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
const password = process.env.SUTRA_KAFKA_PASSWORD || '';
const brokers = String(process.env.SUTRA_KAFKA_BROKERS || '').split(',').map(x => x.trim()).filter(Boolean);
const enabled = process.env.SUTRA_KAFKA_TEST === '1' && brokers.length > 0;

if (!enabled) {
  test('Kafka real-broker activity matrix', { skip: 'set SUTRA_KAFKA_TEST=1 and SUTRA_KAFKA_BROKERS' }, () => {});
} else {
  testEnv(22860);
  const user = process.env.SUTRA_KAFKA_USER || '';
  const sasl = (process.env.SUTRA_KAFKA_SASL || (user ? 'plain' : 'none')) as 'none' | 'plain' | 'scram-sha-256' | 'scram-sha-512';
  const read = readTestPem;
  const caPem = read('SUTRA_KAFKA_CA_FILE');
  const clientCertPem = read('SUTRA_KAFKA_CLIENT_CERT_FILE');
  const clientKey = read('SUTRA_KAFKA_CLIENT_KEY_FILE');
  const prefix = `sutra-test-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const topic = `${prefix}-events`;
  const group = `${prefix}-group`;
  let consumerNo = 0;

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
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  const until = async (what: string, fn: () => boolean, ms = 35000) => {
    const at = Date.now();
    while (!fn()) {
      if (Date.now() - at > ms) throw new Error(`Timed out waiting for ${what}`);
      await sleep(100);
    }
  };
  const runs = (flowId: string) => q.all<any>('select id, status, error, started_at from runs where flow_id = ? order by started_at, id', flowId);
  const output = (runId: string, step = 'In') => runState(runId)?.outputs?.[step];
  const waitListening = (flowId: string) => until('Kafka listener', () => [...listenerStatus.entries()].some(([k, v]) => k.startsWith(`${flowId}:`) && v.state === 'ok'));
  const deploy = async (name: string, nodes: any[], edges: any[]) => {
    const f = flows.saveFlow(undefined, { name, nodes, edges }, projectId);
    flows.deploy(f.id); deployed.add(f.id); await rebuildListeners(); await waitListening(f.id); return f.id;
  };
  const undeploy = async (id: string) => { flows.undeploy(id); deployed.delete(id); await rebuildListeners(); };
  const trigger = (name: string, extra: Record<string, any> = {}) => node('busSubscribe', name, {
    broker: 'kafka', kafkaConn: connectionId, destination: topic, groupId: `${group}-${++consumerNo}`, fromBeginning: false,
    messageType: 'JSON', ackMode: 'client', onFailure: 'requeue', maxRedeliveries: 3,
    concurrency: 3, deduplicate: 'on', ...extra,
  });
  const publish = async (body: any, extra: Record<string, any> = {}) => {
    const s = node('start', 'Start', { payload: '{}' });
    const p = node('busPublish', 'Publish', {
      broker: 'kafka', kafkaConn: connectionId, destination: topic, messageType: 'JSON', body: '{{input}}',
      messageId: crypto.randomUUID(), key: '{{input.orderId}}', acks: 'all', properties: [], ...extra,
    });
    const id = await engine.startRun({ doc: { name: 'Kafka publisher', nodes: [s, p], edges: [edge(s, p)] }, projectId, input: body });
    await engine.waitFor(id, 30000, true);
    const r = q.get<any>('select status, error from runs where id = ?', id);
    assert.equal(r.status, 'done', r.error);
    return output(id, 'Publish');
  };

  before(async () => {
    srv = await boot({ listenAdmin: false });
    projectId = projects.saveProject({ name: `Kafka tests ${prefix}` }).id;
    if (password) setSecret('KAFKA_TEST_PASSWORD', password);
    if (clientKey) setSecret('KAFKA_TEST_CLIENT_KEY', clientKey);
    connectionId = saveResource({ kind: 'kafka', name: 'Kafka real broker', project_id: projectId, config: {
      brokers, clientId: prefix, ssl: process.env.SUTRA_KAFKA_TLS !== '0', caPem, clientCertPem,
      clientKeySecret: clientKey ? 'KAFKA_TEST_CLIENT_KEY' : '', sasl, user,
      passwordSecret: password ? 'KAFKA_TEST_PASSWORD' : '',
    } }).id;
    const { Kafka, logLevel } = require('kafkajs');
    const admin = KafkaAdmin(Kafka, logLevel);
    await admin.connect();
    await admin.createTopics({ waitForLeaders: true, topics: [{ topic, numPartitions: 3, replicationFactor: Number(process.env.SUTRA_KAFKA_REPLICATION || 2) }] });
    await admin.disconnect();
  });

  function KafkaAdmin(Kafka: any, logLevel: any) {
    const ssl = process.env.SUTRA_KAFKA_TLS === '0' ? false : {
      rejectUnauthorized: true, ...(caPem ? { ca: [caPem] } : {}),
      ...(clientCertPem && clientKey ? { cert: [clientCertPem], key: clientKey } : {}),
    };
    return new Kafka({ clientId: `${prefix}-admin`, brokers, ssl, logLevel: logLevel.NOTHING,
      sasl: sasl === 'none' ? undefined : { mechanism: sasl, username: user, password } }).admin();
  }

  after(async () => {
    console.info('# Kafka cleanup: stopping listeners');
    for (const id of deployed) flows.undeploy(id);
    await rebuildListeners().catch(() => {});
    console.info('# Kafka cleanup: closing publishers');
    await closeBusPublishers();
    console.info('# Kafka cleanup: removing test topic');
    try {
      const { Kafka, logLevel } = require('kafkajs'); const admin = KafkaAdmin(Kafka, logLevel);
      await admin.connect(); await admin.deleteTopics({ topics: [topic] }); await admin.disconnect();
    } catch { /* best-effort hosted-broker cleanup */ }
    console.info('# Kafka cleanup: stopping isolated server');
    await srv.stop();
    console.info('# Kafka cleanup: complete');
  });

  test('connects through the Kafka resource', async () => {
    const r = q.get<any>('select * from resources where id = ?', connectionId); r.config = JSON.parse(r.config);
    assert.match(await testBroker(r, (name: string) => name === 'KAFKA_TEST_PASSWORD' ? password : name === 'KAFKA_TEST_CLIENT_KEY' ? clientKey : ''), /Connected to Kafka/);
  });

  test('publishes and consumes body, key, headers, properties and offsets', async () => {
    const t = trigger('In'); const flowId = await deploy('Kafka headers', [t], []);
    await publish({ orderId: 'K-100', amount: 42 }, { correlationId: 'corr-k100', replyTo: 'reply.orders', jmsType: 'order', properties: [{ k: 'region', v: 'south' }] });
    await until('Kafka message', () => runs(flowId)[0]?.status === 'done');
    const first = output(runs(flowId)[0].id);
    assert.deepEqual(first.body, { orderId: 'K-100', amount: 42 });
    assert.equal(first.key, 'K-100'); assert.equal(first.headers.correlationId, 'corr-k100');
    assert.equal(first.headers.replyTo, 'reply.orders'); assert.equal(first.headers.type, 'order'); assert.equal(first.properties.region, 'south');
    assert.equal(typeof first.partition, 'number'); assert.match(first.offset, /^\d+$/);
    await undeploy(flowId);
  });

  test('JSON, XML, text, map and bytes round-trip through Kafka activities', async () => {
    for (const [messageType,body] of [['JSON',{id:7}],['XML','<o:Order xmlns:o="urn:orders" id="K-100">東京</o:Order>'],['text','hello Kafka'],['map',{name:'map'}],['bytes',Buffer.from([0,128,255]).toString('base64')]] as const) {
      const t=trigger('In',{messageType}); const flowId=await deploy(`Kafka ${messageType}`,[t],[]);
      await publish(body,{messageType,key:'format'});
      await until(`${messageType} body`,()=>runs(flowId)[0]?.status==='done');
      assert.deepEqual(output(runs(flowId)[0].id).body,body); await undeploy(flowId);
    }
  });

  test('malformed JSON and XML fail before processing and commit at the retry ceiling', async () => {
    for(const [messageType,body]of [['JSON','not JSON'],['XML','<broken>']]){
      const t=trigger('In',{messageType,maxRedeliveries:2});const log=node('log','Business',{message:'must not execute'});
      const flowId=await deploy(`Invalid ${messageType}`,[t,log],[edge(t,log)]);
      await publish(body,{messageType:'text',key:'invalid'});
      await until('two malformed attempts',()=>runs(flowId).length===2&&runs(flowId).every(r=>r.status==='failed'),45000);
      for(const run of runs(flowId)){assert.match(run.error,/Invalid.*message/i);assert.equal(output(run.id,'Business'),undefined);}
      await sleep(6000);assert.equal(runs(flowId).length,2);await undeploy(flowId);
    }
  });

  test('client acknowledgement retries a failure and commits at the configured ceiling', async () => {
    const t = trigger('In', { maxRedeliveries: 2 }); const fail = node('throw', 'Fail', { message: 'planned Kafka failure' });
    const flowId = await deploy('Kafka delivery ceiling', [t, fail], [edge(t, fail)]);
    await publish({ orderId: 'K-retry' });
    await until('two failed Kafka attempts', () => runs(flowId).filter(x => x.status === 'failed').length === 2, 45000);
    assert.deepEqual(runs(flowId).map(x => output(x.id)?.headers.deliveryCount), [1, 2]);
    await sleep(6500); assert.equal(runs(flowId).length, 2, 'the offset is committed after the delivery ceiling');
    await undeploy(flowId);
  });

  test('auto acknowledgement does not replay a failed Sutra', async () => {
    const t = trigger('In', { ackMode: 'auto' });
    const fail = node('throw', 'Fail', { message: 'planned Kafka auto-ack failure' });
    const flowId = await deploy('Kafka auto acknowledgement', [t, fail], [edge(t, fail)]);
    await publish({ orderId: 'K-auto' });
    await until('failed auto-ack run', () => runs(flowId)[0]?.status === 'failed');
    await sleep(6500);
    assert.equal(runs(flowId).length, 1, 'auto-committed offset is not replayed after the run fails');
    await undeploy(flowId);
  });

  test('explicit requeue then confirm settles one Kafka offset without a third run', async () => {
    const t = trigger('In', { ackMode: 'explicit', maxRedeliveries: 3 });
    const choose = node('if', 'First delivery', { left: '{{input.headers.deliveryCount}}', op: 'equals', right: '1' });
    const again = node('busConfirm', 'Requeue', { action: 'requeue' }); const ok = node('busConfirm', 'Confirm', { action: 'confirm' });
    const flowId = await deploy('Kafka explicit decisions', [t, choose, again, ok], [edge(t, choose), edge(choose, again, 'true'), edge(choose, ok, 'false')]);
    await publish({ orderId: 'K-explicit' });
    await until('explicit redelivery', () => runs(flowId).length === 2 && runs(flowId)[1].status === 'done', 45000);
    assert.deepEqual(runs(flowId).map(x => output(x.id)?.headers.deliveryCount), [1, 2]);
    await sleep(6500); assert.equal(runs(flowId).length, 2);
    await undeploy(flowId);
  });

  test('explicit reject commits the offset and a missing Confirm retries to the ceiling', async () => {
    const rejectTrigger = trigger('In', { ackMode: 'explicit' });
    const reject = node('busConfirm', 'Reject', { action: 'reject (dead-letter)' });
    const rejectFlow = await deploy('Kafka explicit reject', [rejectTrigger, reject], [edge(rejectTrigger, reject)]);
    await publish({ orderId: 'K-reject' });
    await until('explicit Kafka rejection', () => runs(rejectFlow)[0]?.status === 'done');
    await sleep(6500);
    assert.equal(runs(rejectFlow).length, 1, 'Kafka has no broker DLQ action; reject commits this source offset');
    await undeploy(rejectFlow);

    const missingTrigger = trigger('In', { ackMode: 'explicit', maxRedeliveries: 2 });
    const log = node('log', 'No confirm', { message: 'intentionally finish without Confirm message' });
    const missingFlow = await deploy('Kafka missing Confirm', [missingTrigger, log], [edge(missingTrigger, log)]);
    await publish({ orderId: 'K-missing-confirm' });
    await until('missing-confirm retries', () => runs(missingFlow).length === 2 && runs(missingFlow).every(x => x.status === 'done'), 45000);
    assert.deepEqual(runs(missingFlow).map(x => output(x.id)?.headers.deliveryCount), [1, 2]);
    await sleep(6500);
    assert.equal(runs(missingFlow).length, 2, 'the ceiling commits the source offset');
    await undeploy(missingFlow);
  });

  test('listener restart and partition concurrency do not duplicate or lose messages', async () => {
    const restartTrigger = trigger('In', { concurrency: 2 });
    const wait = node('wait', 'Work', { ms: 1800 });
    const restartFlow = await deploy('Kafka listener restart', [restartTrigger, wait], [edge(restartTrigger, wait)]);
    await publish({ orderId: 'K-restart' });
    await until('running Kafka delivery', () => runs(restartFlow)[0]?.status === 'running');
    await rebuildListeners(); await waitListening(restartFlow);
    await until('guarded Kafka delivery', () => runs(restartFlow).length === 1 && runs(restartFlow)[0].status === 'done', 45000);
    await sleep(6500);
    assert.equal(runs(restartFlow).length, 1, 'the durable delivery guard prevents a second run for the same offset');
    await undeploy(restartFlow);

    const batchTrigger = trigger('In', { concurrency: 3 });
    const batchFlow = await deploy('Kafka partition concurrency', [batchTrigger], []);
    await Promise.all(Array.from({ length: 12 }, (_, i) => publish({ orderId: `K-batch-${i}`, i })));
    await until('12 Kafka messages', () => runs(batchFlow).length === 12 && runs(batchFlow).every(x => x.status === 'done'), 60000);
    assert.equal(new Set(runs(batchFlow).map(x => output(x.id).body.i)).size, 12);
    await undeploy(batchFlow);
  });
}
