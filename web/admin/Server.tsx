/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.9.1
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { useCallback, useEffect, useState } from 'react';
import { get, post, put } from '../src/api';
import { fmtTime, useToast } from '../src/ui';
import { SecretValueEntry } from '../src/Fields';
import { PageHead } from './shared';

interface ServerInfo {
  gateway: { host: string; httpPort: number; httpsPort: number };
  status: { http: string; https: string; error: string };
  tls: { mode: string; domains: string[]; email: string; staging: boolean; agreeTos: boolean; clientCaPem: string };
  cert: null | { source: string; subject?: string; issuer?: string; altNames?: string; validTo?: string; daysLeft?: number; fingerprint256?: string; error?: string };
  acme: { state: string; message: string; at?: string };
  routes: { kind: string; method: string; path: string; flow: string; version: number; step: string; policy: string | null; urls: string[]; wsdl?: string; flowId?: string; tool?: string }[];
  schedulerErrors: string[];
  listeners: { flow: string; step: string; type: string; state: string; message: string; at: string }[];
  engine: Record<string, number>;
  admin: { host: string; port: number };
}

export function Runtime() {
  return (
    <>
      <PageHead title="Runtime" sub="Server-wide values and permissions used by every project and engine." />
      <EngineVariables />
      <ScriptsPolicy />
      <ReleasesPolicy />
    </>
  );
}

