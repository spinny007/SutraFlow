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
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { testEnv, captureServer, node, edge } from './helpers.js';

testEnv(18610);
const require = createRequire(import.meta.url);
const { boot } = await import('../server/src/index.js');
const { engine, runState } = await import('../server/src/engine/engine.js');
const { q } = await import('../server/src/db.js');
const flows = await import('../server/src/flows.js');
const { setSecret } = await import('../server/src/secrets.js');
const { saveResource } = await import('../server/src/resources.js');
const { bindFor, namedParams, closeDbPools, inlineRunData } = await import('../server/src/connectors/db.js');
const { priorDelivery, busTiming, messageKey, stopHolds, handle: handleDelivery } = await import('../server/src/connectors/bus.js');
const { rebuildListeners, listenerStatus } = await import('../server/src/listeners.js');
const oauth = await import('../server/src/connectors/oauth.js');

let srv: Awaited<ReturnType<typeof boot>>;
before(async () => { srv = await boot({ listenAdmin: false }); });
after(async () => { await closeDbPools(); await srv.stop(); });

async function run(nodes: any[], edges: any[], input?: any) {
  const id = await engine.startRun({ doc: { name: 'C', nodes, edges }, input });
  await engine.waitFor(id, 20000, true);
  const r: any = q.get('select * from runs where id = ?', id);
  return { status: r.status, error: r.error, state: runState(r.id)! };
}
const until = async (fn: () => boolean, ms = 8000) => {
  const t = Date.now();
  while (!fn()) { if (Date.now() - t > ms) throw new Error('timed out'); await new Promise(r => setTimeout(r, 50)); }
};

test('DB Ops placeholders per database, ignoring quotes, comments and ::casts', () => {
  const sql = "SELECT ':no', x::text FROM t -- :nope\nWHERE a = :a AND b IN (:b, :a)";
  assert.deepEqual(namedParams(sql).map(p => p.name), ['a', 'b', 'a']);
  assert.deepEqual(bindFor('postgres', sql, { a: 1, b: 2 }), { sql: "SELECT ':no', x::text FROM t -- :nope\nWHERE a = $1 AND b IN ($2, $3)", values: [1, 2, 1] });
  assert.equal(bindFor('mysql', 'x = :a', { a: 1 }).sql, 'x = ?');
  assert.equal(bindFor('mssql', 'x = :a', { a: 1 }).sql, 'x = @a');
  assert.deepEqual(bindFor('oracle', 'x = :a', { a: 1 }).values, { a: 1 });
  assert.throws(() => bindFor('postgres', 'x = :missing', {}), /:missing has no value/);
});

test('SQL text: properties are written in, run data written in the SQL is bound', () => {
  const scope = { gv: { SCHEMA: 'sales' }, ev: { REGION: 'eu' }, input: { id: "x' OR '1'='1", n: 7, q: 'ab' }, vars: { status: 'NEW' } };
  const r = inlineRunData("SELECT * FROM {{gv.SCHEMA}}.orders WHERE id = '{{input.id}}' AND n = {{input.n}} AND name LIKE '%{{input.q}}%' AND region = '{{ev.REGION}}' AND s = {{vars.status | lower}}", scope);
  assert.equal(r.sql, "SELECT * FROM sales.orders WHERE id = :sutra_v1 AND n = :sutra_v2 AND name LIKE :sutra_v3 AND region = 'eu' AND s = :sutra_v4");
  assert.deepEqual(r.params, { sutra_v1: "x' OR '1'='1", sutra_v2: 7, sutra_v3: '%ab%', sutra_v4: 'new' });
  assert.equal(inlineRunData("SELECT 'it''s {{input.q}}' AS t", scope).params.sutra_v1, "it's ab", 'doubled quotes stay one quote');
  assert.equal(inlineRunData('x = {{input.n}}', scope, { sutra_v1: 'mine' }).sql, 'x = :sutra_v2', 'names in Parameters are not reused');
  assert.equal(inlineRunData("x = '{{gv.SCHEMA}}' -- {{gv.SCHEMA}}", scope).sql, "x = 'sales' -- sales", 'properties may go anywhere');
  for (const [sql, where] of [['x = "{{input.id}}"', 'quoted identifier'], ['x = 1 -- {{input.id}}', 'comment'], ['x = 1 /* {{input.id}} */', 'comment'], ['DO $$ BEGIN PERFORM {{input.id}}; END $$', '\\$\\$ body']]) {
    assert.throws(() => inlineRunData(sql, scope), new RegExp(`cannot be bound inside a ${where}`), sql);
  }
  assert.throws(() => inlineRunData("=concat('x = ', {input.id})", scope), /only Project and Engine properties/, 'formulas build text, so they stay property-only');
  assert.deepEqual(inlineRunData('SELECT 1', scope), { sql: 'SELECT 1', params: {} });
});

