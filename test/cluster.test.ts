import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { testEnv, node, edge } from './helpers.js';
import { startServer, waitFor, type Proc } from './proc.js';

/**
 * Several engine processes on one database file: work is shared and done once, one leader runs
 * timers, a dead leader is replaced, a dead engine's steps are finished by another, replies reach
 * the engine the caller is waiting on, deploys reach every engine, and draining hands work back.
 */
testEnv(19310);
const { boot } = await import('../server/src/index.js');
const projects = await import('../server/src/projects.js');
const flows = await import('../server/src/flows.js');
const pk = await import('../server/src/packages.js');

const TOKEN = 'cluster-token-0123456789abcdef';
const KEY = crypto.randomBytes(32).toString('base64');
const H = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
let srv: Awaited<ReturnType<typeof boot>>;
let shared = '', deployDir = '';
const procs: Record<string, Proc> = {};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function sutra(pid: string, name: string, nodes: any[], edges: any[]) {
  const ex = flows.listFlows(pid).find(f => f.name === name);
  const f = flows.saveFlow(ex?.id, { name, nodes, edges }, pid);
  flows.deploy(f.id);
  return f;
}
function rest(pid: string, name: string, p: string, waitMs: number) {
  const t = node('restService', 'In', { method: 'GET', path: p, policy: '', maxBodyKb: 16, testRequest: '{"method":"GET","params":{"n":"0"},"query":{},"headers":{},"body":null}' });
  const w = node('wait', 'Work', { ms: waitMs });
  const r = node('httpResponse', 'Out', { status: '200', contentType: 'application/json', bodySource: 'template', body: '{"n": "{{trigger.params.n}}"}', headers: [] });
  return sutra(pid, name, [t, w, r], [edge(t, w), edge(w, r)]);
}

const engine = (name: string, port: number, env: Record<string, string> = {}) => {
  const p = startServer({ adminPort: port, httpPort: port + 50, env: {
    SUTRA_MODE: 'engine', SUTRA_DATA_DIR: shared, SUTRA_MASTER_KEY: KEY, SUTRA_ADMIN_TOKEN: TOKEN, SUTRA_DEPLOY_DIR: deployDir,
    SUTRA_ENGINE_ID: name, SUTRA_HEARTBEAT_MS: '400', SUTRA_WORKERS: '4', SUTRA_REPLY_TIMEOUT_MS: '20000', ...env } });
  procs[name] = p;
  return p;
};
const db = () => new DatabaseSync(path.join(shared, 'sutra.db'), { readOnly: true });
const status = async (p: Proc) => (await fetch(`${p.admin}/api/engine/status`, { headers: H })).json();
const until = async (what: string, fn: () => Promise<boolean> | boolean, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return; await sleep(150); }
  throw new Error(`Timed out: ${what}`);
};

before(async () => {
  srv = await boot({ listenAdmin: false, gateway: false });
  shared = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-cluster-'));
  deployDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-cdeploy-'));
  const pid = projects.saveProject({ name: 'Cluster', config: { variables: [] } }).id;
  rest(pid, 'Work', '/work/:n', 150);
  rest(pid, 'Slow', '/slow/:n', 2500);
  const tick = node('timer', 'Every second', { mode: 'cron', cron: '* * * * * *', timezone: 'UTC', payload: '{}' });
  const cnt = node('counter', 'Tick', { name: 'ticks', op: 'increment', by: 1 });
  sutra(pid, 'Ticker', [tick, cnt], [edge(tick, cnt)]);
  fs.writeFileSync(path.join(deployDir, 'cluster.sutra'), JSON.stringify(pk.buildPackage(pid, { version: '1.0.0' })));
  for (const f of flows.listFlows(pid)) flows.undeploy(f.id);
});
after(async () => {
  for (const p of Object.values(procs)) await p.stop();
  await srv.stop();
});

