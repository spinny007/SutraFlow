import { useEffect, useRef, useState } from 'react';
import { get, post, put } from '../src/api';
import { useToast } from '../src/ui';
import { act } from './log';
import { PageHead, Err, Confirm, when } from './shared';

interface Target { host: string; port: number; database: string; user: string; sslMode: 'off' | 'require' | 'verify'; savedAt?: string; testedAt?: string; testedOk?: boolean; hasPassword?: boolean }
interface Status { state: string; at: string; startedAt?: string; message?: string; log: string[]; rows?: number; tables?: number; target?: string; envBackup?: string }
interface Info { kind: 'sqlite' | 'postgres'; where: string; counts: Record<string, number | null>; target: Target | null; status: Status; envFile: string; scripts: { windows: string; linux: string }; launcher: boolean }

const RUNNING = ['starting', 'stopping', 'copying', 'switching', 'restarting', 'checking'];
const STEPS = [['stopping', 'Stop SutraFlow'], ['copying', 'Copy the data'], ['switching', 'Switch the settings'], ['restarting', 'Start on PostgreSQL'], ['checking', 'Check']];

/**
 * The server's own database. An administrator saves and tests a PostgreSQL connection, then Migrate
 * now runs tools/migrate-to-postgres: it stops SutraFlow, copies everything, switches sutraflow.env,
 * starts SutraFlow and checks it (back to SQLite on any failure). This page waits through the restart.
 */
