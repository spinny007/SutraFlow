import { Agent, ProxyAgent, request, type Dispatcher } from 'undici';
import https from 'node:https';
import { XMLParser } from 'fast-xml-parser';
import { kvToObject, type Resource } from '../resources.js';
import type { WssOptions } from './wss.js';

type SecretFn = (name: string, what?: string) => string;

// ---------- TLS / connection ----------

export interface TlsMaterial {
  ca?: string;
  cert?: string;
  key?: string;
  passphrase?: string;
  rejectUnauthorized: boolean;
}

export function tlsFromConnection(conn: Resource | undefined, secret: SecretFn): TlsMaterial {
  const c = conn?.config || {};
  return {
    ca: c.caPem?.trim() || undefined,
    cert: c.clientCertPem?.trim() || undefined,
    key: c.clientKeySecret ? secret(c.clientKeySecret, 'Client private key') : undefined,
    passphrase: c.clientKeyPassSecret ? secret(c.clientKeyPassSecret, 'Key passphrase') : undefined,
    rejectUnauthorized: c.verifyTls !== false,
  };
}

const dispatchers = new Map<string, Dispatcher>();

export function dispatcherFor(conn: Resource | undefined, tls: TlsMaterial): Dispatcher | undefined {
  if (!conn) return undefined;
  const key = `${conn.id}:${conn.rev}`;
  let d = dispatchers.get(key);
  if (d) return d;
  for (const k of dispatchers.keys()) if (k.startsWith(conn.id + ':')) { dispatchers.get(k)!.close().catch(() => {}); dispatchers.delete(k); }
  const connect = { ca: tls.ca, cert: tls.cert, key: tls.key, passphrase: tls.passphrase, rejectUnauthorized: tls.rejectUnauthorized };
  d = conn.config.proxyUrl
    ? new ProxyAgent({ uri: conn.config.proxyUrl, requestTls: connect })
    : new Agent({ connect });
  dispatchers.set(key, d);
  return d;
}

/** node-soap uses axios, which takes a Node https.Agent. */
export function httpsAgentFor(tls: TlsMaterial) {
  return new https.Agent({ ca: tls.ca, cert: tls.cert, key: tls.key, passphrase: tls.passphrase, rejectUnauthorized: tls.rejectUnauthorized, keepAlive: true });
}

export function joinUrl(base: string | undefined, url: string) {
  if (!base || /^https?:\/\//i.test(url)) return url;
  return base.replace(/\/+$/, '') + '/' + url.replace(/^\/+/, '');
}

// ---------- authentication ----------

export interface AppliedAuth {
  headers: Record<string, string>;
  query: Record<string, string>;
  wss?: WssOptions;
}

const tokenCache = new Map<string, { token: string; exp: number }>();

export async function applyAuth(
  profile: Resource | undefined,
  secret: SecretFn,
  resolve: (t: unknown) => any,
  opts: { soap?: boolean; signal?: AbortSignal; dispatcher?: Dispatcher } = {},
): Promise<AppliedAuth> {
  const out: AppliedAuth = { headers: {}, query: {} };
  if (!profile) return out;
  const c = profile.config;
  const ttl = Number(c.timestamp) || 0;
  switch (c.type) {
    case 'none':
      break;
    case 'basic': {
      const user = String(resolve(c.username) ?? '');
      out.headers.authorization = 'Basic ' + Buffer.from(`${user}:${secret(c.passwordSecret, 'Password')}`).toString('base64');
      break;
    }
    case 'bearer':
      out.headers.authorization = 'Bearer ' + secret(c.tokenSecret, 'Token');
      break;
    case 'apiKey': {
      const v = secret(c.apiKeySecret, 'API key');
      if (c.apiKeyIn === 'query') out.query[c.apiKeyName || 'api_key'] = v;
      else out.headers[(c.apiKeyName || 'X-API-Key').toLowerCase()] = v;
      break;
    }
    case 'oauth2ClientCredentials':
      out.headers.authorization = 'Bearer ' + (await clientCredentialsToken(profile, secret, opts));
      break;
    case 'customHeaders':
      Object.assign(out.headers, kvToObject(c.headers, v => String(resolve(v) ?? '')));
      break;
    case 'wssUsernameToken':
    case 'wssSaml':
    case 'wssX509': {
      if (!opts.soap) throw new Error(`${profile.name}: WS-Security profiles apply to SOAP calls only`);
      const wss: WssOptions = { timestampTtlSec: ttl || undefined };
      if (c.type === 'wssUsernameToken' || (c.type === 'wssSaml' && c.samlWithUsername)) {
        wss.username = { user: String(resolve(c.username) ?? ''), password: secret(c.passwordSecret, 'Password'), type: c.passwordType === 'PasswordText' ? 'PasswordText' : 'PasswordDigest' };
      }
      if (c.type === 'wssSaml') {
        const a = c.samlSource === 'expression' ? resolve(c.samlExpression) : secret(c.samlSecret, 'SAML assertion');
        const xml = typeof a === 'string' ? a : a && typeof a === 'object' && typeof a.text === 'string' ? a.text : '';
        if (!/<(\w+:)?Assertion[\s>]/.test(xml)) throw new Error(`${profile.name}: the SAML value does not contain an <Assertion> element`);
        wss.samlAssertion = xml;
      }
      if (c.type === 'wssX509') {
        if (!c.certPem?.trim()) throw new Error(`${profile.name}: signing certificate is missing`);
        wss.x509 = {
          certPem: c.certPem,
          keyPem: secret(c.keySecret, 'Signing private key'),
          passphrase: c.keyPassSecret ? secret(c.keyPassSecret, 'Key passphrase') : undefined,
          signatureAlgorithm: c.signatureAlgorithm === 'rsa-sha1' ? 'http://www.w3.org/2000/09/xmldsig#rsa-sha1' : undefined,
          digestAlgorithm: c.signatureAlgorithm === 'rsa-sha1' ? 'http://www.w3.org/2000/09/xmldsig#sha1' : undefined,
        };
      }
      out.wss = wss;
      break;
    }
    default:
      throw new Error(`${profile.name}: unknown security method ${c.type}`);
  }
  return out;
}

async function clientCredentialsToken(profile: Resource, secret: SecretFn, opts: { signal?: AbortSignal; dispatcher?: Dispatcher }) {
  const c = profile.config;
  const cacheKey = `${profile.id}:${profile.rev}`;
  const hit = tokenCache.get(cacheKey);
  if (hit && hit.exp > Date.now() + 30000) return hit.token;
  if (!c.tokenUrl) throw new Error(`${profile.name}: token URL is missing`);
  const clientSecret = secret(c.clientSecretSecret, 'Client secret');
  const form = new URLSearchParams({ grant_type: 'client_credentials' });
  if (c.scope) form.set('scope', c.scope);
  if (c.audience) form.set('audience', c.audience);
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' };
  if (c.clientAuth === 'form body') {
    form.set('client_id', c.clientId);
    form.set('client_secret', clientSecret);
  } else {
    headers.authorization = 'Basic ' + Buffer.from(`${encodeURIComponent(c.clientId)}:${encodeURIComponent(clientSecret)}`).toString('base64');
  }
  const r = await request(c.tokenUrl, { method: 'POST', headers, body: form.toString(), signal: opts.signal, dispatcher: opts.dispatcher });
  const text = await r.body.text();
  if (r.statusCode >= 400) throw new Error(`${profile.name}: token request failed with ${r.statusCode}: ${text.slice(0, 300)}`);
  let j: any;
  try { j = JSON.parse(text); } catch { throw new Error(`${profile.name}: token response is not JSON`); }
  if (!j.access_token) throw new Error(`${profile.name}: token response has no access_token`);
  tokenCache.set(cacheKey, { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 300) * 1000 });
  return j.access_token as string;
}

