/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.9.0
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import crypto from 'node:crypto';
import type { AsyncStore, TxQ } from '../asyncdb.js';
import { restrictedReason } from '../git/restricted.js';
import { now } from '../db.js';
import { resolve, resolveDeep } from '../template.js';
import { getSecret, maskSecrets, missingSecretError } from '../secrets.js';
import { effectiveVariables, engineVariableValues, engineSecretValues } from '../projects.js';
import { projectLog, wantsStepData, runOrigin } from '../logger.js';
import { schemaTree } from '../schemas.js';
import { adhocTree, evaluateMapping, type MappingValue } from '../mapping.js';
import { checkMappedValue } from '../mapping-check.js';
import { resolveSetting } from '../settings.js';
import { truthy } from '../expr.js';
import type { Activity, DebugState, FlowDoc, FlowNode, ReplyPayload, StepResult } from './types.js';
import type { ClaimedTask } from './scheduler.js';
import type { LoadedRun, RunState } from './state.js';

const MAX_LOOP = 10000;
const DEFAULT_TIMEOUT_MS = 120000;

export interface ExecutorPorts {
  store(): AsyncStore;
  activity(type: string): Activity | undefined;
  portsOf(node: FlowNode): string[];
  loaded(row: any, outputs?: any): LoadedRun | undefined;
  loadRun(db: TxQ, runId: string): Promise<LoadedRun | undefined>;
  outputsOf(db: TxQ, run: LoadedRun): Promise<Record<string, any>>;
  fence(task: ClaimedTask): [string, any[]];
  settle(runId: string): Promise<void>;
  fail(task: ClaimedTask, doc: FlowDoc, node: FlowNode | undefined, error: Error, extra?: { ms?: number; logs?: RunState['logs'] }): Promise<void>;
  complete(task: ClaimedTask, doc: FlowDoc, node: FlowNode, result: StepResult, extra: { ms: number; revealed: Set<string>; logs: RunState['logs']; varsSet: Record<string, any>; replied?: ReplyPayload }): Promise<void>;
  emitNow(task: ClaimedTask, node: FlowNode, port: string, output: any): Promise<void>;
  controller(taskId: number, controller?: AbortController): void;
  wasHandedOver(taskId: number): boolean;
}

/** Executes activities. Durable state changes are delegated to transition ports after execution. */
export class Executor {
  constructor(private readonly ports: ExecutorPorts) {}

