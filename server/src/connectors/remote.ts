/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import crypto from 'node:crypto';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { createRequire } from 'node:module';
import type { Activity, ExecCtx, SchemaHelpers } from '../engine/types.js';
import type { SNode } from '../schemas.js';
import { requireResource, type Resource } from '../resources.js';
import { requireSecret } from '../secrets.js';
import { registerListener } from '../listeners.js';
import { getSetting, setSetting } from '../db.js';
import { F, when, writeFields, writeMode, appended } from '../palettes/common.js';
import { readFields, writeFormatFields, parseValidatedContent, contentShape, buildValidatedContent } from '../palettes/fileformat.js';
import { wildcard, streamFields, streaming, batchShape } from '../palettes/file.js';
import { streamRows } from '../palettes/fileformat.js';
import fs from 'node:fs';
import os from 'node:os';

const require = createRequire(import.meta.url);

/**
 * SFTP / FTP palette: list, read, write, move, copy and delete files on another server, and a trigger
 * that picks up new files. Paths are relative to the connection's base folder and can never leave
 * it. SFTP signs in with a password or a private key from the vault and checks the server's host key
 * fingerprint when one is set; FTP can use explicit or implicit TLS.
 */

export interface Entry { name: string; path: string; size: number; modifiedAt: string; isDir: boolean }
interface Remote {
  base: string; host: string; fingerprint?: string;
  list(dir: string): Promise<Entry[]>;
  get(p: string): Promise<Buffer>;
  put(p: string, data: Buffer): Promise<void>;
  append(p: string, data: Buffer): Promise<void>;
  exists(p: string): Promise<false | 'file' | 'dir'>;
  rename(from: string, to: string): Promise<void>;
  remove(p: string): Promise<void>;
  mkdirp(dir: string): Promise<void>;
  stat(p: string): Promise<Entry>;
  close(): Promise<void>;
}

/** A path inside the base folder (posix); throws when a mapping tries to leave it. */
export function remotePath(base: string, rel: string) {
  const root = path.posix.normalize('/' + String(base || '/').replace(/\\/g, '/')).replace(/\/+$/, '') || '/';
  const full = path.posix.normalize(path.posix.join(root, String(rel || '').replace(/\\/g, '/')));
  if (full !== root && !full.startsWith(root === '/' ? '/' : root + '/')) throw new Error(`Path "${rel}" is outside the base folder ${root}`);
  return full;
}

/** OpenSSH style SHA256 fingerprint of a host key. */
export const fingerprintOf = (key: Buffer) => 'SHA256:' + crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/, '');

/** Time limits of a connection (seconds in the settings; older connections had one timeoutSec). */
export function timingOf(c: Record<string, any>) {
  const n = (v: unknown, d: number, min = 0) => { const x = Number(v); return Number.isFinite(x) && x >= min ? x : d; };
  return {
    connectMs: n(c.connectSec ?? c.timeoutSec, 30, 1) * 1000,
    responseMs: n(c.responseSec, 60, 1) * 1000,
    attempts: Math.min(10, Math.max(1, Math.round(n(c.attempts, 3, 1)))),
    retryWaitMs: n(c.retryWaitSec, 5) * 1000,
    keepaliveMs: n(c.keepaliveSec, 15) * 1000,
  };
}

/** Rejects when work takes longer than ms. */
function limit<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: NodeJS.Timeout;
  return Promise.race([p, new Promise<T>((_r, rej) => { t = setTimeout(() => rej(new Error(`${what} took longer than ${Math.round(ms / 1000)} s (Response time limit of the connection)`)), ms); })]).finally(() => clearTimeout(t));
}

/** Wraps every operation of a connection in its response time limit. */
function timed(x: Remote, ms: number): Remote {
  const w = <A extends unknown[], T>(name: string, f: (...a: A) => Promise<T>) => (...a: A) => limit(f(...a), ms, `${name} ${String(a[0] ?? '')}`.trim());
  return { ...x, list: w('Listing', x.list), get: w('Reading', x.get), put: w('Writing', x.put), append: w('Appending to', x.append), exists: w('Checking', x.exists), rename: w('Renaming', x.rename), remove: w('Deleting', x.remove), mkdirp: w('Creating folder', x.mkdirp), stat: w('Reading details of', x.stat) };
}

/** Sign-in and host key problems are not retried: trying again cannot help. */
const permanent = (e: any) => /host key|authentication|auth|password|login|530|denied|not the expected/i.test(String(e?.message || e));

