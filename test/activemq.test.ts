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
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { testEnv, node, edge } from './helpers.js';

const password = process.env.SUTRA_ACTIVEMQ_PASSWORD || '';
const enabled = process.env.SUTRA_ACTIVEMQ_TEST === '1' && !!password;

if (!enabled) {
  test('ActiveMQ Classic real-broker activity matrix', { skip: 'set SUTRA_ACTIVEMQ_TEST=1 and SUTRA_ACTIVEMQ_PASSWORD' }, () => {});
} else {
  testEnv(22810);
  const host = process.env.SUTRA_ACTIVEMQ_HOST || '127.0.0.1';
  const port = Number(process.env.SUTRA_ACTIVEMQ_PORT || 5673);
  const user = process.env.SUTRA_ACTIVEMQ_USER || 'admin';
  const consoleUrl = process.env.SUTRA_ACTIVEMQ_CONSOLE || 'http://127.0.0.1:8161';
  const openWireUrl = process.env.SUTRA_ACTIVEMQ_OPENWIRE_URL || 'tcp://127.0.0.1:61616';
  const activeMqHome = process.env.SUTRA_ACTIVEMQ_HOME || 'C:\\apache-activemq-6.3.2';
  const java = process.env.SUTRA_JAVA || 'java';
  const read = (name: string) => process.env[name] ? fs.readFileSync(process.env[name]!, 'utf8') : '';
  const caPem = read('SUTRA_ACTIVEMQ_CA_FILE');
  const clientCertPem = read('SUTRA_ACTIVEMQ_CLIENT_CERT_FILE');
  const clientKey = read('SUTRA_ACTIVEMQ_CLIENT_KEY_FILE');
  const probe = fileURLToPath(new URL('./fixtures/ActiveMqOpenWireProbe.java', import.meta.url));
  const javaCp = [path.join(activeMqHome, 'lib', '*'), path.join(activeMqHome, 'lib', 'optional', '*')].join(path.delimiter);
  const runProbe = async (...args: string[]) => (await promisify(execFile)(java, ['--class-path', javaCp, probe, ...args], { timeout: 30000, windowsHide: true })).stdout;
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
  const topics = new Set<string>();

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
  const destination = (kind: 'queue' | 'topic', suffix: string) => {
    const name = `${prefix}.${suffix}`;
    (kind === 'queue' ? queues : topics).add(name);
    return name;
  };
  const waitListening = async (flowId: string) => until('ActiveMQ listener', () => {
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
    broker: 'amqp1', amqpConn: connectionId, destinationType: 'queue', destination: dest,
    messageType: 'JSON', ackMode: 'client', onFailure: 'requeue', maxRedeliveries: 3,
    concurrency: 4, deduplicate: 'on', withoutId: 'process', ...extra,
  });
  const publish = async (dest: string, body: any, extra: Record<string, any> = {}) => {
    const s = node('start', 'Start', { payload: '{}' });
    const p = node('busPublish', 'Publish', {
      broker: 'amqp1', amqpConn: connectionId, destinationType: 'queue', destination: dest,
      messageType: 'JSON', body: '{{input}}', deliveryMode: 'persistent', priority: 4,
      timeToLive: 0, messageId: crypto.randomUUID(), properties: [], ...extra,
    });
    const runId = await engine.startRun({ doc: { name: 'ActiveMQ publisher', nodes: [s, p], edges: [edge(s, p)] }, projectId, input: body });
    await engine.waitFor(runId, 20000, true);
    const r = q.get<any>('select status, error from runs where id = ?', runId);
    assert.equal(r.status, 'done', r.error);
    return output(runId, 'Publish');
  };
  const removeDestination = async (kind: 'Queue' | 'Topic', name: string) => {
    const auth = Buffer.from(`${user}:${password}`).toString('base64');
    const object = `org.apache.activemq:type=Broker,brokerName=localhost`;
    const op = kind === 'Queue' ? 'removeQueue' : 'removeTopic';
    const url = `${consoleUrl}/api/jolokia/exec/${encodeURIComponent(object)}/${op}/${encodeURIComponent(name)}`;
    await fetch(url, { method: 'POST', headers: { authorization: `Basic ${auth}`, origin: consoleUrl } }).catch(() => {});
  };

  before(async () => {
    srv = await boot({ listenAdmin: false });
    projectId = projects.saveProject({ name: `ActiveMQ tests ${prefix}` }).id;
    setSecret('ACTIVEMQ_TEST_PASSWORD', password);
    if (clientKey) setSecret('ACTIVEMQ_TEST_CLIENT_KEY', clientKey);
    connectionId = saveResource({ kind: 'amqp1', name: 'ActiveMQ Classic real broker', project_id: projectId, config: {
      host, port, tls: !!caPem, user, passwordSecret: 'ACTIVEMQ_TEST_PASSWORD', containerId: `sutraflow-${prefix}`,
      caPem, clientCertPem, clientKeySecret: clientKey ? 'ACTIVEMQ_TEST_CLIENT_KEY' : '',
      queuePrefix: '', topicPrefix: 'topic://',
    } }).id;
  });

  after(async () => {
    for (const id of [...deployed]) flows.undeploy(id);
    await rebuildListeners().catch(() => {});
    await closeBusPublishers();
    await srv.stop();
    await Promise.all([...queues].map(n => removeDestination('Queue', n)));
    await Promise.all([...topics].map(n => removeDestination('Topic', n)));
  });

  test('connects through the ActiveMQ / AMQP 1.0 resource', async () => {
    const r = q.get<any>('select * from resources where id = ?', connectionId);
    r.config = JSON.parse(r.config);
    await assert.doesNotReject(async () => {
      assert.match(await testBroker(r, (name: string) => name === 'ACTIVEMQ_TEST_PASSWORD' ? password : name === 'ACTIVEMQ_TEST_CLIENT_KEY' ? clientKey : ''), /Connected.*AMQP 1\.0/);
    });
  });

  test('interoperates both ways with native OpenWire/JMS clients', async () => {
    const inbound = destination('queue', 'openwire.to.sutra');
    const flowId = await deploy('OpenWire to SutraFlow', [trigger('In', inbound)], []);
    await runProbe('send', openWireUrl, user, password, inbound, JSON.stringify({ from: 'openwire-jms' }));
    await until('OpenWire/JMS message in SutraFlow', () => runs(flowId)[0]?.status === 'done');
    assert.deepEqual(output(runs(flowId)[0].id).body, { from: 'openwire-jms' });
    assert.equal(output(runs(flowId)[0].id).properties.source, 'openwire-jms');
    await undeploy(flowId);

    const outbound = destination('queue', 'sutra.to.openwire');
    await publish(outbound, { from: 'sutraflow-amqp' });
    const stdout = await runProbe('receive', openWireUrl, user, password, outbound, '10000');
    const encoded = stdout.match(/BODY_BASE64=([^\r\n]+)/)?.[1];
    assert.ok(encoded, `OpenWire probe did not return a body: ${stdout}`);
    assert.deepEqual(JSON.parse(Buffer.from(encoded, 'base64').toString()), { from: 'sutraflow-amqp' });
  });

  test('queue client acknowledgement preserves JSON and JMS headers, properties, and duplicate protection', async () => {
    const dest = destination('queue', 'client');
    const t = trigger('In', dest);
    const log = node('log', 'Done', { message: 'received {{input.body.orderId}}' });
    const flowId = await deploy('ActiveMQ client ack', [t, log], [edge(t, log)]);
    const messageId = `ID:${crypto.randomUUID()}`;
    await publish(dest, { orderId: 'A-100', amount: 42 }, {
      messageId, correlationId: 'corr-100', replyTo: 'reply.orders', jmsType: 'order', priority: 8,
      timeToLive: 60000, properties: [{ k: 'region', v: 'south' }, { k: 'source', v: 'sutraflow-test' }],
    });
    await until('the client-ack run', () => runs(flowId).length === 1 && runs(flowId)[0].status === 'done');
    const first = output(runs(flowId)[0].id);
    assert.deepEqual(first.body, { orderId: 'A-100', amount: 42 });
    assert.equal(first.headers.messageId, messageId);
    assert.equal(first.headers.correlationId, 'corr-100');
    assert.equal(first.headers.replyTo, 'reply.orders');
    assert.equal(first.headers.type, 'order');
    assert.equal(first.headers.priority, 8);
    assert.equal(first.headers.deliveryMode, 'persistent');
    assert.equal(first.properties.region, 'south');
    await publish(dest, { orderId: 'duplicate' }, { messageId });
    await sleep(1500);
    assert.equal(runs(flowId).length, 1, 'a repeated message id is acknowledged without a duplicate run');
    await undeploy(flowId);
  });

  test('JSON, XML, text, map and bytes bodies round-trip through Sutra activities', async () => {
    const cases = [
      { type: 'JSON', sent: { id: 1, ok: true }, expected: { id: 1, ok: true } },
      { type: 'XML', sent: '<o:Order xmlns:o="urn:orders" id="A-100">東京</o:Order>', expected: '<o:Order xmlns:o="urn:orders" id="A-100">東京</o:Order>' },
      { type: 'text', sent: 'hello ActiveMQ', expected: 'hello ActiveMQ' },
      { type: 'map', sent: { id: 2, name: 'map' }, expected: { id: 2, name: 'map' } },
      { type: 'bytes', sent: Buffer.from([0, 1, 2, 250]).toString('base64'), expected: Buffer.from([0, 1, 2, 250]).toString('base64') },
    ];
    for (const c of cases) {
      const dest = destination('queue', `body.${c.type}`);
      const t = trigger('In', dest, { messageType: c.type });
      const log = node('log', 'Done', { message: 'received' });
      const flowId = await deploy(`ActiveMQ ${c.type}`, [t, log], [edge(t, log)]);
      await publish(dest, c.sent, { messageType: c.type, body: '{{input}}' });
      await until(`${c.type} body`, () => runs(flowId).some(r => r.status === 'done'));
      assert.deepEqual(output(runs(flowId)[0].id).body, c.expected);
      await undeploy(flowId);
    }
  });

  test('generated XML queue sample forwards exact XML before confirming its delivery', async () => {
    const {addSamples}=await import('../server/src/samples.js');
    const made=addSamples(projectId,['queue']);const sample=made.find(f=>f.name==='Sample: XML queue in and out')!;
    const doc=flows.getFlow(sample.id)!.doc;
    const inbound=destination('queue','sample.xml.in'),outbound=destination('queue','sample.xml.out');
    for(const n of doc.nodes) if(n.type==='busSubscribe'||n.type==='busPublish')Object.assign(n.config,{broker:'amqp1',amqpConn:connectionId,destination:n.type==='busSubscribe'?inbound:outbound});
    const collected=await deploy('XML sample result',[trigger('In',outbound,{messageType:'XML'})],[]);
    const flowId=await deploy('XML sample forwarder',doc.nodes,doc.edges);
    const body='<o:Order xmlns:o="urn:orders" id="sample-100">東京 &amp; Delhi</o:Order>';
    await publish(inbound,body,{messageType:'XML',body:'{{input}}'});
    await until('sample forward and confirm',()=>runs(flowId)[0]?.status==='done'&&runs(collected)[0]?.status==='done');
    assert.equal(output(runs(collected)[0].id).body,body);
    assert.ok(output(runs(flowId)[0].id,'Confirm XML'));
    await undeploy(flowId);await undeploy(collected);
  });

  test('malformed JSON and XML fail before processing and respect the retry ceiling', async () => {
    for (const [messageType, body] of [['JSON','not JSON'],['XML','<broken>']]) {
      const dest=destination('queue',`invalid.${messageType}`);
      const t=trigger('In',dest,{messageType,ackMode:'client',maxRedeliveries:2,onFailure:'requeue'});
      const log=node('log','Business',{message:'must not execute'});
      const flowId=await deploy(`Invalid ${messageType}`,[t,log],[edge(t,log)]);
      await publish(dest,body,{messageType:'text',body:'{{input}}'});
      await until('two malformed attempts',()=>runs(flowId).length===2&&runs(flowId).every(r=>r.status==='failed'));
      for(const run of runs(flowId)){ assert.match(run.error,/Invalid.*message/i);assert.equal(output(run.id,'Business'),undefined); }
      await sleep(1200);assert.equal(runs(flowId).length,2);await undeploy(flowId);
    }
  });

  test('selector accepts only matching application properties', async () => {
    const dest = destination('queue', 'selector');
    const t = trigger('In', dest, { selector: "region = 'south'" });
    const flowId = await deploy('ActiveMQ selector', [t], []);
    await publish(dest, { id: 'north' }, { properties: [{ k: 'region', v: 'north' }] });
    await publish(dest, { id: 'south' }, { properties: [{ k: 'region', v: 'south' }] });
    await until('selector match', () => runs(flowId).length === 1 && runs(flowId)[0].status === 'done');
    assert.equal(output(runs(flowId)[0].id).body.id, 'south');
    await undeploy(flowId);
  });

  test('auto acknowledgement does not redeliver a failed Sutra', async () => {
    const dest = destination('queue', 'auto');
    const t = trigger('In', dest, { ackMode: 'auto' });
    const fail = node('throw', 'Fail', { message: 'deliberate auto-ack failure' });
    const flowId = await deploy('ActiveMQ auto ack', [t, fail], [edge(t, fail)]);
    await publish(dest, { id: 'auto-1' });
    await until('failed auto-ack run', () => runs(flowId).length === 1 && runs(flowId)[0].status === 'failed');
    await sleep(1500);
    assert.equal(runs(flowId).length, 1);
    await undeploy(flowId);
  });

  test('client acknowledgement requeues failures and rejects at the delivery ceiling', async () => {
    const dest = destination('queue', 'redelivery');
    const t = trigger('In', dest, { ackMode: 'client', onFailure: 'requeue', maxRedeliveries: 2 });
    const fail = node('throw', 'Fail', { message: 'deliberate redelivery failure' });
    const flowId = await deploy('ActiveMQ redelivery limit', [t, fail], [edge(t, fail)]);
    await publish(dest, { id: 'retry-1' });
    await until('two failed deliveries', () => runs(flowId).length >= 2 && runs(flowId).every(r => r.status === 'failed'));
    await sleep(1500);
    assert.equal(runs(flowId).length, 2, 'delivery two is rejected instead of being requeued forever');
    assert.equal(output(runs(flowId)[1].id).headers.redelivered, true);
    assert.equal(output(runs(flowId)[1].id).headers.deliveryCount, 2);
    await undeploy(flowId);
  });

  test('explicit confirm, requeue and reject decisions settle as selected', async () => {
    const confirmed = destination('queue', 'explicit.confirm');
    const tc = trigger('In', confirmed, { ackMode: 'explicit' });
    const ok = node('busConfirm', 'Confirm', { action: 'confirm' });
    const confirmedFlow = await deploy('ActiveMQ explicit confirm', [tc, ok], [edge(tc, ok)]);
    await publish(confirmed, { id: 'confirm-1' });
    await until('explicit confirmation', () => runs(confirmedFlow).length === 1 && runs(confirmedFlow)[0].status === 'done');
    await sleep(700);
    assert.equal(runs(confirmedFlow).length, 1);
    await undeploy(confirmedFlow);

    const requeued = destination('queue', 'explicit.requeue');
    const tr = trigger('In', requeued, { ackMode: 'explicit', deduplicate: 'on' });
    const choose = node('if', 'First?', { left: '{{input.headers.redelivered}}', op: 'equals', right: 'false' });
    const again = node('busConfirm', 'Requeue', { action: 'requeue' });
    const accept = node('busConfirm', 'Accept', { action: 'confirm' });
    const requeueFlow = await deploy('ActiveMQ explicit requeue', [tr, choose, again, accept], [edge(tr, choose), edge(choose, again, 'true'), edge(choose, accept, 'false')]);
    await publish(requeued, { id: 'requeue-1' });
    await until('explicit requeue and second run', () => runs(requeueFlow).length >= 2 && runs(requeueFlow).every(r => r.status === 'done'));
    assert.equal(runs(requeueFlow).length, 2);
    assert.equal(output(runs(requeueFlow)[1].id).headers.redelivered, true);
    await undeploy(requeueFlow);

    const rejected = destination('queue', 'explicit.reject');
    const tj = trigger('In', rejected, { ackMode: 'explicit' });
    const no = node('busConfirm', 'Reject', { action: 'reject (dead-letter)' });
    const rejectFlow = await deploy('ActiveMQ explicit reject', [tj, no], [edge(tj, no)]);
    await publish(rejected, { id: 'reject-1' });
    await until('explicit rejection', () => runs(rejectFlow).length === 1 && runs(rejectFlow)[0].status === 'done');
    await sleep(1000);
    assert.equal(runs(rejectFlow).length, 1);
    await undeploy(rejectFlow);
  });

  test('ending explicit mode without Confirm causes redelivery up to the configured ceiling', async () => {
    const dest = destination('queue', 'explicit.missing');
    const t = trigger('In', dest, { ackMode: 'explicit', onFailure: 'requeue', maxRedeliveries: 2 });
    const log = node('log', 'No confirm', { message: 'intentionally no confirmation' });
    const flowId = await deploy('ActiveMQ missing confirm', [t, log], [edge(t, log)]);
    await publish(dest, { id: 'missing-confirm' });
    await until('missing-confirm redelivery', () => runs(flowId).length >= 2);
    await sleep(1000);
    assert.equal(runs(flowId).length, 2);
    await undeploy(flowId);
  });

  test('TTL expires a queued message before a subscriber appears', async () => {
    const dest = destination('queue', 'ttl');
    await publish(dest, { id: 'expired' }, { timeToLive: 700 });
    await sleep(1400);
    const t = trigger('In', dest);
    const flowId = await deploy('ActiveMQ TTL', [t], []);
    await sleep(1200);
    assert.equal(runs(flowId).length, 0);
    await undeploy(flowId);
  });

  test('durable topic subscription receives messages published while undeployed', async () => {
    const dest = destination('topic', 'durable');
    const durableName = `${prefix}.durable.consumer`;
    const t = trigger('In', dest, { destinationType: 'topic', durableName, concurrency: 1 });
    const flowId = await deploy('ActiveMQ durable topic', [t], []);
    await undeploy(flowId);
    await publish(dest, { id: 'offline-topic' }, { destinationType: 'topic' });
    flows.deploy(flowId);
    deployed.add(flowId);
    await rebuildListeners();
    await waitListening(flowId);
    await until('offline durable-topic message', () => runs(flowId).length === 1 && runs(flowId)[0].status === 'done');
    assert.equal(output(runs(flowId)[0].id).body.id, 'offline-topic');
    await undeploy(flowId);
  });

  test('listener restart during an unacknowledged run does not start a duplicate', async () => {
    const dest = destination('queue', 'restart');
    const t = trigger('In', dest, { ackMode: 'client', concurrency: 2 });
    const wait = node('wait', 'Work', { ms: 1800 });
    const flowId = await deploy('ActiveMQ listener restart', [t, wait], [edge(t, wait)]);
    await publish(dest, { id: 'restart-1' });
    await until('running message', () => runs(flowId).length === 1 && runs(flowId)[0].status === 'running');
    await rebuildListeners();
    await waitListening(flowId);
    await until('run after listener restart', () => runs(flowId).length === 1 && runs(flowId)[0].status === 'done', 25000);
    await sleep(1200);
    assert.equal(runs(flowId).length, 1, 'redelivery after listener restart follows the durable run guard');
    await undeploy(flowId);
  });

  test('concurrency processes a batch once without losing messages', async () => {
    const dest = destination('queue', 'concurrency');
    const t = trigger('In', dest, { concurrency: 4 });
    const wait = node('wait', 'Work', { ms: 100 });
    const flowId = await deploy('ActiveMQ concurrency', [t, wait], [edge(t, wait)]);
    await Promise.all(Array.from({ length: 20 }, (_, i) => publish(dest, { id: `batch-${i}` })));
    await until('20 completed messages', () => runs(flowId).length === 20 && runs(flowId).every(r => r.status === 'done'), 30000);
    const ids = runs(flowId).map(r => output(r.id).body.id);
    assert.equal(new Set(ids).size, 20);
    await undeploy(flowId);
  });
}
