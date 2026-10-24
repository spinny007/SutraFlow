/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 2.0.9
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { testEnv, node, edge } from './helpers.js';
testEnv(22970);
process.env.SUTRA_ADMIN_TOKEN = 'impact-test-only';
const { boot } = await import('../server/src/index.js');
const { saveProject } = await import('../server/src/projects.js');
const { saveSchema, getSchema } = await import('../server/src/schemas.js');
const { saveFlow, getFlow } = await import('../server/src/flows.js');
const { schemaImpact, compareSchemaTrees } = await import('../server/src/schema-impact.js');
const { sutraDocumentation, packageDocumentation } = await import('../server/src/docs.js');
const { q } = await import('../server/src/db.js');
let srv: Awaited<ReturnType<typeof boot>>;
before(async () => { srv = await boot({ listenAdmin: false, gateway: false }); });
after(async () => { await srv.stop(); });

test('proposed schema removal reports downstream broken source references without writing state', () => {
  const p = saveProject({ name: 'Impact', config: { variables: [] } });
  const schema = saveSchema({ project_id: p.id, name: 'Incoming', kind: 'json', text: '{"scores":[2,5]}' });
  const s = node('start', 'Incoming order', { schema: schema.id, payload: '{"scores":[2,5]}' });
  const m = node('mapperXml', 'Convert order', { mapping: { fields: ['User/Score[]'], rules: { 'User/Score': { expr: '{input.scores}' } } } });
  const flow = saveFlow(undefined, { name: 'Impacted', nodes: [s, m], edges: [edge(s, m)] }, p.id);
  const baseline = JSON.stringify([getSchema(schema.id), getFlow(flow.id), q.get<any>('select count(*) n from runs')]);
  const result = schemaImpact(schema.id, { text: '{"zone":[2,5]}' });
  assert.ok(result.changes.some(c => c.path === 'scores' && c.change === 'removed'));
  assert.ok(result.changes.some(c => c.path === 'zone' && c.change === 'added'));
  assert.match(result.affected[0].uses[0].activity, /Incoming order \(Manual start\)/);
  assert.ok(result.affected[0].diagnostics.some(d => d.message.includes('input.scores')));
  assert.equal(JSON.stringify([getSchema(schema.id), getFlow(flow.id), q.get<any>('select count(*) n from runs')]), baseline);
  assert.throws(() => schemaImpact(schema.id, { text: '{broken' }));
  assert.throws(() => schemaImpact(schema.id, { text: 'x'.repeat(1024 * 1024 + 1) }), /1 MB/);
});

test('XSD root and occurrence changes are reported; constraints carry explicit limitations', () => {
  const p = saveProject({ name: 'XML impact', config: { variables: [] } });
  const schema = saveSchema({ project_id: p.id, name: 'Order', kind: 'xsd', text: '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="Order" type="xs:string"/></xs:schema>' });
  const result = schemaImpact(schema.id, { text: '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="Order" type="xs:integer"/></xs:schema>' });
  assert.deepEqual(result.changes, [{ path: 'Order', change: 'changed' }]);
  assert.match(result.limitations.join(' '), /Patterns/);
  assert.deepEqual(compareSchemaTrees({ name: 'a', type: 'integer', repeats: true, minItems: 1 }, { name: 'b', type: 'integer', repeats: true, minItems: 2 }), [{ path: '(root)', change: 'changed' }]);
});

test('impact endpoint requires authorization and does not expose another project via a body override', async () => {
  const p = saveProject({ name: 'Auth impact', config: { variables: [] } });
  const schema = saveSchema({ project_id: p.id, name: 'Contract', kind: 'json', text: '{"id":1}' });
  const url = `/api/schemas/${schema.id}/impact`;
  assert.equal((await srv.admin.inject({ method: 'POST', url, payload: { text: '{}' }, headers: { 'x-sutra': '1' } })).statusCode, 401);
  const r = await srv.admin.inject({ method: 'POST', url, payload: { text: '{}', project_id: 'not-the-project' }, headers: { 'x-sutra': '1', authorization: 'Bearer impact-test-only' } });
  assert.equal(r.statusCode, 200); assert.equal(r.json().schemaId, schema.id);
  const { createAccount } = await import('../server/src/access.js');
  const { issue } = await import('../server/src/auth.js');
  createAccount({ username: 'impact-designer', password: 'Test-only-password-77', mustChange: false, grants: [{ role: 'developer', project: p.id }] });
  const other = saveProject({ name: 'Other private project', config: { variables: [] } });
  const privateSchema = saveSchema({ project_id: other.id, name: 'Private contract', kind: 'json', text: '{"private":1}' });
  const headers = { 'x-sutra': '1', cookie: `sutra_session=${issue('impact-designer')}` };
  assert.equal((await srv.admin.inject({ method: 'POST', url, payload: { text: '{}' }, headers })).statusCode, 200);
  const forbidden = await srv.admin.inject({ method: 'POST', url: `/api/schemas/${privateSchema.id}/impact`, payload: { text: '{}', project_id: p.id }, headers });
  assert.equal(forbidden.statusCode, 403);
  assert.ok(!forbidden.body.includes('Private contract'));
});

test('HTML, Markdown and package documentation resolve schema and connection names safely', () => {
  const s = node('start', 'Accept request', { schema: 'contract::Order', payload: '{}' });
  const m = node('httpRequest', 'Send order', { connection: 'conn', responseSchema: 'gone', headers: [{ k: 'Authorization', v: 'do-not-print' }] });
  const doc = { name: 'Documented flow', nodes: [s, m], edges: [edge(s, m)] };
  const options = { resources: [{ id: 'conn', name: 'Order API', kind: 'http' }], schemas: [{ id: 'contract', name: 'Order contract', kind: 'xsd', root: 'Order' }] };
  const report = sutraDocumentation({ doc }, options);
  for (const text of [report.html, report.markdown]) {
    assert.match(text, /Accept request.*Manual start/);
    assert.match(text, /Order contract \(XSD\).*root Order/);
    assert.match(text, /Order API \(http\)/);
    assert.match(text, /missing schema: gone/);
    assert.ok(!text.includes('do-not-print'));
  }
  const pkg = packageDocumentation({ name: 'Release', version: '2.0.9', project: { name: 'Orders' }, ...options, sutras: [{ id: 'f', doc, version: 1, deployed: false }] });
  assert.match(pkg.markdown, /Order contract \(XSD\)/);
});
