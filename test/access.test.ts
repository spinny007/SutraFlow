import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { testEnv, node, edge } from './helpers.js';

const env = testEnv(19710);
const { boot } = await import('../server/src/index.js');
const { RULES } = await import('../server/src/guard.js');
const access = await import('../server/src/access.js');
const { saveResource } = await import('../server/src/resources.js');
const flows = await import('../server/src/flows.js');

let srv: Awaited<ReturnType<typeof boot>>;
before(async () => { srv = await boot({ listenAdmin: false }); });
after(async () => { await srv.stop(); });

type Who = { cookie?: string; token?: string };
const call = (who: Who, method: string, url: string, payload?: any) => srv.admin.inject({
  method: method as any, url, payload,
  headers: { ...(who.token ? { authorization: `Bearer ${who.token}` } : { 'x-sutra': '1' }), ...(who.cookie ? { cookie: who.cookie } : {}) },
});
const signIn = async (username: string, password: string) => {
  const r = await call({}, 'POST', '/api/auth/login', { username, password });
  return { status: r.statusCode, body: r.json(), cookie: String(r.headers['set-cookie'] || '').split(';')[0] };
};

const admin: Who = {};
let shop = '', hr = '';

test('the first administrator gets every permission; built-in roles exist', async () => {
  const r = await call({}, 'POST', '/api/auth/setup', { username: 'root', password: 'first-admin-pass-1' });
  assert.equal(r.statusCode, 200);
  admin.cookie = String(r.headers['set-cookie']).split(';')[0];
  const me = (await call(admin, 'GET', '/api/access/me')).json();
  assert.equal(me.username, 'root');
  assert.deepEqual([...me.permissions.all].sort(), access.PERMISSIONS.map(p => p.id).sort());
  const roles = (await call(admin, 'GET', '/api/access/roles')).json();
  for (const id of ['administrator', 'developer', 'deployer', 'operator', 'approver', 'viewer', 'apiCaller']) assert.ok(roles.some((x: any) => x.id === id && x.builtin), id);
  shop = (await call(admin, 'POST', '/api/projects', { name: 'Shop' })).json().id;
  hr = (await call(admin, 'POST', '/api/projects', { name: 'HR' })).json().id;
});

test('every route has an access rule, and every rule names a real route', async () => {
  for (const key of Object.keys(RULES)) {
    const [method, url] = key.split(' ');
    assert.ok(srv.admin.hasRoute({ method: method as any, url }), `rule without a route: ${key}`);
  }
});

