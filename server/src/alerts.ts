import crypto from 'node:crypto';
import { q, tx, now } from './db.js';
import { config } from './config.js';
import { engine } from './engine/engine.js';
import { deployedFlows } from './flows.js';
import { getSecret } from './secrets.js';
import { sendMail } from './connectors/email.js';
import { certInfo } from './gateway/tls.js';
import { clusterStatus } from './cluster.js';
import { listenerStatus } from './listeners.js';

/**
 * Alerts: rules checked by the cluster leader every 30 seconds, so a cluster alerts once.
 *
 *  Rule      what to watch (failed runs, slow runs, gateway errors or latency, engines, work waiting,
 *            approvals waiting, certificate expiry, listener errors), with a severity and channels.
 *  Alert     opens when a rule's condition holds; can be acknowledged; resolves by itself when the
 *            condition clears. One open alert per rule at a time.
 *  Channel   email (an SMTP connection), webhook (JSON, optionally signed), or a deployed Sutra that
 *            receives the alert as its input. Every delivery is recorded on the alert.
 */

// ---------- channels ----------

export type ChannelKind = 'email' | 'webhook' | 'sutra';
export interface Channel { id: string; name: string; kind: ChannelKind; config: Record<string, any>; enabled: boolean }
const chRow = (r: any): Channel => ({ id: r.id, name: r.name, kind: r.kind, config: JSON.parse(r.config || '{}'), enabled: !!Number(r.enabled) });

export const listChannels = () => q.all<any>('select * from alert_channels order by name').map(chRow);
export const getChannel = (id: string) => { const r = q.get<any>('select * from alert_channels where id = ?', id); return r ? chRow(r) : null; };

export function saveChannel(c: Partial<Channel> & { name: string; kind: ChannelKind }) {
  const name = String(c.name || '').trim();
  if (!name) throw new Error('The channel needs a name');
  if (!['email', 'webhook', 'sutra'].includes(c.kind)) throw new Error('Kind: email, webhook or sutra');
  const cfg = c.config || {};
  if (c.kind === 'email') {
    if (!q.get(`select 1 from resources where id = ? and kind = 'smtp'`, String(cfg.connection || ''))) throw new Error('Choose an Email (SMTP) connection');
    if (!String(cfg.to || '').trim()) throw new Error('Give at least one address to send to');
  }
  if (c.kind === 'webhook' && !/^https?:\/\/\S+$/.test(String(cfg.url || ''))) throw new Error('The webhook address must start with http:// or https://');
  if (c.kind === 'sutra' && !q.get('select 1 from flows where id = ?', String(cfg.flowId || ''))) throw new Error('Choose the Sutra to start');
  const id = c.id || 'ch-' + crypto.randomBytes(4).toString('hex');
  if (q.get('select 1 from alert_channels where lower(name) = lower(?) and id != ?', name, id)) throw new Error(`A channel named "${name}" exists`);
  q.run(`insert into alert_channels(id, name, kind, config, enabled, updated_at) values(?, ?, ?, ?, ?, ?)
    on conflict(id) do update set name = excluded.name, kind = excluded.kind, config = excluded.config, enabled = excluded.enabled, updated_at = excluded.updated_at`,
  id, name, c.kind, JSON.stringify(cfg), c.enabled === false ? 0 : 1, now());
  return getChannel(id)!;
}
export function deleteChannel(id: string) {
  const used = listRules().filter(r => r.channels.includes(id)).map(r => r.name);
  if (used.length) throw new Error(`Rules still send to this channel: ${used.join(', ')}`);
  q.run('delete from alert_channels where id = ?', id);
}

// ---------- rules ----------

export type RuleKind = 'runFailures' | 'slowRuns' | 'gatewayErrors' | 'gatewayLatency' | 'engines' | 'workWaiting' | 'approvalsWaiting' | 'certificate' | 'listeners';
export interface Rule {
  id: string; name: string; kind: RuleKind; params: Record<string, any>; severity: 'warning' | 'critical';
  channels: string[]; enabled: boolean; notifyResolved: boolean; repeatMin: number;
}

