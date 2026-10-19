/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { Fragment, useEffect, useState } from 'react';
import { get } from '../src/api';
import { useToast } from '../src/ui';
import { act } from './log';
import { PageHead, State, Err, Empty, when } from './shared';

interface Policy { retentionDays: number; entries: number; oldest: string | null; newest: string | null; lastCleared: { at: string; by: string; details: any } | null }

/** How long the audit log keeps entries, and clearing it. Changing either needs "Audit settings and clearing". */
function Retention({ onCleared }: { onCleared(): void }) {
  const toast = useToast();
  const [p, setP] = useState<Policy | null>(null);
  const [days, setDays] = useState('');
  const [before, setBefore] = useState('');
  const [confirm, setConfirm] = useState<'all' | 'before' | 'older' | null>(null);
  const [err, setErr] = useState('');
  const load = () => get<Policy>('/api/audit/policy').then(x => { setP(x); setDays(String(x.retentionDays)); }).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []);
  const save = async () => {
    try { setP(await act({ label: `Keep audit entries ${days} days`, method: 'PUT', url: '/api/audit/policy', body: { retentionDays: Number(days) }, cli: ['audit', 'retention', days] })); toast('Retention saved'); }
    catch (e: any) { toast(e.message, true); }
  };
  const clear = async () => {
    const body = confirm === 'all' ? { all: true } : confirm === 'older' ? { olderThanRetention: true } : { before };
    const cli = ['audit', 'clear', ...(confirm === 'all' ? ['--all'] : confirm === 'older' ? ['--older'] : ['--before', before])];
    try {
      const r = await act<any>({ label: `Clear the audit log (${confirm === 'before' ? `before ${before}` : confirm})`, method: 'POST', url: '/api/audit/clear', body, cli });
      toast(`Cleared ${r.deleted} entries`); setConfirm(null); load(); onCleared();
    } catch (e: any) { toast(e.message, true); }
  };
  if (err) return <Err text={err} />;
  if (!p) return null;
  return (
    <section className="c-card" aria-label="Retention">
      <div className="c-cardhead"><strong>Retention</strong><span className="muted xs">{p.entries} entries{p.oldest ? `, oldest ${when(p.oldest)}` : ''}</span></div>
      <p className="muted xs">Entries older than the days to keep are deleted by housekeeping. 0 keeps everything. Clearing is recorded as its own entry, so the log always shows who cleared it.{p.lastCleared ? ` Last cleared ${when(p.lastCleared.at)} by ${p.lastCleared.by}.` : ''}</p>
      <div className="c-filters">
        <div className="fld"><label htmlFor="a-days">Keep entries (days)</label><input id="a-days" type="number" min={0} max={3650} value={days} onChange={e => setDays(e.target.value)} /></div>
        <button className="btn primary small" disabled={days === String(p.retentionDays) || days === ''} onClick={save}>Save</button>
        <button className="btn small" disabled={!p.retentionDays} onClick={() => setConfirm('older')}>Delete older entries now</button>
        <div className="fld"><label htmlFor="a-before">Clear before</label><input id="a-before" type="date" className="inp" value={before} onChange={e => setBefore(e.target.value)} /></div>
        <button className="btn small" disabled={!before} onClick={() => setConfirm('before')}>Clear before</button>
        <button className="btn c-danger-soft small" onClick={() => setConfirm('all')}>Clear all</button>
      </div>
      {confirm && (
        <div className="c-confirm" role="alertdialog" aria-label="Confirm clearing">
          <p><strong>{confirm === 'all' ? `Delete all ${p.entries} audit entries?` : confirm === 'older' ? `Delete the entries older than ${p.retentionDays} days?` : `Delete the entries before ${before}?`}</strong> This cannot be undone. Export them first if you need a copy.</p>
          <div className="c-actions"><button className="btn c-danger-soft" onClick={clear}>Delete</button><button className="btn" onClick={() => setConfirm(null)}>Cancel</button></div>
        </div>
      )}
    </section>
  );
}

