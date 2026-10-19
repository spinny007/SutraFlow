/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import type { Activity, Field } from '../engine/types.js';
import { requireResource, effectiveResource, kvToObject, type Resource } from '../resources.js';
import { requireSecret } from '../secrets.js';
import { registerListener, type ListenerContext } from '../listeners.js';
import { F, when } from '../palettes/common.js';

const require = createRequire(import.meta.url);

/**
 * Service Bus palette (JMS-style) for Kafka, RabbitMQ (AMQP 0-9-1) and AMQP 1.0
 * brokers (ActiveMQ Classic/Artemis, Azure Service Bus, Qpid).
 *
 * Message headers follow JMS: messageId, correlationId, replyTo, type (JMSType),
 * deliveryMode (persistent / non-persistent), priority (0-9), timeToLive, plus
 * custom properties. Destinations are a queue or a topic, and may come from
 * project variables ({{gv.ORDERS_QUEUE}}).
 *
 * Acknowledge modes of the subscriber:
 *   auto      acknowledged on receipt (at most once)
 *   client    acknowledged when the flow finished successfully; on failure the
 *             message is redelivered (requeue) or rejected (dead-letter)
 *   explicit  the flow acknowledges with a Confirm message activity, at the point
 *             it chooses (Confirm message); not confirmed = redelivered
 */
type Broker = 'kafka' | 'rabbitmq' | 'amqp1';
type Secret = (n: string, w?: string) => string;

const brokerFields: Field[] = [
  F('broker', 'Broker', 'select', 'amqp1', { options: ['amqp1', 'rabbitmq', 'kafka'], help: 'amqp1 = ActiveMQ Classic/Artemis, Azure Service Bus, Qpid.' }),
  F('amqpConn', 'AMQP 1.0 connection', 'resource', '', { resourceKind: 'amqp1', ...when('broker', 'amqp1') }),
  F('rabbitConn', 'RabbitMQ connection', 'resource', '', { resourceKind: 'rabbitmq', ...when('broker', 'rabbitmq') }),
  F('kafkaConn', 'Kafka connection', 'resource', '', { resourceKind: 'kafka', ...when('broker', 'kafka') }),
  F('destinationType', 'Destination type', 'select', 'queue', { options: ['queue', 'topic'], ...when('broker', 'amqp1', 'rabbitmq') }),
];
const connOf = (cfg: Record<string, any>): Resource => {
  const b = (cfg.broker || 'kafka') as Broker;
  const id = b === 'kafka' ? cfg.kafkaConn : b === 'rabbitmq' ? cfg.rabbitConn : cfg.amqpConn;
  return requireResource(id, b, `${b} connection`);
};
/** AMQP 1.0 address for a queue or topic (ActiveMQ Classic: topic://name). */
const amqpAddress = (r: Resource, type: string, name: string) => {
  if (/^(queue|topic):\/\//.test(name)) return name;
  return (type === 'topic' ? r.config.topicPrefix ?? 'topic://' : r.config.queuePrefix ?? '') + name;
};

// ---------- clients ----------
function kafkaClient(r: Resource, secret: Secret) {
  const { Kafka, logLevel } = require('kafkajs');
  const c = r.config;
  return new Kafka({
    clientId: c.clientId || 'sutraflow', brokers: c.brokers, ssl: !!c.ssl, logLevel: logLevel.NOTHING,
    sasl: c.sasl && c.sasl !== 'none' ? { mechanism: c.sasl, username: c.user, password: secret(c.passwordSecret, 'Kafka password') } : undefined,
  });
}
function rabbitUrl(r: Resource, secret: Secret) {
  const u = new URL(r.config.url || 'amqp://localhost:5672/');
  if (r.config.user) { u.username = encodeURIComponent(r.config.user); u.password = encodeURIComponent(r.config.passwordSecret ? secret(r.config.passwordSecret, 'RabbitMQ password') : ''); }
  if (r.config.vhost && r.config.vhost !== '/') u.pathname = '/' + encodeURIComponent(r.config.vhost);
  return u.toString();
}
function amqpConnect(r: Resource, secret: Secret, reconnect = true) {
  const rhea = require('rhea');
  const container = rhea.create_container({ id: r.config.containerId || 'sutraflow' });
  const conn = container.connect({
    host: r.config.host, port: Number(r.config.port) || 5672, transport: r.config.tls ? 'tls' : 'tcp',
    username: r.config.user || undefined, password: r.config.passwordSecret ? secret(r.config.passwordSecret, 'AMQP password') : undefined,
    reconnect, initial_reconnect_delay: 500, max_reconnect_delay: 30000,
  });
  return { container, conn, rhea };
}

const producers = new Map<string, Promise<any>>();
async function publisher(b: Broker, r: Resource, secret: Secret) {
  const key = `${b}:${r.rev}`;
  let p = producers.get(key);
  if (!p) {
    p = (async () => {
      if (b === 'kafka') { const pr = kafkaClient(r, secret).producer(); await pr.connect(); return pr; }
      if (b === 'rabbitmq') {
        const amqp = require('amqplib');
        const conn = await amqp.connect(rabbitUrl(r, secret));
        conn.on('close', () => producers.delete(key));
        return conn.createConfirmChannel();
      }
      const { conn } = amqpConnect(r, secret);
      await new Promise<void>((res, rej) => {
        conn.once('connection_open', () => res());
        conn.once('connection_error', (ctx: any) => rej(new Error(ctx?.connection?.error?.description || 'AMQP connection failed')));
        conn.once('disconnected', (ctx: any) => rej(new Error(ctx?.error?.message || 'AMQP broker not reachable')));
      });
      return { conn, senders: new Map<string, any>() };
    })();
    producers.set(key, p);
    p.catch(() => producers.delete(key));
  }
  return p;
}

/** Closes publisher connections (server stop). */
export async function closeBusPublishers() {
  const all = [...producers.entries()];
  producers.clear();
  await Promise.all(all.map(async ([key, p]) => {
    try {
      const v = await p;
      if (key.startsWith('kafka:')) await v.disconnect();
      else if (key.startsWith('rabbitmq:')) await v.connection?.close?.();
      else { if (v.conn.options) v.conn.options.reconnect = false; v.conn.close(); }
    } catch { /* best effort */ }
  }));
}

function bodyBytes(body: unknown, type: string): { buf: Buffer; contentType: string } {
  if (type === 'bytes') return { buf: Buffer.from(String(body ?? ''), 'base64'), contentType: 'application/octet-stream' };
  if (type === 'text') return { buf: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)), contentType: 'text/plain' };
  return { buf: Buffer.from(JSON.stringify(body ?? null)), contentType: 'application/json' };
}

