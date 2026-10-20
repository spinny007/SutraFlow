/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.8.0
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
/**
 * Checks on what callers send to a REST or SOAP service, before a run starts:
 *
 *  Threat protection  limits from the service's API security policy (nesting depth, fields, list
 *                     items, string length, body size), and no DOCTYPE in XML (no entity expansion,
 *                     no external entities). Depth is measured on the raw text, before parsing.
 *  Validation         the body against the service's schema: JSON Schema (draft 2020-12, 2019-09 and
 *                     07) with ajv; an XSD element, or a JSON sample, as the schema tree the mapper
 *                     uses (elements and fields required, their types, single or repeated, allowed
 *                     values, and nothing undeclared for an XSD).
 */
import { createRequire } from 'node:module';
import { getSchema, jsonTree, xsdRoots, type SNode } from '../schemas.js';

const require = createRequire(import.meta.url);
// ajv ships CommonJS; formats add date-time, email, uri and the like.
const Ajv2020 = require('ajv/dist/2020').default;
const Ajv2019 = require('ajv/dist/2019').default;
const AjvDraft7 = require('ajv').default;
const addFormats = require('ajv-formats').default;

// ---------- threat protection ----------

export interface ThreatLimits {
  /** Deepest nesting of objects, lists or elements. */
  maxDepth: number;
  /** Fields (object keys, elements and attributes) in the whole message. */
  maxFields: number;
  /** Items in one list. */
  maxItems: number;
  /** Characters in one string value, in KB. */
  maxStringKb: number;
}
/** Applied to every service; a policy can set its own. Generous: real messages stay far below them. */
export const DEFAULT_LIMITS: ThreatLimits = { maxDepth: 64, maxFields: 50000, maxItems: 50000, maxStringKb: 1024 };

export function limitsOf(policyConfig: Record<string, any> | undefined): ThreatLimits {
  const n = (k: keyof ThreatLimits) => {
    const v = Number(policyConfig?.[k]);
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_LIMITS[k];
  };
  return { maxDepth: n('maxDepth'), maxFields: n('maxFields'), maxItems: n('maxItems'), maxStringKb: n('maxStringKb') };
}

export class MessageRejected extends Error {
  constructor(message: string, readonly status = 400, readonly errors: string[] = []) { super(message); }
}

/** Nesting depth of JSON text, outside strings, without parsing it. */
function jsonDepth(raw: string, max: number) {
  let depth = 0, inStr = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (inStr) {
      if (c === 92) i++; // backslash: skip the escaped character
      else if (c === 34) inStr = false;
      continue;
    }
    if (c === 34) inStr = true;
    else if (c === 123 || c === 91) { if (++depth > max) return depth; }
    else if (c === 125 || c === 93) depth--;
  }
  return depth;
}
/** Element nesting depth of XML text, without parsing it (comments and CDATA skipped). */
function xmlDepth(raw: string, max: number) {
  let depth = 0;
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<(\/?)[^\s>/!?]+[^>]*?(\/?)>/g;
  for (let m; (m = re.exec(raw));) {
    if (m[1] === undefined) continue;
    if (m[1] === '/') depth--;
    else if (m[2] !== '/' && ++depth > max) return depth;
  }
  return depth;
}

/** Before parsing: XML without a DOCTYPE, and nesting within the limit. */
export function checkRaw(raw: string, format: 'json' | 'xml' | 'other', limits: ThreatLimits) {
  if (!raw) return;
  if (format === 'xml') {
    if (/<!DOCTYPE/i.test(raw)) throw new MessageRejected('XML with a DOCTYPE is not accepted (entity declarations are refused)');
    if (xmlDepth(raw, limits.maxDepth) > limits.maxDepth) throw new MessageRejected(`The message is nested deeper than ${limits.maxDepth} levels`);
  } else if (format === 'json') {
    if (jsonDepth(raw, limits.maxDepth) > limits.maxDepth) throw new MessageRejected(`The message is nested deeper than ${limits.maxDepth} levels`);
  }
}

