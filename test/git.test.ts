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
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { testEnv, node, edge } from './helpers.js';

/** Git workspaces: a team project and personal copies, commit, push, pull, conflicts, branches, trust, own accounts. */
process.env.SUTRA_GIT_ALLOW_FILE = '1';
testEnv(20010);
const { boot } = await import('../server/src/index.js');
const { engine } = await import('../server/src/engine/engine.js');
const { q } = await import('../server/src/db.js');
const flows = await import('../server/src/flows.js');
const { saveResource } = await import('../server/src/resources.js');
const { saveSchema } = await import('../server/src/schemas.js');
const { setItemFolder } = await import('../server/src/folders.js');
const { engines } = await import('../server/src/git/engine.js');

let srv: Awaited<ReturnType<typeof boot>>;
before(async () => { srv = await boot({ listenAdmin: false, gateway: false }); });
after(async () => { await srv.stop(); });

type Who = { cookie?: string };
const call = (who: Who, method: string, url: string, payload?: any) => srv.admin.inject({ method: method as any, url, payload, headers: { 'x-sutra': '1', ...(who.cookie ? { cookie: who.cookie } : {}) } });
const ok = async (who: Who, method: string, url: string, payload?: any) => { const r = await call(who, method, url, payload); assert.ok(r.statusCode < 300, `${method} ${url}: ${r.statusCode} ${r.body}`); return r.json(); };
const admin: Who = {}, dana: Who = {};
const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-remote-')) + '/shop.git';
const remote = pathToFileURL(bare).href;
let shop = '', danaShop = '';
const sutraDoc = (name: string, msg: string) => { const s = node('start', 'Start'), l = node('log', 'Say', { message: msg }); return { name, nodes: [s, l], edges: [edge(s, l)] }; };
const sayOf = (projectId: string, name: string) => flows.getFlow(flows.listFlows(projectId).find(f => f.name === name)!.id)!.doc.nodes.find(n => n.type === 'log')!.config.message;

test('setup: a team project with Sutras in folders, a connection and a schema; an administrator and a developer', async () => {
  execFileSync('git', ['init', '--bare', '-b', 'main', bare]);
  const r = await call({}, 'POST', '/api/auth/setup', { username: 'root', password: 'first-admin-pass-1' });
  admin.cookie = String(r.headers['set-cookie']).split(';')[0];
  shop = (await ok(admin, 'POST', '/api/projects', { name: 'Shop' })).id;
  const a = flows.saveFlow(undefined, sutraDoc('Orders', 'hello from main'), shop);
  setItemFolder('sutras', a.id, 'Sales/Inbound');
  const conn = saveResource({ kind: 'database', name: 'Shop DB', project_id: shop, config: { driver: 'postgres', host: 'db', passwordSecret: 'SHOP_DB_PASSWORD' } });
  flows.saveFlow(undefined, { ...sutraDoc('Report', 'report'), nodes: [node('start', 'Start'), node('dbQuery', 'Query', { connection: conn.id, sql: 'select 1' })], edges: [] }, shop);
  saveSchema({ project_id: shop, name: 'Order', kind: 'json', text: '{"id": "A-1"}' });
  await ok(admin, 'POST', '/api/access/users', { username: 'dana', password: 'temporary-pass-9', grants: [{ role: 'developer', project: shop }] });
  const s = await call({}, 'POST', '/api/auth/login', { username: 'dana', password: 'temporary-pass-9' });
  const c = await call({ cookie: String(s.headers['set-cookie']).split(';')[0] }, 'POST', '/api/auth/password', { current: 'temporary-pass-9', password: 'River-stone-88' });
  dana.cookie = String(c.headers['set-cookie']).split(';')[0];
});

