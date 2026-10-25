/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.8.0
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
/**
 * WebSocket: services on the gateway (a trigger per message, and the send step that answers, pushes
 * or broadcasts) and connections to other WebSocket servers (a trigger for what they send, with
 * reconnects, and a step that sends and can wait for the answer). The client trigger runs on the
 * leader engine, like other listeners, so a cluster holds one connection, not one per engine.
 */
import WebSocket from 'ws';
import type { Activity, ResourceKind } from '../engine/types.js';
import { requireResource, kvToObject, type Resource } from '../resources.js';
import { registerListener } from '../listeners.js';
import { getSecret } from '../secrets.js';
import { resolve as resolveTemplate } from '../template.js';
import { F, when } from '../palettes/common.js';
import { wsSend } from '../gateway/websocket.js';
import { messageStartPayload } from '../contracts.js';

export const WS_KINDS: ResourceKind[] = [
  {
    kind: 'websocket', name: 'WebSocket connection', desc: 'A WebSocket server this server connects to: its address, headers (a token, a key) and how it reconnects.',
    fields: [
      F('url', 'Address', 'text', 'wss://stream.example.com/ws', { tpl: true, help: 'ws:// or wss://. May use project variables.' }),
      F('headers', 'Headers', 'kv', [], { tpl: true, help: 'Sent when connecting. Values may use {{secret.NAME}}, such as Authorization = Bearer {{secret.STREAM_TOKEN}}.' }),
      F('protocols', 'Subprotocols', 'text', '', { help: 'Comma separated, when the server asks for one.' }),
      F('pingSeconds', 'Ping every (seconds)', 'number', 30, { help: 'Keeps the connection open through proxies; a server that stops answering is reconnected. 0 = off.' }),
      F('reconnectMinMs', 'Reconnect after (ms)', 'number', 1000, { help: 'The first wait after a lost connection; it doubles up to the maximum.' }),
      F('reconnectMaxMs', 'Longest wait (ms)', 'number', 30000),
    ],
  },
];

