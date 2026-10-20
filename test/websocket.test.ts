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
import WebSocket, { WebSocketServer } from 'ws';
import { testEnv, node, edge, port } from './helpers.js';

/**
 * WebSocket services on the gateway (trigger, send step, security, order, broadcast, the outbox for
 * connections on other engines) and the WebSocket client trigger and send step.
 */
const env = testEnv(20850);
const { boot } = await import('../server/src/index.js');
const { setSecret } = await import('../server/src/secrets.js');
const { saveResource } = await import('../server/src/resources.js');
const flows = await import('../server/src/flows.js');
const { engine, runState } = await import('../server/src/engine/engine.js');
const { q } = await import('../server/src/db.js');
const { config } = await import('../server/src/config.js');
const { rebuildListeners, listenerStatus } = await import('../server/src/listeners.js');

let srv: Awaited<ReturnType<typeof boot>>;
before(async () => { srv = await boot({ listenAdmin: false }); });
after(async () => { await srv.stop(); });

const wsUrl = (p: string) => `${env.http.replace('http', 'ws')}${p}`;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
function deploy(name: string, nodes: any[], edges: any[]) { const f = flows.saveFlow(undefined, { name, nodes, edges }); flows.deploy(f.id); return f; }

/** A client that collects what it receives. */
async function connect(url: string, o: WebSocket.ClientOptions = {}) {
  const ws = new WebSocket(url, o);
  const got: any[] = [];
  ws.on('message', d => { const t = d.toString(); try { got.push(JSON.parse(t)); } catch { got.push(t); } });
  await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); ws.once('unexpected-response', (_q, r) => rej(new Error(`HTTP ${r.statusCode}`))); });
  const until = async (n: number, ms = 8000) => { const t0 = Date.now(); while (got.length < n && Date.now() - t0 < ms) await sleep(20); return got; };
  return { ws, got, until };
}

test('a WebSocket service answers each message on its connection, in order, and runs on open and close', async () => {
  const t = node('wsService', 'Echo', { path: '/ws/echo', format: 'json' });
  const w = node('wait', 'Think', { ms: '{{input.message.delay}}' });
  const s = node('wsSend', 'Answer', { to: 'this connection', message: '{"n": {{trigger.message.n}}, "who": "{{trigger.auth.subject}}"}' });
  const hello = node('wsSend', 'Welcome', { to: 'this connection', message: '{"welcome": "{{input.connectionId}}"}' });
  const bye = node('log', 'Bye', { message: 'closed {{input.code}}' });
  deploy('WS echo', [t, w, s, hello, bye], [{ ...edge(t, w), port: 'message' }, edge(w, s), { ...edge(t, hello), port: 'open' }, { ...edge(t, bye), port: 'close' }]);

  const c = await connect(wsUrl('/ws/echo'));
  await c.until(1);
  assert.ok(c.got[0].welcome, 'open ran');
  // The first takes longest: with one message at a time, answers still come in order.
  for (const [n, delay] of [[1, 300], [2, 10], [3, 100], [4, 0]]) c.ws.send(JSON.stringify({ n, delay }));
  const got = await c.until(5);
  assert.deepEqual(got.slice(1).map(x => x.n), [1, 2, 3, 4]);
  assert.equal(got[1].who, 'anonymous');
  c.ws.send('not json');
  assert.equal((await c.until(6))[5].error, 'The message is not valid JSON');
  assert.equal(Number(q.get<any>("select count(*) n from ws_connections where path = '/ws/echo'").n), 1);
  c.ws.close(4000, 'done');
  for (let i = 0; i < 100 && !q.get<any>("select 1 from runs where source = 'websocket' and flow_name = 'WS echo' and status = 'done' and input like '%\"close\"%'"); i++) await sleep(50);
  assert.ok(q.get<any>("select 1 from runs where source = 'websocket' and input like '%\"close\"%'"), 'close ran');
  assert.equal(Number(q.get<any>("select count(*) n from ws_connections where path = '/ws/echo'").n), 0);
  // A plain HTTP call on the path is told to use WebSocket.
  const plain = await fetch(`${env.http}/ws/echo`);
  assert.equal(plain.status, 426);
});

