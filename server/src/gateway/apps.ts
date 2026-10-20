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
import { asyncDatabase } from '../asyncdb.js';
import { SignJWT, jwtVerify } from 'jose';
import { q, tx, now, getSetting, setSetting } from '../db.js';
import { config } from '../config.js';
import { ipAllowed } from '../security/inbound.js';
import { schemaTree } from '../schemas.js';
import { jsonSchemaOf } from '../mcp.js';
import { effectiveResource } from '../resources.js';

/**
 * Gateway management: who may call the deployed services and how much.
 *
 *  Apps      API consumers (a partner, a mobile app, a team). Each has scopes, a plan, and API keys
 *            (sfk_<id>_<secret>, shown once, stored as hashes) that also serve as OAuth2 client
 *            secrets: POST /oauth/token on the gateway gives a short access token for an app.
 *  Policies  An API security policy with "Gateway apps" accepts an app key or access token holding
 *            the scopes the policy requires.
 *  Plans     Requests per minute, hour and day, and a monthly quota. Counted in the database, so all
 *            engines of a cluster share one count. Over a limit: 429 with Retry-After.
 *  Firewall  Addresses allowed or denied for the whole gateway.
 *  Log       Every gateway request, for statistics and the request log; kept for a number of days.
 */

// ---------- plans ----------

export interface Plan { id: string; name: string; description: string; perMinute: number; perHour: number; perDay: number; perMonth: number }
const planRow = (r: any): Plan => ({ id: r.id, name: r.name, description: r.description || '', perMinute: Number(r.per_minute) || 0, perHour: Number(r.per_hour) || 0, perDay: Number(r.per_day) || 0, perMonth: Number(r.per_month) || 0 });

export function listPlans() {
  return q.all<any>('select * from gw_plans order by name').map(r => ({ ...planRow(r), apps: Number(q.get<any>('select count(*) n from gw_apps where plan_id = ?', r.id)?.n || 0) }));
}
export const getPlan = (id: string | null | undefined) => { const r = id ? q.get<any>('select * from gw_plans where id = ?', id) : undefined; return r ? planRow(r) : null; };

export function savePlan(p: Partial<Plan> & { name: string }) {
  const name = String(p.name || '').trim();
  if (!name) throw new Error('The plan needs a name');
  const n = (v: unknown, label: string) => { const x = Number(v || 0); if (!Number.isInteger(x) || x < 0) throw new Error(`${label}: a whole number, 0 = no limit`); return x; };
  const id = p.id || 'plan-' + crypto.randomBytes(4).toString('hex');
  if (q.get('select 1 from gw_plans where lower(name) = lower(?) and id != ?', name, id)) throw new Error(`A plan named "${name}" exists`);
  q.run(`insert into gw_plans(id, name, description, per_minute, per_hour, per_day, per_month, updated_at) values(?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set name = excluded.name, description = excluded.description, per_minute = excluded.per_minute, per_hour = excluded.per_hour, per_day = excluded.per_day, per_month = excluded.per_month, updated_at = excluded.updated_at`,
  id, name, String(p.description || ''), n(p.perMinute, 'Per minute'), n(p.perHour, 'Per hour'), n(p.perDay, 'Per day'), n(p.perMonth, 'Per month'), now());
  return getPlan(id)!;
}
export function deletePlan(id: string) {
  if (q.get('select 1 from gw_apps where plan_id = ?', id)) throw new Error('Apps still use this plan; move them to another plan first');
  q.run('delete from gw_plans where id = ?', id);
}

// ---------- apps and keys ----------

export interface App { id: string; name: string; description: string; contact: string; planId: string; scopes: string[]; disabled: boolean; createdAt: string }
const appRow = (r: any): App => ({ id: r.id, name: r.name, description: r.description || '', contact: r.contact || '', planId: r.plan_id || '', scopes: JSON.parse(r.scopes || '[]'), disabled: !!Number(r.disabled), createdAt: r.created_at });
const SCOPE = /^[\w:.-]{1,64}$/;

