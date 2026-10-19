/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { q, tx } from './db.js';
import { effectiveResource, listResources, onResourceChange, type Resource } from './resources.js';
import { dbConnection } from './connectors/db.js';
import { getSecret } from './secrets.js';

/**
 * Memory tables: rows kept by key in the memory of each engine, for lookups that must not wait for a
 * database (reference data, prices, customers, routing tables, session state).
 *
 *  - Filled from a database query (all of a table, or the part a WHERE clause picks), by Sutras with
 *    Memory put, or both. A row that is missing can be fetched with a lookup query (read-through).
 *  - Refreshed every N minutes from the source; rows may expire (time to live); a table holds at most
 *    N rows and drops the least recently used beyond that.
 *  - Failsafe ("Keep a copy in the database"): every change is also written to SutraFlow's own
 *    database. An engine that starts loads that copy instead of asking the source again, and the
 *    engines of a cluster pick up each other's changes within the sync time (a version number per
 *    table; each change carries the next one). Memory only: nothing is written, each engine has its
 *    own rows, and a restart loads them from the source again.
 *
 * Reads never touch the database while the table is in sync; writes cost one small transaction in
 * failsafe mode and none in memory only.
 */

export interface MemRow { v: any; exp: number }
export interface MemStats {
  id: string; name: string; project: string | null; rows: number; bytes: number; hits: number; misses: number;
  loads: number; loadedAt: string | null; version: number; failsafe: boolean; source: string; lastError: string | null;
  settings: ReturnType<typeof settingsOf>; notLoaded?: boolean;
}

/** How often an engine checks the database copy for changes made by other engines (failsafe tables). */
export const memSync = { ms: Number(process.env.SUTRA_MEMORY_SYNC_MS ?? 1000) };

class MemTable {
  rows = new Map<string, MemRow>();
  bytes = 0;
  version = 0;
  hits = 0;
  misses = 0;
  loads = 0;
  loadedAt = 0;
  syncedAt = 0;
  lastError: string | null = null;
  reloading = false;
  timer: NodeJS.Timeout | null = null;
  ready: Promise<void> | null = null;
  constructor(public r: Resource) {}
  get failsafe() { return this.r.config.keep !== 'memory only'; }
  /** Small reference data only: limits always apply, with a ceiling. */
  get maxRows() { return Math.min(MAX_ROWS, Number(this.r.config.maxRows) || 10000); }
  get maxBytes() { return Math.min(MAX_MB, Number(this.r.config.maxMb) || 16) * 1048576; }
  get ttlMs() { return (Number(this.r.config.ttlSeconds) || 0) * 1000; }
  keyFields() { return String(this.r.config.key || 'id').split(',').map(s => s.trim()).filter(Boolean); }
  keyOf(row: any) {
    const ks = this.keyFields();
    const parts = ks.map(k => row?.[k]);
    if (parts.some(p => p === undefined || p === null || p === '')) throw new Error(`${this.r.name}: the row has no ${ks.join(' + ')} (the key of this memory table)`);
    return parts.map(String).join('|');
  }
  /** Keeps a row in memory (LRU order: a used row moves to the end). */
  setLocal(k: string, v: any, exp: number) {
    const old = this.rows.get(k);
    if (old) { this.bytes -= size(old.v); this.rows.delete(k); }
    this.rows.set(k, { v, exp });
    this.bytes += size(v);
    const max = this.maxRows, bytes = this.maxBytes;
    while (this.rows.size > max || (this.bytes > bytes && this.rows.size > 1)) { const [first, row] = this.rows.entries().next().value!; this.rows.delete(first); this.bytes -= size(row.v); }
  }
  deleteLocal(k: string) {
    const old = this.rows.get(k);
    if (old) { this.bytes -= size(old.v); this.rows.delete(k); }
  }
  clearLocal() { this.rows.clear(); this.bytes = 0; }
}

/** Ceilings of any memory table: these are for small reference data, never big tables or files. */
export const MAX_ROWS = 100000, MAX_MB = 256;
const size = (v: any) => { try { return JSON.stringify(v)?.length ?? 0; } catch { return 0; } };
const tables = new Map<string, MemTable>();
const secret = (name: string, what = 'Secret') => {
  if (!name) throw new Error(`${what} is not set`);
  const v = getSecret(name);
  if (v === undefined) throw new Error(`${what}: secret "${name}" does not exist`);
  return v;
};

// A changed or deleted memory table starts again (the next use loads it with the new settings).
onResourceChange.push(id => { const t = tables.get(id); if (t) { if (t.timer) clearInterval(t.timer); tables.delete(id); } });

