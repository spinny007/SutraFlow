/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.9.0
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import type { AsyncStore, TxQ } from '../asyncdb.js';
import { now } from '../db.js';
import { sutraTuning, tunedSutras } from '../tuning.js';
import type { DebugState, FlowDoc, FlowNode, StepResult } from './types.js';
import type { LoadedRun, RunState } from './state.js';
import type { TaskRow } from './run-store.js';

export type DebugAction = 'step' | 'continue' | 'pause' | 'breakpoints';

export interface OperatorPorts {
  store(): AsyncStore;
  engineId: string;
  loadRun(db: TxQ, runId: string): Promise<LoadedRun | undefined>;
  remember(runId: string, doc?: FlowDoc): void;
  notify(runId: string): void;
  pump(): void;
  controllers(): ReadonlyMap<number, AbortController>;
  complete(task: TaskRow, doc: FlowDoc, node: FlowNode, result: StepResult, extra: { ms: number; revealed: Set<string>; logs: RunState['logs']; varsSet: Record<string, any> }): Promise<void>;
  cancelOpen(tx: TxQ, runId: string): Promise<void>;
  saveState(tx: TxQ, runId: string, state: RunState): Promise<void>;
  cancelReply(runId: string): void;
  finish(runId: string, status: string): void;
  runEnded(runId: string, flowId: string | null, source: string, status: string): Promise<void>;
  resumeCaller(runId: string, status: string): Promise<void>;
  observeRun(runId: string, sutra: string, status: string, startedAt: string, source: string | null, trace?: RunState['trace'], error?: string): void;
  cancelMemory(runId: string, reason?: string): Promise<boolean> | undefined;
}

/** Administrative and debugger operations on durable runs. */
export class Operator {
  constructor(private readonly ports: OperatorPorts) {}

  async resubmit(runId: string, by = 'someone') {
    const run = await this.ports.loadRun(this.ports.store(), runId);
    if (!run) throw new Error('Run not found');
    if (run.row.status !== 'failed') throw new Error(`Only failed runs can be run again (this one is ${run.row.status})`);
    let count = 0;
    await this.ports.store().transaction(`run:${runId}`, async tx => {
      const failed = await tx.all<TaskRow>(`select * from tasks where run_id = ? and status = 'failed' order by id`, runId);
      if (!failed.length) throw new Error('This run did not fail on a step (it was stopped on purpose), so there is no step to run again');
      count = failed.length;
      run.state.failed = false;
      run.state.logs.push({ t: now(), level: 'info', msg: `Run again from ${failed.map(x => run.doc.nodes.find(n => n.id === x.node_id)?.name || x.node_id).join(', ')} by ${by}` });
      for (const task of failed) {
        await tx.run(`update tasks set status = 'resubmitted' where id = ?`, task.id);
        await tx.run(`insert into tasks(run_id, node_id, input, status, not_before) values(?, ?, ?, 'pending', 0)`, runId, task.node_id, task.input);
      }
      for (const task of await tx.all<TaskRow>(`select * from tasks where run_id = ? and status = 'cancelled'`, runId)) {
        await tx.run(`update tasks set status = 'resubmitted' where id = ?`, task.id);
        await tx.run(`insert into tasks(run_id, node_id, input, status, not_before) values(?, ?, ?, 'pending', 0)`, runId, task.node_id, task.input);
      }
      await tx.run(`update runs set status = 'running', error = null, finished_at = null, state = ? where id = ?`, JSON.stringify(run.state), runId);
    });
    this.ports.remember(runId, run.doc);
    this.ports.notify(runId); this.ports.pump();
    return { runId, resubmitted: count };
  }

  async abortCancelledHere() {
    const controllers = this.ports.controllers();
    if (!controllers.size) return;
    for (const row of await this.ports.store().all<{ id: number }>(`select id from tasks where owner = ? and status = 'cancelled'`, this.ports.engineId)) controllers.get(Number(row.id))?.abort();
  }

  async promoteQueued(flowId?: string) {
    const store = this.ports.store();
    const flows = flowId ? [flowId] : (await store.all<any>(`select distinct flow_id from runs where status = 'queued'`)).map(row => row.flow_id as string);
    let started = 0;
    const promoted: string[] = [];
    for (const id of flows) {
      const max = Number(sutraTuning(id).maxRuns) || 0;
      await store.transaction(`flow:${id}`, async tx => {
        let active = Number((await tx.get<any>(`select count(*) n from runs where flow_id = ? and status in ('running', 'waiting', 'paused') and source not in ('test', 'debug')`, id))?.n || 0);
        while (max === 0 || active < max) {
          const next = await tx.get<{ id: string }>(`select id from runs where flow_id = ? and status = 'queued' order by started_at, id limit 1`, id);
          if (!next) break;
          await tx.run(`update runs set status = 'running' where id = ? and status = 'queued'`, next.id);
          await tx.run(`update tasks set status = 'pending' where run_id = ? and status = 'queued'`, next.id);
          active++; started++; promoted.push(next.id);
        }
      });
    }
    for (const id of promoted) this.ports.notify(id);
    if (started) this.ports.pump();
    return started;
  }

