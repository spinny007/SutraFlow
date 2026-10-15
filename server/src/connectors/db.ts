import path from 'node:path';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import type { Activity, ExecCtx } from '../engine/types.js';
import { requireResource, kvToObject, type Resource } from '../resources.js';
import { config } from '../config.js';
import { F } from '../palettes/common.js';

const require = createRequire(import.meta.url);

/**
 * DB Ops palette. SQL is written with :name parameters for every database; the
 * values are always sent as bound parameters (never pasted into the SQL), which
 * prevents SQL injection from mapped data.
 */
type Driver = 'postgres' | 'mysql' | 'mssql' | 'oracle' | 'sqlite';
export interface DbResult { rows: any[]; rowCount: number; columns: string[] }
interface Conn {
  query(sql: string, params: Record<string, any>): Promise<DbResult>;
  procedure(name: string, params: Record<string, any>): Promise<DbResult & { outputs?: Record<string, any> }>;
  transaction<T>(fn: (q: (sql: string, params: Record<string, any>) => Promise<DbResult>) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Finds :name parameters outside quotes and comments, skipping ::casts. */
export function namedParams(sql: string) {
  const out: { name: string; start: number; end: number }[] = [];
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'" || c === '"' || c === '`') { const e = sql.indexOf(c, i + 1); i = e < 0 ? sql.length : e + 1; continue; }
    if (c === '-' && sql[i + 1] === '-') { const e = sql.indexOf('\n', i); i = e < 0 ? sql.length : e; continue; }
    if (c === '/' && sql[i + 1] === '*') { const e = sql.indexOf('*/', i + 2); i = e < 0 ? sql.length : e + 2; continue; }
    if (c === ':' && sql[i + 1] === ':') { i += 2; continue; }
    if (c === ':' && /[A-Za-z_]/.test(sql[i + 1] || '') && sql[i - 1] !== ':') {
      const m = /^[A-Za-z_]\w*/.exec(sql.slice(i + 1))!;
      out.push({ name: m[0], start: i, end: i + 1 + m[0].length });
      i += 1 + m[0].length;
      continue;
    }
    i++;
  }
  return out;
}

/** Rewrites :name to the driver's placeholder style. */
export function bindFor(driver: Driver, sql: string, params: Record<string, any>) {
  const ps = namedParams(sql);
  for (const p of ps) if (!(p.name in params)) throw new Error(`SQL parameter :${p.name} has no value. Add it under Parameters.`);
  if (driver === 'oracle' || driver === 'sqlite') return { sql, values: Object.fromEntries(ps.map(p => [p.name, params[p.name]])) };
  let out = '', last = 0;
  const values: any[] = [];
  ps.forEach((p, i) => {
    out += sql.slice(last, p.start) + (driver === 'postgres' ? `$${i + 1}` : driver === 'mssql' ? `@${p.name}` : '?');
    values.push(params[p.name]);
    last = p.end;
  });
  return { sql: out + sql.slice(last), values };
}

const toRows = (rows: any[], fields?: { name: string }[]): DbResult => ({ rows, rowCount: rows.length, columns: fields?.map(f => f.name) ?? (rows[0] ? Object.keys(rows[0]) : []) });

async function open(r: Resource, secret: (n: string, w?: string) => string): Promise<Conn> {
  const c = r.config;
  const driver = c.driver as Driver;
  const pass = () => (c.passwordSecret ? secret(c.passwordSecret, 'Database password') : undefined);
  const ssl = c.ssl ? { rejectUnauthorized: c.verifyTls !== false } : undefined;
  const max = Number(c.poolMax) || 10;
  switch (driver) {
    case 'postgres': {
      const { Pool } = require('pg');
      const pool = new Pool({ host: c.host, port: Number(c.port) || 5432, database: c.database, user: c.user, password: pass(), ssl, max });
      const run = async (cl: any, sql: string, p: Record<string, any>) => { const b = bindFor(driver, sql, p); const res = await cl.query(b.sql, b.values); return { ...toRows(res.rows || [], res.fields), rowCount: res.rowCount ?? res.rows?.length ?? 0 }; };
      return {
        query: (sql, p) => run(pool, sql, p),
        procedure: (name, p) => run(pool, `CALL ${ident(name)}(${Object.keys(p).map(k => ':' + k).join(', ')})`, p),
        transaction: async fn => { const cl = await pool.connect(); try { await cl.query('BEGIN'); const v = await fn((s, p) => run(cl, s, p)); await cl.query('COMMIT'); return v; } catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); } },
        close: () => pool.end(),
      };
    }
    case 'mysql': {
      const mysql = require('mysql2/promise');
      const pool = mysql.createPool({ host: c.host, port: Number(c.port) || 3306, database: c.database, user: c.user, password: pass(), ssl, connectionLimit: max, dateStrings: true });
      const run = async (cl: any, sql: string, p: Record<string, any>): Promise<DbResult> => {
        const b = bindFor(driver, sql, p);
        // Prepared statements first; some statements (CREATE or DROP PROCEDURE, ...) are not allowed in
        // them (MySQL error 1295), so those run as text with every value escaped by the driver.
        const [res, fields] = await cl.execute(b.sql, b.values).catch((e: any) => {
          if (e?.errno !== 1295) throw e;
          return cl.query(b.sql, b.values);
        });
        // CALL returns several result sets (the procedure's rows, then a status); the first holds the rows.
        if (Array.isArray(res) && Array.isArray(res[0])) return toRows(res[0], Array.isArray((fields as any)?.[0]) ? (fields as any)[0] : undefined);
        return Array.isArray(res) ? toRows(res as any[], fields) : { rows: [], rowCount: (res as any).affectedRows ?? 0, columns: [], ...(res as any).insertId ? { insertId: (res as any).insertId } : {} } as any;
      };
      return {
        query: (sql, p) => run(pool, sql, p),
        procedure: async (name, p) => { const r2 = await run(pool, `CALL ${ident(name)}(${Object.keys(p).map(k => ':' + k).join(', ')})`, p); return { ...r2, rows: Array.isArray(r2.rows[0]) ? r2.rows[0] : r2.rows }; },
        transaction: async fn => { const cl = await pool.getConnection(); try { await cl.beginTransaction(); const v = await fn((s, p) => run(cl, s, p)); await cl.commit(); return v; } catch (e) { await cl.rollback().catch(() => {}); throw e; } finally { cl.release(); } },
        close: () => pool.end(),
      };
    }
    case 'mssql': {
      const sql = require('mssql');
      const pool = await new sql.ConnectionPool({ server: c.host, port: Number(c.port) || 1433, database: c.database, user: c.user, password: pass(), pool: { max }, options: { encrypt: !!c.ssl, trustServerCertificate: c.verifyTls === false } }).connect();
      const run = async (req: any, s: string, p: Record<string, any>): Promise<DbResult> => {
        const b = bindFor(driver, s, p);
        for (const n of namedParams(s)) req.input(n.name, p[n.name]);
        const res = await req.query(b.sql);
        return { ...toRows(res.recordset || []), rowCount: res.recordset ? res.recordset.length : (res.rowsAffected || []).reduce((a: number, x: number) => a + x, 0) };
      };
      return {
        query: (s, p) => run(pool.request(), s, p),
        procedure: async (name, p) => { const req = pool.request(); for (const [k, v] of Object.entries(p)) req.input(k, v); const res = await req.execute(name); return { ...toRows(res.recordset || []), outputs: res.output }; },
        transaction: async fn => { const t = new sql.Transaction(pool); await t.begin(); try { const v = await fn((s, p) => run(new sql.Request(t), s, p)); await t.commit(); return v; } catch (e) { await t.rollback().catch(() => {}); throw e; } },
        close: () => pool.close(),
      };
    }
    case 'oracle': {
      const oracledb = require('oracledb');
      const pool = await oracledb.createPool({ user: c.user, password: pass(), connectString: `${c.host}:${Number(c.port) || 1521}/${c.database}`, poolMax: max });
      const run = async (conn: any, s: string, p: Record<string, any>, commit: boolean): Promise<DbResult> => {
        const b = bindFor(driver, s, p);
        const res = await conn.execute(b.sql, b.values, { outFormat: oracledb.OUT_FORMAT_OBJECT, autoCommit: commit });
        return { rows: res.rows || [], rowCount: res.rows ? res.rows.length : res.rowsAffected ?? 0, columns: (res.metaData || []).map((m: any) => m.name) };
      };
      const withConn = async <T>(fn: (cn: any) => Promise<T>) => { const cn = await pool.getConnection(); try { return await fn(cn); } finally { await cn.close(); } };
      return {
        query: (s, p) => withConn(cn => run(cn, s, p, true)),
        procedure: (name, p) => withConn(cn => run(cn, `BEGIN ${ident(name)}(${Object.keys(p).map(k => ':' + k).join(', ')}); END;`, p, true)),
        transaction: fn => withConn(async cn => { try { const v = await fn((s, p) => run(cn, s, p, false)); await cn.commit(); return v; } catch (e) { await cn.rollback().catch(() => {}); throw e; } }),
        close: () => pool.close(0),
      };
    }
    case 'sqlite': {
      const file = path.isAbsolute(c.file) ? c.file : path.join(config.dataDir, c.file || 'app.sqlite');
      const db = new DatabaseSync(file);
      const run = async (s: string, p: Record<string, any>): Promise<DbResult> => {
        const b = bindFor(driver, s, p);
        const st = db.prepare(b.sql);
        if (/^\s*(select|with|pragma)\b/i.test(s) || /\breturning\b/i.test(s)) return toRows(st.all(b.values as any) as any[]);
        const res = st.run(b.values as any);
        return { rows: [], rowCount: Number(res.changes), columns: [], lastInsertId: Number(res.lastInsertRowid) } as any;
      };
      return {
        query: run,
        procedure: async () => { throw new Error('SQLite has no stored procedures'); },
        transaction: async fn => { db.exec('begin'); try { const v = await fn(run); db.exec('commit'); return v; } catch (e) { db.exec('rollback'); throw e; } },
        close: async () => db.close(),
      };
    }
  }
  throw new Error(`Unsupported database ${driver}`);
}

