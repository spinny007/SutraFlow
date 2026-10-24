/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 2.0.7
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { testEnv, node, edge, captureServer } from './helpers.js';
import { addMappingField, deleteMappingField, renameMappingField } from '../web/src/mapping-fields.js';
testEnv(22730);
process.env.SUTRA_ADMIN_TOKEN = 'mapping207-test-admin-token';
const { adhocTree, evaluateMapping } = await import('../server/src/mapping.js');
const { checkMapping, checkMappedValue } = await import('../server/src/mapping-check.js');
const { previewMapping, schemaFromSample } = await import('../server/src/mapping-preview.js');
const { boot } = await import('../server/src/index.js');
const { engine, runState } = await import('../server/src/engine/engine.js');
const { q } = await import('../server/src/db.js');
const { saveProject } = await import('../server/src/projects.js');
const { addSamples } = await import('../server/src/samples.js');
const { getFlow, validateDoc } = await import('../server/src/flows.js');
const { saveSchema, schemaTree, jsonTree, xsdRoots } = await import('../server/src/schemas.js');
const { validateStructured, validateSoapOperation } = await import('../server/src/schema-validation.js');
const { parseValidatedContent, buildValidatedContent, readFields } = await import('../server/src/palettes/fileformat.js');
const { httpActivities } = await import('../server/src/palettes/http.js');
let srv: Awaited<ReturnType<typeof boot>>, projectId: string;
before(async () => { srv = await boot({ listenAdmin: false, gateway: false }); projectId = saveProject({ name: 'Mapping 207', config: { variables: [] } }).id; });
after(async () => { await srv.stop(); });
const api = (url: string, payload: any) => srv.admin.inject({ method: 'POST', url, payload, headers: { authorization: 'Bearer mapping207-test-admin-token', 'x-sutra': '1' } });

test('typed field edits preserve definitions, descendants and source formulas; deletion is immutable', () => {
  let m = addMappingField({ rules: {} }, 'lines[]/amount', { type: 'integer', required: true });
  m = { ...m, rules: { 'lines/amount': { expr: '{item.amount}' } } };
  const original = structuredClone(m);
  const renamed = renameMappingField(m, 'lines', 'items');
  assert.ok(renamed.definitions?.['items/amount']?.required);
  assert.equal(renamed.rules['items/amount'].expr, '{item.amount}');
  const deleted = deleteMappingField(renamed, 'items');
  assert.deepEqual(deleted.fields, []); assert.deepEqual(deleted.rules, {}); assert.deepEqual(deleted.definitions, {});
  assert.deepEqual(m, original);
  assert.throws(() => addMappingField(m, '__proto__/x', { type: 'string' }));
  assert.throws(() => addMappingField(m, 'lines[]/amount', { type: 'string' }));
});

test('typed runtime/preview detects integer, boolean, required and array count failures', () => {
  const m = { fields: ['id', 'active', 'scores[]'], definitions: { id: { type: 'integer' as const, required: true }, active: { type: 'boolean' as const }, scores: { type: 'integer' as const, repeats: true, minItems: 1, maxItems: 2 } }, rules: { id: { expr: '{input.id}' }, active: { expr: '{input.active}' }, scores: { expr: '{input.scores}' } } };
  const tree = adhocTree(m);
  const value = evaluateMapping(tree, m, { input: { id: 1.2, active: 'invalid', scores: [1, 2, 3] } }, true);
  const issues = checkMappedValue(tree, value).join(';');
  assert.match(issues, /expected integer/); assert.match(issues, /expected boolean/); assert.match(issues, /more than 2/);
  assert.match(checkMappedValue(tree, {})[0], /required/);
  assert.equal(previewMapping(tree, m, { input: { id: 2, active: false, scores: [3] } }, 'json').ok, true);
});

