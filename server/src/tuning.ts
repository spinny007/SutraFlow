import { q, getSetting, setSetting } from './db.js';
import { config } from './config.js';
import { settingsCache } from './projects.js';

/**
 * Tuning parameters, changed in the Admin Console while running and applied by every engine without
 * a restart (the change raises the deploy generation; each engine re-reads tuning on its next beat).
 * Environment variables stay the defaults.
 *
 *  Engine: for the whole cluster, and "Steps at once" also per engine.
 *  Sutra:  per deployed Sutra, kept across redeploys of new versions.
 */

export interface Field { k: string; name: string; help: string; type: 'number' | 'select'; min?: number; max?: number; step?: number; unit?: string; options?: string[]; perEngine?: boolean }

export const ENGINE_FIELDS: Field[] = [
  { k: 'workers', name: 'Steps at once', help: 'Steps one engine runs at the same time across all runs. 0 = this engine runs nothing (a studio in a cluster).', type: 'number', min: 0, max: 512, unit: 'steps', perEngine: true },
  { k: 'maxStepsPerRun', name: 'Steps per run limit', help: 'A run that takes more steps is stopped: protects against loops that never end.', type: 'number', min: 10, max: 1000000, unit: 'steps' },
  { k: 'replyTimeoutMs', name: 'Reply wait', help: 'How long REST, SOAP and MCP callers wait for a reply step before they get 504.', type: 'number', min: 1000, max: 600000, step: 1000, unit: 'ms' },
  { k: 'runRetentionDays', name: 'Keep finished runs', help: 'Finished runs older than this are deleted with their steps. 0 = keep.', type: 'number', min: 0, max: 3650, unit: 'days' },
  { k: 'auditRetentionDays', name: 'Keep audit entries', help: 'Audit entries older than this are deleted. 0 = keep.', type: 'number', min: 0, max: 3650, unit: 'days' },
  { k: 'memoryWorkers', name: 'Steps at once in memory', help: 'Steps one engine runs at the same time for Sutras that run in memory. 0 = the same as Steps at once.', type: 'number', min: 0, max: 512, unit: 'steps', perEngine: true },
  { k: 'pollMs', name: 'Queue check', help: 'How often an idle engine looks for due steps. Lower answers sooner and costs more database reads; steps started on the same engine begin at once either way.', type: 'number', min: 20, max: 10000, step: 10, unit: 'ms', perEngine: true },
  { k: 'settingsRefreshMs', name: 'Settings refresh', help: 'How long an engine keeps Project and Sengine variables before reading them again. 0 = read on every step.', type: 'number', min: 0, max: 60000, step: 100, unit: 'ms' },
  { k: 'traceSampling', name: 'Trace sampling', help: 'Share of runs sent to the OpenTelemetry collector: 1 = every run, 0.1 = one in ten.', type: 'number', min: 0, max: 1, step: 0.05 },
];

export const SUTRA_FIELDS: Field[] = [
  { k: 'execution', name: 'Execution', help: 'Durable: every step is saved, so a run survives a restart and can wait. In memory: steps are kept in memory and the run is saved when it ends; several times faster for short request-reply Sutras, but a run open during a restart is lost and steps cannot wait.', type: 'select', options: ['durable', 'in memory'] },
  { k: 'maxRuns', name: 'Runs at once', help: 'More runs than this wait in a queue and start when one ends. 0 = no limit.', type: 'number', min: 0, max: 10000, unit: 'runs' },
  { k: 'priority', name: 'Priority', help: 'Steps of higher priority Sutras are taken from the work queue first.', type: 'number', min: -5, max: 5 },
  { k: 'runTimeoutMin', name: 'Run time limit', help: 'A run still open after this is cancelled with an error. 0 = none.', type: 'number', min: 0, max: 100000, unit: 'min' },
  { k: 'retries', name: 'Retries', help: 'Retries for steps whose own settings do not set any.', type: 'number', min: 0, max: 20 },
  { k: 'retryDelayMs', name: 'First retry after', help: 'Wait before the first retry; it doubles each time.', type: 'number', min: 0, max: 3600000, step: 100, unit: 'ms' },
  { k: 'stepData', name: 'Step data in history', help: 'What run history keeps of each step\'s input and output: all, only for failed runs, or none.', type: 'select', options: ['all', 'errors only', 'none'] },
  { k: 'retentionDays', name: 'Keep finished runs', help: 'Overrides the engine setting for this Sutra. 0 = the engine setting.', type: 'number', min: 0, max: 3650, unit: 'days' },
];

/** The environment (or built-in) values, read once at start. */
const DEFAULTS: Record<string, number> = {
  workers: config.workerConcurrency, maxStepsPerRun: config.maxStepsPerRun, replyTimeoutMs: config.replyTimeoutMs,
  runRetentionDays: config.runRetentionDays, auditRetentionDays: config.auditRetentionDays, traceSampling: config.traceSampling,
  memoryWorkers: config.memoryWorkers, pollMs: config.pollMs, settingsRefreshMs: settingsCache.ms,
};

