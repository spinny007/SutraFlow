import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { q, tx, now, getSetting, setSetting } from './db.js';
import { config } from './config.js';
import { getSecret } from './secrets.js';

/**
 * A project groups processes (flows), shared resources, shared schemas, project
 * variables and logging. Its deployment config ("ops config") lets an operations
 * team override variables, resource settings and logging per environment without
 * editing the processes. Override values may read environment variables: ${env:DB_HOST}.
 */

export type VarType = 'string' | 'number' | 'boolean' | 'secret';
export interface ProjectVariable { name: string; type: VarType; value: string; description?: string }
export interface LoggingConfig {
  enabled: boolean;
  /** Relative to the data folder unless absolute. {project} and {date} are replaced. */
  file: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  format: 'text' | 'json';
  maxSizeMb: number;
  maxFiles: number;
  /** Also log each step's input and output (debug level). */
  stepData: boolean;
}
export interface ProjectConfig { variables: ProjectVariable[]; logging: LoggingConfig }
export interface OpsConfig {
  variables: Record<string, string>;
  resources: Record<string, Record<string, any>>;
  logging: Partial<LoggingConfig>;
}
export interface Project { id: string; name: string; description: string; config: ProjectConfig; updated_at: string; /** A person's own copy (Git clone): their username; '' for the team's projects. */ owner?: string; restricted?: number | boolean }

export const defaultLogging: LoggingConfig = { enabled: true, file: 'logs/{project}.log', level: 'info', format: 'text', maxSizeMb: 10, maxFiles: 5, stepData: false };
const emptyOps: OpsConfig = { variables: {}, resources: {}, logging: {} };

const rowTo = (r: any): Project => {
  const c = JSON.parse(r.config || '{}');
  return { ...r, description: r.description || '', config: { variables: c.variables || [], logging: { ...defaultLogging, ...(c.logging || {}) } } };
};

export function listProjects() {
  return q.all<any>(`select p.*, (select count(*) from flows f where f.project_id = p.id) flows from projects p order by name`).map(r => ({ ...rowTo(r), flows: r.flows }));
}
export function getProject(id: string): Project | undefined {
  const r = q.get('select * from projects where id = ?', id);
  return r ? rowTo(r) : undefined;
}
export function requireProject(id: string) {
  const p = getProject(id);
  if (!p) throw new Error('Project not found');
  return p;
}
export function ensureDefaultProject() {
  const r = q.get<{ id: string }>('select id from projects order by updated_at limit 1');
  return r ? r.id : saveProject({ name: 'My project' }).id;
}

const VAR_NAME = /^[A-Za-z_][\w]*$/;
export function saveProject(p: { id?: string; name: string; description?: string; config?: Partial<ProjectConfig> }) {
  const id = p.id || crypto.randomUUID();
  const prev = p.id ? getProject(p.id) : undefined;
  const cfg: ProjectConfig = {
    variables: (p.config?.variables ?? prev?.config.variables ?? []).map(v => ({ name: String(v.name).trim(), type: v.type || 'string', value: String(v.value ?? ''), description: v.description || '' })),
    logging: { ...defaultLogging, ...(prev?.config.logging || {}), ...(p.config?.logging || {}) },
  };
  const seen = new Set<string>();
  for (const v of cfg.variables) {
    if (!VAR_NAME.test(v.name)) throw new Error(`Variable name "${v.name}" must start with a letter or _ and use letters, digits and _`);
    if (seen.has(v.name)) throw new Error(`Variable ${v.name} is defined twice`);
    seen.add(v.name);
  }
  const name = String(p.name || prev?.name || 'Project').trim();
  if (q.get('select 1 from projects where lower(name) = lower(?) and id != ?', name, id)) throw new Error(`A project named "${name}" already exists`);
  q.run(`insert into projects(id, name, description, config, updated_at) values(?, ?, ?, ?, ?)
    on conflict(id) do update set name = excluded.name, description = excluded.description, config = excluded.config, updated_at = excluded.updated_at`,
    id, name, p.description ?? prev?.description ?? '', JSON.stringify(cfg), now());
  onProjectChange.forEach(fn => fn(id));
  return getProject(id)!;
}

export function deleteProject(id: string) {
  const n = q.get<{ n: number }>('select count(*) n from flows where project_id = ?', id)!.n;
  if (n) throw new Error('Move or delete the project\'s Sutras first');
  tx(() => {
    q.run('delete from resources where project_id = ?', id);
    q.run('delete from schemas where project_id = ?', id);
    q.run('delete from folders where project_id = ?', id);
    q.run('delete from projects where id = ?', id);
  });
  setSetting(`ops:${id}`, emptyOps);
}

