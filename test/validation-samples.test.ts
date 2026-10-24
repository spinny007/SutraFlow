/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 2.0.7
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { SignJWT } from 'jose';
import { testEnv, node, edge } from './helpers.js';
const env = testEnv(22830);
const { boot } = await import('../server/src/index.js');
const { engine, runState } = await import('../server/src/engine/engine.js');
const { q } = await import('../server/src/db.js');
const { saveProject } = await import('../server/src/projects.js');
const { addSamples, SAMPLES } = await import('../server/src/samples.js');
const { getFlow, validateDoc, deploy, saveFlow } = await import('../server/src/flows.js');
const { saveResource } = await import('../server/src/resources.js');
const { setSecret } = await import('../server/src/secrets.js');
const { listSchemas, getSchema, saveSchema } = await import('../server/src/schemas.js');
let srv: Awaited<ReturnType<typeof boot>>, projectId: string;
let samples: ReturnType<typeof addSamples>;
before(async () => {
  srv = await boot({ listenAdmin: false });
  projectId = saveProject({ name: 'Validation samples release gate', config: { variables: [{ name: 'VALIDATION_FOLDER', type: 'string', value: path.join(env.dir, 'validation-fixtures') }] } }).id;
  samples = addSamples(projectId, ['validation', 'mappingtyped']);
});
after(async () => { await srv.stop(); });
const doc = (name: string) => getFlow(samples.find(s => s.name === name)!.id)!.doc;
async function run(document: ReturnType<typeof doc>) {
  const id = await engine.startRun({ projectId, doc: document });
  await engine.waitFor(id, 10000);
  return { id, ...q.get<any>('select status,error from runs where id = ?', id), outputs: runState(id)!.outputs };
}

test('validation catalogue covers new activities, explicit strict reads and described, reusable contracts', () => {
  assert.ok(SAMPLES.some(s => s.id === 'validation'));
  assert.equal(samples.length, 13, 'ten validation examples plus three manual/typed mapping examples');
  const types = new Set<string>();
  for (const sample of samples) {
    const flow = getFlow(sample.id)!.doc;
    assert.ok(flow.description && flow.description.length > 40, flow.name);
    assert.deepEqual(validateDoc(flow, projectId).errors, [], flow.name);
    for (const n of flow.nodes) {
      types.add(n.type);
      assert.ok(n.description && n.description.length > 20, `${flow.name}: ${n.name}`);
      if (n.type === 'fileRead') { assert.equal(n.config.strictValidation, true); assert.ok(n.config.schema); }
    }
  }
  for (const type of ['mapperJson', 'mapperXml', 'parseJson', 'parseXml', 'renderJson', 'renderXml', 'validate', 'fileRead', 'fileWrite', 'httpRequest', 'httpResponse', 'restService', 'soapService']) assert.ok(types.has(type), type);
  const before = listSchemas(projectId);
  const schema = getSchema(before.find(s => s.name === 'Sample validation — Customer JSON')!.id)!;
  const changed = JSON.parse(schema.text); changed.description = 'Administrator-owned edit retained on reimport';
  saveSchema({ ...schema, root: schema.root || undefined, text: JSON.stringify(changed) });
  addSamples(projectId, ['validation', 'mappingtyped']);
  assert.equal(listSchemas(projectId).length, before.length, 'reimport reuses schemas');
  assert.equal(JSON.parse(getSchema(schema.id)!.text).description, changed.description, 'never overwrite user-edited contracts');
});

