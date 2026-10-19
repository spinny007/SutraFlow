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
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { testEnv, port } from './helpers.js';

/**
 * Moving the server's own data from SQLite to PostgreSQL from the Admin Console's Database page:
 * the connection is checked before saving, the button refuses until it is tested, and (with a real
 * PostgreSQL server in SUTRA_TEST_PG_URL) the whole move: a SutraFlow started by the launcher is
 * stopped, copied, switched in its sutraflow.env, started on PostgreSQL and checked, with the data.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
testEnv(20350);
process.env.SUTRA_ADMIN_TOKEN = 'dbmigrate-admin-token-0123456789';
const { boot } = await import('../server/src/index.js');
let srv: Awaited<ReturnType<typeof boot>>;
const H = { authorization: `Bearer ${process.env.SUTRA_ADMIN_TOKEN}` };
before(async () => { srv = await boot({ listenAdmin: false }); });
after(async () => { await srv.stop(); });
const call = (method: string, url: string, payload?: any) => srv.admin.inject({ method: method as any, url, payload, headers: H });

test('the Database page shows SQLite in use; a connection is checked before it is saved; Migrate waits for a tested one', async () => {
  const info = (await call('GET', '/api/server/database')).json();
  assert.equal(info.kind, 'sqlite');
  assert.match(info.where, /sutra\.db$/);
  assert.equal(info.target, null);
  assert.match(info.scripts.windows, /tools[\\/]migrate-to-postgres\.cmd$/);
  assert.equal((await call('POST', '/api/server/database/migrate', {})).json().error, 'Save the PostgreSQL connection first');
  assert.match((await call('PUT', '/api/server/database/target', { host: 'db.local', port: 5432, database: 'bad name', user: 'u' })).json().error, /database name/);
  const saved = (await call('PUT', '/api/server/database/target', { host: '127.0.0.1', port: port(20359), database: 'sutraflow', user: 'sutra', password: 'pw-123', ssl: false })).json();
  assert.equal(saved.hasPassword, true);
  assert.equal('password' in saved, false, 'the password never comes back');
  assert.equal((await call('POST', '/api/server/database/migrate', {})).json().error, 'Test the PostgreSQL connection first');
  const t = (await call('POST', '/api/server/database/test', { host: '127.0.0.1', port: port(20359), database: 'sutraflow', user: 'sutra' })).json();
  assert.equal(t.ok, false);
  assert.match(t.message, /Nothing answers at 127\.0\.0\.1:\d+/);
  assert.equal((await call('GET', '/health')).json().database, 'sqlite');
});

test('the migration scripts exist for Windows (CRLF) and Linux (LF) and run the same Node script', () => {
  const cmd = fs.readFileSync(path.join(root, 'tools', 'migrate-to-postgres.cmd'), 'utf8');
  const sh = fs.readFileSync(path.join(root, 'tools', 'migrate-to-postgres.sh'), 'utf8');
  assert.ok(cmd.includes('\r\n') && cmd.includes('migrate-to-postgres.mjs" --env'));
  assert.ok(!sh.includes('\r') && sh.startsWith('#!/bin/sh') && sh.includes('migrate-to-postgres.mjs" --env'));
});

test('the whole move on a real PostgreSQL: stop, copy, switch, start, check', { skip: !process.env.SUTRA_TEST_PG_URL && 'set SUTRA_TEST_PG_URL to run against a PostgreSQL server', timeout: 240000 }, async () => {
  const { default: pg } = await import('pg');
  const admin = new pg.Client({ connectionString: process.env.SUTRA_TEST_PG_URL! });
  await admin.connect();
  const dbName = `sutra_migrate_test_${Date.now()}`;
  const u = new URL(process.env.SUTRA_TEST_PG_URL!);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-mig-'));
  const envFile = path.join(dir, 'sutraflow.env');
  const studio = port(20360);
  fs.writeFileSync(envFile, [`SUTRA_DATA_DIR=${path.join(dir, 'data').split(path.sep).join('/')}`, `STUDIO_PORT=${studio}`, `STUDIO_GATEWAY_HTTP=${port(20361)}`, `STUDIO_GATEWAY_HTTPS=${port(20362)}`, 'SUTRA_ENVIRONMENT=development', '# SUTRA_DB=postgres://...', ''].join('\r\n'));
  // The launcher reads SUTRA_ settings from the environment over the file: give it only the file.
  const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(SUTRA_|STUDIO_|ENGINE_)/.test(k) || k === 'SUTRA_TEST_PG_URL'));
  const launcher = (...a: string[]) => spawnSync(process.execPath, [path.join(root, 'bin', 'sutraflow.mjs'), ...a], { cwd: root, env: { ...cleanEnv, SUTRAFLOW_ENV: envFile }, encoding: 'utf8' });
  const base = `http://127.0.0.1:${studio}`;
  try {
    const s = launcher('start');
    assert.equal(s.status, 0, s.stdout + s.stderr);
    const token = fs.readFileSync(path.join(dir, 'data', 'admin-token.txt'), 'utf8').trim();
    const api = async (method: string, p: string, body?: unknown) => { const r = await fetch(base + p, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json() }; };
    assert.equal((await api('POST', '/api/projects', { name: 'Kept across the move' })).status, 200);
    const target = { host: u.hostname, port: Number(u.port || 5432), database: dbName, user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), ssl: false };
    assert.equal((await api('PUT', '/api/server/database/target', target)).status, 200);
    const t = await api('POST', '/api/server/database/test', target);
    assert.equal(t.body.ok, true, t.body.message);
    assert.ok(t.body.notes.some((n: string) => /will be made/.test(n)));
    const m = await api('POST', '/api/server/database/migrate', { replace: false });
    assert.equal(m.status, 200, JSON.stringify(m.body));
    // The page waits through the restart the same way: status while up, health while down.
    let h: any = null;
    for (let i = 0; i < 180 && h?.database !== 'postgres'; i++) {
      await new Promise(r => setTimeout(r, 1000));
      try { h = await (await fetch(`${base}/health`)).json(); } catch { h = null; }
    }
    const st = JSON.parse(fs.readFileSync(path.join(dir, 'data', 'migration', 'status.json'), 'utf8'));
    assert.equal(h?.database, 'postgres', st.log.join('\n'));
    for (let i = 0; i < 20 && st.state !== 'done'; i++) { await new Promise(r => setTimeout(r, 500)); Object.assign(st, JSON.parse(fs.readFileSync(path.join(dir, 'data', 'migration', 'status.json'), 'utf8'))); }
    assert.equal(st.state, 'done', st.log.join('\n'));
    const env = fs.readFileSync(envFile, 'utf8');
    assert.match(env, new RegExp(`^SUTRA_DB=postgres://[^:@/]+@${u.hostname}:\\d+/${dbName}\\r?$`, 'm'), 'the address without the password');
    if (u.password) assert.match(env, /^SUTRA_DB_PASSWORD=/m);
    assert.ok(env.includes('\r\n'), 'the file keeps its line endings');
    assert.ok(fs.existsSync(st.envBackup), 'the old settings are kept');
    const projects = (await api('GET', '/api/projects')).body;
    assert.ok(projects.some((p: any) => p.name === 'Kept across the move'), 'the data came along');
    const info = (await api('GET', '/api/server/database')).body;
    assert.equal(info.kind, 'postgres');
    assert.ok(!info.where.includes(target.password) || !target.password);
  } finally {
    launcher('stop', 'all', '--force');
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
    await admin.end();
  }
});

test('a failed copy changes nothing: sutraflow.env stays on SQLite and SutraFlow comes back', { skip: !process.env.SUTRA_TEST_PG_URL && 'set SUTRA_TEST_PG_URL to run against a PostgreSQL server', timeout: 240000 }, async () => {
  const { default: pg } = await import('pg');
  const admin = new pg.Client({ connectionString: process.env.SUTRA_TEST_PG_URL! });
  await admin.connect();
  const dbName = `sutra_migrate_busy_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${dbName}`);
  const u = new URL(process.env.SUTRA_TEST_PG_URL!); u.pathname = `/${dbName}`;
  const busy = new pg.Client({ connectionString: u.toString() });
  await busy.connect();
  await busy.query("create table settings(key text primary key, value text not null)");
  await busy.query("insert into settings values('someone.else', '1')");
  await busy.end();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-mig2-'));
  const envFile = path.join(dir, 'sutraflow.env');
  const studio = port(20370);
  const original = [`SUTRA_DATA_DIR=${path.join(dir, 'data').split(path.sep).join('/')}`, `STUDIO_PORT=${studio}`, `STUDIO_GATEWAY_HTTP=${port(20371)}`, `STUDIO_GATEWAY_HTTPS=${port(20372)}`, ''].join('\n');
  fs.writeFileSync(envFile, original);
  const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(SUTRA_|STUDIO_|ENGINE_)/.test(k)));
  const launcher = (...a: string[]) => spawnSync(process.execPath, [path.join(root, 'bin', 'sutraflow.mjs'), ...a], { cwd: root, env: { ...cleanEnv, SUTRAFLOW_ENV: envFile }, encoding: 'utf8' });
  try {
    assert.equal(launcher('start').status, 0);
    const r = spawnSync(process.execPath, [path.join(root, 'tools', 'migrate-to-postgres.mjs'), '--env', envFile, '--url', u.toString()], { cwd: root, env: cleanEnv, encoding: 'utf8' });
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /already has data in settings/);
    assert.match(r.stdout, /The copy did not finish; sutraflow\.env is unchanged/);
    assert.equal(fs.readFileSync(envFile, 'utf8'), original);
    const h = await (await fetch(`http://127.0.0.1:${studio}/health`)).json();
    assert.equal(h.database, 'sqlite', 'back up on SQLite');
  } finally {
    launcher('stop', 'all', '--force');
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
    await admin.end();
  }
});

/**
 * A PostgreSQL of its own, as a remote server would be: password sign-in (SCRAM) and SSL required,
 * with a self-signed certificate. Made in a temporary folder from the PostgreSQL programs in
 * SUTRA_TEST_PG_BIN (initdb, pg_ctl) and openssl, on its own port; removed afterwards.
 */
