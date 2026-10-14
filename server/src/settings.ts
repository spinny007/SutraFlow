import type { Field } from './engine/types.js';
import { resolve } from './template.js';

/**
 * General-tab settings (folders, URLs, topics, queue names…) may use project and
 * engine variables: {{gv.INBOX}}, ={gv.BASE_URL}, concat({gv.DIR}, '\\*.csv').
 * Only plain settings are resolved here; code, HTML and mappable inputs keep their
 * text because the activities interpret it themselves.
 */
const DYNAMIC = (v: unknown) => typeof v === 'string' && (v.startsWith('=') || v.includes('{{'));

export function resolveSetting(f: Field | undefined, value: unknown, scope: Record<string, any>): any {
  if (!f || f.tpl || !['text', 'number', 'list', 'select'].includes(f.type)) return value;
  if (Array.isArray(value)) return value.map(x => (DYNAMIC(x) ? resolve(x, scope) : x));
  if (!DYNAMIC(value)) return value;
  const r = resolve(value, scope);
  return f.type === 'number' ? Number(r) : r;
}

export function resolveSettings(fields: Field[], config: Record<string, any>, scope: Record<string, any>) {
  const out: Record<string, any> = { ...config };
  for (const f of fields) if (f.k in out) out[f.k] = resolveSetting(f, out[f.k], scope);
  return out;
}

/** Resource settings: any text value may use {{gv.X}} / = formulas (secret names included). */
export function resolveResourceConfig(config: Record<string, any>, scope: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(config)) {
    out[k] = Array.isArray(v) ? v.map(x => (DYNAMIC(x) ? resolve(x, scope) : x)) : DYNAMIC(v) && !/^(caPem|clientCertPem|certPem|jwtPublicKeyPem)$/.test(k) ? resolve(v, scope) : v;
  }
  return out;
}