test('DB Ops on SQLite: update, query with bound parameters, transaction rollback', async () => {
  const db = saveResource({ kind: 'database', name: 'Local', config: { driver: 'sqlite', file: 'test-orders.sqlite' } });
  const s = node('start', 'Start', { payload: '{"id":"A-1; DROP TABLE orders; --","amount":120.5}' });
  const create = node('dbUpdate', 'Create', { connection: db.id, sql: 'CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, amount REAL, status TEXT)', params: [] });
  const ins = node('dbUpdate', 'Insert', { connection: db.id, sql: "INSERT INTO orders(id, amount, status) VALUES (:id, :amount, 'open')", params: [{ k: 'id', v: '{{trigger.id}}' }, { k: 'amount', v: '{{trigger.amount}}' }] });
  const sel = node('dbQuery', 'Find', { connection: db.id, sql: 'SELECT * FROM orders WHERE id = :id', params: [{ k: 'id', v: '{{trigger.id}}' }], maxRows: 10 });
  const none = node('log', 'Nothing', { message: 'none' });
  const r = await run([s, create, ins, sel, none], [edge(s, create), edge(create, ins), edge(ins, sel), edge(sel, none, 'empty')]);
  assert.equal(r.status, 'done', r.error);
  assert.equal(r.state.outputs.Insert.rowCount, 1);
  assert.deepEqual(r.state.outputs.Find.first, { id: 'A-1; DROP TABLE orders; --', amount: 120.5, status: 'open' }, 'injection text stored as data');

  const tx = node('dbTransaction', 'Tx', { connection: db.id, params: [{ k: 'id', v: 'B-2' }], sql: "INSERT INTO orders(id, amount, status) VALUES (:id, 1, 'x')\n;\nINSERT INTO orders(id, amount, status) VALUES (:id, 2, 'duplicate key')" });
  const r2 = await run([s, tx], [edge(s, tx)]);
  assert.equal(r2.status, 'failed');
  const chk = node('dbQuery', 'Check', { connection: db.id, sql: "SELECT count(*) AS n FROM orders WHERE id = 'B-2'", params: [] });
  const r3 = await run([s, chk], [edge(s, chk)]);
  assert.equal(r3.state.outputs.Check.first.n, 0, 'the first insert was rolled back');
});

test('Kafka: a copy delivered while its run waits pauses the partition instead of starting a second run', async () => {
  const start = node('start', 'Start'), approval = node('approval', 'Approve', { message: 'Wait here' });
  const flowId = crypto.randomUUID();
  const runId = await engine.startRun({ doc: { name: 'Waiting delivery', nodes: [start, approval], edges: [edge(start, approval)] }, flowId });
  await until(() => q.get<any>('select status from runs where id = ?', runId)?.status === 'waiting');
  q.run('insert into bus_messages(flow_id, node_id, message_key, run_id, status, updated_at) values(?, ?, ?, ?, ?, ?)', flowId, 'trigger', 'message-1', runId, 'running', Date.now());
  let acked = 0, requeued = 0;
  const began = Date.now();
  let why = '';
  assert.equal(await priorDelivery({ flowId, node: { id: 'trigger' } } as any, 'message-1', { ack: () => { acked++; }, requeue: (w?: string) => { requeued++; why = w || ''; } }), true);
  assert.equal(why, 'duplicate', 'Kafka says why it pauses');
  assert.deepEqual([acked, requeued], [0, 1]);
  assert.ok(Date.now() - began < 200, 'the consumer slot is not held while the approval is waiting');
  assert.equal(Number(q.get<any>('select count(*) n from runs where id = ?', runId).n), 1, 'the existing run remains authoritative');
  await engine.cancel(runId);
});

