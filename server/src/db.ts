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
  begin(): void;
  commit(): void;
  rollback(): void;
  close(): void;
}
let db: Backend | null = null;

function sqliteBackend(file: string): Backend {
  const d = new DatabaseSync(file);
  // busy_timeout: several engines on one host may share the file; a writer waits briefly instead of failing.
  d.exec('pragma journal_mode = wal; pragma synchronous = normal; pragma foreign_keys = on; pragma busy_timeout = 10000;');
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

function postgresBackend(url: string): Backend {
  const ctrl = new SharedArrayBuffer(4);
  const flag = new Int32Array(ctrl);
  const { port1, port2 } = new MessageChannel();
  const here = import.meta.url;
  const file = new URL(here.endsWith('.ts') ? './pgworker.ts' : './pgworker.js', here);
  const worker = new Worker(file, { workerData: { url, ctrl, port: port2 }, transferList: [port2 as unknown as MessagePort] });
  worker.unref();
  const call = (sql: string, params: any[], mode: string) => {
    Atomics.store(flag, 0, 0);
    port1.postMessage({ sql: mode === 'exec' ? sql : toPg(sql), params: params.map(v => (typeof v === 'boolean' ? (v ? 1 : 0) : v === undefined ? null : v)), mode });
    if (Atomics.wait(flag, 0, 0, 120000) === 'timed-out') throw new Error('PostgreSQL did not answer within 120 seconds');
    const m = receiveMessageOnPort(port1)?.message as any;
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
    // One write transaction at a time across all engines, like SQLite's begin immediate.
    begin: () => { call('begin', [], 'run'); call('select pg_advisory_xact_lock(424242)', [], 'run'); },
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
    db.exec(pgSchema(SCHEMA));
  } else {
    const f = file || path.join(config.dataDir, 'sutra.db');
    if (f !== ':memory:') ensureDataDir();
    db = sqliteBackend(f);
    db.exec(SCHEMA);
  }
  migrate();
  return db;
}

export const dbKind = () => getDb().kind;

/** Adds columns introduced after the first release, so existing installs upgrade in place. */
function migrate() {
  const d = getDb();
  const cols = (t: string) => d.kind === 'sqlite'
    ? (d.all(`pragma table_info(${t})`, []) as any[]).map(c => c.name)
    : (d.all(`select column_name as name from information_schema.columns where table_name = ?`, [t]) as any[]).map(c => c.name);
  const add = (t: string, c: string, ddl: string) => { if (!cols(t).includes(c)) d.exec(`alter table ${t} add column ${d.kind === 'postgres' ? pgSchema(ddl) : ddl}`); };
  add('flows', 'project_id', 'project_id text');
  add('resources', 'project_id', 'project_id text');
  add('runs', 'project_id', 'project_id text');
  add('runs', 'debug', 'debug text');
  add('tasks', 'released', 'released integer not null default 0');
  add('tasks', 'owner', 'owner text');
  // Users, system accounts and their sign-in state.
  add('deployments', 'tuning', 'tuning text');
  add('runs', 'priority', 'priority integer not null default 0');
  add('tasks', 'priority', 'priority integer not null default 0');
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
export function tx<T>(fn: () => T): T {
  const d = getDb();
  d.begin();
  try {
    const r = fn();
    d.commit();
    return r;
  } catch (e) {
    d.rollback();
    throw e;
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
