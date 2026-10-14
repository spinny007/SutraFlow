import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { testEnv, captureServer, node, edge } from './helpers.js';

testEnv(18710);
const require = createRequire(import.meta.url);
const { boot } = await import('../server/src/index.js');
const { engine } = await import('../server/src/engine/engine.js');
const { q } = await import('../server/src/db.js');
const projects = await import('../server/src/projects.js');
const schemas = await import('../server/src/schemas.js');
const flows = await import('../server/src/flows.js');
const { saveResource } = await import('../server/src/resources.js');
const { evaluateMapping, adhocTree } = await import('../server/src/mapping.js');
const { rebuildListeners } = await import('../server/src/listeners.js');

let srv: Awaited<ReturnType<typeof boot>>;
let pid = '';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-feat-'));
before(async () => {
  srv = await boot({ listenAdmin: false });
  pid = projects.saveProject({ name: 'Features', config: { variables: [
    { name: 'OUT', type: 'string', value: dir },
    { name: 'BATCH', type: 'number', value: '1' },
    { name: 'API', type: 'string', value: 'http://127.0.0.1:1' },
    { name: 'QUEUE', type: 'string', value: 'orders.in' },
  ] } }).id;
});
after(async () => { await srv.stop(); });

async function run(nodes: any[], edges: any[], input?: any) {
  const id = engine.startRun({ doc: { name: 'F', nodes, edges }, projectId: pid, input });
  await engine.waitFor(id, 15000, true);
  const r: any = q.get('select * from runs where id = ?', id);
  return { status: r.status, error: r.error, state: JSON.parse(r.state) };
}
const until = async (fn: () => boolean, ms = 8000) => {
  const t = Date.now();
  while (!fn()) { if (Date.now() - t > ms) throw new Error('timed out'); await new Promise(r => setTimeout(r, 50)); }
};

test('For-Each with Where, Group by and Sort by (bare column names)', () => {
  const rows = [
    { Country: 'India', City: 'Pune', Amount: 10 }, { Country: 'USA', City: 'NYC', Amount: 50 },
    { Country: 'india', City: 'Delhi', Amount: 30 }, { Country: 'INDIA', City: 'Pune', Amount: 5 },
  ];
  const m = {
    fields: ['cities[]/city', 'cities[]/total', 'cities[]/orders', 'cities[]/rank'],
    rules: {
      cities: { forEach: '{input.rows}', where: "upper-case(Country) = 'INDIA'", groupBy: 'City', sortBy: 'sum({group.items}, \'Amount\')', sortDesc: true },
      'cities/city': { expr: '{group.key}' },
      'cities/total': { expr: "sum({group.items}, 'Amount')" },
      'cities/orders': { expr: '{group.count}' },
      'cities/rank': { expr: "concat(position(), ' of ', last())" },
    },
  };
  const out = evaluateMapping(adhocTree(m), m, { input: { rows } });
  assert.deepEqual(out.cities, [{ city: 'Delhi', total: 30, orders: 1, rank: '1 of 2' }, { city: 'Pune', total: 15, orders: 2, rank: '2 of 2' }]);
});

test('project and Sengine variables: General-tab settings, connections, get/set functions', async () => {
  projects.saveEngineVariables([{ name: 'REGION', value: 'ap-south-1' }]);
  const s = node('start', 'Start', { payload: '{"lines":[{"sku":"A","qty":2}]}' });
  // Folder comes from a project variable; no mapping needed in the General tab.
  const w = node('fileWrite', 'Write', { folder: '{{gv.OUT}}', path: 'v.txt', format: 'text', content: "=concat(get-engine-variable('REGION'), '/', {ev.REGION}, '/', get-project-variable('QUEUE'))", overwrite: true });
  const setv = node('mapper', 'Bump', { mapping: { rules: { next: { expr: "set-project-variable('BATCH', {gv.BATCH} + 1)" } } } });
  const r = await run([s, w, setv], [edge(s, w), edge(w, setv)]);
  assert.equal(r.status, 'done', r.error);
  assert.equal(fs.readFileSync(path.join(dir, 'v.txt'), 'utf8'), 'ap-south-1/ap-south-1/orders.in');
  assert.equal(projects.effectiveVariables(pid).values.BATCH, 2, 'set-project-variable changes later runs');
  projects.setOps(pid, {});
  assert.equal(projects.effectiveVariables(pid).values.BATCH, 1, 'a new deployment config resets runtime values');

  const cap = await captureServer(() => ({ body: '{"ok":true}' }));
  try {
    projects.setOps(pid, { variables: { API: cap.url } });
    const conn = saveResource({ kind: 'httpConnection', name: 'Var API', project_id: pid, config: { baseUrl: '{{gv.API}}', timeoutMs: 5000 } });
    const h = node('httpRequest', 'Call', { connection: conn.id, method: 'GET', url: '/ping', parse: 'auto', failOn: '4xx or 5xx' });
    const r2 = await run([s, h], [edge(s, h)]);
    assert.equal(r2.status, 'done', r2.error);
    assert.equal(cap.seen[0].url, '/ping');
  } finally { await cap.close(); projects.setOps(pid, {}); }
});

