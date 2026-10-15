import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { testEnv, node, edge, port } from './helpers.js';

const env = testEnv(19010);
process.env.SUTRA_ADMIN_TOKEN = 'test-admin-token-0123456789';
const { boot } = await import('../server/src/index.js');
const { q } = await import('../server/src/db.js');
const projects = await import('../server/src/projects.js');
const flows = await import('../server/src/flows.js');
const { saveResource, listResources } = await import('../server/src/resources.js');
const { saveSchema, listSchemas } = await import('../server/src/schemas.js');
const { setSecret, deleteSecret } = await import('../server/src/secrets.js');
const pk = await import('../server/src/packages.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let srv: Awaited<ReturnType<typeof boot>>;
let shop = '';
before(async () => {
  srv = await boot({ listenAdmin: false });
  setSecret('SHOP_KEY', 'super-secret-value-123');
  shop = projects.saveProject({ name: 'Shop', config: { variables: [{ name: 'GREETING', type: 'string', value: 'hello' }, { name: 'DB_PW', type: 'secret', value: 'SHOP_KEY' }] } }).id;
  const schema = saveSchema({ project_id: shop, name: 'Order', kind: 'json', text: JSON.stringify({ orderId: 'A-1', amount: 10 }) });
  const pol = saveResource({ kind: 'inboundPolicy', name: 'Shop keys', project_id: shop, config: { auth: 'apiKey', apiKeyHeader: 'X-API-Key', apiKeySecrets: ['SHOP_KEY'], requireHttps: false, rateLimitPerMinute: 0 } });
  saveResource({ kind: 'mcpServer', name: 'Shop skills', project_id: shop, config: { path: '/mcp/shop', title: 'Shop', instructions: 'x', policy: pol.id } });

  const helper = flows.saveFlow(undefined, { name: 'Double', nodes: [node('start', 'Start', { payload: '{"amount": 2}' }), node('return', 'Return', { source: 'value', value: '={input.amount} * 2' })], edges: [] }, shop);
  const hd = flows.getFlow(helper.id)!.doc; hd.edges = [edge(hd.nodes[0], hd.nodes[1])]; flows.saveFlow(helper.id, hd);
  const t = node('restService', 'Order API', { method: 'GET', path: '/shop/orders/:id', policy: pol.id, maxBodyKb: 64, bodySchema: schema.id, testRequest: JSON.stringify({ method: 'GET', params: { id: 'A-1' }, query: {}, headers: {}, body: null }) });
  const c = node('callProcess', 'Double it', { process: helper.id, use: 'draft', wait: true, source: 'value', input: "=object('amount', 21)" });
  const r = node('httpResponse', 'Reply', { status: '200', contentType: 'application/json', bodySource: 'template', body: '{{input}}', headers: [] });
  const api = flows.saveFlow(undefined, { name: 'Order API', nodes: [t, c, r], edges: [edge(t, c), edge(c, r)] }, shop);
  flows.deploy(helper.id);
  flows.deploy(api.id);
  flows.saveFlow(undefined, { name: 'Draft only', nodes: [node('start', 'Start'), node('log', 'Log', { message: 'hi' })], edges: [] }, shop);
});
after(async () => { await srv.stop(); });

const shopFlow = (name: string, project = shop) => flows.listFlows(project).find(f => f.name === name)!;

test('a package carries every Sutra at its version, connections, schemas, variables; never secret values', () => {
  const p = pk.buildPackage(shop, { version: '1.0.0', note: 'first' });
  assert.equal(p.format, 'sutraflow-package');
  assert.match(p.checksum, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(p.sutras.map(s => [s.name, s.deployed]).sort(), [['Double', true], ['Draft only', false], ['Order API', true]]);
  assert.equal(p.schemas.length, 1);
  assert.deepEqual(p.resources.map(r => r.kind).sort(), ['inboundPolicy', 'mcpServer']);
  assert.deepEqual(p.manifest.secrets, ['SHOP_KEY']);
  assert.ok(p.manifest.sutras.find(s => s.name === 'Order API')!.exposes.includes('GET /shop/orders/:p'));
  assert.ok(!JSON.stringify(p).includes('super-secret-value-123'), 'secret values never leave the vault');
  assert.equal(pk.checksumOf(p), p.checksum);
  assert.throws(() => pk.buildPackage(shop, { version: 'v1' }), /not like 1.4.0/);
  assert.throws(() => pk.buildPackage(shop, { sutras: ['Nope'] }), /No Sutra named "Nope"/);
});

test('a changed or foreign file is refused', () => {
  const p = pk.buildPackage(shop, { version: '1.0.0' });
  const tampered = JSON.parse(JSON.stringify(p));
  tampered.sutras[0].doc.nodes[0].name = 'Evil';
  assert.throws(() => pk.readPackage(tampered), /checksum does not match/);
  assert.throws(() => pk.readPackage('{"hello": 1}'), /not a SutraFlow package/);
  assert.throws(() => pk.readPackage('not json'), /not JSON/);
  assert.throws(() => pk.readPackage({ ...p, formatVersion: 9 }), /newer than this SutraFlow/);
});

test('check: missing secrets, addresses used by another project, unknown activities', () => {
  const p = pk.buildPackage(shop, { version: '1.0.0' });
  let c = pk.checkPackage(p, { project: 'Shop' });
  assert.equal(c.ok, true, c.errors.join('; '));
  c = pk.checkPackage(p, { project: 'Shop Prod' });
  assert.ok(c.errors.some(e => /GET \/shop\/orders\/:p is already served by "Order API"/.test(e)), c.errors.join('; '));
  deleteSecret('SHOP_KEY');
  c = pk.checkPackage(p, { project: 'Shop' });
  assert.ok(c.errors.some(e => /Missing secrets on this server: SHOP_KEY/.test(e)));
  assert.deepEqual(c.secrets, [{ name: 'SHOP_KEY', present: false }]);
  setSecret('SHOP_KEY', 'super-secret-value-123');
  const odd = JSON.parse(JSON.stringify(p));
  odd.manifest.activityTypes.push('quantumTeleport');
  delete odd.checksum; odd.checksum = pk.checksumOf(odd);
  assert.ok(pk.checkPackage(odd).errors.some(e => /does not have the activities quantumTeleport/.test(e)));
  assert.throws(() => pk.deployPackage(odd), /cannot be deployed/);
});

test('deploy to another project: ids remapped, Sutras deployed, references work, history kept', async () => {
  const p = pk.buildPackage(shop, { version: '1.0.0' });
  flows.undeploy(shopFlow('Order API').id); // free the address for the copy
  const r = pk.deployPackage(p, { project: 'Shop Prod', ops: { variables: { GREETING: 'namaste' }, resources: {}, logging: {} } });
  assert.equal(r.project.created, true);
  assert.deepEqual(r.sutras.map(s => s.action), ['created', 'created', 'created']);
  const prod = r.project.id;
  assert.notEqual(prod, shop);
  const prodPolicy = listResources('inboundPolicy', prod)[0];
  const prodSchema = listSchemas(prod)[0];
  const api = flows.getFlow(shopFlow('Order API', prod).id)!;
  assert.ok(api.deployed, 'Order API is deployed');
  const trig = api.doc.nodes.find(n => n.type === 'restService')!;
  assert.equal(trig.config.policy, prodPolicy.id, 'policy reference remapped');
  assert.equal(trig.config.bodySchema, prodSchema.id, 'schema reference remapped');
  assert.equal(api.doc.nodes.find(n => n.type === 'callProcess')!.config.process, shopFlow('Double', prod).id, 'Call Sutra points at the copy');
  assert.equal(listResources('mcpServer', prod)[0].config.policy, prodPolicy.id, 'resource-to-resource reference remapped');
  assert.equal(flows.getFlow(shopFlow('Draft only', prod).id)!.deployed, null, 'not-deployed Sutras stay undeployed');
  assert.equal(projects.effectiveVariables(prod).values.GREETING, 'namaste', 'deployment config applied');

  // The deployed copy serves its API on the gateway, with the copied policy and secret.
  const res = await fetch(`${env.http}/shop/orders/A-9`, { headers: { 'x-api-key': 'super-secret-value-123' } });
  const body = await res.text();
  assert.equal(res.status, 200, body);
  assert.equal(body, '42', `reply: ${body} run ${res.headers.get('x-sutra-run')}`);
  assert.equal((await fetch(`${env.http}/shop/orders/A-9`)).status, 401);

  // Same package again: nothing changes, no new versions.
  const before = shopFlow('Order API', prod).version;
  const again = pk.deployPackage(p, { project: 'Shop Prod' });
  assert.equal(again.unchanged, true);
  assert.equal(shopFlow('Order API', prod).version, before);
  assert.equal(pk.packageHistory(prod).length, 2);
});

test('new version, pruning, keep-others and rollback', () => {
  const prod = projects.listProjects().find(p => p.name === 'Shop Prod')!.id;
  // 1.1.0: the helper changes; Order API is left out of the package.
  const helper = shopFlow('Double');
  const d = flows.getFlow(helper.id)!.doc;
  d.nodes.find(n => n.type === 'return')!.config.value = '={input.amount} * 3';
  flows.saveFlow(helper.id, d);
  flows.deploy(helper.id);
  const p2 = pk.buildPackage(shop, { version: '1.1.0', sutras: ['Double'] });
  const kept = pk.deployPackage(p2, { project: 'Shop Prod', keepOthers: true });
  assert.deepEqual(kept.undeployed, []);
  assert.equal(kept.sutras[0].action, 'updated');
  assert.ok(shopFlow('Order API', prod).deployed, 'kept with keepOthers');
  const pruned = pk.deployPackage(p2, { project: 'Shop Prod' });
  assert.deepEqual(pruned.undeployed, ['Order API']);
  assert.equal(shopFlow('Order API', prod).deployed, null);
  assert.ok(flows.getFlow(shopFlow('Order API', prod).id), 'undeployed, not deleted');

  const hist = pk.packageHistory(prod);
  assert.deepEqual(hist.map(h => h.version), ['1.1.0', '1.1.0', '1.0.0', '1.0.0']);
  const back = pk.rollbackPackage(prod, { by: 'test' });
  assert.equal(back.package.version, '1.0.0');
  assert.ok(shopFlow('Order API', prod).deployed, 'rollback redeployed Order API');
  const ret = flows.versionDoc(shopFlow('Double', prod).id, shopFlow('Double', prod).deployed!.version)!.nodes.find(n => n.type === 'return')!;
  assert.equal(ret.config.value, '={input.amount} * 2', 'rollback restored the 1.0.0 helper');
  assert.throws(() => pk.rollbackPackage(shop), /No package has been deployed/);
});

test('package tests run every Sutra with its test data', async () => {
  const p = pk.buildPackage(shop, { version: '1.2.0', sutras: ['Double', 'Draft only'] });
  const r = await pk.testPackage(p);
  assert.equal(r.ok, true, JSON.stringify(r.results));
  assert.equal(r.passed, 2);
  const broken = flows.saveFlow(undefined, { name: 'Broken', nodes: [node('start', 'Start'), node('throw', 'Boom', { message: 'no' })], edges: [] }, shop);
  const bd = flows.getFlow(broken.id)!.doc; bd.edges = [edge(bd.nodes[0], bd.nodes[1])]; flows.saveFlow(broken.id, bd);
  const p3 = pk.buildPackage(shop, { version: '1.3.0', sutras: ['Broken', 'Double'] });
  const r3 = await pk.testPackage(p3);
  assert.equal(r3.ok, false);
  assert.match(r3.results.find(x => x.name === 'Broken')!.error!, /Boom: no/);
  const skipped = await pk.testPackage(p3, { skip: ['Broken'] });
  assert.equal(skipped.ok, true);
  assert.equal(skipped.skipped, 1);
});

test('admin API: package download, check and deploy with the bearer token; sessions still need sign-in', async () => {
  const H = { authorization: `Bearer ${process.env.SUTRA_ADMIN_TOKEN}` };
  let r = await srv.admin.inject({ method: 'GET', url: `/api/projects/${shop}/package?version=2.0.0`, headers: H });
  assert.equal(r.statusCode, 200);
  assert.match(String(r.headers['content-disposition']), /Shop-2\.0\.0\.sutra/);
  const pkgJson = r.json();
  r = await srv.admin.inject({ method: 'POST', url: '/api/packages/check', headers: H, payload: { package: pkgJson, project: 'Shop' } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().ok, true);
  const prodId = projects.listProjects().find(p => p.name === 'Shop Prod')!.id;
  const prodPkg = (await srv.admin.inject({ method: 'GET', url: `/api/projects/${prodId}/package?version=2.0.0`, headers: H })).json();
  r = await srv.admin.inject({ method: 'POST', url: '/api/packages/deploy', headers: H, payload: { package: prodPkg, project: 'Shop API copy', keepOthers: true } });
  assert.equal(r.statusCode, 400, 'the address is in use by Shop Prod');
  assert.ok(r.json().check.errors.length);
  r = await srv.admin.inject({ method: 'GET', url: `/api/projects/${shop}/packages`, headers: { authorization: 'Bearer wrong-token-0123456789x' } });
  assert.equal(r.statusCode, 401);
  r = await srv.admin.inject({ method: 'POST', url: '/api/packages/check', payload: { package: pkgJson } });
  assert.equal(r.statusCode, 403, 'no token: the X-Sutra guard and sign-in still apply');
  r = await srv.admin.inject({ method: 'GET', url: '/health' });
  assert.equal(r.json().ok, true);
  r = await srv.admin.inject({ method: 'GET', url: '/ready' });
  assert.equal(r.statusCode, 200, JSON.stringify(r.json()));
});

test('command line: package, check, deploy, history, rollback, test, usage errors (local data folder)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-cli-'));
  const cli = (...args: string[]) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', 'tsx', path.join(root, 'server/src/cli.ts'), ...args],
    { cwd: root, env: { ...process.env, SUTRA_SERVER: '' }, encoding: 'utf8', timeout: 120000 });
  const f = (n: string) => path.join(dir, n);
  let r = cli('package', '--project', 'Shop', '--version', '3.0.0', '--sutras', 'Double,Draft only', '--out', f('shop.sutra'));
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /shop.sutra: Shop 3.0.0, 2 Sutras, 1 secrets needed/);
  r = cli('check', f('shop.sutra'), '--project', 'CLI Prod');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /secret\s+SHOP_KEY: present/);
  r = cli('deploy', f('shop.sutra'), '--project', 'CLI Prod');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Deployed Shop 3.0.0 to CLI Prod \(new project\)/);
  assert.match(r.stdout, /created\s+Double v1/);
  r = cli('history', '--project', 'CLI Prod');
  assert.match(r.stdout, /Shop 3.0.0/);
  r = cli('rollback', '--project', 'CLI Prod');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no earlier package/);
  r = cli('test', f('shop.sutra'));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /2 passed, 0 failed/);
  fs.writeFileSync(f('bad.sutra'), '{"format":"x"}');
  r = cli('check', f('bad.sutra'));
  assert.equal(r.status, 1);
  r = cli('deploy');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Usage: Give the package file/);
  r = cli('frobnicate');
  assert.equal(r.status, 2);
  r = cli('help');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /sutra <command>/);
  assert.ok(q.get('select 1 from projects where name = ?', 'CLI Prod'), 'the CLI wrote to the same data folder');
});

