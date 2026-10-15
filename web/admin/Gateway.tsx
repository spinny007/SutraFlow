import { Fragment, useCallback, useState } from 'react';
import { get } from '../src/api';
import { useToast } from '../src/ui';
import { PageHead, State, Err, Empty, Confirm, useLoad, useEvery, ago, when } from './shared';
import { act, type Action } from './log';
import { Drawer } from './Apps';

/** Gateway pages: traffic and request log, apps and keys, plans, firewall, APIs. */

const fmt = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(n));
const pctText = (x: number) => `${(x * 100).toFixed(x > 0 && x < 0.01 ? 2 : 1)}%`;
const statusState = (s: number) => (s >= 500 ? 'err' : s >= 400 ? 'warn' : 'ok') as 'err' | 'warn' | 'ok';

// ---------- Traffic ----------

interface Stats {
  period: string; bucketMs: number;
  totals: { requests: number; errors: number; refused: number; errorRate: number; p50Ms: number; p95Ms: number; p99Ms: number };
  timeline: { at: string; requests: number; errors: number; refused: number }[];
  byStatus: Record<string, number>;
  topServices: Row[]; slowestServices: Row[]; topApps: Row[];
}
interface Row { name: string; requests: number; errors: number; avgMs: number; p95Ms: number }

/** Requests per time bucket: answered, refused (4xx) and errors (5xx) stacked; drawn to one scale. */
function TrafficChart({ s }: { s: Stats }) {
  const W = 960, H = 220, L = 46, B = 26, T = 10;
  const max = Math.max(1, ...s.timeline.map(b => b.requests));
  const nice = (() => { const p = 10 ** Math.floor(Math.log10(max)); const m = max / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; })();
  const y = (v: number) => T + (H - T - B) * (1 - v / nice);
  const bw = (W - L - 8) / s.timeline.length;
  const label = (iso: string) => { const d = new Date(iso); return s.bucketMs >= 86400e3 ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : s.bucketMs >= 3600e3 && s.period !== '24h' ? d.toLocaleString(undefined, { weekday: 'short', hour: '2-digit' }) : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); };
  const ticks = [0, nice / 2, nice];
  const every = Math.max(1, Math.ceil(s.timeline.length / 8));
  return (
    <div className="c-chartwrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="c-chart" role="img" aria-label={`Requests over time: ${s.totals.requests} in total`}>
        {ticks.map(t => <g key={t}><line x1={L} x2={W - 4} y1={y(t)} y2={y(t)} className="c-grid" /><text x={L - 6} y={y(t) + 4} className="c-axis" textAnchor="end">{fmt(t)}</text></g>)}
        {s.timeline.map((b, i) => {
          const x = L + 2 + i * bw, w = Math.max(1, bw - 2);
          const ok = b.requests - b.errors - b.refused;
          return (
            <g key={b.at}>
              <title>{`${new Date(b.at).toLocaleString()}: ${b.requests} requests, ${b.refused} refused, ${b.errors} errors`}</title>
              {ok > 0 && <rect x={x} width={w} y={y(b.requests)} height={y(b.refused + b.errors) - y(b.requests)} className="c-bar ok" />}
              {b.refused > 0 && <rect x={x} width={w} y={y(b.refused + b.errors)} height={y(b.errors) - y(b.refused + b.errors)} className="c-bar warn" />}
              {b.errors > 0 && <rect x={x} width={w} y={y(b.errors)} height={y(0) - y(b.errors)} className="c-bar err" />}
              {i % every === 0 && <text x={x + w / 2} y={H - 8} className="c-axis" textAnchor="middle">{label(b.at)}</text>}
            </g>
          );
        })}
      </svg>
      <div className="c-legend"><span><i className="ok" />answered</span><span><i className="warn" />refused (4xx)</span><span><i className="err" />errors (5xx)</span></div>
    </div>
  );
}

