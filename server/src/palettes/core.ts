import { XMLBuilder } from 'fast-xml-parser';
import type { Activity } from '../engine/types.js';
import { getPath, setPath, toNumber } from '../template.js';
import { xmlParser } from '../security/outbound.js';
import { inferTree, type SNode } from '../schemas.js';
import { adhocTree, type MappingValue } from '../mapping.js';
import { F, when, isObj, listOf, parseJsonText, needList, OPS, compare } from './common.js';
import { truthy } from '../expr.js';

const safeJson = (t: unknown): any => { if (typeof t !== 'string') return t; try { return JSON.parse(t); } catch { return undefined; } };
/** Route names from a kv field ([{k, v}]) or a comma list. */
const routeNames = (v: unknown) => (Array.isArray(v) ? v.map((r: any) => String(r?.k ?? r ?? '').trim()).filter(Boolean) : listOf(v));

/* ---------------- Triggers ---------------- */

const triggers: Activity[] = [
  {
    type: 'start', palette: 'triggers', name: 'Manual start', glyph: '▶', trigger: true, ports: ['out'],
    desc: 'Starts the Sutra from the studio or the Run API, with a test payload.',
    fields: [
      F('schema', 'Payload schema', 'schema', '', { help: 'Optional. Describes the payload for mapping in later steps.' }),
      F('payload', 'Test payload (JSON)', 'code', '{\n  "orderId": "A-1001"\n}'),
    ],
    outputSchema: (cfg, h) => h.schema(cfg.schema) || h.infer(safeJson(cfg.payload) ?? {}),
    execute: c => ({ out: c.input ?? parseJsonText(c.raw('payload'), 'Test payload') ?? {} }),
  },
  {
    type: 'timer', palette: 'triggers', name: 'Timer', glyph: '⏱', trigger: true, ports: ['out'],
    desc: 'Starts the Sutra on a schedule while the Sutra is deployed: a cron expression or a fixed interval.',
    fields: [
      F('mode', 'Schedule by', 'select', 'cron', { options: ['cron', 'interval'] }),
      F('cron', 'Cron expression', 'text', '0 */15 * * * *', { help: 'Seconds field optional. Example: 0 30 9 * * MON-FRI', ...when('mode', 'cron') }),
      F('every', 'Every (seconds)', 'number', 300, when('mode', 'interval')),
      F('timezone', 'Time zone', 'text', 'Asia/Kolkata', when('mode', 'cron')),
      F('payload', 'Payload (JSON)', 'code', '{}'),
    ],
    outputHint: { firedAt: '2026-01-01T00:00:00.000Z' },
    outputSchema: (cfg, h) => h.infer({ ...(safeJson(cfg.payload) || {}), firedAt: '2026-01-01T00:00:00.000Z' }),
    execute: c => ({ out: { ...(parseJsonText(c.raw('payload'), 'Payload') || {}), ...(isObj(c.input) ? c.input : {}), firedAt: c.input?.firedAt || new Date().toISOString() } }),
  },
  {
    type: 'restService', palette: 'triggers', name: 'REST service', glyph: '⇲', trigger: true, ports: ['out'],
    desc: 'Exposes the Sutra as an HTTP/REST API on the gateway. Reply with a Send HTTP response step.',
    fields: [
      F('method', 'Method', 'select', 'POST', { options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'ANY'] }),
      F('path', 'Path', 'text', '/orders/:id', { help: 'Use :name for path parameters. Served on the gateway ports.' }),
      F('policy', 'API security policy', 'resource', '', { resourceKind: 'inboundPolicy', help: 'Empty = no authentication (not advised outside testing).' }),
      F('maxBodyKb', 'Max body size (KB)', 'number', 1024),
      F('bodySchema', 'Request body schema', 'schema', '', { help: 'Optional. Shape of the JSON or XML body callers send.' }),
      F('testRequest', 'Test request (JSON)', 'code', '{\n  "method": "POST",\n  "params": { "id": "A-1001" },\n  "query": {},\n  "headers": {},\n  "body": { "qty": 2 }\n}'),
    ],
    outputHint: { method: 'POST', path: '/orders/A-1001', params: { id: '' }, query: {}, headers: {}, body: {}, auth: { subject: '', method: '' }, client: { ip: '' } },
    outputSchema: (cfg, h) => {
      const test = safeJson(cfg.testRequest) || {};
      const params = Object.fromEntries(String(cfg.path || '').split('/').filter(x => x.startsWith(':')).map(x => [x.slice(1), '']));
      const t = h.infer({ method: '', path: '', params: { ...params, ...(test.params || {}) }, query: test.query || {}, headers: test.headers || {}, body: null, auth: { subject: '', method: '', claims: {} }, client: { ip: '', secure: true } });
      const body = h.schema(cfg.bodySchema);
      // An XSD tree wraps the root element, matching parsed XML ({ Order: {...} }).
      const bodyNode: SNode = body ? { ...body, name: 'body' } : h.infer(test.body ?? {}, 'body');
      t.children = t.children!.map(ch => (ch.name === 'body' ? bodyNode : ch));
      return t;
    },
    execute: c => ({ out: c.input ?? parseJsonText(c.raw('testRequest'), 'Test request') ?? {} }),
  },
  {
    type: 'soapService', palette: 'triggers', name: 'SOAP service', glyph: '⧉', trigger: true,
    ports: cfg => (listOf(cfg.operations).length ? listOf(cfg.operations) : ['out']),
    desc: 'Exposes the Sutra as a SOAP web service with a generated WSDL. Each operation is an output; reply with a SOAP reply step.',
    fields: [
      F('serviceName', 'Service name', 'text', 'OrderService'),
      F('namespace', 'Target namespace', 'text', 'urn:sutra:orders'),
      F('path', 'Path', 'text', '/soap/orders', { help: 'WSDL is served at this path with ?wsdl.' }),
      F('operations', 'Operations (comma separated)', 'text', 'GetOrder, CreateOrder', { ports: true }),
      F('soapVersion', 'SOAP version', 'select', '1.1', { options: ['1.1', '1.2'] }),
      F('policy', 'API security policy', 'resource', '', { resourceKind: 'inboundPolicy', help: 'Use WS-Security UsernameToken for SOAP callers, or mutual TLS / Basic.' }),
      F('testRequest', 'Test request (JSON)', 'code', '{\n  "operation": "GetOrder",\n  "body": { "OrderId": "A-1001" }\n}'),
    ],
    outputHint: { operation: 'GetOrder', body: {}, header: {}, auth: { subject: '', method: '' }, client: { ip: '' } },
    outputSchema: (cfg, h) => h.infer({ operation: '', body: safeJson(cfg.testRequest)?.body ?? {}, header: {}, soapAction: '', auth: { subject: '', method: '' }, client: { ip: '', secure: true } }),
    execute: c => {
      const req = c.input ?? parseJsonText(c.raw('testRequest'), 'Test request') ?? {};
      const ops = listOf(c.raw('operations'));
      const op = ops.find(o => o.toLowerCase() === String(req.operation || '').toLowerCase());
      if (ops.length && !op) throw new Error(`Operation "${req.operation}" is not one of: ${ops.join(', ')}`);
      return { port: op || 'out', out: req };
    },
  },
];

