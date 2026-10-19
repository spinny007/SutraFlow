/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { testEnv, captureServer, node, edge } from './helpers.js';

testEnv(18810);
const { boot } = await import('../server/src/index.js');
const { engine } = await import('../server/src/engine/engine.js');
const { q } = await import('../server/src/db.js');
const projects = await import('../server/src/projects.js');
const flows = await import('../server/src/flows.js');
const { saveResource } = await import('../server/src/resources.js');
const { rebuildListeners } = await import('../server/src/listeners.js');

let srv: Awaited<ReturnType<typeof boot>>;
let pid = '';
before(async () => {
  srv = await boot({ listenAdmin: false });
  pid = projects.saveProject({ name: 'Sutras', config: { variables: [] } }).id;
});
after(async () => { await srv.stop(); });

async function run(nodes: any[], edges: any[], input?: any, name = 'P') {
  const id = await engine.startRun({ doc: { name, nodes, edges }, projectId: pid, input });
  await engine.waitFor(id, 15000);
  const r: any = q.get('select * from runs where id = ?', id);
  return { id, status: r.status, error: r.error, state: JSON.parse(r.state) };
}

/** A reusable process: doubles the amount and returns it. */
function child(name: string, body?: { nodes: any[]; edges: any[] }) {
  const s = node('start', 'Start', { payload: '{"amount": 1}' });
  const m = node('mapper', 'Double', { mapping: { rules: { total: { expr: '{input.amount} * 2' }, who: { expr: "'child'" } } } });
  const r = node('return', 'Return', { source: 'value', value: '{{input}}' });
  return flows.saveFlow(undefined, { name, ...(body || { nodes: [s, m, r], edges: [edge(s, m), edge(m, r)] }) }, pid);
}

test('Call Sutra waits for the called Sutra and continues with its Return result', async () => {
  const c = child('Double it');
  const s = node('start', 'Start'), call = node('callProcess', 'Call', { process: c.id, use: 'deployed (draft while testing)', wait: true, source: 'value', input: '{{input}}' });
  const after = node('log', 'After', { message: 'total {{input.total}}' });
  const r = await run([s, call, after], [edge(s, call), edge(call, after)], { amount: 21 });
  assert.equal(r.status, 'done', r.error);
  assert.deepEqual(r.state.outputs.Call, { total: 42, who: 'child' });
  assert.ok(r.state.outputs.After);

  // Deployed runs call the deployed version: not deployed yet is a clear error.
  const id = await engine.startRun({ doc: { name: 'P2', nodes: [s, call], edges: [edge(s, call)] }, projectId: pid, version: 3, input: { amount: 1 } });
  await engine.waitFor(id, 15000);
  assert.match((q.get('select error from runs where id = ?', id) as any).error, /not deployed/);
});

test('Call Sutra: a failure in the called Sutra goes to the error output; fire and forget; recursion is stopped', async () => {
  const s = node('start', 'Start'), t = node('throw', 'Boom', { message: 'bad order {{input.amount}}' });
  const failing = child('Fails', { nodes: [s, t], edges: [edge(s, t)] });
  const ps = node('start', 'Start'), call = node('callProcess', 'Call', { process: failing.id, use: 'draft', wait: true, input: '{{input}}' });
  const handled = node('log', 'Handled', { message: '{{input.error.message}}' });
  let r = await run([ps, call, handled], [edge(ps, call), edge(call, handled, 'error')], { amount: 5 });
  assert.equal(r.status, 'done', r.error);
  assert.match(r.state.outputs.Call.error.message, /Fails failed: Boom: bad order 5/);

  const c = child('Fire');
  const ff = node('callProcess', 'Start it', { process: c.id, use: 'draft', wait: false, input: '{{input}}' });
  r = await run([ps, ff], [edge(ps, ff)], { amount: 1 });
  assert.equal(r.status, 'done', r.error);
  assert.equal(r.state.outputs['Start it'].started, true);
  assert.equal(await engine.waitFor(r.state.outputs['Start it'].runId, 15000), 'done');

  // A process that calls itself.
  const self = flows.saveFlow(undefined, { name: 'Self', nodes: [], edges: [] }, pid);
  const ss = node('start', 'Start'), sc = node('callProcess', 'Again', { process: self.id, use: 'draft', wait: true, input: '{{input}}' });
  flows.saveFlow(self.id, { name: 'Self', nodes: [ss, sc], edges: [edge(ss, sc)] });
  r = await run([ss, sc], [edge(ss, sc)], {});
  assert.equal(r.status, 'failed');
  assert.match(r.error, /levels deep/);
});

