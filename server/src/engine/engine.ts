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
import { restrictedReason } from '../git/restricted.js';
import { now, dbKind, memoryStore, q } from '../db.js';
import { asyncDatabase, localStore, type AsyncStore, type TxBody, type TxQ } from '../asyncdb.js';
import { config } from '../config.js';
import { resolve, resolveDeep } from '../template.js';
import { getSecret, maskSecrets } from '../secrets.js';
import { effectiveVariables, engineVariableValues } from '../projects.js';
import { projectLog, wantsStepData, runOrigin } from '../logger.js';
import { schemaTree } from '../schemas.js';
import { adhocTree, evaluateMapping, type MappingValue } from '../mapping.js';
import { resolveSetting } from '../settings.js';
import { truthy } from '../expr.js';
import { metrics } from '../metrics.js';
import { recordSpan, parseTraceparent, traceIdFor, runSpanId, stepSpanId, traceparent as tp } from '../tracing.js';
import { sutraTuning, tunedSutras } from '../tuning.js';
import type { Activity, FlowDoc, FlowEdge, FlowNode, ReplyPayload, StepResult } from './types.js';

/**
 * Durable flow engine.
 *
 * A run is a database row plus a set of task rows (one per step execution). Any
 * free worker slot picks the next pending task, runs the step, and in a single
 * transaction stores the output (the checkpoint) and inserts the tasks for the
 * next steps. Nothing is held in memory between steps, so:
 *  - an approval or long timer waits as a row, costing nothing;
 *  - after a crash or restart, tasks that were running go back to pending and resume;
 *  - in-flight runs keep the flow version they started with (the doc is stored on the run).
 *
 * Branches: every connection carries either a live token or a skip token. Merge
 * steps fire once every incoming connection has delivered one, so a branch that
 * was not taken does not block the merge (dead-path elimination).
 *
 * Storage is asynchronous (asyncdb.ts): on PostgreSQL many steps have their database work in flight
 * at once. Every transition is one explicit transaction keyed by its run, and every change to a
 * claimed step is fenced: it applies only while the step is still running here under the claim that
 * started it (the claim number counts up each time a step is claimed). A step recovered by another
 * engine, handed back in a drain, or cancelled meanwhile is therefore never completed twice.
 */

export interface RunState {
  outputs: Record<string, any>;
  vars: Record<string, any>;
  live: Record<string, true>;
  skips: Record<string, string[]>;
  skipped: Record<string, true>;
  joins: Record<string, Record<string, { live: boolean; from: string; out: any }>>;
  logs: { t: string; level: string; msg: string; step?: string }[];
  failed?: boolean;
  last?: any;
  reply?: ReplyPayload;
  /** Set by a Return activity: what a calling process receives. */
  result?: any;
  /** Nesting level when started by Call process (0 for top-level runs). */
  depth?: number;
  /** The error handler (Catch) has taken over this run. */
  caught?: boolean;
  /** Trace context from the caller's traceparent header (OpenTelemetry). */
  trace?: { traceId: string; parentSpanId: string };
}

const MAX_CALL_DEPTH = 10;
const MAX_LOOP = 10000;

interface TaskRow {
  id: number;
  run_id: string;
  node_id: string;
  input: string | null;
  status: string;
  attempt: number;
  phase: string | null;
  wait: string | null;
  released: number;
  /** The claim number this engine holds the step under (fencing). */
  claim: number;
}

export interface DebugState { stepping: boolean; breakpoints: string[] }

interface ReplyHandle {
  resolve(r: ReplyPayload & { runId: string; failed?: boolean; error?: string }): void;
  done: boolean;
}

export interface StartOptions {
  doc: FlowDoc;
  flowId?: string;
  version?: number;
  triggerNodeId?: string;
  input?: any;
  source?: string;
  projectId?: string | null;
  onReply?: ReplyHandle['resolve'];
  /** Called once when the run ends (done, failed or cancelled), e.g. to acknowledge a queue message. */
  onFinish?: (status: string, runId: string) => void;
  /** Step-by-step debugging: pause before steps (stepping) or at breakpoints. */
  debug?: DebugState;
  /** Preset run id (Call process records it before the run starts). */
  id?: string;
  depth?: number;
  /** W3C traceparent of the caller, to continue its trace. */
  traceparent?: string;
}

/** A transition found its step no longer held here (recovered, handed back, cancelled): it changes nothing. */
class StaleStep extends Error { constructor() { super('The step is no longer held by this engine'); } }

/** What one transition did: steps it queued (so it knows the run goes on). */
interface Turn { queued: number }

const MAX_LOGS = 500;
const DEFAULT_TIMEOUT_MS = 120000;
const OPEN = `('running', 'waiting', 'paused', 'queued')`;

/**
 * A run as the engine uses it. Step outputs live in run_outputs, one row per step name, so a step
 * writes only its own output instead of the run state with every earlier output (runs started by a
 * version before 1.8.0 keep theirs in state.outputs, read first). outs: the rows once read; fresh:
 * the output of the step being completed, which conditions on its connections can already read.
 */
type Loaded = { row: any; doc: FlowDoc; state: RunState; outs?: Record<string, any>; fresh?: Record<string, any> };
/**
 * A run's state with every step output in state.outputs (run_outputs over what a run of an older
 * version kept in its state): for the API, the run views and tests. Undefined for an unknown run.
 */
export function runState(runId: string): RunState | undefined {
  const r = q.get<{ state: string }>('select state from runs where id = ?', runId);
  if (!r) return undefined;
  const st = JSON.parse(r.state) as RunState;
  st.outputs = { ...(st.outputs || {}), ...outputsFrom(q.all<{ name: string; out: string | null }>('select name, out from run_outputs where run_id = ?', runId)) };
  return st;
}
/** Keeps a step's output: one row per step name (a loop's later pass replaces it). */
const OUT_SQL = 'insert into run_outputs(run_id, name, out) values(?, ?, ?) on conflict(run_id, name) do update set out = excluded.out';
/** run_outputs rows (or PostgreSQL's json_object_agg of them) as outputs by step name. */
export function outputsFrom(rows: { name: string; out: string | null }[] | Record<string, string | null> | null | undefined): Record<string, any> {
  const pairs = Array.isArray(rows) ? rows.map(r => [r.name, r.out] as const) : Object.entries(rows || {});
  return Object.fromEntries(pairs.map(([k, v]) => [k, v == null ? undefined : JSON.parse(v)]));
}

export class Engine {
  private activities = new Map<string, Activity>();
  private active = 0;
  private timer: NodeJS.Timeout | null = null;
  private docs = new Map<string, FlowDoc>();
  private replies = new Map<string, ReplyHandle>();
  private finishers = new Map<string, (status: string, runId: string) => void>();
  private controllers = new Map<number, AbortController>();
  private pumping = false;
  private pumpAgain = false;
  private checking = false;
  /** Shutting down: no new tasks are claimed. */
  private draining = false;
  /** Tasks handed back to the queue during a drain: their late results are ignored. */
  private handedOver = new Set<number>();
  /** This engine's name, written as the owner of the tasks it runs. */
  readonly id = config.engineId;
  /** Listeners notified when a run changes (for live status in the studio). */
  readonly listeners = new Set<(runId: string) => void>();
  concurrency = config.workerConcurrency;
  private readonly own?: AsyncStore;

  /**
   * The engine of this server keeps runs in the database (durable). Sutras tuned to run in memory go
   * to a second engine inside it (parent set) whose runs and steps live in an in-memory database and
   * are written to the database in one transaction when the run ends: far fewer writes per step, but a
   * run that is open when the server stops is lost, and such runs cannot wait.
   */
  constructor(store?: AsyncStore, private readonly parent?: Engine) {
    this.own = store;
    if (parent) { this.activities = parent.activities; this.listeners = parent.listeners; }
  }
  /** The store: the in-memory one, or the database's (opened after this engine is made). */
  private get a(): AsyncStore { return this.own ?? asyncDatabase(); }
  private memoryEngine?: Engine;
  /** PostgreSQL: engines pass over a task another engine is claiming instead of waiting for it. */
  private get skipLocked() { return !this.parent && dbKind() === 'postgres' ? ' for update skip locked' : ''; }
  /** The in-memory engine, made and started on first use. */
  get memory() {
    if (!this.memoryEngine) { this.memoryEngine = new Engine(localStore(memoryStore().backend!), this); if (this.timer) void this.memoryEngine.start(); }
    return this.memoryEngine;
  }
  /** Runs open in memory now. */
  get memoryRuns(): number {
    const m = this.parent ? this : this.memoryEngine;
    return m ? Number(m.a.sync!.get(`select count(*) n from runs where status in ${OPEN}`, [])?.n || 0) : 0;
  }
  /** Whether a run of this Sutra runs in memory: deployed runs of Sutras tuned so (never tests or debugging). */
  private inMemory(o: { flowId?: string; source?: string; debug?: unknown }) {
    return !!o.flowId && o.source !== 'test' && o.source !== 'debug' && !o.debug && sutraTuning(o.flowId).execution === 'in memory';
  }
  /** A run open in memory: its row (status, steps, timing), or undefined. */
  memoryRun(runId: string): any {
    return this.memoryEngine?.a.sync!.get('select id, flow_id, project_id, flow_name, version, status, source, trigger_node, error, steps, started_at, finished_at from runs where id = ?', [runId]);
  }
  /** The in-memory engine when it holds this run. */
  private memoryHolding(runId: string) {
    return !this.parent && this.memoryEngine?.a.sync!.get('select 1 from runs where id = ?', [runId]) ? this.memoryEngine : undefined;
  }