/** The memory table of a resource, loaded on first use. */
export async function memTable(id: string): Promise<MemTable> {
  let t = tables.get(id);
  if (!t) {
    const r = effectiveResource(id);
    if (!r) throw new Error('Memory table: the resource no longer exists');
    if (r.kind !== 'memoryTable') throw new Error(`Memory table: expected a memory table, got ${r.kind}`);
    t = new MemTable(r);
    tables.set(id, t);
    const tt = t;
    t.ready = start(tt).catch(e => { tt.lastError = e.message; tables.delete(id); throw e; });
  }
  await t.ready;
  sync(t);
  return t;
}

/** A memory table by name in a project (for the memory-lookup() function); undefined when not loaded. */
export function memTableByName(projectId: string | null, name: string) {
  const r = listResources('memoryTable', projectId || undefined).find(x => x.name.toLowerCase() === String(name).toLowerCase());
  if (!r) throw new Error(`There is no memory table named "${name}"${projectId ? ' in this project' : ''}`);
  const t = tables.get(r.id);
  if (!t || !t.loadedAt) { memTable(r.id).catch(() => {}); return undefined; }
  sync(t);
  return t;
}

async function start(t: MemTable) {
  if (t.failsafe) {
    const meta = q.get<{ version: number; loaded_at: number }>('select version, loaded_at from mem_meta where store_id = ?', t.r.id);
    if (meta && Number(meta.loaded_at) > 0) {
      // The database copy is there: no need to ask the source again.
      readCopy(t, 0);
      t.version = Number(meta.version);
      t.loadedAt = Number(meta.loaded_at);
      t.syncedAt = Date.now();
    } else await reload(t);
  } else await reload(t);
  const every = (Number(t.r.config.refreshMinutes) || 0) * 60000;
  if (every > 0 && t.r.config.source === 'database query') {
    t.timer = setInterval(() => { reload(t).catch(e => { t.lastError = e.message; }); }, every);
    t.timer.unref?.();
  }
}

/** Rows of the database copy changed after a version (all when 0). */
function readCopy(t: MemTable, after: number) {
  const rows = q.all<{ k: string; value: string | null; expires_at: number; version: number }>('select k, value, expires_at, version from mem_rows where store_id = ? and version > ? order by version', t.r.id, after);
  for (const row of rows) {
    if (row.value === null) t.deleteLocal(row.k);
    else t.setLocal(row.k, JSON.parse(row.value), Number(row.expires_at) || 0);
  }
  return rows.length;
}

/**
 * At most every sync time: a reload asked for on any engine (hot reload from the Admin Console), and
 * in failsafe tables the changes other engines made.
 */
function sync(t: MemTable) {
  if (Date.now() - t.syncedAt < memSync.ms) return;
  t.syncedAt = Date.now();
  const m = q.get<{ version: number; loaded_at: number; reload_at: number }>('select version, loaded_at, reload_at from mem_meta where store_id = ?', t.r.id);
  if (!t.failsafe) {
    // Memory only: nothing is shared but the request to load again from the source.
    if (m && Number(m.reload_at) > t.loadedAt && !t.reloading) { t.reloading = true; reload(t, false).catch(e => { t.lastError = e.message; }).finally(() => { t.reloading = false; }); }
    return;
  }
  const v = Number(m?.version || 0);
  if (v > t.version) {
    const meta = m;
    // Reloaded elsewhere (a new load replaces every row): read the whole copy again.
    if (meta && Number(meta.loaded_at) > t.loadedAt) { t.clearLocal(); readCopy(t, 0); t.loadedAt = Number(meta.loaded_at); } else readCopy(t, t.version);
    t.version = v;
  }
}

/**
 * Loads the table from its source (the load query), replacing every row; empty when it has none.
 * everywhere: the other engines load again too (within the sync time).
 */