test('initialize the team project, publish it; the repository holds readable files and never secret values', async () => {
  assert.equal((await ok(admin, 'GET', `/api/projects/${shop}/git`)).connected, false);
  let st = await ok(admin, 'POST', `/api/projects/${shop}/git/init`, { branch: 'main' });
  assert.equal(st.kind, 'shared');
  st = await ok(admin, 'POST', `/api/projects/${shop}/git/publish`, { url: remote });
  assert.equal(st.ahead, 0);
  const files = execFileSync('git', ['--git-dir', bare, 'ls-tree', '-r', '--name-only', 'main'], { encoding: 'utf8' }).trim().split('\n').sort();
  assert.deepEqual(files, ['.gitattributes', 'README.md', 'connections/Shop DB.connection.json', 'schemas/Order.json', 'schemas/Order.schema.json', 'sutraflow.json', 'sutras/Report.sutra.json', 'sutras/Sales/Inbound/Orders.sutra.json']);
  const conn = JSON.parse(execFileSync('git', ['--git-dir', bare, 'show', 'main:connections/Shop DB.connection.json'], { encoding: 'utf8' }));
  assert.equal(conn.config.passwordSecret, 'SHOP_DB_PASSWORD', 'the secret by name');
  const report = JSON.parse(execFileSync('git', ['--git-dir', bare, 'show', 'main:sutras/Report.sutra.json'], { encoding: 'utf8' }));
  assert.equal(report.doc.nodes.find((n: any) => n.type === 'dbQuery').config.connection, conn.id, 'references use repository ids');
});

test('a developer clones a personal copy: only they see it, it is restricted until trusted, and it cannot be deployed', async () => {
  const r = await ok(dana, 'POST', '/api/git/clone', { url: remote });
  danaShop = r.projectId;
  assert.equal(r.name, 'Shop (dana)');
  assert.equal(r.kind, 'personal');
  assert.equal(r.trusted, false);
  assert.deepEqual(flows.listFlows(danaShop).map(f => [f.name, f.folder]).sort(), [['Orders', 'Sales/Inbound'], ['Report', '']]);
  assert.notEqual(flows.listFlows(danaShop)[0].id, flows.listFlows(shop)[0].id, 'own ids, so copies never clash');
  const danaConn = q.get<any>('select id from resources where project_id = ?', danaShop).id;
  const rep = flows.getFlow(flows.listFlows(danaShop).find(f => f.name === 'Report')!.id)!.doc;
  assert.equal(rep.nodes.find(n => n.type === 'dbQuery')!.config.connection, danaConn, 'references point at the copy\'s own connection');
  assert.ok(!(await ok(admin, 'GET', '/api/projects')).some((p: any) => p.id === danaShop), 'others do not see the copy');
  assert.ok((await ok(dana, 'GET', '/api/projects')).some((p: any) => p.id === danaShop));
  assert.equal((await call(dana, 'POST', `/api/flows/${flows.listFlows(danaShop)[0].id}/deploy`, {})).statusCode, 403, 'a developer does not deploy');
  const deploy = await call(admin, 'POST', `/api/flows/${flows.listFlows(danaShop)[0].id}/deploy`, {});
  assert.ok(deploy.statusCode >= 400);
  assert.match(deploy.json().error, /own copy of a repository/, 'not even an administrator deploys a personal copy');

  // Restricted: code does not run until trusted.
  const code = { name: 'Code', nodes: [node('start', 'Start'), node('jsCode', 'Run code', { code: 'return 1' })], edges: [] as any[] };
  code.edges = [edge(code.nodes[0], code.nodes[1])];
  let id = engine.startRun({ doc: code, projectId: danaShop, source: 'test' });
  await engine.waitFor(id, 10000);
  assert.match(q.get<any>('select error from runs where id = ?', id).error, /restricted mode/);
  await ok(dana, 'POST', `/api/projects/${danaShop}/git/trust`);
  id = engine.startRun({ doc: code, projectId: danaShop, source: 'test' });
  await engine.waitFor(id, 10000);
  assert.equal(q.get<any>('select status from runs where id = ?', id).status, 'done');
});

