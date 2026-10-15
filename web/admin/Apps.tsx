import { useCallback, useState } from 'react';
import { get, post, put } from '../src/api';
import { useToast } from '../src/ui';
import { PageHead, State, Err, Empty, Confirm, useLoad, useEvery, ago, when, can, useMe, runState } from './shared';

interface SutraApp {
  id: string; name: string; version: number; enabled: boolean; deployedAt: string; lastRun: string | null;
  triggers: { step: string; type: string; name: string; what: string }[];
  runs24h: { done: number; failed: number; running: number };
}
interface ProjectApp { id: string; name: string; package: { version: string; deployedAt: string; deployedBy: string } | null; sutras: SutraApp[] }

/** Deployed projects and their Sutras: start, stop, runs, versions, packages. */
export function Apps() {
  const { me } = useMe();
  const toast = useToast();
  const { data, error, reload } = useLoad<ProjectApp[]>('/api/console/apps');
  useEvery(useCallback(() => { reload(); }, [reload]), 15000);
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<{ project: ProjectApp; sutra: SutraApp } | null>(null);
  const [history, setHistory] = useState<ProjectApp | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; text: string; action: string; danger?: boolean; run(): Promise<void> } | null>(null);

  const toggle = (p: ProjectApp, s: SutraApp) => setConfirm({
    title: s.enabled ? `Stop ${s.name}` : `Start ${s.name}`,
    text: s.enabled ? 'Its triggers stop starting runs (requests get 404, timers and listeners pause). Runs in progress finish. It stays deployed at version ' + s.version + '.' : 'Its triggers start runs again on every engine.',
    action: s.enabled ? 'Stop' : 'Start', danger: s.enabled,
    run: async () => { await put(`/api/console/sutras/${s.id}/enabled`, { enabled: !s.enabled }); toast(`${s.name} ${s.enabled ? 'stopped' : 'started'}`); reload(); },
  });

  const f = filter.trim().toLowerCase();
  const list = (data || []).map(p => ({ ...p, sutras: p.sutras.filter(s => !f || s.name.toLowerCase().includes(f) || p.name.toLowerCase().includes(f) || s.triggers.some(t => t.what.toLowerCase().includes(f))) })).filter(p => p.sutras.length);

  return (
    <>
      <PageHead title="Applications" sub="Deployed projects and their Sutras. Design changes are made in the designer and arrive here by deploying.">
        <input className="inp c-search" type="search" placeholder="Find a Sutra, project or path" aria-label="Find a Sutra, project or path" value={filter} onChange={e => setFilter(e.target.value)} />
        <button className="btn small" onClick={reload}>Refresh</button>
      </PageHead>
      <Err text={error} />
      {data && !data.length && <Empty title="Nothing is deployed yet">Deploy Sutras from the designer, or deploy a package with the sutra command or a Release Sutra.</Empty>}
      {list.map(p => (
        <section key={p.id} className="c-section c-project">
          <div className="c-projhead">
            <div>
              <h2>{p.name}</h2>
              <span className="muted xs">{p.package ? <>Package {p.package.version}, deployed {ago(p.package.deployedAt)} by {p.package.deployedBy || 'unknown'}</> : 'Deployed Sutra by Sutra (no package)'}</span>
            </div>
            <div className="c-actions">
              <button className="btn small" onClick={() => setHistory(p)}>Package history</button>
            </div>
          </div>
          <div className="c-tablewrap"><table className="t c-table">
            <thead><tr><th>Sutra</th><th>State</th><th>Started by</th><th className="right">Runs, 24 h</th><th>Last run</th><th /></tr></thead>
            <tbody>{p.sutras.map(s => (
              <tr key={s.id}>
                <td><button className="btn link c-name" onClick={() => setOpen({ project: p, sutra: s })}>{s.name}</button><span className="muted xs"> v{s.version}</span></td>
                <td>{s.enabled ? <State kind="ok">started</State> : <State kind="warn">stopped</State>}</td>
                <td><div className="c-triggers">{s.triggers.map(t => <span key={t.step} className="c-trig" title={t.step}>{t.name}{t.what && <code>{t.what}</code>}</span>)}</div></td>
                <td className="right nowrap"><span className="c-ok">{s.runs24h.done}</span>{s.runs24h.failed > 0 && <span className="c-bad"> · {s.runs24h.failed} failed</span>}{s.runs24h.running > 0 && <span className="muted"> · {s.runs24h.running} open</span>}</td>
                <td className="nowrap muted">{s.lastRun ? ago(s.lastRun) : 'never'}</td>
                <td className="right nowrap">
                  <button className="btn small" onClick={() => setOpen({ project: p, sutra: s })}>Runs</button>{' '}
                  {can(me, 'operate', p.id) && <button className={`btn small${s.enabled ? ' c-danger-soft' : ''}`} onClick={() => toggle(p, s)}>{s.enabled ? 'Stop' : 'Start'}</button>}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        </section>
      ))}
      {open && <SutraDrawer project={open.project} sutra={open.sutra} onClose={() => setOpen(null)} onChanged={reload} />}
      {history && <PackageDrawer project={history} onClose={() => setHistory(null)} onChanged={reload} />}
      {confirm && <Confirm title={confirm.title} text={confirm.text} action={confirm.action} danger={confirm.danger} onYes={confirm.run} onClose={() => setConfirm(null)} />}
    </>
  );
}

export function Drawer({ title, sub, onClose, children }: { title: string; sub?: React.ReactNode; onClose(): void; children: React.ReactNode }) {
  return (
    <div className="c-scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
      <aside className="c-drawer" role="dialog" aria-modal="true" aria-label={title}>
        <div className="c-drawerhead"><div><h2>{title}</h2>{sub && <div className="muted xs">{sub}</div>}</div><button className="btn small" onClick={onClose} autoFocus>Close</button></div>
        <div className="c-drawerbody">{children}</div>
      </aside>
    </div>
  );
}

function SutraDrawer({ project, sutra, onClose, onChanged }: { project: ProjectApp; sutra: SutraApp; onClose(): void; onChanged(): void }) {
  const { me } = useMe();
  const toast = useToast();
  const [tab, setTab] = useState<'runs' | 'versions'>('runs');
  const [status, setStatus] = useState('');
  const runs = useLoad<any[]>(`/api/runs?flowId=${encodeURIComponent(sutra.id)}&limit=100${status ? '&status=' + status : ''}`, [status]);
  const versions = useLoad<{ version: number; note: string; created_at: string }[]>(tab === 'versions' ? `/api/flows/${sutra.id}/versions` : null, [tab]);
  const [run, setRun] = useState<any | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; text: string; action: string; run(): Promise<void> } | null>(null);
  const openRun = async (id: string) => { try { setRun(await get(`/api/runs/${id}`)); } catch (e: any) { toast(e.message, true); } };
  const act = async (fn: () => Promise<unknown>, msg: string) => { try { await fn(); toast(msg); runs.reload(); if (run) openRun(run.id); } catch (e: any) { toast(e.message, true); } };
  const mayOperate = can(me, 'operate', project.id), mayDeploy = can(me, 'deploy', project.id);
  const deployed = runs.data ? runs.data.filter(r => r.source !== 'test' && r.source !== 'debug') : [];

  return (
    <Drawer title={sutra.name} sub={<>{project.name} · version {sutra.version} deployed {ago(sutra.deployedAt)} · {sutra.enabled ? 'started' : 'stopped'}</>} onClose={onClose}>
      <div className="c-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'runs'} className={tab === 'runs' ? 'act' : ''} onClick={() => setTab('runs')}>Runs</button>
        <button role="tab" aria-selected={tab === 'versions'} className={tab === 'versions' ? 'act' : ''} onClick={() => setTab('versions')}>Versions</button>
      </div>
      {tab === 'runs' && !run && (
        <>
          <div className="c-filters">
            <label htmlFor="c-run-status" className="muted xs">Status</label>
            <select id="c-run-status" className="inp" value={status} onChange={e => setStatus(e.target.value)}>
              <option value="">All</option><option value="failed">Failed</option><option value="running">Running</option><option value="waiting">Waiting</option><option value="done">Done</option><option value="cancelled">Cancelled</option>
            </select>
            <button className="btn small" onClick={runs.reload}>Refresh</button>
          </div>
          <Err text={runs.error} />
          {deployed.length ? (
            <div className="c-tablewrap"><table className="t c-table">
              <thead><tr><th>Started</th><th>Status</th><th>By</th><th className="right">Steps</th><th>Error</th></tr></thead>
              <tbody>{deployed.map(r => (
                <tr key={r.id} className="click" onClick={() => openRun(r.id)} tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') openRun(r.id); }}>
                  <td className="nowrap" title={when(r.startedAt)}>{ago(r.startedAt)}</td><td>{runState(r.status)}</td><td>{r.source}</td><td className="right">{r.steps}</td><td className="c-err">{r.error || ''}</td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : runs.data && <Empty title="No runs">Runs started by this Sutra's triggers appear here.</Empty>}
        </>
      )}
      {tab === 'runs' && run && (
        <div className="c-run">
          <div className="c-runhead">
            <button className="btn small" onClick={() => setRun(null)}>Back to runs</button>
            <span>{runState(run.status)} <span className="muted xs">started {when(run.startedAt)}{run.finishedAt ? `, finished ${when(run.finishedAt)}` : ''} · version {run.version} · {run.source}</span></span>
            <span className="c-actions">
              {mayOperate && run.status === 'failed' && <button className="btn small" onClick={() => act(() => post(`/api/runs/${run.id}/resubmit`), 'Run resubmitted')}>Resubmit</button>}
              {mayOperate && (run.status === 'running' || run.status === 'waiting') && <button className="btn small c-danger-soft" onClick={() => act(() => post(`/api/runs/${run.id}/cancel`), 'Run cancelled')}>Cancel run</button>}
            </span>
          </div>
          {run.error && <div className="errbox">{run.error}</div>}
          <div className="c-tablewrap"><table className="t c-table">
            <thead><tr><th>Step</th><th>Status</th><th className="right">Try</th><th className="right">Time</th><th>Output or error</th></tr></thead>
            <tbody>{run.tasks.map((t: any) => (
              <tr key={t.id}>
                <td><strong>{run.doc.nodes.find((n: any) => n.id === t.node_id)?.name || t.node_id}</strong></td>
                <td>{runState(t.status)}{t.port && t.port !== 'out' && <span className="muted xs"> → {t.port}</span>}</td>
                <td className="right">{(t.attempt || 0) + 1}</td>
                <td className="right nowrap">{t.ms != null ? `${t.ms} ms` : ''}</td>
                <td className={t.error ? 'c-err' : 'c-out'}>{t.error || (t.output != null ? <code>{JSON.stringify(t.output).slice(0, 220)}</code> : '')}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      )}
      {tab === 'versions' && (
        <>
          <Err text={versions.error} />
          <div className="c-tablewrap"><table className="t c-table">
            <thead><tr><th>Version</th><th>Published</th><th>Note</th><th /></tr></thead>
            <tbody>{(versions.data || []).map(v => (
              <tr key={v.version}>
                <td><strong>{v.version}</strong>{v.version === sutra.version && <span className="c-badge">deployed</span>}</td>
                <td className="nowrap">{when(v.created_at)}</td><td>{v.note}</td>
                <td className="right">{mayDeploy && v.version !== sutra.version && <button className="btn small" onClick={() => setConfirm({
                  title: `Deploy version ${v.version}`, text: `${sutra.name} switches from version ${sutra.version} to ${v.version} on every engine. Runs in progress keep their version.`, action: 'Deploy',
                  run: async () => { await post(`/api/flows/${sutra.id}/deploy`, { version: v.version }); toast(`Version ${v.version} deployed`); onChanged(); onClose(); },
                })}>Deploy this version</button>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </>
      )}
      {confirm && <Confirm title={confirm.title} text={confirm.text} action={confirm.action} onYes={confirm.run} onClose={() => setConfirm(null)} />}
    </Drawer>
  );
}

function PackageDrawer({ project, onClose, onChanged }: { project: ProjectApp; onClose(): void; onChanged(): void }) {
  const { me } = useMe();
  const toast = useToast();
  const h = useLoad<any[]>(`/api/projects/${project.id}/packages`);
  const [confirm, setConfirm] = useState<any | null>(null);
  return (
    <Drawer title={`${project.name}: packages`} sub="Every package deployed to this project, newest first." onClose={onClose}>
      <Err text={h.error} />
      {h.data && !h.data.length && <Empty title="No packages">This project was deployed Sutra by Sutra. Packages appear here when deployed with the sutra command, the designer's Releases, or a Release Sutra.</Empty>}
      {!!h.data?.length && (
        <div className="c-tablewrap"><table className="t c-table">
          <thead><tr><th>Version</th><th>Deployed</th><th>By</th><th>Sutras</th><th /></tr></thead>
          <tbody>{h.data.map((d, i) => (
            <tr key={d.id}>
              <td><strong>{d.version}</strong>{i === 0 && <span className="c-badge">current</span>}<div className="muted xs mono">{String(d.checksum).slice(0, 12)}</div></td>
              <td className="nowrap">{when(d.deployed_at)}</td><td>{d.deployed_by || ''}</td>
              <td>{(d.report?.sutras || []).map((s: any) => s.name).join(', ')}</td>
              <td className="right">{i > 0 && can(me, 'deploy', project.id) && <button className="btn small" onClick={() => setConfirm(d)}>Roll back to this</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {confirm && <Confirm title={`Roll back to ${confirm.version}`} text={`The package ${confirm.name} ${confirm.version} is deployed again to ${project.name}. Sutras not in it are undeployed.`} action="Roll back" danger
        onYes={async () => { await post(`/api/projects/${project.id}/rollback`, { to: confirm.id }); toast(`Rolled back to ${confirm.version}`); h.reload(); onChanged(); }} onClose={() => setConfirm(null)} />}
    </Drawer>
  );
}
