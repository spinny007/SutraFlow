import crypto from 'node:crypto';
import { q, now, getSetting, setSetting } from './db.js';

/**
 * Studio sign-in. The first visit creates the administrator account. Sessions
 * are signed cookies (HMAC with a server key kept in settings); mutating
 * requests also need the X-Sutra header, which a cross-site form cannot send.
 */
const SESSION_HOURS = 12;

function serverKey(): Buffer {
  let k = getSetting<string>('sessionKey', '');
  if (!k) { k = crypto.randomBytes(32).toString('base64'); setSetting('sessionKey', k); }
  return Buffer.from(k, 'base64');
}

export function hashPassword(pw: string) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(pw: string, stored: string) {
  const [, salt, hash] = stored.split('$');
  const h = crypto.scryptSync(pw, Buffer.from(salt, 'base64'), 64, { N: 16384, r: 8, p: 1 });
  const e = Buffer.from(hash, 'base64');
  return h.length === e.length && crypto.timingSafeEqual(h, e);
}

export const hasUsers = () => !!q.get('select 1 from users limit 1');

export function createUser(username: string, password: string, role = 'admin') {
  if (!/^[\w.@-]{2,64}$/.test(username)) throw new Error('Username: 2 to 64 letters, digits, . _ @ -');
  if (password.length < 10) throw new Error('Password must have at least 10 characters');
  q.run('insert into users(username, hash, role, created_at) values(?, ?, ?, ?)', username, hashPassword(password), role, now());
}

export function login(username: string, password: string) {
  const u = q.get<{ username: string; hash: string; role: string }>('select * from users where username = ?', username);
  if (!u || !verifyPassword(password, u.hash)) return null;
  return issue(u.username, u.role);
}

export function issue(user: string, role: string) {
  const payload = Buffer.from(JSON.stringify({ u: user, r: role, exp: Date.now() + SESSION_HOURS * 3600e3 })).toString('base64url');
  const sig = crypto.createHmac('sha256', serverKey()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifySession(token: string | undefined): { u: string; r: string } | null {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expect = crypto.createHmac('sha256', serverKey()).update(payload).digest('base64url');
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return p.exp > Date.now() ? { u: p.u, r: p.r } : null;
  } catch {
    return null;
  }
}

/** Login attempt throttling per IP. */
const attempts = new Map<string, { n: number; until: number }>();
export function loginAllowed(ip: string) {
  const a = attempts.get(ip);
  return !a || a.until < Date.now() || a.n < 10;
}
export function loginFailed(ip: string) {
  const a = attempts.get(ip);
  if (!a || a.until < Date.now()) attempts.set(ip, { n: 1, until: Date.now() + 15 * 60e3 });
  else a.n++;
}
