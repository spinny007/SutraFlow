/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import type { Activity, ExecCtx } from '../engine/types.js';
import { requireResource, kvToObject, type Resource } from '../resources.js';
import { config } from '../config.js';
import { getSecret } from '../secrets.js';
import { F } from '../palettes/common.js';
import { resolveAdminText } from '../settings.js';
import { resolve, asText } from '../template.js';

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

/**
 * Checks a :name SQL statement against the designer's Parameters rows.
 * The runtime remains authoritative, but surfacing the same mistakes in the
 * designer prevents an avoidable failed run after deployment.
 */
export function namedParameterIssues(sql: unknown, rows: unknown, subject = 'SQL') {
  const used = [...new Set(namedParams(String(sql ?? '')).map(p => p.name))];
  const entries = (Array.isArray(rows) ? rows : []).map((row: any) => ({
    name: String(row?.k ?? ''),
    hasValue: row?.v !== undefined && row?.v !== null && String(row.v).length > 0,
  }));
  const names = entries.map(x => x.name).filter(Boolean);
  const uniqueNames = [...new Set(names)];
  const errors: string[] = [], warnings: string[] = [];

  if (entries.some(x => !x.name && x.hasValue)) errors.push('A Parameters row has a value but no name.');
  for (const name of uniqueNames) {
    if (name !== name.trim()) errors.push(`Parameter name "${name}" has leading or trailing spaces. Use "${name.trim()}".`);
    if (names.filter(n => n === name).length > 1) errors.push(`Parameter "${name}" is listed more than once. Keep one row.`);
  }

  const caseMismatches = new Set<string>();
  for (const name of used) {
    if (names.includes(name)) continue;
    const close = uniqueNames.find(n => n.trim().toLowerCase() === name.toLowerCase());
    if (close) {
      caseMismatches.add(close);
      if (close === close.trim()) errors.push(`${subject} uses :${name}, but Parameters contains "${close}". Parameter names are case-sensitive.`);
    } else {
      errors.push(`${subject} parameter :${name} has no value. Add "${name}" under Parameters.`);
    }
  }
  for (const name of uniqueNames) {
    if (!used.includes(name) && !caseMismatches.has(name)) warnings.push(`Parameter "${name}" is not used by the ${subject}. Remove it or add :${name} to the ${subject}.`);
  }
  return { errors, warnings };
}
export const namedParameterErrors = (sql: unknown, rows: unknown, subject = 'SQL') => namedParameterIssues(sql, rows, subject).errors;
export const namedParameterWarnings = (sql: unknown, rows: unknown, subject = 'SQL') => namedParameterIssues(sql, rows, subject).warnings;

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

const ADMIN_REF = /^(?:gv|ev)\./;
const REF = /\{\{((?:(?!\{\{|\}\}).)+)\}\}/gs;

/**
 * SQL text with {{...}} references. Project and Engine properties ({{gv.X}}, {{ev.X}}) are written into
 * the text: administrator-controlled names and clauses. Every other reference (run input, trigger data,
 * earlier outputs, local variables) becomes a bound parameter and never SQL text:
 *   WHERE id = {{input.id}}          -> WHERE id = :sutra_v1           (the value, its type kept)
 *   WHERE id = '{{input.id}}'        -> WHERE id = :sutra_v1           (the whole literal, as text)
 *   WHERE name LIKE '%{{input.q}}%'  -> WHERE name LIKE :sutra_v1     (the literal filled, as text)
 * Run data inside a "quoted" or `quoted` identifier, a comment or a $$ body cannot be bound and is refused.
 */
