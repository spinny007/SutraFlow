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
import { registerListener } from '../listeners.js';
import { apiCall } from './oauth.js';
import { httpCall } from '../security/outbound.js';
import { F, when } from '../palettes/common.js';
import { documentText } from '../ai/documents.js';

/**
 * SharePoint document libraries and OneDrive through Microsoft Graph, with a Microsoft OAuth
 * connection (scopes Files.Read.All or Files.ReadWrite.All, Sites.Read.All, offline_access):
 * list, read (as file or as document text), search and upload, and a trigger for added, changed
 * and removed files. Built to feed knowledge bases, so read can return the text directly.
 */
const GRAPH = 'https://graph.microsoft.com/v1.0';
const conn = () => F('connection', 'Microsoft account (OAuth connection)', 'resource', '', { resourceKind: 'oauthApp', help: 'Provider microsoft; scopes Files.Read.All Sites.Read.All offline_access (Files.ReadWrite.All to upload).' });
const placeFields = () => [
  F('location', 'Where', 'select', 'SharePoint site', { options: ['SharePoint site', 'OneDrive'] }),
  F('site', 'Site address', 'text', 'https://contoso.sharepoint.com/sites/Policies', { ...when('location', 'SharePoint site'), tpl: true }),
  F('library', 'Document library', 'text', '', { ...when('location', 'SharePoint site'), help: 'Empty = the default library (Documents / Shared Documents).' }),
];
type Call = (o: Parameters<typeof apiCall>[1]) => ReturnType<typeof apiCall>;
const callerFor = (connection: string, signal?: AbortSignal): Call => o => apiCall(connection, { ...o, signal });
const enc = (p: string) => p.split('/').filter(Boolean).map(encodeURIComponent).join('/');

