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
import { createRequire } from 'node:module';
import { testEnv, node, edge, port } from './helpers.js';
import { sftpServer } from './sftpserver.js';

testEnv(19830);
const { boot } = await import('../server/src/index.js');
const { engine, runState } = await import('../server/src/engine/engine.js');
const { q } = await import('../server/src/db.js');
const flows = await import('../server/src/flows.js');
const projects = await import('../server/src/projects.js');
const { saveResource } = await import('../server/src/resources.js');
const { setSecret } = await import('../server/src/secrets.js');
const { testResource } = await import('../server/src/resourceTest.js');
const { remotePath, fingerprintOf } = await import('../server/src/connectors/remote.js');
const require = createRequire(import.meta.url);

let srv: Awaited<ReturnType<typeof boot>>;
let sftp: Awaited<ReturnType<typeof sftpServer>>;
let ftp: any;
const sftpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-sftp-'));
const ftpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-ftp-'));
const { utils } = require('ssh2');
const userKey = utils.generateKeyPairSync('ecdsa', { bits: 256 });
let shop = '', sftpConn = '', sftpKeyConn = '', ftpConn = '';

before(async () => {
  srv = await boot({ listenAdmin: false, gateway: false });
  sftp = await sftpServer(sftpRoot, { user: 'partner', password: 'Sftp-pass-123', publicKey: userKey.public });
  const FtpSrv = require('ftp-srv');
  ftp = new FtpSrv({ url: `ftp://127.0.0.1:${port(19836)}`, pasv_url: '127.0.0.1', pasv_min: port(19837), pasv_max: port(19845), anonymous: false, greeting: 'test', log: { info() {}, debug() {}, trace() {}, warn() {}, error() {}, child() { return this; } } as any });
  ftp.on('login', ({ username, password }: any, resolve: any, reject: any) => (username === 'ftpuser' && password === 'Ftp-pass-123' ? resolve({ root: ftpRoot }) : reject(new Error('Bad login'))));
  await ftp.listen();
  setSecret('SFTP_PW', 'Sftp-pass-123');
  setSecret('SFTP_KEY', userKey.private);
  setSecret('FTP_PW', 'Ftp-pass-123');
  shop = projects.saveProject({ name: 'Remote files', config: { variables: [] } }).id;
  fs.mkdirSync(path.join(sftpRoot, 'partner'), { recursive: true });
  sftpConn = saveResource({ kind: 'sftp', name: 'Partner SFTP', project_id: shop, config: { host: '127.0.0.1', port: sftp.port, user: 'partner', auth: 'password', passwordSecret: 'SFTP_PW', baseFolder: '/partner' } }).id;
  sftpKeyConn = saveResource({ kind: 'sftp', name: 'Partner SFTP key', project_id: shop, config: { host: '127.0.0.1', port: sftp.port, user: 'partner', auth: 'private key', keySecret: 'SFTP_KEY', hostFingerprint: fingerprintOf(sftp.hostKeyRaw), baseFolder: '/partner' } }).id;
  ftpConn = saveResource({ kind: 'ftp', name: 'Old FTP', project_id: shop, config: { host: '127.0.0.1', port: port(19836), user: 'ftpuser', passwordSecret: 'FTP_PW', security: 'none', baseFolder: '/files' } }).id;
  fs.mkdirSync(path.join(ftpRoot, 'files'), { recursive: true });
});
after(async () => { await srv.stop(); await sftp.close(); await ftp.close().catch(() => {}); });

const run = async (nodes: any[], edges: any[]) => {
  const id = await engine.startRun({ doc: { name: 'Remote', nodes, edges }, projectId: shop });
  await engine.waitFor(id, 30000);
  const r: any = q.get('select id, status, error, state from runs where id = ?', id);
  return { status: r.status, error: r.error, out: runState(r.id)!.outputs };
};