test('deployment checks invalid formulas, missing required targets, stale schema rules and hidden mapping mode', () => {
  const start = node('start', 'Start', { payload: '{}' });
  const map = node('mapperJson', 'Map', { mapping: { fields: ['id'], definitions: { id: { type: 'integer', required: true } }, rules: {} } });
  let doc = { name: 'Check', nodes: [start, map], edges: [edge(start, map)] };
  assert.match(validateDoc(doc).errors.join(';'), /required/);
  map.config.mapping.rules.id = { expr: 'missingFunction(' };
  assert.match(validateDoc(doc).errors.join(';'), /id expr/);
  const tree = jsonTree({ type: 'object', properties: { id: { type: 'string' } } });
  assert.match(checkMapping(tree, { rules: { removed: { expr: '1' } } }).warnings.join(';'), /stale/);
  const render = node('renderXml', 'Render value', { source: 'value', value: '{{input}}', root: 'User', mapping: { rules: { x: { expr: '(' } } } });
  doc = { name: 'Hidden mapping', nodes: [start, render], edges: [edge(start, render)] };
  assert.deepEqual(validateDoc(doc).errors, []);
});

test('JSON allOf retains own properties and reusable required fields; XSD choice is not falsely required', () => {
  const tree = jsonTree({ type: 'object', required: ['id'], properties: { id: { type: 'integer' } }, allOf: [{ $ref: '#/$defs/Contact' }], $defs: { Contact: { type: 'object', required: ['email'], properties: { email: { type: 'string' } } } } });
  assert.deepEqual(tree.children?.map(c => c.name), ['id', 'email']);
  assert.ok(tree.children?.every(c => c.required));
  const xsd = '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="Root"><xs:complexType><xs:choice><xs:element name="A" type="xs:string"/><xs:element name="B" type="xs:string"/></xs:choice></xs:complexType></xs:element></xs:schema>';
  assert.ok(xsdRoots(xsd).build('Root').children?.every(c => !c.required));
});

test('sample inference creates browsable JSON/XSD; rejects invalid XML and entities', () => {
  const json = schemaFromSample('json', '{"items":[{"id":7}],"active":true}');
  assert.equal(jsonTree(JSON.parse(json.text)).children?.[0].repeats, true);
  const xml = schemaFromSample('xsd', '<User status="active"><id>7</id><Score>2</Score><Score>5</Score></User>');
  assert.ok(xsdRoots(xml.text).build('User').children?.some(c => c.name === '@_status'));
  assert.throws(() => schemaFromSample('xsd', '<User>'));
  assert.throws(() => schemaFromSample('xsd', '<!DOCTYPE x><User/>'));
});

test('read-only preview API uses project authorization, bounds samples, and never creates runs', async () => {
  const before = q.get<any>('select count(*) n from runs').n;
  const payload = { projectId, format: 'xml', config: { mapping: { fields: ['User/id'], rules: { 'User/id': { expr: '{input.id}' } } } }, scope: { input: { id: 7 } } };
  const result = await api('/api/design/mapping-preview', payload);
  assert.equal(result.statusCode, 200); assert.equal(result.json().ok, true); assert.match(result.json().text, /<id>7<\/id>/);
  assert.equal(q.get<any>('select count(*) n from runs').n, before);
  const other = saveProject({ name: 'Other mapping project', config: { variables: [] } });
  const s = saveSchema({ project_id: other.id, name: 'Other schema', kind: 'json', text: '{"id":1}' });
  const cross = await api('/api/design/mapping-preview', { ...payload, config: { schema: s.id } });
  assert.equal(cross.json().ok, false);
  const large = await api('/api/design/mapping-preview', { ...payload, scope: { input: 'x'.repeat(270000) } });
  assert.equal(large.json().ok, false);
  const inferred = await api('/api/design/schema-from-sample', { projectId, kind: 'json', sample: '{"id":1}' });
  assert.equal(inferred.statusCode, 200); assert.ok(inferred.json().text);
  const anonymous = await srv.admin.inject({ method: 'POST', url: '/api/design/mapping-preview', payload, headers: { 'x-sutra': '1' } });
  assert.equal(anonymous.statusCode, 401);
});