/** What each kind watches and its settings, for the console and validation. */
export const RULE_KINDS: { kind: RuleKind; name: string; help: string; params: { k: string; name: string; type: 'number' | 'sutra' | 'text'; def: unknown; unit?: string; help?: string }[] }[] = [
  { kind: 'runFailures', name: 'Failed runs', help: 'Runs of deployed Sutras that failed, counted over a window.', params: [
    { k: 'count', name: 'At least', type: 'number', def: 1, unit: 'failed runs' }, { k: 'minutes', name: 'Within', type: 'number', def: 15, unit: 'min' },
    { k: 'flowId', name: 'Sutra', type: 'sutra', def: '', help: 'Empty = any deployed Sutra.' }] },
  { kind: 'slowRuns', name: 'Slow runs', help: 'Runs of a Sutra that took longer than a limit, or are still open past it.', params: [
    { k: 'seconds', name: 'Longer than', type: 'number', def: 60, unit: 's' }, { k: 'minutes', name: 'Within', type: 'number', def: 15, unit: 'min' },
    { k: 'flowId', name: 'Sutra', type: 'sutra', def: '', help: 'Empty = any deployed Sutra.' }] },
  { kind: 'gatewayErrors', name: 'Gateway error rate', help: 'Share of gateway requests answered with 5xx.', params: [
    { k: 'percent', name: 'At least', type: 'number', def: 5, unit: '%' }, { k: 'minutes', name: 'Within', type: 'number', def: 10, unit: 'min' },
    { k: 'minRequests', name: 'Only from', type: 'number', def: 20, unit: 'requests', help: 'Too few requests do not alert.' }, { k: 'service', name: 'Service', type: 'text', def: '', help: 'A Sutra name; empty = every service.' }] },
  { kind: 'gatewayLatency', name: 'Gateway latency', help: 'The 95th percentile of gateway answer times.', params: [
    { k: 'ms', name: 'p95 above', type: 'number', def: 2000, unit: 'ms' }, { k: 'minutes', name: 'Within', type: 'number', def: 10, unit: 'min' },
    { k: 'minRequests', name: 'Only from', type: 'number', def: 20, unit: 'requests' }, { k: 'service', name: 'Service', type: 'text', def: '' }] },
  { kind: 'engines', name: 'Engines', help: 'An engine stopped beating, or fewer engines are alive than needed.', params: [
    { k: 'minAlive', name: 'At least alive', type: 'number', def: 1, unit: 'engines' }] },
  { kind: 'workWaiting', name: 'Work waiting', help: 'Steps waiting in the queue longer than a limit (engines too busy or stopped).', params: [
    { k: 'minutes', name: 'Waiting longer than', type: 'number', def: 5, unit: 'min' }, { k: 'count', name: 'At least', type: 'number', def: 1, unit: 'steps' }] },
  { kind: 'approvalsWaiting', name: 'Approvals waiting', help: 'Approvals no one decided for too long.', params: [
    { k: 'hours', name: 'Waiting longer than', type: 'number', def: 24, unit: 'h' }] },
  { kind: 'certificate', name: 'Certificate expiry', help: 'The gateway certificate ends soon.', params: [
    { k: 'days', name: 'Ends within', type: 'number', def: 14, unit: 'days' }] },
  { kind: 'listeners', name: 'Listeners in error', help: 'Folder, mailbox, queue or Drive triggers that cannot listen.', params: [] },
];

const ruleRow = (r: any): Rule => ({
  id: r.id, name: r.name, kind: r.kind, params: JSON.parse(r.params || '{}'), severity: r.severity, channels: JSON.parse(r.channels || '[]'),
  enabled: !!Number(r.enabled), notifyResolved: !!Number(r.notify_resolved), repeatMin: Number(r.repeat_min) || 0,
});
export const listRules = () => q.all<any>('select * from alert_rules order by name').map(ruleRow);
export const getRule = (id: string) => { const r = q.get<any>('select * from alert_rules where id = ?', id); return r ? ruleRow(r) : null; };

