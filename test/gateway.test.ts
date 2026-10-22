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
import { Agent, request } from 'undici';
import { SignJWT } from 'jose';
import { generate } from 'selfsigned';
import { createRequire } from 'node:module';
import { testEnv, captureServer, node, edge } from './helpers.js';

const env = testEnv(18210);
const { boot } = await import('../server/src/index.js');
const { engine, runState } = await import('../server/src/engine/engine.js');
const { q } = await import('../server/src/db.js');
const { setSecret } = await import('../server/src/secrets.js');
const { saveResource } = await import('../server/src/resources.js');
const flows = await import('../server/src/flows.js');
const projects = await import('../server/src/projects.js');
const tls = await import('../server/src/gateway/tls.js');
const gw = await import('../server/src/gateway/gateway.js');

let srv: Awaited<ReturnType<typeof boot>>;
before(async () => { srv = await boot({ listenAdmin: false }); });
after(async () => { await srv.stop(); });

function deployFlow(name: string, nodes: any[], edges: any[], projectId?: string) {
  const f = flows.saveFlow(undefined, { name, nodes, edges }, projectId);
  flows.deploy(f.id);
  return f;
}

test('gateway starter settings resolve project variables before routes are published', async () => {
  const pid = projects.saveProject({ name: `Gateway variables ${Date.now()}`, config: { variables: [
    { name: 'API_PATH', type: 'string', value: '/variable-route' },
    { name: 'BODY_KB', type: 'number', value: '8' },
  ] } }).id;
  const t = node('restService', 'Variable API', { method: 'POST', path: '{{gv.API_PATH}}', maxBodyKb: '{{gv.BODY_KB}}' });
  const r = node('httpResponse', 'Reply', { status: '200', contentType: 'application/json', body: '{"ok":true}' });
  const f = deployFlow('Variable route', [t, r], [edge(t, r)], pid);
  try {
    const route = gw.apiRoutes().find((x: any) => x.flowId === f.id)!;
    assert.equal(route.path, '/variable-route');
    assert.equal(route.node.config.maxBodyKb, 8);
    const res = await fetch(`${env.http}/variable-route`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(res.status, 200);
  } finally { flows.undeploy(f.id); }
});
async function runFlow(nodes: any[], edges: any[]) {
  const id = await engine.startRun({ doc: { name: 'Client', nodes, edges } });
  await engine.waitFor(id, 20000);
  const r: any = q.get('select * from runs where id = ?', id);
  return { status: r.status, error: r.error, outputs: runState(r.id)!.outputs };
}

test('REST service with API key policy, path params, JSON reply and rate limit', async () => {
  setSecret('PARTNER_KEY', 'k-123456789');
  const pol = saveResource({ kind: 'inboundPolicy', name: 'Partner keys', config: { auth: 'apiKey', apiKeyHeader: 'X-API-Key', apiKeySecrets: ['PARTNER_KEY'], requireHttps: false, rateLimitPerMinute: 3 } });
  const t = node('restService', 'Order API', { method: 'POST', path: '/orders/:id', policy: pol.id });
  const m = node('mapper', 'Map', { map: [{ k: 'orderId', v: '{{input.params.id}}' }, { k: 'qty', v: '{{input.body.qty | number}}' }, { k: 'caller', v: '{{input.auth.subject}}' }] });
  const r = node('httpResponse', 'Reply', { status: '201', contentType: 'application/json', body: '{{input}}', headers: [{ k: 'X-Order', v: '{{input.orderId}}' }] });
  deployFlow('Orders REST', [t, m, r], [edge(t, m), edge(m, r)]);

  const call = (key?: string) => fetch(`${env.http}/orders/A-42`, { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { 'x-api-key': key } : {}) }, body: '{"qty":"3"}' });
  assert.equal((await call()).status, 401);
  assert.equal((await call('wrong')).status, 401);
  const ok = await call('k-123456789');
  assert.equal(ok.status, 201);
  assert.equal(ok.headers.get('x-order'), 'A-42');
  assert.ok(ok.headers.get('x-sutra-run'));
  assert.deepEqual(await ok.json(), { orderId: 'A-42', qty: 3, caller: 'PARTNER_KEY' });
  await call('k-123456789');
  await call('k-123456789');
  const limited = await call('k-123456789');
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get('retry-after'));
  assert.equal((await fetch(`${env.http}/orders/A-42`, { method: 'DELETE' })).status, 405);
  assert.equal((await fetch(`${env.http}/nothing`)).status, 404);
});