export function inlineRunData(text: unknown, scope: Record<string, any>, taken: Record<string, any> = {}, label = 'SQL text') {
  const sql = String(text ?? '');
  const params: Record<string, any> = {};
  if (sql.startsWith('=')) return { sql: resolveAdminText(sql, scope, label), params };
  if (!sql.includes('{{')) return { sql, params };
  let n = 0;
  const bind = (value: any) => {
    let name: string;
    do name = `sutra_v${++n}`; while (name in taken || name in params);
    params[name] = value === undefined ? null : value;
    return ':' + name;
  };
  const isRun = (ref: string) => !ADMIN_REF.test(ref.trim());
  const hasRun = (part: string) => [...part.matchAll(REF)].some(m => isRun(m[1]));
  const admin = (part: string) => part.replace(REF, (_all, ref: string) => asText(resolve(`{{${ref}}}`, scope)));
  const refuse = (where: string) => { throw new Error(`${label}: run data cannot be bound inside ${where}. Use a :name parameter where a value goes, or a checked Project property for a name.`); };
  let out = '', i = 0;
  while (i < sql.length) {
    const c = sql[i], two = sql.slice(i, i + 2);
    if (c === "'") {
      let e = i + 1;
      for (;;) { const q = sql.indexOf("'", e); if (q < 0) { e = sql.length; break; } if (sql[q + 1] === "'") { e = q + 2; continue; } e = q + 1; break; }
      const literal = sql.slice(i, e), inner = literal.slice(1, literal.endsWith("'") && literal.length > 1 ? -1 : undefined);
      out += hasRun(inner) ? bind(asText(resolve(inner.replace(/''/g, "'"), scope))) : admin(literal);
      i = e; continue;
    }
    let end = -1, where = '';
    if (c === '"' || c === '`') { const q = sql.indexOf(c, i + 1); end = q < 0 ? sql.length : q + 1; where = 'a quoted identifier'; }
    else if (two === '--') { const q = sql.indexOf('\n', i); end = q < 0 ? sql.length : q; where = 'a comment'; }
    else if (two === '/*') { const q = sql.indexOf('*/', i + 2); end = q < 0 ? sql.length : q + 2; where = 'a comment'; }
    else if (c === '$') {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i))?.[0];
      if (tag) { const q = sql.indexOf(tag, i + tag.length); end = q < 0 ? sql.length : q + tag.length; where = 'a $$ body'; }
    }
    if (end > i) { const part = sql.slice(i, end); if (hasRun(part)) refuse(where); out += admin(part); i = end; continue; }
    if (two === '{{') {
      const m = /^\{\{((?:(?!\{\{|\}\}).)+)\}\}/s.exec(sql.slice(i));
      if (m) { out += isRun(m[1]) ? bind(resolve(m[0], scope)) : asText(resolve(m[0], scope)); i += m[0].length; continue; }
    }
    out += c; i++;
  }
  return { sql: out, params };
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
  return dbConnection(requireResource(c.raw('connection'), 'database', 'Database connection'), c.secret);
}

/** The pooled connection of a database connection, for other parts that keep data in it (AI memory, knowledge). */
export async function dbConnection(r: Resource, secret: (n: string, w?: string) => string) {
  const cur = pools.get(r.id);
  if (cur && cur.rev === r.rev) return cur.conn;
  if (cur) cur.conn.then(x => x.close()).catch(() => {});
  const conn = open(r, secret);
  pools.set(r.id, { rev: r.rev!, conn });
  conn.catch(() => { if (pools.get(r.id)?.conn === conn) pools.delete(r.id); });
  return conn;
}
export async function closeDbPools() {
  const all = [...pools.values()];
  pools.clear();
  await Promise.all(all.map(p => p.conn.then(c => c.close()).catch(() => {})));
}

