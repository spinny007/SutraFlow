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
import fs from 'node:fs';
import path from 'node:path';
import { testEnv, node, edge, port } from './helpers.js';

/**
 * Load and performance features: per-run database locks, the settings cache, Sutras that run in
 * memory, the queue check tuning, and big files read as a stream in batches.
 */
const env = testEnv(20450);
process.env.SUTRA_ADMIN_TOKEN = 'performance-admin-token-0123456789';
const { boot } = await import('../server/src/index.js');
const { engine, runState } = await import('../server/src/engine/engine.js');
const { q, lockId, memoryStore, dbKind } = await import('../server/src/db.js');
const { config } = await import('../server/src/config.js');
const flows = await import('../server/src/flows.js');
const projects = await import('../server/src/projects.js');
const { parseCsvRows, csvParser, streamRows } = await import('../server/src/palettes/fileformat.js');

let srv: Awaited<ReturnType<typeof boot>>;
before(async () => { srv = await boot({ listenAdmin: false }); await srv.admin.listen({ host: '127.0.0.1', port: port(20459) }); });
after(async () => { await srv.stop(); });

const H = { authorization: `Bearer ${process.env.SUTRA_ADMIN_TOKEN}` };
const call = (method: string, url: string, payload?: any) => srv.admin.inject({ method: method as any, url, payload, headers: H });
let shop = '';
function deployed(name: string, nodes: any[], edges: any[]) {
  shop ||= projects.saveProject({ name: 'Performance shop', config: { variables: [{ name: 'GREETING', type: 'string', value: 'hello' }] } }).id;
  const f = flows.saveFlow(undefined, { name, nodes, edges }, shop);
  flows.deploy(f.id);
  return f.id;
}
const start = (flowId: string, input: any = {}, source = 'api') => {
  const d = flows.deployedFlows().find(x => x.flowId === flowId)!;
  return engine.startRun({ doc: d.doc, flowId, projectId: d.projectId, version: d.version, source, input });
};
const inMemory = async (id: string) => assert.equal((await call('PUT', `/api/console/sutras/${id}/tuning`, { values: { execution: 'in memory' } })).statusCode, 200);

test('lock numbers: the same key always gives the same number, other keys others, never the shared lock', () => {
  assert.equal(lockId('run:a'), lockId('run:a'));
  const ids = new Set(Array.from({ length: 2000 }, (_, i) => lockId(`run:${i}`)));
  assert.ok(ids.size > 1995, 'hardly any collisions');
  for (const n of ids) { assert.ok(n > 1000000 && Number.isSafeInteger(n)); assert.notEqual(n, 424242); }
});

test('settings cache: variables are kept for the refresh time, a change on this engine clears them at once, 0 reads every step', () => {
  deployed('Cache warm-up', [node('start', 'Start')], []);
  const v1 = projects.effectiveVariables(shop).values.GREETING;
  assert.equal(v1, 'hello');
  const p = projects.getProject(shop)!;
  projects.saveProject({ ...p, config: { ...p.config, variables: [{ name: 'GREETING', type: 'string', value: 'hi' }] } } as any);
  assert.equal(projects.effectiveVariables(shop).values.GREETING, 'hi', 'saving the project clears the cache');
  // A write that skips the project functions (another engine, say) is seen after the refresh time.
  const raw = q.get<any>('select config from projects where id = ?', shop);
  const cfg = JSON.parse(raw.config); cfg.variables[0].value = 'hey';
  q.run('update projects set config = ? where id = ?', JSON.stringify(cfg), shop);
  assert.equal(projects.effectiveVariables(shop).values.GREETING, 'hi', 'cached');
  const keep = projects.settingsCache.ms;
  projects.settingsCache.ms = 0;
  try { assert.equal(projects.effectiveVariables(shop).values.GREETING, 'hey', 'no cache: read fresh'); } finally { projects.settingsCache.ms = keep; }
  projects.forgetCachedSettings();
});

