/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 2.0.0
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { generate } from 'selfsigned';
import { SignedXml } from 'xml-crypto';
import { testEnv } from './helpers.js';

testEnv(20710);
const { boot } = await import('../server/src/index.js');
const { q } = await import('../server/src/db.js');
const projects = await import('../server/src/projects.js');

const idp = await generate([{ name: 'commonName', value: 'login.example.test' }], { keySize: 2048, algorithm: 'sha256' } as any);
const idpIssuer = 'https://login.example.test/saml';
const entityId = 'https://sutra.example.test/sp';
const entryPoint = 'https://login.example.test/sso';
let srv: Awaited<ReturnType<typeof boot>>, admin = '', ops = '';

before(async () => {
  srv = await boot({ listenAdmin: false });
  const r = await srv.admin.inject({ method: 'POST', url: '/api/auth/setup', payload: { username: 'root', password: 'Saml-admin-pass-1' }, headers: { 'x-sutra': '1' } });
  admin = String(r.headers['set-cookie']).split(';')[0];
  ops = projects.saveProject({ name: 'SAML Ops', config: { variables: [] } }).id;
});
after(async () => { await srv.stop(); });

const call = (method: string, url: string, payload?: any, cookie = admin, headers: Record<string, string> = {}) =>
  srv.admin.inject({ method: method as any, url, payload, headers: { 'x-sutra': '1', ...(cookie ? { cookie } : {}), ...headers } });
const cookieOf = (r: any, name: string) => ([] as string[]).concat(r.headers['set-cookie'] || []).map(c => c.split(';')[0]).find(c => c.startsWith(`${name}=`) && c.length > name.length + 1);

async function start() {
  const r = await srv.admin.inject({ method: 'GET', url: '/api/auth/sso/start?return=%2Fadmin%23people' });
  assert.equal(r.statusCode, 302, r.body);
  const url = new URL(String(r.headers.location));
  assert.equal(url.origin + url.pathname, entryPoint);
  const request = inflateRawSync(Buffer.from(url.searchParams.get('SAMLRequest')!, 'base64')).toString('utf8');
  const requestId = /\bID="([^"]+)"/.exec(request)?.[1] || '';
  const acs = /\bAssertionConsumerServiceURL="([^"]+)"/.exec(request)?.[1]?.replace(/&amp;/g, '&') || '';
  assert.ok(requestId && acs.endsWith('/api/auth/sso/callback'));
  assert.match(request, new RegExp(`<saml:Issuer>${entityId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</saml:Issuer>`));
  return { requestId, acs, relay: url.searchParams.get('RelayState')!, cookie: cookieOf(r, 'sutra_sso') || '' };
}

function response(requestId: string, acs: string, o: { username?: string; audience?: string; issuer?: string; unsigned?: boolean } = {}) {
  const now = Date.now(), iso = (n: number) => new Date(n).toISOString();
  const issuer = o.issuer || idpIssuer, assertionId = `_assert_${Math.random().toString(16).slice(2)}`;
  const assertion = `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${assertionId}" Version="2.0" IssueInstant="${iso(now)}"><saml:Issuer>${issuer}</saml:Issuer><saml:Subject><saml:NameID>person-123</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData Recipient="${acs}" InResponseTo="${requestId}" NotOnOrAfter="${iso(now + 300000)}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="${iso(now - 60000)}" NotOnOrAfter="${iso(now + 300000)}"><saml:AudienceRestriction><saml:Audience>${o.audience || entityId}</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AttributeStatement><saml:Attribute Name="username"><saml:AttributeValue>${o.username || 'saml.alice'}</saml:AttributeValue></saml:Attribute><saml:Attribute Name="groups"><saml:AttributeValue>sutra-admins</saml:AttributeValue><saml:AttributeValue>ops-team</saml:AttributeValue></saml:Attribute><saml:Attribute Name="email"><saml:AttributeValue>alice@example.test</saml:AttributeValue></saml:Attribute><saml:Attribute Name="name"><saml:AttributeValue>Alice SAML</saml:AttributeValue></saml:Attribute></saml:AttributeStatement></saml:Assertion>`;
  let xml = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="_response_${Date.now()}" Version="2.0" IssueInstant="${iso(now)}" Destination="${acs}" InResponseTo="${requestId}"><saml:Issuer xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">${issuer}</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>${assertion}</samlp:Response>`;
  if (!o.unsigned) {
    const sig = new SignedXml({ privateKey: idp.private, publicCert: idp.cert, signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256', canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#' });
    sig.addReference({ xpath: "//*[local-name(.)='Response']", digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256', transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'] });
    sig.computeSignature(xml, { location: { reference: "//*[local-name(.)='Response']/*[local-name(.)='Issuer']", action: 'after' } });
    xml = sig.getSignedXml();
  }
  return xml;
}

