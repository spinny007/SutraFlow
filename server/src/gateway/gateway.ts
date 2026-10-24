/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.9.0
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { lifecycle, closeServer } from '../lifecycle.js';
import { config } from '../config.js';
import { getSetting, setSetting } from '../db.js';
import { engine } from '../engine/engine.js';
import type { FlowDoc, FlowNode } from '../engine/types.js';
import { deployedFlows } from '../flows.js';
import { effectiveResource, getResource, kvToObject } from '../resources.js';
import { authorize, corsHeaders, PolicyError, type Caller } from '../security/inbound.js';
import { xmlParser } from '../security/outbound.js';
import { checkParsed, checkRaw, limitsOf, MessageRejected } from '../security/validate.js';
import { validateStructured, validateSoapOperation } from '../schema-validation.js';
import { decryptMessage, WssError } from '../security/wssin.js';
import { applyWss } from '../security/wss.js';
import { getSecret } from '../secrets.js';
import { NS } from '../security/wss.js';
import { listOf } from '../palettes/common.js';
import { acmeChallenge, getCert, getTls } from './tls.js';
import { metrics } from '../metrics.js';
import { firewallAllows, getFirewallAsync, getGatewayOptions, logRequest, openApi } from './apps.js';
import { agentMcpEndpoints, handleAgents, listAgents, rebuildAgents } from './agents.js';
import { attachWebSockets, closeWebSockets, forgetStaleConnections, setWsRoutes, type WsRoute } from './websocket.js';
import { parseRestBody, sendRest } from './rest.js';
import { buildWsdl, renderXml, soapEnvelope, soapFault, xmlEsc } from './soap.js';
import { handleMcp, type McpTool } from './mcp-handler.js';
import { tokenEndpoint } from './oauth-handler.js';
import { effectiveVariables, engineVariableValues } from '../projects.js';
import { resolveSettings } from '../settings.js';
export { buildWsdl } from './soap.js';

/**
 * The gateway serves deployed REST and SOAP services on its own HTTP and HTTPS
 * listeners, separate from the studio/admin port. Each request is checked
 * against the service's API security policy, starts a run of the deployed flow
 * version and waits for the flow's reply step.
 */
export interface GatewaySettings { host: string; httpPort: number; httpsPort: number; }
export const getGatewaySettings = (): GatewaySettings => ({
  host: '0.0.0.0', httpPort: config.gatewayHttpPort, httpsPort: config.gatewayHttpsPort,
  ...getSetting<Partial<GatewaySettings>>('gateway', {}),
});
export const setGatewaySettings = (s: Partial<GatewaySettings>) => setSetting('gateway', { ...getGatewaySettings(), ...s });

interface Route {
  kind: 'rest' | 'soap' | 'ws';
  method: string;
  path: string;
  re: RegExp;
  keys: string[];
  flowId: string;
  projectId: string;
  version: number;
  doc: FlowDoc;
  node: FlowNode;
}

let routes: Route[] = [];
/** AI tools by MCP address: '/mcp' for tools without an MCP server, else the server's address. */
let mcpTools: McpTool[] = [];
export const mcpPath = (p: unknown) => '/' + String(p || 'mcp').trim().replace(/^\/+|\/+$/g, '').toLowerCase();

