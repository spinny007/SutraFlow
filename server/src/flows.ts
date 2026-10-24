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
import { q, tx, now } from './db.js';
import { engine } from './engine/engine.js';
import { ensureDefaultProject, getProject } from './projects.js';
import { setItemFolder } from './folders.js';
import type { FlowDoc } from './engine/types.js';
import { designSchemas } from './design.js';

/**
 * Flows have an editable draft plus immutable published versions. Deploying
 * picks a version; the gateway, timers and the Run API use the deployed version
 * while the draft keeps changing in the studio.
 */
export interface FlowRow { id: string; name: string; project_id: string; doc: FlowDoc; version: number; updated_at: string; deployed?: { version: number; enabled: boolean; deployed_at: string } | null }

const rowToFlow = (r: any): FlowRow => ({ ...r, doc: JSON.parse(r.doc) });

export function listFlows(projectId?: string) {
  return q.all<any>(`select f.id, f.name, f.project_id, f.folder, f.version, f.updated_at, d.version dversion, d.enabled, d.deployed_at
    from flows f left join deployments d on d.flow_id = f.id ${projectId ? 'where f.project_id = ?' : ''} order by f.name`, ...(projectId ? [projectId] : [])).map(r => ({
    id: r.id, name: r.name, projectId: r.project_id, folder: r.folder || '', version: r.version, updated_at: r.updated_at,
    deployed: r.dversion != null ? { version: r.dversion, enabled: !!r.enabled, deployed_at: r.deployed_at } : null,
  }));
}

export function getFlow(id: string): FlowRow | undefined {
  const r = q.get('select * from flows where id = ?', id);
  if (!r) return undefined;
  const f = rowToFlow(r);
  const d = q.get<any>('select * from deployments where flow_id = ?', id);
  f.deployed = d ? { version: d.version, enabled: !!d.enabled, deployed_at: d.deployed_at } : null;
  return f;
}

export function normalizeDoc(doc: any): FlowDoc {
  if (!doc || !Array.isArray(doc.nodes) || !Array.isArray(doc.edges)) throw new Error('A Sutra needs nodes and edges lists');
  const nodes = doc.nodes.map((n: any) => ({
    id: String(n.id || crypto.randomUUID()),
    type: String(n.type),
    name: String(n.name || n.type).replace(/[.[\]{}|]/g, '').trim() || 'Step',
    x: Number(n.x) || 0,
    y: Number(n.y) || 0,
    config: n.config && typeof n.config === 'object' ? n.config : {},
    ...(n.description && String(n.description).trim() ? { description: String(n.description).slice(0, 4000) } : {}),
    settings: n.settings && typeof n.settings === 'object' ? n.settings : undefined,
  }));
  const ids = new Set(nodes.map((n: any) => n.id));
  const edges = doc.edges
    .filter((e: any) => e && ids.has(String(e.from)) && ids.has(String(e.to)))
    .map((e: any) => ({
      id: String(e.id || crypto.randomUUID()), from: String(e.from), port: String(e.port || 'out'), to: String(e.to),
      ...(e.label ? { label: String(e.label).slice(0, 80) } : {}),
      ...(e.when === 'when' || e.when === 'otherwise' ? { when: e.when } : {}),
      ...(e.when === 'when' && e.condition ? { condition: String(e.condition) } : {}),
    }));
  const variables = Array.isArray(doc.variables)
    ? doc.variables.filter((v: any) => v && /^[A-Za-z_]\w*$/.test(String(v.name || ''))).map((v: any) => ({ name: String(v.name), type: String(v.type || 'string'), value: v.value ?? '', description: v.description ? String(v.description) : undefined }))
    : undefined;
  return { name: String(doc.name || 'Untitled Sutra'), description: doc.description ? String(doc.description) : undefined, variables, nodes, edges };
}

/** Problems that stop a deploy (errors) or deserve attention (warnings). */
/**
 * Project variables a value reads: {gv.X}, {{gv.X}}, $gv.X (JSONata) and get-project-variable('X').
 * The studio has the same rule in web/src/vars.ts.
 */
