/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { Worker, MessageChannel, receiveMessageOnPort, type MessagePort } from 'node:worker_threads';
import { config, ensureDataDir } from './config.js';

/**
 * Storage. Every read and write goes through q and tx below, on one of two backends:
 *  - SQLite (built into Node): the default; one server, or several engines on one host.
 *  - PostgreSQL (SUTRA_DB=postgres://...): several engines on several machines. Node's PostgreSQL
 *    drivers are asynchronous while this layer is synchronous (as SQLite is), so a worker thread holds
 *    the connection and the caller waits for each answer (see pgworker.ts). Write transactions take a
 *    cluster-wide lock, matching SQLite, so engines never overwrite each other's run state.
 *    SUTRA_DB=pglite:memory runs PostgreSQL inside Node, used by the tests.
 */
interface Backend {
  kind: 'sqlite' | 'postgres';
  get(sql: string, args: any[]): any;
  all(sql: string, args: any[]): any[];
  run(sql: string, args: any[]): { changes: number };
  exec(sql: string): void;
  begin(key?: string): void;
  commit(): void;
  rollback(): void;
  close(): void;
}
let db: Backend | null = null;

function sqliteBackend(file: string): Backend {
  const d = new DatabaseSync(file);
  // busy_timeout: several engines on one host may share the file; a writer waits briefly instead of failing.
  d.exec('pragma busy_timeout = 10000');
  // Switching a new file to WAL does not always wait for another engine setting up the same file
  // (SQLite answers "database is locked" at once): try again for a while.
  const nap = new Int32Array(new SharedArrayBuffer(4));
  for (let i = 0; ; i++) {
    try { d.exec('pragma journal_mode = wal; pragma synchronous = normal; pragma foreign_keys = on;'); break; } catch (e: any) {
      if (!/locked|busy/i.test(String(e?.message)) || i >= 200) throw e;
      Atomics.wait(nap, 0, 0, 50);
    }
  }
  return {
    kind: 'sqlite',
    get: (sql, a) => d.prepare(sql).get(...a),
    all: (sql, a) => d.prepare(sql).all(...a),
    run: (sql, a) => { const r = d.prepare(sql).run(...a); return { changes: Number(r.changes) }; },
    exec: sql => d.exec(sql),
    begin: () => d.exec('begin immediate'),
    commit: () => d.exec('commit'),
    rollback: () => d.exec('rollback'),
    close: () => d.close(),
  };
}

/** ? placeholders to $1, $2 ... (outside quoted text). */
function toPg(sql: string) {
  let n = 0, out = '', quote = '';
  for (const ch of sql) {
    if (quote) { if (ch === quote) quote = ''; out += ch; continue; }
    if (ch === "'" || ch === '"') { quote = ch; out += ch; continue; }
    out += ch === '?' ? `$${++n}` : ch;
  }
  return out;
}

/** A 63-bit-safe lock number for a key (FNV-1a), never the shared lock's number. */
export function lockId(key: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return 1000000 + h;
}

