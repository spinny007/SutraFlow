import crypto from 'node:crypto';
import { restrictedReason } from '../git/restricted.js';
import { now, dbKind, databaseStore, memoryStore, type Store } from '../db.js';
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
}

export interface DebugState { stepping: boolean; breakpoints: string[] }

interface ReplyHandle {
  resolve(r: ReplyPayload & { runId: string; failed?: boolean; error?: string }): void;
  done: boolean;
}

const MAX_LOGS = 500;
const DEFAULT_TIMEOUT_MS = 120000;

export class Engine {
  private activities = new Map<string, Activity>();
  private active = 0;
  private timer: NodeJS.Timeout | null = null;
  private docs = new Map<string, FlowDoc>();
  private replies = new Map<string, ReplyHandle>();
  private finishers = new Map<string, (status: string, runId: string) => void>();
  private controllers = new Map<number, AbortController>();
  private pumping = false;
  /** Shutting down: no new tasks are claimed. */
  private draining = false;
  /** Tasks handed back to the queue during a drain: their late results are ignored. */
  private handedOver = new Set<number>();
  /** This engine's name, written as the owner of the tasks it runs. */
  readonly id = config.engineId;
  /** Listeners notified when a run changes (for live status in the studio). */
  readonly listeners = new Set<(runId: string) => void>();
  concurrency = config.workerConcurrency;
  private q: Store['q'];
  private tx: Store['tx'];

