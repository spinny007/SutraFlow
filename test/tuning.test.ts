import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { testEnv, node, edge, port } from './helpers.js';
import { root } from './proc.js';

testEnv(19750);
process.env.SUTRA_ADMIN_TOKEN = 'tuning-admin-token-0123456789';
const { boot } = await import('../server/src/index.js');
const { engine } = await import('../server/src/engine/engine.js');
const { q } = await import('../server/src/db.js');
const { config } = await import('../server/src/config.js');
const flows = await import('../server/src/flows.js');
const projects = await import('../server/src/projects.js');
const { housekeeping } = await import('../server/src/housekeeping.js');

let srv: Awaited<ReturnType<typeof boot>>;
const ADMIN = `http://127.0.0.1:${port(19759)}`;
before(async () => { srv = await boot({ listenAdmin: false }); await srv.admin.listen({ host: '127.0.0.1', port: port(19759) }); });
after(async () => { await srv.stop(); });

const H = { authorization: `Bearer ${process.env.SUTRA_ADMIN_TOKEN}` };
const call = (method: string, url: string, payload?: any, headers: Record<string, string> = H) => srv.admin.inject({ method: method as any, url, payload, headers });
let shop = '';
function deployed(name: string, nodes: any[], edges: any[]) {
  shop ||= projects.saveProject({ name: 'Tuning shop', config: { variables: [] } }).id;
  const f = flows.saveFlow(undefined, { name, nodes, edges }, shop);
  flows.deploy(f.id);
  return f.id;
}
const start = (flowId: string, input: any = {}) => {
  const d = flows.deployedFlows().find(x => x.flowId === flowId)!;
  return engine.startRun({ doc: d.doc, flowId, projectId: d.projectId, version: d.version, source: 'api', input });
};
const status = (id: string) => q.get<any>('select status, error from runs where id = ?', id);

