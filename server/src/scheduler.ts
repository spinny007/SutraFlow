/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { Cron } from 'croner';
import { engine } from './engine/engine.js';
import { deployedFlows } from './flows.js';

/** Starts runs for Timer triggers of deployed flows. Rebuilt whenever deployments change. */
let jobs: Array<{ stop(): void }> = [];
export const schedulerErrors: string[] = [];

export function rebuildSchedules() {
  for (const j of jobs) j.stop();
  jobs = [];
  schedulerErrors.length = 0;
  for (const d of deployedFlows()) {
    for (const n of d.doc.nodes.filter(x => x.type === 'timer')) {
      const fire = () => {
        try {
          engine.startRun({ doc: d.doc, flowId: d.flowId, projectId: d.projectId, version: d.version, triggerNodeId: n.id, input: { firedAt: new Date().toISOString() }, source: 'timer' });
        } catch (e: any) {
          schedulerErrors.push(`${d.doc.name} / ${n.name}: ${e.message}`);
        }
      };
      try {
        if (n.config.mode === 'interval') {
          const s = Math.max(5, Number(n.config.every) || 300);
          const t = setInterval(fire, s * 1000);
          jobs.push({ stop: () => clearInterval(t) });
        } else {
          const c = new Cron(String(n.config.cron || '0 * * * * *'), { timezone: n.config.timezone || undefined, protect: true }, fire);
          jobs.push({ stop: () => c.stop() });
        }
      } catch (e: any) {
        schedulerErrors.push(`${d.doc.name} / ${n.name}: ${e.message}`);
      }
    }
  }
}

export function stopSchedules() {
  for (const j of jobs) j.stop();
  jobs = [];
}