export function rebuildRoutes() {
  const out: Route[] = [];
  for (const d of deployedFlows()) {
    for (const n of d.doc.nodes) {
      if (n.type !== 'restService' && n.type !== 'soapService' && n.type !== 'wsService') continue;
      const act = engine.activity(n.type);
      const resolved = act ? { ...n, config: resolveSettings(act.fields, n.config, { gv: effectiveVariables(d.projectId).values, ev: engineVariableValues() }) } : n;
      const path = '/' + String(resolved.config.path || '').trim().replace(/^\/+|\/+$/g, '');
      const keys: string[] = [];
      const re = new RegExp('^' + path.replace(/[.+*?^${}()|[\]\\]/g, '\\$&').replace(/:([A-Za-z_]\w*)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
      out.push({ kind: n.type === 'restService' ? 'rest' : n.type === 'soapService' ? 'soap' : 'ws', method: n.type === 'wsService' ? 'GET' : String(resolved.config.method || 'ANY').toUpperCase(), path, re, keys, flowId: d.flowId, projectId: d.projectId, version: d.version, doc: d.doc, node: resolved });
    }
  }
  // Literal paths before parameterised ones.
  routes = out.sort((a, b) => a.keys.length - b.keys.length);
  setWsRoutes(path => {
    const r = routes.find(x => x.kind === 'ws' && x.re.test(path));
    if (!r) return undefined;
    const m = path.match(r.re)!;
    return { route: r as WsRoute, params: Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]])) };
  });
  mcpTools = deployedFlows().flatMap(d => d.doc.nodes.filter(n => n.type === 'mcpTool').map(node => {
    const srv = node.config.server ? effectiveResource(node.config.server) : undefined;
    return { endpoint: srv ? mcpPath(srv.config.path) : '/mcp', serverId: srv?.id || '', flowId: d.flowId, projectId: d.projectId, version: d.version, doc: d.doc, node };
  }));
  rebuildAgents(mcpPath);
}

/** Deployed REST and SOAP services, for OpenAPI and the Admin Console. */
export const apiRoutes = () => routes.filter(r => r.kind !== 'ws').map(r => ({ kind: r.kind, method: r.method, path: r.path, flowName: r.doc.name, flowId: r.flowId, projectId: r.projectId, version: r.version, node: r.node }));

export function listRoutes() {
  const s = getGatewaySettings();
  const tls = getTls();
  return routes.map(r => ({
    kind: r.kind, method: r.kind === 'soap' ? 'POST' : r.method, path: r.path, flowId: r.flowId, flow: r.doc.name, version: r.version, step: r.node.name,
    policy: r.node.config.policy ? getResource(r.node.config.policy)?.name ?? '(missing)' : null,
    urls: [
      `${r.kind === 'ws' ? 'ws' : 'http'}://${tls.domains[0] || 'localhost'}:${s.httpPort}${r.path}`,
      ...(tls.mode !== 'off' && getCert() ? [`${r.kind === 'ws' ? 'wss' : 'https'}://${tls.domains[0] || 'localhost'}:${s.httpsPort}${r.path}`] : []),
    ],
    wsdl: r.kind === 'soap' ? `${r.path}?wsdl` : undefined,
  })).concat(mcpTools.map(t => {
    const pol = t.node.config.policy || (t.serverId ? effectiveResource(t.serverId)?.config.policy : '');
    return {
      kind: 'mcp' as any, method: 'MCP', path: t.endpoint, flowId: t.flowId, flow: t.doc.name, version: t.version, step: t.node.name,
      policy: pol ? getResource(pol)?.name ?? '(missing)' : null,
      urls: [`http://${tls.domains[0] || 'localhost'}:${s.httpPort}${t.endpoint}`, ...(tls.mode !== 'off' && getCert() ? [`https://${tls.domains[0] || 'localhost'}:${s.httpsPort}${t.endpoint}`] : [])],
      wsdl: undefined, tool: String(t.node.config.toolName || ''),
    };
  })).concat(listAgents().map(a => {
    const base = (https: boolean) => `${https ? 'https' : 'http'}://${tls.domains[0] || 'localhost'}:${https ? s.httpsPort : s.httpPort}`;
    const bases = [base(false), ...(tls.mode !== 'off' && getCert() ? [base(true)] : [])];
    return {
      kind: 'agent' as any, method: 'AGENT', path: `/chat/${a.name}`, flowId: a.flowId, flow: a.flow, version: a.version, step: a.title,
      policy: null, wsdl: undefined, tool: a.tool || undefined,
      urls: bases.flatMap(b => [...(a.chat ? [`${b}/chat/${a.name}`] : []), ...(a.openai ? [`${b}/v1/chat/completions (model ${a.name})`] : []), ...(a.mcp ? [`${b}${a.mcp} (tool ${a.tool})`] : []), ...(a.a2a ? [`${b}/a2a/${a.name}`] : [])]),
    };
  }));
}

