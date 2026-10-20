/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.8.1
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { testEnv, node, edge } from './helpers.js';

/** Deleting and renaming Sutras, connections, schemas and folders: typed confirmation, deployed Sutras, Git, permissions. */
testEnv(20110);
const { boot } = await import('../server/src/index.js');
const flows = await import('../server/src/flows.js');
const { saveResource, getResource } = await import('../server/src/resources.js');
const { saveSchema, getSchema } = await import('../server/src/schemas.js');
const { setItemFolder, listFolders } = await import('../server/src/folders.js');
const { RULES } = await import('../server/src/guard.js');

let srv: Awaited<ReturnType<typeof boot>>;
before(async () => { srv = await boot({ listenAdmin: false, gateway: false }); });
after(async () => { await srv.stop(); });

type Who = { cookie?: string };
const call = (who: Who, method: string, url: string, payload?: any) => srv.admin.inject({ method: method as any, url, payload, headers: { 'x-sutra': '1', ...(who.cookie ? { cookie: who.cookie } : {}) } });
const ok = async (who: Who, method: string, url: string, payload?: any) => { const r = await call(who, method, url, payload); assert.ok(r.statusCode < 300, `${method} ${url}: ${r.statusCode} ${r.body}`); return r.json(); };
const admin: Who = {}, vic: Who = {};
let shop = '';
const sutraDoc = (name: string, extra: Record<string, any> = {}) => { const s = node('start', 'Start'), l = node('log', 'Say', { message: 'hi', ...extra }); return { name, nodes: [s, l], edges: [edge(s, l)] }; };

test('setup: an administrator, a viewer, a project with items in folders', async () => {
  const r = await call({}, 'POST', '/api/auth/setup', { username: 'root', password: 'first-admin-pass-1' });
  admin.cookie = String(r.headers['set-cookie']).split(';')[0];
  shop = (await ok(admin, 'POST', '/api/projects', { name: 'Shop' })).id;
  await ok(admin, 'POST', '/api/access/users', { username: 'vic', password: 'temporary-pass-9', grants: [{ role: 'viewer', project: shop }] });
  const s = await call({}, 'POST', '/api/auth/login', { username: 'vic', password: 'temporary-pass-9' });
  const c = await call({ cookie: String(s.headers['set-cookie']).split(';')[0] }, 'POST', '/api/auth/password', { current: 'temporary-pass-9', password: 'River-stone-88' });
  vic.cookie = String(c.headers['set-cookie']).split(';')[0];
  for (const k of ['POST /api/flows/:id/rename', 'POST /api/resources/:id/rename', 'POST /api/schemas/:id/rename', 'GET /api/projects/:id/usage', 'GET /api/projects/:id/folders/contents']) assert.ok(k in RULES, k);
});

test('rename: Sutra, connection and schema; a name used twice and an empty name are refused; a viewer may not', async () => {
  const f = flows.saveFlow(undefined, sutraDoc('Orders'), shop);
  const conn = saveResource({ kind: 'httpConnection', name: 'Orders API', project_id: shop, config: {} });
  const sc = saveSchema({ project_id: shop, name: 'Order', kind: 'json', text: '{"id": "A-1"}' });
  setItemFolder('sutras', f.id, 'Sales');
  await ok(admin, 'POST', `/api/flows/${f.id}/rename`, { name: 'Orders in' });
  assert.equal(flows.getFlow(f.id)!.doc.name, 'Orders in');
  assert.equal(flows.listFlows(shop).find(x => x.id === f.id)!.folder, 'Sales', 'renaming keeps the folder');
  await ok(admin, 'POST', `/api/resources/${conn.id}/rename`, { name: 'Orders API v2' });
  assert.equal(getResource(conn.id)!.name, 'Orders API v2');
  await ok(admin, 'POST', `/api/schemas/${sc.id}/rename`, { name: 'Order v2' });
  assert.equal(getSchema(sc.id)!.name, 'Order v2');
  assert.equal(getSchema(sc.id)!.text, '{"id": "A-1"}', 'the content stays');
  flows.saveFlow(undefined, sutraDoc('Refunds'), shop);
  assert.equal((await call(admin, 'POST', `/api/flows/${f.id}/rename`, { name: 'Refunds' })).statusCode, 400);
  assert.match((await call(admin, 'POST', `/api/flows/${f.id}/rename`, { name: '  ' })).json().error, /Give a name/);
  assert.equal((await call(vic, 'POST', `/api/flows/${f.id}/rename`, { name: 'Mine' })).statusCode, 403);
});