  async enforceRunTimeouts(nowMs = Date.now()) {
    let count = 0;
    for (const [flowId, tuning] of tunedSutras()) {
      const min = Number(tuning.runTimeoutMin) || 0;
      if (!min) continue;
      const cutoff = new Date(nowMs - min * 60000).toISOString();
      for (const run of await this.ports.store().all<{ id: string }>(`select id from runs where flow_id = ? and status in ('running', 'waiting', 'paused') and source not in ('test', 'debug') and started_at < ?`, flowId, cutoff)) if (await this.cancel(run.id, `Run time limit of ${min} min reached`)) count++;
    }
    return count;
  }

  async decide(taskId: number, approved: boolean, by: string, comment = '', votes?: unknown[], port?: string) {
    const task = await this.ports.store().get<TaskRow>('select * from tasks where id = ?', taskId);
    if (!task || task.status !== 'waiting') throw new Error('This approval is no longer waiting');
    task.id = Number(task.id); task.claim = Number(task.claim); task.attempt = Number(task.attempt);
    const run = await this.ports.loadRun(this.ports.store(), task.run_id);
    const node = run?.doc.nodes.find(n => n.id === task.node_id);
    if (!run || !node) throw new Error('Run not found');
    const input = task.input == null ? null : JSON.parse(task.input);
    const question = !!JSON.parse(task.wait || '{}').question;
    if (question && approved && !comment.trim()) throw new Error('Write the answer first');
    const out = { ...(input && typeof input === 'object' && !Array.isArray(input) ? input : { value: input }), ...(question ? { answer: approved ? comment : '' } : {}), approval: { approved, by, comment, at: now(), ...(votes ? { votes } : {}), ...(port === 'expired' ? { expired: true } : {}) } };
    await this.ports.complete(task, run.doc, node, { port: port || (question ? (approved ? 'answered' : 'declined') : approved ? 'approved' : 'rejected'), out }, { ms: 0, revealed: new Set(), logs: [{ t: now(), level: 'info', msg: `${node.name}: ${approved ? 'approved' : 'rejected'} by ${by}${comment ? ` (${comment})` : ''}`, step: node.name }], varsSet: {} });
    this.ports.pump();
  }

  async cancel(runId: string, reason?: string): Promise<boolean> {
    const memory = this.ports.cancelMemory(runId, reason);
    if (memory) return memory;
    let run: LoadedRun | undefined;
    const children: string[] = [];
    const done = await this.ports.store().transaction(`run:${runId}`, async tx => {
      run = await this.ports.loadRun(tx, runId);
      if (!run || !['running', 'waiting', 'paused', 'queued'].includes(run.row.status)) return false;
      for (const row of await tx.all<{ wait: string }>(`select wait from tasks where run_id = ? and status = 'waiting' and wait like '%"kind":"process"%'`, runId)) {
        try { const child = JSON.parse(row.wait).child; if (child) children.push(child); } catch { /* ignore malformed old wait state */ }
      }
      await this.ports.cancelOpen(tx, runId);
      run.state.logs.push({ t: now(), level: 'warn', msg: reason ? `Run cancelled: ${reason}` : 'Run cancelled' });
      await this.ports.saveState(tx, runId, run.state);
      await tx.run(`update runs set status = 'cancelled', finished_at = ?${reason ? ', error = ?' : ''} where id = ?`, now(), ...(reason ? [reason] : []), runId);
      return true;
    });
    if (!done || !run) return false;
    this.ports.cancelReply(runId); this.ports.remember(runId); this.ports.finish(runId, 'cancelled');
    await this.ports.runEnded(runId, run.row.flow_id, run.row.source, 'cancelled');
    if (run.row.source === 'sutra' || run.row.source === 'process') void this.ports.resumeCaller(runId, 'cancelled').catch(() => {});
    this.ports.observeRun(runId, run.doc.name, 'cancelled', run.row.started_at, run.row.source, run.state.trace, 'Run cancelled');
    for (const child of children) await this.cancel(child);
    this.ports.notify(runId);
    return true;
  }

  async debug(runId: string, action: DebugAction, breakpoints?: string[]) {
    const store = this.ports.store();
    const row = await store.get<{ debug: string | null; status: string }>('select debug, status from runs where id = ?', runId);
    if (!row) throw new Error('Run not found');
    if (!row.debug) throw new Error('This run was not started in debug mode');
    const state = JSON.parse(row.debug) as DebugState;
    if (breakpoints) state.breakpoints = breakpoints.map(String);
    if (action === 'step' || action === 'pause') state.stepping = true;
    if (action === 'continue') state.stepping = false;
    await store.transaction(`run:${runId}`, async tx => {
      await tx.run('update runs set debug = ? where id = ?', JSON.stringify(state), runId);
      if (action === 'step') {
        const next = await tx.get<{ id: number }>(`select id from tasks where run_id = ? and status = 'paused' order by id limit 1`, runId);
        if (next) await tx.run(`update tasks set status = 'pending', released = 1 where id = ?`, next.id);
      }
      if (action === 'continue') await tx.run(`update tasks set status = 'pending', released = 1 where run_id = ? and status = 'paused'`, runId);
      if ((action === 'step' || action === 'continue') && row.status === 'paused') await tx.run(`update runs set status = 'running' where id = ?`, runId);
    });
    this.ports.notify(runId); this.ports.pump();
    return state;
  }
}
