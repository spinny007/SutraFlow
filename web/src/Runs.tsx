/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { useCallback, useEffect, useState } from 'react';
import { get, post } from './api';
import { fmtTime, Json, since, useToast } from './ui';
import type { RunDetail } from './types';

interface RunRow { id: string; flowId: string; flowName: string; version: number; status: string; source: string; error: string | null; steps: number; startedAt: string; finishedAt: string | null }
interface Approval { id: number; runId: string; flowName: string; step: string; startedAt: string; wait: { message: string; assignee?: string; question?: boolean }; input: any }

export function Runs() {
  const toast = useToast();
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState<RunDetail | null>(null);
  const [step, setStep] = useState<number | null>(null);
  const [comment, setComment] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    const [r, a] = await Promise.all([get<RunRow[]>(`/api/runs?limit=200${status ? `&status=${status}` : ''}`), get<Approval[]>('/api/approvals')]);
    setRuns(r); setApprovals(a);
  }, [status]);
  useEffect(() => {
    load().catch(e => toast(e.message, true));
    const t = window.setInterval(() => load().catch(() => {}), 4000);
    return () => window.clearInterval(t);
  }, [load, toast]);

  const openRun = (id: string) => get<RunDetail>(`/api/runs/${id}`).then(r => { setOpen(r); setStep(null); }).catch(e => toast(e.message, true));
  const decide = async (a: Approval, approved: boolean) => {
    try {
      await post(`/api/approvals/${a.id}`, { approved, comment: comment[a.id] || '' });
      toast(`${approved ? 'Approved' : 'Rejected'}: ${a.step}`);
      load();
      if (open?.id === a.runId) openRun(a.runId);
    } catch (e: any) { toast(e.message, true); }
  };

  return (
    <div className="page"><div className="page-inner">
      <h1>Runs</h1>
      <p className="lead">Every run is stored with each step's input and output. Secret values are masked.</p>
      {approvals.length > 0 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <h2>Waiting for a person ({approvals.length})</h2>
          {approvals.map(a => (
            <div key={a.id} style={{ borderTop: '1px solid var(--line)', padding: '10px 0' }}>
              <div><b>{a.flowName}</b> · {a.step} <span className="muted" style={{ fontSize: 12 }}>since {fmtTime(a.startedAt)}{a.wait.assignee ? ` · for ${a.wait.assignee}` : ''}</span></div>
              <p style={{ margin: '4px 0 8px', whiteSpace: 'pre-wrap' }}>{a.wait.message}</p>
              <div className="row">
                {a.wait.question
                  ? <textarea className="inp" rows={2} style={{ maxWidth: 420 }} placeholder="Your answer" aria-label="Answer" value={comment[a.id] || ''} onChange={e => setComment(c => ({ ...c, [a.id]: e.target.value }))} />
                  : <input className="inp" style={{ maxWidth: 320 }} placeholder="Comment (optional)" aria-label="Comment" value={comment[a.id] || ''} onChange={e => setComment(c => ({ ...c, [a.id]: e.target.value }))} />}
                <button className="btn go" disabled={!!a.wait.question && !(comment[a.id] || '').trim()} onClick={() => decide(a, true)}>{a.wait.question ? 'Send answer' : 'Approve'}</button>
                <button className="btn danger" onClick={() => decide(a, false)}>{a.wait.question ? 'Decline' : 'Reject'}</button>
                <button className="btn link" onClick={() => openRun(a.runId)}>Open run</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="cols" style={{ gridTemplateColumns: open ? 'minmax(0, 1fr) minmax(0, 1.1fr)' : '1fr' }}>
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>History</h2>
            <select className="inp" style={{ width: 'auto' }} aria-label="Filter by status" value={status} onChange={e => setStatus(e.target.value)}>
              <option value="">All statuses</option>{['running', 'waiting', 'done', 'failed', 'cancelled'].map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="t">
              <thead><tr><th>Started</th><th>Sutra</th><th>Source</th><th>Status</th><th>Steps</th><th>Time</th></tr></thead>
              <tbody>{runs.map(r => (
                <tr key={r.id} className="click" onClick={() => openRun(r.id)} style={open?.id === r.id ? { background: 'var(--paper)' } : undefined}>
                  <td className="muted" style={{ whiteSpace: 'nowrap' }}>{fmtTime(r.startedAt)}</td>
                  <td>{r.flowName}{r.version ? <span className="muted"> v{r.version}</span> : <span className="muted"> draft</span>}</td>
                  <td>{r.source}</td>
                  <td><span className={`badge ${r.status}`}>{r.status}</span></td>
                  <td>{r.steps}</td>
                  <td className="muted">{since(r.startedAt, r.finishedAt)}</td>
                </tr>
              ))}</tbody>
            </table>
            {!runs.length && <p className="muted">No runs yet. Test a Sutra in the designer, call a deployed service, or wait for a timer.</p>}
          </div>
        </div>
        {open && (
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0 }}>{open.flowName} <span className={`badge ${open.status}`}>{open.status}</span></h2>
              <div className="row">
                {['running', 'waiting'].includes(open.status) && <button className="btn danger small" onClick={() => post(`/api/runs/${open.id}/cancel`).then(() => openRun(open.id))}>Cancel run</button>}
                {open.status === 'failed' && <button className="btn small" title="Runs the failed step again with the same input; the earlier steps' results are kept" onClick={() => post(`/api/runs/${open.id}/resubmit`).then(() => openRun(open.id)).catch((e: any) => alert(e.message))}>Run again from the failed step</button>}
                <button className="btn small" onClick={() => openRun(open.id)}>Refresh</button>
                <button className="btn small" onClick={() => setOpen(null)}>Close</button>
              </div>
            </div>
            <p className="muted" style={{ fontSize: 12 }}>Run {open.id} · {open.source} · {open.version ? `version ${open.version}` : 'draft'} · {fmtTime(open.startedAt)} · {since(open.startedAt, open.finishedAt)}</p>
            {open.error && <div className="errbox">{open.error}</div>}
            <table className="t">
              <thead><tr><th>#</th><th>Step</th><th>Status</th><th>Output</th><th>ms</th><th>Engine</th></tr></thead>
              <tbody>{open.tasks.map((t, i) => (
                <tr key={t.id} className="click" onClick={() => setStep(step === t.id ? null : t.id)}>
                  <td className="muted">{i + 1}</td>
                  <td>{open.doc.nodes.find(n => n.id === t.node_id)?.name ?? t.node_id}{t.attempt ? <span className="muted"> (retry {t.attempt})</span> : null}</td>
                  <td><span className={`badge ${t.status}`}>{t.status}</span></td>
                  <td><code>{t.port}</code></td>
                  <td className="muted">{t.ms}</td>
                  <td className="muted xs">{(t as any).owner ?? ''}</td>
                </tr>
              ))}</tbody>
            </table>
            {step != null && (() => {
              const t = open.tasks.find(x => x.id === step)!;
              return <>
                {t.error && <div className="errbox" style={{ marginTop: 10 }}>{t.error}</div>}
                <p className="sub" style={{ marginTop: 10 }}>Received</p><Json value={t.input} />
                {t.output !== null && <><p className="sub">Produced</p><Json value={t.output} /></>}
              </>;
            })()}
            {open.reply && <><p className="sub">Reply sent to the caller</p><Json value={open.reply} /></>}
            {open.logs.length > 0 && <><p className="sub">Log</p><ul className="log">{open.logs.map((l, i) => <li key={i}><time>{l.t.slice(11, 19)}</time><span className={l.level}>{l.step ? `${l.step}: ` : ''}{l.msg}</span></li>)}</ul></>}
          </div>
        )}
      </div>
    </div></div>
  );
}