test('RabbitMQ and ActiveMQ: a copy delivered while its run waits is held, then settled by how that run ends', async () => {
  busTiming.holdPollMs = 50;
  const start = node('start', 'Start'), approval = node('approval', 'Approve', { message: 'Wait here' });
  const waitingRun = async (name: string) => {
    const flowId = crypto.randomUUID();
    const runId = await engine.startRun({ doc: { name, nodes: [start, approval], edges: [edge(start, approval)] }, flowId });
    await until(() => q.get<any>('select status from runs where id = ?', runId)?.status === 'waiting');
    q.run('insert into bus_messages(flow_id, node_id, message_key, run_id, status, updated_at) values(?, ?, ?, ?, ?, ?)', flowId, 'trigger', 'm-1', runId, 'running', Date.now());
    const statuses: string[] = [];
    const c = { flowId, node: { id: 'trigger' }, status: (_s: string, m: string) => statuses.push(m) } as any;
    const seen = { acked: 0, requeued: 0, grown: 0, shrunk: 0 };
    const settle = { ack: () => { seen.acked++; }, requeue: () => { seen.requeued++; }, hold: { grow: () => { seen.grown++; }, shrink: () => { seen.shrunk++; } } };
    return { flowId, runId, c, seen, settle, statuses };
  };

  // The first run finishes: the held copy is acknowledged, never run twice, never redelivered meanwhile.
  const a = await waitingRun('Held then done');
  assert.equal(await priorDelivery(a.c, 'm-1', a.settle), true, 'no second run');
  await new Promise(r => setTimeout(r, 300));
  assert.deepEqual(a.seen, { acked: 0, requeued: 0, grown: 1, shrunk: 0 }, 'held unacknowledged while the approval waits, with one more slot');
  assert.match(a.statuses.join(' '), /held while run/);
  const task = q.get<any>(`select id from tasks where run_id = ? and status = 'waiting'`, a.runId);
  await engine.decide(Number(task.id), true, 'tester');
  await until(() => a.seen.acked === 1);
  assert.deepEqual(a.seen, { acked: 1, requeued: 0, grown: 1, shrunk: 1 });
  assert.equal(q.get<any>('select status from bus_messages where flow_id = ?', a.flowId).status, 'done', 'later copies are acknowledged at once');

  // The first run is cancelled: the copy goes back to the broker to start a new run.
  const b = await waitingRun('Held then cancelled');
  await priorDelivery(b.c, 'm-1', b.settle);
  await engine.cancel(b.runId);
  await until(() => b.seen.requeued === 1);
  assert.deepEqual(b.seen, { acked: 0, requeued: 1, grown: 1, shrunk: 1 });
  assert.equal(q.get<any>('select 1 as x from bus_messages where flow_id = ?', b.flowId), undefined, 'the delivery guard is released for the new run');

  // A listener that stops leaves held copies to the broker (they come back unacknowledged).
  const d = await waitingRun('Held then stopped');
  await priorDelivery(d.c, 'm-1', d.settle);
  stopHolds(d.c);
  await engine.cancel(d.runId);
  await new Promise(r => setTimeout(r, 300));
  assert.deepEqual([d.seen.acked, d.seen.requeued], [0, 0]);
  busTiming.holdPollMs = 2000;
});

test('Duplicate key: messages without a broker message id are recognised by a chosen field', () => {
  const input = { body: { orderId: 'A-7' }, headers: { correlationId: 'c-9' } };
  assert.equal(messageKey({}, input, 'rabbitmq:orders:m-1'), 'rabbitmq:orders:m-1', 'the broker id comes first');
  assert.equal(messageKey({}, input, ''), '', 'no id and no key: not deduplicated');
  assert.equal(messageKey({ duplicateKey: '{{body.orderId}}' }, input, ''), 'key:A-7');
  assert.equal(messageKey({ duplicateKey: '{{headers.correlationId}}' }, input, ''), 'key:c-9');
  assert.equal(messageKey({ duplicateKey: '{{body.missing}}' }, input, ''), '', 'an empty value is not a key');
  assert.equal(messageKey({ deduplicate: 'off', duplicateKey: '{{body.orderId}}' }, input, 'x'), '');
});

