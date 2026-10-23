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
import { q } from '../db.js';
import { resolve } from '../template.js';

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

/** ActiveMQ's JMS transformer qualifies Destination values on the AMQP wire. */
export const logicalJmsDestination = (value: unknown) =>
  typeof value === 'string' ? value.replace(/^(?:queue|topic):\/\//, '') : value;

// ---------- clients ----------
export function kafkaTlsOptions(c: Record<string, any>, secret: Secret) {
  if (!c.ssl) return false;
  const ca = String(c.caPem || '').trim();
  const cert = String(c.clientCertPem || '').trim();
  const keyName = String(c.clientKeySecret || '').trim();
  const passphraseName = String(c.clientKeyPassphraseSecret || '').trim();
  if (!ca && !cert && !keyName && !passphraseName) return true;
  if (!!cert !== !!keyName) throw new Error('Kafka mutual TLS needs both Client certificate and Client private key');
  return {
    rejectUnauthorized: true,
    ...(ca ? { ca: [ca] } : {}),
    ...(cert ? { cert: [cert], key: secret(keyName, 'Kafka client private key') } : {}),
    ...(passphraseName ? { passphrase: secret(passphraseName, 'Kafka client key passphrase') } : {}),
  };
}

export function brokerTlsOptions(c: Record<string, any>, secret: Secret, broker: string) {
  const ca = String(c.caPem || '').trim();
  const cert = String(c.clientCertPem || '').trim();
  const keyName = String(c.clientKeySecret || '').trim();
  const passphraseName = String(c.clientKeyPassphraseSecret || '').trim();
  if (!!cert !== !!keyName) throw new Error(`${broker} mutual TLS needs both Client certificate and Client private key`);
  return {
    rejectUnauthorized: true,
    ...(ca ? { ca: [ca] } : {}),
    ...(cert ? { cert, key: secret(keyName, `${broker} client private key`) } : {}),
    ...(passphraseName ? { passphrase: secret(passphraseName, `${broker} client key passphrase`) } : {}),
  };
}

function kafkaClient(r: Resource, secret: Secret) {
  const { Kafka, logLevel } = require('kafkajs');
  const c = r.config;
  return new Kafka({
    clientId: c.clientId || 'sutraflow', brokers: c.brokers, ssl: kafkaTlsOptions(c, secret), logLevel: logLevel.NOTHING,
    sasl: c.sasl && c.sasl !== 'none' ? { mechanism: c.sasl, username: c.user, password: secret(c.passwordSecret, 'Kafka password') } : undefined,
  });
}
function rabbitConnection(r: Resource, secret: Secret) {
  const u = new URL(r.config.url || 'amqp://localhost:5672/');
  if (r.config.user) { u.username = encodeURIComponent(r.config.user); u.password = encodeURIComponent(r.config.passwordSecret ? secret(r.config.passwordSecret, 'RabbitMQ password') : ''); }
  if (r.config.vhost && r.config.vhost !== '/') u.pathname = '/' + encodeURIComponent(r.config.vhost);
  return { url: u.toString(), socket: u.protocol === 'amqps:' ? brokerTlsOptions(r.config, secret, 'RabbitMQ') : undefined };
}
function amqpConnect(r: Resource, secret: Secret, reconnect = true, role = 'connection') {
  const rhea = require('rhea');
  // ActiveMQ uses the AMQP container id as a client id and refuses two live
  // connections with the same value. The resource value is therefore a prefix,
  // not the complete id: publishers, tests and each deployed listener get their
  // own identity. Listener roles are stable so durable subscriptions survive a
  // reconnect and leader restart.
  const base = String(r.config.containerId || 'sutraflow').replace(/[^A-Za-z0-9_.-]/g, '-');
  const suffix = String(role).replace(/[^A-Za-z0-9_.-]/g, '-');
  const container = rhea.create_container({ id: `${base}-${suffix}` });
  // Rhea raises an uncaught exception when a broker rejects a reconnect and no
  // connection_error listener exists. Disconnection is reported to the caller
  // below; this listener makes a transient duplicate-client rejection during a
  // fast durable-listener replacement non-fatal to the engine process.
  container.on('connection_error', () => {});
  const conn = container.connect({
    host: r.config.host, port: Number(r.config.port) || 5672, transport: r.config.tls ? 'tls' : 'tcp',
    username: r.config.user || undefined, password: r.config.passwordSecret ? secret(r.config.passwordSecret, 'AMQP password') : undefined,
    ...(r.config.tls ? brokerTlsOptions(r.config, secret, 'AMQP 1.0') : {}),
    reconnect, initial_reconnect_delay: 500, max_reconnect_delay: 30000,
  });
  return { container, conn, rhea };
}

/** Stop reconnect timers before closing; otherwise a listener rebuild can race its old connection. */
async function closeAmqpConnection(conn: any) {
  try { conn.set_reconnect?.(false); } catch { if (conn.options) conn.options.reconnect = false; }
  if (conn.scheduled_reconnect) {
    clearTimeout(conn.scheduled_reconnect);
    conn.scheduled_reconnect = undefined;
  }
  if (!conn.socket_ready && !conn.socket) return;
  await new Promise<void>(resolve => {
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      conn.removeListener?.('disconnected', done);
      resolve();
    };
    // A remote close frame arrives before the TCP socket is gone. Wait for the
    // disconnected event; otherwise a listener rebuild can reuse its durable
    // client id while ActiveMQ still considers the old socket live.
    const timer = setTimeout(() => {
      try { conn.abort_socket?.(conn.socket); } catch { /* already gone */ }
      setTimeout(done, 50);
    }, 1500);
    conn.once?.('disconnected', done);
    try { if (!conn.is_closed?.()) conn.close(); } catch { done(); }
  });
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
        const o = rabbitConnection(r, secret);
        const conn = await amqp.connect(o.url, o.socket);
        conn.on('close', () => producers.delete(key));
        return conn.createConfirmChannel();
      }
      const { conn } = amqpConnect(r, secret, true, `publisher-${process.pid}`);
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
      else await closeAmqpConnection(v.conn);
    } catch { /* best effort */ }
  }));
}

