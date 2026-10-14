import { workerData, type MessagePort } from 'node:worker_threads';
import { createRequire } from 'node:module';

/**
 * PostgreSQL connection for the synchronous storage bridge (see db.ts). The main thread posts one
 * statement, waits on a shared flag, and reads the answer; this worker runs it on one connection.
 * url: postgres://... (a server), or pglite:memory / pglite:<folder> (PostgreSQL inside Node, for tests).
 */
const require = createRequire(import.meta.url);
const { url, ctrl, port } = workerData as { url: string; ctrl: SharedArrayBuffer; port: MessagePort };
const flag = new Int32Array(ctrl);

type Q = { sql: string; params: unknown[]; mode: 'get' | 'all' | 'run' | 'exec' };
let query: (sql: string, params: unknown[], exec: boolean) => Promise<{ rows: any[]; changes: number }>;

const plain = (v: any): any => (typeof v === 'bigint' ? Number(v) : v instanceof Date ? v.toISOString() : v);
const row = (r: any) => { for (const k of Object.keys(r)) r[k] = plain(r[k]); return r; };

async function connect() {
  if (url.startsWith('pglite:')) {
    const { PGlite } = await import('@electric-sql/pglite');
    const where = url.slice('pglite:'.length);
    const db = where === 'memory' || !where ? new PGlite() : new PGlite(where);
    await db.waitReady;
    query = async (sql, params, exec) => {
      if (exec) { await db.exec(sql); return { rows: [], changes: 0 }; }
      const r: any = await db.query(sql, params as any[]);
      return { rows: r.rows.map(row), changes: r.affectedRows ?? 0 };
    };
    return;
  }
  const pg = require('pg');
  pg.types.setTypeParser(20, (v: string) => Number(v)); // bigint
  pg.types.setTypeParser(1700, (v: string) => Number(v)); // numeric
  const client = new pg.Client({ connectionString: url, application_name: 'sutraflow' });
  await client.connect();
  client.on('error', (e: Error) => { console.error('PostgreSQL connection lost:', e.message); process.exit(1); });
  query = async (sql, params, exec) => {
    const r = await client.query(exec ? sql : { text: sql, values: params });
    const last = Array.isArray(r) ? r[r.length - 1] : r;
    return { rows: (last?.rows || []).map(row), changes: last?.rowCount ?? 0 };
  };
}

const ready = connect();
port.on('message', async (q: Q) => {
  let reply: any;
  try {
    await ready;
    const r = await query(q.sql, q.params, q.mode === 'exec');
    reply = { ok: true, rows: r.rows, changes: r.changes };
  } catch (e: any) {
    reply = { ok: false, error: e?.message || String(e), code: e?.code };
  }
  port.postMessage(reply);
  Atomics.store(flag, 0, 1);
  Atomics.notify(flag, 0);
});