test('both new palettes and documented sample processes execute with expected structured and serialized outputs', async () => {
  const added = addSamples(projectId, ['mappingtyped']);
  assert.equal(added.length, 2);
  for (const sample of added) {
    const doc = getFlow(sample.id)!.doc;
    assert.deepEqual(validateDoc(doc, projectId).errors, [], doc.name);
    const id = await engine.startRun({ doc, projectId });
    await engine.waitFor(id, 10000);
    const row = q.get<any>('select status,error from runs where id = ?', id);
    assert.equal(row.status, 'done', row.error);
    const output = runState(id)!.outputs;
    if (doc.name.includes('JSON')) assert.deepEqual(JSON.parse(output['Serialize JSON'].text), { id: 'U-7', active: true, scores: [2, 5] });
    else { assert.match(output['Serialize XML'].text, /xmlns="urn:sutra:sample:user"/); assert.match(output['Serialize XML'].text, /status="active"/); assert.equal((output['Serialize XML'].text.match(/<Score>/g) || []).length, 2); }
  }
});

test('new typed palette rejects a bad runtime value through normal error handling', async () => {
  const s = node('start', 'Start', { payload: '{"id":"bad"}' });
  const m = node('mapperJson', 'Map', { mapping: { fields: ['id'], definitions: { id: { type: 'integer', required: true } }, rules: { id: { expr: '{input.id}' } } } });
  const id = await engine.startRun({ projectId, doc: { name: 'Invalid typed value', nodes: [s, m], edges: [edge(s, m)] } });
  await engine.waitFor(id, 10000);
  assert.equal(q.get<any>('select status from runs where id = ?', id).status, 'failed');
});

let contractNumber = 0;
const contract = () => saveSchema({ project_id: projectId, name: 'Strict JSON contract ' + ++contractNumber, kind: 'json', text: JSON.stringify({
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', required: ['id', 'email', 'amount'], additionalProperties: false,
  properties: { id: { type: 'string', pattern: '^A-[0-9]+$' }, email: { type: 'string', format: 'email' }, amount: { type: 'number', minimum: 1, maximum: 10 } },
}) });
const valid = { id: 'A-12', email: 'a@example.com', amount: 3 };
const userXsd = `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:group name="Contact"><xs:choice><xs:element name="Email" type="xs:string"/><xs:element name="Phone" type="xs:string"/></xs:choice></xs:group><xs:element name="User"><xs:complexType><xs:sequence><xs:element name="Code"><xs:simpleType><xs:restriction base="xs:token"><xs:pattern value="[A-Z]{2}-[0-9]{2}"/></xs:restriction></xs:simpleType></xs:element><xs:group ref="Contact" minOccurs="1" maxOccurs="2"/><xs:element name="Age" minOccurs="0"><xs:simpleType><xs:restriction base="xs:integer"><xs:minInclusive value="18"/><xs:maxInclusive value="99"/></xs:restriction></xs:simpleType></xs:element></xs:sequence><xs:attribute name="status" use="required"><xs:simpleType><xs:restriction base="xs:string"><xs:enumeration value="active"/><xs:enumeration value="inactive"/></xs:restriction></xs:simpleType></xs:attribute></xs:complexType></xs:element></xs:schema>`;

test('shared JSON validator enforces pattern, format, ranges, extra fields and drafts', async () => {
  const s = contract();
  assert.deepEqual(await validateStructured(s.id, valid), []);
  for (const bad of [{ ...valid, id: 'bad' }, { ...valid, email: 'bad' }, { ...valid, amount: 11 }, { ...valid, extra: true }, {}]) {
    assert.ok((await validateStructured(s.id, bad)).length, JSON.stringify(bad));
  }
  for (const draft of ['http://json-schema.org/draft-07/schema#', 'https://json-schema.org/draft/2019-09/schema']) {
    const d = saveSchema({ project_id: projectId, name: draft, kind: 'json', text: JSON.stringify({ $schema: draft, type: 'string', enum: ['yes'] }) });
    assert.deepEqual(await validateStructured(d.id, 'yes'), []);
    assert.ok((await validateStructured(d.id, 'no')).length);
  }
});

