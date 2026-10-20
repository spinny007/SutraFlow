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
import fs from 'node:fs';
import path from 'node:path';
import { q, now } from '../db.js';
import { asyncDatabase } from '../asyncdb.js';
import { config } from '../config.js';
import { requireResource, type Resource } from '../resources.js';
import { httpCall } from '../security/outbound.js';
import { engineOf, rootOf, NEEDS_KEY } from './providers.js';
import { dbConnection } from '../connectors/db.js';
import { tokensOf } from './memory.js';

/**
 * Knowledge bases: text split into chunks, each kept with a vector (embedding), so an agent can find
 * passages by meaning as well as by words. Vectors come from an AI provider (Ollama, OpenAI, Gemini or
 * an OpenAI-compatible server) or, offline and with no model, from the built-in word vectors.
 * Chunks live in SutraFlow's own database or in a folder; search compares vectors in the server.
 */
type Secret = (name: string, what?: string) => string;
export interface Chunk { id: string; source: string; chunk: number; text: string; meta: Record<string, any>; vector: number[]; at: string }
export interface Hit { text: string; source: string; chunk: number; meta: Record<string, any>; score: number }

/** Splits text into chunks of about size tokens, on paragraph and sentence ends, overlapping by overlap tokens. */
export function chunkText(text: string, size = 300, overlap = 40) {
  const maxChars = Math.max(200, size * 4), back = Math.max(0, overlap * 4);
  const parts = String(text || '').replace(/\r\n/g, '\n').split(/\n{2,}|(?<=[.!?])\s+(?=[A-Z0-9"'(])/).map(s => s.trim()).filter(Boolean);
  const out: string[] = [];
  let cur = '';
  for (const p of parts) {
    if (cur && (cur.length + p.length + 1) > maxChars) {
      out.push(cur);
      cur = back ? cur.slice(-back).replace(/^\S*\s/, '') : '';
    }
    for (let s = p; s.length; ) {
      const room = maxChars - cur.length;
      if (s.length <= room || !cur) { const take = s.slice(0, maxChars); cur = cur ? `${cur} ${take}` : take; s = s.slice(take.length); if (s.length) { out.push(cur); cur = ''; } }
      else { out.push(cur); cur = ''; }
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** A light English stem, so "returns", "returned" and "returning" meet "return". */
const stem = (w: string) => (w.length > 5 && w.endsWith('ing') ? w.slice(0, -3) : w.length > 4 && w.endsWith('ed') ? w.slice(0, -2) : w.length > 4 && w.endsWith('es') ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
const words = (t: string) => (String(t).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').match(/[\p{L}\p{N}]+/gu) || ([] as string[])).map(stem);
const STOP = new Set('a an and are as at be but by can could did do doe does for from had has have how i if in into is it its me my of on or our so than that the their them then there these they this to us was we were what when where which who why will with would you your'.split(' '));

/** Built-in word vectors: words and word pairs hashed into 512 numbers. No model, works offline; finds shared words, not synonyms. */
export function builtInVector(text: string, dims = 512) {
  const v = new Array(dims).fill(0);
  const w = words(text).filter(x => !STOP.has(x));
  const add = (tok: string, weight: number) => { const h = crypto.createHash('md5').update(tok).digest(); v[h.readUInt32BE(0) % dims] += (h[4] & 1 ? 1 : -1) * weight; };
  w.forEach((x, i) => { add(x, 1); if (x.length > 5) add(x.slice(0, 5), 0.5); if (i) add(`${w[i - 1]} ${x}`, 0.7); });
  const n = Math.hypot(...v) || 1;
  return v.map(x => x / n);
}

/** Vectors for texts from the knowledge base's AI provider, or the built-in word vectors. */
export async function embed(kb: Resource, secret: Secret, texts: string[], signal?: AbortSignal): Promise<{ vectors: number[][]; model: string }> {
  if ((kb.config.embedWith || 'built-in') === 'built-in') {
    // A long document has thousands of passages: made in slices, so the engine keeps serving meanwhile.
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += 200) {
      if (signal?.aborted) throw new Error('Step was cancelled');
      for (const t of texts.slice(i, i + 200)) vectors.push(builtInVector(t));
      await new Promise(r => setImmediate(r));
    }
    return { vectors, model: 'built-in word vectors' };
  }
  const p = requireResource(String(kb.config.provider || ''), 'aiProvider', 'AI provider for vectors');
  return embedWith(p, secret, String(kb.config.embedModel || ''), texts, signal);
}

export async function embedWith(p: Resource, secret: Secret, model: string, texts: string[], signal?: AbortSignal): Promise<{ vectors: number[][]; model: string }> {
  const engine = engineOf(p);
  const base = rootOf(p);
  const m = model || String(p.config.model || '');
  const key = () => secret(p.config.apiKeySecret, `${engine} API key`);
  const post = async (url: string, headers: Record<string, string>, body: unknown) => {
    const res = await httpCall({ method: 'POST', url, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), timeoutMs: 300000, signal, parse: 'json', retryReset: true });
    if (res.status >= 400) throw new Error(`${engine} vectors error ${res.status}: ${String(res.body?.error?.message || res.body?.error || JSON.stringify(res.body)).slice(0, 300)}`);
    return res.body;
  };
  if (!texts.length) return { vectors: [], model: m };
  if (engine === 'Ollama') {
    if (!m) throw new Error('Set the vector model, for example nomic-embed-text (ollama pull nomic-embed-text)');
    const b = await post(`${base}/api/embed`, {}, { model: m, input: texts });
    return { vectors: b.embeddings, model: b.model || m };
  }
  if (engine === 'Gemini API') {
    const gm = m || 'gemini-embedding-001';
    const b = await post(`${base}/v1beta/models/${encodeURIComponent(gm)}:batchEmbedContents`, { 'x-goog-api-key': key() }, { requests: texts.map(t => ({ model: `models/${gm}`, content: { parts: [{ text: t }] } })) });
    return { vectors: b.embeddings.map((e: any) => e.values), model: gm };
  }
  if ((['OpenAI API', 'LM Studio', 'Hugging Face', 'Hugging Face TGI (local)', 'OpenAI-compatible server'] as string[]).includes(engine)) {
    const om = m || (engine === 'OpenAI API' ? 'text-embedding-3-small' : '');
    if (!om) throw new Error('Set the vector model of the knowledge base');
    const b = await post(`${base}/embeddings`, NEEDS_KEY.includes(engine) || p.config.apiKeySecret ? { authorization: `Bearer ${key()}` } : {}, { model: om, input: texts });
    return { vectors: b.data.sort((a: any, z: any) => a.index - z.index).map((d: any) => d.embedding), model: b.model || om };
  }
  throw new Error(`${engine} does not make vectors. Use Ollama, OpenAI, Gemini or an OpenAI-compatible server for vectors, or the built-in word vectors.`);
}

const cosine = (a: number[], b: number[]) => {
  if (a.length !== b.length) return 0;
  let d = 0, x = 0, y = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; }
  return x && y ? d / Math.sqrt(x * y) : 0;
};

/** Which passages a call is about: one source (or a folder of sources), details, or everything. */
interface Filter { source?: string; meta?: Record<string, string>; all?: boolean }
/** Where the passages are kept. Vector databases search on their side and return their best candidates. */
interface Store {
  add(chunks: Chunk[]): Promise<void>;
  remove(f: Filter): Promise<number>;
  candidates(vector: number[], k: number, f: Filter): Promise<(Chunk & { vscore?: number })[]>;
  list(f: Filter): Promise<Chunk[]>;
}
const inSource = (source: string, s?: string) => !s || source === s || source.startsWith(s + '/');
const matches = (c: Chunk, f: Filter) => inSource(c.source, f.source) && Object.entries(f.meta || {}).every(([k, v]) => String(c.meta?.[k] ?? '') === String(v));
/** "Policies/HR/Leave.docx" -> ["Policies", "Policies/HR"]: lets vector databases filter by folder. */
const dirsOf = (source: string) => source.split('/').slice(0, -1).map((_x, i, a) => a.slice(0, i + 1).join('/'));
const metaKey = (k: string) => { if (!/^\w{1,40}$/.test(k)) throw new Error(`Detail names may use letters, digits and _ only: ${k}`); return k; };

function localStore(kb: Resource): Store {
  let read: () => Chunk[], write: (cs: Chunk[]) => void, append: (cs: Chunk[]) => void;
  if ((kb.config.store || 'built-in') === 'folder') {
    const dir = String(kb.config.folder || '').trim() || path.join('knowledge', kb.id);
    const file = path.join(path.isAbsolute(dir) ? dir : path.join(config.dataDir, dir), 'chunks.jsonl');
    read = () => { try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
    write = cs => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, cs.map(c => JSON.stringify(c)).join('\n') + (cs.length ? '\n' : '')); };
    append = cs => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.appendFileSync(file, cs.map(c => JSON.stringify(c) + '\n').join('')); };
  } else {
    // In the database, through the connection pool and in batches: a document of many passages does
    // not hold the engine while it is written.
    const db = asyncDatabase();
    // A source and the sources in its folder ("Policies" and "Policies/..."), with LIKE wildcards escaped.
    const inFolder = ` and (source = ? or source like ? escape '\\')`;
    const folderOf = (src: string) => [src, `${src.replace(/[\\%_]/g, '\\$&')}/%`];
    const rows = async (f: Filter) => {
      const src = f.source && !f.all ? f.source : '';
      const list = await db.all<any>(`select id, source, chunk, text, meta, vector, at from ai_knowledge where kb_id = ?${src ? inFolder : ''}`, kb.id, ...(src ? folderOf(src) : []));
      return list.map((r: any) =>({ id: r.id, source: r.source, chunk: Number(r.chunk), text: r.text, meta: r.meta ? JSON.parse(r.meta) : {}, vector: r.vector ? JSON.parse(r.vector) : [], at: r.at }) as Chunk).filter(c => matches(c, f));
    };
    const insert = async (cs: Chunk[]) => {
      for (let i = 0; i < cs.length; i += 200) {
        const part = cs.slice(i, i + 200);
        await db.run(`insert into ai_knowledge(kb_id, id, source, chunk, text, meta, vector, at) values ${part.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
          ...part.flatMap(c => [kb.id, c.id, c.source, c.chunk, c.text, JSON.stringify(c.meta), JSON.stringify(c.vector), c.at]));
      }
    };
    return {
      add: insert,
      remove: async f => {
        if (f.all) return (await db.run('delete from ai_knowledge where kb_id = ?', kb.id)).changes;
        if (!f.source) return 0;
        return (await db.run(`delete from ai_knowledge where kb_id = ?${inFolder}`, kb.id, ...folderOf(f.source))).changes;
      },
      candidates: async (_v, _k, f) => rows(f),
      list: async f => rows(f),
    };
  }
  return {
    add: async cs => append(cs),
    remove: async f => { const cs = read(); const keep = cs.filter(c => !(f.all || (f.source && inSource(c.source, f.source)))); if (keep.length !== cs.length) write(keep); return cs.length - keep.length; },
    candidates: async (_v, _k, f) => read().filter(c => matches(c, f)),
    list: async f => read().filter(c => matches(c, f)),
  };
}

/** PostgreSQL with pgvector: one table, cosine distance in the database. */
function pgStore(kb: Resource, secret: Secret): Store {
  const dbRes = requireResource(String(kb.config.database || ''), 'database', 'Database connection of the knowledge base');
  if (dbRes.config.driver !== 'postgres') throw new Error('pgvector needs a PostgreSQL connection');
  const t = String(kb.config.table || 'sutra_knowledge').replace(/[^\w]/g, '');
  const db = () => dbConnection(dbRes, secret);
  let ready = false;
  const ensure = async (dim: number) => {
    if (ready) return;
    const c = await db();
    // Making the extension needs rights; it may already be there, so only a missing type is an error.
    const ext = await c.query('CREATE EXTENSION IF NOT EXISTS vector', {}).then(() => '', (e: any) => String(e.message));
    await c.query(`CREATE TABLE IF NOT EXISTS ${t} (id TEXT PRIMARY KEY, kb_id TEXT NOT NULL, source TEXT NOT NULL, chunk INTEGER NOT NULL, text TEXT NOT NULL, meta JSONB, embedding vector(${dim}), at TEXT NOT NULL)`, {})
      .catch((e: any) => { throw new Error(/type "vector" does not exist/.test(e.message) ? `The pgvector extension is not installed in this database${ext ? ` (${ext})` : ''}. Run CREATE EXTENSION vector as an administrator.` : e.message); });
    await c.query(`CREATE INDEX IF NOT EXISTS ${t}_kb ON ${t} (kb_id, source)`, {});
    ready = true;
  };
  /** The table is made by the first add; before that, reads find nothing (without an error). */
  const exists = async () => ready || !!(await (await db()).query('SELECT to_regclass(:t) AS t', { t })).rows[0]?.t;
  const where = (f: Filter, p: Record<string, any>) => {
    const w = ['kb_id = :kb'];
    p.kb = kb.id;
    if (f.source) { w.push('(source = :src OR source LIKE :srcdir)'); p.src = f.source; p.srcdir = f.source.replace(/[\\%_]/g, '\\$&') + '/%'; }
    Object.entries(f.meta || {}).forEach(([k, v], i) => { w.push(`meta->>'${metaKey(k)}' = :m${i}`); p[`m${i}`] = String(v); });
    return w.join(' AND ');
  };
  const row = (r: any): Chunk & { vscore?: number } => ({ id: r.id, source: r.source, chunk: Number(r.chunk), text: r.text, meta: typeof r.meta === 'string' ? JSON.parse(r.meta) : r.meta || {}, vector: [], at: r.at, ...(r.score != null ? { vscore: Number(r.score) } : {}) });
  return {
    add: async cs => { if (!cs.length) return; await ensure(cs[0].vector.length); const c = await db(); for (const x of cs) await c.query(`INSERT INTO ${t} (id, kb_id, source, chunk, text, meta, embedding, at) VALUES (:id, :kb, :s, :n, :t, :m::jsonb, :e::vector, :at)`, { id: x.id, kb: kb.id, s: x.source, n: x.chunk, t: x.text, m: JSON.stringify(x.meta), e: JSON.stringify(x.vector), at: x.at }); },
    remove: async f => { if (!await exists()) return 0; const p: Record<string, any> = {}; return (await (await db()).query(`DELETE FROM ${t} WHERE ${f.all ? 'kb_id = :kb' : where({ source: f.source }, p)}`, f.all ? { kb: kb.id } : p)).rowCount; },
    candidates: async (v, k, f) => { if (!await exists()) return []; const p: Record<string, any> = { e: JSON.stringify(v), k }; return (await (await db()).query(`SELECT id, source, chunk, text, meta, at, 1 - (embedding <=> :e::vector) AS score FROM ${t} WHERE ${where(f, p)} ORDER BY embedding <=> :e::vector LIMIT :k`, p)).rows.map(row); },
    list: async f => { if (!await exists()) return []; const p: Record<string, any> = {}; return (await (await db()).query(`SELECT id, source, chunk, text, meta, at FROM ${t} WHERE ${where(f, p)} ORDER BY source, chunk`, p)).rows.map(row); },
  };
}

/** A JSON request to a vector database. */
async function vdb(url: string, method: string, headers: Record<string, string>, body?: unknown, signal?: AbortSignal) {
  const res = await httpCall({ method, url, headers: { 'content-type': 'application/json', accept: 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body), timeoutMs: 120000, signal, parse: 'json' });
  return res;
}
const must = async (p: Promise<any>, what: string) => { const r = await p; if (r.status >= 400) throw new Error(`${what} failed (${r.status}): ${String(typeof r.body === 'object' ? r.body?.status?.error || r.body?.error || r.body?.message || JSON.stringify(r.body) : r.body).slice(0, 300)}`); return r.body; };

function qdrantStore(kb: Resource, secret: Secret): Store {
  const base = String(kb.config.url || 'http://127.0.0.1:6333').replace(/\/+$/, '');
  const col = encodeURIComponent(String(kb.config.collection || 'sutra_knowledge'));
  const h: Record<string, string> = kb.config.apiKeySecret ? { 'api-key': secret(kb.config.apiKeySecret, 'Qdrant API key') } : {};
  let ready = false;
  const ensure = async (dim: number) => {
    if (ready) return;
    const r = await vdb(`${base}/collections/${col}`, 'GET', h);
    if (r.status === 404) await must(vdb(`${base}/collections/${col}`, 'PUT', h, { vectors: { size: dim, distance: 'Cosine' } }), 'Creating the Qdrant collection');
    else if (r.status >= 400) throw new Error(`Qdrant ${base}: ${r.status}`);
    ready = true;
  };
  const filter = (f: Filter) => ({ must: [{ key: 'kb', match: { value: kb.id } }, ...(f.source ? [{ should: [{ key: 'source', match: { value: f.source } }, { key: 'dirs', match: { value: f.source } }] }] : []), ...Object.entries(f.meta || {}).map(([k, v]) => ({ key: `meta.${metaKey(k)}`, match: { value: String(v) } }))] });
  const chunk = (p: any, score?: number): Chunk & { vscore?: number } => ({ id: '', source: p.source, chunk: Number(p.chunk), text: p.text, meta: p.meta || {}, vector: [], at: p.at, ...(score != null ? { vscore: score } : {}) });
  const count = async (f: Filter) => { const r = await vdb(`${base}/collections/${col}/points/count`, 'POST', h, { filter: filter(f), exact: true }); return r.status === 404 ? 0 : Number(r.body?.result?.count || 0); };
  return {
    add: async cs => { if (!cs.length) return; await ensure(cs[0].vector.length); for (let i = 0; i < cs.length; i += 100) await must(vdb(`${base}/collections/${col}/points?wait=true`, 'PUT', h, { points: cs.slice(i, i + 100).map(c => ({ id: c.id, vector: c.vector, payload: { kb: kb.id, source: c.source, dirs: dirsOf(c.source), chunk: c.chunk, text: c.text, meta: c.meta, at: c.at } })) }), 'Adding to Qdrant'); },
    remove: async f => { const n = await count(f.all ? {} : { source: f.source }); if (n) await must(vdb(`${base}/collections/${col}/points/delete?wait=true`, 'POST', h, { filter: filter(f.all ? {} : { source: f.source }) }), 'Removing from Qdrant'); return n; },
    candidates: async (v, k, f) => { await ensure(v.length); const b = await must(vdb(`${base}/collections/${col}/points/search`, 'POST', h, { vector: v, limit: k, filter: filter(f), with_payload: true }), 'Searching Qdrant'); return (b.result || []).map((x: any) => chunk(x.payload, x.score)); },
    list: async f => {
      const out: Chunk[] = [];
      let offset: any = null;
      for (let i = 0; i < 1000; i++) {
        const r = await vdb(`${base}/collections/${col}/points/scroll`, 'POST', h, { filter: filter(f), limit: 256, with_payload: true, ...(offset != null ? { offset } : {}) });
        if (r.status === 404) return [];
        out.push(...(r.body?.result?.points || []).map((x: any) => chunk(x.payload)));
        offset = r.body?.result?.next_page_offset;
        if (offset == null) break;
      }
      return out;
    },
  };
}

function chromaStore(kb: Resource, secret: Secret): Store {
  const root = `${String(kb.config.url || 'http://127.0.0.1:8000').replace(/\/+$/, '')}/api/v2/tenants/default_tenant/databases/default_database`;
  const h: Record<string, string> = kb.config.apiKeySecret ? { 'x-chroma-token': secret(kb.config.apiKeySecret, 'Chroma API key') } : {};
  let id = '';
  const col = async () => { if (!id) id = (await must(vdb(`${root}/collections`, 'POST', h, { name: String(kb.config.collection || 'sutra_knowledge'), get_or_create: true, metadata: { 'hnsw:space': 'cosine' } }), 'Opening the Chroma collection')).id; return `${root}/collections/${id}`; };
  const where = (f: Filter) => {
    const parts: any[] = [{ kb: { $eq: kb.id } }];
    if (f.source) parts.push({ $or: [{ source: { $eq: f.source } }, ...[0, 1, 2, 3].map(i => ({ [`dir${i}`]: { $eq: f.source } }))] });
    for (const [k, v] of Object.entries(f.meta || {})) parts.push({ [`m_${metaKey(k)}`]: { $eq: String(v) } });
    return parts.length === 1 ? parts[0] : { $and: parts };
  };
  const meta = (c: Chunk) => ({ kb: kb.id, source: c.source, chunk: c.chunk, at: c.at, ...Object.fromEntries(dirsOf(c.source).slice(0, 4).map((d, i) => [`dir${i}`, d])), ...Object.fromEntries(Object.entries(c.meta || {}).map(([k, v]) => [`m_${metaKey(k)}`, String(v)])) });
  const back = (doc: string, m: any, score?: number): Chunk & { vscore?: number } => ({ id: '', source: m.source, chunk: Number(m.chunk), text: doc, at: m.at, vector: [], meta: Object.fromEntries(Object.entries(m).filter(([k]) => k.startsWith('m_')).map(([k, v]) => [k.slice(2), v])), ...(score != null ? { vscore: score } : {}) });
  const get = async (f: Filter, include: string[]) => (await must(vdb(`${await col()}/get`, 'POST', h, { where: where(f), include }), 'Reading Chroma'));
  return {
    add: async cs => { for (let i = 0; i < cs.length; i += 100) { const b = cs.slice(i, i + 100); await must(vdb(`${await col()}/add`, 'POST', h, { ids: b.map(c => c.id), embeddings: b.map(c => c.vector), documents: b.map(c => c.text), metadatas: b.map(meta) }), 'Adding to Chroma'); } },
    remove: async f => { const ff = f.all ? {} : { source: f.source }; const n = ((await get(ff, [])).ids || []).length; if (n) await must(vdb(`${await col()}/delete`, 'POST', h, { where: where(ff) }), 'Removing from Chroma'); return n; },
    candidates: async (v, k, f) => { const b = await must(vdb(`${await col()}/query`, 'POST', h, { query_embeddings: [v], n_results: k, where: where(f), include: ['documents', 'metadatas', 'distances'] }), 'Searching Chroma'); return (b.ids?.[0] || []).map((_x: string, i: number) => back(b.documents[0][i], b.metadatas[0][i], 1 - Number(b.distances[0][i]))); },
    list: async f => { const b = await get(f, ['documents', 'metadatas']); return (b.ids || []).map((_x: string, i: number) => back(b.documents[i], b.metadatas[i])); },
  };
}

function pineconeStore(kb: Resource, secret: Secret): Store {
  const host = String(kb.config.url || '').replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(host)) throw new Error('Set the Pinecone index host, for example https://<index>-<project>.svc.<region>.pinecone.io');
  const h = { 'Api-Key': secret(kb.config.apiKeySecret, 'Pinecone API key'), 'X-Pinecone-API-Version': '2025-04' };
  const ns = String(kb.config.namespace || '');
  const prefix = `${kb.id}#`;
  const filter = (f: Filter) => {
    const parts: any[] = [{ kb: { $eq: kb.id } }];
    if (f.source) parts.push({ $or: [{ source: { $eq: f.source } }, { dirs: { $in: [f.source] } }] });
    for (const [k, v] of Object.entries(f.meta || {})) parts.push({ [`m_${metaKey(k)}`]: { $eq: String(v) } });
    return { $and: parts };
  };
  const back = (m: any, score?: number): Chunk & { vscore?: number } => ({ id: '', source: m.source, chunk: Number(m.chunk), text: m.text, at: m.at, vector: [], meta: Object.fromEntries(Object.entries(m).filter(([k]) => k.startsWith('m_')).map(([k, v]) => [k.slice(2), v])), ...(score != null ? { vscore: score } : {}) });
  const ids = async (pre: string) => {
    const out: string[] = [];
    let token = '';
    for (let i = 0; i < 1000; i++) {
      const u = new URL(`${host}/vectors/list`); u.searchParams.set('prefix', pre); if (ns) u.searchParams.set('namespace', ns); if (token) u.searchParams.set('paginationToken', token);
      const b = await must(vdb(u.toString(), 'GET', h), 'Listing Pinecone');
      out.push(...(b.vectors || []).map((v: any) => v.id));
      token = b.pagination?.next || '';
      if (!token) break;
    }
    return out;
  };
  const sourceIds = async (f: Filter) => (f.all ? ids(prefix) : [...await ids(`${prefix}${f.source}#`), ...await ids(`${prefix}${f.source}/`)]);
  return {
    add: async cs => { for (let i = 0; i < cs.length; i += 100) await must(vdb(`${host}/vectors/upsert`, 'POST', h, { namespace: ns, vectors: cs.slice(i, i + 100).map(c => ({ id: `${prefix}${c.source}#${c.chunk}`, values: c.vector, metadata: { kb: kb.id, source: c.source, dirs: dirsOf(c.source), chunk: c.chunk, text: c.text, at: c.at, ...Object.fromEntries(Object.entries(c.meta || {}).map(([k, v]) => [`m_${metaKey(k)}`, String(v)])) } })) }), 'Adding to Pinecone'); },
    remove: async f => { const all = await sourceIds(f); for (let i = 0; i < all.length; i += 1000) await must(vdb(`${host}/vectors/delete`, 'POST', h, { ids: all.slice(i, i + 1000), namespace: ns }), 'Removing from Pinecone'); return all.length; },
    candidates: async (v, k, f) => { const b = await must(vdb(`${host}/query`, 'POST', h, { vector: v, topK: k, includeMetadata: true, filter: filter(f), namespace: ns }), 'Searching Pinecone'); return (b.matches || []).map((m: any) => back(m.metadata || {}, m.score)); },
    list: async f => {
      const all = await ids(prefix);
      const out: Chunk[] = [];
      for (let i = 0; i < all.length; i += 100) {
        const u = new URL(`${host}/vectors/fetch`); all.slice(i, i + 100).forEach(x => u.searchParams.append('ids', x)); if (ns) u.searchParams.set('namespace', ns);
        const b = await must(vdb(u.toString(), 'GET', h), 'Reading Pinecone');
        out.push(...Object.values(b.vectors || {}).map((x: any) => back(x.metadata || {})));
      }
      return out.filter(c => matches(c, f));
    },
  };
}

function storeOf(kb: Resource, secret: Secret): Store {
  switch (kb.config.store || 'built-in') {
    case 'PostgreSQL (pgvector)': return pgStore(kb, secret);
    case 'Qdrant': return qdrantStore(kb, secret);
    case 'Chroma': return chromaStore(kb, secret);
    case 'Pinecone': return pineconeStore(kb, secret);
    default: return localStore(kb);
  }
}

/**
 * Adds a text under a source name (file name, URL, document id); an existing source is replaced.
 * Every passage keeps a contentHash of the text and details, so a feed that reads the same files
 * again (a timer over a folder) can skip unchanged ones without making their vectors again.
 */
export async function addKnowledge(kb: Resource, secret: Secret, source: string, text: string, meta: Record<string, any> = {}, signal?: AbortSignal, o: { skipUnchanged?: boolean } = {}) {
  const src = String(source || '').trim().replace(/^\/+/, '');
  if (!src) throw new Error('Give the source a name, such as the file name or address');
  const hash = crypto.createHash('sha256').update(JSON.stringify([text, meta, kb.config.chunkTokens, kb.config.overlapTokens])).digest('hex').slice(0, 32);
  const st = storeOf(kb, secret);
  const existing = (await st.list({ source: src })).filter(c => c.source === src);
  if (o.skipUnchanged && existing.length && existing.every(c => c.meta?.contentHash === hash)) {
    return { source: src, chunks: existing.length, tokens: 0, replaced: 0, model: '', skipped: true };
  }
  const overlap = Number(kb.config.overlapTokens);
  const pieces = chunkText(text, Number(kb.config.chunkTokens) || 300, Number.isFinite(overlap) ? overlap : 40);
  if (!pieces.length) throw new Error(`${src}: there is no text to add`);
  const { vectors, model } = await embed(kb, secret, pieces, signal);
  if (existing.length) await st.remove({ source: src });
  const at = now();
  await st.add(pieces.map((t, i) => ({ id: crypto.randomUUID(), source: src, chunk: i + 1, text: t, meta: { ...meta, contentHash: hash }, vector: vectors[i], at })));
  return { source: src, chunks: pieces.length, tokens: pieces.reduce((a, t) => a + tokensOf(t), 0), replaced: existing.length, model, skipped: false };
}

/** The sources a knowledge base holds, with their passage counts and when they were added. */
export async function listSources(kb: Resource, secret: Secret, under?: string) {
  const by = new Map<string, { source: string; chunks: number; at: string }>();
  for (const c of await storeOf(kb, secret).list({ source: under ? String(under).replace(/^\/+|\/+$/g, '') : undefined })) {
    const e = by.get(c.source) || { source: c.source, chunks: 0, at: c.at };
    e.chunks++; if (c.at > e.at) e.at = c.at;
    by.set(c.source, e);
  }
  return [...by.values()].sort((a, b) => a.source.localeCompare(b.source));
}

/**
 * Removes every source not in the list (within a folder of sources when given): after a feed has
 * read a whole folder, files deleted from it leave the knowledge base too.
 */
export async function keepOnlySources(kb: Resource, secret: Secret, keep: string[], under?: string) {
  const want = new Set(keep.map(k => String(k).trim().replace(/^\/+/, '')).filter(Boolean));
  const st = storeOf(kb, secret);
  const removed: string[] = [];
  for (const s of await listSources(kb, secret, under)) if (!want.has(s.source)) { await st.remove({ source: s.source }); removed.push(s.source); }
  return { removed: removed.length, sources: removed, kept: want.size };
}

/** Passages closest to a question: meaning (vectors) and shared words together, best first. */
export async function searchKnowledge(kb: Resource, secret: Secret, query: string, o: { top?: number; minScore?: number; source?: string; meta?: Record<string, string> } = {}, signal?: AbortSignal): Promise<Hit[]> {
  const text = String(query || '').trim();
  if (!text) throw new Error('The question to search for is empty');
  const top = Math.max(1, Math.min(50, o.top || 5));
  const [qv] = (await embed(kb, secret, [text], signal)).vectors;
  const chunks = await storeOf(kb, secret).candidates(qv, top * 4, { source: o.source, meta: o.meta });
  if (!chunks.length) return [];
  const qw = new Set(words(text).filter(w => !STOP.has(w)));
  const scored = chunks.map(c => {
    const cw = words(c.text);
    const shared = qw.size ? [...qw].filter(w => cw.includes(w)).length / qw.size : 0;
    const meaning = c.vscore ?? cosine(qv, c.vector);
    return { text: c.text, source: c.source, chunk: c.chunk, meta: c.meta, score: Math.round((0.7 * Math.max(0, meaning) + 0.3 * shared) * 1000) / 1000 };
  });
  const min = o.minScore ?? 0.05;
  return scored.filter(s => s.score >= min).sort((a, b) => b.score - a.score).slice(0, top);
}

/** Removes a source or a folder of sources (or everything). */
export async function removeKnowledge(kb: Resource, source: string, all = false, secret: Secret = n => { throw new Error(`Secret ${n} is not available here`); }) {
  const src = String(source || '').trim().replace(/^\/+/, '');
  if (!src && !all) throw new Error('Name the source to remove, or choose to remove everything');
  return storeOf(kb, secret).remove(all ? { all: true } : { source: src });
}

/** Makes every vector again, after the vector model changed. */
export async function rebuildKnowledge(kb: Resource, secret: Secret, signal?: AbortSignal) {
  const st = storeOf(kb, secret);
  const cs = await st.list({});
  const { vectors, model } = await embed(kb, secret, cs.map(c => c.text), signal);
  await st.remove({ all: true });
  await st.add(cs.map((c, i) => ({ ...c, id: crypto.randomUUID(), vector: vectors[i] })));
  return { chunks: cs.length, model };
}

/** Test connection: makes a vector, reaches the store and counts what it holds. */
export async function testKnowledge(kb: Resource, secret: Secret) {
  const { vectors, model } = await embed(kb, secret, ['test']);
  const s = await knowledgeStats(kb, secret);
  return `Vectors from ${model} (${vectors[0]?.length ?? 0} numbers each). ${kb.config.store || 'built-in'} holds ${s.chunks} passages from ${s.sources} sources.`;
}

export async function knowledgeStats(kb: Resource, secret: Secret = n => { throw new Error(`Secret ${n} is not available here`); }) {
  const cs = await storeOf(kb, secret).list({});
  return { chunks: cs.length, sources: [...new Set(cs.map(c => c.source))].length };
}