test('engine tuning: for all engines and for one, applied at once; wrong values refused; empty returns to the default', async () => {
  const before = (await call('GET', '/api/console/tuning')).json();
  assert.ok(before.fields.engine.some((f: any) => f.k === 'workers'));
  assert.equal(before.effective.workers, config.workerConcurrency);
  let r = await call('PUT', '/api/console/tuning/engine', { values: { workers: 3, maxStepsPerRun: 500, replyTimeoutMs: 20000 } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(engine.concurrency, 3);
  assert.equal(config.maxStepsPerRun, 500);
  assert.equal(config.replyTimeoutMs, 20000);
  r = await call('PUT', `/api/console/tuning/engines/${encodeURIComponent(config.engineId)}`, { values: { workers: 5 } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(engine.concurrency, 5, 'this engine\'s own value wins');
  assert.match((await call('PUT', `/api/console/tuning/engines/${encodeURIComponent(config.engineId)}`, { values: { replyTimeoutMs: 5000 } })).json().error, /cannot be set here/);
  assert.match((await call('PUT', '/api/console/tuning/engine', { values: { workers: -1 } })).json().error, /Steps at once: a number from 0 to 512/);
  assert.match((await call('PUT', '/api/console/tuning/engine', { values: { speed: 1 } })).json().error, /Unknown setting/);
  await call('PUT', `/api/console/tuning/engines/${encodeURIComponent(config.engineId)}`, { values: {} });
  assert.equal(engine.concurrency, 3);
  await call('PUT', '/api/console/tuning/engine', { values: {} });
  assert.equal(engine.concurrency, before.defaults.workers);
  assert.equal(config.maxStepsPerRun, before.defaults.maxStepsPerRun);
});

test('Runs at once: extra runs wait in a queue and start when one ends', async () => {
  const s = node('start', 'Start'), w = node('wait', 'Pause', { ms: 250 });
  const id = deployed('Queue me', [s, w], [edge(s, w)]);
  assert.equal((await call('PUT', `/api/console/sutras/${id}/tuning`, { values: { maxRuns: 1 } })).statusCode, 200);
  const runs = [start(id), start(id), start(id)];
  assert.deepEqual(runs.map(r => status(r).status), ['running', 'queued', 'queued']);
  await engine.waitFor(runs[0], 10000);
  await new Promise(r => setTimeout(r, 30));
  assert.equal(status(runs[1]).status, 'running', 'the next one started');
  assert.equal(status(runs[2]).status, 'queued');
  await engine.waitFor(runs[2], 10000);
  assert.deepEqual(runs.map(r => status(r).status), ['done', 'done', 'done']);
  const app = (await call('GET', '/api/console/apps')).json().flatMap((p: any) => p.sutras).find((x: any) => x.id === id);
  assert.deepEqual(app.tuning, { maxRuns: 1 });
});

test('priority: steps of higher priority Sutras are taken from the queue first', async () => {
  const mk = (n: string) => { const s = node('start', 'Start'), w = node('wait', 'Pause', { ms: 10 }); return deployed(n, [s, w], [edge(s, w)]); };
  const low = mk('Low'), high = mk('High');
  await call('PUT', `/api/console/sutras/${high}/tuning`, { values: { priority: 5 } });
  engine.concurrency = 0;
  const a = start(low), b = start(high);
  engine.concurrency = 1;
  engine.pump();
  await engine.waitFor(a, 10000); await engine.waitFor(b, 10000);
  const firstPause = (run: string) => Number(q.get<any>(`select min(t.id) id from tasks t join runs r on r.id = t.run_id where t.run_id = ? and t.node_id != r.trigger_node`, run).id);
  assert.ok(firstPause(b) < firstPause(a), 'the high priority run moved first although it started second');
  engine.concurrency = config.workerConcurrency;
});

test('default retries for steps without their own; run time limit; step data kept or not', async () => {
  const s = node('start', 'Start'), boom = node('throw', 'Boom', { message: 'nope' });
  const id = deployed('Flaky', [s, boom], [edge(s, boom)]);
  await call('PUT', `/api/console/sutras/${id}/tuning`, { values: { retries: 2, retryDelayMs: 10, stepData: 'none' } });
  const r = start(id, { secret: 'card 4111' });
  await engine.waitFor(r, 10000);
  assert.equal(status(r).status, 'failed');
  const t = q.get<any>(`select attempt, input, output from tasks where run_id = ? and node_id = ?`, r, boom.id);
  assert.equal(Number(t.attempt), 2, 'retried twice from the Sutra tuning');
  assert.equal(t.input, null, 'step data not kept');

  const s2 = node('start', 'Start'), ap = node('approval', 'Sign off', { message: 'ok?' });
  const id2 = deployed('Slow sign-off', [s2, ap], [edge(s2, ap)]);
  await call('PUT', `/api/console/sutras/${id2}/tuning`, { values: { runTimeoutMin: 1 } });
  const r2 = start(id2);
  await engine.waitFor(r2, 10000, true);
  assert.equal(engine.enforceRunTimeouts(Date.now() + 30000), 0, 'not yet');
  assert.equal(engine.enforceRunTimeouts(Date.now() + 61000), 1);
  assert.equal(status(r2).status, 'cancelled');
  assert.equal(status(r2).error, 'Run time limit of 1 min reached');
});

test('per-Sutra run retention; restart keeps it started; viewers may not tune', async () => {
  const s = node('start', 'Start'), l = node('log', 'Log', { message: 'hi' });
  const id = deployed('Short memory', [s, l], [edge(s, l)]);
  const r = start(id);
  await engine.waitFor(r, 10000);
  await call('PUT', `/api/console/sutras/${id}/tuning`, { values: { retentionDays: 1 } });
  housekeeping({ retentionDays: 0, now: Date.now() + 2 * 86400000 });
  assert.equal(status(r), undefined, 'deleted after its own retention');
  const restart = await call('POST', `/api/console/sutras/${id}/restart`);
  assert.equal(restart.statusCode, 200, restart.body);
  assert.equal(restart.json().enabled, true);
  assert.equal(flows.deployedFlows().some(d => d.flowId === id), true);
  assert.match((await call('PUT', `/api/console/sutras/${id}/tuning`, { values: { stepData: 'some' } })).json().error, /Step data in history: one of all, errors only, none/);
});

const cli = (...args: string[]) => new Promise<{ status: number | null; out: string; err: string }>(res => {
  const c = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', 'tsx', path.join(root, 'server/src/cli.ts'), ...args, '--server', ADMIN], { cwd: root, env: process.env });
  let out = '', err = '';
  c.stdout.on('data', d => (out += d)); c.stderr.on('data', d => (err += d));
  c.on('close', status => res({ status, out, err }));
});

test('the console actions from the sutra command: list, stop, start, restart, tune, runs, engines, tokens', async () => {
  let r = await cli('sutras', 'list', '--project', 'Tuning shop');
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /Tuning shop\s+Queue me\s+1\s+started/);
  r = await cli('sutras', 'stop', 'Queue me', '--project', 'Tuning shop');
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /Queue me: stopped/);
  assert.match((await cli('sutras', 'list')).out, /Queue me\s+1\s+stopped/);
  assert.match((await cli('sutras', 'start', 'Queue me', '--project', 'Tuning shop')).out, /started/);
  assert.match((await cli('sutras', 'restart', 'Queue me', '--project', 'Tuning shop')).out, /restarted/);
  r = await cli('sutras', 'tune', 'Queue me', '--project', 'Tuning shop', '--max-runs', '4', '--step-data', 'errors-only');
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /"maxRuns":4/);
  assert.match(r.out, /"stepData":"errors only"/);
  r = await cli('engines', 'tune', '--workers', '7');
  assert.equal(r.status, 0, r.err);
  assert.equal(engine.concurrency, 7);
  await cli('engines', 'tune', '--workers', '');
  assert.equal(engine.concurrency, config.workerConcurrency, 'an empty value returns to the default');
  r = await cli('runs', 'list', '--sutra', 'Flaky', '--project', 'Tuning shop', '--status', 'failed');
  assert.match(r.out, /Flaky\s+failed/);
  r = await cli('engines', 'list');
  assert.match(r.out, new RegExp(config.engineId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+alive\\s+yes'));
  assert.equal((await cli('sutras', 'stop', 'Nope', '--project', 'Tuning shop')).status, 1);
  await call('POST', '/api/access/users', { username: 'ci', kind: 'system', grants: [{ role: 'deployer', project: '' }] });
  r = await cli('token', 'create', 'ci', '--name', 'pipeline', '--expires-days', '30');
  assert.equal(r.status, 0, r.err);
  assert.match(r.out.trim(), /^sut_[0-9a-f]{12}_/);
  assert.match(r.err, /not shown again/);
});
