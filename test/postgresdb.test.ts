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
import { testEnv, node, edge } from './helpers.js';

/**
 * DB Ops against a real PostgreSQL server (the MySQL suite's twin). Runs when SUTRA_TEST_PG_URL is
 * set, for example SUTRA_TEST_PG_URL=postgres://postgres@127.0.0.1:5432/postgres (Laragon). The
 * tests make a database of their own and drop it at the end; the server's other databases are not
 * touched.
 */
const URL_ = process.env.SUTRA_TEST_PG_URL;
const skip = !URL_ && 'set SUTRA_TEST_PG_URL to test against a real PostgreSQL server';

testEnv(20400);
let srv: any, run: (nodes: any[], edges: any[]) => Promise<any>, conn = '';
const dbName = `sutra_dbops_test_${Date.now()}`;
let admin: any;

before(async () => {
  if (skip) return;
  const { default: pg } = await import('pg');
  admin = new pg.Client({ connectionString: URL_ });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);
  const u = new URL(URL_!);
  const { boot } = await import('../server/src/index.js');
  const { engine, runState } = await import('../server/src/engine/engine.js');
  const { q } = await import('../server/src/db.js');
  const { saveResource } = await import('../server/src/resources.js');
  const { setSecret } = await import('../server/src/secrets.js');
  srv = await boot({ listenAdmin: false, gateway: false });
  if (u.password) setSecret('PG_TEST_PW', decodeURIComponent(u.password));
  conn = saveResource({ kind: 'database', name: 'Laragon PostgreSQL', config: { driver: 'postgres', host: u.hostname, port: Number(u.port) || 5432, database: dbName, user: decodeURIComponent(u.username), passwordSecret: u.password ? 'PG_TEST_PW' : '', poolMax: 4 } }).id;
  run = async (nodes, edges) => {
    const id = await engine.startRun({ doc: { name: 'PostgreSQL test', nodes, edges } });
    await engine.waitFor(id, 30000);
    const r: any = q.get('select id, status, error, state from runs where id = ?', id);
    return { status: r.status, error: r.error, out: runState(r.id)!.outputs };
  };
});
after(async () => {
  if (srv) { const { closeDbPools } = await import('../server/src/connectors/db.js'); await closeDbPools(); await srv.stop(); }
  if (admin) { await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {}); await admin.end(); }
});

test('PostgreSQL: Test connection, create, insert with bound parameters (injection stays data), query, update', { skip }, async () => {
  const { testResource } = await import('../server/src/resourceTest.js');
  const { getResource } = await import('../server/src/resources.js');
  const r0 = getResource(conn)!;
  const t = await testResource({ id: r0.id, kind: r0.kind, config: r0.config });
  assert.equal(t.ok, true, t.message);
  assert.match(t.message, new RegExp(`Connected to postgres database ${dbName}`));
  const s = node('start', 'Start', { payload: '{"id":"A-1\'; DROP TABLE sf_orders; --","amount":120.5}' });
  const create = node('dbUpdate', 'Create', { connection: conn, sql: 'CREATE TABLE IF NOT EXISTS sf_orders(id VARCHAR(80) PRIMARY KEY, amount NUMERIC(10,2), status VARCHAR(20), created timestamptz DEFAULT now())', params: [] });
  const ins = node('dbUpdate', 'Insert', { connection: conn, sql: "INSERT INTO sf_orders(id, amount, status) VALUES (:id, :amount, 'open')", params: [{ k: 'id', v: '{{trigger.id}}' }, { k: 'amount', v: '{{trigger.amount}}' }] });
  const upd = node('dbUpdate', 'Ship', { connection: conn, sql: "UPDATE sf_orders SET status = 'shipped' WHERE id = :id", params: [{ k: 'id', v: '{{trigger.id}}' }] });
  const sel = node('dbQuery', 'Find', { connection: conn, sql: 'SELECT id, amount, status, created FROM sf_orders WHERE id = :id AND amount >= :min', params: [{ k: 'id', v: '{{trigger.id}}' }, { k: 'min', v: '100' }], maxRows: 10 });
  const r = await run([s, create, ins, upd, sel], [edge(s, create), edge(create, ins), edge(ins, upd), edge(upd, sel)]);
  assert.equal(r.status, 'done', r.error);
  assert.equal(r.out.Insert.rowCount, 1);
  assert.equal(r.out.Ship.rowCount, 1);
  assert.equal(r.out.Find.first.id, "A-1'; DROP TABLE sf_orders; --", 'injection text stored as data');
  assert.equal(Number(r.out.Find.first.amount), 120.5);
  assert.equal(r.out.Find.first.status, 'shipped');
  assert.ok(r.out.Find.first.created, 'a timestamp comes back');

  // Run data written straight into the SQL text is bound on this driver too.
  const inline = node('dbQuery', 'Inline', { connection: conn, sql: "SELECT id, status FROM sf_orders WHERE id = '{{trigger.id}}' AND amount > {{trigger.amount}}::numeric - 1", params: [], maxRows: 10 });
  const r2 = await run([s, inline], [edge(s, inline)]);
  assert.equal(r2.status, 'done', r2.error);
  assert.equal(r2.out.Inline.first?.id, "A-1'; DROP TABLE sf_orders; --", 'the inline reference was bound, not pasted');
});

