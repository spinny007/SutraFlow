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
import { generate } from 'selfsigned';
import { SignedXml } from 'xml-crypto';
import { testEnv, node, edge } from './helpers.js';

/**
 * WS-Security on SOAP services (security/wssin.ts): requests signed with X.509, SAML assertions,
 * timestamps, and XML encryption both ways, against real certificates.
 */
const env = testEnv(20750);
const { boot } = await import('../server/src/index.js');
const { setSecret } = await import('../server/src/secrets.js');
const { saveResource } = await import('../server/src/resources.js');
const flows = await import('../server/src/flows.js');
const { engine, runState } = await import('../server/src/engine/engine.js');
const { applyWss } = await import('../server/src/security/wss.js');
const { encryptBody, decryptMessage } = await import('../server/src/security/wssin.js');

let srv: Awaited<ReturnType<typeof boot>>;
before(async () => { srv = await boot({ listenAdmin: false }); });
after(async () => { await srv.stop(); });

const cert = (cn: string, ca?: { key: string; cert: string }) => generate([{ name: 'commonName', value: cn }], { keySize: 2048, algorithm: 'sha256', ...(ca ? { ca } : {}) } as any);
const ca = await generate([{ name: 'commonName', value: 'Partner CA' }], { keySize: 2048, algorithm: 'sha256', extensions: [{ name: 'basicConstraints', cA: true, critical: true }, { name: 'keyUsage', keyCertSign: true, cRLSign: true, digitalSignature: true, critical: true }] } as any);
const client = await cert('erp-client', { key: ca.private, cert: ca.cert });
const stranger = await cert('stranger');
const idp = await cert('idp.example');
const server = await cert('orders.sutra');

let n = 0;
function service(path: string, policy: Record<string, any>) {
  const pol = saveResource({ kind: 'inboundPolicy', name: `WSS ${++n}`, config: { requireHttps: false, rateLimitPerMinute: 0, ...policy } });
  const t = node('soapService', `WS ${n}`, { serviceName: 'OrderService', namespace: 'urn:sutra:orders', path, operations: 'GetOrder', soapVersion: '1.1', policy: pol.id });
  const reply = node('soapReply', 'Reply', { kind: 'response', body: '{"OrderId": "{{input.body.OrderId}}", "Caller": "{{input.auth.subject}}", "Method": "{{input.auth.method}}"}' });
  const f = flows.saveFlow(undefined, { name: `WSS service ${n}`, nodes: [t, reply], edges: [edge(t, reply, 'GetOrder')] });
  flows.deploy(f.id);
}
const envelope = (id = 'A-1') => `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Header/><soapenv:Body><o:GetOrder xmlns:o="urn:sutra:orders"><o:OrderId>${id}</o:OrderId></o:GetOrder></soapenv:Body></soapenv:Envelope>`;
const send = async (path: string, xml: string) => { const r = await fetch(`${env.http}${path}`, { method: 'POST', headers: { 'content-type': 'text/xml; charset=utf-8' }, body: xml }); return { status: r.status, text: await r.text() }; };
const fault = (t: string) => (/<faultstring>([^<]*)<\/faultstring>/.exec(t)?.[1] || t).replace(/&(apos|quot|lt|gt|amp);/g, (_, e) => ({ apos: "'", quot: '"', lt: '<', gt: '>', amp: '&' } as Record<string, string>)[e]);
const x509 = (k: { private: string; cert: string }) => ({ keyPem: k.private, certPem: k.cert });

test('X.509 signed requests: a certificate issued by a trusted CA passes; untrusted, changed or unsigned ones do not', async () => {
  service('/soap/x509', { auth: 'wssX509', trustedCertsPem: ca.cert, wssTimestamp: 'required' });
  const ok = await send('/soap/x509', applyWss(envelope(), { x509: x509(client), timestampTtlSec: 300 }));
  assert.equal(ok.status, 200, ok.text);
  assert.match(ok.text, /<OrderId>A-1<\/OrderId><Caller>erp-client<\/Caller><Method>wssX509<\/Method>/);

  const untrusted = await send('/soap/x509', applyWss(envelope(), { x509: x509(stranger), timestampTtlSec: 300 }));
  assert.equal(untrusted.status, 401);
  assert.equal(fault(untrusted.text), 'The certificate of stranger is not trusted by this service');

  const changed = applyWss(envelope('A-1'), { x509: x509(client), timestampTtlSec: 300 }).replace('<o:OrderId>A-1<', '<o:OrderId>A-999<');
  assert.match(fault((await send('/soap/x509', changed)).text), /The signature is not valid/);

  assert.equal(fault((await send('/soap/x509', applyWss(envelope(), { timestampTtlSec: 300 }))).text), 'The message is not signed');
  assert.equal(fault((await send('/soap/x509', applyWss(envelope(), { x509: x509(client) }))).text), 'A WS-Security Timestamp is required');

  // Signature wrapping: a second Body with the signed one moved away is refused.
  const signed = applyWss(envelope('A-1'), { x509: x509(client), timestampTtlSec: 300 });
  const wrapped = signed.replace('</soapenv:Envelope>', '<soapenv:Body><o:GetOrder xmlns:o="urn:sutra:orders"><o:OrderId>EVIL</o:OrderId></o:GetOrder></soapenv:Body></soapenv:Envelope>');
  assert.equal(fault((await send('/soap/x509', wrapped)).text), 'The SOAP envelope must have exactly one Body');

  // Allowed subjects narrow the trusted certificates.
  service('/soap/x509-only', { auth: 'wssX509', trustedCertsPem: ca.cert, x509AllowedSubjects: ['billing-client'] });
  assert.equal(fault((await send('/soap/x509-only', applyWss(envelope(), { x509: x509(client), timestampTtlSec: 300 }))).text), 'Certificate subject erp-client is not allowed');
});