test('REST service with JWT (HS256) policy, issuer, audience and scopes', async () => {
  setSecret('JWT_SECRET', 'a-long-shared-secret-for-tests-0123456789');
  const pol = saveResource({ kind: 'inboundPolicy', name: 'JWT', config: { auth: 'jwt', jwtMode: 'sharedSecret', jwtSecret: 'JWT_SECRET', jwtIssuer: 'https://idp.test', jwtAudience: 'sutra', jwtScopes: 'orders:read', requireHttps: false, rateLimitPerMinute: 0 } });
  const t = node('restService', 'Who', { method: 'GET', path: '/whoami', policy: pol.id });
  const r = node('httpResponse', 'Reply', { status: '200', contentType: 'application/json', body: '{"sub":"{{input.auth.subject}}"}' });
  deployFlow('JWT REST', [t, r], [edge(t, r)]);
  const key = new TextEncoder().encode('a-long-shared-secret-for-tests-0123456789');
  const tok = (scope: string, aud = 'sutra') => new SignJWT({ scope }).setProtectedHeader({ alg: 'HS256' }).setSubject('client-7').setIssuer('https://idp.test').setAudience(aud).setExpirationTime('5m').sign(key);
  const call = async (t?: string) => fetch(`${env.http}/whoami`, { headers: t ? { authorization: `Bearer ${t}` } : {} });
  assert.equal((await call()).status, 401);
  assert.equal((await call(await tok('orders:read', 'other'))).status, 401);
  assert.equal((await call(await tok('orders:write'))).status, 403);
  const ok = await call(await tok('orders:read profile'));
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { sub: 'client-7' });
});

test('SOAP service with WS-Security UsernameToken, called by the SOAP palette from its WSDL', async () => {
  setSecret('SOAP_USER_PW', 's0ap-Pass-word');
  const pol = saveResource({ kind: 'inboundPolicy', name: 'SOAP users', config: { auth: 'wssUsernameToken', users: [{ k: 'erp', v: 'SOAP_USER_PW' }], requireHttps: false, rateLimitPerMinute: 0 } });
  const t = node('soapService', 'Order WS', { serviceName: 'OrderService', namespace: 'urn:sutra:orders', path: '/soap/orders', operations: 'GetOrder, CancelOrder', soapVersion: '1.1', policy: pol.id });
  const reply = node('soapReply', 'Reply', { kind: 'response', body: '{"OrderId": "{{input.body.OrderId}}", "Status": "SHIPPED", "Caller": "{{input.auth.subject}}"}' });
  const fault = node('soapReply', 'Cancel fault', { kind: 'fault', faultCode: 'soap:Client', faultString: 'Order {{input.body.OrderId}} cannot be cancelled' });
  deployFlow('Orders SOAP', [t, reply, fault], [edge(t, reply, 'GetOrder'), edge(t, fault, 'CancelOrder')]);

  const wsdl = await (await fetch(`${env.http}/soap/orders?wsdl`)).text();
  assert.match(wsdl, /<operation name="GetOrder">/);
  assert.ok(wsdl.includes(`soap:address location="${env.http}/soap/orders"`), 'WSDL address');

  const goodAuth = saveResource({ kind: 'outboundAuth', name: 'ERP digest', config: { type: 'wssUsernameToken', username: 'erp', passwordSecret: 'SOAP_USER_PW', passwordType: 'PasswordDigest', timestamp: 300 } });
  setSecret('BAD_PW', 'nope-nope-nope');
  const badAuth = saveResource({ kind: 'outboundAuth', name: 'ERP bad', config: { type: 'wssUsernameToken', username: 'erp', passwordSecret: 'BAD_PW', passwordType: 'PasswordText', timestamp: 0 } });

  const client = (authId: string, op = 'GetOrder') => {
    const s = node('start', 'Start', { payload: '{"orderId":"A-77"}' });
    const inv = node('soapInvoke', 'Call SOAP', { mode: 'wsdl', wsdlUrl: `${env.http}/soap/orders?wsdl`, operation: op, auth: authId, args: '{"OrderId": "{{input.orderId}}"}' });
    const onFault = node('log', 'Fault', { message: '{{input.fault.message}}' });
    return runFlow([s, inv, onFault], [edge(s, inv), edge(inv, onFault, 'fault')]);
  };

  const ok = await client(goodAuth.id);
  assert.equal(ok.status, 'done', ok.error);
  assert.equal(String(ok.outputs['Call SOAP'].body.OrderId), 'A-77');
  assert.equal(ok.outputs['Call SOAP'].body.Status, 'SHIPPED');
  assert.equal(ok.outputs['Call SOAP'].body.Caller, 'erp');

  const denied = await client(badAuth.id);
  assert.equal(denied.status, 'done');
  assert.match(denied.outputs['Call SOAP'].fault.message, /Invalid username or password/);

  const cancel = await client(goodAuth.id, 'CancelOrder');
  assert.match(cancel.outputs['Call SOAP'].fault.message, /A-77 cannot be cancelled/);
});