// ---------- calling ----------

export const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: true,
  trimValues: true,
});

export function parseBody(text: string, contentType: string, mode: string) {
  const ct = contentType.toLowerCase();
  if (mode === 'text') return text;
  if (mode === 'json' || (mode === 'auto' && ct.includes('json'))) {
    if (!text) return null;
    try { return JSON.parse(text); } catch { if (mode === 'json') throw new Error('Response is not valid JSON'); return text; }
  }
  if (mode === 'xml' || (mode === 'auto' && ct.includes('xml'))) return text ? xmlParser.parse(text) : null;
  return text;
}

export interface HttpResult {
  status: number;
  headers: Record<string, string>;
  body: any;
  text: string;
  ms: number;
  /** Raw bytes, when parse is "buffer". */
  buffer?: Buffer;
}

export async function httpCall(o: {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string | Buffer;
  dispatcher?: Dispatcher;
  timeoutMs: number;
  signal?: AbortSignal;
  parse?: string;
}): Promise<HttpResult> {
  const t = Date.now();
  const signals = [AbortSignal.timeout(o.timeoutMs)];
  if (o.signal) signals.push(o.signal);
  let r;
  try {
    r = await request(o.url, {
      method: o.method as any,
      headers: o.headers,
      body: o.body,
      dispatcher: o.dispatcher,
      signal: AbortSignal.any(signals),
      headersTimeout: o.timeoutMs,
      bodyTimeout: o.timeoutMs,
    });
  } catch (e: any) {
    const cause = e?.cause?.code || e?.code;
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw new Error(`${o.method} ${o.url} timed out or was cancelled after ${Date.now() - t} ms`);
    throw new Error(`${o.method} ${o.url} failed: ${e?.message || e}${cause ? ` (${cause})` : ''}`);
  }
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.headers)) headers[k] = Array.isArray(v) ? v.join(', ') : String(v ?? '');
  if (o.parse === 'buffer') {
    const buffer = Buffer.from(await r.body.arrayBuffer());
    const text = r.statusCode >= 400 ? buffer.toString('utf8') : '';
    return { status: r.statusCode, headers, text, buffer, body: r.statusCode >= 400 ? parseBody(text, headers['content-type'] || '', 'auto') : null, ms: Date.now() - t };
  }
  const text = await r.body.text();
  return { status: r.statusCode, headers, text, body: parseBody(text, headers['content-type'] || '', o.parse || 'auto'), ms: Date.now() - t };
}
