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
import { q, now } from './db.js';
import { version as sutraVersion } from './config.js';
import { engine } from './engine/engine.js';
import type { FlowDoc } from './engine/types.js';
import { listFlows, getFlow, saveFlow, publish, deploy, undeploy, versionDoc, validateDoc, deployedFlows, normPath, normalizeDoc, setFlowFolder } from './flows.js';
import { listResources, saveResource, RESOURCE_KINDS } from './resources.js';
import { listSchemas, getSchema, saveSchema } from './schemas.js';
import { setItemFolder } from './folders.js';
import { listProjects, getProject, saveProject, importOpsFile, projectFilesDir } from './projects.js';
import { writeProjectFiles } from './bundles.js';
import { getSecret } from './secrets.js';

/**
 * Project packages: one file holding a release of a whole project, promoted unchanged from
 * test to production. It carries every Sutra at a fixed version, the connections (secret names,
 * never secret values), shared schemas and WSDLs, project variables and logging. Values that
 * differ per environment come from the target's deployment config and ${env:...} values.
 */
export const PACKAGE_FORMAT = 'sutraflow-package';

export interface PackageSutra { id: string; name: string; version: number; deployed: boolean; doc: FlowDoc; folder?: string }
export interface Package {
  format: typeof PACKAGE_FORMAT;
  formatVersion: 1;
  name: string;
  version: string;
  note?: string;
  /** Where a package built from Git came from: repository (no credentials), ref, commit. */
  source?: { repository?: string; ref?: string; commit?: string };
  createdAt: string;
  createdWith: string;
  project: { name: string; description: string; variables: any[]; logging: any };
  schemas: { id: string; name: string; kind: string; root: string | null; text: string; folder?: string }[];
  resources: { id: string; kind: string; name: string; config: Record<string, any>; folder?: string }[];
  sutras: PackageSutra[];
  manifest: {
    sutras: { name: string; version: number; triggers: string[]; exposes: string[] }[];
    secrets: string[];
    activityTypes: string[];
  };
  checksum: string;
}

const VERSION = /^\d+\.\d+\.\d+([-+][\w.]+)?$/;

/** sha256 of the package without its checksum, keys sorted, so the same content always has the same checksum. */
export function checksumOf(p: Omit<Package, 'checksum'> | Package) {
  const { checksum: _drop, ...rest } = p as Package;
  const canon = (v: any): any => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v);
  return 'sha256:' + crypto.createHash('sha256').update(JSON.stringify(canon(rest))).digest('hex');
}

/**
 * The connections, schemas and WSDLs the given Sutras use, directly or through each other (an MCP
 * server and its policy, a SOAP step and its WSDL). Found by their ids in the Sutras and settings.
 */
export function usedBy<R extends { id: string; config: unknown }, S extends { id: string; text: string }>(docs: unknown[], resources: R[], schemas: S[]) {
  let text = JSON.stringify(docs);
  const res = new Set<R>(), sch = new Set<S>();
  for (let grew = true; grew;) {
    grew = false;
    for (const r of resources) if (!res.has(r) && text.includes(r.id)) { res.add(r); text += JSON.stringify(r.config); grew = true; }
    for (const s of schemas) if (!sch.has(s) && text.includes(s.id)) { sch.add(s); grew = true; }
  }
  return { resources: resources.filter(r => res.has(r)), schemas: schemas.filter(s => sch.has(s)) };
}