export function saveRule(r: Partial<Rule> & { name: string; kind: RuleKind }) {
  const name = String(r.name || '').trim();
  if (!name) throw new Error('The rule needs a name');
  const k = RULE_KINDS.find(x => x.kind === r.kind);
  if (!k) throw new Error('Unknown kind of rule');
  const params: Record<string, any> = {};
  for (const p of k.params) {
    const v = r.params?.[p.k] ?? p.def;
    if (p.type === 'number') { const n = Number(v); if (!Number.isFinite(n) || n < 0) throw new Error(`${p.name}: a number of 0 or more`); params[p.k] = n; }
    else params[p.k] = String(v ?? '');
  }
  if (params.flowId && !q.get('select 1 from flows where id = ?', params.flowId)) throw new Error('Unknown Sutra');
  const channels = [...new Set((r.channels || []).map(String))];
  for (const c of channels) if (!getChannel(c)) throw new Error(`Unknown channel ${c}`);
  const id = r.id || 'rule-' + crypto.randomBytes(4).toString('hex');
  if (q.get('select 1 from alert_rules where lower(name) = lower(?) and id != ?', name, id)) throw new Error(`A rule named "${name}" exists`);
  q.run(`insert into alert_rules(id, name, kind, params, severity, channels, enabled, notify_resolved, repeat_min, updated_at) values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set name = excluded.name, kind = excluded.kind, params = excluded.params, severity = excluded.severity, channels = excluded.channels,
      enabled = excluded.enabled, notify_resolved = excluded.notify_resolved, repeat_min = excluded.repeat_min, updated_at = excluded.updated_at`,
  id, name, r.kind, JSON.stringify(params), r.severity === 'critical' ? 'critical' : 'warning', JSON.stringify(channels), r.enabled === false ? 0 : 1, r.notifyResolved === false ? 0 : 1, Math.max(0, Math.round(Number(r.repeatMin) || 0)), now());
  return getRule(id)!;
}
export function deleteRule(id: string) {
  tx(() => { q.run(`update alerts set state = 'resolved', resolved_at = ? where rule_id = ? and state != 'resolved'`, now(), id); q.run('delete from alert_rules where id = ?', id); });
}

// ---------- checking ----------

interface Finding { firing: boolean; message: string; details?: Record<string, unknown> }
const sutraName = (flowId: string) => (flowId ? q.get<any>('select name from flows where id = ?', flowId)?.name || flowId : '');
const pct = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0);

