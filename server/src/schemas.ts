/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { q, now } from './db.js';
import { config } from './config.js';

/**
 * Shared schemas of a project: JSON Schema, a sample JSON document (its shape is
 * inferred), XSD, and WSDL service descriptors. Every schema converts to one tree
 * format that the mapper (Activity Input) and the Process Data / Output views use.
 */
export type SType = 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'date' | 'any' | 'null';
export interface SNode {
  name: string;
  type: SType;
  /** A list of this node (array / maxOccurs > 1). */
  repeats?: boolean;
  required?: boolean;
  children?: SNode[];
  doc?: string;
  enum?: string[];
  /** XML attribute (key "@_name" in parsed and rendered XML). */
  attr?: boolean;
  minItems?: number;
  maxItems?: number;
  namespace?: string;
}

export type SchemaKind = 'json' | 'xsd' | 'wsdl';
export interface SchemaRow { id: string; project_id: string; name: string; kind: SchemaKind; root: string | null; text: string; updated_at: string; folder?: string }

export const listSchemas = (projectId: string) =>
  q.all<SchemaRow>('select id, project_id, name, kind, root, folder, updated_at from schemas where project_id = ? order by kind, name', projectId);
export const getSchema = (id: string) => q.get<SchemaRow>('select * from schemas where id = ?', id);

export function saveSchema(s: { id?: string; project_id: string; name: string; kind: SchemaKind; root?: string; text: string }) {
  if (!['json', 'xsd', 'wsdl'].includes(s.kind)) throw new Error('Schema kind must be json, xsd or wsdl');
  const name = String(s.name || '').trim();
  if (!name) throw new Error('Schema name is required');
  const id = s.id || crypto.randomUUID();
  if (q.get('select 1 from schemas where project_id = ? and lower(name) = lower(?) and id != ?', s.project_id, name, id)) throw new Error(`This project already has a schema named "${name}"`);
  // Validate by converting it once.
  if (s.kind === 'json') jsonTree(parseJsonText(s.text), name);
  if (s.kind === 'xsd') xsdRoots(s.text);
  if (s.kind === 'wsdl' && !/<(\w+:)?definitions[\s>]/.test(s.text)) throw new Error('This is not a WSDL 1.1 document (no definitions element)');
  q.run(`insert into schemas(id, project_id, name, kind, root, text, updated_at) values(?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set name = excluded.name, kind = excluded.kind, root = excluded.root, text = excluded.text, updated_at = excluded.updated_at`,
    id, s.project_id, name, s.kind, s.root || null, s.text, now());
  if (s.kind === 'wsdl') fs.rmSync(wsdlFile(id), { force: true });
  return getSchema(id)!;
}

export function deleteSchema(id: string) {
  q.run('delete from schemas where id = ?', id);
  fs.rmSync(wsdlFile(id), { force: true });
}

/** node-soap reads WSDL from a URL or file; project WSDLs are written to a cache file. */
export function wsdlFile(id: string) {
  return path.join(config.dataDir, 'wsdl-cache', `${id}.wsdl`);
}
export function wsdlPath(id: string) {
  const s = getSchema(id);
  if (!s || s.kind !== 'wsdl') throw new Error('Service descriptor (WSDL) not found');
  const f = wsdlFile(id);
  if (!fs.existsSync(f)) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s.text); }
  return f;
}

function parseJsonText(t: string) {
  try { return JSON.parse(t); } catch (e: any) { throw new Error(`Not valid JSON: ${e.message}`); }
}

/** Schema reference stored in activity config: "schemaId" or "schemaId::RootElement". */
export function schemaTree(ref: string | undefined | null): SNode | null {
  if (!ref) return null;
  const [id, rootSel] = String(ref).split('::');
  const s = getSchema(id);
  if (!s) return null;
  return schemaTreeFromRow(s, rootSel);
}

/** Build a draft's tree without saving it or changing process-global schema caches. */
export function schemaTreeFromRow(s: Pick<SchemaRow, 'kind' | 'text' | 'name' | 'root'>, rootSel?: string): SNode | null {
  if (s.kind === 'json') return jsonTree(parseJsonText(s.text), s.name);
  if (s.kind === 'xsd') {
    const { roots, build } = xsdRoots(s.text);
    const root = rootSel || s.root || roots[0];
    if (!root) throw new Error(`${s.name} has no top-level element`);
    return { name: s.name, type: 'object', children: [build(root)] };
  }
  return null;
}

