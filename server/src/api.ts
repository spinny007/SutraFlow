import crypto from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { q } from './db.js';
import { engine } from './engine/engine.js';
import * as flows from './flows.js';
import { PALETTES } from './palettes/index.js';
import { describeWsdl } from './palettes/soap.js';
import { RESOURCE_KINDS, listResources, getResource, saveResource, deleteResource } from './resources.js';
import { listSecrets, setSecret, deleteSecret } from './secrets.js';
import { PIPES, resolve } from './template.js';
import * as auth from './auth.js';
import * as access from './access.js';
import type { Caller } from './access.js';
import { RULES, OPEN_ROUTES, check, auditRequest } from './guard.js';
import { audit, listAudit, auditCsv } from './audit.js';
import { gatewayStatus, getGatewaySettings, setGatewaySettings, listRoutes, startGateway, reloadTls } from './gateway/gateway.js';
import { acmeStatus, certInfo, getTls, setTls, makeSelfSigned, storeCert, requestAcme } from './gateway/tls.js';
import { schedulerErrors } from './scheduler.js';
import { config, version, rootDir } from './config.js';
import * as projects from './projects.js';
import * as schemas from './schemas.js';
import { designSchemas } from './design.js';
import { evalExpression, functionCatalog, refsOf, ExprError } from './expr.js';
import { tailLog } from './logger.js';
import * as oauth from './connectors/oauth.js';
import { listenerStatus } from './listeners.js';
import { testResource, prepare } from './resourceTest.js';
import { listModels, ollamaPull, ollamaImport } from './ai/providers.js';
import { addSamples, SAMPLES } from './samples.js';
import { health, readiness, lifecycle } from './lifecycle.js';
import { clusterStatus } from './cluster.js';
import { prometheusText } from './metrics.js';
import { tracingStats } from './tracing.js';
import { housekeeping } from './housekeeping.js';
import { buildPackage, checkPackage, deployPackage, packageHistory, readPackage, rollbackPackage, testPackage } from './packages.js';

const COOKIE = 'sutra_session';

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const bad = (m: string) => new HttpError(400, m);