test('files: CSV rows typed by a schema, encodings, wildcard directory listing, write CSV from rows', async () => {
  const sch = schemas.saveSchema({ project_id: pid, name: 'OrderRow', kind: 'json', text: JSON.stringify({ type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, country: { type: 'string' }, amount: { type: 'number' }, paid: { type: 'boolean' } } } }) });
  // ISO-8859-1 file, no header row, ';' separated: columns come from the schema in order.
  fs.writeFileSync(path.join(dir, 'in1.csv'), Buffer.from('007;España;12,5;yes\n008;India;"3";no\n', 'latin1'));
  fs.writeFileSync(path.join(dir, 'in2.csv'), 'id,country,amount,paid\n9,India,7,true\n');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
  const s = node('start', 'Start', { payload: '{}' });
  const rd = node('fileRead', 'Read', { folder: '{{gv.OUT}}', path: 'in1.csv', format: 'CSV rows', encoding: 'iso-8859-1', delimiter: ';', header: false, decimal: ',', schema: sch.id });
  const r = await run([s, rd], [edge(s, rd)]);
  assert.equal(r.status, 'done', r.error);
  assert.deepEqual(r.state.outputs.Read.rows, [{ id: '007', country: 'España', amount: 12.5, paid: true }, { id: '008', country: 'India', amount: 3, paid: false }]);

  const ls = node('fileList', 'List', { location: "=concat({gv.OUT}, '/*.csv')", format: 'CSV rows', header: true, sort: 'name' });
  const wr = node('fileWrite', 'Export', { folder: '{{gv.OUT}}', path: 'out.csv', format: 'CSV from rows', rows: '={nodes.List.files}[name = \'in2.csv\'].rows', delimiter: ',', header: true, encoding: 'utf-8 with BOM', overwrite: true });
  const r2 = await run([s, ls, wr], [edge(s, ls), edge(ls, wr)]);
  assert.equal(r2.status, 'done', r2.error);
  assert.deepEqual(r2.state.outputs.List.files.map((f: any) => f.name), ['in1.csv', 'in2.csv'], 'only *.csv');
  const written = fs.readFileSync(path.join(dir, 'out.csv'));
  assert.deepEqual([...written.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 BOM');
  assert.equal(written.subarray(3).toString(), 'id,country,amount,paid\n9,India,7,true');

  const lines = node('fileRead', 'Lines', { folder: '{{gv.OUT}}', path: 'in2.csv', format: 'lines', skipRows: 1 });
  const r3 = await run([s, lines], [edge(s, lines)]);
  assert.deepEqual(r3.state.outputs.Lines.rows, [{ number: 1, line: '9,India,7,true' }]);
});

test('Transform (JSONata) reshapes repeating rows', async () => {
  const s = node('start', 'Start', { payload: JSON.stringify({ rows: [{ OrderId: 1, Country: 'India', City: 'Pune', Qty: 2, Price: 10 }, { OrderId: 2, Country: 'USA', City: 'NYC', Qty: 1, Price: 5 }, { OrderId: 3, Country: 'india', City: 'Pune', Qty: 1, Price: 3 }] }) });
  const j = node('jsonata', 'Shape', { source: '{{input}}', expression: '{ "orders": rows[$uppercase(Country) = "INDIA"].{ "id": OrderId, "total": Qty * Price }, "byCity": rows{ City: $sum($.(Qty * Price)) }, "region": $gv.QUEUE }' });
  const r = await run([s, j], [edge(s, j)]);
  assert.equal(r.status, 'done', r.error);
  assert.deepEqual(r.state.outputs.Shape, { orders: [{ id: 1, total: 20 }, { id: 3, total: 3 }], byCity: { Pune: 23, NYC: 5 }, region: 'orders.in' });
});

