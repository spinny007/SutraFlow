/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import type { Activity, ExecCtx } from '../engine/types.js';
import { kvToObject } from '../resources.js';
import { registerListener } from '../listeners.js';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { apiCall, streamCall } from './oauth.js';
import { F, when, isObj, writeFields, writeMode, appended } from '../palettes/common.js';

/** Activities for Google Sheets, Google Drive / Docs, Dropbox, YouTube, Facebook Pages, and any REST API of a connected account. */
const conn = (help?: string) => F('connection', 'Account (OAuth connection)', 'resource', '', { resourceKind: 'oauthApp', help });
// Each call waits as long as the step's "Wait for each call" says (slow links, big files), within the step's time limit.
const call = (c: ExecCtx, o: Parameters<typeof apiCall>[1]) => apiCall(c.raw('connection'), { ...(Number(c.raw('timeoutSec')) > 0 ? { timeoutMs: Number(c.raw('timeoutSec')) * 1000 } : {}), ...o, signal: c.signal });
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
    type: 'googleDrive', palette: 'apps', name: 'Google Drive / Docs', glyph: '△', ports: ['out'], timeoutMs: 1800000,
    desc: 'Lists, uploads, downloads files, and exports Google Docs/Sheets as text, PDF, CSV or Word.',
    fields: [
      conn('Scope https://www.googleapis.com/auth/drive'),
      F('op', 'Operation', 'select', 'list', { options: ['list', 'upload', 'download', 'export'] }),
      F('folderId', 'Folder id', 'text', '', { tpl: true, ...when('op', 'list', 'upload') }),
      F('q', 'Search (Drive query)', 'text', "trashed = false", { tpl: true, ...when('op', 'list'), help: "e.g. mimeType = 'application/vnd.google-apps.document'" }),
      F('fileId', 'File id', 'text', '{{input.id}}', { tpl: true, ...when('op', 'download', 'export') }),
      F('saveTo', 'Save to', 'select', 'step output', { options: ['step output', 'server file'], ...when('op', 'download', 'export'), help: 'server file: streamed to disk, for videos and other large files (then YouTube, SFTP or Read document text can take the file).' }),
      F('savePath', 'Server file', 'text', "=concat({gv.DOWNLOADS}, '/', {input.name})", { tpl: true, ...when('saveTo', 'server file'), help: 'Full path of the file to write; its folder is made when missing.' }),
      F('exportAs', 'Export as', 'select', 'text/plain', { options: ['text/plain', 'text/html', 'application/pdf', 'text/csv', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'], ...when('op', 'export') }),
      F('name', 'File name', 'text', 'report.csv', { tpl: true, ...when('op', 'upload'), help: 'With Upload from server file: empty = the name of the file.' }),
      F('from', 'Upload from', 'select', 'content', { options: ['content', 'server file'], ...when('op', 'upload'), help: 'server file: streamed from disk in a resumable upload, for big files; the content is never held in memory. content: the Content below.' }),
      F('filePath', 'Server file', 'text', '{{input.path}}', { tpl: true, ...when('from', 'server file') }),
      F('content', 'Content', 'textarea', '{{input.text}}', { tpl: true, ...when('op', 'upload') }),
      F('encoding', 'Content is', 'select', 'text', { options: ['text', 'base64'], ...when('op', 'upload') }),
      F('mimeType', 'MIME type', 'text', 'text/csv', when('op', 'upload')),
      F('convert', 'Convert to a Google Doc/Sheet', 'bool', false, when('op', 'upload')),
      F('timeoutSec', 'Wait for each call (seconds)', 'number', 300, { help: 'How long one call to Drive may take before it fails: raise it for slow links. Streamed uploads and downloads to server files run until the step\'s time limit (Settings: 30 minutes by default).' }),
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
        if (c.raw('saveTo') === 'server file') {
          const target = String(c.v('savePath') || '').trim();
          if (!target) throw new Error('Server file is not set');
          const meta = (await call(c, { method: 'GET', url: `${DRIVE}/files/${id}`, query: { fields: 'id,name,mimeType,size,modifiedTime' } })).body;
          fs.mkdirSync(path.dirname(target), { recursive: true });
          const q = new URLSearchParams(op === 'export' ? { mimeType: c.raw('exportAs') } : { alt: 'media' });
          const res = await streamCall(c.raw('connection'), `${url}?${q}`, { method: 'GET', signal: c.signal });
          await pipeline(Readable.fromWeb(res.body as any), fs.createWriteStream(target));
          return { out: { fileId: c.v('fileId'), name: meta.name, mimeType: meta.mimeType, path: target, size: fs.statSync(target).size, modifiedTime: meta.modifiedTime } };
        }
        const r = await call(c, { method: 'GET', url, query: op === 'export' ? { mimeType: c.raw('exportAs') } : { alt: 'media' }, parse: 'buffer' });
        return { out: { fileId: c.v('fileId'), content: textual ? r.buffer!.toString('utf8') : r.buffer!.toString('base64'), encoding: textual ? 'text' : 'base64', size: r.buffer!.length } };
      }
      if (c.raw('from') === 'server file') return { out: await driveUploadFile(c) };
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
    type: 'youtube', palette: 'apps', name: 'YouTube', glyph: '▶', ports: ['out'], timeoutMs: 6 * 3600000,
    desc: 'Your channel on YouTube: its videos, playlists, comments and statistics, search, Analytics reports (views, watch time, subscribers by day, video or country), uploading a video from a file on the server, changing a video\'s title, description, tags and privacy, and setting its thumbnail. To publish videos kept in Google Drive, save them to a server file with Google Drive / Docs first.',
    fields: [
      conn('Scopes: .../auth/youtube.readonly to read, .../auth/youtube.upload to upload, .../auth/youtube.force-ssl to change videos and read comments, .../auth/yt-analytics.readonly for Analytics.'),
      F('op', 'Operation', 'select', 'my videos', { options: ['my videos', 'search', 'video stats', 'channel stats', 'playlists', 'playlist videos', 'comments', 'analytics report', 'upload video', 'update video', 'set thumbnail'] }),
      F('q', 'Search', 'text', '', { tpl: true, ...when('op', 'search') }),
      F('videoIds', 'Video ids (comma separated)', 'text', '{{input.videoId}}', { tpl: true, ...when('op', 'video stats', 'comments', 'update video', 'set thumbnail') }),
      F('playlistId', 'Playlist id', 'text', '', { tpl: true, ...when('op', 'playlist videos'), help: 'From the playlist address: list=...' }),
      F('startDate', 'From', 'text', "=format-date('YYYY-MM-DD', add-to-date(current-date(), 0, 0, -28))", { tpl: true, ...when('op', 'analytics report') }),
      F('endDate', 'To', 'text', '=current-date()', { tpl: true, ...when('op', 'analytics report') }),
      F('metrics', 'Metrics', 'text', 'views,estimatedMinutesWatched,averageViewDuration,likes,subscribersGained', { ...when('op', 'analytics report'), help: 'Comma separated YouTube Analytics metrics.' }),
      F('dimensions', 'By', 'select', 'day', { options: ['day', 'month', 'video', 'country', 'deviceType', 'insightTrafficSourceType', 'none'], ...when('op', 'analytics report') }),
      F('filters', 'Filters', 'text', '', { tpl: true, ...when('op', 'analytics report'), help: 'Optional, for example video==dQw4w9WgXcQ or country==IN.' }),
      F('from', 'Video from', 'select', 'server file', { options: ['server file', 'earlier step (base64)'], ...when('op', 'upload video') }),
      F('filePath', 'Video file', 'text', '{{input.path}}', { tpl: true, ...when('from', 'server file'), help: 'A file on the SutraFlow server, for example saved there by Google Drive / Docs (Save to: server file) or a file trigger. Streamed, so large videos are fine.' }),
      F('content', 'Video content (base64)', 'text', '{{input.content}}', { tpl: true, ...when('from', 'earlier step (base64)'), help: 'For short clips only; large videos belong in a server file.' }),
      F('thumbnailPath', 'Thumbnail image file', 'text', '{{input.path}}', { tpl: true, ...when('op', 'set thumbnail'), help: 'JPEG or PNG under 2 MB, 1280x720 is best.' }),
      F('title', 'Title', 'text', '{{input.name}}', { tpl: true, ...when('op', 'upload video', 'update video') }),
      F('description', 'Description', 'textarea', '', { tpl: true, ...when('op', 'upload video', 'update video') }),
      F('tags', 'Tags (comma separated)', 'text', '', { tpl: true, ...when('op', 'upload video', 'update video') }),
      F('categoryId', 'Category id', 'text', '22', { ...when('op', 'upload video', 'update video'), help: '22 People & Blogs, 27 Education, 28 Science & Technology, 24 Entertainment, 26 Howto & Style.' }),
      F('privacy', 'Privacy', 'select', 'private', { options: ['private', 'unlisted', 'public'], ...when('op', 'upload video', 'update video') }),
      F('publishAt', 'Publish at', 'text', '', { tpl: true, ...when('op', 'upload video', 'update video'), help: 'Optional: an ISO date and time; the video stays private until then.' }),
      F('madeForKids', 'Made for kids', 'bool', false, when('op', 'upload video')),
      F('addToPlaylist', 'Add to playlist id', 'text', '', { tpl: true, ...when('op', 'upload video') }),
      F('notify', 'Notify subscribers', 'bool', true, when('op', 'upload video')),
      F('max', 'Maximum results', 'number', 25, when('op', 'my videos', 'search', 'playlists', 'playlist videos', 'comments')),
    ],
    outputHint: { items: [{ id: '', title: '', publishedAt: '' }], count: 0, videoId: '', url: '', rows: [{}], columns: [''] },
    execute: async c => {
      const Y = 'https://www.googleapis.com/youtube/v3';
      const op = c.raw('op') || 'my videos';
      const max = String(Math.min(50, Number(c.raw('max')) || 25));
      const ids = String(c.v('videoIds') || '').split(',').map(s => s.trim()).filter(Boolean);
      const list = (items: any[]) => ({ out: { items, count: items.length } });
      switch (op) {
        case 'video stats': {
          const r = await call(c, { method: 'GET', url: `${Y}/videos`, query: { part: 'snippet,statistics,contentDetails,status', id: ids.join(',') } });
          return list((r.body.items || []).map((v: any) => ({ id: v.id, title: v.snippet?.title, publishedAt: v.snippet?.publishedAt, duration: v.contentDetails?.duration, privacy: v.status?.privacyStatus, views: Number(v.statistics?.viewCount || 0), likes: Number(v.statistics?.likeCount || 0), comments: Number(v.statistics?.commentCount || 0) })));
        }
        case 'channel stats': {
          const r = await call(c, { method: 'GET', url: `${Y}/channels`, query: { part: 'snippet,statistics', mine: 'true' } });
          const ch = r.body.items?.[0];
          if (!ch) throw new Error('The connected account has no YouTube channel');
          return { out: { id: ch.id, title: ch.snippet?.title, subscribers: Number(ch.statistics?.subscriberCount || 0), views: Number(ch.statistics?.viewCount || 0), videos: Number(ch.statistics?.videoCount || 0), url: `https://www.youtube.com/channel/${ch.id}` } };
        }
        case 'playlists': {
          const r = await call(c, { method: 'GET', url: `${Y}/playlists`, query: { part: 'snippet,contentDetails,status', mine: 'true', maxResults: max } });
          return list((r.body.items || []).map((p: any) => ({ id: p.id, title: p.snippet?.title, videos: p.contentDetails?.itemCount, privacy: p.status?.privacyStatus })));
        }
        case 'playlist videos': {
          const r = await call(c, { method: 'GET', url: `${Y}/playlistItems`, query: { part: 'snippet,contentDetails', playlistId: String(c.v('playlistId') || ''), maxResults: max } });
          return list((r.body.items || []).map((p: any) => ({ id: p.contentDetails?.videoId, title: p.snippet?.title, publishedAt: p.contentDetails?.videoPublishedAt, position: p.snippet?.position })));
        }
        case 'comments': {
          const r = await call(c, { method: 'GET', url: `${Y}/commentThreads`, query: { part: 'snippet', videoId: ids[0] || '', maxResults: max, order: 'time' } });
          return list((r.body.items || []).map((t: any) => { const s = t.snippet?.topLevelComment?.snippet || {}; return { id: t.id, author: s.authorDisplayName, text: s.textOriginal, likes: s.likeCount, publishedAt: s.publishedAt, replies: t.snippet?.totalReplyCount }; }));
        }
        case 'analytics report': {
          const dim = c.raw('dimensions') || 'day';
          const r = await call(c, { method: 'GET', url: 'https://youtubeanalytics.googleapis.com/v2/reports', query: { ids: 'channel==MINE', startDate: String(c.v('startDate')), endDate: String(c.v('endDate')), metrics: String(c.raw('metrics') || 'views'), ...(dim !== 'none' ? { dimensions: dim, sort: dim === 'day' || dim === 'month' ? dim : `-${String(c.raw('metrics') || 'views').split(',')[0]}` } : {}), ...(dim === 'video' ? { maxResults: '50' } : {}), filters: String(c.v('filters') || '') } });
          const cols = (r.body.columnHeaders || []).map((h: any) => h.name);
          const rows = (r.body.rows || []).map((row: any[]) => Object.fromEntries(cols.map((k: string, i: number) => [k, row[i]])));
          return { out: { columns: cols, rows, count: rows.length } };
        }
        case 'update video': {
          if (!ids[0]) throw new Error('Video id is not set');
          const cur = (await call(c, { method: 'GET', url: `${Y}/videos`, query: { part: 'snippet,status', id: ids[0] } })).body.items?.[0];
          if (!cur) throw new Error(`No video ${ids[0]} on the connected channel`);
          const snippet = { ...cur.snippet, ...(c.v('title') ? { title: String(c.v('title')) } : {}), ...(c.v('description') ? { description: String(c.v('description')) } : {}), ...(c.v('tags') ? { tags: String(c.v('tags')).split(',').map(t => t.trim()).filter(Boolean) } : {}), categoryId: c.raw('categoryId') || cur.snippet.categoryId };
          const status = { ...cur.status, privacyStatus: c.raw('privacy') || cur.status.privacyStatus, ...(c.v('publishAt') ? { publishAt: String(c.v('publishAt')), privacyStatus: 'private' } : {}) };
          const r = await call(c, { method: 'PUT', url: `${Y}/videos`, query: { part: 'snippet,status' }, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: ids[0], snippet: { title: snippet.title, description: snippet.description, tags: snippet.tags, categoryId: snippet.categoryId }, status: { privacyStatus: status.privacyStatus, ...(status.publishAt ? { publishAt: status.publishAt } : {}) } }) });
          return { out: { videoId: r.body.id, title: r.body.snippet?.title, privacy: r.body.status?.privacyStatus, url: `https://youtu.be/${r.body.id}` } };
        }
        case 'set thumbnail': {
          if (!ids[0]) throw new Error('Video id is not set');
          const f = String(c.v('thumbnailPath') || '');
          if (!fs.existsSync(f)) throw new Error(`Thumbnail file not found on this server: ${f}`);
          const r = await call(c, { method: 'POST', url: 'https://www.googleapis.com/upload/youtube/v3/thumbnails/set', query: { videoId: ids[0] }, headers: { 'content-type': /\.png$/i.test(f) ? 'image/png' : 'image/jpeg' }, body: fs.readFileSync(f) });
          return { out: { videoId: ids[0], thumbnails: r.body.items?.[0] || {} } };
        }
        case 'upload video': {
          // Resumable upload: the metadata first, then the video streamed to the address YouTube gives.
          let size: number, body: any, name: string;
          if ((c.raw('from') || 'server file') === 'server file') {
            const f = String(c.v('filePath') || '').trim();
            if (!f || !fs.existsSync(f)) throw new Error(`Video file not found on this server: ${f || '(empty)'}`);
            size = fs.statSync(f).size; name = path.basename(f);
            body = Readable.toWeb(fs.createReadStream(f));
          } else {
            const buf = Buffer.from(String(c.v('content') || ''), 'base64');
            if (!buf.length) throw new Error('The video content is empty');
            size = buf.length; body = buf; name = 'video';
          }
          const tags = String(c.v('tags') || '').split(',').map(t => t.trim()).filter(Boolean);
          const meta = {
            snippet: { title: String(c.v('title') || name).replace(/\.[a-z0-9]{2,4}$/i, '').slice(0, 100), description: String(c.v('description') || '').slice(0, 5000), ...(tags.length ? { tags } : {}), categoryId: c.raw('categoryId') || '22' },
            status: { privacyStatus: c.v('publishAt') ? 'private' : c.raw('privacy') || 'private', ...(c.v('publishAt') ? { publishAt: String(c.v('publishAt')) } : {}), selfDeclaredMadeForKids: !!c.raw('madeForKids') },
          };
          const start = await streamCall(c.raw('connection'), `https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status&notifySubscribers=${c.raw('notify') !== false}`, {
            method: 'POST', signal: c.signal, body: JSON.stringify(meta),
            headers: { 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-length': String(size), 'x-upload-content-type': 'video/*' },
          });
          const location = start.headers.get('location');
          if (!location) throw new Error('YouTube did not give an upload address');
          c.log('info', `Uploading ${name} (${(size / 1048576).toFixed(1)} MB) to YouTube`);
          const up = await streamCall(c.raw('connection'), location, { method: 'PUT', signal: c.signal, body, headers: { 'content-type': 'video/*', 'content-length': String(size) } });
          const v: any = await up.json();
          const playlist = String(c.v('addToPlaylist') || '').trim();
          if (playlist) await call(c, { method: 'POST', url: `${Y}/playlistItems`, query: { part: 'snippet' }, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ snippet: { playlistId: playlist, resourceId: { kind: 'youtube#video', videoId: v.id } } }) });
          return { out: { videoId: v.id, url: `https://youtu.be/${v.id}`, title: v.snippet?.title, privacy: v.status?.privacyStatus, uploadStatus: v.status?.uploadStatus, bytes: size, playlist: playlist || null } };
        }
        default: {
          const r = await call(c, { method: 'GET', url: `${Y}/search`, query: { part: 'snippet', maxResults: max, order: 'date', type: 'video', ...(op === 'my videos' ? { forMine: 'true' } : { q: String(c.v('q') || '') }) } });
          return list((r.body.items || []).map((v: any) => ({ id: v.id?.videoId, title: v.snippet?.title, publishedAt: v.snippet?.publishedAt, channel: v.snippet?.channelTitle })));
        }
      }
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
  {
    type: 'twitch', palette: 'apps', name: 'Twitch', glyph: '◘', ports: ['out'],
    desc: 'Twitch channels: users, whether a channel is live and its viewers, channel information, followers, past broadcasts (videos), clips, the schedule, and for your own channel: changing the title, game and tags, creating a clip, and sending a chat message.',
    fields: [
      conn('An OAuth connection with Service twitch (dev.twitch.tv > Your Console > Applications). Scopes: user:read:email; channel:manage:broadcast to change the channel; clips:edit for clips; user:write:chat for chat; moderator:read:followers for followers.'),
      F('op', 'Operation', 'select', 'stream status', { options: ['users', 'stream status', 'channel info', 'followers', 'videos', 'clips', 'schedule', 'update channel', 'create clip', 'chat message'] }),
      F('logins', 'Channels (login names, comma separated)', 'text', '', { tpl: true, help: 'Empty = the connected account\'s own channel.' }),
      F('title', 'Title', 'text', '{{input.title}}', { tpl: true, ...when('op', 'update channel') }),
      F('game', 'Game or category', 'text', '', { tpl: true, ...when('op', 'update channel'), help: 'A category name such as Just Chatting or Software and Game Development.' }),
      F('tags', 'Tags (comma separated)', 'text', '', { tpl: true, ...when('op', 'update channel') }),
      F('message', 'Message', 'textarea', 'Thanks for watching! New video: {{input.url}}', { tpl: true, ...when('op', 'chat message') }),
      F('max', 'Maximum results', 'number', 20, when('op', 'followers', 'videos', 'clips', 'schedule')),
    ],
    outputHint: { items: [{ id: '', login: '', live: false, title: '', viewers: 0 }], count: 0 },
    execute: async c => {
      const H = 'https://api.twitch.tv/helix';
      const op = c.raw('op') || 'stream status';
      const first = String(Math.min(100, Number(c.raw('max')) || 20));
      const logins = String(c.v('logins') || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      const usersQ = new URLSearchParams(); for (const l of logins) usersQ.append('login', l);
      const users = (await call(c, { method: 'GET', url: `${H}/users${logins.length ? `?${usersQ}` : ''}` })).body.data || [];
      if (!users.length) throw new Error(logins.length ? `No Twitch user ${logins.join(', ')}` : 'The connected account has no Twitch user');
      const me = users[0];
      const list = (items: any[]) => ({ out: { items, count: items.length } });
      const byIds = (key: string) => { const q = new URLSearchParams(); for (const u of users) q.append(key, u.id); return q.toString(); };
      switch (op) {
        case 'users': return list(users.map((u: any) => ({ id: u.id, login: u.login, name: u.display_name, description: u.description, created: u.created_at, type: u.broadcaster_type, image: u.profile_image_url })));
        case 'stream status': {
          const live = (await call(c, { method: 'GET', url: `${H}/streams?${byIds('user_id')}` })).body.data || [];
          return list(users.map((u: any) => { const s = live.find((x: any) => x.user_id === u.id); return { id: u.id, login: u.login, live: !!s, title: s?.title || '', game: s?.game_name || '', viewers: s?.viewer_count || 0, startedAt: s?.started_at || null, url: `https://www.twitch.tv/${u.login}` }; }));
        }
        case 'channel info': {
          const ch = (await call(c, { method: 'GET', url: `${H}/channels?${byIds('broadcaster_id')}` })).body.data || [];
          return list(ch.map((x: any) => ({ id: x.broadcaster_id, login: x.broadcaster_login, title: x.title, game: x.game_name, tags: x.tags || [], language: x.broadcaster_language })));
        }
        case 'followers': {
          const r = (await call(c, { method: 'GET', url: `${H}/channels/followers`, query: { broadcaster_id: me.id, first } })).body;
          return { out: { total: r.total ?? 0, items: (r.data || []).map((f: any) => ({ id: f.user_id, login: f.user_login, name: f.user_name, followedAt: f.followed_at })), count: (r.data || []).length } };
        }
        case 'videos': return list(((await call(c, { method: 'GET', url: `${H}/videos`, query: { user_id: me.id, first } })).body.data || []).map((v: any) => ({ id: v.id, title: v.title, url: v.url, views: v.view_count, duration: v.duration, publishedAt: v.published_at, type: v.type })));
        case 'clips': return list(((await call(c, { method: 'GET', url: `${H}/clips`, query: { broadcaster_id: me.id, first } })).body.data || []).map((x: any) => ({ id: x.id, title: x.title, url: x.url, views: x.view_count, creator: x.creator_name, createdAt: x.created_at, duration: x.duration })));
        case 'schedule': {
          const r = await call(c, { method: 'GET', url: `${H}/schedule`, query: { broadcaster_id: me.id, first } }).catch((e: any) => { if (/404/.test(e.message)) return { body: { data: { segments: [] } } }; throw e; });
          return list((r.body.data?.segments || []).map((s: any) => ({ id: s.id, title: s.title, start: s.start_time, end: s.end_time, game: s.category?.name || '' })));
        }
        case 'update channel': {
          const body: any = {};
          if (c.v('title')) body.title = String(c.v('title')).slice(0, 140);
          if (c.v('tags')) body.tags = String(c.v('tags')).split(',').map(t => t.trim().replace(/\s+/g, '')).filter(Boolean).slice(0, 10);
          const game = String(c.v('game') || '').trim();
          if (game) {
            const g = (await call(c, { method: 'GET', url: `${H}/games`, query: { name: game } })).body.data?.[0];
            if (!g) throw new Error(`No Twitch category named "${game}"`);
            body.game_id = g.id;
          }
          if (!Object.keys(body).length) throw new Error('Give a title, a game or tags to change');
          await call(c, { method: 'PATCH', url: `${H}/channels`, query: { broadcaster_id: me.id }, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
          return { out: { login: me.login, ...body } };
        }
        case 'create clip': {
          const r = (await call(c, { method: 'POST', url: `${H}/clips`, query: { broadcaster_id: me.id } })).body.data?.[0];
          return { out: { id: r?.id, editUrl: r?.edit_url, url: r?.id ? `https://clips.twitch.tv/${r.id}` : '' } };
        }
        case 'chat message': {
          const sender = (await call(c, { method: 'GET', url: `${H}/users` })).body.data?.[0];
          const r = (await call(c, { method: 'POST', url: `${H}/chat/messages`, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ broadcaster_id: me.id, sender_id: sender?.id || me.id, message: String(c.v('message') || '').slice(0, 500) }) })).body.data?.[0];
          if (r && r.is_sent === false) throw new Error(`Twitch did not send the message: ${r.drop_reason?.message || 'dropped'}`);
          return { out: { messageId: r?.message_id, sent: true, channel: me.login } };
        }
        default: throw new Error(`Unknown operation ${op}`);
      }
    },
  },
  {
    type: 'twitchLiveTrigger', palette: 'apps', name: 'Twitch live trigger', glyph: '◘', trigger: true, ports: ['live', 'offline'],
    desc: 'Starts the Sutra when a Twitch channel goes live or ends its stream: to announce it on other networks, post in a chat, or record statistics. Polls while deployed.',
    fields: [
      conn('An OAuth connection with Service twitch.'),
      F('logins', 'Channels (login names, comma separated)', 'text', '', { help: 'Empty = the connected account\'s own channel.' }),
      F('pollSeconds', 'Check every (seconds)', 'number', 60),
      F('testEvent', 'Test event (JSON)', 'code', JSON.stringify({ event: 'live', login: 'ashatraders', name: 'AshaTraders', title: 'Tea tasting: Assam vs Darjeeling', game: 'Food & Drink', viewers: 42, startedAt: '2026-10-19T14:00:00Z', url: 'https://www.twitch.tv/ashatraders' }, null, 2)),
    ],
    outputHint: { event: 'live', login: '', name: '', title: '', game: '', viewers: 0, startedAt: '', url: '' },
    execute: c => { const e = c.input ?? JSON.parse(c.raw('testEvent') || '{}'); return { port: e.event === 'offline' ? 'offline' : 'live', out: e }; },
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

/** Twitch live trigger: polls the channels' streams and fires when one goes live or ends. */
registerListener('twitchLiveTrigger', c => {
  const cfg = c.node.config;
  const every = Math.max(30, Number(cfg.pollSeconds) || 60) * 1000;
  const logins = String(cfg.logins || '').split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean);
  let state: Map<string, boolean> | null = null;
  const H = 'https://api.twitch.tv/helix';
  const tick = async () => {
    try {
      const q = new URLSearchParams(); for (const l of logins) q.append('login', l);
      const users = (await apiCall(cfg.connection, { method: 'GET', url: `${H}/users${logins.length ? `?${q}` : ''}` })).body.data || [];
      const ids = new URLSearchParams(); for (const u of users) ids.append('user_id', u.id);
      const live = users.length ? (await apiCall(cfg.connection, { method: 'GET', url: `${H}/streams?${ids}` })).body.data || [] : [];
      const next = new Map<string, boolean>();
      for (const u of users) {
        const s = live.find((x: any) => x.user_id === u.id);
        next.set(u.id, !!s);
        if (state && state.get(u.id) !== !!s) c.fire({ event: s ? 'live' : 'offline', login: u.login, name: u.display_name, title: s?.title || '', game: s?.game_name || '', viewers: s?.viewer_count || 0, startedAt: s?.started_at || null, url: `https://www.twitch.tv/${u.login}` });
      }
      state = next;
      c.status('ok', `Watching ${users.map((u: any) => u.login).join(', ')}: ${live.length} live`);
    } catch (e: any) {
      c.status('error', e.message);
    }
  };
  tick();
  const t = setInterval(tick, every);
  return () => clearInterval(t);
});

/**
 * A server file to Drive in a resumable upload: the metadata first, then the file streamed to the
 * address Drive gives, so a file of any size is never held in memory. Overwrite replaces the content
 * of a file with the same name in the folder; append is not possible on this path.
 */
async function driveUploadFile(c: ExecCtx) {
  const f = String(c.v('filePath') || '').trim();
  if (!f || !fs.existsSync(f)) throw new Error(`File not found on this server: ${f || '(empty)'}`);
  const size = fs.statSync(f).size;
  const name = String(c.v('name') || '').trim() || path.basename(f);
  const mime = c.raw('mimeType') || 'application/octet-stream';
  const mode = writeMode(c.raw);
  if (mode === 'append') throw new Error('Append is not possible when uploading a server file: choose overwrite or a new file');
  let existing: string | undefined;
  if (mode === 'overwrite') {
    const q = [`name = '${name.replace(/'/g, "\\'")}'`, 'trashed = false', c.v('folderId') ? `'${String(c.v('folderId')).replace(/'/g, "\\'")}' in parents` : ''].filter(Boolean).join(' and ');
    existing = (await call(c, { method: 'GET', url: `${DRIVE}/files`, query: { q, fields: 'files(id)', pageSize: '1' } })).body.files?.[0]?.id;
  }
  const meta: any = existing ? {} : { name, ...(c.v('folderId') ? { parents: [String(c.v('folderId'))] } : {}) };
  if (!existing && c.raw('convert')) meta.mimeType = mime === 'text/csv' ? 'application/vnd.google-apps.spreadsheet' : 'application/vnd.google-apps.document';
  const start = await streamCall(c.raw('connection'), `${DRIVE_UP}/files${existing ? `/${existing}` : ''}?uploadType=resumable&fields=id,name,mimeType,size,webViewLink`, {
    method: existing ? 'PATCH' : 'POST', signal: c.signal, body: JSON.stringify(meta),
    headers: { 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-length': String(size), 'x-upload-content-type': mime },
  });
  const location = start.headers.get('location');
  if (!location) throw new Error('Google Drive did not give an upload address');
  c.log('info', `Uploading ${name} (${(size / 1048576).toFixed(1)} MB) to Google Drive`);
  const up = await streamCall(c.raw('connection'), location, { method: 'PUT', signal: c.signal, body: Readable.toWeb(fs.createReadStream(f)), headers: { 'content-type': mime, 'content-length': String(size) } });
  const r: any = await up.json();
  return { ...r, bytes: size, action: existing ? 'overwritten' : 'created' };
}