test('WebSocket security: the policy at connect (key in a header or the query), origins, scopes and message checks', async () => {
  setSecret('WS_KEY', 'ws-key-123456');
  const pol = saveResource({ kind: 'inboundPolicy', name: 'WS keys', config: { auth: 'apiKey', apiKeyHeader: 'X-API-Key', apiKeySecrets: ['WS_KEY'], requireHttps: false, rateLimitPerMinute: 0, corsOrigins: ['https://app.example'], maxDepth: 4 } });
  const schema = (await import('../server/src/schemas.js')).saveSchema({ project_id: 'p-ws', name: 'Sub', kind: 'json', text: JSON.stringify({ type: 'object', required: ['op'], properties: { op: { enum: ['subscribe', 'ping'] } } }) });
  const t = node('wsService', 'Secured', { path: '/ws/secure', policy: pol.id, bodySchema: schema.id, validateBody: 'reject invalid' });
  const s = node('wsSend', 'Ok', { message: '{"ok": "{{input.message.op}}", "caller": "{{input.auth.subject}}"}' });
  deploy('WS secure', [t, s], [{ ...edge(t, s), port: 'message' }]);
  await assert.rejects(connect(wsUrl('/ws/secure')), /HTTP 401/);
  await assert.rejects(connect(wsUrl('/ws/secure?X-API-Key=wrong')), /HTTP 401/);
  await assert.rejects(connect(wsUrl('/ws/secure?X-API-Key=ws-key-123456'), { origin: 'https://evil.example' }), /HTTP 403/);
  const viaQuery = await connect(wsUrl('/ws/secure?X-API-Key=ws-key-123456'), { origin: 'https://app.example' });
  const viaHeader = await connect(wsUrl('/ws/secure'), { headers: { 'x-api-key': 'ws-key-123456' } });
  viaHeader.ws.send('{"op":"subscribe"}');
  assert.deepEqual((await viaHeader.until(1))[0], { ok: 'subscribe', caller: 'WS_KEY' });
  viaQuery.ws.send('{"op":"dance"}');
  const bad = (await viaQuery.until(1))[0];
  assert.equal(bad.error, 'The message does not match the schema');
  assert.match(bad.errors[0], /allowed values/);
  viaQuery.ws.send('{"op":{"a":{"b":{"c":{"d":1}}}}}');
  assert.equal((await viaQuery.until(2))[1].error, 'The message is nested deeper than 4 levels');
  viaQuery.ws.close(); viaHeader.ws.close();
});

test('broadcast to every connection of a service, and messages for connections held by other engines', async () => {
  const t = node('wsService', 'Room', { path: '/ws/room' });
  const s = node('wsSend', 'Tell all', { to: 'every connection of a service', path: '/ws/room', message: '{"said": "{{input.message.text}}"}' });
  deploy('WS room', [t, s], [{ ...edge(t, s), port: 'message' }]);
  const a = await connect(wsUrl('/ws/room')), b = await connect(wsUrl('/ws/room'));
  a.ws.send('{"text":"hello all"}');
  assert.deepEqual((await a.until(1))[0], { said: 'hello all' });
  assert.deepEqual((await b.until(1))[0], { said: 'hello all' });
  // Another engine holds a connection of this service: the broadcast leaves it a message in the outbox.
  q.run('insert into ws_connections(id, engine_id, path, flow_id, subject, opened_at) values(?, ?, ?, ?, ?, ?)', 'far-1', 'other-engine', '/ws/room', null, 'x', Date.now());
  b.ws.send('{"text":"again"}');
  await a.until(2);
  for (let i = 0; i < 50 && !q.get("select 1 from ws_outbox where engine_id = 'other-engine'"); i++) await sleep(20);
  assert.ok(q.get("select 1 from ws_outbox where engine_id = 'other-engine' and path = '/ws/room'"), 'left for the other engine');
  // And what another engine left for a connection here is delivered by this one.
  const id = q.get<any>("select id from ws_connections where engine_id = ? and path = '/ws/room' order by opened_at limit 1", config.engineId).id;
  q.run('insert into ws_outbox(engine_id, connection_id, path, item, created_at) values(?, ?, ?, ?, ?)', config.engineId, id, '', JSON.stringify({ data: '{"from":"another engine"}' }), Date.now());
  const all = [...(await a.until(3, 3000)), ...(await b.until(3, 3000))];
  assert.ok(all.some(x => x.from === 'another engine'), JSON.stringify(all));
  for (let i = 0; i < 50 && q.get('select 1 from ws_outbox where engine_id = ?', config.engineId); i++) await sleep(20);
  assert.equal(q.get('select 1 from ws_outbox where engine_id = ?', config.engineId), undefined, 'delivered rows are removed');
  q.run("delete from ws_connections where engine_id = 'other-engine'");
  a.ws.close(); b.ws.close();
});

