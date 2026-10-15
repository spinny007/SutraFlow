import crypto from 'node:crypto';
import net from 'node:net';
import type { TLSSocket } from 'node:tls';
import { jwtVerify, createRemoteJWKSet, type JWTVerifyGetKey } from 'jose';
import { getSecret } from '../secrets.js';
import { kvToObject, type Resource } from '../resources.js';
import { verifyUsernameToken, safeEqual } from './wss.js';
import { systemAccountMayCall } from '../access.js';

/** Thrown for a request the policy refuses; the gateway turns it into an HTTP (or SOAP fault) reply. */
export class PolicyError extends Error {
  constructor(public status: number, message: string, public headers: Record<string, string> = {}) {
    super(message);
  }
}

export interface InboundRequest {
  headers: Record<string, string | string[] | undefined>;
  ip: string;
  secure: boolean;
  socket: any;
  /** Parsed wsse:Security header for SOAP requests. */
  wsSecurity?: any;
}

export interface Caller {
  method: string;
  subject: string;
  claims?: Record<string, any>;
}

const h = (r: InboundRequest, name: string) => {
  const v = r.headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
};

export function ipAllowed(ip: string, rules: string[]) {
  if (!rules.length) return true;
  const addr = ip.replace(/^::ffff:/, '');
  return rules.some(rule => {
    const r = rule.trim();
    if (!r) return false;
    if (!r.includes('/')) return r === addr || r === ip;
    const [base, bits] = r.split('/');
    if (!net.isIPv4(base) || !net.isIPv4(addr)) return false;
    const toInt = (a: string) => a.split('.').reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;
    const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
    return (toInt(base) & mask) === (toInt(addr) & mask);
  });
}

// ---------- rate limiting (fixed one-minute windows, per policy and caller) ----------
const windows = new Map<string, { start: number; n: number }>();
function rateLimit(policyId: string, caller: string, perMinute: number) {
  if (!perMinute || perMinute <= 0) return;
  const k = `${policyId}|${caller}`;
  const now = Date.now();
  let w = windows.get(k);
  if (!w || now - w.start >= 60000) { w = { start: now, n: 0 }; windows.set(k, w); }
  w.n++;
  if (windows.size > 50000) for (const [key, v] of windows) if (now - v.start >= 60000) windows.delete(key);
  if (w.n > perMinute) {
    throw new PolicyError(429, 'Rate limit exceeded', { 'retry-after': String(Math.ceil((w.start + 60000 - now) / 1000)) });
  }
}

const jwksCache = new Map<string, JWTVerifyGetKey>();

