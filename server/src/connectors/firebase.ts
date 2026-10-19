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
import { SignJWT, importPKCS8 } from 'jose';
import type { Activity, ExecCtx } from '../engine/types.js';
import { requireResource, type Resource } from '../resources.js';
import { httpCall } from '../security/outbound.js';
import { F, when, isObj } from '../palettes/common.js';

/**
 * Firebase with a service account: Firestore (document database), Realtime
 * Database and Cloud Messaging (push notifications), over Google's REST APIs.
 */
const SCOPES = 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/userinfo.email';
const tokens = new Map<string, { token: string; exp: number }>();

interface Sa { project_id: string; client_email: string; private_key: string; token_uri?: string }

export async function googleServiceToken(sa: Sa, scopes: string, cacheKey: string, signal?: AbortSignal) {
  const hit = tokens.get(cacheKey);
  if (hit && hit.exp > Date.now() + 60000) return hit.token;
  const aud = sa.token_uri || 'https://oauth2.googleapis.com/token';
  const key = await importPKCS8(sa.private_key, 'RS256');
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: scopes }).setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(sa.client_email).setSubject(sa.client_email).setAudience(aud).setIssuedAt(now).setExpirationTime(now + 3600).sign(key);
  const r = await httpCall({ method: 'POST', url: aud, headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(), timeoutMs: 20000, signal, parse: 'json' });
  if (r.status >= 400 || !r.body?.access_token) throw new Error(`Google token request failed (${r.status}): ${JSON.stringify(r.body).slice(0, 200)}`);
  tokens.set(cacheKey, { token: r.body.access_token, exp: Date.now() + (Number(r.body.expires_in) || 3600) * 1000 });
  return r.body.access_token as string;
}

function account(c: ExecCtx, r: Resource): Sa {
  let sa: Sa;
  try { sa = JSON.parse(c.secret(r.config.serviceAccountSecret, 'Firebase service account')); } catch { throw new Error('The Firebase service account secret is not valid JSON'); }
  if (!sa.client_email || !sa.private_key || !sa.project_id) throw new Error('The service account JSON needs project_id, client_email and private_key');
  return sa;
}

// ---------- Firestore value format ----------
export function toFirestore(v: any): any {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(v) ? { timestampValue: v } : { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFirestore) } };
  if (isObj(v)) return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toFirestore(x)])) } };
  return { stringValue: String(v) };
}
export function fromFirestore(v: any): any {
  if (!v || typeof v !== 'object') return v;
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('referenceValue' in v) return v.referenceValue;
  if ('geoPointValue' in v) return v.geoPointValue;
  if ('bytesValue' in v) return v.bytesValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromFirestore);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, fromFirestore(x)]));
  return v;
}
const docOut = (d: any) => (d ? { id: String(d.name).split('/').pop(), path: d.name, ...Object.fromEntries(Object.entries(d.fields || {}).map(([k, x]) => [k, fromFirestore(x)])), _createTime: d.createTime, _updateTime: d.updateTime } : null);

const OPS: Record<string, string> = { '=': 'EQUAL', '!=': 'NOT_EQUAL', '<': 'LESS_THAN', '<=': 'LESS_THAN_OR_EQUAL', '>': 'GREATER_THAN', '>=': 'GREATER_THAN_OR_EQUAL', 'array-contains': 'ARRAY_CONTAINS', in: 'IN' };

async function call(c: ExecCtx, method: string, url: string, body?: unknown) {
  const r = requireResource(c.raw('connection'), 'firebase', 'Firebase connection');
  const sa = account(c, r);
  const token = await googleServiceToken(sa, SCOPES, r.rev!, c.signal);
  const res = await httpCall({ method, url, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), timeoutMs: 30000, signal: c.signal, parse: 'json' });
  return { res, sa, r };
}
const base = (r: Resource, real: string) => (r.config.apiBase ? r.config.apiBase.replace(/\/+$/, '') : real);

