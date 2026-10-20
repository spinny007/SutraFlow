/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.8.0
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
/**
 * HMAC request signing (as many webhook senders use) and OAuth 2.0 token introspection (RFC 7662).
 *
 *  HMAC     the sender signs the body with a shared secret: with a timestamp ("timestamp.body"), with
 *           the method, path and timestamp as well, or the body only. The receiver recomputes the
 *           signature with each accepted secret (several, while one is rotated), refuses a timestamp
 *           older than the allowed age, and refuses a signature it has seen within that age (replay):
 *           remembered in the database, so a replay to another engine is refused too.
 *  Tokens   an opaque access token is checked at the identity provider's introspection endpoint;
 *           the answer is kept until the token expires or for the cache time, whichever is sooner.
 */
import crypto from 'node:crypto';
import { q } from '../db.js';

export type SignedParts = 'timestamp and body' | 'method, path, timestamp and body' | 'body only';
export interface HmacOptions {
  algorithm: string;
  encoding: 'hex' | 'base64';
  prefix: string;
  signed: SignedParts;
}

const ALGORITHMS = new Set(['sha256', 'sha512', 'sha1']);

/** What is signed, as one string. */
function payload(o: HmacOptions, p: { method: string; path: string; timestamp: string; body: string }) {
  if (o.signed === 'body only') return p.body;
  if (o.signed === 'method, path, timestamp and body') return `${p.method.toUpperCase()}\n${p.path}\n${p.timestamp}\n${p.body}`;
  return `${p.timestamp}.${p.body}`;
}

export function hmacSignature(secret: string, o: HmacOptions, p: { method: string; path: string; timestamp: string; body: string }) {
  if (!ALGORITHMS.has(o.algorithm)) throw new Error(`HMAC algorithm ${o.algorithm} is not supported`);
  return `${o.prefix || ''}${crypto.createHmac(o.algorithm, secret).update(payload(o, p), 'utf8').digest(o.encoding === 'base64' ? 'base64' : 'hex')}`;
}

/** The headers an outgoing request carries: its signature, and the timestamp it signed. */
export function signRequest(secret: string, o: HmacOptions & { header: string; timestampHeader: string }, p: { method: string; url: string; body: string }) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const path = (() => { try { const u = new URL(p.url); return u.pathname + u.search; } catch { return p.url; } })();
  const out: Record<string, string> = { [o.header.toLowerCase()]: hmacSignature(secret, o, { method: p.method, path, timestamp, body: p.body }) };
  if (o.signed !== 'body only') out[o.timestampHeader.toLowerCase()] = timestamp;
  return out;
}

/** Unix seconds, milliseconds or an ISO date, as milliseconds. */
function timeOf(v: string) {
  if (/^\d+$/.test(v)) { const n = Number(v); return n > 1e12 ? n : n * 1000; }
  return Date.parse(v);
}

/**
 * Checks an incoming signature. Returns the name of the secret that matched. Throws with a reason a
 * caller may see (never which part was wrong beyond that).
 */
export function verifyRequest(secrets: { name: string; value: string }[], o: HmacOptions & { maxAgeSec: number }, p: { method: string; path: string; timestamp?: string; signature?: string; body: string }) {
  if (!p.signature) throw new Error('The request is not signed');
  const needsTime = o.signed !== 'body only';
  const maxAge = Math.max(1, o.maxAgeSec) * 1000;
  if (needsTime) {
    if (!p.timestamp) throw new Error('The signature timestamp is missing');
    const t = timeOf(p.timestamp);
    if (!Number.isFinite(t) || Math.abs(Date.now() - t) > maxAge) throw new Error('The signature timestamp is too old or in the future');
  }
  const given = Buffer.from(p.signature.trim());
  const match = secrets.find(s => {
    const want = Buffer.from(hmacSignature(s.value, o, { method: p.method, path: p.path, timestamp: p.timestamp || '', body: p.body }));
    return want.length === given.length && crypto.timingSafeEqual(want, given);
  });
  if (!match) throw new Error('The signature does not match');
  if (!remember(`hmac:${crypto.createHash('sha256').update(p.signature).digest('base64url')}`, Date.now() + 2 * maxAge)) throw new Error('This signed request was already received (replay)');
  return match.name;
}

/** Remembers a key until it expires; false when it is already remembered (the database decides, for every engine). */
export function remember(key: string, expiresAt: number) {
  return q.run('insert into replay_guard(k, expires_at) values(?, ?) on conflict(k) do nothing', key, expiresAt).changes === 1;
}
export function pruneReplayGuard(now = Date.now()) {
  return q.run('delete from replay_guard where expires_at < ?', now).changes;
}

// ---------- token introspection ----------

const introspected = new Map<string, { until: number; r: any }>();

export async function introspect(o: { url: string; clientId: string; clientSecret: string; cacheSec: number }, token: string) {
  const key = crypto.createHash('sha256').update(`${o.url}|${token}`).digest('base64url');
  const hit = introspected.get(key);
  if (hit && hit.until > Date.now()) return hit.r;
  const r = await fetch(o.url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', authorization: `Basic ${Buffer.from(`${encodeURIComponent(o.clientId)}:${encodeURIComponent(o.clientSecret)}`).toString('base64')}` },
    body: new URLSearchParams({ token, token_type_hint: 'access_token' }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`The token could not be checked (introspection answered ${r.status})`);
  const j = await r.json() as any;
  const exp = Number(j.exp) * 1000;
  const until = Math.min(Date.now() + Math.max(0, o.cacheSec) * 1000, Number.isFinite(exp) && exp > 0 ? exp : Infinity);
  if (introspected.size > 20000) introspected.clear();
  if (until > Date.now()) introspected.set(key, { until, r: j });
  return j;
}

/** Scopes of a token: "scope" as text, or "scp" as a list or text. */
export const scopesOf = (claims: any): string[] =>
  String(claims?.scope ?? (Array.isArray(claims?.scp) ? claims.scp.join(' ') : claims?.scp) ?? '').split(/\s+/).filter(Boolean);
