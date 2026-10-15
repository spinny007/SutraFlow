import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { testEnv, node, edge, port } from './helpers.js';
import { root } from './proc.js';

const env = testEnv(19790);
process.env.SUTRA_ADMIN_TOKEN = 'gateway-admin-token-0123456789';
const { boot } = await import('../server/src/index.js');
const flows = await import('../server/src/flows.js');
const projects = await import('../server/src/projects.js');
const { saveResource } = await import('../server/src/resources.js');
const { q } = await import('../server/src/db.js');
const { housekeeping } = await import('../server/src/housekeeping.js');

let srv: Awaited<ReturnType<typeof boot>>;
before(async () => { srv = await boot({ listenAdmin: false }); await srv.admin.listen({ host: '127.0.0.1', port: port(19799) }); });
after(async () => { await srv.stop(); });

const H = { authorization: `Bearer ${process.env.SUTRA_ADMIN_TOKEN}` };
const api = (method: string, url: string, payload?: any, headers: Record<string, string> = H) => srv.admin.inject({ method: method as any, url, payload, headers });
let appId = '', otherId = '', key = '', otherKey = '', shop = '';

test('plans, apps and keys: keys shown once and stored as hashes; wrong input refused', async () => {
  const plan = (await api('POST', '/api/gateway/plans', { name: 'Bronze', perMinute: 3, perDay: 1000 })).json();
  assert.equal(plan.perMinute, 3);
  assert.match((await api('POST', '/api/gateway/plans', { name: 'Bad', perMinute: -1 })).json().error, /whole number/);
  const app = (await api('POST', '/api/gateway/apps', { name: 'Partner shop', contact: 'ops@partner.test', scopes: ['orders:read'], planId: plan.id })).json();
  appId = app.id;
  assert.deepEqual(app.scopes, ['orders:read']);
  assert.match((await api('POST', '/api/gateway/apps', { name: 'Odd', scopes: ['has space'] })).json().error, /Scopes are words/);
  assert.match((await api('POST', '/api/gateway/apps', { name: 'partner SHOP' })).json().error, /exists/);
  const k = (await api('POST', `/api/gateway/apps/${appId}/keys`, { name: 'production', expiresDays: 90 })).json();
  key = k.key;
  assert.match(key, /^sfk_[0-9a-f]{12}_/);
  const list = (await api('GET', `/api/gateway/apps/${appId}/keys`)).json();
  assert.equal(list.length, 1);
  assert.ok(!JSON.stringify(list).includes(key), 'key values are never listed');
  assert.ok(!JSON.stringify(q.all('select * from gw_keys')).includes(key), 'only the hash is stored');
  otherId = (await api('POST', '/api/gateway/apps', { name: 'Reporting', scopes: ['reports:read'] })).json().id;
  otherKey = (await api('POST', `/api/gateway/apps/${otherId}/keys`, { name: 'k' })).json().key;
  assert.match((await api('DELETE', `/api/gateway/plans/${plan.id}`)).json().error, /Apps still use this plan/);
});

test('a service for gateway apps: key or token, scopes, plan limit with rate headers and 429', async () => {
  shop = projects.saveProject({ name: 'Partner API', config: { variables: [] } }).id;
  const pol = saveResource({ kind: 'inboundPolicy', name: 'Partners', project_id: shop, config: { auth: 'apps', appScopes: 'orders:read', requireHttps: false, rateLimitPerMinute: 0 } });
  const t = node('restService', 'Orders', { method: 'GET', path: '/gw/orders/:id', policy: pol.id });
  const r = node('httpResponse', 'Reply', { status: '200', contentType: 'application/json', body: '{"id":"{{input.params.id}}","app":"{{input.auth.subject}}"}' });
  flows.deploy(flows.saveFlow(undefined, { name: 'Partner orders', nodes: [t, r], edges: [edge(t, r)] }, shop).id);
  const get = (headers: Record<string, string> = {}) => fetch(`${env.http}/gw/orders/A-7`, { headers });

  assert.equal((await get()).status, 401);
  assert.equal((await get({ 'x-api-key': 'sfk_000000000000_nope' })).status, 401);
  assert.equal((await get({ 'x-api-key': otherKey })).status, 403, 'the other app lacks orders:read');
  const ok = await get({ 'x-api-key': key });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { id: 'A-7', app: 'Partner shop' });
  assert.equal(ok.headers.get('x-ratelimit-limit'), '3');
  assert.equal(ok.headers.get('x-ratelimit-remaining'), '2');
  assert.equal(ok.headers.get('x-ratelimit-window'), 'minute');
  assert.equal((await get({ authorization: `Bearer ${key}` })).status, 200, 'the key also works as a bearer token');
  assert.equal((await get({ 'x-api-key': key })).status, 200);
  const limited = await get({ 'x-api-key': key });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) >= 1);
  assert.match((await limited.json()).error, /allows 3 requests per minute/);
  const usage = (await api('GET', '/api/gateway/apps')).json().find((a: any) => a.id === appId).usage;
  assert.equal(usage.minute, 3);
  assert.equal(usage.day, 3, 'refused requests are not counted');
});