async function openSftp(r: Resource, secret: (n: string, w?: string) => string): Promise<Remote> {
  const SftpClient = require('ssh2-sftp-client');
  const c = r.config;
  const client = new SftpClient();
  let seen = '';
  const want = String(c.hostFingerprint || '').trim();
  await client.connect({
    host: c.host, port: Number(c.port) || 22, username: c.user, readyTimeout: timingOf(c).connectMs, retries: 0,
    keepaliveInterval: timingOf(c).keepaliveMs, keepaliveCountMax: 4,
    ...(c.auth === 'private key'
      ? { privateKey: secret(c.keySecret, 'Private key'), ...(c.passphraseSecret ? { passphrase: secret(c.passphraseSecret, 'Key passphrase') } : {}) }
      : { password: secret(c.passwordSecret, 'SFTP password') }),
    hostVerifier: (key: Buffer) => { seen = fingerprintOf(key); return !want || want === seen; },
  }).catch((e: any) => {
    if (want && seen && want !== seen) throw new Error(`The server's host key ${seen} is not the expected ${want}`);
    throw e;
  });
  const entry = (dir: string, f: any): Entry => ({ name: f.name, path: path.posix.join(dir, f.name), size: Number(f.size) || 0, modifiedAt: new Date(Number(f.modifyTime) || 0).toISOString(), isDir: f.type === 'd' });
  return {
    base: remotePath(c.baseFolder || '/', ''), host: c.host, fingerprint: seen,
    list: async dir => (await client.list(dir)).filter((f: any) => f.name !== '.' && f.name !== '..').map((f: any) => entry(dir, f)),
    get: async p => client.get(p) as Promise<Buffer>,
    put: async (p, data) => { await client.put(data, p); },
    append: async (p, data) => { await client.append(data, p); },
    exists: async p => { const t = await client.exists(p); return t === 'd' ? 'dir' : t ? 'file' : false; },
    rename: async (a, b) => { await client.rename(a, b); },
    remove: async p => { await client.delete(p); },
    mkdirp: async dir => { if (!(await client.exists(dir))) await client.mkdir(dir, true); },
    stat: async p => { const s = await client.stat(p); return { name: path.posix.basename(p), path: p, size: Number(s.size) || 0, modifiedAt: new Date(Number(s.modifyTime) || 0).toISOString(), isDir: !!s.isDirectory }; },
    close: async () => { await client.end().catch(() => {}); },
  };
}

async function openFtp(r: Resource, secret: (n: string, w?: string) => string): Promise<Remote> {
  const { Client } = require('basic-ftp');
  const c = r.config;
  const client = new Client(timingOf(c).responseMs);
  await limit(client.access({
    host: c.host, port: Number(c.port) || 21, user: c.user || 'anonymous', password: c.passwordSecret ? secret(c.passwordSecret, 'FTP password') : '',
    secure: c.security === 'explicit TLS' ? true : c.security === 'implicit TLS' ? 'implicit' : false,
    secureOptions: { rejectUnauthorized: c.verifyTls !== false },
  }), timingOf(c).connectMs, `Connecting to ${c.host}`).catch((e: any) => { client.close(); throw e; });
  const toBuffer = async (p: string) => {
    const chunks: Buffer[] = [];
    const sink = new PassThrough();
    sink.on('data', d => chunks.push(Buffer.from(d)));
    await client.downloadTo(sink, p);
    return Buffer.concat(chunks);
  };
  const statOf = async (p: string): Promise<Entry | null> => {
    const dir = path.posix.dirname(p), name = path.posix.basename(p);
    const f = (await client.list(dir).catch(() => [])).find((x: any) => x.name === name);
    return f ? { name, path: p, size: Number(f.size) || 0, modifiedAt: (f.modifiedAt ? new Date(f.modifiedAt) : new Date(0)).toISOString(), isDir: !!f.isDirectory } : null;
  };
  return {
    base: remotePath(c.baseFolder || '/', ''), host: c.host,
    list: async dir => (await client.list(dir)).filter((f: any) => f.name !== '.' && f.name !== '..').map((f: any) => ({ name: f.name, path: path.posix.join(dir, f.name), size: Number(f.size) || 0, modifiedAt: (f.modifiedAt ? new Date(f.modifiedAt) : new Date(0)).toISOString(), isDir: !!f.isDirectory })),
    get: toBuffer,
    put: async (p, data) => { await client.uploadFrom(Readable.from(data), p); },
    append: async (p, data) => { await client.appendFrom(Readable.from(data), p); },
    exists: async p => { const s = await statOf(p); return s ? (s.isDir ? 'dir' : 'file') : false; },
    rename: async (a, b) => { await client.rename(a, b); },
    remove: async p => { await client.remove(p); },
    mkdirp: async dir => { await client.ensureDir(dir); await client.cd('/'); },
    stat: async p => { const s = await statOf(p); if (!s) throw new Error(`${p} does not exist`); return s; },
    close: async () => { client.close(); },
  };
}

