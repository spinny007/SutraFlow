/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { createRequire } from 'node:module';
import type { Activity } from '../engine/types.js';
import { requireResource, type Resource } from '../resources.js';
import { applyAuth, dispatcherFor, httpCall, httpsAgentFor, joinUrl, tlsFromConnection, xmlParser } from '../security/outbound.js';
import { guarded } from '../security/breaker.js';
import { applyWss, NS, SutraSoapSecurity } from '../security/wss.js';
import { requireSecret } from '../secrets.js';
import { wsdlPath } from '../schemas.js';
import { F, when, isObj } from './common.js';

const require = createRequire(import.meta.url);
const soap = require('soap') as typeof import('soap');

type SecretFn = (name: string, what?: string) => string;

async function wsdlClient(wsdlUrl: string, conn: Resource | undefined, auth: { headers: Record<string, string> }, secret: SecretFn, endpoint?: string) {
  const tls = tlsFromConnection(conn, secret);
  const httpsAgent = httpsAgentFor(tls);
  const client = await soap.createClientAsync(joinUrl(conn?.config.baseUrl, wsdlUrl), {
    wsdl_options: { httpsAgent },
    wsdl_headers: auth.headers,
    endpoint: endpoint || undefined,
    returnFault: true,
  } as any);
  return { client, httpsAgent };
}

/** Lists services, ports and operations of a WSDL, with input/output shapes, for the studio's operation picker. */
export async function describeWsdl(wsdlUrl: string, connId?: string, authId?: string) {
  const conn = connId ? requireResource(connId, 'httpConnection', 'HTTP connection') : undefined;
  const profile = authId ? requireResource(authId, 'outboundAuth', 'Outbound security') : undefined;
  const secret: SecretFn = (n, w) => requireSecret(n, w);
  // Only HTTP-level auth matters for fetching the WSDL document.
  const auth = profile && !String(profile.config.type).startsWith('wss')
    ? await applyAuth(profile, secret, x => x, {})
    : { headers: {} };
  const { client } = await wsdlClient(wsdlUrl, conn, auth, secret);
  return client.describe();
}

function faultOf(e: any): { code: string; message: string; detail?: any } | null {
  const f = e?.root?.Envelope?.Body?.Fault || e?.Fault;
  if (!f) return null;
  return {
    code: String(f.faultcode ?? f.Code?.Value ?? 'Fault'),
    message: String(f.faultstring ?? f.Reason?.Text?.$value ?? f.Reason?.Text ?? 'SOAP fault'),
    detail: f.detail ?? f.Detail,
  };
}

const esc = (s: string) => s.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);