test('SOAP replay protection: the same digest nonce is refused twice', async () => {
  const crypto = await import('node:crypto');
  const { passwordDigest, NS } = await import('../server/src/security/wss.js');
  const nonce = crypto.randomBytes(16).toString('base64');
  const created = new Date().toISOString();
  const env12 = `<s:Envelope xmlns:s="${NS.soap11}"><s:Header><wsse:Security xmlns:wsse="${NS.wsse}" xmlns:wsu="${NS.wsu}"><wsse:UsernameToken><wsse:Username>erp</wsse:Username><wsse:Password Type="${NS.pwDigest}">${passwordDigest(nonce, created, 's0ap-Pass-word')}</wsse:Password><wsse:Nonce>${nonce}</wsse:Nonce><wsu:Created>${created}</wsu:Created></wsse:UsernameToken></wsse:Security></s:Header><s:Body><GetOrder xmlns="urn:sutra:orders"><OrderId>R1</OrderId></GetOrder></s:Body></s:Envelope>`;
  const post = () => fetch(`${env.http}/soap/orders`, { method: 'POST', headers: { 'content-type': 'text/xml', soapaction: '"urn:sutra:orders/GetOrder"' }, body: env12 });
  const first = await post();
  assert.equal(first.status, 200, await first.clone().text());
  assert.match(await first.text(), /<GetOrderResponse xmlns="urn:sutra:orders"><OrderId>R1<\/OrderId>/);
  const second = await post();
  assert.equal(second.status, 401);
  assert.match(await second.text(), /replay/);
});

test('outbound SAML token and X.509 signature are placed in wsse:Security', async () => {
  const cap = await captureServer(() => ({ headers: { 'content-type': 'text/xml' }, body: `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><PingResponse><Ok>true</Ok></PingResponse></soap:Body></soap:Envelope>` }));
  try {
    const saml = '<saml2:Assertion xmlns:saml2="urn:oasis:names:tc:SAML:2.0:assertion" ID="_a1" Version="2.0" IssueInstant="2026-10-13T00:00:00Z"><saml2:Issuer>https://sts.test</saml2:Issuer><saml2:Subject><saml2:NameID>erp-service</saml2:NameID></saml2:Subject></saml2:Assertion>';
    setSecret('SAML_ASSERTION', saml);
    setSecret('SAML_PW', 'saml-user-pw');
    const samlAuth = saveResource({ kind: 'outboundAuth', name: 'SAML', config: { type: 'wssSaml', samlSource: 'secret', samlSecret: 'SAML_ASSERTION', samlWithUsername: true, username: 'erp', passwordSecret: 'SAML_PW', passwordType: 'PasswordText', timestamp: 300 } });
    const pems = await generate([{ name: 'commonName', value: 'erp-signer' }], { keySize: 2048, algorithm: 'sha256' } as any);
    setSecret('SIGN_KEY', pems.private);
    const x509 = saveResource({ kind: 'outboundAuth', name: 'Signer', config: { type: 'wssX509', certPem: pems.cert, keySecret: 'SIGN_KEY', signatureAlgorithm: 'rsa-sha256', timestamp: 300 } });

    const call = (authId: string) => {
      const s = node('start', 'Start', { payload: '{}' });
      const inv = node('soapInvoke', 'Ping', { mode: 'raw envelope', endpoint: cap.url + '/ws', soapVersion: '1.1', soapAction: 'urn:ping', bodyXml: '<p:Ping xmlns:p="urn:p"><p:Id>1</p:Id></p:Ping>', auth: authId });
      return runFlow([s, inv], [edge(s, inv)]);
    };
    const a = await call(samlAuth.id);
    assert.equal(a.status, 'done', a.error);
    assert.equal(a.outputs.Ping.body.PingResponse.Ok, true);
    const sent = cap.seen[0];
    assert.equal(sent.headers.soapaction, '"urn:ping"');
    assert.match(sent.body, /<wsse:Security[^>]*soapenv:mustUnderstand="1"[^>]*>.*<saml2:Assertion .*<\/saml2:Assertion><wsse:UsernameToken/s);
    assert.match(sent.body, /<wsu:Timestamp/);

    const b = await call(x509.id);
    assert.equal(b.status, 'done', b.error);
    const signed = cap.seen[1].body;
    assert.match(signed, /<wsse:BinarySecurityToken[^>]*X509v3/);
    assert.match(signed, /<ds:Signature[\s\S]*<ds:Reference URI="#[^"]+"/);
    // Verify the signature with xml-crypto, as a receiving service would.
    const require = createRequire(import.meta.url);
    const { SignedXml } = require('xml-crypto');
    const { DOMParser } = require('@xmldom/xmldom');
    const doc = new DOMParser().parseFromString(signed, 'text/xml');
    const sigNode = doc.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'Signature')[0];
    const v = new SignedXml({ publicCert: pems.cert, idMode: 'wssecurity' });
    v.loadSignature(sigNode);
    assert.ok(v.checkSignature(signed), 'signature verifies: ' + (v.validationErrors || []).join(','));
  } finally { await cap.close(); }
});