test('XSD validator checks reusable repeating choice, optional types, enums and XSD patterns', async () => {
  const s = saveSchema({ project_id: projectId, name: 'Strict User XSD', kind: 'xsd', text: userXsd });
  const xml = '<User status="active"><Code>AB-12</Code><Email>a</Email><Phone>b</Phone><Age>20</Age></User>';
  assert.deepEqual(await validateStructured(s.id, null, xml), []);
  assert.deepEqual(await validateStructured(s.id, null, xml.replace('<Age>20</Age>', '')), []);
  for (const bad of [xml.replace('AB-12', 'bad'), xml.replace('active', 'unknown'), xml.replace('20', '17'), xml.replace('<Age>', '<Phone>c</Phone><Age>'), xml.replace('<Email>a</Email><Phone>b</Phone>', ''), xml.replace('20', 'not-an-integer')]) {
    assert.ok((await validateStructured(s.id, null, bad)).length, bad);
  }
  assert.match((await validateStructured(s.id, null, '<!DOCTYPE x><User/>')).join(), /DTD/);
  assert.deepEqual(await Promise.all(Array.from({ length: 6 }, () => validateStructured(s.id, null, xml))), Array.from({ length: 6 }, () => []));
});

test('XSD dependencies stay project local and SOAP preserves operation namespaces', async () => {
  saveSchema({ project_id: projectId, name: 'common.xsd', kind: 'xsd', text: '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:simpleType name="Code"><xs:restriction base="xs:string"><xs:enumeration value="OK"/></xs:restriction></xs:simpleType></xs:schema>' });
  const s = saveSchema({ project_id: projectId, name: 'Include XSD', kind: 'xsd', text: '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:include schemaLocation="common.xsd"/><xs:element name="Code" type="Code"/></xs:schema>' });
  assert.deepEqual(await validateStructured(s.id, null, '<Code>OK</Code>'), []);
  assert.ok((await validateStructured(s.id, null, '<Code>NO</Code>')).length);
  const ns = saveSchema({ project_id: projectId, name: 'SOAP namespaced XSD', kind: 'xsd', text: '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:test"><xs:element name="Ping" type="xs:integer"/></xs:schema>' });
  const envelope = '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:t="urn:test"><s:Body><t:Ping>42</t:Ping></s:Body></s:Envelope>';
  assert.deepEqual(await validateSoapOperation(ns.id, 42, envelope), []);
  assert.ok((await validateSoapOperation(ns.id, 'bad', envelope.replace('42', 'bad'))).length);
});

