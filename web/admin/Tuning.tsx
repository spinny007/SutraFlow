import { useState } from 'react';
import { useToast } from '../src/ui';
import { Err, Confirm, useLoad, can, useMe } from './shared';
import { act, type Action } from './log';

export interface Field { k: string; name: string; help: string; type: 'number' | 'select'; min?: number; max?: number; step?: number; unit?: string; options?: string[]; perEngine?: boolean }

/**
 * A form of tuning values. Empty fields fall back (to the engine setting, or the environment default
 * shown as the placeholder). Saving shows the change and its command first.
 */
export function TuningForm({ fields, values, defaults, readOnly, action, onSaved, idPrefix = 't' }: {
  fields: Field[]; values: Record<string, unknown>; defaults?: Record<string, unknown>; readOnly?: boolean;
  action(values: Record<string, unknown>): Action; onSaved(): void; idPrefix?: string;
}) {
  const [form, setForm] = useState<Record<string, string>>(() => Object.fromEntries(fields.map(f => [f.k, values[f.k] === undefined ? '' : String(values[f.k])])));
  const [confirm, setConfirm] = useState<Action | null>(null);
  const clean = () => Object.fromEntries(Object.entries(form).filter(([, v]) => v !== '').map(([k, v]) => [k, fields.find(f => f.k === k)?.type === 'number' ? Number(v) : v]));
  const changed = fields.some(f => (values[f.k] === undefined ? '' : String(values[f.k])) !== form[f.k]);
  return (
    <form className="c-tuning" onSubmit={e => { e.preventDefault(); setConfirm(action(clean())); }}>
      <div className="c-tuninggrid">
        {fields.map(f => {
          const id = `${idPrefix}-${f.k}`;
          const def = defaults?.[f.k];
          return (
            <div key={f.k} className="fld">
              <label htmlFor={id}>{f.name}{f.unit && <span className="muted xs"> ({f.unit})</span>}</label>
              {f.type === 'select'
                ? <select id={id} value={form[f.k]} disabled={readOnly} onChange={e => setForm({ ...form, [f.k]: e.target.value })}>
                    <option value="">{def !== undefined ? `Default (${def})` : 'Default (all)'}</option>{f.options!.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                : <input id={id} type="number" inputMode="decimal" min={f.min} max={f.max} step={f.step ?? 1} value={form[f.k]} disabled={readOnly}
                    placeholder={def !== undefined ? String(def) : 'engine setting'} onChange={e => setForm({ ...form, [f.k]: e.target.value })} />}
              <div className="hint">{f.help}</div>
            </div>
          );
        })}
      </div>
      {!readOnly && <div className="c-actions">
        <button className="btn primary" type="submit" disabled={!changed}>Save tuning</button>
        {changed && <button className="btn" type="button" onClick={() => setForm(Object.fromEntries(fields.map(f => [f.k, values[f.k] === undefined ? '' : String(values[f.k])])))}>Undo changes</button>}
      </div>}
      {confirm && <Confirm title="Save tuning" action="Save" cmd={confirm}
        text={<>Every engine applies it within a heartbeat, without a restart.<pre className="c-code">{JSON.stringify(confirm.body?.values ?? {}, null, 2)}</pre></>}
        onYes={async () => { await act(confirm); onSaved(); }} onClose={() => setConfirm(null)} />}
    </form>
  );
}

interface EngineTuningData { fields: { engine: Field[] }; defaults: Record<string, number>; cluster: Record<string, number>; perEngine: Record<string, Record<string, number>> }

const ENGINE_FLAGS: Record<string, string> = { workers: 'workers', maxStepsPerRun: 'max-steps', replyTimeoutMs: 'reply-timeout-ms', runRetentionDays: 'retention-days', auditRetentionDays: 'audit-retention-days', traceSampling: 'trace-sampling', memoryWorkers: 'memory-workers', pollMs: 'poll-ms', settingsRefreshMs: 'settings-refresh-ms' };
const flags = (v: Record<string, unknown>) => Object.entries(ENGINE_FLAGS).flatMap(([k, f]) => (v[k] !== undefined ? [`--${f}`, String(v[k])] : []));

/** Engine tuning: values for every engine, and Steps at once per engine. */
export function EngineTuning({ engines }: { engines: { id: string }[] }) {
  const { me } = useMe();
  const toast = useToast();
  const t = useLoad<EngineTuningData>('/api/console/tuning');
  const [engineId, setEngineId] = useState('');
  const ro = !can(me, 'engines');
  if (!t.data) return <Err text={t.error} />;
  const perEngineFields = t.data.fields.engine.filter(f => f.perEngine);
  const clusterEffective = { ...t.data.defaults, ...t.data.cluster };
  return (
    <section className="c-section c-project">
      <h2>Tuning</h2>
      <p className="muted">For every engine of the cluster, applied within a heartbeat without a restart. Empty fields use the value the engine started with (shown greyed).</p>
      <Machine readOnly={ro} cluster={t.data.cluster} onApplied={() => { toast('Recommended tuning applied'); t.reload(); }} />
      <TuningForm key={JSON.stringify(t.data.cluster)} idPrefix="te" fields={t.data.fields.engine} values={t.data.cluster} defaults={t.data.defaults} readOnly={ro}
        action={values => ({ label: 'Tune all engines', method: 'PUT', url: '/api/console/tuning/engine', body: { values }, cli: ['engines', 'tune', ...flags(values)] })}
        onSaved={() => { toast('Engine tuning saved'); t.reload(); }} />
      <h3>One engine</h3>
      <div className="c-filters">
        <label htmlFor="te-engine" className="muted xs">Engine</label>
        <select id="te-engine" className="inp" value={engineId} onChange={e => setEngineId(e.target.value)}>
          <option value="">Choose an engine</option>{engines.map(e => <option key={e.id} value={e.id}>{e.id}{t.data!.perEngine[e.id] ? ' (tuned)' : ''}</option>)}
        </select>
      </div>
      {engineId && <TuningForm key={engineId + JSON.stringify(t.data.perEngine[engineId] || {})} idPrefix="tn" fields={perEngineFields} values={t.data.perEngine[engineId] || {}} defaults={clusterEffective} readOnly={ro}
        action={values => ({ label: `Tune ${engineId}`, method: 'PUT', url: `/api/console/tuning/engines/${encodeURIComponent(engineId)}`, body: { values }, cli: ['engines', 'tune', '--engine', engineId, ...flags(values)] })}
        onSaved={() => { toast(`${engineId} tuning saved`); t.reload(); }} />}
    </section>
  );
}

interface Profile { name: string; machine: string; workers: number; memoryWorkers: number; pollMs: number; settingsRefreshMs: number; engines: number; nodeMemoryMb: number; readWholeMb: number; batchRows: number; database: string }
interface MachineData { engine: string; cpus: number; cpuModel: string; memoryGb: number; freeGb: number; platform: string; node: string; database: string; memoryRuns: number; running: number; recommended: Profile; profiles: Profile[] }

/** The machine of the engine serving this console, and the tuning recommended for it. */
function Machine({ readOnly, cluster, onApplied }: { readOnly: boolean; cluster: Record<string, number>; onApplied(): void }) {
  const m = useLoad<MachineData>('/api/console/machine');
  const [confirm, setConfirm] = useState<Action | null>(null);
  if (!m.data) return <Err text={m.error} />;
  const r = m.data.recommended;
  const values = { workers: r.workers, memoryWorkers: r.memoryWorkers, pollMs: r.pollMs, settingsRefreshMs: r.settingsRefreshMs };
  const applied = Object.entries(values).every(([k, v]) => cluster[k] === undefined || cluster[k] === v);
  return (
    <div className="c-card c-machine">
      <h3>This machine</h3>
      <p className="muted">{m.data.engine}: {m.data.cpus} cores ({m.data.cpuModel}), {m.data.memoryGb} GB memory ({m.data.freeGb} GB free), {m.data.database === 'postgres' ? 'PostgreSQL' : 'SQLite'}. Steps running now: {m.data.running}, runs in memory: {m.data.memoryRuns}.</p>
      <table className="c-table">
        <tbody>
          <tr><th>Profile</th><td>{r.name} ({r.machine})</td></tr>
          <tr><th>Steps at once</th><td>{r.workers} (in memory {r.memoryWorkers})</td></tr>
          <tr><th>Queue check</th><td>{r.pollMs} ms</td></tr>
          <tr><th>Settings refresh</th><td>{r.settingsRefreshMs} ms</td></tr>
          <tr><th>Engines on this machine</th><td>{r.engines} with PostgreSQL (1 with SQLite)</td></tr>
          <tr><th>Node memory per engine</th><td>{r.nodeMemoryMb} MB (node --max-old-space-size)</td></tr>
          <tr><th>Files read whole</th><td>up to {r.readWholeMb} MB; bigger CSV and line files: Stream in batches of {r.batchRows} rows</td></tr>
          <tr><th>Database</th><td>{r.database}</td></tr>
        </tbody>
      </table>
      <p className="hint">Engines start with these values unless environment variables set others. The user guide chapter Sizing and performance has the measurements behind them.</p>
      {!readOnly && <div className="c-actions"><button className="btn" type="button" disabled={applied} onClick={() => setConfirm({ label: 'Apply recommended tuning', method: 'PUT', url: '/api/console/tuning/engine', body: { values: { ...cluster, ...values } }, cli: ['engines', 'tune', ...flags(values)] })}>{applied ? 'Recommended tuning in use' : 'Apply recommended tuning'}</button></div>}
      {confirm && <Confirm title="Apply recommended tuning" action="Apply" cmd={confirm}
        text={<>Every engine applies it within a heartbeat, without a restart.<pre className="c-code">{JSON.stringify(values, null, 2)}</pre></>}
        onYes={async () => { await act(confirm); onApplied(); }} onClose={() => setConfirm(null)} />}
    </div>
  );
}
