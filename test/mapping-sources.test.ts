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
import { mappingSources } from '../web/src/mapping-sources.js';
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
});
test('multiple incoming branches do not falsely identify a unique runtime source', () => {
  const joined = { ...doc, edges: [...doc.edges, { id: 'join', from: 'parallel', to: 'map', port: 'out' }] };
  assert.match(mappingSources(joined, 'map', activities).inputLabel, /incoming activities: Fetch customer \(SQL query\), parallel \(Map data\)/);
});
test('streaming and multi-port predecessor outputs are not incorrectly collapsed into current input', () => {
  const meta = [{ type: 'query', name: 'Streaming query', ports: ['batch', 'out'] }, { type: 'mapper', name: 'Map data', ports: ['out'] }];
  assert.ok(mappingSources(doc, 'map', meta).sources.some(s => s.node.id === 'earlier'));
});
test('starter, unknown types and cycles have safe labels without self references', () => {
  assert.equal(mappingSources(doc, 'start', []).inputLabel, 'Current input (starter / supplied data)');
  const cycle = { ...doc, edges: [...doc.edges, { id: 'cycle', from: 'later', to: 'earlier', port: 'out' }] };
  assert.ok(mappingSources(cycle, 'map', []).sources.every(s => s.node.id !== 'map'));
  assert.match(mappingSources(doc, 'map', []).inputLabel, /Fetch customer \(query\)/);
});
