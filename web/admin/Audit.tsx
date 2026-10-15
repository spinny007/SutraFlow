import { Fragment, useEffect, useState } from 'react';
import { get } from '../src/api';
import { PageHead, State, Err, Empty, when } from './shared';

interface Entry { id: number; at: string; actor: string; actorKind: string; ip: string; action: string; target: string; projectId: string; status: number; outcome: 'ok' | 'denied' | 'failed'; details: any }

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
  'POST /api/engine/drain': 'Stopped an engine', 'POST /api/engine/housekeeping': 'Deleted old runs',
};
const describe = (a: string) => ACTIONS[a] || a;

/** Who did what, when, from where: searchable and exportable. */
export function Audit() {
  const [filters, setFilters] = useState({ actor: '', outcome: '', q: '', from: '', to: '' });
  const [rows, setRows] = useState<Entry[]>([]);
  const [more, setMore] = useState(false);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const query = (before?: number) => {
    const p = new URLSearchParams();
    if (filters.actor) p.set('actor', filters.actor);
    if (filters.outcome) p.set('outcome', filters.outcome);
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
      <form className="c-filters" onSubmit={e => { e.preventDefault(); load(); }}>
        <div className="fld"><label htmlFor="a-actor">Who</label><input id="a-actor" type="text" value={filters.actor} onChange={e => set('actor', e.target.value)} placeholder="username" /></div>
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
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>Target</th><th>Result</th><th>From</th></tr></thead>
          <tbody>{rows.map(r => (
            <Fragment key={r.id}>
              <tr className="click" tabIndex={0} onClick={() => setOpen(open === r.id ? null : r.id)} onKeyDown={e => { if (e.key === 'Enter') setOpen(open === r.id ? null : r.id); }}>
                <td className="nowrap">{when(r.at)}</td>
                <td><strong>{r.actor}</strong>{r.actorKind && r.actorKind !== 'user' && <span className="muted xs"> {r.actorKind === 'system' ? 'system account' : r.actorKind}</span>}</td>
                <td>{describe(r.action)}</td>
                <td className="mono xs">{r.target}</td>
                <td>{r.outcome === 'ok' ? <State kind="ok">done</State> : r.outcome === 'denied' ? <State kind="warn">refused</State> : <State kind="err">failed</State>}</td>
                <td className="mono xs">{r.ip}</td>
              </tr>
              {open === r.id && <tr className="c-detail"><td colSpan={6}><pre className="c-code">{JSON.stringify({ action: r.action, status: r.status, project: r.projectId || undefined, details: r.details ?? undefined }, null, 2)}</pre></td></tr>}
            </Fragment>
          ))}</tbody>
        </table></div>
      )}
      {more && <div className="c-actions"><button className="btn" onClick={() => load(true)}>Load older entries</button></div>}
    </>
  );
}