function postgresBackend(url: string): Backend {
  const ctrl = new SharedArrayBuffer(4);
  const flag = new Int32Array(ctrl);
  const { port1, port2 } = new MessageChannel();
  const here = import.meta.url;
  const file = new URL(here.endsWith('.ts') ? './pgworker.ts' : './pgworker.js', here);
  const worker = new Worker(file, { workerData: { url, ctrl, port: port2 }, transferList: [port2 as unknown as MessagePort] });
  worker.unref();
  const nap = new Int32Array(new SharedArrayBuffer(4));
  let seq = 0;
  const call = (sql: string, params: any[], mode: string) => {
    const id = ++seq;
    Atomics.store(flag, 0, 0);
    port1.postMessage({ id, sql: mode === 'exec' ? sql : toPg(sql), params: params.map(v => (typeof v === 'boolean' ? (v ? 1 : 0) : v === undefined ? null : v)), mode });
    if (Atomics.wait(flag, 0, 0, 120000) === 'timed-out') throw new Error('PostgreSQL did not answer within 120 seconds');
    // The flag can be set a moment before the answer reaches this port (seen under heavy load): wait for
    // it briefly, and skip any answer that is not for this statement.
    let m: any;
    for (let i = 0; i < 5000; i++) {
      m = receiveMessageOnPort(port1)?.message;
      if (m && m.id === id) break;
      m = undefined;
      Atomics.wait(nap, 0, 0, 1);
    }
    if (!m) throw new Error('PostgreSQL bridge: no answer');
    if (!m.ok) throw Object.assign(new Error(m.error), { code: m.code });
    return m as { rows: any[]; changes: number };
  };
  return {
    kind: 'postgres',
    get: (sql, a) => call(sql, a, 'get').rows[0],
    all: (sql, a) => call(sql, a, 'all').rows,
    run: (sql, a) => ({ changes: call(sql, a, 'run').changes }),
    exec: sql => { call(sql, [], 'exec'); },
    // A transaction about one run (or one Sutra's queue) locks only that key, so engines save different
    // runs at the same time; other write transactions (deploys, settings) take one shared lock, like
    // SQLite's begin immediate. Begin and the lock are one round trip.
    begin: (key?: string) => { call(`begin; select pg_advisory_xact_lock(${key ? lockId(key) : 424242})`, [], 'exec'); },
    commit: () => { call('commit', [], 'run'); },
    rollback: () => { call('rollback', [], 'run'); },
    close: () => { port1.close(); void worker.terminate(); },
  };
}

/** The SQLite schema for PostgreSQL: 64-bit integers (times in ms), floating point, serial ids. */
const pgSchema = (sql: string) => sql
  .replace(/integer primary key autoincrement/g, 'bigserial primary key')
  .replace(/\binteger\b/g, 'bigint')
  .replace(/\breal\b/g, 'double precision');