test('change, see it by item, diff, commit and push; the team project pulls it', async () => {
  const f = flows.listFlows(danaShop).find(x => x.name === 'Orders')!;
  flows.saveFlow(f.id, sutraDoc('Orders', 'changed by dana'));
  const st = await ok(dana, 'GET', `/api/projects/${danaShop}/git`);
  assert.deepEqual(st.changes.map((c: any) => [c.kind, c.name, c.change]), [['sutra', 'Orders', 'M']]);
  const d = await ok(dana, 'GET', `/api/projects/${danaShop}/git/diff?path=${encodeURIComponent(st.changes[0].path)}`);
  assert.match(d.before, /hello from main/);
  assert.match(d.after, /changed by dana/);
  assert.equal((await call(dana, 'POST', `/api/projects/${danaShop}/git/commit`, { message: '' })).statusCode, 400);
  await ok(dana, 'POST', `/api/projects/${danaShop}/git/commit`, { message: 'Orders: new greeting', push: true });
  const log = execFileSync('git', ['--git-dir', bare, 'log', '-1', '--format=%an|%s', 'main'], { encoding: 'utf8' }).trim();
  assert.equal(log, 'dana|Orders: new greeting', 'committed as dana');

  const pulled = await ok(admin, 'POST', `/api/projects/${shop}/git/pull`);
  assert.deepEqual(pulled.conflicts, []);
  assert.equal(sayOf(shop, 'Orders'), 'changed by dana');
  const hist = await ok(admin, 'GET', `/api/projects/${shop}/git/log`);
  assert.equal(hist[0].subject, 'Orders: new greeting');
  const files = await ok(admin, 'GET', `/api/projects/${shop}/git/commits/${hist[0].sha}`);
  assert.deepEqual(files.map((x: any) => [x.kind, x.name, x.status]), [['sutra', 'Orders', 'M']]);
});

test('both change the same Sutra: the second puller resolves the conflict by choosing a side', async () => {
  flows.saveFlow(flows.listFlows(shop).find(x => x.name === 'Orders')!.id, sutraDoc('Orders', 'admin wins'));
  await ok(admin, 'POST', `/api/projects/${shop}/git/commit`, { message: 'Admin edit', push: true });
  flows.saveFlow(flows.listFlows(danaShop).find(x => x.name === 'Orders')!.id, sutraDoc('Orders', 'dana edit'));
  assert.match((await call(dana, 'POST', `/api/projects/${danaShop}/git/pull`)).json().error, /Commit or discard your 1 changes first/);
  await ok(dana, 'POST', `/api/projects/${danaShop}/git/commit`, { message: 'Dana edit' });
  const r = await ok(dana, 'POST', `/api/projects/${danaShop}/git/pull`);
  assert.equal(r.conflicts.length, 1);
  assert.match(r.conflicts[0], /Orders\.sutra\.json$/);
  assert.equal(sayOf(danaShop, 'Orders'), 'dana edit', 'the project is not touched while the conflict is open');
  const done = await ok(dana, 'POST', `/api/projects/${danaShop}/git/resolve`, { path: r.conflicts[0], side: 'theirs' });
  assert.deepEqual(done.conflicts, []);
  assert.equal(sayOf(danaShop, 'Orders'), 'admin wins');
  await ok(dana, 'POST', `/api/projects/${danaShop}/git/push`);
});

test('branches: work on a branch, switch back; discard undoes uncommitted changes', async () => {
  await ok(dana, 'POST', `/api/projects/${danaShop}/git/switch`, { branch: 'feature/greeting', create: true });
  flows.saveFlow(flows.listFlows(danaShop).find(x => x.name === 'Orders')!.id, sutraDoc('Orders', 'on the branch'));
  await ok(dana, 'POST', `/api/projects/${danaShop}/git/commit`, { message: 'Branch work', push: true });
  const b = await ok(dana, 'GET', `/api/projects/${danaShop}/git/branches`);
  assert.equal(b.current, 'feature/greeting');
  assert.ok(b.local.includes('main') && b.remote.includes('feature/greeting'));
  await ok(dana, 'POST', `/api/projects/${danaShop}/git/switch`, { branch: 'main' });
  assert.equal(sayOf(danaShop, 'Orders'), 'admin wins');
  flows.saveFlow(flows.listFlows(danaShop).find(x => x.name === 'Orders')!.id, sutraDoc('Orders', 'oops'));
  flows.saveFlow(undefined, sutraDoc('Scratch', 'temp'), danaShop);
  assert.match((await call(dana, 'POST', `/api/projects/${danaShop}/git/switch`, { branch: 'feature/greeting' })).json().error, /Commit or discard/);
  await ok(dana, 'POST', `/api/projects/${danaShop}/git/discard`, {});
  assert.equal(sayOf(danaShop, 'Orders'), 'admin wins');
  assert.ok(!flows.listFlows(danaShop).some(f => f.name === 'Scratch'), 'a new Sutra is removed by discard');
});