test('in memory: steps run without database writes and the whole run is saved when it ends', async () => {
  const s = node('start', 'Start'), a = node('jsonata', 'Add', { source: '{{input}}', expression: '{ "n": n + 1 }' }), b = node('jsonata', 'Double', { source: '{{input}}', expression: '{ "n": n * 2, "g": $gv.GREETING }' });
  const id = deployed('Fast lane', [s, a, b], [edge(s, a), edge(a, b)]);
  await inMemory(id);
  const runId = await start(id, { n: 4 });
  assert.equal(q.get('select 1 from runs where id = ?', runId), undefined, 'not in the database while it runs');
  const open = (await call('GET', `/api/runs/${runId}`)).json();
  assert.equal(open.inMemory, true, 'the run API knows it while it is in memory');
  assert.equal(open.status, 'running');
  assert.equal(await engine.waitFor(runId, 10000), 'done');
  const row = q.get<any>('select id, status, steps, state, flow_id from runs where id = ?', runId);
  assert.equal(row.status, 'done');
  assert.equal(row.flow_id, id);
  assert.equal(runState(row.id)!.outputs.Double.n, 10);
  const tasks = q.all<any>('select node_id, status, output from tasks where run_id = ? order by id', runId);
  assert.deepEqual(tasks.map(t => t.status), ['done', 'done', 'done'], 'every step is in the history');
  assert.equal(engine.memoryRuns, 0, 'nothing left in memory');
  // Many at once.
  // Many at once: started together, so their steps run side by side.
  const many = await Promise.all(Array.from({ length: 40 }, (_, i) => start(id, { n: i })));
  for (const r of many) assert.equal(await engine.waitFor(r, 20000), 'done');
  assert.equal(Number(q.get<any>(`select count(*) n from tasks where run_id in (${many.map(() => '?').join(',')})`, ...many).n), 120);
});

test('in memory: tests and debugging stay durable; retries and the error port work; a step that waits fails with a clear message', async () => {
  const s = node('start', 'Start'), a = node('jsonata', 'Same', { source: '{{input}}', expression: '$' });
  const id = deployed('Fast but tested', [s, a], [edge(s, a)]);
  await inMemory(id);
  const t = await start(id, {}, 'test');
  assert.ok(q.get('select 1 from runs where id = ?', t), 'a test run is written at once');
  assert.equal(await engine.waitFor(t, 10000), 'done');

  const s2 = node('start', 'Start'), boom = node('throw', 'Boom', { message: 'no' }, { retries: 2, retryDelayMs: 10 }), fix = node('jsonata', 'Handled', { source: '{{input}}', expression: '{ "handled": error.message }' });
  const id2 = deployed('Fast retries', [s2, boom, fix], [edge(s2, boom), edge(boom, fix, 'error')]);
  await inMemory(id2);
  const r2 = await start(id2);
  assert.equal(await engine.waitFor(r2, 10000), 'done');
  assert.equal(q.get<any>(`select attempt from tasks where run_id = ? and node_id = ?`, r2, boom.id).attempt, 2, 'retried twice in memory');
  assert.equal(runState(r2)!.outputs.Handled.handled, 'no');

  const s3 = node('start', 'Start'), w = node('approval', 'Approve', { title: 'OK?' });
  const id3 = deployed('Fast but waits', [s3, w], [edge(s3, w)]);
  const refused = await call('PUT', `/api/console/sutras/${id3}/tuning`, { values: { execution: 'in memory' } });
  assert.equal(refused.statusCode, 400);
  assert.match(refused.json().error, /Approve waits .* Keep this Sutra durable/);
  // Tuned before the waiting step was added (or by hand): the step fails with the reason instead.
  q.run('update deployments set tuning = ? where flow_id = ?', JSON.stringify({ execution: 'in memory' }), id3);
  (await import('../server/src/tuning.js')).loadSutraTuning();
  const r3 = await start(id3);
  assert.equal(await engine.waitFor(r3, 10000), 'failed');
  assert.match(q.get<any>('select error from runs where id = ?', r3).error, /runs in memory cannot wait/);
});

test('in memory: a run can be cancelled while it is in memory', async () => {
  const s = node('start', 'Start'), slow = node('jsonata', 'Slow', { source: '{{input}}', expression: '$count([1..3000000])' });
  const id = deployed('Fast cancel', [s, slow], [edge(s, slow)]);
  await inMemory(id);
  const r = await start(id);
  assert.equal(await engine.cancel(r, 'stop'), true);
  assert.equal(await engine.waitFor(r, 10000), 'cancelled');
  assert.equal(q.get<any>('select status from runs where id = ?', r).status, 'cancelled');
});

test('memory store: a private database with the full schema', () => {
  const m = memoryStore();
  m.tx(() => { m.q.run(`insert into runs(id, flow_name, doc, status, source, trigger_node, state, started_at) values('x', 'X', '{}', 'running', 'api', 't', '{}', '2026-01-01')`); });
  assert.equal(m.q.get<any>('select status from runs where id = ?', 'x').status, 'running');
  assert.equal(q.get('select 1 from runs where id = ?', 'x'), undefined, 'not in the database');
  assert.throws(() => m.tx(() => { m.q.run(`update runs set status = 'done'`); throw new Error('roll back'); }));
  assert.equal(m.q.get<any>('select status from runs where id = ?', 'x').status, 'running');
});