const SCHEMA = `
create table if not exists flows(
  id text primary key, name text not null, doc text not null,
  version integer not null default 0, updated_at text not null);
create table if not exists flow_versions(
  flow_id text not null, version integer not null, doc text not null,
  note text, created_at text not null, primary key(flow_id, version));
create table if not exists deployments(
  flow_id text primary key, version integer not null, enabled integer not null default 1, deployed_at text not null);
create table if not exists runs(
  id text primary key, flow_id text, flow_name text, version integer, doc text not null,
  status text not null, source text, trigger_node text, input text, state text not null,
  error text, steps integer not null default 0, started_at text not null, finished_at text);
create index if not exists runs_flow on runs(flow_id, started_at);
create index if not exists runs_status on runs(status);
create table if not exists tasks(
  id integer primary key autoincrement, run_id text not null, node_id text not null,
  input text, status text not null, attempt integer not null default 0, not_before integer not null default 0,
  phase text, port text, output text, error text, ms integer, wait text,
  started_at text, finished_at text);
create index if not exists tasks_pick on tasks(status, not_before);
create index if not exists tasks_run on tasks(run_id);
create table if not exists resources(
  id text primary key, kind text not null, name text not null, config text not null, updated_at text not null);
create table if not exists secrets(
  name text primary key, iv text not null, tag text not null, data text not null, updated_at text not null);
create table if not exists settings(key text primary key, value text not null);
create table if not exists projects(
  id text primary key, name text not null, description text, config text not null, updated_at text not null);
create table if not exists schemas(
  id text primary key, project_id text not null, name text not null, kind text not null,
  root text, text text not null, updated_at text not null);
create table if not exists mem_rows(
  store_id text not null, k text not null, value text, expires_at integer not null default 0, version integer not null,
  primary key(store_id, k));
create index if not exists mem_rows_version on mem_rows(store_id, version);
create table if not exists mem_meta(store_id text primary key, version integer not null, loaded_at integer not null default 0, reload_at integer not null default 0);
create table if not exists counters(
  project_id text not null, name text not null, value real not null, updated_at text not null, primary key(project_id, name));
create table if not exists package_deployments(
  id text primary key, seq integer not null, project_id text not null, name text not null, version text not null,
  checksum text not null, deployed_at text not null, deployed_by text, report text not null, package text not null);
create table if not exists engines(
  id text primary key, host text, pid integer, mode text, version text, started_at text not null,
  heartbeat_at integer not null, workers integer, active integer not null default 0, draining integer not null default 0);
create table if not exists leases(name text primary key, holder text not null, expires_at integer not null);
create table if not exists users(
  username text primary key, hash text not null, role text not null, created_at text not null);
create table if not exists roles(
  id text primary key, name text not null, description text, perms text not null, builtin integer not null default 0, updated_at text not null);
create table if not exists grants(
  username text not null, role_id text not null, project_id text not null default '', primary key(username, role_id, project_id));
create table if not exists api_tokens(
  id text primary key, username text not null, name text not null, hash text not null, created_at text not null,
  expires_at integer not null default 0, last_used text);
create table if not exists audit(
  id integer primary key autoincrement, at text not null, actor text not null, actor_kind text, ip text, action text not null,
  method text, path text, target text, project_id text, status integer, outcome text not null, details text);
create index if not exists audit_at on audit(at);
create table if not exists alert_channels(
  id text primary key, name text not null, kind text not null, config text not null, enabled integer not null default 1, updated_at text not null);
create table if not exists alert_rules(
  id text primary key, name text not null, kind text not null, params text not null, severity text not null, channels text not null default '[]',
  enabled integer not null default 1, notify_resolved integer not null default 1, repeat_min integer not null default 0, updated_at text not null);
create table if not exists alerts(
  id text primary key, rule_id text not null, rule_name text not null, severity text not null, state text not null, message text,
  details text, started_at text not null, last_seen_at text not null, last_notified_at text, resolved_at text, ack_by text, ack_at text, notified text not null default '[]');
create index if not exists alerts_state on alerts(state, started_at);
create table if not exists gw_plans(
  id text primary key, name text not null, description text, per_minute integer not null default 0, per_hour integer not null default 0,
  per_day integer not null default 0, per_month integer not null default 0, updated_at text not null);
create table if not exists gw_apps(
  id text primary key, name text not null, description text, contact text, plan_id text, scopes text not null default '[]',
  disabled integer not null default 0, created_at text not null, updated_at text not null);
create table if not exists gw_keys(
  id text primary key, app_id text not null, name text not null, hash text not null, created_at text not null,
  expires_at integer not null default 0, last_used text);
create table if not exists gw_usage(app_id text not null, win text not null, n integer not null default 0, expires integer not null, primary key(app_id, win));
create table if not exists folders(project_id text not null, area text not null, path text not null, primary key(project_id, area, path));
create table if not exists ai_sessions(store_id text not null, session text not null, project_id text, summary text, summary_upto integer not null default 0, last_seq integer not null default 0,
  turns integer not null default 0, tokens integer not null default 0, lock_run text, lock_until integer not null default 0, created_at text not null, updated_at text not null, primary key(store_id, session));
create table if not exists ai_memory(store_id text not null, session text not null, seq integer not null, role text not null, name text, content text not null, tokens integer not null, at text not null, primary key(store_id, session, seq));
create table if not exists ai_knowledge(kb_id text not null, id text not null, source text not null, chunk integer not null, text text not null, meta text, vector text, at text not null, primary key(kb_id, id));
create index if not exists ai_knowledge_source on ai_knowledge(kb_id, source);
create table if not exists ai_session_queue(seq integer primary key autoincrement, store_id text not null, session text not null, run_id text not null, at text not null);
create index if not exists ai_session_queue_s on ai_session_queue(store_id, session, seq);
create table if not exists git_accounts(id text primary key, username text not null, provider text not null, host text not null, label text not null, login text not null,
  token text not null, author_name text, author_email text, created_at text not null, last_used text);
create index if not exists git_accounts_user on git_accounts(username);
create table if not exists git_workspaces(id text primary key, project_id text not null unique, owner text not null, kind text not null, dir text not null, remote_url text,
  branch text not null, account_id text, trusted integer not null default 0, source_project_id text, created_at text not null, updated_at text not null);
create table if not exists git_ids(workspace_id text not null, kind text not null, repo_id text not null, local_id text not null, primary key(workspace_id, repo_id));
create index if not exists git_ids_local on git_ids(workspace_id, local_id);
create table if not exists ai_agent_state(run_id text not null, node_id text not null, state text not null, updated_at text not null, primary key(run_id, node_id));
create table if not exists gw_requests(
  id integer primary key autoincrement, at text not null, engine text, kind text, method text, path text, route text, flow_id text,
  project_id text, app_id text, caller text, status integer, ms integer, bytes_in integer, bytes_out integer, ip text, run_id text, error text);
create index if not exists gw_requests_at on gw_requests(at);
create index if not exists gw_requests_route on gw_requests(route, at);
create index if not exists audit_actor on audit(actor, at);
`;

