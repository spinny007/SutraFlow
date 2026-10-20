/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
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

type Q = { id: number; sql: string; params: unknown[]; mode: 'get' | 'all' | 'run' | 'exec' };
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
  // A lost connection (a restarted or unreachable database) is opened again on the next statement,
  // trying 10 times with growing waits. A statement already sent is never sent again (it may have run),
  // and a transaction the connection was lost in fails until the engine rolls it back, so the rest of
  // a half transaction is never committed on its own.
  let client: any = null, inTx = false, broken = false;
  const open = async () => {
    for (let i = 1; ; i++) {
      const c = new pg.Client({ connectionString: url, application_name: 'sutraflow', connectionTimeoutMillis: 10000 });
      // An idle connection that is closed under it ends without an error: both mean it is gone.
      const lost = (why: string) => {
        if (client !== c) return;
        console.error('PostgreSQL connection lost:', why);
        client = null;
        if (inTx) broken = true;
      };
      c.on('error', (e: Error) => lost(e.message));
      c.on('end', () => lost('closed'));
      try { await c.connect(); client = c; if (i > 1) console.error(`PostgreSQL connection open again (try ${i})`); return; } catch (e: any) {
        c.end().catch(() => {});
        // A database that does not exist or refuses the account: trying again cannot help.
        if (['3D000', '28P01', '28000', '42501'].includes(e?.code)) throw e;
        if (i >= 10) throw new Error(`PostgreSQL cannot be reached after 10 tries: ${e.message}`);
        await new Promise(r => setTimeout(r, Math.min(5000, 250 * 2 ** i)));
      }
    }
  };
  await open();
  query = async (sql, params, exec) => {
    const s = sql.trimStart().slice(0, 12).toLowerCase();
    const ends = s.startsWith('commit') || s.startsWith('rollback');
    if (broken) {
      if (s.startsWith('rollback')) { broken = false; inTx = false; return { rows: [], changes: 0 }; }
      throw new Error('The connection to PostgreSQL was lost during this transaction; it was rolled back');
    }
    if (!client) await open();
    try {
      const r = await client.query(exec ? sql : { text: sql, values: params });
      if (s.startsWith('begin')) inTx = true;
      if (ends) inTx = false;
      const last = Array.isArray(r) ? r[r.length - 1] : r;
      return { rows: (last?.rows || []).map(row), changes: last?.rowCount ?? 0 };
    } catch (e: any) {
      // The connection went while this statement was on its way: its fate is unknown, so it is not repeated.
      if (!client || /Connection terminated|ECONNRESET|EPIPE|not queryable/i.test(String(e?.message))) {
        try { await client?.end(); } catch { /* gone */ }
        client = null;
        if (inTx && !ends) broken = true;
        inTx = false;
      }
      throw e;
    }
  };
}

const ready = connect();
// A failed start is answered to each statement (they await it); it is not an error of its own.
ready.catch(() => {});
port.on('message', async (q: Q) => {
  let reply: any;
  try {
    await ready;
    const r = await query(q.sql, q.params, q.mode === 'exec');
    reply = { id: q.id, ok: true, rows: r.rows, changes: r.changes };
  } catch (e: any) {
    reply = { id: q.id, ok: false, error: e?.message || String(e), code: e?.code };
  }
  port.postMessage(reply);
  Atomics.store(flag, 0, 1);
  Atomics.notify(flag, 0);
});
