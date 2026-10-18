import { useCallback, useState } from 'react';
import { act } from './log';
import { useToast } from '../src/ui';
import { PageHead, Err, Empty, useLoad, useEvery, ago, when } from './shared';

interface Approval { id: number; runId: string; flowName: string; startedAt: string; step: string; wait: { kind?: string; message?: string; assignee?: string; question?: boolean }; input: unknown }

/** Runs waiting for a person's decision. */
export function Approvals() {
  const toast = useToast();
  const { data, error, reload } = useLoad<Approval[]>('/api/approvals');
  useEvery(useCallback(() => { reload(); }, [reload]), 10000);
  const [comments, setComments] = useState<Record<number, string>>({});
  const list = (data || []).filter(a => a.wait?.kind === 'approval');
  const decide = async (a: Approval, approved: boolean) => {
    const comment = comments[a.id] || '';
    try { await act({ label: `${approved ? 'Approve' : 'Reject'} ${a.flowName}: ${a.step}`, method: 'POST', url: `/api/approvals/${a.id}`, body: { approved, comment }, cli: ['approvals', approved ? 'approve' : 'reject', String(a.id), ...(comment ? ['--comment', comment] : [])] }); toast(approved ? 'Approved' : 'Rejected'); reload(); } catch (e: any) { toast(e.message, true); }
  };
  return (
    <>
      <PageHead title="Approvals" sub="Running Sutras waiting for a decision. You see those of projects you may view; deciding needs the Approve permission.">
        <button className="btn small" onClick={reload}>Refresh</button>
      </PageHead>
      <Err text={error} />
      {data && !list.length && <Empty title="Nothing is waiting">Approval steps of running Sutras appear here.</Empty>}
      <div className="c-cards">
        {list.map(a => (
          <article key={a.id} className="c-card">
            <div className="c-cardhead"><strong>{a.flowName}</strong><span className="muted xs" title={when(a.startedAt)}>started {ago(a.startedAt)}</span></div>
            <div className="muted xs">Step {a.step}{a.wait.assignee ? ` · for ${a.wait.assignee}` : ''}</div>
            <p className="c-message">{a.wait.message || 'No message.'}</p>
            {a.input != null && <details><summary className="muted xs">What the step received</summary><pre className="c-code">{JSON.stringify(a.input, null, 2).slice(0, 4000)}</pre></details>}
            <div className="fld" style={{ marginTop: 10 }}>
              <label htmlFor={`c-ap-${a.id}`}>{a.wait.question ? 'Answer' : 'Comment'}</label>
              {a.wait.question
                ? <textarea id={`c-ap-${a.id}`} rows={3} value={comments[a.id] || ''} onChange={e => setComments(c => ({ ...c, [a.id]: e.target.value }))} />
                : <input id={`c-ap-${a.id}`} type="text" value={comments[a.id] || ''} onChange={e => setComments(c => ({ ...c, [a.id]: e.target.value }))} />}
            </div>
            <div className="c-actions">
              <button className="btn go" disabled={!!a.wait.question && !(comments[a.id] || '').trim()} onClick={() => decide(a, true)}>{a.wait.question ? 'Send answer' : 'Approve'}</button>
              <button className="btn c-danger-soft" onClick={() => decide(a, false)}>{a.wait.question ? 'Decline' : 'Reject'}</button>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