test('Git accounts are per person: tokens are never returned, never usable by others, and go only in the request header', async () => {
  const seen: string[] = [];
  const fake = http.createServer((req, res) => { seen.push(String(req.headers.authorization || '')); res.writeHead(401, { 'www-authenticate': 'Basic realm="git"' }); res.end(); });
  await new Promise<void>(r => fake.listen(0, '127.0.0.1', () => r()));
  const url = `http://127.0.0.1:${(fake.address() as any).port}/acme/shop.git`;
  try {
    const acc = await ok(dana, 'POST', '/api/git/accounts', { provider: 'other', host: '127.0.0.1', login: 'dana', token: 'dana-secret-token-123', label: 'Local' });
    assert.equal(acc.token, undefined);
    assert.equal((await ok(dana, 'GET', '/api/git/accounts')).length, 1);
    assert.equal((await ok(admin, 'GET', '/api/git/accounts')).length, 0, 'the administrator does not see dana\'s account');
    assert.equal((await call(admin, 'DELETE', `/api/git/accounts/${acc.id}`)).statusCode, 400, 'nor delete it');
    const t = await call(dana, 'POST', `/api/git/accounts/${acc.id}/test`, { url });
    assert.equal(t.statusCode, 400);
    assert.ok(!t.body.includes('dana-secret-token-123'), 'the token never appears in messages');
    assert.ok(seen.includes(`Basic ${Buffer.from('dana:dana-secret-token-123').toString('base64')}`), 'sent as the HTTP header');
    const audit = (await ok(admin, 'GET', '/api/audit?actor=dana&limit=50')).map((x: any) => JSON.stringify(x)).join('\n');
    assert.ok(!audit.includes('dana-secret-token-123'), 'never in the audit log');
  } finally { fake.close(); }
});

test('the built-in Git: init, commit, status, history and files at a commit, without the git command', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-iso-'));
  const g = engines.builtin;
  await g.init(dir, 'main');
  fs.writeFileSync(path.join(dir, 'a.json'), '{"v":1}\n');
  const c1 = await g.commitAll(dir, 'first', { name: 'Ann', email: 'ann@example.test' });
  assert.ok(c1);
  assert.equal(await g.commitAll(dir, 'nothing', { name: 'Ann', email: 'ann@example.test' }), null);
  fs.writeFileSync(path.join(dir, 'a.json'), '{"v":2}\n');
  fs.writeFileSync(path.join(dir, 'b.json'), '{}\n');
  const st = await g.status(dir);
  assert.deepEqual(st.files.map(f => f.path).sort(), ['a.json', 'b.json']);
  const c2 = await g.commitAll(dir, 'second', { name: 'Ann', email: 'ann@example.test' });
  const log = await g.log(dir, 10);
  assert.deepEqual(log.map(x => x.subject), ['second', 'first']);
  assert.equal(await g.fileAt(dir, c1!, 'a.json'), '{"v":1}\n');
  assert.deepEqual((await g.changedIn(dir, c2!)).map(x => `${x.status} ${x.path}`).sort(), ['A b.json', 'M a.json']);
  await g.switchBranch(dir, 'feature', true);
  assert.equal((await g.branches(dir)).current, 'feature');
});

test('disconnecting a personal copy removes it; the team project keeps its Sutras', async () => {
  await ok(dana, 'DELETE', `/api/projects/${danaShop}/git`);
  assert.equal(q.get('select 1 from projects where id = ?', danaShop), undefined);
  assert.equal(flows.listFlows(shop).length, 2);
});