export function listApps() {
  return q.all<any>('select * from gw_apps order by name').map(r => ({
    ...appRow(r),
    keys: Number(q.get<any>('select count(*) n from gw_keys where app_id = ?', r.id)?.n || 0),
    lastUsed: q.get<any>('select max(last_used) t from gw_keys where app_id = ?', r.id)?.t || null,
  }));
}
export const getApp = (id: string) => { const r = q.get<any>('select * from gw_apps where id = ?', id); return r ? appRow(r) : null; };

export function saveApp(a: Partial<App> & { name: string }) {
  const name = String(a.name || '').trim();
  if (!name) throw new Error('The app needs a name');
  const scopes = [...new Set((a.scopes || []).map(s => String(s).trim()).filter(Boolean))];
  const bad = scopes.filter(s => !SCOPE.test(s));
  if (bad.length) throw new Error(`Scopes are words like orders:read; not: ${bad.join(', ')}`);
  if (a.planId && !getPlan(a.planId)) throw new Error('Unknown plan');
  const id = a.id || 'app-' + crypto.randomBytes(4).toString('hex');
  if (q.get('select 1 from gw_apps where lower(name) = lower(?) and id != ?', name, id)) throw new Error(`An app named "${name}" exists`);
  const existing = getApp(id);
  q.run(`insert into gw_apps(id, name, description, contact, plan_id, scopes, disabled, created_at, updated_at) values(?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set name = excluded.name, description = excluded.description, contact = excluded.contact, plan_id = excluded.plan_id, scopes = excluded.scopes, disabled = excluded.disabled, updated_at = excluded.updated_at`,
  id, name, String(a.description ?? existing?.description ?? ''), String(a.contact ?? existing?.contact ?? ''), a.planId ?? existing?.planId ?? '', JSON.stringify(scopes),
  (a.disabled ?? existing?.disabled) ? 1 : 0, existing?.createdAt || now(), now());
  return getApp(id)!;
}
export function deleteApp(id: string) {
  tx(() => { q.run('delete from gw_keys where app_id = ?', id); q.run('delete from gw_usage where app_id = ?', id); q.run('delete from gw_apps where id = ?', id); });
}

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export function listKeys(appId: string) {
  return q.all<any>('select id, name, created_at, expires_at, last_used from gw_keys where app_id = ? order by created_at', appId).map(k => ({
    id: k.id, name: k.name, createdAt: k.created_at, expiresAt: Number(k.expires_at) ? new Date(Number(k.expires_at)).toISOString() : null, lastUsed: k.last_used, expired: !!Number(k.expires_at) && Number(k.expires_at) < Date.now(),
  }));
}
/** A new key; its value is returned once and only its hash is kept. */
export function createKey(appId: string, name: string, expiresDays = 0) {
  if (!getApp(appId)) throw new Error('App not found');
  const id = crypto.randomBytes(6).toString('hex');
  const key = `sfk_${id}_${crypto.randomBytes(24).toString('base64url')}`;
  const exp = expiresDays > 0 ? Date.now() + expiresDays * 86400e3 : 0;
  q.run('insert into gw_keys(id, app_id, name, hash, created_at, expires_at) values(?, ?, ?, ?, ?, ?)', id, appId, String(name || 'key').slice(0, 80), sha(key), now(), exp);
  return { id, key, expiresAt: exp ? new Date(exp).toISOString() : null };
}
export const deleteKey = (appId: string, id: string) => q.run('delete from gw_keys where app_id = ? and id = ?', appId, id);

