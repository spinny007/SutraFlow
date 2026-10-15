import { q, now } from './db.js';
import { config } from './config.js';

/**
 * Audit log: who changed what, when, from where, and whether it worked. Every changing admin API call
 * is recorded, with sign-ins and refused requests. Secret values and passwords are never recorded.
 * Kept for SUTRA_AUDIT_RETENTION_DAYS (housekeeping deletes older entries).
 */
export interface AuditEntry {
  actor: string; actorKind?: string; ip?: string; action: string; method?: string; path?: string;
  target?: string; projectId?: string; status?: number; outcome: 'ok' | 'denied' | 'failed'; details?: unknown;
}

export const auditRetentionDays = () => config.auditRetentionDays;

export function audit(e: AuditEntry) {
  try {
    q.run(`insert into audit(at, actor, actor_kind, ip, action, method, path, target, project_id, status, outcome, details) values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      now(), e.actor || 'anonymous', e.actorKind || '', e.ip || '', e.action, e.method || '', e.path || '', e.target || '', e.projectId || '', e.status ?? 0, e.outcome,
      e.details === undefined ? '' : JSON.stringify(e.details).slice(0, 4000));
  } catch (err) {
    console.error('Audit log:', err);
  }
}

export interface AuditFilter { actor?: string; action?: string; projectId?: string; outcome?: string; from?: string; to?: string; text?: string; before?: number; limit?: number }

export function listAudit(f: AuditFilter = {}) {
  const where: string[] = [], args: any[] = [];
  if (f.actor) { where.push('lower(actor) = lower(?)'); args.push(f.actor); }
  if (f.action) { where.push('action like ?'); args.push(`%${f.action}%`); }
  if (f.projectId) { where.push('project_id = ?'); args.push(f.projectId); }
  if (f.outcome) { where.push('outcome = ?'); args.push(f.outcome); }
  if (f.from) { where.push('at >= ?'); args.push(f.from); }
  if (f.to) { where.push('at <= ?'); args.push(f.to); }
  if (f.before) { where.push('id < ?'); args.push(f.before); }
  if (f.text) { where.push('(lower(target) like ? or lower(details) like ? or lower(path) like ?)'); const t = `%${f.text.toLowerCase()}%`; args.push(t, t, t); }
  const limit = Math.min(1000, Math.max(1, Number(f.limit) || 200));
  return q.all<any>(`select * from audit ${where.length ? 'where ' + where.join(' and ') : ''} order by id desc limit ?`, ...args, limit).map(r => ({
    id: Number(r.id), at: r.at, actor: r.actor, actorKind: r.actor_kind, ip: r.ip, action: r.action, method: r.method, path: r.path,
    target: r.target, projectId: r.project_id, status: Number(r.status), outcome: r.outcome, details: r.details ? JSON.parse(r.details) : null,
  }));
}

const csvCell = (v: unknown) => { const s = v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function auditCsv(f: AuditFilter = {}) {
  const rows = listAudit({ ...f, limit: 1000 });
  const cols = ['at', 'actor', 'actorKind', 'ip', 'action', 'target', 'projectId', 'status', 'outcome', 'details'] as const;
  return [cols.join(','), ...rows.map(r => cols.map(c => csvCell((r as any)[c])).join(','))].join('\n') + '\n';
}

/** Deletes entries older than the retention period. */
export function pruneAudit(days = auditRetentionDays()) {
  if (!(days > 0)) return 0;
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  return Number(q.run('delete from audit where at < ?', cutoff).changes || 0);
}