// ---------- request handling ----------

const HIDDEN = new Set(['authorization', 'cookie', 'proxy-authorization', 'x-api-key']);

/** Starts a run and waits for its reply; the reply may come before the start has returned the run id. */
function waitReply(start: (onReply: (r: any) => void) => Promise<string>, timeoutMs: number) {
  return new Promise<{ runId: string; reply: any }>((res, rej) => {
    let runId = '', reply: any, replied = false;
    const to = setTimeout(() => rej(Object.assign(new Error('The Sutra did not reply in time'), { runId })), timeoutMs);
    const done = () => { if (replied && runId) { clearTimeout(to); res({ runId, reply }); } };
    start(r => { reply = r; replied = true; done(); }).then(id => { runId = id; done(); }, e => { clearTimeout(to); rej(e); });
  });
}

async function handle(req: FastifyRequest, reply: FastifyReply, secure: boolean) {
  const url = new URL(req.url, 'http://x');
  const path = decodeURIComponent(url.pathname);

  if (path.startsWith('/.well-known/acme-challenge/')) {
    const ka = await acmeChallenge(path.split('/').pop() || '');
    return ka ? reply.type('text/plain').send(ka) : reply.code(404).send('Not found');
  }
  if (path === '/health') return reply.send({ ok: true });
  const gw: GwInfo = ((req as any).gw = { kind: 'rest' });
  if (!firewallAllows(req.ip, await getFirewallAsync())) { gw.error = 'Firewall'; return reply.code(403).send({ error: 'Your address is not allowed' }); }
  if (path === '/oauth/token') { gw.route = 'Access tokens'; return tokenEndpoint(req, reply); }
  if (path === '/openapi.json' && req.method === 'GET') {
    gw.route = 'OpenAPI';
    if (!getGatewayOptions().publishOpenApi) return reply.code(404).send({ error: 'OpenAPI is not published on this gateway' });
    return reply.send(openApi(routes.filter(r => r.kind !== 'ws').map(r => ({ kind: r.kind, method: r.method, path: r.path, flowName: r.doc.name, projectId: r.projectId, version: r.version, node: r.node })), `${secure ? 'https' : 'http'}://${req.headers.host || 'localhost'}`));
  }
  if (/^\/(chat|a2a)\/|^\/v1\/(models|chat\/completions)$/.test(path)) {
    const done = await handleAgents(req, reply, secure, path);
    if (done) return done;
  }
  const mcpAt = mcpPath(path);
  if (mcpAt === '/mcp' || mcpTools.some(t => t.endpoint === mcpAt) || agentMcpEndpoints().includes(mcpAt)) { gw.kind = 'mcp'; gw.route = `MCP ${mcpAt}`; return handleMcp(req, reply, secure, mcpAt, mcpTools, waitReply); }

  const method = req.method.toUpperCase();
  const candidates = routes.filter(r => r.re.test(path));
  const route = candidates.find(r => r.kind === 'soap' || r.method === 'ANY' || r.method === method || method === 'OPTIONS')
    || (candidates.length ? null : undefined);
  if (!route) gw.route = 'No service at this path';
  if (route === undefined) return reply.code(404).send({ error: 'No deployed service at this path' });
  if (route === null) return reply.code(405).header('allow', candidates.map(c => c.method).join(', ')).send({ error: 'Method not allowed' });
  Object.assign(gw, { kind: route.kind, route: route.doc.name, flowId: route.flowId, projectId: route.projectId });
  if (route.kind === 'ws') return reply.code(426).header('upgrade', 'websocket').send({ error: 'This is a WebSocket service: connect with ws:// or wss://' });

  const policy = route.node.config.policy ? effectiveResource(route.node.config.policy) : undefined;
  if (route.node.config.policy && !policy) return reply.code(503).send({ error: 'The service\'s security policy is missing; refusing to serve it unprotected' });
  const cors = corsHeaders(policy, req.headers.origin);
  if (cors) reply.headers(cors);
  if (method === 'OPTIONS') return reply.code(cors ? 204 : 403).send();

  const raw = typeof req.body === 'string' ? req.body : req.body == null ? '' : String(req.body);
  const ct = String(req.headers['content-type'] || '').toLowerCase();
  const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !HIDDEN.has(k) && k !== String(policy?.config.apiKeyHeader || '').toLowerCase()));
  const client = { ip: req.ip, secure };

  if (route.kind === 'soap') {
    const n = route.node;
    const v12cfg = n.config.soapVersion === '1.2';
    if (method === 'GET' && url.searchParams.has('wsdl')) {
      const host = req.headers.host || 'localhost';
      return reply.type('text/xml; charset=utf-8').send(buildWsdl(n, `${secure ? 'https' : 'http'}://${host}${route.path}`));
    }
    let responseCaller: Caller | undefined;
    const responseCert = () => {
      const c = policy?.config || {};
      if (c.responseEncryption === 'caller certificate') return String(responseCaller?.claims?.certificatePem || '');
      if (c.responseEncryption === 'configured certificate') return String(c.responseEncryptCertPem || '');
      return '';
    };
    const secureResponse = (xml: string) => {
      const mode = policy?.config.responseEncryption || 'off';
      if (mode === 'off') return xml;
      const certPem = responseCert();
      // Before authentication, a caller-certificate policy has no trusted recipient yet. Such faults
      // stay plain; after authentication every normal response and fault is encrypted.
      if (!certPem && mode === 'caller certificate' && !responseCaller) return xml;
      if (!certPem) throw new WssError(mode === 'caller certificate'
        ? 'SOAP response encryption needs a verified WS-Security X.509 caller certificate'
        : 'SOAP response encryption has no configured recipient certificate');
      return applyWss(xml, { timestampTtlSec: 300, encrypt: { certPem, algorithm: policy?.config.responseEncryptAlgorithm || 'aes256-gcm' } });
    };
    const sendSoap = (status: number, xml: string, v12 = v12cfg) => {
      let body = xml;
      try { body = secureResponse(xml); }
      catch (e: any) {
        gw.error = e.message;
        body = soapFault(v12, 'soap:Server', `SOAP response security failed: ${e.message}`);
        status = 500;
      }
      return reply.code(status).type(v12 ? 'application/soap+xml; charset=utf-8' : 'text/xml; charset=utf-8').send(body);
    };
    const fault = (status: number, code: string, msg: string, v12 = v12cfg) => sendSoap(status, soapFault(v12, code, msg), v12);
    if (method !== 'POST') return fault(405, 'soap:Client', 'SOAP requests must use POST');
    const limits = limitsOf(policy?.config);
    const soapMaxKb = Number(policy?.config.maxBodyKb) || 0;
    if (soapMaxKb && Buffer.byteLength(raw) > soapMaxKb * 1024) { gw.error = 'Body too large'; return fault(413, 'soap:Client', `Body is larger than ${soapMaxKb} KB`); }
    try { checkRaw(raw, 'xml', limits); } catch (e: any) { gw.error = e.message; return fault(e.status || 400, 'soap:Client', e.message); }
    // XML encryption: decrypted with the policy's key before anything reads the message.
    let xml = raw;
    if (policy?.config.decryptKeySecret || policy?.config.requireEncryption || /EncryptedData/.test(raw)) {
      try {
        const c = policy?.config || {};
        const d = decryptMessage(raw, c.decryptKeySecret ? getSecret(c.decryptKeySecret) || '' : '', c.decryptKeyPassSecret ? getSecret(c.decryptKeyPassSecret) : undefined);
        if (c.requireEncryption && !d.bodyEncrypted) throw new WssError('The SOAP Body must be encrypted');
        xml = d.xml;
      } catch (e: any) { gw.error = e.message; return fault(e instanceof WssError ? 400 : 500, 'soap:Client', e.message); }
    }
    let env: any;
    try { env = xmlParser.parse(xml)?.Envelope; } catch { /* handled below */ }
    if (!env?.Body) return fault(400, 'soap:Client', 'Request is not a SOAP envelope');
    const v12 = ct.includes('application/soap+xml') || raw.includes(NS.soap12);
    const opName = Object.keys(env.Body).find(k => !k.startsWith('@_'));
    if (!opName) return fault(400, 'soap:Client', 'SOAP Body is empty', v12);
    let caller;
    try {
      caller = await authorize(policy, { headers: req.headers, ip: req.ip, secure, socket: req.raw.socket, wsSecurity: env.Header?.Security, soapXml: xml, method, path: url.pathname + url.search, rawBody: raw });
      responseCaller = caller;
      noteCaller(gw, reply, caller);
    } catch (e: any) {
      const pe = e as PolicyError;
      gw.error = pe.message;
      if (pe.headers) reply.headers(pe.headers);
      return fault(pe.status || 500, 'soap:Client', pe.message, v12);
    }
    const ops = listOf(n.config.operations);
    if (ops.length && !ops.some(o => o.toLowerCase() === opName.toLowerCase())) return fault(400, 'soap:Client', `Unknown operation ${opName}`, v12);
    const opScopes = Object.entries(kvToObject(n.config.operationScopes)).find(([k]) => k.trim().toLowerCase() === opName.toLowerCase())?.[1];
    const missingOp = missingScopes(caller, opScopes);
    if (missingOp) { gw.error = missingOp; return fault(403, 'soap:Client', missingOp, v12); }
    try {
      checkParsed(env.Body, limits);
      if (n.config.validateBody === 'reject invalid' && n.config.bodySchema) {
        const errs = await validateSoapOperation(String(n.config.bodySchema), env.Body[opName], xml);
        if (errs.length) throw new MessageRejected(`The request does not match the schema: ${errs.join('; ')}`, 400, errs);
      }
    } catch (e: any) {
      if (!(e instanceof MessageRejected)) throw e;
      gw.error = e.message;
      return fault(e.status, 'soap:Client', e.message, v12);
    }
    const header = { ...(env.Header || {}) };
    delete header.Security;
    const input = { operation: ops.find(o => o.toLowerCase() === opName.toLowerCase()) || opName, body: env.Body[opName], header, headers, soapAction: req.headers.soapaction, auth: caller, client };
    try {
      const { runId, reply: r } = await waitReply(onReply => engine.startRun({ doc: route.doc, flowId: route.flowId, projectId: route.projectId, version: route.version, triggerNodeId: n.id, input, source: 'soap', onReply, traceparent: String(req.headers.traceparent || '') }), config.replyTimeoutMs);
      reply.header('x-sutra-run', runId);
      const ns = String(n.config.namespace || 'urn:sutra');
      if (r.failed || r.soap?.fault) {
        const f = r.soap?.fault || { code: 'soap:Server', message: r.error || 'Sutra failed' };
        return fault(500, f.code, f.message, v12);
      }
      const opResp = `${r.soap?.operation || input.operation}Response`;
      const bodyXml = r.body == null ? '' : typeof r.body === 'object' ? renderXml(r.body) : xmlEsc(String(r.body));
      return sendSoap(200, soapEnvelope(v12, `<${opResp} xmlns="${xmlEsc(ns)}">${bodyXml}</${opResp}>`), v12);
    } catch (e: any) {
      if (e.runId) reply.header('x-sutra-run', e.runId);
      return fault(e.runId !== undefined ? 504 : 500, 'soap:Server', e.message, v12);
    }
  }

  // REST
  let caller;
  try {
    caller = await authorize(policy, { headers: req.headers, ip: req.ip, secure, socket: req.raw.socket, method, path: url.pathname + url.search, rawBody: raw });
    noteCaller(gw, reply, caller);
    const missing = missingScopes(caller, route.node.config.requiredScopes);
    if (missing) throw new PolicyError(403, missing, { 'www-authenticate': 'Bearer error="insufficient_scope"' });
  } catch (e: any) {
    const pe = e as PolicyError;
    gw.error = pe.message;
    if (pe.headers) reply.headers(pe.headers);
    return reply.code(pe.status || 500).send({ error: pe.message });
  }
  const policyKb = Number(policy?.config.maxBodyKb) || 0;
  const maxKb = Math.min(Number(route.node.config.maxBodyKb) || 1024, policyKb || Infinity);
  if (Buffer.byteLength(raw) > maxKb * 1024) { gw.error = 'Body too large'; return reply.code(413).send({ error: `Body is larger than ${maxKb} KB` }); }
  const limits = limitsOf(policy?.config);
  let body;
  try {
    checkRaw(raw, ct.includes('json') ? 'json' : ct.includes('xml') ? 'xml' : 'other', limits);
    body = parseRestBody(raw, ct);
    checkParsed(body, limits);
    if (route.node.config.validateBody === 'reject invalid' && route.node.config.bodySchema) {
      const errs = await validateStructured(String(route.node.config.bodySchema), body, ct.includes('xml') ? raw : undefined);
      if (errs.length) throw new MessageRejected('The request does not match the schema', 400, errs);
    }
  } catch (e: any) {
    gw.error = e.message;
    return reply.code(e.status || 400).send({ error: e.message, ...(e.errors?.length ? { errors: e.errors } : {}) });
  }
  const m = path.match(route.re)!;
  const params = Object.fromEntries(route.keys.map((k, i) => [k, m[i + 1]]));
  const input = { method, path, params, query: Object.fromEntries(url.searchParams), headers, body, auth: caller, client };
  try {
    const { reply: r } = await waitReply(onReply => engine.startRun({ doc: route.doc, flowId: route.flowId, projectId: route.projectId, version: route.version, triggerNodeId: route.node.id, input, source: 'rest', onReply, traceparent: String(req.headers.traceparent || '') }), config.replyTimeoutMs);
    if (r.failed) return sendRest(reply, { status: r.status || 500, body: { error: r.error || 'Sutra failed', run: r.runId }, runId: r.runId });
    return sendRest(reply, r);
  } catch (e: any) {
    if (e.runId) reply.header('x-sutra-run', e.runId);
    return reply.code(e.runId !== undefined ? 504 : 500).send({ error: e.message });
  }
}

