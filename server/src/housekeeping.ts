import { q, tx } from './db.js';
import { config } from './config.js';
import { pruneAudit } from './audit.js';

/**
 * Run housekeeping, done by the cluster leader about once a minute: finished runs (done, failed,
 * cancelled) older than SUTRA_RUN_RETENTION_DAYS are deleted with their steps. Runs still waiting
 * (approvals, timers) are never deleted. 0 days keeps everything. Audit entries older than
 * SUTRA_AUDIT_RETENTION_DAYS are deleted too.
 */
export function housekeeping(o: { retentionDays?: number; now?: number } = {}) {
  const deletedAudit = pruneAudit();
  const days = o.retentionDays ?? config.runRetentionDays;
  if (!(days > 0)) return { deletedRuns: 0, deletedAudit };
  const cutoff = new Date((o.now ?? Date.now()) - days * 86400000).toISOString();
  let deletedRuns = 0;
  // In batches, so a large backlog never holds the database for long.
  for (;;) {
    const ids = q.all<{ id: string }>(`select id from runs where status in ('done', 'failed', 'cancelled') and finished_at is not null and finished_at < ? limit 500`, cutoff).map(r => r.id);
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
  return { deletedRuns, deletedAudit };
}
