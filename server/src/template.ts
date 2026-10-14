/**
 * Mapping expressions. A field value may contain {{ expression }} references:
 *   {{input.amount}}                previous step's output
 *   {{nodes.Get order.body.id}}     any earlier step, by name
 *   {{trigger.body.customer}}       what started the run
 *   {{vars.total}}                  run variables (Set variable step)
 *   {{secret.API_KEY}}              a vault secret (server side only, masked in history)
 *   {{input.name | upper | default:"n/a"}}   pipes
 * When the whole field is one expression, the typed value is kept (object, number, list).
 * No eval: expressions are parsed and only the pipes below can run.
 */
export type Ctx = Record<string, any>;

import { getPath, parsePath, setPath, asText, toNumber, isObj } from './values.js';
import { evalExpression } from './expr.js';
export { getPath, parsePath, setPath, asText, toNumber };


export function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '', q: string | null = null, depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '\\' && i + 1 < s.length) { cur += c + s[++i]; continue; }
      if (c === q) q = null;
      cur += c;
      continue;
    }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '[') depth++;
    if (c === ']') depth--;
    if (c === sep && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

function literal(tok: string, ctx: Ctx): any {
  const t = tok.trim();
  if (t === '') return undefined;
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1).replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : c));
  }
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null') return null;
  return getPath(ctx, t);
}

const xmlEsc = (s: string) => s.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);

type Pipe = (v: any, ...a: any[]) => any;
export const PIPES: Record<string, { fn: Pipe; help: string }> = {
  upper: { fn: v => asText(v).toUpperCase(), help: 'Upper case' },
  lower: { fn: v => asText(v).toLowerCase(), help: 'Lower case' },
  trim: { fn: v => asText(v).trim(), help: 'Remove spaces at both ends' },
  number: { fn: v => toNumber(v), help: 'Convert to a number' },
  int: { fn: v => Math.trunc(toNumber(v)), help: 'Convert to a whole number' },
  string: { fn: v => asText(v), help: 'Convert to text' },
  bool: { fn: v => (typeof v === 'string' ? ['true', '1', 'yes', 'y'].includes(v.trim().toLowerCase()) : !!v), help: 'Convert to true/false' },
  json: { fn: v => JSON.stringify(v), help: 'Turn data into JSON text' },
  parse: { fn: v => (typeof v === 'string' ? JSON.parse(v) : v), help: 'Turn JSON text into data' },
  default: { fn: (v, d) => (v == null || v === '' ? d : v), help: 'default:"x" when empty' },
  length: { fn: v => (v == null ? 0 : Array.isArray(v) || typeof v === 'string' ? v.length : isObj(v) ? Object.keys(v).length : 0), help: 'Number of items or characters' },
  first: { fn: v => (Array.isArray(v) ? v[0] : v), help: 'First item' },
  last: { fn: v => (Array.isArray(v) ? v[v.length - 1] : v), help: 'Last item' },
  join: { fn: (v, s = ',') => (Array.isArray(v) ? v.map(asText).join(s) : asText(v)), help: 'join:", "' },
  split: { fn: (v, s = ',') => asText(v).split(s), help: 'split:","' },
  round: { fn: (v, n = 0) => { const p = 10 ** Number(n); return Math.round(toNumber(v) * p) / p; }, help: 'round:2' },
  add: { fn: (v, n) => toNumber(v) + toNumber(n), help: 'add:10' },
  sub: { fn: (v, n) => toNumber(v) - toNumber(n), help: 'sub:10' },
  mul: { fn: (v, n) => toNumber(v) * toNumber(n), help: 'mul:1.18' },
  div: { fn: (v, n) => toNumber(v) / toNumber(n), help: 'div:100' },
  concat: { fn: (v, ...a) => asText(v) + a.map(asText).join(''), help: 'concat:"-":input.id' },
  replace: { fn: (v, a, b = '') => asText(v).split(asText(a)).join(asText(b)), help: 'replace:"a":"b"' },
  substr: { fn: (v, s = 0, l?: number) => asText(v).substr(Number(s), l == null ? undefined : Number(l)), help: 'substr:0:5' },
  pad: { fn: (v, n = 2, c = '0') => asText(v).padStart(Number(n), asText(c)), help: 'pad:6:"0"' },
  base64: { fn: v => Buffer.from(asText(v), 'utf8').toString('base64'), help: 'Encode as Base64' },
  unbase64: { fn: v => Buffer.from(asText(v), 'base64').toString('utf8'), help: 'Decode Base64' },
  urlencode: { fn: v => encodeURIComponent(asText(v)), help: 'Encode for a URL' },
  urldecode: { fn: v => decodeURIComponent(asText(v)), help: 'Decode a URL part' },
  xmlescape: { fn: v => xmlEsc(asText(v)), help: 'Escape for XML' },
  date: {
    fn: (v, f = 'iso') => {
      const d = v == null || v === '' ? new Date() : new Date(typeof v === 'number' || /^\d+$/.test(String(v)) ? Number(v) : String(v));
      if (isNaN(d.getTime())) return '';
      if (f === 'epoch') return d.getTime();
      if (f === 'date') return d.toISOString().slice(0, 10);
      if (f === 'time') return d.toISOString().slice(11, 19);
      return d.toISOString();
    },
    help: 'date:"iso" | "date" | "time" | "epoch"',
  },
  keys: { fn: v => (isObj(v) ? Object.keys(v) : []), help: 'Field names of an object' },
  values: { fn: v => (isObj(v) ? Object.values(v) : []), help: 'Field values of an object' },
  get: { fn: (v, p) => getPath(v, asText(p)), help: 'get:"a.b"' },
  map: { fn: (v, p) => (Array.isArray(v) ? v.map(x => getPath(x, asText(p))) : []), help: 'map:"name" picks a field from every item' },
  sum: { fn: (v, p) => (Array.isArray(v) ? v.reduce((a, x) => a + (toNumber(p ? getPath(x, asText(p)) : x) || 0), 0) : 0), help: 'sum or sum:"amount"' },
  list: { fn: v => (v == null ? [] : Array.isArray(v) ? v : [v]), help: 'Make sure the value is a list' },
};

