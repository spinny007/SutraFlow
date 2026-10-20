/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Activity, SchemaHelpers } from '../engine/types.js';
import type { SNode } from '../schemas.js';
import { F, when, writeFields, writeMode, appended } from './common.js';
import { readFields, writeFormatFields, parseContent, contentShape, buildContent, streamRows, STREAM_FORMATS, columnsOf } from './fileformat.js';

/**
 * File palette. Each activity names a folder (project variables allowed:
 * {{gv.INBOX}}); mapped file names are confined to it, so a mapping can never
 * reach outside the folder.
 */
export function safePath(base: string, rel: string) {
  if (!base) throw new Error('Pick a folder for this activity');
  const root = path.resolve(base);
  const full = path.resolve(root, rel || '.');
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error(`Path "${rel}" is outside the folder ${root}`);
  return full;
}

/** "C:\in\*.csv" or "C:/in" (+ separate pattern) → folder and pattern. */
export function splitLocation(location: string, pattern?: string) {
  const loc = String(location || '').trim();
  const last = loc.split(/[\\/]/).pop() || '';
  if (/[*?]/.test(last)) return { folder: loc.slice(0, loc.length - last.length).replace(/[\\/]+$/, '') || '.', pattern: last };
  return { folder: loc, pattern: pattern || '*' };
}

const folderOf = (c: { raw(k: string): any }) => String(c.raw('folder') || '').trim();
const schemaOf = (c: { schemaTree(k: string): SNode | null }) => { try { return c.schemaTree('schema'); } catch { return null; } };
/** Older steps stored readContent 'text' / 'base64' / 'no'. */
const legacyRead = (cfg: Record<string, any>) => (cfg.format ? cfg : { ...cfg, format: cfg.readContent === 'base64' ? 'base64 (binary)' : cfg.readContent === 'no' ? 'do not read' : cfg.readContent === 'text' ? 'text' : cfg.format });

const fileInfo = (full: string, st: fs.Stats, root?: string) => ({
  name: path.basename(full), path: full, relativePath: root ? path.relative(root, full).split(path.sep).join('/') : path.basename(full),
  folder: path.dirname(full), extension: path.extname(full).slice(1), size: st.size, modifiedAt: st.mtime.toISOString(),
});
const infoShape: SNode[] = ['name', 'path', 'relativePath', 'folder', 'extension', 'modifiedAt'].map(n => ({ name: n, type: n === 'modifiedAt' ? 'date' : 'string' } as SNode)).concat([{ name: 'size', type: 'integer' }]);
const shapeWith = (h: SchemaHelpers, cfg: Record<string, any>, extra: SNode[] = []): SNode => ({ name: 'out', type: 'object', children: [...extra, ...infoShape, ...contentShape(legacyRead(cfg), h.schema(cfg.schema))] });

/** Streaming: big CSV and line files are read in batches of rows, each sent on the batch port. */
export const streamFields = () => [
  F('stream', 'Stream in batches', 'bool', false, { help: 'For big files: reads the file piece by piece and sends its rows in batches on the batch port while reading goes on, so only one batch is in memory. out gives the totals when the whole file is read. CSV rows and lines only; the size limit does not apply.', showIf: { k: 'format', in: STREAM_FORMATS } }),
  F('batchSize', 'Rows per batch', 'number', 1000, { help: 'Larger batches mean fewer steps per file; smaller ones less memory per step.', showIf: { k: 'stream', in: [true] } }),
];
export const streaming = (cfg: Record<string, any>) => !!cfg.stream && STREAM_FORMATS.includes(cfg.format);
/** What the batch port gives: the rows of one batch, its number, and the file. */
export const batchShape = (h: SchemaHelpers, cfg: Record<string, any>): SNode => {
  const cols = columnsOf(h.schema(cfg.schema));
  const rowKids: SNode[] = cfg.format === 'lines' ? [{ name: 'number', type: 'integer' }, { name: 'line', type: 'string' }] : cols ? cols.map(c => ({ name: c.name, type: c.type })) : [{ name: '(columns)', type: 'any' }];
  return { name: 'out', type: 'object', children: [{ name: 'rows', type: 'object', repeats: true, children: rowKids }, { name: 'batch', type: 'integer' }, { name: 'count', type: 'integer' }, { name: 'file', type: 'object', children: infoShape }] };
};
const totalsShape: SNode[] = [{ name: 'count', type: 'integer' }, { name: 'batches', type: 'integer' }, { name: 'streamed', type: 'boolean' }];