test('OAuth2 client credentials: token for the app scopes; wrong secret, foreign scope and disabled app refused', async () => {
  await api('PUT', `/api/gateway/apps/${appId}`, { name: 'Partner shop', scopes: ['orders:read'], planId: '' });
  const token = async (body: Record<string, string>, headers: Record<string, string> = {}) =>
    fetch(`${env.http}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(body).toString() });
  let r = await token({ grant_type: 'client_credentials', client_id: appId, client_secret: key });
  assert.equal(r.status, 200);
  const t = await r.json();
  assert.equal(t.token_type, 'Bearer');
  assert.equal(t.scope, 'orders:read');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const call = await fetch(`${env.http}/gw/orders/B-1`, { headers: { authorization: `Bearer ${t.access_token}` } });
  assert.equal(call.status, 200, 'no plan now: no limit');
  r = await token({ grant_type: 'client_credentials' }, { authorization: 'Basic ' + Buffer.from(`${appId}:${key}`).toString('base64') });
  assert.equal(r.status, 200, 'client credentials in Basic');
  assert.equal((await token({ grant_type: 'client_credentials', client_id: appId, client_secret: otherKey })).status, 401);
  r = await token({ grant_type: 'client_credentials', client_id: appId, client_secret: key, scope: 'reports:read' });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, 'invalid_scope');
  assert.equal((await token({ grant_type: 'password' })).status, 400);
  await api('PUT', `/api/gateway/apps/${appId}`, { name: 'Partner shop', scopes: ['orders:read'], disabled: true });
  assert.equal((await fetch(`${env.http}/gw/orders/B-1`, { headers: { authorization: `Bearer ${t.access_token}` } })).status, 401, 'tokens of a disabled app stop working');
  assert.equal((await fetch(`${env.http}/gw/orders/B-1`, { headers: { 'x-api-key': key } })).status, 401);
  await api('PUT', `/api/gateway/apps/${appId}`, { name: 'Partner shop', scopes: ['orders:read'], disabled: false });
  const keyId = (await api('GET', `/api/gateway/apps/${appId}/keys`)).json()[0].id;
  await api('DELETE', `/api/gateway/apps/${appId}/keys/${keyId}`);
  assert.equal((await fetch(`${env.http}/gw/orders/B-1`, { headers: { 'x-api-key': key } })).status, 401, 'revoked key');
});

test('firewall: deny wins, an allow list admits only its addresses, wrong rules refused', async () => {
  assert.match((await api('PUT', '/api/gateway/firewall', { deny: ['not-an-ip'] })).json().error, /Not an IP address/);
  assert.equal((await api('PUT', '/api/gateway/firewall', { deny: ['127.0.0.1'] })).statusCode, 200);
  const r = await fetch(`${env.http}/gw/orders/A-1`);
  assert.equal(r.status, 403);
  assert.match((await r.json()).error, /address is not allowed/);
  await api('PUT', '/api/gateway/firewall', { allow: ['10.0.0.0/8'], deny: [] });
  assert.equal((await fetch(`${env.http}/gw/orders/A-1`)).status, 403, 'not on the allow list');
  await api('PUT', '/api/gateway/firewall', { allow: ['127.0.0.0/8'], deny: [] });
  assert.equal((await fetch(`${env.http}/gw/orders/A-1`)).status, 401, 'allowed through the firewall; the policy still asks for a key');
  await api('PUT', '/api/gateway/firewall', { allow: [], deny: [] });
});

test('request log and statistics: services, apps, statuses, latency; filtered; old entries deleted', async () => {
  const log = (await api('GET', '/api/gateway/requests?limit=200')).json();
  assert.ok(log.some((e: any) => e.route === 'Partner orders' && e.app === 'Partner shop' && e.status === 200 && e.caller === 'Partner shop' && e.runId));
  assert.ok(log.some((e: any) => e.status === 429 && /allows 3 requests/.test(e.error)));
  assert.ok(log.some((e: any) => e.status === 403 && e.error === 'Firewall'));
  assert.ok(log.some((e: any) => e.route === 'Access tokens' && e.status === 200));
  const refused = (await api('GET', '/api/gateway/requests?status=refused')).json();
  assert.ok(refused.length && refused.every((e: any) => e.status >= 400 && e.status < 500));
  const s = (await api('GET', '/api/gateway/stats?period=1h')).json();
  assert.ok(s.totals.requests >= 15);
  assert.ok(s.totals.p95Ms >= s.totals.p50Ms);
  assert.ok(s.timeline.length === 60 || s.timeline.length === 61, 'one bucket per minute');
  assert.equal(s.timeline.reduce((a: number, b: any) => a + b.requests, 0), s.totals.requests);
  assert.equal(s.topServices[0].name, 'Partner orders');
  assert.ok(s.topApps.some((a: any) => a.name === 'Partner shop'));
  assert.ok(s.byStatus['4xx'] > 0 && s.byStatus['2xx'] > 0);
  // Housekeeping keeps the log for its number of days.
  housekeeping({ now: Date.now() + 15 * 86400000 });
  assert.equal((await api('GET', '/api/gateway/requests')).json().length, 0);
});

test('OpenAPI for deployed services with their security; published on the gateway only when chosen; Gateway permission', async () => {
  const doc = (await api('GET', '/api/gateway/openapi')).json();
  const op = doc.paths['/gw/orders/{id}'].get;
  assert.equal(op.summary, 'Partner orders');
  assert.deepEqual(op.parameters[0], { name: 'id', in: 'path', required: true, schema: { type: 'string' } });
  assert.deepEqual(op.security, [{ appKey: [] }, { appToken: ['orders:read'] }]);
  assert.match(doc.components.securitySchemes.appToken.flows.clientCredentials.tokenUrl, /\/oauth\/token$/);
  assert.equal((await fetch(`${env.http}/openapi.json`)).status, 404);
  await api('PUT', '/api/gateway/options', { publishOpenApi: true });
  const pub = await fetch(`${env.http}/openapi.json`);
  assert.equal(pub.status, 200);
  assert.ok((await pub.json()).paths['/gw/orders/{id}']);
  assert.match((await api('PUT', '/api/gateway/options', { logDays: -1 })).json().error, /0 to 3650/);
  const apis = (await api('GET', '/api/gateway/apis')).json();
  assert.ok(apis.routes.some((r: any) => r.path === '/gw/orders/:id' && r.policy === 'Partners'));

  await api('POST', '/api/access/users', { username: 'vee', password: 'Viewer-pass-91', mustChange: false, grants: [{ role: 'viewer', project: '' }] });
  await api('POST', '/api/access/users', { username: 'opal', password: 'Operator-pass-91', mustChange: false, grants: [{ role: 'operator', project: '' }] });
  const sign = async (u: string, p: string) => String((await srv.admin.inject({ method: 'POST', url: '/api/auth/login', payload: { username: u, password: p }, headers: { 'x-sutra': '1' } })).headers['set-cookie']).split(';')[0];
  assert.equal((await api('GET', '/api/gateway/apps', undefined, { cookie: await sign('vee', 'Viewer-pass-91') })).statusCode, 403);
  assert.equal((await api('GET', '/api/gateway/apps', undefined, { cookie: await sign('opal', 'Operator-pass-91') })).statusCode, 200, 'operators manage the gateway');
});

const cli = (...args: string[]) => new Promise<{ status: number | null; out: string; err: string }>(res => {
  const c = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', 'tsx', path.join(root, 'server/src/cli.ts'), ...args, '--server', `http://127.0.0.1:${port(19799)}`], { cwd: root, env: process.env });
  let out = '', err = '';
  c.stdout.on('data', d => (out += d)); c.stderr.on('data', d => (err += d));
  c.on('close', status => res({ status, out, err }));
});

test('the gateway from the sutra command: plans, apps, keys, firewall, statistics, OpenAPI', async () => {
  let r = await cli('gateway', 'plan', 'set', 'Silver', '--per-minute', '60', '--per-day', '5000');
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /Plan Silver: 60\/min, -\/hour, 5000\/day/);
  r = await cli('gateway', 'app', 'add', 'Mobile', '--scopes', 'orders:read orders:write', '--plan', 'Silver');
  assert.equal(r.status, 0, r.err);
  r = await cli('gateway', 'key', 'create', 'Mobile', '--name', 'ios', '--expires-days', '30');
  assert.equal(r.status, 0, r.err);
  const k = r.out.trim();
  assert.match(k, /^sfk_/);
  assert.match(r.err, /not shown again/);
  assert.equal((await fetch(`${env.http}/gw/orders/C-3`, { headers: { 'x-api-key': k } })).status, 200);
  r = await cli('gateway', 'apps');
  assert.match(r.out, /Mobile\s+active\s+Silver\s+orders:read orders:write\s+1\s+1/);
  r = await cli('gateway', 'firewall', '--deny', '203.0.113.9');
  assert.match(r.out, /Deny:\s+203.0.113.9/);
  r = await cli('gateway', 'firewall', '--deny', '');
  assert.match(r.out, /Deny:\s+none/, 'an empty value clears the list');
  r = await cli('gateway', 'stats', '--period', '1h');
  assert.match(r.out, /Partner orders/);
  r = await cli('gateway', 'openapi');
  assert.ok(JSON.parse(r.out).paths['/gw/orders/{id}']);
  assert.equal((await cli('gateway', 'app', 'disable', 'Nope')).status, 1);
});