export const firebaseActivities: Activity[] = [
  {
    type: 'firestore', palette: 'firebase', name: 'Firestore', glyph: '🔥', ports: ['out', 'notFound'],
    desc: 'Reads and writes Firestore documents: get, set (merge or replace), add with a new id, query, delete.',
    fields: [
      F('connection', 'Firebase connection', 'resource', '', { resourceKind: 'firebase' }),
      F('op', 'Operation', 'select', 'get', { options: ['get', 'set', 'add', 'query', 'delete'] }),
      F('collection', 'Collection', 'text', 'orders', { tpl: true }),
      F('docId', 'Document id', 'text', '{{input.orderId}}', { tpl: true, ...when('op', 'get', 'set', 'delete') }),
      F('data', 'Data', 'code', '{{input}}', { tpl: true, ...when('op', 'set', 'add') }),
      F('merge', 'Merge with the existing document', 'bool', true, when('op', 'set')),
      F('where', 'Where (field, op, value)', 'kv', [{ k: 'status =', v: 'open' }], { tpl: true, help: 'Key is "field op" with op one of = != < <= > >= array-contains in.', ...when('op', 'query') }),
      F('orderBy', 'Order by', 'text', '', when('op', 'query')),
      F('limit', 'Limit', 'number', 100, when('op', 'query')),
    ],
    outputHint: { id: '', path: '' },
    execute: async c => {
      const r = requireResource(c.raw('connection'), 'firebase', 'Firebase connection');
      const sa = account(c, r);
      const root = `${base(r, 'https://firestore.googleapis.com')}/v1/projects/${sa.project_id}/databases/(default)/documents`;
      const col = encodeURIComponent(String(c.v('collection') || '')).replace(/%2F/g, '/');
      const id = encodeURIComponent(String(c.v('docId') ?? ''));
      const op = c.raw('op');
      const data = () => { const d = c.v('data'); const o = typeof d === 'string' ? JSON.parse(d) : d; if (!isObj(o)) throw new Error('Data must be an object'); return o; };
      if (op === 'get') {
        const { res } = await call(c, 'GET', `${root}/${col}/${id}`);
        if (res.status === 404) return { port: 'notFound', out: { id: c.v('docId'), found: false } };
        if (res.status >= 400) throw new Error(`Firestore get failed (${res.status}): ${JSON.stringify(res.body).slice(0, 300)}`);
        return { out: docOut(res.body) };
      }
      if (op === 'set') {
        const o = data();
        const mask = c.raw('merge') ? '?' + Object.keys(o).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&') : '';
        const { res } = await call(c, 'PATCH', `${root}/${col}/${id}${mask}`, { fields: toFirestore(o).mapValue.fields });
        if (res.status >= 400) throw new Error(`Firestore set failed (${res.status}): ${JSON.stringify(res.body).slice(0, 300)}`);
        return { out: docOut(res.body) };
      }
      if (op === 'add') {
        const { res } = await call(c, 'POST', `${root}/${col}?documentId=${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`, { fields: toFirestore(data()).mapValue.fields });
        if (res.status >= 400) throw new Error(`Firestore add failed (${res.status}): ${JSON.stringify(res.body).slice(0, 300)}`);
        return { out: docOut(res.body) };
      }
      if (op === 'delete') {
        const { res } = await call(c, 'DELETE', `${root}/${col}/${id}`);
        if (res.status >= 400 && res.status !== 404) throw new Error(`Firestore delete failed (${res.status})`);
        return { out: { id: c.v('docId'), deleted: res.status < 400 } };
      }
      const filters = ((c.raw('where') as any[]) || []).filter(w => w?.k).map(w => {
        const [field, op2 = '='] = String(w.k).trim().split(/\s+/);
        if (!OPS[op2]) throw new Error(`Unknown query operator "${op2}"`);
        return { fieldFilter: { field: { fieldPath: field }, op: OPS[op2], value: toFirestore(c.resolve(w.v)) } };
      });
      const q: any = { from: [{ collectionId: String(c.v('collection')) }], limit: Number(c.raw('limit')) || 100 };
      if (filters.length === 1) q.where = filters[0];
      if (filters.length > 1) q.where = { compositeFilter: { op: 'AND', filters } };
      if (c.raw('orderBy')) { const [f, d] = String(c.raw('orderBy')).split(/\s+/); q.orderBy = [{ field: { fieldPath: f }, direction: /desc/i.test(d || '') ? 'DESCENDING' : 'ASCENDING' }]; }
      const { res } = await call(c, 'POST', `${root}:runQuery`, { structuredQuery: q });
      if (res.status >= 400) throw new Error(`Firestore query failed (${res.status}): ${JSON.stringify(res.body).slice(0, 300)}`);
      const docs = (Array.isArray(res.body) ? res.body : []).filter((x: any) => x.document).map((x: any) => docOut(x.document));
      return { out: { docs, count: docs.length } };
    },
  },
  {
    type: 'firebaseRtdb', palette: 'firebase', name: 'Realtime Database', glyph: '⟳', ports: ['out'],
    desc: 'Reads, writes, updates, pushes to or deletes a path in the Firebase Realtime Database.',
    fields: [
      F('connection', 'Firebase connection', 'resource', '', { resourceKind: 'firebase' }),
      F('op', 'Operation', 'select', 'get', { options: ['get', 'set', 'update', 'push', 'delete'] }),
      F('path', 'Path', 'text', 'orders/{{input.orderId}}', { tpl: true }),
      F('data', 'Data', 'code', '{{input}}', { tpl: true, ...when('op', 'set', 'update', 'push') }),
    ],
    outputHint: { value: {}, key: '' },
    execute: async c => {
      const r = requireResource(c.raw('connection'), 'firebase', 'Firebase connection');
      const url = `${base(r, String(r.config.databaseUrl || '').replace(/\/+$/, ''))}/${String(c.v('path') || '').replace(/^\/+/, '')}.json`;
      const op = c.raw('op');
      const m = { get: 'GET', set: 'PUT', update: 'PATCH', push: 'POST', delete: 'DELETE' }[op as 'get'] || 'GET';
      const d = c.v('data');
      const { res } = await call(c, m, url, ['PUT', 'PATCH', 'POST'].includes(m) ? (typeof d === 'string' ? JSON.parse(d) : d) : undefined);
      if (res.status >= 400) throw new Error(`Realtime Database ${op} failed (${res.status}): ${JSON.stringify(res.body).slice(0, 300)}`);
      return { out: op === 'push' ? { key: res.body?.name } : { value: res.body } };
    },
  },
  {
    type: 'firebaseNotify', palette: 'firebase', name: 'Push notification (FCM)', glyph: '🔔', ports: ['out'],
    desc: 'Sends a push notification with Firebase Cloud Messaging to a device token, a topic or a condition.',
    fields: [
      F('connection', 'Firebase connection', 'resource', '', { resourceKind: 'firebase' }),
      F('target', 'Send to', 'select', 'token', { options: ['token', 'topic', 'condition'] }),
      F('to', 'Device token / topic / condition', 'text', '{{input.deviceToken}}', { tpl: true }),
      F('title', 'Title', 'text', "=concat('Order ', {input.orderId}, ' shipped')", { tpl: true }),
      F('body', 'Text', 'textarea', 'Your order is on the way.', { tpl: true }),
      F('image', 'Image URL', 'text', '', { tpl: true }),
      F('data', 'Data (key/value)', 'kv', [{ k: 'orderId', v: '{{input.orderId}}' }], { tpl: true }),
      F('link', 'Open URL on click (web)', 'text', '', { tpl: true }),
    ],
    outputHint: { name: '' },
    execute: async c => {
      const r = requireResource(c.raw('connection'), 'firebase', 'Firebase connection');
      const sa = account(c, r);
      const message: any = {
        [c.raw('target') || 'token']: String(c.v('to') || ''),
        notification: { title: String(c.v('title') ?? ''), body: String(c.v('body') ?? ''), ...(c.v('image') ? { image: String(c.v('image')) } : {}) },
        data: Object.fromEntries(((c.raw('data') as any[]) || []).filter(x => x?.k).map(x => [x.k, String(c.resolve(x.v) ?? '')])),
      };
      if (c.v('link')) message.webpush = { fcm_options: { link: String(c.v('link')) } };
      const { res } = await call(c, 'POST', `${base(r, 'https://fcm.googleapis.com')}/v1/projects/${sa.project_id}/messages:send`, { message });
      if (res.status >= 400) throw new Error(`FCM send failed (${res.status}): ${JSON.stringify(res.body?.error?.message || res.body).slice(0, 300)}`);
      return { out: { name: res.body?.name } };
    },
  },
];

/** Test connection: signs in with the service account. */
export async function testFirebase(r: Resource, secret: (n: string, w?: string) => string): Promise<string> {
  let sa: Sa;
  try { sa = JSON.parse(secret(r.config.serviceAccountSecret, 'Firebase service account')); } catch (e: any) { throw new Error(/secret/.test(e?.message) ? e.message : 'The Firebase service account secret is not valid JSON'); }
  if (!sa.client_email || !sa.private_key || !sa.project_id) throw new Error('The service account JSON needs project_id, client_email and private_key');
  await googleServiceToken(sa, SCOPES, `test:${crypto.randomUUID()}`);
  return `Signed in to Firebase project ${sa.project_id} as ${sa.client_email}`;
}