export function schemaRoots(id: string): string[] {
  const s = getSchema(id);
  if (!s || s.kind !== 'xsd') return [];
  return xsdRoots(s.text).roots;
}

// ---------- JSON Schema and samples ----------

export const looksLikeSchema = (v: any): boolean => {
  if (typeof v === 'boolean') return true;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const types = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'];
  if (typeof v.type === 'string' && types.includes(v.type)) return true;
  if (Array.isArray(v.type) && v.type.every((t: any) => types.includes(t))) return true;
  if (v.items !== undefined && (typeof v.items === 'boolean' || (v.items && typeof v.items === 'object' && !Array.isArray(v.items)))) return true;
  return ['$schema', '$ref', '$defs', 'properties', 'allOf', 'oneOf', 'anyOf', 'not', 'if', 'required', 'enum', 'const', 'additionalProperties', 'pattern', 'minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems'].some(k => Object.hasOwn(v, k));
};

export function jsonTree(doc: any, name = 'root'): SNode {
  return looksLikeSchema(doc) ? fromJsonSchema(doc, doc, name, 0) : inferTree(doc, name);
}

function fromJsonSchema(s: any, rootDoc: any, name: string, depth: number): SNode {
  if (depth > 12 || !s || typeof s !== 'object') return { name, type: 'any' };
  if (s.$ref) {
    const m = /^#\/(definitions|\$defs)\/(.+)$/.exec(s.$ref);
    const target = m ? rootDoc?.[m[1]]?.[m[2]] : undefined;
    return target ? { ...fromJsonSchema(target, rootDoc, name, depth + 1), doc: s.description || target.description } : { name, type: 'any', doc: `Unresolved ${s.$ref}` };
  }
  if (Array.isArray(s.allOf)) {
    const { allOf, ...own } = s;
    const parts = [fromJsonSchema(own, rootDoc, name, depth + 1), ...allOf.map((x: any) => fromJsonSchema(x, rootDoc, name, depth + 1))];
    const children = new Map<string, SNode>();
    for (const part of parts) for (const child of part.children || []) {
      const prior = children.get(child.name);
      children.set(child.name, { ...prior, ...child, required: prior?.required || child.required || s.required?.includes(child.name) });
    }
    return { name, type: 'object', children: [...children.values()], doc: s.description };
  }
  const alt = s.oneOf || s.anyOf;
  if (Array.isArray(alt)) {
    const nonNull = alt.filter((x: any) => x?.type !== 'null');
    return nonNull.length === 1 ? fromJsonSchema(nonNull[0], rootDoc, name, depth + 1) : { name, type: 'any', doc: s.description };
  }
  let type = Array.isArray(s.type) ? s.type.find((t: string) => t !== 'null') : s.type;
  if (!type) type = s.properties ? 'object' : s.items ? 'array' : 'any';
  if (type === 'array') {
    const item = fromJsonSchema(s.items || {}, rootDoc, name, depth + 1);
    return { ...item, name, repeats: true, minItems: s.minItems, maxItems: s.maxItems, doc: s.description || item.doc };
  }
  if (type === 'object') {
    const req: string[] = Array.isArray(s.required) ? s.required : [];
    return {
      name, type: 'object', doc: s.description,
      children: Object.entries<any>(s.properties || {}).map(([k, v]) => ({ ...fromJsonSchema(v, rootDoc, k, depth + 1), required: req.includes(k) })),
    };
  }
  const t: SType = type === 'string' && /date/.test(s.format || '') ? 'date' : (['string', 'number', 'integer', 'boolean', 'null'].includes(type) ? type : 'any');
  return { name, type: t, doc: s.description, enum: Array.isArray(s.enum) ? s.enum.map(String) : undefined };
}

