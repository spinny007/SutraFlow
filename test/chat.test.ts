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
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { testEnv, node, edge } from './helpers.js';

/**
 * Discord (webhook and bot) and Telegram bots against stand-ins that answer like the real APIs:
 * messages with embeds and files, Test connection, tokens never shown in errors, and the triggers
 * that start Sutras from messages and commands.
 */
testEnv(20300);
const { boot } = await import('../server/src/index.js');
const { engine, runState } = await import('../server/src/engine/engine.js');
const { q } = await import('../server/src/db.js');
const projects = await import('../server/src/projects.js');
const flows = await import('../server/src/flows.js');
const { saveResource } = await import('../server/src/resources.js');
const { setSecret } = await import('../server/src/secrets.js');
const { testResource } = await import('../server/src/resourceTest.js');

let srv: Awaited<ReturnType<typeof boot>>;
let fake: http.Server;
let base = '';
let pid = '';
const got: { method: string; url: string; headers: http.IncomingHttpHeaders; body: Buffer }[] = [];
const TG_TOKEN = '123456:SECRET-telegram-token';
let pendingUpdates: any[] = [];
let discordMessages: any[] = [{ id: '100', channel_id: 'C1', author: { username: 'old', id: 'u0' }, content: 'before', timestamp: '2026-10-19T09:00:00Z' }];