function RowsTable({ title, rows, empty }: { title: string; rows: Row[]; empty: string }) {
  return (
    <section className="c-section c-half">
      <h2>{title}</h2>
      {rows.length ? (
        <div className="c-tablewrap"><table className="t c-table">
          <thead><tr><th>Name</th><th className="right">Requests</th><th className="right">4xx/5xx</th><th className="right">Avg</th><th className="right">p95</th></tr></thead>
          <tbody>{rows.map(r => <tr key={r.name}><td><strong>{r.name}</strong></td><td className="right">{fmt(r.requests)}</td><td className={`right${r.errors ? ' c-bad' : ''}`}>{r.errors}</td><td className="right">{r.avgMs} ms</td><td className="right">{r.p95Ms} ms</td></tr>)}</tbody>
        </table></div>
      ) : <p className="muted">{empty}</p>}
    </section>
  );
}

export function Traffic() {
  const [period, setPeriod] = useState('24h');
  const { data: s, error, reload } = useLoad<Stats>(`/api/gateway/stats?period=${period}`, [period]);
  useEvery(useCallback(() => { reload(); }, [reload]), 15000);
  return (
    <>
      <PageHead title="Traffic" sub="Requests to deployed services through the gateway, from every engine.">
        <div className="c-seg" role="group" aria-label="Period">
          {['1h', '24h', '7d', '30d'].map(p => <button key={p} className={period === p ? 'act' : ''} aria-pressed={period === p} onClick={() => setPeriod(p)}>{p}</button>)}
        </div>
        <button className="btn small" onClick={reload}>Refresh</button>
      </PageHead>
      <Err text={error} />
      {s && (
        <>
          <div className="c-tiles">
            <div className="c-tile static ok"><span className="c-tile-label">Requests</span><span className="c-tile-value">{fmt(s.totals.requests)}</span><span className="c-tile-note">in the last {period}</span></div>
            <div className={`c-tile static ${s.totals.errors ? 'err' : 'ok'}`}><span className="c-tile-label">Errors (5xx)</span><span className="c-tile-value">{pctText(s.totals.errorRate)}</span><span className="c-tile-note">{s.totals.errors} requests</span></div>
            <div className={`c-tile static ${s.totals.refused ? 'warn' : 'ok'}`}><span className="c-tile-label">Refused (4xx)</span><span className="c-tile-value">{fmt(s.totals.refused)}</span><span className="c-tile-note">keys, scopes, limits, firewall</span></div>
            <div className="c-tile static"><span className="c-tile-label">Latency p50 / p95</span><span className="c-tile-value">{s.totals.p50Ms || '<1'}<small> / {s.totals.p95Ms || '<1'} ms</small></span><span className="c-tile-note">p99 {s.totals.p99Ms} ms</span></div>
          </div>
          <section className="c-section c-project"><TrafficChart s={s} /></section>
          <div className="c-halves">
            <RowsTable title="Busiest services" rows={s.topServices} empty="No requests in this period." />
            <RowsTable title="Slowest services (p95)" rows={s.slowestServices} empty="No requests in this period." />
            <RowsTable title="Apps" rows={s.topApps} empty="No requests from gateway apps in this period." />
            <section className="c-section c-half"><h2>Status codes</h2>
              {Object.keys(s.byStatus).length ? <div className="c-chips">{Object.entries(s.byStatus).sort().map(([k, v]) => <span key={k} className="c-chip"><State kind={k.startsWith('5') ? 'err' : k.startsWith('4') ? 'warn' : 'ok'}>{k}</State>{fmt(v)}</span>)}</div> : <p className="muted">No requests in this period.</p>}
            </section>
          </div>
        </>
      )}
      <RequestLog />
    </>
  );
}

