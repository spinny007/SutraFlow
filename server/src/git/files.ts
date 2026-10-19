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
import { q, tx } from '../db.js';
import { getProject, saveProject } from '../projects.js';
import { deleteFlow, getFlow, listFlows, normalizeDoc, saveFlow } from '../flows.js';
import { deleteResource, listResources, saveResource } from '../resources.js';
import { getSchema, listSchemas, saveSchema } from '../schemas.js';
import { createFolder, listFolders, setItemFolder } from '../folders.js';

/**
 * A project as files in a Git working copy, and back. The layout is plain and stable, so diffs read well:
 *
 *   sutraflow.json                              the project: name, description, variables (secret values never), logging, empty folders
 *   sutras/<folder>/<name>.sutra.json           one Sutra (its draft): id, name, folder, the document
 *   connections/<folder>/<name>.connection.json one connection: kind, settings (secrets by name only)
 *   schemas/<folder>/<name>.<json|xsd|wsdl>     the schema text as it was given, with <name>.schema.json beside it (kind, root)
 *
 * Ids in the files are the repository's ids. Each workspace keeps its own map from repository ids to the
 * ids of its project here, so several people's copies of one repository never share an id.
 */
export const FORMAT = 1;
type Kind = 'sutra' | 'connection' | 'schema';

const safe = (s: string) => String(s || 'unnamed').replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-').replace(/^\.+/, '').trim().slice(0, 100) || 'unnamed';
const dirOf = (folder?: string) => (folder ? folder.split('/').map(safe).join('/') : '');
/** Stable JSON: keys in a fixed order for the top level, two spaces, a newline at the end. */
const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n';

/** Repository id <-> local id, per workspace and kind. */
export function idMap(workspaceId: string) {
  const rows = q.all<{ kind: Kind; repo_id: string; local_id: string }>('select kind, repo_id, local_id from git_ids where workspace_id = ?', workspaceId);
  const toRepo = new Map(rows.map(r => [r.local_id, r.repo_id]));
  const toLocal = new Map(rows.map(r => [r.repo_id, r.local_id]));
  return {
    repoOf: (localId: string, kind: Kind) => {
      let r = toRepo.get(localId);
      if (!r) { r = localId; q.run('insert into git_ids(workspace_id, kind, repo_id, local_id) values(?, ?, ?, ?) on conflict do nothing', workspaceId, kind, r, localId); toRepo.set(localId, r); toLocal.set(r, localId); }
      return r;
    },
    localOf: (repoId: string) => toLocal.get(repoId),
    bind: (repoId: string, localId: string, kind: Kind) => {
      q.run('delete from git_ids where workspace_id = ? and (repo_id = ? or local_id = ?)', workspaceId, repoId, localId);
      q.run('insert into git_ids(workspace_id, kind, repo_id, local_id) values(?, ?, ?, ?)', workspaceId, kind, repoId, localId);
      toRepo.set(localId, repoId); toLocal.set(repoId, localId);
    },
    all: () => [...toLocal.entries()],
  };
}

/** Replaces whole-string ids inside a value (references between Sutras, connections and schemas). */
function remapIds(v: unknown, map: Map<string, string>) {
  if (!map.size) return v;
  let text = JSON.stringify(v);
  for (const [from, to] of map) if (from !== to) text = text.split(`"${from}"`).join(`"${to}"`).split(`"${from}::`).join(`"${to}::`);
  return JSON.parse(text);
}

