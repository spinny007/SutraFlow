#!/usr/bin/env node
/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
/**
 * Moves SutraFlow from SQLite to PostgreSQL, on Windows and Linux. Run by the Database page of the
 * Admin Console (Migrate now), or by hand through tools/migrate-to-postgres.cmd (Windows) or
 * tools/migrate-to-postgres.sh (Linux):
 *
 *   1. stops SutraFlow gracefully (running steps finish) with the launcher;
 *   2. copies every table to PostgreSQL (sutra db migrate): the connection saved on the Database page,
 *      or --url postgres://user:password@host:5432/sutraflow; the database is made when missing;
 *   3. points sutraflow.env at PostgreSQL (SUTRA_DB, and the password as SUTRA_DB_PASSWORD), keeping
 *      a copy of the old file;
 *   4. starts SutraFlow again (and the engine when it was running) and checks it uses PostgreSQL;
 *   5. on any failure puts the old sutraflow.env back and starts SutraFlow on SQLite again.
 *
 * The SQLite file is not changed, so it remains a backup. Progress goes to the console and to
 * <data>/migration/status.json, which the Admin Console shows.
 *
 * Options: --env <sutraflow.env>  --data <data folder>  --url <postgres://...>  --replace (overwrite
 * SutraFlow tables already in the target database)
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = k => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined; };
const envFile = path.resolve(opt('env') || process.env.SUTRAFLOW_ENV || path.join(HOME, 'sutraflow.env'));

function readEnvFile(file) {
  const vals = {};
  if (!fs.existsSync(file)) return vals;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith('#')) continue;
    vals[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return vals;
}
const settings = () => ({ ...readEnvFile(envFile), ...Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(SUTRA_|STUDIO_|ENGINE_)/.test(k) && k !== 'SUTRA_DB' && k !== 'SUTRA_DB_PASSWORD')) });
const s0 = settings();
const dataDir = path.resolve(opt('data') || path.resolve(HOME, s0.SUTRA_DATA_DIR || 'data'));
const node = process.env.SUTRA_NODE || s0.SUTRA_NODE || process.execPath;
const host = (s0.SUTRA_ADMIN_HOST || '127.0.0.1') === '0.0.0.0' ? '127.0.0.1' : (s0.SUTRA_ADMIN_HOST || '127.0.0.1');
const studioUrl = `http://${host}:${Number(s0.STUDIO_PORT || 4800)}`;

// ---------- progress ----------
const statusPath = path.join(dataDir, 'migration', 'status.json');
let status = (() => { try { return JSON.parse(fs.readFileSync(statusPath, 'utf8')); } catch { return { log: [] }; } })();
if (!['starting'].includes(status.state)) status = { log: [], startedAt: new Date().toISOString() };
const say = (state, line, extra = {}) => {
  const stamp = new Date().toISOString();
  if (line) { console.log(line); status.log = [...(status.log || []), `${stamp.slice(11, 19)} ${line}`].slice(-200); }
  status = { ...status, ...extra, state, at: stamp };
  fs.mkdirSync(path.dirname(statusPath), { recursive: true });
  fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
};

/** The launcher (bin/sutraflow.mjs) with this sutraflow.env: stop, start, status. */
const launcher = (...args) => {
  const r = spawnSync(node, [path.join(HOME, 'bin', 'sutraflow.mjs'), ...args], { cwd: HOME, env: { ...process.env, SUTRAFLOW_ENV: envFile, SUTRA_DATA_DIR: dataDir }, encoding: 'utf8', windowsHide: true });
  for (const l of `${r.stdout || ''}${r.stderr || ''}`.split(/\r?\n/).filter(Boolean)) say(status.state, `  ${l}`);
  return r.status ?? 1;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
// A new connection each time: a kept one may still lead to the SutraFlow that was stopped before the copy.
async function health() { try { const r = await fetch(`${studioUrl}/health`, { headers: { connection: 'close' }, signal: AbortSignal.timeout(3000) }); return r.ok ? await r.json() : null; } catch { return null; } }
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const enginePid = () => { try { const p = Number(fs.readFileSync(path.join(dataDir, 'run', 'engine.pid'), 'utf8')); return p && alive(p) ? p : 0; } catch { return 0; } };

async function main() {
  say('stopping', `SutraFlow ${HOME}`, { startedAt: status.startedAt || new Date().toISOString() });
  say('stopping', `Settings ${envFile}; data ${dataDir}`);
  if (/^postgres/i.test(readEnvFile(envFile).SUTRA_DB || '')) { say('failed', 'sutraflow.env already points at PostgreSQL (SUTRA_DB); nothing to do', { message: 'Already on PostgreSQL' }); return 1; }
  if (!fs.existsSync(path.join(HOME, 'dist', 'server', 'cli.js'))) { say('failed', 'SutraFlow is not built (dist/server/cli.js missing): run sutraflow setup first', { message: 'Not built' }); return 1; }
  const wasEngine = !!enginePid();
  const wasRunning = !!(await health());

  // 1. Stop: running steps finish first.
  say('stopping', `1/4 Stopping SutraFlow gracefully${wasEngine ? ' (studio and engine)' : ''}`);
  if (launcher('stop', 'all') !== 0) launcher('stop', 'all', '--force');
  for (let i = 0; i < 20 && await health(); i++) await sleep(500);
  if (await health()) { say('failed', 'SutraFlow did not stop; nothing was changed', { message: 'Could not stop SutraFlow' }); return 1; }

  // 2. Copy, and switch sutraflow.env (sutra db migrate does both, so the password never passes through here).
  say('copying', '2/4 Copying the data to PostgreSQL');
  const env = { ...process.env, SUTRA_DATA_DIR: dataDir, SUTRAFLOW_ENV: envFile };
  delete env.SUTRA_DB; delete env.SUTRA_DB_PASSWORD; delete env.SUTRA_SERVER;
  const args = ['--disable-warning=ExperimentalWarning', path.join(HOME, 'dist', 'server', 'cli.js'), 'db', 'migrate', '--write-env', envFile, ...(argv.includes('--replace') ? ['--replace'] : []), ...(opt('url') ? ['--url', opt('url')] : [])];
  const r = spawnSync(node, args, { cwd: HOME, env, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  let result = null;
  for (const l of `${r.stdout || ''}${r.stderr || ''}`.split(/\r?\n/).filter(Boolean)) {
    if (l.startsWith('RESULT ')) { try { result = JSON.parse(l.slice(7)); } catch { /* below */ } } else say('copying', `  ${l}`);
  }
  if (r.status !== 0 || !result) {
    say('failed', `The copy did not finish${r.error ? `: ${r.error.message}` : ''}; sutraflow.env is unchanged. Starting SutraFlow on SQLite again.`, { message: 'The copy failed; SutraFlow stays on SQLite' });
    if (wasRunning) launcher('start');
    if (wasEngine) launcher('start', 'engine');
    return 1;
  }
  say('switching', `3/4 Copied ${result.rows} rows in ${result.tables} tables to ${result.url}; sutraflow.env now uses PostgreSQL (old file kept as ${path.basename(result.backup)})`, { rows: result.rows, tables: result.tables, target: result.url, envBackup: result.backup });

  // 3. Start on PostgreSQL and check.
  say('restarting', '4/4 Starting SutraFlow on PostgreSQL');
  const started = launcher('start') === 0;
  if (wasEngine) launcher('start', 'engine');
  let h = null;
  for (let i = 0; i < 60 && !(h && h.database === 'postgres'); i++) { h = await health(); if (!h) await sleep(1000); }
  say('checking', h ? `SutraFlow answers, database: ${h.database}` : 'SutraFlow does not answer');
  if (started && h && h.database === 'postgres') {
    say('done', `Migration complete: SutraFlow ${h.version} runs on PostgreSQL. The SQLite file ${path.join(dataDir, 'sutra.db')} is unchanged and can be kept as a backup.`, { message: 'SutraFlow now uses PostgreSQL' });
    return 0;
  }
  // 4. Roll back: the old settings, SQLite again.
  say('rolled back', 'SutraFlow did not start on PostgreSQL: putting the SQLite settings back', { message: 'Rolled back to SQLite: SutraFlow did not start on PostgreSQL (see the log)' });
  launcher('stop', 'all', '--force');
  fs.copyFileSync(result.backup, envFile);
  launcher('start');
  if (wasEngine) launcher('start', 'engine');
  say('rolled back', `SutraFlow runs on SQLite again; the PostgreSQL copy is left in place. Output log: ${path.join(dataDir, 'logs', 'studio.out.log')}`);
  return 1;
}

main().then(code => process.exit(code), e => { say('failed', `Unexpected error: ${e.stack || e.message}`, { message: e.message }); process.exit(1); });
