import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { testEnv, node, edge, port } from './helpers.js';

/**
 * Production releases: a release zip (package, deployment config to fill in, README), built in the
 * designer, by `sutra package --zip`, or from Git with `sutra package --from-git`, and deployed with
 * `sutra deploy release.zip` or the Admin Console. A production server refuses designer deploys.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = testEnv(20100);
process.env.SUTRA_ADMIN_TOKEN = 'releases-admin-token-0123456789';
const { boot } = await import('../server/src/index.js');
const { config } = await import('../server/src/config.js');
const { unzip } = await import('../server/src/ai/documents.js');
const { buildBundle, readBundle, configTemplate, configFor } = await import('../server/src/bundles.js');
const { buildPackage } = await import('../server/src/packages.js');
const projects = await import('../server/src/projects.js');
const flows = await import('../server/src/flows.js');
const { saveResource } = await import('../server/src/resources.js');
const { setSecret } = await import('../server/src/secrets.js');
const { projectFiles } = await import('../server/src/git/files.js');
const { engines, gitEngine } = await import('../server/src/git/engine.js');

let srv: Awaited<ReturnType<typeof boot>>;
const ADMIN = `http://127.0.0.1:${port(20109)}`;
const H = { authorization: `Bearer ${process.env.SUTRA_ADMIN_TOKEN}` };
const call = (method: string, url: string, payload?: any) => srv.admin.inject({ method: method as any, url, payload, headers: H });
let pid = '';
let flowId = '';

before(async () => {
  srv = await boot({ listenAdmin: false });
  await srv.admin.listen({ host: '127.0.0.1', port: port(20109) });
  pid = projects.saveProject({ name: 'Orders', description: 'Order services', config: { variables: [{ name: 'REGION', type: 'string', value: 'dev-1' }, { name: 'DB_PASS', type: 'secret', value: 'ORDERS_DB' }] } }).id;
  setSecret('ORDERS_DB', 'dev-secret-value');
  saveResource({ kind: 'httpConnection', name: 'Shop API', project_id: pid, config: { baseUrl: 'http://dev-shop.local', timeoutMs: 5000 } });
  const s = node('restService', 'GET /status', { method: 'GET', path: '/rel-status' });
  const rp = node('httpResponse', 'Reply', { status: '200', contentType: 'application/json', body: '{"region": "{{gv.REGION}}"}' });
  flowId = flows.saveFlow(undefined, { name: 'Status', nodes: [s, rp], edges: [edge(s, rp)] }, pid).id;
  flows.deploy(flowId);
});
after(async () => { config.environment = 'development'; await srv.stop(); });

const cli = (...args: string[]) => new Promise<{ status: number | null; out: string; err: string }>(res => {
  const c = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', 'tsx', path.join(root, 'server/src/cli.ts'), ...args], { cwd: root, env: process.env });
  let out = '', err = '';
  c.stdout.on('data', d => (out += d)); c.stderr.on('data', d => (err += d));
  c.on('close', status => res({ status, out, err }));
});

test('a release zip holds the package, a deployment config to fill in and a README', () => {
  const p = buildPackage(pid, { version: '1.2.0', note: 'Status service' });
  const z = unzip(buildBundle(p));
  assert.deepEqual([...z.keys()], ['package.sutra', 'deployment-config.json', 'README.txt', 'documentation.html', 'documentation.md']);
  assert.match(z.get('documentation.md')!.toString(), /## Status[\s\S]*REST service: GET \/status/);
  const cfg = JSON.parse(z.get('deployment-config.json')!.toString());
  assert.equal(cfg.project, 'Orders');
  assert.deepEqual(cfg.secrets, ['ORDERS_DB']);
  assert.deepEqual(cfg.variables, { REGION: 'dev-1', DB_PASS: 'ORDERS_DB' });
  assert.equal(cfg.resources['Shop API'].baseUrl, 'http://dev-shop.local');
  assert.equal(cfg.resources['Shop API'].kind, 'httpConnection');
  const readme = z.get('README.txt')!.toString();
  assert.match(readme, /Orders 1\.2\.0/);
  assert.match(readme, /ORDERS_DB/);
  assert.match(readme, /sutra deploy release\.zip/);
  const back = readBundle(buildBundle(p));
  assert.equal(back.package.checksum, p.checksum);
  assert.deepEqual(back.config, cfg);
  assert.equal(readBundle(JSON.stringify(p)).config, undefined, 'a package file has no config');
  assert.deepEqual(configTemplate(p).variables, cfg.variables);
});

test('a config written for the package project fits the project it is deployed under', () => {
  const p = buildPackage(pid, { version: '1.2.0' });
  const c = configFor(p, configTemplate(p), 'Orders (production)');
  assert.equal(c.project, 'Orders (production)');
  assert.equal(c.secrets, undefined, 'the secrets list is for people');
  assert.equal(configFor(p, { project: 'Billing' }, 'Orders (production)').project, 'Billing', 'a config for another project is left to fail');
});

test('the designer downloads a release zip; an uploaded zip opens with its check and config', async () => {
  const r = await call('GET', `/api/projects/${pid}/release?version=1.3.0`);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.headers['content-type'], 'application/zip');
  assert.match(String(r.headers['content-disposition']), /Orders-1\.3\.0\.zip/);
  const zip = r.rawPayload;
  const o = (await call('POST', '/api/packages/open', { zip: zip.toString('base64'), project: 'Orders' })).json();
  assert.equal(o.package.version, '1.3.0');
  assert.equal(o.config.project, 'Orders');
  assert.equal(o.check.ok, true, JSON.stringify(o.check));
  assert.deepEqual(o.check.secrets, [{ name: 'ORDERS_DB', present: true }]);
  const bad = await call('POST', '/api/packages/open', { zip: Buffer.from('not a zip').toString('base64') });
  assert.equal(bad.statusCode, 400);
});

test('sutra deploy release.zip applies the zip\'s deployment config; --config replaces it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-rel-'));
  const zip = path.join(dir, 'orders.zip');
  let r = await cli('package', '--project', 'Orders', '--version', '2.0.0', '--zip', '--out', zip, '--server', ADMIN);
  assert.equal(r.status, 0, r.err + r.out);
  assert.match(r.out, /Wrote .*orders\.zip: Orders 2\.0\.0, 1 Sutras, 1 secrets needed/);
  // The production team fills in the config inside the zip.
  const z = unzip(fs.readFileSync(zip));
  const cfg = JSON.parse(z.get('deployment-config.json')!.toString());
  cfg.variables.REGION = 'eu-prod';
  cfg.resources['Shop API'].baseUrl = 'https://shop.example.test';
  const { zipFiles } = await import('../server/src/bundles.js');
  fs.writeFileSync(zip, zipFiles([['package.sutra', z.get('package.sutra')!], ['deployment-config.json', JSON.stringify(cfg)], ['README.txt', z.get('README.txt')!]]));
  r = await cli('check', zip, '--project', 'Orders prod', '--server', ADMIN);
  assert.equal(r.status, 1, 'the address is served by Orders already');
  assert.match(r.out, /already served by "Status"/);
  flows.undeploy(flowId);
  r = await cli('deploy', zip, '--project', 'Orders prod', '--server', ADMIN);
  assert.equal(r.status, 0, r.err + r.out);
  assert.match(r.out, /Deployed Orders 2\.0\.0 to Orders prod \(new project\)/);
  const prod = projects.listProjects().find(p => p.name === 'Orders prod')!;
  const ops = projects.getOps(prod.id);
  assert.equal(ops.variables.REGION, 'eu-prod');
  assert.equal(ops.resources['Shop API'].baseUrl, 'https://shop.example.test');
  assert.equal((await fetch(`${env.http}/rel-status`)).status, 200);
  assert.equal((await (await fetch(`${env.http}/rel-status`)).json()).region, 'eu-prod');
  // --config replaces the zip's own.
  const other = path.join(dir, 'other.json');
  fs.writeFileSync(other, JSON.stringify({ project: 'Orders', variables: { REGION: 'us-prod' } }));
  r = await cli('deploy', zip, '--project', 'Orders prod', '--config', other, '--server', ADMIN);
  assert.equal(r.status, 0, r.err + r.out);
  assert.equal(projects.getOps(prod.id).variables.REGION, 'us-prod');
  const hist = (await call('GET', `/api/projects/${prod.id}/packages`)).json();
  assert.equal(hist.length, 2);
});

test('sutra package --from-git builds a release from the repository files, with no server', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-repo-'));
  for (const [rel, text] of projectFiles(pid, 'release-test')) { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), text); }
  const g = gitEngine();
  await g.init(repo, 'main');
  await g.commitAll(repo, 'First', { name: 'CI', email: 'ci@example.test' });
  const out = path.join(repo, '..', `from-git-${Date.now()}.zip`);
  const r = await cli('package', '--from-git', repo, '--version', '3.1.0', '--note', 'From CI', '--out', out);
  assert.equal(r.status, 0, r.err + r.out);
  assert.match(r.out, /Orders 3\.1\.0, 1 Sutras/);
  assert.match(r.out, /commit [0-9a-f]{12}/);
  const b = readBundle(fs.readFileSync(out));
  assert.equal(b.package.sutras[0].name, 'Status');
  assert.equal(b.package.sutras[0].deployed, true, 'every Sutra of the repository is deployed by the release');
  assert.deepEqual(b.package.manifest.sutras[0].exposes, ['GET /rel-status']);
  assert.equal(b.package.source?.commit, await g.head(repo));
  assert.equal(b.package.note, 'From CI');
  assert.equal(b.config.resources['Shop API'].baseUrl, 'http://dev-shop.local');
  assert.deepEqual(b.config.secrets, ['ORDERS_DB']);
  const bad = await cli('package', '--from-git', path.join(repo, 'sutras'));
  assert.equal(bad.status, 1);
  assert.match(bad.err + bad.out, /no sutraflow\.json/);
});

test('--ref builds the release from a tag, not from the newest commit', { skip: gitEngine() !== engines.system && 'needs the git command' }, async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-repo-'));
  for (const [rel, text] of projectFiles(pid, 'release-test-ref')) { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), text); }
  const g = engines.system;
  await g.init(repo, 'main');
  await g.commitAll(repo, 'v1', { name: 'CI', email: 'ci@example.test' });
  const tagged = await g.head(repo);
  spawn('git', ['-C', repo, 'tag', 'v1.0.0']);
  await new Promise(r => setTimeout(r, 500));
  const f = path.join(repo, 'sutraflow.json');
  fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), description: 'Newer' }, null, 2));
  await g.commitAll(repo, 'v2', { name: 'CI', email: 'ci@example.test' });
  const out = path.join(repo, '..', `ref-${Date.now()}.zip`);
  const r = await cli('package', '--from-git', repo, '--ref', 'v1.0.0', '--version', '1.0.0', '--out', out);
  assert.equal(r.status, 0, r.err + r.out);
  const b = readBundle(fs.readFileSync(out));
  assert.equal(b.package.source?.commit, tagged);
  assert.equal(b.package.source?.ref, 'v1.0.0');
  assert.equal(b.package.project.description, 'Order services');
});

test('a production server refuses deploys from the designer; packages still deploy', async () => {
  config.environment = 'production';
  try {
    const r = await call('POST', `/api/flows/${flowId}/deploy`, {});
    assert.equal(r.statusCode, 403);
    assert.match(r.json().error, /production server.*release packages/);
    const p = buildPackage(pid, { version: '9.0.0' });
    const d = await call('POST', '/api/packages/deploy', { package: p, project: 'Orders', keepOthers: true });
    assert.equal(d.statusCode, 200, d.body);
  } finally { config.environment = 'development'; }
});

test('a release zip\'s files/ reach the project files folder when deployed with sutra deploy', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-relf-'));
  const zip = path.join(dir, 'with-files.zip');
  const p = buildPackage(pid, { version: '4.0.0' });
  fs.writeFileSync(zip, buildBundle(p, undefined, [['files/templates/letter.txt', Buffer.from('Dear customer')], ['files/../escape.txt', Buffer.from('no')]]));
  const r = await cli('deploy', zip, '--project', 'Orders files', '--keep-others', '--server', ADMIN);
  assert.equal(r.status, 0, r.err + r.out);
  assert.match(r.out, /files {4}1 written to the project's files folder/);
  assert.equal(fs.readFileSync(path.join(projects.projectFilesDir('Orders files'), 'templates', 'letter.txt'), 'utf8'), 'Dear customer');
  assert.ok(!fs.existsSync(path.join(projects.projectFilesDir('Orders files'), '..', 'escape.txt')), 'paths never leave the folder');
});