/** Shape of an example value (used for samples, test payloads and run outputs). */
export function inferTree(v: any, name = 'root', depth = 0): SNode {
  if (depth > 12) return { name, type: 'any' };
  if (Array.isArray(v)) {
    const objs = v.filter(x => x && typeof x === 'object' && !Array.isArray(x)).slice(0, 20);
    if (objs.length) return { ...inferTree(Object.assign({}, ...objs.reverse()), name, depth + 1), repeats: true };
    return { ...(v.length ? inferTree(v[0], name, depth + 1) : { name, type: 'any' as SType }), repeats: true };
  }
  if (v && typeof v === 'object') return { name, type: 'object', children: Object.entries(v).map(([k, x]) => inferTree(x, k, depth + 1)) };
  if (typeof v === 'number') return { name, type: Number.isInteger(v) ? 'integer' : 'number' };
  if (typeof v === 'boolean') return { name, type: 'boolean' };
  if (v === null) return { name, type: 'any' };
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(v)) return { name, type: 'date' };
  return { name, type: v === undefined ? 'any' : 'string' };
}

// ---------- XSD ----------

const xsdParser = new XMLParser({
  ignoreAttributes: false, attributeNamePrefix: '', removeNSPrefix: true, parseAttributeValue: false,
  isArray: n => ['element', 'attribute', 'complexType', 'simpleType', 'sequence', 'choice', 'all', 'group', 'attributeGroup', 'enumeration'].includes(n),
});

const BUILTIN: Record<string, SType> = {
  string: 'string', normalizedString: 'string', token: 'string', anyURI: 'string', QName: 'string', ID: 'string', IDREF: 'string', NCName: 'string', language: 'string', base64Binary: 'string', hexBinary: 'string',
  int: 'integer', integer: 'integer', long: 'integer', short: 'integer', byte: 'integer', nonNegativeInteger: 'integer', positiveInteger: 'integer', unsignedInt: 'integer', unsignedLong: 'integer', unsignedShort: 'integer', negativeInteger: 'integer', nonPositiveInteger: 'integer',
  decimal: 'number', float: 'number', double: 'number', boolean: 'boolean',
  date: 'date', dateTime: 'date', time: 'string', duration: 'string', gYear: 'string', anyType: 'any', anySimpleType: 'string',
};
const local = (q: string) => String(q || '').replace(/^.*:/, '');

