/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.8.0
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { testEnv, node, edge } from './helpers.js';

/**
 * Message validation and threat protection on the gateway (security/validate.ts): REST bodies against
 * a JSON Schema, a JSON sample and an XSD; SOAP operations against an XSD; and the policy's limits.
 */
const env = testEnv(20650);
const { boot } = await import('../server/src/index.js');
const { saveResource } = await import('../server/src/resources.js');
const schemas = await import('../server/src/schemas.js');
const { ensureDefaultProject } = await import('../server/src/projects.js');
const flows = await import('../server/src/flows.js');

let srv: Awaited<ReturnType<typeof boot>>;
before(async () => { srv = await boot({ listenAdmin: false }); });
after(async () => { await srv.stop(); });

function deployFlow(name: string, nodes: any[], edges: any[]) {
  const f = flows.saveFlow(undefined, { name, nodes, edges });
  flows.deploy(f.id);
  return f;
}
const post = (path: string, body: string, ct = 'application/json') => fetch(`${env.http}${path}`, { method: 'POST', headers: { 'content-type': ct }, body });

const XSD = `<?xml version="1.0"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="Order">
    <xs:complexType><xs:sequence>
      <xs:element name="Id" type="xs:string"/>
      <xs:element name="Qty" type="xs:int"/>
      <xs:element name="Status"><xs:simpleType><xs:restriction base="xs:string"><xs:enumeration value="open"/><xs:enumeration value="paid"/></xs:restriction></xs:simpleType></xs:element>
      <xs:element name="Line" maxOccurs="unbounded" minOccurs="0"><xs:complexType><xs:sequence><xs:element name="Sku" type="xs:string"/></xs:sequence></xs:complexType></xs:element>
      <xs:element name="Note" type="xs:string" minOccurs="0"/>
    </xs:sequence><xs:attribute name="currency" type="xs:string" use="required"/></xs:complexType>
  </xs:element>
  <xs:element name="GetOrder"><xs:complexType><xs:sequence><xs:element name="OrderId" type="xs:string"/><xs:element name="Detail" type="xs:boolean" minOccurs="0"/></xs:sequence></xs:complexType></xs:element>
</xs:schema>`;

