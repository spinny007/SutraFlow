/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { testEnv } from './helpers.js';

/** sutra db copy: everything from SQLite to PostgreSQL (PGlite here; a real server with SUTRA_TEST_PG_URL). */
testEnv(19970);
const dbm = await import('../server/src/db.js');
const { config } = await import('../server/src/config.js');
const projects = await import('../server/src/projects.js');
const flows = await import('../server/src/flows.js');
const { setSecret, getSecret } = await import('../server/src/secrets.js');
after(() => dbm.closeDb());

function seed() {
  delete (config as any).dbUrl; (config as any).dbUrl = '';
  dbm.openDb();
  const pid = projects.saveProject({ name: 'Shop', description: "Asha's shop", config: { variables: [{ name: 'INBOX', type: 'string', value: 'C:/in' }] } }).id;
  for (let i = 1; i <= 3; i++) flows.saveFlow(undefined, { name: `Sutra ${i}`, nodes: [{ id: 's', type: 'start', name: 'Start', x: 0, y: 0, config: {} }], edges: [] }, pid);
  setSecret('SHOP_KEY', 'secret-value-1');
  for (let i = 0; i < 1203; i++) dbm.q.run(`insert into gw_requests(at, kind, method, path, status, ms) values(?, 'rest', 'GET', '/x', 200, ?)`, new Date().toISOString(), i);
  return pid;
}

async function check(target: string) {
  seed();
  const r = dbm.copyDatabase(target, { log: () => {} });
  assert.ok(r.tables.find(t => t.table === 'gw_requests')!.rows === 1203, 'more than two batches');
  assert.throws(() => dbm.copyDatabase(target), /already has data in .*projects/, 'a target with data is refused');
  assert.equal(dbm.copyDatabase(target, { replace: true }).rows, r.rows, 'replace copies again');
  // Open the target as the server would.
  (config as any).dbUrl = target;
  dbm.openDb();
  assert.equal(dbm.dbKind(), 'postgres');
  assert.deepEqual(flows.listFlows().map(f => f.name).sort(), ['Sutra 1', 'Sutra 2', 'Sutra 3']);
  assert.equal(projects.listProjects().find(p => p.name === 'Shop')!.description, "Asha's shop");
  assert.equal(getSecret('SHOP_KEY'), 'secret-value-1', 'secrets stay readable with the same master key');
  dbm.q.run(`insert into gw_requests(at, kind, method, path, status, ms) values(?, 'rest', 'GET', '/y', 200, 1)`, new Date().toISOString());
  assert.equal(Number(dbm.q.get<any>(`select max(id) as m from gw_requests`).m), 1204, 'ids continue after the copied rows');
  dbm.closeDb();
  (config as any).dbUrl = '';
}

test('SQLite to PostgreSQL (PGlite): every table, batches, refusal, replace, ids continue', async () => {
  await check(`pglite:${fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-pg-'))}`);
});

const PG = process.env.SUTRA_TEST_PG_URL;
test('SQLite to a real PostgreSQL server', { skip: !PG && 'set SUTRA_TEST_PG_URL, for example postgres://postgres@127.0.0.1:5432/postgres' }, async () => {
  const { default: pg } = await import('pg');
  const name = `sutra_copy_test_${Date.now()}`;
  const admin = new pg.Client({ connectionString: PG });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  try {
    const u = new URL(PG!); u.pathname = `/${name}`;
    // A fresh data folder so the SQLite side starts empty.
    process.env.SUTRA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-test-'));
    (config as any).dataDir = process.env.SUTRA_DATA_DIR;
    await check(u.toString());
  } finally {
    await new Promise(r => setTimeout(r, 500));
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  }
});
