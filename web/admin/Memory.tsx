/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { useCallback, useState } from 'react';
import { useToast } from '../src/ui';
import { act, type Action } from './log';
import { PageHead, Err, Empty, Confirm, State, useLoad, useEvery, useMe, can, when } from './shared';

interface Settings { key: string; source: string; database: string; loadSql: string; lookupSql: string; refreshMinutes: number; ttlSeconds: number; maxRows: number; maxMb: number; keep: string }
interface Table {
  id: string; name: string; project: string | null; rows: number; bytes: number; hits: number; misses: number; loads: number;
  loadedAt: string | null; version: number; failsafe: boolean; source: string; lastError: string | null; settings: Settings; notLoaded?: boolean;
}
interface Rows { total: number; offset: number; limit: number; fields: string[]; rows: { key: string; row: any; expiresAt: string | null }[] }

const kb = (n: number) => (n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`);
const rate = (t: Table) => (t.hits + t.misses ? `${Math.round((t.hits / (t.hits + t.misses)) * 100)}%` : '-');
const PAGE = 50;

/**
 * Memory tables: small reference data each engine keeps in memory. Their settings and figures on the
 * engine serving this console, their rows a page at a time with filters, hot reload (every engine),
 * and values changed by hand.
 */
export function Memory() {
  const { me } = useMe();
  const toast = useToast();
  const apps = useLoad<{ id: string; name: string }[]>('/api/console/apps');
  const [project, setProject] = useState('');
  const [find, setFind] = useState('');
  const [keep, setKeep] = useState('');
  const qs = new URLSearchParams({ ...(project ? { project } : {}), ...(find ? { find } : {}), ...(keep ? { keep } : {}) }).toString();
  const list = useLoad<Table[]>(`/api/console/memory${qs ? `?${qs}` : ''}`, [qs]);
  useEvery(useCallback(() => { list.reload(); }, [list.reload]), 10000);
  const [open, setOpen] = useState<string>('');
  const [confirm, setConfirm] = useState<{ action: Action; title: string; text: string; danger?: boolean } | null>(null);
  const projectName = (id: string | null) => apps.data?.find(p => p.id === id)?.name || (id ? id.slice(0, 8) : 'no project');
  const mayChange = can(me, 'deploy');
  const current = list.data?.find(t => t.id === open);
  return (
    <>
      <PageHead title="Memory tables" sub="Small reference data each engine keeps in memory for lookups without a database round trip: codes, rates, routing, reusable values. Big data stays in the database or is streamed." />
      <div className="c-filters">
        <div className="fld"><label htmlFor="m-proj">Project</label>
          <select id="m-proj" className="inp" value={project} onChange={e => setProject(e.target.value)}>
            <option value="">All projects</option>{(apps.data || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></div>
        <div className="fld"><label htmlFor="m-find">Name</label><input id="m-find" className="inp" value={find} placeholder="Contains" onChange={e => setFind(e.target.value)} /></div>
        <div className="fld"><label htmlFor="m-keep">Failsafe</label>
          <select id="m-keep" className="inp" value={keep} onChange={e => setKeep(e.target.value)}>
            <option value="">All</option><option value="copy in the database">Copy in the database</option><option value="memory only">Memory only</option>
          </select></div>
      </div>
      <Err text={list.error} />
      {list.data && !list.data.length && <Empty title="No memory tables">Make one in the designer: Resources, New, Memory table.</Empty>}
      {list.data && list.data.length > 0 && (
        <table className="t c-table">
          <thead><tr><th>Table</th><th>Project</th><th>Rows</th><th>Memory</th><th>Hit rate</th><th>Loaded</th><th>Failsafe</th><th></th></tr></thead>
          <tbody>{list.data.map(t => (
            <tr key={t.id} aria-selected={open === t.id}>
              <td><button className="btn link c-name" aria-expanded={open === t.id} onClick={() => setOpen(open === t.id ? '' : t.id)}><b>{t.name}</b></button>{t.lastError && <div className="xs"><State kind="err">{t.lastError}</State></div>}</td>
              <td>{projectName(t.project)}</td>
              <td>{t.notLoaded ? <span className="muted">not loaded here</span> : `${t.rows.toLocaleString()} of ${t.settings.maxRows.toLocaleString()}`}</td>
              <td>{t.notLoaded ? '' : `${kb(t.bytes)} of ${t.settings.maxMb} MB`}</td>
              <td>{rate(t)}</td>
              <td>{t.loadedAt ? when(t.loadedAt) : ''}</td>
              <td>{t.failsafe ? <State kind="ok">copy in the database</State> : <State kind="idle">memory only</State>}</td>
              <td className="c-actions">{mayChange && <>
                <button className="btn small" onClick={() => setConfirm({ title: `Reload ${t.name}`, text: t.settings.source === 'database query' ? 'Loads the table again from its load query, on this engine now and on every other engine within a second. Rows added by Sutras or by hand are replaced.' : 'This table is filled by Sutras: reloading empties it on every engine.', action: { label: `Reload memory table ${t.name}`, method: 'POST', url: `/api/console/memory/${t.id}/reload`, cli: ['memory', 'reload', t.name, '--project', projectName(t.project)] } })}>Reload</button>
                <button className="btn small" onClick={() => setConfirm({ title: `Clear ${t.name}`, danger: true, text: 'Removes every row. A table with a lookup query fetches rows again as they are asked for.', action: { label: `Clear memory table ${t.name}`, method: 'POST', url: `/api/console/memory/${t.id}/clear`, cli: ['memory', 'clear', t.name, '--project', projectName(t.project)] } })}>Clear</button>
              </>}</td>
            </tr>))}
          </tbody>
        </table>
      )}
      {current && <TableDetail key={current.id} t={current} projectName={projectName(current.project)} mayChange={mayChange} onChanged={() => list.reload()} />}
      {confirm && <Confirm title={confirm.title} action={confirm.title.split(' ')[0]} danger={confirm.danger} cmd={confirm.action} text={confirm.text}
        onYes={async () => { await act(confirm.action); toast(`${confirm.title}: done`); list.reload(); }} onClose={() => setConfirm(null)} />}
    </>
  );
}

/** One table: its settings, figures, and rows a page at a time, with filters and changes by hand. */
function TableDetail({ t, projectName, mayChange, onChanged }: { t: Table; projectName: string; mayChange: boolean; onChanged(): void }) {
  const toast = useToast();
  const [find, setFind] = useState('');
  const [field, setField] = useState('');
  const [value, setValue] = useState('');
  const [offset, setOffset] = useState(0);
  const [edit, setEdit] = useState<{ key: string; text: string } | null>(null);
  const [err, setErr] = useState('');
  const qs = new URLSearchParams({ offset: String(offset), limit: String(PAGE), ...(find ? { find } : {}), ...(field ? { field, value } : {}) }).toString();
  const rows = useLoad<Rows>(`/api/console/memory/${t.id}/rows?${qs}`, [qs]);
  const s = t.settings;
  const save = async () => {
    if (!edit) return;
    setErr('');
    try {
      const row = JSON.parse(edit.text);
      await act({ label: `Set ${edit.key || 'a row'} in memory table ${t.name}`, method: 'PUT', url: `/api/console/memory/${t.id}/rows`, body: { key: edit.key || undefined, row },
        cli: ['memory', 'set', t.name, '--project', projectName, ...(edit.key ? ['--key', edit.key] : []), '--row', JSON.stringify(row)] });
      toast(`${t.name}: saved${t.failsafe ? ', every engine has it within a second' : ' on this engine'}`);
      setEdit(null); rows.reload(); onChanged();
    } catch (e: any) { setErr(e instanceof SyntaxError ? `The row is not JSON: ${e.message}` : e.message); }
  };
  const remove = async (key: string) => {
    await act({ label: `Remove ${key} from memory table ${t.name}`, method: 'DELETE', url: `/api/console/memory/${t.id}/rows/${encodeURIComponent(key)}`, cli: ['memory', 'remove', t.name, '--project', projectName, '--key', key] });
    rows.reload(); onChanged();
  };
  const total = rows.data?.total ?? 0;
  return (
    <section className="c-card" aria-label={`Memory table ${t.name}`}>
      <div className="c-cardhead"><strong>{t.name}</strong><span className="muted xs">{projectName}</span></div>
      <table className="t c-table"><tbody>
        <tr><th>Key</th><td>{s.key}</td><th>Rows come from</th><td>{s.source}{s.database ? ` (${s.database})` : ''}</td></tr>
        <tr><th>Refresh</th><td>{s.refreshMinutes ? `every ${s.refreshMinutes} min` : 'on demand'}</td><th>Rows expire</th><td>{s.ttlSeconds ? `after ${s.ttlSeconds} s` : 'never'}</td></tr>
        <tr><th>Limits</th><td>{s.maxRows.toLocaleString()} rows, {s.maxMb} MB (least recently used go first)</td><th>Failsafe</th><td>{s.keep}</td></tr>
        <tr><th>Figures here</th><td colSpan={3}>{t.rows.toLocaleString()} rows, {kb(t.bytes)}, {t.hits.toLocaleString()} hits, {t.misses.toLocaleString()} misses, loaded {t.loads} times, change {t.version}</td></tr>
        {s.loadSql && <tr><th>Load query</th><td colSpan={3}><pre className="c-code">{s.loadSql}</pre></td></tr>}
        {s.lookupSql && <tr><th>Lookup query</th><td colSpan={3}><pre className="c-code">{s.lookupSql}</pre></td></tr>}
      </tbody></table>
      <p className="hint">The settings are changed in the designer (Resources); this page shows them and the rows. A change by hand is saved like Memory put{t.failsafe ? ' and reaches every engine' : ', on this engine only (memory only)'}.</p>
      <div className="c-filters">
        <div className="fld"><label htmlFor="mr-find">Find</label><input id="mr-find" className="inp" value={find} placeholder="In keys and values" onChange={e => { setFind(e.target.value); setOffset(0); }} /></div>
        <div className="fld"><label htmlFor="mr-field">Field</label>
          <select id="mr-field" className="inp" value={field} onChange={e => { setField(e.target.value); setOffset(0); }}>
            <option value="">Any</option>{(rows.data?.fields || []).map(f => <option key={f} value={f}>{f}</option>)}
          </select></div>
        {field && <div className="fld"><label htmlFor="mr-value">Equals</label><input id="mr-value" className="inp" value={value} onChange={e => { setValue(e.target.value); setOffset(0); }} /></div>}
        {mayChange && <div className="fld"><label>&nbsp;</label><button className="btn small" onClick={() => setEdit({ key: '', text: '{\n  "' + s.key.split(',')[0] + '": ""\n}' })}>Add row</button></div>}
      </div>
      <Err text={rows.error || err} />
      {edit && (
        <div className="c-card">
          <div className="fld"><label htmlFor="mr-row">{edit.key ? `Row ${edit.key}` : 'New row'} (JSON)</label>
            <textarea id="mr-row" className="inp" rows={8} value={edit.text} onChange={e => setEdit({ ...edit, text: e.target.value })} /></div>
          <div className="c-actions"><button className="btn primary small" onClick={save}>Save</button><button className="btn small" onClick={() => setEdit(null)}>Cancel</button></div>
        </div>
      )}
      {rows.data && (
        <>
          <table className="t c-table">
            <thead><tr><th>Key</th><th>Row</th><th>Expires</th><th></th></tr></thead>
            <tbody>{rows.data.rows.map(r => (
              <tr key={r.key}>
                <td><code>{r.key}</code></td>
                <td><code className="xs">{JSON.stringify(r.row).slice(0, 300)}</code></td>
                <td>{r.expiresAt ? when(r.expiresAt) : ''}</td>
                <td className="c-actions">{mayChange && <>
                  <button className="btn small" onClick={() => setEdit({ key: r.key, text: JSON.stringify(r.row, null, 2) })}>Edit</button>
                  <button className="btn small" onClick={() => remove(r.key)}>Remove</button>
                </>}</td>
              </tr>))}
              {!rows.data.rows.length && <tr><td colSpan={4} className="muted">No rows{find || field ? ' match' : ''}</td></tr>}
            </tbody>
          </table>
          <div className="c-actions">
            <span className="muted xs">{total ? `${offset + 1} to ${Math.min(offset + PAGE, total)} of ${total.toLocaleString()}` : ''}</span>
            <button className="btn small" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</button>
            <button className="btn small" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>Next</button>
          </div>
        </>
      )}
    </section>
  );
}