/* ---------------- Flow control ---------------- */

const flow: Activity[] = [
  {
    type: 'if', palette: 'flow', name: 'If / else', glyph: '◇', ports: ['true', 'false'],
    desc: 'Sends the data down the true or false branch.',
    fields: [
      F('left', 'Value', 'text', '{{input.status}}', { tpl: true }),
      F('op', 'Check', 'select', 'equals', { options: OPS }),
      F('right', 'Compare to', 'text', 'paid', { tpl: true, showIf: { k: 'op', in: OPS.filter(o => !o.startsWith('is ')) } }),
    ],
    passThrough: true,
    execute: c => ({ port: compare(c.v('left'), c.raw('op'), c.v('right')) ? 'true' : 'false', out: c.input }),
  },
  {
    type: 'switch', palette: 'flow', name: 'Switch', glyph: '☰',
    ports: cfg => [...listOf(cfg.cases), 'default'],
    desc: 'Matches a value against cases. Each case is an output.',
    fields: [F('value', 'Value', 'text', '{{input.type}}', { tpl: true }), F('cases', 'Cases (comma separated)', 'text', 'retail, wholesale', { ports: true })],
    passThrough: true,
    execute: c => {
      const v = String(c.v('value') ?? '').trim().toLowerCase();
      return { port: listOf(c.raw('cases')).find(x => x.toLowerCase() === v) || 'default', out: c.input };
    },
  },
  {
    type: 'router', palette: 'flow', name: 'Router', glyph: '⑂',
    ports: cfg => [...routeNames(cfg.routes), 'otherwise'],
    desc: 'Conditional branches. Each route has a condition; take the first match or every match. Nothing matched goes to otherwise.',
    fields: [
      F('routes', 'Routes', 'kv', [{ k: 'large', v: '={input.amount} > 1000' }, { k: 'priority', v: "={input.customer.tier} = 'gold'" }], { tpl: true, ports: true, help: 'Route name and its condition (an = expression or a {{ }} value; true when not empty or false).' }),
      F('mode', 'Take', 'select', 'first match', { options: ['first match', 'all matches'] }),
    ],
    passThrough: true,
    execute: c => {
      const rows = ((c.raw('routes') as any[]) || []).filter(r => r?.k);
      const hits: string[] = [];
      for (const r of rows) {
        if (truthy(c.resolve(r.v))) { hits.push(String(r.k).trim()); if (c.raw('mode') !== 'all matches') break; }
      }
      if (!hits.length) return { port: 'otherwise', out: c.input };
      return { emits: hits.map(port => ({ port, out: c.input })), store: c.input };
    },
  },
  {
    type: 'forEach', palette: 'flow', name: 'For each', glyph: '↻', ports: ['item', 'done'],
    desc: 'Runs the item branch once per list entry, then the done branch once with the whole list.',
    fields: [F('list', 'List', 'text', '{{input.items}}', { tpl: true }), F('max', 'Maximum items', 'number', 1000)],
    outputHint: { items: [], count: 0 },
    execute: c => {
      const arr = needList(c.v('list'), 'List');
      const max = Number(c.raw('max')) || 1000;
      if (arr.length > max) throw new Error(`List has ${arr.length} items, more than the maximum of ${max}`);
      return {
        emits: [...arr.map((it, i) => ({ port: 'item', out: isObj(it) ? { ...it, _index: i } : { value: it, _index: i } })), { port: 'done', out: { items: arr, count: arr.length } }],
        store: { items: arr, count: arr.length },
      };
    },
  },
  {
    type: 'merge', palette: 'flow', name: 'Merge', glyph: '⋈', ports: ['out'], join: true,
    desc: 'Waits for every incoming branch (branches not taken are skipped), then continues once with each branch\'s output by step name.',
    fields: [],
    outputSchema: (_cfg, h) => h.input,
    execute: c => ({ out: c.input }),
  },
  {
    type: 'wait', palette: 'flow', name: 'Wait', glyph: '⏸', ports: ['out'],
    desc: 'Pauses the branch. Waits over 5 seconds are durable and survive a restart.',
    fields: [F('ms', 'Wait (milliseconds)', 'number', 1000), F('until', 'Or until (date/time)', 'text', '', { tpl: true, help: 'ISO date such as {{input.dueAt}}. Overrides the wait above.' })],
    passThrough: true,
    execute: async c => {
      if (c.phase === 'resume') return { out: c.input };
      const until = c.v('until') ? Date.parse(String(c.v('until'))) : Date.now() + Math.max(0, Number(c.raw('ms')) || 0);
      if (!isFinite(until)) throw new Error('"Until" is not a valid date');
      const ms = until - Date.now();
      if (ms > 5000) return { deferUntil: until };
      if (ms > 0) await new Promise((r, j) => { const t = setTimeout(r, ms); c.signal.addEventListener('abort', () => { clearTimeout(t); j(new Error('Cancelled')); }); });
      return { out: c.input };
    },
  },
  {
    type: 'approval', palette: 'flow', name: 'Human approval', glyph: '✓', ports: ['approved', 'rejected'],
    desc: 'Pauses until a person approves or rejects in Runs > Approvals. The run waits as saved state, for days if needed.',
    fields: [F('message', 'Question', 'textarea', 'Approve order {{input.orderId}}?', { tpl: true }), F('assignee', 'Assignee (optional)', 'text', '')],
    outputHint: { approval: { approved: true, by: '', comment: '', at: '' } },
    outputSchema: (_cfg, h) => ({ name: 'out', type: 'object', children: [...(h.input?.children || []), h.infer({ approved: true, by: '', comment: '', at: '' }, 'approval')] }),
    execute: c => ({ wait: { kind: 'approval', message: String(c.v('message') ?? ''), assignee: c.raw('assignee') || undefined } }),
  },
  {
    type: 'setVar', palette: 'flow', name: 'Set variables', glyph: '𝑥', ports: ['out'],
    desc: 'Stores values for later steps as {{vars.name}}. Passes its input through.',
    fields: [F('vars', 'Variables', 'kv', [{ k: 'total', v: '{{input.amount}}' }], { tpl: true })],
    passThrough: true,
    execute: c => {
      for (const r of (c.raw('vars') as any[]) || []) if (r?.k) c.setVar(r.k, c.resolve(r.v));
      return { out: c.input };
    },
  },
  {
    type: 'throw', palette: 'flow', name: 'Throw error', glyph: '!', ports: [],
    desc: 'Fails this branch with a message. Connect its error output to handle it, or the run fails.',
    fields: [F('message', 'Error message', 'text', 'Order {{input.orderId}} is not valid', { tpl: true })],
    execute: c => { throw new Error(String(c.v('message') || 'Error')); },
  },
  {
    type: 'end', palette: 'flow', name: 'End', glyph: '■', ports: [], noErrorPort: true,
    desc: 'Ends a branch and records its result. Can also stop the whole Sutra at once, as succeeded or failed, cancelling the other branches.',
    fields: [
      F('stop', 'Ends', 'select', 'this branch', { options: ['this branch', 'Sutra: success', 'Sutra: error'], help: 'Sutra: success / error stops every other branch now and sets the run status.' }),
      F('result', 'Result', 'text', '{{input}}', { tpl: true }),
      F('message', 'Error message', 'text', 'Order {{input.orderId}} could not be processed', { tpl: true, ...when('stop', 'Sutra: error') }),
    ],
    execute: c => {
      const mode = c.raw('stop') || 'this branch';
      if (mode === 'this branch') return { out: c.v('result') };
      return { out: c.v('result'), stop: mode === 'Sutra: error' ? { status: 'failed', message: String(c.v('message') || 'Sutra stopped with an error') } : { status: 'done' } };
    },
  },
];