test('Messages without an id: processed by default, or rejected to the dead-letter queue when chosen', async () => {
  const input = { body: { orderId: 'A-8' }, headers: {} };
  const make = () => {
    const seen = { fired: 0, rejected: 0, statuses: [] as string[] };
    const c = { flowId: crypto.randomUUID(), node: { id: 'trigger' }, status: (_s: string, m: string) => seen.statuses.push(m), fire: async (_i: unknown, done?: (s: string, id: string) => void) => { seen.fired++; setTimeout(() => done?.('done', 'r1'), 5); return 'r1'; } } as any;
    const settle = { ack: () => {}, requeue: () => {}, reject: () => { seen.rejected++; } };
    return { c, seen, settle };
  };
  const a = make();
  await handleDelivery(a.c, { ackMode: 'client', withoutId: 'reject (dead-letter)' }, input, a.settle, 1, '');
  assert.deepEqual([a.seen.fired, a.seen.rejected], [0, 1]);
  assert.match(a.seen.statuses.join(' '), /without a message id/);
  const b = make();
  await handleDelivery(b.c, { ackMode: 'client' }, input, b.settle, 1, '');
  assert.deepEqual([b.seen.fired, b.seen.rejected], [1, 0], 'process is the default');
  const k = make();
  await handleDelivery(k.c, { ackMode: 'client', withoutId: 'reject (dead-letter)', duplicateKey: '{{body.orderId}}' }, input, k.settle, 1, '');
  assert.deepEqual([k.seen.fired, k.seen.rejected], [1, 0], 'a Duplicate key counts as an id');
});

test('Send email over SMTP', async () => {
  const { SMTPServer } = require('smtp-server');
  const got: string[] = [];
  const smtp = new SMTPServer({ authOptional: true, disabledCommands: ['STARTTLS'], onData(stream: any, _s: any, cb: any) { let d = ''; stream.on('data', (c: Buffer) => (d += c)); stream.on('end', () => { got.push(d); cb(); }); } });
  await new Promise<void>(r => smtp.listen(0, '127.0.0.1', r));
  const port = smtp.server.address().port;
  try {
    const conn = saveResource({ kind: 'smtp', name: 'Local SMTP', config: { host: '127.0.0.1', port, security: 'none', from: 'Sutra <noreply@sutra.test>', verifyTls: false } });
    const s = node('start', 'Start', { payload: '{"email":"asha@example.com","orderId":"A-9","name":"Asha"}' });
    const h = node('htmlTemplate', 'Body', { html: '<p>Hi {{input.name}}, order <b>{{input.orderId}}</b> shipped.</p>' });
    const m = node('emailSend', 'Mail', { connection: conn.id, to: '{{trigger.email}}', subject: "=concat('Order ', {trigger.orderId}, ' shipped')", text: 'Order {{trigger.orderId}} shipped', html: '{{nodes.Body.html}}' });
    const r = await run([s, h, m], [edge(s, h), edge(h, m)]);
    assert.equal(r.status, 'done', r.error);
    assert.deepEqual(r.state.outputs.Mail.accepted, ['asha@example.com']);
    assert.match(got[0], /Subject: Order A-9 shipped/);
    assert.match(got[0], /order <b>A-9<\/b> shipped/);
  } finally { await new Promise(r => smtp.close(r)); }
});