/** Applies an API security policy. Returns who the caller is, or throws PolicyError. */
export async function authorize(policy: Resource | undefined, req: InboundRequest): Promise<Caller> {
  if (!policy) return { method: 'none', subject: 'anonymous' };
  const c = policy.config;
  if (c.requireHttps && !req.secure) throw new PolicyError(403, 'HTTPS is required for this service');
  if (!ipAllowed(req.ip, Array.isArray(c.ipAllow) ? c.ipAllow : [])) throw new PolicyError(403, 'Your IP address is not allowed');

  let caller: Caller;
  switch (c.auth) {
    case 'none':
      caller = { method: 'none', subject: 'anonymous' };
      break;
    case 'basic': {
      const a = h(req, 'authorization') || '';
      const challenge = { 'www-authenticate': 'Basic realm="sutra", charset="UTF-8"' };
      if (!a.startsWith('Basic ')) throw new PolicyError(401, 'Basic authentication required', challenge);
      const dec = Buffer.from(a.slice(6), 'base64').toString('utf8');
      const i = dec.indexOf(':');
      const user = dec.slice(0, i), pw = dec.slice(i + 1);
      // System accounts: active, right password, and the Call services permission on this project.
      if (c.basicAccounts === 'system accounts') {
        if (i < 0 || !systemAccountMayCall(user, pw, policy.project_id || undefined)) throw new PolicyError(401, 'Invalid username or password', challenge);
        caller = { method: 'basic', subject: user };
        break;
      }
      const secretName = kvToObject(c.users)[user];
      const expected = secretName ? getSecret(secretName) : undefined;
      if (i < 0 || expected === undefined || !safeEqual(expected, pw)) throw new PolicyError(401, 'Invalid username or password', challenge);
      caller = { method: 'basic', subject: user };
      break;
    }
    case 'apiKey': {
      const key = h(req, c.apiKeyHeader || 'x-api-key');
      if (!key) throw new PolicyError(401, `Missing ${c.apiKeyHeader || 'X-API-Key'} header`);
      const names: string[] = Array.isArray(c.apiKeySecrets) ? c.apiKeySecrets : [];
      const match = names.find(n => { const v = getSecret(n); return v !== undefined && safeEqual(v, key); });
      if (!match) throw new PolicyError(401, 'Invalid API key');
      caller = { method: 'apiKey', subject: match };
      break;
    }
    case 'jwt': {
      const a = h(req, 'authorization') || '';
      if (!/^Bearer\s+/i.test(a)) throw new PolicyError(401, 'Bearer token required', { 'www-authenticate': 'Bearer' });
      const token = a.replace(/^Bearer\s+/i, '');
      const opts: any = { issuer: c.jwtIssuer || undefined, audience: c.jwtAudience || undefined, clockTolerance: 30 };
      let payload: any;
      try {
        if (c.jwtMode === 'sharedSecret') {
          const s = getSecret(c.jwtSecret);
          if (!s) throw new Error('JWT shared secret is not configured');
          ({ payload } = await jwtVerify(token, new TextEncoder().encode(s), { ...opts, algorithms: ['HS256', 'HS384', 'HS512'] }));
        } else if (c.jwtMode === 'publicKey') {
          ({ payload } = await jwtVerify(token, crypto.createPublicKey(c.jwtPublicKeyPem), opts));
        } else {
          if (!c.jwksUrl) throw new Error('JWKS URL is not configured');
          let ks = jwksCache.get(c.jwksUrl);
          if (!ks) { ks = createRemoteJWKSet(new URL(c.jwksUrl)); jwksCache.set(c.jwksUrl, ks); }
          ({ payload } = await jwtVerify(token, ks, opts));
        }
      } catch (e: any) {
        throw new PolicyError(401, `Invalid token: ${e.code || e.message}`, { 'www-authenticate': 'Bearer error="invalid_token"' });
      }
      const need = String(c.jwtScopes || '').split(/\s+/).filter(Boolean);
      if (need.length) {
        const have = new Set(String(payload.scope || (Array.isArray(payload.scp) ? payload.scp.join(' ') : payload.scp) || '').split(/\s+/));
        const missing = need.filter(s => !have.has(s));
        if (missing.length) throw new PolicyError(403, `Token is missing scope: ${missing.join(' ')}`, { 'www-authenticate': 'Bearer error="insufficient_scope"' });
      }
      caller = { method: 'jwt', subject: String(payload.sub || payload.client_id || 'unknown'), claims: payload };
      break;
    }
    case 'wssUsernameToken': {
      if (!req.wsSecurity) throw new PolicyError(401, 'WS-Security header is required');
      const users = kvToObject(c.users);
      try {
        const r = verifyUsernameToken(req.wsSecurity, u => (users[u] ? getSecret(users[u]) : undefined));
        caller = { method: 'wssUsernameToken', subject: r.user };
      } catch (e: any) {
        throw new PolicyError(401, e.message);
      }
      break;
    }
    case 'mtls': {
      const s = req.socket as TLSSocket;
      if (!req.secure || typeof s.getPeerCertificate !== 'function') throw new PolicyError(403, 'A client certificate over HTTPS is required');
      if (!s.authorized) throw new PolicyError(403, `Client certificate not accepted: ${s.authorizationError || 'none presented'}`);
      const cert = s.getPeerCertificate();
      const cn = String(cert?.subject?.CN ?? '');
      const allowed: string[] = Array.isArray(c.mtlsAllowedSubjects) ? c.mtlsAllowedSubjects : [];
      if (allowed.length && !allowed.includes(cn)) throw new PolicyError(403, `Certificate subject ${cn} is not allowed`);
      caller = { method: 'mtls', subject: cn, claims: { fingerprint256: cert.fingerprint256, issuer: cert.issuer?.CN } };
      break;
    }
    default:
      throw new PolicyError(500, `Unknown authentication method ${c.auth}`);
  }
  rateLimit(policy.id, caller.subject === 'anonymous' ? req.ip : caller.subject, Number(c.rateLimitPerMinute) || 0);
  return caller;
}

/** CORS headers for an allowed origin, or null. */
export function corsHeaders(policy: Resource | undefined, origin: string | undefined) {
  const list: string[] = Array.isArray(policy?.config.corsOrigins) ? policy!.config.corsOrigins : [];
  if (!origin || !list.length || !(list.includes('*') || list.includes(origin))) return null;
  return {
    'access-control-allow-origin': list.includes('*') ? '*' : origin,
    'access-control-allow-headers': 'authorization, content-type, x-api-key, ' + (policy?.config.apiKeyHeader || ''),
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}
