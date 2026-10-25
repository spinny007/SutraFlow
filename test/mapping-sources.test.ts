/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 2.0.8
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mappingSources, mappingDisplayRef, mappingRunContext, mappingPreviewNeedsRun, refsIn } from '../web/src/mapping-sources.js';
import { resolve } from '../server/src/template.js';
import type { FlowDoc } from '../web/src/types.js';

const doc: FlowDoc = {
  name: 'Sources',
  nodes: ['start', 'earlier', 'map', 'parallel', 'later'].map(id => ({ id, name: id === 'earlier' ? 'Fetch customer' : id, type: id === 'earlier' ? 'query' : 'mapper', x: 0, y: 0, config: {} })),
  edges: [['start', 'earlier'], ['earlier', 'map'], ['start', 'parallel'], ['map', 'later']].map(([from, to], i) => ({ id: String(i), from, to, port: 'out' })),
};
const activities = [{ type: 'query', name: 'SQL query', ports: ['out'] }, { type: 'mapper', name: 'Map data', ports: ['out'] }];
test('mapping names current input and earlier activities with their activity types', () => {
  const result = mappingSources(doc, 'map', activities);
  assert.equal(result.inputLabel, 'Fetch customer (SQL query) — current input');
  assert.deepEqual(result.sources.map(s => s.node.id), ['start', 'parallel']);
  assert.match(result.sources[1].label, /other branch; available only after completion/);
  assert.equal(result.inputAliasName, 'Fetch customer');
  assert.equal(mappingDisplayRef('nodes.Fetch customer.id', result.inputAliasName), 'input.id');
  assert.equal(mappingDisplayRef('nodes.Fetch customerExtra.id', result.inputAliasName), 'nodes.Fetch customerExtra.id');
  assert.equal(mappingDisplayRef('nodes["Read.v2"].amount', 'Read.v2'), 'input.amount');
  assert.equal(mappingDisplayRef('run.id'), 'sutra.id');
  assert.equal(mappingDisplayRef('process.id'), 'sutra.id');
  assert.equal(mappingDisplayRef('runner.id'), 'runner.id');
  assert.deepEqual(refsIn('[{"$match":{"status":"processed"}}]'), [], 'literal MongoDB stages are not workflow references');
  assert.deepEqual(refsIn("=list(object('$match', object('_id', {run.id})))"), ['run.id']);
  assert.deepEqual(refsIn('{{nodes.Read.documents}}'), ['nodes.Read.documents']);
  assert.equal(mappingPreviewNeedsRun("=list(object('$match', object('_id', {run.id})))", mappingRunContext(null)), true);
  assert.equal(mappingPreviewNeedsRun('={input.amount}', mappingRunContext(null)), true);
  assert.equal(mappingPreviewNeedsRun('[{"$match":{"status":"processed"}}]', mappingRunContext(null)), false);
  assert.equal(mappingPreviewNeedsRun('={{gv.STATUS}}', { gv: { STATUS: 'processed' } }), false);
  const scope = mappingRunContext({ id: 'selected-run', flowName: 'Current flow', version: 1, startedAt: '2026-10-25', source: 'test' });
  assert.equal(scope.run, scope.sutra); assert.equal(scope.run, scope.process);
  assert.equal(scope.run.id, 'selected-run');
  assert.equal(mappingPreviewNeedsRun('={run.id}', scope), false);
  for (const alias of ['run', 'sutra', 'process']) assert.deepEqual(resolve(`=list(object('$match', object('_id', {${alias}.id})))`, scope), [{ $match: { _id: 'selected-run' } }]);
  assert.deepEqual(mappingRunContext(null), { run: {}, sutra: {}, process: {} }, 'clearing a run must not retain previous context');
});
test('multiple incoming branches do not falsely identify a unique runtime source', () => {
  const joined = { ...doc, edges: [...doc.edges, { id: 'join', from: 'parallel', to: 'map', port: 'out' }] };
  assert.match(mappingSources(joined, 'map', activities).inputLabel, /incoming activities: Fetch customer \(SQL query\), parallel \(Map data\)/);
  assert.equal(mappingSources(joined, 'map', activities).inputAliasName, undefined);
});
test('streaming and multi-port predecessor outputs are not incorrectly collapsed into current input', () => {
  const meta = [{ type: 'query', name: 'Streaming query', ports: ['batch', 'out'] }, { type: 'mapper', name: 'Map data', ports: ['out'] }];
  assert.ok(mappingSources(doc, 'map', meta).sources.some(s => s.node.id === 'earlier'));
  assert.equal(mappingSources(doc, 'map', meta).inputAliasName, undefined);
});
test('starter, unknown types and cycles have safe labels without self references', () => {
  assert.equal(mappingSources(doc, 'start', []).inputLabel, 'Current input (starter / supplied data)');
  const cycle = { ...doc, edges: [...doc.edges, { id: 'cycle', from: 'later', to: 'earlier', port: 'out' }] };
  assert.ok(mappingSources(cycle, 'map', []).sources.every(s => s.node.id !== 'map'));
  assert.match(mappingSources(doc, 'map', []).inputLabel, /Fetch customer \(query\)/);
});