/** Refuse data-changing SQL in a designer preview. Returns the normalized SELECT text. */
export function assertReadOnlyPreviewSql(sqlText: unknown) {
  const text = String(sqlText || '').trim().replace(/;\s*$/, '');
  if (!/^\s*(?:select|with)\b/i.test(text)) throw new Error('Test query accepts SELECT or WITH queries only. Update, script and transaction activities must be tested as a Sutra.');
  // WITH can contain data-changing CTEs (and SELECT ... FOR UPDATE takes locks). Refuse every
  // mutating keyword outside strings, quoted identifiers and comments. A read-only database account
  // remains the strongest guard against side effects hidden inside a database function.
  let visible = '', i = 0;
  while (i < text.length) {
    const c = text[i], two = text.slice(i, i + 2);
    if (c === "'" || c === '"' || c === '`') {
      let e = i + 1;
      for (;;) { const q = text.indexOf(c, e); if (q < 0) { e = text.length; break; } if (text[q + 1] === c) { e = q + 2; continue; } e = q + 1; break; }
      visible += ' '; i = e; continue;
    }
    if (two === '--') { const e = text.indexOf('\n', i); visible += ' '; i = e < 0 ? text.length : e; continue; }
    if (two === '/*') { const e = text.indexOf('*/', i + 2); visible += ' '; i = e < 0 ? text.length : e + 2; continue; }
    visible += c; i++;
  }
  const mutating = /\b(insert|update|delete|merge|replace|call|execute|exec|create|alter|drop|truncate|grant|revoke|copy|vacuum|attach|detach|pragma)\b/i.exec(visible);
  if (mutating) throw new Error(`Test query is read-only and cannot contain ${mutating[1].toUpperCase()}. Test data-changing SQL by running the Sutra in a safe environment.`);
  return text;
}

/** Read-only designer preview. The wrapper limits work at the database; normal runs are unchanged. */
export async function previewDatabaseQuery(connectionId: string, sqlText: unknown, parameterRows: unknown, scope: Record<string, any>, limit = 10) {
  const issues = namedParameterIssues(sqlText, parameterRows);
  if (issues.errors.length) throw new Error(issues.errors.join('\n'));
  const resource = requireResource(connectionId, 'database', 'Database connection');
  const p = kvToObject(parameterRows, v => resolve(v, scope) as any) as Record<string, any>;
  const bound = inlineRunData(sqlText, scope, p, 'SQL text');
  const text = assertReadOnlyPreviewSql(bound.sql);
  const n = Math.max(1, Math.min(100, Math.floor(limit) || 10));
  const driver = resource.config.driver as Driver;
  let previewSql: string;
  if (driver === 'mssql') {
    if (/^\s*select\s+distinct\b/i.test(text)) previewSql = text.replace(/^\s*select\s+distinct\b/i, m => `${m} TOP (${n})`);
    else if (/^\s*select\b/i.test(text)) previewSql = text.replace(/^\s*select\b/i, m => `${m} TOP (${n})`);
    else previewSql = /\border\s+by\b/i.test(text) ? `${text} OFFSET 0 ROWS FETCH NEXT ${n} ROWS ONLY` : `${text} ORDER BY (SELECT NULL) OFFSET 0 ROWS FETCH NEXT ${n} ROWS ONLY`;
  } else if (driver === 'oracle') previewSql = `SELECT * FROM (${text}) sutra_preview WHERE ROWNUM <= ${n}`;
  else previewSql = `SELECT * FROM (${text}) AS sutra_preview LIMIT ${n}`;
  const secret = (name: string, what?: string) => {
    const value = getSecret(name);
    if (value === undefined) throw new Error(`${what || 'Secret'}: secret "${name}" does not exist`);
    return value;
  };
  const result = await (await dbConnection(resource, secret)).query(previewSql, { ...p, ...bound.params });
  return { ...result, rows: result.rows.slice(0, n), rowCount: result.rows.length, first: result.rows[0] ?? null, previewLimit: n };
}

