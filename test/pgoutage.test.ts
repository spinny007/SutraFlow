/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.8.0
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { testEnv, node, edge } from './helpers.js';

/**
 * PostgreSQL goes away for a while (a restart, a network cut): the engine opens its connections again
 * and goes on, instead of waiting for ever on a connection that is gone. Found by the soak test.
 * Needs SUTRA_TEST_PG_URL; the engine reaches its own database through a proxy this test can cut.
 */
const ADMIN = process.env.SUTRA_TEST_PG_URL;
testEnv(20890);
let dbName = '', adminClient: any, cut: (ms: number) => Promise<void> = async () => {}, stopProxy = () => {};
if (ADMIN) {
  const { default: pg } = await import('pg');
  adminClient = new pg.Client({ connectionString: ADMIN });
  adminClient.on('error', () => {});
  await adminClient.connect();
  dbName = `sutra_outage_${Date.now()}`;
  await adminClient.query(`CREATE DATABASE ${dbName}`);
  // The proxy runs in a process of its own: the engine's synchronous calls block this one.
  const u = new URL(ADMIN);
  const script = `const net=require('net');const socks=new Set();let down=false;
const srv=net.createServer(c=>{if(down)return c.destroy();const s=net.connect(${Number(u.port || 5432)},'${u.hostname}');socks.add(c);socks.add(s);c.pipe(s);s.pipe(c);
const end=()=>{c.destroy();s.destroy();socks.delete(c);socks.delete(s)};c.on('error',end);s.on('error',end);c.on('close',end);s.on('close',end)});
srv.listen(0,'127.0.0.1',()=>console.log('port '+srv.address().port));
process.stdin.on('data',d=>{const ms=Number(String(d).trim());down=true;for(const x of socks)x.destroy();setTimeout(()=>{down=false;console.log('up')},ms)});`;
  const child = spawn(process.execPath, ['-e', script], { stdio: ['pipe', 'pipe', 'inherit'] });
  const lines: string[] = [];
  child.stdout.on('data', d => lines.push(...String(d).trim().split('\n')));
  while (!lines.some(l => l.startsWith('port '))) await new Promise(r => setTimeout(r, 50));
  const proxyPort = Number(lines.find(l => l.startsWith('port '))!.slice(5));
  cut = async ms => { const n = lines.length; child.stdin.write(`${ms}\n`); while (!lines.slice(n).includes('up')) await new Promise(r => setTimeout(r, 50)); };
  stopProxy = () => child.kill();
  const e = new URL(ADMIN); e.hostname = '127.0.0.1'; e.port = String(proxyPort); e.pathname = `/${dbName}`;
  process.env.SUTRA_DB = e.toString();
}
const skip = ADMIN ? false : 'SUTRA_TEST_PG_URL is not set';

let srv: any, engine: any, q: any, flows: any;
before(async () => {
  if (!ADMIN) return;
  ({ engine } = await import('../server/src/engine/engine.js'));
  ({ q } = await import('../server/src/db.js'));
  flows = await import('../server/src/flows.js');
  const { boot } = await import('../server/src/index.js');
  srv = await boot({ listenAdmin: false, gateway: false });
});
after(async () => {
  if (!ADMIN) return;
  await srv?.stop();
  stopProxy();
  await adminClient.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
  await adminClient.end();
});

test('after PostgreSQL was cut for a few seconds, the engine reads, writes and finishes runs again', { skip }, async () => {
  const s = node('start', 'Start', { payload: '{"n":1}' }), m = node('jsonata', 'Double', { source: '{{input}}', expression: '{ "n": n * 2 }' });
  const run = async () => { const id = await engine.startRun({ doc: { name: 'Outage', nodes: [s, m], edges: [edge(s, m)] } }); return [id, await engine.waitFor(id, 30000)]; };
  assert.equal((await run())[1], 'done');
  await cut(3000);
  // The first statements after the cut may fail (their connection is gone); then the engine is back.
  let ok = false;
  for (let i = 0; i < 60 && !ok; i++) { try { q.get('select 1 as x'); ok = true; } catch { await new Promise(r => setTimeout(r, 500)); } }
  assert.ok(ok, 'the synchronous connection is open again');
  const t0 = Date.now();
  assert.equal(q.get('select 2 as x').x, 2);
  assert.ok(Date.now() - t0 < 2000, 'and answers at once, not after a long wait');
  let done = '';
  for (let i = 0; i < 10 && done !== 'done'; i++) { try { done = (await run())[1]; } catch { await new Promise(r => setTimeout(r, 500)); } }
  assert.equal(done, 'done', 'runs finish again');
  flows.listFlows?.();
});
