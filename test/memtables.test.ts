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
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { testEnv, node, edge, port } from './helpers.js';

/** Memory tables: small reference data kept in memory, loaded from a query, with a failsafe copy. */
const env = testEnv(20500);
process.env.SUTRA_ADMIN_TOKEN = 'memtables-admin-token-0123456789';
process.env.SUTRA_MEMORY_SYNC_MS = '0';
const { boot } = await import('../server/src/index.js');
const { engine, runState } = await import('../server/src/engine/engine.js');
const { q } = await import('../server/src/db.js');
const flows = await import('../server/src/flows.js');
const projects = await import('../server/src/projects.js');
const { saveResource, effectiveResource } = await import('../server/src/resources.js');
const mem = await import('../server/src/memtables.js');

let srv: Awaited<ReturnType<typeof boot>>;
before(async () => { srv = await boot({ listenAdmin: false }); await srv.admin.listen({ host: '127.0.0.1', port: port(20509) }); });
after(async () => { await srv.stop(); });
const H = { authorization: `Bearer ${process.env.SUTRA_ADMIN_TOKEN}` };
const call = (method: string, url: string, payload?: any) => srv.admin.inject({ method: method as any, url, payload, headers: H });

// A source database with a table of currencies.
const src = new DatabaseSync(path.join(env.dir, 'ref.sqlite'));
src.exec(`create table rates(code text primary key, name text, rate real, active int);
  insert into rates values ('EUR', 'Euro', 1.08, 1), ('GBP', 'Pound', 1.27, 1), ('JPY', 'Yen', 0.0067, 1), ('XXX', 'Old', 0, 0);`);
src.close();
const shop = projects.saveProject({ name: 'Rates shop', config: { variables: [] } }).id;
const db = saveResource({ kind: 'database', name: 'Ref', project_id: shop, config: { driver: 'sqlite', file: 'ref.sqlite' } });
const rates = saveResource({ kind: 'memoryTable', name: 'Rates', project_id: shop, config: {
  key: 'code', source: 'database query', database: db.id,
  loadSql: 'SELECT code, name, rate FROM rates WHERE active = 1', lookupSql: 'SELECT code, name, rate FROM rates WHERE code = :key',
  keep: 'copy in the database',
} });
const deployed = (name: string, nodes: any[], edges: any[]) => { const f = flows.saveFlow(undefined, { name, nodes, edges }, shop); flows.deploy(f.id); return f.id; };
const run = async (flowId: string, input: any = {}) => {
  const d = flows.deployedFlows().find(x => x.flowId === flowId)!;
  const id = await engine.startRun({ doc: d.doc, flowId, projectId: shop, version: d.version, source: 'api', input });
  const status = await engine.waitFor(id, 15000);
  return { status, out: runState(id)!.outputs, error: q.get<any>('select error from runs where id = ?', id).error };
};

test('loads part of a table at first use; Memory get finds a row, fetches a missing one with the lookup query, says missing otherwise', async () => {
  const s = node('start', 'Start'), g = node('memGet', 'Rate', { table: rates.id, key: '{{input.code}}' });
  const found = node('log', 'Found', { message: 'ok' }), missing = node('log', 'Missing', { message: 'no' });
  const id = deployed('Get rate', [s, g, found, missing], [edge(s, g), edge(g, found, 'found'), edge(g, missing, 'missing')]);
  let r = await run(id, { code: 'GBP' });
  assert.equal(r.status, 'done', r.error);
  assert.deepEqual(r.out.Rate.row, { code: 'GBP', name: 'Pound', rate: 1.27 });
  assert.ok(r.out.Found);
  const t = await mem.memTable(rates.id);
  assert.equal(t.rows.size, 3, 'only active rows were loaded');
  r = await run(id, { code: 'XXX' });
  assert.equal(r.out.Rate.row.name, 'Old', 'fetched with the lookup query');
  assert.equal(t.rows.size, 4, 'and kept');
  r = await run(id, { code: 'NOPE' });
  assert.equal(r.out.Rate.found, false);
  assert.ok(r.out.Missing);
});

