/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
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
  /** Names at the time of the change: the project, and the Sutra (process) it was about. */
  projectName?: string; sutraId?: string; sutraName?: string;
}

export const auditRetentionDays = () => config.auditRetentionDays;

export function audit(e: AuditEntry) {
  try {
    q.run(`insert into audit(at, actor, actor_kind, ip, action, method, path, target, project_id, status, outcome, details, project_name, sutra_id, sutra_name, environment, engine) values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      now(), e.actor || 'anonymous', e.actorKind || '', e.ip || '', e.action, e.method || '', e.path || '', e.target || '', e.projectId || '', e.status ?? 0, e.outcome,
      e.details === undefined ? '' : JSON.stringify(e.details).slice(0, 4000), e.projectName || '', e.sutraId || '', e.sutraName || '', config.environment, config.engineId);
  } catch (err) {
    console.error('Audit log:', err);
  }
}

export interface AuditFilter { environment?: string; actor?: string; action?: string; projectId?: string; sutraId?: string; outcome?: string; from?: string; to?: string; text?: string; before?: number; limit?: number }

export function listAudit(f: AuditFilter = {}) {
  const where: string[] = [], args: any[] = [];
  if (f.actor) { where.push('lower(actor) = lower(?)'); args.push(f.actor); }
  if (f.action) { where.push('action like ?'); args.push(`%${f.action}%`); }
  if (f.projectId) { where.push('project_id = ?'); args.push(f.projectId); }
  if (f.sutraId) { where.push('sutra_id = ?'); args.push(f.sutraId); }
  if (f.environment) { where.push('environment = ?'); args.push(f.environment); }
  if (f.outcome) { where.push('outcome = ?'); args.push(f.outcome); }
  if (f.from) { where.push('at >= ?'); args.push(f.from); }
  if (f.to) { where.push('at <= ?'); args.push(f.to); }
  if (f.before) { where.push('id < ?'); args.push(f.before); }
  if (f.text) { where.push('(lower(target) like ? or lower(details) like ? or lower(path) like ? or lower(sutra_name) like ? or lower(project_name) like ?)'); const t = `%${f.text.toLowerCase()}%`; args.push(t, t, t, t, t); }
  const limit = Math.min(1000, Math.max(1, Number(f.limit) || 200));
  // Entries from before names were kept: today's names, when the project or Sutra still exists.
  const pname = new Map<string, string>(), sname = new Map<string, string>();
  const projectName = (id: string) => { if (!id) return ''; if (!pname.has(id)) pname.set(id, q.get<any>('select name from projects where id = ?', id)?.name || ''); return pname.get(id)!; };
  const sutraName = (id: string) => { if (!id) return ''; if (!sname.has(id)) sname.set(id, q.get<any>('select name from flows where id = ?', id)?.name || ''); return sname.get(id)!; };
  return q.all<any>(`select * from audit ${where.length ? 'where ' + where.join(' and ') : ''} order by id desc limit ?`, ...args, limit).map(r => {
    const sutraId = r.sutra_id || (/^\S+ \/api\/(flows|console\/sutras)\/:id/.test(r.action) ? String(r.target || '').replace(/^id=/, '').split(' ')[0] : '');
    return {
      id: Number(r.id), at: r.at, actor: r.actor, actorKind: r.actor_kind, ip: r.ip, action: r.action, method: r.method, path: r.path,
      target: r.target, projectId: r.project_id, projectName: r.project_name || projectName(r.project_id), sutraId, sutraName: r.sutra_name || sutraName(sutraId),
      status: Number(r.status), outcome: r.outcome, details: r.details ? JSON.parse(r.details) : null,
      environment: r.environment || '', engine: r.engine || '',
      // Test runs from the designer, against deployed Sutras and their runs.
      origin: /\/test$|\/debug/.test(r.action) ? 'editor test' : /\/deploy$|packages\/deploy|rollback|console\/sutras/.test(r.action) ? 'deployed' : '',
    };
  });
}

const csvCell = (v: unknown) => { const s = v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function auditCsv(f: AuditFilter = {}) {
  const rows = listAudit({ ...f, limit: 1000 });
  const cols = ['at', 'environment', 'engine', 'actor', 'actorKind', 'ip', 'action', 'origin', 'projectName', 'projectId', 'sutraName', 'sutraId', 'target', 'status', 'outcome', 'details'] as const;
  return [cols.join(','), ...rows.map(r => cols.map(c => csvCell((r as any)[c])).join(','))].join('\n') + '\n';
}

/** How much the audit log holds and how long it keeps entries, for the Admin Console. */
export function auditStats() {
  const r = q.get<any>('select count(*) n, min(at) oldest, max(at) newest from audit') || {};
  const cleared = q.get<any>(`select at, actor, details from audit where action = 'Audit cleared' order by id desc limit 1`);
  return {
    retentionDays: auditRetentionDays(), entries: Number(r.n || 0), oldest: r.oldest || null, newest: r.newest || null,
    lastCleared: cleared ? { at: cleared.at, by: cleared.actor, details: cleared.details ? JSON.parse(cleared.details) : null } : null,
  };
}

/**
 * Clears the audit log: entries before a date, older than the retention, or all of them. The
 * clearing itself is recorded afterwards, so a cleared log always says who cleared it and what.
 */
export function clearAudit(o: { before?: string; olderThanRetention?: boolean; all?: boolean }, who: { actor: string; actorKind?: string; ip?: string }) {
  let n = 0, what = '';
  if (o.all) { n = Number(q.run('delete from audit').changes || 0); what = 'all entries'; }
  else if (o.olderThanRetention) {
    if (!(auditRetentionDays() > 0)) throw new Error('No retention is set (0 = keep everything); set the days to keep first');
    n = pruneAudit(); what = `entries older than ${auditRetentionDays()} days`;
  } else if (o.before) {
    const d = new Date(o.before);
    if (Number.isNaN(d.getTime())) throw new Error('Give the date to clear before, such as 2026-10-01');
    n = Number(q.run('delete from audit where at < ?', d.toISOString()).changes || 0); what = `entries before ${d.toISOString().slice(0, 10)}`;
  } else throw new Error('Choose what to clear: before a date, older than the retention, or all');
  audit({ actor: who.actor, actorKind: who.actorKind, ip: who.ip, action: 'Audit cleared', target: what, outcome: 'ok', details: { deleted: n, ...o } });
  return { deleted: n, what };
}

/** Deletes entries older than the retention period. */
export function pruneAudit(days = auditRetentionDays()) {
  if (!(days > 0)) return 0;
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  return Number(q.run('delete from audit where at < ?', cutoff).changes || 0);
}
