import type { Activity, ExecCtx } from '../engine/types.js';
import { kvToObject } from '../resources.js';
import { registerListener } from '../listeners.js';
import { apiCall } from './oauth.js';
import { F, when, isObj, writeFields, writeMode, appended } from '../palettes/common.js';

/** Activities for Google Sheets, Google Drive / Docs, Dropbox, YouTube, Facebook Pages, and any REST API of a connected account. */
const conn = (help?: string) => F('connection', 'Account (OAuth connection)', 'resource', '', { resourceKind: 'oauthApp', help });
const call = (c: ExecCtx, o: Parameters<typeof apiCall>[1]) => apiCall(c.raw('connection'), { ...o, signal: c.signal });
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UP = 'https://www.googleapis.com/upload/drive/v3';

/** Rows as objects (first row = header) or as lists. */
function toRows(values: any[][] | undefined, headerRow: boolean) {
  const v = values || [];
  if (!headerRow || !v.length) return v;
  const [h, ...rest] = v;
  return rest.map(r => Object.fromEntries(h.map((k: string, i: number) => [k, r[i] ?? ''])));
}
function fromRows(rows: unknown, header?: string[]) {
  const list = Array.isArray(rows) ? rows : [rows];
  return list.map(r => (Array.isArray(r) ? r : isObj(r) ? (header || Object.keys(r)).map(k => (r as any)[k] ?? '') : [r]));
}