test('Memory put, query and delete; memory-lookup() reads memory in a mapping', async () => {
  const s = node('start', 'Start');
  const p = node('memPut', 'Add', { table: rates.id, row: '{{input.rows}}' });
  const qy = node('memQuery', 'Dear', { table: rates.id, condition: '={row.rate} > 1' });
  const id = deployed('Put rates', [s, p, qy], [edge(s, p), edge(p, qy)]);
  const r = await run(id, { rows: [{ code: 'CHF', name: 'Franc', rate: 1.13 }, { code: 'INR', name: 'Rupee', rate: 0.012 }] });
  assert.equal(r.status, 'done', r.error);
  assert.deepEqual([r.out.Add.added, r.out.Add.count], [2, 2]);
  assert.deepEqual(r.out.Dear.rows.map((x: any) => x.code).sort(), ['CHF', 'EUR', 'GBP']);
  // memory-lookup() reads memory where mappings and settings are worked out.
  const { resolve } = await import('../server/src/template.js');
  const scope = { process: { project: shop } } as any;
  assert.equal(resolve("=memory-lookup('Rates', 'CHF', 'name')", scope), 'Franc');
  assert.equal(resolve("=memory-lookup('Rates', 'CHF')", scope).rate, 1.13);
  assert.equal(resolve("=memory-lookup('Rates', 'ZZZ', 'name')", scope), null, 'not in memory: empty, no waiting');
  const s3 = node('start', 'Start'), d = node('memDelete', 'Drop', { table: rates.id, key: 'INR' });
  assert.equal((await run(deployed('Drop', [s3, d], [edge(s3, d)]))).out.Drop.deleted, true);
  assert.equal((await mem.memTable(rates.id)).rows.has('INR'), false);
});

test('Delete Memory Records removes a list of keys or records matching fields and a condition', async () => {
  const t = await mem.memTable(rates.id);
  mem.memPut(t, { code: 'A1', group: 'old', rate: 1 });
  mem.memPut(t, { code: 'A2', group: 'old', rate: 2 });
  mem.memPut(t, { code: 'A3', group: 'old', rate: 3 });
  const s = node('start', 'Start');
  const list = node('memDelete', 'Delete list', { table: rates.id, what: 'list of keys', keys: ['A1', 'A2'] });
  const match = node('memDelete', 'Delete match', { table: rates.id, what: 'matching records', match: [{ k: 'group', v: 'old' }], condition: '={row.rate} >= 3', limit: 10 });
  const r = await run(deployed('Delete cached records', [s, list, match], [edge(s, list), edge(list, match)]));
  assert.equal(r.status, 'done', r.error);
  assert.deepEqual(r.out['Delete list'].keys.sort(), ['A1', 'A2']);
  assert.deepEqual(r.out['Delete match'].keys, ['A3']);
  assert.equal(t.rows.has('A1') || t.rows.has('A2') || t.rows.has('A3'), false);
});

test('failsafe: every change is in the database copy; a restarted engine (or another one) has the rows without asking the source', async () => {
  const t = await mem.memTable(rates.id);
  const copy = q.all<any>('select k from mem_rows where store_id = ? and value is not null order by k', rates.id).map(r => r.k);
  assert.deepEqual(copy, [...t.rows.keys()].sort());
  // Another engine changed a row: this one sees it at the next use (sync time 0 in this test).
  const v = Number(q.get<any>('select version from mem_meta where store_id = ?', rates.id).version) + 1;
  q.run(`update mem_rows set value = ?, version = ? where store_id = ? and k = 'EUR'`, JSON.stringify({ code: 'EUR', name: 'Euro', rate: 1.1 }), v, rates.id);
  q.run('update mem_meta set version = ? where store_id = ?', v, rates.id);
  assert.equal((await mem.memGet(await mem.memTable(rates.id), 'EUR')).rate, 1.1);
  // A restart: the memory is gone, the source is not asked (its rows would say 1.08).
  mem.stopMemTables();
  const again = await mem.memTable(rates.id);
  assert.equal(again.loads, 0, 'loaded from the copy, not from the source');
  assert.equal((await mem.memGet(again, 'EUR')).rate, 1.1);
  assert.equal(again.rows.has('CHF'), true, 'rows added by Sutras survive');
});

