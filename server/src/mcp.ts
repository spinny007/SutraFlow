import type { FlowNode } from './engine/types.js';
import { schemaTree, type SNode } from './schemas.js';

/**
 * Sutras as AI tools over the Model Context Protocol. A deployed Sutra that starts with an
 * "MCP skill" trigger is listed by the gateway's /mcp endpoint; an AI assistant calls it
 * with arguments and receives what the Sutra's "Reply to AI" step sends back.
 */
export const MCP_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
export const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/** JSON Schema for a schema tree (shared JSON schema or XSD). */
export function jsonSchemaOf(n: SNode): any {
  const one = (x: SNode): any => {
    const base: any = x.children?.length
      ? { type: 'object', properties: Object.fromEntries(x.children.map(c => [c.attr ? `@_${c.name}` : c.name, jsonSchemaOf(c)])), ...(x.children.some(c => c.required) ? { required: x.children.filter(c => c.required).map(c => (c.attr ? `@_${c.name}` : c.name)) } : {}) }
      : x.type === 'integer' ? { type: 'integer' } : x.type === 'number' ? { type: 'number' } : x.type === 'boolean' ? { type: 'boolean' }
        : x.type === 'date' ? { type: 'string', format: 'date-time' } : x.type === 'any' ? {} : x.type === 'object' ? { type: 'object' } : { type: 'string' };
    if (x.enum?.length) base.enum = x.enum;
    if (x.doc) base.description = x.doc;
    return base;
  };
  return n.repeats ? { type: 'array', items: one({ ...n, repeats: false }) } : one(n);
}

/** Inputs written as rows "name" = "description" (optionally "number: description", "boolean: ..."). */
function schemaFromRows(rows: unknown): any {
  const props: Record<string, any> = {};
  const required: string[] = [];
  for (const r of (Array.isArray(rows) ? rows : []) as { k?: string; v?: string }[]) {
    const name = String(r?.k || '').trim();
    if (!name) continue;
    let desc = String(r?.v || '').trim();
    let type = 'string';
    const m = /^(string|number|integer|boolean|array|object)\s*[:-]\s*/i.exec(desc);
    if (m) { type = m[1].toLowerCase(); desc = desc.slice(m[0].length); }
    const optional = /^optional\b[:,]?\s*/i.test(desc);
    if (optional) desc = desc.replace(/^optional\b[:,]?\s*/i, '');
    props[name] = { type, ...(desc ? { description: desc } : {}) };
    if (!optional) required.push(name);
  }
  return { type: 'object', properties: props, ...(required.length ? { required } : {}) };
}

/** The MCP tool definition of an "MCP skill" trigger. */
export function toolDefinition(n: FlowNode) {
  const c = n.config || {};
  const tree = c.inputSchema ? schemaTree(c.inputSchema) : null;
  let inputSchema = tree ? jsonSchemaOf(tree) : schemaFromRows(c.inputs);
  if (inputSchema.type !== 'object') inputSchema = { type: 'object', properties: { value: inputSchema }, required: ['value'] };
  const out = c.outputSchema ? schemaTree(c.outputSchema) : null;
  let outputSchema = out ? jsonSchemaOf(out) : undefined;
  if (outputSchema && outputSchema.type !== 'object') outputSchema = undefined;
  return {
    name: String(c.toolName || ''),
    ...(c.title ? { title: String(c.title) } : {}),
    description: String(c.description || ''),
    inputSchema,
    ...(outputSchema ? { outputSchema } : {}),
    annotations: { ...(c.title ? { title: String(c.title) } : {}), readOnlyHint: !c.changesData, destructiveHint: !!c.changesData, openWorldHint: false },
  };
}

/** The tool result for an AI: text, plus structured content when the result is an object. */
export function toolResult(result: unknown, isError = false) {
  const text = typeof result === 'string' ? result : JSON.stringify(result ?? null, null, 2);
  return {
    content: [{ type: 'text', text }],
    ...(result && typeof result === 'object' && !Array.isArray(result) && !isError ? { structuredContent: result } : {}),
    ...(isError ? { isError: true } : {}),
  };
}