test('paths stay inside the base folder', () => {
  assert.equal(remotePath('/data', 'inbox/a.csv'), '/data/inbox/a.csv');
  assert.equal(remotePath('/data', '/inbox/a.csv'), '/data/inbox/a.csv', 'a leading slash is still inside the base');
  assert.equal(remotePath('/', 'x/../y.txt'), '/y.txt');
  assert.throws(() => remotePath('/data', '../etc/passwd'), /outside the base folder/);
  assert.throws(() => remotePath('/data', 'inbox/../../secret'), /outside the base folder/);
});

test('test connection: SFTP shows the host key; a wrong fingerprint and a wrong password are refused; key sign-in works', async () => {
  const fp = fingerprintOf(sftp.hostKeyRaw);
  let r = await testResource({ kind: 'sftp', config: { host: '127.0.0.1', port: sftp.port, user: 'partner', auth: 'password', passwordSecret: 'SFTP_PW', baseFolder: '/partner' } });
  assert.equal(r.ok, true, r.message);
  assert.match(r.message, new RegExp(`Signed in to 127\\.0\\.0\\.1: 0 entries in /partner\\. Host key ${fp.replace(/[+/]/g, '\\$&')}`));
  r = await testResource({ kind: 'sftp', config: { host: '127.0.0.1', port: sftp.port, user: 'partner', auth: 'password', passwordSecret: 'SFTP_PW', hostFingerprint: 'SHA256:not-this-one', baseFolder: '/partner' } });
  assert.equal(r.ok, false);
  assert.match(r.message, /is not the expected SHA256:not-this-one/);
  setSecret('SFTP_BAD', 'wrong-password');
  r = await testResource({ kind: 'sftp', config: { host: '127.0.0.1', port: sftp.port, user: 'partner', auth: 'password', passwordSecret: 'SFTP_BAD', baseFolder: '/' } });
  assert.equal(r.ok, false);
  r = await testResource({ kind: 'sftp', config: { host: '127.0.0.1', port: sftp.port, user: 'partner', auth: 'private key', keySecret: 'SFTP_KEY', hostFingerprint: fp, baseFolder: '/partner' } });
  assert.equal(r.ok, true, r.message);
  assert.match(r.message, /\(as expected\)/);
  r = await testResource({ kind: 'ftp', config: { host: '127.0.0.1', port: port(19836), user: 'ftpuser', passwordSecret: 'FTP_PW', security: 'none', baseFolder: '/' } });
  assert.equal(r.ok, true, r.message);
});

