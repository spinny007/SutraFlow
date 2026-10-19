/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { lifecycle, closeServer } from '../lifecycle.js';
import { XMLBuilder } from 'fast-xml-parser';
import { config } from '../config.js';
import { getSetting, setSetting } from '../db.js';
import { engine } from '../engine/engine.js';
import type { FlowDoc, FlowNode, ReplyPayload } from '../engine/types.js';
import { deployedFlows } from '../flows.js';
import { effectiveResource, getResource } from '../resources.js';
import { authorize, corsHeaders, PolicyError, type Caller } from '../security/inbound.js';
import { xmlParser } from '../security/outbound.js';
import { NS } from '../security/wss.js';
import { listOf } from '../palettes/common.js';
import { acmeChallenge, getCert, getTls } from './tls.js';
import crypto from 'node:crypto';
import { MCP_PROTOCOLS, toolDefinition, toolResult } from '../mcp.js';
import { metrics } from '../metrics.js';
import { version as sutraVersion } from '../config.js';
import { firewallAllows, getFirewall, getGatewayOptions, issueToken, logRequest, openApi } from './apps.js';
import { agentMcpEndpoints, agentMcpTools, callAgentTool, handleAgents, listAgents, rebuildAgents } from './agents.js';

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
  kind: 'rest' | 'soap';
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
interface McpTool { endpoint: string; serverId: string; flowId: string; projectId: string; version: number; doc: FlowDoc; node: FlowNode }
let mcpTools: McpTool[] = [];
export const mcpPath = (p: unknown) => '/' + String(p || 'mcp').trim().replace(/^\/+|\/+$/g, '').toLowerCase();

