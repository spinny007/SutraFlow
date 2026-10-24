/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { Agent, request } from 'undici';
import { testEnv } from './helpers.js';

const require = createRequire(import.meta.url);
const enabled = process.env.SUTRA_BROKER_REST_TEST === '1';
if (enabled) testEnv(22840);
const basic = (user: string, password: string) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
const json = async (url: string, init: any = {}) => {
  const r = await request(url, init);
  const text = await r.body.text();
  assert.ok(r.statusCode >= 200 && r.statusCode < 300, `${init.method || 'GET'} ${new URL(url).pathname}: ${r.statusCode} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
};

test('RabbitMQ management REST publishes, fetches with acknowledgement, and cleans up', { skip: enabled ? false : 'set SUTRA_BROKER_REST_TEST=1' }, async () => {
  const base = process.env.SUTRA_RABBIT_REST_URL || 'http://127.0.0.1:15672';
  const auth = basic(process.env.SUTRA_RABBIT_REST_USER || 'guest', process.env.SUTRA_RABBIT_REST_PASSWORD || 'guest');
  const queue = `sutraflow-rest-${crypto.randomUUID()}`;
  const path = `/api/queues/%2F/${encodeURIComponent(queue)}`;
  const headers = { authorization: auth, 'content-type': 'application/json' };
  try {
    await json(base + path, { method: 'PUT', headers, body: JSON.stringify({ durable: true, auto_delete: false, arguments: {} }) });
    const payload = JSON.stringify({ orderId: 'R-REST-1' });
    const published = await json(base + '/api/exchanges/%2F/amq.default/publish', { method: 'POST', headers, body: JSON.stringify({ properties: { content_type: 'application/json', message_id: crypto.randomUUID(), delivery_mode: 2 }, routing_key: queue, payload, payload_encoding: 'string' }) });
    assert.equal(published.routed, true);
    const messages = await json(base + path + '/get', { method: 'POST', headers, body: JSON.stringify({ count: 1, ackmode: 'ack_requeue_false', encoding: 'auto', truncate: 50000 }) });
    assert.equal(messages.length, 1); assert.equal(JSON.parse(messages[0].payload).orderId, 'R-REST-1');
  } finally {
    await request(base + path, { method: 'DELETE', headers }).then(r => r.body.dump()).catch(() => {});
  }
});

test('ActiveMQ Jolokia REST creates, publishes, browses, removes and cleans up', { skip: enabled ? false : 'set SUTRA_BROKER_REST_TEST=1' }, async () => {
  const base = process.env.SUTRA_ACTIVEMQ_REST_URL || 'http://localhost:8161';
  const brokerName = process.env.SUTRA_ACTIVEMQ_BROKER_NAME || 'localhost';
  const queue = `sutraflow.rest.${crypto.randomUUID()}`;
  const broker = `org.apache.activemq:type=Broker,brokerName=${brokerName}`;
  const destination = `${broker},destinationType=Queue,destinationName=${queue}`;
  const headers = { authorization: basic(process.env.SUTRA_ACTIVEMQ_REST_USER || 'admin', process.env.SUTRA_ACTIVEMQ_REST_PASSWORD || 'admin'), origin: process.env.SUTRA_ACTIVEMQ_REST_ORIGIN || 'http://localhost:8161', 'content-type': 'application/json' };
  const exec = (mbean: string, operation: string, args: unknown[]) => json(base + '/api/jolokia/', { method: 'POST', headers, body: JSON.stringify({ type: 'exec', mbean, operation, arguments: args }) });
  try {
    await exec(broker, 'addQueue(java.lang.String)', [queue]);
    const sent = await exec(destination, 'sendTextMessage(java.lang.String)', [JSON.stringify({ orderId: 'A-REST-1' })]);
    assert.match(sent.value, /^ID:/);
    const browsed = await exec(destination, 'browse()', []);
    assert.equal(browsed.value.length, 1); assert.equal(browsed.value[0].Text, JSON.stringify({ orderId: 'A-REST-1' }));
    const removed = await exec(destination, 'removeMessage(java.lang.String)', [browsed.value[0].JMSMessageID]);
    assert.equal(removed.value, true);
  } finally {
    await exec(broker, 'removeQueue(java.lang.String)', [queue]).catch(() => {});
  }
});

const kafkaEnabled = enabled && !!process.env.SUTRA_KAFKA_REST_URL && !!process.env.SUTRA_KAFKA_BROKERS;
test('Kafka REST publishes and completes create-subscribe-poll-commit-close lifecycle', { skip: kafkaEnabled ? false : 'set Kafka REST and broker test variables' }, async () => {
  const base = process.env.SUTRA_KAFKA_REST_URL!.replace(/\/+$/, '');
  const user = process.env.SUTRA_KAFKA_REST_USER || '';
  const password = process.env.SUTRA_KAFKA_REST_PASSWORD || '';
  const restCa = process.env.SUTRA_KAFKA_REST_CA_FILE ? fs.readFileSync(process.env.SUTRA_KAFKA_REST_CA_FILE, 'utf8') : undefined;
  const dispatcher = new Agent({ connect: { rejectUnauthorized: true, ...(restCa ? { ca: restCa } : {}) } });
  const headers = { authorization: basic(user, password), 'content-type': 'application/vnd.kafka.v2+json', accept: 'application/vnd.kafka.v2+json' };
  const call = (path: string, init: any = {}) => json(/^https?:/i.test(path) ? path : base + path, { dispatcher, ...init, headers: { ...headers, ...(init.headers || {}) } });
  const topic = `sutraflow-rest-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const group = `${topic}-group`; const instance = `${topic}-consumer`;
  const brokers = process.env.SUTRA_KAFKA_BROKERS!.split(',').map(x => x.trim()).filter(Boolean);
  const kafkaCa = process.env.SUTRA_KAFKA_CA_FILE ? fs.readFileSync(process.env.SUTRA_KAFKA_CA_FILE, 'utf8') : undefined;
  const clientCert = process.env.SUTRA_KAFKA_CLIENT_CERT_FILE ? fs.readFileSync(process.env.SUTRA_KAFKA_CLIENT_CERT_FILE, 'utf8') : '';
  const clientKey = process.env.SUTRA_KAFKA_CLIENT_KEY_FILE ? fs.readFileSync(process.env.SUTRA_KAFKA_CLIENT_KEY_FILE, 'utf8') : '';
  const { Kafka, logLevel } = require('kafkajs');
  const ssl = { rejectUnauthorized: true, ...(kafkaCa ? { ca: [kafkaCa] } : {}), ...(clientCert && clientKey ? { cert: [clientCert], key: clientKey } : {}) };
  const saslPassword = process.env.SUTRA_KAFKA_PASSWORD || '';
  const kafka = new Kafka({ clientId: topic, brokers, ssl, logLevel: logLevel.NOTHING, sasl: saslPassword ? { mechanism: process.env.SUTRA_KAFKA_SASL || 'plain', username: process.env.SUTRA_KAFKA_USER || '', password: saslPassword } : undefined });
  const admin = kafka.admin(); let consumerUri = '';
  await admin.connect();
  try {
    await admin.createTopics({ waitForLeaders: true, topics: [{ topic, numPartitions: 2, replicationFactor: Number(process.env.SUTRA_KAFKA_REPLICATION || 2) }] });
    const first = await call(`/topics/${encodeURIComponent(topic)}`, { method: 'POST', headers: { 'content-type': 'application/vnd.kafka.json.v2+json' }, body: JSON.stringify({ records: [{ value: { orderId: 'K-REST-PUBLISH' } }] }) });
    assert.equal(first.offsets.length, 1); assert.equal(first.offsets[0].error_code ?? null, null);
    const made = await call(`/consumers/${encodeURIComponent(group)}`, { method: 'POST', body: JSON.stringify({ name: instance, format: 'json', 'auto.offset.reset': 'earliest', 'auto.commit.enable': 'false' }) });
    consumerUri = made.base_uri;
    await call(consumerUri + '/subscription', { method: 'POST', body: JSON.stringify({ topics: [topic] }) });
    await call(`/topics/${encodeURIComponent(topic)}`, { method: 'POST', headers: { 'content-type': 'application/vnd.kafka.json.v2+json' }, body: JSON.stringify({ records: [{ value: { orderId: 'K-REST-SUBSCRIBE' } }] }) });
    let records: any[] = [];
    for (let i = 0; i < 4 && !records.some(x => x.value?.orderId === 'K-REST-SUBSCRIBE'); i++) records.push(...await call(consumerUri + '/records?timeout=10000&max_bytes=1048576', { method: 'GET', headers: { accept: 'application/vnd.kafka.json.v2+json' } }));
    assert.ok(records.some(x => x.value?.orderId === 'K-REST-SUBSCRIBE'));
    await call(consumerUri + '/offsets', { method: 'POST', body: '{}' });
    await call(consumerUri, { method: 'DELETE' }); consumerUri = '';
  } finally {
    if (consumerUri) await call(consumerUri, { method: 'DELETE' }).catch(() => {});
    await admin.deleteTopics({ topics: [topic] }).catch(() => {}); await admin.disconnect().catch(() => {}); await dispatcher.close();
  }
});

