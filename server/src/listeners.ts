/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import fsp from 'node:fs/promises';
import { engine } from './engine/engine.js';
import type { FlowDoc, FlowNode } from './engine/types.js';
import { deployedFlows } from './flows.js';
import { listFiles } from './palettes/file.js';
import { parseValidatedContent } from './palettes/fileformat.js';
import { schemaTree } from './schemas.js';
import { effectiveVariables, engineVariableValues } from './projects.js';
import { resolveSettings } from './settings.js';
import { q } from './db.js';

/**
 * Long-running triggers of deployed flows: file watchers, mailbox polling,
 * queue/topic subscriptions, cloud-file polling. Each trigger type registers a
 * starter; all listeners restart whenever deployments or resources change.
 */
export interface ListenerContext {
  flowId: string;
  projectId: string;
  version: number;
  doc: FlowDoc;
  node: FlowNode;
  /** Starts a run. onFinish lets queue listeners acknowledge only after the flow succeeded. */
  fire(input: unknown, onFinish?: (status: string, runId: string) => void, runId?: string): Promise<string>;
  status(state: 'ok' | 'error', message: string): void;
}
export type ListenerStarter = (c: ListenerContext) => Promise<() => void | Promise<void>> | (() => void | Promise<void>);

const starters = new Map<string, ListenerStarter>();
export function registerListener(type: string, s: ListenerStarter) { starters.set(type, s); }

const running: { key: string; stop: () => void | Promise<void> }[] = [];
export const listenerStatus = new Map<string, { flow: string; step: string; type: string; state: string; message: string; at: string }>();

let rebuilding: Promise<void> = Promise.resolve();
/** Rebuilds run one after another, so two quick deploys never start a listener twice. */
export function rebuildListeners(): Promise<void> {
  rebuilding = rebuilding.then(rebuild, rebuild);
  return rebuilding;
}

async function rebuild() {
  await stopListeners();
  for (const d of deployedFlows()) {
    for (const n of d.doc.nodes) {
      const start = starters.get(n.type);
      if (!start) continue;
      const key = `${d.flowId}:${n.id}`;
      const status = (state: 'ok' | 'error', message: string) =>
        listenerStatus.set(key, { flow: d.doc.name, step: n.name, type: n.type, state, message, at: new Date().toISOString() });
      // Trigger settings (folders, topics, queues…) may use project and engine variables.
      const act = engine.activity(n.type);
      const resolved = act ? { ...n, config: resolveSettings(act.fields, n.config, { gv: effectiveVariables(d.projectId).values, ev: engineVariableValues() }) } : n;
      const ctx: ListenerContext = {
        flowId: d.flowId, projectId: d.projectId, version: d.version, doc: d.doc, node: resolved, status,
        // A run that cannot start (the database is unreachable) shows on the listener and is logged; the
        // event's source keeps it (an unacknowledged message, a file not moved) to try again later.
        fire: (input, onFinish, runId) => engine.startRun({ id: runId, doc: d.doc, flowId: d.flowId, projectId: d.projectId, version: d.version, triggerNodeId: n.id, input, source: n.type, onFinish })
          .catch((e: any) => { status('error', `A run could not start: ${e?.message || e}`); console.error(`${d.doc.name} / ${n.name}: a run could not start:`, e?.message || e); return ''; }),
      };
      try {
        const stop = await start(ctx);
        running.push({ key, stop });
        if (!listenerStatus.get(key) || listenerStatus.get(key)!.state !== 'error') status('ok', 'Listening');
      } catch (e: any) {
        status('error', e?.message || String(e));
      }
    }
  }
}

export async function stopListeners() {
  const all = running.splice(0);
  listenerStatus.clear();
  await Promise.all(all.map(async r => { try { await r.stop(); } catch { /* best effort */ } }));
}

