/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 2.0.9
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { useEffect, useRef, useState } from 'react';
import { post } from './api';

interface Impact {
  contentChanged: boolean;
  schemaUpdatedAt: string;
  changes: { path: string; change: string }[];
  affected: { flowId: string; name: string; deployed: boolean; uses: { nodeId: string; activity: string; field: string }[]; diagnostics: { nodeId: string; activity: string; severity: string; message: string }[] }[];
  limitations: string[];
}
/** One report UI for both schema editors; proposed definitions are never saved by this control. */
export function SchemaImpact({ id, kind, text, root }: { id: string; kind: string; text: string; root: string }) {
  const [report, setReport] = useState<Impact | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const epoch = useRef(0);
  useEffect(() => { epoch.current++; setReport(null); setError(''); setBusy(false); return () => { epoch.current++; }; }, [id, kind, text, root]);
  const check = async () => {
    const request = ++epoch.current;
    setBusy(true); setReport(null); setError('');
    try { const result = await post<Impact>(`/api/schemas/${encodeURIComponent(id)}/impact`, { kind, text, root }); if (request === epoch.current) setReport(result); }
    catch (e: any) { if (request === epoch.current) setError(e.message); }
    finally { if (request === epoch.current) setBusy(false); }
  };
  return <div className="schema-impact">
    <button type="button" className="btn" onClick={check} disabled={busy || !text.trim()}>{busy ? 'Checking impact…' : 'Check schema change impact'}</button>
    <p className="hint">Read-only analysis of saved drafts. Does not change mappings or certify runtime compatibility.</p>
    {error && <div className="errbox" role="alert">{error}</div>}
    {report && <div aria-live="polite">
      <p className="hint">Compared with saved schema version {report.schemaUpdatedAt}. {report.contentChanged ? 'The proposed definition differs from the saved definition.' : 'The proposed definition is unchanged.'}</p>
      <h3>Structural changes ({report.changes.length})</h3>
      {!report.changes.length && <p>No structural field changes detected. Constraint changes may still affect runtime validation.</p>}
      <ul>{report.changes.map(c => <li key={c.path}><code>{c.path}</code>: {c.change}</li>)}</ul>
      <h3>Affected Sutras ({report.affected.length})</h3>
      {report.affected.map(f => <section key={f.flowId}><b>{f.name}</b>{f.deployed && <p className="warnbox">This Sutra is deployed. Review and retest its deployed version separately.</p>}
        <ul>{f.uses.map((u, i) => <li key={`${u.nodeId}-${i}`}>{u.activity}: {u.field}</li>)}</ul>
        {f.diagnostics.length ? <ul>{f.diagnostics.map((d, i) => <li key={i}>{d.severity}: {d.activity} — {d.message}</li>)}</ul> : <p>No new structural diagnostics. Runtime tests are still required.</p>}
      </section>)}
      {report.limitations.map(t => <p className="hint" key={t}>{t}</p>)}
    </div>}
  </div>;
}
