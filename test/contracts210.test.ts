/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 2.0.10
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available; see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { testEnv, node, edge } from './helpers.js';
testEnv(23120);
const { boot } = await import('../server/src/index.js');
const { engine, runState } = await import('../server/src/engine/engine.js');
const { q } = await import('../server/src/db.js');
const { saveProject } = await import('../server/src/projects.js');
const { saveSchema } = await import('../server/src/schemas.js');
const { manualStartPayload, enforceContract } = await import('../server/src/contracts.js');
let server: Awaited<ReturnType<typeof boot>>, projectId: string, schema: string;
before(async () => {
  server = await boot({ listenAdmin: false, gateway: false });
  projectId = saveProject({ name: 'Strict starter regression' }).id;
  schema = saveSchema({ project_id: projectId, name: 'Zone input', kind: 'json', text: JSON.stringify({ id: 'a-7', status: 'active', zone: [2, 5] }) }).id;
});
after(async () => { await server.stop(); });
test('strict Manual start rejects configured/supplied mismatches before creating a run or downstream task', async () => {
  const start = node('start', 'User input', { schema, validateSchema: true, payload: JSON.stringify({ id: 7, status: 'active', scores: [2, 5] }) });
  const downstream = node('noop', 'Must not run', {});
  const count = Number(q.get<any>('select count(*) n from runs').n);
  const doc = { name: 'Starter rejection', nodes: [start, downstream], edges: [edge(start, downstream)] };
  await assert.rejects(engine.startRun({ doc, projectId }), /does not match/);
  await assert.rejects(engine.startRun({ doc, projectId, input: { id: 7, status: 'active', scores: [2, 5] }, source: 'debug', debug: { breakpoints: [], stepping: true } }), /does not match/);
  assert.equal(Number(q.get<any>('select count(*) n from runs').n), count);
  const good = { id: 'a-7', status: 'active', zone: [2, 5] };
  const id = await engine.startRun({ doc, projectId, input: good }); await engine.waitFor(id, 10000);
  assert.equal(q.get<any>('select status from runs where id=?', id).status, 'done');
  assert.deepEqual(runState(id)?.outputs['Must not run'], good);
});
test('strict flag resolution and missing/wrong/foreign schemas fail closed; Off remains explicitly descriptive', async () => {
  const config = { schema, validateSchema: '{{gv.STRICT}}', payload: '{}' };
  const bad = { id: 7 };
  await assert.rejects(manualStartPayload(config, bad, { gv: { STRICT: 'On' } }, projectId, 'Start'), /does not match/);
  await assert.rejects(manualStartPayload(config, bad, { gv: { STRICT: 'maybe' } }, projectId, 'Start'), /not boolean/);
  assert.deepEqual(await manualStartPayload(config, bad, { gv: { STRICT: 'Off' } }, projectId, 'Start'), bad);
  await assert.rejects(enforceContract('', bad, { projectId, subject: 'Missing' }), /select a schema/);
  await assert.rejects(enforceContract(schema, bad, { projectId: 'another-project', subject: 'Foreign' }), /another project/);
  const xml = saveSchema({ project_id: projectId, name: 'XML', kind: 'xsd', text: '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="Root" type="xs:string"/></xs:schema>' }).id;
  await assert.rejects(enforceContract(xml, bad, { projectId, subject: 'Wrong kind', kind: 'json' }), /requires a JSON/);
});
test('unsupported JSON validation keywords are rejected instead of silently ignored', async () => {
  const unknown = saveSchema({ project_id: projectId, name: 'Unknown keyword', kind: 'json', text: '{"type":"object","requiredTypo":["id"]}' }).id;
  await assert.rejects(enforceContract(unknown, {}, { projectId, subject: 'Unknown', kind: 'json' }), /unknown keyword/);
});
test('REST/WebSocket direct engine admission cannot bypass configured request rejection', async () => {
  const before = Number(q.get<any>('select count(*) n from runs').n);
  for (const type of ['restService', 'wsService']) {
    const start = node(type, 'Strict ingress', { bodySchema: schema, validateBody: 'reject invalid' });
    const input = type === 'restService' ? { body: { scores: [2, 5] } } : { event: 'message', message: { scores: [2, 5] } };
    await assert.rejects(engine.startRun({ projectId, doc: { name: type, nodes: [start], edges: [] }, input }), /does not match/);
  }
  assert.equal(Number(q.get<any>('select count(*) n from runs').n), before);
});
test('Call Sutra and Return enforce input/result boundaries, including resumed child results', async () => {
  const { saveFlow } = await import('../server/src/flows.js');
  const start = node('start', 'Child input', { payload: '{}' });
  const ret = node('return', 'Child result', { source: 'value', value: '{{input}}' });
  const child = saveFlow(undefined, { name: 'Contract child', nodes: [start, ret], edges: [edge(start, ret)] }, projectId);
  const parentStart = node('start', 'Parent input', { payload: '{}' });
  const call = node('callProcess', 'Checked call', { process: child.id, use: 'draft', source: 'value', input: '{{input}}', wait: true, inputSchema: schema, validateInput: true, resultSchema: schema, validateResult: true });
  const done = node('noop', 'After checked result', {});
  const doc = { name: 'Checked parent', nodes: [parentStart, call, done], edges: [edge(parentStart, call), edge(call, done)] };
  const good = { id: 'a-7', status: 'active', zone: [2, 5] };
  const id = await engine.startRun({ projectId, doc, input: good }); await engine.waitFor(id, 10000);
  assert.equal(q.get<any>('select status from runs where id=?', id).status, 'done');
  assert.deepEqual(runState(id)?.outputs['After checked result'], good);
  const bad = await engine.startRun({ projectId, doc, input: { id: 7 } }); await engine.waitFor(bad, 10000);
  assert.equal(q.get<any>('select status from runs where id=?', bad).status, 'failed');
  assert.equal(runState(bad)?.outputs['After checked result'], undefined);
  call.config.validateInput = false;
  const badResult = await engine.startRun({ projectId, doc, input: { id: 7 } }); await engine.waitFor(badResult, 10000);
  assert.equal(q.get<any>('select status from runs where id=?', badResult).status, 'failed');
  assert.equal(runState(badResult)?.outputs['After checked result'], undefined);
});
test('strict local/remote file triggers never forward invalid parsed events or read-error envelopes', async () => {
  for (const type of ['fileTrigger', 'remoteTrigger']) {
    for (const input of [{ event: 'added', data: { scores: [2, 5] } }, { event: 'added', readError: 'invalid JSON' }]) {
      const trigger = node(type, 'File event', { strictValidation: true, format: 'JSON', schema });
      const downstream = node('noop', 'File consumer', {});
      const id = await engine.startRun({ projectId, doc: { name: type, nodes: [trigger, downstream], edges: [edge(trigger, downstream, type === 'fileTrigger' ? 'added' : 'out')] }, input });
      await engine.waitFor(id, 10000);
      assert.equal(q.get<any>('select status from runs where id=?', id).status, 'failed');
      assert.equal(runState(id)?.outputs['File consumer'], undefined);
    }
  }
});
test('SOAP engine admission applies real XSD patterns and namespaces before business processing', async () => {
  const ref = saveSchema({ project_id: projectId, name: 'Strict SOAP request', kind: 'xsd', root: 'GetOrder', text: '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:strict:soap" elementFormDefault="qualified"><xs:element name="GetOrder"><xs:complexType><xs:sequence><xs:element name="OrderId"><xs:simpleType><xs:restriction base="xs:string"><xs:pattern value="[A-Z]{2}[0-9]{2}"/><xs:length value="4"/></xs:restriction></xs:simpleType></xs:element></xs:sequence></xs:complexType></xs:element></xs:schema>' }).id;
  const trigger = node('soapService', 'SOAP input', { operations: 'GetOrder', bodySchema: ref, validateBody: 'reject invalid' });
  const doc = { name: 'Strict SOAP admission', nodes: [trigger], edges: [] };
  const count = Number(q.get<any>('select count(*) n from runs').n);
  await assert.rejects(engine.startRun({ projectId, doc, input: { operation: 'GetOrder', body: { OrderId: 'bad' } } }), /does not match/);
  assert.equal(Number(q.get<any>('select count(*) n from runs').n), count);
  const id = await engine.startRun({ projectId, doc, input: { operation: 'GetOrder', body: { OrderId: 'AB12' } } }); await engine.waitFor(id, 10000);
  assert.equal(q.get<any>('select status from runs where id=?', id).status, 'done');
});