// ---------- explicit acknowledgement (Confirm message) ----------
interface PendingAck { confirm(): Promise<void> | void; requeue(): Promise<void> | void; reject(): Promise<void> | void; done: boolean }
const pending = new Map<string, PendingAck>();

export const busActivities: Activity[] = [
  {
    type: 'busPublish', palette: 'bus', name: 'Publish message', glyph: '⇪', ports: ['out'],
    desc: 'Sends a message to a queue or topic (ActiveMQ/AMQP 1.0, RabbitMQ) or a Kafka topic with JMS-style headers and custom properties, and waits for the broker to confirm.',
    fields: [
      ...brokerFields,
      F('destination', 'Queue / topic name', 'text', '{{gv.ORDERS_QUEUE}}', { tpl: true, help: 'Mappable, or a project variable such as {{gv.ORDERS_QUEUE}}.' }),
      F('exchange', 'Exchange (RabbitMQ)', 'text', '', { tpl: true, ...when('broker', 'rabbitmq'), help: 'Empty: queue = default exchange; topic = amq.topic.' }),
      F('messageType', 'Message type', 'select', 'JSON', { options: ['JSON', 'text', 'map', 'bytes'], help: 'map = an object of fields (JMS MapMessage style); bytes = base64 content.' }),
      F('body', 'Message body', 'code', '{{input}}', { tpl: true }),
      F('deliveryMode', 'Delivery mode', 'select', 'persistent', { options: ['persistent', 'non-persistent'], group: 'Headers' }),
      F('priority', 'Priority (0-9)', 'number', 4, { group: 'Headers' }),
      F('timeToLive', 'Time to live (ms, 0 = forever)', 'number', 0, { group: 'Headers' }),
      F('messageId', 'Message id', 'text', '', { tpl: true, group: 'Headers', help: 'Empty = a new id.' }),
      F('correlationId', 'Correlation id', 'text', '', { tpl: true, group: 'Headers' }),
      F('replyTo', 'Reply to', 'text', '', { tpl: true, group: 'Headers' }),
      F('jmsType', 'Type (JMSType / subject)', 'text', '', { tpl: true, group: 'Headers' }),
      F('key', 'Message key (Kafka)', 'text', '{{input.orderId}}', { tpl: true, group: 'Headers', ...when('broker', 'kafka'), help: 'Same key = same partition, so order is kept.' }),
      F('acks', 'Broker acknowledgement (Kafka)', 'select', 'all', { options: ['all', 'leader', 'none'], group: 'Headers', ...when('broker', 'kafka') }),
      F('properties', 'Custom properties', 'kv', [{ k: 'source', v: 'sutraflow' }], { tpl: true, group: 'Properties' }),
    ],
    outputHint: { messageId: '', destination: '', partition: 0, offset: '' },
    execute: async c => {
      const cfg = c.node.config;
      const b = (cfg.broker || 'kafka') as Broker;
      const r = connOf(cfg);
      // Older steps used topic / routingKey / address / format / headers.
      const dest = String(c.v('destination') ?? '') || String(c.v('topic') ?? c.v('routingKey') ?? c.v('address') ?? '');
      if (!dest) throw new Error('Queue / topic name is empty');
      const type = c.raw('messageType') || (c.raw('format') === 'text' ? 'text' : 'JSON');
      const { buf, contentType } = bodyBytes(c.v('body'), type);
      const props = { ...kvToObject(c.raw('headers'), v => String(c.resolve(v) ?? '')), ...kvToObject(c.raw('properties'), v => String(c.resolve(v) ?? '')) };
      const messageId = String(c.v('messageId') || '') || crypto.randomUUID();
      const correlationId = String(c.v('correlationId') || '') || undefined;
      const replyTo = String(c.v('replyTo') || '') || undefined;
      const jmsType = String(c.v('jmsType') || '') || undefined;
      const persistent = (c.raw('deliveryMode') || (c.raw('persistent') === false ? 'non-persistent' : 'persistent')) === 'persistent';
      const priority = Math.max(0, Math.min(9, Number(c.raw('priority') ?? 4)));
      const ttl = Math.max(0, Number(c.raw('timeToLive')) || 0);
      const pub = await publisher(b, r, c.secret);

      if (b === 'kafka') {
        const headers: Record<string, string> = { ...props, messageId, contentType, ...(correlationId ? { correlationId } : {}), ...(replyTo ? { replyTo } : {}), ...(jmsType ? { type: jmsType } : {}) };
        const res = await pub.send({ topic: dest, acks: c.raw('acks') === 'none' ? 0 : c.raw('acks') === 'leader' ? 1 : -1, messages: [{ key: c.v('key') ? String(c.v('key')) : undefined, value: buf, headers }] });
        return { out: { messageId, destination: dest, partition: res?.[0]?.partition, offset: res?.[0]?.baseOffset } };
      }
      if (b === 'rabbitmq') {
        const topic = c.raw('destinationType') === 'topic';
        const exchange = String(c.v('exchange') || '') || (topic ? 'amq.topic' : '');
        pub.publish(exchange, dest, buf, { persistent, priority, expiration: ttl ? String(ttl) : undefined, messageId, correlationId, replyTo, type: jmsType, contentType, headers: props, timestamp: Math.floor(Date.now() / 1000) });
        await pub.waitForConfirms();
        return { out: { messageId, destination: exchange ? `${exchange}/${dest}` : dest } };
      }
      const address = amqpAddress(r, c.raw('destinationType'), dest);
      let sender = pub.senders.get(address);
      if (!sender) { sender = pub.conn.open_sender(address); pub.senders.set(address, sender); }
      await new Promise<void>((res, rej) => {
        const send = () => {
          const d = sender.send({
            message_id: messageId, correlation_id: correlationId, reply_to: replyTo, subject: jmsType, durable: persistent, priority,
            ttl: ttl || undefined, content_type: contentType, body: type === 'bytes' ? require('rhea').message.data_section(buf) : buf.toString(),
            application_properties: props,
          });
          const onAcc = (ctx: any) => { if (ctx.delivery === d) { cleanup(); res(); } };
          const onRej = (ctx: any) => { if (ctx.delivery === d) { cleanup(); rej(new Error(`Broker rejected the message: ${ctx.delivery?.remote_state?.error?.description || 'rejected'}`)); } };
          const cleanup = () => { sender.removeListener('accepted', onAcc); sender.removeListener('rejected', onRej); sender.removeListener('released', onRej); };
          sender.on('accepted', onAcc); sender.on('rejected', onRej); sender.on('released', onRej);
        };
        if (sender.sendable()) send(); else sender.once('sendable', send);
        c.signal.addEventListener('abort', () => rej(new Error('Cancelled')));
      });
      return { out: { messageId, destination: address } };
    },
  },
  {
    type: 'busSubscribe', palette: 'bus', name: 'Message subscriber', glyph: '⇩', trigger: true, ports: ['out'],
    desc: 'Starts the Sutra for each message on a queue or topic while deployed. Gives the body, the JMS headers and the custom properties. Acknowledge automatically, after the Sutra succeeds, or with a Confirm message activity.',
    fields: [
      ...brokerFields,
      F('destination', 'Queue / topic name', 'text', '{{gv.ORDERS_QUEUE}}', { help: 'May use project variables.' }),
      F('selector', 'Message selector', 'text', '', { help: "JMS selector, e.g. type = 'order' AND priority > 4 (AMQP 1.0 brokers that support it).", ...when('broker', 'amqp1') }),
      F('durableName', 'Durable subscription name', 'text', '', { help: 'Topics: keeps messages while the Sutra is not running.', ...when('destinationType', 'topic') }),
      F('groupId', 'Consumer group (Kafka)', 'text', 'sutraflow-orders', when('broker', 'kafka')),
      F('fromBeginning', 'Read from the beginning (new group)', 'bool', false, when('broker', 'kafka')),
      F('declare', 'Create the queue if missing (durable)', 'bool', false, when('broker', 'rabbitmq')),
      F('messageType', 'Message type', 'select', 'JSON', { options: ['JSON', 'text', 'map', 'bytes'] }),
      F('ackMode', 'Acknowledge', 'select', 'client', { options: ['auto', 'client', 'explicit'], help: 'auto: on receipt. client: when the Sutra succeeds. explicit: with a Confirm message activity in the Sutra.' }),
      F('onFailure', 'When the Sutra fails', 'select', 'requeue', { options: ['requeue', 'reject (dead-letter)'], ...when('ackMode', 'client', 'explicit') }),
      F('maxRedeliveries', 'Reject after this many deliveries (0 = never)', 'number', 0, when('ackMode', 'client', 'explicit')),
      F('concurrency', 'Messages in parallel', 'number', 1, { help: 'RabbitMQ prefetch / AMQP credit / Kafka partitions at once.' }),
      F('testMessage', 'Test message (JSON)', 'code', '{\n  "body": { "orderId": "A-1001" },\n  "headers": { "messageId": "m-1", "type": "order", "priority": 4, "deliveryMode": "persistent" },\n  "properties": { "source": "erp" }\n}'),
    ],
    outputHint: {
      body: {}, properties: {}, destination: '',
      headers: { messageId: '', correlationId: '', replyTo: '', type: '', priority: 4, deliveryMode: 'persistent', timestamp: '', expiration: '', redelivered: false, deliveryCount: 1, contentType: '' },
      key: '', partition: 0, offset: '',
    },
    execute: c => ({ out: c.input ?? JSON.parse(c.raw('testMessage') || '{}') }),
  },
  {
    type: 'busConfirm', palette: 'bus', name: 'Confirm message', glyph: '✓', ports: ['out'],
    desc: 'Acknowledges the message that started this run (Message subscriber with Acknowledge: explicit), or rejects / requeues it.',
    fields: [F('action', 'Action', 'select', 'confirm', { options: ['confirm', 'requeue', 'reject (dead-letter)'] })],
    outputHint: { confirmed: true, action: 'confirm' },
    passThrough: true,
    execute: async c => {
      const p = pending.get(c.runId);
      const a = c.raw('action') || 'confirm';
      if (!p) {
        if (c.scope.run?.source === 'test' || c.scope.run?.source === 'debug') { c.log('info', 'Test run: no message to confirm'); return { out: c.input }; }
        throw new Error('This run was not started by a Message subscriber with Acknowledge: explicit, or the message was already confirmed');
      }
      if (a === 'confirm') await p.confirm(); else if (a === 'requeue') await p.requeue(); else await p.reject();
      p.done = true;
      pending.delete(c.runId);
      c.log('info', `Message ${a === 'confirm' ? 'confirmed' : a}`);
      return { out: c.input };
    },
  },
];

