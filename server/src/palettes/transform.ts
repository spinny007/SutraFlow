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
import { F } from './common.js';

const require = createRequire(import.meta.url);
const jsonata = require('jsonata');

/**
 * JSONata transform: the JSON query and transformation language used by
 * Node-RED, AWS Step Functions and IBM App Connect. Good for reshaping repeating
 * data in one expression (filter, group, aggregate, rename, nest).
 */
const compiled = new Map<string, any>();

export const transformActivities: Activity[] = [
  {
    type: 'jsonata', palette: 'data', name: 'Transform (JSONata)', glyph: 'J', ports: ['out'],
    desc: 'Reshapes JSON with a JSONata expression: filter rows, group, sum, rename, nest. $gv, $vars, $nodes and $trigger hold project variables, Sutra variables, earlier activities and the trigger.',
    fields: [
      F('source', 'Data', 'text', '{{input}}', { tpl: true, help: 'What the expression works on (its "$").' }),
      F('expression', 'Expression', 'code', `{
  "country": "INDIA",
  "orders": rows[$uppercase(Country) = "INDIA"].{
    "id": OrderId,
    "total": $round(Qty * Price, 2)
  },
  "byCity": rows{ City: $sum($.(Qty * Price)) },
  "count": $count(rows[$uppercase(Country) = "INDIA"])
}`, { help: 'JSONata syntax: path.to.field, list[condition], {key: value}, $sum(), $count(), $map(), $string(). See docs.jsonata.org.' }),
    ],
    outputHint: {},
    execute: async c => {
      const src = String(c.raw('expression') || '');
      let expr = compiled.get(src);
      if (!expr) {
        try { expr = jsonata(src); } catch (e: any) { throw new Error(`JSONata syntax error at ${e.position ?? '?'}: ${e.message}`); }
        if (compiled.size > 500) compiled.clear();
        compiled.set(src, expr);
      }
      const bindings = { gv: c.scope.gv, vars: c.scope.vars, nodes: c.scope.nodes, trigger: c.scope.trigger, run: c.scope.run };
      try {
        const out = await expr.evaluate(c.v('source'), bindings);
        return { out: out === undefined ? null : JSON.parse(JSON.stringify(out)) };
      } catch (e: any) {
        throw new Error(`JSONata: ${e.message}${e.token ? ` (near "${e.token}")` : ''}`);
      }
    },
  },
];
