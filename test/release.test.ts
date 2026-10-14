import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { testEnv, node, edge, port } from './helpers.js';

testEnv(19610);
process.env.SUTRA_ADMIN_TOKEN = 'release-token-0123456789abcdef';
const { boot } = await import('../server/src/index.js');
const { engine } = await import('../server/src/engine/engine.js');
const { q } = await import('../server/src/db.js');
const projects = await import('../server/src/projects.js');
const flows = await import('../server/src/flows.js');
const { setSecret } = await import('../server/src/secrets.js');
const pk = await import('../server/src/packages.js');

let srv: Awaited<ReturnType<typeof boot>>;
let shop = '', ops = '';
before(async () => {
  srv = await boot({ listenAdmin: false, gateway: false });
  await srv.admin.listen({ host: '127.0.0.1', port: port(19619) }); // plays the remote engine
  setSecret('PROD_TOKEN', 'release-token-0123456789abcdef');
  shop = projects.saveProject({ name: 'Shop', config: { variables: [{ name: 'TAX', type: 'string', value: '18' }] } }).id;
  const s = node('start', 'Start'), l = node('log', 'Hello', { message: 'tax {{gv.TAX}}' });
  const f = flows.saveFlow(undefined, { name: 'Hello', nodes: [s, l], edges: [edge(s, l)] }, shop);
  flows.deploy(f.id);
  ops = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-ops-')), 'prod.json');
  fs.writeFileSync(ops, JSON.stringify({ variables: { TAX: '5' }, resources: {}, logging: {} }));
});
after(async () => { await srv.stop(); });

async function run(nodes: any[], edges: any[]) {
  const pid = projects.listProjects().find(p => p.name === 'Release pipelines')?.id || projects.saveProject({ name: 'Release pipelines', config: { variables: [] } }).id;
  const id = engine.startRun({ doc: { name: 'Release', nodes, edges }, projectId: pid });
  await engine.waitFor(id, 30000);
  const r: any = q.get('select status, error, state from runs where id = ?', id);
  return { status: r.status, error: r.error, out: JSON.parse(r.state).outputs };
}

test('release activities are off until an administrator allows them', async () => {
  projects.setReleasesAllowed(false);
  const s = node('start', 'Start'), b = node('releasePackage', 'Build', { target: 'this server', project: 'Shop', version: '1.0.0' });
  const r = await run([s, b], [edge(s, b)]);
  assert.equal(r.status, 'failed');
  assert.match(r.error, /switched off on this server/);
});

test('a release Sutra: build, check, deploy with a deployment config, then roll back, on this server', async () => {
  projects.setReleasesAllowed(true);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-rel-'));
  const s = node('start', 'Start');
  const b = node('releasePackage', 'Build', { target: 'this server', project: 'Shop', version: '2.0.0', note: 'from a Sutra', saveTo: dir });
  const c = node('releaseCheck', 'Check', { packageFrom: 'previous step', package: '{{input.package}}', target: 'this server', project: 'Shop Copy' });
  const d = node('releaseDeploy', 'Deploy', { packageFrom: 'previous step', package: '{{input.package}}', target: 'this server', project: 'Shop Copy', opsFile: ops });
  const bad = node('log', 'Problems', { message: '{{input.errors}}' });
  let r = await run([s, b, c, d, bad], [edge(s, b), edge(b, c), edge(c, d, 'ok'), edge(c, bad, 'problems')]);
  assert.equal(r.status, 'done', r.error);
  assert.equal(r.out.Build.version, '2.0.0');
  assert.deepEqual(r.out.Build.sutras, ['Hello']);
  assert.ok(fs.existsSync(path.join(dir, 'Shop-2.0.0.sutra')), 'saved as a file');
  assert.equal(r.out.Check.ok, true);
  assert.equal(r.out.Deploy.project.name, 'Shop Copy');
  assert.equal(r.out.Deploy.sutras[0].action, 'created');
  const copy = projects.listProjects().find(p => p.name === 'Shop Copy')!.id;
  assert.equal(projects.effectiveVariables(copy).values.TAX, '5', 'the deployment config came with the deploy');
  assert.ok(flows.listFlows(copy).find(f => f.name === 'Hello')!.deployed);

  // A second release from the saved file, then roll back to the first.
  const s2 = node('start', 'Start'), b2 = node('releasePackage', 'Build', { target: 'this server', project: 'Shop', version: '2.1.0' });
  const d2 = node('releaseDeploy', 'Deploy', { packageFrom: 'previous step', package: '{{input.package}}', target: 'this server', project: 'Shop Copy' });
  r = await run([s2, b2, d2], [edge(s2, b2), edge(b2, d2)]);
  assert.equal(r.status, 'done', r.error);
  const rb = node('releaseRollback', 'Back', { target: 'this server', project: 'Shop Copy' });
  r = await run([s2, rb], [edge(s2, rb)]);
  assert.equal(r.status, 'done', r.error);
  assert.equal(r.out.Back.package.version, '2.0.0');
  const fromFile = node('releaseDeploy', 'From file', { packageFrom: 'file', file: path.join(dir, 'Shop-2.0.0.sutra'), target: 'this server', project: 'Shop Copy 2', keepOthers: true });
  r = await run([s2, fromFile], [edge(s2, fromFile)]);
  assert.equal(r.status, 'done', r.error);
  assert.equal(r.out['From file'].project.created, true);
});

