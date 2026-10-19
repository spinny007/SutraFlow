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

testEnv(18110);
const { boot } = await import('../server/src/index.js');
const { engine } = await import('../server/src/engine/engine.js');
const { q } = await import('../server/src/db.js');
const { setSecret } = await import('../server/src/secrets.js');
const { saveResource } = await import('../server/src/resources.js');

let srv: Awaited<ReturnType<typeof boot>>;
before(async () => { srv = await boot({ listenAdmin: false }); });
after(async () => { await srv.stop(); });

async function run(nodes: any[], edges: any[], input?: any) {
  const id = await engine.startRun({ doc: { name: 'T', nodes, edges }, input });
  const status = await engine.waitFor(id, 20000, true);
  const r: any = q.get('select * from runs where id = ?', id);
  const tasks = q.all<any>('select * from tasks where run_id = ? order by id', id);
  return { id, status, state: JSON.parse(r.state), error: r.error, tasks };
}

test('mapping, if/else, merge with dead-path elimination', async () => {
  const s = node('start', 'Start', { payload: '{"orderId":"A-1","amount":"1500","lines":[{"sku":"X","qty":2},{"sku":"Y","qty":1}]}' });
  const m = node('mapper', 'Map', { map: [{ k: 'id', v: '{{input.orderId}}' }, { k: 'total', v: '{{input.amount | number}}' }, { k: 'skus', v: '{{input.lines | map:"sku"}}' }] });
  const big = node('if', 'Big order', { left: '{{input.total}}', op: 'greater than', right: '1000' });
  const yes = node('log', 'Big', { message: 'big {{input.id}}' });
  const no = node('log', 'Small', { message: 'small' });
  const mg = node('merge', 'Join');
  const end = node('end', 'Done', { result: '{{input}}' });
  const r = await run([s, m, big, yes, no, mg, end], [edge(s, m), edge(m, big), edge(big, yes, 'true'), edge(big, no, 'false'), edge(yes, mg), edge(no, mg), edge(mg, end)]);
  assert.equal(r.status, 'done', r.error);
  assert.deepEqual(r.state.outputs.Map, { id: 'A-1', total: 1500, skus: ['X', 'Y'] });
  assert.ok(!('Small' in r.state.outputs), 'false branch must not run');
  assert.deepEqual(Object.keys(r.state.outputs.Join), ['Big'], 'merge fires once with live branches only');
  assert.ok(r.state.logs.some((l: any) => l.msg === 'big A-1'));
});

test('for each runs per item and then done', async () => {
  const s = node('start', 'Start', { payload: '{"items":[1,2,3]}' });
  const fe = node('forEach', 'Each', { list: '{{input.items}}' });
  const item = node('setVar', 'Track', { vars: [{ k: 'last', v: '{{input.value}}' }] });
  const done = node('end', 'Done', { result: '{{input.count}}' });
  const r = await run([s, fe, item, done], [edge(s, fe), edge(fe, item, 'item'), edge(fe, done, 'done')]);
  assert.equal(r.status, 'done');
  assert.equal(r.tasks.filter(t => t.node_id === item.id).length, 3);
  assert.equal(r.state.outputs.Done, 3);
});

test('retries with backoff, then error branch handles the failure', async () => {
  const s = node('start', 'Start', { payload: '{}' });
  const t = node('throw', 'Boom', { message: 'nope {{run.source}}' }, { retries: 2, retryDelayMs: 20 });
  const h = node('log', 'Handled', { message: '{{input.error.message}}' });
  const r = await run([s, t, h], [edge(s, t), edge(t, h, 'error')]);
  assert.equal(r.status, 'done');
  const boom = r.tasks.find(x => x.node_id === t.id);
  assert.equal(boom.attempt, 2);
  assert.equal(boom.status, 'error');
  assert.equal(r.state.outputs.Handled.error.message, 'nope manual');
});

test('unhandled error fails the run and cancels other branches', async () => {
  const s = node('start', 'Start', { payload: '{}' });
  const t = node('throw', 'Boom', { message: 'bad' });
  const w = node('wait', 'Slow', { ms: 3000 });
  const after = node('log', 'After', { message: 'x' });
  const r = await run([s, t, w, after], [edge(s, t), edge(s, w), edge(w, after)]);
  assert.equal(r.status, 'failed');
  assert.match(r.error, /Boom: bad/);
  assert.ok(!('After' in r.state.outputs));
});

test('human approval waits as saved state and resumes on decision', async () => {
  const s = node('start', 'Start', { payload: '{"orderId":"A-9"}' });
  const a = node('approval', 'Approve', { message: 'OK {{input.orderId}}?' });
  const ok = node('log', 'Approved', { message: 'yes' });
  const nok = node('log', 'Rejected', { message: 'no' });
  const id = await engine.startRun({ doc: { name: 'T', nodes: [s, a, ok, nok], edges: [edge(s, a), edge(a, ok, 'approved'), edge(a, nok, 'rejected')] } });
  assert.equal(await engine.waitFor(id, 10000, true), 'waiting');
  const t: any = q.get(`select * from tasks where run_id = ? and status = 'waiting'`, id);
  assert.equal(JSON.parse(t.wait).message, 'OK A-9?');
  await engine.decide(t.id, true, 'tester', 'fine');
  assert.equal(await engine.waitFor(id), 'done');
  const st = JSON.parse((q.get('select state from runs where id = ?', id) as any).state);
  assert.equal(st.outputs.Approve.approval.by, 'tester');
  assert.ok('Approved' in st.outputs && !('Rejected' in st.outputs));
});

