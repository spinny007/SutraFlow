import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { testEnv, node, edge } from './helpers.js';

testEnv(18510);
const { boot } = await import('../server/src/index.js');
const { engine } = await import('../server/src/engine/engine.js');
const { q } = await import('../server/src/db.js');
const flows = await import('../server/src/flows.js');
const { runSandboxed, renderHtml } = await import('../server/src/palettes/code.js');
const { rebuildListeners, listenerStatus } = await import('../server/src/listeners.js');

let srv: Awaited<ReturnType<typeof boot>>;
before(async () => { srv = await boot({ listenAdmin: false }); });
after(async () => { await srv.stop(); });

async function run(nodes: any[], edges: any[]) {
  const id = engine.startRun({ doc: { name: 'P', nodes, edges } });
  await engine.waitFor(id, 15000, true);
  const r: any = q.get('select * from runs where id = ?', id);
  return { status: r.status, error: r.error, state: JSON.parse(r.state) };
}
const until = async (fn: () => boolean, ms = 8000) => {
  const t = Date.now();
  while (!fn()) { if (Date.now() - t > ms) throw new Error('timed out'); await new Promise(r => setTimeout(r, 100)); }
};

test('JavaScript code step: runs, logs, returns data', async () => {
  const s = node('start', 'Start', { payload: '{"lines":[{"qty":2,"price":10.5},{"qty":1,"price":4}]}' });
  const c = node('jsCode', 'Total', { code: "console.log('lines', input.lines.length);\nconst total = input.lines.reduce((a, l) => a + l.qty * l.price, 0);\nreturn { total, first: nodes.Start.lines[0].qty };" });
  const r = await run([s, c], [edge(s, c)]);
  assert.equal(r.status, 'done', r.error);
  assert.deepEqual(r.state.outputs.Total, { total: 25, first: 2 });
  assert.ok(r.state.logs.some((l: any) => l.msg === 'lines 2'));
});

test('code sandbox blocks host access, eval, endless loops and memory bombs', async () => {
  await assert.rejects(runSandboxed('return process.env', {}), /process is not defined/);
  await assert.rejects(runSandboxed('return require("fs")', {}), /require is not defined/);
  await assert.rejects(runSandboxed("return this.constructor.constructor('return process')()", {}), /Code generation from strings disallowed|not defined|Cannot read/);
  await assert.rejects(runSandboxed("return eval('1+1')", {}), /Code generation from strings disallowed/);
  await assert.rejects(runSandboxed('while (true) {}', {}, 300), /did not finish|timed out|Script execution timed out/);
  await assert.rejects(runSandboxed('const a = []; while (true) a.push(new Array(1e6).fill(1));', {}, 20000, 32), /memory|terminated|Worker/i);
  const ok = await runSandboxed('return input.a * 2', { input: { a: 21 } });
  assert.equal(ok.value, 42);
});

test('HTML template escapes values and supports each / if / formulas', () => {
  const html = renderHtml(
    '<h1>{{input.title}}</h1>{{{input.raw}}}<ul>{{#each input.items}}<li>{{@index}}:{{this.name}}</li>{{/each}}</ul>{{#if input.note}}N{{else}}none{{/if}} {{=upper-case({input.code})}}',
    { input: { title: '<script>x</script>', raw: '<b>ok</b>', items: [{ name: 'A&B' }, { name: 'C' }], note: '', code: 'ab' } });
  assert.equal(html, '<h1>&lt;script&gt;x&lt;/script&gt;</h1><b>ok</b><ul><li>0:A&amp;B</li><li>1:C</li></ul>none AB');
});

test('file activities stay inside their folder; file trigger fires on added, modified and removed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-files-'));
  const w = node('fileWrite', 'Write', { folder: dir, path: 'out/a.txt', content: 'hello', mode: 'overwrite' });
  const s = node('start', 'Start', { payload: '{}' });
  const ok = await run([s, w], [edge(s, w)]);
  assert.equal(ok.status, 'done', ok.error);
  assert.equal(fs.readFileSync(path.join(dir, 'out/a.txt'), 'utf8'), 'hello');
  // Append / Overwrite checkboxes
  const app = node('fileWrite', 'Append', { folder: dir, path: 'out/a.txt', content: 'world', append: true, newline: true });
  const ra = await run([s, app], [edge(s, app)]);
  assert.equal(ra.state.outputs.Append.action, 'appended');
  assert.equal(fs.readFileSync(path.join(dir, 'out/a.txt'), 'utf8'), 'hello\nworld');
  const noOver = node('fileWrite', 'Keep', { folder: dir, path: 'out/a.txt', content: 'x', append: false, overwrite: false });
  const rk = await run([s, noOver], [edge(s, noOver)]);
  assert.match(rk.error, /already exists/);
  const over = node('fileWrite', 'Replace', { folder: dir, path: 'out/a.txt', content: 'new', append: false, overwrite: true });
  const ro = await run([s, over], [edge(s, over)]);
  assert.equal(ro.state.outputs.Replace.action, 'overwritten');
  assert.equal(fs.readFileSync(path.join(dir, 'out/a.txt'), 'utf8'), 'new');

  const bad = node('fileRead', 'Read', { folder: dir, path: '../../etc/passwd' });
  const r2 = await run([s, bad], [edge(s, bad)]);
  assert.match(r2.error, /outside the folder/);

  const t = node('fileTrigger', 'Inbox', { folder: dir, pattern: '*.csv', events: ['added', 'modified', 'removed'], pollSeconds: 1, stableSeconds: 0, readContent: 'text' });
  const l = node('log', 'Seen', { message: '={input.event}' });
  const f = flows.saveFlow(undefined, { name: 'Watch', nodes: [t, l], edges: [edge(t, l, 'added'), edge(t, l, 'modified'), edge(t, l, 'removed')] });
  flows.deploy(f.id);
  await rebuildListeners();
  await new Promise(r => setTimeout(r, 300));
  const events = () => q.all<any>(`select state from runs where flow_id = ? order by started_at`, f.id).map(x => JSON.parse(x.state).outputs.Inbox?.event);
  fs.writeFileSync(path.join(dir, 'orders.csv'), 'id\n1');
  await until(() => events().includes('added'));
  await new Promise(r => setTimeout(r, 1100));
  fs.writeFileSync(path.join(dir, 'orders.csv'), 'id\n1\n2');
  await until(() => events().includes('modified'));
  fs.rmSync(path.join(dir, 'orders.csv'));
  await until(() => events().includes('removed'));
  const added = q.all<any>(`select state from runs where flow_id = ?`, f.id).map(x => JSON.parse(x.state).outputs.Inbox).find(o => o.event === 'added');
  assert.equal(added.content, 'id\n1');
  assert.equal([...listenerStatus.values()].find(s => s.type === 'fileTrigger')?.state, 'ok');
  flows.undeploy(f.id);
});
