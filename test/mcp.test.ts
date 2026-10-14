import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { testEnv, node, edge } from './helpers.js';

const env = testEnv(18950);
const { boot } = await import('../server/src/index.js');
const projects = await import('../server/src/projects.js');
const flows = await import('../server/src/flows.js');
const { saveResource } = await import('../server/src/resources.js');
const { setSecret } = await import('../server/src/secrets.js');
const { rebuildRoutes } = await import('../server/src/gateway/gateway.js');

let srv: Awaited<ReturnType<typeof boot>>;
let pid = '';
before(async () => {
  srv = await boot({ listenAdmin: false });
  pid = projects.saveProject({ name: 'Skills', config: { variables: [] } }).id;
  setSecret('SKILL_KEY', 'k-123');
});
after(async () => { await srv.stop(); });

const rpc = (path: string, body: any, key?: string) => fetch(`${env.http}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(key ? { 'x-api-key': key } : {}) }, body: JSON.stringify(body),
});

test('MCP skills: a Sutra is a tool on an MCP server; Reply to AI returns the outcome', async () => {
  const pol = saveResource({ kind: 'inboundPolicy', name: 'Skill keys', project_id: pid, config: { auth: 'apiKey', apiKeyHeader: 'X-API-Key', apiKeySecrets: ['SKILL_KEY'], requireHttps: false, rateLimitPerMinute: 0 } });
  const server = saveResource({ kind: 'mcpServer', name: 'Order skills', project_id: pid, config: { path: '/mcp/orders', title: 'Order skills', instructions: 'Tools for orders.', policy: pol.id } });

  const t = node('mcpTool', 'Skill', { server: server.id, toolName: 'order_total', title: 'Order total', description: 'Adds up the order lines and returns the total. Use it when asked for an order amount.',
    inputs: [{ k: 'orderId', v: 'The order number' }, { k: 'lines', v: 'array: the order lines, each with qty and price' }, { k: 'note', v: 'optional: a remark' }], testArguments: '{"orderId":"A-1","lines":[]}' });
  const m = node('mapper', 'Total', { mapping: { rules: { orderId: { expr: '{input.arguments.orderId}' }, total: { expr: "sum({input.arguments.lines}, 'price')" } } } });
  const i = node('if', 'Has lines', { left: '=count({input.arguments.lines})', op: 'greater than', right: '0' });
  const ok = node('mcpReply', 'Reply', { source: 'value', result: '{{nodes.Total}}' });
  const no = node('mcpReply', 'No lines', { source: 'value', result: 'The order has no lines', isError: true });
  const f = flows.saveFlow(undefined, { name: 'Order total skill', nodes: [t, i, m, ok, no], edges: [edge(t, i), edge(i, m, 'true'), edge(m, ok), edge(i, no, 'false')] }, pid);
  assert.deepEqual(flows.validateDoc(flows.getFlow(f.id)!.doc).errors, []);
  flows.deploy(f.id);
  rebuildRoutes();

  // Handshake and discovery.
  let r = await rpc('/mcp/orders', { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
  let j: any = await r.json();
  assert.equal(j.result.protocolVersion, '2025-06-18');
  assert.equal(j.result.serverInfo.title, 'Order skills');
  assert.equal(j.result.instructions, 'Tools for orders.');
  assert.ok(r.headers.get('mcp-session-id'));
  assert.equal((await rpc('/mcp/orders', { jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);

  r = await rpc('/mcp/orders', { jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.equal(r.status, 401, 'no key, no tools');
  j = await (await rpc('/mcp/orders', { jsonrpc: '2.0', id: 2, method: 'tools/list' }, 'k-123')).json();
  assert.equal(j.result.tools.length, 1);
  const tool = j.result.tools[0];
  assert.equal(tool.name, 'order_total');
  assert.deepEqual(tool.inputSchema.required, ['orderId', 'lines']);
  assert.equal(tool.inputSchema.properties.lines.type, 'array');
  assert.equal(tool.annotations.readOnlyHint, true);

  // Calls.
  j = await (await rpc('/mcp/orders', { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'order_total', arguments: { orderId: 'A-9', lines: [{ qty: 1, price: 40 }, { qty: 2, price: 60 }] } } }, 'k-123')).json();
  assert.equal(j.result.isError, undefined, j.result.content[0].text);
  assert.deepEqual(j.result.structuredContent, { orderId: 'A-9', total: 100 });
  assert.match(j.result.content[0].text, /"total": 100/);
  j = await (await rpc('/mcp/orders', { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'order_total', arguments: { orderId: 'A-9', lines: [] } } }, 'k-123')).json();
  assert.equal(j.result.isError, true);
  assert.equal(j.result.content[0].text, 'The order has no lines');
  j = await (await rpc('/mcp/orders', { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'order_total', arguments: { lines: [] } } }, 'k-123')).json();
  assert.match(j.result.content[0].text, /Missing argument: orderId/);
  j = await (await rpc('/mcp/orders', [{ jsonrpc: '2.0', id: 6, method: 'ping' }, { jsonrpc: '2.0', id: 7, method: 'nope' }], 'k-123')).json();
  assert.deepEqual(j[0].result, {});
  assert.equal(j[1].error.code, -32601);

  // The default address lists tools without a server; this one is not there.
  j = await (await rpc('/mcp', { jsonrpc: '2.0', id: 8, method: 'tools/list' })).json();
  assert.deepEqual(j.result.tools, []);
  assert.equal((await fetch(`${env.http}/mcp/orders`)).status, 405);

  // A second Sutra may not take the same tool name on the same server.
  const dup = flows.saveFlow(undefined, { name: 'Dup', nodes: [{ ...t, id: 'x' }], edges: [] }, pid);
  assert.throws(() => flows.deploy(dup.id), /already used on this MCP server/);
});