test('every connection-free validation and mapping sample runs; rejection samples take their expected invalid branch', async () => {
  for (const sample of samples) {
    const flow = getFlow(sample.id)!.doc;
    if (flow.nodes.some(n => ['httpRequest', 'restService', 'soapService'].includes(n.type))) continue;
    const result = await run(flow);
    assert.equal(result.status, 'done', `${flow.name}: ${result.error}`);
    if (!flow.name.includes('expected rejection')) for (const n of flow.nodes.filter(n => n.type === 'validate')) assert.notEqual(result.outputs[n.name]?.valid, false, `${flow.name}: ${JSON.stringify(result.outputs[n.name]?.problems)}`);
    if (flow.name.includes('expected rejection')) {
      assert.equal(result.outputs['Check contract'].valid, false, flow.name);
      assert.ok(result.outputs['Check contract'].problems.length > 0);
      assert.equal(result.outputs['Unexpected acceptance'], undefined);
    }
    if (flow.name.includes('Read JSON')) assert.equal(result.outputs['Strict file read'].data.id, 'A-12');
    if (flow.name.includes('Read XML')) assert.equal(result.outputs['Strict file read'].data.User.Code, 'AB-12');
    if (flow.name.includes('JSON schema validation pipeline')) assert.equal(JSON.parse(result.outputs['Render validated JSON'].text).amount, 12.5);
    if (flow.name.includes('XML schema validation pipeline')) assert.match(result.outputs['Render validated XML'].text, /urn:sutra:validation/);
    if (flow.name.includes('XML schema-backed mapping')) assert.match(result.outputs['Render receipt XML'].text, /<Amount>12.5<\/Amount>/);
  }
});

test('sample file read checkbox rejects invalid JSON/XML only when checked, including missing and mismatched contracts', async () => {
  for (const format of ['JSON', 'XML']) {
    const template = doc(`Sample: Read ${format} file with schema validation`).nodes.find(n => n.type === 'fileRead')!;
    const filename = format === 'JSON' ? 'customer.json' : 'customer.xml';
    const fixture = path.join(env.dir, 'validation-fixtures', filename);
    await fs.mkdir(path.dirname(fixture), { recursive: true });
    await fs.writeFile(fixture, format === 'JSON' ? '{}' : '<User xmlns="urn:sutra:validation"/>');
    for (const mode of ['on', 'off', 'missing', 'mismatch'] as const) {
      const start = node('start', 'Start', { payload: '{}' });
      const read = structuredClone(template);
      read.config.strictValidation = mode !== 'off';
      if (mode === 'missing') read.config.schema = '';
      if (mode === 'mismatch') read.config.schema = doc(`Sample: Read ${format === 'JSON' ? 'XML' : 'JSON'} file with schema validation`).nodes.find(n => n.type === 'fileRead')!.config.schema;
      const result = await run({ name: `${format} strict ${mode}`, nodes: [start, read], edges: [edge(start, read)] });
      assert.equal(result.status, mode === 'off' ? 'done' : 'failed', `${format} ${mode}: ${result.error}`);
      if (mode !== 'off') assert.match(result.error, /schema|XSD|JSON Schema/i);
    }
  }
});

test('sample REST/HTTP client and SOAP server enforce real ingress, egress, namespaces and no-run-on-invalid boundaries', async () => {
  const rest = samples.find(s => s.name === 'Sample: Validated REST service')!;
  const soap = samples.find(s => s.name === 'Sample: Validated SOAP service')!;
  deploy(rest.id); deploy(soap.id);
  const client = await run(doc('Sample: Validated HTTP client'));
  assert.equal(client.status, 'done', client.error);
  assert.equal(client.outputs['Call validated customer API'].status, 200);
  assert.equal(client.outputs['Call validated customer API'].body.id, 'A-12');
  const pipeline = doc('Sample: JSON schema validation pipeline');
  const customer = JSON.parse(JSON.parse(pipeline.nodes[0].config.payload).text);
  const validXml = JSON.parse(doc('Sample: XML schema validation pipeline').nodes[0].config.payload).xml;
  const envelope = (xml: string) => `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${xml}</soap:Body></soap:Envelope>`;
  const post = (url: string, body: string, type = 'application/json') => fetch(env.http + url, { method: 'POST', headers: { 'content-type': type }, body });
  const good = await post('/samples/validation/soap', envelope(validXml), 'text/xml');
  assert.equal(good.status, 200, await good.text());
  // Bad payloads must not create workflow runs. Check the durable counter, not just status codes.
  const count = q.get<any>('select count(*) n from runs').n;
  for (const bad of [{ ...customer, email: 'bad' }, { ...customer, tags: ['retail', 'retail'] }, { ...customer, amount: 101 }, { ...customer, extra: true }]) {
    const response = await post('/samples/validation/customer', JSON.stringify(bad));
    assert.equal(response.status, 400); await response.text();
  }
  for (const bad of [validXml.replace('urn:sutra:validation', 'urn:wrong'), validXml.replace('AB-12', 'bad'), validXml.replace('>20<', '>17<'), validXml.replace('<Active>true</Active>', '<Active>maybe</Active>'), validXml.replace('<Phone>555-0100</Phone>', '<Phone>1</Phone><Phone>2</Phone>')]) {
    const response = await post('/samples/validation/soap', envelope(bad), 'text/xml');
    assert.equal(response.status, 400); assert.match(await response.text(), /soap:Client/);
  }
  assert.equal(q.get<any>('select count(*) n from runs').n, count, 'invalid messages rejected before run creation');
  const badClient = structuredClone(doc('Sample: Validated HTTP client'));
  badClient.nodes[0].config.payload = JSON.stringify({ ...customer, amount: -1 });
  const bad = await run(badClient);
  assert.equal(bad.status, 'failed'); assert.match(bad.error, /HTTP request does not match/);
  assert.equal(q.get<any>('select count(*) n from runs').n, count + 1, 'invalid outgoing body creates only the client run, never a server run');
});

