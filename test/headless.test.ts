import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { testEnv, node, edge } from './helpers.js';
import { startServer, waitFor, type Proc } from './proc.js';

// This process builds the packages; the headless engines run as separate processes.
testEnv(19110);
const { boot } = await import('../server/src/index.js');
const projects = await import('../server/src/projects.js');
const flows = await import('../server/src/flows.js');
const pk = await import('../server/src/packages.js');

let srv: Awaited<ReturnType<typeof boot>>;
const procs: Proc[] = [];
let deployDir = '', dataDir = '';
const TOKEN = 'headless-token-0123456789abcdef';
const KEY = crypto.randomBytes(32).toString('base64');
const H = { authorization: `Bearer ${TOKEN}` };

function makePackage(name: string, version: string, sutra: string, routePath: string, reply: string) {
  const pid = projects.listProjects().find(p => p.name === name)?.id || projects.saveProject({ name, config: { variables: [] } }).id;
  const t = node('restService', 'API', { method: 'GET', path: routePath, policy: '', maxBodyKb: 64, testRequest: JSON.stringify({ method: 'GET', params: {}, query: {}, headers: {}, body: null }) });
  const r = node('httpResponse', 'Reply', { status: '200', contentType: 'application/json', bodySource: 'template', body: reply, headers: [] });
  const existing = flows.listFlows(pid).find(f => f.name === sutra);
  const f = flows.saveFlow(existing?.id, { name: sutra, nodes: [t, r], edges: [edge(t, r)] }, pid);
  flows.deploy(f.id);
  const p = pk.buildPackage(pid, { version });
  flows.undeploy(f.id); // the builder's copy must not keep the address on this side
  return p;
}

const engine = (port: number, extra: Record<string, string> = {}) => startServer({
  adminPort: port, httpPort: port + 10,
  env: { SUTRA_MODE: 'engine', SUTRA_DATA_DIR: dataDir, SUTRA_MASTER_KEY: KEY, SUTRA_ADMIN_TOKEN: TOKEN, SUTRA_DEPLOY_DIR: deployDir, ...extra },
});

before(async () => {
  srv = await boot({ listenAdmin: false, gateway: false });
  deployDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-deploy-'));
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-engine-'));
  fs.writeFileSync(path.join(deployDir, '10-orders.sutra'), JSON.stringify(makePackage('Orders', '1.0.0', 'Ping', '/ping', '{"pong": true, "v": 1}')));
});
after(async () => {
  for (const p of procs) await p.stop();
  await srv.stop();
});

test('a headless engine deploys the packages in its folder and serves them, with no studio', async () => {
  const e = engine(19120); procs.push(e);
  await waitFor(`${e.admin}/ready`, e);
  assert.match(e.out(), /10-orders.sutra: Orders 1.0.0 deployed \(1 Sutras\)/);
  assert.match(e.out(), /SutraFlow engine .* \(headless\)/);

  const ping = await fetch(`${e.http}/ping`);
  assert.equal(ping.status, 200);
  assert.deepEqual(await ping.json(), { pong: true, v: 1 });

  const health = await (await fetch(`${e.admin}/health`)).json();
  assert.equal(health.mode, 'engine');
  assert.equal((await fetch(`${e.admin}/`)).status, 404, 'no studio pages');
  assert.equal((await fetch(`${e.admin}/api/projects`)).status, 401, 'no token');
  assert.equal((await fetch(`${e.admin}/api/projects`, { headers: { authorization: 'Bearer nope' } })).status, 401);
  assert.equal((await fetch(`${e.admin}/api/projects`, { headers: H })).status, 200);
  assert.equal((await fetch(`${e.admin}/api/flows`, { headers: H })).status, 404, 'no editing API');
  assert.equal((await fetch(`${e.admin}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401, 'no sign-in on an engine');
});

test('a new package deployed through the API is served at once; restarting does not deploy the folder twice', async () => {
  const e = procs[0];
  const p2 = makePackage('Billing', '1.0.0', 'Invoice', '/invoice', '{"invoice": "INV-1"}');
  const r = await fetch(`${e.admin}/api/packages/deploy`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ package: p2 }) });
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal((await (await fetch(`${e.http}/invoice`)).json()).invoice, 'INV-1');

  await e.stop();
  const again = engine(19130); procs.push(again);
  await waitFor(`${again.admin}/ready`, again);
  assert.match(again.out(), /10-orders.sutra: already deployed/);
  assert.equal((await fetch(`${again.http}/ping`)).status, 200);
  assert.equal((await fetch(`${again.http}/invoice`)).status, 200, 'API-deployed packages persist in the data folder');
  const hist = await (await fetch(`${again.admin}/api/projects`, { headers: H })).json();
  assert.ok(hist.some((p: any) => p.name === 'Billing'));
  await again.stop();
});

test('an updated package in the folder replaces the old version on the next start', async () => {
  fs.writeFileSync(path.join(deployDir, '10-orders.sutra'), JSON.stringify(makePackage('Orders', '1.1.0', 'Ping', '/ping', '{"pong": true, "v": 2}')));
  const e = engine(19140); procs.push(e);
  await waitFor(`${e.admin}/ready`, e);
  assert.match(e.out(), /Orders 1.1.0 deployed/);
  assert.equal((await (await fetch(`${e.http}/ping`)).json()).v, 2);
  await e.stop();
});

test('a package that cannot be deployed stops the engine with an error', async () => {
  const bad = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-bad-'));
  fs.writeFileSync(path.join(bad, 'broken.sutra'), '{"format": "sutraflow-package", "formatVersion": 1}');
  const e = engine(19150, { SUTRA_DEPLOY_DIR: bad, SUTRA_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-e2-')) }); procs.push(e);
  const code = await e.exited;
  assert.notEqual(code, 0);
  assert.match(e.out(), /broken.sutra: The package has no name/);
});

test('an engine without an admin token keeps its API closed but still serves and reports health', async () => {
  const e = engine(19160, { SUTRA_ADMIN_TOKEN: '', SUTRA_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-e3-')) }); procs.push(e);
  await waitFor(`${e.admin}/ready`, e);
  assert.equal((await fetch(`${e.http}/ping`)).status, 200);
  const r = await fetch(`${e.admin}/api/projects`, { headers: H });
  assert.equal(r.status, 401);
  assert.match((await r.json()).error, /has no SUTRA_ADMIN_TOKEN/);
  await e.stop();
});
