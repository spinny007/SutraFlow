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
import { testEnv } from './helpers.js';

testEnv(18310);
const { boot } = await import('../server/src/index.js');
let srv: Awaited<ReturnType<typeof boot>>;
let cookie = '';
before(async () => { srv = await boot({ listenAdmin: false }); });
after(async () => { await srv.stop(); });

const call = (method: string, url: string, payload?: any, extra: Record<string, string> = {}) =>
  srv.admin.inject({ method: method as any, url, payload, headers: { 'x-sutra': '1', cookie, ...extra } });

test('first run creates the admin; API needs a session and the X-Sutra header', async () => {
  assert.equal((await srv.admin.inject({ method: 'GET', url: '/api/flows' })).statusCode, 401);
  const st = await call('GET', '/api/auth/status');
  assert.equal(st.json().setup, true);
  assert.equal((await call('POST', '/api/auth/setup', { username: 'admin', password: 'short' })).statusCode, 400);
  const setup = await call('POST', '/api/auth/setup', { username: 'admin', password: 'a-good-long-password' });
  assert.equal(setup.statusCode, 200);
  cookie = String(setup.headers['set-cookie']).split(';')[0];
  assert.equal((await call('POST', '/api/auth/setup', { username: 'x', password: 'another-long-one' })).statusCode, 409);
  const noCsrf = await srv.admin.inject({ method: 'POST', url: '/api/flows', payload: { name: 'x', nodes: [], edges: [] }, headers: { cookie } });
  assert.equal(noCsrf.statusCode, 403);
  const bad = await srv.admin.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'wrong-password' }, headers: { 'x-sutra': '1' } });
  assert.equal(bad.statusCode, 401);
});

test('Sutras, test runs, secrets and meta through the API', async () => {
  const f = (await call('POST', '/api/flows', {
    name: 'API Sutra',
    nodes: [{ id: 's', type: 'start', name: 'Start', config: { payload: '{"a":2}' } }, { id: 'm', type: 'mapper', name: 'Map', config: { map: [{ k: 'b', v: '{{input.a | mul:5}}' }] } }],
    edges: [{ id: 'e', from: 's', port: 'out', to: 'm' }],
  })).json();
  const { runId } = (await call('POST', `/api/flows/${f.id}/test`, {})).json();
  let run;
  for (let i = 0; i < 40; i++) {
    run = (await call('GET', `/api/runs/${runId}`)).json();
    if (run.status === 'done') break;
    await new Promise(r => setTimeout(r, 50));
  }
  assert.equal(run.status, 'done');
  assert.deepEqual(run.outputs.Map, { b: 10 });
  const sample = (await call('GET', `/api/flows/${f.id}/sample`)).json();
  assert.deepEqual(sample.outputs.Map, { b: 10 });
  const { q } = await import('../server/src/db.js');
  q.run('update runs set source = ? where id = ?', 'api', runId);
  assert.deepEqual((await call('GET', `/api/flows/${f.id}/sample`)).json().outputs, {}, 'production outputs must not become designer sample data');
  q.run('update runs set source = ? where id = ?', 'debug', runId);
  assert.deepEqual((await call('GET', `/api/flows/${f.id}/sample`)).json().outputs.Map, { b: 10 });

  assert.equal((await call('PUT', '/api/secrets/API_TOKEN', { value: 'top-secret-value' })).statusCode, 200);
  const list = await call('GET', '/api/secrets');
  assert.ok(!list.body.includes('top-secret-value'), 'secret values are never returned');
  assert.equal(list.json()[0].name, 'API_TOKEN');

  const meta = (await call('GET', '/api/meta')).json();
  const sw = meta.activities.find((a: any) => a.type === 'switch');
  assert.deepEqual(sw.ports, { field: 'cases', extra: ['default'], fallback: ['default'] });
  assert.ok(meta.activities.some((a: any) => a.type === 'soapInvoke'));
  assert.ok(meta.resourceKinds.some((k: any) => k.kind === 'inboundPolicy'));

  const dep = await call('POST', `/api/flows/${f.id}/deploy`, {});
  assert.equal(dep.json().version, 1);
  const runApi = (await call('POST', `/api/flows/${f.id}/run?wait=5000`, { input: { a: 3 } })).json();
  assert.equal(runApi.status, 'done');
  assert.deepEqual(runApi.outputs.Map, { b: 15 });
});