test('Error handler catches unhandled errors; End with Sutra: error still fails the run', async () => {
  const s = node('start', 'Start'), w = node('wait', 'Slow', { ms: 3000 }), slowLog = node('log', 'Late', { message: 'late' });
  const t = node('throw', 'Boom', { message: 'invalid {{input.id}}' });
  const h = node('catch', 'On error'), log = node('log', 'Report', { message: '{{input.error.step}}: {{input.error.message}}' });
  let r = await run([s, w, slowLog, t, h, log], [edge(s, w), edge(w, slowLog), edge(s, t), edge(h, log)], { id: 'X' });
  assert.equal(r.status, 'done', r.error);
  assert.equal(r.state.outputs['On error'].error.message, 'invalid X');
  assert.equal(r.state.outputs['On error'].error.step, 'Boom');
  assert.equal(r.state.outputs.Late, undefined, 'other branches stop');

  const end = node('end', 'Fail', { stop: 'Sutra: error', message: 'Gave up: {{input.error.message}}' });
  r = await run([s, t, h, end], [edge(s, t), edge(h, end)], { id: 'Y' });
  assert.equal(r.status, 'failed');
  assert.match(r.error, /Gave up: invalid Y/);

  // An error inside the handler itself fails the run.
  const t2 = node('throw', 'Again', { message: 'handler broke' });
  r = await run([s, t, h, t2], [edge(s, t), edge(h, t2)], { id: 'Z' });
  assert.equal(r.status, 'failed');
  assert.match(r.error, /handler broke/);

  assert.ok(flows.validateDoc({ name: 'v', nodes: [s, h, { ...h, id: 'h2', name: 'H2' }], edges: [] }).errors.some(e => /only one Error handler/.test(e)));
});

test('Activity loops: for each item collects results; repeat while runs until the condition is false', async () => {
  const s = node('start', 'Start');
  const m = node('mapper', 'Line', { mapping: { rules: { sku: { expr: '{iteration.value.sku}' }, n: { expr: '{iteration.index} + 1' }, qty: { expr: '{item.qty} * 10' } } } },
    { loop: 'for each item', loopOver: '{{input.lines}}' });
  let r = await run([s, m], [edge(s, m)], { lines: [{ sku: 'A', qty: 1 }, { sku: 'B', qty: 2 }] });
  assert.equal(r.status, 'done', r.error);
  assert.deepEqual(r.state.outputs.Line, { iterations: [{ sku: 'A', n: 1, qty: 10 }, { sku: 'B', n: 2, qty: 20 }], count: 2 });

  const c = node('counter', 'Count', { name: 'loop-test', op: 'increment', by: 1 }, { loop: 'repeat while', loopWhile: '={iteration.output.value} < 5', loopDelayMs: 5 });
  r = await run([s, c], [edge(s, c)], {});
  assert.equal(r.status, 'done', r.error);
  assert.equal(r.state.outputs.Count.value, 5);
  assert.equal(r.state.outputs.Count._iterations, 5);

  const bad = node('counter', 'Bad', { name: 'x', op: 'get' }, { loop: 'for each item', loopOver: '{{input.nothing}}' });
  r = await run([s, bad], [edge(s, bad)], {});
  assert.equal(r.status, 'failed');
  assert.match(r.error, /not a list/);
});

test('Counter, channels between deployed Sutras, and the circuit breaker', async () => {
  const s = node('start', 'Start');
  const inc = node('counter', 'Inc', { name: 'orders', op: 'increment', by: 3 });
  const dec = node('counter', 'Dec', { name: 'orders', op: 'decrement', by: 1 });
  let r = await run([s, inc, dec], [edge(s, inc), edge(inc, dec)]);
  assert.deepEqual(r.state.outputs.Dec, { name: 'orders', value: 2, previous: 3 });

  // Channel: a deployed listener process receives what another process sends.
  const ct = node('channelTrigger', 'On order', { channel: 'new-orders' }), rec = node('counter', 'Received', { name: 'received', op: 'increment', by: 1 });
  const listener = flows.saveFlow(undefined, { name: 'Listener', nodes: [ct, rec], edges: [edge(ct, rec)] }, pid);
  flows.deploy(listener.id);
  await rebuildListeners();
  const send = node('channelPublish', 'Send', { channel: 'NEW-orders', message: '{{input}}' });
  r = await run([s, send], [edge(s, send)], { id: 7 });
  assert.equal(r.state.outputs.Send.delivered, 1);
  assert.equal(await engine.waitFor(r.state.outputs.Send.runIds[0], 15000), 'done');
  const got: any = q.get('select state from runs where id = ?', r.state.outputs.Send.runIds[0]);
  assert.deepEqual(JSON.parse(got.state).outputs['On order'], { id: 7 });
  const none = node('channelPublish', 'Nobody', { channel: 'empty', message: '{{input}}', required: true });
  r = await run([s, none], [edge(s, none)], {});
  assert.match(r.error, /No deployed Sutra listens/);

  // Circuit breaker: two 500s in a row open it; the third call fails without reaching the server.
  const cap = await captureServer(() => ({ status: 500, body: '{"error":"down"}' }));
  try {
    const conn = saveResource({ kind: 'httpConnection', name: 'Flaky', project_id: pid, config: { baseUrl: cap.url, breakerFailures: 2, breakerOpenSeconds: 60 } });
    const h = node('httpRequest', 'Call', { connection: conn.id, method: 'GET', url: '/x', bodyType: 'none', failOn: '4xx or 5xx' });
    for (let i = 0; i < 3; i++) r = await run([s, h], [edge(s, h)]);
    assert.match(r.error, /Circuit open for Flaky/);
    assert.equal(cap.seen.length, 2);
  } finally { await cap.close(); }
});