test('tuning: queue check, settings refresh and steps at once in memory apply at once', async () => {
  let r = await call('PUT', '/api/console/tuning/engine', { values: { pollMs: 100, settingsRefreshMs: 0, memoryWorkers: 4 } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(config.pollMs, 100);
  assert.equal(projects.settingsCache.ms, 0);
  assert.equal(config.memoryWorkers, 4);
  assert.match((await call('PUT', '/api/console/tuning/engine', { values: { pollMs: 5 } })).json().error, /Queue check: a number from 20/);
  assert.match((await call('PUT', '/api/console/sutras/x/tuning', { values: { execution: 'fast' } })).json().error, /not deployed|Execution: one of durable, in memory/);
  r = await call('PUT', '/api/console/tuning/engine', { values: {} });
  const d = r.json().defaults;
  assert.equal(config.pollMs, d.pollMs, 'back to the default (from this machine, or SUTRA_POLL_MS)');
  assert.equal(projects.settingsCache.ms, d.settingsRefreshMs);
  // The machine and its recommendation.
  const m = (await call('GET', '/api/console/machine')).json();
  assert.ok(m.cpus >= 1 && m.memoryGb > 0);
  assert.ok(m.profiles.some((p: any) => p.name === m.recommended.name));
});

// ---------- streaming files ----------

test('CSV in pieces: any split of the text gives the same rows as the whole text', () => {
  const text = 'id,name,note\r\n1,"Smith, J","said ""hi"""\r\n2,Ann,"two\nlines"\n\n3,Bo,\r\n4,"x""",end\r\n';
  const whole = parseCsvRows(text, ',');
  assert.equal(whole.length, 5);
  for (let i = 0; i <= text.length; i++) for (const j of [i, Math.min(text.length, i + 1), Math.min(text.length, i + 7)]) {
    const p = csvParser(',');
    const got = [...p.push(text.slice(0, i)), ...p.push(text.slice(i, j)), ...p.push(text.slice(j)), ...p.end()];
    assert.deepEqual(got, whole, `split at ${i} and ${j}`);
  }
});

test('streaming: a big CSV file is read in batches with typed rows, only one batch at a time', async () => {
  const file = path.join(env.dir, 'big.csv');
  const out = fs.createWriteStream(file);
  out.write('﻿id;amount;city\r\n');
  for (let i = 1; i <= 25000; i++) out.write(`${i};${i},5;"City ${i % 7}"\r\n`);
  await new Promise(r => out.end(r));
  let rows = 0, biggest = 0, first: any, last: any;
  const r = await streamRows(file, { format: 'CSV rows', delimiter: ';', header: true, decimal: ',' }, null, 1000, async (b, n) => {
    rows += b.length; biggest = Math.max(biggest, b.length);
    if (n === 1) first = b[0];
    last = b[b.length - 1];
    await new Promise(res => setImmediate(res));
  });
  assert.deepEqual(r, { count: 25000, batches: 25 });
  assert.equal(rows, 25000);
  assert.equal(biggest, 1000);
  assert.deepEqual(first, { id: 1, amount: 1.5, city: 'City 1' });
  assert.equal(last.id, 25000);
});

test('streaming: lines with skipped rows, no trailing empty line, other encodings', async () => {
  const file = path.join(env.dir, 'lines.txt');
  fs.writeFileSync(file, 'header\r\nfirst\r\n\r\nthird\r\n');
  const got: any[] = [];
  const r = await streamRows(file, { format: 'lines', skipRows: 1 }, null, 2, b => { got.push(...b); });
  assert.deepEqual(got, [{ number: 1, line: 'first' }, { number: 2, line: '' }, { number: 3, line: 'third' }]);
  assert.deepEqual(r, { count: 3, batches: 2 });
  const latin = path.join(env.dir, 'latin.csv');
  fs.writeFileSync(latin, Buffer.from('name\nJos\xe9\n', 'latin1'));
  const rows: any[] = [];
  await streamRows(latin, { format: 'CSV rows', encoding: 'iso-8859-1' }, null, 10, b => { rows.push(...b); });
  assert.deepEqual(rows, [{ name: 'José' }]);
  await assert.rejects(streamRows(file, { format: 'JSON' }, null, 10, () => {}), /CSV rows or lines/);
});

test('Read file with Stream in batches: each batch starts the steps on the batch port, out gives the totals', async () => {
  const dir = path.join(env.dir, 'inbox');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'orders.csv'), 'id,qty\n' + Array.from({ length: 2500 }, (_, i) => `${i + 1},${(i % 5) + 1}`).join('\n'));
  const s = node('start', 'Start');
  const read = node('fileRead', 'Read orders', { folder: dir, path: 'orders.csv', format: 'CSV rows', stream: true, batchSize: 1000 });
  const sum = node('jsonata', 'Sum batch', { source: '{{input}}', expression: '{ "batch": batch, "rows": count, "qty": $sum(rows.qty) }' });
  const done = node('jsonata', 'Totals', { source: '{{input}}', expression: '{ "count": count, "batches": batches }' });
  const id = deployed('Stream orders', [s, read, sum, done], [edge(s, read), edge(read, sum, 'batch'), edge(read, done, 'out')]);
  const runId = await start(id);
  assert.equal(await engine.waitFor(runId, 20000), 'done');
  const sums = q.all<any>('select output from tasks where run_id = ? and node_id = ? order by id', runId, sum.id).map(t => JSON.parse(t.output));
  assert.deepEqual(sums.map(x => x.rows), [1000, 1000, 500]);
  assert.equal(sums.reduce((a, x) => a + x.qty, 0), 7500);
  const totals = JSON.parse(q.get<any>('select output from tasks where run_id = ? and node_id = ?', runId, done.id).output);
  assert.deepEqual(totals, { count: 2500, batches: 3 });
  // Without streaming, a file over the size limit is refused with the way out.
  const whole = node('fileRead', 'Read whole', { folder: dir, path: 'orders.csv', format: 'CSV rows', maxMb: 0.001 });
  const s2 = node('start', 'Start');
  const id2 = deployed('Too big', [s2, whole], [edge(s2, whole)]);
  const r2 = await start(id2);
  assert.equal(await engine.waitFor(r2, 10000), 'failed');
  assert.match(q.get<any>('select error from runs where id = ?', r2).error, /Stream it in batches/);
});

