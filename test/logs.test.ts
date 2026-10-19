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
import { testEnv, node, edge } from './helpers.js';

/** Audit retention and clearing (administrators), project logs and test runs (developers; administrators on production). */
testEnv(19990);
const { boot } = await import('../server/src/index.js');
const { engine } = await import('../server/src/engine/engine.js');
const { q } = await import('../server/src/db.js');
const { config } = await import('../server/src/config.js');

let srv: Awaited<ReturnType<typeof boot>>;
before(async () => { srv = await boot({ listenAdmin: false, gateway: false }); });
after(async () => { await srv.stop(); });

type Who = { cookie?: string };
const call = (who: Who, method: string, url: string, payload?: any) => srv.admin.inject({ method: method as any, url, payload, headers: { 'x-sutra': '1', ...(who.cookie ? { cookie: who.cookie } : {}) } });
const admin: Who = {}, dev: Who = {}, ops: Who = {};
let shop = '';

test('setup: an administrator, a developer and an operator', async () => {
  const r = await call({}, 'POST', '/api/auth/setup', { username: 'root', password: 'first-admin-pass-1' });
  admin.cookie = String(r.headers['set-cookie']).split(';')[0];
  shop = (await call(admin, 'POST', '/api/projects', { name: 'Shop' })).json().id;
  for (const [u, role, who] of [['dana', 'developer', dev], ['omar', 'operator', ops]] as const) {
    await call(admin, 'POST', '/api/access/users', { username: u, password: 'temporary-pass-9', grants: [{ role, project: role === 'developer' ? shop : '' }] });
    const s = await call({}, 'POST', '/api/auth/login', { username: u, password: 'temporary-pass-9' });
    const c = await call({ cookie: String(s.headers['set-cookie']).split(';')[0] }, 'POST', '/api/auth/password', { current: 'temporary-pass-9', password: 'River-stone-88' });
    who.cookie = String(c.headers['set-cookie']).split(';')[0];
  }
});

test('audit retention: an operator reads it; only an administrator changes it or clears the log, and the clearing is recorded', async () => {
  let p = (await call(ops, 'GET', '/api/audit/policy')).json();
  assert.equal(typeof p.retentionDays, 'number');
  assert.ok(p.entries > 0);
  assert.equal((await call(ops, 'PUT', '/api/audit/policy', { retentionDays: 30 })).statusCode, 403, 'reading is not changing');
  assert.equal((await call(ops, 'POST', '/api/audit/clear', { all: true })).statusCode, 403);
  assert.equal((await call(admin, 'PUT', '/api/audit/policy', { retentionDays: -1 })).statusCode, 400);
  p = (await call(admin, 'PUT', '/api/audit/policy', { retentionDays: 30 })).json();
  assert.equal(p.retentionDays, 30);

  // Old entries, then clear before a date and older than the retention.
  q.run(`insert into audit(at, actor, actor_kind, ip, action, method, path, target, project_id, status, outcome, details) values('2020-01-01T00:00:00.000Z', 'old', '', '', 'x', '', '', '', '', 0, 'ok', '')`);
  q.run(`insert into audit(at, actor, actor_kind, ip, action, method, path, target, project_id, status, outcome, details) values('2026-01-01T00:00:00.000Z', 'older', '', '', 'x', '', '', '', '', 0, 'ok', '')`);
  let r = (await call(admin, 'POST', '/api/audit/clear', { before: '2021-01-01' })).json();
  assert.equal(r.deleted, 1);
  r = (await call(admin, 'POST', '/api/audit/clear', { olderThanRetention: true })).json();
  assert.equal(r.deleted, 1);
  const cleared = (await call(admin, 'GET', '/api/audit?action=Audit%20cleared')).json();
  assert.equal(cleared.length, 2);
  assert.equal(cleared[0].actor, 'root');

  r = (await call(admin, 'POST', '/api/audit/clear', { all: true })).json();
  assert.ok(r.deleted > 2);
  const left = (await call(admin, 'GET', '/api/audit?limit=10')).json();
  assert.deepEqual(left.map((x: any) => x.action), ['Audit cleared'], 'only the record of the clearing is left (and this read is not a change)');
  assert.equal(left[0].target, 'all entries');
  assert.equal((await call(admin, 'GET', '/api/audit/policy')).json().lastCleared.by, 'root');
});

