import type { Activity } from '../engine/types.js';
import { kvToObject, requireResource } from '../resources.js';
import { applyAuth, dispatcherFor, httpCall, joinUrl, tlsFromConnection } from '../security/outbound.js';
import { guarded } from '../security/breaker.js';
import { F, when, isObj } from './common.js';
import { XMLBuilder } from 'fast-xml-parser';

const xmlOut = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '@_', suppressEmptyNode: true });

const REDACT = new Set(['authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'x-api-key']);

export const httpActivities: Activity[] = [
  {
    type: 'httpRequest', palette: 'http', name: 'Send HTTP request', glyph: '⇋', ports: ['out'],
    desc: 'Calls a REST/HTTP API with headers, query, body and an outbound security profile (Basic, Bearer, API key, OAuth 2.0). TLS and client certificates come from the HTTP connection.',
    fields: [
      F('connection', 'HTTP connection', 'resource', '', { resourceKind: 'httpConnection', help: 'Optional. Base URL, TLS, client certificate, proxy.' }),
      F('auth', 'Outbound security', 'resource', '', { resourceKind: 'outboundAuth' }),
      F('method', 'Method', 'select', 'GET', { options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] }),
      F('url', 'URL or path', 'text', 'https://httpbin.org/anything/{{input.orderId}}', { tpl: true }),
      F('query', 'Query parameters', 'kv', [], { tpl: true }),
      F('headers', 'Headers', 'kv', [{ k: 'Accept', v: 'application/json' }], { tpl: true, help: 'Values may use {{secret.NAME}}; secret values are masked in run history.' }),
      F('bodyType', 'Body', 'select', 'json', { options: ['none', 'json', 'xml', 'text', 'form', 'mapped JSON', 'mapped XML'], ...when('method', 'POST', 'PUT', 'PATCH', 'DELETE'), help: 'Mapped: build the body field by field against a shared schema in the Input tab.' }),
      F('bodySchema', 'Body schema', 'schema', '', when('bodyType', 'mapped JSON', 'mapped XML')),
      F('bodyMapping', 'Request body', 'mapping', { rules: {} }, { schemaField: 'bodySchema', ...when('bodyType', 'mapped JSON', 'mapped XML') }),
      F('body', 'Body content', 'code', '{\n  "orderId": "{{input.orderId}}"\n}', { tpl: true, help: 'For JSON, write JSON with {{ }} references, or one reference such as {{nodes.Map order}}.', ...when('bodyType', 'json', 'xml', 'text') }),
      F('form', 'Form fields', 'kv', [], { tpl: true, ...when('bodyType', 'form') }),
      F('parse', 'Read response as', 'select', 'auto', { options: ['auto', 'json', 'xml', 'text'] }),
      F('responseSchema', 'Response body schema', 'schema', '', { help: 'Optional. Describes the response body for mapping in later steps.' }),
      F('failOn', 'Fail when status is', 'select', '4xx or 5xx', { options: ['4xx or 5xx', '5xx only', 'never'] }),
    ],
    outputHint: { status: 200, headers: {}, body: {}, ms: 0, method: '', url: '' },
    outputSchema: (cfg, h) => {
      const t = h.infer({ status: 200, headers: {}, body: null, ms: 0, method: '', url: '' });
      const body = h.schema(cfg.responseSchema);
      t.children = t.children!.map(ch => (ch.name === 'body' ? (body ? { ...body, name: 'body' } : { name: 'body', type: 'any' }) : ch));
      return t;
    },
    execute: async c => {
      const connId = c.raw('connection');
      const conn = connId ? requireResource(connId, 'httpConnection', 'HTTP connection') : undefined;
      const authId = c.raw('auth');
      const profile = authId ? requireResource(authId, 'outboundAuth', 'Outbound security') : undefined;
      const tls = tlsFromConnection(conn, c.secret);
      const dispatcher = dispatcherFor(conn, tls);
      const auth = await applyAuth(profile, c.secret, c.resolve, { signal: c.signal, dispatcher });

      const url = new URL(joinUrl(conn?.config.baseUrl, String(c.v('url') ?? '')));
      for (const [k, v] of Object.entries({ ...kvToObject(c.raw('query'), v => String(c.resolve(v) ?? '')), ...auth.query })) url.searchParams.set(k, v);
      const headers: Record<string, string> = {};
      const put = (o: Record<string, string>) => { for (const [k, v] of Object.entries(o)) headers[k.toLowerCase()] = v; };
      put(kvToObject(conn?.config.headers));
      put(kvToObject(c.raw('headers'), v => String(c.resolve(v) ?? '')));
      put(auth.headers);

      const method = c.raw('method') || 'GET';
      let body: string | undefined;
      const bt = ['GET', 'HEAD', 'OPTIONS'].includes(method) ? 'none' : c.raw('bodyType') || 'none';
      if (bt === 'json') {
        const raw = c.raw('body');
        const v = c.resolve(raw);
        if (typeof v === 'string') {
          // A JSON template: resolve references, then check it is valid JSON.
          try { body = JSON.stringify(JSON.parse(v)); } catch (e: any) { throw new Error(`Body is not valid JSON after mapping: ${e.message}`); }
        } else body = JSON.stringify(v);
        headers['content-type'] ||= 'application/json';
      } else if (bt === 'xml' || bt === 'text') {
        const v = c.v('body');
        body = typeof v === 'string' ? v : JSON.stringify(v);
        headers['content-type'] ||= bt === 'xml' ? 'application/xml; charset=utf-8' : 'text/plain; charset=utf-8';
      } else if (bt === 'mapped JSON') {
        body = JSON.stringify(c.mapping('bodyMapping'));
        headers['content-type'] ||= 'application/json';
      } else if (bt === 'mapped XML') {
        const doc = c.mapping('bodyMapping');
        body = '<?xml version="1.0" encoding="UTF-8"?>' + xmlOut.build(doc);
        headers['content-type'] ||= 'application/xml; charset=utf-8';
      } else if (bt === 'form') {
        body = new URLSearchParams(kvToObject(c.raw('form'), v => String(c.resolve(v) ?? ''))).toString();
        headers['content-type'] ||= 'application/x-www-form-urlencoded';
      }

      const timeoutMs = Number(conn?.config.timeoutMs) || 30000;
      const r = await guarded(conn, () => httpCall({ method, url: url.toString(), headers, body, dispatcher, timeoutMs, signal: c.signal, parse: c.raw('parse') || 'auto' }), x => x.status >= 500);
      const failOn = c.raw('failOn') || '4xx or 5xx';
      if ((failOn === '4xx or 5xx' && r.status >= 400) || (failOn === '5xx only' && r.status >= 500)) {
        const detail = typeof r.body === 'string' ? r.body.slice(0, 500) : JSON.stringify(r.body)?.slice(0, 500);
        throw new Error(`${method} ${url.origin}${url.pathname} returned ${r.status}: ${detail}`);
      }
      const shown = Object.fromEntries(Object.entries(r.headers).filter(([k]) => !REDACT.has(k)));
      return { out: { status: r.status, headers: shown, body: r.body, ms: r.ms, method, url: `${url.origin}${url.pathname}` } };
    },
  },
  {
    type: 'httpResponse', palette: 'http', name: 'Send HTTP response', glyph: '⇱', ports: ['out'],
    desc: 'Replies to the caller of a REST service trigger. The Sutra can continue after replying.',
    fields: [
      F('status', 'Status code', 'text', '200', { tpl: true }),
      F('contentType', 'Content type', 'select', 'application/json', { options: ['application/json', 'application/xml', 'text/plain', 'text/csv', 'text/html'] }),
      F('bodySource', 'Build body from', 'select', 'template', { options: ['template', 'mapping'] }),
      F('body', 'Body', 'code', '{\n  "ok": true,\n  "orderId": "{{input.orderId}}"\n}', { tpl: true, ...when('bodySource', 'template') }),
      F('bodySchema', 'Body schema', 'schema', '', when('bodySource', 'mapping')),
      F('bodyMapping', 'Response body', 'mapping', { rules: {} }, { schemaField: 'bodySchema', ...when('bodySource', 'mapping') }),
      F('headers', 'Headers', 'kv', [], { tpl: true }),
    ],
    execute: c => {
      const ct = c.raw('contentType') || 'application/json';
      let body = c.raw('bodySource') === 'mapping' ? c.mapping('bodyMapping') : c.v('body');
      if (ct.includes('json') && typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e: any) { throw new Error(`Body is not valid JSON after mapping: ${e.message}`); }
      }
      const status = Number(c.v('status')) || 200;
      if (status < 100 || status > 599) throw new Error(`Status ${status} is not a valid HTTP status`);
      const headers = kvToObject(c.raw('headers'), v => String(c.resolve(v) ?? ''));
      c.reply({ status, headers, body, contentType: ct });
      return { out: { status, body: isObj(body) || Array.isArray(body) ? body : String(body ?? '') } };
    },
  },
];