test('delete one item: usage is listed first, a deployed Sutra is refused until undeployed, a viewer may not', async () => {
  const conn = saveResource({ kind: 'httpConnection', name: 'Stock API', project_id: shop, config: {} });
  const user = flows.saveFlow(undefined, { ...sutraDoc('Stock'), nodes: [node('start', 'Start'), node('httpRequest', 'Call', { connection: conn.id })], edges: [] }, shop);
  const usage = await ok(admin, 'GET', `/api/projects/${shop}/usage?item=${conn.id}`);
  assert.deepEqual(usage.sutras, ['Stock']);
  flows.deploy(user.id);
  assert.match((await call(admin, 'DELETE', `/api/flows/${user.id}`)).json().error, /deployed: undeploy it first/);
  assert.ok(flows.getFlow(user.id), 'still there');
  assert.equal((await call(vic, 'DELETE', `/api/resources/${conn.id}`)).statusCode, 403);
  flows.undeploy(user.id);
  await ok(admin, 'DELETE', `/api/flows/${user.id}`);
  assert.equal(flows.getFlow(user.id), undefined);
  await ok(admin, 'DELETE', `/api/resources/${conn.id}`);
  assert.equal(getResource(conn.id), undefined);
});

test('delete a folder with everything in it: needs confirm=delete, refuses deployed Sutras, removes folders too', async () => {
  const a = flows.saveFlow(undefined, sutraDoc('Inbound A'), shop), b = flows.saveFlow(undefined, sutraDoc('Inbound B'), shop), keep = flows.saveFlow(undefined, sutraDoc('Keep'), shop);
  setItemFolder('sutras', a.id, 'Partners');
  setItemFolder('sutras', b.id, 'Partners/EU');
  setItemFolder('sutras', keep.id, 'Partnership');
  const c = await ok(admin, 'GET', `/api/projects/${shop}/folders/contents?area=sutras&path=Partners`);
  assert.deepEqual(c.items.map((i: any) => i.name).sort(), ['Inbound A', 'Inbound B'], 'a folder whose name starts the same is not inside');
  assert.deepEqual(c.folders, ['Partners', 'Partners/EU']);
  const url = `/api/projects/${shop}/folders?area=sutras&path=Partners&withItems=1`;
  assert.match((await call(admin, 'DELETE', url)).json().error, /Type delete to confirm/);
  flows.deploy(b.id);
  assert.match((await call(admin, 'DELETE', url + '&confirm=delete')).json().error, /Undeploy first: Inbound B is deployed/);
  assert.ok(flows.getFlow(a.id), 'nothing deleted while one is deployed');
  flows.undeploy(b.id);
  const r = await ok(admin, 'DELETE', url + '&confirm=DELETE');
  assert.equal(r.deleted, 2);
  assert.equal(flows.getFlow(a.id), undefined);
  assert.equal(flows.getFlow(b.id), undefined);
  assert.ok(flows.getFlow(keep.id));
  assert.deepEqual(listFolders(shop, 'sutras'), ['Partnership', 'Sales'], 'Partners and Partners/EU are gone; Partnership stays');
  // Without withItems the old behaviour stays: the folder goes, its contents move up.
  const s = saveSchema({ project_id: shop, name: 'Kept', kind: 'json', text: '{}' });
  setItemFolder('schemas', s.id, 'Old');
  await ok(admin, 'DELETE', `/api/projects/${shop}/folders?area=schemas&path=Old`);
  assert.ok(getSchema(s.id), 'removing a folder alone deletes nothing');
});

test('in a Git project, a deleted Sutra shows as a deleted file to commit at once', async () => {
  const f = flows.saveFlow(undefined, sutraDoc('Tracked'), shop);
  await ok(admin, 'POST', `/api/projects/${shop}/git/init`, { branch: 'main' });
  await ok(admin, 'DELETE', `/api/flows/${f.id}`);
  const st = await ok(admin, 'GET', `/api/projects/${shop}/git`);
  assert.ok(st.changes.some((c: any) => c.name === 'Tracked' && c.change === 'D'), JSON.stringify(st.changes));
});
