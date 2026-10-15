import { useCallback, useState } from 'react';
import { useToast } from '../src/ui';
import { PageHead, State, Err, Confirm, useLoad, useEvery, ago, when, can, useMe } from './shared';
import { act, type Action } from './log';
import { EngineTuning } from './Tuning';

interface EngineRow { id: string; host: string; pid: number; mode: string; version: string; startedAt: string; alive: boolean; heartbeatAgeMs: number; workers: number; running: number; draining: boolean; leader: boolean }
interface ClusterData { self: string; leader: string | null; engines: EngineRow[]; tasks: { pending: number; running: number; waiting: number; paused: number } }

const drainCmd = (id: string): Action => ({ label: `Drain ${id}`, method: 'POST', url: `/api/console/engines/${encodeURIComponent(id)}/drain`, cli: ['engines', 'drain', id] });
const HOUSEKEEPING: Action = { label: 'Delete old runs now', method: 'POST', url: '/api/engine/housekeeping', body: {}, cli: ['engines', 'housekeeping'] };

/** Every engine sharing this database: liveness, leader, load; drain one; tuning. */
export function Engines() {
  const { me } = useMe();
  const toast = useToast();
  const { data, error, reload } = useLoad<ClusterData>('/api/engine/status');
  useEvery(useCallback(() => { reload(); }, [reload]), 5000);
  const [drain, setDrain] = useState<EngineRow | null>(null);
  const [cleanup, setCleanup] = useState(false);
  const manage = can(me, 'engines');
  return (
    <>
      <PageHead title="Engines" sub="Engines sharing this database. Work is shared; the leader also runs timers, listeners, recovery and housekeeping.">
        {manage && <button className="btn small" onClick={() => setCleanup(true)}>Delete old runs now</button>}
        <button className="btn small" onClick={reload}>Refresh</button>
      </PageHead>
      <Err text={error} />
      {data && (
        <>
          <div className="c-tiles c-tiles-sm">
            {(['pending', 'running', 'waiting', 'paused'] as const).map(k => (
              <div key={k} className="c-tile static"><span className="c-tile-label">Steps {k}</span><span className="c-tile-value">{data.tasks[k]}</span></div>
            ))}
          </div>
          <div className="c-tablewrap"><table className="t c-table">
            <thead><tr><th>Engine</th><th>State</th><th>Host</th><th>Mode</th><th>Version</th><th className="right">Steps</th><th>Heartbeat</th><th>Started</th><th /></tr></thead>
            <tbody>{data.engines.map(e => (
              <tr key={e.id}>
                <td><code>{e.id}</code>{e.leader && <span className="c-badge">leader</span>}{e.id === data.self && <span className="c-badge soft">this one</span>}</td>
                <td>{!e.alive ? <State kind="err">silent</State> : e.draining ? <State kind="warn">draining</State> : <State kind="ok">alive</State>}</td>
                <td>{e.host} <span className="muted xs">pid {e.pid}</span></td>
                <td>{e.mode === 'engine' ? 'headless' : e.mode}</td>
                <td>{e.version}</td>
                <td className="right nowrap">{e.running} / {e.workers}</td>
                <td className="nowrap">{Math.round(e.heartbeatAgeMs / 1000)} s ago</td>
                <td className="nowrap" title={when(e.startedAt)}>{ago(e.startedAt)}</td>
                <td className="right">{manage && e.alive && !e.draining && <button className="btn small c-danger-soft" onClick={() => setDrain(e)}>Drain and stop</button>}</td>
              </tr>
            ))}</tbody>
          </table></div>
          <p className="muted xs">An engine silent for three heartbeats is presumed stopped; the leader gives its unfinished steps to the others.</p>
        </>
      )}
      {data && <EngineTuning engines={data.engines} />}
      {drain && <Confirm title={`Drain ${drain.id}`} danger action="Drain and stop" cmd={drainCmd(drain.id)}
        text={<>The engine stops taking new work, gives up leadership, lets running steps finish (up to its drain time), hands the rest to other engines, and stops. Your service manager or orchestrator starts it again.{data && data.engines.filter(x => x.alive && !x.draining).length <= 1 && <strong> It is the only engine: nothing runs until it is started again.</strong>}</>}
        onYes={async () => { await act(drainCmd(drain.id)); toast(`${drain.id} drains on its next heartbeat`); reload(); }} onClose={() => setDrain(null)} />}
      {cleanup && <Confirm title="Delete old runs now" action="Delete" cmd={HOUSEKEEPING}
        text="Finished runs older than the retention period are deleted with their steps, and old audit entries too. The leader also does this every minute."
        onYes={async () => { const r: any = await act(HOUSEKEEPING); toast(`${r.deletedRuns} runs and ${r.deletedAudit ?? 0} audit entries deleted`); }} onClose={() => setCleanup(false)} />}
    </>
  );
}