function cookie(req: FastifyRequest, name: string) {
  const c = req.headers.cookie || '';
  for (const part of c.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

function activityMeta() {
  return engine.allActivities().map(a => {
    const meta: any = {
      type: a.type, palette: a.palette, name: a.name, glyph: a.glyph, desc: a.desc, trigger: !!a.trigger,
      join: !!a.join, noErrorPort: !!a.noErrorPort, noInput: !!a.noInput, fields: a.fields, outputHint: a.outputHint ?? null,
    };
    if (typeof a.ports === 'function') {
      const field = a.fields.find(f => f.ports)?.k || '';
      const probe = a.ports({ [field]: '__probe__' });
      meta.ports = { field, extra: probe.filter(p => p !== '__probe__'), fallback: a.ports({}) };
    } else meta.ports = a.ports;
    return meta;
  });
}

function runDetail(id: string) {
  const r = q.get<any>('select * from runs where id = ?', id);
  if (!r) throw new HttpError(404, 'Run not found');
  const tasks = q.all<any>('select id, node_id, status, attempt, port, input, output, error, ms, wait, started_at, finished_at, owner from tasks where run_id = ? order by id', id)
    .map(t => ({ ...t, input: t.input ? JSON.parse(t.input) : null, output: t.output ? JSON.parse(t.output) : null, wait: t.wait ? JSON.parse(t.wait) : null }));
  const state = JSON.parse(r.state);
  return {
    id: r.id, flowId: r.flow_id, flowName: r.flow_name, version: r.version, status: r.status, source: r.source,
    triggerNode: r.trigger_node, error: r.error, steps: r.steps, startedAt: r.started_at, finishedAt: r.finished_at,
    doc: JSON.parse(r.doc), outputs: state.outputs, vars: state.vars, logs: state.logs, reply: state.reply ?? null, tasks,
    projectId: r.project_id, debug: r.debug ? JSON.parse(r.debug) : null,
  };
}

export async function buildAdmin(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 20 * 1024 * 1024, forceCloseConnections: 'idle', keepAliveTimeout: 5000 });

  app.setErrorHandler((err: any, _req, reply) => {
    const status = err instanceof HttpError ? err.status : err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    reply.code(status).send({ error: err.message || String(err), ...(err.check ? { check: err.check } : {}) });
  });

  // ---------- health and readiness (no sign-in: probes) ----------
  app.get('/health', async () => health());
  app.get('/ready', async (_req, reply) => { const r = readiness(); return reply.code(r.ready ? 200 : 503).send(r); });
  // Prometheus metrics: counters and histograms of this engine, gauges read now.
  app.get('/metrics', async (req, reply) => {
    if (config.metricsToken && String(req.headers.authorization || '') !== `Bearer ${config.metricsToken}`) return reply.code(401).send('metrics token required');
    const st = clusterStatus();
    const me = st.engines.find((e: any) => e.id === config.engineId);
    const listeners = [...listenerStatus.values()].reduce((m: Record<string, number>, l) => { m[l.state] = (m[l.state] || 0) + 1; return m; }, {});
    return reply.type('text/plain; version=0.0.4').send(prometheusText([
      { name: 'sutra_info', help: 'This engine: version, mode and name.', values: [{ labels: { version, mode: config.mode, engine: config.engineId }, v: 1 }] },
      { name: 'sutra_tasks', help: 'Steps in the shared queue by status.', values: Object.entries(st.tasks).map(([status, v]) => ({ labels: { status }, v: Number(v) })) },
      { name: 'sutra_engine_running_steps', help: 'Steps running on this engine now.', values: [{ v: engine.running }] },
      { name: 'sutra_engine_workers', help: 'Steps this engine may run at once.', values: [{ v: engine.concurrency }] },
      { name: 'sutra_engine_leader', help: '1 when this engine leads the cluster (timers, listeners).', values: [{ v: me?.leader ? 1 : 0 }] },
      { name: 'sutra_engines_alive', help: 'Engines with a recent heartbeat.', values: [{ v: st.engines.filter((e: any) => e.alive).length }] },
      { name: 'sutra_listeners', help: 'Polling listeners on this engine by state.', values: Object.entries(listeners).map(([state, v]) => ({ labels: { state }, v })) },
      { name: 'sutra_traces_exported_total', help: 'Spans sent to the OpenTelemetry collector.', values: [{ v: tracingStats.exported }] },
      { name: 'sutra_traces_failed_total', help: 'Spans the collector did not accept.', values: [{ v: tracingStats.failed }] },
    ]));
  });

  // ---------- who is calling, and may they ----------
  // Every /api route must have a rule in guard.ts; a route without one stops the start.
  const apiRoutes: string[] = [];
  app.addHook('onRoute', r => {
    const methods = Array.isArray(r.method) ? r.method : [r.method];
    for (const m of methods) if (r.url.startsWith('/api/') && m !== 'HEAD') apiRoutes.push(`${m} ${r.url}`);
  });
  // Headless engines: packages, runs, secrets, engine control, access and audit; no designer API.
  const ENGINE_API = [/^\/api\/packages\//, /^\/api\/projects\/?$/, /^\/api\/projects\/[^/]+\/(packages|rollback)$/, /^\/api\/engine\//, /^\/api\/runs/, /^\/api\/secrets/, /^\/api\/meta$/, /^\/api\/access\//, /^\/api\/audit/];
  const sameToken = (a: string, b: string) => !!a && !!b && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  /** The caller: the admin token (everything), a system account token, or a signed-in person. */
  const identify = (req: FastifyRequest): Caller | null => {
    const bearer = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''))?.[1];
    if (bearer) {
      if (sameToken(bearer, config.adminToken)) return { u: 'token', kind: 'token', all: true };
      const sys = access.tokenAccount(bearer);
      return sys ? { u: sys, kind: 'system' } : null;
    }
    if (config.mode === 'engine') return null;
    const s = auth.verifySession(cookie(req, COOKIE));
    return s && access.sessionValid(s.u, s.iat) ? { u: s.u, kind: 'user' } : null;
  };
  app.addHook('onRequest', async (req: FastifyRequest & { user?: Caller }, reply: FastifyReply) => {
    if (!req.url.startsWith('/api/')) return;
    const p = req.url.split('?')[0];
    const key = `${req.method} ${req.routeOptions?.url || p}`;
    if (config.mode === 'engine') {
      const who = identify(req);
      if (!who) return reply.code(401).send({ error: config.adminToken ? 'A headless engine accepts only API tokens (Authorization: Bearer ...)' : 'This headless engine has no SUTRA_ADMIN_TOKEN, so its API is closed' });
      if (!ENGINE_API.some(r => r.test(p))) return reply.code(404).send({ error: 'Not available on a headless engine' });
      req.user = who;
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-sutra'] !== '1' && !/^Bearer\s/i.test(String(req.headers.authorization || ''))) {
      return reply.code(403).send({ error: 'Missing X-Sutra header' });
    }
    if (OPEN_ROUTES.has(key)) return;
    const who = identify(req);
    if (!who) return reply.code(401).send({ error: 'Sign in required' });
    req.user = who;
    // A password an administrator set must be changed before anything else.
    if (who.kind === 'user' && key !== 'POST /api/auth/password' && key !== 'GET /api/access/me' && access.mustChangePassword(who.u)) {
      return reply.code(403).send({ error: 'Change your password first', mustChange: true });
    }
  });
  app.addHook('preHandler', async (req: any, reply: FastifyReply) => {
    if (!req.user || !req.url.startsWith('/api/')) return;
    const rule = RULES[`${req.method} ${req.routeOptions?.url}`];
    if (!rule) return reply.code(404).send({ error: 'Not found' });
    const denied = check(rule, req.user, req);
    if (denied) { auditRequest(req, 403, rule, denied); return reply.code(403).send({ error: denied }); }
  });
  app.addHook('onResponse', async (req: any, reply: FastifyReply) => {
    if (!req.user || !req.url.startsWith('/api/') || reply.statusCode === 403) return;
    auditRequest(req, reply.statusCode, RULES[`${req.method} ${req.routeOptions?.url}`]);
  });
  const setCookie = (reply: FastifyReply, token: string, secure: boolean) =>
    reply.header('set-cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${12 * 3600}${secure ? '; Secure' : ''}`);
  const signInAudit = (req: FastifyRequest, actor: string, action: string, outcome: 'ok' | 'denied' | 'failed', status: number, reason?: string) =>
    audit({ actor, actorKind: 'user', ip: req.ip, action, method: 'POST', path: req.url, status, outcome, details: reason ? { reason } : undefined });
  const caller = (req: any): Caller => req.user;

  app.get('/api/auth/status', async req => {
    const s = auth.verifySession(cookie(req, COOKIE));
    const ok = !!s && access.sessionValid(s.u, s.iat);
    return { setup: !auth.hasUsers(), user: ok ? access.me({ u: s!.u, kind: 'user' }) : null, version, mode: config.mode };
  });
  app.post('/api/auth/setup', async (req: any, reply) => {
    if (auth.hasUsers()) throw new HttpError(409, 'Already set up');
    const username = String(req.body?.username || 'admin');
    try { access.createAccount({ username, password: String(req.body?.password || ''), displayName: 'Administrator', mustChange: false, grants: [{ role: 'administrator', project: '' }] }); } catch (e: any) { throw bad(e.message); }
    signInAudit(req, username, 'Set up first administrator', 'ok', 200);
    setCookie(reply, auth.issue(username), req.protocol === 'https');
    return { ok: true };
  });
  app.post('/api/auth/login', async (req: any, reply) => {
    const username = String(req.body?.username || '');
    if (!auth.loginAllowed(req.ip)) { signInAudit(req, username, 'Sign in', 'denied', 429, 'too many attempts from this address'); throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.'); }
    const r = access.passwordSignIn(username, String(req.body?.password || ''));
    if (!r.ok) {
      auth.loginFailed(req.ip);
      signInAudit(req, username, 'Sign in', 'failed', 401, r.reason);
      if (r.reason === 'locked') throw new HttpError(423, `Account locked after ${access.LOCK_AFTER} wrong passwords. Try again in ${access.LOCK_MINUTES} minutes or ask an administrator to unlock it.`);
      if (r.reason === 'disabled') throw new HttpError(403, 'This account is disabled');
      throw new HttpError(401, 'Wrong username or password');
    }
    if (r.user.kind === 'system') { signInAudit(req, username, 'Sign in', 'denied', 403, 'system account'); throw new HttpError(403, 'System accounts sign in with API tokens, not here'); }
    signInAudit(req, username, 'Sign in', 'ok', 200);
    setCookie(reply, auth.issue(username), req.protocol === 'https');
    return { ok: true, mustChange: !!r.user.must_change };
  });
  app.post('/api/auth/logout', async (req, reply) => {
    const s = auth.verifySession(cookie(req, COOKIE));
    if (s) signInAudit(req, s.u, 'Sign out', 'ok', 200);
    reply.header('set-cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    return { ok: true };
  });
  app.post('/api/auth/password', async (req: any, reply) => {
    if (caller(req).kind !== 'user') throw bad('Only people change their password here');
    try { access.changeOwnPassword(caller(req).u, String(req.body?.current || ''), String(req.body?.password || '')); } catch (e: any) { throw bad(e.message); }
    setCookie(reply, auth.issue(caller(req).u), req.protocol === 'https');
    return { ok: true };
  });

  // ---------- users, system accounts, roles, audit ----------
  app.get('/api/access/me', async req => access.me(caller(req)));
  app.get('/api/access/permissions', async () => ({ permissions: access.PERMISSIONS }));
  const accessErr = (e: any): never => { throw /not found/i.test(e.message) ? new HttpError(404, e.message) : bad(e.message); };
  app.get('/api/access/roles', async () => access.listRoles());
  app.post('/api/access/roles', async (req: any) => { try { return access.saveRole({ ...req.body, id: undefined }); } catch (e) { return accessErr(e); } });
  app.put('/api/access/roles/:id', async (req: any) => { try { return access.saveRole({ ...req.body, id: req.params.id }); } catch (e) { return accessErr(e); } });
  app.delete('/api/access/roles/:id', async (req: any) => { try { access.deleteRole(req.params.id); return { ok: true }; } catch (e) { return accessErr(e); } });
  app.get('/api/access/users', async (req: any) => access.listUsers(req.query?.kind === 'system' || req.query?.kind === 'user' ? req.query.kind : undefined));
  app.post('/api/access/users', async (req: any) => { try { return access.createAccount(req.body || {}); } catch (e) { return accessErr(e); } });
  app.get('/api/access/users/:name', async (req: any) => access.getUser(req.params.name) ?? accessErr(new Error('Account not found')));
  app.put('/api/access/users/:name', async (req: any) => { try { return access.updateAccount(req.params.name, req.body || {}, caller(req).u); } catch (e) { return accessErr(e); } });
  app.delete('/api/access/users/:name', async (req: any) => { try { access.deleteAccount(req.params.name, caller(req).u); return { ok: true }; } catch (e) { return accessErr(e); } });
  app.post('/api/access/users/:name/password', async (req: any) => { try { access.resetPassword(req.params.name, String(req.body?.password || ''), req.body?.mustChange !== false); return { ok: true }; } catch (e) { return accessErr(e); } });
  app.post('/api/access/users/:name/unlock', async (req: any) => { access.unlock(req.params.name); return { ok: true }; });
  app.post('/api/access/users/:name/sign-out', async (req: any) => { access.endSessions(req.params.name); return { ok: true }; });
  app.get('/api/access/users/:name/tokens', async (req: any) => access.listTokens(req.params.name));
  app.post('/api/access/users/:name/tokens', async (req: any) => { try { return access.createToken(req.params.name, String(req.body?.name || ''), Number(req.body?.expiresDays) || 0); } catch (e) { return accessErr(e); } });
  app.delete('/api/access/users/:name/tokens/:id', async (req: any) => { access.deleteToken(req.params.name, req.params.id); return { ok: true }; });
  const auditFilter = (qs: any) => ({ actor: qs.actor, action: qs.action, projectId: qs.projectId, outcome: qs.outcome, from: qs.from, to: qs.to, text: qs.q, before: Number(qs.before) || undefined, limit: Number(qs.limit) || undefined });
  app.get('/api/audit', async (req: any) => listAudit(auditFilter(req.query || {})));
  app.get('/api/audit/export', async (req: any, reply) => {
    reply.header('content-disposition', `attachment; filename="sutraflow-audit-${new Date().toISOString().slice(0, 10)}.csv"`);
    return reply.type('text/csv; charset=utf-8').send(auditCsv(auditFilter(req.query || {})));
  });
  /** Lists show only the projects the caller may see. */
  const seen = (req: any) => { const v = access.visibleProjects(caller(req)); return (pid: string | null | undefined) => v === 'all' || (!!pid && v.has(pid)); };

  // ---------- catalog ----------
  app.get('/api/meta', async () => ({
    palettes: PALETTES,
    activities: activityMeta(),
    resourceKinds: RESOURCE_KINDS,
    pipes: Object.entries(PIPES).map(([name, p]) => ({ name, help: p.help })),
    functions: functionCatalog(),
    version,
  }));

  // ---------- projects ----------
  app.get('/api/projects', async req => { const ok = seen(req); return projects.listProjects().filter(p => ok(p.id)); });
  app.post('/api/projects', async (req: any) => projects.saveProject({ name: req.body?.name, description: req.body?.description }));
  app.get('/api/projects/:id', async (req: any) => projects.requireProject(req.params.id));
  app.put('/api/projects/:id', async (req: any) => { projects.requireProject(req.params.id); return projects.saveProject({ ...req.body, id: req.params.id }); });
  app.delete('/api/projects/:id', async (req: any) => { projects.deleteProject(req.params.id); return { ok: true }; });
  app.get('/api/projects/:id/ops', async (req: any) => projects.getOps(req.params.id));
  app.put('/api/projects/:id/ops', async (req: any) => projects.setOps(req.params.id, req.body || {}));
  app.get('/api/projects/:id/ops/file', async (req: any, reply) => {
    const f = projects.exportOpsFile(req.params.id);
    reply.header('content-disposition', `attachment; filename="${f.project.replace(/[^\w.-]+/g, '-')}.json"`);
    return f;
  });
  app.post('/api/projects/:id/ops/file', async (req: any) => projects.importOpsFile(req.params.id, req.body));
  app.get('/api/projects/:id/runtime-variables', async (req: any) => projects.runtimeVariables(req.params.id));
  app.delete('/api/projects/:id/runtime-variables', async (req: any) => { projects.clearRuntimeVariables(req.params.id); return { ok: true }; });
  app.get('/api/engine-variables', async () => projects.listEngineVariables());
  /** Adds the sample Sutras (For-Each mapping, loops, sub-Sutra, try / catch) to a project. */
  app.get('/api/samples', async () => SAMPLES);
  app.post('/api/projects/:id/samples', async (req: any) => {
    projects.requireProject(req.params.id);
    return addSamples(req.params.id, Array.isArray(req.body?.ids) ? req.body.ids.map(String) : undefined);
  });
  // ---------- project packages (releases) ----------
  const packErr = (e: any) => Object.assign(bad(e.message), e.check ? { check: e.check } : {});
  app.get('/api/projects/:id/package', async (req: any, reply) => {
    projects.requireProject(req.params.id);
    try {
      const p = buildPackage(req.params.id, { version: req.query?.version, note: req.query?.note, sutras: req.query?.sutras ? String(req.query.sutras).split(',').map((x: string) => x.trim()).filter(Boolean) : undefined });
      reply.header('content-disposition', `attachment; filename="${p.name.replace(/[^\w.-]+/g, '-')}-${p.version}.sutra"`);
      return p;
    } catch (e: any) { throw bad(e.message); }
  });
  app.post('/api/packages/check', async (req: any) => {
    try { return checkPackage(readPackage(req.body?.package), { project: req.body?.project }); } catch (e: any) { throw bad(e.message); }
  });
  app.post('/api/packages/deploy', async (req: any) => {
    try { return deployPackage(req.body?.package, { project: req.body?.project, ops: req.body?.ops, keepOthers: !!req.body?.keepOthers, by: req.user?.u }); } catch (e: any) { throw packErr(e); }
  });
  app.post('/api/packages/test', async (req: any) => {
    try { return await testPackage(req.body?.package, { skip: req.body?.skip }); } catch (e: any) { throw bad(e.message); }
  });
  app.get('/api/projects/:id/packages', async (req: any) => packageHistory(req.params.id));
  app.post('/api/projects/:id/rollback', async (req: any) => {
    try { return rollbackPackage(req.params.id, { to: req.body?.to, by: req.user?.u }); } catch (e: any) { throw packErr(e); }
  });

  // ---------- engine and cluster ----------
  app.get('/api/engine/status', async () => ({ ...clusterStatus(), ready: readiness(), health: health() }));
  /** Graceful stop of this engine (for orchestrators and Windows, where signals cannot drain). */
  app.post('/api/engine/drain', async (req: any, reply) => {
    if (!lifecycle.shutdown) throw bad('This server cannot be stopped from the API');
    reply.code(202).send({ draining: true, engine: config.engineId, drainMs: config.drainMs });
    setTimeout(() => { lifecycle.shutdown!().finally(() => { if (req.body?.exit !== false) process.exit(0); }); }, 50);
  });

  app.get('/api/releases/policy', async () => ({ allowed: projects.releasesAllowed() }));
  app.put('/api/releases/policy', async (req: any) => {
    projects.setReleasesAllowed(!!req.body?.allowed);
    return { allowed: projects.releasesAllowed() };
  });
  app.get('/api/scripts/policy', async () => ({ allowed: projects.scriptsAllowed() }));
  app.put('/api/scripts/policy', async (req: any) => {
    projects.setScriptsAllowed(!!req.body?.allowed);
    return { allowed: projects.scriptsAllowed() };
  });
  app.get('/api/engine-variables/policy', async () => ({ sutrasMayChange: projects.sutrasMayChangeSengine() }));
  app.put('/api/engine-variables/policy', async (req: any) => {
    projects.setSutrasMayChangeSengine(!!req.body?.sutrasMayChange);
    return { sutrasMayChange: projects.sutrasMayChangeSengine() };
  });
  app.put('/api/engine-variables', async (req: any) => {
    return projects.saveEngineVariables(Array.isArray(req.body) ? req.body : []);
  });
  app.get('/api/projects/:id/log', async (req: any) => tailLog(req.params.id, Math.min(2000, Number(req.query?.lines) || 200)));

  // ---------- OAuth connections ----------
  const redirectUri = (req: FastifyRequest) => `${req.protocol}://${req.headers.host}/api/oauth/callback`;
  app.get('/api/oauth/:id', async (req: any) => ({ ...oauth.connectionStatus(req.params.id), redirectUri: redirectUri(req) }));
  app.get('/api/oauth/:id/start', async (req: any) => ({ url: oauth.startUrl(req.params.id, redirectUri(req)) }));
  app.delete('/api/oauth/:id', async (req: any) => { oauth.disconnect(req.params.id); return { ok: true }; });
  app.get('/api/oauth/callback', async (req: any, reply) => {
    const page = (title: string, msg: string) => reply.type('text/html').send(`<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;padding:40px"><h2>${title}</h2><p>${msg.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]!)}</p><p>You can close this tab and return to SutraFlow.</p><script>setTimeout(()=>window.close(),3000)</script></body>`);
    if (req.query?.error) return page('Not connected', String(req.query.error_description || req.query.error));
    try { const r = await oauth.finish(String(req.query?.code || ''), String(req.query?.state || '')); return page('Account connected', `${r.name} is ready to use.`); }
    catch (e: any) { reply.code(400); return page('Not connected', e.message); }
  });

  // ---------- shared schemas ----------
  app.get('/api/schemas', async (req: any) => {
    if (!req.query?.projectId) throw bad('projectId is required');
    return schemas.listSchemas(req.query.projectId).map(x => ({ ...x, roots: x.kind === 'xsd' ? safe(() => schemas.schemaRoots(x.id), []) : [] }));
  });
  app.get('/api/schemas/:id', async (req: any) => schemas.getSchema(req.params.id) ?? (() => { throw new HttpError(404, 'Schema not found'); })());
  app.post('/api/schemas', async (req: any) => schemas.saveSchema(req.body));
  app.put('/api/schemas/:id', async (req: any) => schemas.saveSchema({ ...req.body, id: req.params.id }));
  app.delete('/api/schemas/:id', async (req: any) => { schemas.deleteSchema(req.params.id); return { ok: true }; });
  app.get('/api/schemas/:id/tree', async (req: any) => schemas.schemaTree(req.params.id + (req.query?.root ? '::' + req.query.root : '')));

  /** Design-time shapes of every step (Process Data, Activity Input trees, Output fields). */
  app.post('/api/design/schemas', async (req: any) => designSchemas(flows.normalizeDoc(req.body?.doc)));

  /** Live preview of a formula against sample data. */
  app.post('/api/expr/eval', async (req: any) => {
    const src = String(req.body?.expr ?? '');
    try {
      const sc = { now: new Date().toISOString(), ...(req.body?.scope || {}) };
      // mode "field": a raw field value (= formula or {{ }} template); otherwise a bare formula.
      const value = req.body?.mode === 'field' ? resolve(src, sc) : evalExpression(src.startsWith('=') ? src.slice(1) : src, sc);
      return { ok: true, value: value === undefined ? null : value, refs: refsOf(src.startsWith('=') ? src.slice(1) : src) };
    } catch (e: any) {
      return { ok: false, error: e.message, at: e instanceof ExprError ? e.at : undefined };
    }
  });

  // ---------- flows ----------
  app.get('/api/flows', async (req: any) => { const ok = seen(req); return flows.listFlows(req.query?.projectId).filter(f => ok(f.projectId)); });
  app.post('/api/flows', async (req: any) => flows.saveFlow(undefined, req.body?.doc ?? req.body, req.body?.projectId));
  app.get('/api/flows/:id', async (req: any) => flows.getFlow(req.params.id) ?? (() => { throw new HttpError(404, 'Sutra not found'); })());
  app.put('/api/flows/:id', async (req: any) => flows.saveFlow(req.params.id, req.body));
  app.delete('/api/flows/:id', async (req: any) => { flows.deleteFlow(req.params.id); return { ok: true }; });
  app.post('/api/flows/validate', async (req: any) => flows.validateDoc(flows.normalizeDoc(req.body)));
  app.get('/api/flows/:id/versions', async (req: any) => flows.versions(req.params.id));
  app.post('/api/flows/:id/deploy', async (req: any) => flows.deploy(req.params.id, req.body?.version ? Number(req.body.version) : undefined, req.body?.note));
  app.delete('/api/flows/:id/deploy', async (req: any) => { flows.undeploy(req.params.id); return { ok: true }; });

  /** Test run of the draft (what is on the canvas). */
  app.post('/api/flows/:id/test', async (req: any) => {
    const f = flows.getFlow(req.params.id);
    if (!f) throw new HttpError(404, 'Sutra not found');
    const doc = req.body?.doc ? flows.normalizeDoc(req.body.doc) : f.doc;
    const v = flows.validateDoc(doc);
    if (v.errors.length) throw bad(v.errors.join('\n'));
    const debug = req.body?.debug ? { stepping: req.body.debug.stepping !== false, breakpoints: (req.body.debug.breakpoints || []).map(String) } : undefined;
    const runId = engine.startRun({ doc, flowId: f.id, projectId: f.project_id, version: 0, triggerNodeId: req.body?.triggerNodeId, input: req.body?.input, source: debug ? 'debug' : 'test', debug });
    return { runId, warnings: v.warnings };
  });

  /** Latest run outputs of a flow, used by the mapper as sample data. */
  app.get('/api/flows/:id/sample', async (req: any) => {
    const r = q.get<any>(`select id from runs where flow_id = ? order by started_at desc limit 1`, req.params.id);
    if (!r) return { outputs: {}, runId: null };
    const d = runDetail(r.id);
    return { runId: d.id, outputs: d.outputs, vars: d.vars, triggerNode: d.triggerNode };
  });

  /** Run API: start the deployed version of a flow (Manual start trigger). */
  app.post('/api/flows/:id/run', async (req: any) => {
    const d = flows.deployedFlows().find(x => x.flowId === req.params.id);
    if (!d) throw bad('This Sutra is not deployed');
    const runId = engine.startRun({ doc: d.doc, flowId: d.flowId, projectId: d.projectId, version: d.version, triggerNodeId: req.body?.triggerNodeId, input: req.body?.input, source: 'api' });
    if (req.query?.wait) await engine.waitFor(runId, Math.min(120000, Number(req.query.wait) || 30000)).catch(() => {});
    return runDetail(runId);
  });

  // ---------- runs & approvals ----------
  app.get('/api/runs', async (req: any) => {
    const { flowId, status } = req.query || {};
    const limit = Math.min(500, Number(req.query?.limit) || 100);
    const where: string[] = [], args: any[] = [];
    if (flowId) { where.push('flow_id = ?'); args.push(flowId); }
    if (status) { where.push('status = ?'); args.push(status); }
    const ok = seen(req);
    return q.all<any>(`select id, flow_id flowId, flow_name flowName, version, status, source, error, steps, started_at startedAt, finished_at finishedAt, project_id projectId
      from runs ${where.length ? 'where ' + where.join(' and ') : ''} order by started_at desc limit ?`, ...args, limit).filter(r => ok(r.projectId));
  });
  app.get('/api/runs/:id', async (req: any) => runDetail(req.params.id));
  /** Runs a failed run again from the step that failed. */
  app.post('/api/runs/:id/resubmit', async (req: any) => {
    try { return engine.resubmit(req.params.id, req.user?.u); } catch (e: any) { throw bad(e.message); }
  });
  /** Deletes finished runs older than the retention period now (the leader also does it every minute). */
  app.post('/api/engine/housekeeping', async (req: any) => {
    return housekeeping({ retentionDays: req.body?.retentionDays !== undefined ? Number(req.body.retentionDays) : undefined });
  });
  app.post('/api/runs/:id/cancel', async (req: any) => ({ ok: engine.cancel(req.params.id) }));
  app.post('/api/runs/:id/debug', async (req: any) => {
    const a = String(req.body?.action || '');
    if (!['step', 'continue', 'pause', 'breakpoints'].includes(a)) throw bad('action must be step, continue, pause or breakpoints');
    return engine.debug(req.params.id, a as any, Array.isArray(req.body?.breakpoints) ? req.body.breakpoints : undefined);
  });
  app.get('/api/approvals', async req => {
    const ok = seen(req);
    return q.all<any>(`select t.id, t.run_id runId, t.node_id nodeId, t.wait, t.input, r.flow_name flowName, r.started_at startedAt, r.doc, r.project_id
      from tasks t join runs r on r.id = t.run_id where t.status = 'waiting' order by t.id`).filter(t => ok(t.project_id)).map(t => {
      const doc = JSON.parse(t.doc);
      return { id: t.id, runId: t.runId, flowName: t.flowName, startedAt: t.startedAt, step: doc.nodes.find((n: any) => n.id === t.nodeId)?.name, wait: JSON.parse(t.wait || '{}'), input: t.input ? JSON.parse(t.input) : null };
    });
  });
  app.post('/api/approvals/:id', async (req: any) => {
    engine.decide(Number(req.params.id), !!req.body?.approved, req.user.u, String(req.body?.comment || ''));
    return { ok: true };
  });

  /** Server-sent events: run status changes, for live canvas updates. */
  app.get('/api/events', (req, reply) => {
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    reply.raw.write(': connected\n\n');
    const fn = (runId: string) => {
      const r = q.get<any>('select status, flow_id from runs where id = ?', runId);
      reply.raw.write(`data: ${JSON.stringify({ runId, status: r?.status, flowId: r?.flow_id })}\n\n`);
    };
    engine.listeners.add(fn);
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 25000);
    req.raw.on('close', () => { engine.listeners.delete(fn); clearInterval(ping); });
  });

  // ---------- resources & secrets ----------
  app.get('/api/resources', async (req: any) => { const ok = seen(req); return listResources(req.query?.kind, req.query?.projectId).filter((r: any) => ok(r.project_id)); });
  /** Test connection: tries the settings as sent (saved or not) and reports the result. */
  app.post('/api/resources/test', async (req: any) => {
    if (!req.body?.kind) throw bad('kind is required');
    return testResource(req.body);
  });
  /** AI provider: the models the engine offers (Ollama, LM Studio, OpenAI-compatible, Gemini, Claude). */
  app.post('/api/resources/models', async (req: any) => {
    const { r, secret } = prepare(req.body || {});
    try { return { models: await listModels(r, secret) }; } catch (e: any) { throw bad(e.message); }
  });
  /** Ollama: pull a model (online), or import a .gguf file that is on this server (offline). Administrators only. */
  app.post('/api/resources/ollama/:action', async (req: any) => {
    const { r } = prepare(req.body || {});
    try {
      if (req.params.action === 'pull') return { message: await ollamaPull(r, String(req.body?.model || '').trim()) };
      if (req.params.action === 'import') return { message: await ollamaImport(r, String(req.body?.file || '').trim(), String(req.body?.model || '').trim(), String(req.body?.take || '').trim()) };
    } catch (e: any) { throw bad(e.message); }
    throw bad('Unknown action');
  });
  app.post('/api/resources', async (req: any) => {
    if (!req.body?.project_id) throw bad('project_id is required');
    projects.requireProject(req.body.project_id);
    return saveResource(req.body);
  });
  app.put('/api/resources/:id', async (req: any) => {
    if (!getResource(req.params.id)) throw new HttpError(404, 'Resource not found');
    return saveResource({ ...req.body, id: req.params.id });
  });
  app.delete('/api/resources/:id', async (req: any) => { deleteResource(req.params.id); return { ok: true }; });
  app.get('/api/secrets', async () => listSecrets());
  app.put('/api/secrets/:name', async (req: any) => {
    if (typeof req.body?.value !== 'string') throw bad('value is required');
    setSecret(req.params.name, req.body.value);
    return { ok: true };
  });
  app.delete('/api/secrets/:name', async (req: any) => { deleteSecret(req.params.name); return { ok: true }; });

  app.post('/api/soap/describe', async (req: any) => {
    if (!req.body?.wsdlUrl && !req.body?.wsdlRef) throw bad('wsdlUrl or wsdlRef is required');
    const url = req.body.wsdlRef ? schemas.wsdlPath(String(req.body.wsdlRef).split('::')[0]) : String(req.body.wsdlUrl);
    return describeWsdl(url, req.body.connection || undefined, req.body.auth || undefined);
  });

  // ---------- server settings ----------
  app.get('/api/server', async () => ({
    gateway: getGatewaySettings(), status: gatewayStatus, tls: getTls(), cert: certInfo(), acme: acmeStatus,
    routes: listRoutes(), schedulerErrors, listeners: [...listenerStatus.values()],
    engine: {
      workers: engine.concurrency,
      ...Object.fromEntries(q.all<any>(`select status, count(*) n from runs group by status`).map(r => [r.status, r.n])),
    },
    admin: { host: config.adminHost, port: config.adminPort },
  }));
  app.put('/api/server/gateway', async (req: any) => {
    const b = req.body || {};
    const port = (v: any, name: string) => { const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > 65535) throw bad(`${name} must be 1 to 65535`); return n; };
    setGatewaySettings({ host: String(b.host || '0.0.0.0'), httpPort: port(b.httpPort, 'HTTP port'), httpsPort: port(b.httpsPort, 'HTTPS port') });
    await startGateway();
    return { status: gatewayStatus };
  });
  app.put('/api/server/tls', async (req: any) => {
    const b = req.body || {};
    if (b.mode && !['off', 'selfSigned', 'uploaded', 'acme'].includes(b.mode)) throw bad('Unknown TLS mode');
    setTls({
      mode: b.mode, email: b.email, staging: b.staging, agreeTos: b.agreeTos, clientCaPem: b.clientCaPem,
      domains: Array.isArray(b.domains) ? b.domains.map((d: string) => d.trim()).filter(Boolean) : undefined,
    } as any);
    await startGateway();
    return { status: gatewayStatus, cert: certInfo() };
  });
  app.post('/api/server/tls/self-signed', async () => {
    await makeSelfSigned(getTls().domains);
    setTls({ mode: 'selfSigned' });
    await startGateway();
    return { cert: certInfo(), status: gatewayStatus };
  });
  app.post('/api/server/tls/upload', async (req: any) => {
    if (!req.body?.certPem || !req.body?.keyPem) throw bad('certPem and keyPem are required');
    storeCert(String(req.body.certPem), String(req.body.keyPem), 'uploaded');
    setTls({ mode: 'uploaded' });
    await startGateway();
    return { cert: certInfo(), status: gatewayStatus };
  });
  app.post('/api/server/tls/acme', async () => {
    setTls({ mode: 'acme' });
    requestAcme(reloadTls).catch(() => {});
    return { acme: acmeStatus };
  });

  // ---------- user guide (docs/sutraflow-user-guide.html, built by npm run guide) ----------
  app.get('/guide', async (_req, reply) => {
    const f = path.join(rootDir, 'docs', 'sutraflow-user-guide.html');
    if (!fs.existsSync(f)) return reply.code(404).type('text/plain').send('The user guide has not been built. Run: npm run guide');
    return reply.type('text/html; charset=utf-8').header('cache-control', 'no-cache').send(fs.createReadStream(f));
  });

  // ---------- architecture page (docs/sutraflow-architecture.html, built by npm run architecture) ----------
  app.get('/architecture', async (_req, reply) => {
    const f = path.join(rootDir, 'docs', 'sutraflow-architecture.html');
    if (!fs.existsSync(f)) return reply.code(404).type('text/plain').send('The architecture page has not been built. Run: npm run architecture');
    return reply.type('text/html; charset=utf-8').header('cache-control', 'no-cache').send(fs.createReadStream(f));
  });

  // ---------- studio (built web app) ----------
  const here = path.dirname(fileURLToPath(import.meta.url));
  const webDir = config.mode === 'engine' ? undefined : [config.webDir, path.resolve(here, '../web'), path.resolve(here, '../../dist/web')].find(d => d && fs.existsSync(path.join(d, 'index.html')));
  if (webDir) {
    await app.register(fastifyStatic, { root: webDir, prefix: '/' });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
      return reply.type('text/html').sendFile('index.html');
    });
  }
  const missing = apiRoutes.filter(r => !RULES[r] && !OPEN_ROUTES.has(r));
  if (missing.length) throw new Error(`Admin API routes without an access rule (guard.ts): ${missing.join(', ')}`);
  return app;
}