export function GatewayTls() {
  const toast = useToast();
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [gw, setGw] = useState<ServerInfo['gateway'] | null>(null);
  const [tls, setTls] = useState<ServerInfo['tls'] | null>(null);
  const [pem, setPem] = useState({ certPem: '', keyPem: '' });
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => get<ServerInfo>('/api/server').then(i => { setInfo(i); setGw(g => g ?? i.gateway); setTls(t => t ?? i.tls); }), []);
  useEffect(() => { load().catch(e => toast(e.message, true)); }, [load, toast]);
  useEffect(() => {
    if (info?.acme.state !== 'running') return;
    const t = window.setTimeout(() => load(), 2000);
    return () => window.clearTimeout(t);
  }, [info, load]);

  const act = async (fn: () => Promise<any>, ok: string) => {
    setBusy(true);
    try { await fn(); toast(ok); await load(); } catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  if (!info || !gw || !tls) return <div className="muted">Loading</div>;
  const domainsText = tls.domains.join(', ');

  return (
    <>
      <PageHead title="Gateway & TLS" sub={`Listener and certificate settings for this server, separate from the Admin Console at ${info.admin.host}:${info.admin.port}.`} />

      <div className="card">
        <h2>Gateway listeners</h2>
        <p className="muted" style={{ fontSize: 13 }}>HTTP: {info.status.http || 'not listening'} · HTTPS: {info.status.https || 'off'}</p>
        {info.status.error && <div className="errbox">{info.status.error}</div>}
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div className="fld"><label htmlFor="gh">Bind address</label><input id="gh" type="text" value={gw.host} onChange={e => setGw({ ...gw, host: e.target.value })} /></div>
          <div className="fld"><label htmlFor="gp">HTTP port</label><input id="gp" type="number" value={gw.httpPort} onChange={e => setGw({ ...gw, httpPort: Number(e.target.value) })} /></div>
          <div className="fld"><label htmlFor="gs">HTTPS port</label><input id="gs" type="number" value={gw.httpsPort} onChange={e => setGw({ ...gw, httpsPort: Number(e.target.value) })} /></div>
          <div className="fld"><button className="btn primary" disabled={busy} onClick={() => act(() => put('/api/server/gateway', gw), 'Gateway restarted')}>Apply and restart</button></div>
        </div>
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>For Let's Encrypt the HTTP port must be reachable as port 80 on your domain (directly, or forwarded by a firewall or load balancer).</p>
      </div>

      <div className="card">
        <h2>TLS certificate</h2>
        {info.cert ? (
          info.cert.error ? <div className="errbox">{info.cert.error}</div> : (
            <table className="t"><tbody>
              <tr><th>Source</th><td>{info.cert.source}</td></tr>
              <tr><th>Subject</th><td><code>{info.cert.subject}</code></td></tr>
              <tr><th>Names</th><td><code>{info.cert.altNames}</code></td></tr>
              <tr><th>Issuer</th><td><code>{info.cert.issuer}</code></td></tr>
              <tr><th>Valid until</th><td>{fmtTime(info.cert.validTo)} <span className={`badge ${(info.cert.daysLeft ?? 0) < 20 ? 'failed' : 'done'}`}>{info.cert.daysLeft} days</span></td></tr>
            </tbody></table>
          )
        ) : <p className="muted">No certificate yet. HTTPS starts once one is in place and the mode is not Off.</p>}

        <div className="group">Mode</div>
        <div className="row">
          {[['off', 'Off (HTTP only)'], ['selfSigned', 'Self-signed'], ['uploaded', 'Own certificate'], ['acme', "Let's Encrypt"]].map(([m, l]) => (
            <label key={m} className="check" style={{ marginRight: 12 }}><input type="radio" name="tlsmode" checked={tls.mode === m} onChange={() => setTls({ ...tls, mode: m })} /> {l}</label>
          ))}
        </div>
        <div className="fld" style={{ marginTop: 10 }}><label htmlFor="dom">Domain names</label><input id="dom" type="text" defaultValue={domainsText} onBlur={e => setTls({ ...tls, domains: e.target.value.split(',').map(x => x.trim()).filter(Boolean) })} placeholder="api.example.com, soap.example.com" /><div className="hint">Comma separated. The first is the certificate's common name.</div></div>

        {tls.mode === 'selfSigned' && <p><button className="btn" disabled={busy} onClick={() => act(async () => { await put('/api/server/tls', tls); await post('/api/server/tls/self-signed'); }, 'Self-signed certificate created')}>Generate self-signed certificate</button> <span className="muted" style={{ fontSize: 12 }}>For testing; clients must trust it explicitly.</span></p>}

        {tls.mode === 'uploaded' && <>
          <div className="fld"><label htmlFor="cp">Certificate chain (PEM)</label><textarea id="cp" className="code" rows={5} value={pem.certPem} onChange={e => setPem({ ...pem, certPem: e.target.value })} spellCheck={false} /></div>
          <div className="fld"><label htmlFor="kp">Private key (PEM)</label><textarea id="kp" className="code" rows={5} value={pem.keyPem} onChange={e => setPem({ ...pem, keyPem: e.target.value })} spellCheck={false} autoComplete="off" /><div className="hint">Stored encrypted. Must match the first certificate.</div></div>
          <button className="btn" disabled={busy || !pem.certPem || !pem.keyPem} onClick={() => act(async () => { await put('/api/server/tls', tls); await post('/api/server/tls/upload', pem); setPem({ certPem: '', keyPem: '' }); }, 'Certificate installed')}>Install certificate</button>
        </>}

        {tls.mode === 'acme' && <>
          <div className="fld"><label htmlFor="em">Contact email</label><input id="em" type="text" value={tls.email} onChange={e => setTls({ ...tls, email: e.target.value })} /></div>
          <div className="fld"><label className="check"><input type="checkbox" checked={tls.staging} onChange={e => setTls({ ...tls, staging: e.target.checked })} /> Use the staging environment (untrusted test certificates, higher rate limits)</label></div>
          <div className="fld"><label className="check"><input type="checkbox" checked={tls.agreeTos} onChange={e => setTls({ ...tls, agreeTos: e.target.checked })} /> I accept the <a href="https://letsencrypt.org/repository/" target="_blank" rel="noreferrer">Let's Encrypt Subscriber Agreement</a></label></div>
          <button className="btn" disabled={busy || !tls.agreeTos || !tls.email || !tls.domains.length} onClick={() => act(async () => { await put('/api/server/tls', tls); await post('/api/server/tls/acme'); }, 'Certificate requested')}>Request certificate</button>
          {info.acme.state !== 'idle' && <div className={info.acme.state === 'error' ? 'errbox' : info.acme.state === 'ok' ? 'okbox' : 'warnbox'} style={{ marginTop: 10 }}>{info.acme.message}{info.acme.at ? ` (${fmtTime(info.acme.at)})` : ''}</div>}
          <p className="muted" style={{ fontSize: 12 }}>Renewal runs automatically when fewer than 30 days remain.</p>
        </>}

        <div className="group">Mutual TLS (client certificates)</div>
        <div className="fld"><label htmlFor="ca">Trusted client CA (PEM)</label><textarea id="ca" className="code" rows={4} value={tls.clientCaPem} onChange={e => setTls({ ...tls, clientCaPem: e.target.value })} spellCheck={false} /><div className="hint">When set, the HTTPS listener asks callers for a certificate. Services whose policy uses "mtls" accept only certificates signed by this CA.</div></div>
        <button className="btn primary" disabled={busy} onClick={() => act(() => put('/api/server/tls', tls), 'TLS settings saved')}>Save TLS settings</button>
      </div>
    </>
  );
}

