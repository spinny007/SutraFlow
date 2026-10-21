/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.6
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { testEnv, node, edge, port } from './helpers.js';

/**
 * The engine on a real PostgreSQL through the connection pool (asyncdb.ts): transactions at the same
 * time, every run finished, every step done once, fencing, and the shared-lock fallback. Needs
 * SUTRA_TEST_PG_URL (an administrator address); the test makes a database of its own and drops it.
 */
const ADMIN = process.env.SUTRA_TEST_PG_URL;
testEnv(20600);
let dbName = '';
let adminClient: any;
if (ADMIN) {
  const { default: pg } = await import('pg');
  adminClient = new pg.Client({ connectionString: ADMIN });
  adminClient.on('error', () => {});
  await adminClient.connect();
  dbName = `sutra_asyncpg_${Date.now()}`;
  await adminClient.query(`CREATE DATABASE ${dbName}`);
  const u = new URL(ADMIN); u.pathname = `/${dbName}`;
  process.env.SUTRA_DB = u.toString();
  process.env.SUTRA_WORKERS = '16';
}
const skip = ADMIN ? false : 'SUTRA_TEST_PG_URL is not set';

let srv: any, engine: any, runState: any, q: any, flows: any, projects: any, asyncDatabase: any, poolFigures: any;
before(async () => {
  if (!ADMIN) return;
  ({ engine, runState } = await import('../server/src/engine/engine.js'));
  ({ q } = await import('../server/src/db.js'));
  ({ asyncDatabase, poolFigures } = await import('../server/src/asyncdb.js'));
  flows = await import('../server/src/flows.js');
  projects = await import('../server/src/projects.js');
  const { boot } = await import('../server/src/index.js');
  srv = await boot({ listenAdmin: false });
  await srv.admin.listen({ host: '127.0.0.1', port: port(20609) });
});
after(async () => {
  if (!ADMIN) return;
  await srv?.stop();
  await adminClient.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
  await adminClient.end();
});