/** Whether a rule's condition holds now, and what to say about it. */
export function check(r: Rule, nowMs = Date.now()): Finding {
  const p = r.params;
  const flow = p.flowId ? ' and flow_id = ?' : '';
  const fa = p.flowId ? [p.flowId] : [];
  const where = (min: number) => new Date(nowMs - min * 60e3).toISOString();
  switch (r.kind) {
    case 'runFailures': {
      const rows = q.all<any>(`select id, flow_name, error from runs where status = 'failed' and source not in ('test', 'debug') and started_at >= ?${flow} order by started_at desc`, where(p.minutes), ...fa);
      return { firing: rows.length >= Math.max(1, p.count), message: `${rows.length} failed run${rows.length === 1 ? '' : 's'} of ${p.flowId ? sutraName(p.flowId) : 'deployed Sutras'} in ${p.minutes} min`, details: { runs: rows.slice(0, 5).map(x => ({ id: x.id, sutra: x.flow_name, error: x.error })) } };
    }
    case 'slowRuns': {
      const limitIso = (row: any) => Date.parse(row.finished_at || new Date(nowMs).toISOString()) - Date.parse(row.started_at);
      const rows = q.all<any>(`select id, flow_name, started_at, finished_at, status from runs where source not in ('test', 'debug') and started_at >= ?${flow}`, where(p.minutes + p.seconds / 60), ...fa)
        .filter(x => limitIso(x) > p.seconds * 1000 && (x.finished_at ? Date.parse(x.finished_at) >= nowMs - p.minutes * 60e3 : true));
      return { firing: rows.length > 0, message: `${rows.length} run${rows.length === 1 ? '' : 's'} of ${p.flowId ? sutraName(p.flowId) : 'deployed Sutras'} took longer than ${p.seconds} s`, details: { runs: rows.slice(0, 5).map(x => ({ id: x.id, sutra: x.flow_name, status: x.status, seconds: Math.round(limitIso(x) / 1000) })) } };
    }
    case 'gatewayErrors': case 'gatewayLatency': {
      const rows = q.all<any>(`select status, ms from gw_requests where at >= ?${p.service ? ' and route = ?' : ''}`, where(p.minutes), ...(p.service ? [p.service] : []));
      if (rows.length < p.minRequests) return { firing: false, message: `${rows.length} requests in ${p.minutes} min, fewer than ${p.minRequests}` };
      const scope = p.service ? `${p.service} on the gateway` : 'the gateway';
      if (r.kind === 'gatewayErrors') {
        const errors = rows.filter(x => Number(x.status) >= 500).length;
        const share = (100 * errors) / rows.length;
        return { firing: share >= p.percent, message: `${share.toFixed(1)}% of ${rows.length} requests to ${scope} failed (5xx) in ${p.minutes} min`, details: { requests: rows.length, errors } };
      }
      const p95 = pct(rows.map(x => Number(x.ms)).sort((a, b) => a - b), 95);
      return { firing: p95 > p.ms, message: `p95 of ${scope} is ${p95} ms over ${rows.length} requests in ${p.minutes} min`, details: { p95Ms: p95, requests: rows.length } };
    }
    case 'engines': {
      const st = clusterStatus();
      const silent = st.engines.filter(e => !e.alive).map(e => e.id);
      const alive = st.engines.length - silent.length;
      return { firing: silent.length > 0 || alive < p.minAlive, message: silent.length ? `Engine${silent.length === 1 ? '' : 's'} not beating: ${silent.join(', ')}; ${alive} alive` : `${alive} engine${alive === 1 ? '' : 's'} alive`, details: { silent, alive } };
    }
    case 'workWaiting': {
      const n = Number(q.get<any>(`select count(*) n from tasks t join runs r on r.id = t.run_id where t.status = 'pending' and t.not_before <= ? and coalesce(t.started_at, r.started_at) < ?`, nowMs - p.minutes * 60e3, where(p.minutes))?.n || 0);
      return { firing: n >= Math.max(1, p.count), message: `${n} step${n === 1 ? '' : 's'} waiting in the queue longer than ${p.minutes} min`, details: { steps: n } };
    }
    case 'approvalsWaiting': {
      const rows = q.all<any>(`select t.id, r.flow_name from tasks t join runs r on r.id = t.run_id where t.status = 'waiting' and t.wait like '%"approval"%' and r.started_at < ?`, new Date(nowMs - p.hours * 3600e3).toISOString());
      return { firing: rows.length > 0, message: `${rows.length} approval${rows.length === 1 ? '' : 's'} waiting longer than ${p.hours} h`, details: { approvals: rows.slice(0, 10).map(x => ({ id: Number(x.id), sutra: x.flow_name })) } };
    }
    case 'certificate': {
      const c = certInfo() as any;
      if (!c?.validTo) return { firing: false, message: 'No gateway certificate' };
      const days = Math.floor((Date.parse(c.validTo) - nowMs) / 86400e3);
      return { firing: days <= p.days, message: days < 0 ? `The gateway certificate ended ${-days} days ago` : `The gateway certificate ends in ${days} days (${c.validTo.slice(0, 10)})`, details: { validTo: c.validTo, subject: c.subject } };
    }
    case 'listeners': {
      const bad = [...listenerStatus.values()].filter(l => l.state === 'error');
      return { firing: bad.length > 0, message: bad.length ? `${bad.length} listener${bad.length === 1 ? '' : 's'} in error: ${bad.map(l => `${l.flow} (${l.message})`).join('; ')}` : 'Every listener is listening', details: { listeners: bad.map(l => ({ sutra: l.flow, step: l.step, message: l.message })) } };
    }
  }
  return { firing: false, message: '' };
}

// ---------- alerts ----------

export interface Alert { id: string; ruleId: string; ruleName: string; severity: string; state: 'firing' | 'acknowledged' | 'resolved'; message: string; details: any; startedAt: string; lastSeenAt: string; resolvedAt: string | null; ackBy: string | null; ackAt: string | null; notified: any[] }
const alertRow = (r: any): Alert => ({
  id: r.id, ruleId: r.rule_id, ruleName: r.rule_name, severity: r.severity, state: r.state, message: r.message, details: JSON.parse(r.details || 'null'),
  startedAt: r.started_at, lastSeenAt: r.last_seen_at, resolvedAt: r.resolved_at, ackBy: r.ack_by, ackAt: r.ack_at, notified: JSON.parse(r.notified || '[]'),
});

export function listAlerts(f: { state?: string; limit?: number } = {}) {
  const open = f.state === 'open';
  return q.all<any>(`select * from alerts ${open ? "where state != 'resolved'" : f.state ? 'where state = ?' : ''} order by case state when 'firing' then 0 when 'acknowledged' then 1 else 2 end, started_at desc limit ?`,
    ...(f.state && !open ? [f.state] : []), Math.min(500, Number(f.limit) || 100)).map(alertRow);
}
export const getAlert = (id: string) => { const r = q.get<any>('select * from alerts where id = ?', id); return r ? alertRow(r) : null; };