export const onProjectChange: Array<(id: string) => void> = [];

// ---------- ops config ----------

export function getOps(projectId: string): OpsConfig {
  return { ...emptyOps, ...getSetting<Partial<OpsConfig>>(`ops:${projectId}`, {}) };
}
export function setOps(projectId: string, ops: Partial<OpsConfig>) {
  const clean: OpsConfig = {
    variables: Object.fromEntries(Object.entries(ops.variables || {}).map(([k, v]) => [k, String(v)])),
    resources: ops.resources || {},
    logging: ops.logging || {},
  };
  setSetting(`ops:${projectId}`, clean);
  // A new deployment config replaces values set at run time by set-project-variable().
  setSetting(`runtimeVars:${projectId}`, {});
  onProjectChange.forEach(fn => fn(projectId));
  return clean;
}

/** The file an operations team edits: every variable and resource setting that can be overridden. */
export function exportOpsFile(projectId: string) {
  const p = requireProject(projectId);
  const ops = getOps(projectId);
  const resources = q.all<any>('select name, kind, config from resources where project_id = ? order by name', projectId);
  return {
    $comment: 'SutraFlow deployment config. Change values for this environment; ${env:NAME} reads an environment variable. Secret variables and *Secret fields hold names of vault secrets, not the secrets.',
    project: p.name,
    exportedAt: now(),
    variables: Object.fromEntries(p.config.variables.map(v => [v.name, ops.variables[v.name] ?? v.value])),
    resources: Object.fromEntries(resources.map(r => [r.name, { kind: r.kind, ...JSON.parse(r.config), ...(ops.resources[r.name] || {}) }])),
    logging: { ...p.config.logging, ...ops.logging },
  };
}

/** Imports an edited config file; only values that differ from the project's defaults are kept as overrides. */
export function importOpsFile(projectId: string, file: any) {
  const p = requireProject(projectId);
  if (!file || typeof file !== 'object') throw new Error('The config file is not a JSON object');
  if (file.project && file.project !== p.name) throw new Error(`This config file is for project "${file.project}", not "${p.name}"`);
  const variables: Record<string, string> = {};
  for (const [k, v] of Object.entries(file.variables || {})) {
    const def = p.config.variables.find(x => x.name === k);
    if (!def) throw new Error(`Unknown variable ${k}`);
    if (String(v) !== def.value) variables[k] = String(v);
  }
  const resources: Record<string, Record<string, any>> = {};
  for (const [name, vals] of Object.entries<any>(file.resources || {})) {
    const r = q.get<any>('select config from resources where project_id = ? and name = ?', projectId, name);
    if (!r) throw new Error(`Unknown resource ${name}`);
    const base = JSON.parse(r.config);
    const diff = Object.fromEntries(Object.entries(vals).filter(([k, v]) => k !== 'kind' && JSON.stringify(v) !== JSON.stringify(base[k])));
    if (Object.keys(diff).length) resources[name] = diff;
  }
  const logging = Object.fromEntries(Object.entries(file.logging || {}).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify((p.config.logging as any)[k])));
  return setOps(projectId, { variables, resources, logging });
}

/** Loads data/config/<project name>.json files dropped there by operations, at startup. */
export function loadOpsFiles(log: (m: string) => void = () => {}) {
  const dir = process.env.SUTRA_CONFIG_DIR || path.join(config.dataDir, 'config');
  if (!fs.existsSync(dir)) return;
  for (const p of listProjects()) {
    const file = path.join(dir, `${p.name}.json`);
    if (!fs.existsSync(file)) continue;
    try {
      importOpsFile(p.id, JSON.parse(fs.readFileSync(file, 'utf8')));
      log(`Loaded deployment config ${file}`);
    } catch (e: any) {
      log(`Could not load ${file}: ${e.message}`);
    }
  }
}

/** ${env:NAME} and ${env:NAME:-default} read process environment variables. */
export function substituteEnv(v: unknown): any {
  if (typeof v === 'string') {
    return v.replace(/\$\{env:([A-Za-z_][\w]*)(?::-([^}]*))?\}/g, (_, name, def) => {
      const e = process.env[name];
      if (e === undefined && def === undefined) throw new Error(`Environment variable ${name} is not set`);
      return e ?? def;
    });
  }
  if (Array.isArray(v)) return v.map(substituteEnv);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, substituteEnv(x)]));
  return v;
}

// ---------- effective values at run time ----------

export interface EffectiveVars { values: Record<string, any>; secrets: string[] }