const params = (c: ExecCtx) => kvToObject(c.raw('params'), v => c.resolve(v) as any) as Record<string, any>;
const adminText = (c: ExecCtx, key: string, label: string) => resolveAdminText(c.node.config?.[key], c.scope, label);
/** The SQL of a step with its run-data references bound, merged with the Parameters field. */
const sqlOf = (c: ExecCtx, label: string) => {
  const p = params(c);
  const r = inlineRunData(c.node.config?.sql, c.scope, p, label);
  return { sql: r.sql, p: { ...p, ...r.params } };
};
const conn = F('connection', 'Database connection', 'resource', '', { resourceKind: 'database' });
const paramField = F('params', 'Parameters', 'kv', [{ k: 'id', v: '{{input.orderId}}' }], { tpl: true, help: 'Values for :name placeholders in the SQL. Always sent as bound parameters.' });

export const dbActivities: Activity[] = [
  {
    type: 'dbQuery', palette: 'db', name: 'SQL query', glyph: '⛁', ports: ['out', 'empty'],
    desc: 'Runs a SELECT and returns the rows. No rows goes to the empty output.',
    fields: [conn, F('sql', 'SQL', 'code', 'SELECT id, customer, amount\nFROM orders\nWHERE id = :id', { vars: true, help: 'Project and Engine properties ({{gv.X}}, {{ev.X}}) are written into the SQL: names and clauses. Run data such as {{input.id}} is always sent as a bound parameter, the same as a :name parameter.' }), paramField, F('maxRows', 'Maximum rows', 'number', 10000)],
    designCheck: cfg => namedParameterWarnings(cfg.sql, cfg.params),
    designErrors: cfg => namedParameterErrors(cfg.sql, cfg.params),
    outputHint: { rows: [{}], rowCount: 0, columns: [''] },
    execute: async c => {
      const { sql, p } = sqlOf(c, 'SQL text');
      const r = await (await connFor(c)).query(sql, p);
      const max = Number(c.raw('maxRows')) || 10000;
      if (r.rows.length > max) throw new Error(`Query returned ${r.rows.length} rows, more than the maximum of ${max}`);
      return { port: r.rows.length ? 'out' : 'empty', out: { ...r, first: r.rows[0] ?? null } };
    },
  },
  {
    type: 'dbUpdate', palette: 'db', name: 'SQL update', glyph: '⛃', ports: ['out'],
    desc: 'Runs INSERT, UPDATE, DELETE or MERGE and returns the number of affected rows (and RETURNING rows where supported).',
    fields: [conn, F('sql', 'SQL', 'code', 'UPDATE orders SET status = :status WHERE id = :id', { vars: true, help: 'Project and Engine properties ({{gv.X}}, {{ev.X}}) are written into the SQL: names and clauses. Run data such as {{input.id}} is always sent as a bound parameter, the same as a :name parameter.' }), F('params', 'Parameters', 'kv', [{ k: 'id', v: '{{input.orderId}}' }, { k: 'status', v: 'SHIPPED' }], { tpl: true, help: 'Values for :name placeholders.' }),
      F('expect', 'Fail when no row is affected', 'bool', false)],
    designCheck: cfg => namedParameterWarnings(cfg.sql, cfg.params),
    designErrors: cfg => namedParameterErrors(cfg.sql, cfg.params),
    outputHint: { rowCount: 0, rows: [] },
    execute: async c => {
      const { sql, p } = sqlOf(c, 'SQL text');
      const r = await (await connFor(c)).query(sql, p);
      if (c.raw('expect') && !r.rowCount) throw new Error('No row was affected');
      return { out: r };
    },
  },
  {
    type: 'dbProcedure', palette: 'db', name: 'Call procedure', glyph: '⚙', ports: ['out'],
    desc: 'Calls a stored procedure with named parameters (in order for PostgreSQL, MySQL and Oracle).',
    fields: [conn, F('procedure', 'Procedure name', 'text', 'process_order'), F('params', 'Parameters (in order)', 'kv', [{ k: 'p_order_id', v: '{{input.orderId}}' }], { tpl: true })],
    outputHint: { rows: [], rowCount: 0, outputs: {} },
    execute: async c => ({ out: await (await connFor(c)).procedure(adminText(c, 'procedure', 'Procedure name'), params(c)) }),
  },
  {
    type: 'dbScript', palette: 'db', name: 'SQL script', glyph: '⛭', ports: ['out'], timeoutMs: 600000,
    desc: 'Runs an install or change script: CREATE DATABASE, CREATE TABLE, CREATE PROCEDURE, seed rows. Statements are separated by a line with only ";" and run one after another, not in one transaction: most databases keep table and procedure changes at once.',
    fields: [conn,
      F('sql', 'Script', 'code', 'CREATE TABLE IF NOT EXISTS customers (\n  id VARCHAR(20) PRIMARY KEY,\n  name VARCHAR(100) NOT NULL\n)\n;\nINSERT INTO customers (id, name) VALUES (:id, :name)', { vars: true, help: 'Project and Engine properties ({{gv.X}}, {{ev.X}}) are written into the script: database and object names. Run data such as {{input.id}} is always sent as a bound parameter, the same as a :name parameter.' }),
      F('params', 'Parameters', 'kv', [], { tpl: true, help: 'Values for :name placeholders in any statement. Always sent as bound parameters.' }),
      F('onError', 'When a statement fails', 'select', 'stop', { options: ['stop', 'continue'], help: 'Stop: the step fails at that statement (those before it stay done). Continue: runs the rest and lists the failures.' })],
    designCheck: cfg => namedParameterWarnings(cfg.sql, cfg.params, 'SQL script'),
    designErrors: cfg => namedParameterErrors(cfg.sql, cfg.params, 'SQL script'),
    outputHint: { results: [{ n: 0, statement: '', ok: true, rowCount: 0, error: '' }], ran: 0, failed: 0 },
    execute: async c => {
      const { sql, p } = sqlOf(c, 'SQL script');
      const stmts = sql.split(/^\s*;\s*$/m).map(s => s.trim()).filter(Boolean);
      if (!stmts.length) throw new Error('The script has no statements');
      const db = await connFor(c);
      const results: { n: number; statement: string; ok: boolean; rowCount: number; rows?: any[]; error?: string }[] = [];
      for (const [i, s] of stmts.entries()) {
        const statement = s.replace(/\s+/g, ' ').slice(0, 80);
        try {
          const r = await db.query(s, Object.fromEntries(namedParams(s).map(n => [n.name, p[n.name]])));
          results.push({ n: i + 1, statement, ok: true, rowCount: r.rowCount, ...(r.rows.length ? { rows: r.rows } : {}) });
        } catch (e: any) {
          if (c.raw('onError') !== 'continue') throw new Error(`Statement ${i + 1} of ${stmts.length} failed (${statement}): ${e.message}`);
          results.push({ n: i + 1, statement, ok: false, rowCount: 0, error: e.message });
        }
      }
      return { out: { results, ran: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length } };
    },
  },
  {
    type: 'dbTransaction', palette: 'db', name: 'SQL transaction', glyph: '⛬', ports: ['out'],
    desc: 'Runs several statements in one transaction: all succeed or none are kept. Statements are separated by a line with only ";".',
    fields: [conn, F('sql', 'Statements', 'code', 'INSERT INTO audit(order_id, action) VALUES (:id, \'ship\')\n;\nUPDATE orders SET status = \'SHIPPED\' WHERE id = :id', { vars: true, help: 'Project and Engine properties ({{gv.X}}, {{ev.X}}) are written into the SQL: names and clauses. Run data such as {{input.id}} is always sent as a bound parameter, the same as a :name parameter.' }), paramField],
    designCheck: cfg => namedParameterWarnings(cfg.sql, cfg.params, 'SQL transaction'),
    designErrors: cfg => namedParameterErrors(cfg.sql, cfg.params, 'SQL transaction'),
    outputHint: { results: [{ rowCount: 0 }] },
    execute: async c => {
      const { sql, p } = sqlOf(c, 'SQL transaction');
      const stmts = sql.split(/^\s*;\s*$/m).map(s => s.trim()).filter(Boolean);
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