test('HTTPS gateway with self-signed certificate and Require HTTPS policy', async () => {
  await tls.makeSelfSigned(['localhost']);
  tls.setTls({ mode: 'selfSigned' });
  await gw.startGateway();
  assert.ok(gw.gatewayStatus.https, gw.gatewayStatus.error);
  const pol = saveResource({ kind: 'inboundPolicy', name: 'Open over TLS', config: { auth: 'none', requireHttps: true, rateLimitPerMinute: 0, ipAllow: ['127.0.0.1', '::1'] } });
  const t = node('restService', 'Ping', { method: 'GET', path: '/secure/ping', policy: pol.id });
  const r = node('httpResponse', 'Reply', { status: '200', contentType: 'text/plain', body: 'pong' });
  deployFlow('Secure ping', [t, r], [edge(t, r)]);
  // The gateway restarted, so use a fresh connection rather than fetch's pooled keep-alive socket.
  const plain = await request(`${env.http}/secure/ping`, { dispatcher: new Agent() });
  assert.equal(plain.statusCode, 403);
  await plain.body.text();
  const res = await request(`${env.https}/secure/ping`, { dispatcher: new Agent({ connect: { rejectUnauthorized: false } }) });
  assert.equal(res.statusCode, 200);
  assert.equal(await res.body.text(), 'pong');
  const info: any = tls.certInfo();
  assert.equal(info.source, 'self-signed');
  assert.ok(info.daysLeft > 300);
});

test('ACME challenges are shared through storage and issuance is leased across engines', async () => {
  await tls.putAcmeChallenge('shared-token', 'shared-key-authorization', 'engine-a');
  const challenge = await fetch(`${env.http}/.well-known/acme-challenge/shared-token`);
  assert.equal(challenge.status, 200);
  assert.equal(await challenge.text(), 'shared-key-authorization');

  await tls.putAcmeChallenge('expired-token', 'expired', 'engine-a', Date.now() - 1);
  assert.equal((await fetch(`${env.http}/.well-known/acme-challenge/expired-token`)).status, 404);
  await tls.removeAcmeChallenge('shared-token');
  assert.equal((await fetch(`${env.http}/.well-known/acme-challenge/shared-token`)).status, 404);

  assert.equal(await tls.claimAcmeLease('engine-a'), true);
  assert.equal(await tls.claimAcmeLease('engine-b'), false);
  await tls.releaseAcmeLease('engine-a');
  assert.equal(await tls.claimAcmeLease('engine-b'), true);
  await tls.releaseAcmeLease('engine-b');
});

test('deploy refuses a path already served by another Sutra', () => {
  const t = node('restService', 'Clash', { method: 'POST', path: '/orders/:orderId' });
  const f = flows.saveFlow(undefined, { name: 'Clash', nodes: [t], edges: [] });
  assert.throws(() => flows.deploy(f.id), /already served/);
});
