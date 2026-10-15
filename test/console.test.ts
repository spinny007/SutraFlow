import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { testEnv, node, edge } from './helpers.js';
import { root } from './proc.js';

const env = testEnv(19730);
const { boot } = await import('../server/src/index.js');
const flows = await import('../server/src/flows.js');
const projects = await import('../server/src/projects.js');
const { engine } = await import('../server/src/engine/engine.js');
const { beat } = await import('../server/src/cluster.js');
const { lifecycle } = await import('../server/src/lifecycle.js');
const { config } = await import('../server/src/config.js');

let srv: Awaited<ReturnType<typeof boot>>;
before(async () => { srv = await boot({ listenAdmin: false }); });
after(async () => { await srv.stop(); });

type Who = { cookie?: string };
const call = (who: Who, method: string, url: string, payload?: any) =>
  srv.admin.inject({ method: method as any, url, payload, headers: { 'x-sutra': '1', ...(who.cookie ? { cookie: who.cookie } : {}) } });
const admin: Who = {}, viewer: Who = {}, ops: Who = {};
let shop = '', hr = '', stockId = '';

test('set up: two projects with deployed Sutras, an administrator, a viewer of one project, an operator', async () => {
  const r = await call({}, 'POST', '/api/auth/setup', { username: 'root', password: 'Console-admin-1' });
  admin.cookie = String(r.headers['set-cookie']).split(';')[0];
  shop = projects.saveProject({ name: 'Shop', config: { variables: [] } }).id;
  hr = projects.saveProject({ name: 'HR', config: { variables: [] } }).id;
  const t = node('restService', 'Stock API', { method: 'GET', path: '/stock', policy: '' });
  const reply = node('httpResponse', 'Reply', { status: '200', contentType: 'application/json', body: '{"ok":true}' });
  stockId = flows.saveFlow(undefined, { name: 'Stock', nodes: [t, reply], edges: [edge(t, reply)] }, shop).id;
  flows.deploy(stockId);
  const s = node('start', 'Start'), bad = node('throw', 'Fail', { message: 'boom' });
  const failing = flows.saveFlow(undefined, { name: 'Payroll', nodes: [s, bad], edges: [edge(s, bad)] }, hr);
  flows.deploy(failing.id);
  const d = flows.deployedFlows().find(x => x.flowId === failing.id)!;
  const id = engine.startRun({ doc: d.doc, flowId: d.flowId, projectId: hr, version: d.version, source: 'api' });
  await engine.waitFor(id, 10000);
  for (const [u, role, project, who] of [['vic', 'viewer', shop, viewer], ['olga', 'operator', '', ops]] as const) {
    await call(admin, 'POST', '/api/access/users', { username: u, password: 'Console-user-77', mustChange: false, grants: [{ role, project }] });
    const l = await call({}, 'POST', '/api/auth/login', { username: u, password: 'Console-user-77' });
    who.cookie = String(l.headers['set-cookie']).split(';')[0];
  }
});

test('overview: engines, deployed Sutras, runs and failures, limited to the projects the caller may see', async () => {
  const o = (await call(admin, 'GET', '/api/console/overview')).json();
  assert.equal(o.cluster.engines.length, 1);
  assert.equal(o.cluster.engines[0].id, config.engineId);
  assert.deepEqual(o.sutras, { running: 2, stopped: 0 });
  assert.equal(o.runs24h.failed, 1);
  assert.equal(o.failures[0].flowName, 'Payroll');
  assert.match(o.failures[0].error, /boom/);
  const v = (await call(viewer, 'GET', '/api/console/overview')).json();
  assert.deepEqual(v.sutras, { running: 1, stopped: 0 }, 'only Shop');
  assert.equal(v.failures.length, 0, 'the HR failure is not shown');
});

test('applications: projects, Sutras, triggers and run counts; viewers see only their projects', async () => {
  const apps = (await call(admin, 'GET', '/api/console/apps')).json();
  assert.deepEqual(apps.map((p: any) => p.name), ['HR', 'Shop']);
  const stock = apps.find((p: any) => p.name === 'Shop').sutras[0];
  assert.equal(stock.name, 'Stock');
  assert.equal(stock.enabled, true);
  assert.deepEqual(stock.triggers.map((t: any) => t.what), ['GET /stock']);
  assert.equal(apps.find((p: any) => p.name === 'HR').sutras[0].runs24h.failed, 1);
  assert.deepEqual((await call(viewer, 'GET', '/api/console/apps')).json().map((p: any) => p.name), ['Shop']);
});

test('stop and start a deployed Sutra: its address stops answering, then answers again; viewers may not', async () => {
  assert.equal((await fetch(`${env.http}/stock`)).status, 200);
  assert.equal((await call(viewer, 'PUT', `/api/console/sutras/${stockId}/enabled`, { enabled: false })).statusCode, 403);
  const stop = await call(ops, 'PUT', `/api/console/sutras/${stockId}/enabled`, { enabled: false });
  assert.equal(stop.statusCode, 200, stop.body);
  assert.equal((await fetch(`${env.http}/stock`)).status, 404, 'stopped');
  const app = (await call(admin, 'GET', '/api/console/apps')).json().find((p: any) => p.name === 'Shop').sutras[0];
  assert.equal(app.enabled, false);
  assert.equal(app.version, 1, 'still deployed');
  assert.deepEqual((await call(admin, 'GET', '/api/console/overview')).json().sutras, { running: 1, stopped: 1 });
  await call(ops, 'PUT', `/api/console/sutras/${stockId}/enabled`, { enabled: true });
  assert.equal((await fetch(`${env.http}/stock`)).status, 200, 'started again');
  const audit = (await call(admin, 'GET', '/api/audit?actor=olga')).json();
  assert.ok(audit.some((e: any) => e.action === 'PUT /api/console/sutras/:id/enabled' && e.details?.enabled === false && e.projectId === shop));
});

test('the Admin Console page is served at /admin', async () => {
  if (!fs.existsSync(path.join(root, 'dist/web/admin.html'))) return;
  const r = await srv.admin.inject({ method: 'GET', url: '/admin' });
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /SutraFlow Admin Console/);
});

test('drain an engine from the console: only with the Engines permission; the engine drains on its next beat', async () => {
  assert.equal((await call(viewer, 'POST', `/api/console/engines/${encodeURIComponent(config.engineId)}/drain`)).statusCode, 403);
  assert.equal((await call(ops, 'POST', '/api/console/engines/no-such-engine/drain')).statusCode, 404);
  const r = await call(ops, 'POST', `/api/console/engines/${encodeURIComponent(config.engineId)}/drain`);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(lifecycle.draining, false, 'not yet');
  beat();
  for (let i = 0; i < 50 && !lifecycle.draining; i++) await new Promise(res => setTimeout(res, 20));
  assert.equal(lifecycle.draining, true, 'draining after its heartbeat');
});
