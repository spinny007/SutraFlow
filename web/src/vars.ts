/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import type { FlowNode, Project, Resource } from './types';

/**
 * Project variables a value reads: {gv.X}, {{gv.X}}, $gv.X (JSONata) and get-project-variable('X').
 * The server has the same rule in flows.ts (variablesUsed).
 */
export function variablesUsed(v: unknown): string[] {
  const text = JSON.stringify(v ?? '');
  const out = new Set<string>();
  for (const m of text.matchAll(/\bgv\.([A-Za-z_]\w*)/g)) out.add(m[1]);
  for (const m of text.matchAll(/get-project-variable\(\s*\\?['"]([A-Za-z_]\w*)/g)) out.add(m[1]);
  return [...out];
}

const defined = (project: Project | null | undefined) => new Set((project?.config.variables || []).map(v => v.name));

/** Variables a connection reads that the project does not define. */
export function missingInResource(r: Resource, project: Project | null | undefined) {
  const d = defined(project);
  return variablesUsed(r.config).filter(x => !d.has(x));
}

/** Variables a step reads, itself or through the connections it uses, that the project does not define. */
export function missingInNode(n: FlowNode, project: Project | null | undefined, resources: Resource[]) {
  const d = defined(project);
  const own = variablesUsed(n.config).filter(x => !d.has(x)).map(name => ({ name, via: '' }));
  const text = JSON.stringify(n.config);
  const viaRes = resources.filter(r => text.includes(r.id)).flatMap(r => missingInResource(r, project).map(name => ({ name, via: r.name })));
  return [...own, ...viaRes];
}

export const missingText = (m: { name: string; via: string }[]) =>
  m.map(x => `Project variable ${x.name} is not defined in this project${x.via ? ` (used by the connection ${x.via})` : ''}.`).join('\n');