export function summary() {
  const rows = q.all<any>(`select severity, state, count(*) n from alerts where state != 'resolved' group by severity, state`);
  const n = (s?: string, st?: string) => rows.filter(r => (!s || r.severity === s) && (!st || r.state === st)).reduce((a, r) => a + Number(r.n), 0);
  return { open: n(), firing: n(undefined, 'firing'), critical: n('critical'), warning: n('warning'), acknowledged: n(undefined, 'acknowledged') };
}

export function acknowledge(id: string, by: string) {
  const a = getAlert(id);
  if (!a) throw new Error('Alert not found');
  if (a.state !== 'firing') throw new Error(`The alert is ${a.state}`);
  q.run(`update alerts set state = 'acknowledged', ack_by = ?, ack_at = ? where id = ?`, by, now(), id);
  return getAlert(id)!;
}
/** Closes an alert by hand; if its condition still holds, the next check opens a new one. */
export function resolveAlert(id: string, by: string) {
  const a = getAlert(id);
  if (!a) throw new Error('Alert not found');
  if (a.state === 'resolved') throw new Error('The alert is already resolved');
  q.run(`update alerts set state = 'resolved', resolved_at = ?, ack_by = coalesce(ack_by, ?) where id = ?`, now(), by, id);
  return getAlert(id)!;
}

// ---------- notifying ----------

/** What every channel receives. */
function payload(a: Alert, event: 'firing' | 'resolved' | 'reminder' | 'test') {
  const verb = event === 'resolved' ? 'Resolved' : event === 'reminder' ? 'Still open' : event === 'test' ? 'Test' : a.severity === 'critical' ? 'Critical' : 'Warning';
  return {
    event, text: `[SutraFlow] ${verb}: ${a.ruleName}. ${a.message}`,
    alert: { id: a.id, rule: a.ruleName, severity: a.severity, state: a.state, message: a.message, details: a.details, startedAt: a.startedAt, resolvedAt: a.resolvedAt },
    server: { engine: config.engineId, version: config.mode },
  };
}