export function variablesUsed(v: unknown): string[] {
  const text = JSON.stringify(v ?? '');
  const out = new Set<string>();
  for (const m of text.matchAll(/\bgv\.([A-Za-z_]\w*)/g)) out.add(m[1]);
  for (const m of text.matchAll(/get-project-variable\(\s*\\?['"]([A-Za-z_]\w*)/g)) out.add(m[1]);
  return [...out];
}

/** Steps or transition connections that read project variables the project does not define. */
export function missingVariables(doc: FlowDoc, projectId: string) {
  const p = getProject(projectId);
  if (!p) return [];
  const defined = new Set((p.config.variables || []).map((v: { name: string }) => v.name));
  const conns = q.all<{ id: string; name: string; config: string }>('select id, name, config from resources where project_id = ?', projectId);
  const out: { step: string; name: string; via: string }[] = [];
  for (const n of doc.nodes) {
    const text = JSON.stringify(n.config);
    for (const name of variablesUsed(n.config)) if (!defined.has(name)) out.push({ step: n.name, name, via: '' });
    for (const r of conns) if (text.includes(r.id)) for (const name of variablesUsed(JSON.parse(r.config))) if (!defined.has(name)) out.push({ step: n.name, name, via: r.name });
  }
  for (const e of doc.edges) {
    const from = doc.nodes.find(n => n.id === e.from)?.name || e.from;
    const to = doc.nodes.find(n => n.id === e.to)?.name || e.to;
    const connection = e.label ? `\"${e.label}\"` : `${from} to ${to}`;
    for (const name of variablesUsed(e.condition)) if (!defined.has(name)) out.push({ step: `Connection ${connection}`, name, via: '' });
  }
  return out;
}

export function validateDoc(doc: FlowDoc, projectId?: string) {
  const errors: string[] = [], warnings: string[] = [];
  if (projectId) for (const m of missingVariables(doc, projectId)) warnings.push(`${m.step}: project variable ${m.name} is not defined in this project${m.via ? ` (used by the connection ${m.via})` : ''}; it reads as empty`);
  const names = new Set<string>();
  for (const n of doc.nodes) {
    const a = engine.activity(n.type);
    if (!a) errors.push(`${n.name}: unknown step type ${n.type}`);
    if (names.has(n.name)) errors.push(`Two steps are named "${n.name}". Step names must be unique because mappings refer to them.`);
    names.add(n.name);
    if (a && !a.trigger && !a.noInput && !doc.edges.some(e => e.to === n.id)) warnings.push(`${n.name} has no incoming connection and will never run`);
    if (a?.designCheck && !n.settings?.disabled) { try { for (const w of a.designCheck(n.config || {})) warnings.push(`${n.name}: ${w}`); } catch (e: any) { warnings.push(`${n.name}: ${e.message}`); } }
    if (a?.designErrors && !n.settings?.disabled) { try { for (const issue of a.designErrors(n.config || {})) errors.push(`${n.name}: ${issue}`); } catch (e: any) { errors.push(`${n.name}: ${e.message}`); } }
  }
  const triggers = doc.nodes.filter(n => engine.activity(n.type)?.trigger);
  if (!triggers.length) errors.push('The Sutra has no trigger step');
  for (const e of doc.edges) {
    const from = doc.nodes.find(n => n.id === e.from)!;
    if (!engine.portsOf(from).includes(e.port)) warnings.push(`${from.name} has no output "${e.port}"; that connection never fires`);
    const to = doc.nodes.find(n => n.id === e.to)!;
    if (engine.activity(to.type)?.trigger) errors.push(`${to.name} is a trigger and cannot receive a connection`);
    const cname = e.label ? `"${e.label}"` : `${from.name} to ${to.name}`;
    if (e.when === 'when' && !String(e.condition || '').trim()) errors.push(`Connection ${cname} is set to "when" but has no condition`);
    if (e.when === 'otherwise' && !doc.edges.some(x => x.from === e.from && x.port === e.port && x.when === 'when')) warnings.push(`Connection ${cname} is "otherwise" but no other connection from ${from.name} (${e.port}) has a condition, so it always runs`);
    if (engine.activity(to.type)?.noInput) errors.push(`${to.name} starts by itself when an error is not handled and cannot receive a connection`);
  }
  for (const t of triggers) {
    if (t.type === 'restService' && !doc.nodes.some(n => n.type === 'httpResponse')) warnings.push(`${t.name}: no Send HTTP response step; callers get the last step's output as JSON`);
    if (t.type === 'soapService' && !doc.nodes.some(n => n.type === 'soapReply')) warnings.push(`${t.name}: no SOAP reply step; callers get the last step's output`);
    if (t.type === 'mcpTool') {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(t.config.toolName || ''))) errors.push(`${t.name}: the tool name may use only letters, digits, _ and - (up to 64)`);
      if (String(t.config.description || '').trim().length < 20) warnings.push(`${t.name}: describe what the tool does and when to use it; the AI chooses tools by their description`);
      if (!doc.nodes.some(n => n.type === 'mcpReply')) warnings.push(`${t.name}: no Reply to AI step; the AI receives the last step's output`);
    }
    if ((t.type === 'restService' || t.type === 'soapService') && !t.config.policy) warnings.push(`${t.name}: no API security policy, anyone who can reach the gateway can call it`);
  }
  if (doc.nodes.filter(n => engine.activity(n.type)?.noInput).length > 1) errors.push('A Sutra can have only one Error handler');
  const designs = designSchemas(doc);
  for (const n of doc.nodes) if (!n.settings?.disabled) {
    errors.push(...designs[n.id].errors.map(issue => `${n.name}: ${issue}`).filter(issue => !errors.includes(issue)));
    warnings.push(...designs[n.id].warnings.map(issue => `${n.name}: ${issue}`).filter(issue => !warnings.includes(issue)));
  }
  return { errors, warnings };
}

// ---------- folders (see folders.ts) ----------
export { normFolder, listFolders, createFolder, moveFolder, removeFolder } from './folders.js';

/** Moves a Sutra to a folder ('' = the top); the folder is made when missing. */
export function setFlowFolder(id: string, folder: unknown) {
  setItemFolder('sutras', id, folder);
  return getFlow(id)!;
}

export function saveFlow(id: string | undefined, raw: any, projectId?: string) {
  const doc = normalizeDoc(raw);
  const fid = id || crypto.randomUUID();
  const existing = id ? q.get<{ project_id: string }>('select project_id from flows where id = ?', id) : undefined;
  const pid = projectId || existing?.project_id || ensureDefaultProject();
  if (q.get('select 1 from flows where project_id = ? and lower(name) = lower(?) and id != ?', pid, doc.name, fid)) {
    throw new Error(`This project already has a Sutra named "${doc.name}"`);
  }
  q.run(`insert into flows(id, name, project_id, doc, version, updated_at) values(?, ?, ?, ?, 0, ?)
    on conflict(id) do update set name = excluded.name, doc = excluded.doc, updated_at = excluded.updated_at`,
    fid, doc.name, pid, JSON.stringify(doc), now());
  return getFlow(fid)!;
}

export function deleteFlow(id: string) {
  tx(() => {
    q.run('delete from deployments where flow_id = ?', id);
    q.run('delete from flow_versions where flow_id = ?', id);
    q.run('delete from flows where id = ?', id);
  });
  onDeploymentsChange.forEach(fn => fn());
}

export function publish(flowId: string, note = '') {
  const f = getFlow(flowId);
  if (!f) throw new Error('Sutra not found');
  const v = validateDoc(f.doc, f.project_id);
  if (v.errors.length) throw new Error(v.errors.join('\n'));
  const version = f.version + 1;
  tx(() => {
    q.run('insert into flow_versions(flow_id, version, doc, note, created_at) values(?, ?, ?, ?, ?)', flowId, version, JSON.stringify(f.doc), note, now());
    q.run('update flows set version = ? where id = ?', version, flowId);
  });
  return { version, warnings: v.warnings };
}

export function versions(flowId: string) {
  return q.all('select version, note, created_at from flow_versions where flow_id = ? order by version desc', flowId);
}

export function versionDoc(flowId: string, version: number): FlowDoc | undefined {
  const r = q.get<{ doc: string }>('select doc from flow_versions where flow_id = ? and version = ?', flowId, version);
  return r ? JSON.parse(r.doc) : undefined;
}

export function deploy(flowId: string, version?: number, note = '') {
  const owner = q.get<any>('select p.owner from flows f join projects p on p.id = f.project_id where f.id = ?', flowId)?.owner;
  if (owner) throw new Error(`This Sutra is in ${owner}'s own copy of a repository: test it here, push it, and deploy from the team's project`);
  let warnings: string[] = [];
  if (!version) ({ version, warnings } = publish(flowId, note || 'Deployed from studio'));
  if (!versionDoc(flowId, version)) throw new Error(`Version ${version} does not exist`);
  assertNoRouteClash(flowId, versionDoc(flowId, version)!);
  q.run(`insert into deployments(flow_id, version, enabled, deployed_at) values(?, ?, 1, ?)
    on conflict(flow_id) do update set version = excluded.version, enabled = 1, deployed_at = excluded.deployed_at`, flowId, version, now());
  onDeploymentsChange.forEach(fn => fn());
  return { version, warnings };
}

export function undeploy(flowId: string) {
  q.run('delete from deployments where flow_id = ?', flowId);
  onDeploymentsChange.forEach(fn => fn());
}

/** Starts or stops a deployed Sutra: stopped, its triggers start no runs; runs in flight finish. */
export function setEnabled(flowId: string, enabled: boolean) {
  const d = q.get<{ version: number }>('select version from deployments where flow_id = ?', flowId);
  if (!d) throw new Error('This Sutra is not deployed');
  if (enabled) assertNoRouteClash(flowId, versionDoc(flowId, d.version)!);
  q.run('update deployments set enabled = ? where flow_id = ?', enabled ? 1 : 0, flowId);
  onDeploymentsChange.forEach(fn => fn());
}

export function deployedFlows(): { flowId: string; projectId: string; version: number; doc: FlowDoc }[] {
  return q.all<any>(`select d.flow_id, f.project_id, d.version, v.doc from deployments d
    join flow_versions v on v.flow_id = d.flow_id and v.version = d.version
    join flows f on f.id = d.flow_id where d.enabled = 1`)
    .map(r => ({ flowId: r.flow_id, projectId: r.project_id, version: r.version, doc: JSON.parse(r.doc) }));
}

export const onDeploymentsChange: Array<() => void> = [];

const routeKey = (n: any) => n.type === 'restService'
  ? `${String(n.config.method || 'ANY').toUpperCase()} ${normPath(n.config.path)}`
  : n.type === 'soapService' ? `SOAP ${normPath(n.config.path)}` : null;
export const normPath = (p: unknown) => '/' + String(p || '').trim().replace(/^\/+|\/+$/g, '').replace(/:[^/]+/g, ':p');

function assertNoRouteClash(flowId: string, doc: FlowDoc) {
  // AI tool names must be unique on their MCP address.
  const toolKey = (n: any) => `${n.config.server || ''}::${String(n.config.toolName || '')}`;
  const myTools = doc.nodes.filter(n => n.type === 'mcpTool').map(toolKey);
  for (const d of deployedFlows()) {
    if (d.flowId === flowId) continue;
    for (const n of d.doc.nodes) if (n.type === 'mcpTool' && myTools.includes(toolKey(n))) throw new Error(`AI tool name "${n.config.toolName}" is already used on this MCP server by deployed Sutra "${d.doc.name}"`);
  }
  const mine = doc.nodes.map(routeKey).filter(Boolean) as string[];
  for (const d of deployedFlows()) {
    if (d.flowId === flowId) continue;
    for (const n of d.doc.nodes) {
      const k = routeKey(n);
      if (!k) continue;
      for (const m of mine) {
        const [ma, mp] = m.split(' '), [ka, kp] = k.split(' ');
        const sameMethod = ma === ka || ma === 'ANY' || ka === 'ANY' || ma === 'SOAP' || ka === 'SOAP';
        if (mp === kp && sameMethod) throw new Error(`Path ${kp} is already served by deployed Sutra "${d.doc.name}"`);
      }
    }
  }
}