const pgBin = process.env.SUTRA_TEST_PG_BIN;
const exe = (n: string) => path.join(pgBin || '', process.platform === 'win32' ? `${n}.exe` : n);
test('a password-protected PostgreSQL that requires SSL: wrong password, no SSL, unchecked certificate, then the whole move', { skip: !pgBin && 'set SUTRA_TEST_PG_BIN to the PostgreSQL bin folder (initdb, pg_ctl)', timeout: 300000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-pgsec-'));
  const data = path.join(dir, 'pgdata');
  const pgPort = port(20380);
  const password = 'S3cret p@ss:/#?&word';
  fs.writeFileSync(path.join(dir, 'pw.txt'), password);
  const run = (cmd: string, args: string[]) => { const r = spawnSync(cmd, args, { encoding: 'utf8' }); assert.equal(r.status, 0, `${cmd} ${args.join(' ')}\n${r.stdout}${r.stderr}`); return r; };
  run(exe('initdb'), ['-D', data, '-U', 'sutra_owner', '--auth=scram-sha-256', `--pwfile=${path.join(dir, 'pw.txt')}`, '-E', 'UTF8', '--locale=C']);
  run(process.env.SUTRA_TEST_OPENSSL || 'openssl', ['req', '-new', '-x509', '-days', '2', '-nodes', '-subj', '/CN=localhost', '-keyout', path.join(data, 'server.key'), '-out', path.join(data, 'server.crt')]);
  fs.appendFileSync(path.join(data, 'postgresql.conf'), `\nport = ${pgPort}\nlisten_addresses = '127.0.0.1'\nssl = on\n`);
  fs.writeFileSync(path.join(data, 'pg_hba.conf'), 'hostssl all all 127.0.0.1/32 scram-sha-256\n');
  // pg_ctl leaves the server running with the handles it was given: no pipes, or this would wait for ever.
  const started = spawnSync(exe('pg_ctl'), ['-D', data, '-l', path.join(dir, 'pg.log'), '-w', 'start'], { stdio: 'ignore', timeout: 60000 });
  assert.equal(started.status, 0, fs.existsSync(path.join(dir, 'pg.log')) ? fs.readFileSync(path.join(dir, 'pg.log'), 'utf8') : 'pg_ctl start failed');
  const base = { host: '127.0.0.1', port: pgPort, user: 'sutra_owner' };
  try {
    const t = async (o: any) => (await call('POST', '/api/server/database/test', { ...base, database: 'sutraflow', ...o })).json();
    // A server just started under a busy suite can reset its first SSL connections: try again briefly.
    let wrong = await t({ password: 'wrong', sslMode: 'require' });
    for (let i = 0; i < 10 && /ECONNRESET|ECONNREFUSED/.test(wrong.message); i++) { await new Promise(r => setTimeout(r, 500)); wrong = await t({ password: 'wrong', sslMode: 'require' }); }
    assert.match(wrong.message, /refused the password of sutra_owner/);
    assert.match((await t({ password, sslMode: 'off' })).message, /does not accept sutra_owner from this machine.*turn SSL on/);
    assert.match((await t({ password, sslMode: 'verify' })).message, /certificate could not be checked/);
    const ok = await t({ password, sslMode: 'require' });
    assert.equal(ok.ok, true, ok.message);
    assert.ok(ok.notes.includes('Signed in with the password, over SSL'), ok.notes.join('\n'));
    assert.ok(ok.notes.some((n: string) => /will be made/.test(n)));

    // The whole move with the password and SSL, as from the Database page.
    const sdir = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-mig3-'));
    const envFile = path.join(sdir, 'sutraflow.env');
    const studio = port(20390);
    fs.writeFileSync(envFile, [`SUTRA_DATA_DIR=${path.join(sdir, 'data').split(path.sep).join('/')}`, `STUDIO_PORT=${studio}`, `STUDIO_GATEWAY_HTTP=${port(20391)}`, `STUDIO_GATEWAY_HTTPS=${port(20392)}`, ''].join('\n'));
    const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(SUTRA_|STUDIO_|ENGINE_)/.test(k)));
    const launcher = (...a: string[]) => spawnSync(process.execPath, [path.join(root, 'bin', 'sutraflow.mjs'), ...a], { cwd: root, env: { ...cleanEnv, SUTRAFLOW_ENV: envFile }, encoding: 'utf8' });
    const web = `http://127.0.0.1:${studio}`;
    try {
      assert.equal(launcher('start').status, 0);
      const token = fs.readFileSync(path.join(sdir, 'data', 'admin-token.txt'), 'utf8').trim();
      const api = async (method: string, p: string, body?: unknown) => { const r = await fetch(web + p, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json() }; };
      await api('POST', '/api/projects', { name: 'Remote and secure' });
      const target = { ...base, database: 'sutraflow', password, sslMode: 'require' };
      assert.equal((await api('PUT', '/api/server/database/target', target)).status, 200);
      const saved = (await api('POST', '/api/server/database/test', { ...target, password: undefined })).body;
      assert.equal(saved.ok, true, `the saved password is used: ${saved.message}`);
      assert.equal((await api('POST', '/api/server/database/migrate', {})).status, 200);
      // Wait for the migration tool to finish (it checks the new start itself) before looking or stopping.
      const stPath = path.join(sdir, 'data', 'migration', 'status.json');
      let st: any = {};
      for (let i = 0; i < 300 && !['done', 'rolled back', 'failed'].includes(st.state); i++) { await new Promise(r => setTimeout(r, 1000)); try { st = JSON.parse(fs.readFileSync(stPath, 'utf8')); } catch { /* being written */ } }
      assert.equal(st.state, 'done', (st.log || []).join('\n'));
      let h: any = null;
      try { h = await (await fetch(`${web}/health`)).json(); } catch { h = null; }
      assert.equal(h?.database, 'postgres', st.log.join('\n'));
      const env = fs.readFileSync(envFile, 'utf8');
      assert.match(env, new RegExp(`^SUTRA_DB=postgres://sutra_owner@127\.0\.0\.1:${pgPort}/sutraflow[?]sslmode=no-verify$`, 'm'));
      assert.ok(env.split(/\r?\n/).some(l => l.startsWith('SUTRA_DB_PASSWORD=') && l.includes('S3cret p@ss:/#?&word')), 'the password apart from the address');
      assert.ok(!/^SUTRA_DB=.*S3cret/m.test(env), 'never inside the address');
      assert.ok((await api('GET', '/api/projects')).body.some((p: any) => p.name === 'Remote and secure'));
      const log = fs.readFileSync(path.join(sdir, 'data', 'migration', 'migration.log'), 'utf8') + st.log.join('\n');
      assert.ok(!log.includes('S3cret'), 'the password is not in the migration log');
    } finally { launcher('stop', 'all', '--force'); }
  } finally {
    spawnSync(exe('pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop'], { stdio: 'ignore', timeout: 60000 });
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* files in use */ }
  }
});