export function openDb(file?: string) {
  if (db) { try { db.close(); } catch { /* already closed */ } }
  const url = config.dbUrl;
  if (!file && /^(postgres(ql)?:|pglite:)/.test(url)) {
    db = postgresBackend(url);
    // Engines starting together on an empty database would create the same tables at once: one at a time.
    db.exec('select pg_advisory_lock(424243)');
    try { db.exec(pgSchema(SCHEMA)); migrate(); } finally { db.exec('select pg_advisory_unlock(424243)'); }
    return db;
  } else {
    const f = file || path.join(config.dataDir, 'sutra.db');
    if (f !== ':memory:') ensureDataDir();
    db = sqliteBackend(f);
    // Engines starting together on one file would add the same new columns at once: one at a time
    // (begin immediate waits for the other, then sees what it added).
    for (let i = 0; ; i++) {
      try { db.exec('begin immediate'); break; } catch (e: any) { if (!/locked|busy/i.test(String(e?.message)) || i >= 200) throw e; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50); }
    }
    try { db.exec(SCHEMA); migrate(); db.exec('commit'); } catch (e) { try { db.exec('rollback'); } catch { /* none open */ } throw e; }
  }
  return db;
}

export const dbKind = () => getDb().kind;

/** Adds columns introduced after the first release, so existing installs upgrade in place. */
function migrate(d = getDb()) {
  const cols = (t: string) => d.kind === 'sqlite'
    ? (d.all(`pragma table_info(${t})`, []) as any[]).map(c => c.name)
    : (d.all(`select column_name as name from information_schema.columns where table_name = ?`, [t]) as any[]).map(c => c.name);
  const add = (t: string, c: string, ddl: string) => { if (!cols(t).includes(c)) d.exec(`alter table ${t} add column ${d.kind === 'postgres' ? pgSchema(ddl) : ddl}`); };
  add('flows', 'project_id', 'project_id text');
  add('flows', 'folder', "folder text not null default ''");
  // Personal copies of a project (Git workspaces): the owner, and restricted mode until the repository is trusted.
  add('projects', 'owner', "owner text not null default ''");
  add('projects', 'restricted', 'restricted integer not null default 0');
  // Audit entries keep the names of what they were about, so a renamed or deleted item stays readable.
  add('audit', 'project_name', 'project_name text');
  add('audit', 'sutra_id', 'sutra_id text');
  add('audit', 'sutra_name', 'sutra_name text');
  add('audit', 'environment', 'environment text');
  add('audit', 'engine', 'engine text');
  d.exec('create index if not exists audit_project on audit(project_id, at)');
  d.exec('create index if not exists audit_sutra on audit(sutra_id, at)');
  add('resources', 'folder', "folder text not null default ''");
  add('schemas', 'folder', "folder text not null default ''");
  // Folders kept by the first folder release (Sutras only) move to the folders table.
  if (d.all(d.kind === 'sqlite' ? "select name from sqlite_master where type = 'table' and name = 'flow_folders'" : "select table_name as name from information_schema.tables where table_name = 'flow_folders'", []).length) {
    d.exec("insert into folders(project_id, area, path) select project_id, 'sutras', path from flow_folders where true on conflict do nothing");
    d.exec('drop table flow_folders');
  }
  add('resources', 'project_id', 'project_id text');
  add('runs', 'project_id', 'project_id text');
  add('runs', 'debug', 'debug text');
  add('tasks', 'released', 'released integer not null default 0');
  add('tasks', 'owner', 'owner text');
  // Users, system accounts and their sign-in state.
  add('deployments', 'tuning', 'tuning text');
  add('runs', 'priority', 'priority integer not null default 0');
  add('tasks', 'priority', 'priority integer not null default 0');
  add('tasks', 'queued_at', 'queued_at integer');
  add('engines', 'drain_requested', 'drain_requested integer not null default 0');
  add('users', 'kind', "kind text not null default 'user'");
  add('users', 'display_name', 'display_name text');
  add('users', 'email', 'email text');
  add('users', 'disabled', 'disabled integer not null default 0');
  add('users', 'must_change', 'must_change integer not null default 0');
  add('users', 'failed', 'failed integer not null default 0');
  add('users', 'locked_until', 'locked_until integer not null default 0');
  add('users', 'sessions_after', 'sessions_after integer not null default 0');
  add('users', 'last_login', 'last_login text');
  add('users', 'updated_at', 'updated_at text');
  d.exec('create index if not exists flows_project on flows(project_id)');
  d.exec('create index if not exists resources_project on resources(project_id)');
  d.exec('create index if not exists tasks_owner on tasks(owner, status)');
  // Covering indexes: the queries that count a run's steps by status, claim the next step and check a
  // step's status read only the index, never the row (in SQLite, status and priority come after the
  // input column, so reading them walks through a big input).
  d.exec('create index if not exists tasks_run_status on tasks(run_id, status)');
  d.exec('create index if not exists tasks_claim on tasks(status, priority desc, id, not_before)');
  d.exec('create index if not exists tasks_status on tasks(id, status)');
  // Everything created before projects existed goes into a default project.
  const hasOrphans = d.get('select 1 as x from flows where project_id is null union select 1 as x from resources where project_id is null limit 1', []);
  let def = d.get(`select id from projects order by updated_at limit 1`, []) as any;
  if (!def && hasOrphans) {
    d.run('insert into projects(id, name, description, config, updated_at) values(?, ?, ?, ?, ?)', ['default', 'Default project', 'Sutras and resources created before projects existed', '{}', new Date().toISOString()]);
    def = { id: 'default' };
  }
  if (def) {
    d.run('update flows set project_id = ? where project_id is null', [def.id]);
    d.run('update resources set project_id = ? where project_id is null', [def.id]);
  }
}

