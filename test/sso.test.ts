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
import http from 'node:http';
import crypto from 'node:crypto';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { testEnv, port } from './helpers.js';

/**
 * Single sign-on with OpenID Connect (sso.ts) against a stand-in identity provider: discovery, keys
 * (JWKS), and a token endpoint that checks the PKCE verifier and the client secret.
 */
testEnv(20700);
const { boot } = await import('../server/src/index.js');
const { setSecret } = await import('../server/src/secrets.js');
const { q } = await import('../server/src/db.js');
const projects = await import('../server/src/projects.js');

const idpPort = port(20710);
const issuer = `http://127.0.0.1:${idpPort}`;
const { publicKey, privateKey } = await generateKeyPair('RS256');
const other = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
/** code -> what the provider tells about the person, and the PKCE challenge it was given. */
const codes = new Map<string, { claims: Record<string, any>; challenge: string; badKey?: boolean; nonce?: string }>();
const seenAuth: string[] = [];
const idp = http.createServer(async (req, res) => {
  const u = new URL(req.url!, issuer);
  const json = (v: any, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };
  if (u.pathname === '/.well-known/openid-configuration') return json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` });
  if (u.pathname === '/jwks') return json({ keys: [jwk] });
  if (u.pathname === '/token') {
    let body = ''; for await (const c of req) body += c;
    const p = new URLSearchParams(body);
    seenAuth.push(String(req.headers.authorization || ''));
    const c = codes.get(p.get('code') || '');
    if (!c) return json({ error: 'invalid_grant' }, 400);
    codes.delete(p.get('code')!);
    const verifier = p.get('code_verifier') || '';
    if (crypto.createHash('sha256').update(verifier).digest('base64url') !== c.challenge) return json({ error: 'invalid_grant', error_description: 'PKCE verifier does not match' }, 400);
    if (req.headers.authorization !== `Basic ${Buffer.from('sutra-studio:idp-client-secret').toString('base64')}`) return json({ error: 'invalid_client' }, 401);
    const idToken = await new SignJWT({ ...c.claims, nonce: c.nonce }).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(issuer).setAudience('sutra-studio')
      .setIssuedAt().setExpirationTime('5m').sign(c.badKey ? other.privateKey : privateKey);
    return json({ access_token: 'at', token_type: 'Bearer', id_token: idToken });
  }
  res.writeHead(404); res.end();
});

let srv: Awaited<ReturnType<typeof boot>>;
let admin = '';
before(async () => {
  await new Promise<void>(r => idp.listen(idpPort, '127.0.0.1', r));
  srv = await boot({ listenAdmin: false });
  const r = await srv.admin.inject({ method: 'POST', url: '/api/auth/setup', payload: { username: 'root', password: 'Sso-admin-pass-1' }, headers: { 'x-sutra': '1' } });
  admin = String(r.headers['set-cookie']).split(';')[0];
});
after(async () => { await srv.stop(); idp.close(); });

const call = (method: string, url: string, payload?: any, cookie = admin) =>
  srv.admin.inject({ method: method as any, url, payload, headers: { 'x-sutra': '1', ...(cookie ? { cookie } : {}) } });
const cookieOf = (r: any, name: string) => ([] as string[]).concat(r.headers['set-cookie'] || []).map(c => c.split(';')[0]).find(c => c.startsWith(`${name}=`) && c.length > name.length + 1);

/** A whole sign-in: start, the provider's answer for these claims, the callback. */
async function signIn(claims: Record<string, any>, o: { badKey?: boolean; wrongState?: boolean; wrongNonce?: boolean; noCookie?: boolean } = {}) {
  const start = await srv.admin.inject({ method: 'GET', url: '/api/auth/sso/start?return=%2Fadmin%23people' });
  assert.equal(start.statusCode, 302, start.body);
  const to = new URL(String(start.headers.location));
  assert.equal(to.origin + to.pathname, `${issuer}/authorize`);
  assert.equal(to.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(to.searchParams.get('client_id'), 'sutra-studio');
  const code = crypto.randomBytes(8).toString('hex');
  codes.set(code, { claims, challenge: to.searchParams.get('code_challenge')!, badKey: o.badKey, nonce: o.wrongNonce ? 'another' : to.searchParams.get('nonce')! });
  const state = o.wrongState ? 'forged' : to.searchParams.get('state')!;
  const back = await srv.admin.inject({ method: 'GET', url: `/api/auth/sso/callback?code=${code}&state=${state}`, headers: o.noCookie ? {} : { cookie: cookieOf(start, 'sutra_sso')! } });
  return { status: back.statusCode, body: back.body, session: cookieOf(back, 'sutra_session') };
}

test('single sign-on: settings are checked, and the sign-in button appears once it is on', async () => {
  assert.equal((await call('GET', '/api/auth/status', undefined, '')).json().sso, null);
  assert.match((await call('PUT', '/api/access/sso', { enabled: true, issuer: 'ftp://idp', clientId: 'x' })).json().error, /Issuer: an https/);
  assert.match((await call('PUT', '/api/access/sso', { enabled: true, issuer, clientId: 'sutra-studio', clientSecret: 'NOPE' })).json().error, /Secret "NOPE" does not exist/);
  setSecret('IDP_SECRET', 'idp-client-secret');
  const ops = projects.saveProject({ name: 'Ops', config: { variables: [] } }).id;
  const saved = await call('PUT', '/api/access/sso', { enabled: true, name: 'Company', issuer: `${issuer}/`, clientId: 'sutra-studio', clientSecret: 'IDP_SECRET', createAccounts: true,
    groupRoles: [{ group: 'sutra-admins', role: 'administrator' }, { group: 'ops-team', role: 'operator', project: ops }, { group: '', role: 'viewer' }] });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().issuer, issuer, 'trailing slash removed');
  assert.equal(saved.json().groupRoles.length, 2, 'empty rows dropped');
  assert.deepEqual((await call('GET', '/api/auth/status', undefined, '')).json().sso, { name: 'Company' });
  assert.match((await call('GET', '/api/access/sso')).json().redirectUri, /\/api\/auth\/sso\/callback$/);
  assert.equal((await call('GET', '/api/access/sso', undefined, '')).statusCode, 401, 'settings need sign-in');
});

test('single sign-on: a new person gets an account with the roles of their groups; the session works', async () => {
  const r = await signIn({ sub: 'u-100', preferred_username: 'asha', name: 'Asha Rao', email: 'asha@example.com', groups: ['ops-team', 'other'] });
  assert.equal(r.status, 200, r.body);
  assert.match(r.body, /location\.replace\("\/admin#people"\)/);
  assert.ok(r.session);
  const me = (await call('GET', '/api/auth/status', undefined, r.session)).json().user;
  assert.equal(me.username, 'asha');
  const u = (await call('GET', '/api/access/users/asha')).json();
  assert.equal(u.sso, true);
  assert.equal(u.hasPassword, false);
  assert.equal(u.mustChange, false);
  assert.equal(u.displayName, 'Asha Rao');
  assert.deepEqual(u.grants.map((g: any) => g.role), ['operator']);
  // Groups change at the provider: roles follow at the next sign-in. The same subject finds the account.
  await signIn({ sub: 'u-100', preferred_username: 'asha-renamed', groups: ['sutra-admins'] });
  assert.deepEqual((await call('GET', '/api/access/users/asha')).json().grants.map((g: any) => g.role), ['administrator']);
  assert.equal(q.get<any>("select count(*) n from users where username like 'asha%'").n, 1);
  // Without a password, the account cannot sign in with one.
  assert.equal((await call('POST', '/api/auth/login', { username: 'asha', password: '' }, '')).statusCode, 401);
});

test('single sign-on refuses forged or mismatched sign-ins and existing names', async () => {
  assert.match((await signIn({ sub: 'u-2', preferred_username: 'x' }, { wrongState: true })).body, /does not match the one this browser started/);
  assert.match((await signIn({ sub: 'u-2', preferred_username: 'x' }, { noCookie: true })).body, /took too long or was started in another browser/);
  const bad = await signIn({ sub: 'u-2', preferred_username: 'x' }, { badKey: true });
  assert.equal(bad.status, 401);
  assert.match(bad.body, /The ID token is not valid/);
  assert.match((await signIn({ sub: 'u-2', preferred_username: 'x' }, { wrongNonce: true })).body, /belongs to another sign-in/);
  // root exists as a local account: not taken over by a person who calls themselves root.
  const taken = await signIn({ sub: 'evil', preferred_username: 'root', groups: ['sutra-admins'] });
  assert.equal(taken.status, 401);
  assert.match(taken.body, /An account named root exists/);
  assert.equal(taken.session, undefined);
  const back = await srv.admin.inject({ method: 'GET', url: '/api/auth/sso/callback?error=access_denied&error_description=User%20cancelled' });
  assert.match(back.body, /refused the sign-in: User cancelled/);
  // Create accounts off: unknown people are turned away.
  await call('PUT', '/api/access/sso', { createAccounts: false });
  assert.match((await signIn({ sub: 'u-3', preferred_username: 'newbie' })).body, /No account for newbie/);
  // A disabled account stays out.
  await call('PUT', '/api/access/users/asha', { disabled: true });
  assert.match((await signIn({ sub: 'u-100', preferred_username: 'asha' })).body, /This account is disabled/);
  // The return address stays on this server.
  const start = await srv.admin.inject({ method: 'GET', url: '/api/auth/sso/start?return=%2F%2Fevil.example' });
  assert.equal(start.statusCode, 302);
  await call('PUT', '/api/access/users/asha', { disabled: false });
});

test('single sign-on can link an existing local account when the administrator allows it; the last administrator stays', async () => {
  assert.equal((await call('POST', '/api/access/users', { username: 'priya', password: 'Linked-pass-123', grants: [{ role: 'viewer', project: '' }] })).statusCode, 200);
  await call('PUT', '/api/access/sso', { linkExisting: true });
  const r = await signIn({ sub: 'u-priya', preferred_username: 'priya', groups: [] });
  assert.equal(r.status, 200, r.body);
  assert.equal((await call('GET', '/api/access/users/priya')).json().sso, true);
  assert.deepEqual((await call('GET', '/api/access/users/priya')).json().grants, [], 'no mapped group: no roles');
  // Another person at the provider cannot claim the linked name.
  assert.match((await signIn({ sub: 'u-other', preferred_username: 'priya' })).body, /linked to another person/);
  const audit = q.all<any>("select action, outcome from audit where action like 'Sign in with single sign-on%'");
  assert.ok(audit.some(a => a.outcome === 'ok') && audit.some(a => a.outcome === 'failed'));
});