test('generated RabbitMQ, ActiveMQ and Kafka REST sample Sutras execute', { skip: enabled ? false : 'set SUTRA_BROKER_REST_TEST=1' }, async () => {
  const { boot } = await import('../server/src/index.js');
  const { engine } = await import('../server/src/engine/engine.js');
  const { q } = await import('../server/src/db.js');
  const flows = await import('../server/src/flows.js');
  const projects = await import('../server/src/projects.js');
  const { addSamples } = await import('../server/src/samples.js');
  const { setSecret } = await import('../server/src/secrets.js');
  const variables: any[] = [
    { name: 'RABBITMQ_HTTP_URL', type: 'string', value: process.env.SUTRA_RABBIT_REST_URL || 'http://127.0.0.1:15672' },
    { name: 'RABBITMQ_HTTP_USER', type: 'string', value: process.env.SUTRA_RABBIT_REST_USER || 'guest' },
    { name: 'RABBITMQ_HTTP_PASSWORD_SECRET', type: 'string', value: 'REST_SAMPLE_RABBIT_PASSWORD' },
    { name: 'ACTIVEMQ_REST_URL', type: 'string', value: process.env.SUTRA_ACTIVEMQ_REST_URL || 'http://localhost:8161' },
    { name: 'ACTIVEMQ_REST_ORIGIN', type: 'string', value: process.env.SUTRA_ACTIVEMQ_REST_ORIGIN || 'http://localhost:8161' },
    { name: 'ACTIVEMQ_REST_USER', type: 'string', value: process.env.SUTRA_ACTIVEMQ_REST_USER || 'admin' },
    { name: 'ACTIVEMQ_REST_PASSWORD_SECRET', type: 'string', value: 'REST_SAMPLE_ACTIVEMQ_PASSWORD' },
  ];
  if (kafkaEnabled) variables.push(
    { name: 'KAFKA_REST_URL', type: 'string', value: process.env.SUTRA_KAFKA_REST_URL },
    { name: 'KAFKA_REST_USER', type: 'string', value: process.env.SUTRA_KAFKA_REST_USER || '' },
    { name: 'KAFKA_REST_PASSWORD_SECRET', type: 'string', value: 'REST_SAMPLE_KAFKA_PASSWORD' },
    { name: 'KAFKA_REST_CA_PEM', type: 'string', value: '' },
  );
  const srv = await boot({ listenAdmin: false });
  let admin: any; let topic = '';
  try {
    const projectId = projects.saveProject({ name: `Broker REST samples ${Date.now()}`, config: { variables } }).id;
    setSecret('REST_SAMPLE_RABBIT_PASSWORD', process.env.SUTRA_RABBIT_REST_PASSWORD || 'guest');
    setSecret('REST_SAMPLE_ACTIVEMQ_PASSWORD', process.env.SUTRA_ACTIVEMQ_REST_PASSWORD || 'admin');
    if (kafkaEnabled) setSecret('REST_SAMPLE_KAFKA_PASSWORD', process.env.SUTRA_KAFKA_REST_PASSWORD || '');
    addSamples(projectId, ['brokerrest']);
    if (kafkaEnabled) {
      topic = `sutraflow-rest-sample-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
      const brokers = process.env.SUTRA_KAFKA_BROKERS!.split(',').map(x => x.trim()).filter(Boolean);
      const kafkaCa = process.env.SUTRA_KAFKA_CA_FILE ? fs.readFileSync(process.env.SUTRA_KAFKA_CA_FILE, 'utf8') : undefined;
      const { Kafka, logLevel } = require('kafkajs');
      const kafka = new Kafka({ clientId: topic, brokers, ssl: { rejectUnauthorized: true, ...(kafkaCa ? { ca: [kafkaCa] } : {}) }, logLevel: logLevel.NOTHING,
        sasl: process.env.SUTRA_KAFKA_PASSWORD ? { mechanism: process.env.SUTRA_KAFKA_SASL || 'plain', username: process.env.SUTRA_KAFKA_USER || '', password: process.env.SUTRA_KAFKA_PASSWORD } : undefined });
      admin = kafka.admin(); await admin.connect();
      await admin.createTopics({ waitForLeaders: true, topics: [{ topic, numPartitions: 2, replicationFactor: Number(process.env.SUTRA_KAFKA_REPLICATION || 2) }] });
    }
    const run = async (name: string) => {
      const summary = flows.listFlows(projectId).find(f => f.name === name); assert.ok(summary, name);
      const doc = structuredClone(flows.getFlow(summary.id)!.doc);
      if (topic) {
        const start = doc.nodes.find((n: any) => n.type === 'start');
        assert.ok(start, `${name}: manual start node`);
        const input = JSON.parse(start.config.payload); input.topic = topic; input.group = `${topic}-sample-group`; start.config.payload = JSON.stringify(input, null, 2);
      }
      const id = await engine.startRun({ doc, projectId }); await engine.waitFor(id, 90000, true);
      const row = q.get<any>('select status, error from runs where id = ?', id);
      assert.equal(row.status, 'done', `${name}: ${row.error || 'did not finish'}`);
    };
    await run('Sample: RabbitMQ HTTP publish and fetch');
    await run('Sample: ActiveMQ REST publish and fetch');
    if (kafkaEnabled) { await run('Sample: Kafka REST publish'); await run('Sample: Kafka REST subscribe'); }
  } finally {
    if (admin) { if (topic) await admin.deleteTopics({ topics: [topic] }).catch(() => {}); await admin.disconnect().catch(() => {}); }
    await srv.stop();
  }
});