/** A SAML 2.0 assertion signed by the identity provider. */
function assertion(o: { nameId?: string; issuer?: string; audience?: string; notOnOrAfter?: Date; key?: string; cert?: string } = {}) {
  const now = Date.now();
  const iso = (d: Date) => d.toISOString();
  const xml = `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_a${now}${Math.random().toString(16).slice(2)}" Version="2.0" IssueInstant="${iso(new Date(now))}">`
    + `<saml:Issuer>${o.issuer || 'https://idp.example'}</saml:Issuer><saml:Subject><saml:NameID>${o.nameId || 'buyer@partner.example'}</saml:NameID></saml:Subject>`
    + `<saml:Conditions NotBefore="${iso(new Date(now - 60000))}" NotOnOrAfter="${iso(o.notOnOrAfter || new Date(now + 600000))}"><saml:AudienceRestriction><saml:Audience>${o.audience || 'urn:sutra:orders'}</saml:Audience></saml:AudienceRestriction></saml:Conditions>`
    + `<saml:AttributeStatement><saml:Attribute Name="role"><saml:AttributeValue>buyer</saml:AttributeValue></saml:Attribute></saml:AttributeStatement></saml:Assertion>`;
  const sig = new SignedXml({ privateKey: o.key || idp.private, publicCert: o.cert || idp.cert, signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256', canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#' });
  sig.addReference({ xpath: "//*[local-name(.)='Assertion']", digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256', transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'] });
  sig.computeSignature(xml, { location: { reference: "//*[local-name(.)='Issuer']", action: 'after' } });
  return sig.getSignedXml();
}

test('SAML assertions: signed by the identity provider, from the right issuer, for this audience, in time', async () => {
  service('/soap/saml', { auth: 'wssSaml', samlIdpCertPem: idp.cert, samlIssuer: 'https://idp.example', samlAudience: 'urn:sutra:orders' });
  const ok = await send('/soap/saml', applyWss(envelope(), { samlAssertion: assertion(), timestampTtlSec: 300 }));
  assert.equal(ok.status, 200, ok.text);
  assert.match(ok.text, /<Caller>buyer@partner.example<\/Caller><Method>wssSaml<\/Method>/);
  const no = async (a: string) => fault((await send('/soap/saml', applyWss(envelope(), { samlAssertion: a }))).text);
  assert.equal(await no(assertion({ audience: 'urn:other' })), 'The SAML assertion is not meant for urn:sutra:orders');
  assert.equal(await no(assertion({ issuer: 'https://evil.example' })), 'The SAML assertion comes from https://evil.example, not https://idp.example');
  assert.equal(await no(assertion({ notOnOrAfter: new Date(Date.now() - 3600e3) })), 'The SAML assertion has expired');
  assert.match(await no(assertion({ key: stranger.private, cert: stranger.cert })), /signature is not valid/);
  assert.match(await no(assertion().replace('buyer@partner.example', 'admin@partner.example')), /signature is not valid/);
  assert.equal(fault((await send('/soap/saml', envelope())).text), 'WS-Security header is required');
});