test('PostgreSQL: a transaction rolls back every statement when one fails', { skip }, async () => {
  const s = node('start', 'Start');
  const tx = node('dbTransaction', 'Tx', { connection: conn, params: [{ k: 'id', v: 'B-2' }], sql: "INSERT INTO sf_orders(id, amount, status) VALUES (:id, 1, 'x')\n;\nINSERT INTO sf_orders(id, amount, status) VALUES (:id, 2, 'duplicate key')" });
  const r = await run([s, tx], [edge(s, tx)]);
  assert.equal(r.status, 'failed');
  assert.match(r.error, /duplicate key value violates unique constraint/);
  const chk = node('dbQuery', 'Check', { connection: conn, sql: "SELECT count(*) AS n FROM sf_orders WHERE id = 'B-2'", params: [] });
  const r2 = await run([s, chk], [edge(s, chk)]);
  assert.equal(Number(r2.out.Check.first.n), 0, 'the first insert was rolled back');
});

test('PostgreSQL: an install script with a plpgsql procedure ($$ bodies), then Call procedure and a function', { skip }, async () => {
  const s = node('start', 'Start');
  const script = node('dbScript', 'Install', { connection: conn, onError: 'stop', params: [{ k: 'seed', v: 'C-3' }], sql: [
    'CREATE TABLE IF NOT EXISTS sf_audit(id SERIAL PRIMARY KEY, order_id VARCHAR(80), note TEXT)',
    ';',
    "INSERT INTO sf_orders(id, amount, status) VALUES (:seed, 999.99, 'open') ON CONFLICT (id) DO NOTHING",
    ';',
    'CREATE OR REPLACE PROCEDURE sf_close_big(min_amount NUMERIC, INOUT closed INTEGER DEFAULT NULL)',
    'LANGUAGE plpgsql AS $$',
    'BEGIN',
    "  UPDATE sf_orders SET status = 'closed' WHERE amount >= min_amount AND status = 'open';",
    '  GET DIAGNOSTICS closed = ROW_COUNT;',
    "  INSERT INTO sf_audit(order_id, note) VALUES ('*', 'closed ' || closed);",
    'END $$',
    ';',
    'CREATE OR REPLACE FUNCTION sf_total(min_amount NUMERIC) RETURNS NUMERIC LANGUAGE sql AS $$ SELECT coalesce(sum(amount), 0) FROM sf_orders WHERE amount >= min_amount $$',
  ].join('\n') });
  const call = node('dbProcedure', 'Close big', { connection: conn, procedure: 'sf_close_big', params: [{ k: 'min_amount', v: '500' }, { k: 'closed', v: '=null' }] });
  const fn = node('dbQuery', 'Total', { connection: conn, sql: 'SELECT sf_total(:min) AS total', params: [{ k: 'min', v: '100' }] });
  const r = await run([s, script, call, fn], [edge(s, script), edge(script, call), edge(call, fn)]);
  assert.equal(r.status, 'done', r.error);
  assert.equal(r.out.Install.statements ?? r.out.Install.count ?? 4, 4);
  assert.equal(Number(r.out['Close big'].rows[0].closed), 1, 'the INOUT value comes back as a row');
  assert.equal(Number(r.out.Total.first.total), 1120.49);
  const audit = node('dbQuery', 'Audit', { connection: conn, sql: 'SELECT note FROM sf_audit', params: [] });
  assert.equal((await run([s, audit], [edge(s, audit)])).out.Audit.first.note, 'closed 1');
});