/** The app an API key belongs to (active, key not expired), or null. */
export function appOfKey(key: string): App | null {
  const m = /^sfk_([0-9a-f]{12})_[\w-]+$/.exec(key || '');
  if (!m) return null;
  const k = q.get<any>('select app_id, hash, expires_at from gw_keys where id = ?', m[1]);
  if (!k) return null;
  const a = Buffer.from(sha(key)), b = Buffer.from(String(k.hash));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Number(k.expires_at) && Number(k.expires_at) < Date.now()) return null;
  const app = getApp(k.app_id);
  if (!app || app.disabled) return null;
  q.run('update gw_keys set last_used = ? where id = ?', now(), m[1]);
  return app;
}

// ---------- OAuth2 client credentials ----------

const tokenKey = () => {
  let k = getSetting<string>('gateway.tokenKey', '');
  if (!k) { k = crypto.randomBytes(32).toString('base64'); setSetting('gateway.tokenKey', k); }
  return Buffer.from(k, 'base64');
};
export const TOKEN_SECONDS = 3600;

/** client_credentials: the app id and one of its keys give a short access token for the requested scopes. */
export async function issueToken(clientId: string, clientSecret: string, scope?: string) {
  const app = appOfKey(clientSecret);
  if (!app || app.id !== clientId) throw Object.assign(new Error('invalid_client'), { status: 401 });
  const asked = String(scope || '').split(/\s+/).filter(Boolean);
  const notAllowed = asked.filter(s => !app.scopes.includes(s));
  if (notAllowed.length) throw Object.assign(new Error('invalid_scope'), { status: 400, detail: `Not allowed for this app: ${notAllowed.join(' ')}` });
  const scopes = asked.length ? asked : app.scopes;
  const token = await new SignJWT({ scope: scopes.join(' '), app: app.id }).setProtectedHeader({ alg: 'HS256' }).setSubject(app.id).setIssuer('sutraflow-gateway')
    .setIssuedAt().setExpirationTime(`${TOKEN_SECONDS}s`).sign(tokenKey());
  return { access_token: token, token_type: 'Bearer', expires_in: TOKEN_SECONDS, scope: scopes.join(' ') };
}

/** The app and scopes of an access token from issueToken, or null. */
export async function appOfToken(token: string): Promise<{ app: App; scopes: string[] } | null> {
  try {
    const { payload } = await jwtVerify(token, tokenKey(), { issuer: 'sutraflow-gateway', algorithms: ['HS256'] });
    const app = getApp(String(payload.sub));
    if (!app || app.disabled) return null;
    // Scopes taken away from the app since the token was made no longer count.
    return { app, scopes: String(payload.scope || '').split(/\s+/).filter(s => s && app.scopes.includes(s)) };
  } catch { return null; }
}

// ---------- plan limits ----------

const WINDOWS: { k: keyof Plan; tag: string; ms: number; key(d: Date): string; ends(d: Date): number }[] = [
  { k: 'perMinute', tag: 'minute', ms: 60e3, key: d => 'm' + d.toISOString().slice(0, 16), ends: d => Math.floor(d.getTime() / 60e3) * 60e3 + 60e3 },
  { k: 'perHour', tag: 'hour', ms: 3600e3, key: d => 'h' + d.toISOString().slice(0, 13), ends: d => Math.floor(d.getTime() / 3600e3) * 3600e3 + 3600e3 },
  { k: 'perDay', tag: 'day', ms: 86400e3, key: d => 'd' + d.toISOString().slice(0, 10), ends: d => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) },
  { k: 'perMonth', tag: 'month', ms: 31 * 86400e3, key: d => 'M' + d.toISOString().slice(0, 7), ends: d => Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) },
];

/**
 * Counts one request against the app's plan. Returns rate-limit headers, or throws when a limit is
 * reached (the request is not counted then). Windows are calendar windows in UTC.
 */