test('REST bodies are checked against a JSON Schema, a JSON sample and an XSD before a run starts', async () => {
  const js = schemas.saveSchema({ project_id: ensureDefaultProject(), name: 'NewOrder', kind: 'json', text: JSON.stringify({
    $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', required: ['id', 'qty'], additionalProperties: false,
    properties: { id: { type: 'string', pattern: '^A-\\d+$' }, qty: { type: 'integer', minimum: 1 }, email: { type: 'string', format: 'email' } },
  }) });
  const sample = schemas.saveSchema({ project_id: ensureDefaultProject(), name: 'Sample', kind: 'json', text: '{"id": "A-1", "qty": 2, "lines": [{"sku": "X"}]}' });
  const xsd = schemas.saveSchema({ project_id: ensureDefaultProject(), name: 'Orders', kind: 'xsd', text: XSD });
  const ok = node('httpResponse', 'Reply', { status: '200', contentType: 'application/json', body: '{"ok": true}' });
  for (const [path, ref] of [['/v/json', js.id], ['/v/sample', sample.id], ['/v/xml', `${xsd.id}::Order`]] as const) {
    const t = node('restService', `In ${path}`, { method: 'POST', path, bodySchema: ref, validateBody: 'reject invalid' });
    deployFlow(`Validate ${path}`, [t, { ...ok, id: `${ok.id}${path}` }], [{ ...edge(t, ok), to: `${ok.id}${path}` }]);
  }
  // Off: the same schema, not enforced.
  const loose = node('restService', 'Loose', { method: 'POST', path: '/v/loose', bodySchema: js.id });
  deployFlow('Loose', [loose, { ...ok, id: 'ok-loose' }], [{ ...edge(loose, ok), to: 'ok-loose' }]);

  assert.equal((await post('/v/json', '{"id":"A-7","qty":3,"email":"a@b.co"}')).status, 200);
  const bad = await post('/v/json', '{"id":"B-7","qty":0,"email":"nope","extra":1}');
  assert.equal(bad.status, 400);
  const b = await bad.json();
  assert.equal(b.error, 'The request does not match the schema');
  assert.ok(b.errors.some((e: string) => /body\.id.*pattern/.test(e)), b.errors.join('\n'));
  assert.ok(b.errors.some((e: string) => /body\.qty.*>= 1/.test(e)));
  assert.ok(b.errors.some((e: string) => /body\.email.*format "email"/.test(e)));
  assert.ok(b.errors.some((e: string) => /additional properties \(extra\)/.test(e)));
  assert.match((await (await post('/v/json', '{"qty":1}')).json()).errors[0], /required property 'id'/);
  assert.equal((await post('/v/loose', '{"anything": true}')).status, 200, 'not enforced when validation is off');

  assert.equal((await post('/v/sample', '{"id":"A-9","qty":5,"lines":[{"sku":"X"}]}')).status, 200);
  assert.equal((await post('/v/sample', '{"id":"A-9","qty":5,"more":"not allowed"}')).status, 400, 'strict samples require shown fields and reject extras');
  const sb = await (await post('/v/sample', '{"id":"A-9","qty":"five","lines":{"sku":"X"}}')).json();
  assert.ok(sb.errors.some((e: string) => /lines.*array/.test(e)), sb.errors.join(';'));
  assert.ok(sb.errors.some((e: string) => /qty.*integer/.test(e)), sb.errors.join(';'));

  const good = '<?xml version="1.0"?><Order currency="EUR"><Id>A-1</Id><Qty>2</Qty><Status>paid</Status><Line><Sku>X</Sku></Line><Line><Sku>Y</Sku></Line></Order>';
  assert.equal((await post('/v/xml', good, 'application/xml')).status, 200);
  assert.equal((await post('/v/xml', '<Order currency="EUR"><Id>A-1</Id><Qty>2</Qty><Status>open</Status><Line><Sku>X</Sku></Line></Order>', 'application/xml')).status, 200, 'one element of a repeated kind');
  const xb = await (await post('/v/xml', '<Order><Id>A-1</Id><Id>A-2</Id><Qty>two</Qty><Status>lost</Status><Colour>red</Colour></Order>', 'application/xml')).json();
  assert.match(xb.errors.join(';'), /currency.*required/);
  assert.match(xb.errors.join(';'), /not expected/);
  // XSD validators can stop at the first invalid sequence particle. Exercise facets separately.
  for (const bad of [good.replace('<Qty>2</Qty>', '<Qty>two</Qty>'), good.replace('paid', 'lost'), good.replace('</Order>', '<Colour>red</Colour></Order>')]) {
    assert.equal((await post('/v/xml', bad, 'application/xml')).status, 400);
  }
  assert.match((await (await post('/v/xml', '<Invoice/>', 'application/xml')).json()).errors[0], /root element must be Order/);
});

test('SOAP operations are checked against their XSD element; a bad request gets a Client fault', async () => {
  const xsd = schemas.saveSchema({ project_id: ensureDefaultProject(), name: 'OrderOps', kind: 'xsd', text: XSD.replace('<xs:schema ', '<xs:schema targetNamespace="urn:sutra:orders" elementFormDefault="qualified" ') });
  const t = node('soapService', 'Checked WS', { serviceName: 'OrderService', namespace: 'urn:sutra:orders', path: '/soap/checked', operations: 'GetOrder', soapVersion: '1.1', bodySchema: xsd.id, validateBody: 'reject invalid' });
  const reply = node('soapReply', 'Reply', { kind: 'response', body: '{"OrderId": "{{input.body.OrderId}}"}' });
  deployFlow('Checked SOAP', [t, reply], [edge(t, reply, 'GetOrder')]);
  const env1 = (inner: string) => `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><o:GetOrder xmlns:o="urn:sutra:orders">${inner}</o:GetOrder></soap:Body></soap:Envelope>`;
  const good = await post('/soap/checked', env1('<o:OrderId>A-1</o:OrderId><o:Detail>true</o:Detail>'), 'text/xml');
  assert.equal(good.status, 200);
  assert.match(await good.text(), /<OrderId>A-1<\/OrderId>/);
  const bad = await post('/soap/checked', env1('<o:Detail>maybe</o:Detail><o:Extra/>'), 'text/xml');
  assert.equal(bad.status, 400);
  const fault = await bad.text();
  assert.match(fault, /<faultcode>soap:Client<\/faultcode>/);
  assert.match(fault, /OrderId/);
  for (const inner of ['<o:OrderId>A-1</o:OrderId><o:Detail>maybe</o:Detail>', '<o:OrderId>A-1</o:OrderId><o:Extra/>']) {
    assert.equal((await post('/soap/checked', env1(inner), 'text/xml')).status, 400);
  }
  assert.equal((await post('/soap/checked', env1('<o:OrderId>A-1</o:OrderId>').replace('urn:sutra:orders', 'urn:wrong'), 'text/xml')).status, 400, 'namespace mismatches are rejected');
});