test('WebSocket client: the send step waits for its answer, and the trigger reconnects and subscribes again', async () => {
  // A WebSocket server elsewhere: it answers {id} messages and pushes to subscribers.
  const wsPort = port(20860);
  const remote = new WebSocketServer({ port: wsPort, host: '127.0.0.1' });
  let connects = 0;
  const auths: string[] = [];
  remote.on('connection', (sock, req) => {
    connects++;
    auths.push(String(req.headers.authorization || ''));
    sock.on('message', d => {
      const m = JSON.parse(d.toString());
      if (m.op === 'subscribe') { sock.send(JSON.stringify({ hint: 'noise' })); sock.send(JSON.stringify({ channel: m.channel, data: { tick: connects } })); }
      if (m.op === 'status') { sock.send(JSON.stringify({ id: 'other', status: 'ignored' })); sock.send(JSON.stringify({ id: m.id, status: 'shipped' })); }
    });
  });
  setSecret('STREAM_TOKEN', 'stream-token-1');
  const conn = saveResource({ kind: 'websocket', name: 'Stream', config: { url: `ws://127.0.0.1:${wsPort}/feed`, headers: [{ k: 'Authorization', v: 'Bearer {{secret.STREAM_TOKEN}}' }], reconnectMinMs: 200, reconnectMaxMs: 400, pingSeconds: 0 } });

  const s = node('start', 'Start', { payload: '{"orderId":"A-9"}' });
  const call = node('wsClientSend', 'Ask', { connection: conn.id, message: '{"op":"status","id":"{{input.orderId}}"}', matchField: 'id', matchValue: '{{input.orderId}}', replyTimeoutMs: 5000 });
  const id = await engine.startRun({ doc: { name: 'Ask', nodes: [s, call], edges: [edge(s, call)] } });
  assert.equal(await engine.waitFor(id, 15000), 'done', JSON.stringify(runState(id)!.logs));
  assert.deepEqual(runState(id)!.outputs.Ask, { sent: true, reply: { id: 'A-9', status: 'shipped' } });
  assert.equal(auths[0], 'Bearer stream-token-1');

  const trig = node('wsClientTrigger', 'Feed', { connection: conn.id, subscribe: '{"op":"subscribe","channel":"orders"}' });
  const log = node('log', 'Got', { message: '{{input.message | json}}' });
  const f = deploy('Feed', [trig, log], [edge(trig, log)]);
  await rebuildListeners();
  const runsOf = () => q.all<any>('select id from runs where flow_id = ? order by started_at', f.id).map(r => runState(r.id)!.outputs.Feed?.message);
  for (let i = 0; i < 100 && runsOf().length < 2; i++) await sleep(50);
  assert.ok(runsOf().some(m => m?.channel === 'orders'), JSON.stringify(runsOf()));
  // The server drops every connection: the trigger reconnects and subscribes again.
  const before = connects;
  for (const c of remote.clients) c.terminate();
  for (let i = 0; i < 100 && connects === before; i++) await sleep(50);
  assert.ok(connects > before, 'reconnected');
  for (let i = 0; i < 100 && !runsOf().some(m => m?.data?.tick === connects); i++) await sleep(50);
  assert.ok(runsOf().some(m => m?.data?.tick === connects), 'subscribed again after reconnecting');
  assert.equal([...listenerStatus.values()].find(x => x.type === 'wsClientTrigger')?.state, 'ok');
  flows.undeploy(f.id);
  await new Promise<void>(r => remote.close(() => r()));
});