/** Project variables with ops overrides applied, typed. Secret variables resolve through the vault. */
export function effectiveVariables(projectId: string | null | undefined): EffectiveVars {
  if (!projectId) return { values: {}, secrets: [] };
  const p = getProject(projectId);
  if (!p) return { values: {}, secrets: [] };
  const ops = getOps(projectId);
  const values: Record<string, any> = {};
  const secrets: string[] = [];
  for (const v of p.config.variables) {
    const rt = getSetting<Record<string, string>>(`runtimeVars:${projectId}`, {});
    const raw = substituteEnv(rt[v.name] ?? ops.variables[v.name] ?? v.value);
    if (v.type === 'number') values[v.name] = Number(raw);
    else if (v.type === 'boolean') values[v.name] = ['true', '1', 'yes'].includes(String(raw).toLowerCase());
    else if (v.type === 'secret') {
      const s = raw ? getSecret(raw) : undefined;
      if (s !== undefined) { values[v.name] = s; secrets.push(s); } else values[v.name] = undefined;
    } else values[v.name] = raw;
  }
  return { values, secrets };
}

/** set-project-variable(): a runtime value that wins until the deployment config changes. */
export function setRuntimeVariable(projectId: string | null, name: string, value: unknown) {
  if (!projectId) throw new Error('set-project-variable() needs a run that belongs to a project');
  const p = requireProject(projectId);
  const def = p.config.variables.find(v => v.name === name);
  if (!def) throw new Error(`Project variable ${name} is not defined in ${p.name}`);
  if (def.type === 'secret') throw new Error(`${name} is a secret variable and cannot be set from a Sutra`);
  const rt = getSetting<Record<string, string>>(`runtimeVars:${projectId}`, {});
  rt[name] = typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
  setSetting(`runtimeVars:${projectId}`, rt);
}
export const runtimeVariables = (projectId: string) => getSetting<Record<string, string>>(`runtimeVars:${projectId}`, {});
export function clearRuntimeVariables(projectId: string) { setSetting(`runtimeVars:${projectId}`, {}); }

// ---------- engine (administrator) variables, shared by all projects ----------
export interface EngineVariable { name: string; value: string; description?: string }
export const listEngineVariables = () => getSetting<EngineVariable[]>('engineVars', []);
export function saveEngineVariables(vars: EngineVariable[]) {
  const seen = new Set<string>();
  const clean = vars.map(v => ({ name: String(v.name || '').trim(), value: String(v.value ?? ''), description: v.description ? String(v.description) : undefined }));
  for (const v of clean) {
    if (!VAR_NAME.test(v.name)) throw new Error(`Sengine variable name "${v.name}" must start with a letter or _`);
    if (seen.has(v.name)) throw new Error(`Sengine variable ${v.name} is defined twice`);
    seen.add(v.name);
  }
  setSetting('engineVars', clean);
  return clean;
}
export function engineVariableValues() {
  return Object.fromEntries(listEngineVariables().map(v => [v.name, substituteEnv(v.value)]));
}
/** Sutras read Sengine variables; changing them from a Sutra needs the administrator's permission. */
export function sutrasMayChangeSengine() { return getSetting<boolean>('sengineWritable', false); }
export function setSutrasMayChangeSengine(on: boolean) { setSetting('sengineWritable', !!on); }
/** Script activities (PowerShell, shell, programs) run on the server only when the administrator allows them. */
export function scriptsAllowed() { return getSetting<boolean>('scriptsAllowed', false); }
export function setScriptsAllowed(on: boolean) { setSetting('scriptsAllowed', !!on); }
/** Release activities (build, deploy, roll back packages) only when the administrator allows them. */
export function releasesAllowed() { return getSetting<boolean>('releasesAllowed', false); }
export function setReleasesAllowed(on: boolean) { setSetting('releasesAllowed', !!on); }

export function setEngineVariable(name: string, value: unknown) {
  if (!sutrasMayChangeSengine()) throw new Error(`Sengine variables are read-only for Sutras, so ${name} was not changed. An administrator can allow changes in Server & APIs.`);
  const vars = listEngineVariables();
  const v = vars.find(x => x.name === name);
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
  if (v) v.value = text; else vars.push({ name, value: text });
  saveEngineVariables(vars);
}

export function effectiveLogging(projectId: string): LoggingConfig {
  const p = getProject(projectId);
  return substituteEnv({ ...defaultLogging, ...(p?.config.logging || {}), ...getOps(projectId).logging });
}

/** Resource settings with the project's ops overrides for that resource name applied. */
export function applyResourceOverrides(r: { project_id?: string | null; name: string; config: Record<string, any> }) {
  if (!r.project_id) return substituteEnv(r.config);
  const o = getOps(r.project_id).resources[r.name];
  return substituteEnv(o ? { ...r.config, ...o } : r.config);
}
