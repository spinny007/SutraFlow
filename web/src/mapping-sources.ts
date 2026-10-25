/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 2.0.8
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import type { ActivityMeta, FlowDoc, FlowNode } from './types.js';

export function mappingSources(doc: FlowDoc, nodeId: string, activities: (Pick<ActivityMeta, 'type' | 'name'> & Partial<Pick<ActivityMeta, 'ports'>>)[]) {
  const label = (node: FlowNode) => `${node.name} (${activities.find(a => a.type === node.type)?.name || node.type})`;
  const walk = (direction: 'before' | 'after') => {
    const seen = new Set<string>([nodeId]);
    const pending = [nodeId];
    while (pending.length) {
      const id = pending.pop()!;
      for (const e of doc.edges) {
        const next = direction === 'before' ? e.to === id ? e.from : null : e.from === id ? e.to : null;
        if (next && !seen.has(next)) { seen.add(next); pending.push(next); }
      }
    }
    return seen;
  };
  const before = walk('before'), after = walk('after');
  const incoming = new Set(doc.edges.filter(e => e.to === nodeId).map(e => e.from));
  const direct = doc.nodes.filter(n => n.id !== nodeId && incoming.has(n.id));
  const ports = direct.length === 1 ? activities.find(a => a.type === direct[0].type)?.ports : undefined;
  // Do not collapse streaming/multi-port outputs: their named result can differ from this task's input.
  const alias = direct.length === 1 && Array.isArray(ports) && ports.filter(p => p !== 'error').length === 1 ? direct[0].id : undefined;
  return {
    // Multiple incoming connections do not identify which branch supplied this task's input.
    inputLabel: direct.length === 1 ? `${label(direct[0])} — current input` : direct.length ? `Current input — incoming activities: ${direct.map(label).join(', ')}` : 'Current input (starter / supplied data)',
    // A unique predecessor already appears as current input. Named-output formulas remain valid;
    // omit only its redundant browser entry, never distinct multi-input or parallel sources.
    sources: doc.nodes.filter(n => n.id !== nodeId && before.has(n.id) && n.id !== alias).map(n => ({ node: n, label: label(n) })).concat(
      doc.nodes.filter(n => !before.has(n.id) && !after.has(n.id)).map(n => ({ node: n, label: `${label(n)} — other branch; available only after completion` })),
    ),
  };
}
