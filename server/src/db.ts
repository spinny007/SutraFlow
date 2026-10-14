import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { config, ensureDataDir } from './config.js';

/**
 * Storage. SQLite (built into Node) keeps the single-app install dependency-free.
 * All access goes through this module, so it can be swapped for Postgres later.
 */
let db: DatabaseSync;

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
create table if not exists users(
  username text primary key, hash text not null, role text not null, created_at text not null);
`;

export function openDb(file = path.join(config.dataDir, 'sutra.db')) {
  if (file !== ':memory:') ensureDataDir();
  db = new DatabaseSync(file);
  db.exec('pragma journal_mode = wal; pragma synchronous = normal; pragma foreign_keys = on;');
  db.exec(SCHEMA);
  migrate();
  return db;
}

/** Adds columns introduced after the first release, so existing installs upgrade in place. */
function migrate() {
  const cols = (t: string) => (db.prepare(`pragma table_info(${t})`).all() as any[]).map(c => c.name);
  const add = (t: string, c: string, ddl: string) => { if (!cols(t).includes(c)) db.exec(`alter table ${t} add column ${ddl}`); };
  add('flows', 'project_id', 'project_id text');
  add('resources', 'project_id', 'project_id text');
  add('runs', 'project_id', 'project_id text');
  add('runs', 'debug', 'debug text');
  add('tasks', 'released', 'released integer not null default 0');
  db.exec('create index if not exists flows_project on flows(project_id)');
  db.exec('create index if not exists resources_project on resources(project_id)');
  // Everything created before projects existed goes into a default project.
  const hasOrphans = db.prepare('select 1 from flows where project_id is null union select 1 from resources where project_id is null limit 1').get();
  let def = db.prepare(`select id from projects order by updated_at limit 1`).get() as any;
  if (!def && hasOrphans) {
    db.prepare('insert into projects(id, name, description, config, updated_at) values(?, ?, ?, ?, ?)')
      .run('default', 'Default project', 'Sutras and resources created before projects existed', '{}', new Date().toISOString());
    def = { id: 'default' };
  }
  if (def) {
    db.prepare('update flows set project_id = ? where project_id is null').run(def.id);
    db.prepare('update resources set project_id = ? where project_id is null').run(def.id);
  }
}

export function getDb() {
  if (!db) throw new Error('Database is not open');
  return db;
}

export const q = {
  get<T = any>(sql: string, ...args: any[]): T | undefined {
    return getDb().prepare(sql).get(...args) as T | undefined;
  },
  all<T = any>(sql: string, ...args: any[]): T[] {
    return getDb().prepare(sql).all(...args) as T[];
  },
  run(sql: string, ...args: any[]) {
    return getDb().prepare(sql).run(...args);
  },
};

/** Runs fn inside one transaction. node:sqlite is synchronous, so nothing else interleaves. */
export function tx<T>(fn: () => T): T {
  const d = getDb();
  d.exec('begin immediate');
  try {
    const r = fn();
    d.exec('commit');
    return r;
  } catch (e) {
    d.exec('rollback');
    throw e;
  }
}

export const now = () => new Date().toISOString();

export function getSetting<T>(key: string, def: T): T {
  const r = q.get<{ value: string }>('select value from settings where key = ?', key);
  return r ? (JSON.parse(r.value) as T) : def;
}
export function setSetting(key: string, value: unknown) {
  q.run('insert into settings(key, value) values(?, ?) on conflict(key) do update set value = excluded.value', key, JSON.stringify(value));
}
