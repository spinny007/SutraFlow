/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { testEnv, node, edge } from './helpers.js';
import { readTestPem } from './pem-fixtures.js';

const require = createRequire(import.meta.url);
const password = process.env.SUTRA_RABBITMQ_PASSWORD || '';
const enabled = process.env.SUTRA_RABBITMQ_TEST === '1' && !!password;

if (!enabled) {
  test('RabbitMQ real-broker activity matrix', { skip: 'set SUTRA_RABBITMQ_TEST=1 and SUTRA_RABBITMQ_PASSWORD' }, () => {});
} else {
  testEnv(22820);
  const url = process.env.SUTRA_RABBITMQ_URL || 'amqp://localhost:5672/';
  const user = process.env.SUTRA_RABBITMQ_USER || 'guest';
  const read = readTestPem;
  const caPem = read('SUTRA_RABBITMQ_CA_FILE');
  const clientCertPem = read('SUTRA_RABBITMQ_CLIENT_CERT_FILE');
  const clientKey = read('SUTRA_RABBITMQ_CLIENT_KEY_FILE');
  const prefix = `sutra.test.${Date.now()}.${crypto.randomBytes(3).toString('hex')}`;

  const { boot } = await import('../server/src/index.js');
  const { engine, runState } = await import('../server/src/engine/engine.js');
  const { q } = await import('../server/src/db.js');
  const flows = await import('../server/src/flows.js');
  const projects = await import('../server/src/projects.js');
  const { setSecret } = await import('../server/src/secrets.js');
  const { saveResource } = await import('../server/src/resources.js');
  const { rebuildListeners, listenerStatus } = await import('../server/src/listeners.js');
  const { closeBusPublishers, testBroker } = await import('../server/src/connectors/bus.js');

  let srv: Awaited<ReturnType<typeof boot>>;
  let projectId = '';
  let connectionId = '';
  const deployed = new Set<string>();
  const queues = new Set<string>();
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  const until = async (what: string, fn: () => boolean, ms = 20000) => {
    const at = Date.now();
    while (!fn()) {
      if (Date.now() - at > ms) throw new Error(`Timed out waiting for ${what}`);
      await sleep(50);
    }
  };
  const runs = (flowId: string) => q.all<any>('select id, status, error, started_at from runs where flow_id = ? order by started_at, id', flowId);
  const output = (runId: string, step = 'In') => runState(runId)?.outputs?.[step];
  const destination = (suffix: string) => { const name = `${prefix}.${suffix}`; queues.add(name); return name; };
  const waitListening = async (flowId: string) => until('RabbitMQ listener', () => {
    const s = [...listenerStatus.entries()].find(([k]) => k.startsWith(`${flowId}:`))?.[1];
    return s?.state === 'ok';
  });
  const deploy = async (name: string, nodes: any[], edges: any[]) => {
    const f = flows.saveFlow(undefined, { name, nodes, edges }, projectId);
    flows.deploy(f.id);
    deployed.add(f.id);
    await rebuildListeners();
    await waitListening(f.id);
    return f.id;
  };
  const undeploy = async (id: string) => {
    flows.undeploy(id);
    deployed.delete(id);
    await rebuildListeners();
  };
  const trigger = (name: string, dest: string, extra: Record<string, any> = {}) => node('busSubscribe', name, {
    broker: 'rabbitmq', rabbitConn: connectionId, destinationType: 'queue', destination: dest, declare: true,
    messageType: 'JSON', ackMode: 'client', onFailure: 'requeue', maxRedeliveries: 3,
    concurrency: 4, deduplicate: 'on', withoutId: 'process', ...extra,
  });
  const publish = async (dest: string, body: any, extra: Record<string, any> = {}) => {
    const s = node('start', 'Start', { payload: '{}' });
    const p = node('busPublish', 'Publish', {
      broker: 'rabbitmq', rabbitConn: connectionId, destinationType: 'queue', destination: dest,
      messageType: 'JSON', body: '{{input}}', deliveryMode: 'persistent', priority: 4,
      timeToLive: 0, messageId: crypto.randomUUID(), properties: [], ...extra,
    });
    const runId = await engine.startRun({ doc: { name: 'RabbitMQ publisher', nodes: [s, p], edges: [edge(s, p)] }, projectId, input: body });
    await engine.waitFor(runId, 20000, true);
    const r = q.get<any>('select status, error from runs where id = ?', runId);
    assert.equal(r.status, 'done', r.error);
    return output(runId, 'Publish');
  };

  before(async () => {
    srv = await boot({ listenAdmin: false });
    projectId = projects.saveProject({ name: `RabbitMQ tests ${prefix}` }).id;
    setSecret('RABBITMQ_TEST_PASSWORD', password);
    if (clientKey) setSecret('RABBITMQ_TEST_CLIENT_KEY', clientKey);
    connectionId = saveResource({ kind: 'rabbitmq', name: 'RabbitMQ real broker', project_id: projectId, config: {
      url, user, passwordSecret: 'RABBITMQ_TEST_PASSWORD', vhost: '/', caPem, clientCertPem,
      clientKeySecret: clientKey ? 'RABBITMQ_TEST_CLIENT_KEY' : '',
    } }).id;
  });

  after(async () => {
    for (const id of [...deployed]) flows.undeploy(id);
    await rebuildListeners().catch(() => {});
    await closeBusPublishers();
    const amqp = require('amqplib');
    try {
      const u = new URL(url); u.username = encodeURIComponent(user); u.password = encodeURIComponent(password);
      const conn = await amqp.connect(u.toString());
      const ch = await conn.createChannel();
      for (const queue of queues) await ch.deleteQueue(queue).catch(() => {});
      await ch.close(); await conn.close();
    } catch { /* best-effort test cleanup */ }
    await srv.stop();
  });

  test('connects through the RabbitMQ resource', async () => {
    const r = q.get<any>('select * from resources where id = ?', connectionId);
    r.config = JSON.parse(r.config);
    assert.match(await testBroker(r, (name: string) => name === 'RABBITMQ_TEST_PASSWORD' ? password : name === 'RABBITMQ_TEST_CLIENT_KEY' ? clientKey : ''), /Connected to RabbitMQ/);
  });

  test('queue client acknowledgement preserves body, JMS headers, properties, and deduplication', async () => {
    const dest = destination('client');
    const t = trigger('In', dest);
    const flowId = await deploy('RabbitMQ client ack', [t], []);
    const messageId = `ID:${crypto.randomUUID()}`;
    await publish(dest, { orderId: 'R-100', amount: 42 }, {
      messageId, correlationId: 'corr-r100', replyTo: 'reply.orders', jmsType: 'order', priority: 8,
      properties: [{ k: 'region', v: 'south' }],
    });
    await until('client-ack run', () => runs(flowId).length === 1 && runs(flowId)[0].status === 'done');
    const first = output(runs(flowId)[0].id);
    assert.deepEqual(first.body, { orderId: 'R-100', amount: 42 });
    assert.deepEqual([first.headers.messageId, first.headers.correlationId, first.headers.replyTo, first.headers.type, first.headers.priority], [messageId, 'corr-r100', 'reply.orders', 'order', 8]);
    assert.equal(first.headers.deliveryMode, 'persistent');
    assert.equal(first.properties.region, 'south');
    await publish(dest, { orderId: 'duplicate' }, { messageId });
    await sleep(700);
    assert.equal(runs(flowId).length, 1, 'same message id is acknowledged without a duplicate run');
    await undeploy(flowId);
  });

  test('JSON, XML, text, map and bytes bodies round-trip', async () => {
    for (const [kind, body] of [['JSON', { n: 7 }], ['XML', '<o:Order xmlns:o="urn:orders" id="A-100">東京</o:Order>'], ['text', 'hello'], ['map', { a: 1, b: 'two' }], ['bytes', Buffer.from('binary').toString('base64')]] as const) {
      const dest = destination(`body.${kind}`);
      const t = trigger('In', dest, { messageType: kind });
      const flowId = await deploy(`RabbitMQ ${kind}`, [t], []);
      await publish(dest, body, { messageType: kind, body: '{{input}}' });
      await until(`${kind} body`, () => runs(flowId)[0]?.status === 'done');
      assert.deepEqual(output(runs(flowId)[0].id).body, body);
      await undeploy(flowId);
    }
  });

  test('malformed JSON and XML fail before processing and respect the retry ceiling', async () => {
    for(const [messageType,body] of [['JSON','not JSON'],['XML','<broken>']]){
      const dest=destination(`invalid.${messageType}`);
      const t=trigger('In',dest,{messageType,ackMode:'client',maxRedeliveries:2});
      const log=node('log','Business',{message:'must not execute'});
      const flowId=await deploy(`Invalid ${messageType}`,[t,log],[edge(t,log)]);
      await publish(dest,body,{messageType:'text',body:'{{input}}'});
      await until('two malformed attempts',()=>runs(flowId).length===2&&runs(flowId).every(r=>r.status==='failed'));
      for(const run of runs(flowId)){assert.match(run.error,/Invalid.*message/i);assert.equal(output(run.id,'Business'),undefined);}
      await sleep(700);assert.equal(runs(flowId).length,2);await undeploy(flowId);
    }
  });

  test('auto acknowledgement does not redeliver a failed Sutra', async () => {
    const dest = destination('auto');
    const t = trigger('In', dest, { ackMode: 'auto' });
    const bad = node('throw', 'Fail', { message: 'planned auto failure' });
    const flowId = await deploy('RabbitMQ auto ack', [t, bad], [edge(t, bad)]);
    await publish(dest, { id: 'auto-1' });
    await until('failed auto run', () => runs(flowId)[0]?.status === 'failed');
    await sleep(700);
    assert.equal(runs(flowId).length, 1);
    await undeploy(flowId);
  });

  test('client acknowledgement requeues and enforces the delivery ceiling', async () => {
    const dest = destination('redelivery');
    const t = trigger('In', dest, { ackMode: 'client', maxRedeliveries: 2 });
    const bad = node('throw', 'Fail', { message: 'planned client failure' });
    const flowId = await deploy('RabbitMQ client retry', [t, bad], [edge(t, bad)]);
    await publish(dest, { id: 'retry-1' });
    await until('two delivery attempts', () => runs(flowId).length === 2 && runs(flowId).every(r => r.status === 'failed'));
    assert.deepEqual(runs(flowId).map(r => output(r.id).headers.deliveryCount), [1, 2]);
    await sleep(700);
    assert.equal(runs(flowId).length, 2, 'second failure is rejected rather than requeued forever');
    await undeploy(flowId);
  });

  test('explicit confirm, requeue, reject, and missing Confirm settle correctly', async () => {
    const confirmed = destination('explicit.confirm');
    const tc = trigger('In', confirmed, { ackMode: 'explicit' });
    const ok = node('busConfirm', 'Confirm', { action: 'confirm' });
    const confirmedFlow = await deploy('RabbitMQ explicit confirm', [tc, ok], [edge(tc, ok)]);
    await publish(confirmed, { id: 'confirm' });
    await until('explicit confirmation', () => runs(confirmedFlow)[0]?.status === 'done');
    await undeploy(confirmedFlow);

    const requeued = destination('explicit.requeue');
    const tr = trigger('In', requeued, { ackMode: 'explicit' });
    const choose = node('if', 'First?', { left: '{{input.headers.deliveryCount}}', op: 'equals', right: '1' });
    const again = node('busConfirm', 'Requeue', { action: 'requeue' });
    const accept = node('busConfirm', 'Accept', { action: 'confirm' });
    const requeueFlow = await deploy('RabbitMQ explicit requeue', [tr, choose, again, accept], [edge(tr, choose), edge(choose, again, 'true'), edge(choose, accept, 'false')]);
    await publish(requeued, { id: 'requeue' });
    await until('explicit requeue', () => runs(requeueFlow).length === 2 && runs(requeueFlow).every(r => r.status === 'done'));
    assert.deepEqual(runs(requeueFlow).map(r => output(r.id).headers.deliveryCount), [1, 2]);
    await undeploy(requeueFlow);

    const rejected = destination('explicit.reject');
    const tj = trigger('In', rejected, { ackMode: 'explicit' });
    const no = node('busConfirm', 'Reject', { action: 'reject (dead-letter)' });
    const rejectFlow = await deploy('RabbitMQ explicit reject', [tj, no], [edge(tj, no)]);
    await publish(rejected, { id: 'reject' });
    await until('explicit rejection', () => runs(rejectFlow).length === 1 && runs(rejectFlow)[0].status === 'done');
    await sleep(700);
    assert.equal(runs(rejectFlow).length, 1, 'rejected delivery is not sent back to the source queue');
    await undeploy(rejectFlow);

    const missing = destination('explicit.missing');
    const tm = trigger('In', missing, { ackMode: 'explicit', maxRedeliveries: 2 });
    const log = node('log', 'No confirm', { message: 'finish without confirm' });
    const missingFlow = await deploy('RabbitMQ missing confirm', [tm, log], [edge(tm, log)]);
    await publish(missing, { id: 'missing' });
    await until('missing Confirm redelivery', () => runs(missingFlow).length === 2 && runs(missingFlow).every(r => r.status === 'done'));
    await sleep(500);
    assert.equal(runs(missingFlow).length, 2);
    await undeploy(missingFlow);
  });

  test('TTL and durable topics retain the intended broker semantics', async () => {
    const ttl = destination('ttl');
    await publish(ttl, { id: 'expired' }, { timeToLive: 600 });
    await sleep(1200);
    const ttlFlow = await deploy('RabbitMQ TTL', [trigger('In', ttl)], []);
    await sleep(800);
    assert.equal(runs(ttlFlow).length, 0);
    await undeploy(ttlFlow);

    const topic = `${prefix}.topic.durable`;
    const durableName = destination('durable.subscription');
    const t = trigger('In', topic, { destinationType: 'topic', durableName, declare: false });
    const flowId = await deploy('RabbitMQ durable topic', [t], []);
    await undeploy(flowId);
    await publish(topic, { id: 'offline-topic' }, { destinationType: 'topic' });
    flows.deploy(flowId); deployed.add(flowId); await rebuildListeners(); await waitListening(flowId);
    await until('offline topic message', () => runs(flowId)[0]?.status === 'done');
    assert.equal(output(runs(flowId)[0].id).body.id, 'offline-topic');
    await undeploy(flowId);
  });

  test('listener restart and concurrency do not duplicate or lose messages', async () => {
    const restart = destination('restart');
    const tr = trigger('In', restart, { concurrency: 2 });
    const wait = node('wait', 'Work', { ms: 1000 });
    const restartFlow = await deploy('RabbitMQ restart', [tr, wait], [edge(tr, wait)]);
    await publish(restart, { id: 'restart-1' });
    await until('running delivery', () => runs(restartFlow)[0]?.status === 'running');
    await rebuildListeners(); await waitListening(restartFlow);
    await until('recovered delivery', () => runs(restartFlow)[0]?.status === 'done');
    await sleep(500);
    assert.equal(runs(restartFlow).length, 1);
    await undeploy(restartFlow);

    const batch = destination('concurrency');
    const batchFlow = await deploy('RabbitMQ concurrency', [trigger('In', batch, { concurrency: 5 })], []);
    await Promise.all(Array.from({ length: 20 }, (_, i) => publish(batch, { i }, { messageId: `${prefix}-batch-${i}` })));
    await until('20 messages', () => runs(batchFlow).length === 20 && runs(batchFlow).every(r => r.status === 'done'));
    assert.equal(new Set(runs(batchFlow).map(r => output(r.id).body.i)).size, 20);
    await undeploy(batchFlow);
  });
}