export const soapActivities: Activity[] = [
  {
    type: 'soapInvoke', palette: 'soap', name: 'Invoke SOAP service', glyph: '⧉', ports: ['out', 'fault'],
    desc: 'Calls a SOAP web service from its WSDL (or a raw envelope) with WS-Security: UsernameToken, SAML token, X.509 signature, plus Basic/Bearer and mutual TLS.',
    fields: [
      F('mode', 'Call using', 'select', 'wsdl', { options: ['wsdl', 'raw envelope'] }),
      F('connection', 'HTTP connection', 'resource', '', { resourceKind: 'httpConnection', help: 'TLS, client certificate, proxy, timeout.' }),
      F('auth', 'Outbound security', 'resource', '', { resourceKind: 'outboundAuth', help: 'WS-Security profiles add a wsse:Security header; Basic/Bearer/API key go in HTTP headers.' }),
      F('wsdlSource', 'WSDL from', 'select', 'url', { options: ['url', 'project'], ...when('mode', 'wsdl') }),
      F('wsdlUrl', 'WSDL URL', 'text', 'http://localhost:8080/soap/orders?wsdl', when('wsdlSource', 'url')),
      F('wsdlRef', 'Service descriptor', 'schema', '', { schemaKinds: ['wsdl'], ...when('wsdlSource', 'project'), help: 'A WSDL stored in the project (Service descriptors). Set the endpoint below if its address is not right for this environment.' }),
      F('service', 'Service', 'text', '', { ...when('mode', 'wsdl'), help: 'Filled by "Load operations". Empty = first service.' }),
      F('port', 'Port', 'text', '', when('mode', 'wsdl')),
      F('operation', 'Operation', 'text', 'GetOrder', when('mode', 'wsdl')),
      F('argsSource', 'Build request from', 'select', 'template', { options: ['template', 'mapping'], ...when('mode', 'wsdl') }),
      F('args', 'Request message (JSON)', 'code', '{\n  "OrderId": "{{input.orderId}}"\n}', { tpl: true, ...when('argsSource', 'template'), help: 'Field names follow the WSDL input message.' }),
      F('argsSchema', 'Request schema', 'schema', '', when('argsSource', 'mapping')),
      F('argsMapping', 'Request message', 'mapping', { rules: {} }, { schemaField: 'argsSchema', ...when('argsSource', 'mapping') }),
      F('responseSchema', 'Response schema', 'schema', '', { help: 'Optional. Describes the response body for mapping in later steps.' }),
      F('endpoint', 'Endpoint URL', 'text', '', { tpl: true, help: 'Overrides the WSDL address (raw mode: required).' }),
      F('soapVersion', 'SOAP version', 'select', '1.1', { options: ['1.1', '1.2'], ...when('mode', 'raw envelope') }),
      F('soapAction', 'SOAPAction', 'text', '', { tpl: true, ...when('mode', 'raw envelope') }),
      F('bodyXml', 'Body XML', 'code', '<ord:GetOrder xmlns:ord="urn:sutra:orders">\n  <ord:OrderId>{{input.orderId | xmlescape}}</ord:OrderId>\n</ord:GetOrder>', { tpl: true, ...when('mode', 'raw envelope') }),
      F('extraHeaders', 'Extra SOAP headers (XML)', 'code', '', { tpl: true, help: 'Added inside soap:Header, e.g. WS-Addressing or a custom token.' }),
    ],
    outputHint: { body: {}, header: {}, ms: 0 },
    outputSchema: (cfg, h) => {
      const body = h.schema(cfg.responseSchema);
      return { name: 'out', type: 'object', children: [body ? { ...body, name: 'body' } : { name: 'body', type: 'any' }, { name: 'header', type: 'any' }, { name: 'status', type: 'integer' }, { name: 'ms', type: 'integer' }, { name: 'operation', type: 'string' }, { name: 'endpoint', type: 'string' }] };
    },
    execute: async c => {
      const conn = c.raw('connection') ? requireResource(c.raw('connection'), 'httpConnection', 'HTTP connection') : undefined;
      const profile = c.raw('auth') ? requireResource(c.raw('auth'), 'outboundAuth', 'Outbound security') : undefined;
      const tls = tlsFromConnection(conn, c.secret);
      const auth = await applyAuth(profile, c.secret, c.resolve, { soap: true, signal: c.signal, dispatcher: dispatcherFor(conn, tls) });
      const extraHeaders = String(c.v('extraHeaders') ?? '').trim();
      const timeoutMs = Number(conn?.config.timeoutMs) || 30000;
      const t0 = Date.now();

      if (c.raw('mode') === 'raw envelope') {
        const endpoint = String(c.v('endpoint') || '');
        if (!endpoint) throw new Error('Endpoint URL is required for a raw envelope call');
        const v12 = c.raw('soapVersion') === '1.2';
        const action = String(c.v('soapAction') ?? '');
        let xml = `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="${v12 ? NS.soap12 : NS.soap11}"><soapenv:Header>${extraHeaders}</soapenv:Header><soapenv:Body>${String(c.v('bodyXml') ?? '')}</soapenv:Body></soapenv:Envelope>`;
        if (auth.wss) xml = applyWss(xml, auth.wss, 'soapenv');
        const headers: Record<string, string> = { ...auth.headers };
        if (v12) headers['content-type'] = `application/soap+xml; charset=utf-8${action ? `; action="${esc(action)}"` : ''}`;
        else { headers['content-type'] = 'text/xml; charset=utf-8'; headers.soapaction = `"${action}"`; }
        const url = new URL(joinUrl(conn?.config.baseUrl, endpoint));
        for (const [k, v] of Object.entries(auth.query)) url.searchParams.set(k, v);
        const r = await guarded(conn, () => httpCall({ method: 'POST', url: url.toString(), headers, body: xml, dispatcher: dispatcherFor(conn, tls), timeoutMs, signal: c.signal, parse: 'text' }), x => x.status >= 500 && !/Fault/.test(x.text));
        const parsed = r.text.trim().startsWith('<') ? xmlParser.parse(r.text) : null;
        const env = parsed?.Envelope;
        if (!env) throw new Error(`Endpoint returned ${r.status} without a SOAP envelope: ${r.text.slice(0, 300)}`);
        const fault = faultOf({ Fault: env.Body?.Fault });
        if (fault) return { port: 'fault', out: { fault, status: r.status, ms: r.ms } };
        if (r.status >= 400) throw new Error(`Endpoint returned HTTP ${r.status}`);
        return { out: { body: env.Body, header: env.Header ?? {}, status: r.status, ms: r.ms, operation: action, endpoint: `${url.origin}${url.pathname}` } };
      }

      const wsdlUrl = c.raw('wsdlSource') === 'project' ? wsdlPath(String(c.raw('wsdlRef') || '').split('::')[0]) : String(c.raw('wsdlUrl') || '');
      if (!wsdlUrl) throw new Error('WSDL URL is required');
      const { client, httpsAgent } = await wsdlClient(wsdlUrl, conn, { headers: auth.headers }, c.secret, String(c.v('endpoint') || '') || undefined);
      client.setSecurity(new SutraSoapSecurity(auth.wss || {}, auth.headers) as any);
      if (extraHeaders) client.addSoapHeader(extraHeaders);
      const desc = client.describe();
      const service = c.raw('service') || Object.keys(desc)[0];
      if (!desc[service]) throw new Error(`Service "${service}" is not in the WSDL. Found: ${Object.keys(desc).join(', ')}`);
      const port = c.raw('port') || Object.keys(desc[service])[0];
      if (!desc[service][port]) throw new Error(`Port "${port}" is not in service ${service}`);
      const opName = c.raw('operation');
      const fn = (client as any)[service]?.[port]?.[opName];
      if (typeof fn !== 'function') throw new Error(`Operation "${opName}" is not in ${service}/${port}. Found: ${Object.keys(desc[service][port]).join(', ')}`);
      let args = c.raw('argsSource') === 'mapping' ? c.mapping('argsMapping') : c.resolve(c.raw('args'));
      if (typeof args === 'string') {
        try { args = args.trim() ? JSON.parse(args) : {}; } catch (e: any) { throw new Error(`Request message is not valid JSON after mapping: ${e.message}`); }
      }
      const result = await guarded(conn, () => new Promise<{ body: any; raw: string; header: any }>((res, rej) => {
        fn.call(client, args, (err: any, body: any, raw: string, header: any) => (err ? rej(err) : res({ body, raw, header })),
          { httpsAgent, timeout: timeoutMs, signal: c.signal });
      }).catch((e: any) => { const fault = faultOf(e); if (fault) return { fault } as any; throw e; })).catch((e: any) => {
        const fault = faultOf(e);
        if (fault) return { fault } as any;
        throw new Error(`SOAP call ${opName} failed: ${e?.message || e}`);
      });
      if ((result as any).fault) return { port: 'fault', out: { fault: (result as any).fault, ms: Date.now() - t0 } };
      return { out: { body: result.body, header: result.header ?? {}, status: 200, ms: Date.now() - t0, operation: opName, endpoint: String((client as any).endpoint || (client as any).wsdl?.services?.[service]?.ports?.[port]?.location || '') } };
    },
  },
  {
    type: 'soapReply', palette: 'soap', name: 'SOAP reply', glyph: '⧈', ports: ['out'],
    desc: 'Replies to the caller of a SOAP service trigger with a response message or a SOAP fault.',
    fields: [
      F('kind', 'Reply with', 'select', 'response', { options: ['response', 'fault'] }),
      F('bodySource', 'Build response from', 'select', 'template', { options: ['template', 'mapping'], ...when('kind', 'response') }),
      F('body', 'Response message (JSON)', 'code', '{\n  "OrderId": "{{input.body.OrderId}}",\n  "Status": "SHIPPED"\n}', { tpl: true, ...when('bodySource', 'template'), help: 'Wrapped in <OperationResponse> in the service namespace.' }),
      F('bodySchema', 'Response schema', 'schema', '', when('bodySource', 'mapping')),
      F('bodyMapping', 'Response message', 'mapping', { rules: {} }, { schemaField: 'bodySchema', ...when('bodySource', 'mapping') }),
      F('faultCode', 'Fault code', 'text', 'soap:Client', when('kind', 'fault')),
      F('faultString', 'Fault message', 'text', 'Order {{input.body.OrderId}} not found', { tpl: true, ...when('kind', 'fault') }),
    ],
    execute: c => {
      const op = c.scope.trigger?.operation;
      if (c.raw('kind') === 'fault') {
        const fault = { code: String(c.raw('faultCode') || 'soap:Server'), message: String(c.v('faultString') ?? 'Fault') };
        c.reply({ status: 500, body: null, soap: { operation: op, fault } });
        return { out: { fault } };
      }
      let body = c.raw('bodySource') === 'mapping' ? c.mapping('bodyMapping') : c.resolve(c.raw('body'));
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e: any) { throw new Error(`Response message is not valid JSON after mapping: ${e.message}`); }
      }
      c.reply({ status: 200, body, soap: { operation: op } });
      return { out: isObj(body) ? body : { value: body } };
    },
  },
];