test('project log: developers read it by level and words, and clear it and their test runs on a development server', async () => {
  const s = node('start', 'Start'), a = node('log', 'Info', { message: 'all good A-1001' }), b = node('log', 'Warn', { level: 'warn', message: 'stock low TEA-01' });
  const doc = { name: 'Logs', nodes: [s, a, b], edges: [edge(s, a), edge(a, b)] };
  const f = (await call(dev, 'POST', '/api/flows', { doc, projectId: shop })).json();
  for (let i = 0; i < 2; i++) {
    const id = engine.startRun({ doc, flowId: f.id, projectId: shop, source: 'test' });
    await engine.waitFor(id, 10000);
  }
  const live = engine.startRun({ doc, flowId: f.id, projectId: shop, source: 'rest' });
  await engine.waitFor(live, 10000);

  let log = (await call(dev, 'GET', `/api/projects/${shop}/log`)).json();
  assert.equal(log.environment, 'development');
  assert.ok(log.lines.some((l: string) => l.includes('all good A-1001')));
  log = (await call(dev, 'GET', `/api/projects/${shop}/log?level=warn`)).json();
  assert.ok(log.lines.length && log.lines.every((l: string) => /WARN|ERROR/.test(l)), 'warnings and errors only');
  log = (await call(dev, 'GET', `/api/projects/${shop}/log?q=tea-01`)).json();
  assert.ok(log.lines.length && log.lines.every((l: string) => l.includes('TEA-01')));
  assert.ok(log.bytes > 0);

  const cleared = (await call(dev, 'POST', `/api/projects/${shop}/log/clear`, {})).json();
  assert.ok(cleared.cleared > 0);
  assert.equal((await call(dev, 'GET', `/api/projects/${shop}/log`)).json().lines.length, 0);
  const runs = (await call(dev, 'POST', `/api/projects/${shop}/runs/clear-tests`, {})).json();
  assert.equal(runs.deleted, 2);
  assert.ok(q.get('select 1 from runs where id = ?', live), 'the deployed run is kept');
  assert.equal((await call(ops, 'POST', `/api/projects/${shop}/log/clear`, {})).statusCode, 403, 'an operator does not design');

  const audited = (await call(admin, 'GET', '/api/audit?actor=dana')).json().map((x: any) => x.action);
  assert.ok(audited.includes('POST /api/projects/:id/log/clear'));
});

test('log lines and audit entries say which server, which kind of run, and name the project and Sutra', async () => {
  const s = node('start', 'Start'), a = node('log', 'Say', { message: 'origin check' });
  const doc = { name: 'Origins', nodes: [s, a], edges: [edge(s, a)] };
  const f = (await call(dev, 'POST', '/api/flows', { doc, projectId: shop })).json();
  await engine.waitFor(engine.startRun({ doc, flowId: f.id, projectId: shop, source: 'test' }), 10000);
  await call(admin, 'POST', `/api/flows/${f.id}/deploy`, {});
  await engine.waitFor(engine.startRun({ doc, flowId: f.id, projectId: shop, source: 'rest', version: 1 }), 10000);

  const lines: string[] = (await call(dev, 'GET', `/api/projects/${shop}/log?q=origin%20check`)).json().lines;
  assert.ok(lines.some(l => l.includes('{development, editor test}')), 'a designer test run');
  assert.ok(lines.some(l => l.includes('{development, deployed v1}')), 'the deployed version');
  const deployedOnly: string[] = (await call(dev, 'GET', `/api/projects/${shop}/log?origin=deployed`)).json().lines;
  assert.ok(deployedOnly.length && deployedOnly.every(l => l.includes('deployed v')));
  const editorOnly: string[] = (await call(dev, 'GET', `/api/projects/${shop}/log?origin=editor`)).json().lines;
  assert.ok(editorOnly.length && editorOnly.every(l => /editor (test|debug)/.test(l)));

  // Audit: names and ids of the project and the Sutra, kept after the Sutra is deleted; filters by both.
  await call(dev, 'DELETE', `/api/flows/${f.id}`);
  const rows = (await call(admin, 'GET', `/api/audit?projectId=${shop}&sutraId=${f.id}`)).json();
  assert.deepEqual(rows.map((r: any) => r.action).sort(), ['DELETE /api/flows/:id', 'POST /api/flows', 'POST /api/flows/:id/deploy'].sort());
  for (const r of rows) {
    assert.equal(r.projectName, 'Shop');
    assert.equal(r.sutraName, 'Origins', 'the name survives deleting the Sutra');
    assert.equal(r.sutraId, f.id);
    assert.equal(r.environment, 'development');
    assert.ok(r.engine);
  }
  assert.equal(rows.find((r: any) => r.action === 'POST /api/flows/:id/deploy').origin, 'deployed');
  assert.equal((await call(admin, 'GET', '/api/audit?environment=production')).json().length, 0, 'filter by server');
  const csv = (await call(admin, 'GET', `/api/audit/export?sutraId=${f.id}`)).body;
  assert.match(csv.split('\n')[0], /^at,environment,engine,actor,actorKind,ip,action,origin,projectName,projectId,sutraName,sutraId,/);
});

test('on a production server only an administrator clears project logs', async () => {
  const was = config.environment;
  (config as any).environment = 'production';
  try {
    const r = await call(dev, 'POST', `/api/projects/${shop}/log/clear`, {});
    assert.equal(r.statusCode, 403);
    assert.match(r.json().error, /production server: only an administrator/);
    assert.equal((await call(dev, 'POST', `/api/projects/${shop}/runs/clear-tests`, {})).statusCode, 403);
    assert.equal((await call(admin, 'POST', `/api/projects/${shop}/log/clear`, {})).statusCode, 200);
    assert.equal((await call(dev, 'GET', `/api/projects/${shop}/log`)).json().environment, 'production', 'reading stays open');
  } finally { (config as any).environment = was; }
});