/** Procedure names: letters, digits, _ . $ # only (they cannot be bound as parameters). */
function ident(name: string) {
  if (!/^[A-Za-z_][\w.$#]*$/.test(name)) throw new Error(`"${name}" is not a valid procedure name`);
  return name;
}

/** One pool per connection; a changed connection (or ops override) closes the old pool. */
const pools = new Map<string, { rev: string; conn: Promise<Conn> }>();
async function connFor(c: ExecCtx) {
  const r = requireResource(c.raw('connection'), 'database', 'Database connection');
  const cur = pools.get(r.id);
  if (cur && cur.rev === r.rev) return cur.conn;
  if (cur) cur.conn.then(x => x.close()).catch(() => {});
  const conn = open(r, c.secret);
  pools.set(r.id, { rev: r.rev!, conn });
  conn.catch(() => { if (pools.get(r.id)?.conn === conn) pools.delete(r.id); });
  return conn;
}
export async function closeDbPools() {
  const all = [...pools.values()];
  pools.clear();
  await Promise.all(all.map(p => p.conn.then(c => c.close()).catch(() => {})));
}

const params = (c: ExecCtx) => kvToObject(c.raw('params'), v => c.resolve(v) as any) as Record<string, any>;
const conn = F('connection', 'Database connection', 'resource', '', { resourceKind: 'database' });
const paramField = F('params', 'Parameters', 'kv', [{ k: 'id', v: '{{input.orderId}}' }], { tpl: true, help: 'Values for :name placeholders in the SQL. Always sent as bound parameters.' });

export const dbActivities: Activity[] = [
  {
    type: 'dbQuery', palette: 'db', name: 'SQL query', glyph: '⛁', ports: ['out', 'empty'],
    desc: 'Runs a SELECT and returns the rows. No rows goes to the empty output.',
    fields: [conn, F('sql', 'SQL', 'code', 'SELECT id, customer, amount\nFROM orders\nWHERE id = :id'), paramField, F('maxRows', 'Maximum rows', 'number', 10000)],
    outputHint: { rows: [{}], rowCount: 0, columns: [''] },
    execute: async c => {
      const r = await (await connFor(c)).query(String(c.raw('sql') || ''), params(c));
      const max = Number(c.raw('maxRows')) || 10000;
      if (r.rows.length > max) throw new Error(`Query returned ${r.rows.length} rows, more than the maximum of ${max}`);
      return { port: r.rows.length ? 'out' : 'empty', out: { ...r, first: r.rows[0] ?? null } };
    },
  },
  {
    type: 'dbUpdate', palette: 'db', name: 'SQL update', glyph: '⛃', ports: ['out'],
    desc: 'Runs INSERT, UPDATE, DELETE or MERGE and returns the number of affected rows (and RETURNING rows where supported).',
    fields: [conn, F('sql', 'SQL', 'code', 'UPDATE orders SET status = :status WHERE id = :id'), F('params', 'Parameters', 'kv', [{ k: 'id', v: '{{input.orderId}}' }, { k: 'status', v: 'SHIPPED' }], { tpl: true, help: 'Values for :name placeholders.' }),
      F('expect', 'Fail when no row is affected', 'bool', false)],
    outputHint: { rowCount: 0, rows: [] },
    execute: async c => {
      const r = await (await connFor(c)).query(String(c.raw('sql') || ''), params(c));
      if (c.raw('expect') && !r.rowCount) throw new Error('No row was affected');
      return { out: r };
    },
  },
  {
    type: 'dbProcedure', palette: 'db', name: 'Call procedure', glyph: '⚙', ports: ['out'],
    desc: 'Calls a stored procedure with named parameters (in order for PostgreSQL, MySQL and Oracle).',
    fields: [conn, F('procedure', 'Procedure name', 'text', 'process_order'), F('params', 'Parameters (in order)', 'kv', [{ k: 'p_order_id', v: '{{input.orderId}}' }], { tpl: true })],
    outputHint: { rows: [], rowCount: 0, outputs: {} },
    execute: async c => ({ out: await (await connFor(c)).procedure(String(c.raw('procedure') || ''), params(c)) }),
  },
  {
    type: 'dbTransaction', palette: 'db', name: 'SQL transaction', glyph: '⛬', ports: ['out'],
    desc: 'Runs several statements in one transaction: all succeed or none are kept. Statements are separated by a line with only ";".',
    fields: [conn, F('sql', 'Statements', 'code', 'INSERT INTO audit(order_id, action) VALUES (:id, \'ship\')\n;\nUPDATE orders SET status = \'SHIPPED\' WHERE id = :id'), paramField],
    outputHint: { results: [{ rowCount: 0 }] },
    execute: async c => {
      const stmts = String(c.raw('sql') || '').split(/^\s*;\s*$/m).map(s => s.trim()).filter(Boolean);
      const p = params(c);
      const results = await (await connFor(c)).transaction(async q => {
        const out: DbResult[] = [];
        for (const s of stmts) out.push(await q(s, Object.fromEntries(namedParams(s).map(n => [n.name, p[n.name]]))));
        return out;
      });
      return { out: { results: results.map(r => ({ rowCount: r.rowCount, rows: r.rows })) } };
    },
  },
];

/** Test connection: opens a connection, runs a trivial query, closes it. */
export async function testDatabase(r: Resource, secret: (n: string, w?: string) => string) {
  const conn = await open(r, secret);
  try {
    await conn.query(r.config.driver === 'oracle' ? 'select 1 as ok from dual' : 'select 1 as ok', {});
    return `Connected to ${r.config.driver}${r.config.database ? ` database ${r.config.database}` : ''}${r.config.host ? ` on ${r.config.host}` : ''}`;
  } finally {
    await conn.close().catch(() => {});
  }
}

// Every DB activity also returns which connection ran it and how long it took.
for (const a of dbActivities) {
  const run = a.execute;
  a.execute = async c => {
    const t0 = Date.now();
    const r = (await run(c)) as any;
    const res = requireResource(c.raw('connection'), 'database', 'Database connection');
    if (r?.out && typeof r.out === 'object') r.out = { ...r.out, connection: res.name, driver: res.config.driver, ms: Date.now() - t0 };
    return r;
  };
  if (a.outputHint) a.outputHint = { ...a.outputHint, connection: '', driver: '', ms: 0 };
}