/* ---------------- Data & mapping ---------------- */

function parseCsv(text: string, d: string) {
  const rows: string[][] = [];
  let row: string[] = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true;
    else if (ch === d) { row.push(f); f = ''; }
    else if (ch === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (ch !== '\r') f += ch;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  const clean = rows.filter(r => r.some(x => x.trim() !== ''));
  if (!clean.length) return [];
  const [h, ...rest] = clean;
  const auto = (v = '') => { const t = v.trim(); return t !== '' && /^-?\d*\.?\d+$/.test(t) ? Number(t) : t === 'true' ? true : t === 'false' ? false : t; };
  return rest.map(r => Object.fromEntries(h.map((k, i) => [k.trim(), auto(r[i])])));
}

function toCsv(arr: any[], d: string) {
  if (!arr.length) return '';
  const keys = [...new Set(arr.flatMap(r => (isObj(r) ? Object.keys(r) : ['value'])))];
  const cell = (v: unknown) => { const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return new RegExp(`["\\n${d === '\t' ? '\\t' : d}]`).test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return [keys.join(d), ...arr.map(r => keys.map(k => cell(isObj(r) ? r[k] : r)).join(d))].join('\n');
}

const xmlBuilder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '@_', format: true, suppressEmptyNode: true });
const delim = (d: string) => (d === 'tab' ? '\t' : d || ',');