before(async () => {
  srv = await boot({ listenAdmin: false });
  pid = projects.saveProject({ name: 'Chat', config: { variables: [] } }).id;
  setSecret('TG_TOKEN', TG_TOKEN);
  setSecret('DC_BOT', 'discord-bot-token');
  fake = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', d => chunks.push(d)); req.on('end', async () => {
      const body = Buffer.concat(chunks);
      const u = new URL(req.url!, 'http://x');
      got.push({ method: req.method!, url: req.url!, headers: req.headers, body });
      const send = (status: number, o: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      // Discord webhook and bot
      if (u.pathname === '/api/webhooks/1/abc') {
        if (req.method === 'GET') return send(200, { name: 'Alerts', channel_id: 'C9' });
        return send(200, { id: 'm1', channel_id: 'C9', author: { username: 'Alerts', id: 'w' }, content: '', timestamp: '2026-10-19T10:00:00Z', attachments: [] });
      }
      if (u.pathname.startsWith('/discord/')) {
        if (req.headers.authorization !== 'Bot discord-bot-token') return send(401, { message: '401: Unauthorized' });
        const p = u.pathname.slice('/discord'.length);
        if (p === '/users/@me') return send(200, { username: 'sutra-bot' });
        if (p === '/channels/C1') return send(200, { name: 'orders' });
        if (p === '/channels/C1/messages' && req.method === 'POST') return send(200, { id: 'm2', channel_id: 'C1', author: { username: 'sutra-bot', id: 'b', bot: true }, content: JSON.parse(body.toString()).content || '', timestamp: '2026-10-19T10:00:00Z' });
        if (p === '/channels/C1/messages') { const after = u.searchParams.get('after'); return send(200, [...discordMessages].filter(m => !after || BigInt(m.id) > BigInt(after)).reverse()); }
      }
      // Telegram
      if (u.pathname.startsWith(`/bot${TG_TOKEN}/`)) {
        const method = u.pathname.split('/').pop();
        const isJson = /json/.test(String(req.headers['content-type']));
        const b = isJson ? JSON.parse(body.toString() || '{}') : {};
        if (method === 'getMe') return send(200, { ok: true, result: { username: 'asha_orders_bot', first_name: 'Asha orders' } });
        if (method === 'getChat') return b.chat_id === 'missing' ? send(400, { ok: false, description: 'Bad Request: chat not found' }) : send(200, { ok: true, result: { id: -100123, type: 'supergroup', title: 'Asha team' } });
        if (method === 'sendMessage') return send(200, { ok: true, result: { message_id: 77, chat: { id: Number(b.chat_id) || b.chat_id, type: 'private' }, text: b.text, date: 1760860800 } });
        if (method === 'sendDocument') return send(200, { ok: true, result: { message_id: 78, chat: { id: -100123, type: 'supergroup' }, caption: 'Report', date: 1760860800, document: { file_name: 'report.csv', file_id: 'F1' } } });
        if (method === 'getUpdates') {
          if (b.offset === -1) return send(200, { ok: true, result: [{ update_id: 9, message: { message_id: 1, chat: { id: 5 }, text: 'old message' } }] });
          if (pendingUpdates.length && (b.offset ?? 0) <= pendingUpdates[0].update_id) { const r = pendingUpdates; pendingUpdates = []; return send(200, { ok: true, result: r }); }
          await new Promise(r => setTimeout(r, 300));
          return send(200, { ok: true, result: [] });
        }
      }
      if (u.pathname.startsWith('/bot')) return send(401, { ok: false, description: 'Unauthorized' });
      send(404, { message: 'no route' });
    });
  });
  await new Promise<void>(r => fake.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(fake.address() as any).port}`;
  setSecret('DC_HOOK', `${base}/api/webhooks/1/abc`);
});
after(async () => { fake.close(); await srv.stop(); });

const tg = () => saveResource({ kind: 'telegram', name: `TG ${Math.random()}`, project_id: pid, config: { botTokenSecret: 'TG_TOKEN', chatId: '-100123', apiBase: base } });
const dcBot = () => saveResource({ kind: 'discord', name: `DC ${Math.random()}`, project_id: pid, config: { mode: 'bot', botTokenSecret: 'DC_BOT', channelId: 'C1', apiBase: `${base}/discord` } });
const run = async (n: ReturnType<typeof node>) => {
  const s = node('start', 'Start', { payload: JSON.stringify({ orderId: 'A-1001' }) });
  const id = await engine.startRun({ doc: { name: 'T', nodes: [s, n], edges: [edge(s, n)] }, projectId: pid, source: 'test' });
  await engine.waitFor(id, 30000);
  const r: any = q.get('select id, status, error, state from runs where id = ?', id);
  return { status: r.status, error: r.error, out: runState(r.id)!.outputs[n.name] };
};

test('Test connection: a Discord webhook, a Discord bot and its channel, a Telegram bot and its chat', async () => {
  const hook = saveResource({ kind: 'discord', name: 'Hook', project_id: pid, config: { mode: 'webhook', webhookSecret: 'DC_HOOK' } });
  assert.equal((await testResource({ id: hook.id, kind: 'discord', project_id: pid, config: hook.config })).message, 'Webhook "Alerts" posts to channel C9');
  const b = dcBot();
  assert.equal((await testResource({ id: b.id, kind: 'discord', project_id: pid, config: b.config })).message, 'Signed in as the bot sutra-bot; can see #orders');
  const t = tg();
  assert.equal((await testResource({ id: t.id, kind: 'telegram', project_id: pid, config: t.config })).message, 'Bot @asha_orders_bot (Asha orders); can reach Asha team');
});

test('a wrong Telegram chat says why and never shows the bot token', async () => {
  const t = tg();
  const r = await testResource({ kind: 'telegram', project_id: pid, config: { ...t.config, chatId: 'missing' } });
  assert.equal(r.ok, false);
  assert.match(r.message, /chat not found/);
  assert.ok(!r.message.includes('SECRET-telegram-token'));
  setSecret('TG_BAD', 'bad:SECRET-other-token');
  const bad = await run(node('telegram', 'Send', { connection: saveResource({ kind: 'telegram', name: 'Bad', project_id: pid, config: { botTokenSecret: 'TG_BAD', apiBase: base } }).id, chatId: '5', text: 'hi' }));
  assert.equal(bad.status, 'failed');
  assert.match(bad.error, /Unauthorized/);
  assert.ok(!bad.error.includes('SECRET-other-token'));
});

test('Discord: a webhook message with an embed and a file; a bot message with mentions switched off', async () => {
  const hook = saveResource({ kind: 'discord', name: 'Hook 2', project_id: pid, config: { mode: 'webhook', webhookSecret: 'DC_HOOK' } });
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-dc-')), 'report.csv');
  fs.writeFileSync(f, 'order,total\nA-1001,240\n');
  const r = await run(node('discord', 'Post', { connection: hook.id, op: 'send message', content: 'Order {{input.orderId}} shipped', username: 'SutraFlow', embedTitle: 'Order {{input.orderId}}', embedText: 'Blue Dart', embedColor: '#ff0000', files: f }));
  assert.equal(r.status, 'done', r.error);
  const post = got.find(g => g.method === 'POST' && g.url.startsWith('/api/webhooks/1/abc'))!;
  assert.match(post.url, /wait=true/);
  assert.match(String(post.headers['content-type']), /multipart\/form-data/);
  const text = post.body.toString();
  assert.match(text, /"content":"Order A-1001 shipped"/);
  assert.match(text, /"embeds":\[\{"title":"Order A-1001","description":"Blue Dart","color":16711680\}\]/);
  assert.match(text, /"allowed_mentions":\{"parse":\[\]\}/);
  assert.match(text, /filename="report.csv"[\s\S]*A-1001,240/);
  const b = await run(node('discord', 'Bot post', { connection: dcBot().id, op: 'send message', content: 'Hello @everyone' }));
  assert.equal(b.status, 'done', b.error);
  assert.deepEqual(JSON.parse(got.filter(g => g.url === '/discord/channels/C1/messages' && g.method === 'POST').pop()!.body.toString()).allowed_mentions, { parse: [] });
});

test('Telegram: an HTML reply, and a document from a server file', async () => {
  const t = tg();
  const r = await run(node('telegram', 'Reply', { connection: t.id, op: 'send message', chatId: '42', text: '<b>Order {{input.orderId}}</b> shipped', format: 'HTML', replyTo: '9', preview: false }));
  assert.equal(r.status, 'done', r.error);
  const sent = JSON.parse(got.filter(g => g.url.endsWith('/sendMessage')).pop()!.body.toString());
  assert.deepEqual(sent, { chat_id: '42', parse_mode: 'HTML', reply_parameters: { message_id: 9, allow_sending_without_reply: true }, text: '<b>Order A-1001</b> shipped', link_preview_options: { is_disabled: true } });
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-tg-')), 'report.csv');
  fs.writeFileSync(f, 'a,b\n1,2\n');
  const d = await run(node('telegram', 'Doc', { connection: t.id, op: 'send document', chatId: '', file: f, caption: 'Report' }));
  assert.equal(d.status, 'done', d.error);
  const up = got.filter(g => g.url.endsWith('/sendDocument')).pop()!;
  assert.match(String(up.headers['content-type']), /multipart\/form-data/);
  assert.match(up.body.toString(), /name="chat_id"\r\n\r\n-100123[\s\S]*filename="report.csv"/);
});

test('the Telegram trigger skips old messages and starts the Sutra for a new /command', async () => {
  const t = tg();
  const trig = node('telegramTrigger', 'To the bot', { connection: t.id });
  const reply = node('telegram', 'Answer', { connection: t.id, op: 'send message', chatId: '{{trigger.chatId}}', text: 'Status of {{trigger.args}}: shipped', replyTo: '{{trigger.messageId}}' });
  const f = flows.saveFlow(undefined, { name: 'Bot', nodes: [trig, reply], edges: [edge(trig, reply, 'command')] }, pid);
  flows.deploy(f.id);
  await new Promise(r => setTimeout(r, 800));
  pendingUpdates = [{ update_id: 10, message: { message_id: 55, chat: { id: 777, type: 'private' }, from: { username: 'meera', id: 777 }, text: '/status A-1002', date: 1760860800 } }];
  let msg: any;
  for (let i = 0; i < 40 && !msg; i++) { await new Promise(r => setTimeout(r, 250)); const s = got.filter(g => g.url.endsWith('/sendMessage')).map(g => JSON.parse(g.body.toString())).find(m => m.chat_id === '777'); msg = s; }
  flows.undeploy(f.id);
  assert.ok(msg, 'the bot answered');
  assert.equal(msg.text, 'Status of A-1002: shipped');
  assert.equal(msg.reply_parameters.message_id, 55);
  assert.ok(!got.some(g => g.url.endsWith('/sendMessage') && JSON.parse(g.body.toString()).text?.includes('old message')), 'the old message was skipped');
});

test('the Discord trigger starts the Sutra for a !command, and leaves out bots', { timeout: 30000 }, async () => {
  const b = dcBot();
  const trig = node('discordTrigger', 'Channel', { connection: b.id, channelId: 'C1', prefix: '!', pollSeconds: 5 });
  const log = node('log', 'Seen', { message: '{{trigger.command}} {{trigger.args}}' });
  const f = flows.saveFlow(undefined, { name: 'Discord bot', nodes: [trig, log], edges: [edge(trig, log, 'command')] }, pid);
  flows.deploy(f.id);
  await new Promise(r => setTimeout(r, 1000));
  discordMessages = [...discordMessages, { id: '101', channel_id: 'C1', author: { username: 'other-bot', id: 'x', bot: true }, content: '!status A-9', timestamp: '2026-10-19T10:00:00Z' }, { id: '102', channel_id: 'C1', author: { username: 'meera', id: 'u1' }, content: '!status A-1001', timestamp: '2026-10-19T10:00:01Z' }];
  let runs: any[] = [];
  for (let i = 0; i < 40 && !runs.length; i++) { await new Promise(r => setTimeout(r, 300)); runs = q.all<any>("select id, state from runs where flow_id = ? and status = 'done'", f.id); }
  flows.undeploy(f.id);
  assert.equal(runs.length, 1, 'one run: the bot message was left out');
  const out = runState(runs[0].id)!.outputs;
  assert.equal(out.Channel.author, 'meera');
  assert.equal(out.Channel.command, 'status');
  assert.equal(out.Channel.args, 'A-1001');
});

test('the Discord and Telegram templates are complete and described', async () => {
  const { addSamples } = await import('../server/src/samples.js');
  const { validateDoc } = await import('../server/src/flows.js');
  const p2 = projects.saveProject({ name: 'Chat templates', config: { variables: [] } }).id;
  const made = addSamples(p2, ['discord', 'telegram']);
  assert.deepEqual(made.map(m => m.name).sort(), ['Sample: Discord order status bot', 'Sample: Telegram order status bot', 'Sample: Telegram team alerts']);
  for (const m of made) {
    const doc = flows.getFlow(m.id)!.doc;
    assert.ok(doc.nodes.every(n => n.description), m.name);
    assert.deepEqual(validateDoc(doc, p2).errors, [], m.name);
    assert.equal(m.folder, 'Samples/Social media');
  }
});