test('command line against a running server with the token', async () => {
  await srv.admin.listen({ host: '127.0.0.1', port: port(19019) });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-cli-'));
  const run = (...args: string[]) => new Promise<{ status: number | null; stdout: string; stderr: string }>(res => {
    import('node:child_process').then(({ spawn }) => {
      const c = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', 'tsx', path.join(root, 'server/src/cli.ts'), ...args, '--server', `http://127.0.0.1:${port(19019)}`], { cwd: root, env: process.env });
      let stdout = '', stderr = '';
      c.stdout.on('data', d => (stdout += d)); c.stderr.on('data', d => (stderr += d));
      c.on('close', status => res({ status, stdout, stderr }));
    });
  });
  let r = await run('package', '--project', 'Shop', '--version', '4.0.0', '--sutras', 'Double', '--out', path.join(dir, 'r.sutra'));
  assert.equal(r.status, 0, r.stderr);
  r = await run('deploy', path.join(dir, 'r.sutra'), '--project', 'Remote Prod');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /Deployed Shop 4.0.0 to Remote Prod/);
  r = await run('secret', 'set', 'REMOTE_ONE', '--value', 'v1');
  assert.equal(r.status, 0, r.stderr);
  const bad = await new Promise<number | null>(res => import('node:child_process').then(({ spawn }) => {
    const c = spawn(process.execPath, ['--import', 'tsx', path.join(root, 'server/src/cli.ts'), 'history', '--project', 'Shop', '--server', `http://127.0.0.1:${port(19019)}`, '--token', 'nope-nope-nope-nope-nope-x'], { cwd: root, env: process.env });
    c.on('close', res);
  }));
  assert.equal(bad, 1);
});

