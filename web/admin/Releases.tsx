import { Fragment, useEffect, useState } from 'react';
import { get, post } from '../src/api';
import { useToast } from '../src/ui';
import { act } from './log';
import { PageHead, Err, Empty, when, useMe, can } from './shared';

interface Opened { package: any; config: any | null; files?: string[]; zip?: string; check: { ok: boolean; errors: string[]; warnings: string[]; secrets: { name: string; present: boolean }[] }; file: string }

/** Reads a file as base64 (without the data: prefix). */
const base64 = (f: File) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).replace(/^data:[^,]*,/, ''));
  r.onerror = () => rej(r.error);
  r.readAsDataURL(f);
});

/** Upload of a release zip (or package file): check against this server, then deploy with its deployment config. */
function Upload({ onDeployed }: { onDeployed(): void }) {
  const toast = useToast();
  const [opened, setOpened] = useState<Opened | null>(null);
  const [project, setProject] = useState('');
  const [override, setOverride] = useState<{ name: string; config: any } | null>(null);
  const [keepOthers, setKeepOthers] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const open = async (f: File | undefined, target = project) => {
    setErr(''); setOpened(null);
    if (!f) return;
    try {
      const body = /\.zip$/i.test(f.name) ? { zip: await base64(f) } : { package: JSON.parse(await f.text()) };
      const o = await post<Omit<Opened, 'file'>>('/api/packages/open', { ...body, project: target || undefined });
      setOpened({ ...o, file: f.name, zip: 'zip' in body ? body.zip : undefined });
      if (!target) setProject(o.package.project.name);
    } catch (e: any) { setErr(`${f.name}: ${e.message}`); }
  };
  const recheck = async () => {
    if (!opened) return;
    try { setOpened({ ...opened, check: await post('/api/packages/check', { package: opened.package, project }) }); } catch (e: any) { setErr(e.message); }
  };
  const pickConfig = async (f: File | undefined) => {
    if (!f) { setOverride(null); return; }
    try { setOverride({ name: f.name, config: JSON.parse(await f.text()) }); } catch (e: any) { toast(`${f.name} is not JSON: ${e.message}`, true); }
  };
  const config = override?.config ?? opened?.config ?? undefined;
  const deploy = async () => {
    if (!opened) return;
    setBusy(true);
    try {
      const ops = config ? { ...config, project: !config.project || config.project === opened.package.project.name ? project : config.project } : undefined;
      const r = await act<any>({
        label: `Deploy ${opened.package.name} ${opened.package.version} to ${project}`, method: 'POST', url: '/api/packages/deploy',
        body: { ...(opened.zip ? { zip: opened.zip } : { package: opened.package }), project, ops, keepOthers },
        cli: ['deploy', opened.file, '--project', project, ...(override ? ['--config', override.name] : []), ...(keepOthers ? ['--keep-others'] : [])],
      });
      toast(`Deployed ${r.package.name} ${r.package.version} to ${r.project.name}${r.unchanged ? ': nothing changed' : ''}`);
      setOpened(null); setOverride(null); onDeployed();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const p = opened?.package;
  return (
    <section className="c-card" aria-label="Deploy a release">
      <div className="c-cardhead"><strong>Deploy a release</strong><span className="muted xs">release zip or .sutra package</span></div>
      <p className="muted xs">A release zip holds the package, its deployment config and a README. It is built in the designer (Releases), with <code>sutra package --zip</code>, or by a CI pipeline from Git with <code>sutra package --from-git</code>. It is checked against this server before anything changes.</p>
      <div className="c-filters">
        <div className="fld"><label htmlFor="r-file">Release</label><input id="r-file" type="file" accept=".zip,.sutra,.json" onChange={e => open(e.target.files?.[0])} /></div>
      </div>
      <Err text={err} />
      {p && opened && (
        <>
          <table className="t c-table"><tbody>
            <tr><th>Package</th><td><b>{p.name} {p.version}</b> <span className="muted xs">{p.checksum.slice(7, 19)}</span>{p.note ? <div className="muted xs">{p.note}</div> : null}</td></tr>
            {p.source && <tr><th>Built from</th><td>{p.source.repository || 'a Git folder'}{p.source.ref ? ` ${p.source.ref}` : ''}{p.source.commit ? <span className="muted xs"> commit {p.source.commit.slice(0, 12)}</span> : null}</td></tr>}
            <tr><th>Made</th><td>{when(p.createdAt)} with SutraFlow {p.createdWith}</td></tr>
            <tr><th>Sutras</th><td>{p.manifest.sutras.map((s: any) => <div key={s.name}>{s.name} v{s.version}{s.exposes.length ? <span className="muted xs"> {s.exposes.join(', ')}</span> : null}</div>)}</td></tr>
            <tr><th>Secrets</th><td>{opened.check.secrets.length ? opened.check.secrets.map(s => <span key={s.name} className={`pill ${s.present ? 'ok' : 'err'}`} style={{ marginRight: 4 }}>{s.name}{s.present ? '' : ': missing'}</span>) : <span className="muted">none</span>}</td></tr>
            {opened.files && opened.files.length > 0 && <tr><th>Files</th><td>{opened.files.length} for the project files folder: {opened.files.join(', ')}</td></tr>}
            <tr><th>Deployment config</th><td>{config ? `${override ? override.name : 'from the zip'}: ${Object.keys(config.variables || {}).length} variables, ${Object.keys(config.resources || {}).length} connections` : <span className="muted">none; the package's own values are used</span>}</td></tr>
          </tbody></table>
          <div className="c-filters" style={{ marginTop: 10 }}>
            <div className="fld"><label htmlFor="r-proj">Project</label><input id="r-proj" value={project} onChange={e => setProject(e.target.value)} onBlur={recheck} /></div>
            <div className="fld"><label htmlFor="r-cfg">Other deployment config</label><input id="r-cfg" type="file" accept=".json" onChange={e => pickConfig(e.target.files?.[0])} /></div>
            <label className="check"><input type="checkbox" checked={keepOthers} onChange={e => setKeepOthers(e.target.checked)} /> Keep Sutras not in the package</label>
          </div>
          {(opened.check.errors.length > 0 || opened.check.warnings.length > 0) && (
            <div className={opened.check.ok ? 'okbox' : 'errbox'} role="status"><ul>{[...opened.check.errors, ...opened.check.warnings].map(x => <li key={x}>{x}</li>)}</ul></div>
          )}
          <div className="row">
            <button className="btn primary" disabled={!opened.check.ok || !project || busy} onClick={deploy}>{busy ? 'Deploying' : `Deploy to ${project}`}</button>
            <button className="btn" onClick={() => { setOpened(null); setOverride(null); }}>Cancel</button>
          </div>
        </>
      )}
    </section>
  );
}

/** Releases: deploy release zips, and each project's package history with rollback. */
export function Releases() {
  const { me } = useMe();
  const toast = useToast();
  const [projects, setProjects] = useState<any[] | null>(null);
  const [hist, setHist] = useState<Record<string, any[]>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const load = async () => {
    try {
      const ps = await get<any[]>('/api/projects');
      const h: Record<string, any[]> = {};
      await Promise.all(ps.map(async p => { h[p.id] = await get<any[]>(`/api/projects/${p.id}/packages`).catch(() => []); }));
      setProjects(ps); setHist(h);
    } catch (e: any) { setErr(e.message); }
  };
  useEffect(() => { load(); }, []);
  const rollback = async (p: any, to?: string) => {
    if (!confirm(to ? 'Deploy this earlier package again?' : `Roll ${p.name} back to the package before the current one?`)) return;
    try {
      const r = await act<any>({ label: `Roll back ${p.name}`, method: 'POST', url: `/api/projects/${p.id}/rollback`, body: { to }, cli: ['rollback', '--project', p.name, ...(to ? ['--to', to] : [])] });
      toast(`${p.name} is at ${r.package.version}`); load();
    } catch (e: any) { toast(e.message, true); }
  };
  const released = (projects || []).filter(p => hist[p.id]?.length);
  return (
    <>
      <PageHead title="Releases" sub="Production gets Sutras from release packages: deploy one here or with sutra deploy, and roll back to any earlier one." />
      {can(me, 'deploy') && <Upload onDeployed={load} />}
      <Err text={err} />
      <section className="c-card" aria-label="Deployed releases" style={{ marginTop: 14 }}>
        <div className="c-cardhead"><strong>Deployed releases</strong></div>
        {projects && !released.length ? <Empty title="No release deployed yet">Deploy a release zip above, or run <code>sutra deploy release.zip --server … --token …</code>.</Empty> : (
          <div className="c-tablewrap"><table className="t c-table">
            <thead><tr><th>Project</th><th>Current package</th><th>Deployed</th><th>By</th><th /></tr></thead>
            <tbody>{released.map(p => {
              const h = hist[p.id], cur = h[0];
              return (
                <Fragment key={p.id}>
                  <tr className="click" onClick={() => setOpen(open === p.id ? null : p.id)} aria-expanded={open === p.id}>
                    <td><b>{p.name}</b></td><td>{cur.name} <b>{cur.version}</b> <span className="muted xs">{cur.checksum.slice(7, 19)}</span></td><td>{when(cur.deployed_at)}</td><td>{cur.deployed_by}</td>
                    <td>{h.length > 1 && can(me, 'deploy', p.id) && <button className="btn small" onClick={e => { e.stopPropagation(); rollback(p); }}>Roll back</button>}</td>
                  </tr>
                  {open === p.id && h.map((d, i) => (
                    <tr key={d.id}>
                      <td className="muted xs">{i === 0 ? 'current' : ''}</td><td>{d.name} {d.version} <span className="muted xs">{d.checksum.slice(7, 19)}</span></td><td>{when(d.deployed_at)}</td><td>{d.deployed_by}</td>
                      <td>{i > 0 && can(me, 'deploy', p.id) && <button className="btn small" onClick={() => rollback(p, d.id)}>Deploy again</button>}</td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