test('timestamps: an expired one is refused, and a required one must be there', async () => {
  setSecret('WS_PW', 'ws-password-1');
  service('/soap/ut', { auth: 'wssUsernameToken', users: [{ k: 'erp', v: 'WS_PW' }], wssTimestamp: 'required', wssSkewSec: 60 });
  const ut = { user: 'erp', password: 'ws-password-1', type: 'PasswordDigest' as const };
  assert.equal((await send('/soap/ut', applyWss(envelope(), { username: ut, timestampTtlSec: 300 }))).status, 200);
  assert.equal(fault((await send('/soap/ut', applyWss(envelope(), { username: ut }))).text), 'A WS-Security Timestamp is required');
  const old = applyWss(envelope(), { username: ut, timestampTtlSec: 300 }).replace(/<wsu:Created>[^<]+<\/wsu:Created><wsu:Expires>[^<]+<\/wsu:Expires>/, '<wsu:Created>2020-01-01T00:00:00Z</wsu:Created><wsu:Expires>2020-01-01T00:05:00Z</wsu:Expires>');
  assert.equal(fault((await send('/soap/ut', old)).text), 'The message has expired (Timestamp)');
});

test('XML encryption: requests encrypted for the service are decrypted; signed then encrypted works; RSA 1.5 and wrong keys are refused', async () => {
  setSecret('ORDERS_KEY', server.private);
  service('/soap/enc', { auth: 'none', decryptKeySecret: 'ORDERS_KEY', requireEncryption: true });
  for (const algorithm of ['aes256-gcm', 'aes128-gcm', 'aes256-cbc', 'aes128-cbc']) {
    const xml = applyWss(envelope('E-1'), { timestampTtlSec: 300, encrypt: { certPem: server.cert, algorithm } });
    assert.ok(!xml.includes('E-1') && xml.includes('EncryptedData'), 'the order id is not readable on the wire');
    const r = await send('/soap/enc', xml);
    assert.equal(r.status, 200, `${algorithm}: ${r.text}`);
    assert.match(r.text, /<OrderId>E-1<\/OrderId>/);
  }
  assert.equal(fault((await send('/soap/enc', applyWss(envelope(), { timestampTtlSec: 300 }))).text), 'The SOAP Body must be encrypted');
  assert.equal(fault((await send('/soap/enc', applyWss(envelope(), { timestampTtlSec: 300, encrypt: { certPem: stranger.cert } }))).text), 'The content key cannot be decrypted with this service\'s key');
  const rsa15 = applyWss(envelope(), { timestampTtlSec: 300, encrypt: { certPem: server.cert } }).replace('#rsa-oaep-mgf1p', '#rsa-1_5');
  assert.match(fault((await send('/soap/enc', rsa15)).text), /RSA 1.5 key transport is refused/);

  // Signed with X.509, then encrypted: decrypted first, then the signature checks out.
  service('/soap/enc-signed', { auth: 'wssX509', trustedCertsPem: ca.cert, decryptKeySecret: 'ORDERS_KEY', requireEncryption: true, wssTimestamp: 'required' });
  const both = await send('/soap/enc-signed', applyWss(envelope('S-7'), { x509: x509(client), timestampTtlSec: 300, encrypt: { certPem: server.cert } }));
  assert.equal(both.status, 200, both.text);
  assert.match(both.text, /<OrderId>S-7<\/OrderId><Caller>erp-client<\/Caller>/);

  // The functions on their own: what is decrypted is what was encrypted.
  const plain = applyWss(envelope('R-1'), { timestampTtlSec: 300 });
  const round = decryptMessage(encryptBody(plain, server.cert, 'aes256-cbc'), server.private);
  assert.equal(round.bodyEncrypted, true);
  assert.match(round.xml, /<o:OrderId>R-1<\/o:OrderId>/);
});

test('an Invoke SOAP service step signs and encrypts with its outbound security profile', async () => {
  setSecret('CLIENT_KEY', client.private);
  const auth = saveResource({ kind: 'outboundAuth', name: 'Partner signing', config: { type: 'wssX509', certPem: client.cert, keySecret: 'CLIENT_KEY', timestamp: 300, encryptCertPem: server.cert, encryptAlgorithm: 'aes256-gcm' } });
  const s = node('start', 'Start', { payload: '{"orderId":"P-5"}' });
  const call = node('soapInvoke', 'Call', { mode: 'raw envelope', auth: auth.id, endpoint: `${env.http}/soap/enc-signed`, bodyXml: '<ord:GetOrder xmlns:ord="urn:sutra:orders"><ord:OrderId>{{input.orderId | xmlescape}}</ord:OrderId></ord:GetOrder>' });
  const id = await engine.startRun({ doc: { name: 'Client', nodes: [s, call], edges: [edge(s, call)] } });
  assert.equal(await engine.waitFor(id, 20000), 'done', JSON.stringify(runState(id)!.logs));
  const out = runState(id)!.outputs.Call;
  assert.equal(JSON.stringify(out).includes('P-5') && JSON.stringify(out).includes('erp-client'), true, JSON.stringify(out));
});