// ---------- File trigger: polling with stability check ----------
registerListener('fileTrigger', c => {
  const cfg = c.node.config;
  const folder = String(cfg.folder || '').trim();
  if (!folder) throw new Error('Folder is not set');
  const events = new Set<string>(Array.isArray(cfg.events) && cfg.events.length ? cfg.events : ['added', 'modified', 'removed']);
  const every = Math.max(1, Number(cfg.pollSeconds) || 10) * 1000;
  const stableMs = Math.max(0, Number(cfg.stableSeconds) || 0) * 1000;
  type Seen = { size: number; mtime: string; changedAt: number; reported: boolean; inFlight?: boolean };
  let known: Map<string, Seen> | null = null;
  let busy = false;
  // Content as text, CSV rows, lines, JSON, XML or base64 (older steps: readContent text/base64).
  const fmt = cfg.format || (cfg.readContent === 'base64' ? 'base64 (binary)' : cfg.readContent === 'text' ? 'text' : 'do not read');
  const rowSchema = cfg.schema ? schemaTree(cfg.schema) : null;
  const save = (p: string, k: Seen) => q.run(`insert into file_listener_files(flow_id, node_id, path, size, mtime) values(?, ?, ?, ?, ?)
    on conflict(flow_id, node_id, path) do update set size = excluded.size, mtime = excluded.mtime`, c.flowId, c.node.id, p, k.size, k.mtime);
  const forget = (p: string) => q.run('delete from file_listener_files where flow_id = ? and node_id = ? and path = ?', c.flowId, c.node.id, p);
  const read = async (p: string): Promise<Record<string, any>> => {
    if (fmt === 'do not read') return {};
    try { return await parseValidatedContent(await fsp.readFile(p), { ...cfg, format: fmt }, rowSchema); }
    catch (e: any) { return { readError: e.message }; }
  };
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const files = await listFiles(folder, String(cfg.pattern || '*'), !!cfg.recursive);
      const now = Date.now();
      if (!known) {
        // The first deployment baselines existing files. Later leaders load the shared checkpoint,
        // so a file that arrived or failed on another leader is not lost when leadership changes.
        const initialized = !!q.get('select 1 as x from file_listener_state where flow_id = ? and node_id = ?', c.flowId, c.node.id);
        const saved = initialized ? q.all<{ path: string; size: number; mtime: string }>('select path, size, mtime from file_listener_files where flow_id = ? and node_id = ?', c.flowId, c.node.id) : [];
        known = new Map(saved.map(f => [f.path, { size: Number(f.size), mtime: f.mtime, changedAt: 0, reported: true }]));
        for (const f of files) {
          const old = known.get(f.path);
          known.set(f.path, { size: f.size, mtime: f.modifiedAt, changedAt: initialized && (!old || old.size !== f.size || old.mtime !== f.modifiedAt) ? now : 0, reported: !initialized || !!old && old.size === f.size && old.mtime === f.modifiedAt });
        }
        if (!initialized) {
          q.run('insert into file_listener_state(flow_id, node_id) values(?, ?) on conflict(flow_id, node_id) do nothing', c.flowId, c.node.id);
          for (const [p, k] of known) save(p, k);
        }
        c.status('ok', `Watching ${folder} (${files.length} existing files${initialized ? ', checkpoint restored' : ''})`);
        return;
      }
      const seen = new Set<string>();
      for (const f of files) {
        seen.add(f.path);
        const k = known.get(f.path);
        if (!k) { known.set(f.path, { size: f.size, mtime: f.modifiedAt, changedAt: now, reported: false }); continue; }
        if (k.size !== f.size || k.mtime !== f.modifiedAt) { Object.assign(k, { size: f.size, mtime: f.modifiedAt, changedAt: now, reported: false, inFlight: false, modified: k.reported }); continue; }
        if (!k.reported && !k.inFlight && now - k.changedAt >= stableMs) {
          const event = (k as any).modified ? 'modified' : 'added';
          if (events.has(event)) {
            const ext = f.name.includes('.') ? f.name.split('.').pop() : '';
            // A file is handled only after its run succeeds. Failed durable creation, a failed run,
            // or cancellation leaves the unchanged file eligible for another attempt next poll.
            k.inFlight = true;
            const runId = await c.fire(
              { event, path: f.path, name: f.name, relativePath: f.name, folder, extension: ext, size: f.size, modifiedAt: f.modifiedAt, ...(await read(f.path)) },
              status => {
                k.inFlight = false;
                if (status === 'done') {
                  try { save(f.path, k); k.reported = true; }
                  catch { k.reported = false; k.changedAt = Date.now(); }
                }
                else { k.reported = false; k.changedAt = Date.now(); }
              },
            );
            if (!runId) { k.inFlight = false; continue; }
            continue;
          }
          try { save(f.path, k); k.reported = true; } catch { k.reported = false; }
        }
      }
      for (const [p, k] of known) {
        if (seen.has(p)) continue;
        if (k.inFlight) continue;
        if (k.reported && events.has('removed')) {
          k.inFlight = true;
          const runId = await c.fire({ event: 'removed', path: p, name: p.slice(folder.length).replace(/^[\\/]/, '').split('\\').join('/'), folder }, status => {
            k.inFlight = false;
            if (status === 'done') { try { forget(p); known?.delete(p); } catch { /* retry next poll */ } }
          });
          if (!runId) k.inFlight = false;
        } else {
          try { forget(p); known.delete(p); } catch { /* retry next poll */ }
        }
      }
      c.status('ok', `Watching ${folder}`);
    } catch (e: any) {
      c.status('error', e.message);
    } finally {
      busy = false;
    }
  };
  tick();
  const t = setInterval(tick, every);
  return () => clearInterval(t);
});