export function evalExpr(expr: string, ctx: Ctx): any {
  const [head, ...pipes] = splitTop(expr, '|');
  let v = literal(head, ctx);
  for (const p of pipes) {
    const [name, ...args] = splitTop(p.trim(), ':');
    const pipe = PIPES[name.trim()];
    if (!pipe) throw new Error(`Unknown pipe "${name.trim()}" in {{${expr.trim()}}}`);
    v = pipe.fn(v, ...args.map(a => literal(a, ctx)));
  }
  return v;
}

const WHOLE = /^\s*\{\{((?:(?!\{\{|\}\}).)+)\}\}\s*$/s;
const ANY = /\{\{((?:(?!\{\{|\}\}).)+)\}\}/gs;

export function resolve(t: unknown, ctx: Ctx): any {
  if (typeof t !== 'string') return t;
  // "=" starts an expression: =concat('Name: ', {input.name}). "\=" keeps a literal leading "=".
  if (t.startsWith('=')) return evalExpression(t.slice(1), ctx);
  const s = t.startsWith('\\=') ? t.slice(1) : t;
  const whole = s.match(WHOLE);
  if (whole) return evalExpr(whole[1], ctx);
  return s.replace(ANY, (_: string, e: string) => asText(evalExpr(e, ctx)));
}

/** Resolves every string inside a JSON-like structure. */
export function resolveDeep(v: unknown, ctx: Ctx): any {
  if (typeof v === 'string') return resolve(v, ctx);
  if (Array.isArray(v)) return v.map(x => resolveDeep(x, ctx));
  if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolveDeep(x, ctx)]));
  return v;
}

export const hasRefs = (t: unknown) => typeof t === 'string' && /\{\{.+?\}\}/s.test(t);
