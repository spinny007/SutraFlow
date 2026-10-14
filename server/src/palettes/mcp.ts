import type { Activity } from '../engine/types.js';
import { F, when, parseJsonText } from './common.js';
import { toolDefinition } from '../mcp.js';

const safeJson = (t: unknown): any => { if (typeof t !== 'string') return t; try { return JSON.parse(t); } catch { return undefined; } };

/**
 * A Sutra as a skill for AI assistants: the trigger describes the tool (what it does, when to use it,
 * what it needs), and Reply to AI sends the outcome back. Served by the gateway at /mcp.
 */
export const mcpActivities: Activity[] = [
  {
    type: 'mcpTool', palette: 'triggers', name: 'MCP skill', glyph: '✧', trigger: true, ports: ['out'],
    desc: 'Makes the Sutra a tool (skill) that AI assistants such as Claude can call over the Model Context Protocol, at the gateway address /mcp. Describe what it does and what it needs; end the Sutra with Reply to AI.',
    fields: [
      F('server', 'MCP server', 'resource', '', { resourceKind: 'mcpServer', help: 'The set of skills this tool belongs to (Resources > MCP server). Empty = the gateway\'s default address /mcp.' }),
      F('toolName', 'Tool name', 'text', 'check_order_status', { help: 'Letters, digits, _ and -. The AI sees and calls it by this name; unique on this server.' }),
      F('title', 'Title', 'text', 'Check order status'),
      F('description', 'What it does (for the AI)', 'textarea', 'Looks up an order by its number and returns its status, delivery date and amount. Use it when the user asks where an order is or when it will arrive.', { help: 'The skill as the AI reads it: what the tool does, when to use it, what it returns. A clear description is what makes the AI choose it correctly.' }),
      F('inputs', 'Inputs', 'kv', [{ k: 'orderId', v: 'The order number, e.g. A-1001' }], { help: 'One row per input: name and description. Start the description with number:, integer:, boolean:, array: or object: for other types, and with optional: when it may be left out.' }),
      F('inputSchema', 'Input schema (instead of the rows)', 'schema', '', { schemaKinds: ['json'], help: 'Optional. A shared JSON schema for richer inputs.' }),
      F('outputSchema', 'Result schema', 'schema', '', { schemaKinds: ['json'], help: 'Optional. Tells the AI the shape of the result.' }),
      F('changesData', 'Changes data (not read-only)', 'bool', false, { help: 'Tick when the tool creates, changes or deletes something; assistants then ask the user before calling it.' }),
      F('policy', 'API security policy', 'resource', '', { resourceKind: 'inboundPolicy', help: 'Who may call it: an API key, bearer token (JWT) or Basic, sent by the AI assistant as a header. Empty = the MCP server\'s policy; with neither, anyone who reaches the gateway.' }),
      F('testArguments', 'Test arguments (JSON)', 'code', '{\n  "orderId": "A-1001"\n}'),
    ],
    outputSchema: (cfg, h) => ({ name: 'out', type: 'object', children: [{ ...h.infer(safeJson(cfg.testArguments) ?? {}, 'arguments') }, { name: 'tool', type: 'string' }, h.infer({ subject: '', method: '' }, 'auth'), h.infer({ ip: '', secure: true, name: '', version: '' }, 'client')] }),
    execute: c => {
      const given = c.input && typeof c.input === 'object' && 'arguments' in c.input ? c.input : null;
      if (given) return { out: given };
      return { out: { arguments: parseJsonText(c.raw('testArguments'), 'Test arguments') ?? {}, tool: toolDefinition(c.node).name, auth: { subject: 'test', method: 'none' }, client: { ip: '127.0.0.1', secure: false, name: 'studio test', version: '' } } };
    },
  },
  {
    type: 'mcpReply', palette: 'triggers', name: 'Reply to AI', glyph: '↵', ports: ['out'],
    desc: 'Sends the outcome back to the AI assistant that called this Sutra through an MCP skill trigger. Use one on every branch, including error branches (tick "Is an error" there).',
    fields: [
      F('source', 'Result from', 'select', 'value', { options: ['value', 'mapping'] }),
      F('result', 'Result', 'text', '{{input}}', { tpl: true, help: 'Text, or data (sent as JSON and as structured content).', ...when('source', 'value') }),
      F('schema', 'Result schema', 'schema', '', { schemaKinds: ['json'], ...when('source', 'mapping') }),
      F('mapping', 'Result', 'mapping', { rules: {} }, { schemaField: 'schema', ...when('source', 'mapping') }),
      F('isError', 'Is an error', 'bool', false, { help: 'Tells the AI the tool did not succeed, so it can explain or try something else.' }),
    ],
    outputHint: { result: null, isError: false },
    execute: c => {
      const result = c.raw('source') === 'mapping' ? c.mapping('mapping') : c.v('result');
      const isError = !!c.raw('isError');
      c.reply({ status: 200, body: { result, isError }, contentType: 'application/json' });
      return { out: { result, isError } };
    },
  },
];