/** Opens the connection of a step (SFTP or FTP), runs fn, and always closes it. */
export async function withRemote<T>(r: Resource, secret: (n: string, w?: string) => string, fn: (x: Remote) => Promise<T>): Promise<T> {
  const t = timingOf(r.config);
  let x: Remote | undefined, last: any;
  for (let i = 1; i <= t.attempts && !x; i++) {
    try { x = r.kind === 'sftp' ? await openSftp(r, secret) : await openFtp(r, secret); }
    catch (e) {
      last = e;
      if (permanent(e) || i === t.attempts) break;
      await new Promise(res => setTimeout(res, t.retryWaitMs));
    }
  }
  if (!x) throw new Error(`${r.config.host}: ${last?.message || last}${t.attempts > 1 && !permanent(last) ? ` (after ${t.attempts} attempts)` : ''}`);
  const conn = timed(x, t.responseMs);
  try { return await fn(conn); } finally { await x.close(); }
}

/** Test connection: sign in and list the base folder. */
export async function testRemote(r: Resource, secret: (n: string, w?: string) => string) {
  return withRemote(r, secret, async x => {
    const n = (await x.list(x.base)).length;
    return `Signed in to ${x.host}: ${n} entr${n === 1 ? 'y' : 'ies'} in ${x.base}${x.fingerprint ? `. Host key ${x.fingerprint}${r.config.hostFingerprint ? ' (as expected)' : ': put it in Host key fingerprint to check it on every connection'}` : ''}`;
  });
}

// ---------- activities ----------

const PROTOCOLS = ['SFTP', 'FTP'];
const connFields = () => [
  F('protocol', 'Protocol', 'select', 'SFTP', { options: PROTOCOLS }),
  F('sftpConn', 'SFTP connection', 'resource', '', { resourceKind: 'sftp', ...when('protocol', 'SFTP') }),
  F('ftpConn', 'FTP connection', 'resource', '', { resourceKind: 'ftp', ...when('protocol', 'FTP') }),
];
const resourceOf = (c: { raw(k: string): any }) => c.raw('protocol') === 'FTP'
  ? requireResource(String(c.raw('ftpConn') || ''), 'ftp', 'FTP connection')
  : requireResource(String(c.raw('sftpConn') || ''), 'sftp', 'SFTP connection');
const secretOf = (c: ExecCtx) => (n: string, w?: string) => c.secret(n, w);

const info = (e: Entry, base: string, host: string) => ({
  name: path.posix.basename(e.path), path: e.path, relativePath: path.posix.relative(base, e.path), folder: path.posix.dirname(e.path),
  extension: path.posix.extname(e.path).slice(1), size: e.size, modifiedAt: e.modifiedAt, server: host,
});
const infoShape: SNode[] = ['name', 'path', 'relativePath', 'folder', 'extension', 'modifiedAt', 'server'].map(n => ({ name: n, type: n === 'modifiedAt' ? 'date' : 'string' } as SNode)).concat([{ name: 'size', type: 'integer' }]);
const readCfg = (c: { raw(k: string): any }) => ({ strictValidation: c.raw('strictValidation'), schema: c.raw('schema'), format: c.raw('format') || 'text', encoding: c.raw('encoding'), delimiter: c.raw('delimiter'), header: c.raw('header'), skipRows: c.raw('skipRows'), trimValues: c.raw('trimValues'), decimal: c.raw('decimal') });
const schemaOf = (c: { schemaTree(k: string): SNode | null }) => { try { return c.schemaTree('schema'); } catch { return null; } };
const shape = (h: SchemaHelpers, cfg: Record<string, any>, extra: SNode[] = []): SNode => ({ name: 'out', type: 'object', children: [...extra, ...infoShape, ...contentShape(cfg, h.schema(cfg.schema))] });

