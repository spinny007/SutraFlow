/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { engine } from './engine/engine.js';
import type { FlowDoc, FlowNode, SchemaHelpers } from './engine/types.js';
import { inferTree, schemaTree, type SNode } from './schemas.js';
import { adhocTree, unmappedRequired, type MappingValue } from './mapping.js';
import { parsePath } from './values.js';

/**
 * Design-time data shapes: what each step receives and produces before anything
 * has run. Drives the mapper's Process Data tree, the Activity Input trees of
 * mapping fields, and the Output tab ("field names when not running").
 */
export interface NodeDesign {
  in: SNode | null;
  out: SNode | null;
  /** Per-port shapes when they differ from out (For each: item). */
  ports?: Record<string, SNode>;
  /** Target trees of mapping fields, by field key. */
  inputTrees: Record<string, SNode>;
  warnings: string[];
}

const ANY = (name: string): SNode => ({ name, type: 'any' });

/** Shape at a simple reference such as {{input.items}} or ={nodes.Parse.rows}. */
export function shapeAt(expr: unknown, scope: { input: SNode | null; nodes: Record<string, SNode | null> }): SNode | null {
  const m = typeof expr === 'string' ? /^\s*(?:\{\{\s*([^{}|]+?)\s*\}\}|=\s*\{([^{}]+)\}\s*)\s*$/.exec(expr) : null;
  if (!m) return null;
  const parts = parsePath((m[1] || m[2]).trim());
  let cur: SNode | null | undefined;
  if (parts[0] === 'input') { cur = scope.input; parts.shift(); }
  else if (parts[0] === 'nodes' && parts.length > 1) { cur = scope.nodes[parts[1]]; parts.splice(0, 2); }
  else return null;
  for (const p of parts) {
    if (!cur) return null;
    if (/^-?\d+$/.test(p) && cur.repeats) { cur = { ...cur, repeats: false }; continue; }
    cur = cur.children?.find(c => c.name === p);
  }
  return cur ?? null;
}

export function designSchemas(doc: FlowDoc): Record<string, NodeDesign> {
  const out: Record<string, NodeDesign> = {};
  const byName: Record<string, SNode | null> = {};
  const done = new Set<string>();
  const preds = (id: string) => doc.edges.filter(e => e.to === id);
  // Repeatedly settle nodes whose predecessors are known (graphs with loops fall back to unknown input).
  const pending = new Set(doc.nodes.map(n => n.id));
  let guard = 0;
  while (pending.size && guard++ < doc.nodes.length + 5) {
    for (const n of doc.nodes) {
      if (!pending.has(n.id)) continue;
      const ps = preds(n.id);
      if (ps.some(e => !done.has(e.from)) && guard <= doc.nodes.length) continue;
      out[n.id] = designNode(doc, n, ps.map(e => ({ edge: e, from: doc.nodes.find(x => x.id === e.from)! })), out, byName);
      byName[n.name] = out[n.id].out;
      done.add(n.id);
      pending.delete(n.id);
    }
  }
  return out;
}

function portShape(d: NodeDesign | undefined, port: string, fromName: string): SNode | null {
  if (!d) return null;
  if (port === 'error') return { name: fromName, type: 'object', children: [{ name: 'error', type: 'object', children: [{ name: 'message', type: 'string' }, { name: 'step', type: 'string' }, { name: 'type', type: 'string' }, { name: 'at', type: 'date' }] }, { ...(d.in || ANY('input')), name: 'input' }] };
  return d.ports?.[port] ?? d.out;
}

function designNode(doc: FlowDoc, n: FlowNode, ins: { edge: { port: string }; from: FlowNode }[], all: Record<string, NodeDesign>, byName: Record<string, SNode | null>): NodeDesign {
  const act = engine.activity(n.type);
  const cfg = n.config || {};
  const warnings: string[] = [];
  let input: SNode | null = null;
  if (act?.join) input = { name: 'input', type: 'object', children: ins.map(i => ({ ...(portShape(all[i.from.id], i.edge.port, i.from.name) || ANY(i.from.name)), name: i.from.name })) };
  else if (ins.length) input = portShape(all[ins[0].from.id], ins[0].edge.port, ins[0].from.name);

  const inputTrees: Record<string, SNode> = {};
  const safeSchema = (ref: string | undefined) => {
    try { return schemaTree(ref); } catch (e: any) { warnings.push(e.message); return null; }
  };
  const h: SchemaHelpers = {
    schema: safeSchema,
    infer: (v, name) => inferTree(v, name),
    input,
    mappingTree: (c, field, schemaField) => safeSchema(c[schemaField]) || adhocTree(c[field] as MappingValue),
  };
  for (const f of act?.fields || []) {
    if (f.type !== 'mapping') continue;
    const tree = h.mappingTree(cfg, f.k, f.schemaField || '');
    inputTrees[f.k] = tree;
    const missing = unmappedRequired(tree, cfg[f.k]);
    if (missing.length) warnings.push(`Required field${missing.length > 1 ? 's' : ''} not mapped: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}`);
  }

  let outShape: SNode | null | undefined;
  let ports: Record<string, SNode> | undefined;
  try {
    if (n.type === 'forEach') {
      const list = shapeAt(cfg.list, { input, nodes: byName });
      const item: SNode = list ? { ...list, name: 'item', repeats: false } : ANY('item');
      if (item.type === 'object' || item.children) item.children = [...(item.children || []), { name: '_index', type: 'integer' }];
      outShape = { name: n.name, type: 'object', children: [{ ...(list || ANY('items')), name: 'items', repeats: true }, { name: 'count', type: 'integer' }] };
      ports = { item, done: outShape };
    } else if ((n.type === 'filter' || n.type === 'sort') && shapeAt(cfg.list, { input, nodes: byName })) {
      const list = shapeAt(cfg.list, { input, nodes: byName })!;
      outShape = { name: n.name, type: 'object', children: [{ ...list, name: 'items', repeats: true }, { name: 'count', type: 'integer' }] };
    } else if (act?.outputSchema) outShape = act.outputSchema(cfg, h);
    else if (act?.passThrough) outShape = input;
    else if (act?.outputHint !== undefined && act.outputHint !== null) outShape = inferTree(act.outputHint, n.name);
  } catch (e: any) {
    warnings.push(e.message);
  }
  if (act?.designCheck) { try { warnings.push(...act.designCheck(cfg)); } catch (e: any) { warnings.push(e.message); } }
  // Looping activities: for each item gives every result; repeat while gives the last one and the count.
  if (n.settings?.loop === 'for each item') outShape = { name: n.name, type: 'object', children: [{ ...(outShape || ANY('iterations')), name: 'iterations', repeats: true }, { name: 'count', type: 'integer' }] };
  else if (n.settings?.loop === 'repeat while' && outShape) outShape = { ...outShape, children: [...(outShape.children || []), { name: '_iterations', type: 'integer' }] };
  return { in: input, out: outShape ? { ...outShape, name: n.name } : outShape === null ? null : ANY(n.name), ports, inputTrees, warnings };
}