let shop = '';
function deployed(name: string, nodes: any[], edges: any[]) {
  shop ||= projects.saveProject({ name: 'Pool shop', config: { variables: [] } }).id;
  const f = flows.saveFlow(undefined, { name, nodes, edges }, shop);
  flows.deploy(f.id);
  return f.id;
}
const start = (flowId: string, input: any = {}) => {
  const d = flows.deployedFlows().find((x: any) => x.flowId === flowId)!;
  return engine.startRun({ doc: d.doc, flowId, projectId: d.projectId, version: d.version, source: 'api', input });
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

test('the engine uses the pool on PostgreSQL, and its transactions run at the same time', { skip }, async () => {
  assert.equal(asyncDatabase().pooled, true);
  assert.equal(asyncDatabase().backend, 'postgres');
  const s = node('start', 'Start'), a = node('jsonata', 'A', { source: '{{input}}', expression: '{ "n": n + 1 }' }), b = node('jsonata', 'B', { source: '{{input}}', expression: '{ "n": n * 2 }' }), c = node('jsonata', 'C', { source: '{{input}}', expression: '{ "n": n - 1 }' });
  const id = deployed('Pool many', [s, a, b, c], [edge(s, a), edge(a, b), edge(b, c)]);
  const ids: string[] = await Promise.all(Array.from({ length: 200 }, (_, i) => start(id, { n: i })));
  for (const r of ids) assert.equal(await engine.waitFor(r, 60000), 'done');
  const rows = q.all(`select run_id, node_id, count(*) n from tasks where status = 'done' and run_id in (${ids.map(() => '?').join(',')}) group by run_id, node_id`, ...ids);
  assert.equal(rows.length, 800, 'every step of every run');
  assert.ok(rows.every((r: any) => Number(r.n) === 1), 'none twice');
  assert.equal(runState(ids[10])!.outputs.C.n, 21);
  assert.ok(poolFigures.total >= 2, `more than one connection was in use (${poolFigures.total})`);
  assert.ok(poolFigures.txMs.count > 0 && poolFigures.acquireMs.count > 0);
});

test('PostgreSQL NOTIFY wakes an idle engine while durable polling remains the fallback', { skip }, async () => {
  engine.setPollMs(10000);
  const before = engine.concurrency;
  engine.concurrency = 0;
  const s = node('start', 'Start'), n = node('log', 'Woken', { message: 'now' });
  const id = deployed('Notify wake', [s, n], [edge(s, n)]);
  const runId = await start(id);
  await sleep(100);
  assert.equal(q.get('select status from runs where id = ?', runId).status, 'running');
  engine.concurrency = 1;
  const u = new URL(ADMIN!); u.pathname = `/${dbName}`;
  const { default: pg } = await import('pg');
  const external = new pg.Client({ connectionString: u.toString() });
  await external.connect();
  const at = Date.now();
  await external.query('update tasks set not_before = not_before where run_id = $1 and status = \'pending\'', [runId]);
  assert.equal(await engine.waitFor(runId, 3000), 'done');
  assert.ok(Date.now() - at < 3000, 'completed before the 10-second poll');
  await external.end();
  engine.concurrency = before;
  engine.setPollMs(200);
});

test('fencing on PostgreSQL: a step recovered by another engine meanwhile is left to it', { skip }, async () => {
  const s = node('start', 'Start'), w = node('wait', 'Slow', { ms: 1200 }), n = node('log', 'Next', { message: 'next' });
  const id = deployed('Pool fenced', [s, w, n], [edge(s, w), edge(w, n)]);
  const runId = await start(id);
  let task: any;
  for (let i = 0; i < 100 && !task; i++) { task = q.get(`select id from tasks where run_id = ? and node_id = ? and status = 'running'`, runId, w.id); if (!task) await sleep(20); }
  assert.ok(task);
  // Another engine, alive (a heartbeat, so the leader does not recover its steps), now holds the step.
  q.run(`insert into engines(id, host, pid, mode, version, started_at, heartbeat_at, workers) values('other-engine', 'h', 1, 'engine', 'x', ?, ?, 1) on conflict(id) do update set heartbeat_at = excluded.heartbeat_at`, new Date().toISOString(), Date.now() + 60000);
  q.run(`update tasks set owner = 'other-engine', claim = claim + 1 where id = ?`, task.id);
  await sleep(1800);
  assert.equal(q.get('select owner from tasks where id = ?', task.id).owner, 'other-engine');
  assert.equal(q.get('select 1 as x from tasks where run_id = ? and node_id = ?', runId, n.id), undefined);
  assert.equal(await engine.cancel(runId, 'test over'), true);
});

test('runs at once, approvals and cancel work through the pool', { skip }, async () => {
  const s = node('start', 'Start'), ap = node('approval', 'Approve', { message: 'OK?' }), done = node('log', 'Done', { message: 'ok' });
  const id = deployed('Pool approval', [s, ap, done], [edge(s, ap), edge(ap, done, 'approved')]);
  const runId = await start(id);
  assert.equal(await engine.waitFor(runId, 10000, true), 'waiting');
  const t = q.get(`select id from tasks where run_id = ? and status = 'waiting'`, runId);
  await engine.decide(Number(t.id), true, 'tester');
  assert.equal(await engine.waitFor(runId, 10000), 'done');
  // Runs at once 1: the others queue under the Sutra's lock and start one after another.
  const qs = node('start', 'Start'), hold = node('wait', 'Hold', { ms: 200 });
  const q2 = deployed('Pool queue', [qs, hold], [edge(qs, hold)]);
  const { setSutraTuning } = await import('../server/src/tuning.js');
  setSutraTuning(q2, { maxRuns: 1 });
  const runs: string[] = await Promise.all([start(q2), start(q2), start(q2)]);
  const statuses = runs.map(r => q.get('select status from runs where id = ?', r).status).sort();
  assert.deepEqual(statuses, ['queued', 'queued', 'running']);
  for (const r of runs) assert.equal(await engine.waitFor(r, 15000), 'done');
});