// ---------- subscriber listener ----------
function decodeBody(raw: unknown, type: string) {
  if (raw == null) return null;
  const buf = Buffer.isBuffer(raw) ? raw : raw instanceof Uint8Array ? Buffer.from(raw) : null;
  if (type === 'bytes') return (buf || Buffer.from(String(raw))).toString('base64');
  const s = buf ? buf.toString('utf8') : typeof raw === 'string' ? raw : null;
  if (s === null) return raw; // already structured (AMQP map/list body)
  if (type === 'text') return s;
  try { return JSON.parse(s); } catch { return s; }
}

/** Runs the flow for one message and settles it according to the acknowledge mode. */
function handle(c: ListenerContext, cfg: Record<string, any>, input: Record<string, any>, settle: { ack(): any; requeue(): any; reject(): any }, deliveryCount: number) {
  const mode = cfg.ackMode === 'auto' || cfg.ackMode === 'on receipt' ? 'auto' : cfg.ackMode === 'explicit' ? 'explicit' : 'client';
  const max = Number(cfg.maxRedeliveries) || 0;
  const fail = () => (cfg.onFailure === 'reject (dead-letter)' || (max && deliveryCount >= max) ? settle.reject() : settle.requeue());
  if (mode === 'auto') { c.fire(input).catch(e => c.status('error', e.message)); return Promise.resolve(); }
  return new Promise<void>(resolve => {
    // The entry exists before the run starts: a run can end before its start has returned the id.
    const entry: PendingAck | null = mode === 'explicit' ? { confirm: settle.ack, requeue: settle.requeue, reject: settle.reject, done: false } : null;
    let runId = '';
    c.fire(input, status => {
      Promise.resolve().then(async () => {
        if (mode === 'explicit') {
          if (entry && !entry.done) {
            if (runId) pending.delete(runId);
            await fail();
            if (status === 'done') c.status('error', 'A run finished without Confirm message; the message was redelivered');
          }
        } else if (status === 'done') await settle.ack();
        else await fail();
      }).catch(e => c.status('error', `Acknowledgement failed: ${e.message}`)).finally(resolve);
    }).then(id => {
      runId = id;
      if (entry && !entry.done) pending.set(id, entry);
    }, e => {
      c.status('error', `The Sutra did not start: ${e.message}`);
      Promise.resolve(fail()).catch(() => {}).finally(resolve);
    });
  });
}