test('limits: memory tables are for small reference data; a load that is too big is refused, rows beyond the limit are dropped', async () => {
  const small = saveResource({ kind: 'memoryTable', name: 'Tiny', project_id: shop, config: { key: 'code', source: 'database query', database: db.id, loadSql: 'SELECT code, name FROM rates', maxRows: 2, keep: 'memory only' } });
  await assert.rejects(mem.memTable(small.id), /returned 4 rows .* more than this memory table keeps \(2 rows/);
  const lru = saveResource({ kind: 'memoryTable', name: 'Recent', project_id: shop, config: { key: 'id', maxRows: 3, keep: 'memory only' } });
  const t = await mem.memTable(lru.id);
  for (const id of [1, 2, 3]) mem.memPut(t, { id });
  await mem.memGet(t, '1'); // used: kept
  mem.memPut(t, { id: 4 });
  assert.deepEqual([...t.rows.keys()].sort(), ['1', '3', '4'], 'the least recently used row went');
  assert.equal(q.get('select 1 from mem_rows where store_id = ?', lru.id), undefined, 'memory only writes nothing');
  assert.throws(() => mem.memPut(t, { name: 'no id' }), /has no id/);
});

test('Admin Console: tables with their settings and figures, rows, reload and clear', async () => {
  const list = (await call('GET', '/api/console/memory')).json();
  const r = list.find((x: any) => x.name === 'Rates');
  assert.ok(r.rows >= 4 && r.failsafe && r.settings.key === 'code' && r.settings.refreshMinutes === 0, JSON.stringify(r));
  const rows = (await call('GET', `/api/console/memory/${rates.id}/rows?limit=2&offset=1`)).json();
  const byField = (await call('GET', `/api/console/memory/${rates.id}/rows?field=name&value=Pound`)).json();
  assert.deepEqual(byField.rows.map((x: any) => x.key), ['GBP']);
  assert.equal(rows.offset, 1);
  assert.equal((await call('GET', '/api/console/memory?find=rat')).json().length, 1);
  assert.equal(rows.rows.length, 2);
  assert.ok(rows.total >= 4);
  const re = (await call('POST', `/api/console/memory/${rates.id}/reload`)).json();
  assert.equal(re.rows, 3, 'reloaded from the source: the rows Sutras added are gone');
  assert.equal((await call('POST', `/api/console/memory/${rates.id}/clear`)).json().rows, 0);
});

test('Admin configures refresh schedules and cluster/project quotas', async () => {
  const saved = (await call('PUT', `/api/console/memory/${rates.id}/config`, {
    source: 'database query', database: db.id, loadSql: rates.config.loadSql, lookupSql: rates.config.lookupSql,
    key: 'code', refresh: 'cron', refreshCron: '0 */10 * * * *', refreshTimezone: 'Asia/Kolkata', maxRows: 10000, maxMb: 16, keep: 'copy in the database',
  })).json();
  assert.equal(saved.config.refresh, 'cron');
  await call('GET', `/api/console/memory/${rates.id}/rows`);
  const stat = (await call('GET', '/api/console/memory')).json().find((x: any) => x.id === rates.id);
  assert.equal(stat.settings.databaseDriver, 'sqlite');
  assert.ok(stat.nextRefresh, JSON.stringify(stat));
  const before = (await call('GET', '/api/console/memory-quotas')).json();
  assert.ok(before.usage.engine.tables >= 1);
  const changed = (await call('PUT', '/api/console/memory-quotas', { engine: { maxRows: 900000, maxMb: 1900 }, projects: { [shop]: { maxRows: 200000, maxMb: 400 } } })).json();
  assert.deepEqual(changed.quotas.projects[shop], { maxRows: 200000, maxMb: 400 });
  const tooLow = await call('PUT', '/api/console/memory-quotas', { engine: { maxRows: 1, maxMb: 1 }, projects: {} });
  assert.equal(tooLow.statusCode, 400); assert.match(tooLow.body, /already uses/);
  await call('PUT', '/api/console/memory-quotas', before.quotas);
});

test('a scheduled table recovers when its external source becomes available after startup', async () => {
  const late = saveResource({ kind: 'memoryTable', name: 'Late source', project_id: shop, config: { key: 'id', source: 'database query', database: db.id, loadSql: 'SELECT id, label FROM later_rows', refresh: 'interval', refreshMinutes: 0.001, keep: 'memory only' } });
  await assert.rejects(mem.memTable(late.id), /later_rows/);
  const external = new DatabaseSync(path.join(env.dir, 'ref.sqlite'));
  external.exec("create table later_rows(id text primary key, label text); insert into later_rows values ('ready', 'Recovered')"); external.close();
  await new Promise(resolve => setTimeout(resolve, 180));
  const t = await mem.memTable(late.id);
  assert.equal((await mem.memGet(t, 'ready')).label, 'Recovered');
  assert.equal(t.lastError, null);
});

test('connection details are cached for the settings refresh time and a change clears them at once', () => {
  const a = effectiveResource(db.id)!;
  assert.equal(effectiveResource(db.id), a, 'the same object: not read again');
  saveResource({ ...a, config: { ...a.config, file: 'other.sqlite' } });
  assert.equal(effectiveResource(db.id)!.config.file, 'other.sqlite');
  saveResource({ ...a, config: { ...a.config, file: 'ref.sqlite' } });
});

test('engines get a display name in the Admin Console; their id stays the same', async () => {
  const st = (await call('GET', '/api/engine/status')).json();
  const id = st.self;
  assert.equal((await call('PUT', `/api/console/engines/${encodeURIComponent(id)}/name`, { name: 'Azure West Europe 1' })).json().name, 'Azure West Europe 1');
  const e = (await call('GET', '/api/engine/status')).json().engines.find((x: any) => x.id === id);
  assert.equal(e.name, 'Azure West Europe 1');
  await call('PUT', `/api/console/engines/${encodeURIComponent(id)}/name`, { name: '' });
  assert.equal((await call('GET', '/api/engine/status')).json().engines.find((x: any) => x.id === id).name, '');
});