test('a developer on one project: password change first, then only that project, no deploy, no admin', async () => {
  const created = await call(admin, 'POST', '/api/access/users', { username: 'dana', displayName: 'Dana', email: 'dana@example.test', password: 'temporary-pass-9', grants: [{ role: 'developer', project: shop }] });
  assert.equal(created.statusCode, 200, created.body);
  assert.equal(created.json().mustChange, true);
  assert.equal((await call(admin, 'POST', '/api/access/users', { username: 'weak', password: 'short' })).statusCode, 400);

  let s = await signIn('dana', 'temporary-pass-9');
  assert.equal(s.status, 200);
  assert.equal(s.body.mustChange, true);
  const dana: Who = { cookie: s.cookie };
  const blocked = await call(dana, 'GET', '/api/projects');
  assert.equal(blocked.statusCode, 403);
  assert.equal(blocked.json().mustChange, true);
  assert.equal((await call(dana, 'POST', '/api/auth/password', { current: 'wrong-one-123', password: 'River-stone-88' })).statusCode, 400);
  const changed = await call(dana, 'POST', '/api/auth/password', { current: 'temporary-pass-9', password: 'River-stone-88' });
  assert.equal(changed.statusCode, 200);
  dana.cookie = String(changed.headers['set-cookie']).split(';')[0];

  const projects = (await call(dana, 'GET', '/api/projects')).json();
  assert.deepEqual(projects.map((p: any) => p.name), ['Shop']);
  const doc = { name: 'Hello', nodes: [node('start', 'Start'), node('log', 'Log', { message: 'hi' })], edges: [] as any[] };
  doc.edges = [edge(doc.nodes[0], doc.nodes[1])];
  const f = await call(dana, 'POST', '/api/flows', { ...doc, projectId: shop });
  assert.equal(f.statusCode, 200, f.body);
  const other = await call(dana, 'POST', '/api/flows', { ...doc, projectId: hr });
  assert.equal(other.statusCode, 403);
  assert.match(other.json().error, /Design permission on project HR/);
  assert.equal((await call(dana, 'POST', `/api/flows/${f.json().id}/test`, {})).statusCode, 200);
  assert.match((await call(dana, 'POST', `/api/flows/${f.json().id}/deploy`, {})).json().error, /Deploy permission/);
  assert.equal((await call(dana, 'GET', '/api/access/users')).statusCode, 403);
  assert.equal((await call(dana, 'PUT', '/api/secrets/X', { value: 'v' })).statusCode, 403);
  assert.equal((await call(dana, 'POST', '/api/projects', { name: 'Mine' })).statusCode, 403, 'a new project needs Design on all projects');

  const me = (await call(dana, 'GET', '/api/access/me')).json();
  assert.deepEqual(me.permissions.all, []);
  assert.deepEqual(me.permissions.projects[shop].sort(), ['connections', 'design', 'operate', 'view']);
});

test('custom roles: permissions checked; built-in roles cannot change; a role in use cannot go', async () => {
  assert.equal((await call(admin, 'POST', '/api/access/roles', { name: 'Odd', perms: ['fly'] })).statusCode, 400);
  assert.equal((await call(admin, 'PUT', '/api/access/roles/viewer', { name: 'Viewer', perms: ['view', 'deploy'] })).statusCode, 400);
  const r = (await call(admin, 'POST', '/api/access/roles', { name: 'Release manager', description: 'Deploys and approves', perms: ['view', 'deploy', 'approve'] })).json();
  assert.deepEqual(r.perms, ['view', 'deploy', 'approve']);
  const u = await call(admin, 'POST', '/api/access/users', { username: 'rel', password: 'Harbor-light-42', mustChange: false, grants: [{ role: r.id, project: shop }] });
  assert.equal(u.statusCode, 200);
  assert.equal((await call(admin, 'DELETE', `/api/access/roles/${r.id}`)).statusCode, 400);
  const s = await signIn('rel', 'Harbor-light-42');
  const f = flows.listFlows(shop)[0];
  assert.equal((await call({ cookie: s.cookie }, 'POST', `/api/flows/${f.id}/deploy`, {})).statusCode, 200);
  assert.equal((await call({ cookie: s.cookie }, 'PUT', `/api/flows/${f.id}`, flows.getFlow(f.id)!.doc)).statusCode, 403, 'cannot design');
});

test('lockout after repeated wrong passwords, unlock, disable ends sessions, sign out everywhere', async () => {
  await call(admin, 'POST', '/api/access/users', { username: 'lee', password: 'Maple-leaf-301', mustChange: false, grants: [{ role: 'viewer', project: '' }] });
  const good = await signIn('lee', 'Maple-leaf-301');
  assert.equal(good.status, 200);
  const lee: Who = { cookie: good.cookie };
  assert.equal((await call(lee, 'GET', '/api/projects')).json().length, 2, 'viewer on all projects');
  for (let i = 0; i < access.LOCK_AFTER - 1; i++) assert.equal((await signIn('lee', 'nope-nope-nope')).status, 401);
  assert.equal((await signIn('lee', 'nope-nope-nope')).status, 423);
  assert.equal((await signIn('lee', 'Maple-leaf-301')).status, 423, 'locked even with the right password');
  assert.equal((await call(admin, 'GET', '/api/access/users/lee')).json().locked, true);
  await call(admin, 'POST', '/api/access/users/lee/unlock');
  assert.equal((await signIn('lee', 'Maple-leaf-301')).status, 200);

  assert.equal((await call(lee, 'GET', '/api/projects')).statusCode, 200);
  await call(admin, 'POST', '/api/access/users/lee/sign-out');
  assert.equal((await call(lee, 'GET', '/api/projects')).statusCode, 401, 'sign out everywhere ends the session');
  const again = await signIn('lee', 'Maple-leaf-301');
  await new Promise(r => setTimeout(r, 5));
  await call(admin, 'PUT', '/api/access/users/lee', { disabled: true });
  assert.equal((await call({ cookie: again.cookie }, 'GET', '/api/projects')).statusCode, 401, 'disabled ends the session');
  assert.equal((await signIn('lee', 'Maple-leaf-301')).status, 403);
});

