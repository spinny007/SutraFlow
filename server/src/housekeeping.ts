import { q, tx } from './db.js';
import { config } from './config.js';
import { pruneAudit } from './audit.js';
import { tunedSutras } from './tuning.js';

/**
 * Run housekeeping, done by the cluster leader about once a minute: finished runs (done, failed,
 * cancelled) older than SUTRA_RUN_RETENTION_DAYS are deleted with their steps. Runs still waiting
 * (approvals, timers) are never deleted. 0 days keeps everything. Audit entries older than
 * SUTRA_AUDIT_RETENTION_DAYS are deleted too.
 */
export function housekeeping(o: { retentionDays?: number; now?: number } = {}) {
  const deletedAudit = pruneAudit();
  let deletedRuns = 0;
  // Sutras tuned to keep their runs for a different time.
  for (const [flowId, t] of tunedSutras()) {
    if (Number(t.retentionDays) > 0) deletedRuns += prune(new Date((o.now ?? Date.now()) - Number(t.retentionDays) * 86400000).toISOString(), flowId);
  }
  const days = o.retentionDays ?? config.runRetentionDays;
  if (!(days > 0)) return { deletedRuns, deletedAudit };
  deletedRuns += prune(new Date((o.now ?? Date.now()) - days * 86400000).toISOString());
  return { deletedRuns, deletedAudit };
}

/** Deletes finished runs before cutoff (of one Sutra, or all), with their steps. */
function prune(cutoff: string, flowId?: string) {
  let deletedRuns = 0;
  // In batches, so a large backlog never holds the database for long.
  for (;;) {
    const ids = q.all<{ id: string }>(`select id from runs where status in ('done', 'failed', 'cancelled') and finished_at is not null and finished_at < ?${flowId ? ' and flow_id = ?' : ''} limit 500`, cutoff, ...(flowId ? [flowId] : [])).map(r => r.id);
    if (!ids.length) break;
    tx(() => {
      for (const id of ids) {
        q.run('delete from tasks where run_id = ?', id);
        q.run('delete from runs where id = ?', id);
      }
    });
    deletedRuns += ids.length;
    if (ids.length < 500) break;
  }
  return deletedRuns;
}