test('crash recovery: a task left running resumes after restart', async () => {
  const s = node('start', 'Start', { payload: '{"v":1}' });
  const l = node('log', 'After restart', { message: 'resumed {{input.v}}' });
  const doc = { name: 'T', nodes: [s, l], edges: [edge(s, l)] };
  // Simulate a crash: a run whose next task was claimed but never finished.
  q.run(`insert into runs(id, flow_name, version, doc, status, source, trigger_node, state, started_at) values('crash1', 'T', 0, ?, 'running', 'test', ?, ?, ?)`,
    JSON.stringify(doc), s.id, JSON.stringify({ outputs: { Start: { v: 1 } }, vars: {}, live: {}, skips: {}, skipped: {}, joins: {}, logs: [] }), new Date().toISOString());
  q.run(`insert into tasks(run_id, node_id, input, status) values('crash1', ?, '{"v":1}', 'running')`, l.id);
  engine.stop();
  engine.start();
  assert.equal(await engine.waitFor('crash1'), 'done');
  const st = JSON.parse((q.get(`select state from runs where id = 'crash1'`) as any).state);
  assert.ok(st.logs.some((x: any) => x.msg === 'resumed 1'));
});

test('HTTP request with Basic auth: header sent, secret masked in history', async () => {
  const cap = await captureServer(() => ({ body: JSON.stringify({ ok: true, echo: 'pw-Secret-123' }) }));
  try {
    setSecret('SVC_PW', 'pw-Secret-123');
    const auth = saveResource({ kind: 'outboundAuth', name: 'Svc basic', config: { type: 'basic', username: 'svc', passwordSecret: 'SVC_PW' } });
    const conn = saveResource({ kind: 'httpConnection', name: 'Svc', config: { baseUrl: cap.url, timeoutMs: 5000, headers: [{ k: 'X-Tenant', v: 't1' }] } });
    const s = node('start', 'Start', { payload: '{"id":"A-7"}' });
    const h = node('httpRequest', 'Call', {
      connection: conn.id, auth: auth.id, method: 'POST', url: '/orders/{{input.id}}', query: [{ k: 'expand', v: 'lines' }],
      headers: [{ k: 'X-Trace', v: '{{run.id}}' }], bodyType: 'json', body: '{"id": "{{input.id}}", "pw": "{{secret.SVC_PW}}"}', parse: 'auto', failOn: '4xx or 5xx',
    });
    const r = await run([s, h], [edge(s, h)]);
    assert.equal(r.status, 'done', r.error);
    const req = cap.seen[0];
    assert.equal(req.url, '/orders/A-7?expand=lines');
    assert.equal(req.headers.authorization, 'Basic ' + Buffer.from('svc:pw-Secret-123').toString('base64'));
    assert.equal(req.headers['x-tenant'], 't1');
    assert.equal(JSON.parse(req.body).pw, 'pw-Secret-123', 'secret reaches the target');
    const stored = JSON.stringify(r.state.outputs.Call) + r.tasks.map(t => t.output).join('');
    assert.ok(!stored.includes('pw-Secret-123'), 'secret value is masked in run history');
    assert.ok(stored.includes('••••••'));
  } finally { await cap.close(); }
});

test('HTTP 500 fails the step with the response detail', async () => {
  const cap = await captureServer(() => ({ status: 500, body: '{"error":"db down"}' }));
  try {
    const s = node('start', 'Start', { payload: '{}' });
    const h = node('httpRequest', 'Call', { method: 'GET', url: cap.url + '/x', failOn: '4xx or 5xx', parse: 'auto' });
    const r = await run([s, h], [edge(s, h)]);
    assert.equal(r.status, 'failed');
    assert.match(r.error, /returned 500.*db down/);
  } finally { await cap.close(); }
});

test('durable wait over 5 seconds is deferred, not held in memory', async () => {
  const s = node('start', 'Start', { payload: '{}' });
  const w = node('wait', 'Long wait', { ms: 5200 });
  const id = await engine.startRun({ doc: { name: 'T', nodes: [s, w], edges: [edge(s, w)] } });
  await new Promise(r => setTimeout(r, 600));
  const t: any = q.get(`select * from tasks where run_id = ? and node_id = ?`, id, w.id);
  assert.equal(t.status, 'pending');
  assert.equal(t.phase, 'resume');
  assert.ok(t.not_before > Date.now() + 3000);
  assert.equal(await engine.waitFor(id, 15000), 'done');
});