export function rebuildRoutes() {
  const out: Route[] = [];
  for (const d of deployedFlows()) {
    for (const n of d.doc.nodes) {
      if (n.type !== 'restService' && n.type !== 'soapService') continue;
      const path = '/' + String(n.config.path || '').trim().replace(/^\/+|\/+$/g, '');
      const keys: string[] = [];
      const re = new RegExp('^' + path.replace(/[.+*?^${}()|[\]\\]/g, '\\$&').replace(/:([A-Za-z_]\w*)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
      out.push({ kind: n.type === 'restService' ? 'rest' : 'soap', method: String(n.config.method || 'ANY').toUpperCase(), path, re, keys, flowId: d.flowId, projectId: d.projectId, version: d.version, doc: d.doc, node: n });
    }
  }
  // Literal paths before parameterised ones.
  routes = out.sort((a, b) => a.keys.length - b.keys.length);
  mcpTools = deployedFlows().flatMap(d => d.doc.nodes.filter(n => n.type === 'mcpTool').map(node => {
    const srv = node.config.server ? effectiveResource(node.config.server) : undefined;
    return { endpoint: srv ? mcpPath(srv.config.path) : '/mcp', serverId: srv?.id || '', flowId: d.flowId, projectId: d.projectId, version: d.version, doc: d.doc, node };
  }));
  rebuildAgents(mcpPath);
}

/** Deployed REST and SOAP services, for OpenAPI and the Admin Console. */
export const apiRoutes = () => routes.map(r => ({ kind: r.kind, method: r.method, path: r.path, flowName: r.doc.name, flowId: r.flowId, projectId: r.projectId, version: r.version, node: r.node }));

export function listRoutes() {
  const s = getGatewaySettings();
  const tls = getTls();
  return routes.map(r => ({
    kind: r.kind, method: r.kind === 'soap' ? 'POST' : r.method, path: r.path, flowId: r.flowId, flow: r.doc.name, version: r.version, step: r.node.name,
    policy: r.node.config.policy ? getResource(r.node.config.policy)?.name ?? '(missing)' : null,
    urls: [
      `http://${tls.domains[0] || 'localhost'}:${s.httpPort}${r.path}`,
      ...(tls.mode !== 'off' && getCert() ? [`https://${tls.domains[0] || 'localhost'}:${s.httpsPort}${r.path}`] : []),
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

const xmlBuilder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '@_', suppressEmptyNode: true });
const xmlEsc = (s: string) => s.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);

// ---------- WSDL ----------

export function buildWsdl(n: FlowNode, baseUrl: string) {
  const name = String(n.config.serviceName || 'Service').replace(/[^\w]/g, '') || 'Service';
  const tns = String(n.config.namespace || 'urn:sutra');
  const ops = listOf(n.config.operations).map(o => o.replace(/[^\w]/g, '')).filter(Boolean);
  const v12 = n.config.soapVersion === '1.2';
  const sp = v12 ? 'soap12' : 'soap';
  const anyType = (el: string) => `<xsd:element name="${el}"><xsd:complexType><xsd:sequence><xsd:any minOccurs="0" maxOccurs="unbounded" processContents="lax"/></xsd:sequence></xsd:complexType></xsd:element>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<definitions name="${name}" targetNamespace="${xmlEsc(tns)}" xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:tns="${xmlEsc(tns)}"
  xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/" xmlns:soap12="http://schemas.xmlsoap.org/wsdl/soap12/" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <types>
    <xsd:schema targetNamespace="${xmlEsc(tns)}" elementFormDefault="qualified">
      ${ops.map(o => anyType(o) + anyType(o + 'Response')).join('\n      ')}
    </xsd:schema>
  </types>
  ${ops.map(o => `<message name="${o}Request"><part name="parameters" element="tns:${o}"/></message>
  <message name="${o}Response"><part name="parameters" element="tns:${o}Response"/></message>`).join('\n  ')}
  <portType name="${name}PortType">
    ${ops.map(o => `<operation name="${o}"><input message="tns:${o}Request"/><output message="tns:${o}Response"/></operation>`).join('\n    ')}
  </portType>
  <binding name="${name}Binding" type="tns:${name}PortType">
    <${sp}:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>
    ${ops.map(o => `<operation name="${o}"><${sp}:operation soapAction="${xmlEsc(tns)}/${o}"/><input><${sp}:body use="literal"/></input><output><${sp}:body use="literal"/></output></operation>`).join('\n    ')}
  </binding>
  <service name="${name}">
    <port name="${name}Port" binding="tns:${name}Binding"><${sp}:address location="${xmlEsc(baseUrl)}"/></port>
  </service>
</definitions>`;
}

function soapEnvelope(v12: boolean, body: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="${v12 ? NS.soap12 : NS.soap11}"><soap:Body>${body}</soap:Body></soap:Envelope>`;
}

function soapFault(v12: boolean, code: string, message: string) {
  const local = code.replace(/^\w+:/, '');
  if (v12) {
    const v = /client|sender/i.test(local) ? 'soap:Sender' : 'soap:Receiver';
    return soapEnvelope(true, `<soap:Fault><soap:Code><soap:Value>${v}</soap:Value></soap:Code><soap:Reason><soap:Text xml:lang="en">${xmlEsc(message)}</soap:Text></soap:Reason></soap:Fault>`);
  }
  const c = /client|sender/i.test(local) ? 'soap:Client' : /server|receiver/i.test(local) ? 'soap:Server' : code.includes(':') ? code : `soap:${code}`;
  return soapEnvelope(false, `<soap:Fault><faultcode>${xmlEsc(c)}</faultcode><faultstring>${xmlEsc(message)}</faultstring></soap:Fault>`);
}

// ---------- request handling ----------

const HIDDEN = new Set(['authorization', 'cookie', 'proxy-authorization', 'x-api-key']);

function waitReply(start: (onReply: (r: any) => void) => string, timeoutMs: number) {
  return new Promise<{ runId: string; reply: any }>((res, rej) => {
    let runId = '';
    const to = setTimeout(() => rej(Object.assign(new Error('The Sutra did not reply in time'), { runId })), timeoutMs);
    try {
      runId = start(r => { clearTimeout(to); res({ runId, reply: r }); });
    } catch (e) {
      clearTimeout(to);
      rej(e);
    }
  });
}

function parseRestBody(raw: string, ct: string) {
  if (!raw) return null;
  if (ct.includes('json')) {
    try { return JSON.parse(raw); } catch { throw new PolicyError(400, 'Request body is not valid JSON'); }
  }
  if (ct.includes('xml')) {
    try { return xmlParser.parse(raw); } catch { throw new PolicyError(400, 'Request body is not valid XML'); }
  }
  if (ct.includes('x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw));
  return raw;
}

function sendRest(reply: FastifyReply, r: ReplyPayload & { failed?: boolean; error?: string; runId?: string }) {
  if (r.runId) reply.header('x-sutra-run', r.runId);
  for (const [k, v] of Object.entries(r.headers || {})) reply.header(k, v);
  const ct = r.contentType || (typeof r.body === 'string' ? 'text/plain; charset=utf-8' : 'application/json');
  reply.code(r.status || 200).type(ct);
  if (r.body == null) return reply.send(r.status === 204 ? undefined : '');
  if (typeof r.body === 'string') return reply.send(r.body);
  if (ct.includes('xml')) return reply.send(xmlBuilder.build(r.body));
  return reply.send(JSON.stringify(r.body));
}

async function handle(req: FastifyRequest, reply: FastifyReply, secure: boolean) {
  const url = new URL(req.url, 'http://x');
  const path = decodeURIComponent(url.pathname);

  if (path.startsWith('/.well-known/acme-challenge/')) {
    const ka = acmeChallenge(path.split('/').pop() || '');
    return ka ? reply.type('text/plain').send(ka) : reply.code(404).send('Not found');
  }
  if (path === '/health') return reply.send({ ok: true });
  const gw: GwInfo = ((req as any).gw = { kind: 'rest' });
  if (!firewallAllows(req.ip, firewall())) { gw.error = 'Firewall'; return reply.code(403).send({ error: 'Your address is not allowed' }); }
  if (path === '/oauth/token') { gw.route = 'Access tokens'; return tokenEndpoint(req, reply); }
  if (path === '/openapi.json' && req.method === 'GET') {
    gw.route = 'OpenAPI';
    if (!getGatewayOptions().publishOpenApi) return reply.code(404).send({ error: 'OpenAPI is not published on this gateway' });
    return reply.send(openApi(routes.map(r => ({ kind: r.kind, method: r.method, path: r.path, flowName: r.doc.name, projectId: r.projectId, version: r.version, node: r.node })), `${secure ? 'https' : 'http'}://${req.headers.host || 'localhost'}`));
  }
  if (/^\/(chat|a2a)\/|^\/v1\/(models|chat\/completions)$/.test(path)) {
    const done = await handleAgents(req, reply, secure, path);
    if (done) return done;
  }
  const mcpAt = mcpPath(path);
  if (mcpAt === '/mcp' || mcpTools.some(t => t.endpoint === mcpAt) || agentMcpEndpoints().includes(mcpAt)) { gw.kind = 'mcp'; gw.route = `MCP ${mcpAt}`; return handleMcp(req, reply, secure, mcpAt); }

  const method = req.method.toUpperCase();
  const candidates = routes.filter(r => r.re.test(path));
  const route = candidates.find(r => r.kind === 'soap' || r.method === 'ANY' || r.method === method || method === 'OPTIONS')
    || (candidates.length ? null : undefined);
  if (!route) gw.route = 'No service at this path';
  if (route === undefined) return reply.code(404).send({ error: 'No deployed service at this path' });
  if (route === null) return reply.code(405).header('allow', candidates.map(c => c.method).join(', ')).send({ error: 'Method not allowed' });
  Object.assign(gw, { kind: route.kind, route: route.doc.name, flowId: route.flowId, projectId: route.projectId });

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
    const fault = (status: number, code: string, msg: string, v12 = v12cfg) =>
      reply.code(status).type(v12 ? 'application/soap+xml; charset=utf-8' : 'text/xml; charset=utf-8').send(soapFault(v12, code, msg));
    if (method !== 'POST') return fault(405, 'soap:Client', 'SOAP requests must use POST');
    let env: any;
    try { env = xmlParser.parse(raw)?.Envelope; } catch { /* handled below */ }
    if (!env?.Body) return fault(400, 'soap:Client', 'Request is not a SOAP envelope');
    const v12 = ct.includes('application/soap+xml') || raw.includes(NS.soap12);
    const opName = Object.keys(env.Body).find(k => !k.startsWith('@_'));
    if (!opName) return fault(400, 'soap:Client', 'SOAP Body is empty', v12);
    let caller;
    try {
      caller = await authorize(policy, { headers: req.headers, ip: req.ip, secure, socket: req.raw.socket, wsSecurity: env.Header?.Security });
      noteCaller(gw, reply, caller);
    } catch (e: any) {
      const pe = e as PolicyError;
      gw.error = pe.message;
      if (pe.headers) reply.headers(pe.headers);
      return fault(pe.status || 500, 'soap:Client', pe.message, v12);
    }
    const ops = listOf(n.config.operations);
    if (ops.length && !ops.some(o => o.toLowerCase() === opName.toLowerCase())) return fault(400, 'soap:Client', `Unknown operation ${opName}`, v12);
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
      const bodyXml = r.body == null ? '' : typeof r.body === 'object' ? xmlBuilder.build(r.body) : xmlEsc(String(r.body));
      return reply.code(200).type(v12 ? 'application/soap+xml; charset=utf-8' : 'text/xml; charset=utf-8')
        .send(soapEnvelope(v12, `<${opResp} xmlns="${xmlEsc(ns)}">${bodyXml}</${opResp}>`));
    } catch (e: any) {
      if (e.runId) reply.header('x-sutra-run', e.runId);
      return fault(e.runId !== undefined ? 504 : 500, 'soap:Server', e.message, v12);
    }
  }

  // REST
  let caller;
  try {
    caller = await authorize(policy, { headers: req.headers, ip: req.ip, secure, socket: req.raw.socket });
    noteCaller(gw, reply, caller);
  } catch (e: any) {
    const pe = e as PolicyError;
    gw.error = pe.message;
    if (pe.headers) reply.headers(pe.headers);
    return reply.code(pe.status || 500).send({ error: pe.message });
  }
  const maxKb = Number(route.node.config.maxBodyKb) || 1024;
  if (Buffer.byteLength(raw) > maxKb * 1024) return reply.code(413).send({ error: `Body is larger than ${maxKb} KB` });
  let body;
  try { body = parseRestBody(raw, ct); } catch (e: any) { return reply.code(400).send({ error: e.message }); }
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

function noteCaller(gw: GwInfo, reply: FastifyReply, caller: Caller) {
  gw.caller = caller.subject;
  gw.appId = caller.appId;
  if (caller.responseHeaders) reply.headers(caller.responseHeaders);
}

// The firewall is read at most every two seconds; a change applies on every engine within that time.
let fwCache = { at: 0, f: { allow: [] as string[], deny: [] as string[] } };
const firewall = () => { if (Date.now() - fwCache.at > 2000) fwCache = { at: Date.now(), f: getFirewall() }; return fwCache.f; };
export const refreshFirewall = () => { fwCache.at = 0; };

/** OAuth2 client credentials for gateway apps (RFC 6749 section 4.4). */
async function tokenEndpoint(req: FastifyRequest, reply: FastifyReply) {
  reply.header('cache-control', 'no-store');
  if (req.method !== 'POST') return reply.code(405).header('allow', 'POST').send({ error: 'invalid_request', error_description: 'Use POST' });
  const raw = typeof req.body === 'string' ? req.body : '';
  const ct = String(req.headers['content-type'] || '');
  let f: Record<string, string> = {};
  try { f = ct.includes('json') ? JSON.parse(raw || '{}') : Object.fromEntries(new URLSearchParams(raw)); } catch { return reply.code(400).send({ error: 'invalid_request', error_description: 'The body is not form data or JSON' }); }
  let id = f.client_id || '', secret = f.client_secret || '';
  const basic = /^Basic\s+(.+)$/i.exec(String(req.headers.authorization || ''))?.[1];
  if (basic) { const d = Buffer.from(basic, 'base64').toString('utf8'); const i = d.indexOf(':'); id = decodeURIComponent(d.slice(0, i)); secret = decodeURIComponent(d.slice(i + 1)); }
  if (f.grant_type !== 'client_credentials') return reply.code(400).send({ error: 'unsupported_grant_type', error_description: 'Only client_credentials is supported' });
  if (!id || !secret) return reply.code(401).send({ error: 'invalid_client', error_description: 'Send client_id and client_secret (the app id and one of its keys)' });
  try {
    const t = await issueToken(id, secret, f.scope);
    ((req as any).gw as GwInfo).appId = id;
    return reply.send(t);
  } catch (e: any) {
    ((req as any).gw as GwInfo).error = e.message;
    return reply.code(e.status || 400).send({ error: e.message, ...(e.detail ? { error_description: e.detail } : {}) });
  }
}

// ---------- MCP: Sutras as skills for AI assistants (Streamable HTTP, JSON-RPC 2.0) ----------

async function handleMcp(req: FastifyRequest, reply: FastifyReply, secure: boolean, endpoint: string) {
  const method = req.method.toUpperCase();
  if (method === 'GET') return reply.code(405).header('allow', 'POST, DELETE').send({ error: 'This MCP server answers POST requests; it does not open an event stream' });
  if (method === 'DELETE' || method === 'OPTIONS') return reply.code(204).send();
  if (method !== 'POST') return reply.code(405).header('allow', 'POST, DELETE').send();
  let msg: any;
  try { msg = JSON.parse(typeof req.body === 'string' ? req.body : String(req.body ?? '')); } catch {
    return reply.code(400).send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Request is not valid JSON' } });
  }
  const tools = mcpTools.filter(t => t.endpoint === endpoint);
  const agentTools = agentMcpTools(endpoint);
  const server = tools.find(t => t.serverId)?.serverId || (agentTools[0]?.agent.node.config.mcpServer as string | undefined);
  const srv = server ? effectiveResource(server) : undefined;
  const batch = Array.isArray(msg) ? msg : [msg];
  const ctx = { headers: req.headers, ip: req.ip, secure, socket: req.raw.socket };
  const allowed = async (t: McpTool) => {
    const ref = t.node.config.policy || (t.serverId ? effectiveResource(t.serverId)?.config.policy : '');
    const policy = ref ? effectiveResource(ref) : undefined;
    if (ref && !policy) throw new PolicyError(503, "The tool's security policy is missing; refusing to serve it unprotected");
    const who = await authorize(policy, ctx);
    const g = (req as any).gw as GwInfo | undefined;
    if (g) { g.caller = who.subject; g.appId = who.appId; }
    return who;
  };
  /** Agents on this address follow the MCP server's policy. */
  const serverAllowed = async () => {
    const ref = srv?.config.policy || '';
    const policy = ref ? effectiveResource(ref) : undefined;
    if (ref && !policy) throw new PolicyError(503, "The MCP server's security policy is missing; refusing to serve it unprotected");
    const who = await authorize(policy, ctx);
    const g = (req as any).gw as GwInfo | undefined;
    if (g) { g.caller = who.subject; g.appId = who.appId; }
    return who;
  };
  const out: any[] = [];
  for (const m of batch) {
    if (!m || m.jsonrpc !== '2.0' || typeof m.method !== 'string') { out.push({ jsonrpc: '2.0', id: m?.id ?? null, error: { code: -32600, message: 'Invalid request' } }); continue; }
    if (m.id === undefined || m.id === null) continue; // notification
    const ok = (result: any) => out.push({ jsonrpc: '2.0', id: m.id, result });
    const err = (code: number, message: string) => out.push({ jsonrpc: '2.0', id: m.id, error: { code, message } });
    if (m.method === 'initialize') {
      const asked = String(m.params?.protocolVersion || '');
      reply.header('mcp-session-id', crypto.randomUUID());
      ok({
        protocolVersion: MCP_PROTOCOLS.includes(asked) ? asked : MCP_PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'SutraFlow', title: srv?.config.title || 'SutraFlow skills', version: sutraVersion },
        instructions: srv?.config.instructions || 'Each tool runs a SutraFlow Sutra (an integration process) and returns its outcome. Read each tool description to choose one.',
      });
    } else if (m.method === 'ping') {
      ok({});
    } else if (m.method === 'tools/list') {
      const list: any[] = [];
      let denied: PolicyError | undefined;
      for (const t of tools) {
        try { await allowed(t); list.push(toolDefinition(t.node)); } catch (e: any) { denied ||= e; }
      }
      for (const t of agentTools) {
        try { await serverAllowed(); list.push(t.def); } catch (e: any) { denied ||= e; }
      }
      if (!list.length && denied) {
        if (denied.headers) reply.headers(denied.headers);
        return reply.code(denied.status || 401).send({ jsonrpc: '2.0', id: m.id, error: { code: -32001, message: denied.message } });
      }
      ok({ tools: list });
    } else if (m.method === 'tools/call') {
      const name = String(m.params?.name || '');
      const at = agentTools.find(x => x.def.name === name);
      if (at) {
        let who;
        try { who = await serverAllowed(); } catch (e: any) {
          const pe = e as PolicyError;
          if (pe.headers) reply.headers(pe.headers);
          return reply.code(pe.status || 401).send({ jsonrpc: '2.0', id: m.id, error: { code: -32001, message: pe.message } });
        }
        if (!String(m.params?.arguments?.message || '').trim() && !m.params?.arguments?.job) { ok(toolResult('Missing argument: message', true)); continue; }
        ok(await callAgentTool(at.agent, m.params?.arguments || {}, who));
        continue;
      }
      const t = tools.find(x => x.node.config.toolName === name);
      if (!t) { err(-32602, `Unknown tool: ${name}`); continue; }
      let caller;
      try { caller = await allowed(t); } catch (e: any) {
        const pe = e as PolicyError;
        if (pe.headers) reply.headers(pe.headers);
        return reply.code(pe.status || 401).send({ jsonrpc: '2.0', id: m.id, error: { code: -32001, message: pe.message } });
      }
      const args = m.params?.arguments && typeof m.params.arguments === 'object' ? m.params.arguments : {};
      const def = toolDefinition(t.node);
      const missing = ((def.inputSchema.required || []) as string[]).filter(k => args[k] === undefined || args[k] === null || args[k] === '');
      if (missing.length) { ok(toolResult(`Missing argument${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`, true)); continue; }
      const input = { arguments: args, tool: name, auth: caller, client: { ip: req.ip, secure, name: String(req.headers['user-agent'] || ''), version: '' } };
      try {
        const { runId, reply: r } = await waitReply(onReply => engine.startRun({ doc: t.doc, flowId: t.flowId, projectId: t.projectId, version: t.version, triggerNodeId: t.node.id, input, source: 'mcp', onReply, traceparent: String(req.headers.traceparent || '') }), config.replyTimeoutMs);
        reply.header('x-sutra-run', runId);
        if (r.failed) { ok(toolResult(`The Sutra failed: ${r.error || 'unknown error'}`, true)); continue; }
        const b = r.body;
        const fromReply = b && typeof b === 'object' && 'result' in b && 'isError' in b;
        ok(toolResult(fromReply ? b.result : b, fromReply ? !!b.isError : false));
      } catch (e: any) {
        ok(toolResult(e.runId !== undefined ? 'The Sutra did not reply in time' : e.message, true));
      }
    } else if (m.method === 'resources/list') {
      ok({ resources: [] });
    } else if (m.method === 'prompts/list') {
      ok({ prompts: [] });
    } else {
      err(-32601, `Method not found: ${m.method}`);
    }
  }
  if (!out.length) return reply.code(202).send();
  return reply.code(200).type('application/json').send(JSON.stringify(Array.isArray(msg) ? out : out[0]));
}

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
    if (run && !reply.getHeader('traceparent')) reply.header('traceparent', engine.traceparentOf(String(run)));
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
  await Promise.all([closeServer(httpApp), closeServer(httpsApp)]);
  httpApp = httpsApp = null;
}
