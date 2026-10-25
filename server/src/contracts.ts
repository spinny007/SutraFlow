/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 2.0.10
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available; see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { getSchema } from './schemas.js';
import { validateStructured } from './schema-validation.js';
import { booleanSetting } from './settings.js';
import { resolve } from './template.js';
import { validateMessage } from './security/validate.js';
import { XMLBuilder } from 'fast-xml-parser';
import { DOMParser } from '@xmldom/xmldom';
import { schemaTree } from './schemas.js';

export function contractDefinition(ref: unknown, options: { projectId: string | null; subject: string; kind?: 'json' | 'xsd' }) {
  const fail = (message: string): never => { throw Object.assign(new Error(`${options.subject}: ${message}`), { statusCode: 400 }); };
  if (typeof ref !== 'string' || !ref.trim()) fail('Strict validation is On: select a schema.');
  const schema = getSchema(String(ref).split('::')[0]);
  if (!schema) fail('The selected schema no longer exists.');
  if (schema!.project_id !== options.projectId) fail('The selected schema belongs to another project.');
  if (options.kind && schema!.kind !== options.kind) fail(`Validation requires ${options.kind === 'json' ? 'a JSON Schema/sample' : 'an XSD'}.`);
  if (schema!.kind === 'json') {
    // Compile even when a query returns zero records. Null-validation findings are irrelevant here.
    try { validateMessage(String(ref), null); } catch (error: any) { fail(`Invalid schema: ${error.message}`); }
  }
  return schema!;
}

/** One strict boundary: validate the actual value, never mutate/coerce it or substitute examples. */
export async function enforceContract(ref: unknown, value: unknown, options: { projectId: string | null; subject: string; kind?: 'json' | 'xsd'; xml?: string }) {
  const fail = (message: string): never => { throw Object.assign(new Error(`${options.subject}: ${message}`), { statusCode: 400 }); };
  const schema = contractDefinition(ref, options);
  let issues: string[];
  try { issues = await validateStructured(String(ref), value, options.xml, options.kind); }
  catch (error: any) { fail(`Invalid schema: ${error.message}`); }
  if (issues!.length) fail(`does not match ${schema!.name}: ${issues!.join('; ')}`);
}

/** Shared by admission and execution so API, debug and called Sutras cannot bypass the starter contract. */
export async function manualStartPayload(config: Record<string, any>, input: unknown, scope: Record<string, any>, projectId: string | null, name: string) {
  let value = input;
  if (value === undefined || value === null) {
    const text = config.payload;
    try { value = typeof text === 'string' ? JSON.parse(text || '{}') : text ?? {}; }
    catch { throw Object.assign(new Error(`${name}: Test payload must be valid JSON.`), { statusCode: 400 }); }
  }
  const enabled = booleanSetting(resolve(config.validateSchema ?? false, scope), 'Validate against schema');
  if (enabled) await enforceContract(resolve(config.schema, scope), value, { projectId, subject: `${name} (Manual start) payload`, kind: 'json' });
  return value;
}

/** REST/WebSocket test and Run API entry points share gateway contract semantics. */
export async function messageStartPayload(type: 'restService' | 'wsService', config: Record<string, any>, input: any, scope: Record<string, any>, projectId: string | null, name: string) {
  let request = input;
  if (request === undefined || request === null) {
    try { request = typeof config.testRequest === 'string' ? JSON.parse(config.testRequest || '{}') : config.testRequest ?? {}; }
    catch { throw Object.assign(new Error(`${name}: Test request must be valid JSON.`), { statusCode: 400 }); }
  }
  const mode = resolve(config.validateBody ?? 'off', scope);
  if (!['off', 'reject invalid'].includes(mode)) throw new Error(`${name}: unknown request validation mode.`);
  if (mode === 'reject invalid' && !(type === 'wsService' && ['open', 'close'].includes(request.event))) {
    await enforceContract(resolve(config.bodySchema, scope), type === 'wsService' ? request.message : request.body, { projectId, subject: `${name} message`, ...(type === 'wsService' ? { kind: 'json' as const } : {}) });
  }
  return request;
}

/** SOAP Run API/Test input is an operation object, not a raw HTTP envelope. Validate its XML form. */
export async function soapStartPayload(config: Record<string, any>, input: any, scope: Record<string, any>, projectId: string | null, name: string) {
  let request = input;
  if (request === undefined || request === null) {
    try { request = typeof config.testRequest === 'string' ? JSON.parse(config.testRequest || '{}') : config.testRequest ?? {}; }
    catch { throw Object.assign(new Error(`${name}: Test request must be valid JSON.`), { statusCode: 400 }); }
  }
  const mode = resolve(config.validateBody ?? 'off', scope);
  if (!['off', 'reject invalid'].includes(mode)) throw new Error(`${name}: unknown request validation mode.`);
  if (mode === 'off') return request;
  const ref = resolve(config.bodySchema, scope);
  const schema = contractDefinition(ref, { projectId, subject: `${name} SOAP request` });
  if (schema.kind === 'json') { await enforceContract(ref, request.body, { projectId, subject: `${name} SOAP body`, kind: 'json' }); return request; }
  const operation = String(request.operation || '');
  if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(operation)) throw new Error(`${name}: supply a valid SOAP operation name.`);
  const selected = String(ref).split('::')[1];
  if (selected && selected !== operation) throw new Error(`${name}: SOAP operation does not match the selected XSD root.`);
  const tree = schemaTree(`${schema.id}::${operation}`);
  const namespace = tree?.children?.[0]?.namespace;
  const doc = new DOMParser().parseFromString(schema.text, 'application/xml');
  const qualified = doc.documentElement.getAttribute('elementFormDefault') === 'qualified';
  const attrs = namespace ? { '@_xmlns:sf': namespace, ...(qualified ? { '@_xmlns': namespace } : {}) } : {};
  const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body) ? { ...attrs, ...request.body } : { ...attrs, '#text': request.body };
  const xml = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '@_' }).build({ [namespace ? `sf:${operation}` : operation]: body });
  await enforceContract(ref, null, { projectId, subject: `${name} SOAP operation`, kind: 'xsd', xml });
  return request;
}