  async execute(task: ClaimedTask) {
    const db = this.ports.store();
    const run = 'run_row' in task ? this.ports.loaded(task.run_row, task.run_outs ?? null) : await this.ports.loadRun(db, task.run_id);
    if (!run || !['running', 'waiting', 'paused'].includes(run.row.status)) {
      const [where, args] = this.ports.fence(task);
      await db.run(`update tasks set status = 'cancelled', finished_at = ? where ${where}`, now(), ...args);
      return;
    }
    if (!task.released && run.row.debug) {
      const debug = JSON.parse(run.row.debug) as DebugState;
      if (debug.stepping || debug.breakpoints.includes(task.node_id)) {
        const [where, args] = this.ports.fence(task);
        await db.run(`update tasks set status = 'paused', owner = null where ${where}`, ...args);
        await this.ports.settle(task.run_id);
        return;
      }
    }
    const node = run.doc.nodes.find(n => n.id === task.node_id);
    const activity = node && this.ports.activity(node.type);
    const input = task.input == null ? null : JSON.parse(task.input);
    if (!node || !activity) {
      await this.ports.fail(task, run.doc, node, new Error(`Step ${task.node_id} has an unknown type`));
      return;
    }
    const started = Date.now();
    const revealed = new Set<string>();
    const controller = new AbortController();
    this.ports.controller(task.id, controller);
    const settings = node.settings || {};
    const timeoutMs = Number(settings.timeoutMs) > 0 ? Number(settings.timeoutMs) : activity.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const triggerName = run.doc.nodes.find(n => n.id === run.row.trigger_node)?.name;
    const outputs = await this.ports.outputsOf(db, run);
    let globals: ReturnType<typeof effectiveVariables>;
    try { globals = effectiveVariables(run.row.project_id); }
    catch (error) {
      this.ports.controller(task.id);
      await this.ports.fail(task, run.doc, node, error instanceof Error ? error : new Error(String(error)));
      return;
    }
    globals.secrets.forEach(value => revealed.add(value));
    engineSecretValues().forEach(value => revealed.add(value));
    const runInfo = { id: task.run_id, name: run.doc.name, flow: run.doc.name, sutraId: run.row.flow_id, flowId: run.row.flow_id, version: run.row.version, project: run.row.project_id, startedAt: run.row.started_at, source: run.row.source, step: node.name, attempt: task.attempt };
    const scope: Record<string, any> = {
      input, nodes: outputs, vars: run.state.vars, gv: globals.values, ev: engineVariableValues(),
      trigger: triggerName ? outputs[triggerName] : undefined,
      run: runInfo, sutra: runInfo, process: runInfo, now: new Date().toISOString(),
      secret: new Proxy({}, { get: (_, name) => {
        if (typeof name !== 'string') return undefined;
        const value = getSecret(name);
        if (value === undefined) throw missingSecretError(String(name));
        revealed.add(value);
        return value;
      } }),
    };
    Object.defineProperty(scope, 'uuid', { get: () => crypto.randomUUID(), enumerable: false });
    const logs: RunState['logs'] = [];
    const varsSet: Record<string, any> = {};
    const clock = { restart: () => {} };
    let replied: ReplyPayload | undefined;
    let result: StepResult | void;
    try {
      const blocked = restrictedReason(run.row.project_id, node);
      if (blocked) throw new Error(blocked);
      if (settings.disabled) result = { port: this.ports.portsOf(node)[0] || 'out', out: input };
      else {
        const once = () => activity.execute({
          node, runId: task.run_id, input, scope, phase: task.phase, attempt: task.attempt, signal: controller.signal,
          resumed: task.phase === 'resume' && task.wait ? (JSON.parse(task.wait).outcome ?? undefined) : undefined,
          raw: key => resolveSetting(activity.fields.find(field => field.k === key), node.config?.[key], scope),
          v: key => resolve(node.config?.[key], scope),
          resolve: value => resolve(value, scope), resolveDeep: value => resolveDeep(value, scope),
          log: (level, message) => logs.push({ t: now(), level, msg: message, step: node.name }),
          secret: (name, what = 'Secret') => {
            if (!name) throw new Error(`${what} is not set`);
            const value = getSecret(name);
            if (value === undefined) throw missingSecretError(name, what);
            revealed.add(value);
            return value;
          },
          reply: value => { replied = value; },
          emit: async (port, output) => { await this.ports.emitNow(task, node, port, maskSecrets(output, revealed)); clock.restart(); },
          setVar: (key, value) => { varsSet[key] = value; },
          projectId: run.row.project_id,
          schemaTree: key => schemaTree(resolve(node.config?.[key], scope)),
          mapping: key => {
            const field = activity.fields.find(candidate => candidate.k === key);
            const mapping = node.config?.[key] as MappingValue | undefined;
            const tree = (field?.schemaField && schemaTree(resolve(node.config?.[field.schemaField], scope))) || adhocTree(mapping);
            const typed = !!mapping?.definitions || node.type === 'mapperJson' || node.type === 'mapperXml';
            const result = evaluateMapping(tree, mapping, scope, typed);
            if (typed) {
              const issues = checkMappedValue(tree, result);
              if (issues.length) throw new Error(issues.join('; '));
            }
            return result;
          },
        });
        const execution = settings.loop === 'for each item' || settings.loop === 'repeat while'
          ? this.loop(node, settings, scope, once, controller.signal) : once();
        result = await withTimeout(Promise.resolve(execution), timeoutMs, controller, `${node.name} did not finish within ${timeoutMs} ms`, clock);
      }
    } catch (cause: any) {
      this.ports.controller(task.id);
      if (this.ports.wasHandedOver(task.id)) return;
      const message = maskSecrets(String(cause?.message || cause), revealed);
      projectLog(run.row.project_id, { level: task.attempt < (Number(settings.retries) || 0) ? 'warn' : 'error', msg: message, flow: run.doc.name, run: task.run_id, step: node.name, origin: runOrigin(run.row.source, run.row.version) });
      const failure = Object.assign(new Error(message), cause?.details !== undefined ? { details: maskSecrets(cause.details, revealed) } : {});
      await this.ports.fail(task, run.doc, node, failure, { ms: Date.now() - started, logs });
      return;
    }
    this.ports.controller(task.id);
    for (const log of logs) projectLog(run.row.project_id, { level: log.level as any, msg: maskSecrets(log.msg, revealed), flow: run.doc.name, run: task.run_id, step: node.name, origin: runOrigin(run.row.source, run.row.version) });
    if (wantsStepData(run.row.project_id)) projectLog(run.row.project_id, { level: 'debug', msg: 'Step finished', flow: run.doc.name, run: task.run_id, step: node.name, origin: runOrigin(run.row.source, run.row.version), data: maskSecrets({ input, output: (result as any)?.out ?? (result as any)?.store }, revealed) });
    if (this.ports.wasHandedOver(task.id)) return;
    await this.ports.complete(task, run.doc, node, result || {}, { ms: Date.now() - started, revealed, logs, varsSet, replied });
  }