export const fileActivities: Activity[] = [
  {
    type: 'fileTrigger', palette: 'files', name: 'File trigger', glyph: '🗀', trigger: true, ports: ['added', 'modified', 'removed'],
    desc: 'Starts the Sutra when a file in a folder is added, modified or removed (polling while the Sutra is deployed). Can read the file as text or as structured rows.',
    fields: [
      F('folder', 'Folder', 'text', 'C:/sutra/inbox', { help: 'Absolute path; may use {{gv.INBOX}}.' }),
      F('pattern', 'File name pattern', 'text', '*.csv', { help: 'Wildcards * and ?; several separated by commas.' }),
      F('events', 'Events', 'list', ['added', 'modified', 'removed']),
      F('recursive', 'Include sub-folders', 'bool', false),
      F('pollSeconds', 'Check every (seconds)', 'number', 10),
      F('stableSeconds', 'Wait until unchanged for (seconds)', 'number', 2, { help: 'Avoids reading files that are still being written.' }),
      ...readFields({ allowNone: true }),
      F('testEvent', 'Test event (JSON)', 'code', '{\n  "event": "added",\n  "path": "C:/sutra/inbox/orders.csv",\n  "name": "orders.csv",\n  "size": 120,\n  "rows": [{ "id": 1, "amount": 100 }]\n}'),
    ],
    outputSchema: (cfg, h) => shapeWith(h, cfg, [{ name: 'event', type: 'string', enum: ['added', 'modified', 'removed'] }]),
    execute: c => {
      const e = c.input ?? JSON.parse(c.raw('testEvent') || '{}');
      return { port: ['added', 'modified', 'removed'].includes(e.event) ? e.event : 'added', out: e };
    },
  },
  {
    type: 'fileRead', palette: 'files', name: 'Read file', glyph: '⎘', ports: cfg => (streaming(cfg) ? ['batch', 'out'] : ['out']),
    desc: 'Reads a file as text, as CSV rows or lines (a repeating list to map), as JSON or XML data, or as base64 bytes. Big CSV and line files can be streamed in batches.',
    fields: [
      F('folder', 'Folder', 'text', 'C:/sutra/inbox', { help: 'May use {{gv.INBOX}}.' }),
      F('path', 'File (relative to the folder)', 'text', '{{input.name}}', { tpl: true }),
      ...readFields(),
      ...streamFields(),
      F('maxMb', 'Maximum size (MB)', 'number', 50, { help: 'Files read whole are held in memory. For bigger CSV or line files, stream them in batches.' }),
    ],
    // Streaming: batch gives rows, batch and file; out gives the file and the totals.
    outputSchema: (cfg, h) => (streaming(cfg) ? { name: 'out', type: 'object', children: [...batchShape(h, cfg).children!, ...infoShape, { name: 'batches', type: 'integer' }, { name: 'streamed', type: 'boolean' }] } : shapeWith(h, cfg)),
    execute: async c => {
      const full = safePath(folderOf(c), String(c.v('path') ?? ''));
      const st = await fsp.stat(full);
      const cfg = legacyRead({ format: c.raw('format'), encoding: c.raw('encoding'), delimiter: c.raw('delimiter'), header: c.raw('header'), skipRows: c.raw('skipRows'), trimValues: c.raw('trimValues'), decimal: c.raw('decimal'), readContent: c.raw('readContent') });
      if (cfg.encoding === 'utf8') cfg.encoding = 'utf-8';
      if (cfg.encoding === 'base64') cfg.format = 'base64 (binary)';
      const info = fileInfo(full, st);
      if (streaming({ ...cfg, stream: c.raw('stream') })) {
        const r = await streamRows(full, cfg, schemaOf(c), Number(c.raw('batchSize')) || 1000, (rows, batch) => c.emit('batch', { rows, batch, count: rows.length, file: info }), c.signal);
        return { port: 'out', out: { ...info, ...r, streamed: true } };
      }
      const max = (Number(c.raw('maxMb')) || 50) * 1024 * 1024;
      if (st.size > max) throw new Error(`${path.basename(full)} is larger than ${Math.round(max / 1048576)} MB. Stream it in batches (CSV rows or lines), or raise the maximum size.`);
      return { out: { ...info, ...parseContent(await fsp.readFile(full), cfg, schemaOf(c)) } };
    },
  },
  {
    type: 'fileList', palette: 'files', name: 'List / read directory', glyph: '☷', ports: cfg => (streaming(cfg) ? ['batch', 'out', 'empty'] : ['out', 'empty']),
    desc: 'Lists files matching a location such as C:\\in\\*.csv (or a folder plus pattern), optionally reading each one. Gives a repeating list of files; no match goes to empty.',
    fields: [
      F('location', 'Location', 'text', 'C:/sutra/inbox/*.csv', { help: "Folder with an optional wildcard, e.g. =concat({gv.INBOX}, '\\*.csv')." }),
      F('pattern', 'Pattern (when the location is a folder)', 'text', '*'),
      F('recursive', 'Include sub-folders', 'bool', false),
      F('sort', 'Order', 'select', 'name', { options: ['name', 'oldest first', 'newest first', 'largest first'] }),
      F('max', 'Maximum files', 'number', 1000),
      ...readFields({ allowNone: true }),
      ...streamFields(),
    ],
    outputSchema: (cfg, h) => streaming(cfg) ? { name: 'out', type: 'object', children: [...batchShape(h, cfg).children!, { name: 'files', type: 'object', repeats: true, children: [...infoShape, ...totalsShape] }, { name: 'folder', type: 'string' }] } : ({ name: 'out', type: 'object', children: [{ name: 'files', type: 'object', repeats: true, children: [...infoShape, ...contentShape(legacyRead(cfg), h.schema(cfg.schema))] }, { name: 'count', type: 'integer' }, { name: 'folder', type: 'string' }] }),
    execute: async c => {
      const loc = c.raw('location') || (c.raw('folder') ? path.join(c.raw('folder'), c.raw('pattern') || '*') : '');
      const { folder, pattern } = splitLocation(loc, c.raw('pattern'));
      const root = safePath(folder, '.');
      let files = await listFiles(root, pattern, !!c.raw('recursive'));
      const order = c.raw('sort') || 'name';
      files.sort((a, b) => order === 'oldest first' ? a.modifiedAt.localeCompare(b.modifiedAt) : order === 'newest first' ? b.modifiedAt.localeCompare(a.modifiedAt) : order === 'largest first' ? b.size - a.size : a.name.localeCompare(b.name));
      files = files.slice(0, Number(c.raw('max')) || 1000);
      const cfg = { format: c.raw('format') || 'do not read', encoding: c.raw('encoding'), delimiter: c.raw('delimiter'), header: c.raw('header'), skipRows: c.raw('skipRows'), trimValues: c.raw('trimValues'), decimal: c.raw('decimal') };
      const schema = schemaOf(c);
      const out = [];
      const stream = streaming({ ...cfg, stream: c.raw('stream') });
      for (const f of files) {
        const st = await fsp.stat(f.path);
        if (stream) {
          const info = fileInfo(f.path, st, root);
          const r = await streamRows(f.path, cfg, schema, Number(c.raw('batchSize')) || 1000, (rows, batch) => c.emit('batch', { rows, batch, count: rows.length, file: info }), c.signal);
          out.push({ ...info, ...r, streamed: true });
          continue;
        }
        out.push({ ...fileInfo(f.path, st, root), ...(cfg.format === 'do not read' ? {} : parseContent(await fsp.readFile(f.path), cfg, schema)) });
      }
      return { port: out.length ? 'out' : 'empty', out: { files: out, count: out.length, folder: root } };
    },
  },
  {
    type: 'fileWrite', palette: 'files', name: 'Write file', glyph: '⎙', ports: ['out'],
    desc: 'Writes text, CSV built from rows, lines, JSON or XML in the chosen encoding; appends or overwrites; creates folders as needed.',
    fields: [
      F('folder', 'Folder', 'text', 'C:/sutra/outbox', { help: 'May use {{gv.OUTBOX}}.' }),
      F('path', 'File (relative to the folder)', 'text', "=concat('report-', current-timestamp('YYYYMMDD'), '.csv')", { tpl: true }),
      ...writeFormatFields(),
      ...writeFields(),
    ],
    // Always the written file's details, whatever the format or schema.
    outputSchema: () => ({ name: 'out', type: 'object', children: [...infoShape, { name: 'action', type: 'string', enum: ['created', 'overwritten', 'appended'] }, { name: 'format', type: 'string' }, { name: 'encoding', type: 'string' }, { name: 'bytesWritten', type: 'integer' }, { name: 'rowsWritten', type: 'integer' }] }),
    execute: async c => {
      const root = folderOf(c);
      const full = safePath(root, String(c.v('path') ?? ''));
      // Older steps: encoding 'base64' meant binary content, 'utf8' meant text.
      const legacy = c.raw('encoding');
      const cc = legacy === 'base64' && !c.raw('format') ? { raw: (k: string) => (k === 'format' ? 'base64 (binary)' : c.raw(k)), v: c.v } : legacy === 'utf8' ? { raw: (k: string) => (k === 'encoding' ? 'utf-8' : c.raw(k)), v: c.v } : c;
      const data = buildContent(cc, schemaOf(c));
      await fsp.mkdir(path.dirname(full), { recursive: true });
      const mode = writeMode(c.raw);
      const exists = fs.existsSync(full);
      if (mode === 'fail' && exists) throw new Error(`${full} already exists (Overwrite and Append are off)`);
      if (mode === 'append' && exists) await fsp.writeFile(full, appended(await fsp.readFile(full), data, c.raw('newline') !== false));
      else await fsp.writeFile(full, data);
      const fmt = cc.raw('format') || 'text';
      const rows = /rows/.test(fmt) ? c.v('rows') : undefined;
      return { out: {
        ...fileInfo(full, await fsp.stat(full), root),
        action: !exists ? 'created' : mode === 'append' ? 'appended' : 'overwritten',
        format: fmt, encoding: fmt === 'base64 (binary)' ? 'binary' : cc.raw('encoding') || 'utf-8',
        bytesWritten: data.length, rowsWritten: Array.isArray(rows) ? rows.length : 0,
      } };
    },
  },
  {
    type: 'fileMove', palette: 'files', name: 'Move / copy / delete file', glyph: '⇢', ports: ['out'],
    desc: 'Moves, copies or deletes a file inside the folder.',
    fields: [
      F('folder', 'Folder', 'text', 'C:/sutra/inbox', { help: 'May use {{gv.INBOX}}.' }),
      F('action', 'Action', 'select', 'move', { options: ['move', 'copy', 'delete'] }),
      F('from', 'File', 'text', '{{input.name}}', { tpl: true }),
      F('to', 'To', 'text', "=concat('done/', {input.name})", { tpl: true, ...when('action', 'move', 'copy') }),
      F('overwrite', 'Overwrite the target if it exists', 'bool', true, when('action', 'move', 'copy')),
    ],
    // Always the file's details; for delete, the details from before it was removed.
    outputSchema: () => ({ name: 'out', type: 'object', children: [...infoShape, { name: 'action', type: 'string', enum: ['moved', 'copied', 'deleted'] }, { name: 'from', type: 'string' }, { name: 'to', type: 'string' }] }),
    execute: async c => {
      const base = folderOf(c);
      const from = safePath(base, String(c.v('from') ?? ''));
      if (c.raw('action') === 'delete') { const info = fileInfo(from, await fsp.stat(from), base); await fsp.rm(from); return { out: { ...info, action: 'deleted', from, to: '', deleted: true } }; }
      const to = safePath(base, String(c.v('to') ?? ''));
      if (c.raw('overwrite') === false && fs.existsSync(to)) throw new Error(`${to} already exists`);
      await fsp.mkdir(path.dirname(to), { recursive: true });
      if (c.raw('action') === 'copy') await fsp.copyFile(from, to); else await fsp.rename(from, to);
      return { out: { ...fileInfo(to, await fsp.stat(to), base), action: c.raw('action') === 'copy' ? 'copied' : 'moved', from, to } };
    },
  },
];

export function wildcard(pattern: string) {
  const parts = pattern.split(',').map(p => p.trim()).filter(Boolean);
  const res = (parts.length ? parts : ['*']).map(p => new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i'));
  return (name: string) => res.some(r => r.test(name));
}

export async function listFiles(dir: string, pattern: string, recursive: boolean) {
  const match = wildcard(pattern);
  const out: { name: string; path: string; size: number; modifiedAt: string }[] = [];
  const walk = async (d: string, depth: number) => {
    for (const e of await fsp.readdir(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) { if (recursive && depth < 10) await walk(full, depth + 1); continue; }
      if (!e.isFile() || !match(e.name)) continue;
      const st = await fsp.stat(full);
      out.push({ name: path.relative(dir, full).split(path.sep).join('/'), path: full, size: st.size, modifiedAt: st.mtime.toISOString() });
    }
  };
  await walk(dir, 0);
  return out;
}
