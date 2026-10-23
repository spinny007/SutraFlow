/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
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
  if (!f || f.tpl || (!['text', 'number', 'bool', 'list', 'select', 'kv'].includes(f.type) && !f.vars)) return value;
  if (f.type === 'kv' && Array.isArray(value)) return value.map(row => row && typeof row === 'object'
    ? { ...row, v: DYNAMIC(row.v) ? resolve(row.v, scope) : row.v }
    : row);
  if (Array.isArray(value)) return value.map(x => (DYNAMIC(x) ? resolve(x, scope) : x));
  if (!DYNAMIC(value)) return value;
  const r = resolve(value, scope);
  if (f.type === 'bool') return typeof r === 'string' ? !/^(|0|false|no|off)$/i.test(r.trim()) : !!r;
  return f.type === 'number' ? Number(r) : r;
}

export function resolveSettings(fields: Field[], config: Record<string, any>, scope: Record<string, any>) {
  const out: Record<string, any> = { ...config };
  for (const f of fields) if (f.k in out) out[f.k] = resolveSetting(f, out[f.k], scope);
  return out;
}

/** Resource settings: any text value may use {{gv.X}} / = formulas (secret names included). */
export function resolveResourceConfig(config: Record<string, any>, scope: Record<string, any>) {
  const protectedText = /^(caPem|clientCertPem|certPem|jwtPublicKeyPem|trustedCertsPem|samlIdpCertPem|responseEncryptCertPem|encryptCertPem)$/;
  // A resource is resolved before an activity context (and its secret proxy) exists. Fill only gv/ev
  // here and preserve {{secret.X}} or any step-time reference for the connector to resolve later.
  const staticValue = (text: string) => {
    if (!DYNAMIC(text) || !/(?:\{\{\s*|\{\s*)(?:gv|ev)\./.test(text)) return text;
    if (text.startsWith('=')) {
      const refs = [...text.matchAll(/\{\s*([^{}]+?)\s*\}/g)].map(m => m[1].trim());
      return refs.every(ref => /^(?:gv|ev)\./.test(ref)) ? resolve(text, scope) : text;
    }
    const kept: string[] = [];
    const safe = text.replace(/\{\{[\s\S]*?\}\}/g, ref => {
      if (/^\{\{\s*(?:gv|ev)\./.test(ref)) return ref;
      kept.push(ref);
      return `__SUTRA_REF_${kept.length - 1}__`;
    });
    const filled = String(resolve(safe, scope) ?? '');
    return filled.replace(/__SUTRA_REF_(\d+)__/g, (_all, n) => kept[Number(n)] ?? '');
  };
  const walk = (v: unknown, key = ''): any => {
    if (typeof v === 'string') {
      if (!protectedText.test(key)) return staticValue(v);
      // PEM/configuration text is normally literal so certificate contents can
      // never be treated as a template. An exact Project/Engine-property
      // reference is safe and lets administrators select a certificate per
      // deployment without copying it into every connection.
      return /^\s*\{\{\s*(?:gv|ev)\.[^{}]+\s*\}\}\s*$/.test(v) ? staticValue(v) : v;
    }
    if (Array.isArray(v)) return v.map(x => walk(x));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
    return v;
  };
  return walk(config);
}

/**
 * Administrator-controlled text that becomes executable configuration (SQL text, procedure names).
 * Only Project and Engine properties may shape it. Run input, trigger data, prior outputs, local
 * variables and secrets must travel through the activity's bound/value fields instead.
 */
export function resolveAdminText(value: unknown, scope: Record<string, any>, label: string): string {
  const text = String(value ?? '');
  if (!DYNAMIC(text)) return text;
  const refs = text.startsWith('=')
    ? [...text.matchAll(/\{\s*([^{}]+?)\s*\}/g)].map(m => m[1].trim())
    : [...text.matchAll(/\{\{\s*([\s\S]*?)\s*\}\}/g)].map(m => m[1].trim());
  const unsafe = refs.find(ref => !/^(?:gv|ev)\./.test(ref));
  if (unsafe) throw new Error(`${label} may use only Project and Engine properties (gv/ev); put run data in bound parameters, not {{${unsafe}}}`);
  return String(resolve(text, scope) ?? '');
}