interface Entry { environment: string; engine: string; origin: string; id: number; at: string; actor: string; actorKind: string; ip: string; action: string; target: string; projectId: string; projectName: string; sutraId: string; sutraName: string; status: number; outcome: 'ok' | 'denied' | 'failed'; details: any }

/** A name with its id below it, small, for checking logs by either. */
const NameId = ({ name, id }: { name?: string; id?: string }) => (id || name
  ? <><div>{name || <span className="muted">(deleted)</span>}</div>{id && <div className="mono xs muted" title={id}>{id}</div>}</>
  : <span className="muted">-</span>);

/** Plain words for the recorded API actions. */
const ACTIONS: Record<string, string> = {
  'POST /api/flows': 'Created a Sutra', 'PUT /api/flows/:id': 'Changed a Sutra', 'DELETE /api/flows/:id': 'Deleted a Sutra',
  'POST /api/flows/:id/deploy': 'Deployed a Sutra', 'DELETE /api/flows/:id/deploy': 'Undeployed a Sutra', 'POST /api/flows/:id/test': 'Test run', 'POST /api/flows/:id/run': 'Started a run',
  'PUT /api/console/sutras/:id/enabled': 'Started or stopped a Sutra', 'POST /api/console/engines/:id/drain': 'Drained an engine',
  'POST /api/packages/deploy': 'Deployed a package', 'POST /api/projects/:id/rollback': 'Rolled back a project',
  'POST /api/projects': 'Created a project', 'PUT /api/projects/:id': 'Changed a project', 'DELETE /api/projects/:id': 'Deleted a project', 'PUT /api/projects/:id/ops': 'Changed a deployment config',
  'POST /api/runs/:id/resubmit': 'Resubmitted a run', 'POST /api/runs/:id/cancel': 'Cancelled a run', 'POST /api/approvals/:id': 'Decided an approval',
  'POST /api/resources': 'Added a connection', 'PUT /api/resources/:id': 'Changed a connection', 'DELETE /api/resources/:id': 'Deleted a connection',
  'PUT /api/secrets/:name': 'Stored a secret', 'DELETE /api/secrets/:name': 'Deleted a secret',
  'POST /api/access/users': 'Added an account', 'PUT /api/access/users/:name': 'Changed an account', 'DELETE /api/access/users/:name': 'Deleted an account',
  'POST /api/access/users/:name/password': 'Set a password', 'POST /api/access/users/:name/unlock': 'Unlocked an account', 'POST /api/access/users/:name/sign-out': 'Signed out an account everywhere',
  'POST /api/access/users/:name/tokens': 'Created an API token', 'DELETE /api/access/users/:name/tokens/:id': 'Revoked an API token',
  'POST /api/access/roles': 'Added a role', 'PUT /api/access/roles/:id': 'Changed a role', 'DELETE /api/access/roles/:id': 'Deleted a role',
  'POST /api/auth/password': 'Changed own password', 'PUT /api/server/gateway': 'Changed gateway ports', 'PUT /api/server/tls': 'Changed certificates',
  'PUT /api/engine-variables': 'Changed Sengine variables', 'PUT /api/scripts/policy': 'Changed the scripts policy', 'PUT /api/releases/policy': 'Changed the release policy',
  'POST /api/gateway/apps': 'Added a gateway app', 'PUT /api/gateway/apps/:id': 'Changed a gateway app', 'DELETE /api/gateway/apps/:id': 'Deleted a gateway app',
  'POST /api/gateway/apps/:id/keys': 'Created an app key', 'DELETE /api/gateway/apps/:id/keys/:keyId': 'Revoked an app key',
  'POST /api/gateway/plans': 'Added a plan', 'PUT /api/gateway/plans/:id': 'Changed a plan', 'DELETE /api/gateway/plans/:id': 'Deleted a plan',
  'PUT /api/gateway/firewall': 'Changed the gateway firewall', 'PUT /api/gateway/options': 'Changed gateway options',
  'POST /api/console/sutras/:id/restart': 'Restarted a Sutra', 'PUT /api/console/tuning/engine': 'Tuned the engines', 'PUT /api/console/tuning/engines/:id': 'Tuned an engine', 'PUT /api/console/sutras/:id/tuning': 'Tuned a Sutra',
  'POST /api/projects/import': 'Imported a project', 'POST /api/projects/:id/copy': 'Copied a project',
  'POST /api/engine/drain': 'Stopped an engine', 'POST /api/engine/housekeeping': 'Deleted old runs',
  'PUT /api/audit/policy': 'Changed the audit retention', 'Audit cleared': 'Cleared the audit log',
  'POST /api/projects/:id/log/clear': 'Cleared a project log', 'POST /api/projects/:id/runs/clear-tests': 'Cleared test runs',
};
const describe = (a: string) => ACTIONS[a] || a;