registerListener('busSubscribe', async c => {
  const cfg = c.node.config;
  const b = (cfg.broker || 'kafka') as Broker;
  const r = connOf(cfg);
  const n = Math.max(1, Number(cfg.concurrency) || 1);
  const dest = String(cfg.destination || cfg.topic || cfg.queue || cfg.address || '');
  if (!dest) throw new Error('Queue / topic name is empty');
  const type = cfg.messageType || (cfg.format === 'text' ? 'text' : 'JSON');
  const secret: Secret = (nm, w) => requireSecret(nm, w);
  const auto = cfg.ackMode === 'auto' || cfg.ackMode === 'on receipt';

  if (b === 'kafka') {
    const consumer = kafkaClient(r, secret).consumer({ groupId: cfg.groupId || 'sutraflow' });
    await consumer.connect();
    await consumer.subscribe({ topic: dest, fromBeginning: !!cfg.fromBeginning });
    await consumer.run({
      autoCommit: auto,
      partitionsConsumedConcurrently: n,
      eachMessage: async ({ topic, partition, message, pause }: any) => {
        const headers = Object.fromEntries(Object.entries(message.headers || {}).map(([k, v]: any) => [k, v?.toString()]));
        const { messageId, correlationId, replyTo, type: jt, contentType, ...props } = headers as Record<string, string>;
        const input = { body: decodeBody(message.value, type), properties: props, destination: topic, key: message.key?.toString(), partition, offset: message.offset,
          headers: { messageId, correlationId, replyTo, type: jt, contentType, timestamp: new Date(Number(message.timestamp)).toISOString(), redelivered: false, deliveryCount: 1 } };
        let requeued = false;
        const commit = () => consumer.commitOffsets([{ topic, partition, offset: (BigInt(message.offset) + 1n).toString() }]);
        await handle(c, cfg, input, { ack: commit, reject: commit, requeue: () => { requeued = true; } }, 1);
        if (requeued) { const resume = pause(); setTimeout(resume, 5000); throw new Error('Sutra failed; the message will be processed again'); }
      },
    });
    c.status('ok', `Consuming ${dest} as ${cfg.groupId}`);
    return () => consumer.disconnect();
  }

  if (b === 'rabbitmq') {
    const amqp = require('amqplib');
    const conn = await amqp.connect(rabbitUrl(r, secret));
    const ch = await conn.createChannel();
    let queue = dest;
    if (cfg.destinationType === 'topic') {
      // A topic is a binding on amq.topic: durable name = durable queue, otherwise a temporary one.
      const q = await ch.assertQueue(cfg.durableName || '', { durable: !!cfg.durableName, exclusive: !cfg.durableName, autoDelete: !cfg.durableName });
      await ch.bindQueue(q.queue, 'amq.topic', dest);
      queue = q.queue;
    } else if (cfg.declare) await ch.assertQueue(queue, { durable: true });
    await ch.prefetch(n);
    await ch.consume(queue, async (msg: any) => {
      if (!msg) return;
      const p = msg.properties;
      const deaths = Array.isArray(p.headers?.['x-death']) ? p.headers['x-death'].reduce((a: number, d: any) => a + (Number(d.count) || 0), 0) : 0;
      const input = { body: decodeBody(msg.content, type), properties: Object.fromEntries(Object.entries(p.headers || {}).filter(([k]) => !k.startsWith('x-'))), destination: dest, routingKey: msg.fields.routingKey,
        headers: { messageId: p.messageId, correlationId: p.correlationId, replyTo: p.replyTo, type: p.type, priority: p.priority, deliveryMode: p.deliveryMode === 2 ? 'persistent' : 'non-persistent', timestamp: p.timestamp ? new Date(p.timestamp * 1000).toISOString() : undefined, expiration: p.expiration, contentType: p.contentType, redelivered: msg.fields.redelivered, deliveryCount: deaths + 1 } };
      await handle(c, cfg, input, { ack: () => ch.ack(msg), requeue: () => ch.nack(msg, false, true), reject: () => ch.nack(msg, false, false) }, deaths + 1);
    }, { noAck: auto });
    c.status('ok', `Consuming ${cfg.destinationType === 'topic' ? 'topic' : 'queue'} ${dest}`);
    return async () => { await ch.close().catch(() => {}); await conn.close().catch(() => {}); };
  }

  const { conn, rhea } = amqpConnect(r, secret);
  const source: any = { address: amqpAddress(r, cfg.destinationType, dest) };
  if (cfg.selector) source.filter = rhea.filter.selector(cfg.selector);
  if (cfg.durableName && cfg.destinationType === 'topic') { source.durable = 2; source.expiry_policy = 'never'; }
  const receiver = conn.open_receiver({ source, name: cfg.durableName || undefined, autoaccept: auto, credit_window: n });
  receiver.on('message', async (ctx: any) => {
    const m = ctx.message;
    const raw = m.body && typeof m.body === 'object' && m.body.typecode === 0x75 ? m.body.content : m.body;
    const count = (m.delivery_count ?? 0) + 1;
    const input = { body: decodeBody(raw, type), properties: m.application_properties || {}, destination: dest,
      headers: { messageId: m.message_id, correlationId: m.correlation_id, replyTo: m.reply_to, type: m.subject, priority: m.priority, deliveryMode: m.durable ? 'persistent' : 'non-persistent', timestamp: m.creation_time ? new Date(m.creation_time).toISOString() : undefined, expiration: m.absolute_expiry_time, contentType: m.content_type, redelivered: count > 1, deliveryCount: count } };
    await handle(c, cfg, input, {
      ack: () => ctx.delivery.accept(),
      requeue: () => ctx.delivery.release({ delivery_failed: true }),
      reject: () => ctx.delivery.reject({ condition: 'sutra:flow-failed', description: 'Sutra failed' }),
    }, count);
  });
  conn.on('connection_open', () => c.status('ok', `Receiving from ${source.address}${cfg.selector ? ` where ${cfg.selector}` : ''}`));
  conn.on('disconnected', (ctx: any) => c.status('error', `Disconnected: ${ctx?.error?.message || 'broker not reachable'}; reconnecting`));
  return () => { try { if (conn.options) conn.options.reconnect = false; conn.close(); } catch { /* ignore */ } };
});

