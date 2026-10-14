import crypto from 'node:crypto';
import { getSetting, setSetting } from '../db.js';
import { encrypt, decrypt, requireSecret } from '../secrets.js';
import { requireResource, effectiveResource, type Resource } from '../resources.js';
import { httpCall } from '../security/outbound.js';

/**
 * OAuth 2.0 authorization-code connections (Google, Dropbox, Facebook,
 * Microsoft, custom). The studio starts the sign-in; the callback stores the
 * tokens encrypted; steps get a fresh access token (refreshed when expired).
 */
export const PROVIDERS: Record<string, { auth: string; token: string; extraAuth?: Record<string, string>; api: string }> = {
  google: { auth: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', extraAuth: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' }, api: 'https://www.googleapis.com' },
  dropbox: { auth: 'https://www.dropbox.com/oauth2/authorize', token: 'https://api.dropboxapi.com/oauth2/token', extraAuth: { token_access_type: 'offline' }, api: 'https://api.dropboxapi.com' },
  facebook: { auth: 'https://www.facebook.com/v19.0/dialog/oauth', token: 'https://graph.facebook.com/v19.0/oauth/access_token', api: 'https://graph.facebook.com/v19.0' },
  microsoft: { auth: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token', api: 'https://graph.microsoft.com/v1.0' },
};

interface Stored { access: { iv: string; tag: string; data: string }; refresh?: { iv: string; tag: string; data: string }; expiresAt: number; scope?: string; account?: string; connectedAt: string }

const endpoints = (r: Resource) => {
  const p = PROVIDERS[r.config.provider];
  return { auth: r.config.authUrl || p?.auth, token: r.config.tokenUrl || p?.token, extra: p?.extraAuth || {}, api: r.config.apiBase || p?.api || '' };
};

function stateKey(): Buffer {
  let k = getSetting<string>('oauthStateKey', '');
  if (!k) { k = crypto.randomBytes(32).toString('base64'); setSetting('oauthStateKey', k); }
  return Buffer.from(k, 'base64');
}
const sign = (payload: string) => crypto.createHmac('sha256', stateKey()).update(payload).digest('base64url');

/** URL the user opens to grant access. state is signed and expires in 10 minutes. */
export function startUrl(resourceId: string, redirectUri: string) {
  const r = requireResource(resourceId, 'oauthApp', 'OAuth connection');
  const e = endpoints(r);
  if (!e.auth || !e.token) throw new Error('Authorization and token URLs are required for a custom provider');
  if (!r.config.clientId) throw new Error('Client ID is not set');
  const payload = Buffer.from(JSON.stringify({ r: resourceId, u: redirectUri, x: Date.now() + 600000, n: crypto.randomBytes(8).toString('hex') })).toString('base64url');
  const u = new URL(e.auth);
  u.search = new URLSearchParams({ response_type: 'code', client_id: r.config.clientId, redirect_uri: redirectUri, scope: r.config.scopes || '', state: `${payload}.${sign(payload)}`, ...e.extra }).toString();
  return u.toString();
}

/** Exchanges the code from the provider's redirect and stores the tokens. */
export async function finish(code: string, state: string) {
  const [payload, sig] = String(state).split('.');
  if (!payload || !sig || sign(payload) !== sig) throw new Error('Invalid sign-in state. Start again from the studio.');
  const st = JSON.parse(Buffer.from(payload, 'base64url').toString());
  if (st.x < Date.now()) throw new Error('The sign-in took too long. Start again from the studio.');
  const r = requireResource(st.r, 'oauthApp', 'OAuth connection');
  const t = await tokenRequest(r, { grant_type: 'authorization_code', code, redirect_uri: st.u });
  save(r.id, t);
  return r;
}