test('threat protection: depth before parsing, DOCTYPE, fields, list items, text length and body size', async () => {
  const pol = saveResource({ kind: 'inboundPolicy', name: 'Tight', config: { auth: 'none', requireHttps: false, rateLimitPerMinute: 0, maxDepth: 5, maxFields: 20, maxItems: 10, maxStringKb: 1, maxBodyKb: 8 } });
  const t = node('restService', 'Guarded', { method: 'POST', path: '/guarded', policy: pol.id, maxBodyKb: 1024 });
  const ok = node('httpResponse', 'Reply', { status: '200', contentType: 'application/json', body: '{"ok": true}' });
  deployFlow('Guarded', [t, ok], [edge(t, ok)]);
  const err = async (body: string, ct = 'application/json') => { const r = await post('/guarded', body, ct); return { status: r.status, error: (await r.json()).error as string }; };

  assert.equal((await post('/guarded', '{"a":{"b":[1,2,3]},"s":"x"}')).status, 200);
  assert.deepEqual(await err('{"a":{"b":{"c":{"d":{"e":{"f":1}}}}}}'), { status: 400, error: 'The message is nested deeper than 5 levels' });
  assert.equal((await post('/guarded', `{"s":"${'[{'.repeat(10)}\\"]}"}`)).status, 200, 'brackets and escaped quotes inside strings do not count');
  assert.deepEqual(await err('<a><b><c><d><e><f>1</f></e></d></c></b></a>', 'application/xml'), { status: 400, error: 'The message is nested deeper than 5 levels' });
  assert.deepEqual(await err('<?xml version="1.0"?><!DOCTYPE lol [<!ENTITY a "aaaa">]><r>&a;</r>', 'application/xml'), { status: 400, error: 'XML with a DOCTYPE is not accepted (entity declarations are refused)' });
  assert.deepEqual(await err(JSON.stringify(Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`k${i}`, i])))), { status: 400, error: 'The message has more than 20 fields' });
  assert.deepEqual(await err(JSON.stringify({ l: Array.from({ length: 11 }, (_, i) => i) })), { status: 400, error: 'A list has more than 10 items' });
  assert.deepEqual(await err(JSON.stringify({ s: 'x'.repeat(1100) })), { status: 400, error: 'A text value is longer than 1 KB' });
  assert.deepEqual(await err(JSON.stringify({ s: 'x'.repeat(900), t: 'y'.repeat(900), u: 'z'.repeat(900), v: 'w'.repeat(900), w: 'v'.repeat(900), x: 'u'.repeat(900), y: 'q'.repeat(900), z: 'p'.repeat(900), a: 'o'.repeat(900), b: 'n'.repeat(900) })), { status: 413, error: 'Body is larger than 8 KB' });
  // Without a policy the generous defaults apply: depth 64.
  const open = node('restService', 'Open', { method: 'POST', path: '/open' });
  deployFlow('Open', [open, { ...ok, id: 'ok-open' }], [{ ...edge(open, ok), to: 'ok-open' }]);
  assert.equal((await post('/open', `${'['.repeat(60)}${']'.repeat(60)}`)).status, 200);
  assert.equal((await post('/open', `${'['.repeat(70)}${']'.repeat(70)}`)).status, 400);
});