  private async loop(node: FlowNode, settings: NonNullable<FlowNode['settings']>, scope: Record<string, any>, once: () => any, signal: AbortSignal): Promise<StepResult> {
    const max = Math.max(1, Math.min(MAX_LOOP, Number(settings.loopMax) || 1000));
    const delay = Math.max(0, Number(settings.loopDelayMs) || 0);
    const pause = () => delay ? new Promise<void>((resolvePause, rejectPause) => {
      const timer = setTimeout(resolvePause, delay);
      signal.addEventListener('abort', () => { clearTimeout(timer); rejectPause(new Error('Cancelled')); }, { once: true });
    }) : Promise.resolve();
    const runOnce = async (): Promise<StepResult> => {
      const result = (await once()) || {};
      if (result.wait || result.deferUntil || result.call) throw new Error(`${node.name}: this activity cannot run in a loop`);
      return result;
    };
    const valueOf = (result: StepResult) => 'store' in result ? result.store : result.emits?.length ? result.emits[result.emits.length - 1].out : result.out;
    if (settings.loop === 'for each item') {
      let list = resolve(settings.loopOver || '{{input}}', scope);
      if (list && typeof list === 'object' && !Array.isArray(list)) list = Object.entries(list).map(([key, value]) => ({ key, value }));
      if (!Array.isArray(list)) throw new Error(`${node.name}: "Loop over" is not a list`);
      if (list.length > max) throw new Error(`${node.name}: ${list.length} items is more than the loop maximum of ${max}`);
      const outputs: any[] = [];
      for (let index = 0; index < list.length; index++) {
        if (signal.aborted) throw new Error('Cancelled');
        scope.iteration = { index, value: list[index], count: list.length };
        scope.item = list[index]; scope.index = index;
        outputs.push(valueOf(await runOnce()));
        if (index < list.length - 1) await pause();
      }
      return { out: { iterations: outputs, count: outputs.length } };
    }
    let last: StepResult = {};
    for (let index = 0; index < max; index++) {
      if (signal.aborted) throw new Error('Cancelled');
      scope.iteration = { index, output: index ? valueOf(last) : undefined }; scope.index = index;
      last = await runOnce(); scope.iteration = { index, output: valueOf(last) };
      if (!truthy(resolve(settings.loopWhile || 'false', scope))) return { port: last.port || last.emits?.[0]?.port || 'out', out: { ...asObject(valueOf(last)), _iterations: index + 1 } };
      await pause();
    }
    throw new Error(`${node.name}: still repeating after ${max} times (loop maximum)`);
  }
}

const asObject = (value: any) => value && typeof value === 'object' && !Array.isArray(value) ? value : { value };

function withTimeout<T>(promise: Promise<T>, ms: number, controller: AbortController, message: string, clock?: { restart(): void }): Promise<T> {
  return new Promise((resolvePromise, rejectPromise) => {
    let timedOut = false;
    let timer = setTimeout(() => { timedOut = true; controller.abort(); }, ms);
    if (clock) clock.restart = () => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; controller.abort(); }, ms); };
    controller.signal.addEventListener('abort', () => { clearTimeout(timer); rejectPromise(new Error(timedOut ? message : 'Step was cancelled')); }, { once: true });
    promise.then(value => { clearTimeout(timer); resolvePromise(value); }, error => { clearTimeout(timer); rejectPromise(error); });
  });
}