export function consume(app: App, at = new Date()): { ok: true; headers: Record<string, string> } | { ok: false; window: string; limit: number; retryAfter: number } {
  const plan = getPlan(app.planId);
  const active = plan ? WINDOWS.filter(w => Number(plan[w.k]) > 0) : [];
  if (!active.length) return { ok: true, headers: {} };
  return tx(() => {
    const counts = active.map(w => ({ w, limit: Number(plan![w.k]), n: Number(q.get<any>('select n from gw_usage where app_id = ? and win = ?', app.id, w.key(at))?.n || 0) }));
    const full = counts.find(c => c.n >= c.limit);
    if (full) return { ok: false as const, window: full.w.tag, limit: full.limit, retryAfter: Math.max(1, Math.ceil((full.w.ends(at) - at.getTime()) / 1000)) };
    for (const c of counts) {
      q.run(`insert into gw_usage(app_id, win, n, expires) values(?, ?, 1, ?) on conflict(app_id, win) do update set n = gw_usage.n + 1`, app.id, c.w.key(at), c.w.ends(at));
    }
    // The tightest window (fewest left) is reported in the headers.
    const tight = counts.map(c => ({ ...c, left: c.limit - c.n - 1 })).sort((a, b) => a.left - b.left)[0];
    return { ok: true as const, headers: { 'x-ratelimit-limit': String(tight.limit), 'x-ratelimit-remaining': String(Math.max(0, tight.left)), 'x-ratelimit-reset': String(Math.ceil(tight.w.ends(at) / 1000)), 'x-ratelimit-window': tight.w.tag } };
  });
}

/** Usage of an app in the current windows. */
export function usageOf(appId: string, at = new Date()) {
  return Object.fromEntries(WINDOWS.map(w => [w.tag, Number(q.get<any>('select n from gw_usage where app_id = ? and win = ?', appId, w.key(at))?.n || 0)]));
}

// ---------- firewall ----------

export interface Firewall { allow: string[]; deny: string[] }
/** The firewall, read at most every two seconds (it is checked on every request); a change here applies at once. */
let firewallCache: { at: number; f: Firewall } | null = null;
export const getFirewall = (): Firewall => {
  if (firewallCache && Date.now() - firewallCache.at < 2000) return firewallCache.f;
  const f = { allow: [], deny: [], ...getSetting<Partial<Firewall>>('gateway.firewall', {}) } as Firewall;
  firewallCache = { at: Date.now(), f };
  return f;
};
const IP_RULE = /^[0-9a-fA-F:.]+(\/\d{1,3})?$/;
export function setFirewall(f: Partial<Firewall>) {
  const clean = (l: unknown) => [...new Set((Array.isArray(l) ? l : []).map(x => String(x).trim()).filter(Boolean))];
  const allow = clean(f.allow), deny = clean(f.deny);
  const bad = [...allow, ...deny].filter(x => !IP_RULE.test(x));
  if (bad.length) throw new Error(`Not an IP address or CIDR range: ${bad.join(', ')}`);
  setSetting('gateway.firewall', { allow, deny });
  firewallCache = null;
  return getFirewall();
}
/** Whether the gateway serves this address: never when denied; when an allow list exists, only those. */
export function firewallAllows(ip: string, f = getFirewall()) {
  if (f.deny.length && ipAllowed(ip, f.deny)) return false;
  return ipAllowed(ip, f.allow);
}

// ---------- settings, request log, statistics ----------

export interface GatewayOptions { logRequests: boolean; logDays: number; publishOpenApi: boolean }
export const getGatewayOptions = (): GatewayOptions => ({ logRequests: true, logDays: 14, publishOpenApi: false, ...getSetting<Partial<GatewayOptions>>('gateway.options', {}) });
export function setGatewayOptions(o: Partial<GatewayOptions>) {
  const cur = getGatewayOptions();
  const days = o.logDays === undefined ? cur.logDays : Number(o.logDays);
  if (!Number.isInteger(days) || days < 0 || days > 3650) throw new Error('Keep the request log: 0 to 3650 days');
  setSetting('gateway.options', { logRequests: o.logRequests ?? cur.logRequests, logDays: days, publishOpenApi: o.publishOpenApi ?? cur.publishOpenApi });
  return getGatewayOptions();
}