test('at least one administrator remains; nobody disables or deletes themselves', async () => {
  assert.match((await call(admin, 'PUT', '/api/access/users/root', { disabled: true })).json().error, /own account/);
  assert.match((await call(admin, 'DELETE', '/api/access/users/root')).json().error, /own account/);
  assert.match((await call(admin, 'PUT', '/api/access/users/root', { grants: [{ role: 'viewer', project: '' }] })).json().error, /administrator must remain/);
  assert.equal((await call(admin, 'GET', '/api/access/me')).json().permissions.all.includes('users'), true, 'unchanged');
});

test('system accounts: tokens for the API (scoped, expiring, revocable), no studio sign-in', async () => {
  const sa = await call(admin, 'POST', '/api/access/users', { username: 'ci-shop', kind: 'system', displayName: 'CI for Shop', grants: [{ role: 'deployer', project: shop }] });
  assert.equal(sa.statusCode, 200, sa.body);
  assert.equal(sa.json().kind, 'system');
  assert.equal((await call(admin, 'POST', '/api/access/users/dana/tokens', { name: 'x' })).statusCode, 400, 'tokens are for system accounts');
  const t = (await call(admin, 'POST', '/api/access/users/ci-shop/tokens', { name: 'pipeline' })).json();
  assert.match(t.token, /^sut_[0-9a-f]{12}_/);
  const ci: Who = { token: t.token };
  assert.deepEqual((await call(ci, 'GET', '/api/projects')).json().map((p: any) => p.name), ['Shop']);
  const pkg = (await call(ci, 'GET', `/api/projects/${shop}/package?version=1.0.0`)).json();
  assert.equal((await call(ci, 'POST', '/api/packages/deploy', { package: pkg })).statusCode, 200, 'deployer may deploy Shop');
  const toHr = await call(ci, 'POST', '/api/packages/deploy', { package: pkg, project: 'HR' });
  assert.equal(toHr.statusCode, 403);
  assert.equal((await call(ci, 'POST', '/api/packages/deploy', { package: pkg, project: 'Brand new' })).statusCode, 403, 'a new project needs Deploy on all projects');
  const list = (await call(admin, 'GET', '/api/access/users/ci-shop/tokens')).json();
  assert.equal(list.length, 1);
  assert.ok(list[0].lastUsed);
  assert.ok(!JSON.stringify(list).includes(t.token), 'token values are not listed');
  await call(admin, 'DELETE', `/api/access/users/ci-shop/tokens/${t.id}`);
  assert.equal((await call(ci, 'GET', '/api/projects')).statusCode, 401, 'revoked');
  assert.equal((await call({ token: t.token.slice(0, -2) + 'xx' }, 'GET', '/api/projects')).statusCode, 401);

  await call(admin, 'POST', '/api/access/users/ci-shop/password', { password: 'system-pass-123' });
  assert.equal((await signIn('ci-shop', 'system-pass-123')).status, 403, 'system accounts do not sign in to the studio');
});

