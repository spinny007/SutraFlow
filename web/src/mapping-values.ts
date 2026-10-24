/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 2.0.8
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import type { SNode } from './types.js';

/** Runtime output fields must come from emitted data, not a possibly different design contract. */
export function observedShape(value: any, name = 'output', depth = 0): SNode {
  if (depth > 8) return { name, type: 'any' };
  if (Array.isArray(value)) {
    const objects = value.filter(x => x && typeof x === 'object' && !Array.isArray(x)).slice(0, 10);
    const base = objects.length ? observedShape(Object.assign({}, ...objects), name, depth + 1) : value.length ? observedShape(value[0], name, depth + 1) : { name, type: 'any' as const };
    return { ...base, repeats: true };
  }
  if (value && typeof value === 'object') return { name, type: 'object', children: Object.entries(value).map(([key, v]) => observedShape(v, key, depth + 1)) };
  return { name, type: typeof value === 'number' ? Number.isInteger(value) ? 'integer' : 'number' : typeof value === 'boolean' ? 'boolean' : value === null ? 'null' : value === undefined ? 'any' : 'string' };
}

export function repeatedValueSummary(value: unknown, leaf: boolean): string | null {
  return Array.isArray(value) ? `${value.length} item${value.length === 1 ? '' : 's'}${leaf ? ': ' + JSON.stringify(value) : ' (children preview the first item)'}` : null;
}