/** Test connection: connects to the broker and disconnects. */
export async function testBroker(r: Resource, secret: Secret): Promise<string> {
  const within = <T>(p: Promise<T>, what: string) => Promise.race([p, new Promise<T>((_, j) => setTimeout(() => j(new Error(`${what}: no answer within 15 seconds`)), 15000))]);
  if (r.kind === 'kafka') {
    const admin = kafkaClient(r, secret).admin();
    await within(admin.connect(), 'Kafka');
    try { const topics = await within<string[]>(admin.listTopics(), 'Kafka'); return `Connected to Kafka: ${topics.length} topics`; } finally { await admin.disconnect().catch(() => {}); }
  }
  if (r.kind === 'rabbitmq') {
    const amqplib = require('amqplib');
    const conn = await within(amqplib.connect(rabbitUrl(r, secret)), 'RabbitMQ') as any;
    await conn.close().catch(() => {});
    return `Connected to RabbitMQ at ${new URL(r.config.url || 'amqp://localhost:5672/').host}`;
  }
  const { container, conn } = amqpConnect(r, secret, false);
  try {
    await within(new Promise<void>((res, rej) => {
      container.once('connection_open', () => res());
      container.once('connection_error', (ctx: any) => rej(new Error(ctx?.connection?.error?.description || 'connection refused')));
      container.once('disconnected', (ctx: any) => rej(new Error(ctx?.error?.message || 'disconnected')));
    }), 'AMQP');
    return `Connected to ${r.config.host}:${Number(r.config.port) || 5672} (AMQP 1.0)`;
  } finally { try { conn.close(); } catch { /* closed */ } }
}

// Publish message also returns the broker, connection and time it was sent.
for (const a of busActivities.filter(x => x.type === 'busPublish')) {
  const run = a.execute;
  a.execute = async c => {
    const r = (await run(c)) as any;
    const id = c.raw(c.raw('broker') === 'kafka' ? 'kafkaConn' : c.raw('broker') === 'rabbitmq' ? 'rabbitConn' : 'amqpConn');
    const res = id ? effectiveResource(id) : undefined;
    if (r?.out && typeof r.out === 'object') r.out = { ...r.out, broker: c.raw('broker'), connection: res?.name ?? '', sentAt: new Date().toISOString() };
    return r;
  };
  a.outputHint = { ...a.outputHint, broker: '', connection: '', sentAt: '' };
}