export const saasActivities: Activity[] = [
  {
    type: 'oauthRequest', palette: 'apps', name: 'Connected API call', glyph: '⇋', ports: ['out'],
    desc: 'Calls any REST API of a connected account (Google, Microsoft Graph, Dropbox, Facebook Graph, or a custom OAuth service) with its access token.',
    fields: [
      conn(),
      F('method', 'Method', 'select', 'GET', { options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] }),
      F('url', 'URL or path', 'text', 'https://www.googleapis.com/oauth2/v3/userinfo', { tpl: true }),
      F('query', 'Query', 'kv', [], { tpl: true }), F('body', 'JSON body', 'code', '', { tpl: true, ...when('method', 'POST', 'PUT', 'PATCH') }),
    ],
    outputHint: { status: 200, body: {} },
    execute: async c => {
      const body = c.v('body');
      const r = await call(c, {
        method: c.raw('method'), url: String(c.v('url')), query: kvToObject(c.raw('query'), v => String(c.resolve(v) ?? '')),
        headers: body ? { 'content-type': 'application/json' } : {}, body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
      });
      return { out: { status: r.status, body: r.body } };
    },
  },
  {
    type: 'googleSheets', palette: 'apps', name: 'Google Sheets', glyph: '▦', ports: ['out'],
    desc: 'Reads a range, appends rows, updates a range or clears it. Rows can be objects (first row is the header) or lists.',
    fields: [
      conn('Scope https://www.googleapis.com/auth/spreadsheets'),
      F('op', 'Operation', 'select', 'read', { options: ['read', 'append', 'update', 'clear'] }),
      F('spreadsheetId', 'Spreadsheet id', 'text', '', { tpl: true, help: 'From the sheet URL: /spreadsheets/d/<id>/edit' }),
      F('range', 'Range', 'text', 'Sheet1!A1:F', { tpl: true }),
      F('header', 'First row is a header', 'bool', true),
      F('rows', 'Rows', 'text', '{{input.items}}', { tpl: true, ...when('op', 'append', 'update') }),
      F('valueInput', 'Values are', 'select', 'USER_ENTERED', { options: ['USER_ENTERED', 'RAW'], ...when('op', 'append', 'update') }),
    ],
    outputHint: { rows: [{}], count: 0, updatedRange: '' },
    execute: async c => {
      const id = encodeURIComponent(String(c.v('spreadsheetId') || ''));
      const range = encodeURIComponent(String(c.v('range') || 'Sheet1'));
      const op = c.raw('op');
      if (op === 'read') {
        const r = await call(c, { method: 'GET', url: `${SHEETS}/${id}/values/${range}` });
        const rows = toRows(r.body.values, !!c.raw('header'));
        return { out: { rows, count: rows.length, range: r.body.range } };
      }
      if (op === 'clear') {
        const r = await call(c, { method: 'POST', url: `${SHEETS}/${id}/values/${range}:clear`, headers: { 'content-type': 'application/json' }, body: '{}' });
        return { out: { clearedRange: r.body.clearedRange } };
      }
      let header: string[] | undefined;
      if (c.raw('header')) {
        const h = await call(c, { method: 'GET', url: `${SHEETS}/${id}/values/${encodeURIComponent(String(c.v('range')).split('!')[0] + '!1:1')}` });
        header = h.body.values?.[0];
      }
      const values = fromRows(c.v('rows'), header);
      const path = op === 'append' ? `${SHEETS}/${id}/values/${range}:append` : `${SHEETS}/${id}/values/${range}`;
      const r = await call(c, { method: op === 'append' ? 'POST' : 'PUT', url: path, query: { valueInputOption: c.raw('valueInput') || 'USER_ENTERED', ...(op === 'append' ? { insertDataOption: 'INSERT_ROWS' } : {}) }, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ values }) });
      const u = r.body.updates || r.body;
      return { out: { updatedRange: u.updatedRange, updatedRows: u.updatedRows, count: values.length } };
    },
  },
  {
    type: 'googleDrive', palette: 'apps', name: 'Google Drive / Docs', glyph: '△', ports: ['out'],
    desc: 'Lists, uploads, downloads files, and exports Google Docs/Sheets as text, PDF, CSV or Word.',
    fields: [
      conn('Scope https://www.googleapis.com/auth/drive'),
      F('op', 'Operation', 'select', 'list', { options: ['list', 'upload', 'download', 'export'] }),
      F('folderId', 'Folder id', 'text', '', { tpl: true, ...when('op', 'list', 'upload') }),
      F('q', 'Search (Drive query)', 'text', "trashed = false", { tpl: true, ...when('op', 'list'), help: "e.g. mimeType = 'application/vnd.google-apps.document'" }),
      F('fileId', 'File id', 'text', '{{input.id}}', { tpl: true, ...when('op', 'download', 'export') }),
      F('exportAs', 'Export as', 'select', 'text/plain', { options: ['text/plain', 'text/html', 'application/pdf', 'text/csv', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'], ...when('op', 'export') }),
      F('name', 'File name', 'text', 'report.csv', { tpl: true, ...when('op', 'upload') }),
      F('content', 'Content', 'textarea', '{{input.text}}', { tpl: true, ...when('op', 'upload') }),
      F('encoding', 'Content is', 'select', 'text', { options: ['text', 'base64'], ...when('op', 'upload') }),
      F('mimeType', 'MIME type', 'text', 'text/csv', when('op', 'upload')),
      F('convert', 'Convert to a Google Doc/Sheet', 'bool', false, when('op', 'upload')),
      ...writeFields({ k: 'op', in: ['upload'] }).map(f => (f.k === 'append' ? { ...f, help: 'Adds to the end of a file with the same name in the folder (not for Google Docs/Sheets).' } : f.k === 'overwrite' ? { ...f, help: 'Replaces the content of a file with the same name in the folder. Unticked: a second file with the same name is created.' } : f)),
    ],
    outputHint: { files: [{ id: '', name: '', mimeType: '', modifiedTime: '' }], count: 0 },
    execute: async c => {
      const op = c.raw('op');
      if (op === 'list') {
        const q = [String(c.v('q') || ''), c.v('folderId') ? `'${String(c.v('folderId')).replace(/'/g, "\\'")}' in parents` : ''].filter(Boolean).join(' and ');
        const r = await call(c, { method: 'GET', url: `${DRIVE}/files`, query: { q, fields: 'files(id,name,mimeType,modifiedTime,size,webViewLink)', pageSize: '200' } });
        return { out: { files: r.body.files || [], count: (r.body.files || []).length } };
      }
      if (op === 'download' || op === 'export') {
        const id = encodeURIComponent(String(c.v('fileId')));
        const url = op === 'export' ? `${DRIVE}/files/${id}/export` : `${DRIVE}/files/${id}`;
        const textual = op === 'export' && /^text\//.test(c.raw('exportAs'));
        const r = await call(c, { method: 'GET', url, query: op === 'export' ? { mimeType: c.raw('exportAs') } : { alt: 'media' }, parse: 'buffer' });
        return { out: { fileId: c.v('fileId'), content: textual ? r.buffer!.toString('utf8') : r.buffer!.toString('base64'), encoding: textual ? 'text' : 'base64', size: r.buffer!.length } };
      }
      const raw0 = c.v('content');
      const data0 = c.raw('encoding') === 'base64' ? Buffer.from(String(raw0 ?? ''), 'base64') : Buffer.from(typeof raw0 === 'string' ? raw0 : JSON.stringify(raw0));
      const mode = writeMode(c.raw);
      if (mode !== 'fail') {
        // Same name in the same folder: update its content instead of creating a second file.
        const q = [`name = '${String(c.v('name')).replace(/'/g, "\\'")}'`, 'trashed = false', c.v('folderId') ? `'${String(c.v('folderId')).replace(/'/g, "\\'")}' in parents` : ''].filter(Boolean).join(' and ');
        const found = (await call(c, { method: 'GET', url: `${DRIVE}/files`, query: { q, fields: 'files(id,mimeType)', pageSize: '1' } })).body.files?.[0];
        if (found) {
          let content = data0;
          if (mode === 'append') {
            if (String(found.mimeType).startsWith('application/vnd.google-apps')) throw new Error('Append works on regular files, not Google Docs/Sheets');
            const cur = await call(c, { method: 'GET', url: `${DRIVE}/files/${found.id}`, query: { alt: 'media' }, parse: 'buffer' });
            content = appended(cur.buffer!, data0, c.raw('newline') !== false);
          }
          const r = await call(c, { method: 'PATCH', url: `${DRIVE_UP}/files/${found.id}`, query: { uploadType: 'media', fields: 'id,name,mimeType,webViewLink' }, headers: { 'content-type': c.raw('mimeType') || 'application/octet-stream' }, body: content });
          return { out: { ...r.body, action: mode === 'append' ? 'appended' : 'overwritten' } };
        }
      }
      const meta: any = { name: String(c.v('name')), ...(c.v('folderId') ? { parents: [String(c.v('folderId'))] } : {}) };
      if (c.raw('convert')) meta.mimeType = c.raw('mimeType') === 'text/csv' ? 'application/vnd.google-apps.spreadsheet' : 'application/vnd.google-apps.document';
      const boundary = 'sutra' + Date.now();
      const raw = c.v('content');
      const data = c.raw('encoding') === 'base64' ? Buffer.from(String(raw ?? ''), 'base64') : Buffer.from(typeof raw === 'string' ? raw : JSON.stringify(raw));
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\ncontent-type: ${c.raw('mimeType') || 'application/octet-stream'}\r\n\r\n`),
        data, Buffer.from(`\r\n--${boundary}--`),
      ]);
      const r = await call(c, { method: 'POST', url: `${DRIVE_UP}/files`, query: { uploadType: 'multipart', fields: 'id,name,mimeType,webViewLink' }, headers: { 'content-type': `multipart/related; boundary=${boundary}` }, body });
      return { out: { ...r.body, action: 'created' } };
    },
  },
  {
    type: 'googleDriveTrigger', palette: 'apps', name: 'Google Drive / Docs trigger', glyph: '△', trigger: true, ports: ['added', 'modified', 'removed'],
    desc: 'Starts the Sutra when a file in a Google Drive folder (for example Google Docs) is added, modified or removed. Polls while deployed.',
    fields: [
      conn('Scope https://www.googleapis.com/auth/drive.readonly'),
      F('folderId', 'Folder id', 'text', ''),
      F('mimeType', 'Only this type', 'select', 'Google Docs', { options: ['any', 'Google Docs', 'Google Sheets', 'PDF'] }),
      F('pollSeconds', 'Check every (seconds)', 'number', 60),
      F('testEvent', 'Test event (JSON)', 'code', '{\n  "event": "modified",\n  "id": "1AbC",\n  "name": "Quarterly plan",\n  "mimeType": "application/vnd.google-apps.document",\n  "modifiedTime": "2026-10-14T09:00:00Z"\n}'),
    ],
    outputHint: { event: 'added', id: '', name: '', mimeType: '', modifiedTime: '', webViewLink: '' },
    execute: c => { const e = c.input ?? JSON.parse(c.raw('testEvent') || '{}'); return { port: ['added', 'modified', 'removed'].includes(e.event) ? e.event : 'added', out: e }; },
  },
  {
    type: 'dropbox', palette: 'apps', name: 'Dropbox', glyph: '◇', ports: ['out'],
    desc: 'Uploads, downloads or lists files in Dropbox.',
    fields: [
      conn('Scopes files.content.read files.content.write'),
      F('op', 'Operation', 'select', 'list', { options: ['list', 'upload', 'download'] }),
      F('path', 'Path', 'text', '/reports', { tpl: true }),
      F('content', 'Content', 'textarea', '{{input.text}}', { tpl: true, ...when('op', 'upload') }),
      F('encoding', 'Content is', 'select', 'text', { options: ['text', 'base64'], ...when('op', 'upload') }),
      ...writeFields({ k: 'op', in: ['upload'] }),
    ],
    outputHint: { entries: [{ name: '', path_display: '', '.tag': '' }] },
    execute: async c => {
      const p = String(c.v('path') || '');
      if (c.raw('op') === 'list') {
        const r = await call(c, { method: 'POST', url: 'https://api.dropboxapi.com/2/files/list_folder', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: p === '/' ? '' : p }) });
        return { out: { entries: r.body.entries || [], count: (r.body.entries || []).length } };
      }
      if (c.raw('op') === 'download') {
        const r = await call(c, { method: 'POST', url: 'https://content.dropboxapi.com/2/files/download', headers: { 'Dropbox-API-Arg': JSON.stringify({ path: p }) }, parse: 'buffer' });
        return { out: { path: p, content: r.buffer!.toString('base64'), encoding: 'base64', size: r.buffer!.length } };
      }
      const raw = c.v('content');
      let data = c.raw('encoding') === 'base64' ? Buffer.from(String(raw ?? ''), 'base64') : Buffer.from(typeof raw === 'string' ? raw : JSON.stringify(raw));
      const mode = writeMode(c.raw);
      let action = 'created';
      if (mode === 'append') {
        // Dropbox has no append: read the current file (if any), add, upload over it.
        try {
          const cur = await call(c, { method: 'POST', url: 'https://content.dropboxapi.com/2/files/download', headers: { 'Dropbox-API-Arg': JSON.stringify({ path: p }) }, parse: 'buffer' });
          data = appended(cur.buffer!, data, c.raw('newline') !== false);
          action = 'appended';
        } catch (e: any) {
          if (!/not_found|409/.test(e.message)) throw e;
        }
      }
      const r = await call(c, { method: 'POST', url: 'https://content.dropboxapi.com/2/files/upload', headers: { 'content-type': 'application/octet-stream', 'Dropbox-API-Arg': JSON.stringify({ path: p, mode: mode === 'fail' ? 'add' : 'overwrite', autorename: false }) }, body: data });
      return { out: { ...r.body, action: action === 'appended' ? action : mode === 'overwrite' ? 'written' : action } };
    },
  },
  {
    type: 'youtube', palette: 'apps', name: 'YouTube', glyph: '▶', ports: ['out'],
    desc: 'Lists your channel\'s latest videos, searches videos, or gets video statistics.',
    fields: [
      conn('Scope https://www.googleapis.com/auth/youtube.readonly'),
      F('op', 'Operation', 'select', 'my videos', { options: ['my videos', 'search', 'video stats'] }),
      F('q', 'Search', 'text', '', { tpl: true, ...when('op', 'search') }),
      F('videoIds', 'Video ids (comma separated)', 'text', '', { tpl: true, ...when('op', 'video stats') }),
      F('max', 'Maximum results', 'number', 25),
    ],
    outputHint: { items: [{ id: '', title: '', publishedAt: '' }] },
    execute: async c => {
      const Y = 'https://www.googleapis.com/youtube/v3';
      const max = String(Math.min(50, Number(c.raw('max')) || 25));
      if (c.raw('op') === 'video stats') {
        const r = await call(c, { method: 'GET', url: `${Y}/videos`, query: { part: 'snippet,statistics', id: String(c.v('videoIds') || '') } });
        return { out: { items: (r.body.items || []).map((v: any) => ({ id: v.id, title: v.snippet?.title, ...v.statistics })) } };
      }
      const r = await call(c, { method: 'GET', url: `${Y}/search`, query: { part: 'snippet', maxResults: max, order: 'date', type: 'video', ...(c.raw('op') === 'my videos' ? { forMine: 'true' } : { q: String(c.v('q') || '') }) } });
      return { out: { items: (r.body.items || []).map((v: any) => ({ id: v.id?.videoId, title: v.snippet?.title, publishedAt: v.snippet?.publishedAt, channel: v.snippet?.channelTitle })) } };
    },
  },
  {
    type: 'facebookPage', palette: 'apps', name: 'Facebook Page', glyph: 'f', ports: ['out'],
    desc: 'Publishes a post (with an optional link) to a Facebook Page you manage, or reads its latest posts.',
    fields: [
      conn('Scopes pages_manage_posts pages_read_engagement'),
      F('op', 'Operation', 'select', 'post', { options: ['post', 'latest posts'] }),
      F('pageId', 'Page id', 'text', ''),
      F('message', 'Message', 'textarea', 'New arrivals this week: {{input.title}}', { tpl: true, ...when('op', 'post') }),
      F('link', 'Link', 'text', '', { tpl: true, ...when('op', 'post') }),
    ],
    outputHint: { id: '' },
    execute: async c => {
      const G = 'https://graph.facebook.com/v19.0';
      const page = encodeURIComponent(String(c.raw('pageId') || ''));
      // Page actions need the page's own access token, obtained with the user's token.
      const pt = await call(c, { method: 'GET', url: `${G}/${page}`, query: { fields: 'access_token' } });
      const pageToken = pt.body.access_token;
      if (!pageToken) throw new Error('No page access token: the connected user must manage this page and grant pages_manage_posts');
      if (c.raw('op') === 'latest posts') {
        const r = await call(c, { method: 'GET', url: `${G}/${page}/posts`, query: { access_token: pageToken, fields: 'id,message,created_time,permalink_url', limit: '25' } });
        return { out: { posts: r.body.data || [] } };
      }
      const r = await call(c, { method: 'POST', url: `${G}/${page}/feed`, headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ message: String(c.v('message') ?? ''), ...(c.v('link') ? { link: String(c.v('link')) } : {}), access_token: pageToken }).toString() });
      return { out: { id: r.body.id } };
    },
  },
];

// ---------- Google Drive / Docs trigger ----------
const MIME: Record<string, string> = { 'Google Docs': 'application/vnd.google-apps.document', 'Google Sheets': 'application/vnd.google-apps.spreadsheet', PDF: 'application/pdf' };
registerListener('googleDriveTrigger', c => {
  const cfg = c.node.config;
  const every = Math.max(30, Number(cfg.pollSeconds) || 60) * 1000;
  let known: Map<string, { modifiedTime: string; name: string }> | null = null;
  const tick = async () => {
    try {
      const q = ['trashed = false', cfg.folderId ? `'${String(cfg.folderId).replace(/'/g, "\\'")}' in parents` : '', MIME[cfg.mimeType] ? `mimeType = '${MIME[cfg.mimeType]}'` : ''].filter(Boolean).join(' and ');
      const r = await apiCall(cfg.connection, { method: 'GET', url: `${DRIVE}/files`, query: { q, fields: 'files(id,name,mimeType,modifiedTime,webViewLink,lastModifyingUser(displayName,emailAddress))', pageSize: '1000' } });
      const files: any[] = r.body.files || [];
      if (!known) { known = new Map(files.map(f => [f.id, { modifiedTime: f.modifiedTime, name: f.name }])); c.status('ok', `Watching ${files.length} files`); return; }
      const seen = new Set<string>();
      for (const f of files) {
        seen.add(f.id);
        const k = known.get(f.id);
        if (!k) c.fire({ event: 'added', ...f });
        else if (k.modifiedTime !== f.modifiedTime) c.fire({ event: 'modified', ...f });
        known.set(f.id, { modifiedTime: f.modifiedTime, name: f.name });
      }
      for (const [id, k] of known) if (!seen.has(id)) { known.delete(id); c.fire({ event: 'removed', id, name: k.name }); }
      c.status('ok', `Watching ${files.length} files`);
    } catch (e: any) {
      c.status('error', e.message);
    }
  };
  tick();
  const t = setInterval(tick, every);
  return () => clearInterval(t);
});