for (const proto of ['SFTP', 'FTP'] as const) {
  test(`${proto}: write CSV from rows, append, list and read rows, copy, move, refuse overwrite, delete`, async () => {
    const conn = proto === 'SFTP' ? { protocol: 'SFTP', sftpConn: proto === 'SFTP' ? sftpKeyConn : '' } : { protocol: 'FTP', ftpConn };
    const s = node('start', 'Start', { payload: JSON.stringify({ rows: [{ id: 'A-1', amount: 100 }, { id: 'A-2', amount: 250 }], more: 'A-3,75' }) });
    const w = node('remoteWrite', 'Write', { ...conn, path: 'outbox/orders.csv', format: 'CSV from rows', rows: '{{input.rows}}', delimiter: ',', header: true, encoding: 'utf-8', lineEnding: 'LF', append: false, overwrite: true });
    const a = node('remoteWrite', 'Append', { ...conn, path: 'outbox/orders.csv', format: 'text', content: '{{trigger.more}}', encoding: 'utf-8', append: true, newline: true });
    const l = node('remoteList', 'List', { ...conn, folder: 'outbox', pattern: '*.csv', sort: 'name', max: 10, format: 'CSV rows', encoding: 'utf-8', delimiter: ',', header: true, skipRows: 0, trimValues: true, decimal: '.' });
    const rd = node('remoteRead', 'Read', { ...conn, path: 'outbox/orders.csv', format: 'lines', encoding: 'utf-8', skipRows: 0 });
    const cp = node('remoteMove', 'Copy', { ...conn, action: 'copy', from: 'outbox/orders.csv', to: 'archive/orders-copy.csv', overwrite: true });
    const mv = node('remoteMove', 'Move', { ...conn, action: 'move', from: 'outbox/orders.csv', to: 'done/orders.csv', overwrite: true });
    const r = await run([s, w, a, l, rd, cp, mv], [edge(s, w), edge(w, a), edge(a, l), edge(l, rd), edge(rd, cp), edge(cp, mv)]);
    assert.equal(r.status, 'done', r.error);
    assert.equal(r.out.Write.action, 'created');
    assert.equal(r.out.Write.path, proto === 'SFTP' ? '/partner/outbox/orders.csv' : '/files/outbox/orders.csv');
    assert.equal(r.out.Append.action, 'appended');
    assert.equal(r.out.List.count, 1);
    assert.deepEqual(r.out.List.files[0].rows.map((x: any) => x.id), ['A-1', 'A-2', 'A-3'], 'the appended line is a third row');
    assert.equal(r.out.Read.count, 4, 'a header and three rows');
    assert.equal(r.out.Copy.action, 'copied');
    assert.equal(r.out.Move.action, 'moved');
    const base = proto === 'SFTP' ? path.join(sftpRoot, 'partner') : path.join(ftpRoot, 'files');
    assert.ok(fs.existsSync(path.join(base, 'done', 'orders.csv')));
    assert.ok(fs.existsSync(path.join(base, 'archive', 'orders-copy.csv')));
    assert.ok(!fs.existsSync(path.join(base, 'outbox', 'orders.csv')));

    const again = node('remoteWrite', 'Again', { ...conn, path: 'done/orders.csv', format: 'text', content: 'x', append: false, overwrite: false });
    const r2 = await run([s, again], [edge(s, again)]);
    assert.equal(r2.status, 'failed');
    assert.match(r2.error, /already exists/);
    const escape = node('remoteRead', 'Escape', { ...conn, path: '../../etc/passwd', format: 'text' });
    assert.match((await run([s, escape], [edge(s, escape)])).error, /outside the base folder/);
    const del = node('remoteMove', 'Delete', { ...conn, action: 'delete', from: 'archive/orders-copy.csv' });
    const empty = node('remoteList', 'Nothing', { ...conn, folder: 'archive', pattern: '*.csv', format: 'do not read' });
    const none = node('log', 'Empty', { message: 'none' });
    const r3 = await run([s, del, empty, none], [edge(s, del), edge(del, empty), edge(empty, none, 'empty')]);
    assert.equal(r3.status, 'done', r3.error);
    assert.equal(r3.out.Delete.action, 'deleted');
    assert.ok(r3.out.Empty, 'no file left: the empty output was taken');
  });
}

