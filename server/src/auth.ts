/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import crypto from 'node:crypto';
import { q, getSetting, setSetting } from './db.js';

/**
 * Sign-in sessions for the designer and the Admin Console. The first visit creates the administrator
 * account. Sessions are signed cookies (HMAC with a server key kept in settings) that carry when they
 * were issued, so disabling an account or "sign out everywhere" ends them. Changing requests also need
 * the X-Sutra header, which a cross-site form cannot send. Accounts and roles: access.ts.
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

export const hasUsers = () => !!q.get(`select 1 from users where coalesce(kind, 'user') = 'user' limit 1`);

export function issue(user: string) {
  const t = Date.now();
  const payload = Buffer.from(JSON.stringify({ u: user, iat: t, exp: t + SESSION_HOURS * 3600e3 })).toString('base64url');
  const sig = crypto.createHmac('sha256', serverKey()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifySession(token: string | undefined): { u: string; iat: number } | null {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expect = crypto.createHmac('sha256', serverKey()).update(payload).digest('base64url');
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return p.exp > Date.now() ? { u: p.u, iat: Number(p.iat) || 0 } : null;
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