function clean(fields: Field[], values: Record<string, unknown>, only?: (f: Field) => boolean) {
  const out: Record<string, number | string> = {};
  for (const [k, v] of Object.entries(values || {})) {
    if (v === '' || v === null || v === undefined) continue;
    const f = fields.find(x => x.k === k);
    if (!f) throw new Error(`Unknown setting: ${k}`);
    if (only && !only(f)) throw new Error(`${f.name} cannot be set here`);
    if (f.type === 'select') {
      if (!f.options!.includes(String(v))) throw new Error(`${f.name}: one of ${f.options!.join(', ')}`);
      out[k] = String(v);
    } else {
      const n = Number(v);
      if (!Number.isFinite(n) || n < (f.min ?? -Infinity) || n > (f.max ?? Infinity)) throw new Error(`${f.name}: a number from ${f.min} to ${f.max}`);
      out[k] = f.step && f.step < 1 ? n : Math.round(n);
    }
  }
  return out;
}

// ---------- engine ----------

export function engineTuning(engineId = config.engineId) {
  const cluster = getSetting<Record<string, number>>('tuning.engine', {});
  const perEngine = getSetting<Record<string, Record<string, number>>>('tuning.engines', {});
  return { defaults: DEFAULTS, cluster, perEngine, effective: { ...DEFAULTS, ...cluster, ...(perEngine[engineId] || {}) } as Record<string, number> };
}

/** Saves cluster-wide values (engineId empty) or one engine's Steps at once. Empty values return to the default. */
export function setEngineTuning(values: Record<string, unknown>, engineId?: string) {
  if (engineId) {
    const all = getSetting<Record<string, Record<string, number>>>('tuning.engines', {});
    const v = clean(ENGINE_FIELDS, values, f => !!f.perEngine) as Record<string, number>;
    if (Object.keys(v).length) all[engineId] = v; else delete all[engineId];
    setSetting('tuning.engines', all);
  } else {
    setSetting('tuning.engine', clean(ENGINE_FIELDS, values));
  }
  changed();
}

// ---------- Sutras ----------

let sutraCache = new Map<string, Record<string, any>>();

/** Tuning of a deployed Sutra ({} when none). */
export const sutraTuning = (flowId: string | null | undefined): Record<string, any> => (flowId && sutraCache.get(flowId)) || {};

export function loadSutraTuning() {
  sutraCache = new Map(q.all<any>(`select flow_id, tuning from deployments where tuning is not null and tuning != ''`).map(r => [r.flow_id, JSON.parse(r.tuning)]));
}

export function setSutraTuning(flowId: string, values: Record<string, unknown>) {
  if (!q.get('select 1 from deployments where flow_id = ?', flowId)) throw new Error('This Sutra is not deployed');
  const v = clean(SUTRA_FIELDS, values);
  if (v.execution === 'in memory') {
    const row = q.get<any>('select v.doc from deployments d join flow_versions v on v.flow_id = d.flow_id and v.version = d.version where d.flow_id = ?', flowId);
    const waiting = row ? waitingSteps(JSON.parse(row.doc)) : [];
    if (waiting.length) throw new Error(`Execution in memory: ${waiting.join(', ')} ${waiting.length === 1 ? 'waits' : 'wait'} (for a person or a called Sutra), and runs in memory cannot wait. Keep this Sutra durable.`);
  }
  q.run('update deployments set tuning = ? where flow_id = ?', Object.keys(v).length ? JSON.stringify(v) : null, flowId);
  changed();
  return v;
}

/** Steps that wait for a person or for a called Sutra: a Sutra with any of them cannot run in memory. */
export function waitingSteps(doc: { nodes: { type: string; name: string; config?: Record<string, any> }[] }) {
  return doc.nodes.filter(n => ['approval', 'askPerson', 'agentHandoff'].includes(n.type) || (n.type === 'callProcess' && n.config?.wait !== false)).map(n => n.name);
}

/** Tuned Sutras (for the run-time limit, retention and queue checks). */
export const tunedSutras = () => [...sutraCache.entries()];

// ---------- applying ----------

let onChange: () => void = () => {};
/** index.ts connects this to the deploy generation, so every engine re-applies tuning. */
export function onTuningChange(fn: () => void) { onChange = fn; }
function changed() { applyTuning(); onChange(); }

/** Applies the effective engine values and reloads Sutra tuning. Called at start and on every change. */
export function applyTuning(setWorkers?: (n: number) => void) {
  const e = engineTuning().effective;
  config.maxStepsPerRun = e.maxStepsPerRun;
  config.replyTimeoutMs = e.replyTimeoutMs;
  config.runRetentionDays = e.runRetentionDays;
  config.auditRetentionDays = e.auditRetentionDays;
  config.traceSampling = e.traceSampling;
  config.memoryWorkers = e.memoryWorkers;
  settingsCache.ms = e.settingsRefreshMs;
  if (e.pollMs !== config.pollMs) applyPoll(e.pollMs);
  (setWorkers || applyWorkers)(e.workers);
  loadSutraTuning();
}
let applyWorkers: (n: number) => void = () => {};
export function onWorkersChange(fn: (n: number) => void) { applyWorkers = fn; }
let applyPoll: (ms: number) => void = ms => { config.pollMs = ms; };
export function onPollChange(fn: (ms: number) => void) { applyPoll = fn; }