test('new project from chosen Sutras of a package: drafts by default (no address clash), name must be new, secrets only warn', async () => {
  const H = { authorization: `Bearer ${process.env.SUTRA_ADMIN_TOKEN}` };
  // Shop serves the Order API address (earlier tests moved it to other projects).
  for (const d of flows.deployedFlows()) if (d.projectId !== shop && d.doc.nodes.some((n: any) => n.type === 'restService' && n.config.path === '/shop/orders/:id')) flows.undeploy(d.flowId);
  flows.deploy(shopFlow('Order API').id);
  const p = pk.buildPackage(shop, { version: '7.0.0' });
  let r = await srv.admin.inject({ method: 'POST', url: '/api/projects/import', headers: H, payload: { package: p, project: 'Study', sutras: ['Order API', 'Double'] } });
  assert.equal(r.statusCode, 200, r.body);
  const study = projects.listProjects().find(x => x.name === 'Study')!.id;
  assert.deepEqual(flows.listFlows(study).map(f => [f.name, !!f.deployed]).sort(), [['Double', false], ['Order API', false]], 'only the chosen Sutras, as drafts');
  assert.equal(listResources(undefined, study).length, 2, 'connections come along');
  assert.equal(pk.packageHistory(study).length, 0, 'an import is not a package deployment');
  const api = flows.getFlow(shopFlow('Order API', study).id)!;
  const call = api.doc.nodes.find((n: any) => n.type === 'callProcess')!;
  assert.equal(call.config.process, shopFlow('Double', study).id, 'references point to the copies');
  assert.match((await srv.admin.inject({ method: 'POST', url: '/api/projects/import', headers: H, payload: { package: p, project: 'study' } })).json().error, /A project named "study" exists/);
  assert.match((await srv.admin.inject({ method: 'POST', url: '/api/projects/import', headers: H, payload: { package: p, project: 'Empty pick', sutras: ['Nope'] } })).json().error, /Choose at least one Sutra/);
  // Deployed as in the package: refused because the original serves the same address.
  r = await srv.admin.inject({ method: 'POST', url: '/api/projects/import', headers: H, payload: { package: p, project: 'Live copy', sutras: ['Order API'], asDrafts: false } });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /already served by/);
  // Secrets: as drafts they only warn.
  deleteSecret('SHOP_KEY');
  r = await srv.admin.inject({ method: 'POST', url: '/api/projects/import', headers: H, payload: { package: p, project: 'No secrets yet', sutras: ['Draft only'] } });
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(r.json().missingSecrets, ['SHOP_KEY']);
  setSecret('SHOP_KEY', 'super-secret-value-123');
});

test('copy chosen Sutras of a project into a new project, as drafts; the original keeps running', async () => {
  const H = { authorization: `Bearer ${process.env.SUTRA_ADMIN_TOKEN}` };
  const before = shopFlow('Order API').deployed;
  const r = await srv.admin.inject({ method: 'POST', url: `/api/projects/${shop}/copy`, headers: H, payload: { project: 'Shop sandbox', sutras: ['Order API', 'Double'] } });
  assert.equal(r.statusCode, 200, r.body);
  const sandbox = projects.listProjects().find(x => x.name === 'Shop sandbox')!.id;
  assert.deepEqual(flows.listFlows(sandbox).map(f => f.name).sort(), ['Double', 'Order API']);
  assert.ok(flows.listFlows(sandbox).every(f => !f.deployed));
  assert.deepEqual(shopFlow('Order API').deployed, before, 'the original is not changed');
  assert.equal(projects.getProject(sandbox)!.config.variables.find((v: any) => v.name === 'GREETING')?.value, 'hello', 'variables come along');
});