function bodyBytes(body: unknown, type: string): { buf: Buffer; contentType: string } {
  if (type === 'bytes') return { buf: Buffer.from(String(body ?? ''), 'base64'), contentType: 'application/octet-stream' };
  if (type === 'text') return { buf: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)), contentType: 'text/plain' };
  return { buf: Buffer.from(JSON.stringify(body ?? null)), contentType: 'application/json' };
}

// ---------- explicit acknowledgement (Confirm message) ----------
type AckDecision = 'confirm' | 'requeue' | 'reject';
interface PendingAck {
  confirm(): Promise<void> | void;
  requeue(): Promise<void> | void;
  reject(): Promise<void> | void;
  /** Set before the broker is settled so run completion can update the durable duplicate guard correctly. */
  decision?: AckDecision;
}
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
      if (!sender) {
        sender = pub.conn.open_sender(address);
        // Each concurrent publish temporarily installs outcome listeners. This is
        // expected up to the configured activity concurrency, not a leak.
        sender.setMaxListeners?.(0);
        pub.senders.set(address, sender);
      }
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
    type: 'busSubscribe', palette: 'bus', name: 'Queue / topic trigger', glyph: '⇩', trigger: true, ports: ['out'],
    desc: 'Subscribes to Kafka, RabbitMQ or ActiveMQ and starts the Sutra for each queue or topic message while deployed. Gives the body, JMS headers and custom properties. Acknowledge automatically, after the Sutra succeeds, or with a Confirm message activity.',
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
      F('deduplicate', 'Avoid duplicate runs', 'select', 'on', { options: ['on', 'off'], help: 'On remembers each message by the Kafka topic/partition/offset, or the RabbitMQ / AMQP message id, so a message delivered again (after a leader change or a reconnect) never starts a second run. While the first run is still going, the copy is held unacknowledged and settled when that run ends.' }),
      F('duplicateKey', 'Duplicate key', 'text', '', { ...when('deduplicate', 'on'), help: 'For messages without a message id (many RabbitMQ publishers send none): a value that is unique per message, for example {{body.orderId}} or {{headers.correlationId}}. Empty = message id only.' }),
      F('withoutId', 'Messages without an id', 'select', 'process', { options: ['process', 'reject (dead-letter)'], ...when('deduplicate', 'on'), help: 'A message with no message id and no Duplicate key cannot be recognised if it is delivered again. Process runs it anyway (no duplicate protection). Reject sends it to the dead-letter queue of the broker (client and explicit acknowledgement). Kafka messages always have an identity.' }),
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
    desc: 'Acknowledges the message that started this run (Queue / topic trigger with Acknowledge: explicit), or rejects / requeues it.',
    fields: [F('action', 'Action', 'select', 'confirm', { options: ['confirm', 'requeue', 'reject (dead-letter)'], help: 'confirm removes or commits the delivery; requeue asks for another delivery; reject does not return it to the source. Configure a broker dead-letter route if rejected messages must be retained.' })],
    outputHint: { confirmed: true, action: 'confirm' },
    passThrough: true,
    execute: async c => {
      const p = pending.get(c.runId);
      const a = c.raw('action') || 'confirm';
      if (!p) {
        if (c.scope.run?.source === 'test' || c.scope.run?.source === 'debug') { c.log('info', 'Test run: no message to confirm'); return { out: c.input }; }
        throw new Error('This run was not started by a Queue / topic trigger with Acknowledge: explicit, or the message was already confirmed');
      }
      // Record the decision before settling. A very fast broker callback can let the run
      // finish immediately after this await, and completion must still know whether this
      // delivery was terminal (confirm/reject) or intentionally returned (requeue).
      p.decision = a === 'confirm' ? 'confirm' : a === 'requeue' ? 'requeue' : 'reject';
      if (p.decision === 'confirm') await p.confirm(); else if (p.decision === 'requeue') await p.requeue(); else await p.reject();
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

/** Timings of held duplicate deliveries; tests shorten them. */
export const busTiming = { holdPollMs: 2000 };

/**
 * A copy of a message whose first run is still going. A broker that can keep it unacknowledged
 * (RabbitMQ, AMQP 1.0) gets one more delivery slot meanwhile (grow), so other messages keep flowing,
 * and the copy is settled when the run ends: done = acknowledged, failed = returned for a new run.
 * Nothing is redelivered while the run waits, however long an approval takes, so the broker's
 * delivery count (ActiveMQ redelivery limit, RabbitMQ quorum delivery-limit) does not climb.
 */
export interface HoldSlot { grow(): void; shrink(): void }
const held = new WeakMap<ListenerContext, Set<NodeJS.Timeout>>();
export function stopHolds(c: ListenerContext) { for (const t of held.get(c) || []) clearInterval(t); held.delete(c); }
function holdUntilDone(c: ListenerContext, key: string, runId: string, settle: { ack(): any; requeue(): any }, slot: HoldSlot) {
  const timers = held.get(c) ?? new Set<NodeJS.Timeout>();
  held.set(c, timers);
  slot.grow();
  c.status('ok', `A message delivered again is held while run ${runId.slice(0, 8)} finishes; it is settled when that run ends`);
  const timer = setInterval(() => {
    const run = q.get<{ status: string }>('select status from runs where id = ?', runId);
    const status = run?.status;
    if (status && !['done', 'failed', 'cancelled'].includes(status)) return;
    clearInterval(timer); timers.delete(timer); slot.shrink();
    const finish = async () => {
      if (status === 'done') {
        q.run(`update bus_messages set status = 'done', updated_at = ? where flow_id = ? and node_id = ? and message_key = ?`, Date.now(), c.flowId, c.node.id, key);
        await settle.ack();
      } else {
        // The first run failed or was cancelled: the message goes back and starts a new run.
        q.run('delete from bus_messages where flow_id = ? and node_id = ? and message_key = ? and run_id = ?', c.flowId, c.node.id, key, runId);
        await settle.requeue();
      }
    };
    finish().catch(e => c.status('error', `Could not settle a held message: ${e.message}`));
  }, busTiming.holdPollMs);
  timer.unref?.();
  timers.add(timer);
}

/** Runs the flow for one message and settles it according to the acknowledge mode. */
export async function priorDelivery(c: ListenerContext, key: string, settle: { ack(): any; requeue(why?: string): any; hold?: HoldSlot }): Promise<boolean> {
  const old = q.get<{ run_id: string; status: string }>('select run_id, status from bus_messages where flow_id = ? and node_id = ? and message_key = ?', c.flowId, c.node.id, key);
  if (!old) return false;
  if (old.status === 'done') { await settle.ack(); return true; }
  const run = q.get<{ status: string }>('select status from runs where id = ?', old.run_id);
  if (!run || ['failed', 'cancelled'].includes(run.status)) {
    q.run('delete from bus_messages where flow_id = ? and node_id = ? and message_key = ?', c.flowId, c.node.id, key);
    return false;
  }
  if (run.status === 'done') {
    q.run(`update bus_messages set status = 'done', updated_at = ? where flow_id = ? and node_id = ? and message_key = ?`, Date.now(), c.flowId, c.node.id, key);
    await settle.ack();
    return true;
  }
  // The durable run is still active (possibly waiting for an approval): never a second run.
  if (settle.hold) holdUntilDone(c, key, old.run_id, settle, settle.hold);
  else await settle.requeue('duplicate');   // Kafka: the partition pauses and checks again
  return true;
}

/** The identity that recognises a message delivered again: the broker's, else the Duplicate key. */
export function messageKey(cfg: Record<string, any>, input: Record<string, any>, identity: string) {
  if (cfg.deduplicate === 'off') return '';
  if (identity) return identity;
  const custom = String(cfg.duplicateKey || '').trim();
  if (!custom) return '';
  const value = resolve(custom, input);
  return value === undefined || value === null || String(value) === '' ? '' : `key:${typeof value === 'object' ? JSON.stringify(value) : String(value)}`;
}

export function handle(c: ListenerContext, cfg: Record<string, any>, input: Record<string, any>, settle: { ack(): any; requeue(why?: string): any; reject(): any; hold?: HoldSlot }, deliveryCount: number, identity = '') {
  const mode = cfg.ackMode === 'auto' || cfg.ackMode === 'on receipt' ? 'auto' : cfg.ackMode === 'explicit' ? 'explicit' : 'client';
  const max = Number(cfg.maxRedeliveries) || 0;
  const fail = () => (cfg.onFailure === 'reject (dead-letter)' || (max && deliveryCount >= max) ? settle.reject() : settle.requeue());
  const key = messageKey(cfg, input, identity);
  if (!key && cfg.deduplicate !== 'off' && cfg.withoutId === 'reject (dead-letter)' && mode !== 'auto') {
    c.status('error', 'A message without a message id or Duplicate key was rejected (dead-letter), as set under Messages without an id');
    return Promise.resolve(settle.reject()).then(() => {}, e => c.status('error', `Could not reject the message: ${e.message}`));
  }
  if (mode === 'auto') { c.fire(input).catch(e => c.status('error', e.message)); return Promise.resolve(); }
  return new Promise<void>(resolve => { void (async () => {
    if (key && await priorDelivery(c, key, settle)) { resolve(); return; }
    const reservedRun = crypto.randomUUID();
    if (key) {
      const claimed = q.run('insert into bus_messages(flow_id, node_id, message_key, run_id, status, updated_at) values(?, ?, ?, ?, ?, ?) on conflict(flow_id, node_id, message_key) do nothing', c.flowId, c.node.id, key, reservedRun, 'running', Date.now());
      if (!claimed.changes && await priorDelivery(c, key, settle)) { resolve(); return; }
    }
    // The entry exists before the run starts: a run can end before its start has returned the id.
    const entry: PendingAck | null = mode === 'explicit' ? { confirm: settle.ack, requeue: settle.requeue, reject: settle.reject } : null;
    // The engine is given the reserved id, so expose the acknowledgement handle before
    // starting it. A one-step Sutra can otherwise reach Confirm message before
    // startRun() resolves and incorrectly report that there is no message to confirm.
    let runId: string = reservedRun;
    if (entry) pending.set(reservedRun, entry);
    c.fire(input, status => {
      Promise.resolve().then(async () => {
        const explicitTerminal = entry?.decision === 'confirm' || entry?.decision === 'reject';
        if (key && (mode === 'explicit' ? explicitTerminal : status === 'done')) q.run(`update bus_messages set status = 'done', updated_at = ? where flow_id = ? and node_id = ? and message_key = ?`, Date.now(), c.flowId, c.node.id, key);
        else if (key) q.run('delete from bus_messages where flow_id = ? and node_id = ? and message_key = ?', c.flowId, c.node.id, key);
        if (mode === 'explicit') {
          if (entry && !entry.decision) {
            if (runId) pending.delete(runId);
            await fail();
            if (status === 'done') c.status('error', 'A run finished without Confirm message; the message was redelivered');
          }
        } else if (status === 'done') await settle.ack();
        else await fail();
      }).catch(e => c.status('error', `Acknowledgement failed: ${e.message}`)).finally(resolve);
    }, reservedRun).then(id => {
      if (!id) {
        if (entry) pending.delete(reservedRun);
        if (key) q.run('delete from bus_messages where flow_id = ? and node_id = ? and message_key = ?', c.flowId, c.node.id, key);
        c.status('error', 'The Sutra did not start; the message will be delivered again');
        Promise.resolve(fail()).catch(e => c.status('error', `Could not release the message: ${e.message}`)).finally(resolve);
        return;
      }
      runId = id;
      if (entry && !entry.decision) pending.set(id, entry);
    }, e => {
      c.status('error', `The Sutra did not start: ${e.message}`);
      if (entry) pending.delete(reservedRun);
      if (key) q.run('delete from bus_messages where flow_id = ? and node_id = ? and message_key = ?', c.flowId, c.node.id, key);
      Promise.resolve(fail()).catch(() => {}).finally(resolve);
    });
  })().catch(e => { c.status('error', `Message delivery guard failed: ${e.message}`); Promise.resolve(fail()).catch(() => {}).finally(resolve); }); });
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
    const deliveryAttempts = new Map<string, number>();
    await consumer.connect();
    await consumer.subscribe({ topic: dest, fromBeginning: !!cfg.fromBeginning });
    let readyTimer: NodeJS.Timeout | undefined;
    const ready = new Promise<void>((resolve, reject) => {
      let joined = false; let fetching = false;
      const done = () => {
        if (!joined || !fetching) return;
        if (readyTimer) clearTimeout(readyTimer);
        offJoin(); offFetch(); resolve();
      };
      const offJoin = consumer.on(consumer.events.GROUP_JOIN, () => { joined = true; done(); });
      // GROUP_JOIN precedes offset initialisation. Publishing before the first fetch
      // response can be treated as pre-existing data for a new group with
      // fromBeginning=false. FETCH means the initial broker round trip is complete;
      // only then is the deployed trigger genuinely ready for new messages.
      const offFetch = consumer.on(consumer.events.FETCH, () => { fetching = true; done(); });
      readyTimer = setTimeout(() => { offJoin(); offFetch(); reject(new Error(`Timed out starting Kafka consumer group ${cfg.groupId || 'sutraflow'}`)); }, 30000);
      readyTimer.unref?.();
    });
    await consumer.run({
      autoCommit: auto,
      partitionsConsumedConcurrently: n,
      eachMessage: async ({ topic, partition, message, pause }: any) => {
        const headers = Object.fromEntries(Object.entries(message.headers || {}).map(([k, v]: any) => [k, v?.toString()]));
        const { messageId, correlationId, replyTo, type: jt, contentType, ...props } = headers as Record<string, string>;
        const attemptKey = `${topic}:${partition}:${message.offset}`;
        const count = (deliveryAttempts.get(attemptKey) || 0) + 1;
        const input = { body: decodeBody(message.value, type), properties: props, destination: topic, key: message.key?.toString(), partition, offset: message.offset,
          headers: { messageId, correlationId, replyTo, type: jt, contentType, timestamp: new Date(Number(message.timestamp)).toISOString(), redelivered: count > 1, deliveryCount: count } };
        let requeued: string | false = false;
        const commit = () => consumer.commitOffsets([{ topic, partition, offset: (BigInt(message.offset) + 1n).toString() }]);
        await handle(c, cfg, input, { ack: commit, reject: commit, requeue: (why?: string) => { requeued = why || 'failed'; } }, count, `kafka:${topic}:${partition}:${message.offset}`);
        if (requeued) {
          if (requeued !== 'duplicate') deliveryAttempts.set(attemptKey, count);
          const resume = pause(); setTimeout(resume, 5000);
          throw new Error(requeued === 'duplicate' ? `Offset ${message.offset} is still being handled by an earlier run; partition ${partition} checks again in 5 seconds` : 'Sutra failed; the message will be processed again');
        }
        deliveryAttempts.delete(attemptKey);
      },
    });
    await ready;
    c.status('ok', `Consuming ${dest} as ${cfg.groupId}`);
    return () => { stopHolds(c); return consumer.disconnect(); };
  }

  if (b === 'rabbitmq') {
    const amqp = require('amqplib');
    const o = rabbitConnection(r, secret);
    const conn = await amqp.connect(o.url, o.socket);
    const ch = await conn.createChannel();
    let queue = dest;
    if (cfg.destinationType === 'topic') {
      // A topic is a binding on amq.topic: durable name = durable queue, otherwise a temporary one.
      const q = await ch.assertQueue(cfg.durableName || '', { durable: !!cfg.durableName, exclusive: !cfg.durableName, autoDelete: !cfg.durableName });
      await ch.bindQueue(q.queue, 'amq.topic', dest);
      queue = q.queue;
    } else if (cfg.declare) await ch.assertQueue(queue, { durable: true });
    await ch.prefetch(n);
    let extra = 0;
    // RabbitMQ's x-death header is added by dead-lettering, not by an ordinary
    // basic.nack(requeue=true). Count those in-place retries ourselves so the
    // delivery ceiling works for classic queues too. After a listener restart,
    // the broker's redelivered flag provides the conservative second attempt.
    const deliveryAttempts = new Map<string, number>();
    const hold: HoldSlot = {
      grow: () => { extra++; ch.prefetch(n + extra).catch(() => {}); },
      shrink: () => { extra = Math.max(0, extra - 1); ch.prefetch(n + extra).catch(() => {}); },
    };
    await ch.consume(queue, async (msg: any) => {
      if (!msg) return;
      const p = msg.properties;
      const deaths = Array.isArray(p.headers?.['x-death']) ? p.headers['x-death'].reduce((a: number, d: any) => a + (Number(d.count) || 0), 0) : 0;
      const identity = p.messageId ? `rabbitmq:${dest}:${p.messageId}` : '';
      const attemptKey = identity || `${msg.fields.exchange}:${msg.fields.routingKey}:${msg.fields.deliveryTag}`;
      const prior = deliveryAttempts.get(attemptKey) || 0;
      const count = Math.max(deaths + 1, prior + 1, msg.fields.redelivered ? 2 : 1);
      deliveryAttempts.set(attemptKey, count);
      const input = { body: decodeBody(msg.content, type), properties: Object.fromEntries(Object.entries(p.headers || {}).filter(([k]) => !k.startsWith('x-'))), destination: dest, routingKey: msg.fields.routingKey,
        headers: { messageId: p.messageId, correlationId: p.correlationId, replyTo: p.replyTo, type: p.type, priority: p.priority, deliveryMode: p.deliveryMode === 2 ? 'persistent' : 'non-persistent', timestamp: p.timestamp ? new Date(p.timestamp * 1000).toISOString() : undefined, expiration: p.expiration, contentType: p.contentType, redelivered: msg.fields.redelivered, deliveryCount: count } };
      await handle(c, cfg, input, {
        ack: () => { deliveryAttempts.delete(attemptKey); ch.ack(msg); },
        requeue: () => ch.nack(msg, false, true),
        reject: () => { deliveryAttempts.delete(attemptKey); ch.nack(msg, false, false); },
        hold,
      }, count, identity);
    }, { noAck: auto });
    c.status('ok', `Consuming ${cfg.destinationType === 'topic' ? 'topic' : 'queue'} ${dest}`);
    return async () => { stopHolds(c); await ch.close().catch(() => {}); await conn.close().catch(() => {}); };
  }

  const { conn, rhea } = amqpConnect(r, secret, true, `listener-${c.flowId}-${c.node.id}`);
  const source: any = { address: amqpAddress(r, cfg.destinationType, dest) };
  if (cfg.selector) source.filter = rhea.filter.selector(cfg.selector);
  if (cfg.durableName && cfg.destinationType === 'topic') { source.durable = 2; source.expiry_policy = 'never'; }
  const receiver = conn.open_receiver({ source, name: cfg.durableName || undefined, autoaccept: auto, credit_window: n });
  receiver.on('message', async (ctx: any) => {
    const m = ctx.message;
    const raw = m.body && typeof m.body === 'object' && m.body.typecode === 0x75 ? m.body.content : m.body;
    const count = (m.delivery_count ?? 0) + 1;
    const input = { body: decodeBody(raw, type), properties: m.application_properties || {}, destination: dest,
      headers: { messageId: m.message_id, correlationId: m.correlation_id, replyTo: logicalJmsDestination(m.reply_to), type: m.subject, priority: m.priority, deliveryMode: m.durable ? 'persistent' : 'non-persistent', timestamp: m.creation_time ? new Date(m.creation_time).toISOString() : undefined, expiration: m.absolute_expiry_time, contentType: m.content_type, redelivered: count > 1, deliveryCount: count } };
    await handle(c, cfg, input, {
      ack: () => ctx.delivery.accept(),
      // A failed run counts as a failed delivery (the broker's redelivery limit applies); a copy
      // returned because its first run was cancelled is a plain release, not counted.
      requeue: (why?: string) => ctx.delivery.release(why === 'duplicate' ? {} : { delivery_failed: true }),
      hold: { grow: () => receiver.add_credit(1), shrink: () => {} },
      reject: () => ctx.delivery.reject({ condition: 'sutra:flow-failed', description: 'Sutra failed' }),
    }, count, m.message_id ? `amqp1:${source.address}:${m.message_id}` : '');
  });
  conn.on('connection_open', () => c.status('ok', `Receiving from ${source.address}${cfg.selector ? ` where ${cfg.selector}` : ''}`));
  conn.on('disconnected', (ctx: any) => c.status('error', `Disconnected: ${ctx?.error?.message || 'broker not reachable'}; reconnecting`));
  // Do not let the listener registry announce "Listening" merely because the
  // asynchronous connection attempt was started. Deployment/rebuild completes
  // only after ActiveMQ has accepted the receiver link, so an immediately
  // arriving message cannot sit queued behind a listener that is not ready yet.
  await new Promise<void>((res, rej) => {
    const done = (error?: Error) => {
      clearTimeout(timer);
      receiver.removeListener('receiver_open', opened);
      conn.removeListener('connection_error', failed);
      conn.removeListener('disconnected', failed);
      error ? rej(error) : res();
    };
    const opened = () => done();
    const failed = (ctx: any) => done(new Error(ctx?.connection?.error?.description || ctx?.error?.message || 'AMQP broker not reachable'));
    const timer = setTimeout(() => done(new Error('AMQP receiver did not open within 15 seconds')), 15000);
    receiver.once('receiver_open', opened);
    conn.once('connection_error', failed);
    conn.once('disconnected', failed);
  });
  return async () => { stopHolds(c); await closeAmqpConnection(conn); };
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
    const o = rabbitConnection(r, secret);
    const conn = await within(amqplib.connect(o.url, o.socket), 'RabbitMQ') as any;
    await conn.close().catch(() => {});
    return `Connected to RabbitMQ at ${new URL(r.config.url || 'amqp://localhost:5672/').host}`;
  }
  const { container, conn } = amqpConnect(r, secret, false, `test-${crypto.randomUUID()}`);
  try {
    await within(new Promise<void>((res, rej) => {
      container.once('connection_open', () => res());
      container.once('connection_error', (ctx: any) => rej(new Error(ctx?.connection?.error?.description || 'connection refused')));
      container.once('disconnected', (ctx: any) => rej(new Error(ctx?.error?.message || 'disconnected')));
    }), 'AMQP');
    return `Connected to ${r.config.host}:${Number(r.config.port) || 5672} (AMQP 1.0)`;
  } finally { await closeAmqpConnection(conn); }
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