export interface RequestEntry { kind: string; method: string; path: string; route?: string; flowId?: string; projectId?: string; appId?: string; caller?: string; status: number; ms: number; bytesIn: number; bytesOut: number; ip: string; runId?: string; error?: string }

let logOn = { at: 0, on: true };
/** Writes one request to the log. The gateway does not wait for it; the returned promise is for tests and tools. */
export function logRequest(e: RequestEntry): Promise<void> {
  // The setting is read at most every few seconds; every engine logs its own requests.
  if (Date.now() - logOn.at > 5000) logOn = { at: Date.now(), on: getGatewayOptions().logRequests };
  if (!logOn.on) return Promise.resolve();
  // Written without waiting: the caller has its answer already, and the log must not hold the engine.
  return asyncDatabase().run(`insert into gw_requests(at, engine, kind, method, path, route, flow_id, project_id, app_id, caller, status, ms, bytes_in, bytes_out, ip, run_id, error)
      values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  now(), config.engineId, e.kind, e.method, e.path.slice(0, 500), e.route || '', e.flowId || '', e.projectId || '', e.appId || '', (e.caller || '').slice(0, 120),
  e.status, Math.round(e.ms), e.bytesIn, e.bytesOut, e.ip, e.runId || '', (e.error || '').slice(0, 500)).then(() => {}, err => { console.error('Gateway log:', err?.message || err); });
}

/** Deletes old log entries and finished usage windows (housekeeping). */
export function pruneGateway(nowMs = Date.now()) {
  const days = getGatewayOptions().logDays;
  const requests = days > 0 ? Number(q.run('delete from gw_requests where at < ?', new Date(nowMs - days * 86400e3).toISOString()).changes || 0) : 0;
  const usage = Number(q.run('delete from gw_usage where expires < ?', nowMs - 86400e3).changes || 0);
  return { requests, usage };
}

type Visible = 'all' | Set<string>;
const scope = (v: Visible, col = 'project_id') => (v === 'all' ? { sql: '', args: [] as string[] } : v.size ? { sql: ` and ${col} in (${[...v].map(() => '?').join(', ')})`, args: [...v] } : { sql: ' and 1 = 0', args: [] });
const pct = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0);

export const PERIODS: Record<string, { ms: number; bucketMs: number }> = {
  '1h': { ms: 3600e3, bucketMs: 60e3 }, '24h': { ms: 86400e3, bucketMs: 3600e3 }, '7d': { ms: 7 * 86400e3, bucketMs: 6 * 3600e3 }, '30d': { ms: 30 * 86400e3, bucketMs: 86400e3 },
};

/** Traffic in a period: totals, latency percentiles, a timeline, top and slowest services, apps, statuses. */
export function stats(period: string, visible: Visible, nowMs = Date.now()) {
  const p = PERIODS[period] || PERIODS['24h'];
  const from = new Date(nowMs - p.ms).toISOString();
  const s = scope(visible);
  const rows = q.all<any>(`select at, route, app_id, status, ms, kind from gw_requests where at >= ?${s.sql}`, from, ...s.args);
  const ms = rows.map(r => Number(r.ms)).sort((a, b) => a - b);
  const errors = rows.filter(r => Number(r.status) >= 500).length;
  const refused = rows.filter(r => Number(r.status) >= 400 && Number(r.status) < 500).length;
  const start = Math.floor((nowMs - p.ms) / p.bucketMs) * p.bucketMs;
  const n = Math.ceil((nowMs - start) / p.bucketMs);
  const timeline = Array.from({ length: n }, (_x, i) => ({ at: new Date(start + i * p.bucketMs).toISOString(), requests: 0, errors: 0, refused: 0 }));
  for (const r of rows) {
    const i = Math.floor((Date.parse(r.at) - start) / p.bucketMs);
    if (i < 0 || i >= n) continue;
    timeline[i].requests++;
    if (Number(r.status) >= 500) timeline[i].errors++;
    else if (Number(r.status) >= 400) timeline[i].refused++;
  }
  const group = (key: (r: any) => string) => {
    const m = new Map<string, number[]>(), e = new Map<string, number>();
    for (const r of rows) { const k = key(r); if (!k) continue; (m.get(k) || m.set(k, []).get(k)!).push(Number(r.ms)); if (Number(r.status) >= 400) e.set(k, (e.get(k) || 0) + 1); }
    return [...m].map(([k, v]) => { v.sort((a, b) => a - b); return { name: k, requests: v.length, errors: e.get(k) || 0, avgMs: Math.round(v.reduce((a, b) => a + b, 0) / v.length), p95Ms: pct(v, 95) }; });
  };
  const apps = new Map(q.all<any>('select id, name from gw_apps').map(a => [a.id, a.name]));
  const services = group(r => r.route);
  const byStatus: Record<string, number> = {};
  for (const r of rows) { const c = `${String(r.status)[0]}xx`; byStatus[c] = (byStatus[c] || 0) + 1; }
  return {
    period, from, to: new Date(nowMs).toISOString(), bucketMs: p.bucketMs,
    totals: { requests: rows.length, errors, refused, errorRate: rows.length ? errors / rows.length : 0, p50Ms: pct(ms, 50), p95Ms: pct(ms, 95), p99Ms: pct(ms, 99) },
    timeline, byStatus,
    topServices: [...services].sort((a, b) => b.requests - a.requests).slice(0, 10),
    slowestServices: [...services].sort((a, b) => b.p95Ms - a.p95Ms).slice(0, 10),
    topApps: group(r => (r.app_id ? apps.get(r.app_id) || r.app_id : '')).sort((a, b) => b.requests - a.requests).slice(0, 10),
  };
}

export function requestLog(f: { route?: string; appId?: string; status?: string; text?: string; before?: number; limit?: number }, visible: Visible) {
  const where: string[] = [], args: any[] = [];
  if (f.route) { where.push('route = ?'); args.push(f.route); }
  if (f.appId) { where.push('app_id = ?'); args.push(f.appId); }
  if (f.status === 'errors') where.push('status >= 500');
  else if (f.status === 'refused') where.push('status >= 400 and status < 500');
  else if (f.status === 'ok') where.push('status < 400');
  if (f.text) { where.push('(lower(path) like ? or lower(caller) like ? or lower(error) like ?)'); const t = `%${f.text.toLowerCase()}%`; args.push(t, t, t); }
  if (f.before) { where.push('id < ?'); args.push(f.before); }
  const s = scope(visible);
  const apps = new Map(q.all<any>('select id, name from gw_apps').map(a => [a.id, a.name]));
  return q.all<any>(`select * from gw_requests where 1 = 1${where.length ? ' and ' + where.join(' and ') : ''}${s.sql} order by id desc limit ?`, ...args, ...s.args, Math.min(500, Number(f.limit) || 100))
    .map(r => ({ id: Number(r.id), at: r.at, engine: r.engine, kind: r.kind, method: r.method, path: r.path, route: r.route, flowId: r.flow_id, projectId: r.project_id, app: r.app_id ? apps.get(r.app_id) || r.app_id : '', caller: r.caller, status: Number(r.status), ms: Number(r.ms), bytesIn: Number(r.bytes_in), bytesOut: Number(r.bytes_out), ip: r.ip, runId: r.run_id, error: r.error }));
}

// ---------- OpenAPI ----------

export interface ApiRoute { kind: string; method: string; path: string; flowName: string; projectId: string; version: number; node: any }

/** OpenAPI 3.1 for the deployed REST services (and SOAP endpoints as POST), with their security. */
export function openApi(list: ApiRoute[], baseUrl: string, visible: Visible = 'all') {
  const paths: Record<string, any> = {};
  const schemes: Record<string, any> = {};
  for (const r of list.filter(x => visible === 'all' || visible.has(x.projectId))) {
    const p = r.path.replace(/:([A-Za-z_]\w*)/g, '{$1}');
    const params = [...r.path.matchAll(/:([A-Za-z_]\w*)/g)].map(m => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }));
    let body: any;
    if (r.node.config.bodySchema) { try { const t = schemaTree(r.node.config.bodySchema); body = t ? jsonSchemaOf(t) : undefined; } catch { body = undefined; } }
    const pol = r.node.config.policy ? effectiveResource(r.node.config.policy) : undefined;
    const security: any[] = [];
    if (pol) {
      const c = pol.config;
      if (c.auth === 'apiKey') { schemes.apiKey = { type: 'apiKey', in: 'header', name: c.apiKeyHeader || 'X-API-Key' }; security.push({ apiKey: [] }); }
      if (c.auth === 'basic') { schemes.basic = { type: 'http', scheme: 'basic' }; security.push({ basic: [] }); }
      if (c.auth === 'jwt') { schemes.bearer = { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }; security.push({ bearer: String(c.jwtScopes || '').split(/\s+/).filter(Boolean) }); }
      if (c.auth === 'mtls') { schemes.mutualTLS = { type: 'mutualTLS' }; security.push({ mutualTLS: [] }); }
      if (c.auth === 'oauth2Introspection') { schemes.token = { type: 'http', scheme: 'bearer', description: 'An access token from the identity provider' }; security.push({ token: [...String(c.jwtScopes || '').split(/\s+/), ...String(r.node.config.requiredScopes || '').split(/\s+/)].filter(Boolean) }); }
      if (c.auth === 'hmac') { schemes.signature = { type: 'apiKey', in: 'header', name: c.hmacHeader || 'X-Signature', description: `HMAC-${String(c.hmacAlgorithm || 'sha256').toUpperCase()} of the ${c.hmacSigned || 'timestamp and body'} (${c.hmacTimestampHeader || 'X-Timestamp'} header: Unix seconds)` }; security.push({ signature: [] }); }
      if (c.auth === 'apps') {
        const sc = String(c.appScopes || '').split(/\s+/).filter(Boolean);
        schemes.appKey = { type: 'apiKey', in: 'header', name: c.apiKeyHeader || 'X-API-Key', description: 'An API key of a gateway app' };
        schemes.appToken = { type: 'oauth2', flows: { clientCredentials: { tokenUrl: `${baseUrl}/oauth/token`, scopes: Object.fromEntries(sc.map(s => [s, s])) } } };
        security.push({ appKey: [] }, { appToken: sc });
      }
    }
    const methods = r.kind === 'soap' ? ['post'] : r.method === 'ANY' ? ['get', 'post', 'put', 'patch', 'delete'] : [r.method.toLowerCase()];
    for (const m of methods) {
      (paths[p] ||= {})[m] = {
        summary: r.flowName, operationId: `${r.flowName.replace(/\W+/g, '_')}_${m}`, tags: [r.kind === 'soap' ? 'SOAP' : 'REST'],
        ...(params.length ? { parameters: params } : {}),
        ...(['get', 'delete'].includes(m) ? {} : { requestBody: { content: r.kind === 'soap' ? { 'text/xml': { schema: { type: 'string' } } } : { 'application/json': { schema: body || {} } } } }),
        responses: { default: { description: 'What the Sutra replies' }, 401: { description: 'Not signed in' }, 429: { description: 'Rate limit or quota reached' }, 504: { description: 'The Sutra did not reply in time' } },
        ...(security.length ? { security } : {}),
      };
    }
  }
  return { openapi: '3.1.0', info: { title: 'SutraFlow gateway', version: '1.0.0', description: 'Deployed services of this SutraFlow gateway.' }, servers: [{ url: baseUrl }], paths, components: { securitySchemes: schemes } };
}