test('structured file readers/writers and HTTP reply reject invalid data; no schema preserves behavior', async () => {
  const s = contract();
  const strictField = readFields().find(f => f.k === 'strictValidation');
  assert.ok(strictField, 'file readers expose an explicit strict-validation checkbox');
  assert.deepEqual((await parseValidatedContent(Buffer.from(JSON.stringify(valid)), { format: 'JSON', schema: s.id, strictValidation: true }, null)).data, valid);
  for (const strictValidation of [undefined, false]) assert.deepEqual((await parseValidatedContent(Buffer.from('{}'), { format: 'JSON', schema: s.id, strictValidation }, null)).data, {}, 'schema alone must not enable validation');
  await assert.rejects(parseValidatedContent(Buffer.from('{}'), { format: 'JSON', schema: s.id, strictValidation: true }, null), /does not match/);
  await assert.rejects(parseValidatedContent(Buffer.from('{}'), { format: 'JSON', strictValidation: true }, null), /requires a JSON Schema/);
  const config = { format: 'JSON', schema: s.id, bodySchema: s.id, data: {}, contentType: 'application/json', body: {}, status: '200' };
  const context: any = { raw: (k: string) => (config as any)[k], v: (k: string) => (config as any)[k], resolve: (v: any) => v, reply: () => { throw new Error('must not reply'); } };
  await assert.rejects(buildValidatedContent(context, null), /does not match/);
  await assert.rejects(Promise.resolve(httpActivities.find(a => a.type === 'httpResponse')!.execute!(context)), /does not match/);
  config.schema = '';
  assert.equal((await buildValidatedContent(context, null)).toString(), '{}');
  const x = saveSchema({ project_id: projectId, name: 'File XML XSD', kind: 'xsd', text: userXsd });
  assert.ok((await parseValidatedContent(Buffer.from('<User/>'), { format: 'XML', schema: x.id, strictValidation: false }, null)).data);
  await assert.rejects(parseValidatedContent(Buffer.from('<User/>'), { format: 'XML', schema: x.id, strictValidation: true }, null), /does not match/);
  await assert.rejects(parseValidatedContent(Buffer.from('<User/>'), { format: 'XML', schema: s.id, strictValidation: true }, null), /requires an XSD/);
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const folder = process.env.SUTRA_DATA_DIR!;
  await fs.writeFile(path.join(folder, 'strict-read.json'), '{}');
  for (const strictValidation of [false, true]) {
    const start = node('start', 'Start', { payload: '{}' });
    const read = node('fileRead', 'Read JSON file', { folder, path: 'strict-read.json', format: 'JSON', schema: s.id, strictValidation });
    const id = await engine.startRun({ projectId, doc: { name: 'Opt-in file validation', nodes: [start, read], edges: [edge(start, read)] } });
    await engine.waitFor(id, 10000);
    assert.equal(q.get<any>('select status from runs where id = ?', id).status, strictValidation ? 'failed' : 'done');
  }
  const remote = await captureServer(() => ({ body: '{}' }));
  try {
    const cfg: any = { method: 'POST', url: remote.url, bodyType: 'json', bodySchema: s.id, body: '{}', parse: 'json' };
    const ctx: any = { raw: (k: string) => cfg[k], v: (k: string) => cfg[k], resolve: (v: any) => v, secret: () => '', signal: new AbortController().signal };
    const request = httpActivities.find(a => a.type === 'httpRequest')!.execute!;
    await assert.rejects(Promise.resolve(request(ctx)), /HTTP request does not match/);
    assert.equal(remote.seen.length, 0, 'invalid outgoing body never reaches the network');
    cfg.body = JSON.stringify(valid); cfg.responseSchema = s.id;
    await assert.rejects(Promise.resolve(request(ctx)), /HTTP response does not match/);
    assert.equal(remote.seen.length, 1);
  } finally { await remote.close(); }
});

test('Parse/Render JSON and XML enforce selected contracts through real engine execution', async () => {
  const json = contract();
  const xml = saveSchema({ project_id: projectId, name: 'Activity XML XSD', kind: 'xsd', text: userXsd });
  for (const [type, cfg] of [
    ['parseJson', { text: '{}', schema: json.id }],
    ['renderJson', { source: 'value', value: '{}', schema: json.id }],
    ['parseXml', { text: '<User/>', schema: xml.id }],
    ['renderXml', { source: 'value', value: {}, root: 'User', schema: xml.id }],
  ] as const) {
    const start = node('start', 'Start', { payload: '{}' });
    const activity = node(type, 'Validate', { ...cfg, validateSchema: true });
    const id = await engine.startRun({ projectId, doc: { name: type, nodes: [start, activity], edges: [edge(start, activity)] } });
    await engine.waitFor(id, 10000);
    assert.equal(q.get<any>('select status from runs where id = ?', id).status, 'failed', type);
  }
  const start = node('start', 'Start', { payload: '{}' });
  const check = node('validate', 'Check schema', { required: [], source: '{{input}}', schema: json.id });
  const stop = node('end', 'Invalid branch');
  const id = await engine.startRun({ projectId, doc: { name: 'Schema branch', nodes: [start, check, stop], edges: [edge(start, check), edge(check, stop, 'invalid')] } });
  await engine.waitFor(id, 10000);
  assert.equal(runState(id)!.outputs['Check schema'].valid, false);
  assert.ok(runState(id)!.outputs['Check schema'].problems.length);
});