export function getDb() {
  if (!db) throw new Error('Database is not open');
  return db;
}

export const q = {
  get<T = any>(sql: string, ...args: any[]): T | undefined {
    return getDb().get(sql, args) as T | undefined;
  },
  all<T = any>(sql: string, ...args: any[]): T[] {
    return getDb().all(sql, args) as T[];
  },
  run(sql: string, ...args: any[]) {
    return getDb().run(sql, args);
  },
};

/** Runs fn inside one write transaction; storage calls are synchronous, so nothing else interleaves here. */
let txDepth = 0;
/**
 * A write transaction. With a key ("run:<id>", "flow:<id>"), PostgreSQL locks only that key, so
 * transactions about other runs go on at the same time; without one, the shared lock serialises it
 * against every other keyless transaction.
 */
export function tx<T>(fn: () => T, key?: string): T {
  // Inside a transaction already (a whole pull, say, that deletes Sutras): the inner work joins it.
  if (txDepth > 0) return fn();
  const d = getDb();
  d.begin(key);
  txDepth++;
  try {
    const r = fn();
    txDepth--;
    d.commit();
    return r;
  } catch (e) {
    txDepth = 0;
    d.rollback();
    throw e;
  }
}

/** Storage calls of one engine: the database, or an in-memory one for Sutras that run in memory. */
export interface Store { q: typeof q; tx: typeof tx; kind: 'database' | 'memory' }
export const databaseStore: Store = { q, tx, kind: 'database' };

/**
 * A private in-memory SQLite database with the full schema, for runs of Sutras set to run in memory:
 * their run and step rows live here while they run (no disk, no network), and are written to the
 * database in one transaction when the run ends.
 */
export function memoryStore(): Store {
  const d = sqliteBackend(':memory:');
  d.exec(SCHEMA);
  migrate(d);
  let depth = 0;
  const mq: typeof q = {
    get: (sql: string, ...a: any[]) => d.get(sql, a),
    all: (sql: string, ...a: any[]) => d.all(sql, a),
    run: (sql: string, ...a: any[]) => d.run(sql, a),
  } as typeof q;
  const mtx = (<T>(fn: () => T): T => {
    if (depth > 0) return fn();
    d.begin(); depth++;
    try { const r = fn(); depth--; d.commit(); return r; } catch (e) { depth = 0; d.rollback(); throw e; }
  }) as typeof tx;
  return { q: mq, tx: mtx, kind: 'memory' };
}