test('two engines start together: the package is deployed once, both are alive, exactly one leads', async () => {
  const a = engine('A', 19320), b = engine('B', 19330);
  await Promise.all([waitFor(`${a.admin}/ready`, a), waitFor(`${b.admin}/ready`, b)]);
  const deployed = [a.out(), b.out()].filter(o => /cluster.sutra: Cluster 1.0.0 deployed/.test(o)).length;
  const skipped = [a.out(), b.out()].filter(o => /cluster.sutra: already deployed/.test(o)).length;
  assert.deepEqual([deployed, skipped], [1, 1], 'one engine deployed, the other found it done');
  await until('both engines beating', async () => (await status(a)).engines.filter((e: any) => e.alive).length === 2);
  const s = await status(a);
  assert.equal(s.engines.filter((e: any) => e.leader).length, 1);
  assert.ok(['A', 'B'].includes(s.leader));
});

test('work is shared between engines, each step runs exactly once, every caller gets its reply', async () => {
  const { A, B } = procs;
  const calls = Array.from({ length: 24 }, (_, n) => fetch(`${(n % 2 ? A : B).http}/work/${n}`).then(async r => ({ status: r.status, body: await r.json(), run: r.headers.get('x-sutra-run') })));
  const res = await Promise.all(calls);
  assert.ok(res.every(r => r.status === 200), JSON.stringify(res.filter(r => r.status !== 200)));
  assert.deepEqual(res.map(r => Number(r.body.n)).sort((x, y) => x - y), Array.from({ length: 24 }, (_, n) => n));
  const d = db();
  const owners = d.prepare(`select owner, count(*) n from tasks where run_id in (select id from runs where flow_name = 'Work') and owner is not null group by owner`).all() as any[];
  assert.deepEqual(owners.map(o => o.owner).sort(), ['A', 'B'], 'both engines ran steps');
  const dup = d.prepare(`select run_id, node_id, count(*) n from tasks where status = 'done' and run_id in (select id from runs where flow_name = 'Work') group by run_id, node_id having count(*) > 1`).all();
  assert.deepEqual(dup, [], 'no step ran twice');
  d.close();
});

test('an engine with no workers only serves: its callers are answered by steps run on the others', async () => {
  const c = engine('C', 19340, { SUTRA_WORKERS: '0' });
  await waitFor(`${c.admin}/ready`, c);
  const r = await fetch(`${c.http}/work/77`);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).n, '77');
  const d = db();
  const owner = d.prepare(`select owner from tasks where run_id = ? and owner is not null limit 1`).get(r.headers.get('x-sutra-run')) as any;
  d.close();
  assert.ok(['A', 'B'].includes(owner.owner), `run by ${owner.owner}`);
  await c.stop();
});

test('the timer fires once per second in the whole cluster, from the leader only', async () => {
  const d = db();
  const count = () => Number((d.prepare(`select coalesce(sum(value), 0) v from counters where name = 'ticks'`).get() as any).v);
  const c0 = count();
  await sleep(4200);
  const fired = count() - c0;
  d.close();
  assert.ok(fired >= 3 && fired <= 6, `fired ${fired} times in 4.2 s with two engines`);
});

test('when the leader dies, the other engine takes over within a few heartbeats', async () => {
  const s = await status(procs.A);
  const leader = s.leader as 'A' | 'B';
  const other = leader === 'A' ? 'B' : 'A';
  procs[leader].child.kill('SIGKILL');
  await procs[leader].exited;
  await until('a new leader', async () => (await status(procs[other])).leader === other, 8000);
  const d = db();
  const count = () => Number((d.prepare(`select coalesce(sum(value), 0) v from counters where name = 'ticks'`).get() as any).v);
  const c0 = count();
  await sleep(2500);
  assert.ok(count() > c0, 'the timer keeps firing under the new leader');
  d.close();
  // Restart the dead one under the same name for the next tests.
  const back = engine(leader, leader === 'A' ? 19320 : 19330);
  await waitFor(`${back.admin}/ready`, back);
});

