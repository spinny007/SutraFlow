import { useCallback, useEffect, useState } from 'react';
import { get, post, put } from './api';
import { fmtTime, useToast } from './ui';

interface ServerInfo {
  gateway: { host: string; httpPort: number; httpsPort: number };
  status: { http: string; https: string; error: string };
  tls: { mode: string; domains: string[]; email: string; staging: boolean; agreeTos: boolean; clientCaPem: string };
  cert: null | { source: string; subject?: string; issuer?: string; altNames?: string; validTo?: string; daysLeft?: number; fingerprint256?: string; error?: string };
  acme: { state: string; message: string; at?: string };
  routes: { kind: string; method: string; path: string; flow: string; version: number; step: string; policy: string | null; urls: string[]; wsdl?: string }[];
  schedulerErrors: string[];
  listeners: { flow: string; step: string; type: string; state: string; message: string; at: string }[];
  engine: Record<string, number>;
  admin: { host: string; port: number };
}

export function Server() {
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
  if (!info || !gw || !tls) return <div className="page muted">Loading</div>;
  const domainsText = tls.domains.join(', ');

  return (
    <div className="page"><div className="page-inner">
      <h1>Server & APIs</h1>
      <p className="lead">Deployed REST and SOAP services run on the gateway listeners below, separate from this studio ({info.admin.host}:{info.admin.port}).</p>

      <div className="card">
        <h2>Exposed services</h2>
        {info.routes.length ? (
          <div style={{ overflowX: 'auto' }}><table className="t">
            <thead><tr><th>Type</th><th>Endpoint</th><th>Sutra</th><th>Security policy</th></tr></thead>
            <tbody>{info.routes.map(r => (
              <tr key={r.kind + r.method + r.path}>
                <td><span className="badge">{r.kind === 'soap' ? 'SOAP' : r.method}</span></td>
                <td>{r.urls.map(u => <div key={u}><code>{u}</code></div>)}{r.wsdl && <div className="muted" style={{ fontSize: 12 }}>WSDL: <code>{r.urls[r.urls.length - 1]}?wsdl</code></div>}</td>
                <td>{r.flow} <span className="muted">v{r.version} · {r.step}</span></td>
                <td>{r.policy ?? <span className="badge failed">none: open to anyone</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <p className="muted">Nothing deployed yet. Add a REST service or SOAP service trigger to a Sutra and deploy it.</p>}
        {info.schedulerErrors.length > 0 && <div className="errbox">{info.schedulerErrors.join('\n')}</div>}
        {info.listeners?.length > 0 && (
          <>
            <p className="sub" style={{ marginTop: 12 }}>Listeners (file, email, queue and cloud triggers)</p>
            <table className="t"><tbody>{info.listeners.map(l => (
              <tr key={l.flow + l.step}><td>{l.flow} <span className="muted">· {l.step}</span></td><td><span className={`badge ${l.state === 'ok' ? 'done' : 'failed'}`}>{l.state}</span></td><td className="muted">{l.message}</td></tr>
            ))}</tbody></table>
          </>
        )}
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>Runs: {Object.entries(info.engine).map(([k, v]) => `${k} ${v}`).join(' · ')}</p>
      </div>

      <EngineVariables />

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
    </div></div>
  );
}

/** Sengine variables: server settings by the administrator, shared by all projects; {{ev.NAME}} or get-sengine-variable('NAME'). */
function EngineVariables() {
  const toast = useToast();
  const [vars, setVars] = useState<{ name: string; value: string; description?: string }[] | null>(null);
  const [writable, setWritable] = useState(false);
  useEffect(() => { get('/api/engine-variables').then(setVars).catch(e => toast(e.message, true)); }, [toast]);
  useEffect(() => { get<{ sutrasMayChange: boolean }>('/api/engine-variables/policy').then(p => setWritable(p.sutrasMayChange)).catch(() => {}); }, []);
  if (!vars) return null;
  const set = (i: number, k: 'name' | 'value' | 'description', v: string) => setVars(vs => vs!.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <div className="card">
      <h2>Sengine variables</h2>
      <p className="muted" style={{ fontSize: 13 }}>Server settings made by the administrator and shared by every project. Sutras read them: <code>{'{{ev.NAME}}'}</code> in settings, <code>{'{ev.NAME}'}</code> or <code>{"get-sengine-variable('NAME')"}</code> in formulas. Values may read environment variables with <code>{'${env:NAME}'}</code>. Change them here, not from Sutras.</p>
      <table className="t"><tbody>
        {vars.map((v, i) => (
          <tr key={i}>
            <td><input className="inp code" aria-label={`Sengine variable ${i + 1} name`} placeholder="NAME" value={v.name} onChange={e => set(i, 'name', e.target.value)} /></td>
            <td><input className="inp code" aria-label={`Sengine variable ${i + 1} value`} placeholder="value" value={v.value} onChange={e => set(i, 'value', e.target.value)} /></td>
            <td><input className="inp" aria-label={`Sengine variable ${i + 1} description`} placeholder="Description" value={v.description || ''} onChange={e => set(i, 'description', e.target.value)} /></td>
            <td><button className="x" aria-label="Remove Sengine variable" onClick={() => setVars(vs => vs!.filter((_, j) => j !== i))}>✕</button></td>
          </tr>
        ))}
      </tbody></table>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn small" onClick={() => setVars(vs => [...vs!, { name: '', value: '' }])}>+ Variable</button>
        <button className="btn primary" onClick={() => put('/api/engine-variables', vars).then(v => { setVars(v); toast('Sengine variables saved'); }).catch(e => toast(e.message, true))}>Save</button>
      </div>
      <label className="check" style={{ marginTop: 12 }}>
        <input type="checkbox" checked={writable} onChange={e => put<{ sutrasMayChange: boolean }>('/api/engine-variables/policy', { sutrasMayChange: e.target.checked }).then(p => { setWritable(p.sutrasMayChange); toast(p.sutrasMayChange ? 'Sutras may now change Sengine variables' : 'Sengine variables are read-only for Sutras'); }).catch(err => toast(err.message, true))} />
        Allow Sutras to change Sengine variables (set-sengine-variable). Not advised: one Sutra could change the behaviour of every project.
      </label>
    </div>
  );
}
