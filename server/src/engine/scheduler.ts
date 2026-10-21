/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.9.0
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import type { AsyncStore } from '../asyncdb.js';
import { config } from '../config.js';
import { now } from '../db.js';
import type { TaskRow } from './run-store.js';

export type ClaimedTask = TaskRow & { run_row?: any; run_outs?: any };

export interface SchedulerOptions {
  store(): AsyncStore;
  engineId: string;
  skipLocked(): string;
  concurrency(): number;
  execute(task: ClaimedTask): Promise<void>;
  checkWaiters(): Promise<void>;
}

/** Claims and dispatches durable tasks. All wake sources coalesce through wake(). */
export class Scheduler {
  active = 0;
  draining = false;
  private timer: NodeJS.Timeout | null = null;
  private pumping = false;
  private wakeAgain = false;

  constructor(private readonly options: SchedulerOptions) {}

  get started() { return this.timer !== null; }

  start() {
    this.draining = false;
    this.startTimer();
    this.wake();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.draining = true;
  }

  setPollMs(ms: number) {
    config.pollMs = ms;
    if (this.timer) this.startTimer();
  }

  private startTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.wake();
      void this.options.checkWaiters();
    }, config.pollMs);
    this.timer.unref?.();
  }

  /** Claims due work while slots are free. Calls while pumping are coalesced, never lost. */
  wake() {
    if (this.pumping) { this.wakeAgain = true; return; }
    this.pumping = true;
    void this.pumpLoop();
  }

  private async pumpLoop() {
    try {
      do {
        this.wakeAgain = false;
        // Zero deliberately pauses claiming (used by tuning changes and deterministic queue control).
        const limit = Math.max(0, this.options.concurrency());
        let contended = 0;
        while (!this.draining && this.active < limit) {
          const got = await this.claim(Math.min(16, limit - this.active));
          if (!got.length) {
            if (contended++ < 5 && await this.options.store().get('select 1 from tasks where status = \'pending\' and not_before <= ? limit 1', Date.now())) continue;
            break;
          }
          for (const task of got) {
            this.active++;
            this.options.execute(task)
              .catch(e => console.error(`Step ${task.id} of run ${task.run_id}: ${e?.message || e}`))
              .finally(() => { this.active--; this.wake(); });
          }
        }
      } while (this.wakeAgain && !this.draining);
    } catch (e: any) {
      console.error('Claiming steps failed:', e?.message || e);
    } finally {
      this.pumping = false;
      if (this.wakeAgain && !this.draining) this.wake();
    }
  }

  /** Atomically claims a batch; PostgreSQL also returns each run and its outputs in this round trip. */
  async claim(n: number): Promise<ClaimedTask[]> {
    const db = this.options.store();
    const limit = Math.max(1, Math.floor(n));
    const update = `update tasks set status = 'running', started_at = ?, owner = ?, claim = claim + 1
       where id in (select id from tasks where status = 'pending' and not_before <= ? order by priority desc, id limit ?${this.options.skipLocked()}) and status = 'pending'
       returning *`;
    const rows = db.backend === 'postgres' && this.options.skipLocked()
      ? await db.all<ClaimedTask>(`with t as (${update}) select t.*, row_to_json(r) as run_row,
          (select json_object_agg(o.name, o.out) from run_outputs o where o.run_id = t.run_id) as run_outs
          from t left join runs r on r.id = t.run_id order by t.priority desc, t.id`, now(), this.options.engineId, Date.now(), limit)
      : (await db.all<TaskRow>(update, now(), this.options.engineId, Date.now(), limit)).sort((a, b) => Number(a.id) - Number(b.id));
    for (const task of rows) {
      task.id = Number(task.id);
      task.claim = Number(task.claim);
      task.attempt = Number(task.attempt);
    }
    return rows;
  }
}
