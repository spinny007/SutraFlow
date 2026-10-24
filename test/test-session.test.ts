/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 2.0.9
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stopTestSession, testIsActive } from '../web/src/test-session.js';
import { testEnv, node, edge } from './helpers.js';
testEnv(22990);
process.env.SUTRA_ADMIN_TOKEN = 'stop-test-only';
test('stop requests cancellation before confirming terminal state and clearing previews', async () => {
  const calls: string[] = [];
  assert.equal(await stopTestSession('test-1', { post: async url => { calls.push('POST ' + url); }, get: async url => { calls.push('GET ' + url); return { status: 'cancelled' }; } }), 'cancelled');
  assert.deepEqual(calls, ['POST /api/runs/test-1/cancel', 'GET /api/runs/test-1']);
  for (const status of ['running', 'waiting', 'paused', 'queued']) {
    assert.ok(testIsActive(status));
    await assert.rejects(stopTestSession('x', { post: async () => ({}), get: async () => ({ status }) }), /controls have been retained/);
  }
});
test('failed cancellation preserves controls; a race with normal completion is safe', async () => {
  await assert.rejects(stopTestSession('x', { post: async () => { throw new Error('network'); }, get: async () => { throw new Error('must not fetch'); } }), /network/);
  assert.equal(await stopTestSession('x', { post: async () => ({ ok: false }), get: async () => ({ status: 'done' }) }), 'done');
});
test('real engine stop cancels waiting and paused tests without executing downstream steps', async () => {
  const { boot } = await import('../server/src/index.js');
  const { engine } = await import('../server/src/engine/engine.js');
  const { q } = await import('../server/src/db.js');
  const srv = await boot({ listenAdmin: false, gateway: false });
  const transport = {
    post: async (url: string) => { const r = await srv.admin.inject({ method: 'POST', url, headers: { authorization: 'Bearer stop-test-only', 'x-sutra': '1' } }); assert.equal(r.statusCode, 200); return r.json(); },
    get: async (url: string) => { const r = await srv.admin.inject({ method: 'GET', url, headers: { authorization: 'Bearer stop-test-only' } }); assert.equal(r.statusCode, 200); return r.json(); },
  };
  try {
    for (const debug of [false, true]) {
      const s = node('start', 'Start', { payload: '{"id":7}' });
      const w = node('wait', 'Wait', { ms: 60000 });
      const last = node('log', 'Must not run', { message: 'late' });
      const id = await engine.startRun({ doc: { name: 'Stop test', nodes: [s, w, last], edges: [edge(s, w), edge(w, last)] }, source: debug ? 'debug' : 'test', debug: debug ? { stepping: true, breakpoints: [] } : undefined });
      for (let i = 0; i < 200; i++) { if (debug ? q.get<any>('select status from runs where id = ?', id).status === 'paused' : q.get<any>('select phase from tasks where run_id = ? and node_id = ?', id, w.id)?.phase === 'resume') break; await new Promise(r => setTimeout(r, 10)); }
      assert.ok(testIsActive(q.get<any>('select status from runs where id = ?', id).status));
      if (debug) assert.equal(q.get<any>('select status from runs where id = ?', id).status, 'paused');
      else assert.equal(q.get<any>('select phase from tasks where run_id = ? and node_id = ?', id, w.id).phase, 'resume');
      assert.equal(await stopTestSession(id, transport), 'cancelled');
      assert.equal(await stopTestSession(id, transport), 'cancelled', 'stop is safe to repeat');
      assert.equal(q.get<any>('select count(*) n from tasks where run_id = ? and node_id = ? and status = ?', id, last.id, 'done').n, 0);
      assert.equal(q.get<any>("select count(*) n from tasks where run_id = ? and status in ('pending','running','waiting','paused')", id).n, 0);
    }
  } finally { await srv.stop(); }
});