/** Files of a folder (and sub-folders up to 5 levels), matching a pattern. */
async function listMatching(x: Remote, dir: string, pattern: string, recursive: boolean) {
  const match = wildcard(pattern || '*');
  const out: Entry[] = [];
  const walk = async (d: string, depth: number) => {
    for (const e of await x.list(d)) {
      if (e.isDir) { if (recursive && depth < 5) await walk(e.path, depth + 1); continue; }
      if (match(e.name)) out.push(e);
    }
  };
  await walk(dir, 0);
  return out;
}

export const remoteActivities: Activity[] = [
  {
    type: 'remoteTrigger', palette: 'remote', name: 'Remote file trigger', glyph: '⇣', trigger: true, ports: ['out'], timeoutMs: 600000,
    desc: 'Starts the Sutra for each new file in a folder on an SFTP or FTP server (polling while deployed). After a successful run the file is deleted, moved, or left and remembered.',
    fields: [
      ...connFields(),
      F('folder', 'Folder (relative to the base folder)', 'text', 'inbox', { help: 'May use {{gv.REMOTE_INBOX}}.' }),
      F('pattern', 'File name pattern', 'text', '*.csv', { help: 'Wildcards * and ?; several separated by commas.' }),
      F('pollSeconds', 'Check every (seconds)', 'number', 60),
      F('after', 'After a successful run', 'select', 'move to a folder', { options: ['move to a folder', 'delete', 'leave and remember'] }),
      F('moveTo', 'Move to folder', 'text', 'inbox/done', { ...when('after', 'move to a folder'), help: 'Relative to the base folder; created when missing.' }),
      ...readFields({ allowNone: true }),
      F('maxMb', 'Maximum size to read (MB)', 'number', 50),
      F('testEvent', 'Test event (JSON)', 'code', '{\n  "name": "orders.csv",\n  "path": "/data/inbox/orders.csv",\n  "relativePath": "inbox/orders.csv",\n  "size": 120,\n  "server": "sftp.example.com",\n  "rows": [{ "id": "A-1", "amount": 300 }]\n}'),
    ],
    outputSchema: (cfg, h) => shape(h, cfg),
    execute: async c => {
      const value = c.input ?? JSON.parse(c.raw('testEvent') || '{}');
      const { validateFileEvent } = await import('../palettes/fileformat.js');
      await validateFileEvent(c, value);
      return { out: value };
    },
  },
  {
    type: 'remoteList', palette: 'remote', name: 'List remote files', glyph: '☰', ports: ['out', 'empty'], timeoutMs: 600000,
    desc: 'Lists files in a folder on an SFTP or FTP server, optionally reading each one. Gives a repeating list of files; no match goes to empty.',
    fields: [
      ...connFields(),
      F('folder', 'Folder (relative to the base folder)', 'text', 'inbox', { tpl: true }),
      F('pattern', 'File name pattern', 'text', '*'),
      F('recursive', 'Include sub-folders', 'bool', false),
      F('sort', 'Order', 'select', 'name', { options: ['name', 'oldest first', 'newest first', 'largest first'] }),
      F('max', 'Maximum files', 'number', 1000),
      ...readFields({ allowNone: true }),
    ],
    outputSchema: (cfg, h) => ({ name: 'out', type: 'object', children: [{ name: 'files', type: 'object', repeats: true, children: [...infoShape, ...contentShape(cfg, h.schema(cfg.schema))] }, { name: 'count', type: 'integer' }, { name: 'folder', type: 'string' }] }),
    execute: async c => withRemote(resourceOf(c), secretOf(c), async x => {
      const dir = remotePath(x.base, String(c.v('folder') ?? ''));
      let files = await listMatching(x, dir, String(c.raw('pattern') || '*'), !!c.raw('recursive'));
      const order = c.raw('sort') || 'name';
      files.sort((a, b) => order === 'oldest first' ? a.modifiedAt.localeCompare(b.modifiedAt) : order === 'newest first' ? b.modifiedAt.localeCompare(a.modifiedAt) : order === 'largest first' ? b.size - a.size : a.name.localeCompare(b.name));
      files = files.slice(0, Number(c.raw('max')) || 1000);
      const cfg = { ...readCfg(c), format: c.raw('format') || 'do not read' };
      const out = [];
      for (const f of files) out.push({ ...info(f, x.base, x.host), ...(cfg.format === 'do not read' ? {} : await parseValidatedContent(await x.get(f.path), cfg, schemaOf(c))) });
      return { port: out.length ? 'out' : 'empty', out: { files: out, count: out.length, folder: dir } };
    }),
  },
  {
    type: 'remoteRead', palette: 'remote', name: 'Read remote file', glyph: '⇩', ports: cfg => (streaming(cfg) ? ['batch', 'out'] : ['out']), timeoutMs: 600000,
    desc: 'Reads a file from an SFTP or FTP server as text, CSV rows, lines, JSON, XML or base64 bytes. Big CSV and line files can be streamed in batches.',
    fields: [...connFields(), F('path', 'File (relative to the base folder)', 'text', 'inbox/{{input.name}}', { tpl: true }), ...readFields(), ...streamFields(), F('maxMb', 'Maximum size (MB)', 'number', 50, { help: 'Files read whole are held in memory. For bigger CSV or line files, stream them in batches.' })],
    outputSchema: (cfg, h) => (streaming(cfg) ? { name: 'out', type: 'object', children: [...batchShape(h, cfg).children!, { name: 'batches', type: 'integer' }, { name: 'streamed', type: 'boolean' }] } : shape(h, cfg)),
    execute: async c => withRemote(resourceOf(c), secretOf(c), async x => {
      const p = remotePath(x.base, String(c.v('path') ?? ''));
      const st = await x.stat(p);
      if (streaming({ format: c.raw('format'), stream: c.raw('stream') })) {
        // Downloaded to a temporary file, then read piece by piece: one batch of rows in memory at a time.
        const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-remote-')), 'file');
        try {
          fs.writeFileSync(tmp, await x.get(p));
          const file = info(st, x.base, x.host);
          const r = await streamRows(tmp, readCfg(c), schemaOf(c), Number(c.raw('batchSize')) || 1000, (rows, batch) => c.emit('batch', { rows, batch, count: rows.length, file }), c.signal);
          return { port: 'out', out: { ...file, ...r, streamed: true } };
        } finally { fs.rmSync(path.dirname(tmp), { recursive: true, force: true }); }
      }
      const max = (Number(c.raw('maxMb')) || 50) * 1048576;
      if (st.size > max) throw new Error(`${st.name} is larger than ${Math.round(max / 1048576)} MB`);
      return { out: { ...info(st, x.base, x.host), ...await parseValidatedContent(await x.get(p), readCfg(c), schemaOf(c)) } };
    }),
  },
  {
    type: 'remoteWrite', palette: 'remote', name: 'Write remote file', glyph: '⇧', ports: ['out'], timeoutMs: 600000,
    desc: 'Writes text, CSV built from rows, lines, JSON, XML or bytes to a file on an SFTP or FTP server; appends or overwrites; creates folders as needed.',
    fields: [...connFields(), F('path', 'File (relative to the base folder)', 'text', "=concat('outbox/report-', current-timestamp('YYYYMMDD'), '.csv')", { tpl: true }), ...writeFormatFields(), ...writeFields()],
    outputSchema: () => ({ name: 'out', type: 'object', children: [...infoShape, { name: 'action', type: 'string', enum: ['created', 'overwritten', 'appended'] }, { name: 'bytesWritten', type: 'integer' }] }),
    execute: async c => withRemote(resourceOf(c), secretOf(c), async x => {
      const p = remotePath(x.base, String(c.v('path') ?? ''));
      const data = await buildValidatedContent(c, schemaOf(c));
      await x.mkdirp(path.posix.dirname(p));
      const mode = writeMode(c.raw);
      const exists = await x.exists(p);
      if (exists === 'dir') throw new Error(`${p} is a folder`);
      if (mode === 'fail' && exists) throw new Error(`${p} already exists (Overwrite and Append are off)`);
      if (mode === 'append' && exists) {
        // A line break first when asked and the file does not end with one.
        const add = c.raw('newline') !== false ? appended(Buffer.from((await x.get(p)).subarray(-1)), data, true).subarray(1) : data;
        await x.append(p, add);
      } else await x.put(p, data);
      return { out: { ...info(await x.stat(p), x.base, x.host), action: !exists ? 'created' : mode === 'append' ? 'appended' : 'overwritten', bytesWritten: data.length } };
    }),
  },
  {
    type: 'remoteMove', palette: 'remote', name: 'Move / copy / delete remote file', glyph: '⇄', ports: ['out'], timeoutMs: 600000,
    desc: 'Moves (renames), copies or deletes a file on an SFTP or FTP server, inside the base folder.',
    fields: [
      ...connFields(),
      F('action', 'Action', 'select', 'move', { options: ['move', 'copy', 'delete'] }),
      F('from', 'File', 'text', 'inbox/{{input.name}}', { tpl: true }),
      F('to', 'To', 'text', "=concat('inbox/done/', {input.name})", { tpl: true, ...when('action', 'move', 'copy') }),
      F('overwrite', 'Overwrite the target if it exists', 'bool', true, when('action', 'move', 'copy')),
    ],
    outputSchema: () => ({ name: 'out', type: 'object', children: [...infoShape, { name: 'action', type: 'string', enum: ['moved', 'copied', 'deleted'] }, { name: 'from', type: 'string' }, { name: 'to', type: 'string' }] }),
    execute: async c => withRemote(resourceOf(c), secretOf(c), async x => {
      const from = remotePath(x.base, String(c.v('from') ?? ''));
      const st = await x.stat(from);
      if (c.raw('action') === 'delete') { await x.remove(from); return { out: { ...info(st, x.base, x.host), action: 'deleted', from, to: '' } }; }
      const to = remotePath(x.base, String(c.v('to') ?? ''));
      if (await x.exists(to)) {
        if (c.raw('overwrite') === false) throw new Error(`${to} already exists`);
        await x.remove(to);
      }
      await x.mkdirp(path.posix.dirname(to));
      if (c.raw('action') === 'copy') await x.put(to, await x.get(from)); else await x.rename(from, to);
      return { out: { ...info(await x.stat(to), x.base, x.host), action: c.raw('action') === 'copy' ? 'copied' : 'moved', from, to } };
    }),
  },
];