/** The files of a project, as path -> text. */
export function projectFiles(projectId: string, workspaceId: string, repoName?: string) {
  const p = getProject(projectId);
  if (!p) throw new Error('Project not found');
  const ids = idMap(workspaceId);
  const files = new Map<string, string>();
  const toRepo = new Map<string, string>();
  const flows = listFlows(projectId), conns = listResources(undefined, projectId), schemas = listSchemas(projectId);
  for (const f of flows) toRepo.set(f.id, ids.repoOf(f.id, 'sutra'));
  for (const r of conns) toRepo.set(r.id, ids.repoOf(r.id, 'connection'));
  for (const s of schemas) toRepo.set(s.id, ids.repoOf(s.id, 'schema'));
  const taken = new Set<string>();
  const unique = (base: string, ext: string) => { let n = `${base}${ext}`; for (let i = 2; taken.has(n.toLowerCase()); i++) n = `${base} (${i})${ext}`; taken.add(n.toLowerCase()); return n; };

  files.set('sutraflow.json', json({
    format: FORMAT, kind: 'SutraFlow project', name: repoName || p.name, description: p.description || '',
    variables: p.config.variables, logging: p.config.logging,
    folders: { sutras: listFolders(projectId, 'sutras'), connections: listFolders(projectId, 'resources'), schemas: listFolders(projectId, 'schemas'), wsdl: listFolders(projectId, 'wsdl') },
  }));
  for (const f of flows) {
    const full = getFlow(f.id)!;
    const dir = ['sutras', dirOf(f.folder)].filter(Boolean).join('/');
    files.set(unique(`${dir}/${safe(f.name)}`, '.sutra.json'), json({ id: toRepo.get(f.id), name: f.name, folder: f.folder || '', doc: remapIds(full.doc, toRepo) }));
  }
  for (const r of conns) {
    const dir = ['connections', dirOf(r.folder)].filter(Boolean).join('/');
    files.set(unique(`${dir}/${safe(r.name)}`, '.connection.json'), json({ id: toRepo.get(r.id), name: r.name, kind: r.kind, folder: r.folder || '', config: remapIds(r.config, toRepo) }));
  }
  for (const s of schemas) {
    const full = getSchema(s.id)!;
    const dir = ['schemas', dirOf(s.folder)].filter(Boolean).join('/');
    const base = unique(`${dir}/${safe(s.name)}`, '');
    files.set(`${base}.schema.json`, json({ id: toRepo.get(s.id), name: s.name, kind: s.kind, root: full.root || null, folder: s.folder || '', file: path.posix.basename(`${base}.${s.kind}`) }));
    files.set(`${base}.${s.kind}`, full.text.endsWith('\n') ? full.text : full.text + '\n');
  }
  return files;
}

const MANAGED = (rel: string) => rel === 'sutraflow.json' || /^(sutras|connections|schemas)\//.test(rel);

/** Writes the project into the working copy: changed files are written, files of removed items deleted. */
export function writeWorkingTree(dir: string, projectId: string, workspaceId: string) {
  // A personal copy is named "Shop (meera)" here; the repository keeps its own project name.
  let repoName: string | undefined;
  const owned = q.get<any>("select kind from git_workspaces where id = ?", workspaceId)?.kind === 'personal';
  if (owned) try { repoName = JSON.parse(fs.readFileSync(path.join(dir, 'sutraflow.json'), 'utf8')).name; } catch { /* a new repository */ }
  const files = projectFiles(projectId, workspaceId, repoName);
  for (const rel of listTree(dir)) if (MANAGED(rel) && !files.has(rel)) fs.rmSync(path.join(dir, rel), { force: true });
  for (const [rel, text] of files) {
    const abs = path.join(dir, rel);
    if (fs.existsSync(abs) && fs.readFileSync(abs, 'utf8') === text) continue;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
  }
  pruneEmptyDirs(dir, ['sutras', 'connections', 'schemas']);
  return files.size;
}