test('remote engine: build there, check and deploy there with its token from the vault; refusals go to the error output', async () => {
  projects.setReleasesAllowed(true);
  const remote = { target: 'remote server', server: `http://127.0.0.1:${port(19619)}`, tokenSecret: 'PROD_TOKEN' };
  const s = node('start', 'Start');
  const b = node('releasePackage', 'Build', { ...remote, project: 'Shop', version: '3.0.0' });
  const c = node('releaseCheck', 'Check', { packageFrom: 'previous step', package: '{{input.package}}', ...remote, project: 'Shop Remote' });
  const d = node('releaseDeploy', 'Deploy', { packageFrom: 'previous step', package: '{{input.package}}', ...remote, project: 'Shop Remote' });
  let r = await run([s, b, c, d], [edge(s, b), edge(b, c), edge(c, d, 'ok')]);
  assert.equal(r.status, 'done', r.error);
  assert.equal(r.out.Deploy.project.name, 'Shop Remote');
  assert.equal(pk.packageHistory(projects.listProjects().find(p => p.name === 'Shop Remote')!.id)[0].deployed_by, 'token');

  setSecret('WRONG_TOKEN', 'nope-nope-nope-nope-nope-nope-x');
  const wrong = node('releasePackage', 'Build', { ...remote, tokenSecret: 'WRONG_TOKEN', project: 'Shop', version: '3.0.1' });
  const handled = node('log', 'Refused', { message: '{{input.error.message}}' });
  r = await run([s, wrong, handled], [edge(s, wrong), edge(wrong, handled, 'error')]);
  assert.equal(r.status, 'done');
  assert.match(r.out.Build.error.message, /Sign in required|401|token/);
  const nope = node('releasePackage', 'Build', { target: 'this server', project: 'No such project', version: '1.0.0' });
  r = await run([s, nope], [edge(s, nope)]);
  assert.match(r.error, /No project named "No such project"/);
});

test('the Release pipeline sample: build, check, deploy to test, approval, deploy to production', async () => {
  projects.setReleasesAllowed(true);
  const { addSamples } = await import('../server/src/samples.js');
  const pid = projects.listProjects().find(p => p.name === 'Release pipelines')!.id;
  const [f] = addSamples(pid, ['release']);
  const doc = flows.getFlow(f.id)!.doc;
  doc.nodes.find((n: any) => n.type === 'start')!.config.payload = JSON.stringify({ project: 'Shop', version: '9.0.0' });
  const id = engine.startRun({ doc, projectId: pid });
  await engine.waitFor(id, 30000, true);
  const task = q.get<any>(`select id from tasks where run_id = ? and status = 'waiting'`, id);
  assert.ok(task, 'waiting for the production approval');
  assert.ok(projects.listProjects().some(p => p.name === 'Shop (test)'), 'deployed to test first');
  engine.decide(task.id, true, 'release manager', 'go');
  await engine.waitFor(id, 30000);
  const r: any = q.get('select status, error from runs where id = ?', id);
  assert.equal(r.status, 'done', r.error);
  const prod = projects.listProjects().find(p => p.name === 'Shop (production)')!;
  assert.equal(pk.packageHistory(prod.id)[0].version, '9.0.0');
});