/** Engine properties: administrator-managed settings shared by all projects. */
function EngineVariables() {
  const toast = useToast();
  const [vars, setVars] = useState<{ name: string; value: string; description?: string; type?: 'string' | 'secret' }[] | null>(null);
  useEffect(() => { get('/api/engine-variables').then(setVars).catch(e => toast(e.message, true)); }, [toast]);
  if (!vars) return null;
  const set = (i: number, k: 'name' | 'value' | 'description' | 'type', v: string) => setVars(vs => vs!.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <div className="card">
      <h2>Engine properties</h2>
      <p className="muted" style={{ fontSize: 13 }}>Administrator-managed settings shared by every project. Sutras read them with <code>{'{{ev.NAME}}'}</code>, <code>{'{ev.NAME}'}</code>, <code>{"get-engine-variable('NAME')"}</code>, or Get Properties. Values may read environment variables with <code>{'${env:NAME}'}</code>. Sutras cannot change them.</p>
      <table className="t"><tbody>
        {vars.map((v, i) => (
          <tr key={i}>
            <td><input className="inp code" aria-label={`Engine property ${i + 1} name`} placeholder="NAME" value={v.name} onChange={e => set(i, 'name', e.target.value)} /></td>
            <td><select aria-label={`Engine property ${i + 1} type`} value={v.type || 'string'} onChange={e => {set(i, 'type', e.target.value); set(i, 'value', '');}}><option value="string">String</option><option value="secret">Secret</option></select></td>
            <td>{v.type === 'secret' ? <><span className="muted">{v.value ? '•••••• (stored)' : '(not set)'}</span><SecretValueEntry key={`${v.name}:${i}`} label={v.name || 'engine secret'} namespace="engine" onStored={ref => set(i, 'value', ref)} /></> : <input className="inp code" aria-label={`Engine property ${i + 1} value`} placeholder="value" value={v.value} onChange={e => set(i, 'value', e.target.value)} />}</td>
            <td><input className="inp" aria-label={`Engine property ${i + 1} description`} placeholder="Description" value={v.description || ''} onChange={e => set(i, 'description', e.target.value)} /></td>
            <td><button className="x" aria-label="Remove Engine property" onClick={() => setVars(vs => vs!.filter((_, j) => j !== i))}>✕</button></td>
          </tr>
        ))}
      </tbody></table>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn small" onClick={() => setVars(vs => [...vs!, { name: '', value: '' }])}>+ Variable</button>
        <button className="btn primary" onClick={() => put('/api/engine-variables', vars).then(v => { setVars(v); toast('Engine properties saved'); }).catch(e => toast(e.message, true))}>Save</button>
      </div>
    </div>
  );
}

/** Script activities run commands on this server: only when the administrator allows them. */
function ScriptsPolicy() {
  const toast = useToast();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [py, setPy] = useState<{ ok: boolean; message: string; configured: string; fromEnv: string } | null>(null);
  const [pyPath, setPyPath] = useState('');
  useEffect(() => { get<{ allowed: boolean }>('/api/scripts/policy').then(p => setAllowed(p.allowed)).catch(() => {}); }, []);
  useEffect(() => { get<any>('/api/scripts/python').then(p => { setPy(p); setPyPath(p.configured || ''); }).catch(() => {}); }, []);
  if (allowed === null) return null;
  return (
    <div className="card">
      <h2>Scripts</h2>
      <p className="muted" style={{ fontSize: 13 }}>The Scripts palette (PowerShell script, Shell script, Python script, Run program) runs commands on this server with the SutraFlow service account's rights. Values reach scripts as environment variables, never as script text.</p>
      <label className="check">
        <input type="checkbox" checked={allowed} onChange={e => put<{ allowed: boolean }>('/api/scripts/policy', { allowed: e.target.checked }).then(p => { setAllowed(p.allowed); toast(p.allowed ? 'Script activities are allowed' : 'Script activities are switched off'); }).catch(err => toast(err.message, true))} />
        Allow script activities to run on this server
      </label>
      {py && <>
        <p className="h" style={{ marginTop: 14 }}>Python</p>
        <div className={py.ok ? 'okbox' : 'warnbox'} role="status">{py.message}{py.fromEnv ? ' (from SUTRA_PYTHON)' : ''}</div>
        <div className="row" style={{ marginTop: 8 }}>
          <input className="inp code" aria-label="Python interpreter path" style={{ flex: 1 }} value={pyPath} placeholder={'Empty = found automatically (py, python3, python)'} onChange={e => setPyPath(e.target.value)} />
          <button className="btn small" onClick={() => put<any>('/api/scripts/python', { path: pyPath }).then(p => { setPy(p); toast(p.message); }).catch(err => toast(err.message, true))}>Use</button>
          <button className="btn small" onClick={() => get<any>('/api/scripts/python').then(p => { setPy(p); toast(p.message, !p.ok); }).catch(err => toast(err.message, true))}>Check again</button>
        </div>
        <p className="muted xs">Python steps use this interpreter unless they name a virtual environment or their own. The designer and Deploy warn when Python, a script file or a package is missing.</p>
      </>}
    </div>
  );
}

/** Release activities build and deploy packages from Sutras: only when the administrator allows them. */
function ReleasesPolicy() {
  const toast = useToast();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => { get<{ allowed: boolean }>('/api/releases/policy').then(p => setAllowed(p.allowed)).catch(() => {}); }, []);
  if (allowed === null) return null;
  return (
    <div className="card">
      <h2>Release activities</h2>
      <p className="muted" style={{ fontSize: 13 }}>The Release palette (Build package, Check package, Deploy package, Roll back) lets a Sutra release projects, on this server or on remote engines with their admin tokens from the vault.</p>
      <label className="check">
        <input type="checkbox" checked={allowed} onChange={e => put<{ allowed: boolean }>('/api/releases/policy', { allowed: e.target.checked }).then(p => { setAllowed(p.allowed); toast(p.allowed ? 'Release activities are allowed' : 'Release activities are switched off'); }).catch(err => toast(err.message, true))} />
        Allow release activities on this server
      </label>
    </div>
  );
}