test('Service Bus: JMS headers and properties; explicit acknowledgement with Confirm message', async () => {
  const rhea = require('rhea');
  const broker = rhea.create_container({ id: 'fake-amq' });
  const got: any[] = [];
  const outcomes: string[] = [];
  let toSub: any = null;
  let subSource: any = null;
  broker.on('message', (ctx: any) => got.push({ address: ctx.receiver.target?.address, m: ctx.message }));
  broker.on('sender_open', (ctx: any) => { toSub = ctx.sender; subSource = ctx.sender.source; });
  broker.on('accepted', () => outcomes.push('accepted'));
  broker.on('released', () => outcomes.push('released'));
  const listener = broker.listen({ port: 0, host: '127.0.0.1' });
  await new Promise(r => listener.on('listening', r));
  try {
    const conn = saveResource({ kind: 'amqp1', name: 'AMQ', project_id: pid, config: { host: '127.0.0.1', port: listener.address().port, topicPrefix: 'topic://' } });
    const s = node('start', 'Start', { payload: '{"orderId":"A-9"}' });
    const p = node('busPublish', 'Publish', { broker: 'amqp1', amqpConn: conn.id, destinationType: 'topic', destination: '{{gv.QUEUE}}', messageType: 'JSON', body: '{{input}}',
      deliveryMode: 'non-persistent', priority: 7, timeToLive: 60000, correlationId: '{{input.orderId}}', replyTo: 'replies', jmsType: 'order', properties: [{ k: 'region', v: 'south' }] });
    const r = await run([s, p], [edge(s, p)]);
    assert.equal(r.status, 'done', r.error);
    const m = got[0].m;
    assert.equal(got[0].address, 'topic://orders.in');
    assert.deepEqual([m.correlation_id, m.reply_to, m.subject, m.priority, m.durable, m.ttl, m.application_properties.region], ['A-9', 'replies', 'order', 7, false, 60000, 'south']);
    assert.equal(r.state.outputs.Publish.messageId, m.message_id);

    // Subscriber with explicit acknowledgement: only the Confirm message activity accepts.
    const t = node('busSubscribe', 'In', { broker: 'amqp1', amqpConn: conn.id, destinationType: 'queue', destination: '{{gv.QUEUE}}', selector: "type = 'order'", ackMode: 'explicit', onFailure: 'requeue', messageType: 'JSON' });
    const chk = node('if', 'Confirm?', { left: '{{input.body.confirm}}', op: 'equals', right: 'true' });
    const ok = node('busConfirm', 'Confirm', { action: 'confirm' });
    const skip = node('log', 'Skip', { message: 'not confirmed' });
    const f = flows.saveFlow(undefined, { name: 'Sub explicit', nodes: [t, chk, ok, skip], edges: [edge(t, chk), edge(chk, ok, 'true'), edge(chk, skip, 'false')] }, pid);
    flows.deploy(f.id);
    await rebuildListeners();
    await until(() => !!toSub && toSub.sendable());
    assert.equal(subSource.address, 'orders.in');
    assert.ok(subSource.filter, 'selector sent to the broker');
    toSub.send({ body: JSON.stringify({ confirm: true }), subject: 'order', message_id: 'm-1', priority: 5 });
    await until(() => outcomes.includes('accepted'));
    toSub.send({ body: JSON.stringify({ confirm: false }), subject: 'order', message_id: 'm-2' });
    await until(() => outcomes.includes('released'));
    const runs = q.all<any>('select state from runs where flow_id = ? order by started_at', f.id).map(x => JSON.parse(x.state).outputs.In);
    assert.equal(runs[0].headers.messageId, 'm-1');
    assert.equal(runs[0].headers.type, 'order');
    flows.undeploy(f.id);
    await rebuildListeners();
  } finally { listener.close(); }
});

