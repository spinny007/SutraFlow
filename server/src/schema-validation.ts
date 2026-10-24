/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 2.0.7
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { XMLBuilder } from 'fast-xml-parser';
import { createRequire } from 'node:module';
import { getSchema, listSchemas } from './schemas.js';
import { validateMessage } from './security/validate.js';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
const require = createRequire(import.meta.url);
const { validateXML } = require('xmllint-wasm') as typeof import('xmllint-wasm');
const builder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '@_', suppressEmptyNode: true });
const MAX_TEXT = 4 * 1024 * 1024;
let active = 0;
const waiting: (() => void)[] = [];
async function acquire() {
  if (active < 4) { active++; return; }
  if (waiting.length >= 64) throw new Error('XML validation queue is full; retry later.');
  await new Promise<void>(resolve => waiting.push(resolve));
}
function release() { const next = waiting.shift(); if (next) next(); else active--; }

/** Standards validator; schemas are loaded only from the same project, never from a URL or disk. */
export async function validateStructured(ref: string | undefined, value: any, rawXml?: string): Promise<string[]> {
  if (!ref) return [];
  const schema = getSchema(String(ref).split('::')[0]);
  if (!schema) return ['Selected schema no longer exists'];
  if (schema.kind === 'json') return validateMessage(ref, value);
  if (schema.kind !== 'xsd') return ['Choose a JSON Schema or XSD'];
  const xml = rawXml ?? builder.build(value);
  if (Buffer.byteLength(xml) > MAX_TEXT) return ['XML validation input exceeds 4 MB; split the document into records.'];
  const files: { fileName: string; contents: string }[] = [{ fileName: 'main.xsd', contents: schema.text }];
  const available = listSchemas(schema.project_id).filter(s => s.kind === 'xsd');
  const visit = (text: string, current = 'main.xsd') => {
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('DTD/entity declarations are not accepted by schema validation.');
    if (/<(?:\w+:)?(?:assert|alternative|openContent|override)\b/.test(text)) throw new Error('XSD 1.1 constructs are not supported; use an XSD 1.0 schema.');
    for (const match of text.matchAll(/\bschemaLocation\s*=\s*["']([^"']+)["']/g)) {
      const location = match[1];
      if (!/^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(location) || location.split('/').includes('..') || location.startsWith('/')) throw new Error('Schema dependencies must be safe project-local filenames: ' + location);
      const base = current.includes('/') ? current.slice(0, current.lastIndexOf('/') + 1) : '';
      const filename = base + location;
      if (files.some(f => f.fileName === filename)) continue;
      const candidates = available.filter(s => s.name === filename || s.name + '.xsd' === filename);
      if (candidates.length !== 1) throw new Error('Add exactly one XSD named "' + filename + '" in this project for the schema dependency.');
      const dependency = getSchema(candidates[0].id)!;
      files.push({ fileName: filename, contents: dependency.text });
      if (files.length > 32 || files.reduce((n, f) => n + f.contents.length, 0) > 1024 * 1024) throw new Error('XSD dependencies exceed 32 files or 1 MB.');
      visit(dependency.text, filename);
    }
  };
  try {
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) return ['XML DTD/entity declarations are not accepted.'];
    const selectedRoot = String(ref).split('::')[1] || schema.root;
    if (selectedRoot) {
      const root = new DOMParser().parseFromString(xml, 'application/xml').documentElement;
      if (root?.localName !== selectedRoot) return ['XML root element must be ' + selectedRoot];
    }
    visit(schema.text);
    await acquire();
    try {
      const result = await validateXML({ xml: [{ fileName: 'document.xml', contents: xml }], schema: [files[0]], preload: files.slice(1), initialMemoryPages: 256, maxMemoryPages: 512, modifyArguments: args => ['--nonet', ...args] });
      return result.valid ? [] : result.errors.slice(0, 20).map(e => e.message || e.rawMessage);
    } finally { release(); }
  } catch (e: any) { return ['XSD validation: ' + e.message]; }
}

/** Validate only the SOAP operation, retaining inherited namespace bindings for XSD. */
export async function validateSoapOperation(ref: string, value: any, envelope: string): Promise<string[]> {
  const schema = getSchema(ref.split('::')[0]);
  if (schema?.kind !== 'xsd') return validateStructured(ref, value);
  try {
    if (/<!DOCTYPE|<!ENTITY/i.test(envelope)) return ['XML DTD/entity declarations are not accepted.'];
    const doc = new DOMParser().parseFromString(envelope, 'application/xml');
    const bodies = ['http://schemas.xmlsoap.org/soap/envelope/', 'http://www.w3.org/2003/05/soap-envelope']
      .flatMap(ns => Array.from(doc.getElementsByTagNameNS(ns, 'Body')));
    if (bodies.length !== 1) return ['SOAP requires exactly one Body'];
    const operations = Array.from(bodies[0].childNodes).filter(n => n.nodeType === 1);
    if (operations.length !== 1) return ['SOAP requires exactly one operation'];
    return validateStructured(ref, value, new XMLSerializer().serializeToString(operations[0]));
  } catch (e: any) { return ['SOAP schema validation: ' + e.message]; }
}