/** After parsing: fields in the message, items per list, and the length of every string. */
export function checkParsed(v: any, limits: ThreatLimits) {
  let fields = 0;
  const maxChars = limits.maxStringKb * 1024;
  const walk = (x: any, depth: number) => {
    if (depth > limits.maxDepth) throw new MessageRejected(`The message is nested deeper than ${limits.maxDepth} levels`);
    if (typeof x === 'string') { if (x.length > maxChars) throw new MessageRejected(`A text value is longer than ${limits.maxStringKb} KB`); return; }
    if (Array.isArray(x)) {
      if (x.length > limits.maxItems) throw new MessageRejected(`A list has more than ${limits.maxItems} items`);
      for (const y of x) walk(y, depth + 1);
      return;
    }
    if (x && typeof x === 'object') {
      for (const k of Object.keys(x)) {
        if (++fields > limits.maxFields) throw new MessageRejected(`The message has more than ${limits.maxFields} fields`);
        walk(x[k], depth + 1);
      }
    }
  };
  walk(v, 0);
}

// ---------- validation ----------

const MAX_ERRORS = 20;
type Check = (body: any) => string[];
const cache = new Map<string, { at: number; stamp: string; check: Check }>();

/**
 * The check for a schema reference ("schemaId" or "schemaId::RootElement"): for an XSD with several
 * top-level elements, the element named like the message root (or like the SOAP operation).
 * Cached for 5 s (a changed schema applies on every engine within that time).
 */