test('ActiveMQ / AMQP 1.0: publish with broker confirmation; subscriber accepts after success and releases on failure', async () => {
  const rhea = require('rhea');
  const broker = rhea.create_container({ id: 'fake-broker' });
  const received: any[] = [];
  const outcomes: string[] = [];
  let toSubscriber: any = null;
  broker.on('message', (ctx: any) => received.push(ctx.message));
  broker.on('sender_open', (ctx: any) => { toSubscriber = ctx.sender; });
  broker.on('accepted', () => outcomes.push('accepted'));
  broker.on('released', () => outcomes.push('released'));
  broker.on('rejected', () => outcomes.push('rejected'));
  const listener = broker.listen({ port: 0, host: '127.0.0.1' });
  await new Promise(r => listener.on('listening', r));
  const port = listener.address().port;
  try {
    setSecret('AMQP_PW', 'pw');
    const conn = saveResource({ kind: 'amqp1', name: 'ActiveMQ', config: { host: '127.0.0.1', port, user: '', passwordSecret: '' } });
    const s = node('start', 'Start', { payload: '{"orderId":"A-5"}' });
    const p = node('busPublish', 'Publish', { broker: 'amqp1', amqpConn: conn.id, address: 'orders', format: 'json', body: '{{input}}', headers: [{ k: 'source', v: 'sutra' }], persistent: true });
    const r = await run([s, p], [edge(s, p)]);
    assert.equal(r.status, 'done', r.error);
    assert.deepEqual(JSON.parse(received[0].body), { orderId: 'A-5' });
    assert.equal(received[0].application_properties.source, 'sutra');

    const t = node('busSubscribe', 'Orders in', { broker: 'amqp1', amqpConn: conn.id, address: 'orders-in', ackMode: 'after success', onFailure: 'requeue', concurrency: 1, format: 'json' });
    const chk = node('if', 'Good?', { left: '{{input.body.ok}}', op: 'equals', right: 'true' });
    const boom = node('throw', 'Bad', { message: 'bad message' });
    const ok = node('log', 'Fine', { message: 'ok' });
    const f = flows.saveFlow(undefined, { name: 'Sub', nodes: [t, chk, boom, ok], edges: [edge(t, chk), edge(chk, ok, 'true'), edge(chk, boom, 'false')] });
    flows.deploy(f.id);
    await rebuildListeners();
    await until(() => !!toSubscriber && toSubscriber.sendable());
    toSubscriber.send({ body: JSON.stringify({ ok: true }) });
    await until(() => outcomes.includes('accepted'));
    toSubscriber.send({ body: JSON.stringify({ ok: false }) });
    await until(() => outcomes.includes('released'));
    assert.equal([...listenerStatus.values()].find(x => x.type === 'busSubscribe')?.state, 'ok');
    flows.undeploy(f.id);
    await rebuildListeners();
  } finally { listener.close(); }
});