export async function reload(t: MemTable, everywhere = false) {
  let rows: any[] = [];
  if (t.r.config.source === 'database query') {
    const sql = String(t.r.config.loadSql || '').trim();
    if (sql) {
      const db = await dbConnection(requireDb(t), secret);
      rows = (await db.query(sql, {})).rows;
      const bytes = rows.reduce((a, r) => a + size(r), 0);
      if (rows.length > t.maxRows || bytes > t.maxBytes) throw new Error(`${t.r.name}: the load query returned ${rows.length} rows (${Math.ceil(bytes / 1048576)} MB), more than this memory table keeps (${t.maxRows} rows, ${t.maxBytes / 1048576} MB). Memory tables are for small reference data: load only what is looked up often (a WHERE clause), use a lookup query for the rest, and keep big data in the database or stream it.`);
    }
  }
  const exp = t.ttlMs ? Date.now() + t.ttlMs : 0;
  const keyed = rows.map(row => [t.keyOf(row), row] as const);
  t.clearLocal();
  for (const [k, row] of keyed) t.setLocal(k, row, exp);
  t.loads++;
  t.loadedAt = Date.now();
  t.lastError = null;
  if (t.failsafe) {
    tx(() => {
      const v = Number(q.get<{ version: number }>('select version from mem_meta where store_id = ?', t.r.id)?.version || 0) + 1;
      q.run('delete from mem_rows where store_id = ?', t.r.id);
      // The rows kept after the size limit, several per statement.
      const kept = [...t.rows.entries()];
      for (let i = 0; i < kept.length; i += 200) {
        const part = kept.slice(i, i + 200);
        q.run(`insert into mem_rows(store_id, k, value, expires_at, version) values ${part.map(() => '(?, ?, ?, ?, ?)').join(', ')}`, ...part.flatMap(([k, r]) => [t.r.id, k, JSON.stringify(r.v), r.exp, v]));
      }
      q.run(`insert into mem_meta(store_id, version, loaded_at) values(?, ?, ?) on conflict(store_id) do update set version = excluded.version, loaded_at = excluded.loaded_at`, t.r.id, v, t.loadedAt);
      t.version = v;
    }, `mem:${t.r.id}`);
    t.syncedAt = Date.now();
  }
  if (everywhere) q.run(`insert into mem_meta(store_id, version, loaded_at, reload_at) values(?, ?, ?, ?) on conflict(store_id) do update set reload_at = excluded.reload_at`, t.r.id, t.version, t.loadedAt, t.loadedAt);
  return { rows: t.rows.size };
}

function requireDb(t: MemTable) {
  const r = effectiveResource(String(t.r.config.database || ''));
  if (!r || r.kind !== 'database') throw new Error(`${t.r.name}: choose the database connection to load from`);
  return r;
}

/** Writes a change to the database copy (failsafe tables) with the next version. */
function persist(t: MemTable, k: string, value: any, exp: number) {
  if (!t.failsafe) return;
  tx(() => {
    const v = Number(q.get<{ version: number }>('select version from mem_meta where store_id = ?', t.r.id)?.version || 0) + 1;
    q.run(`insert into mem_rows(store_id, k, value, expires_at, version) values(?, ?, ?, ?, ?)
      on conflict(store_id, k) do update set value = excluded.value, expires_at = excluded.expires_at, version = excluded.version`,
    t.r.id, k, value === undefined ? null : JSON.stringify(value), exp, v);
    q.run(`insert into mem_meta(store_id, version, loaded_at) values(?, ?, ?) on conflict(store_id) do update set version = excluded.version`, t.r.id, v, t.loadedAt || Date.now());
    // Our own change: the copy is at this version for us too, unless another engine wrote in between.
    if (v === t.version + 1) t.version = v;
  }, `mem:${t.r.id}`);
}

/** A row by key, or undefined. Missing rows are fetched with the lookup query when there is one. */
export async function memGet(t: MemTable, key: string, readThrough = true): Promise<any> {
  const hit = t.rows.get(key);
  if (hit && (!hit.exp || hit.exp > Date.now())) {
    t.hits++;
    t.rows.delete(key); t.rows.set(key, hit); // most recently used
    return hit.v;
  }
  if (hit) t.deleteLocal(key);
  t.misses++;
  const sql = String(t.r.config.lookupSql || '').trim();
  if (!readThrough || !sql || t.r.config.source !== 'database query') return undefined;
  const db = await dbConnection(requireDb(t), secret);
  const ks = t.keyFields();
  const parts = key.split('|');
  const params: Record<string, any> = { key: ks.length === 1 ? key : parts[0] };
  ks.forEach((k, i) => { params[k] = parts[i]; });
  const row = (await db.query(sql, params)).rows[0];
  if (row === undefined) return undefined;
  memPut(t, row, key);
  return row;
}

/** The row in memory only (for functions in mappings: no waiting for a database). */
export function memPeek(t: MemTable, key: string) {
  const hit = t.rows.get(key);
  if (hit && (!hit.exp || hit.exp > Date.now())) { t.hits++; return hit.v; }
  t.misses++;
  return undefined;
}

/** Adds or replaces a row; the key comes from the row's key fields unless given. */
export function memPut(t: MemTable, row: any, key?: string, ttlSeconds?: number) {
  const k = key || t.keyOf(row);
  const ttl = ttlSeconds !== undefined && ttlSeconds > 0 ? ttlSeconds * 1000 : t.ttlMs;
  const exp = ttl ? Date.now() + ttl : 0;
  const existed = t.rows.has(k);
  t.setLocal(k, row, exp);
  persist(t, k, row, exp);
  return { key: k, action: existed ? 'updated' : 'added' };
}