test('End can stop the whole Sutra as success or error; file steps always return file details', async () => {
  const s = node('start', 'Start'), w = node('wait', 'Slow', { ms: 3000 }), late = node('log', 'Late', { message: 'should not run' });
  const mk = (stop: string) => node('end', 'Stop', { stop, result: '{{input}}', message: 'Order {{input.id}} rejected' });
  const ok = mk('Sutra: success');
  let r = await run([s, w, late, ok], [edge(s, w), edge(w, late), edge(s, ok)], { id: 'A1' });
  assert.equal(r.status, 'done', r.error);
  assert.equal(r.state.outputs.Late, undefined);
  const bad = mk('Sutra: error');
  r = await run([s, w, late, bad], [edge(s, w), edge(w, late), edge(s, bad)], { id: 'A2' });
  assert.equal(r.status, 'failed');
  assert.match(r.error, /Order A2 rejected/);

  const wr = node('fileWrite', 'Write', { folder: dir, path: 'out/rows.csv', format: 'CSV from rows', rows: '{{input.rows}}', append: false, overwrite: true });
  const mv = node('fileMove', 'Move', { folder: dir, action: 'copy', from: 'out/rows.csv', to: 'done/rows.csv' });
  r = await run([s, wr, mv], [edge(s, wr), edge(wr, mv)], { rows: [{ a: 1 }, { a: 2 }] });
  assert.equal(r.status, 'done');
  const o = r.state.outputs.Write;
  assert.equal(o.name, 'rows.csv');
  assert.equal(o.relativePath, 'out/rows.csv');
  assert.equal(o.extension, 'csv');
  assert.equal(o.rowsWritten, 2);
  assert.equal(o.action, 'created');
  assert.ok(o.bytesWritten > 0 && o.size === o.bytesWritten);
  assert.equal(r.state.outputs.Move.action, 'copied');
  assert.equal(r.state.outputs.Move.name, 'rows.csv');
});

test('AI router, summarize, translate and sentiment (mock Claude endpoint)', async () => {
  const { setSecret } = await import('../server/src/secrets.js');
  setSecret('AI_KEY', 'sk-test');
  const replyFor = (prompt: string) =>
    prompt.includes('Routes:') ? { routes: ['billing'], reason: 'mentions an invoice' }
    : prompt.includes('Summarise') ? { summary: 'Customer wants a refund for invoice 42.', points: ['refund', 'invoice 42'] }
    : prompt.includes('Translate') ? { text: 'Hello', from: 'Hindi' }
    : { sentiment: 'negative', score: -0.7, emotions: ['frustration'], reason: 'complaint' };
  const cap = await captureServer((_req, body) => {
    const prompt = JSON.parse(body).messages[0].content;
    return { body: JSON.stringify({ id: 'm1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(replyFor(prompt)) }], usage: { input_tokens: 1, output_tokens: 1 } }) };
  });
  try {
    const prov = saveResource({ kind: 'aiProvider', name: 'Mock Claude', project_id: pid, config: { apiKeySecret: 'AI_KEY', baseUrl: cap.url, model: 'claude-opus-5-5' } });
    const s = node('start', 'Start');
    const rt = node('aiRouter', 'Route', { provider: prov.id, text: '{{input.text}}', routes: [{ k: 'billing', v: 'invoices' }, { k: 'technical', v: 'errors' }], mode: 'best match' });
    const sm = node('aiSummarize', 'Sum', { provider: prov.id, text: '{{input.input.text}}', style: 'paragraph', length: 30 });
    const tr = node('aiTranslate', 'Tr', { provider: prov.id, text: 'नमस्ते', to: 'English', from: 'detect' });
    const se = node('aiSentiment', 'Feel', { provider: prov.id, text: '{{trigger.text}}' });
    const neg = node('log', 'Unhappy', { message: 'negative' });
    const r = await run([s, rt, sm, tr, se, neg], [edge(s, rt), edge(rt, sm, 'billing'), edge(sm, tr), edge(tr, se), edge(se, neg, 'negative')], { text: 'My invoice 42 is wrong, refund me!' });
    assert.equal(r.status, 'done', r.error);
    assert.deepEqual(r.state.outputs.Route.routes, ['billing']);
    assert.match(r.state.outputs.Sum.summary, /refund/);
    assert.equal(r.state.outputs.Sum.words, 7);
    assert.equal(r.state.outputs.Tr.text, 'Hello');
    assert.equal(r.state.outputs.Tr.from, 'Hindi');
    assert.equal(r.state.outputs.Feel.sentiment, 'negative');
    assert.ok(r.state.outputs.Unhappy);
  } finally { await cap.close(); }
});