test('Firebase: service-account token, Firestore set/get with value conversion, push notification', async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const docs: Record<string, any> = {};
  const fcm: any[] = [];
  const cap = await captureServer((req, body) => {
    if (req.url === '/token') return { body: JSON.stringify({ access_token: 'ya29.test', expires_in: 3600 }) };
    if (req.headers.authorization !== 'Bearer ya29.test') return { status: 401, body: '{"error":{"message":"no auth"}}' };
    const m = /\/documents\/(orders)\/([^?]+)/.exec(req.url!);
    if (m && req.method === 'PATCH') { docs[m[2]] = { name: `projects/p1/databases/(default)/documents/orders/${m[2]}`, fields: JSON.parse(body).fields }; return { body: JSON.stringify(docs[m[2]]) }; }
    if (m && req.method === 'GET') return docs[m[2]] ? { body: JSON.stringify(docs[m[2]]) } : { status: 404, body: '{}' };
    if (req.url!.includes('messages:send')) { fcm.push(JSON.parse(body)); return { body: '{"name":"projects/p1/messages/1"}' }; }
    return { status: 404, body: '{}' };
  });
  try {
    setSecret('FIREBASE_SA', JSON.stringify({ project_id: 'p1', client_email: 'svc@p1.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: cap.url + '/token' }));
    const fb = saveResource({ kind: 'firebase', name: 'FB', config: { serviceAccountSecret: 'FIREBASE_SA', apiBase: cap.url, databaseUrl: cap.url } });
    const s = node('start', 'Start', { payload: '{"orderId":"A-7","total":99.5,"qty":3,"paid":true,"tags":["x"],"customer":{"name":"Ravi"},"deviceToken":"tok-1"}' });
    const set = node('firestore', 'Save', { connection: fb.id, op: 'set', collection: 'orders', docId: '{{input.orderId}}', data: '{{input}}', merge: true });
    const get = node('firestore', 'Load', { connection: fb.id, op: 'get', collection: 'orders', docId: '{{trigger.orderId}}' });
    const push = node('firebaseNotify', 'Notify', { connection: fb.id, target: 'token', to: '{{trigger.deviceToken}}', title: "=concat('Order ', {trigger.orderId})", body: 'Shipped', data: [{ k: 'orderId', v: '{{trigger.orderId}}' }] });
    const r = await run([s, set, get, push], [edge(s, set), edge(set, get), edge(get, push)]);
    assert.equal(r.status, 'done', r.error);
    assert.equal(docs['A-7'].fields.qty.integerValue, '3');
    assert.equal(docs['A-7'].fields.customer.mapValue.fields.name.stringValue, 'Ravi');
    const loaded = r.state.outputs.Load;
    assert.deepEqual({ total: loaded.total, qty: loaded.qty, paid: loaded.paid, tags: loaded.tags, customer: loaded.customer }, { total: 99.5, qty: 3, paid: true, tags: ['x'], customer: { name: 'Ravi' } });
    assert.deepEqual(fcm[0].message, { token: 'tok-1', notification: { title: 'Order A-7', body: 'Shipped' }, data: { orderId: 'A-7' } });
    const tokenReq = cap.seen.find(x => x.url === '/token')!;
    assert.match(tokenReq.body, /grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer/);
  } finally { await cap.close(); }
});

test('OAuth connection: sign-in, Google Sheets append, automatic token refresh', async () => {
  let issued = 0;
  const appended: any[] = [];
  const cap = await captureServer((req, body) => {
    if (req.url === '/token') {
      const f = new URLSearchParams(body);
      issued++;
      if (f.get('grant_type') === 'authorization_code') return { body: JSON.stringify({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 1 }) };
      if (f.get('grant_type') === 'refresh_token' && f.get('refresh_token') === 'rt-1') return { body: JSON.stringify({ access_token: 'at-2', expires_in: 3600 }) };
      return { status: 400, body: '{"error":"invalid_grant"}' };
    }
    if (req.url!.includes('/values/Sheet1!1%3A1') || req.url!.includes('/values/Sheet1!1:1')) return { body: JSON.stringify({ values: [['sku', 'qty']] }) };
    if (req.url!.includes(':append')) {
      if (req.headers.authorization !== 'Bearer at-2') return { status: 401, body: '{"error":{"message":"expired"}}' };
      appended.push(JSON.parse(body));
      return { body: JSON.stringify({ updates: { updatedRange: 'Sheet1!A2:B3', updatedRows: 2 } }) };
    }
    return { status: 404, body: '{}' };
  });
  try {
    setSecret('OAUTH_CS', 'client-secret');
    const app = saveResource({ kind: 'oauthApp', name: 'Google (test)', config: { provider: 'custom', clientId: 'cid', clientSecretSecret: 'OAUTH_CS', scopes: 'sheets', authUrl: cap.url + '/auth', tokenUrl: cap.url + '/token', apiBase: cap.url } });
    const url = new URL(oauth.startUrl(app.id, 'http://127.0.0.1:4800/api/oauth/callback'));
    assert.equal(url.searchParams.get('client_id'), 'cid');
    await assert.rejects(oauth.finish('code', url.searchParams.get('state')! + 'x'), /Invalid sign-in state/);
    await oauth.finish('the-code', url.searchParams.get('state')!);
    assert.equal(oauth.connectionStatus(app.id).connected, true);
    await new Promise(r => setTimeout(r, 1100)); // let the 1-second token expire

    const s = node('start', 'Start', { payload: '{"items":[{"sku":"X","qty":2},{"qty":5,"sku":"Y"}]}' });
    const g = node('googleSheets', 'Append', { connection: app.id, op: 'append', spreadsheetId: 'sheet1', range: 'Sheet1!A1:B', header: true, rows: '{{input.items}}', valueInput: 'RAW' });
    const r = await run([s, g], [edge(s, g)]);
    assert.equal(r.status, 'done', r.error);
    assert.deepEqual(appended[0].values, [['X', 2], ['Y', 5]], 'objects become rows in header order');
    assert.equal(issued, 2, 'code exchange, then one refresh');
    const stored = JSON.stringify(q.get(`select value from settings where key = ?`, `oauth:${app.id}`));
    assert.ok(!stored.includes('at-2') && !stored.includes('rt-1'), 'tokens are stored encrypted');
  } finally { await cap.close(); }
});