export function xsdRoots(text: string) {
  let doc: any;
  try { doc = xsdParser.parse(text); } catch (e: any) { throw new Error(`Not valid XML: ${e.message}`); }
  const schema = doc.schema;
  if (!schema) throw new Error('This is not an XSD (no xs:schema element)');
  const elements = new Map<string, any>((schema.element || []).map((e: any) => [e.name, e]));
  const complex = new Map<string, any>((schema.complexType || []).map((e: any) => [e.name, e]));
  const simple = new Map<string, any>((schema.simpleType || []).map((e: any) => [e.name, e]));
  const groups = new Map<string, any>((schema.group || []).map((e: any) => [e.name, e]));
  const attrGroups = new Map<string, any>((schema.attributeGroup || []).map((e: any) => [e.name, e]));

  const simpleOf = (typeName: string, st?: any): { type: SType; enum?: string[] } => {
    const n = local(typeName);
    if (BUILTIN[n]) return { type: BUILTIN[n] };
    const s = st || simple.get(n);
    const r = s?.restriction;
    if (r) {
      const base = simpleOf(r.base || 'string');
      const en = (r.enumeration || []).map((e: any) => String(e.value));
      return { type: base.type, enum: en.length ? en : undefined };
    }
    if (s?.list) return { type: 'string' };
    return { type: 'string' };
  };

  const attrs = (ct: any, depth: number): SNode[] => [
    ...(ct?.attribute || []).map((a: any) => {
      const def = a.ref ? undefined : a;
      const nm = a.name || local(a.ref);
      const t = def?.simpleType ? simpleOf('', def.simpleType[0]) : simpleOf(def?.type || 'string');
      return { name: '@_' + nm, attr: true, type: t.type, enum: t.enum, required: a.use === 'required' } as SNode;
    }),
    ...(ct?.attributeGroup || []).flatMap((g: any) => (depth < 8 ? attrs(attrGroups.get(local(g.ref)), depth + 1) : [])),
  ];

  const particles = (c: any, depth: number): SNode[] => {
    if (!c || depth > 14) return [];
    const out: SNode[] = [];
    for (const key of ['sequence', 'all', 'choice']) {
      for (const p of c[key] || []) {
        const many = p.maxOccurs === 'unbounded' || Number(p.maxOccurs) > 1;
        for (const e of p.element || []) out.push({ ...element(e, depth + 1, many), ...(key === 'choice' ? { required: false } : {}) });
        for (const g of p.group || []) out.push(...particles(groups.get(local(g.ref)), depth + 1));
        out.push(...particles(p, depth + 1).filter(x => !out.some(o => o.name === x.name)));
      }
    }
    return out;
  };

  const complexChildren = (ct: any, depth: number): { children: SNode[]; text?: SType } => {
    if (!ct || depth > 14) return { children: [] };
    const cc = ct.complexContent;
    if (cc) {
      const ext = cc.extension || cc.restriction;
      const base = ext?.base ? complexChildren(complex.get(local(ext.base)), depth + 1) : { children: [] };
      return { children: [...base.children, ...particles(ext, depth), ...attrs(ext, depth)] };
    }
    const sc = ct.simpleContent;
    if (sc) {
      const ext = sc.extension || sc.restriction;
      return { children: attrs(ext, depth), text: simpleOf(ext?.base || 'string').type };
    }
    return { children: [...particles(ct, depth), ...attrs(ct, depth)] };
  };

  const element = (e: any, depth: number, parentMany = false): SNode => {
    if (e.ref) {
      const target = elements.get(local(e.ref));
      const base = target && depth < 14 ? element(target, depth + 1) : { name: local(e.ref), type: 'any' as SType };
      return { ...base, repeats: parentMany || e.maxOccurs === 'unbounded' || Number(e.maxOccurs) > 1, required: e.minOccurs !== '0' };
    }
    const repeats = parentMany || e.maxOccurs === 'unbounded' || Number(e.maxOccurs) > 1;
    const required = e.minOccurs !== '0';
    const doc = typeof e.annotation?.documentation === 'string' ? e.annotation.documentation : undefined;
    const ct = e.complexType?.[0] || (e.type && complex.get(local(e.type)));
    if (ct) {
      const { children, text } = complexChildren(ct, depth);
      if (text) return { name: e.name, type: 'object', repeats, required, doc, children: [{ name: '#text', type: text }, ...children] };
      return { name: e.name, type: 'object', repeats, required, doc, children };
    }
    const st = e.simpleType?.[0];
    const t = st ? simpleOf('', st) : simpleOf(e.type || 'string');
    return { name: e.name, type: t.type, enum: t.enum, repeats, required, doc };
  };

  return {
    roots: [...elements.keys()],
    build: (root: string) => {
      const e = elements.get(root);
      if (!e) throw new Error(`Element ${root} is not a top-level element of this XSD`);
      const result = element(e, 0);
      if (schema.targetNamespace && result.type === 'object') result.namespace = schema.targetNamespace;
      return result;
    },
  };
}

/** Explicit mapper limits: this tree is not a complete JSON Schema/XSD validator. */
export function schemaWarnings(ref: string | undefined): string[] {
  if (!ref) return [];
  const schema = getSchema(String(ref).split('::')[0]);
  if (!schema) return ['Selected shared schema is missing'];
  const warnings: string[] = [];
  if (schema.kind === 'json') {
    const text = schema.text;
    if (/"(?:oneOf|anyOf|not|if|then|else|dependentSchemas|patternProperties|prefixItems)"\s*:/.test(text)) warnings.push('This JSON Schema has conditional, alternative or dynamic fields; the mapper shows an approximate shape. Selected-schema runtime validation checks the completed value.');
  } else if (schema.kind === 'xsd') {
    if (/<(?:\w+:)?(?:choice|any|anyAttribute|import|include)\b/.test(schema.text)) warnings.push('The mapping tree approximates XSD alternatives/wildcards; selected-schema runtime validation enforces XSD 1.0. Imports/includes require matching project-local XSD resources.');
    if (/<(?:\w+:)?group\b[^>]*(?:minOccurs|maxOccurs)/.test(schema.text)) warnings.push('XSD group-level occurrence constraints are not fully represented; review repeating fields.');
  }
  return warnings;
}

/** Finds a node by '/'-separated path in a tree (used by the mapper). */
export function nodeAt(tree: SNode, p: string): SNode | undefined {
  let cur: SNode | undefined = tree;
  for (const seg of p.split('/').filter(Boolean)) cur = cur?.children?.find(c => c.name === seg);
  return cur;
}
