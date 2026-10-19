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
import { testEnv, node, edge } from './helpers.js';

/**
 * Python steps (with the Python of this machine), and YouTube and Twitch through OAuth connections
 * signed in with a refresh token secret (as on a server without the studio), against stand-ins:
 * Google Drive saves a video to a server file and YouTube uploads it; Twitch reads a channel.
 */
testEnv(20250);
const { boot } = await import('../server/src/index.js');
const { engine } = await import('../server/src/engine/engine.js');
const { q } = await import('../server/src/db.js');
const projects = await import('../server/src/projects.js');
const { saveResource } = await import('../server/src/resources.js');
const { setSecret } = await import('../server/src/secrets.js');
const { testResource } = await import('../server/src/resourceTest.js');
const { validateDoc } = await import('../server/src/flows.js');
const { findPython } = await import('../server/src/python.js');

let srv: Awaited<ReturnType<typeof boot>>;
let fake: http.Server;
let base = '';
let pid = '';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-py-yt-'));
const got: { method: string; url: string; headers: http.IncomingHttpHeaders; body: Buffer }[] = [];
const VIDEO = Buffer.alloc(300 * 1024, 7);

before(async () => {
  srv = await boot({ listenAdmin: false });
  pid = projects.saveProject({ name: 'Media', config: { variables: [] } }).id;
  projects.setScriptsAllowed(true);
  setSecret('GOOGLE_REFRESH', 'google-refresh-1');
  setSecret('TWITCH_REFRESH', 'twitch-refresh-1');
  setSecret('OAUTH_CLIENT', 'client-secret');
  fake = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', d => chunks.push(d)); req.on('end', () => {
      const body = Buffer.concat(chunks);
      const u = new URL(req.url!, 'http://x');
      got.push({ method: req.method!, url: req.url!, headers: req.headers, body });
      const send = (status: number, o: unknown, h: Record<string, string> = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...h }); res.end(JSON.stringify(o)); };
      if (u.pathname === '/token') {
        const f = new URLSearchParams(body.toString());
        if (f.get('grant_type') !== 'refresh_token') return send(400, { error: 'unsupported_grant_type' });
        return send(200, { access_token: `at:${f.get('refresh_token')}`, expires_in: 3600 });
      }
      if (u.pathname === '/drive/v3/files/VID1' && u.searchParams.get('alt') === 'media') { res.writeHead(200, { 'content-type': 'video/mp4' }); return res.end(VIDEO); }
      if (u.pathname === '/drive/v3/files/VID1') return send(200, { id: 'VID1', name: 'Tea tasting.mp4', mimeType: 'video/mp4', size: String(VIDEO.length), modifiedTime: '2026-10-19T08:00:00Z' });
      if (u.pathname === '/upload/youtube/v3/videos') return send(200, {}, { location: `${base}/upload-session/42` });
      if (u.pathname === '/upload-session/42') return send(200, { id: 'yt123', snippet: { title: JSON.parse(got.find(g => g.url.startsWith('/upload/youtube'))!.body.toString()).snippet.title }, status: { privacyStatus: 'private', uploadStatus: 'uploaded' } });
      if (u.pathname === '/youtube/v3/channels') return send(200, { items: [{ id: 'UC1', snippet: { title: 'Asha Traders' }, statistics: { subscriberCount: '1200', viewCount: '50000', videoCount: '40' } }] });
      if (u.pathname === '/v2/reports') return send(200, { columnHeaders: [{ name: 'day' }, { name: 'views' }], rows: [['2026-10-18', 120], ['2026-10-19', 95]] });
      if (u.pathname.startsWith('/helix/')) {
        if (req.headers['client-id'] !== 'tw-client') return send(401, { message: 'Client ID is missing' });
        if (u.pathname === '/helix/users') return send(200, { data: [{ id: '77', login: 'ashatraders', display_name: 'AshaTraders' }] });
        if (u.pathname === '/helix/streams') return send(200, { data: [{ user_id: '77', title: 'Tea tasting', game_name: 'Food & Drink', viewer_count: 42, started_at: '2026-10-19T14:00:00Z' }] });
      }
      send(404, { error: { message: `no route ${u.pathname}` } });
    });
  });
  await new Promise<void>(r => fake.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(fake.address() as any).port}`;
});
after(async () => { fake.close(); await srv.stop(); });

const run = async (nodes: ReturnType<typeof node>[], input?: unknown) => {
  const s = node('start', 'Start', { payload: JSON.stringify(input ?? { orderId: 'A-7', lines: [{ amount: 100 }, { amount: 50 }] }) });
  const edges = [edge(s, nodes[0]), ...nodes.slice(1).map((n, i) => edge(nodes[i], n))];
  const id = engine.startRun({ doc: { name: 'T', nodes: [s, ...nodes], edges }, projectId: pid, source: 'test' });
  await engine.waitFor(id, 60000);
  const r: any = q.get('select status, error, state from runs where id = ?', id);
  return { status: r.status, error: r.error, out: JSON.parse(r.state).outputs };
};

test('Python is found on this server (py, python3 or python), or the reason says how to install it', () => {
  const p = findPython();
  if (!p.ok) { assert.match(p.message, /Install it from python\.org/); return; }
  assert.match(p.version, /^3\./);
});

test('a Python step reads its parameters and the previous output, and its printed JSON is the result', async t => {
  if (!findPython().ok) return t.skip('Python is not installed on this machine');
  const r = await run([node('python', 'Total', { source: 'code', params: [{ k: 'orderId', v: '{{input.orderId}}' }, { k: 'taxRate', v: '0.18' }], args: ['--mode', 'fast'], code: 'import json, os, sys\nparams = json.load(open(os.environ["SUTRA_PARAMS_FILE"]))\nprev = json.load(open(os.environ["SUTRA_INPUT_FILE"]))\nprint("working")\nprint(json.dumps({"orderId": params["orderId"], "env": os.environ["taxRate"], "args": sys.argv[1:], "total": round(sum(l["amount"] for l in prev["lines"]) * (1 + float(params["taxRate"])), 2), "word": "Café"}))' })]);
  assert.equal(r.status, 'done', r.error);
  assert.deepEqual(r.out.Total.result, { orderId: 'A-7', env: '0.18', args: ['--mode', 'fast'], total: 177, word: 'Café' });
  assert.match(r.out.Total.python, /^Python 3\./);
});

test('a script file runs with its arguments; a traceback fails the step with its last lines', async t => {
  if (!findPython().ok) return t.skip('Python is not installed on this machine');
  const f = path.join(tmp, 'job.py');
  fs.writeFileSync(f, 'import sys\nprint(sys.argv[1].upper())\n');
  const ok = await run([node('python', 'File', { source: 'file', file: f, args: ['{{input.orderId}}'] })]);
  assert.equal(ok.status, 'done', ok.error);
  assert.equal(ok.out.File.stdout.trim(), 'A-7');
  const bad = await run([node('python', 'Broken', { source: 'code', code: 'x = {}\nprint(x["missing"])' })]);
  assert.equal(bad.status, 'failed');
  assert.match(bad.error, /Exit code 1: .*KeyError: 'missing'/);
});

test('before anything runs: syntax errors, missing files, packages and virtual environments are warnings', t => {
  if (!findPython().ok) return t.skip('Python is not installed on this machine');
  const s = node('start', 'Start');
  const a = node('python', 'Syntax', { source: 'code', code: 'def f(:\n  pass' });
  const b = node('python', 'Gone', { source: 'file', file: path.join(tmp, 'nope.py') });
  const c = node('python', 'Packages', { source: 'code', code: 'print(1)', packages: 'json, surely_not_installed_pkg' });
  const d = node('python', 'Venv', { source: 'code', code: 'print(1)', venv: path.join(tmp, 'no-venv') });
  const v = validateDoc({ name: 'X', nodes: [s, a, b, c, d], edges: [edge(s, a), edge(s, b), edge(s, c), edge(s, d)] }, pid);
  assert.ok(v.warnings.some(w => /^Syntax: Python syntax error, line 1: /.test(w)), v.warnings.join('\n'));
  assert.ok(v.warnings.some(w => w.startsWith('Gone: Script file not found on this server')));
  assert.ok(v.warnings.some(w => /^Packages: Python packages not installed .*: surely_not_installed_pkg \(pip install surely_not_installed_pkg\)$/.test(w)), v.warnings.join('\n'));
  assert.ok(v.warnings.some(w => w.startsWith('Venv: Virtual environment folder not found')));
});

test('a refresh token secret signs in an OAuth connection without the studio (Test connection proves it)', async () => {
  const g = saveResource({ kind: 'oauthApp', name: 'Google media', project_id: pid, config: { provider: 'google', clientId: 'g-client', clientSecretSecret: 'OAUTH_CLIENT', tokenUrl: `${base}/token`, apiBase: base, refreshTokenSecret: 'GOOGLE_REFRESH', scopes: 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/youtube.upload' } });
  const t = await testResource({ id: g.id, kind: g.kind, project_id: pid, config: g.config });
  assert.equal(t.ok, true, t.message);
  assert.match(t.message, /YouTube channel Asha Traders/);
  assert.equal(got.filter(x => x.url === '/token').length, 1);
});

test('Google Drive saves a video to a server file, and YouTube uploads that file (streamed, resumable)', async () => {
  const g = saveResource({ kind: 'oauthApp', name: 'Google media 2', project_id: pid, config: { provider: 'google', clientId: 'g-client', clientSecretSecret: 'OAUTH_CLIENT', tokenUrl: `${base}/token`, apiBase: base, refreshTokenSecret: 'GOOGLE_REFRESH' } });
  const target = path.join(tmp, 'videos', 'tea.mp4');
  const r = await run([
    node('googleDrive', 'Fetch video', { connection: g.id, op: 'download', fileId: 'VID1', saveTo: 'server file', savePath: target }),
    node('youtube', 'Publish', { connection: g.id, op: 'upload video', from: 'server file', filePath: '{{input.path}}', title: '{{input.name}}', description: 'Weekly tasting', tags: 'tea, assam', privacy: 'unlisted', notify: false }),
  ]);
  assert.equal(r.status, 'done', r.error);
  assert.equal(r.out['Fetch video'].size, VIDEO.length);
  assert.equal(fs.statSync(target).size, VIDEO.length);
  assert.deepEqual({ id: r.out.Publish.videoId, url: r.out.Publish.url, bytes: r.out.Publish.bytes, title: r.out.Publish.title }, { id: 'yt123', url: 'https://youtu.be/yt123', bytes: VIDEO.length, title: 'Tea tasting' });
  const start = got.find(x => x.url.startsWith('/upload/youtube/v3/videos'))!;
  assert.match(start.url, /uploadType=resumable/);
  assert.equal(start.headers['x-upload-content-length'], String(VIDEO.length));
  assert.deepEqual(JSON.parse(start.body.toString()).status, { privacyStatus: 'unlisted', selfDeclaredMadeForKids: false });
  const put = got.find(x => x.url === '/upload-session/42')!;
  assert.equal(put.method, 'PUT');
  assert.ok(put.body.equals(VIDEO), 'the bytes arrived unchanged');
  assert.equal(put.headers.authorization, 'Bearer at:google-refresh-1');
});

test('YouTube channel statistics and an Analytics report', async () => {
  const g = saveResource({ kind: 'oauthApp', name: 'Google media 3', project_id: pid, config: { provider: 'google', clientId: 'g-client', tokenUrl: `${base}/token`, apiBase: base, refreshTokenSecret: 'GOOGLE_REFRESH' } });
  const r = await run([node('youtube', 'Channel', { connection: g.id, op: 'channel stats' }), node('youtube', 'Report', { connection: g.id, op: 'analytics report', startDate: '2026-10-18', endDate: '2026-10-19', metrics: 'views', dimensions: 'day' })]);
  assert.equal(r.status, 'done', r.error);
  assert.equal(r.out.Channel.subscribers, 1200);
  assert.deepEqual(r.out.Report.rows, [{ day: '2026-10-18', views: 120 }, { day: '2026-10-19', views: 95 }]);
  assert.match(got.find(x => x.url.startsWith('/v2/reports'))!.url, /ids=channel%3D%3DMINE/);
});

test('Twitch sends the app\'s client id; stream status tells who is live', async () => {
  const t = saveResource({ kind: 'oauthApp', name: 'Twitch', project_id: pid, config: { provider: 'twitch', clientId: 'tw-client', clientSecretSecret: 'OAUTH_CLIENT', tokenUrl: `${base}/token`, apiBase: base, refreshTokenSecret: 'TWITCH_REFRESH' } });
  const test1 = await testResource({ id: t.id, kind: t.kind, project_id: pid, config: t.config });
  assert.equal(test1.ok, true, test1.message);
  assert.equal(test1.message, 'Signed in to Twitch as AshaTraders');
  const r = await run([node('twitch', 'Live', { connection: t.id, op: 'stream status', logins: 'ashatraders' })]);
  assert.equal(r.status, 'done', r.error);
  assert.deepEqual(r.out.Live.items[0], { id: '77', login: 'ashatraders', live: true, title: 'Tea tasting', game: 'Food & Drink', viewers: 42, startedAt: '2026-10-19T14:00:00Z', url: 'https://www.twitch.tv/ashatraders' });
});

test('the ADF, Databricks, Python, YouTube and Twitch templates are complete, described, and the Python file one runs', async t => {
  const { addSamples } = await import('../server/src/samples.js');
  const flows = await import('../server/src/flows.js');
  const p2 = projects.saveProject({ name: 'Templates', config: { variables: [] } }).id;
  const made = addSamples(p2, ['adf', 'databricks', 'python', 'youtube', 'twitch']);
  assert.equal(made.length, 9);
  for (const m of made) {
    const doc = flows.getFlow(m.id)!.doc;
    assert.ok(doc.nodes.every(n => n.description), `${m.name}: every step is described`);
    assert.deepEqual(validateDoc(doc, p2).errors, [], m.name);
  }
  assert.deepEqual([...new Set(made.map(m => m.folder))].sort(), ['Samples/Azure and Databricks', 'Samples/Python', 'Samples/Social media']);
  const vars = projects.effectiveVariables(p2).values;
  assert.ok(fs.existsSync(path.join(vars.SCRIPTS_FOLDER, 'sales_report.py')));
  if (!findPython().ok) return t.skip('Python is not installed on this machine');
  const f = made.find(m => m.name === 'Sample: Python script file')!;
  const id = engine.startRun({ doc: flows.getFlow(f.id)!.doc, flowId: f.id, projectId: p2, source: 'test' });
  await engine.waitFor(id, 60000);
  const r: any = q.get('select status, error, state from runs where id = ?', id);
  assert.equal(r.status, 'done', r.error);
  assert.deepEqual(JSON.parse(r.state).outputs['Sales report'].result, { region: 'West', count: 4, total: 4830, average: 1207.5, median: 1090, mode: 'quick' });
});