export function memDelete(t: MemTable, key: string) {
  const existed = t.rows.has(key);
  t.deleteLocal(key);
  if (existed || t.failsafe) persist(t, key, undefined, 0);
  return existed;
}

/** Rows that match: fields equal to values, and an optional test per row. */
export function memQuery(t: MemTable, match: Record<string, any>, test?: (row: any) => boolean, limit = 1000) {
  const out: any[] = [];
  const now = Date.now();
  for (const [, r] of t.rows) {
    if (r.exp && r.exp <= now) continue;
    if (Object.entries(match).some(([k, v]) => String(r.v?.[k] ?? '') !== String(v ?? ''))) continue;
    if (test && !test(r.v)) continue;
    out.push(r.v);
    if (out.length >= limit) break;
  }
  return out;
}

export function memClear(t: MemTable) {
  t.clearLocal();
  if (t.failsafe) tx(() => {
    q.run('delete from mem_rows where store_id = ?', t.r.id);
    q.run(`insert into mem_meta(store_id, version, loaded_at) values(?, 1, ?) on conflict(store_id) do update set version = mem_meta.version + 1, loaded_at = excluded.loaded_at`, t.r.id, Date.now());
  }, `mem:${t.r.id}`);
  t.loadedAt = Date.now();
}

export function memStats(t: MemTable): MemStats {
  return {
    id: t.r.id, name: t.r.name, project: t.r.project_id ?? null, rows: t.rows.size, bytes: t.bytes, hits: t.hits, misses: t.misses,
    loads: t.loads, loadedAt: t.loadedAt ? new Date(t.loadedAt).toISOString() : null, version: t.version, failsafe: t.failsafe,
    source: String(t.r.config.source || 'filled by Sutras'), lastError: t.lastError, settings: settingsOf(t.r),
  };
}

/** The settings the Admin Console shows (the queries, limits and failsafe). */
function settingsOf(r: Resource) {
  const c = r.config;
  return { key: String(c.key || 'id'), source: String(c.source || 'filled by Sutras'), database: c.database ? (effectiveResource(String(c.database))?.name ?? '') : '', loadSql: c.source === 'database query' ? String(c.loadSql || '') : '', lookupSql: c.source === 'database query' ? String(c.lookupSql || '') : '',
    refreshMinutes: Number(c.refreshMinutes) || 0, ttlSeconds: Number(c.ttlSeconds) || 0, maxRows: Math.min(MAX_ROWS, Number(c.maxRows) || 10000), maxMb: Math.min(MAX_MB, Number(c.maxMb) || 16), keep: String(c.keep || 'copy in the database') };
}

/**
 * Rows for the Admin Console, a page at a time: those whose key or values contain a text, and whose
 * field equals a value, in key order.
 */
export function memRows(t: MemTable, o: { find?: string; field?: string; value?: string; offset?: number; limit?: number } = {}) {
  const now = Date.now();
  const f = String(o.find || '').toLowerCase();
  const limit = Math.max(1, Math.min(1000, o.limit || 50)), offset = Math.max(0, o.offset || 0);
  const match: [string, any][] = [];
  for (const [k, r] of t.rows) {
    if (r.exp && r.exp <= now) continue;
    if (o.field && String(r.v?.[o.field] ?? '') !== String(o.value ?? '')) continue;
    if (f && !k.toLowerCase().includes(f) && !JSON.stringify(r.v).toLowerCase().includes(f)) continue;
    match.push([k, r]);
  }
  match.sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
  const fields = [...new Set(match.slice(offset, offset + limit).flatMap(([, r]) => (r.v && typeof r.v === 'object' ? Object.keys(r.v) : [])))];
  return {
    total: match.length, offset, limit, fields,
    rows: match.slice(offset, offset + limit).map(([k, r]) => ({ key: k, row: r.v, expiresAt: r.exp ? new Date(r.exp).toISOString() : null })),
  };
}

/** Every memory table, loaded on this engine or not (Admin Console). */
export function allMemTables() {
  return listResources('memoryTable').map(r => {
    const t = tables.get(r.id);
    return t ? memStats(t) : { id: r.id, name: r.name, project: r.project_id ?? null, rows: 0, bytes: 0, hits: 0, misses: 0, loads: 0, loadedAt: null, version: 0, failsafe: r.config.keep !== 'memory only', source: String(r.config.source || 'filled by Sutras'), lastError: null, settings: settingsOf(r), notLoaded: true };
  });
}

/** Stops the refresh timers (server shutdown, tests). */
export function stopMemTables() { for (const t of tables.values()) if (t.timer) clearInterval(t.timer); tables.clear(); }