function checkFor(ref: string, element?: string): Check | null {
  const key = `${ref}|${element || ''}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 5000) return hit.check;
  const [id, rootSel] = String(ref).split('::');
  const s = getSchema(id);
  if (!s) return null;
  if (hit && hit.stamp === s.updated_at) { hit.at = Date.now(); return hit.check; }
  let check: Check;
  if (s.kind === 'json') {
    const doc = JSON.parse(s.text);
    const isSchema = doc && typeof doc === 'object' && !Array.isArray(doc) && (doc.$schema || doc.type || doc.properties || doc.$ref || doc.allOf || doc.oneOf || doc.anyOf);
    if (isSchema) {
      const draft = String(doc.$schema || '');
      const ajv = new (/2020-12/.test(draft) ? Ajv2020 : /2019-09/.test(draft) ? Ajv2019 : AjvDraft7)({ allErrors: true, strict: false, validateFormats: true });
      addFormats(ajv);
      const validate = ajv.compile(doc);
      check = body => (validate(body) ? [] : (validate.errors || []).slice(0, MAX_ERRORS).map((e: any) =>
        `${e.instancePath ? `body${e.instancePath.replace(/\//g, '.')}` : 'body'}: ${e.message}${e.params?.additionalProperty ? ` (${e.params.additionalProperty})` : ''}${e.params?.allowedValues ? ` (${e.params.allowedValues.join(', ')})` : ''}`));
    } else {
      // A JSON sample: the types of the fields it shows; fields it does not show are allowed.
      const tree = jsonTree(doc, 'body');
      check = body => { const errs: string[] = []; walkTree(tree, body, 'body', errs, false, false); return errs; };
    }
  } else if (s.kind === 'xsd') {
    const { roots, build } = xsdRoots(s.text);
    const pick = (name: string) => roots.find(r => r.toLowerCase() === name.toLowerCase());
    check = body => {
      const errs: string[] = [];
      if (element) {
        // SOAP: the operation element (its content is the body).
        const root = pick(element) || rootSel || s.root || '';
        if (!pick(root)) return [`The schema ${s.name} has no element ${element}`];
        walkTree(build(pick(root)!), body, element, errs, true, true);
        return errs;
      }
      // REST: the body holds the root element ({ Order: {...} } from XML or JSON).
      const keys = body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body).filter(k => !k.startsWith('?') && !k.startsWith('@_')) : [];
      const want = rootSel || s.root;
      const root = want ? pick(want) : keys.map(pick).find(Boolean);
      if (!root) return [`body: the root element must be ${want || roots.join(' or ')}`];
      if (keys.length !== 1 || keys[0] !== root) return [`body: the root element must be ${root}${keys.length ? `, not ${keys.join(', ')}` : ''}`];
      walkTree(build(root), body[root], root, errs, true, true);
      return errs;
    };
  } else return null;
  cache.set(key, { at: Date.now(), stamp: s.updated_at, check });
  return check;
}

/** Checks a message against a schema; returns what is wrong (empty when it is valid). */
export function validateMessage(ref: string, body: any, element?: string): string[] {
  const check = checkFor(ref, element);
  if (!check) return [`The schema of this service no longer exists (${ref.split('::')[0]})`];
  return check(body).slice(0, MAX_ERRORS);
}

const DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * A value against a schema tree. strict: undeclared fields are errors (an XSD). xml: values come
 * from XML text (numbers may arrive as text, and one element of a repeated kind is not a list).
 */
function walkTree(node: SNode, v: any, path: string, errs: string[], strict: boolean, xml: boolean) {
  if (errs.length >= MAX_ERRORS) return;
  if (v === undefined || v === null || v === '') {
    if (node.required && (v === undefined || v === null || node.type === 'object')) errs.push(`${path} is required`);
    return;
  }
  if (node.repeats) {
    const list = Array.isArray(v) ? v : xml ? [v] : null;
    if (!list) { errs.push(`${path} must be a list`); return; }
    list.forEach((x, i) => walkTree({ ...node, repeats: false, required: true }, x, `${path}[${i}]`, errs, strict, xml));
    return;
  }
  if (Array.isArray(v)) { errs.push(xml ? `${path} appears more than once` : `${path} must be a single value, not a list`); return; }
  if (node.type === 'object' || node.children?.length) {
    const kids = node.children || [];
    let obj = v;
    if (typeof v !== 'object') {
      // An element with text only: fine when it declares text content (and its attributes are optional).
      if (kids.some(k => k.name === '#text')) obj = { '#text': v };
      else { errs.push(`${path} must have ${xml ? 'child elements' : 'fields'}`); return; }
    }
    for (const k of kids) walkTree(k, obj[k.name], k.name === '#text' ? path : `${path}.${k.name.replace(/^@_/, '@')}`, errs, strict, xml);
    if (strict) {
      const known = new Set(kids.map(k => k.name));
      for (const key of Object.keys(obj)) {
        if (known.has(key) || key.startsWith('@_xmlns') || key.startsWith('?') || key.startsWith('@_xsi:') || key === '@_type' || key === '@_nil') continue;
        if (errs.length < MAX_ERRORS) errs.push(`${path}.${key.replace(/^@_/, '@')} is not allowed here`);
      }
    }
    return;
  }
  const s = typeof v === 'object' ? null : String(v);
  if (s === null) { errs.push(`${path} must be a single value`); return; }
  switch (node.type) {
    case 'integer':
      if (!(xml ? /^[+-]?\d+$/.test(s.trim()) : Number.isInteger(v))) errs.push(`${path} must be a whole number`);
      break;
    case 'number':
      if (!(xml ? s.trim() !== '' && Number.isFinite(Number(s)) : typeof v === 'number' && Number.isFinite(v))) errs.push(`${path} must be a number`);
      break;
    case 'boolean':
      if (!(xml ? /^(true|false|1|0)$/.test(s.trim()) : typeof v === 'boolean')) errs.push(`${path} must be true or false`);
      break;
    case 'date':
      if (!DATE.test(s.trim())) errs.push(`${path} must be a date (YYYY-MM-DD) or date and time`);
      break;
    case 'string':
      if (!xml && typeof v !== 'string') errs.push(`${path} must be text`);
      break;
    default:
  }
  if (node.enum?.length && !node.enum.includes(s)) errs.push(`${path} must be one of: ${node.enum.join(', ')}`);
}