/** What the request log records about a gateway request, filled in while it is handled. */
interface GwInfo { kind: string; route?: string; flowId?: string; projectId?: string; appId?: string; caller?: string; error?: string }

/** Scopes a service or operation needs that the caller does not hold, as a message; '' when it holds them all. */
function missingScopes(caller: Caller, needed: unknown) {
  const need = String(needed || '').split(/\s+/).filter(Boolean);
  if (!need.length) return '';
  const have = new Set(caller.scopes || []);
  const missing = need.filter(s => !have.has(s));
  return missing.length ? `The caller is missing scope: ${missing.join(' ')}` : '';
}

function noteCaller(gw: GwInfo, reply: FastifyReply, caller: Caller) {
  gw.caller = caller.subject;
  gw.appId = caller.appId;
  if (caller.responseHeaders) reply.headers(caller.responseHeaders);
}

// apps.ts caches the firewall for two seconds; a settings change invalidates its local cache.
export const refreshFirewall = () => { /* retained for the stable gateway API */ };

// ---------- listeners ----------

function build(https?: any): FastifyInstance {
  // Idle keep-alive connections are closed on shutdown (not waited for), so a draining engine stops promptly.
  const app = Fastify({ https, trustProxy: false, bodyLimit: 50 * 1024 * 1024, logger: false, forceCloseConnections: 'idle', keepAliveTimeout: config.keepAliveMs });
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'string' }, (_req, body, done) => done(null, body));
  const secure = !!https;
  // Every answer carries the run's trace context, and is counted by kind and status.
  app.addHook('onSend', async (_req, reply, payload) => {
    // Stopping: the client closes this connection after the answer, so the server is not held open
    // until the keep-alive time runs out.
    if (lifecycle.draining) reply.header('connection', 'close');
    const run = reply.getHeader('x-sutra-run');
    if (run && !reply.getHeader('traceparent')) reply.header('traceparent', await engine.traceparentOf(String(run)));
    return payload;
  });
  app.addHook('onResponse', async (req, reply) => {
    const p = req.url.split('?')[0];
    if (p === '/health' || p.startsWith('/.well-known/')) return;
    const gw: GwInfo = (req as any).gw || { kind: 'rest' };
    const kind = gw.kind || 'rest';
    metrics.gatewayRequests.inc({ kind, status: String(reply.statusCode) });
    metrics.gatewaySeconds.observe({ kind }, reply.elapsedTime / 1000);
    // Request log for the Admin Console (Gateway > Traffic).
    const raw = req.body;
    logRequest({
      kind, method: req.method, path: p, route: gw.route, flowId: gw.flowId, projectId: gw.projectId, appId: gw.appId, caller: gw.caller,
      status: reply.statusCode, ms: reply.elapsedTime, ip: req.ip, runId: String(reply.getHeader('x-sutra-run') || ''), error: reply.statusCode >= 400 ? gw.error : '',
      bytesIn: Number(req.headers['content-length']) || (typeof raw === 'string' ? Buffer.byteLength(raw) : 0), bytesOut: Number(reply.getHeader('content-length')) || 0,
    });
  });
  app.all('/', (req, reply) => handle(req, reply, secure));
  app.all('/*', (req, reply) => handle(req, reply, secure));
  attachWebSockets(app.server, secure);
  return app;
}

