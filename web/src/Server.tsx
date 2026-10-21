/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.9.1
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { useEffect, useState } from 'react';
import { get } from './api';
import { useToast } from './ui';

interface ServicesInfo {
  routes: { kind: string; method: string; path: string; flow: string; version: number; step: string; policy: string | null; urls: string[]; wsdl?: string; flowId?: string; tool?: string }[];
  schedulerErrors: string[];
  listeners: { flow: string; step: string; type: string; state: string; message: string; at: string }[];
  engine: Record<string, number>;
}

/** Read-only service inventory for workflow authors. Server-wide controls live in the Admin Console. */
export function Server() {
  const toast = useToast();
  const [info, setInfo] = useState<ServicesInfo | null>(null);
  useEffect(() => { get<ServicesInfo>('/api/server').then(setInfo).catch(e => toast(e.message, true)); }, [toast]);
  if (!info) return <div className="page muted">Loading</div>;
  return (
    <div className="page"><div className="page-inner">
      <h1>Services</h1>
      <p className="lead">Read-only addresses and listener health for deployed REST, SOAP and MCP services. Administrators manage runtime, gateway and TLS settings in the Admin Console.</p>
      <div className="card">
        <h2>Published services</h2>
        {info.routes.length ? (
          <div style={{ overflowX: 'auto' }}><table className="t">
            <thead><tr><th>Type</th><th>Endpoint</th><th>Sutra</th><th>Security policy</th></tr></thead>
            <tbody>{info.routes.map(r => (
              <tr key={r.kind + r.method + r.path + r.flowId + r.step}>
                <td><span className="badge">{r.kind === 'soap' ? 'SOAP' : r.kind === 'mcp' ? 'MCP skill' : r.method}</span></td>
                <td>{r.urls.map(u => <div key={u}><code>{u}</code></div>)}{r.wsdl && <div className="muted" style={{ fontSize: 12 }}>WSDL: <code>{r.urls[r.urls.length - 1]}?wsdl</code></div>}
                  {r.kind === 'mcp' && <div className="muted" style={{ fontSize: 12 }}>Tool <code>{r.tool}</code>. Connect Claude Code: <code>{`claude mcp add --transport http ${(r.path.split('/').pop() || 'sutraflow')} ${r.urls[r.urls.length - 1]}${r.policy ? ' --header "X-API-Key: <key>"' : ''}`}</code></div>}</td>
                <td>{r.flow} <span className="muted">v{r.version} · {r.step}</span></td>
                <td>{r.policy ?? <span className="badge failed">none: open to anyone</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <p className="muted">Nothing deployed yet. Add a REST service, SOAP service or MCP skill trigger to a Sutra and deploy it.</p>}
        {info.schedulerErrors.length > 0 && <div className="errbox">{info.schedulerErrors.join('\n')}</div>}
        {info.listeners?.length > 0 && <>
          <p className="sub" style={{ marginTop: 12 }}>Listeners (file, email, queue and cloud triggers)</p>
          <table className="t"><tbody>{info.listeners.map(l => (
            <tr key={l.flow + l.step}><td>{l.flow} <span className="muted">· {l.step}</span></td><td><span className={`badge ${l.state === 'ok' ? 'done' : 'failed'}`}>{l.state}</span></td><td className="muted">{l.message}</td></tr>
          ))}</tbody></table>
        </>}
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>Runs: {Object.entries(info.engine).map(([k, v]) => `${k} ${v}`).join(' · ')}</p>
      </div>
    </div></div>
  );
}