test('steps of an engine that dies mid-step are finished by another engine', async () => {
  const { A, B } = procs;
  const caller = fetch(`${A.http}/slow/5`).catch(() => null);
  const d = db();
  let run = '';
  await until('the slow step is running', () => {
    const r = d.prepare(`select t.run_id, t.owner from tasks t join runs r on r.id = t.run_id where r.flow_name = 'Slow' and t.status = 'running' order by t.id desc limit 1`).get() as any;
    if (r) run = r.run_id;
    return !!r;
  });
  const owner = (d.prepare('select owner from tasks where run_id = ? and status = ?').get(run, 'running') as any).owner as 'A' | 'B';
  procs[owner].child.kill('SIGKILL');
  await procs[owner].exited;
  await until('the run finishes on the surviving engine', () => (d.prepare('select status from runs where id = ?').get(run) as any).status === 'done', 20000);
  const done = d.prepare(`select owner from tasks where run_id = ? and status = 'done' and node_id in (select node_id from tasks where run_id = ?)`).all(run, run) as any[];
  assert.ok(done.some(t => t.owner !== owner), 'the surviving engine finished it');
  d.close();
  await caller;
  const back = engine(owner, owner === 'A' ? 19320 : 19330);
  await waitFor(`${back.admin}/ready`, back);
});

test('a package deployed through one engine is served by the other at once', async () => {
  const { A, B } = procs;
  const pid = projects.listProjects().find(p => p.name === 'Cluster')!.id;
  const f = rest(pid, 'Hello', '/hello/:n', 10);
  const pkg = pk.buildPackage(pid, { version: '1.1.0' });
  flows.undeploy(f.id);
  const r = await fetch(`${A.admin}/api/packages/deploy`, { method: 'POST', headers: H, body: JSON.stringify({ package: pkg, keepOthers: true }) });
  assert.equal(r.status, 200, await r.clone().text());
  await until('B serves /hello', async () => (await fetch(`${B.http}/hello/1`)).status === 200, 5000);
});

test('draining: a step that finishes in time completes; one that does not is handed back and finished elsewhere', async () => {
  const { A, B } = procs;
  // B stops with a short drain while a 2.5 s step runs on it.
  const short = engine('D', 19350, { SUTRA_DRAIN_MS: '300' });
  await waitFor(`${short.admin}/ready`, short);
  await fetch(`${A.admin}/api/engine/status`, { headers: H }); // A and B stay busy-free
  const d = db();
  const caller = fetch(`${short.http}/slow/9`).then(r => r.status).catch(() => 0);
  let run = '';
  await until('a slow step running on D', () => {
    const r = d.prepare(`select run_id from tasks where owner = 'D' and status = 'running' limit 1`).get() as any;
    if (r) run = r.run_id;
    return !!r;
  }, 10000).catch(async () => {
    // A or B claimed it first; that is fine for sharing but not for this test: start more until D runs one.
    for (let i = 0; i < 10 && !run; i++) {
      fetch(`${short.http}/slow/${10 + i}`).catch(() => 0);
      await sleep(200);
      const r = d.prepare(`select run_id from tasks where owner = 'D' and status = 'running' limit 1`).get() as any;
      if (r) run = r.run_id;
    }
  });
  assert.ok(run, 'D is running a slow step');
  const t0 = Date.now();
  const res = await fetch(`${short.admin}/api/engine/drain`, { method: 'POST', headers: H, body: '{}' });
  assert.equal(res.status, 202);
  assert.equal(await short.exited, 0);
  assert.ok(Date.now() - t0 < 20000, `D stopped promptly (${Date.now() - t0} ms)`);
  assert.match(short.out(), /handed back to the queue/);
  await until('the handed-back run finishes on A or B', () => (d.prepare('select status from runs where id = ?').get(run) as any).status === 'done', 20000);
  const fin = d.prepare(`select owner from tasks where run_id = ? and status = 'done'`).all(run) as any[];
  assert.ok(fin.some(t => t.owner === 'A' || t.owner === 'B'));
  d.close();
  await caller;
  void B;
});
