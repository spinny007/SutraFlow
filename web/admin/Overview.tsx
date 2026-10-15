import { useCallback } from 'react';
import { post } from '../src/api';
import { useToast } from '../src/ui';
import { PageHead, State, Err, Empty, useLoad, useEvery, ago, can, useMe } from './shared';

interface OverviewData {
  version: string; mode: string; self: string;
  ready: { ready: boolean; reasons?: string[] };
  cluster: { leader: string | null; engines: { id: string; alive: boolean; leader: boolean; draining: boolean; running: number; workers: number }[]; tasks: { pending: number; running: number; waiting: number; paused: number } };
  sutras: { running: number; stopped: number };
  runs24h: { done: number; failed: number; running: number; cancelled: number };
  approvals: number;
  failures: { id: string; flowName: string; error: string; startedAt: string; source: string; projectId: string }[];
  gateway: { http: string; https: string; error: string; certExpires: string | null };
}

export function Overview({ go }: { go(p: any): void }) {
  const { me } = useMe();
  const toast = useToast();
  const { data, error, reload } = useLoad<OverviewData>('/api/console/overview');
  useEvery(useCallback(() => { reload(); }, [reload]), 10000);
  if (!data) return <><PageHead title="Overview" /><Err text={error} /></>;
  const alive = data.cluster.engines.filter(e => e.alive).length;
  const certDays = data.gateway.certExpires ? Math.round((new Date(data.gateway.certExpires).getTime() - Date.now()) / 86400000) : null;
  const resubmit = async (id: string) => {
    try { await post(`/api/runs/${id}/resubmit`); toast('Run resubmitted'); reload(); } catch (e: any) { toast(e.message, true); }
  };
  const tiles = [
    { label: 'Engines', value: `${alive} of ${data.cluster.engines.length}`, note: data.cluster.leader ? `leader ${data.cluster.leader}` : 'no leader', state: alive === data.cluster.engines.length && alive > 0 ? 'ok' : 'err', to: 'engines' },
    { label: 'Deployed Sutras', value: String(data.sutras.running), note: data.sutras.stopped ? `${data.sutras.stopped} stopped` : 'all started', state: data.sutras.stopped ? 'warn' : 'ok', to: 'apps' },
    { label: 'Runs, last 24 h', value: String(data.runs24h.done + data.runs24h.failed + data.runs24h.running + data.runs24h.cancelled), note: `${data.runs24h.failed} failed, ${data.runs24h.running} in progress`, state: data.runs24h.failed ? 'err' : 'ok', to: 'apps' },
    { label: 'Waiting approvals', value: String(data.approvals), note: data.approvals ? 'people are waiting' : 'none', state: data.approvals ? 'warn' : 'ok', to: 'approvals' },
    { label: 'Work queue', value: String(data.cluster.tasks.pending), note: `${data.cluster.tasks.running} running, ${data.cluster.tasks.waiting} waiting`, state: data.cluster.tasks.pending > 50 ? 'warn' : 'ok', to: 'engines' },
    { label: 'Gateway', value: data.gateway.error ? 'Problem' : data.gateway.http || data.gateway.https ? 'Listening' : 'Off', note: data.gateway.error || (certDays !== null ? `certificate ends in ${certDays} d` : 'no certificate'), state: data.gateway.error || (certDays !== null && certDays < 14) ? 'err' : 'ok' },
  ];
  return (
    <>
      <PageHead title="Overview" sub={<>This server: <code>{data.self}</code>{data.ready.ready ? ' · ready' : ` · not ready: ${(data.ready.reasons || []).join(', ')}`}</>}>
        <button className="btn small" onClick={reload}>Refresh</button>
      </PageHead>
      <Err text={error} />
      <div className="c-tiles">
        {tiles.map(t => (
          <button key={t.label} className={`c-tile ${t.state}`} onClick={() => t.to && go(t.to)} disabled={!t.to}>
            <span className="c-tile-label">{t.label}</span>
            <span className="c-tile-value">{t.value}</span>
            <span className="c-tile-note">{t.note}</span>
          </button>
        ))}
      </div>
      <section className="c-section">
        <h2>Recent failures</h2>
        {data.failures.length ? (
          <div className="c-tablewrap"><table className="t c-table">
            <thead><tr><th>When</th><th>Sutra</th><th>Started by</th><th>Error</th><th /></tr></thead>
            <tbody>{data.failures.map(f => (
              <tr key={f.id}>
                <td className="nowrap" title={f.startedAt}>{ago(f.startedAt)}</td>
                <td><strong>{f.flowName}</strong></td>
                <td>{f.source}</td>
                <td className="c-err">{f.error}</td>
                <td className="right">{can(me, 'operate', f.projectId) && f.source !== 'test' && f.source !== 'debug' && <button className="btn small" onClick={() => resubmit(f.id)}>Resubmit</button>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty title="No failed runs">Failed runs of deployed Sutras appear here with their error.</Empty>}
      </section>
      <section className="c-section">
        <h2>Engines</h2>
        <div className="c-chips">
          {data.cluster.engines.map(e => (
            <span key={e.id} className="c-chip">
              <State kind={!e.alive ? 'err' : e.draining ? 'warn' : 'ok'}>{!e.alive ? 'silent' : e.draining ? 'draining' : 'alive'}</State>
              <code>{e.id}</code>{e.leader && <span className="c-badge">leader</span>}<span className="muted xs">{e.running}/{e.workers} steps</span>
            </span>
          ))}
        </div>
      </section>
    </>
  );
}