/** Who did what, when, from where: searchable and exportable. */
export function Audit() {
  const [filters, setFilters] = useState({ actor: '', outcome: '', q: '', from: '', to: '', projectId: '', sutraId: '', environment: '' });
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [sutras, setSutras] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { get<any[]>('/api/projects').then(p => setProjects(p.map(x => ({ id: x.id, name: x.name })))).catch(() => {}); }, []);
  useEffect(() => {
    if (!filters.projectId) { setSutras([]); return; }
    get<any[]>(`/api/flows?projectId=${encodeURIComponent(filters.projectId)}`).then(f => setSutras(f.map(x => ({ id: x.id, name: x.name })))).catch(() => setSutras([]));
  }, [filters.projectId]);
  const [rows, setRows] = useState<Entry[]>([]);
  const [more, setMore] = useState(false);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const query = (before?: number) => {
    const p = new URLSearchParams();
    if (filters.actor) p.set('actor', filters.actor);
    if (filters.outcome) p.set('outcome', filters.outcome);
    if (filters.projectId) p.set('projectId', filters.projectId);
    if (filters.sutraId) p.set('sutraId', filters.sutraId);
    if (filters.environment) p.set('environment', filters.environment);
    if (filters.q) p.set('q', filters.q);
    if (filters.from) p.set('from', new Date(filters.from).toISOString());
    if (filters.to) p.set('to', new Date(filters.to + 'T23:59:59').toISOString());
    if (before) p.set('before', String(before));
    p.set('limit', '200');
    return p.toString();
  };
  const load = async (append = false) => {
    try {
      const r = await get<Entry[]>(`/api/audit?${query(append && rows.length ? rows[rows.length - 1].id : undefined)}`);
      setRows(append ? [...rows, ...r] : r); setMore(r.length === 200); setErr('');
    } catch (e: any) { setErr(e.message); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof typeof filters, v: string) => setFilters(f => ({ ...f, [k]: v }));

  return (
    <>
      <PageHead title="Audit log" sub="Every change, sign-in and refused request. Passwords, secret values and tokens are never recorded.">
        <a className="btn small" href={`/api/audit/export?${query()}`}>Export CSV</a>
      </PageHead>
      <Retention onCleared={() => load()} />
      <form className="c-filters" onSubmit={e => { e.preventDefault(); load(); }}>
        <div className="fld"><label htmlFor="a-actor">Who</label><input id="a-actor" type="text" value={filters.actor} onChange={e => set('actor', e.target.value)} placeholder="username" /></div>
        <div className="fld"><label htmlFor="a-env">Server</label><select id="a-env" value={filters.environment} onChange={e => set('environment', e.target.value)}><option value="">Any</option><option value="production">Production</option><option value="test">Test</option><option value="development">Development</option></select></div>
        <div className="fld"><label htmlFor="a-proj">Project</label><select id="a-proj" value={filters.projectId} onChange={e => setFilters(f => ({ ...f, projectId: e.target.value, sutraId: '' }))}><option value="">All projects</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
        <div className="fld"><label htmlFor="a-sutra">Sutra</label><select id="a-sutra" value={filters.sutraId} disabled={!filters.projectId} onChange={e => set('sutraId', e.target.value)}><option value="">{filters.projectId ? 'All Sutras' : 'Choose a project first'}</option>{sutras.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div className="fld"><label htmlFor="a-out">Result</label><select id="a-out" value={filters.outcome} onChange={e => set('outcome', e.target.value)}><option value="">Any</option><option value="ok">Done</option><option value="failed">Failed</option><option value="denied">Refused</option></select></div>
        <div className="fld"><label htmlFor="a-q">Contains</label><input id="a-q" type="text" value={filters.q} onChange={e => set('q', e.target.value)} placeholder="name, id, path" /></div>
        <div className="fld"><label htmlFor="a-from">From</label><input id="a-from" type="date" className="inp" value={filters.from} onChange={e => set('from', e.target.value)} /></div>
        <div className="fld"><label htmlFor="a-to">To</label><input id="a-to" type="date" className="inp" value={filters.to} onChange={e => set('to', e.target.value)} /></div>
        <button className="btn primary small" type="submit">Search</button>
      </form>
      <Err text={err} />
      {!rows.length && !err && <Empty title="No entries">Nothing matches these filters.</Empty>}
      {!!rows.length && (
        <div className="c-tablewrap"><table className="t c-table">
          <thead><tr><th>When</th><th>Where</th><th>Who</th><th>What</th><th>Project</th><th>Sutra</th><th>Result</th><th>From</th></tr></thead>
          <tbody>{rows.map(r => (
            <Fragment key={r.id}>
              <tr className="click" tabIndex={0} onClick={() => setOpen(open === r.id ? null : r.id)} onKeyDown={e => { if (e.key === 'Enter') setOpen(open === r.id ? null : r.id); }}>
                <td className="nowrap">{when(r.at)}</td>
                <td>{r.environment ? <span className={`c-env c-env-${r.environment}`}>{r.environment}</span> : <span className="muted">-</span>}{r.origin && <div className={`c-origin ${r.origin === 'deployed' ? 'is-deployed' : ''}`}>{r.origin}</div>}{r.engine && <div className="mono xs muted">{r.engine}</div>}</td>
                <td><strong>{r.actor}</strong>{r.actorKind && r.actorKind !== 'user' && <span className="muted xs"> {r.actorKind === 'system' ? 'system account' : r.actorKind}</span>}</td>
                <td>{describe(r.action)}{!r.sutraId && r.target && !/^id=/.test(r.target) && <div className="mono xs muted">{r.target}</div>}</td>
                <td><NameId name={r.projectName} id={r.projectId} /></td>
                <td><NameId name={r.sutraName} id={r.sutraId} /></td>
                <td>{r.outcome === 'ok' ? <State kind="ok">done</State> : r.outcome === 'denied' ? <State kind="warn">refused</State> : <State kind="err">failed</State>}</td>
                <td className="mono xs">{r.ip}</td>
              </tr>
              {open === r.id && <tr className="c-detail"><td colSpan={8}><pre className="c-code">{JSON.stringify({ action: r.action, status: r.status, project: r.projectId ? { name: r.projectName || undefined, id: r.projectId } : undefined, sutra: r.sutraId || r.sutraName ? { name: r.sutraName || undefined, id: r.sutraId || undefined } : undefined, target: r.target || undefined, details: r.details ?? undefined }, null, 2)}</pre></td></tr>}
            </Fragment>
          ))}</tbody>
        </table></div>
      )}
      {more && <div className="c-actions"><button className="btn" onClick={() => load(true)}>Load older entries</button></div>}
    </>
  );
}