const secretValue = (name: string) => { const v = getSecret(name); if (v === undefined) throw new Error(`Secret "${name}" does not exist`); return v; };
/** Address and headers of a connection, with {{secret.X}} and variables resolved. */
function target(r: Resource, scope: Record<string, any> = {}) {
  const s = { ...scope, secret: new Proxy({}, { get: (_, n) => (typeof n === 'string' ? secretValue(n) : undefined) }) };
  const url = String(resolveTemplate(r.config.url, s) ?? '');
  if (!/^wss?:\/\//i.test(url)) throw new Error(`${r.name}: the address must start with ws:// or wss://`);
  const headers = kvToObject(r.config.headers, v => String(resolveTemplate(v, s) ?? ''));
  const protocols = String(r.config.protocols || '').split(',').map(x => x.trim()).filter(Boolean);
  return { url, headers, protocols };
}
const parse = (data: WebSocket.RawData, format: string) => {
  const text = Buffer.isBuffer(data) ? data.toString('utf8') : Buffer.concat(Array.isArray(data) ? data : [Buffer.from(data as ArrayBuffer)]).toString('utf8');
  if (format === 'text') return text;
  try { return JSON.parse(text); } catch { return text; }
};
const outgoing = (v: unknown, format: string) => (typeof v === 'string' ? v : format === 'text' ? String(v ?? '') : JSON.stringify(v));

export const wsActivities: Activity[] = [
  {
    type: 'wsService', palette: 'triggers', name: 'WebSocket service', glyph: '⇄', trigger: true, ports: ['message', 'open', 'close'],
    desc: 'Accepts WebSocket connections on the gateway. Each message starts a run (output message); connect and disconnect start runs when open or close are connected. Answer or push with a WebSocket send step.',
    fields: [
      F('path', 'Path', 'text', '/ws/orders', { help: 'ws:// on the gateway HTTP port, wss:// on its HTTPS port. Use :name for path parameters.' }),
      F('policy', 'API security policy', 'resource', '', { resourceKind: 'inboundPolicy', help: 'Checked when a client connects. Browsers cannot send headers: they pass a token as ?access_token= or the key under the key header\'s name in the query. CORS origins limit which pages may connect.' }),
      F('requiredScopes', 'Required scopes', 'text', '', { help: 'Space separated; the caller\'s token or gateway app must hold every one.' }),
      F('format', 'Messages are', 'select', 'json', { options: ['json', 'text'] }),
      F('maxMessageKb', 'Max message size (KB)', 'number', 256),
      F('inOrder', 'One message at a time per connection', 'bool', true, { help: 'The next message of a connection starts its run when the previous run ends, so answers keep their order. Off: messages run side by side.' }),
      F('bodySchema', 'Message schema', 'schema', '', { help: 'Optional: a JSON Schema or JSON sample of the messages.' }),
      F('validateBody', 'Validate messages', 'select', 'off', { options: ['off', 'reject invalid'], help: 'reject invalid: a message that does not match gets an error message back and starts no run.' }),
      F('testRequest', 'Test message (JSON)', 'code', '{\n  "event": "message",\n  "connectionId": "test",\n  "message": { "type": "subscribe", "orderId": "A-1001" }\n}'),
    ],
    outputHint: { event: 'message', connectionId: '', path: '/ws/orders', params: {}, message: {}, auth: { subject: '', method: '' }, client: { ip: '' } },
    validateStart: async c => { await messageStartPayload('wsService', c.node.config, c.input, c.scope, c.projectId, c.node.name); },
    outputSchema: (cfg, h) => {
      const t = h.infer({ event: 'message', connectionId: '', path: '', params: {}, message: null, auth: { subject: '', method: '', claims: {} }, client: { ip: '', secure: true }, code: 1000, reason: '' });
      const body = h.schema(cfg.bodySchema);
      t.children = t.children!.map(ch => (ch.name === 'message' ? (body ? { ...body, name: 'message' } : h.infer(safeJson(cfg.testRequest)?.message ?? {}, 'message')) : ch));
      return t;
    },
    execute: async c => {
      const req = await messageStartPayload('wsService', c.node.config, c.input, c.scope, c.projectId, c.node.name);
      return { port: ['open', 'close'].includes(req.event) ? req.event : 'message', out: req };
    },
  },
  {
    type: 'wsSend', palette: 'websocket', name: 'WebSocket send', glyph: '⇉', ports: ['out'],
    desc: 'Sends a message to a client of a WebSocket service: the one that sent the message being handled, another connection, or every connection of a service. Can also close a connection.',
    fields: [
      F('to', 'Send to', 'select', 'this connection', { options: ['this connection', 'a connection', 'every connection of a service'] }),
      F('connectionId', 'Connection id', 'text', '{{trigger.connectionId}}', { tpl: true, ...when('to', 'a connection'), help: 'A connectionId a WebSocket service trigger gave, kept for example in a memory table.' }),
      F('path', 'Service path', 'text', '/ws/orders', { tpl: true, ...when('to', 'every connection of a service') }),
      F('action', 'Action', 'select', 'send', { options: ['send', 'close'] }),
      F('message', 'Message', 'code', '{\n  "ok": true,\n  "orderId": "{{input.message.orderId}}"\n}', { tpl: true, ...when('action', 'send') }),
      F('format', 'Send as', 'select', 'json', { options: ['json', 'text'], ...when('action', 'send') }),
      F('closeCode', 'Close code', 'number', 1000, when('action', 'close')),
      F('closeReason', 'Close reason', 'text', '', when('action', 'close')),
    ],
    execute: async c => {
      const to = c.raw('to') || 'this connection';
      const connectionId = to === 'this connection' ? String(c.scope.trigger?.connectionId || '') : to === 'a connection' ? String(c.v('connectionId') ?? '') : undefined;
      if (connectionId !== undefined && !connectionId) throw new Error('No connection: this Sutra was not started by a WebSocket service (use "a connection" with its id)');
      const close = c.raw('action') === 'close' ? { code: Number(c.raw('closeCode')) || 1000, reason: String(c.v('closeReason') ?? '').slice(0, 120) } : undefined;
      let data: unknown = '';
      if (!close) {
        const m = c.v('message');
        data = c.raw('format') === 'text' ? outgoing(m, 'text') : typeof m === 'string' ? (() => { try { return JSON.stringify(JSON.parse(m)); } catch { return JSON.stringify(m); } })() : JSON.stringify(m);
      }
      const r = await wsSend({ connectionId, path: to === 'every connection of a service' ? String(c.v('path') ?? '') : undefined, data, close });
      return { out: { ...r, connectionId: connectionId || null } };
    },
  },
  {
    type: 'wsClientTrigger', palette: 'triggers', name: 'WebSocket client', glyph: '⇆', trigger: true, ports: ['out'],
    desc: 'Connects to a WebSocket server and starts a run for each message it sends. Reconnects when the connection is lost (waiting longer each time), and sends a subscribe message after every connect. Runs on the leader engine of a cluster.',
    fields: [
      F('connection', 'WebSocket connection', 'resource', '', { resourceKind: 'websocket' }),
      F('subscribe', 'Send after connecting', 'code', '', { tpl: true, help: 'Optional, such as {"op":"subscribe","channel":"orders"}. Sent again after every reconnect.' }),
      F('format', 'Messages are', 'select', 'json', { options: ['json', 'text'] }),
      F('testMessage', 'Test message (JSON)', 'code', '{\n  "channel": "orders",\n  "data": { "orderId": "A-1001" }\n}'),
    ],
    outputHint: { message: {}, connection: '', receivedAt: '2026-01-01T00:00:00.000Z' },
    outputSchema: (cfg, h) => h.infer({ message: safeJson(cfg.testMessage) ?? {}, connection: '', receivedAt: '' }),
    execute: c => ({ out: c.input ?? { message: safeJson(c.raw('testMessage')) ?? {}, connection: '', receivedAt: new Date().toISOString() } }),
  },
  {
    type: 'wsClientSend', palette: 'websocket', name: 'WebSocket client send', glyph: '↠', ports: ['out'],
    desc: 'Connects to a WebSocket server, sends a message and, if asked, waits for the answer; then closes the connection.',
    fields: [
      F('connection', 'WebSocket connection', 'resource', '', { resourceKind: 'websocket' }),
      F('message', 'Message', 'code', '{\n  "op": "status",\n  "orderId": "{{input.orderId}}"\n}', { tpl: true }),
      F('format', 'Send as', 'select', 'json', { options: ['json', 'text'] }),
      F('waitReply', 'Wait for the answer', 'bool', true),
      F('replyTimeoutMs', 'Wait at most (ms)', 'number', 10000, when('waitReply', true)),
      F('matchField', 'Answer has field', 'text', '', { tpl: true, help: 'Optional: wait for a message with this field equal to the value below, such as id (skips other messages).', ...when('waitReply', true) }),
      F('matchValue', 'Equal to', 'text', '', { tpl: true, ...when('waitReply', true) }),
    ],
    execute: async c => {
      const r = requireResource(c.raw('connection'), 'websocket', 'WebSocket connection');
      const t = target(r, c.scope);
      const format = c.raw('format') || 'json';
      const m = c.v('message');
      const data = typeof m === 'string' && format === 'json' ? (() => { try { return JSON.stringify(JSON.parse(m)); } catch { return m; } })() : outgoing(m, format);
      const wait = c.raw('waitReply') !== false;
      const timeout = Math.max(100, Number(c.raw('replyTimeoutMs')) || 10000);
      const field = String(c.v('matchField') ?? ''), value = String(c.v('matchValue') ?? '');
      return await new Promise((done, fail) => {
        const ws = new WebSocket(t.url, t.protocols.length ? t.protocols : undefined, { headers: t.headers, handshakeTimeout: Math.min(timeout, 15000) });
        let timer: NodeJS.Timeout | undefined;
        const finish = (err: Error | null, out?: any) => { clearTimeout(timer); c.signal.removeEventListener('abort', abort); try { ws.close(); } catch { /* closing */ } if (err) fail(err); else done({ out }); };
        const abort = () => finish(new Error('Step was cancelled'));
        c.signal.addEventListener('abort', abort);
        ws.on('open', () => {
          ws.send(data, e => {
            if (e) return finish(e);
            if (!wait) return finish(null, { sent: true, reply: null });
            timer = setTimeout(() => finish(new Error(`No answer from ${r.name} within ${timeout} ms`)), timeout);
          });
        });
        ws.on('message', d => {
          if (!wait) return;
          const reply = parse(d, format);
          if (field && !(reply && typeof reply === 'object' && String((reply as any)[field]) === value)) return;
          finish(null, { sent: true, reply });
        });
        ws.on('unexpected-response', (_req, res) => finish(new Error(`${r.name} refused the connection: ${res.statusCode}`)));
        ws.on('error', e => finish(new Error(`${r.name}: ${e.message}`)));
        ws.on('close', (code, reason) => { if (wait) finish(new Error(`${r.name} closed the connection (${code}${reason.length ? `: ${reason}` : ''}) before answering`)); });
      });
    },
  },
];

function safeJson(t: unknown) { try { return typeof t === 'string' && t.trim() ? JSON.parse(t) : undefined; } catch { return undefined; } }

registerListener('wsClientTrigger', ctx => {
  const cfg = ctx.node.config;
  const r = requireResource(cfg.connection, 'websocket', 'WebSocket connection');
  const min = Math.max(200, Number(r.config.reconnectMinMs) || 1000), max = Math.max(min, Number(r.config.reconnectMaxMs) || 30000);
  const pingMs = Math.max(0, Number(r.config.pingSeconds ?? 30)) * 1000;
  let ws: WebSocket | null = null, stopped = false, wait = min, retry: NodeJS.Timeout | undefined, ping: NodeJS.Timeout | undefined, alive = true;
  const connect = () => {
    if (stopped) return;
    let t;
    try { t = target(r); } catch (e: any) { ctx.status('error', e.message); return; }
    ws = new WebSocket(t.url, t.protocols.length ? t.protocols : undefined, { headers: t.headers, handshakeTimeout: 15000 });
    ws.on('open', () => {
      wait = min; alive = true;
      ctx.status('ok', `Connected to ${t.url.replace(/\?.*$/, '')}`);
      const sub = String(cfg.subscribe || '').trim();
      if (sub) ws!.send(sub);
      if (pingMs) { clearInterval(ping); ping = setInterval(() => { if (!alive) { ws?.terminate(); return; } alive = false; try { ws?.ping(); } catch { /* closing */ } }, pingMs); }
    });
    ws.on('pong', () => { alive = true; });
    ws.on('message', d => { void ctx.fire({ message: parse(d, cfg.format || 'json'), connection: r.name, receivedAt: new Date().toISOString() }); });
    ws.on('unexpected-response', (_req, res) => { ctx.status('error', `The server refused the connection: ${res.statusCode}`); ws?.terminate(); });
    ws.on('error', e => ctx.status('error', e.message));
    ws.on('close', () => {
      clearInterval(ping);
      if (stopped) return;
      ctx.status('error', `Connection lost; reconnecting in ${Math.round(wait / 1000)} s`);
      retry = setTimeout(connect, wait);
      wait = Math.min(max, wait * 2);
    });
  };
  connect();
  return () => { stopped = true; clearTimeout(retry); clearInterval(ping); try { ws?.close(1001, 'Sutra stopped'); } catch { /* closed */ } };
});