export function Database() {
  const toast = useToast();
  const [info, setInfo] = useState<Info | null>(null);
  const [err, setErr] = useState('');
  const [f, setF] = useState({ host: '127.0.0.1', port: '5432', database: 'sutraflow', user: 'postgres', password: '', sslMode: 'off' as Target['sslMode'] });
  const [test, setTest] = useState<{ ok: boolean; message: string; notes: string[] } | null>(null);
  const [busy, setBusy] = useState('');
  const [replace, setReplace] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [watch, setWatch] = useState<{ status: Status | null; down: boolean } | null>(null);
  const timer = useRef<number | null>(null);

  const load = () => get<Info>('/api/server/database').then(i => {
    setInfo(i);
    if (i.target) setF(x => ({ ...x, host: i.target!.host, port: String(i.target!.port), database: i.target!.database, user: i.target!.user, sslMode: i.target!.sslMode || 'off' }));
    if (RUNNING.includes(i.status.state) && Date.now() - Date.parse(i.status.at) < 15 * 60000) follow();
  }).catch(e => setErr(e.message));
  useEffect(() => { load(); return () => { if (timer.current) window.clearInterval(timer.current); }; }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const body = () => ({ host: f.host, port: Number(f.port), database: f.database, user: f.user, sslMode: f.sslMode, ...(f.password ? { password: f.password } : {}) });
  const doTest = async () => {
    setBusy('test'); setTest(null);
    try { const r = await post<any>('/api/server/database/test', body()); setTest(r); if (r.ok) load(); } catch (e: any) { setTest({ ok: false, message: e.message, notes: [] }); } finally { setBusy(''); }
  };
  const save = async () => {
    setBusy('save');
    try { await act({ label: `Save the PostgreSQL connection ${f.user}@${f.host}:${f.port}/${f.database}`, method: 'PUT', url: '/api/server/database/target', body: body() }); setF(x => ({ ...x, password: '' })); toast('Connection saved; the password is in the vault'); await doTest(); }
    catch (e: any) { toast(e.message, true); } finally { setBusy(''); }
  };

  /** While the script runs: its status from this server, then (while it restarts) health, then the result. */
  function follow() {
    if (timer.current) return;
    setWatch({ status: null, down: false });
    timer.current = window.setInterval(async () => {
      try {
        const i = await get<Info>('/api/server/database');
        setInfo(i);
        setWatch({ status: i.status, down: false });
        if (!RUNNING.includes(i.status.state)) { window.clearInterval(timer.current!); timer.current = null; toast(i.status.message || i.status.state, i.status.state !== 'done'); }
      } catch {
        setWatch(w => ({ status: w?.status || null, down: true }));
      }
    }, 2000);
  }
  const migrate = async () => {
    setConfirm(false);
    try { await act({ label: 'Migrate the SutraFlow database from SQLite to PostgreSQL', method: 'POST', url: '/api/server/database/migrate', body: { replace } }); follow(); }
    catch (e: any) { toast(e.message, true); }
  };

  if (err) return <Err text={err} />;
  if (!info) return null;
  const st = watch?.status || info.status;
  const running = !!watch && (!st || RUNNING.includes(st.state));
  const t = info.target;
  const ready = info.kind === 'sqlite' && !!t?.testedOk;
  return (
    <>
      <PageHead title="Database" sub="Where this server keeps its own data: projects, Sutras, runs, people, the vault. SQLite needs nothing; PostgreSQL lets several engines share the data and scales further." />
      <section className="c-card" aria-label="Database in use">
        <div className="c-cardhead"><strong>In use</strong><span className={`pill ${info.kind === 'postgres' ? 'ok' : ''}`}>{info.kind === 'postgres' ? 'PostgreSQL' : 'SQLite'}</span></div>
        <p className="mono xs" style={{ wordBreak: 'break-all' }}>{info.where}</p>
        <p className="muted xs">{Object.entries(info.counts).map(([k, v]) => `${v ?? '?'} ${k}`).join(' · ')}</p>
      </section>

      {info.kind === 'sqlite' && <>
        <section className="c-card" aria-label="PostgreSQL connection" style={{ marginTop: 14 }}>
          <div className="c-cardhead"><strong>1. PostgreSQL connection</strong>{t?.testedOk && <span className="pill ok">tested {when(t.testedAt)}</span>}</div>
          <p className="muted xs">The server and database to move to, on this machine or remote (Azure, AWS, Google Cloud or your own server). The database is made when it does not exist (the user then needs CREATEDB). The password is kept in the vault; leave it empty to keep the saved one (or for a server that signs in without one). SSL: off on this machine or a trusted network; require encrypts (the server's own certificate is not checked); verify also checks the certificate, for hosted PostgreSQL.</p>
          <div className="c-filters">
            <div className="fld"><label htmlFor="db-host">Host</label><input id="db-host" type="text" value={f.host} onChange={e => setF({ ...f, host: e.target.value })} /></div>
            <div className="fld" style={{ minWidth: 90 }}><label htmlFor="db-port">Port</label><input id="db-port" type="number" value={f.port} onChange={e => setF({ ...f, port: e.target.value })} /></div>
            <div className="fld"><label htmlFor="db-name">Database</label><input id="db-name" type="text" value={f.database} onChange={e => setF({ ...f, database: e.target.value })} /></div>
            <div className="fld"><label htmlFor="db-user">User</label><input id="db-user" type="text" value={f.user} onChange={e => setF({ ...f, user: e.target.value })} /></div>
            <div className="fld"><label htmlFor="db-pw">Password</label><input id="db-pw" type="password" autoComplete="new-password" value={f.password} placeholder={t?.hasPassword ? 'saved' : ''} onChange={e => setF({ ...f, password: e.target.value })} /></div>
            <div className="fld"><label htmlFor="db-ssl">SSL</label><select id="db-ssl" value={f.sslMode} onChange={e => setF({ ...f, sslMode: e.target.value as Target['sslMode'] })}><option value="off">off</option><option value="require">require</option><option value="verify">verify</option></select></div>
          </div>
          <div className="row">
            <button className="btn" disabled={!!busy} onClick={doTest}>{busy === 'test' ? 'Testing' : 'Test connection'}</button>
            <button className="btn primary" disabled={!!busy} onClick={save}>{busy === 'save' ? 'Saving' : 'Save'}</button>
          </div>
          {test && <div className={test.ok ? 'okbox' : 'errbox'} role="status" style={{ marginTop: 10 }}>{test.message}{test.notes.length > 0 && <ul>{test.notes.map(n => <li key={n}>{n}</li>)}</ul>}</div>}
        </section>

        <section className="c-card" aria-label="Migrate" style={{ marginTop: 14 }}>
          <div className="c-cardhead"><strong>2. Migrate</strong></div>
          <p className="muted xs">Runs <code>tools/migrate-to-postgres</code>: stops SutraFlow gracefully (running steps finish; triggers and APIs pause for about a minute), copies every table and checks the row counts, points <code>{info.envFile}</code> at PostgreSQL (the old file is kept), starts SutraFlow again and checks it. If anything fails, it goes back to SQLite. The SQLite file is not changed.</p>
          {!info.launcher && <div className="warnbox">The launcher (bin/sutraflow.mjs) is not here, so the script cannot stop and start this server.</div>}
          <label className="check"><input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} /> Replace SutraFlow tables already in the target database</label>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn primary" disabled={!ready || running} onClick={() => setConfirm(true)} title={ready ? '' : 'Save and test the connection first'}>Migrate now</button>
          </div>
          <p className="muted xs" style={{ marginTop: 10 }}>The same script by hand: <code>{info.scripts.windows}</code> on Windows, <code>{info.scripts.linux}</code> on Linux.</p>
        </section>
      </>}

      {st && st.state !== 'idle' && (
        <section className="c-card" aria-label="Migration progress" style={{ marginTop: 14 }}>
          <div className="c-cardhead"><strong>Migration</strong><span className={`pill ${st.state === 'done' ? 'ok' : ['failed', 'rolled back'].includes(st.state) ? 'err' : ''}`}>{st.state}</span></div>
          {running && <ol className="xs">{STEPS.map(([k, label]) => { const i = STEPS.findIndex(x => x[0] === st.state); const j = STEPS.findIndex(x => x[0] === k); return <li key={k} style={{ fontWeight: j === i ? 700 : 400, opacity: j > i ? 0.55 : 1 }}>{label}{j < i ? ' ✓' : ''}</li>; })}</ol>}
          {watch?.down && <div className="warnbox">SutraFlow is restarting; this page waits for it.</div>}
          {st.message && <p>{st.message}</p>}
          {st.rows !== undefined && <p className="muted xs">{st.rows} rows in {st.tables} tables to {st.target}</p>}
          <pre className="c-code" style={{ maxHeight: 260, overflow: 'auto' }}>{(st.log || []).join('\n')}</pre>
        </section>
      )}
      {confirm && <Confirm title="Migrate to PostgreSQL" action="Migrate now" text={<>SutraFlow stops for about a minute while the data is copied to <b>{t?.user}@{t?.host}:{t?.port}/{t?.database}</b>, then starts again on PostgreSQL. Running steps finish first. Go on?</>} onYes={migrate} onClose={() => setConfirm(false)} />}
    </>
  );
}
