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
import { health, readiness } from './lifecycle.js';
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
  const tasks = q.all<any>('select id, node_id, status, attempt, port, input, output, error, ms, wait, started_at, finished_at from tasks where run_id = ? order by id', id)
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
  const app = Fastify({ logger: false, bodyLimit: 20 * 1024 * 1024 });

  app.setErrorHandler((err: any, _req, reply) => {
    const status = err instanceof HttpError ? err.status : err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    reply.code(status).send({ error: err.message || String(err), ...(err.check ? { check: err.check } : {}) });
  });

  // ---------- health and readiness (no sign-in: probes) ----------
  app.get('/health', async () => health());
  app.get('/ready', async (_req, reply) => { const r = readiness(); return reply.code(r.ready ? 200 : 503).send(r); });

  // ---------- auth guard ----------
  // The OAuth callback is reached by a cross-site redirect (no SameSite=Strict cookie); its signed state protects it.
  const OPEN = new Set(['/api/auth/status', '/api/auth/setup', '/api/auth/login', '/api/oauth/callback']);
  const ENGINE_API = [/^\/api\/packages\//, /^\/api\/projects\/?$/, /^\/api\/projects\/[^/]+\/(packages|rollback)$/, /^\/api\/engine\//, /^\/api\/runs/, /^\/api\/secrets/, /^\/api\/meta$/];
  app.addHook('onRequest', async (req: FastifyRequest & { user?: any }, reply: FastifyReply) => {
    if (!req.url.startsWith('/api/')) return;
    const p = req.url.split('?')[0];
    // A headless engine has no studio: only automation with the token, for packages, runs, secrets and engine control.
    if (config.mode === 'engine') {
      const tok = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''))?.[1];
      const okTok = !!tok && !!config.adminToken && tok.length === config.adminToken.length && crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(config.adminToken));
      if (!okTok) return reply.code(401).send({ error: config.adminToken ? 'A headless engine accepts only the admin token (Authorization: Bearer ...)' : 'This headless engine has no SUTRA_ADMIN_TOKEN, so its API is closed' });
      if (!ENGINE_API.some(r => r.test(p))) return reply.code(404).send({ error: 'Not available on a headless engine' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-sutra'] !== '1' && !/^Bearer\s/i.test(String(req.headers.authorization || ''))) {
      return reply.code(403).send({ error: 'Missing X-Sutra header' });
    }
    if (OPEN.has(p)) return;
    // Automation (command-line tool, CI, headless engines): Authorization: Bearer <SUTRA_ADMIN_TOKEN>.
    const bearer = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''))?.[1];
    if (bearer && config.adminToken && bearer.length === config.adminToken.length && crypto.timingSafeEqual(Buffer.from(bearer), Buffer.from(config.adminToken))) {
      req.user = { u: 'token', r: 'admin' };
      return;
    }
    const s = auth.verifySession(cookie(req, COOKIE));
    if (!s) return reply.code(401).send({ error: 'Sign in required' });
    req.user = s;
  });
  const setCookie = (reply: FastifyReply, token: string, secure: boolean) =>
    reply.header('set-cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${12 * 3600}${secure ? '; Secure' : ''}`);

  app.get('/api/auth/status', async req => {
    const s = auth.verifySession(cookie(req, COOKIE));
    return { setup: !auth.hasUsers(), user: s ? { username: s.u, role: s.r } : null, version };
  });
  app.post('/api/auth/setup', async (req: any, reply) => {
    if (auth.hasUsers()) throw new HttpError(409, 'Already set up');
    const { username, password } = req.body || {};
    try { auth.createUser(String(username || 'admin'), String(password || ''), 'admin'); } catch (e: any) { throw bad(e.message); }
    setCookie(reply, auth.issue(String(username || 'admin'), 'admin'), req.protocol === 'https');
    return { ok: true };
  });
  app.post('/api/auth/login', async (req: any, reply) => {
    if (!auth.loginAllowed(req.ip)) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
    const t = auth.login(String(req.body?.username || ''), String(req.body?.password || ''));
    if (!t) { auth.loginFailed(req.ip); throw new HttpError(401, 'Wrong username or password'); }
    setCookie(reply, t, req.protocol === 'https');
    return { ok: true };
  });
  app.post('/api/auth/logout', async (_req, reply) => {
    reply.header('set-cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    return { ok: true };
  });

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
  app.get('/api/projects', async () => projects.listProjects());
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
  const admin = (req: any) => { if (req.user?.r !== 'admin') throw new HttpError(403, 'Only administrators can deploy packages'); };
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
    admin(req);
    try { return deployPackage(req.body?.package, { project: req.body?.project, ops: req.body?.ops, keepOthers: !!req.body?.keepOthers, by: req.user?.u }); } catch (e: any) { throw packErr(e); }
  });
  app.post('/api/packages/test', async (req: any) => {
    admin(req);
    try { return await testPackage(req.body?.package, { skip: req.body?.skip }); } catch (e: any) { throw bad(e.message); }
  });
  app.get('/api/projects/:id/packages', async (req: any) => packageHistory(req.params.id));
  app.post('/api/projects/:id/rollback', async (req: any) => {
    admin(req);
    try { return rollbackPackage(req.params.id, { to: req.body?.to, by: req.user?.u }); } catch (e: any) { throw packErr(e); }
  });

  app.get('/api/scripts/policy', async () => ({ allowed: projects.scriptsAllowed() }));
  app.put('/api/scripts/policy', async (req: any) => {
    if ((req as any).user?.r !== 'admin') throw new HttpError(403, 'Only administrators can allow scripts');
    projects.setScriptsAllowed(!!req.body?.allowed);
    return { allowed: projects.scriptsAllowed() };
  });
  app.get('/api/engine-variables/policy', async () => ({ sutrasMayChange: projects.sutrasMayChangeSengine() }));
  app.put('/api/engine-variables/policy', async (req: any) => {
    if ((req as any).user?.r !== 'admin') throw new HttpError(403, 'Only administrators can change this');
    projects.setSutrasMayChangeSengine(!!req.body?.sutrasMayChange);
    return { sutrasMayChange: projects.sutrasMayChangeSengine() };
  });
  app.put('/api/engine-variables', async (req: any) => {
    if ((req as any).user?.r !== 'admin') throw new HttpError(403, 'Only administrators can change Sengine variables');
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
  app.get('/api/flows', async (req: any) => flows.listFlows(req.query?.projectId));
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
    return q.all(`select id, flow_id flowId, flow_name flowName, version, status, source, error, steps, started_at startedAt, finished_at finishedAt
      from runs ${where.length ? 'where ' + where.join(' and ') : ''} order by started_at desc limit ?`, ...args, limit);
  });
  app.get('/api/runs/:id', async (req: any) => runDetail(req.params.id));
  app.post('/api/runs/:id/cancel', async (req: any) => ({ ok: engine.cancel(req.params.id) }));
  app.post('/api/runs/:id/debug', async (req: any) => {
    const a = String(req.body?.action || '');
    if (!['step', 'continue', 'pause', 'breakpoints'].includes(a)) throw bad('action must be step, continue, pause or breakpoints');
    return engine.debug(req.params.id, a as any, Array.isArray(req.body?.breakpoints) ? req.body.breakpoints : undefined);
  });
  app.get('/api/approvals', async () =>
    q.all<any>(`select t.id, t.run_id runId, t.node_id nodeId, t.wait, t.input, r.flow_name flowName, r.started_at startedAt, r.doc
      from tasks t join runs r on r.id = t.run_id where t.status = 'waiting' order by t.id`).map(t => {
      const doc = JSON.parse(t.doc);
      return { id: t.id, runId: t.runId, flowName: t.flowName, startedAt: t.startedAt, step: doc.nodes.find((n: any) => n.id === t.nodeId)?.name, wait: JSON.parse(t.wait || '{}'), input: t.input ? JSON.parse(t.input) : null };
    }));
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
  app.get('/api/resources', async (req: any) => listResources(req.query?.kind, req.query?.projectId));
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
    if ((req as any).user?.r !== 'admin') throw new HttpError(403, 'Only administrators can install models');
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
  return app;
}
