import fsp from 'node:fs/promises';
import { engine } from './engine/engine.js';
import type { FlowDoc, FlowNode } from './engine/types.js';
import { deployedFlows } from './flows.js';
import { listFiles } from './palettes/file.js';
import { parseContent } from './palettes/fileformat.js';
import { schemaTree } from './schemas.js';
import { effectiveVariables, engineVariableValues } from './projects.js';
import { resolveSettings } from './settings.js';

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
  fire(input: unknown, onFinish?: (status: string, runId: string) => void): string;
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
        fire: (input, onFinish) => engine.startRun({ doc: d.doc, flowId: d.flowId, projectId: d.projectId, version: d.version, triggerNodeId: n.id, input, source: n.type, onFinish }),
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
  type Seen = { size: number; mtime: string; changedAt: number; reported: boolean };
  let known: Map<string, Seen> | null = null;
  let busy = false;
  // Content as text, CSV rows, lines, JSON, XML or base64 (older steps: readContent text/base64).
  const fmt = cfg.format || (cfg.readContent === 'base64' ? 'base64 (binary)' : cfg.readContent === 'text' ? 'text' : 'do not read');
  const rowSchema = cfg.schema ? schemaTree(cfg.schema) : null;
  const read = async (p: string): Promise<Record<string, any>> => {
    if (fmt === 'do not read') return {};
    try { return parseContent(await fsp.readFile(p), { ...cfg, format: fmt }, rowSchema); }
    catch (e: any) { return { readError: e.message }; }
  };
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const files = await listFiles(folder, String(cfg.pattern || '*'), !!cfg.recursive);
      const now = Date.now();
      if (!known) {
        // First scan: existing files are the baseline, not events.
        known = new Map(files.map(f => [f.path, { size: f.size, mtime: f.modifiedAt, changedAt: 0, reported: true }]));
        c.status('ok', `Watching ${folder} (${files.length} existing files)`);
        return;
      }
      const seen = new Set<string>();
      for (const f of files) {
        seen.add(f.path);
        const k = known.get(f.path);
        if (!k) { known.set(f.path, { size: f.size, mtime: f.modifiedAt, changedAt: now, reported: false }); continue; }
        if (k.size !== f.size || k.mtime !== f.modifiedAt) { Object.assign(k, { size: f.size, mtime: f.modifiedAt, changedAt: now, reported: false, modified: k.reported }); continue; }
        if (!k.reported && now - k.changedAt >= stableMs) {
          k.reported = true;
          const event = (k as any).modified ? 'modified' : 'added';
          if (events.has(event)) {
            const ext = f.name.includes('.') ? f.name.split('.').pop() : '';
            c.fire({ event, path: f.path, name: f.name, relativePath: f.name, folder, extension: ext, size: f.size, modifiedAt: f.modifiedAt, ...(await read(f.path)) });
          }
        }
      }
      for (const [p, k] of known) {
        if (seen.has(p)) continue;
        known.delete(p);
        if (k.reported && events.has('removed')) c.fire({ event: 'removed', path: p, name: p.slice(folder.length).replace(/^[\\/]/, '').split('\\').join('/'), folder });
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