test('sizing: the profile is the smaller of what the cores and the memory allow', async () => {
  const { profileFor } = await import('../server/src/sizing.js');
  assert.equal(profileFor(1, 1).name, 'Small');
  assert.equal(profileFor(4, 1).name, 'Small', 'little memory limits a machine with more cores');
  assert.equal(profileFor(2, 4).name, 'Small plus');
  assert.equal(profileFor(16, 8).name, 'Medium');
  assert.equal(profileFor(8, 16).name, 'Large');
  assert.equal(profileFor(32, 64).name, 'Very large');
  assert.equal(profileFor(1, 1).database, 'SQLite');
});

test('streaming with step data none: batch steps keep no input or output; the reader waits for the queue (back pressure)', async () => {
  const dir = path.join(env.dir, 'inbox2');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'many.csv'), 'id\n' + Array.from({ length: 20000 }, (_, i) => String(i + 1)).join('\n'));
  const s = node('start', 'Start');
  const read = node('fileRead', 'Read many', { folder: dir, path: 'many.csv', format: 'CSV rows', stream: true, batchSize: 100 });
  const slow = node('jsonata', 'Slow batch', { source: '{{input}}', expression: '{ "n": count }' });
  const id = deployed('Stream none', [s, read, slow], [edge(s, read), edge(read, slow, 'batch')]);
  assert.equal((await call('PUT', `/api/console/sutras/${id}/tuning`, { values: { stepData: 'none' } })).statusCode, 200);
  let most = 0;
  const runId = await start(id);
  const watch = setInterval(() => { most = Math.max(most, Number(q.get<any>(`select count(*) n from tasks where run_id = ? and status = 'pending'`, runId)?.n || 0)); }, 5);
  try { assert.equal(await engine.waitFor(runId, 60000), 'done'); } finally { clearInterval(watch); }
  assert.ok(most <= Math.max(4, engine.concurrency * 2) + 2, `at most a few batches wait (saw ${most})`);
  const rows = q.all<any>('select input, output from tasks where run_id = ? and node_id = ?', runId, slow.id);
  assert.equal(rows.length, 200);
  assert.ok(rows.every(r => r.input === null && r.output === null), 'nothing kept');
  const st = runState(runId)!;
  assert.equal(st.outputs['Read many'].rows, undefined, 'the run state keeps a summary, not the rows');
});

test('covering indexes exist for the claim and status queries', () => {
  const names = q.all<any>(dbKind() === 'sqlite' ? "select name from sqlite_master where type = 'index'" : 'select indexname as name from pg_indexes').map(r => r.name);
  for (const n of ['tasks_run_status', 'tasks_claim', 'tasks_status']) assert.ok(names.includes(n), n);
});