const data: Activity[] = [
  {
    type: 'mapper', palette: 'data', name: 'Map data', glyph: '⇄', ports: ['out'],
    desc: 'Builds a new message from earlier steps. Pick a shared schema for the target, or add target fields by hand; map each with a formula, For-Each, If or Choose.',
    fields: [
      F('schema', 'Target schema', 'schema', '', { help: 'Optional. Without one, add target fields in the Input tab.' }),
      F('mapping', 'Target', 'mapping', { rules: { orderId: { expr: '{input.orderId}' } } }, { schemaField: 'schema' }),
      F('start', 'Start from', 'select', 'empty', { options: ['empty', 'input'], help: 'input: keep the incoming fields and add or replace the mapped ones.' }),
    ],
    outputSchema: (cfg, h) => {
      const t = h.mappingTree(cfg, 'mapping', 'schema');
      // Legacy "map" rows (dotted paths) still contribute fields.
      for (const r of (cfg.map as any[]) || []) if (r?.k) t.children = [...(t.children || []), { name: String(r.k).split('.')[0], type: 'any' }];
      if (cfg.start === 'input' && h.input?.children) t.children = [...h.input.children.filter(ch => !t.children?.some(x => x.name === ch.name)), ...(t.children || [])];
      return t;
    },
    execute: c => {
      const o: Record<string, any> = c.raw('start') === 'input' && isObj(c.input) ? structuredClone(c.input) : {};
      for (const r of (c.raw('map') as any[]) || []) if (r?.k) setPath(o, String(r.k), c.resolve(r.v));
      if (c.raw('mapping')) Object.assign(o, c.mapping('mapping'));
      return { out: o };
    },
  },
  {
    type: 'parseJson', palette: 'data', name: 'Parse JSON', glyph: '{}', ports: ['out'], desc: 'Turns JSON text into data; a shared schema describes the result for mapping.',
    fields: [F('schema', 'Schema', 'schema', '', { schemaKinds: ['json'] }), F('text', 'JSON text', 'textarea', '{{input.body}}', { tpl: true })],
    outputSchema: (cfg, h) => h.schema(cfg.schema) || { name: 'out', type: 'any' },
    execute: c => { const v = c.v('text'); return { out: typeof v === 'string' ? parseJsonText(v, 'Input') : v }; },
  },
  {
    type: 'renderJson', palette: 'data', name: 'Render JSON', glyph: '⟨⟩', ports: ['out'], desc: 'Turns data into JSON text: from one value, or mapped field by field to a shared schema.',
    fields: [
      F('source', 'Build from', 'select', 'value', { options: ['value', 'mapping'] }),
      F('value', 'Data', 'text', '{{input}}', { tpl: true, ...when('source', 'value') }),
      F('schema', 'Schema', 'schema', '', { schemaKinds: ['json'], ...when('source', 'mapping') }),
      F('mapping', 'JSON content', 'mapping', { rules: {} }, { schemaField: 'schema', ...when('source', 'mapping') }),
      F('pretty', 'Pretty print', 'bool', true),
    ],
    outputHint: { text: '' },
    execute: c => ({ out: { text: JSON.stringify(c.raw('source') === 'mapping' ? c.mapping('mapping') : c.v('value'), null, c.raw('pretty') ? 2 : 0) } }),
  },
  {
    type: 'parseXml', palette: 'data', name: 'Parse XML', glyph: '</>', ports: ['out'], desc: 'Turns XML text into data. Namespace prefixes are removed; attributes start with @_. An XSD describes the result for mapping.',
    fields: [F('schema', 'Schema (XSD)', 'schema', '', { schemaKinds: ['xsd'] }), F('text', 'XML text', 'textarea', '{{input.body}}', { tpl: true })],
    outputSchema: (cfg, h) => h.schema(cfg.schema) || { name: 'out', type: 'any' },
    execute: c => {
      const t = String(c.v('text') ?? '');
      if (!t.trim().startsWith('<')) throw new Error('The input is not XML');
      return { out: xmlParser.parse(t) };
    },
  },
  {
    type: 'renderXml', palette: 'data', name: 'Render XML', glyph: '⟨/⟩', ports: ['out'], desc: 'Turns data into XML text: from one value under a root element, or mapped field by field to an XSD.',
    fields: [
      F('source', 'Build from', 'select', 'value', { options: ['value', 'mapping'] }),
      F('root', 'Root element', 'text', 'Order', when('source', 'value')),
      F('value', 'Data', 'text', '{{input}}', { tpl: true, ...when('source', 'value') }),
      F('schema', 'Schema (XSD)', 'schema', '', { schemaKinds: ['xsd'], ...when('source', 'mapping') }),
      F('mapping', 'XML content', 'mapping', { rules: {} }, { schemaField: 'schema', ...when('source', 'mapping') }),
      F('declaration', 'Add <?xml?> declaration', 'bool', true),
    ],
    outputHint: { text: '' },
    execute: c => {
      let doc: any;
      if (c.raw('source') === 'mapping') {
        doc = c.mapping('mapping');
        if (!isObj(doc) || Object.keys(doc).length !== 1) throw new Error('The mapped XML must have exactly one root element. Pick an XSD with a root element, or add one top-level target field.');
      } else doc = { [c.raw('root') || 'root']: c.v('value') };
      const body = xmlBuilder.build(doc);
      return { out: { text: (c.raw('declaration') ? '<?xml version="1.0" encoding="UTF-8"?>\n' : '') + body } };
    },
  },
  {
    type: 'parseCsv', palette: 'data', name: 'Parse CSV', glyph: '▦', ports: ['out'], desc: 'Turns CSV text with a header row into a list of rows.',
    fields: [F('text', 'CSV text', 'textarea', '{{input.csv}}', { tpl: true }), F('delim', 'Separator', 'select', ',', { options: [',', ';', '|', 'tab'] })],
    outputHint: { rows: [], count: 0 },
    execute: c => { const rows = parseCsv(String(c.v('text') ?? ''), delim(c.raw('delim'))); return { out: { rows, count: rows.length } }; },
  },
  {
    type: 'renderCsv', palette: 'data', name: 'Render CSV', glyph: '▤', ports: ['out'], desc: 'Turns a list of rows into CSV text.',
    fields: [F('list', 'Rows', 'text', '{{input.items}}', { tpl: true }), F('delim', 'Separator', 'select', ',', { options: [',', ';', '|', 'tab'] })],
    outputHint: { text: '' },
    execute: c => ({ out: { text: toCsv(needList(c.v('list'), 'Rows'), delim(c.raw('delim'))) } }),
  },
  {
    type: 'filter', palette: 'data', name: 'Filter list', glyph: '⊻', ports: ['out'], desc: 'Keeps the rows that pass a check.',
    fields: [
      F('list', 'List', 'text', '{{input.rows}}', { tpl: true }), F('field', 'Field in each row', 'text', 'status'),
      F('op', 'Check', 'select', 'equals', { options: OPS }), F('value', 'Compare to', 'text', 'paid', { tpl: true }),
    ],
    outputHint: { items: [], count: 0 },
    execute: c => {
      const b = c.v('value'), k = c.raw('field');
      const items = needList(c.v('list'), 'List').filter(r => compare(k ? getPath(r, k) : r, c.raw('op'), b));
      return { out: { items, count: items.length } };
    },
  },
  {
    type: 'sort', palette: 'data', name: 'Sort list', glyph: '⇅', ports: ['out'], desc: 'Orders rows by a field.',
    fields: [F('list', 'List', 'text', '{{input.items}}', { tpl: true }), F('field', 'Sort by field', 'text', 'amount'), F('dir', 'Order', 'select', 'ascending', { options: ['ascending', 'descending'] })],
    outputHint: { items: [], count: 0 },
    execute: c => {
      const arr = [...needList(c.v('list'), 'List')], k = c.raw('field'), d = c.raw('dir') === 'descending' ? -1 : 1;
      arr.sort((a, b) => {
        const x = k ? getPath(a, k) : a, y = k ? getPath(b, k) : b, nx = toNumber(x), ny = toNumber(y);
        return d * (isFinite(nx) && isFinite(ny) ? nx - ny : String(x ?? '').localeCompare(String(y ?? '')));
      });
      return { out: { items: arr, count: arr.length } };
    },
  },
  {
    type: 'aggregate', palette: 'data', name: 'Aggregate', glyph: 'Σ', ports: ['out'], desc: 'Sum, average, count, min or max of a field, optionally grouped.',
    fields: [
      F('list', 'List', 'text', '{{input.items}}', { tpl: true }), F('field', 'Field', 'text', 'amount'),
      F('fn', 'Calculate', 'select', 'sum', { options: ['sum', 'average', 'count', 'min', 'max'] }), F('groupBy', 'Group by field (optional)', 'text', ''),
    ],
    outputHint: { result: 0, count: 0, groups: {} },
    execute: c => {
      const arr = needList(c.v('list'), 'List'), k = c.raw('field'), fn = c.raw('fn');
      const calc = (rows: any[]) => {
        const vals = rows.map(r => toNumber(k ? getPath(r, k) : r)).filter(isFinite);
        const r = fn === 'count' ? rows.length : !vals.length ? 0 : fn === 'sum' ? vals.reduce((a, b) => a + b, 0)
          : fn === 'average' ? vals.reduce((a, b) => a + b, 0) / vals.length : fn === 'min' ? Math.min(...vals) : Math.max(...vals);
        return Math.round(r * 1e6) / 1e6;
      };
      const out: any = { result: calc(arr), count: arr.length };
      if (c.raw('groupBy')) {
        const g: Record<string, any[]> = {};
        for (const r of arr) (g[String(getPath(r, c.raw('groupBy')) ?? '')] ||= []).push(r);
        out.groups = Object.fromEntries(Object.entries(g).map(([gk, rows]) => [gk, { result: calc(rows), count: rows.length }]));
      }
      return { out };
    },
  },
];