// ---------- trigger: poll for new files ----------

registerListener('remoteTrigger', ctx => {
  const cfg = ctx.node.config;
  const r = cfg.protocol === 'FTP' ? requireResource(String(cfg.ftpConn || ''), 'ftp', 'FTP connection') : requireResource(String(cfg.sftpConn || ''), 'sftp', 'SFTP connection');
  const secret = (n: string, w?: string) => requireSecret(n, w);
  const key = `remote.seen.${ctx.flowId}.${ctx.node.id}`;
  const pending = new Map<string, string>(); // path -> size|mtime seen on the previous poll
  const inFlight = new Set<string>();
  let stopped = false, busy = false;
  const poll = async () => {
    if (stopped || busy) return;
    busy = true;
    try {
      await withRemote(r, secret, async x => {
        const dir = remotePath(x.base, String(cfg.folder || ''));
        const seen = new Set(getSetting<string[]>(key, []));
        const files = await listMatching(x, dir, String(cfg.pattern || '*'), false);
        for (const f of files) {
          const sig = `${f.size}|${f.modifiedAt}`;
          if (inFlight.has(f.path) || seen.has(`${f.path}|${sig}`)) continue;
          // Only a file that did not change since the previous poll is complete.
          if (pending.get(f.path) !== sig) { pending.set(f.path, sig); continue; }
          pending.delete(f.path);
          const max = (Number(cfg.maxMb) || 50) * 1048576;
          const read = cfg.format && cfg.format !== 'do not read' && f.size <= max ? await parseValidatedContent(await x.get(f.path), cfg, null) : {};
          inFlight.add(f.path);
          if (cfg.after === 'leave and remember') { seen.add(`${f.path}|${sig}`); setSetting(key, [...seen].slice(-5000)); }
          ctx.fire({ ...info(f, x.base, x.host), ...read }, (status) => {
            inFlight.delete(f.path);
            if (status !== 'done' || cfg.after === 'leave and remember') return;
            withRemote(r, secret, async y => {
              if (cfg.after === 'delete') await y.remove(f.path);
              else {
                const to = remotePath(y.base, path.posix.join(String(cfg.moveTo || 'done'), path.posix.basename(f.path)));
                await y.mkdirp(path.posix.dirname(to));
                if (await y.exists(to)) await y.remove(to);
                await y.rename(f.path, to);
              }
            }).catch(e => ctx.status('error', `After the run: ${e.message}`));
          });
        }
      });
      ctx.status('ok', 'Listening');
    } catch (e: any) {
      ctx.status('error', e.message);
    } finally { busy = false; }
  };
  const t = setInterval(poll, Math.max(1, Number(cfg.pollSeconds) || 60) * 1000);
  poll();
  return () => { stopped = true; clearInterval(t); };
});
