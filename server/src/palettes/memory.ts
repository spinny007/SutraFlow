/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import type { Activity } from '../engine/types.js';
import { F } from './common.js';
import { resolve } from '../template.js';
import { truthy } from '../expr.js';
import { kvToObject } from '../resources.js';
import { memTable, memGet, memPut, memDelete, memQuery, memClear, reload, memStats } from '../memtables.js';

/**
 * Memory tables palette: get, put, delete and query rows of a memory table (see memtables.ts), and
 * reload it from its source.
 */
const table = F('table', 'Memory table', 'resource', '', { resourceKind: 'memoryTable' });
const tableOf = (c: { raw(k: string): any }) => {
  const id = String(c.raw('table') || '');
  if (!id) throw new Error('Memory table is not selected');
  return memTable(id);
};

export const memoryActivities: Activity[] = [
  {
    type: 'memGet', palette: 'memory', name: 'Memory get', glyph: '⚡', ports: ['found', 'missing'],
    desc: 'Reads one row of a memory table by its key, from memory. A row not in memory is fetched with the table\'s lookup query when it has one.',
    fields: [table, F('key', 'Key', 'text', '{{input.customerId}}', { tpl: true, help: 'For a key of several fields, the values joined with |, such as {{input.country}}|{{input.city}}.' }),
      F('readThrough', 'Fetch a missing row with the lookup query', 'bool', true)],
    outputHint: { found: true, key: '', row: {} },
    execute: async c => {
      const t = await tableOf(c);
      const key = String(c.v('key') ?? '');
      if (!key) throw new Error('Key is empty');
      const row = await memGet(t, key, c.raw('readThrough') !== false);
      return row === undefined ? { port: 'missing', out: { found: false, key, row: null } } : { port: 'found', out: { found: true, key, row } };
    },
  },
  {
    type: 'memPut', palette: 'memory', name: 'Memory put', glyph: '⚡', ports: ['out'],
    desc: 'Adds or replaces a row in a memory table. Several rows at once: map a list. In a table with a copy in the database, the change is saved there too and reaches the other engines.',
    fields: [table, F('row', 'Row (or list of rows)', 'text', '{{input}}', { tpl: true, help: 'An object with the key fields of the table, or a list of such objects.' }),
      F('key', 'Key', 'text', '', { tpl: true, help: 'Empty = from the key fields of the row.' }),
      F('ttlSeconds', 'Keep for (seconds)', 'number', 0, { help: '0 = the time to live of the table.' })],
    outputHint: { count: 1, keys: [''], added: 0, updated: 0 },
    execute: async c => {
      const t = await tableOf(c);
      const v = c.v('row');
      const rows = Array.isArray(v) ? v : [v];
      const key = String(c.v('key') ?? '');
      if (key && rows.length > 1) throw new Error('Key is for one row; leave it empty for a list (each row gives its own key)');
      const res = rows.map(r => memPut(t, r, key || undefined, Number(c.raw('ttlSeconds')) || undefined));
      return { out: { count: res.length, keys: res.map(r => r.key), added: res.filter(r => r.action === 'added').length, updated: res.filter(r => r.action === 'updated').length } };
    },
  },
  {
    type: 'memDelete', palette: 'memory', name: 'Memory delete', glyph: '⚡', ports: ['out'],
    desc: 'Removes a row from a memory table by its key, or every row.',
    fields: [table, F('what', 'Remove', 'select', 'one row', { options: ['one row', 'every row'] }),
      F('key', 'Key', 'text', '{{input.customerId}}', { tpl: true, showIf: { k: 'what', in: ['one row'] } })],
    outputHint: { deleted: true, key: '' },
    execute: async c => {
      const t = await tableOf(c);
      if (c.raw('what') === 'every row') { const n = t.rows.size; memClear(t); return { out: { deleted: n > 0, count: n } }; }
      const key = String(c.v('key') ?? '');
      return { out: { deleted: memDelete(t, key), key } };
    },
  },
  {
    type: 'memQuery', palette: 'memory', name: 'Memory query', glyph: '⚡', ports: ['out', 'empty'],
    desc: 'Finds rows of a memory table: fields equal to values, and an optional condition per row ({row.field}). Reads memory only.',
    fields: [table, F('match', 'Fields equal to', 'kv', [], { tpl: true, help: 'Field name and value, such as city = {{input.city}}.' }),
      F('condition', 'Condition', 'text', '', { help: 'Optional, per row: ={row.amount} > 100.' }),
      F('limit', 'Maximum rows', 'number', 1000)],
    outputHint: { rows: [{}], count: 0 },
    execute: async c => {
      const t = await tableOf(c);
      const match = kvToObject(c.raw('match'), v => c.resolve(v) as any);
      // As written (raw() would work out a formula once, for the step, not per row).
      const cond = String(c.node.config?.condition ?? '').trim();
      const rows = memQuery(t, match, cond ? row => truthy(resolve(cond, { row, input: c.input })) : undefined, Number(c.raw('limit')) || 1000);
      return { port: rows.length ? 'out' : 'empty', out: { rows, count: rows.length } };
    },
  },
  {
    type: 'memReload', palette: 'memory', name: 'Memory reload', glyph: '⚡', ports: ['out'],
    desc: 'Loads a memory table again from its load query (for example after the source changed), and gives its figures.',
    fields: [table],
    outputHint: { rows: 0, bytes: 0, hits: 0, misses: 0, loadedAt: '' },
    execute: async c => {
      const t = await tableOf(c);
      await reload(t);
      return { out: memStats(t) };
    },
  },
];