/* ---------------- General ---------------- */

const general: Activity[] = [
  {
    type: 'log', palette: 'general', name: 'Log', glyph: '✎', ports: ['out'], desc: 'Writes a message to the run log and passes data through.',
    fields: [F('message', 'Message', 'textarea', '{{input}}', { tpl: true }), F('level', 'Level', 'select', 'info', { options: ['info', 'warn', 'error'] })],
    passThrough: true,
    execute: c => {
      const m = c.v('message');
      c.log(c.raw('level') || 'info', typeof m === 'object' ? JSON.stringify(m) : String(m ?? ''));
      return { out: c.input };
    },
  },
  {
    type: 'validate', palette: 'general', name: 'Validate fields', glyph: '☑', ports: ['valid', 'invalid'],
    desc: 'Checks that required fields are present. Invalid input goes to the invalid branch with a list of problems.',
    fields: [F('required', 'Required fields', 'list', ['orderId']), F('source', 'Data to check', 'text', '{{input}}', { tpl: true })],
    outputHint: { valid: true, problems: [] },
    passThrough: true,
    execute: c => {
      const src = c.v('source');
      const problems = listOf(c.raw('required')).filter(p => { const v = getPath(src, p); return v == null || v === ''; }).map(p => `${p} is required`);
      return { port: problems.length ? 'invalid' : 'valid', out: problems.length ? { valid: false, problems, data: src } : src };
    },
  },
];

export const coreActivities: Activity[] = [...triggers, ...flow, ...data, ...general];