  register(list: Activity[]) {
    for (const a of list) this.activities.set(a.type, a);
  }
  activity(type: string) {
    return this.activities.get(type);
  }
  allActivities() {
    return [...this.activities.values()];
  }
  portsOf(n: FlowNode): string[] {
    const a = this.activities.get(n.type);
    if (!a) return [];
    const ps = typeof a.ports === 'function' ? a.ports(n.config || {}) : a.ports;
    return a.noErrorPort || a.trigger ? ps : [...ps, 'error'];
  }

  async start() {
    this.draining = false;
    // Steps this engine (same name) or an unnamed one was running when it stopped go back to the queue.
    // Steps of other engines are recovered by the cluster leader when their heartbeat stops.
    await this.a.run(`update tasks set status = 'pending', owner = null where status = 'running' and (owner = ? or owner is null)`, this.id);
    this.startTimer();
    if (this.memoryEngine) await this.memoryEngine.start();
    this.pump();
  }
  private startTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => { this.pump(); void this.checkRemoteWaiters(); }, config.pollMs);
    this.timer.unref?.();
  }
  /** Applies a changed queue check interval (tuning). */
  setPollMs(ms: number) {
    config.pollMs = ms;
    if (this.timer) this.startTimer();
    this.memoryEngine?.setPollMs(ms);
  }

  /** Steps running on this engine now. */
  get running() { return this.active + (this.memoryEngine?.active || 0); }

  /**
   * Graceful shutdown: claim nothing new, let running steps finish for up to ms, then hand the rest
   * back to the queue (pending, no owner) so another engine, or this one after a restart, resumes them.
   */
  async drain(ms: number) {
    this.draining = true;
    const end = Date.now() + Math.max(0, ms);
    // Runs in memory are not handed over (they would be lost): they get the drain time to finish.
    if (this.memoryEngine) await this.memoryEngine.drainMemory(end);
    while (this.active > 0 && Date.now() < end) await new Promise(r => setTimeout(r, 50));
    const left = await this.a.all<{ id: number }>(`select id from tasks where status = 'running' and owner = ?`, this.id);
    for (const t of left) {
      this.handedOver.add(Number(t.id));
      await this.a.run(`update tasks set status = 'pending', owner = null where id = ? and status = 'running' and owner = ?`, t.id, this.id);
      this.controllers.get(Number(t.id))?.abort();
    }
    return { finished: left.length === 0, handedOver: left.length };
  }
  /** Lets open in-memory runs finish until the deadline, then claims nothing more. */
  private async drainMemory(end: number) {
    while (this.memoryRuns > 0 && Date.now() < end) await new Promise(r => setTimeout(r, 50));
    this.draining = true;
  }
  stop() {
    this.memoryEngine?.stop();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const c of this.controllers.values()) c.abort();
  }

  // ---------- starting runs ----------

  async startRun(o: StartOptions): Promise<string> {
    // Runs of Sutras tuned to run in memory go to the in-memory engine, and the other way round.
    if (!this.parent && this.inMemory(o)) return this.memory.startRun(o);
    if (this.parent && !this.inMemory(o)) return this.parent.startRun(o);
    const trig = o.triggerNodeId
      ? o.doc.nodes.find(n => n.id === o.triggerNodeId)
      : o.doc.nodes.find(n => this.activities.get(n.type)?.trigger);
    if (!trig) throw new Error('The Sutra has no trigger step');
    if (!this.activities.get(trig.type)?.trigger) throw new Error(`${trig.name} is not a trigger`);
    const id = o.id || crypto.randomUUID();
    const trace = parseTraceparent(o.traceparent);
    const state: RunState = { outputs: {}, vars: initialVars(o.doc), live: { [trig.id]: true }, skips: {}, skipped: {}, joins: {}, logs: [], depth: o.depth || 0, ...(trace ? { trace } : {}) };
    // Tuning of the deployed Sutra (test and debug runs of drafts are not tuned).
    const tuning = o.flowId && o.source !== 'test' && o.source !== 'debug' ? sutraTuning(o.flowId) : {};
    const maxRuns = Number(tuning.maxRuns) || 0;
    // The reply and finish handlers are in place before any step can run.
    this.docs.set(id, o.doc);
    if (o.onReply) this.replies.set(id, { resolve: o.onReply, done: false });
    if (o.onFinish) this.finishers.set(id, o.onFinish);
    try {
      await this.a.transaction(maxRuns > 0 && o.flowId ? `flow:${o.flowId}` : `run:${id}`, async tx => {
        // Over its "Runs at once" limit, the run waits in a queue and starts when another one ends.
        // Runs started by Call Sutra always start (they count): their caller already holds a place and
        // waits for them, so queuing them could wait forever.
        const queued = maxRuns > 0 && o.source !== 'sutra' && o.source !== 'process'
          && Number((await tx.get<any>(`select count(*) n from runs where flow_id = ? and status in ('running', 'waiting', 'paused') and source not in ('test', 'debug')`, o.flowId))?.n || 0) >= maxRuns;
        await tx.run(
          `insert into runs(id, flow_id, project_id, flow_name, version, doc, status, source, trigger_node, input, state, debug, started_at, priority)
           values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          id, o.flowId ?? null, o.projectId ?? null, o.doc.name, o.version ?? 0, JSON.stringify(o.doc), queued ? 'queued' : 'running', o.source || 'manual', trig.id,
          o.input === undefined ? null : JSON.stringify(o.input), JSON.stringify(state), o.debug ? JSON.stringify(o.debug) : null, now(), Number(tuning.priority) || 0,
        );
        await this.insertTask(tx, null, id, trig.id, o.input === undefined ? null : o.input, 0, queued ? 'queued' : 'pending', Number(tuning.priority) || 0);
      });
    } catch (e) {
      this.docs.delete(id); this.replies.delete(id); this.finishers.delete(id);
      throw e;
    }
    metrics.runsStarted.inc({ sutra: o.doc.name, source: o.source || 'manual' });
    projectLog(o.projectId, { level: 'info', msg: `Run started (${o.source || 'manual'}${o.version ? `, v${o.version}` : ', draft'})`, flow: o.doc.name, run: id, origin: runOrigin(o.source, o.version) });
    this.notify(id);
    this.pump();
    return id;
  }

  /** Queues a step. priority: the run's, when the caller knows it (saves a lookup). */
  private async insertTask(tx: TxQ, turn: Turn | null, runId: string, nodeId: string, input: any, notBefore = 0, status = 'pending', priority?: number) {
    if (turn) turn.queued++;
    await tx.run(`insert into tasks(run_id, node_id, input, status, not_before, priority, queued_at) values(?, ?, ?, ?, ?, ${priority === undefined ? 'coalesce((select priority from runs where id = ?), 0)' : '?'}, ?)`,
      runId, nodeId, input === undefined ? null : JSON.stringify(input), status, notBefore, priority === undefined ? runId : priority, Date.now());
  }

  // ---------- worker loop ----------

  /** Claims due steps while slots are free. Calls while it runs are not lost: it goes round again. */
  pump() {
    if (this.pumping) { this.pumpAgain = true; return; }
    this.pumping = true;
    void (async () => {
      try {
        do {
          this.pumpAgain = false;
          const limit = this.parent ? (config.memoryWorkers || this.parent.concurrency) : this.concurrency;
          let contended = 0;
          while (!this.draining && this.active < limit) {
            // As many steps as there are free slots, in one statement: with a database far away, one
            // round trip per claim would hold the engine back.
            const got = await this.claim(Math.min(16, limit - this.active));
            if (!got.length) {
              // Another engine won the race for the next step: try the next, a few times.
              if (contended++ < 5 && await this.a.get(`select 1 from tasks where status = 'pending' and not_before <= ? limit 1`, Date.now())) continue;
              break;
            }
            for (const t of got) {
              this.active++;
              this.execute(t)
                .catch(e => console.error(`Step ${t.id} of run ${t.run_id}: ${e?.message || e}`))
                .finally(() => { this.active--; this.pump(); });
            }
          }
        } while (this.pumpAgain && !this.draining);
      } catch (e: any) {
        console.error('Claiming steps failed:', e?.message || e);
      } finally {
        this.pumping = false;
      }
    })();
  }

  /**
   * Claims up to n due steps in one statement: with several engines on one database, only one of them
   * changes a step from pending to running; it records itself as the owner and counts the claim up.
   */
  private async claim(n: number): Promise<(TaskRow & { run_row?: any; run_outs?: any })[]> {
    const limit = Math.max(1, Math.floor(n));
    const update = `update tasks set status = 'running', started_at = ?, owner = ?, claim = claim + 1
       where id in (select id from tasks where status = 'pending' and not_before <= ? order by priority desc, id limit ?${this.skipLocked}) and status = 'pending'
       returning *`;
    // PostgreSQL: each step's run comes back with it (one round trip instead of two).
    const rows = this.a.backend === 'postgres' && !this.parent
      ? await this.a.all<TaskRow & { run_row?: any; run_outs?: any }>(`with t as (${update}) select t.*, row_to_json(r) as run_row,
          (select json_object_agg(o.name, o.out) from run_outputs o where o.run_id = t.run_id) as run_outs
          from t left join runs r on r.id = t.run_id order by t.priority desc, t.id`, now(), this.id, Date.now(), limit)
      : (await this.a.all<TaskRow>(update, now(), this.id, Date.now(), limit)).sort((a, b) => Number(a.id) - Number(b.id));
    for (const t of rows) { t.id = Number(t.id); t.claim = Number(t.claim); t.attempt = Number(t.attempt); }
    return rows;
  }

  /** A run row as the engine uses it (the document cached per run). */
  private loaded(r: any, outs?: any): Loaded | undefined {
    if (!r) return undefined;
    let doc = this.docs.get(r.id);
    if (!doc) { doc = (typeof r.doc === 'string' ? JSON.parse(r.doc) : r.doc) as FlowDoc; this.docs.set(r.id, doc); }
    const state = (typeof r.state === 'string' ? JSON.parse(r.state) : r.state) as RunState;
    state.outputs ||= {};
    return { row: r, doc, state, ...(outs !== undefined ? { outs: outputsFrom(outs) } : {}) };
  }
  private static RUN = 'select * from runs where id = ?';

  /** The outputs of a run's steps, read once per transition (and only when something needs them). */
  private async outputsOf(db: TxQ, run: Loaded): Promise<Record<string, any>> {
    run.outs ||= outputsFrom(await db.all<{ name: string; out: string | null }>('select name, out from run_outputs where run_id = ?', run.row.id));
    return { ...run.state.outputs, ...run.outs, ...run.fresh };
  }

  /**
   * Commits a transition with a run statement last, and a step's output with it: on PostgreSQL in the
   * same statement (a data-changing with), elsewhere just before it.
   */
  private async commitRun<T = any>(tx: TxBody, runId: string, sql: string, args: any[], out?: [string, any]): Promise<T | undefined> {
    if (!out) return tx.commitWith<T>(sql, ...args);
    const o = [runId, out[0], out[1] === undefined ? null : JSON.stringify(out[1])];
    if (this.a.backend === 'postgres') return tx.commitWith<T>(`with o as (${OUT_SQL}) ${sql}`, ...o, ...args);
    await tx.run(OUT_SQL, ...o);
    return tx.commitWith<T>(sql, ...args);
  }

  /** The condition under which this engine may change a step: still running here under its claim, or still waiting. */
  private fence(t: TaskRow): [string, any[]] {
    return t.status === 'waiting'
      ? [`id = ? and status = 'waiting'`, [t.id]]
      : [`id = ? and status = 'running' and owner = ? and claim = ?`, [t.id, this.id, t.claim]];
  }
  /** Changes a step under the fence; a step no longer held here ends the transition (StaleStep). */
  private async fenced(tx: TxQ, t: TaskRow, set: string, ...args: any[]) {
    const [where, w] = this.fence(t);
    const r = await tx.run(`update tasks set ${set} where ${where}`, ...args, ...w);
    if (r.changes !== 1) throw new StaleStep();
  }

  private async loadRun(db: TxQ, runId: string): Promise<Loaded | undefined> {
    return this.loaded(await db.get<any>(Engine.RUN, runId));
  }

  private async execute(t: TaskRow & { run_row?: any; run_outs?: any }) {
    const run = 'run_row' in t ? this.loaded(t.run_row, t.run_outs ?? null) : await this.loadRun(this.a, t.run_id);
    if (!run || !['running', 'waiting', 'paused'].includes(run.row.status)) {
      const [where, w] = this.fence(t);
      await this.a.run(`update tasks set status = 'cancelled', finished_at = ? where ${where}`, now(), ...w);
      return;
    }
    // Debugging: pause before the step (the run row was read anyway, so no query of its own).
    if (!t.released && run.row.debug) {
      const d = JSON.parse(run.row.debug) as DebugState;
      if (d.stepping || d.breakpoints.includes(t.node_id)) {
        const [where, w] = this.fence(t);
        await this.a.run(`update tasks set status = 'paused', owner = null where ${where}`, ...w);
        await this.settle(t.run_id);
        return;
      }
    }
    const node = run.doc.nodes.find(n => n.id === t.node_id);
    const act = node && this.activities.get(node.type);
    const input = t.input == null ? null : JSON.parse(t.input);
    if (!node || !act) {
      await this.fail(t, run.doc, node, new Error(`Step ${t.node_id} has an unknown type`));
      return;
    }
    const started = Date.now();
    const revealed = new Set<string>();
    const ac = new AbortController();
    this.controllers.set(t.id, ac);
    const s = node.settings || {};
    const timeoutMs = Number(s.timeoutMs) > 0 ? Number(s.timeoutMs) : act.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const trigName = run.doc.nodes.find(n => n.id === run.row.trigger_node)?.name;
    const outputs = await this.outputsOf(this.a, run);
    const gv = effectiveVariables(run.row.project_id);
    gv.secrets.forEach(v => revealed.add(v));
    const runInfo = { id: t.run_id, name: run.doc.name, flow: run.doc.name, sutraId: run.row.flow_id, flowId: run.row.flow_id, version: run.row.version, project: run.row.project_id, startedAt: run.row.started_at, source: run.row.source, step: node.name, attempt: t.attempt };
    const scope: Record<string, any> = {
      input,
      nodes: outputs,
      vars: run.state.vars,
      gv: gv.values,
      ev: engineVariableValues(),
      trigger: trigName ? outputs[trigName] : undefined,
      run: runInfo,
      sutra: runInfo,
      process: runInfo,
      now: new Date().toISOString(),
      secret: new Proxy({}, {
        get: (_, name) => {
          if (typeof name !== 'string') return undefined;
          const v = getSecret(name);
          if (v === undefined) throw new Error(`Secret "${name}" does not exist`);
          revealed.add(v);
          return v;
        },
      }),
    };
    Object.defineProperty(scope, 'uuid', { get: () => crypto.randomUUID(), enumerable: false });
    const logs: RunState['logs'] = [];
    const varsSet: Record<string, any> = {};
    const clock = { restart: () => {} };
    let replied: ReplyPayload | undefined;
    let res: StepResult | void;
    try {
      const blocked = restrictedReason(run.row.project_id, node);
      if (blocked) throw new Error(blocked);
      if (s.disabled) {
        res = { port: this.portsOf(node)[0] || 'out', out: input };
      } else {
        const once = () => act.execute({
          node, runId: t.run_id, input, scope, phase: t.phase, attempt: t.attempt, signal: ac.signal,
          resumed: t.phase === 'resume' && t.wait ? (JSON.parse(t.wait).outcome ?? undefined) : undefined,
          // Settings may use project/engine variables; mappable inputs are returned as written.
          raw: k => resolveSetting(act.fields.find(f => f.k === k), node.config?.[k], scope),
          v: k => resolve(node.config?.[k], scope),
          resolve: x => resolve(x, scope),
          resolveDeep: x => resolveDeep(x, scope),
          log: (level, msg) => logs.push({ t: now(), level, msg, step: node.name }),
          secret: (name, what = 'Secret') => {
            if (!name) throw new Error(`${what} is not set`);
            const v = getSecret(name);
            if (v === undefined) throw new Error(`${what}: secret "${name}" does not exist. Add it under Resources > Secrets.`);
            revealed.add(v);
            return v;
          },
          reply: r => { replied = r; },
          // A step that sends outputs as it goes (a streamed file) is alive: its time limit starts again.
          emit: async (port, out) => { await this.emitNow(t, node, port, maskSecrets(out, revealed)); clock.restart(); },
          setVar: (k, v) => { varsSet[k] = v; },
          projectId: run.row.project_id,
          schemaTree: k => schemaTree(node.config?.[k]),
          mapping: k => {
            const f = act.fields.find(x => x.k === k);
            const m = node.config?.[k] as MappingValue | undefined;
            const tree = (f?.schemaField && schemaTree(node.config?.[f.schemaField])) || adhocTree(m);
            return evaluateMapping(tree, m, scope);
          },
        });
        const exec = s.loop === 'for each item' || s.loop === 'repeat while' ? this.loop(node, s, scope, once, ac.signal) : once();
        res = await withTimeout(Promise.resolve(exec), timeoutMs, ac, `${node.name} did not finish within ${timeoutMs} ms`, clock);
      }
    } catch (e: any) {
      this.controllers.delete(t.id);
      // Handed back during a drain: another engine runs it again.
      if (this.handedOver.delete(t.id)) return;
      // Stopped by another branch (End: stop process) or by a person: fail() finds the step cancelled
      // (its fence no longer holds) and changes nothing.
      const msg = maskSecrets(String(e?.message || e), revealed);
      projectLog(run.row.project_id, { level: t.attempt < (Number(s.retries) || 0) ? 'warn' : 'error', msg, flow: run.doc.name, run: t.run_id, step: node.name, origin: runOrigin(run.row.source, run.row.version) });
      // Activities may attach what they captured (a script's output and error output) for the error branch.
      const failure = Object.assign(new Error(msg), e?.details !== undefined ? { details: maskSecrets(e.details, revealed) } : {});
      await this.fail(t, run.doc, node, failure, { ms: Date.now() - started, logs });
      return;
    }
    this.controllers.delete(t.id);
    for (const l of logs) projectLog(run.row.project_id, { level: l.level as any, msg: maskSecrets(l.msg, revealed), flow: run.doc.name, run: t.run_id, step: node.name, origin: runOrigin(run.row.source, run.row.version) });
    if (wantsStepData(run.row.project_id)) projectLog(run.row.project_id, { level: 'debug', msg: 'Step finished', flow: run.doc.name, run: t.run_id, step: node.name, origin: runOrigin(run.row.source, run.row.version), data: maskSecrets({ input, output: (res as any)?.out ?? (res as any)?.store }, revealed) });
    if (this.handedOver.delete(t.id)) return;
    // A step cancelled meanwhile: complete() finds its fence gone and changes nothing.
    await this.complete(t, run.doc, node, res || {}, { ms: Date.now() - started, revealed, logs, varsSet, replied });
  }

  /**
   * Activity loops (Settings tab). "for each item" runs the activity once per list item, with
   * {iteration.value} / {item} and {iteration.index} / {index}, and outputs every result.
   * "repeat while" runs it, then again while the condition holds ({iteration.output} is the last result).
   */
  private async loop(node: FlowNode, s: NonNullable<FlowNode['settings']>, scope: Record<string, any>, once: () => any, signal: AbortSignal): Promise<StepResult> {
    const max = Math.max(1, Math.min(MAX_LOOP, Number(s.loopMax) || 1000));
    const delay = Math.max(0, Number(s.loopDelayMs) || 0);
    const pause = () => (delay ? new Promise<void>((r, j) => { const to = setTimeout(r, delay); signal.addEventListener('abort', () => { clearTimeout(to); j(new Error('Cancelled')); }, { once: true }); }) : Promise.resolve());
    const run1 = async (): Promise<StepResult> => {
      const r = (await once()) || {};
      if (r.wait || r.deferUntil || r.call) throw new Error(`${node.name}: this activity cannot run in a loop`);
      return r;
    };
    const valueOf = (r: StepResult) => ('store' in r ? r.store : r.emits?.length ? r.emits[r.emits.length - 1].out : r.out);
    if (s.loop === 'for each item') {
      let list = resolve(s.loopOver || '{{input}}', scope);
      if (list && typeof list === 'object' && !Array.isArray(list)) list = Object.entries(list).map(([key, value]) => ({ key, value }));
      if (!Array.isArray(list)) throw new Error(`${node.name}: "Loop over" is not a list`);
      if (list.length > max) throw new Error(`${node.name}: ${list.length} items is more than the loop maximum of ${max}`);
      const outs: any[] = [];
      for (let i = 0; i < list.length; i++) {
        if (signal.aborted) throw new Error('Cancelled');
        scope.iteration = { index: i, value: list[i], count: list.length };
        scope.item = list[i];
        scope.index = i;
        outs.push(valueOf(await run1()));
        if (i < list.length - 1) await pause();
      }
      return { out: { iterations: outs, count: outs.length } };
    }
    let last: StepResult = {};
    for (let i = 0; i < max; i++) {
      if (signal.aborted) throw new Error('Cancelled');
      scope.iteration = { index: i, output: i ? valueOf(last) : undefined };
      scope.index = i;
      last = await run1();
      scope.iteration = { index: i, output: valueOf(last) };
      if (!truthy(resolve(s.loopWhile || 'false', scope))) return { port: last.port || last.emits?.[0]?.port || 'out', out: { ...asObject(valueOf(last)), _iterations: i + 1 } };
      await pause();
    }
    throw new Error(`${node.name}: still repeating after ${max} times (loop maximum)`);
  }

  private async complete(
    t: TaskRow, doc: FlowDoc, node: FlowNode, res: StepResult,
    extra: { ms: number; revealed: Set<string>; logs: RunState['logs']; varsSet: Record<string, any>; replied?: ReplyPayload },
  ): Promise<void> {
    let replyToSend: ReplyPayload | undefined;
    let childId: string | undefined;
    let callError: string | undefined;
    let finished = true;
    let trace: RunState['trace'];
    let runStatus = '';
    let depth = 0;
    const turn: Turn = { queued: 0 };
    const call = res.call;
    if (this.parent && (res.wait || res.call?.wait)) {
      return this.fail(t, doc, node, new Error(`${node.name} waits (${res.call ? 'for a called Sutra' : 'for a decision, a message or a time'}). A Sutra that runs in memory cannot wait: set its Execution tuning to durable.`), { ms: extra.ms });
    }
    let over: RunState | undefined;
    try {
      await this.a.transaction(`run:${t.run_id}`, async (tx, row) => {
        const run = this.loaded(row);
        if (!run) throw new StaleStep();
        const st = run.state;
        trace = st.trace;
        depth = st.depth || 0;
        st.logs.push(...extra.logs.map(l => ({ ...l, msg: maskSecrets(l.msg, extra.revealed) })));
        if (st.logs.length > MAX_LOGS) st.logs.splice(0, st.logs.length - MAX_LOGS);
        Object.assign(st.vars, maskSecrets(extra.varsSet, extra.revealed));
        if (extra.replied && !st.reply) { st.reply = maskSecrets(extra.replied, new Set()); replyToSend = extra.replied; }

        if (res.wait) {
          finished = false;
          await this.fenced(tx, t, `status = 'waiting', wait = ?, ms = ?`, JSON.stringify(res.wait), extra.ms);
          await tx.commitWith('update runs set state = ? where id = ?', JSON.stringify(st), t.run_id);
          return;
        }
        if (res.deferUntil) {
          finished = false;
          await this.fenced(tx, t, `status = 'pending', phase = 'resume', not_before = ?`, res.deferUntil);
          await tx.commitWith('update runs set state = ? where id = ?', JSON.stringify(st), t.run_id);
          return;
        }
        if (res.call) {
          if ((st.depth || 0) >= MAX_CALL_DEPTH) { callError = `Sutras call each other more than ${MAX_CALL_DEPTH} levels deep. Check for a Sutra that calls itself.`; return; }
          childId = crypto.randomUUID();
          if (res.call.wait) {
            finished = false;
            await this.fenced(tx, t, `status = 'waiting', wait = ?, ms = ?`, JSON.stringify({ kind: 'process', child: childId, name: res.call.name, ...(res.call.resume ? { resume: true } : {}) }), extra.ms);
            st.logs.push({ t: now(), level: 'info', msg: `${node.name}: calling ${res.call.name}`, step: node.name });
            await tx.commitWith('update runs set state = ? where id = ?', JSON.stringify(st), t.run_id);
            return;
          }
          res = { out: { runId: childId, process: res.call.name, started: true } };
        }
        if ('result' in res) st.result = maskSecrets(res.result, extra.revealed);
        const emits = res.emits || [{ port: res.port || 'out', out: res.out }];
        const stored = maskSecrets('store' in res ? res.store : emits.length ? emits[emits.length - 1].out : undefined, extra.revealed);
        run.fresh = { [node.name]: stored };
        st.last = stored;
        // Step data "none": the step's input and output are not kept, also not until the run ends (a
        // streamed file of many batches would otherwise fill the disk first).
        const keep = sutraTuning(run.row.flow_id).stepData !== 'none' || run.row.source === 'test' || run.row.source === 'debug';
        await this.fenced(tx, t, `status = 'done', port = ?, output = ?, ms = ?, finished_at = ?${keep ? '' : ', input = null'}`,
          emits.map(e => e.port).filter((p, i, a) => a.indexOf(p) === i).join(','), keep ? cap(stored) : null, extra.ms, now());
        if (res.stop) {
          await this.cancelOpen(tx, t.run_id);
          if (res.stop.status === 'failed') {
            st.failed = true;
            await tx.run(`update runs set error = ? where id = ?`, `${node.name}: ${res.stop.message || 'Sutra stopped with an error'}`, t.run_id);
          }
          st.logs.push({ t: now(), level: res.stop.status === 'failed' ? 'error' : 'info', msg: `${node.name}: Sutra stopped (${res.stop.status === 'failed' ? 'error' : 'success'})${res.stop.message ? `: ${res.stop.message}` : ''}`, step: node.name });
        } else await this.route(tx, turn, run, st, node, emits.map(e => ({ port: e.port, out: maskSecrets(e.out, extra.revealed) })));
        // State, step count and the count back in one statement, sent with the commit.
        const steps = Number((await this.commitRun<{ steps: number }>(tx, t.run_id, 'update runs set state = ?, steps = steps + 1 where id = ? returning steps', [JSON.stringify(st), t.run_id], [node.name, stored]))!.steps);
        runStatus = run.row.status;
        if (steps > config.maxStepsPerRun) over = st;
      }, { sql: Engine.RUN, args: [t.run_id] });
    } catch (e) {
      if (e instanceof StaleStep) { this.notify(t.run_id); return; }
      throw e;
    }
    if (over) {
      // A run past its step limit stops: a transaction of its own after the step's.
      const st = over;
      st.failed = true;
      await this.a.transaction(`run:${t.run_id}`, async tx => {
        await this.cancelOpen(tx, t.run_id);
        await tx.run(`update runs set error = ? where id = ?`, `Stopped after ${config.maxStepsPerRun} steps. Check for a loop.`, t.run_id);
        await tx.commitWith('update runs set state = ? where id = ?', JSON.stringify(st), t.run_id);
      });
      runStatus = '';
    }
    if (replyToSend) this.sendReply(t.run_id, replyToSend);
    if (callError) return this.fail(t, doc, node, new Error(callError), { ms: extra.ms });
    if (finished) this.observeStep(t, node, extra.ms, 'done', trace);
    if (call && childId) {
      try {
        await this.startRun({ doc: call.doc, flowId: call.flowId, version: call.version, projectId: call.projectId, input: call.input, source: 'sutra', id: childId, depth: depth + 1, triggerNodeId: call.triggerNodeId });
      } catch (e: any) {
        if (call.wait) return this.fail({ ...t, status: 'waiting' }, doc, node, new Error(`${call.name}: ${e.message}`), { ms: extra.ms });
        throw e;
      }
    }
    // The step queued a next step of a running run: the run goes on, nothing to recount. A branch that
    // ends (or waits, stops, or calls) settles the run as before.
    if (finished && !res.stop && !call && runStatus === 'running' && turn.queued > 0) { this.notify(t.run_id); this.pump(); return; }
    await this.settle(t.run_id);
    this.pump();
  }

  /** A called process ended: resume the step that is waiting for it. */
  private async resumeCaller(childRunId: string, status: string) {
    const t = await this.a.get<TaskRow>(`select * from tasks where status = 'waiting' and wait like ?`, `%"child":"${childRunId}"%`);
    if (!t) return;
    t.id = Number(t.id); t.claim = Number(t.claim); t.attempt = Number(t.attempt);
    const run = await this.loadRun(this.a, t.run_id);
    const node = run?.doc.nodes.find(n => n.id === t.node_id);
    const child = await this.loadRun(this.a, childRunId);
    if (!run || !node || !child) return;
    const wait = JSON.parse(t.wait || '{}');
    const name = (wait.name as string) || 'Called Sutra';
    if (wait.resume) {
      // The step asked to continue itself (an AI agent after a tool): run it again with the outcome.
      const err = status === 'done' ? undefined : child.row.error || status;
      const outcome = { status, name, ...(status === 'done' ? { result: child.state.result !== undefined ? child.state.result : child.state.last ?? null } : { error: err }) };
      await this.a.run(`update tasks set status = 'pending', phase = 'resume', not_before = 0, wait = ? where id = ? and status = 'waiting'`, JSON.stringify({ ...wait, outcome }), t.id);
      this.pump();
      return;
    }
    if (status === 'done') {
      const result = child.state.result !== undefined ? child.state.result : child.state.last;
      await this.complete(t, run.doc, node, { out: result ?? null }, { ms: 0, revealed: new Set(), logs: [{ t: now(), level: 'info', msg: `${node.name}: ${name} finished`, step: node.name }], varsSet: {} });
    } else {
      await this.fail(t, run.doc, node, new Error(`${name} ${status === 'cancelled' ? 'was cancelled' : `failed: ${child.row.error || 'unknown error'}`}`));
    }
    this.pump();
  }

  /** A step sends one output while it goes on (see StepContext.emit). */
  private async emitNow(t: TaskRow, node: FlowNode, port: string, out: any) {
    try {
      await this.a.transaction(`run:${t.run_id}`, async tx => {
        const [where, w] = this.fence(t);
        if (!(await tx.get(`select 1 as x from tasks where ${where}`, ...w))) throw new StaleStep();
        const run = await this.loadRun(tx, t.run_id);
        if (!run) throw new StaleStep();
        // The run state keeps a summary (a batch number, a count, the file), not the rows: the rows go
        // with the next steps' input, and the state stays small however many batches there are.
        const summary = out && typeof out === 'object' && !Array.isArray(out)
          ? Object.fromEntries(Object.entries(out).filter(([, v]) => !Array.isArray(v))) : out;
        run.fresh = { [node.name]: summary };
        await this.route(tx, null, run, run.state, node, [{ port, out }], true);
        await tx.run(OUT_SQL, t.run_id, node.name, summary === undefined ? null : JSON.stringify(summary));
        await this.saveState(tx, t.run_id, run.state);
      });
    } catch (e) {
      if (e instanceof StaleStep) throw new Error('Step was cancelled');
      throw e;
    }
    this.notify(t.run_id);
    this.pump();
    // Back pressure: a fast reader waits while more of this run's steps wait than the engine runs at once.
    const limit = Math.max(4, this.concurrency * 2);
    while (Number((await this.a.get<any>(`select count(*) n from tasks where run_id = ? and status = 'pending'`, t.run_id))?.n || 0) > limit) {
      if (await this.wasCancelled(t.id)) throw new Error('Step was cancelled');
      await new Promise(r => setTimeout(r, 20));
    }
  }

  /**
   * Delivers live tokens on emitted ports and skip tokens on the rest. A connection may have a
   * condition on the output ({input.x}): "when" connections are taken when it is true, and
   * "otherwise" connections when no "when" connection of the same output was taken.
   * partial: other ports are not passed over (the step goes on).
   */
  private async route(tx: TxQ, turn: Turn | null, run: Loaded, st: RunState, node: FlowNode, emits: { port: string; out: any }[], partial = false) {
    const doc = run.doc;
    const runId = run.row.id as string;
    const outgoing = doc.edges.filter(e => e.from === node.id);
    const emitted = new Set(emits.map(e => e.port));
    for (const em of emits) {
      const onPort = outgoing.filter(x => x.port === em.port);
      const conditional = onPort.filter(x => x.when === 'when');
      const taken = new Set<string>();
      if (conditional.length) {
        const scope = this.conditionScope(run, await this.outputsOf(tx, run), st, em.out);
        for (const e of conditional) {
          let ok = false;
          try { ok = truthy(resolve(e.condition || 'false', scope)); } catch (err: any) {
            st.logs.push({ t: now(), level: 'warn', msg: `${node.name}: condition on connection ${e.label ? `"${e.label}"` : ''} could not be checked (${err.message}); not taken`, step: node.name });
          }
          if (ok) taken.add(e.id);
        }
      }
      for (const e of onPort) {
        const live = e.when === 'when' ? taken.has(e.id) : e.when === 'otherwise' ? taken.size === 0 : true;
        await this.deliver(tx, turn, runId, doc, st, e, live, live ? em.out : undefined, run.row.priority);
      }
    }
    if (!partial) for (const e of outgoing.filter(x => !emitted.has(x.port))) await this.deliver(tx, turn, runId, doc, st, e, false, undefined, run.row.priority);
  }

  /** What a connection condition can read: the output as {input}, earlier activities, variables. */
  private conditionScope(run: Loaded, outputs: Record<string, any>, st: RunState, out: any) {
    const trig = run.doc.nodes.find(n => n.id === run.row.trigger_node)?.name;
    return { input: out, output: out, nodes: outputs, vars: st.vars, gv: effectiveVariables(run.row.project_id ?? null).values, ev: engineVariableValues(), trigger: trig ? outputs[trig] : undefined, now: new Date().toISOString() };
  }

  private async deliver(tx: TxQ, turn: Turn | null, runId: string, doc: FlowDoc, st: RunState, edge: FlowEdge, live: boolean, out: any, priority?: number) {
    const target = doc.nodes.find(n => n.id === edge.to);
    if (!target) return;
    const act = this.activities.get(target.type);
    const inbound = doc.edges.filter(e => e.to === target.id);
    const from = doc.nodes.find(n => n.id === edge.from)?.name || edge.from;
    const prio = priority === undefined || priority === null ? undefined : Number(priority);
    if (act?.join) {
      const j = (st.joins[target.id] ||= {});
      j[edge.id] = { live, from, out };
      if (inbound.every(e => j[e.id])) {
        const lives = Object.values(j).filter(x => x.live);
        delete st.joins[target.id];
        if (lives.length) {
          st.live[target.id] = true;
          await this.insertTask(tx, turn, runId, target.id, Object.fromEntries(lives.map(x => [x.from, x.out])), 0, 'pending', prio);
        } else await this.skipNode(tx, turn, runId, doc, st, target, prio);
      }
      return;
    }
    if (live) {
      st.live[target.id] = true;
      await this.insertTask(tx, turn, runId, target.id, out, 0, 'pending', prio);
      return;
    }
    const s = (st.skips[target.id] ||= []);
    if (!s.includes(edge.id)) s.push(edge.id);
    if (!st.live[target.id] && inbound.every(e => s.includes(e.id))) await this.skipNode(tx, turn, runId, doc, st, target, prio);
  }

  private async skipNode(tx: TxQ, turn: Turn | null, runId: string, doc: FlowDoc, st: RunState, node: FlowNode, priority?: number) {
    if (st.skipped[node.id]) return;
    st.skipped[node.id] = true;
    for (const e of doc.edges.filter(x => x.from === node.id)) await this.deliver(tx, turn, runId, doc, st, e, false, undefined, priority);
  }

  private async fail(t: TaskRow, doc: FlowDoc, node: FlowNode | undefined, err: Error, extra: { ms?: number; logs?: RunState['logs'] } = {}): Promise<void> {
    const s = node?.settings || {};
    // A step's own retry settings win; otherwise the Sutra's tuning, if any.
    const unset = (v: unknown) => v === undefined || v === null || v === '';
    const tuned = unset(s.retries) || unset(s.retryDelayMs) ? sutraTuning((await this.a.get<any>('select flow_id from runs where id = ?', t.run_id))?.flow_id) : {};
    const retries = Math.max(0, Math.min(20, Number(unset(s.retries) ? tuned.retries : s.retries) || 0));
    try {
      if (node && t.attempt < retries) {
        const delay = Math.max(0, Number(unset(s.retryDelayMs) ? (tuned.retryDelayMs ?? 1000) : s.retryDelayMs)) * 2 ** t.attempt;
        metrics.retries.inc({ activity: node.type });
        await this.a.transaction(`run:${t.run_id}`, async tx => {
          await this.fenced(tx, t, `status = 'pending', attempt = attempt + 1, not_before = ?, error = ?`, Date.now() + delay, err.message);
          await this.appendLogs(tx, t.run_id, [...(extra.logs || []), { t: now(), level: 'warn', msg: `${node.name}: ${err.message}. Retry ${t.attempt + 1} of ${retries} in ${delay} ms.`, step: node.name }]);
        });
        this.notify(t.run_id);
        return;
      }
      await this.a.transaction(`run:${t.run_id}`, async (tx, row) => {
        const run = this.loaded(row);
        if (!run) throw new StaleStep();
        const st = run.state;
        st.logs.push(...(extra.logs || []), { t: now(), level: 'error', msg: `${node?.name ?? t.node_id}: ${err.message}`, step: node?.name });
        const errorEdges = node ? doc.edges.filter(e => e.from === node.id && e.port === 'error') : [];
        const input = t.input == null ? null : JSON.parse(t.input);
        const details = (err as any).details;
        const errOut = { error: { message: err.message, step: node?.name, type: node?.type, at: now(), ...(details !== undefined ? { details } : {}) }, input };
        if (node && errorEdges.length) {
          run.fresh = { [node.name]: errOut };
          await this.fenced(tx, t, `status = 'error', port = 'error', error = ?, output = ?, ms = ?, finished_at = ?`, err.message, cap(errOut), extra.ms ?? null, now());
          await this.route(tx, null, run, st, node, [{ port: 'error', out: errOut }]);
        } else {
          await this.fenced(tx, t, `status = 'failed', error = ?, ms = ?, finished_at = ?`, err.message, extra.ms ?? null, now());
          await this.cancelOpen(tx, t.run_id);
          const handler = !st.caught && doc.nodes.find(n => this.activities.get(n.type)?.noInput);
          if (handler) {
            // The error handler takes over: other branches stop, and its path decides how the run ends.
            st.caught = true;
            st.live[handler.id] = true;
            st.logs.push({ t: now(), level: 'warn', msg: `${handler.name}: handling the error from ${node?.name ?? t.node_id}`, step: handler.name });
            await this.insertTask(tx, null, t.run_id, handler.id, errOut, 0, 'pending', Number(run.row.priority) || 0);
          } else {
            st.failed = true;
            await tx.run(`update runs set error = ? where id = ?`, `${node?.name ?? t.node_id}: ${err.message}`, t.run_id);
          }
        }
        await this.commitRun(tx, t.run_id, 'update runs set state = ? where id = ?', [JSON.stringify(st), t.run_id], node && errorEdges.length ? [node.name, errOut] : undefined);
        if (node) this.observeStep(t, node, extra.ms ?? 0, errorEdges.length ? 'error' : 'failed', st.trace, err.message);
      }, { sql: Engine.RUN, args: [t.run_id] });
    } catch (e) {
      if (e instanceof StaleStep) { this.notify(t.run_id); return; }
      throw e;
    }
    await this.settle(t.run_id);
  }

  /** Cancels a run's open steps; steps of it running on this engine are stopped. */
  private async cancelOpen(tx: TxQ, runId: string) {
    await tx.run(`update tasks set status = 'cancelled', finished_at = ? where run_id = ? and status in ('pending', 'waiting', 'paused', 'queued')`, now(), runId);
    for (const r of await tx.all<{ id: number }>(`select id from tasks where run_id = ? and status = 'running'`, runId)) {
      await tx.run(`update tasks set status = 'cancelled', finished_at = ? where id = ?`, now(), r.id);
      this.controllers.get(Number(r.id))?.abort();
    }
  }

  // ---------- observability ----------

  private observeStep(t: TaskRow, node: FlowNode, ms: number, outcome: 'done' | 'error' | 'failed', trace?: RunState['trace'], error?: string) {
    metrics.steps.inc({ activity: node.type, outcome });
    metrics.stepSeconds.observe({ activity: node.type }, (ms || 0) / 1000);
    const end = Date.now();
    recordSpan({
      traceId: trace?.traceId || traceIdFor(t.run_id), spanId: stepSpanId(t.run_id, t.id, t.attempt), parentSpanId: runSpanId(t.run_id),
      name: node.name, kind: 1, startMs: end - (ms || 0), endMs: end, error: outcome === 'done' ? undefined : error,
      attributes: { 'sutra.activity': node.type, 'sutra.step': node.name, 'sutra.outcome': outcome, 'sutra.attempt': t.attempt, 'sutra.engine': this.id, 'sutra.run_id': t.run_id },
    });
  }

  private observeRun(runId: string, sutra: string, status: string, startedAt: string, source: string | null, trace?: RunState['trace'], error?: string) {
    metrics.runsFinished.inc({ sutra, status });
    const start = Date.parse(startedAt) || Date.now();
    metrics.runSeconds.observe({ sutra, status }, (Date.now() - start) / 1000);
    recordSpan({
      traceId: trace?.traceId || traceIdFor(runId), spanId: runSpanId(runId), parentSpanId: trace?.parentSpanId,
      name: `Sutra ${sutra}`, kind: source && ['rest', 'soap', 'mcp'].includes(source) ? 2 : 1, startMs: start, endMs: Date.now(), error: status === 'done' ? undefined : error || status,
      attributes: { 'sutra.name': sutra, 'sutra.run_id': runId, 'sutra.status': status, 'sutra.source': source || 'manual' },
    });
  }

  /** The traceparent to return to a caller: the run's trace and root span. */
  async traceparentOf(runId: string) {
    const r = await this.a.get<{ state: string }>('select state from runs where id = ?', runId);
    const st = r ? (JSON.parse(r.state) as RunState) : undefined;
    return tp(st?.trace?.traceId || traceIdFor(runId), runSpanId(runId));
  }

  /**
   * Runs a failed run again from the step that failed: the same input, attempt 0, with everything
   * the earlier steps produced kept. Only for runs that failed on a step (not ended by End: error).
   */
  async resubmit(runId: string, by = 'someone') {
    const run = await this.loadRun(this.a, runId);
    if (!run) throw new Error('Run not found');
    if (run.row.status !== 'failed') throw new Error(`Only failed runs can be run again (this one is ${run.row.status})`);
    let count = 0;
    await this.a.transaction(`run:${runId}`, async tx => {
      const failedTasks = await tx.all<TaskRow>(`select * from tasks where run_id = ? and status = 'failed' order by id`, runId);
      if (!failedTasks.length) throw new Error('This run did not fail on a step (it was stopped on purpose), so there is no step to run again');
      count = failedTasks.length;
      const st = run.state;
      st.failed = false;
      st.logs.push({ t: now(), level: 'info', msg: `Run again from ${failedTasks.map(x => run.doc.nodes.find(n => n.id === x.node_id)?.name || x.node_id).join(', ')} by ${by}` });
      for (const ft of failedTasks) {
        await tx.run(`update tasks set status = 'resubmitted' where id = ?`, ft.id);
        await tx.run(`insert into tasks(run_id, node_id, input, status, not_before) values(?, ?, ?, 'pending', 0)`, runId, ft.node_id, ft.input);
      }
      // Branches cancelled when the step failed run again too.
      for (const ct of await tx.all<TaskRow>(`select * from tasks where run_id = ? and status = 'cancelled'`, runId)) {
        await tx.run(`update tasks set status = 'resubmitted' where id = ?`, ct.id);
        await tx.run(`insert into tasks(run_id, node_id, input, status, not_before) values(?, ?, ?, 'pending', 0)`, runId, ct.node_id, ct.input);
      }
      await tx.run(`update runs set status = 'running', error = null, finished_at = null, state = ? where id = ?`, JSON.stringify(st), runId);
    });
    this.docs.set(runId, run.doc);
    this.notify(runId);
    this.pump();
    return { runId, resubmitted: count };
  }

  /** A run cancelled on another engine: stop the steps of it running here. */
  async abortCancelledHere() {
    if (!this.controllers.size) return;
    for (const r of await this.a.all<{ id: number }>(`select id from tasks where owner = ? and status = 'cancelled'`, this.id)) this.controllers.get(Number(r.id))?.abort();
  }

  private async wasCancelled(taskId: number) {
    const r = await this.a.get<{ status: string }>('select status from tasks where id = ?', taskId);
    // In memory, a step whose run already ended and was written to the database is gone.
    return r ? r.status === 'cancelled' : !!this.parent;
  }

  private async saveState(tx: TxQ, runId: string, st: RunState) {
    await tx.run('update runs set state = ? where id = ?', JSON.stringify(st), runId);
  }

  private async appendLogs(tx: TxQ, runId: string, logs: RunState['logs']) {
    const r = await tx.get<{ state: string }>('select state from runs where id = ?', runId);
    if (!r) return;
    const st = JSON.parse(r.state) as RunState;
    st.logs.push(...logs);
    await this.saveState(tx, runId, st);
  }

  /**
   * Works out the run status from its tasks. The change is conditional on the run still being open, so
   * of two engines settling the same run at once, one ends it (and answers its caller), never both.
   */
  private async settle(runId: string) {
    const out = await this.a.transaction(`run:${runId}`, async (tx, row) => {
      const run = this.loaded(row);
      if (!run || ['done', 'failed', 'cancelled'].includes(run.row.status)) return null;
      const counts = Object.fromEntries((await tx.all<{ status: string; n: number }>('select status, count(*) n from tasks where run_id = ? group by status', runId)).map(r => [r.status, Number(r.n)]));
      let status: string;
      if (counts.pending || counts.running) status = 'running';
      else if (counts.paused) status = 'paused';
      else if (counts.waiting) status = 'waiting';
      else status = run.state.failed ? 'failed' : 'done';
      if (status === run.row.status) return null;
      const finished = status === 'done' || status === 'failed';
      const r = await tx.commitWith<{ id: string }>(`update runs set status = ?, finished_at = ? where id = ? and status not in ('done', 'failed', 'cancelled') returning id`, status, finished ? now() : null, runId);
      return r ? { run, status, finished } : null;
    }, { sql: Engine.RUN, args: [runId] });
    if (out?.finished) {
      const { run, status } = out;
      this.docs.delete(runId);
      const err = run.row.error;
      this.resolveReply(runId, run.state, err);
      projectLog(run.row.project_id, { level: status === 'failed' ? 'error' : 'info', msg: status === 'failed' ? `Run failed: ${err}` : 'Run finished', flow: run.doc.name, run: runId, origin: runOrigin(run.row.source, run.row.version) });
      this.observeRun(runId, run.doc.name, status, run.row.started_at, run.row.source, run.state.trace, status === 'failed' ? err : undefined);
      this.finish(runId, status);
      await this.runEnded(runId, run.row.flow_id, run.row.source, status);
      if (run.row.source === 'sutra' || run.row.source === 'process') void this.resumeCaller(runId, status).catch(e => console.error(`Resuming the caller of ${runId}: ${e?.message || e}`));
    }
    this.notify(runId);
  }

  /** The answer for a caller waiting on this run: its reply step's reply, or its outcome when it ended without one. */
  private resolveReply(runId: string, st: RunState, err?: string | null) {
    const h = this.replies.get(runId);
    if (h && !h.done) {
      h.done = true;
      if (st.reply) h.resolve({ ...st.reply, runId });
      else h.resolve(st.failed
        ? { runId, failed: true, error: err || 'Sutra failed', status: 500, body: { error: err || 'Sutra failed' } }
        : { runId, status: 200, body: st.last ?? null });
    }
    this.replies.delete(runId);
  }

  /**
   * Callers wait on the engine that received them, but in a cluster another engine may run the reply
   * step or the last step. Every queue check this engine looks up the runs it is waiting on.
   */
  private async checkRemoteWaiters() {
    const ids = [...new Set([...this.replies.keys(), ...this.finishers.keys()])];
    if (!ids.length || this.checking) return;
    this.checking = true;
    try {
      for (const runId of ids) {
        const r = await this.a.get<{ status: string; state: string; error: string | null }>('select status, state, error from runs where id = ?', runId);
        if (!r) continue;
        const st = JSON.parse(r.state) as RunState;
        const h = this.replies.get(runId);
        if (h && !h.done && st.reply) { h.done = true; h.resolve({ ...st.reply, runId }); this.replies.delete(runId); }
        if (['done', 'failed', 'cancelled'].includes(r.status)) {
          if (this.replies.has(runId)) this.resolveReply(runId, st, r.error);
          if (this.finishers.has(runId)) this.finish(runId, r.status);
        }
      }
    } catch (e: any) {
      console.error('Checking waiting callers failed:', e?.message || e);
    } finally {
      this.checking = false;
    }
  }

  /** After a run of a deployed Sutra ends: trim its step data as tuned, and start queued runs. */
  private async runEnded(runId: string, flowId: string | null, source: string, status: string) {
    if (!flowId || source === 'test' || source === 'debug') return;
    const t = sutraTuning(flowId);
    if (t.stepData === 'none' || (t.stepData === 'errors only' && status === 'done')) await this.a.run('update tasks set input = null, output = null where run_id = ?', runId);
    if (this.parent) await this.persist(runId);
    await this.promoteQueued(flowId);
  }

  /**
   * A run in memory ended: its run row and step rows go to the database in one transaction and leave
   * memory. When the database cannot be written, the run stays in memory and is tried again.
   */
  private async persist(runId: string, attempt = 0): Promise<void> {
    const run = await this.a.get<any>('select * from runs where id = ?', runId);
    if (!run) return;
    const tasks = (await this.a.all<any>('select * from tasks where run_id = ? order by id', runId)).map(({ id: _id, ...t }) => t);
    const outs = await this.a.all<any>('select * from run_outputs where run_id = ?', runId);
    const insert = async (tx: TxQ, table: string, rows: any[]) => {
      if (!rows.length) return;
      const cols = Object.keys(rows[0]);
      // Several rows per statement, within PostgreSQL's limit of parameters per statement.
      const per = Math.max(1, Math.floor(30000 / cols.length));
      for (let i = 0; i < rows.length; i += per) {
        const part = rows.slice(i, i + per);
        await tx.run(`insert into ${table}(${cols.join(', ')}) values ${part.map(() => `(${cols.map(() => '?').join(', ')})`).join(', ')}`, ...part.flatMap(r => cols.map(c => r[c])));
      }
    };
    try {
      await this.parent!.a.transaction(`run:${runId}`, async tx => { await insert(tx, 'runs', [run]); await insert(tx, 'tasks', tasks); await insert(tx, 'run_outputs', outs); });
    } catch (e: any) {
      if (attempt === 0) projectLog(run.project_id, { level: 'error', msg: `Run in memory could not be written to the database, trying again: ${e?.message || e}`, flow: run.flow_name, run: runId, origin: runOrigin(run.source, run.version) });
      setTimeout(() => { void this.persist(runId, attempt + 1); }, Math.min(60000, 1000 * 2 ** attempt)).unref?.();
      return;
    }
    await this.a.transaction(undefined, async tx => {
      await tx.run('delete from tasks where run_id = ?', runId);
      await tx.run('delete from run_outputs where run_id = ?', runId);
      await tx.run('delete from runs where id = ?', runId);
    });
  }

  /** Starts queued runs while their Sutra is under its "Runs at once" limit (all Sutras when flowId is empty). */
  async promoteQueued(flowId?: string) {
    const flows = flowId ? [flowId] : (await this.a.all<any>(`select distinct flow_id from runs where status = 'queued'`)).map(r => r.flow_id as string);
    let started = 0;
    const promoted: string[] = [];
    for (const f of flows) {
      const max = Number(sutraTuning(f).maxRuns) || 0;
      await this.a.transaction(`flow:${f}`, async tx => {
        let active = Number((await tx.get<any>(`select count(*) n from runs where flow_id = ? and status in ('running', 'waiting', 'paused') and source not in ('test', 'debug')`, f))?.n || 0);
        while (max === 0 || active < max) {
          const next = await tx.get<{ id: string }>(`select id from runs where flow_id = ? and status = 'queued' order by started_at, id limit 1`, f);
          if (!next) break;
          await tx.run(`update runs set status = 'running' where id = ? and status = 'queued'`, next.id);
          await tx.run(`update tasks set status = 'pending' where run_id = ? and status = 'queued'`, next.id);
          active++; started++;
          promoted.push(next.id);
        }
      });
    }
    for (const id of promoted) this.notify(id);
    if (started) this.pump();
    return started;
  }

  /** Cancels runs of tuned Sutras that are open longer than their run time limit (the leader calls this). */
  async enforceRunTimeouts(nowMs = Date.now()) {
    let n = 0;
    for (const [flowId, t] of tunedSutras()) {
      const min = Number(t.runTimeoutMin) || 0;
      if (!min) continue;
      const cutoff = new Date(nowMs - min * 60000).toISOString();
      for (const r of await this.a.all<{ id: string }>(`select id from runs where flow_id = ? and status in ('running', 'waiting', 'paused') and source not in ('test', 'debug') and started_at < ?`, flowId, cutoff)) {
        if (await this.cancel(r.id, `Run time limit of ${min} min reached`)) n++;
      }
    }
    return n;
  }

  private finish(runId: string, status: string) {
    const f = this.finishers.get(runId);
    this.finishers.delete(runId);
    if (f) { try { f(status, runId); } catch { /* acknowledgement errors are reported by the listener */ } }
  }

  private sendReply(runId: string, r: ReplyPayload) {
    const h = this.replies.get(runId);
    if (h && !h.done) { h.done = true; h.resolve({ ...r, runId }); }
  }

  private notify(runId: string) {
    for (const l of this.listeners) { try { l(runId); } catch { /* listener errors never break runs */ } }
  }

  // ---------- operator actions ----------

  async decide(taskId: number, approved: boolean, by: string, comment = '', votes?: unknown[], port?: string) {
    const t = await this.a.get<TaskRow>('select * from tasks where id = ?', taskId);
    if (!t || t.status !== 'waiting') throw new Error('This approval is no longer waiting');
    t.id = Number(t.id); t.claim = Number(t.claim); t.attempt = Number(t.attempt);
    const run = await this.loadRun(this.a, t.run_id);
    const node = run?.doc.nodes.find(n => n.id === t.node_id);
    if (!run || !node) throw new Error('Run not found');
    const input = t.input == null ? null : JSON.parse(t.input);
    const question = !!JSON.parse(t.wait || '{}').question;
    if (question && approved && !comment.trim()) throw new Error('Write the answer first');
    const out = { ...(input && typeof input === 'object' && !Array.isArray(input) ? input : { value: input }), ...(question ? { answer: approved ? comment : '' } : {}), approval: { approved, by, comment, at: now(), ...(votes ? { votes } : {}), ...(port === 'expired' ? { expired: true } : {}) } };
    await this.complete(t, run.doc, node, { port: port || (question ? (approved ? 'answered' : 'declined') : approved ? 'approved' : 'rejected'), out }, { ms: 0, revealed: new Set(), logs: [{ t: now(), level: 'info', msg: `${node.name}: ${approved ? 'approved' : 'rejected'} by ${by}${comment ? ` (${comment})` : ''}`, step: node.name }], varsSet: {} });
    this.pump();
  }

  async cancel(runId: string, reason?: string): Promise<boolean> {
    const m = this.memoryHolding(runId);
    if (m) return m.cancel(runId, reason);
    let run: Loaded | undefined;
    const children: string[] = [];
    const done = await this.a.transaction(`run:${runId}`, async tx => {
      run = await this.loadRun(tx, runId);
      if (!run || !['running', 'waiting', 'paused', 'queued'].includes(run.row.status)) return false;
      // A step waiting for a called process: that process is cancelled too.
      for (const w of await tx.all<{ wait: string }>(`select wait from tasks where run_id = ? and status = 'waiting' and wait like '%"kind":"process"%'`, runId)) {
        try { const c = JSON.parse(w.wait).child; if (c) children.push(c); } catch { /* ignore */ }
      }
      await this.cancelOpen(tx, runId);
      run.state.logs.push({ t: now(), level: 'warn', msg: reason ? `Run cancelled: ${reason}` : 'Run cancelled' });
      await this.saveState(tx, runId, run.state);
      await tx.run(`update runs set status = 'cancelled', finished_at = ?${reason ? ', error = ?' : ''} where id = ?`, now(), ...(reason ? [reason] : []), runId);
      return true;
    });
    if (!done || !run) return false;
    const h = this.replies.get(runId);
    if (h && !h.done) h.resolve({ runId, failed: true, error: 'Run cancelled', status: 503, body: { error: 'Run cancelled' } });
    this.replies.delete(runId);
    this.docs.delete(runId);
    this.finish(runId, 'cancelled');
    await this.runEnded(runId, run.row.flow_id, run.row.source, 'cancelled');
    if (run.row.source === 'sutra' || run.row.source === 'process') void this.resumeCaller(runId, 'cancelled').catch(() => {});
    this.observeRun(runId, run.doc.name, 'cancelled', run.row.started_at, run.row.source, run.state.trace, 'Run cancelled');
    for (const c of children) await this.cancel(c);
    this.notify(runId);
    return true;
  }

  /** Debugger: step (run the next paused step), continue (run until a breakpoint), pause, or set breakpoints. */
  async debug(runId: string, action: 'step' | 'continue' | 'pause' | 'breakpoints', breakpoints?: string[]) {
    const r = await this.a.get<{ debug: string | null; status: string }>('select debug, status from runs where id = ?', runId);
    if (!r) throw new Error('Run not found');
    if (!r.debug) throw new Error('This run was not started in debug mode');
    const d = JSON.parse(r.debug) as DebugState;
    if (breakpoints) d.breakpoints = breakpoints.map(String);
    if (action === 'step' || action === 'pause') d.stepping = true;
    if (action === 'continue') d.stepping = false;
    await this.a.transaction(`run:${runId}`, async tx => {
      await tx.run('update runs set debug = ? where id = ?', JSON.stringify(d), runId);
      if (action === 'step') {
        const next = await tx.get<{ id: number }>(`select id from tasks where run_id = ? and status = 'paused' order by id limit 1`, runId);
        if (next) await tx.run(`update tasks set status = 'pending', released = 1 where id = ?`, next.id);
      }
      if (action === 'continue') await tx.run(`update tasks set status = 'pending', released = 1 where run_id = ? and status = 'paused'`, runId);
      if ((action === 'step' || action === 'continue') && r.status === 'paused') await tx.run(`update runs set status = 'running' where id = ?`, runId);
    });
    this.notify(runId);
    this.pump();
    return d;
  }

  /** Resolves when the run leaves running/waiting (tests and synchronous API calls). */
  waitFor(runId: string, timeoutMs = 30000, untilWaiting = false): Promise<any> {
    return new Promise((res, rej) => {
      let over = false;
      const check = async () => {
        if (over) return;
        const r = await this.a.get<any>('select status from runs where id = ?', runId).catch(() => undefined);
        if (!over && r && (!['running', 'waiting', 'paused', 'queued'].includes(r.status) || (untilWaiting && (r.status === 'waiting' || r.status === 'paused')))) {
          over = true;
          this.listeners.delete(fn); clearTimeout(to); clearInterval(poll); res(r.status);
        }
      };
      const fn = (id: string) => { if (id === runId) void check(); };
      const to = setTimeout(() => { over = true; this.listeners.delete(fn); clearInterval(poll); rej(new Error('Timed out waiting for run')); }, timeoutMs);
      // Runs ended by another engine send no notice here: look now and then too.
      const poll = setInterval(() => void check(), 500);
      poll.unref?.();
      this.listeners.add(fn);
      void check();
    });
  }
}

/** Process variables start each run with their declared values. */
function initialVars(doc: FlowDoc) {
  const out: Record<string, any> = {};
  for (const v of doc.variables || []) {
    if (!v?.name) continue;
    const raw = v.value;
    out[v.name] = v.type === 'number' ? Number(raw) : v.type === 'boolean' ? ['true', '1', 'yes'].includes(String(raw).toLowerCase())
      : v.type === 'json' ? (typeof raw === 'string' && raw.trim() ? JSON.parse(raw) : raw ?? null) : raw ?? '';
  }
  return out;
}

const asObject = (v: any) => (v && typeof v === 'object' && !Array.isArray(v) ? v : { value: v });

function cap(v: unknown) {
  const s = JSON.stringify(v === undefined ? null : v);
  return s.length > 1_000_000 ? JSON.stringify({ truncated: true, preview: s.slice(0, 20000) }) : s;
}

/** The step's time limit; clock.restart() starts it again (each batch a streaming step sends). */
function withTimeout<T>(p: Promise<T>, ms: number, ac: AbortController, msg: string, clock?: { restart(): void }): Promise<T> {
  return new Promise((res, rej) => {
    let timedOut = false;
    let to = setTimeout(() => { timedOut = true; ac.abort(); }, ms);
    if (clock) clock.restart = () => { clearTimeout(to); to = setTimeout(() => { timedOut = true; ac.abort(); }, ms); };
    ac.signal.addEventListener('abort', () => { clearTimeout(to); rej(new Error(timedOut ? msg : 'Step was cancelled')); }, { once: true });
    p.then(v => { clearTimeout(to); res(v); }, e => { clearTimeout(to); rej(e); });
  });
}

export const engine = new Engine();