async function tokenRequest(r: Resource, form: Record<string, string>) {
  const e = endpoints(r);
  const secret = r.config.clientSecretSecret ? requireSecret(r.config.clientSecretSecret, 'OAuth client secret') : '';
  const res = await httpCall({
    method: 'POST', url: e.token, timeoutMs: 20000, parse: 'json',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ ...form, client_id: r.config.clientId, ...(secret ? { client_secret: secret } : {}) }).toString(),
  });
  if (res.status >= 400 || !res.body?.access_token) throw new Error(`Token request failed (${res.status}): ${JSON.stringify(res.body).slice(0, 300)}`);
  return res.body as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };
}

function save(id: string, t: { access_token: string; refresh_token?: string; expires_in?: number; scope?: string }, keepRefresh?: Stored['refresh']) {
  const s: Stored = {
    access: encrypt(t.access_token),
    refresh: t.refresh_token ? encrypt(t.refresh_token) : keepRefresh,
    expiresAt: Date.now() + (Number(t.expires_in) || 3600) * 1000,
    scope: t.scope,
    connectedAt: new Date().toISOString(),
  };
  setSetting(`oauth:${id}`, s);
}

export function connectionStatus(id: string) {
  const s = getSetting<Stored | null>(`oauth:${id}`, null);
  return s ? { connected: true, connectedAt: s.connectedAt, expiresAt: new Date(s.expiresAt).toISOString(), canRefresh: !!s.refresh, scope: s.scope } : { connected: false };
}
export function disconnect(id: string) { setSetting(`oauth:${id}`, null); }

const refreshing = new Map<string, Promise<string>>();

/** A valid access token, refreshed when it is about to expire. */
export async function accessToken(id: string): Promise<{ token: string; resource: Resource; api: string }> {
  const r = effectiveResource(id);
  if (!r || r.kind !== 'oauthApp') throw new Error('OAuth connection not found');
  const s = getSetting<Stored | null>(`oauth:${id}`, null);
  if (!s) throw new Error(`${r.name} is not connected. Open it in the project explorer and press Connect account.`);
  const api = endpoints(r).api;
  if (s.expiresAt > Date.now() + 60000) return { token: decrypt(s.access), resource: r, api };
  if (!s.refresh) throw new Error(`${r.name}: the access token expired and there is no refresh token. Connect the account again.`);
  let p = refreshing.get(id);
  if (!p) {
    p = (async () => {
      const t = await tokenRequest(r, { grant_type: 'refresh_token', refresh_token: decrypt(s.refresh!) });
      save(id, t, s.refresh);
      return t.access_token;
    })().finally(() => refreshing.delete(id));
    refreshing.set(id, p);
  }
  return { token: await p, resource: r, api };
}

/** Authorized request to the provider's API (relative paths join the API base). */
export async function apiCall(id: string, o: { method: string; url: string; query?: Record<string, string>; headers?: Record<string, string>; body?: string | Buffer; parse?: string; signal?: AbortSignal; timeoutMs?: number }) {
  const { token, api, resource } = await accessToken(id);
  // With an API base override (tests, proxies), absolute provider URLs keep only their path.
  let url = /^https?:\/\//i.test(o.url) ? o.url : api.replace(/\/+$/, '') + '/' + o.url.replace(/^\/+/, '');
  if (resource.config.apiBase && /^https?:\/\//i.test(o.url)) url = resource.config.apiBase.replace(/\/+$/, '') + new URL(o.url).pathname + new URL(o.url).search;
  const u = new URL(url);
  for (const [k, v] of Object.entries(o.query || {})) if (v !== undefined && v !== '') u.searchParams.set(k, v);
  const res = await httpCall({ method: o.method, url: u.toString(), headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(o.headers || {}) }, body: o.body, timeoutMs: o.timeoutMs || 60000, signal: o.signal, parse: o.parse || 'auto' });
  if (res.status >= 400) {
    const msg = typeof res.body === 'object' ? res.body?.error?.message || res.body?.error_summary || JSON.stringify(res.body) : res.text;
    throw new Error(`${o.method} ${u.pathname} failed (${res.status}): ${String(msg).slice(0, 300)}`);
  }
  return res;
}