async function postSaml(xml: string, relay: string, cookie: string) {
  const body = new URLSearchParams({ SAMLResponse: Buffer.from(xml).toString('base64'), RelayState: relay }).toString();
  return call('POST', '/api/auth/sso/callback', body, cookie, { 'content-type': 'application/x-www-form-urlencoded' });
}

test('SAML sign-on settings expose an AuthnRequest and assertion-consumer address', async () => {
  const invalid = await call('PUT', '/api/access/sso', { enabled: true, protocol: 'saml', samlEntryPoint: 'ftp://idp', samlEntityId: entityId, samlIdpCertPem: 'bad' });
  assert.match(invalid.json().error, /SAML sign-in URL/);
  const saved = await call('PUT', '/api/access/sso', { enabled: true, protocol: 'saml', name: 'Company SAML', samlEntryPoint: entryPoint, samlEntityId: entityId, samlIdpIssuer: idpIssuer, samlIdpCertPem: idp.cert,
    usernameClaim: 'username', groupsClaim: 'groups', createAccounts: true, linkExisting: false,
    groupRoles: [{ group: 'sutra-admins', role: 'administrator' }, { group: 'ops-team', role: 'operator', project: ops }] });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.deepEqual((await call('GET', '/api/auth/status', undefined, '')).json().sso, { name: 'Company SAML' });
  await start();
});

test('SAML HTTP-POST sign-on verifies the assertion, creates the person and maps groups to roles', async () => {
  const s = await start();
  const back = await postSaml(response(s.requestId, s.acs), s.relay, s.cookie);
  assert.equal(back.statusCode, 200, back.body);
  assert.ok(cookieOf(back, 'sutra_session'));
  assert.match((await postSaml(response(s.requestId, s.acs), s.relay, s.cookie)).body, /already used/);
  const u = q.get<any>('select username, display_name, email, idp_subject from users where username = ?', 'saml.alice');
  assert.equal(u.display_name, 'Alice SAML');
  assert.equal(u.email, 'alice@example.test');
  assert.equal(u.idp_subject, `${`saml:${idpIssuer}`}|person-123`);
  const grants = q.all<any>('select role_id, project_id from grants where username = ? order by role_id, project_id', 'saml.alice')
    .map(g => ({ role_id: g.role_id, project_id: g.project_id }));
  assert.deepEqual(grants, [{ role_id: 'administrator', project_id: '' }, { role_id: 'operator', project_id: ops }]);
});

test('SAML sign-on refuses unsigned, changed-audience and mismatched browser responses', async () => {
  let s = await start();
  assert.match((await postSaml(response(s.requestId, s.acs, { unsigned: true }), s.relay, s.cookie)).body, /valid trusted signature/);
  s = await start();
  assert.match((await postSaml(response(s.requestId, s.acs, { audience: 'https:\/\/other.example' }), s.relay, s.cookie)).body, /not meant for/);
  s = await start();
  assert.match((await postSaml(response(s.requestId, s.acs), 'forged', s.cookie)).body, /does not match/);
});