test('remote file trigger: a new file starts the Sutra once it stops changing, with its rows; then it is moved', async () => {
  fs.mkdirSync(path.join(sftpRoot, 'partner', 'inbox'), { recursive: true });
  const t = node('remoteTrigger', 'New file', { protocol: 'SFTP', sftpConn, folder: 'inbox', pattern: '*.csv', pollSeconds: 1, after: 'move to a folder', moveTo: 'inbox/done', format: 'CSV rows', encoding: 'utf-8', delimiter: ',', header: true, skipRows: 0, trimValues: true, decimal: '.', maxMb: 5 });
  const l = node('log', 'Got it', { message: '{{input.name}}: {{input.rows | length}} rows' });
  const f = flows.saveFlow(undefined, { name: 'Partner pickup', nodes: [t, l], edges: [edge(t, l)] }, shop);
  flows.deploy(f.id);
  fs.writeFileSync(path.join(sftpRoot, 'partner', 'inbox', 'batch-1.csv'), 'id,amount\nB-1,10\nB-2,20\n');
  fs.writeFileSync(path.join(sftpRoot, 'partner', 'inbox', 'notes.txt'), 'not matched');
  let run1: any;
  for (let i = 0; i < 100 && !run1; i++) { await new Promise(r => setTimeout(r, 200)); run1 = q.get<any>(`select id, status, state from runs where flow_id = ? and status = 'done'`, f.id); }
  assert.ok(run1, 'the trigger started a run');
  const out = runState(run1.id)!.outputs;
  assert.equal(out['New file'].name, 'batch-1.csv');
  assert.deepEqual(out['New file'].rows.map((x: any) => x.id), ['B-1', 'B-2']);
  for (let i = 0; i < 50 && fs.existsSync(path.join(sftpRoot, 'partner', 'inbox', 'batch-1.csv')); i++) await new Promise(r => setTimeout(r, 100));
  assert.ok(fs.existsSync(path.join(sftpRoot, 'partner', 'inbox', 'done', 'batch-1.csv')), 'moved after the run');
  assert.ok(fs.existsSync(path.join(sftpRoot, 'partner', 'inbox', 'notes.txt')), 'other files are left alone');
  await new Promise(r => setTimeout(r, 2500));
  assert.equal(Number(q.get<any>('select count(*) n from runs where flow_id = ?', f.id).n), 1, 'started once');
  flows.undeploy(f.id);
});

test('time limits: connection attempts with waits, a response limit per operation, and a longer default step limit', async () => {
  const { timingOf } = await import('../server/src/connectors/remote.js');
  assert.deepEqual(timingOf({}), { connectMs: 30000, responseMs: 60000, attempts: 3, retryWaitMs: 5000, keepaliveMs: 15000 });
  assert.equal(timingOf({ timeoutSec: 45 }).connectMs, 45000, 'older connections keep their time limit');
  // Nothing listens on this port: every attempt fails, then the step fails with how many were made.
  const t0 = Date.now();
  let r = await testResource({ kind: 'sftp', config: { host: '127.0.0.1', port: 1, user: 'x', auth: 'password', passwordSecret: 'SFTP_PW', connectSec: 2, attempts: 2, retryWaitSec: 0.2 } });
  assert.equal(r.ok, false);
  assert.match(r.message, /after 2 attempts/);
  assert.ok(Date.now() - t0 < 8000);
  // A wrong password is not retried.
  r = await testResource({ kind: 'sftp', config: { host: '127.0.0.1', port: sftp.port, user: 'partner', auth: 'password', passwordSecret: 'SFTP_BAD', attempts: 3, retryWaitSec: 5 } });
  assert.equal(r.ok, false);
  assert.doesNotMatch(r.message, /attempts/);
  // A slow server: a read that waits longer than the response limit fails with a clear message.
  const slowRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-slow-'));
  fs.writeFileSync(path.join(slowRoot, 'big.txt'), 'hello');
  const slow = await sftpServer(slowRoot, { user: 'partner', password: 'Sftp-pass-123', slowReadMs: 2500 });
  try {
    const conn = saveResource({ kind: 'sftp', name: 'Far away SFTP', project_id: shop, config: { host: '127.0.0.1', port: slow.port, user: 'partner', auth: 'password', passwordSecret: 'SFTP_PW', baseFolder: '/', responseSec: 1 } }).id;
    const s = node('start', 'Start'), rd = node('remoteRead', 'Read', { protocol: 'SFTP', sftpConn: conn, path: 'big.txt', format: 'text', encoding: 'utf-8' });
    const res = await run([s, rd], [edge(s, rd)]);
    assert.equal(res.status, 'failed');
    assert.match(res.error, /Reading \/big.txt took longer than 1 s \(Response time limit of the connection\)/);
  } finally { await slow.close(); }
  assert.equal(engine.activity('remoteRead')!.timeoutMs, 600000, 'remote steps may take up to 10 minutes by default');
  assert.equal(engine.activity('log')!.timeoutMs, undefined);
});