/** The drive (document library or OneDrive) the settings point at. */
async function driveOf(call: Call, cfg: { location?: string; site?: string; library?: string }) {
  if (cfg.location === 'OneDrive') return { drive: `${GRAPH}/me/drive`, label: 'OneDrive' };
  const u = new URL(/^https?:\/\//i.test(String(cfg.site || '')) ? String(cfg.site) : `https://${cfg.site}`);
  const site = (await call({ method: 'GET', url: `${GRAPH}/sites/${u.hostname}:${u.pathname.replace(/\/+$/, '') || '/'}` })).body;
  if (!cfg.library) return { drive: `${GRAPH}/sites/${site.id}/drive`, label: site.displayName || u.pathname };
  const drives = (await call({ method: 'GET', url: `${GRAPH}/sites/${site.id}/drives` })).body.value || [];
  const d = drives.find((x: any) => String(x.name).toLowerCase() === String(cfg.library).toLowerCase());
  if (!d) throw new Error(`No library "${cfg.library}" in ${site.displayName || u.pathname}. Libraries: ${drives.map((x: any) => x.name).join(', ')}`);
  return { drive: `${GRAPH}/drives/${d.id}`, label: `${site.displayName || u.pathname} / ${d.name}` };
}
const item = (x: any, folder = '') => ({
  id: x.id, name: x.name, path: [folder, x.name].filter(Boolean).join('/'), folder: !!x.folder, size: x.size ?? 0, mimeType: x.file?.mimeType || '',
  modifiedAt: x.lastModifiedDateTime, modifiedBy: x.lastModifiedBy?.user?.displayName || '', webUrl: x.webUrl, driveId: x.parentReference?.driveId || '',
});
async function children(call: Call, drive: string, folder: string) {
  const out: any[] = [];
  let url = folder ? `${drive}/root:/${enc(folder)}:/children` : `${drive}/root/children`;
  for (let page = 0; url && page < 50; page++) {
    const b = (await call({ method: 'GET', url, query: page ? undefined : { $top: '200' } })).body;
    out.push(...(b.value || []));
    url = b['@odata.nextLink'];
  }
  return out;
}
async function listFolder(call: Call, drive: string, folder: string, recursive: boolean, pattern: RegExp | null, depth = 0): Promise<ReturnType<typeof item>[]> {
  const out: ReturnType<typeof item>[] = [];
  for (const x of await children(call, drive, folder)) {
    if (x.folder) { if (recursive && depth < 5) out.push(...await listFolder(call, drive, [folder, x.name].filter(Boolean).join('/'), true, pattern, depth + 1)); continue; }
    if (!pattern || pattern.test(x.name)) out.push(item(x, folder));
  }
  return out;
}
const wildcard = (p: string) => (p && p !== '*' ? new RegExp('^' + p.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i') : null);

/** Downloads a file: its metadata gives a short-lived download address, fetched without the token. */
async function download(call: Call, drive: string, path: string, signal?: AbortSignal) {
  const meta = (await call({ method: 'GET', url: `${drive}/root:/${enc(path)}` })).body;
  if (meta.folder) throw new Error(`${path} is a folder`);
  const dl = meta['@microsoft.graph.downloadUrl'];
  const res = dl ? await httpCall({ method: 'GET', url: dl, headers: {}, timeoutMs: 300000, signal, parse: 'buffer' }) : await call({ method: 'GET', url: `${drive}/root:/${enc(path)}:/content`, parse: 'buffer' });
  if (res.status >= 400) throw new Error(`Downloading ${path} failed (${res.status})`);
  return { meta, data: res.buffer! };
}

export const microsoftActivities: Activity[] = [
  {
    type: 'msFiles', palette: 'apps', name: 'SharePoint / OneDrive', glyph: '▤', ports: ['out', 'empty'], timeoutMs: 600000,
    desc: 'Lists, reads, searches or uploads files in a SharePoint document library or OneDrive. Read can return the document text (PDF, Word, PowerPoint, Excel) ready for Add to knowledge.',
    fields: [
      conn(), ...placeFields(),
      F('op', 'Operation', 'select', 'list', { options: ['list', 'read', 'search', 'upload'] }),
      F('folder', 'Folder', 'text', '', { tpl: true, ...when('op', 'list'), help: 'Path inside the library, for example Policies/HR. Empty = the top.' }),
      F('pattern', 'File name pattern', 'text', '*', when('op', 'list')),
      F('recursive', 'Include sub-folders', 'bool', false, when('op', 'list')),
      F('path', 'File', 'text', '{{input.path}}', { tpl: true, ...when('op', 'read', 'upload'), help: 'Path inside the library, for example Policies/Returns.docx' }),
      F('readAs', 'Read as', 'select', 'document text', { options: ['document text', 'file (base64)'], ...when('op', 'read') }),
      F('query', 'Search for', 'text', '{{input.question}}', { tpl: true, ...when('op', 'search') }),
      F('content', 'Content', 'text', '{{input.text}}', { tpl: true, ...when('op', 'upload') }),
      F('encoding', 'Content is', 'select', 'text', { options: ['text', 'base64'], ...when('op', 'upload') }),
    ],
    outputHint: { items: [{ id: '', name: '', path: '', size: 0, mimeType: '', modifiedAt: '', modifiedBy: '', webUrl: '' }], count: 0, text: '', content: '', name: '', path: '', webUrl: '', library: '' },
    execute: async c => {
      const call = callerFor(c.raw('connection'), c.signal);
      const { drive, label } = await driveOf(call, { location: c.raw('location'), site: String(c.v('site') || ''), library: c.raw('library') });
      const op = c.raw('op') || 'list';
      if (op === 'list') {
        const items = await listFolder(call, drive, String(c.v('folder') || '').replace(/^\/+|\/+$/g, ''), !!c.raw('recursive'), wildcard(String(c.raw('pattern') || '*')));
        return { port: items.length ? 'out' : 'empty', out: { items, count: items.length, library: label } };
      }
      if (op === 'search') {
        const b = (await call({ method: 'GET', url: `${drive}/root/search(q='${encodeURIComponent(String(c.v('query') || '').replace(/'/g, "''"))}')` })).body;
        const items = (b.value || []).filter((x: any) => !x.folder).map((x: any) => item(x, String(x.parentReference?.path || '').replace(/^.*root:\/?/, '')));
        return { port: items.length ? 'out' : 'empty', out: { items, count: items.length, library: label } };
      }
      const path = String(c.v('path') || '').replace(/^\/+/, '');
      if (!path) throw new Error('Name the file');
      if (op === 'read') {
        const { meta, data } = await download(call, drive, path, c.signal);
        const base = { ...item(meta, path.split('/').slice(0, -1).join('/')), library: label };
        if (c.raw('readAs') === 'file (base64)') return { out: { ...base, content: data.toString('base64'), encoding: 'base64' } };
        const t = await documentText(data, { name: meta.name, contentType: meta.file?.mimeType });
        return { out: { ...base, text: t.text, type: t.type, title: t.title, pages: t.pages } };
      }
      const raw = c.v('content');
      const data = c.raw('encoding') === 'base64' ? Buffer.from(String(raw ?? ''), 'base64') : Buffer.from(typeof raw === 'string' ? raw : JSON.stringify(raw));
      if (data.length > 4 * 1024 * 1024) throw new Error('Upload here is for files up to 4 MB');
      const r = await call({ method: 'PUT', url: `${drive}/root:/${enc(path)}:/content`, headers: { 'content-type': 'application/octet-stream' }, body: data });
      return { out: { ...item(r.body, path.split('/').slice(0, -1).join('/')), library: label, action: 'written' } };
    },
  },
  {
    type: 'msFilesTrigger', palette: 'apps', name: 'SharePoint / OneDrive trigger', glyph: '▥', trigger: true, ports: ['added', 'modified', 'removed'],
    desc: 'Starts the Sutra when a file in a SharePoint library or OneDrive folder is added, changed or removed. Checks while deployed. Pair it with SharePoint / OneDrive read and Add to knowledge to keep a knowledge base up to date.',
    fields: [
      conn(), ...placeFields(),
      F('folder', 'Folder', 'text', ''), F('pattern', 'File name pattern', 'text', '*'), F('recursive', 'Include sub-folders', 'bool', true),
      F('pollSeconds', 'Check every (seconds)', 'number', 300),
      F('existing', 'Start with the files already there', 'bool', false, { help: 'Ticked: the first check reports every existing file as added (to fill a knowledge base). Unticked: only later changes.' }),
      F('testEvent', 'Test event (JSON)', 'code', '{\n  "event": "modified",\n  "id": "01ABC",\n  "name": "Returns.docx",\n  "path": "Policies/Returns.docx",\n  "size": 18234,\n  "modifiedAt": "2026-10-18T09:00:00Z",\n  "modifiedBy": "Meera",\n  "webUrl": "https://contoso.sharepoint.com/sites/Policies/Shared%20Documents/Policies/Returns.docx"\n}'),
    ],
    outputHint: { event: 'added', id: '', name: '', path: '', size: 0, modifiedAt: '', modifiedBy: '', webUrl: '' },
    execute: c => { const e = c.input ?? JSON.parse(c.raw('testEvent') || '{}'); return { port: ['added', 'modified', 'removed'].includes(e.event) ? e.event : 'added', out: e }; },
  },
];

registerListener('msFilesTrigger', c => {
  const cfg = c.node.config;
  const every = Math.max(15, Number(cfg.pollSeconds) || 300) * 1000;
  const call = callerFor(cfg.connection);
  let known: Map<string, { modifiedAt: string; name: string; path: string }> | null = null;
  const tick = async () => {
    try {
      const { drive, label } = await driveOf(call, cfg);
      const files = await listFolder(call, drive, String(cfg.folder || '').replace(/^\/+|\/+$/g, ''), cfg.recursive !== false, wildcard(String(cfg.pattern || '*')));
      if (!known) {
        known = new Map(files.map(f => [f.id, { modifiedAt: f.modifiedAt, name: f.name, path: f.path }]));
        if (cfg.existing) for (const f of files) c.fire({ event: 'added', ...f });
        c.status('ok', `Watching ${files.length} files in ${label}`);
        return;
      }
      const seen = new Set<string>();
      for (const f of files) {
        seen.add(f.id);
        const k = known.get(f.id);
        if (!k) c.fire({ event: 'added', ...f });
        else if (k.modifiedAt !== f.modifiedAt) c.fire({ event: 'modified', ...f });
        known.set(f.id, { modifiedAt: f.modifiedAt, name: f.name, path: f.path });
      }
      for (const [id, k] of known) if (!seen.has(id)) { known.delete(id); c.fire({ event: 'removed', id, name: k.name, path: k.path }); }
      c.status('ok', `Watching ${files.length} files in ${label}`);
    } catch (e: any) {
      c.status('error', e.message);
    }
  };
  tick();
  const t = setInterval(tick, every);
  return () => clearInterval(t);
});