test('gateway Basic sign-in with system accounts: needs Call services on the policy\'s project', async () => {
  await call(admin, 'POST', '/api/access/users', { username: 'partner', kind: 'system', password: 'Copper-gate-77', grants: [{ role: 'apiCaller', project: shop }] });
  await call(admin, 'POST', '/api/access/users', { username: 'stranger', kind: 'system', password: 'Silver-gate-77', grants: [{ role: 'apiCaller', project: hr }] });
  const pol = saveResource({ kind: 'inboundPolicy', name: 'Partners', project_id: shop, config: { auth: 'basic', basicAccounts: 'system accounts', requireHttps: false, rateLimitPerMinute: 0 } });
  const t = node('restService', 'Stock API', { method: 'GET', path: '/stock', policy: pol.id });
  const r = node('httpResponse', 'Reply', { status: '200', contentType: 'application/json', body: '{"who":"{{input.auth.subject}}"}' });
  const f = flows.saveFlow(undefined, { name: 'Stock', nodes: [t, r], edges: [edge(t, r)] }, shop);
  flows.deploy(f.id);
  const get = (u: string, p: string) => fetch(`${env.http}/stock`, { headers: { authorization: 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64') } });
  const ok = await get('partner', 'Copper-gate-77');
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { who: 'partner' });
  assert.equal((await get('partner', 'wrong-pass-000')).status, 401);
  assert.equal((await get('stranger', 'Silver-gate-77')).status, 401, 'Call services on another project only');
  assert.equal((await get('dana', 'River-stone-88')).status, 401, 'people are not system accounts');
  await call(admin, 'PUT', '/api/access/users/partner', { disabled: true });
  assert.equal((await get('partner', 'Copper-gate-77')).status, 401, 'disabled');
});

test('audit log: changes, sign-ins and refusals; filters; CSV; never passwords or secret values', async () => {
  await call(admin, 'PUT', '/api/secrets/AUDIT_ME', { value: 'very-secret-value-xyz' });
  const all = (await call(admin, 'GET', '/api/audit?limit=1000')).json();
  const text = JSON.stringify(all);
  assert.ok(!text.includes('very-secret-value-xyz'), 'no secret values');
  assert.ok(!text.includes('River-stone-88') && !text.includes('temporary-pass-9'), 'no passwords');
  assert.ok(all.some((e: any) => e.action === 'POST /api/access/users' && e.actor === 'root' && e.details?.username === 'dana' && e.outcome === 'ok'));
  assert.ok(all.some((e: any) => e.action === 'Sign in' && e.actor === 'lee' && e.outcome === 'failed'));
  assert.ok(all.some((e: any) => e.action === 'POST /api/flows' && e.actor === 'dana' && e.outcome === 'denied' && e.projectId === hr));
  assert.ok(all.some((e: any) => e.action === 'POST /api/packages/deploy' && e.actor === 'ci-shop' && e.actorKind === 'system' && e.details?.package?.version === '1.0.0'));
  assert.ok(!all.some((e: any) => e.action === 'POST /api/expr/eval'), 'previews are not audited');
  const dana = (await call(admin, 'GET', '/api/audit?actor=dana')).json();
  assert.ok(dana.length >= 3 && dana.every((e: any) => e.actor === 'dana'));
  const denied = (await call(admin, 'GET', '/api/audit?outcome=denied')).json();
  assert.ok(denied.length >= 3 && denied.every((e: any) => e.outcome === 'denied'));
  const csv = await call(admin, 'GET', '/api/audit/export?actor=dana');
  assert.match(String(csv.headers['content-type']), /text\/csv/);
  assert.match(csv.body.split('\n')[0], /^at,environment,engine,actor,actorKind,ip,action,origin,projectName,projectId,sutraName,sutraId,target,status,outcome,details$/);
  const s = await signIn('rel', 'Harbor-light-42');
  assert.equal((await call({ cookie: s.cookie }, 'GET', '/api/audit')).statusCode, 403, 'the audit log needs the Audit permission');
});