  /**
   * The engine of this server keeps runs in the database (durable). Sutras tuned to run in memory go
   * to a second engine inside it (parent set) whose runs and steps live in an in-memory database and
   * are written to the database in one transaction when the run ends: far fewer writes per step, but a
   * run that is open when the server stops is lost, and such runs cannot wait.
   */
  constructor(store: Store = databaseStore, private readonly parent?: Engine) {
    this.q = store.q;
    this.tx = store.tx;
    if (parent) { this.activities = parent.activities; this.listeners = parent.listeners; }
  }
  private memoryEngine?: Engine;
  /** PostgreSQL: engines pass over a task another engine is claiming instead of waiting for it. */
  private get skipLocked() { return !this.parent && dbKind() === 'postgres' ? ' for update skip locked' : ''; }
  /** The in-memory engine, made and started on first use. */
  get memory() {
    if (!this.memoryEngine) { this.memoryEngine = new Engine(memoryStore(), this); if (this.timer) this.memoryEngine.start(); }
    return this.memoryEngine;
  }
  /** Runs open in memory now. */
  get memoryRuns(): number {
    const m = this.parent ? this : this.memoryEngine;
    return m ? Number(m.q.get<any>(`select count(*) n from runs where status in ('running', 'waiting', 'paused', 'queued')`)?.n || 0) : 0;
  }
  /** Whether a run of this Sutra runs in memory: deployed runs of Sutras tuned so (never tests or debugging). */
  private inMemory(o: { flowId?: string; source?: string; debug?: unknown }) {
    return !!o.flowId && o.source !== 'test' && o.source !== 'debug' && !o.debug && sutraTuning(o.flowId).execution === 'in memory';
  }
  /** A run open in memory: its row (status, steps, timing), or undefined. */
  memoryRun(runId: string): any {
    return this.memoryEngine?.q.get('select id, flow_id, project_id, flow_name, version, status, source, trigger_node, error, steps, started_at, finished_at from runs where id = ?', runId);
  }
  /** The in-memory engine when it holds this run. */
  private memoryHolding(runId: string) {
    return !this.parent && this.memoryEngine?.q.get('select 1 from runs where id = ?', runId) ? this.memoryEngine : undefined;
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

  start() {
    this.draining = false;
    // Steps this engine (same name) or an unnamed one was running when it stopped go back to the queue.
    // Steps of other engines are recovered by the cluster leader when their heartbeat stops.
    this.q.run(`update tasks set status = 'pending', owner = null where status = 'running' and (owner = ? or owner is null)`, this.id);
    this.timer = setInterval(() => { this.pump(); this.checkRemoteWaiters(); }, config.pollMs);
    this.timer.unref?.();
    this.memoryEngine?.start();
    this.pump();
  }
  /** Applies a changed queue check interval (tuning). */
  setPollMs(ms: number) {
    config.pollMs = ms;
    if (this.timer) { clearInterval(this.timer); this.timer = setInterval(() => { this.pump(); this.checkRemoteWaiters(); }, config.pollMs); this.timer.unref?.(); }
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
    const left = this.q.all<{ id: number }>(`select id from tasks where status = 'running' and owner = ?`, this.id);
    for (const t of left) {
      this.handedOver.add(Number(t.id));
      this.q.run(`update tasks set status = 'pending', owner = null where id = ? and status = 'running'`, t.id);
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

  startRun(o: {
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
  }): string {
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
    this.tx(() => {
      // Over its "Runs at once" limit, the run waits in a queue and starts when another one ends.
      // Runs started by Call Sutra always start (they count): their caller already holds a place and
      // waits for them, so queuing them could wait forever.
      const queued = maxRuns > 0 && o.source !== 'sutra' && o.source !== 'process' && Number(this.q.get<any>(`select count(*) n from runs where flow_id = ? and status in ('running', 'waiting', 'paused') and source not in ('test', 'debug')`, o.flowId)?.n || 0) >= maxRuns;
      this.q.run(
        `insert into runs(id, flow_id, project_id, flow_name, version, doc, status, source, trigger_node, input, state, debug, started_at, priority)
         values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, o.flowId ?? null, o.projectId ?? null, o.doc.name, o.version ?? 0, JSON.stringify(o.doc), queued ? 'queued' : 'running', o.source || 'manual', trig.id,
        o.input === undefined ? null : JSON.stringify(o.input), JSON.stringify(state), o.debug ? JSON.stringify(o.debug) : null, now(), Number(tuning.priority) || 0,
      );
      this.insertTask(id, trig.id, o.input === undefined ? null : o.input, 0, queued ? 'queued' : 'pending');
    }, maxRuns > 0 && o.flowId ? `flow:${o.flowId}` : `run:${id}`);
    this.docs.set(id, o.doc);
    if (o.onReply) this.replies.set(id, { resolve: o.onReply, done: false });
    if (o.onFinish) this.finishers.set(id, o.onFinish);
    metrics.runsStarted.inc({ sutra: o.doc.name, source: o.source || 'manual' });
    projectLog(o.projectId, { level: 'info', msg: `Run started (${o.source || 'manual'}${o.version ? `, v${o.version}` : ', draft'})`, flow: o.doc.name, run: id, origin: runOrigin(o.source, o.version) });
    this.notify(id);
    queueMicrotask(() => this.pump());
    return id;
  }

  /** Tasks this engine has queued, so a step can tell it queued a next one. */
  private queued = 0;
  private insertTask(runId: string, nodeId: string, input: any, notBefore = 0, status = 'pending') {
    this.queued++;
    this.q.run(`insert into tasks(run_id, node_id, input, status, not_before, priority, queued_at) values(?, ?, ?, ?, ?, coalesce((select priority from runs where id = ?), 0), ?)`,
      runId, nodeId, input === undefined ? null : JSON.stringify(input), status, notBefore, runId, Date.now());
  }

  // ---------- worker loop ----------

  pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      const limit = this.parent ? (config.memoryWorkers || this.parent.concurrency) : this.concurrency;
      while (!this.draining && this.active < limit) {
        // Claim the next due task in one statement: with several engines on one database, only one
        // of them changes the row from pending to running, and it records itself as the owner.
        const t = this.q.get<TaskRow>(
          `update tasks set status = 'running', started_at = ?, owner = ?
           where id = (select id from tasks where status = 'pending' and not_before <= ? order by priority desc, id limit 1${this.skipLocked}) and status = 'pending'
           returning *`, now(), this.id, Date.now());
        if (!t) {
          if (this.q.get(`select 1 from tasks where status = 'pending' and not_before <= ? limit 1`, Date.now())) continue; // another engine won; try the next
          break;
        }
        t.id = Number(t.id);
        this.active++;
        this.execute(t).finally(() => {
          this.active--;
          this.pump();
        });
      }
    } finally {
      this.pumping = false;
    }
  }

  private loadRun(runId: string) {
    const r = this.q.get<any>('select * from runs where id = ?', runId);
    if (!r) return undefined;
    let doc = this.docs.get(runId);
    if (!doc) { doc = JSON.parse(r.doc) as FlowDoc; this.docs.set(runId, doc); }
    return { row: r, doc, state: JSON.parse(r.state) as RunState };
  }

  private async execute(t: TaskRow) {
    const run = this.loadRun(t.run_id);
    if (!run || !['running', 'waiting', 'paused'].includes(run.row.status)) {
      this.q.run(`update tasks set status = 'cancelled', finished_at = ? where id = ?`, now(), t.id);
      return;
    }
    // Debugging: pause before the step (the run row was read anyway, so no query of its own).
    if (!t.released && run.row.debug) {
      const d = JSON.parse(run.row.debug) as DebugState;
      if (d.stepping || d.breakpoints.includes(t.node_id)) {
        this.q.run(`update tasks set status = 'paused', owner = null where id = ?`, t.id);
        this.settle(t.run_id);
        return;
      }
    }
    const node = run.doc.nodes.find(n => n.id === t.node_id);
    const act = node && this.activities.get(node.type);
    const input = t.input == null ? null : JSON.parse(t.input);
    if (!node || !act) {
      this.fail(t, run.doc, node, new Error(`Step ${t.node_id} has an unknown type`));
      return;
    }
    const started = Date.now();
    const revealed = new Set<string>();
    const ac = new AbortController();
    this.controllers.set(t.id, ac);
    const s = node.settings || {};
    const timeoutMs = Number(s.timeoutMs) > 0 ? Number(s.timeoutMs) : act.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const trigName = run.doc.nodes.find(n => n.id === run.row.trigger_node)?.name;
    const gv = effectiveVariables(run.row.project_id);
    gv.secrets.forEach(v => revealed.add(v));
    const runInfo = { id: t.run_id, name: run.doc.name, flow: run.doc.name, sutraId: run.row.flow_id, flowId: run.row.flow_id, version: run.row.version, project: run.row.project_id, startedAt: run.row.started_at, source: run.row.source, step: node.name, attempt: t.attempt };
    const scope: Record<string, any> = {
      input,
      nodes: run.state.outputs,
      vars: run.state.vars,
      gv: gv.values,
      ev: engineVariableValues(),
      trigger: trigName ? run.state.outputs[trigName] : undefined,
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
    try {
      let res: StepResult | void;
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
      this.controllers.delete(t.id);
      for (const l of logs) projectLog(run.row.project_id, { level: l.level as any, msg: maskSecrets(l.msg, revealed), flow: run.doc.name, run: t.run_id, step: node.name, origin: runOrigin(run.row.source, run.row.version) });
      if (wantsStepData(run.row.project_id)) projectLog(run.row.project_id, { level: 'debug', msg: 'Step finished', flow: run.doc.name, run: t.run_id, step: node.name, origin: runOrigin(run.row.source, run.row.version), data: maskSecrets({ input, output: (res as any)?.out ?? (res as any)?.store }, revealed) });
      if (this.handedOver.delete(t.id)) return;
      if (this.wasCancelled(t.id)) return this.settle(t.run_id);
      this.complete(t, run.doc, node, res || {}, { ms: Date.now() - started, revealed, logs, varsSet, replied });
    } catch (e: any) {
      this.controllers.delete(t.id);
      // Handed back during a drain: another engine runs it again.
      if (this.handedOver.delete(t.id)) return;
      // Stopped by another branch (End: stop process) or by a person: not a failure of this step.
      if (this.wasCancelled(t.id)) return this.settle(t.run_id);
      const msg = maskSecrets(String(e?.message || e), revealed);
      projectLog(run.row.project_id, { level: t.attempt < (Number(s.retries) || 0) ? 'warn' : 'error', msg, flow: run.doc.name, run: t.run_id, step: node.name, origin: runOrigin(run.row.source, run.row.version) });
      // Activities may attach what they captured (a script's output and error output) for the error branch.
      const failure = Object.assign(new Error(msg), e?.details !== undefined ? { details: maskSecrets(e.details, revealed) } : {});
      this.fail(t, run.doc, node, failure, { ms: Date.now() - started, logs });
    }
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

  private complete(
    t: TaskRow, doc: FlowDoc, node: FlowNode, res: StepResult,
    extra: { ms: number; revealed: Set<string>; logs: RunState['logs']; varsSet: Record<string, any>; replied?: ReplyPayload },
  ) {
    let replyToSend: ReplyPayload | undefined;
    let childId: string | undefined;
    let callError: string | undefined;
    let finished = true;
    let trace: RunState['trace'];
    let runStatus = '';
    const queuedBefore = this.queued;
    const call = res.call;
    if (this.parent && (res.wait || res.call?.wait)) {
      return this.fail(t, doc, node, new Error(`${node.name} waits (${res.call ? 'for a called Sutra' : 'for a decision, a message or a time'}). A Sutra that runs in memory cannot wait: set its Execution tuning to durable.`), { ms: extra.ms });
    }
    this.tx(() => {
      const run = this.loadRun(t.run_id)!;
      const st = run.state;
      trace = st.trace;
      st.logs.push(...extra.logs.map(l => ({ ...l, msg: maskSecrets(l.msg, extra.revealed) })));
      if (st.logs.length > MAX_LOGS) st.logs.splice(0, st.logs.length - MAX_LOGS);
      Object.assign(st.vars, maskSecrets(extra.varsSet, extra.revealed));
      if (extra.replied && !st.reply) { st.reply = maskSecrets(extra.replied, new Set()); replyToSend = extra.replied; }

      if (res.wait) {
        finished = false;
        this.q.run(`update tasks set status = 'waiting', wait = ?, ms = ? where id = ?`, JSON.stringify(res.wait), extra.ms, t.id);
        this.saveState(t.run_id, st);
        return;
      }
      if (res.deferUntil) {
        finished = false;
        this.q.run(`update tasks set status = 'pending', phase = 'resume', not_before = ? where id = ?`, res.deferUntil, t.id);
        this.saveState(t.run_id, st);
        return;
      }
      if (res.call) {
        if ((st.depth || 0) >= MAX_CALL_DEPTH) { callError = `Sutras call each other more than ${MAX_CALL_DEPTH} levels deep. Check for a Sutra that calls itself.`; return; }
        childId = crypto.randomUUID();
        if (res.call.wait) {
          finished = false;
          this.q.run(`update tasks set status = 'waiting', wait = ?, ms = ? where id = ?`, JSON.stringify({ kind: 'process', child: childId, name: res.call.name, ...(res.call.resume ? { resume: true } : {}) }), extra.ms, t.id);
          st.logs.push({ t: now(), level: 'info', msg: `${node.name}: calling ${res.call.name}`, step: node.name });
          this.saveState(t.run_id, st);
          return;
        }
        res = { out: { runId: childId, process: res.call.name, started: true } };
      }
      if ('result' in res) st.result = maskSecrets(res.result, extra.revealed);
      const emits = res.emits || [{ port: res.port || 'out', out: res.out }];
      const stored = maskSecrets('store' in res ? res.store : emits.length ? emits[emits.length - 1].out : undefined, extra.revealed);
      st.outputs[node.name] = stored;
      st.last = stored;
      // Step data "none": the step's input and output are not kept, also not until the run ends (a
      // streamed file of many batches would otherwise fill the disk first).
      const keep = sutraTuning(run.row.flow_id).stepData !== 'none' || run.row.source === 'test' || run.row.source === 'debug';
      this.q.run(`update tasks set status = 'done', port = ?, output = ?, ms = ?, finished_at = ?${keep ? '' : ', input = null'} where id = ?`,
        emits.map(e => e.port).filter((p, i, a) => a.indexOf(p) === i).join(','), keep ? cap(stored) : null, extra.ms, now(), t.id);
      if (res.stop) {
        this.cancelOpen(t.run_id);
        if (res.stop.status === 'failed') {
          st.failed = true;
          this.q.run(`update runs set error = ? where id = ?`, `${node.name}: ${res.stop.message || 'Sutra stopped with an error'}`, t.run_id);
        }
        st.logs.push({ t: now(), level: res.stop.status === 'failed' ? 'error' : 'info', msg: `${node.name}: Sutra stopped (${res.stop.status === 'failed' ? 'error' : 'success'})${res.stop.message ? `: ${res.stop.message}` : ''}`, step: node.name });
      } else this.route(t.run_id, doc, st, node, emits.map(e => ({ port: e.port, out: maskSecrets(e.out, extra.revealed) })));
      // State, step count and the count back in one statement.
      const steps = Number(this.q.get<{ steps: number }>('update runs set state = ?, steps = steps + 1 where id = ? returning steps', JSON.stringify(st), t.run_id)!.steps);
      runStatus = run.row.status;
      if (steps > config.maxStepsPerRun) {
        st.failed = true;
        this.cancelOpen(t.run_id);
        this.q.run(`update runs set error = ? where id = ?`, `Stopped after ${config.maxStepsPerRun} steps. Check for a loop.`, t.run_id);
        this.saveState(t.run_id, st);
      }
    }, `run:${t.run_id}`);
    if (replyToSend) this.sendReply(t.run_id, replyToSend);
    if (callError) return this.fail(t, doc, node, new Error(callError), { ms: extra.ms });
    if (finished) this.observeStep(t, node, extra.ms, 'done', trace);
    if (call && childId) {
      const depth = (this.loadRun(t.run_id)?.state.depth || 0) + 1;
      try {
        this.startRun({ doc: call.doc, flowId: call.flowId, version: call.version, projectId: call.projectId, input: call.input, source: 'sutra', id: childId, depth, triggerNodeId: call.triggerNodeId });
      } catch (e: any) {
        if (call.wait) return this.fail({ ...t, status: 'waiting' }, doc, node, new Error(`${call.name}: ${e.message}`), { ms: extra.ms });
        throw e;
      }
    }
    // The step queued a next step of a running run: the run goes on, nothing to recount. A branch that
    // ends (or waits, stops, or calls) settles the run as before.
    if (finished && !res.stop && !call && runStatus === 'running' && this.queued > queuedBefore) { this.notify(t.run_id); return; }
    this.settle(t.run_id);
  }

  /** A called process ended: resume the step that is waiting for it. */
  private resumeCaller(childRunId: string, status: string) {
    const t = this.q.get<TaskRow>(`select * from tasks where status = 'waiting' and wait like ?`, `%"child":"${childRunId}"%`);
    if (!t) return;
    const run = this.loadRun(t.run_id);
    const node = run?.doc.nodes.find(n => n.id === t.node_id);
    const child = this.loadRun(childRunId);
    if (!run || !node || !child) return;
    const wait = JSON.parse(t.wait || '{}');
    const name = (wait.name as string) || 'Called Sutra';
    if (wait.resume) {
      // The step asked to continue itself (an AI agent after a tool): run it again with the outcome.
      const err = status === 'done' ? undefined : this.q.get<{ error: string }>('select error from runs where id = ?', childRunId)?.error || status;
      const outcome = { status, name, ...(status === 'done' ? { result: child.state.result !== undefined ? child.state.result : child.state.last ?? null } : { error: err }) };
      this.q.run(`update tasks set status = 'pending', phase = 'resume', not_before = 0, wait = ? where id = ? and status = 'waiting'`, JSON.stringify({ ...wait, outcome }), t.id);
      this.pump();
      return;
    }
    if (status === 'done') {
      const result = child.state.result !== undefined ? child.state.result : child.state.last;
      this.complete(t, run.doc, node, { out: result ?? null }, { ms: 0, revealed: new Set(), logs: [{ t: now(), level: 'info', msg: `${node.name}: ${name} finished`, step: node.name }], varsSet: {} });
    } else {
      const err = this.q.get<{ error: string }>('select error from runs where id = ?', childRunId)?.error;
      this.fail(t, run.doc, node, new Error(`${name} ${status === 'cancelled' ? 'was cancelled' : `failed: ${err || 'unknown error'}`}`));
    }
    this.pump();
  }

  /**
   * Delivers live tokens on emitted ports and skip tokens on the rest. A connection may have a
   * condition on the output ({input.x}): "when" connections are taken when it is true, and
   * "otherwise" connections when no "when" connection of the same output was taken.
   */
  /** A step sends one output while it goes on (see StepContext.emit). */
  private async emitNow(t: TaskRow, node: FlowNode, port: string, out: any) {
    if (this.wasCancelled(t.id)) throw new Error('Step was cancelled');
    this.tx(() => {
      const run = this.loadRun(t.run_id)!;
      // The run state keeps a summary (a batch number, a count, the file), not the rows: the rows go
      // with the next steps' input, and the state stays small however many batches there are.
      run.state.outputs[node.name] = out && typeof out === 'object' && !Array.isArray(out)
        ? Object.fromEntries(Object.entries(out).filter(([, v]) => !Array.isArray(v))) : out;
      this.route(t.run_id, run.doc, run.state, node, [{ port, out }], true);
      this.saveState(t.run_id, run.state);
    }, `run:${t.run_id}`);
    this.notify(t.run_id);
    queueMicrotask(() => this.pump());
    // Back pressure: a fast reader waits while more of this run's steps wait than the engine runs at once.
    const limit = Math.max(4, this.concurrency * 2);
    while (Number(this.q.get<any>(`select count(*) n from tasks where run_id = ? and status = 'pending'`, t.run_id)?.n || 0) > limit) {
      if (this.wasCancelled(t.id)) throw new Error('Step was cancelled');
      await new Promise(r => setTimeout(r, 20));
    }
  }

  /** Starts the steps connected to the emitted ports. partial: other ports are not passed over (the step goes on). */
  private route(runId: string, doc: FlowDoc, st: RunState, node: FlowNode, emits: { port: string; out: any }[], partial = false) {
    const outgoing = doc.edges.filter(e => e.from === node.id);
    const emitted = new Set(emits.map(e => e.port));
    for (const em of emits) {
      const onPort = outgoing.filter(x => x.port === em.port);
      const conditional = onPort.filter(x => x.when === 'when');
      const taken = new Set<string>();
      if (conditional.length) {
        const scope = this.conditionScope(runId, st, em.out);
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
        this.deliver(runId, doc, st, e, live, live ? em.out : undefined);
      }
    }
    if (!partial) for (const e of outgoing.filter(x => !emitted.has(x.port))) this.deliver(runId, doc, st, e, false, undefined);
  }

  /** What a connection condition can read: the output as {input}, earlier activities, variables. */
  private conditionScope(runId: string, st: RunState, out: any) {
    const row = this.q.get<{ project_id: string | null; trigger_node: string }>('select project_id, trigger_node from runs where id = ?', runId);
    const doc = this.docs.get(runId);
    const trig = doc?.nodes.find(n => n.id === row?.trigger_node)?.name;
    return { input: out, output: out, nodes: st.outputs, vars: st.vars, gv: effectiveVariables(row?.project_id ?? null).values, ev: engineVariableValues(), trigger: trig ? st.outputs[trig] : undefined, now: new Date().toISOString() };
  }

  private deliver(runId: string, doc: FlowDoc, st: RunState, edge: FlowEdge, live: boolean, out: any) {
    const target = doc.nodes.find(n => n.id === edge.to);
    if (!target) return;
    const act = this.activities.get(target.type);
    const inbound = doc.edges.filter(e => e.to === target.id);
    const from = doc.nodes.find(n => n.id === edge.from)?.name || edge.from;
    if (act?.join) {
      const j = (st.joins[target.id] ||= {});
      j[edge.id] = { live, from, out };
      if (inbound.every(e => j[e.id])) {
        const lives = Object.values(j).filter(x => x.live);
        delete st.joins[target.id];
        if (lives.length) {
          st.live[target.id] = true;
          this.insertTask(runId, target.id, Object.fromEntries(lives.map(x => [x.from, x.out])));
        } else this.skipNode(runId, doc, st, target);
      }
      return;
    }
    if (live) {
      st.live[target.id] = true;
      this.insertTask(runId, target.id, out);
      return;
    }
    const s = (st.skips[target.id] ||= []);
    if (!s.includes(edge.id)) s.push(edge.id);
    if (!st.live[target.id] && inbound.every(e => s.includes(e.id))) this.skipNode(runId, doc, st, target);
  }

  private skipNode(runId: string, doc: FlowDoc, st: RunState, node: FlowNode) {
    if (st.skipped[node.id]) return;
    st.skipped[node.id] = true;
    for (const e of doc.edges.filter(x => x.from === node.id)) this.deliver(runId, doc, st, e, false, undefined);
  }

  private fail(t: TaskRow, doc: FlowDoc, node: FlowNode | undefined, err: Error, extra: { ms?: number; logs?: RunState['logs'] } = {}) {
    const s = node?.settings || {};
    // A step's own retry settings win; otherwise the Sutra's tuning, if any.
    const unset = (v: unknown) => v === undefined || v === null || v === '';
    const tuned = unset(s.retries) || unset(s.retryDelayMs) ? sutraTuning(this.q.get<any>('select flow_id, source from runs where id = ?', t.run_id)?.flow_id) : {};
    const retries = Math.max(0, Math.min(20, Number(unset(s.retries) ? tuned.retries : s.retries) || 0));
    if (node && t.attempt < retries) {
      const delay = Math.max(0, Number(unset(s.retryDelayMs) ? (tuned.retryDelayMs ?? 1000) : s.retryDelayMs)) * 2 ** t.attempt;
      metrics.retries.inc({ activity: node.type });
      this.tx(() => {
        this.q.run(`update tasks set status = 'pending', attempt = attempt + 1, not_before = ?, error = ? where id = ?`, Date.now() + delay, err.message, t.id);
        this.appendLogs(t.run_id, [...(extra.logs || []), { t: now(), level: 'warn', msg: `${node.name}: ${err.message}. Retry ${t.attempt + 1} of ${retries} in ${delay} ms.`, step: node.name }]);
      }, `run:${t.run_id}`);
      this.notify(t.run_id);
      return;
    }
    this.tx(() => {
      const run = this.loadRun(t.run_id)!;
      const st = run.state;
      st.logs.push(...(extra.logs || []), { t: now(), level: 'error', msg: `${node?.name ?? t.node_id}: ${err.message}`, step: node?.name });
      const errorEdges = node ? doc.edges.filter(e => e.from === node.id && e.port === 'error') : [];
      if (node) this.observeStep(t, node, extra.ms ?? 0, errorEdges.length ? 'error' : 'failed', st.trace, err.message);
      const input = t.input == null ? null : JSON.parse(t.input);
      const details = (err as any).details;
      const errOut = { error: { message: err.message, step: node?.name, type: node?.type, at: now(), ...(details !== undefined ? { details } : {}) }, input };
      if (node && errorEdges.length) {
        st.outputs[node.name] = errOut;
        this.q.run(`update tasks set status = 'error', port = 'error', error = ?, output = ?, ms = ?, finished_at = ? where id = ?`,
          err.message, cap(errOut), extra.ms ?? null, now(), t.id);
        this.route(t.run_id, doc, st, node, [{ port: 'error', out: errOut }]);
      } else {
        this.q.run(`update tasks set status = 'failed', error = ?, ms = ?, finished_at = ? where id = ?`, err.message, extra.ms ?? null, now(), t.id);
        this.cancelOpen(t.run_id);
        const handler = !st.caught && doc.nodes.find(n => this.activities.get(n.type)?.noInput);
        if (handler) {
          // The error handler takes over: other branches stop, and its path decides how the run ends.
          st.caught = true;
          st.live[handler.id] = true;
          st.logs.push({ t: now(), level: 'warn', msg: `${handler.name}: handling the error from ${node?.name ?? t.node_id}`, step: handler.name });
          this.insertTask(t.run_id, handler.id, errOut);
        } else {
          st.failed = true;
          this.q.run(`update runs set error = ? where id = ?`, `${node?.name ?? t.node_id}: ${err.message}`, t.run_id);
        }
      }
      this.saveState(t.run_id, st);
    }, `run:${t.run_id}`);
    this.settle(t.run_id);
  }

  private cancelOpen(runId: string) {
    this.q.run(`update tasks set status = 'cancelled', finished_at = ? where run_id = ? and status in ('pending', 'waiting', 'paused', 'queued')`, now(), runId);
    for (const r of this.q.all<{ id: number }>(`select id from tasks where run_id = ? and status = 'running'`, runId)) {
      this.q.run(`update tasks set status = 'cancelled', finished_at = ? where id = ?`, now(), r.id);
      this.controllers.get(r.id)?.abort();
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
  traceparentOf(runId: string) {
    const r = this.q.get<{ state: string }>('select state from runs where id = ?', runId);
    const st = r ? (JSON.parse(r.state) as RunState) : undefined;
    return tp(st?.trace?.traceId || traceIdFor(runId), runSpanId(runId));
  }

  /**
   * Runs a failed run again from the step that failed: the same input, attempt 0, with everything
   * the earlier steps produced kept. Only for runs that failed on a step (not ended by End: error).
   */
  resubmit(runId: string, by = 'someone') {
    const run = this.loadRun(runId);
    if (!run) throw new Error('Run not found');
    if (run.row.status !== 'failed') throw new Error(`Only failed runs can be run again (this one is ${run.row.status})`);
    const failedTasks = this.q.all<TaskRow>(`select * from tasks where run_id = ? and status = 'failed' order by id`, runId);
    if (!failedTasks.length) throw new Error('This run did not fail on a step (it was stopped on purpose), so there is no step to run again');
    this.tx(() => {
      const st = run.state;
      st.failed = false;
      st.logs.push({ t: now(), level: 'info', msg: `Run again from ${failedTasks.map(x => run.doc.nodes.find(n => n.id === x.node_id)?.name || x.node_id).join(', ')} by ${by}` });
      for (const ft of failedTasks) {
        this.q.run(`update tasks set status = 'resubmitted' where id = ?`, ft.id);
        this.q.run(`insert into tasks(run_id, node_id, input, status, not_before) values(?, ?, ?, 'pending', 0)`, runId, ft.node_id, ft.input);
      }
      // Branches cancelled when the step failed run again too.
      const cancelled = this.q.all<TaskRow>(`select * from tasks where run_id = ? and status = 'cancelled'`, runId);
      for (const ct of cancelled) {
        this.q.run(`update tasks set status = 'resubmitted' where id = ?`, ct.id);
        this.q.run(`insert into tasks(run_id, node_id, input, status, not_before) values(?, ?, ?, 'pending', 0)`, runId, ct.node_id, ct.input);
      }
      this.q.run(`update runs set status = 'running', error = null, finished_at = null, state = ? where id = ?`, JSON.stringify(st), runId);
    }, `run:${runId}`);
    this.docs.set(runId, run.doc);
    this.notify(runId);
    queueMicrotask(() => this.pump());
    return { runId, resubmitted: failedTasks.length };
  }

  /** A run cancelled on another engine: stop the steps of it running here. */
  abortCancelledHere() {
    const mine = [...this.controllers.keys()];
    if (!mine.length) return;
    for (const r of this.q.all<{ id: number }>(`select id from tasks where owner = ? and status = 'cancelled'`, this.id)) this.controllers.get(Number(r.id))?.abort();
  }

  private wasCancelled(taskId: number) {
    const r = this.q.get<{ status: string }>('select status from tasks where id = ?', taskId);
    // In memory, a step whose run already ended and was written to the database is gone.
    return r ? r.status === 'cancelled' : !!this.parent;
  }

  private saveState(runId: string, st: RunState) {
    this.q.run('update runs set state = ? where id = ?', JSON.stringify(st), runId);
  }

  private appendLogs(runId: string, logs: RunState['logs']) {
    const run = this.loadRun(runId);
    if (!run) return;
    run.state.logs.push(...logs);
    this.saveState(runId, run.state);
  }

  /** Works out the run status from its tasks. */
  private settle(runId: string) {
    const counts = Object.fromEntries(
      this.q.all<{ status: string; n: number }>('select status, count(*) n from tasks where run_id = ? group by status', runId).map(r => [r.status, r.n]),
    );
    const run = this.loadRun(runId);
    if (!run || ['done', 'failed', 'cancelled'].includes(run.row.status)) { this.notify(runId); return; }
    let status: string;
    if (counts.pending || counts.running) status = 'running';
    else if (counts.paused) status = 'paused';
    else if (counts.waiting) status = 'waiting';
    else status = run.state.failed ? 'failed' : 'done';
    const finished = status === 'done' || status === 'failed';
    this.q.run('update runs set status = ?, finished_at = ? where id = ?', status, finished ? now() : null, runId);
    if (finished) {
      this.docs.delete(runId);
      this.resolveReply(runId, run.state, run.row.error);
      const err = this.q.get<{ error: string }>('select error from runs where id = ?', runId)?.error;
      projectLog(run.row.project_id, { level: status === 'failed' ? 'error' : 'info', msg: status === 'failed' ? `Run failed: ${err}` : 'Run finished', flow: run.doc.name, run: runId, origin: runOrigin(run.row.source, run.row.version) });
      this.observeRun(runId, run.doc.name, status, run.row.started_at, run.row.source, run.state.trace, status === 'failed' ? err : undefined);
      this.finish(runId, status);
      this.runEnded(runId, run.row.flow_id, run.row.source, status);
      if (run.row.source === 'sutra' || run.row.source === 'process') queueMicrotask(() => this.resumeCaller(runId, status));
    }
    this.notify(runId);
  }

  /** The answer for a caller waiting on this run: its reply step's reply, or its outcome when it ended without one. */
  private resolveReply(runId: string, st: RunState, rowError?: string | null) {
    const h = this.replies.get(runId);
    if (h && !h.done) {
      h.done = true;
      const err = rowError || this.q.get<{ error: string }>('select error from runs where id = ?', runId)?.error;
      if (st.reply) h.resolve({ ...st.reply, runId });
      else h.resolve(st.failed
        ? { runId, failed: true, error: err || 'Sutra failed', status: 500, body: { error: err || 'Sutra failed' } }
        : { runId, status: 200, body: st.last ?? null });
    }
    this.replies.delete(runId);
  }

  /**
   * Callers wait on the engine that received them, but in a cluster another engine may run the reply
   * step or the last step. Every 250 ms this engine looks up the runs it is waiting on.
   */
  private checkRemoteWaiters() {
    const ids = [...new Set([...this.replies.keys(), ...this.finishers.keys()])];
    if (!ids.length) return;
    for (const runId of ids) {
      const r = this.q.get<{ status: string; state: string; error: string | null }>('select status, state, error from runs where id = ?', runId);
      if (!r) continue;
      const st = JSON.parse(r.state) as RunState;
      const h = this.replies.get(runId);
      if (h && !h.done && st.reply) { h.done = true; h.resolve({ ...st.reply, runId }); this.replies.delete(runId); }
      if (['done', 'failed', 'cancelled'].includes(r.status)) {
        if (this.replies.has(runId)) this.resolveReply(runId, st, r.error);
        if (this.finishers.has(runId)) this.finish(runId, r.status);
      }
    }
  }

  /** After a run of a deployed Sutra ends: trim its step data as tuned, and start queued runs. */
  private runEnded(runId: string, flowId: string | null, source: string, status: string) {
    if (!flowId || source === 'test' || source === 'debug') return;
    const t = sutraTuning(flowId);
    if (t.stepData === 'none' || (t.stepData === 'errors only' && status === 'done')) this.q.run('update tasks set input = null, output = null where run_id = ?', runId);
    if (this.parent) this.persist(runId);
    this.promoteQueued(flowId);
  }

  /**
   * A run in memory ended: its run row and step rows go to the database in one transaction and leave
   * memory. When the database cannot be written, the run stays in memory and is tried again.
   */
  private persist(runId: string, attempt = 0) {
    const run = this.q.get<any>('select * from runs where id = ?', runId);
    if (!run) return;
    const tasks = this.q.all<any>('select * from tasks where run_id = ? order by id', runId).map(({ id: _id, ...t }) => t);
    const insert = (table: string, rows: any[]) => {
      if (!rows.length) return;
      const cols = Object.keys(rows[0]);
      // Several rows per statement, within PostgreSQL's limit of parameters per statement.
      const per = Math.max(1, Math.floor(30000 / cols.length));
      for (let i = 0; i < rows.length; i += per) {
        const part = rows.slice(i, i + per);
        databaseStore.q.run(`insert into ${table}(${cols.join(', ')}) values ${part.map(() => `(${cols.map(() => '?').join(', ')})`).join(', ')}`, ...part.flatMap(r => cols.map(c => r[c])));
      }
    };
    try {
      databaseStore.tx(() => { insert('runs', [run]); insert('tasks', tasks); }, `run:${runId}`);
    } catch (e: any) {
      if (attempt === 0) projectLog(run.project_id, { level: 'error', msg: `Run in memory could not be written to the database, trying again: ${e?.message || e}`, flow: run.flow_name, run: runId, origin: runOrigin(run.source, run.version) });
      setTimeout(() => this.persist(runId, attempt + 1), Math.min(60000, 1000 * 2 ** attempt)).unref?.();
      return;
    }
    this.q.run('delete from tasks where run_id = ?', runId);
    this.q.run('delete from runs where id = ?', runId);
  }

  /** Starts queued runs while their Sutra is under its "Runs at once" limit (all Sutras when flowId is empty). */
  promoteQueued(flowId?: string) {
    const flows = flowId ? [flowId] : this.q.all<any>(`select distinct flow_id from runs where status = 'queued'`).map(r => r.flow_id as string);
    let started = 0;
    for (const f of flows) {
      const max = Number(sutraTuning(f).maxRuns) || 0;
      this.tx(() => {
        let active = Number(this.q.get<any>(`select count(*) n from runs where flow_id = ? and status in ('running', 'waiting', 'paused') and source not in ('test', 'debug')`, f)?.n || 0);
        while (max === 0 || active < max) {
          const next = this.q.get<{ id: string }>(`select id from runs where flow_id = ? and status = 'queued' order by started_at, id limit 1`, f);
          if (!next) break;
          this.q.run(`update runs set status = 'running' where id = ? and status = 'queued'`, next.id);
          this.q.run(`update tasks set status = 'pending' where run_id = ? and status = 'queued'`, next.id);
          active++; started++;
          queueMicrotask(() => this.notify(next.id));
        }
      }, `flow:${f}`);
    }
    if (started) queueMicrotask(() => this.pump());
    return started;
  }

  /** Cancels runs of tuned Sutras that are open longer than their run time limit (the leader calls this). */
  enforceRunTimeouts(nowMs = Date.now()) {
    let n = 0;
    for (const [flowId, t] of tunedSutras()) {
      const min = Number(t.runTimeoutMin) || 0;
      if (!min) continue;
      const cutoff = new Date(nowMs - min * 60000).toISOString();
      for (const r of this.q.all<{ id: string }>(`select id from runs where flow_id = ? and status in ('running', 'waiting', 'paused') and source not in ('test', 'debug') and started_at < ?`, flowId, cutoff)) {
        if (this.cancel(r.id, `Run time limit of ${min} min reached`)) n++;
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

  decide(taskId: number, approved: boolean, by: string, comment = '') {
    const t = this.q.get<TaskRow>('select * from tasks where id = ?', taskId);
    if (!t || t.status !== 'waiting') throw new Error('This approval is no longer waiting');
    const run = this.loadRun(t.run_id);
    const node = run?.doc.nodes.find(n => n.id === t.node_id);
    if (!run || !node) throw new Error('Run not found');
    const input = t.input == null ? null : JSON.parse(t.input);
    const question = !!JSON.parse(t.wait || '{}').question;
    if (question && approved && !comment.trim()) throw new Error('Write the answer first');
    const out = { ...(input && typeof input === 'object' && !Array.isArray(input) ? input : { value: input }), ...(question ? { answer: approved ? comment : '' } : {}), approval: { approved, by, comment, at: now() } };
    this.complete(t, run.doc, node, { port: question ? (approved ? 'answered' : 'declined') : approved ? 'approved' : 'rejected', out }, { ms: 0, revealed: new Set(), logs: [{ t: now(), level: 'info', msg: `${node.name}: ${approved ? 'approved' : 'rejected'} by ${by}${comment ? ` (${comment})` : ''}`, step: node.name }], varsSet: {} });
    this.pump();
  }

  cancel(runId: string, reason?: string): boolean {
    const m = this.memoryHolding(runId);
    if (m) return m.cancel(runId, reason);
    const run = this.loadRun(runId);
    if (!run || !['running', 'waiting', 'paused', 'queued'].includes(run.row.status)) return false;
    this.tx(() => {
      this.cancelOpen(runId);
      run.state.logs.push({ t: now(), level: 'warn', msg: reason ? `Run cancelled: ${reason}` : 'Run cancelled' });
      this.saveState(runId, run.state);
      this.q.run(`update runs set status = 'cancelled', finished_at = ?${reason ? ', error = ?' : ''} where id = ?`, now(), ...(reason ? [reason] : []), runId);
    }, `run:${runId}`);
    const h = this.replies.get(runId);
    if (h && !h.done) h.resolve({ runId, failed: true, error: 'Run cancelled', status: 503, body: { error: 'Run cancelled' } });
    this.replies.delete(runId);
    this.docs.delete(runId);
    this.finish(runId, 'cancelled');
    this.runEnded(runId, run.row.flow_id, run.row.source, 'cancelled');
    if (run.row.source === 'sutra' || run.row.source === 'process') queueMicrotask(() => this.resumeCaller(runId, 'cancelled'));
    this.observeRun(runId, run.doc.name, 'cancelled', run.row.started_at, run.row.source, run.state.trace, 'Run cancelled');
    // A step waiting for a called process: cancel that process too.
    for (const w of this.q.all<{ wait: string }>(`select wait from tasks where run_id = ? and status = 'cancelled' and wait like '%"kind":"process"%'`, runId)) {
      try { const c = JSON.parse(w.wait).child; if (c) this.cancel(c); } catch { /* ignore */ }
    }
    this.notify(runId);
    return true;
  }

  /** Debugger: step (run the next paused step), continue (run until a breakpoint), pause, or set breakpoints. */
  debug(runId: string, action: 'step' | 'continue' | 'pause' | 'breakpoints', breakpoints?: string[]) {
    const r = this.q.get<{ debug: string | null; status: string }>('select debug, status from runs where id = ?', runId);
    if (!r) throw new Error('Run not found');
    if (!r.debug) throw new Error('This run was not started in debug mode');
    const d = JSON.parse(r.debug) as DebugState;
    if (breakpoints) d.breakpoints = breakpoints.map(String);
    if (action === 'step' || action === 'pause') d.stepping = true;
    if (action === 'continue') d.stepping = false;
    this.tx(() => {
      this.q.run('update runs set debug = ? where id = ?', JSON.stringify(d), runId);
      if (action === 'step') {
        const next = this.q.get<{ id: number }>(`select id from tasks where run_id = ? and status = 'paused' order by id limit 1`, runId);
        if (next) this.q.run(`update tasks set status = 'pending', released = 1 where id = ?`, next.id);
      }
      if (action === 'continue') this.q.run(`update tasks set status = 'pending', released = 1 where run_id = ? and status = 'paused'`, runId);
      if ((action === 'step' || action === 'continue') && r.status === 'paused') this.q.run(`update runs set status = 'running' where id = ?`, runId);
    }, `run:${runId}`);
    this.notify(runId);
    this.pump();
    return d;
  }

  /** Resolves when the run leaves running/waiting (tests and synchronous API calls). */
  waitFor(runId: string, timeoutMs = 30000, untilWaiting = false): Promise<any> {
    return new Promise((res, rej) => {
      const check = () => {
        const r = this.q.get<any>('select status from runs where id = ?', runId);
        if (r && (!['running', 'waiting', 'paused', 'queued'].includes(r.status) || (untilWaiting && (r.status === 'waiting' || r.status === 'paused')))) {
          this.listeners.delete(fn); clearTimeout(to); res(r.status); return true;
        }
        return false;
      };
      const fn = (id: string) => { if (id === runId) check(); };
      const to = setTimeout(() => { this.listeners.delete(fn); rej(new Error('Timed out waiting for run')); }, timeoutMs);
      this.listeners.add(fn);
      check();
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
