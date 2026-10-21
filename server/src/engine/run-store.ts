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
import type { FlowDoc } from './types.js';
import { outputsFrom, type LoadedRun, type RunState } from './state.js';

export interface TaskRow {
  id: number;
  run_id: string;
  node_id: string;
  input: string | null;
  status: string;
  attempt: number;
  phase: string | null;
  wait: string | null;
  released: number;
  claim: number;
}

/** A transition lost ownership because another engine recovered, handed back or cancelled its task. */
export class StaleStep extends Error {
  constructor() { super('The step is no longer held by this engine'); }
}

export class RunStore {
  constructor(
    readonly db: AsyncStore,
    readonly engineId: string,
    readonly skipLocked = '',
  ) {}

  loaded(row: any, outs?: any): LoadedRun | undefined {
    if (!row) return undefined;
    const doc = JSON.parse(row.doc) as FlowDoc;
    const state = JSON.parse(row.state) as RunState;
    state.outputs ||= {};
    return { row, doc, state, ...(outs !== undefined ? { outs: outputsFrom(outs) } : {}) };
  }

  async loadRun(db: TxQ, runId: string): Promise<LoadedRun | undefined> {
    return this.loaded(await db.get<any>('select * from runs where id = ?', runId));
  }

  async outputsOf(db: TxQ, run: LoadedRun): Promise<Record<string, any>> {
    run.outs ||= outputsFrom(await db.all<{ name: string; out: string | null }>('select name, out from run_outputs where run_id = ?', run.row.id));
    return { ...run.state.outputs, ...run.outs, ...run.fresh };
  }

  fence(task: TaskRow): [string, any[]] {
    return task.status === 'waiting'
      ? ['id = ? and status = \'waiting\'', [task.id]]
      : ['id = ? and status = \'running\' and owner = ? and claim = ?', [task.id, this.engineId, task.claim]];
  }

  async fenced(tx: TxQ, task: TaskRow, set: string, ...args: any[]) {
    const [where, fenceArgs] = this.fence(task);
    const result = await tx.run(`update tasks set ${set} where ${where}`, ...args, ...fenceArgs);
    if (!result.changes) throw new StaleStep();
  }
}
