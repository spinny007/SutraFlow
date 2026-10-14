import type { Field } from '../engine/types.js';

export const F = (k: string, label: string, type: Field['type'], def?: any, extra: Partial<Field> = {}): Field => ({ k, label, type, def, ...extra });
export const when = (k: string, ...vals: any[]) => ({ showIf: { k, in: vals } });

export const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

export const listOf = (s: unknown): string[] =>
  Array.isArray(s) ? s.map(x => String(x).trim()).filter(Boolean) : String(s ?? '').split(/[,\n]/).map(x => x.trim()).filter(Boolean);

export function parseJsonText(s: unknown, what: string) {
  if (typeof s !== 'string') return s;
  if (!s.trim()) return null;
  try { return JSON.parse(s); } catch (e: any) { throw new Error(`${what} is not valid JSON: ${e.message}`); }
}

export function needList(v: unknown, label: string): any[] {
  if (!Array.isArray(v)) throw new Error(`${label} must be a list, but got ${v === undefined ? 'nothing' : typeof v}. Check the mapping.`);
  return v;
}

/** Write options shared by file-like activities: Append wins, then Overwrite; neither = fail if the file exists. */
export const writeFields = (showIf?: Field['showIf']) => [
  F('append', 'Append to the end of the file', 'bool', false, { help: 'Adds the content after what is already there (creates the file if missing).', ...(showIf ? { showIf } : {}) }),
  F('newline', 'Start appended content on a new line', 'bool', true, { showIf: { k: 'append', in: [true] } }),
  F('overwrite', 'Overwrite if it already exists', 'bool', true, { help: 'Unticked: the step fails when the file exists (and Append is off).', showIf: { k: 'append', in: [false, undefined, ''] } }),
];
export type WriteMode = 'append' | 'overwrite' | 'fail';
export function writeMode(raw: (k: string) => any): WriteMode {
  // Older steps stored a single "mode" select.
  const legacy = raw('mode');
  if (raw('append') === undefined && raw('overwrite') === undefined && legacy) return legacy === 'append' ? 'append' : legacy === 'fail' ? 'fail' : 'overwrite';
  if (raw('append') === true) return 'append';
  return raw('overwrite') === false ? 'fail' : 'overwrite';
}
/** Joins existing and new content for Append, with an optional line break between. */
export function appended(existing: Buffer, add: Buffer, newline: boolean) {
  const sep = newline && existing.length && existing[existing.length - 1] !== 0x0a ? Buffer.from('\n') : Buffer.alloc(0);
  return Buffer.concat([existing, sep, add]);
}

export const OPS = ['equals', 'not equals', 'contains', 'starts with', 'greater than', 'less than', 'is empty', 'is not empty', 'matches regex'];

const num = (x: unknown) => (typeof x === 'number' ? x : x === '' || x == null || typeof x === 'object' ? NaN : Number(String(x).replace(/[,\s]/g, '')));
const txt = (v: unknown) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

export function compare(a: unknown, op: string, b: unknown): boolean {
  const empty = (v: unknown) => v == null || v === '' || (Array.isArray(v) && !v.length) || (isObj(v) && !Object.keys(v).length);
  switch (op) {
    case 'equals':
      return isFinite(num(a)) && isFinite(num(b)) ? num(a) === num(b) : txt(a).trim().toLowerCase() === txt(b).trim().toLowerCase();
    case 'not equals': return !compare(a, 'equals', b);
    case 'contains':
      return Array.isArray(a) ? a.map(x => txt(x).toLowerCase()).includes(txt(b).toLowerCase()) : txt(a).toLowerCase().includes(txt(b).toLowerCase());
    case 'starts with': return txt(a).toLowerCase().startsWith(txt(b).toLowerCase());
    case 'greater than': return num(a) > num(b);
    case 'less than': return num(a) < num(b);
    case 'is empty': return empty(a);
    case 'is not empty': return !empty(a);
    case 'matches regex': try { return new RegExp(txt(b)).test(txt(a)); } catch { throw new Error(`Invalid regular expression: ${txt(b)}`); }
  }
  throw new Error(`Unknown check "${op}"`);
}