/** Secret names a project needs: from connection settings, secret project variables, and {{secret.X}} references. */
function secretsOf(resources: Package['resources'], variables: any[], docs: FlowDoc[]) {
  const out = new Set<string>();
  for (const r of resources) {
    const k = RESOURCE_KINDS.find(x => x.kind === r.kind);
    for (const f of k?.fields || []) {
      const v = r.config[f.k];
      if (f.type === 'secret' && v) out.add(String(v));
      if (f.type === 'list' && /Secrets$/.test(f.k) && Array.isArray(v)) v.filter(Boolean).forEach(x => out.add(String(x)));
      if (f.type === 'kv' && f.k === 'users' && Array.isArray(v)) v.filter((x: any) => x?.v).forEach((x: any) => out.add(String(x.v)));
    }
  }
  for (const v of variables) if (v?.type === 'secret' && v.value) out.add(String(v.value));
  const text = JSON.stringify(docs);
  for (const m of text.matchAll(/secret\.([A-Za-z_][\w]*)/g)) out.add(m[1]);
  for (const d of docs) for (const n of d.nodes) {
    const a = engine.activity(n.type);
    for (const f of a?.fields || []) if (f.type === 'secret' && n.config?.[f.k]) out.add(String(n.config[f.k]));
  }
  return [...out].filter(s => !/^\{\{|^=|\$\{/.test(s)).sort();
}

const triggersOf = (doc: FlowDoc) => doc.nodes.filter(n => engine.activity(n.type)?.trigger).map(n => n.type);
const exposesOf = (doc: FlowDoc) => doc.nodes.flatMap(n =>
  n.type === 'restService' ? [`${String(n.config.method || 'ANY').toUpperCase()} ${normPath(n.config.path)}`]
    : n.type === 'soapService' ? [`SOAP ${normPath(n.config.path)}`]
      : n.type === 'mcpTool' ? [`MCP ${n.config.toolName}`] : []);

/**
 * Builds a package of a project. Each deployed Sutra is taken at its deployed version; a Sutra
 * that is not deployed is published from its draft and included as not deployed (or left out).
 */
export function buildPackage(projectId: string, o: { version?: string; note?: string; sutras?: string[]; includeUndeployed?: boolean; allDeployed?: boolean; source?: Package['source'] } = {}): Package {
  const project = getProject(projectId);
  if (!project) throw new Error('Project not found');
  const version = o.version || '1.0.0';
  if (!VERSION.test(version)) throw new Error(`Version "${version}" is not like 1.4.0`);
  const sutras: PackageSutra[] = [];
  for (const f of listFlows(projectId)) {
    if (o.sutras?.length && !o.sutras.some(n => n.toLowerCase() === f.name.toLowerCase())) continue;
    if (f.deployed) {
      sutras.push({ id: f.id, name: f.name, version: f.deployed.version, deployed: true, doc: versionDoc(f.id, f.deployed.version)!, ...(f.folder ? { folder: f.folder } : {}) });
    } else if (o.includeUndeployed !== false) {
      const row = getFlow(f.id)!;
      const v = row.version && JSON.stringify(versionDoc(f.id, row.version)) === JSON.stringify(row.doc) ? row.version : publish(f.id, `Package ${version}`).version;
      sutras.push({ id: f.id, name: f.name, version: v, deployed: !!o.allDeployed, doc: versionDoc(f.id, v)!, ...(f.folder ? { folder: f.folder } : {}) });
    }
  }
  if (o.sutras?.length) {
    const missing = o.sutras.filter(n => !sutras.some(s => s.name.toLowerCase() === n.toLowerCase()));
    if (missing.length) throw new Error(`No Sutra named ${missing.map(m => `"${m}"`).join(', ')} in ${project.name}`);
  }
  const allSchemas = listSchemas(projectId).map(s => { const full = getSchema(s.id)!; return { id: s.id, name: s.name, kind: s.kind, root: full.root, text: full.text, ...(s.folder ? { folder: s.folder } : {}) }; });
  const allResources = listResources(undefined, projectId).map(r => ({ id: r.id, kind: r.kind, name: r.name, config: r.config, ...(r.folder ? { folder: r.folder } : {}) }));
  const docs = sutras.map(s => s.doc);
  // Chosen Sutras take only the connections and schemas they use; a whole project takes all of them.
  const { resources, schemas } = o.sutras?.length ? usedBy(docs, allResources, allSchemas) : { resources: allResources, schemas: allSchemas };
  const body: Omit<Package, 'checksum'> = {
    format: PACKAGE_FORMAT, formatVersion: 1, name: project.name, version, ...(o.note ? { note: o.note } : {}), ...(o.source ? { source: o.source } : {}),
    createdAt: now(), createdWith: sutraVersion,
    project: { name: project.name, description: project.description || '', variables: project.config.variables || [], logging: project.config.logging },
    schemas, resources, sutras,
    manifest: {
      sutras: sutras.map(s => ({ name: s.name, version: s.version, triggers: triggersOf(s.doc), exposes: s.deployed ? exposesOf(s.doc) : [] })),
      secrets: secretsOf(resources, project.config.variables || [], docs),
      activityTypes: [...new Set(docs.flatMap(d => d.nodes.map(n => n.type)))].sort(),
    },
  };
  return { ...body, checksum: checksumOf(body) };
}

/** Reads a package from text or an object and checks its form and checksum. */
export function readPackage(input: unknown): Package {
  let p: any = input;
  if (typeof input === 'string') { try { p = JSON.parse(input); } catch { throw new Error('This is not a SutraFlow package (not JSON)'); } }
  if (!p || p.format !== PACKAGE_FORMAT) throw new Error('This is not a SutraFlow package');
  if (p.formatVersion !== 1) throw new Error(`Package format ${p.formatVersion} is newer than this SutraFlow understands`);
  for (const k of ['name', 'version', 'project', 'sutras', 'resources', 'schemas', 'manifest', 'checksum']) if (p[k] === undefined) throw new Error(`The package has no ${k}`);
  if (checksumOf(p) !== p.checksum) throw new Error('The package checksum does not match its content: the file was changed or damaged');
  return p as Package;
}

export interface CheckResult { ok: boolean; errors: string[]; warnings: string[]; secrets: { name: string; present: boolean }[] }

/** What would stop the package from running here: unknown activities, missing secrets, invalid Sutras, addresses taken by other projects. */
export function checkPackage(p: Package, o: { project?: string } = {}): CheckResult {
  const errors: string[] = [], warnings: string[] = [];
  const unknown = p.manifest.activityTypes.filter(t => !engine.activity(t));
  if (unknown.length) errors.push(`This SutraFlow (${sutraVersion}) does not have the activities ${unknown.join(', ')}; the package was made with ${p.createdWith}`);
  for (const s of p.sutras) {
    const v = validateDoc(s.doc);
    for (const e of v.errors) errors.push(`${s.name}: ${e}`);
    if (s.deployed) for (const w of v.warnings) warnings.push(`${s.name}: ${w}`);
  }
  const secrets = p.manifest.secrets.map(name => ({ name, present: getSecret(name) !== undefined }));
  const missing = secrets.filter(s => !s.present).map(s => s.name);
  if (missing.length) errors.push(`Missing secrets on this server: ${missing.join(', ')}. Add them under Resources > Secrets (or with the command-line tool) before deploying.`);
  // Addresses served by deployed Sutras of other projects.
  const target = (o.project || p.project.name).toLowerCase();
  const theirs = new Map<string, string>();
  for (const d of deployedFlows()) {
    if (getProject(d.projectId)?.name.toLowerCase() === target) continue;
    for (const x of exposesOf(d.doc)) theirs.set(x.replace(/^(GET|POST|PUT|PATCH|DELETE|ANY) /, 'HTTP '), d.doc.name);
  }
  for (const s of p.sutras.filter(x => x.deployed)) for (const x of exposesOf(s.doc)) {
    const other = theirs.get(x.replace(/^(GET|POST|PUT|PATCH|DELETE|ANY) /, 'HTTP '));
    if (other && !x.startsWith('MCP')) errors.push(`${s.name}: ${x} is already served by "${other}" in another project`);
  }
  if (!p.sutras.some(s => s.deployed)) warnings.push('No Sutra in the package is marked deployed');
  return { ok: !errors.length, errors, warnings, secrets };
}

export interface DeployReport {
  project: { id: string; name: string; created: boolean };
  package: { name: string; version: string; checksum: string };
  sutras: { name: string; action: 'created' | 'updated' | 'unchanged'; version: number; deployed: boolean }[];
  undeployed: string[];
  unchanged: boolean;
  /** Files of the release written to the project's files folder (${files}). */
  files?: number;
  warnings: string[];
}

/**
 * Installs a package into a project (found by name, created when missing): schemas, connections
 * and Sutras are matched by name, references are remapped to this server's ids, changed Sutras get
 * a new version and are deployed. Sutras of the project that are not in the package are undeployed
 * (kept, not deleted) unless keepOthers is set. Every deployment is recorded for history and rollback.
 */
export function deployPackage(input: unknown, o: { project?: string; ops?: unknown; keepOthers?: boolean; skipCheck?: boolean; by?: string; record?: boolean; files?: [string, Buffer][] } = {}): DeployReport {
  const p = readPackage(input);
  if (!o.skipCheck) {
    const c = checkPackage(p, { project: o.project });
    if (!c.ok) throw Object.assign(new Error(`The package cannot be deployed:\n- ${c.errors.join('\n- ')}`), { check: c });
  }
  const projName = o.project || p.project.name;
  const found = listProjects().find(x => x.name.toLowerCase() === projName.toLowerCase());
  const created = !found;
  const project = saveProject({ id: found?.id, name: projName, description: p.project.description, config: { variables: p.project.variables, logging: p.project.logging } });
  const pid = project.id;

  // Matching by name; old (package) id -> id on this server.
  const map = new Map<string, string>();
  const schemasHere = listSchemas(pid);
  for (const s of p.schemas) {
    const existing = schemasHere.find(x => x.name.toLowerCase() === s.name.toLowerCase() && x.kind === s.kind);
    const saved = saveSchema({ id: existing?.id, project_id: pid, name: s.name, kind: s.kind as any, root: s.root || undefined, text: s.text });
    if (!existing && s.folder) setItemFolder(s.kind === 'wsdl' ? 'wsdl' : 'schemas', saved.id, s.folder);
    map.set(s.id, saved.id);
  }
  const resHere = listResources(undefined, pid);
  for (const r of p.resources) {
    const existing = resHere.find(x => x.name.toLowerCase() === r.name.toLowerCase() && x.kind === r.kind);
    map.set(r.id, existing?.id || crypto.randomUUID());
  }
  const flowsHere = listFlows(pid);
  for (const s of p.sutras) {
    const existing = flowsHere.find(x => x.name.toLowerCase() === s.name.toLowerCase());
    map.set(s.id, existing?.id || crypto.randomUUID());
  }
  const remap = (v: unknown) => {
    let text = JSON.stringify(v);
    for (const [from, to] of map) if (from !== to) text = text.split(`"${from}"`).join(`"${to}"`).split(`"${from}::`).join(`"${to}::`);
    return JSON.parse(text);
  };
  // Resources reference each other (MCP server -> policy), so save them after every id is known.
  for (const r of p.resources) {
    const isNew = !resHere.some(x => x.id === map.get(r.id));
    saveResource({ id: map.get(r.id), kind: r.kind, name: r.name, project_id: pid, config: remap(r.config) });
    if (isNew && r.folder) setItemFolder('resources', map.get(r.id)!, r.folder);
  }

  const report: DeployReport = { project: { id: pid, name: project.name, created }, package: { name: p.name, version: p.version, checksum: p.checksum }, sutras: [], undeployed: [], unchanged: true, warnings: [] };
  const keep = new Set<string>();
  for (const s of p.sutras) {
    const id = map.get(s.id)!;
    const doc: FlowDoc = normalizeDoc(remap(s.doc));
    const before = getFlow(id);
    // Unchanged: the version that would be live (deployed, or the latest when not deployed) has this content.
    const current = before ? (s.deployed ? before.deployed?.version : before.deployed ? undefined : before.version) : undefined;
    const same = current !== undefined && current > 0 && JSON.stringify(normalizeDoc(versionDoc(id, current))) === JSON.stringify(doc);
    keep.add(id);
    // A new Sutra takes the package's folder; one already here stays where it was put.
    const placeFolder = () => { if (!before && s.folder) setFlowFolder(id, s.folder); };
    if (same) { placeFolder(); report.sutras.push({ name: s.name, action: 'unchanged', version: current!, deployed: s.deployed }); continue; }
    report.unchanged = false;
    saveFlow(id, doc, pid);
    placeFolder();
    const pub = publish(id, `Package ${p.name} ${p.version}`);
    if (s.deployed) {
      const d = deploy(id, pub.version);
      report.warnings.push(...d.warnings.map(w => `${s.name}: ${w}`));
    } else if (before?.deployed) undeploy(id);
    report.sutras.push({ name: s.name, action: before ? 'updated' : 'created', version: pub.version, deployed: s.deployed });
  }
  if (!o.keepOthers) {
    for (const f of listFlows(pid)) if (!keep.has(f.id) && f.deployed) { undeploy(f.id); report.undeployed.push(f.name); report.unchanged = false; }
  }
  if (o.ops !== undefined && o.ops !== null) importOpsFile(pid, typeof o.ops === 'string' ? JSON.parse(o.ops) : o.ops);
  if (o.files?.length) report.files = writeProjectFiles(projectFilesDir(project.name), o.files);
  if (o.record === false) return report;
  q.run(`insert into package_deployments(id, seq, project_id, name, version, checksum, deployed_at, deployed_by, report, package)
    values(?, (select coalesce(max(seq), 0) + 1 from package_deployments), ?, ?, ?, ?, ?, ?, ?, ?)`,
    crypto.randomUUID(), pid, p.name, p.version, p.checksum, now(), o.by || 'cli', JSON.stringify(report), JSON.stringify(p));
  return report;
}

/**
 * Imports chosen Sutras of a package into a new project, for study, a proof of concept or a fresh
 * start. As drafts (the default) nothing is deployed, so addresses never clash with the original and
 * missing secrets only warn. The project's connections, schemas and variables come along. Not
 * recorded as a package deployment.
 */
export function importPackage(input: unknown, o: { project: string; sutras?: string[]; asDrafts?: boolean; by?: string; files?: [string, Buffer][] }) {
  const p = readPackage(input);
  const name = String(o.project || '').trim();
  if (!name) throw new Error('Give the new project a name');
  if (listProjects().some(x => x.name.toLowerCase() === name.toLowerCase())) throw new Error(`A project named "${name}" exists; choose another name`);
  const pick = o.sutras?.length ? new Set(o.sutras.map(s => s.toLowerCase())) : null;
  const drafts = o.asDrafts !== false;
  const sutras = p.sutras.filter(s => !pick || pick.has(s.name.toLowerCase())).map(s => (drafts ? { ...s, deployed: false } : s));
  if (!sutras.length) throw new Error('Choose at least one Sutra');
  const used = pick ? usedBy(sutras.map(s => s.doc), p.resources, p.schemas) : { resources: p.resources, schemas: p.schemas };
  const chosen: Package = { ...p, sutras, resources: used.resources, schemas: used.schemas, manifest: { ...p.manifest, sutras: p.manifest.sutras.filter((m: any) => sutras.some(s => s.name === m.name)), secrets: secretsOf(used.resources, p.project.variables || [], sutras.map(s => s.doc)) } };
  chosen.checksum = checksumOf(chosen);
  const c = checkPackage(chosen, { project: name });
  const errors = drafts ? c.errors.filter(e => !e.startsWith('Missing secrets')) : c.errors;
  if (errors.length) throw Object.assign(new Error(`The Sutras cannot be imported:\n- ${errors.join('\n- ')}`), { check: c });
  const report = deployPackage(chosen, { project: name, keepOthers: true, skipCheck: true, by: o.by, record: false, files: o.files });
  return { ...report, missingSecrets: c.secrets.filter(s => !s.present).map(s => s.name), asDrafts: drafts };
}

/** Copies chosen Sutras of a project (with its connections, schemas and variables) into a new project, as drafts. */
export function copyProject(sourceId: string, o: { project: string; sutras?: string[]; by?: string }) {
  const pkg = buildPackage(sourceId, { version: '0.0.0', note: 'Project copy', sutras: o.sutras?.length ? o.sutras : undefined });
  return importPackage(pkg, { project: o.project, sutras: o.sutras, asDrafts: true, by: o.by });
}

/** Deployments of packages to a project, newest first. */
export function packageHistory(projectId: string) {
  return q.all<any>('select id, name, version, checksum, deployed_at, deployed_by, report from package_deployments where project_id = ? order by seq desc', projectId)
    .map(r => ({ ...r, report: JSON.parse(r.report) }));
}

/** Deploys the package that was current before the latest one (or a chosen deployment id). */
export function rollbackPackage(projectId: string, o: { to?: string; by?: string } = {}) {
  const rows = q.all<any>('select id, checksum, package from package_deployments where project_id = ? order by seq desc', projectId);
  if (!rows.length) throw new Error('No package has been deployed to this project');
  const target = o.to ? rows.find(r => r.id === o.to) : rows.find(r => r.checksum !== rows[0].checksum);
  if (!target) throw new Error(o.to ? 'That deployment is not in the history' : 'There is no earlier package to roll back to');
  return deployPackage(target.package, { project: getProject(projectId)?.name, by: `${o.by || 'cli'} (rollback)` });
}

/** Runs every Sutra of a package with its trigger's test data; passes when each run ends done. */
export async function testPackage(input: unknown, o: { skip?: string[]; timeoutMs?: number } = {}) {
  const p = readPackage(input);
  const results: { name: string; status: string; error?: string | null; ms: number; skipped?: boolean }[] = [];
  const project = listProjects().find(x => x.name === p.project.name);
  for (const s of p.sutras) {
    if (o.skip?.some(n => n.toLowerCase() === s.name.toLowerCase())) { results.push({ name: s.name, status: 'skipped', ms: 0, skipped: true }); continue; }
    const t0 = Date.now();
    try {
      const id = await engine.startRun({ doc: s.doc, projectId: project?.id ?? null, source: 'test' });
      const status = await engine.waitFor(id, o.timeoutMs ?? 60000);
      const r = q.get<{ error: string | null }>('select error from runs where id = ?', id);
      results.push({ name: s.name, status, error: r?.error, ms: Date.now() - t0 });
    } catch (e: any) {
      results.push({ name: s.name, status: 'failed', error: e.message, ms: Date.now() - t0 });
    }
  }
  const failed = results.filter(r => !r.skipped && r.status !== 'done');
  return { ok: !failed.length, passed: results.filter(r => r.status === 'done').length, failed: failed.length, skipped: results.filter(r => r.skipped).length, results };
}