async function deliver(ch: Channel, body: ReturnType<typeof payload>) {
  const c = ch.config;
  if (ch.kind === 'email') {
    const lines = [body.text, '', `Rule: ${body.alert.rule}`, `Severity: ${body.alert.severity}`, `Opened: ${body.alert.startedAt}`, ...(body.alert.resolvedAt ? [`Resolved: ${body.alert.resolvedAt}`] : []), '', JSON.stringify(body.alert.details ?? {}, null, 2)];
    await sendMail(String(c.connection), { to: String(c.to), subject: body.text, text: lines.join('\n') });
    return `mail to ${c.to}`;
  }
  if (ch.kind === 'webhook') {
    const json = JSON.stringify(body);
    const headers: Record<string, string> = { 'content-type': 'application/json', 'user-agent': 'SutraFlow-Alerts' };
    if (c.secret) {
      const s = getSecret(String(c.secret));
      if (s === undefined) throw new Error(`Secret ${c.secret} is not in the vault`);
      headers['x-sutra-signature'] = 'sha256=' + crypto.createHmac('sha256', s).update(json).digest('hex');
    }
    const r = await fetch(String(c.url), { method: 'POST', headers, body: json, signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`${c.url} answered ${r.status}`);
    return `${c.url} answered ${r.status}`;
  }
  const d = deployedFlows().find(x => x.flowId === c.flowId);
  if (!d) throw new Error('The Sutra is not deployed (or stopped)');
  const runId = engine.startRun({ doc: d.doc, flowId: d.flowId, projectId: d.projectId, version: d.version, input: body, source: 'alert' });
  return `run ${runId}`;
}

async function notify(a: Alert, rule: Rule | null, event: 'firing' | 'resolved' | 'reminder') {
  const body = payload(a, event);
  const results: any[] = [];
  for (const id of rule?.channels || []) {
    const ch = getChannel(id);
    if (!ch || !ch.enabled) continue;
    try { results.push({ channel: ch.name, event, at: now(), ok: true, result: await deliver(ch, body) }); }
    catch (e: any) { results.push({ channel: ch.name, event, at: now(), ok: false, error: e.message }); }
  }
  if (results.length) {
    const cur = getAlert(a.id);
    q.run('update alerts set notified = ?, last_notified_at = ? where id = ?', JSON.stringify([...(cur?.notified || []), ...results].slice(-50)), now(), a.id);
  }
  return results;
}

/** Sends a test message through a channel. */
export async function testChannel(id: string) {
  const ch = getChannel(id);
  if (!ch) throw new Error('Channel not found');
  const a: Alert = { id: 'test', ruleId: '', ruleName: 'Test from the Admin Console', severity: 'warning', state: 'firing', message: 'This is a test. Nothing is wrong.', details: null, startedAt: now(), lastSeenAt: now(), resolvedAt: null, ackBy: null, ackAt: null, notified: [] };
  return deliver(ch, payload(a, 'test'));
}

let running = false;
/**
 * One round: every enabled rule is checked; alerts open, stay, remind and resolve. The leader calls
 * this every 30 seconds; it returns what changed.
 */
export async function evaluate(nowMs = Date.now()) {
  if (running) return { opened: 0, resolved: 0, reminded: 0 };
  running = true;
  const out = { opened: 0, resolved: 0, reminded: 0 };
  try {
    for (const rule of listRules().filter(r => r.enabled)) {
      let f: Finding;
      try { f = check(rule, nowMs); } catch (e: any) { f = { firing: false, message: `Check failed: ${e.message}` }; }
      const open = q.get<any>(`select * from alerts where rule_id = ? and state != 'resolved' order by started_at desc limit 1`, rule.id);
      if (f.firing && !open) {
        const id = crypto.randomUUID();
        q.run(`insert into alerts(id, rule_id, rule_name, severity, state, message, details, started_at, last_seen_at, notified) values(?, ?, ?, ?, 'firing', ?, ?, ?, ?, '[]')`,
          id, rule.id, rule.name, rule.severity, f.message, JSON.stringify(f.details ?? null), now(), now());
        out.opened++;
        await notify(getAlert(id)!, rule, 'firing');
      } else if (f.firing && open) {
        q.run('update alerts set last_seen_at = ?, message = ?, details = ? where id = ?', now(), f.message, JSON.stringify(f.details ?? null), open.id);
        const last = Date.parse(open.last_notified_at || open.started_at);
        if (rule.repeatMin > 0 && open.state === 'firing' && nowMs - last >= rule.repeatMin * 60e3) { out.reminded++; await notify(getAlert(open.id)!, rule, 'reminder'); }
      } else if (!f.firing && open) {
        q.run(`update alerts set state = 'resolved', resolved_at = ?, message = ? where id = ?`, now(), `${open.message} (cleared: ${f.message})`, open.id);
        out.resolved++;
        if (rule.notifyResolved) await notify(getAlert(open.id)!, rule, 'resolved');
      }
    }
  } finally { running = false; }
  return out;
}

/** Resolved alerts older than the audit retention are deleted (housekeeping). */
export function pruneAlerts(nowMs = Date.now()) {
  const days = config.auditRetentionDays;
  if (!(days > 0)) return 0;
  return Number(q.run(`delete from alerts where state = 'resolved' and resolved_at < ?`, new Date(nowMs - days * 86400e3).toISOString()).changes || 0);
}

/** Alert counts for the Overview dashboard, and runs over the last day by hour. */
export function runsTimeline(visible: 'all' | Set<string>, nowMs = Date.now()) {
  const hour = 3600e3, start = Math.floor((nowMs - 24 * hour) / hour) * hour;
  const v = visible === 'all' ? { sql: '', args: [] as string[] } : visible.size ? { sql: ` and project_id in (${[...visible].map(() => '?').join(', ')})`, args: [...visible] } : { sql: ' and 1 = 0', args: [] };
  const rows = q.all<any>(`select started_at, status from runs where started_at >= ? and source not in ('test', 'debug')${v.sql}`, new Date(start).toISOString(), ...v.args);
  const n = Math.ceil((nowMs - start) / hour);
  const t = Array.from({ length: n }, (_x, i) => ({ at: new Date(start + i * hour).toISOString(), done: 0, failed: 0, other: 0 }));
  for (const r of rows) {
    const i = Math.floor((Date.parse(r.started_at) - start) / hour);
    if (i < 0 || i >= n) continue;
    if (r.status === 'done') t[i].done++; else if (r.status === 'failed') t[i].failed++; else t[i].other++;
  }
  return t;
}