function RequestLog() {
  const [f, setF] = useState({ status: '', q: '' });
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const load = async (more = false) => {
    const p = new URLSearchParams({ limit: '100', ...(f.status ? { status: f.status } : {}), ...(f.q ? { q: f.q } : {}), ...(more && rows?.length ? { before: String(rows[rows.length - 1].id) } : {}) });
    try { const r = await get<any[]>(`/api/gateway/requests?${p}`); setRows(more && rows ? [...rows, ...r] : r); setErr(''); } catch (e: any) { setErr(e.message); }
  };
  if (rows === null && !err) load();
  return (
    <section className="c-section">
      <h2>Request log</h2>
      <form className="c-filters" onSubmit={e => { e.preventDefault(); load(); }}>
        <select className="inp" aria-label="Result" value={f.status} onChange={e => setF({ ...f, status: e.target.value })}>
          <option value="">All results</option><option value="ok">Answered</option><option value="refused">Refused (4xx)</option><option value="errors">Errors (5xx)</option>
        </select>
        <input className="inp" type="search" placeholder="Path, caller or error" aria-label="Path, caller or error" value={f.q} onChange={e => setF({ ...f, q: e.target.value })} />
        <button className="btn small primary" type="submit">Search</button>
      </form>
      <Err text={err} />
      {rows && !rows.length && <Empty title="No requests">Requests to deployed services appear here, newest first.</Empty>}
      {!!rows?.length && (
        <div className="c-tablewrap"><table className="t c-table">
          <thead><tr><th>When</th><th>Status</th><th>Request</th><th>Service</th><th>Caller</th><th className="right">Time</th><th>From</th></tr></thead>
          <tbody>{rows.map(r => (
            <Fragment key={r.id}>
              <tr className="click" tabIndex={0} onClick={() => setOpen(open === r.id ? null : r.id)} onKeyDown={e => { if (e.key === 'Enter') setOpen(open === r.id ? null : r.id); }}>
                <td className="nowrap" title={when(r.at)}>{ago(r.at)}</td>
                <td><State kind={statusState(r.status)}>{r.status}</State></td>
                <td className="mono xs c-wrap">{r.method} {r.path}</td>
                <td>{r.route}</td>
                <td>{r.app ? <strong>{r.app}</strong> : r.caller}</td>
                <td className="right nowrap">{r.ms} ms</td>
                <td className="mono xs">{r.ip}</td>
              </tr>
              {open === r.id && <tr className="c-detail"><td colSpan={7}><pre className="c-code">{JSON.stringify({ engine: r.engine, kind: r.kind, error: r.error || undefined, run: r.runId || undefined, bytesIn: r.bytesIn, bytesOut: r.bytesOut, at: r.at }, null, 2)}</pre></td></tr>}
            </Fragment>
          ))}</tbody>
        </table></div>
      )}
      {rows && rows.length >= 100 && rows.length % 100 === 0 && <div className="c-actions"><button className="btn" onClick={() => load(true)}>Load older requests</button></div>}
    </section>
  );
}

// ---------- Apps ----------

interface AppRow { id: string; name: string; description: string; contact: string; planId: string; scopes: string[]; disabled: boolean; createdAt: string; keys: number; lastUsed: string | null; usage: Record<string, number> }
interface PlanRow { id: string; name: string; description: string; perMinute: number; perHour: number; perDay: number; perMonth: number; apps: number }