let httpApp: FastifyInstance | null = null;
let httpsApp: FastifyInstance | null = null;
export const gatewayStatus = { http: '', https: '', error: '' };

function tlsOptions() {
  const t = getTls();
  const c = getCert();
  if (t.mode === 'off' || !c) return null;
  return {
    cert: c.certPem,
    key: c.keyPem,
    ca: t.clientCaPem?.trim() || undefined,
    requestCert: !!t.clientCaPem?.trim(),
    rejectUnauthorized: false, // policies decide; non-mTLS services stay reachable
    minVersion: 'TLSv1.2' as const,
  };
}

export async function startGateway() {
  await stopGateway();
  await forgetStaleConnections();
  rebuildRoutes();
  const s = getGatewaySettings();
  gatewayStatus.error = '';
  httpApp = build();
  try {
    await httpApp.listen({ host: s.host, port: s.httpPort });
    gatewayStatus.http = `http://${s.host}:${s.httpPort}`;
  } catch (e: any) {
    gatewayStatus.http = '';
    gatewayStatus.error = `HTTP port ${s.httpPort}: ${e.message}`;
  }
  const tls = tlsOptions();
  if (tls) {
    httpsApp = build(tls);
    try {
      await httpsApp.listen({ host: s.host, port: s.httpsPort });
      gatewayStatus.https = `https://${s.host}:${s.httpsPort}`;
    } catch (e: any) {
      gatewayStatus.https = '';
      gatewayStatus.error += `${gatewayStatus.error ? '; ' : ''}HTTPS port ${s.httpsPort}: ${e.message}`;
    }
  } else gatewayStatus.https = '';
}

/** Applies a renewed certificate without dropping connections. */
export function reloadTls() {
  const tls = tlsOptions();
  if (httpsApp && tls) (httpsApp.server as any).setSecureContext(tls);
  else startGateway().catch(() => {});
}

export async function stopGateway() {
  closeWebSockets();
  await Promise.all([closeServer(httpApp), closeServer(httpsApp)]);
  httpApp = httpsApp = null;
}