test('authorized invalid REST/SOAP callers receive relevant errors without a run; unauthorized callers get no schema details', async () => {
  const secret = 'sample-validation-jwt-test-secret-207-only';
  setSecret('SAMPLE_VALIDATION_JWT', secret);
  const policy = saveResource({ kind: 'inboundPolicy', name: 'Authenticated validation test', project_id: projectId, config: {
    auth: 'jwt', jwtMode: 'sharedSecret', jwtSecret: 'SAMPLE_VALIDATION_JWT', jwtIssuer: 'https://validation.test', jwtAudience: 'sutra-validation', jwtScopes: 'validation:submit', requireHttps: false, rateLimitPerMinute: 0,
  } });
  for (const [name, route] of [['Sample: Validated REST service', '/samples/authorized/rest'], ['Sample: Validated SOAP service', '/samples/authorized/soap']]) {
    const flow = structuredClone(doc(name));
    flow.name += ' authenticated test'; flow.nodes[0].config.path = route; flow.nodes[0].config.policy = policy.id;
    deploy(saveFlow(undefined, flow, projectId).id);
  }
  const token = (scope: string) => new SignJWT({ scope }).setProtectedHeader({ alg: 'HS256' }).setSubject('test-customer').setIssuer('https://validation.test').setAudience('sutra-validation').setExpirationTime('5m').sign(new TextEncoder().encode(secret));
  const permitted = await token('validation:submit'), forbidden = await token('other:scope');
  const json = JSON.parse(JSON.parse(doc('Sample: JSON schema validation pipeline').nodes[0].config.payload).text);
  const xml = JSON.parse(doc('Sample: XML schema validation pipeline').nodes[0].config.payload).xml;
  const wrap = (inner: string) => `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${inner}</soap:Body></soap:Envelope>`;
  const before = q.get<any>('select count(*) n from runs').n;
  for (const soap of [false, true]) {
    const url = env.http + (soap ? '/samples/authorized/soap' : '/samples/authorized/rest');
    const bad = soap ? wrap(xml.replace('AB-12', 'bad')) : JSON.stringify({ ...json, email: 'not-an-email' });
    const post = (body: string, bearer?: string) => fetch(url, { method: 'POST', headers: { 'content-type': soap ? 'text/xml' : 'application/json', ...(bearer ? { authorization: 'Bearer ' + bearer } : {}) }, body });
    for (const [bearer, status] of [[undefined, 401], [forbidden, 403]] as const) {
      const response = await post(bad, bearer);
      assert.equal(response.status, status);
      const text = await response.text();
      assert.doesNotMatch(text, /Schemas validity|does not match the schema|body\.email|facet.*pattern/i, 'unauthorized callers do not receive schema diagnostics');
    }
    const invalid = await post(bad, permitted);
    assert.equal(invalid.status, 400);
    if (soap) {
      const fault = await invalid.text();
      assert.match(fault, /soap:Client/); assert.match(fault, /Code|pattern/);
    } else {
      const error = await invalid.json() as any;
      assert.equal(error.error, 'The request does not match the schema');
      assert.ok(error.errors.some((e: string) => /email.*format/i.test(e)), JSON.stringify(error));
    }
  }
  assert.equal(q.get<any>('select count(*) n from runs').n, before, 'neither unauthorized nor authorized-invalid requests start a workflow');
});