export function GwApps() {
  const toast = useToast();
  const apps = useLoad<AppRow[]>('/api/gateway/apps');
  const plans = useLoad<PlanRow[]>('/api/gateway/plans');
  const [edit, setEdit] = useState<AppRow | 'new' | null>(null);
  const planName = (id: string) => plans.data?.find(p => p.id === id)?.name || '';
  return (
    <>
      <PageHead title="Apps" sub="Consumers of your APIs. A service whose API security policy uses Gateway apps accepts an app's key, or an access token from /oauth/token, when the app holds the scopes it needs.">
        <button className="btn primary small" onClick={() => setEdit('new')}>Add app</button>
      </PageHead>
      <Err text={apps.error} />
      {apps.data && !apps.data.length && <Empty title="No apps yet">Add one per partner, mobile app or team, so each can have its own keys, scopes and limits, and be turned off on its own.</Empty>}
      {!!apps.data?.length && (
        <div className="c-tablewrap"><table className="t c-table">
          <thead><tr><th>App</th><th>State</th><th>Plan</th><th>Scopes</th><th className="right">Today</th><th>Last call</th><th /></tr></thead>
          <tbody>{apps.data.map(a => (
            <tr key={a.id} className="click" tabIndex={0} onClick={() => setEdit(a)} onKeyDown={e => { if (e.key === 'Enter') setEdit(a); }}>
              <td><strong>{a.name}</strong><div className="muted xs mono">{a.id}</div></td>
              <td>{a.disabled ? <State kind="idle">disabled</State> : a.keys ? <State kind="ok">active</State> : <State kind="warn">no key</State>}</td>
              <td>{planName(a.planId) || <span className="muted">no limit</span>}</td>
              <td>{a.scopes.map(s => <span key={s} className="c-grant mono xs">{s}</span>)}</td>
              <td className="right">{fmt(a.usage?.day || 0)}</td>
              <td className="nowrap muted">{a.lastUsed ? ago(a.lastUsed) : 'never'}</td>
              <td className="right"><button className="btn small" onClick={e => { e.stopPropagation(); setEdit(a); }}>Open</button></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {edit && <AppDrawer app={edit === 'new' ? null : edit} plans={plans.data || []} onClose={() => setEdit(null)} onSaved={(a, msg) => { toast(msg); apps.reload(); setEdit(a); }} />}
    </>
  );
}

function AppDrawer({ app, plans, onClose, onSaved }: { app: AppRow | null; plans: PlanRow[]; onClose(): void; onSaved(a: AppRow | null, msg: string): void }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: app?.name || '', description: app?.description || '', contact: app?.contact || '', planId: app?.planId || '', scopes: (app?.scopes || []).join(' '), disabled: !!app?.disabled });
  const [err, setErr] = useState('');
  const [confirm, setConfirm] = useState<{ title: string; text: string; action: string; danger?: boolean; cmd: Action; done(): void } | null>(null);
  const body = { ...form, scopes: form.scopes.split(/[\s,]+/).filter(Boolean) };
  const planName = plans.find(p => p.id === form.planId)?.name;
  const save = async () => {
    try {
      const r = app
        ? await act<AppRow>({ label: `Change app ${form.name}`, method: 'PUT', url: `/api/gateway/apps/${app.id}`, body })
        : await act<AppRow>({ label: `Add app ${form.name}`, method: 'POST', url: '/api/gateway/apps', body, cli: ['gateway', 'app', 'add', form.name, ...(body.scopes.length ? ['--scopes', body.scopes.join(' ')] : []), ...(planName ? ['--plan', planName] : []), ...(form.contact ? ['--contact', form.contact] : [])] });
      onSaved({ ...r, keys: app?.keys || 0, lastUsed: app?.lastUsed || null, usage: app?.usage || {} } as AppRow, app ? 'Saved' : `App ${r.name} added`);
    } catch (e: any) { setErr(e.message); }
  };
  return (
    <Drawer title={app ? app.name : 'Add app'} sub={app ? <>Client id <code>{app.id}</code> · added {when(app.createdAt)}</> : undefined} onClose={onClose}>
      <Err text={err} />
      <div className="c-form">
        <div className="fld"><label htmlFor="ga-n">Name</label><input id="ga-n" type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
        <div className="fld"><label htmlFor="ga-d">Description</label><input id="ga-d" type="text" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
        <div className="fld"><label htmlFor="ga-c">Contact</label><input id="ga-c" type="text" value={form.contact} placeholder="Who to call when it misbehaves" onChange={e => setForm({ ...form, contact: e.target.value })} /></div>
        <div className="fld"><label htmlFor="ga-s">Scopes</label><input id="ga-s" type="text" className="mono" value={form.scopes} placeholder="orders:read orders:write" onChange={e => setForm({ ...form, scopes: e.target.value })} /><div className="hint">What the app may do. A service's policy names the scopes it requires.</div></div>
        <div className="fld"><label htmlFor="ga-p">Plan</label>
          <select id="ga-p" value={form.planId} onChange={e => setForm({ ...form, planId: e.target.value })}><option value="">No limit</option>{plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
        {app && <label className="c-check"><input type="checkbox" checked={form.disabled} onChange={e => setForm({ ...form, disabled: e.target.checked })} /> Disabled: its keys and tokens are refused</label>}
        <div className="c-actions">
          <button className="btn primary" disabled={!form.name.trim()} onClick={save}>{app ? 'Save' : 'Add app'}</button>
          {app && <button className="btn c-danger-soft" onClick={() => setConfirm({ title: `Delete ${app.name}`, text: 'The app, its keys and its usage are deleted. Calls with its keys are refused at once.', action: 'Delete', danger: true,
            cmd: { label: `Delete app ${app.name}`, method: 'DELETE', url: `/api/gateway/apps/${app.id}`, cli: ['gateway', 'app', 'delete', app.name] }, done: () => onSaved(null, 'App deleted') })}>Delete app</button>}
        </div>
      </div>
      {app && <AppKeys app={app} />}
      {app && (
        <section className="c-section">
          <h3>Usage now</h3>
          <div className="c-chips">{['minute', 'hour', 'day', 'month'].map(w => <span key={w} className="c-chip"><span className="muted xs">this {w}</span><strong>{fmt(app.usage?.[w] || 0)}</strong></span>)}</div>
        </section>
      )}
      {confirm && <Confirm title={confirm.title} text={confirm.text} action={confirm.action} danger={confirm.danger} cmd={confirm.cmd}
        onYes={async () => { await act(confirm.cmd); confirm.done(); toast('Done'); }} onClose={() => setConfirm(null)} />}
    </Drawer>
  );
}

function AppKeys({ app }: { app: AppRow }) {
  const toast = useToast();
  const list = useLoad<{ id: string; name: string; createdAt: string; expiresAt: string | null; lastUsed: string | null; expired: boolean }[]>(`/api/gateway/apps/${app.id}/keys`);
  const [name, setName] = useState('');
  const [days, setDays] = useState('365');
  const [shown, setShown] = useState<string | null>(null);
  const [revoke, setRevoke] = useState<{ id: string; name: string } | null>(null);
  const revokeCmd = (k: { id: string; name: string }): Action => ({ label: `Revoke key ${k.name} of ${app.name}`, method: 'DELETE', url: `/api/gateway/apps/${app.id}/keys/${k.id}`, cli: ['gateway', 'key', 'revoke', app.name, k.id] });
  const create = async () => {
    try {
      const r = await act<{ key: string }>({ label: `Create a key for ${app.name}`, method: 'POST', url: `/api/gateway/apps/${app.id}/keys`, body: { name: name || 'key', expiresDays: Number(days) || 0 }, cli: ['gateway', 'key', 'create', app.name, '--name', name || 'key', '--expires-days', String(Number(days) || 0)] });
      setShown(r.key); setName(''); list.reload();
    } catch (e: any) { toast(e.message, true); }
  };
  const copy = async (t: string) => { try { await navigator.clipboard.writeText(t); toast('Copied'); } catch { toast('Select the text and copy it', true); } };
  const origin = `${location.protocol}//${location.hostname}`;
  return (
    <section className="c-section">
      <h3>Keys</h3>
      <p className="muted xs">Send a key as <code>X-API-Key</code> (or the policy's key header), or use it as the client secret for <code>POST /oauth/token</code> with client id <code>{app.id}</code>.</p>
      {shown && (
        <div className="c-shown" role="status">
          <strong>Copy this key now. It is not shown again.</strong>
          <div className="c-inline"><input className="inp mono" readOnly value={shown} onFocus={e => e.currentTarget.select()} aria-label="New key" /><button className="btn small" onClick={() => copy(shown)}>Copy</button><button className="btn small" onClick={() => setShown(null)}>Done</button></div>
          <p className="muted xs">An access token for an hour (gateway address and port as deployed):</p>
          <pre className="c-code">{`curl -X POST ${origin}:<gateway port>/oauth/token -d grant_type=client_credentials -d client_id=${app.id} -d client_secret=<this key>`}</pre>
        </div>
      )}
      <div className="c-inline c-newtoken">
        <input className="inp" type="text" placeholder="Name, such as production" aria-label="Key name" value={name} onChange={e => setName(e.target.value)} />
        <select className="inp" aria-label="Expires" value={days} onChange={e => setDays(e.target.value)}>
          <option value="90">Expires in 90 days</option><option value="365">Expires in 1 year</option><option value="0">Never expires</option>
        </select>
        <button className="btn small primary" onClick={create}>Create key</button>
      </div>
      <Err text={list.error} />
      {!!list.data?.length && (
        <div className="c-tablewrap"><table className="t c-table">
          <thead><tr><th>Name</th><th>Created</th><th>Expires</th><th>Last used</th><th /></tr></thead>
          <tbody>{list.data.map(k => (
            <tr key={k.id}>
              <td><strong>{k.name}</strong> <span className="muted xs mono">sfk_{k.id}</span></td>
              <td className="nowrap">{when(k.createdAt)}</td>
              <td className="nowrap">{k.expired ? <State kind="err">expired</State> : k.expiresAt ? when(k.expiresAt) : 'never'}</td>
              <td className="nowrap muted">{k.lastUsed ? ago(k.lastUsed) : 'never'}</td>
              <td className="right"><button className="btn small c-danger-soft" onClick={() => setRevoke(k)}>Revoke</button></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {revoke && <Confirm title={`Revoke ${revoke.name}`} text="Calls with this key are refused from now on; tokens already made with it keep working until they expire (an hour at most)." action="Revoke" danger cmd={revokeCmd(revoke)}
        onYes={async () => { await act(revokeCmd(revoke)); toast('Key revoked'); list.reload(); }} onClose={() => setRevoke(null)} />}
    </section>
  );
}

// ---------- Plans ----------

const LIMITS: [keyof PlanRow, string, string][] = [['perMinute', 'Per minute', 'per-minute'], ['perHour', 'Per hour', 'per-hour'], ['perDay', 'Per day', 'per-day'], ['perMonth', 'Per month', 'per-month']];

export function Plans() {
  const toast = useToast();
  const plans = useLoad<PlanRow[]>('/api/gateway/plans');
  const [edit, setEdit] = useState<PlanRow | 'new' | null>(null);
  return (
    <>
      <PageHead title="Plans" sub="Request limits for apps. Every engine counts in the same place, and a full window answers 429 with Retry-After. Windows are calendar minutes, hours, days and months in UTC; 0 means no limit.">
        <button className="btn primary small" onClick={() => setEdit('new')}>New plan</button>
      </PageHead>
      <Err text={plans.error} />
      {plans.data && !plans.data.length && <Empty title="No plans yet">Apps without a plan have no limit. Make plans such as Trial, Partner and Internal.</Empty>}
      {!!plans.data?.length && (
        <div className="c-tablewrap"><table className="t c-table">
          <thead><tr><th>Plan</th>{LIMITS.map(([, l]) => <th key={l} className="right">{l}</th>)}<th className="right">Apps</th></tr></thead>
          <tbody>{plans.data.map(p => (
            <tr key={p.id} className="click" tabIndex={0} onClick={() => setEdit(p)} onKeyDown={e => { if (e.key === 'Enter') setEdit(p); }}>
              <td><strong>{p.name}</strong><div className="muted xs">{p.description}</div></td>
              {LIMITS.map(([k]) => <td key={k} className="right">{Number(p[k]) ? fmt(Number(p[k])) : <span className="muted">-</span>}</td>)}
              <td className="right">{p.apps}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {edit && <PlanDrawer plan={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={msg => { toast(msg); plans.reload(); setEdit(null); }} />}
    </>
  );
}

function PlanDrawer({ plan, onClose, onSaved }: { plan: PlanRow | null; onClose(): void; onSaved(msg: string): void }) {
  const [form, setForm] = useState<Record<string, string>>({ name: plan?.name || '', description: plan?.description || '', ...Object.fromEntries(LIMITS.map(([k]) => [k, String(plan?.[k] || '')])) });
  const [err, setErr] = useState('');
  const [confirm, setConfirm] = useState<Action | null>(null);
  const body = { name: form.name, description: form.description, ...Object.fromEntries(LIMITS.map(([k]) => [k, Number(form[k]) || 0])) };
  const cli = ['gateway', 'plan', 'set', form.name, ...LIMITS.flatMap(([k, , f]) => [`--${f}`, String(Number(form[k]) || 0)])];
  const save = async () => {
    try { await act(plan ? { label: `Change plan ${form.name}`, method: 'PUT', url: `/api/gateway/plans/${plan.id}`, body, cli } : { label: `Add plan ${form.name}`, method: 'POST', url: '/api/gateway/plans', body, cli }); onSaved(plan ? 'Plan saved' : 'Plan added'); } catch (e: any) { setErr(e.message); }
  };
  return (
    <Drawer title={plan ? plan.name : 'New plan'} sub={plan ? `${plan.apps} apps use it` : undefined} onClose={onClose}>
      <Err text={err} />
      <div className="c-form">
        <div className="fld"><label htmlFor="gp-n">Name</label><input id="gp-n" type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
        <div className="fld"><label htmlFor="gp-d">Description</label><input id="gp-d" type="text" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
        <div className="c-tuninggrid">
          {LIMITS.map(([k, l]) => <div key={k} className="fld"><label htmlFor={`gp-${k}`}>{l} <span className="muted xs">(requests)</span></label><input id={`gp-${k}`} type="number" min={0} step={1} value={form[k]} placeholder="no limit" onChange={e => setForm({ ...form, [k]: e.target.value })} /></div>)}
        </div>
        <div className="c-actions">
          <button className="btn primary" disabled={!form.name.trim()} onClick={save}>{plan ? 'Save' : 'Add plan'}</button>
          {plan && <button className="btn c-danger-soft" onClick={() => setConfirm({ label: `Delete plan ${plan.name}`, method: 'DELETE', url: `/api/gateway/plans/${plan.id}`, cli: ['gateway', 'plan', 'delete', plan.name] })}>Delete plan</button>}
        </div>
      </div>
      {confirm && <Confirm title={`Delete ${plan?.name}`} text="Apps must use another plan first." action="Delete" danger cmd={confirm}
        onYes={async () => { await act(confirm); onSaved('Plan deleted'); }} onClose={() => setConfirm(null)} />}
    </Drawer>
  );
}

// ---------- Firewall ----------

export function Firewall() {
  const toast = useToast();
  const fw = useLoad<{ allow: string[]; deny: string[] }>('/api/gateway/firewall');
  const [form, setForm] = useState<{ allow: string; deny: string } | null>(null);
  const [confirm, setConfirm] = useState<Action | null>(null);
  const cur = form ?? (fw.data ? { allow: fw.data.allow.join('\n'), deny: fw.data.deny.join('\n') } : null);
  const lines = (t: string) => t.split(/[\n,]+/).map(x => x.trim()).filter(Boolean);
  if (!cur) return <><PageHead title="Firewall" /><Err text={fw.error} /></>;
  const body = { allow: lines(cur.allow), deny: lines(cur.deny) };
  return (
    <>
      <PageHead title="Firewall" sub="Addresses the whole gateway serves: every REST, SOAP and MCP service and the token endpoint. Applied by every engine within two seconds." />
      <div className="c-halves">
        <section className="c-section c-project c-half">
          <h2>Allow only</h2>
          <p className="muted xs">One address or range per line, such as 10.0.0.0/8. Empty: every address may call (policies still apply).</p>
          <textarea className="inp mono c-iplist" aria-label="Allowed addresses" value={cur.allow} onChange={e => setForm({ ...cur, allow: e.target.value })} />
        </section>
        <section className="c-section c-project c-half">
          <h2>Deny</h2>
          <p className="muted xs">Always refused with 403, even when also allowed.</p>
          <textarea className="inp mono c-iplist" aria-label="Denied addresses" value={cur.deny} onChange={e => setForm({ ...cur, deny: e.target.value })} />
        </section>
      </div>
      <div className="c-actions">
        <button className="btn primary" disabled={!form} onClick={() => setConfirm({ label: 'Change the gateway firewall', method: 'PUT', url: '/api/gateway/firewall', body, cli: ['gateway', 'firewall', '--allow', body.allow.join(','), '--deny', body.deny.join(',')] })}>Save firewall</button>
        {form && <button className="btn" onClick={() => setForm(null)}>Undo changes</button>}
      </div>
      {confirm && <Confirm title="Save firewall" action="Save" cmd={confirm}
        text={<>Allow: {body.allow.join(', ') || 'every address'}. Deny: {body.deny.join(', ') || 'none'}. Check that your own callers stay allowed.</>}
        onYes={async () => { await act(confirm); toast('Firewall saved'); setForm(null); fw.reload(); }} onClose={() => setConfirm(null)} />}
    </>
  );
}

// ---------- APIs ----------

export function Apis() {
  const toast = useToast();
  const d = useLoad<{ routes: any[]; options: { logRequests: boolean; logDays: number; publishOpenApi: boolean }; gateway: { httpPort: number; httpsPort: number } }>('/api/gateway/apis');
  const [confirm, setConfirm] = useState<Action | null>(null);
  const opts = d.data?.options;
  const set = (o: Partial<NonNullable<typeof opts>>, label: string) => setConfirm({ label, method: 'PUT', url: '/api/gateway/options', body: o });
  return (
    <>
      <PageHead title="APIs" sub="Deployed services on the gateway with their security policy.">
        <a className="btn small" href="/api/gateway/openapi" target="_blank" rel="noopener">OpenAPI (JSON)</a>
      </PageHead>
      <Err text={d.error} />
      {d.data && !d.data.routes.length && <Empty title="Nothing is served">Deploy a Sutra that starts with a REST service, SOAP service or MCP skill.</Empty>}
      {!!d.data?.routes.length && (
        <div className="c-tablewrap"><table className="t c-table">
          <thead><tr><th>Kind</th><th>Address</th><th>Sutra</th><th>Policy</th><th>URL</th></tr></thead>
          <tbody>{d.data.routes.map((r, i) => (
            <tr key={i}>
              <td><span className="c-trig">{r.kind === 'mcp' ? 'MCP' : r.kind === 'soap' ? 'SOAP' : 'REST'}</span></td>
              <td className="mono xs">{r.method} {r.path}{r.tool ? ` · ${r.tool}` : ''}</td>
              <td>{r.flow} <span className="muted xs">v{r.version}</span></td>
              <td>{r.policy ? r.policy : <State kind="warn">open</State>}</td>
              <td className="mono xs c-wrap">{r.urls[0]}{r.wsdl && <> · <a href={r.urls[0] + '?wsdl'} target="_blank" rel="noopener">WSDL</a></>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {opts && (
        <section className="c-section c-project">
          <h2>Gateway options</h2>
          <label className="c-check"><input type="checkbox" checked={opts.publishOpenApi} onChange={e => set({ publishOpenApi: e.target.checked }, e.target.checked ? 'Publish OpenAPI on the gateway' : 'Stop publishing OpenAPI')} />
            <span>Publish OpenAPI at <code>/openapi.json</code> on the gateway <span className="muted xs">(anyone who reaches the gateway can read the list of services)</span></span></label>
          <label className="c-check"><input type="checkbox" checked={opts.logRequests} onChange={e => set({ logRequests: e.target.checked }, e.target.checked ? 'Turn the request log on' : 'Turn the request log off')} />
            <span>Record every request in the request log <span className="muted xs">(Traffic and statistics need it)</span></span></label>
          <div className="c-inline">
            <label htmlFor="go-days" className="muted xs">Keep the request log for</label>
            <select id="go-days" className="inp" value={String(opts.logDays)} onChange={e => set({ logDays: Number(e.target.value) }, `Keep the request log for ${e.target.value} days`)}>
              {[3, 7, 14, 30, 90, 365].map(n => <option key={n} value={n}>{n} days</option>)}
            </select>
          </div>
        </section>
      )}
      {confirm && <Confirm title={confirm.label} action="Save" cmd={confirm} text="Applies on every engine within a few seconds."
        onYes={async () => { await act(confirm); toast('Saved'); d.reload(); }} onClose={() => setConfirm(null)} />}
    </>
  );
}