/**
 * Copies everything from the open database to another one (for example SQLite to PostgreSQL):
 * the target gets the full schema, then every table row by row in batches, then its id counters
 * continue after the copied rows. A target with data is refused unless replace is set. Secrets
 * stay encrypted, so the engines on the target need the same master key.
 */
export function copyDatabase(toUrl: string, o: { replace?: boolean; log?: (m: string) => void } = {}) {
  const src = getDb();
  if (!/^(postgres(ql)?:|pglite:)/.test(toUrl) && !/\.(db|sqlite3?)$/i.test(toUrl)) throw new Error('Copy to a postgres://user:pass@host/db address, or to a .db file');
  const target = /^(postgres(ql)?:|pglite:)/.test(toUrl) ? postgresBackend(toUrl) : sqliteBackend(toUrl);
  const log = o.log || (() => {});
  try {
    target.exec(target.kind === 'postgres' ? pgSchema(SCHEMA) : SCHEMA);
    db = target; migrate(); db = src;
    const tables = src.kind === 'sqlite'
      ? (src.all(`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name`, []) as any[]).map(r => r.name as string)
      : (src.all(`select table_name as name from information_schema.tables where table_schema = current_schema() and table_type = 'BASE TABLE' order by table_name`, []) as any[]).map(r => r.name as string);
    const colsOf = (b: Backend, t: string) => b.kind === 'sqlite'
      ? (b.all(`pragma table_info(${t})`, []) as any[]).map(c => c.name as string)
      : (b.all(`select column_name as name from information_schema.columns where table_schema = current_schema() and table_name = ?`, [t]) as any[]).map(c => c.name as string);
    const busy = tables.filter(t => colsOf(target, t).length && Number((target.get(`select count(*) as n from ${t}`, []) as any)?.n || 0) > 0);
    if (busy.length && !o.replace) throw new Error(`The target already has data in ${busy.join(', ')}. Use replace to overwrite it.`);
    const report: { table: string; rows: number }[] = [];
    for (const t of tables) {
      const have = new Set(colsOf(target, t));
      if (!have.size) { log(`${t}: not in the target schema, skipped`); continue; }
      const cols = colsOf(src, t).filter(c => have.has(c));
      const list = cols.map(c => `"${c}"`).join(', ');
      target.begin();
      try {
        target.run(`delete from ${t}`, []);
        let n = 0;
        for (let off = 0; ; off += 500) {
          const rows = src.all(`select ${list} from ${t} limit 500 offset ${off}`, []) as any[];
          for (const r of rows) target.run(`insert into ${t}(${list}) values(${cols.map(() => '?').join(', ')})`, cols.map(c => (r[c] instanceof Uint8Array ? Buffer.from(r[c]).toString('utf8') : r[c])));
          n += rows.length;
          if (rows.length < 500) break;
        }
        target.commit();
        report.push({ table: t, rows: n });
        log(`${t}: ${n} rows`);
      } catch (e: any) {
        target.rollback();
        throw new Error(`${t}: ${e.message}`);
      }
    }
    // Serial ids continue after the copied rows.
    if (target.kind === 'postgres') {
      for (const r of target.all(`select table_name as t, column_name as c from information_schema.columns where table_schema = current_schema() and column_default like 'nextval%'`, []) as any[]) {
        target.run(`select setval(pg_get_serial_sequence('${r.t}', '${r.c}'), coalesce((select max(${r.c}) from ${r.t}), 0) + 1, false)`, []);
      }
    }
    return { tables: report, rows: report.reduce((a, x) => a + x.rows, 0) };
  } finally {
    db = src;
    target.close();
  }
}

export function closeDb() {
  if (db) { try { db.close(); } catch { /* closed */ } db = null; }
}

export const now = () => new Date().toISOString();

export function getSetting<T>(key: string, def: T): T {
  const r = q.get<{ value: string }>('select value from settings where key = ?', key);
  return r ? (JSON.parse(r.value) as T) : def;
}
export function setSetting(key: string, value: unknown) {
  q.run('insert into settings(key, value) values(?, ?) on conflict(key) do update set value = excluded.value', key, JSON.stringify(value));
}