export function listTree(dir: string, sub = ''): string[] {
  const out: string[] = [];
  const here = path.join(dir, sub);
  if (!fs.existsSync(here)) return out;
  for (const e of fs.readdirSync(here, { withFileTypes: true })) {
    if (e.name === '.git') continue;
    const rel = sub ? `${sub}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listTree(dir, rel)); else out.push(rel);
  }
  return out;
}
function pruneEmptyDirs(dir: string, tops: string[]) {
  const walk = (abs: string): boolean => {
    if (!fs.existsSync(abs)) return true;
    let empty = true;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) { if (e.isDirectory()) { if (walk(path.join(abs, e.name))) fs.rmdirSync(path.join(abs, e.name)); else empty = false; } else empty = false; }
    return empty;
  };
  for (const t of tops) walk(path.join(dir, t));
}

/**
 * Reads the working copy into the project: Sutras, connections and schemas are created, updated or
 * removed to match the files; the project's name stays (it is this workspace's own copy).
 */
export function readWorkingTree(dir: string, projectId: string, workspaceId: string) {
  const read = (rel: string) => JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8'));
  const files = listTree(dir);
  const ids = idMap(workspaceId);
  const report = { sutras: 0, connections: 0, schemas: 0, removed: 0, problems: [] as string[] };
  const proj = files.includes('sutraflow.json') ? read('sutraflow.json') : null;
  if (proj && proj.format > FORMAT) throw new Error(`This repository was written by a newer SutraFlow (format ${proj.format}); update SutraFlow first`);
  const sutraFiles = files.filter(f => /^sutras\/.+\.sutra\.json$/.test(f));
  const connFiles = files.filter(f => /^connections\/.+\.connection\.json$/.test(f));
  const schemaFiles = files.filter(f => /^schemas\/.+\.schema\.json$/.test(f));

  // Local ids for every repository id first, so references can be translated.
  const toLocal = new Map<string, string>();
  const plan: { kind: Kind; rel: string; data: any; local: string; isNew: boolean }[] = [];
  for (const [kind, list] of [['schema', schemaFiles], ['connection', connFiles], ['sutra', sutraFiles]] as const) {
    for (const rel of list) {
      let data: any;
      try { data = read(rel); } catch (e: any) { report.problems.push(`${rel}: ${e.message}`); continue; }
      const repoId = String(data.id || '') || crypto.randomUUID();
      const existing = ids.localOf(repoId);
      const local = existing || crypto.randomUUID();
      toLocal.set(repoId, local);
      plan.push({ kind, rel, data: { ...data, id: repoId }, local, isNew: !existing });
    }
  }
  tx(() => {
    if (proj) saveProject({ id: projectId, name: getProject(projectId)!.name, description: proj.description, config: { variables: proj.variables || [], logging: proj.logging } });
    for (const it of plan.filter(x => x.kind === 'schema')) {
      try {
        const textFile = path.posix.join(path.posix.dirname(it.rel), it.data.file || '');
        const text = fs.readFileSync(path.join(dir, textFile), 'utf8');
        saveSchema({ id: it.isNew ? undefined : it.local, project_id: projectId, name: it.data.name, kind: it.data.kind, root: it.data.root || undefined, text });
        const saved = q.get<any>('select id from schemas where project_id = ? and lower(name) = lower(?)', projectId, it.data.name)!.id;
        if (saved !== it.local) { toLocal.set(it.data.id, saved); it.local = saved; }
        ids.bind(it.data.id, saved, 'schema');
        setItemFolder(it.data.kind === 'wsdl' ? 'wsdl' : 'schemas', saved, it.data.folder || '');
        report.schemas++;
      } catch (e: any) { report.problems.push(`${it.rel}: ${e.message}`); }
    }
    for (const it of plan.filter(x => x.kind === 'connection')) {
      try {
        const r = saveResource({ id: it.local, kind: it.data.kind, name: it.data.name, project_id: projectId, config: remapIds(it.data.config || {}, toLocal) as any });
        ids.bind(it.data.id, r.id, 'connection');
        setItemFolder('resources', r.id, it.data.folder || '');
        report.connections++;
      } catch (e: any) { report.problems.push(`${it.rel}: ${e.message}`); }
    }
    for (const it of plan.filter(x => x.kind === 'sutra')) {
      try {
        const doc = normalizeDoc({ ...(remapIds(it.data.doc || {}, toLocal) as any), name: it.data.name });
        const f = saveFlow(it.local, doc, projectId);
        ids.bind(it.data.id, f.id, 'sutra');
        setItemFolder('sutras', f.id, it.data.folder || '');
        report.sutras++;
      } catch (e: any) { report.problems.push(`${it.rel}: ${e.message}`); }
    }
    // Items no longer in the files.
    const keep = new Set(plan.map(x => x.local));
    for (const f of listFlows(projectId)) if (!keep.has(f.id)) { deleteFlow(f.id); report.removed++; }
    for (const r of listResources(undefined, projectId)) if (!keep.has(r.id)) { deleteResource(r.id); report.removed++; }
    for (const s of listSchemas(projectId)) if (!keep.has(s.id)) { q.run('delete from schemas where id = ?', s.id); report.removed++; }
    for (const [area, list] of Object.entries(proj?.folders || {}) as [string, string[]][]) {
      const a = area === 'connections' ? 'resources' : area;
      for (const fo of list || []) try { createFolder(projectId, fo, a as any); } catch { /* bad folder name */ }
    }
  });
  return report;
}
