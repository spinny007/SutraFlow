/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { useEffect, useState } from 'react';
import { del, get, post, put } from './api';
import { FieldList } from './Fields';
import { Modal, useCatalog, useToast } from './ui';
import { NewProjectDialog } from './NewProject';
import { missingInResource, missingText } from './vars';
import type { FlowSummary, LoggingConfig, ProjectVariable, Resource, SchemaInfo, SNode } from './types';

/** What the right-hand panel shows when a project item (not an activity) is selected. */
export type ExplorerSel =
  | { kind: 'resource'; id: string }
  | { kind: 'newResource'; resourceKind: string }
  | { kind: 'schema'; id: string }
  | { kind: 'newSchema'; schemaKind: 'json' | 'xsd' | 'wsdl' }
  | { kind: 'variables' }
  | { kind: 'ops' }
  | { kind: 'logging' }
  | { kind: 'log' }
  | { kind: 'releases' };

export function ProjectExplorer({ flows, flowId, openFlow, newFlow, sel, setSel, onFlowsChanged }: {
  flows: FlowSummary[]; flowId: string | null; openFlow(id: string): void; newFlow(): void;
  sel: ExplorerSel | null; setSel(s: ExplorerSel | null): void; onFlowsChanged(): void;
}) {
  const { meta, projects, projectId, setProjectId, resources, schemas, project, reload } = useCatalog();
  const toast = useToast();
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [creating, setCreating] = useState(false);
  const [kindMenu, setKindMenu] = useState(false);
  const kindOrder = (kind: string) => meta.resourceKinds.findIndex(k => k.kind === kind);
  const sec = (key: string, title: string, count: number, add?: () => void, children?: React.ReactNode) => (
    <div className="xsec">
      <div className="xhead">
        <button className="tw" aria-label={closed[key] ? 'Expand' : 'Collapse'} onClick={() => setClosed(c => ({ ...c, [key]: !c[key] }))}>{closed[key] ? '▸' : '▾'}</button>
        <b>{title}</b><span className="muted">{count}</span>
        {add && <button className="xadd" title={key === 'res' ? 'New resource' : `New in ${title}`} aria-label={key === 'res' ? 'New resource' : `New in ${title}`} aria-haspopup={key === 'res' ? 'menu' : undefined} onClick={add}>+</button>}
      </div>
      {!closed[key] && <div className="xbody">{children}</div>}
    </div>
  );
  const item = (label: string, active: boolean, onClick: () => void, icon = '·', sub?: string) => (
    <button className={`xitem${active ? ' act' : ''}`} onClick={onClick}><span className="xi">{icon}</span><span className="xl">{label}</span>{sub && <span className="muted xs">{sub}</span>}</button>
  );
  const isSel = (s: Partial<ExplorerSel>) => !!sel && Object.entries(s).every(([k, v]) => (sel as any)[k] === v);


  return (
    <div className="explorer">
      <div className="row" style={{ gap: 6, marginBottom: 6 }}>
        <select className="search" style={{ flex: 1 }} aria-label="Project" value={projectId} onChange={e => { setProjectId(e.target.value); setSel(null); }}>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button className="btn small" title="New project: empty, with samples, from a package file, or a copy" aria-label="New project" onClick={() => setCreating(true)}>+</button>
      </div>
      {project?.description && <p className="muted xs" style={{ margin: '0 2px 6px' }}>{project.description}</p>}
      {sec('proc', 'Sutras', flows.length, newFlow, <FolderTree area="sutras" activeId={sel ? null : flowId} onChanged={onFlowsChanged} open={id => { setSel(null); openFlow(id); }}
        items={flows.map(f => ({ id: f.id, name: f.name, folder: f.folder, icon: '⧉', sub: f.deployed ? `v${f.deployed.version}` : undefined }))} />)}
      {sec('res', 'Resources', resources.length, () => setKindMenu(m => !m), <>
        {kindMenu && (
          <div className="kmenu" role="menu" aria-label="New resource">
            {meta.resourceKinds.map(k => (
              <button key={k.kind} role="menuitem" className="kitem" title={k.desc} onClick={() => { setKindMenu(false); setSel({ kind: 'newResource', resourceKind: k.kind }); }}>
                <span className="xi">{k.icon || '⚙'}</span><span>{k.name}</span>
              </button>
            ))}
          </div>
        )}
        {!resources.length && !kindMenu && <p className="muted xs" style={{ margin: '2px 6px' }}>No connections yet. Click + to add one.</p>}
        <FolderTree area="resources" activeId={sel?.kind === 'resource' ? sel.id : null} onChanged={reload} open={id => setSel({ kind: 'resource', id })}
          items={[...resources].sort((a, b) => kindOrder(a.kind) - kindOrder(b.kind) || a.name.localeCompare(b.name)).map(r => {
            const k = meta.resourceKinds.find(x => x.kind === r.kind);
            const miss = missingInResource(r, project);
            return { id: r.id, name: r.name, folder: r.folder, icon: k?.icon || '⚙', title: k?.name, warn: miss.length ? `Project variables not defined: ${miss.join(', ')}` : undefined };
          })} />
      </>)}
      {sec('sch', 'Schemas', schemas.filter(s => s.kind !== 'wsdl').length, () => setSel({ kind: 'newSchema', schemaKind: 'json' }),
        <FolderTree area="schemas" activeId={sel?.kind === 'schema' ? sel.id : null} onChanged={reload} open={id => setSel({ kind: 'schema', id })}
          items={schemas.filter(s => s.kind !== 'wsdl').map(s => ({ id: s.id, name: s.name, folder: s.folder, icon: 'S', sub: s.kind.toUpperCase() }))} />)}
      {sec('wsdl', 'Service descriptors', schemas.filter(s => s.kind === 'wsdl').length, () => setSel({ kind: 'newSchema', schemaKind: 'wsdl' }),
        <FolderTree area="wsdl" activeId={sel?.kind === 'schema' ? sel.id : null} onChanged={reload} open={id => setSel({ kind: 'schema', id })}
          items={schemas.filter(s => s.kind === 'wsdl').map(s => ({ id: s.id, name: s.name, folder: s.folder, icon: 'W', sub: 'WSDL' }))} />)}
      {sec('cfg', 'Configuration', 5, undefined, <>
        {item(`Project variables (${project?.config.variables.length ?? 0})`, isSel({ kind: 'variables' }), () => setSel({ kind: 'variables' }), '$')}
        {item('Deployment config (ops)', isSel({ kind: 'ops' }), () => setSel({ kind: 'ops' }), '⇅')}
        {item('Logging', isSel({ kind: 'logging' }), () => setSel({ kind: 'logging' }), '≡')}
        {item('Project log', isSel({ kind: 'log' }), () => setSel({ kind: 'log' }), '☰')}
        {item('Releases (packages)', isSel({ kind: 'releases' }), () => setSel({ kind: 'releases' }), '⬢')}
      </>)}
      {creating && <NewProjectDialog onClose={() => setCreating(false)} onCreated={async id => { setCreating(false); setProjectId(id); setSel(null); await reload(); }} />}
    </div>
  );
}

const ITEM_MIME = 'application/x-sutra-item';
const FOLDER_MIME = 'application/x-sutra-folder';
const store = { get: (k: string) => { try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch { return {}; } }, set: (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window */ } } };

export type FolderArea = 'sutras' | 'resources' | 'schemas' | 'wsdl';
export interface TreeItem { id: string; name: string; folder?: string; icon: string; sub?: string; title?: string; warn?: string }
const MOVE_URL: Record<FolderArea, (id: string) => string> = {
  sutras: id => `/api/flows/${id}/folder`, resources: id => `/api/resources/${id}/folder`, schemas: id => `/api/schemas/${id}/folder`, wsdl: id => `/api/schemas/${id}/folder`,
};
const WHAT: Record<FolderArea, string> = { sutras: 'Sutra', resources: 'connection', schemas: 'schema', wsdl: 'service descriptor' };

/**
 * One section of the explorer as folders. Drag an item or a folder onto a folder (or onto the line
 * at the bottom for the top level) to move it; the ⋯ button does the same from the keyboard and
 * renames or removes folders. Removing a folder never deletes anything: its contents move up one level.
 */
function FolderTree({ area, items, activeId, open, onChanged }: { area: FolderArea; items: TreeItem[]; activeId: string | null; open(id: string): void; onChanged(): void | Promise<void> }) {
  const { projectId } = useCatalog();
  const toast = useToast();
  const [folders, setFolders] = useState<string[]>([]);
  const key = `sutraflow.folders.${projectId}.${area}`;
  const [shut, setShut] = useState<Record<string, boolean>>(() => store.get(key));
  const [over, setOver] = useState<string | null>(null);
  const [dlg, setDlg] = useState<{ kind: 'item'; id: string } | { kind: 'folder'; path: string } | { kind: 'new'; parent: string } | null>(null);
  const load = () => get<string[]>(`/api/projects/${projectId}/folders?area=${area}`).then(setFolders).catch(() => setFolders([]));
  useEffect(() => { load(); setShut(store.get(key)); }, [projectId, area, items.map(f => f.folder || '').join('|')]);
  const current = items.find(f => f.id === activeId)?.folder || '';
  const isOpen = (p: string) => (p in shut ? !shut[p] : current === p || current.startsWith(p + '/'));
  const toggle = (p: string) => setShut(s => { const n = { ...s, [p]: isOpen(p) }; store.set(key, n); return n; });
  const done = async (p: Promise<unknown>, msg?: string) => { try { await p; if (msg) toast(msg); await load(); await onChanged(); } catch (e: any) { toast(e.message, true); } };
  const moveItem = (id: string, folder: string) => done(put(MOVE_URL[area](id), { folder }), `Moved to ${folder || 'the top level'}`);
  const moveFolder = (from: string, to: string) => done(post(`/api/projects/${projectId}/folders/move`, { area, from, to }), `Folder now ${to}`);
  const dropOn = (target: string) => ({
    onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes(ITEM_MIME + area) || e.dataTransfer.types.includes(FOLDER_MIME + area)) { e.preventDefault(); setOver(target); } },
    onDragLeave: () => setOver(o => (o === target ? null : o)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault(); setOver(null);
      const id = e.dataTransfer.getData(ITEM_MIME + area), from = e.dataTransfer.getData(FOLDER_MIME + area);
      if (id) { if ((items.find(f => f.id === id)?.folder || '') !== target) moveItem(id, target); return; }
      if (!from) return;
      const to = [target, from.split('/').pop()].filter(Boolean).join('/');
      if (to === from) return;
      if (target === from || target.startsWith(from + '/')) { toast('A folder cannot go inside itself', true); return; }
      moveFolder(from, to);
    },
  });
  const childrenOf = (p: string) => folders.filter(f => f.split('/').slice(0, -1).join('/') === p);
  const name = (p: string) => p.split('/').pop() || p;
  const count = (p: string) => items.filter(f => (f.folder || '') === p || (f.folder || '').startsWith(p + '/')).length;
  const pad = (depth: number) => ({ paddingLeft: 6 + depth * 12 });
  const itemRow = (f: TreeItem, depth: number) => (
    <div key={f.id} className="xrow" title={f.warn || f.title} draggable onDragStart={e => { e.dataTransfer.setData(ITEM_MIME + area, f.id); e.dataTransfer.effectAllowed = 'move'; }}>
      <button className={`xitem${f.id === activeId ? ' act' : ''}`} style={pad(depth)} onClick={() => open(f.id)}>
        <span className="xi">{f.icon}</span><span className="xl">{f.name}</span>{f.warn && <span className="xwarn" aria-label={f.warn}>⚠</span>}{f.sub && <span className="muted xs">{f.sub}</span>}
      </button>
      <button className="xmore" title="Move to a folder" aria-label={`Move ${f.name} to a folder`} onClick={() => setDlg({ kind: 'item', id: f.id })}>⋯</button>
    </div>
  );
  const folderRow = (p: string, depth: number): React.ReactNode => (
    <div key={'d' + p}>
      <div className={`xrow${over === p ? ' drop' : ''}`} draggable onDragStart={e => { e.dataTransfer.setData(FOLDER_MIME + area, p); e.dataTransfer.effectAllowed = 'move'; }} {...dropOn(p)}>
        <button className="xitem xfolder" style={pad(depth)} aria-expanded={isOpen(p)} onClick={() => toggle(p)}>
          <span className="xi">{isOpen(p) ? '▾' : '▸'}</span><span className="xl">{name(p)}</span><span className="muted xs">{count(p)}</span>
        </button>
        <button className="xmore" title="Folder: new folder inside, rename, move, remove" aria-label={`Folder ${p}`} onClick={() => setDlg({ kind: 'folder', path: p })}>⋯</button>
      </div>
      {isOpen(p) && <>
        {childrenOf(p).map(c => folderRow(c, depth + 1))}
        {items.filter(f => (f.folder || '') === p).map(f => itemRow(f, depth + 1))}
      </>}
    </div>
  );
  return (
    <>
      {childrenOf('').map(p => folderRow(p, 0))}
      {items.filter(f => !f.folder).map(f => itemRow(f, 0))}
      <div className={`xroot${over === '' ? ' drop' : ''}`} {...dropOn('')}>
        <button className="btn link small" onClick={() => setDlg({ kind: 'new', parent: '' })}>+ Folder</button>
        {folders.length > 0 && <span className="muted xs">Drag here for the top level</span>}
      </div>
      {dlg && <FolderDialog area={area} dlg={dlg} folders={folders} items={items} onClose={() => setDlg(null)}
        act={async p => { await done(p); setDlg(null); }} moveItem={async (id, f) => { await moveItem(id, f); setDlg(null); }} moveFolder={async (a, b) => { await moveFolder(a, b); setDlg(null); }} />}
    </>
  );
}

function FolderDialog({ area, dlg, folders, items, onClose, act, moveItem, moveFolder }: {
  area: FolderArea; dlg: { kind: 'item'; id: string } | { kind: 'folder'; path: string } | { kind: 'new'; parent: string };
  folders: string[]; items: TreeItem[]; onClose(): void; act(p: Promise<unknown>): Promise<void>;
  moveItem(id: string, folder: string): Promise<void>; moveFolder(from: string, to: string): Promise<void>;
}) {
  const { projectId } = useCatalog();
  const item = dlg.kind === 'item' ? items.find(f => f.id === dlg.id) : undefined;
  const [target, setTarget] = useState(item?.folder || '');
  const [path, setPath] = useState(dlg.kind === 'folder' ? dlg.path : dlg.kind === 'new' ? (dlg.parent ? dlg.parent + '/' : '') : '');
  const [sub, setSub] = useState('');
  if (dlg.kind === 'item') {
    return (
      <Modal title={`Move ${item?.name || WHAT[area]}`} onClose={onClose} actions={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn go" onClick={() => moveItem(dlg.id, target)}>Move</button>
      </>}>
        <div className="fld"><label htmlFor="mvto">Folder</label>
          <input id="mvto" list="mvlist" value={target} onChange={e => setTarget(e.target.value)} placeholder="Empty = top level" />
          <datalist id="mvlist">{folders.map(f => <option key={f} value={f} />)}</datalist>
          <div className="hint">Pick a folder or type a new path such as Orders/Inbound; missing folders are made.</div></div>
      </Modal>
    );
  }
  if (dlg.kind === 'new') {
    return (
      <Modal title="New folder" onClose={onClose} actions={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn go" disabled={!path.trim()} onClick={() => act(post(`/api/projects/${projectId}/folders`, { area, path }))}>Create</button>
      </>}>
        <div className="fld"><label htmlFor="nf">Folder path</label><input id="nf" autoFocus value={path} onChange={e => setPath(e.target.value)} placeholder="Orders/Inbound" />
          <div className="hint">Use / for a folder inside another.</div></div>
      </Modal>
    );
  }
  const n = items.filter(f => (f.folder || '') === dlg.path || (f.folder || '').startsWith(dlg.path + '/')).length;
  return (
    <Modal title={`Folder ${dlg.path}`} onClose={onClose} actions={<button className="btn" onClick={onClose}>Close</button>}>
      <div className="fld"><label htmlFor="fpath">Name and place</label>
        <div className="row" style={{ gap: 6 }}><input id="fpath" style={{ flex: 1 }} value={path} onChange={e => setPath(e.target.value)} />
          <button className="btn" disabled={!path.trim() || path.trim() === dlg.path} onClick={() => moveFolder(dlg.path, path)}>Rename / move</button></div>
        <div className="hint">Change the last part to rename; change the path before it to move the folder with its {n} items.</div></div>
      <div className="fld"><label htmlFor="fsub">New folder inside</label>
        <div className="row" style={{ gap: 6 }}><input id="fsub" style={{ flex: 1 }} value={sub} onChange={e => setSub(e.target.value)} />
          <button className="btn" disabled={!sub.trim()} onClick={() => act(post(`/api/projects/${projectId}/folders`, { area, path: `${dlg.path}/${sub}` }))}>Create</button></div></div>
      <div className="fld"><button className="btn danger" onClick={() => act(del(`/api/projects/${projectId}/folders?area=${area}&path=${encodeURIComponent(dlg.path)}`))}>Remove folder</button>
        <div className="hint">{n ? `Its ${n} items and folders move up one level; nothing is deleted.` : 'The folder is empty.'}</div></div>
    </Modal>
  );
}

/** Warns about project variables used but not defined, with a button that adds them (empty, as text). */
export function MissingVariables({ names, via }: { names: string[]; via?: Record<string, string> }) {
  const { project, reload } = useCatalog();
  const toast = useToast();
  if (!names.length || !project) return null;
  const add = async () => {
    const vars = [...project.config.variables, ...[...new Set(names)].map(name => ({ name, type: 'string' as const, value: '', description: '' }))];
    try { await put(`/api/projects/${project.id}`, { name: project.name, config: { variables: vars } }); await reload(); toast(`Added ${[...new Set(names)].join(', ')}; give ${names.length > 1 ? 'them values' : 'it a value'} under Configuration > Project variables`); }
    catch (e: any) { toast(e.message, true); }
  };
  return (
    <div className="warnbox" role="alert">
      {missingText(names.map(n => ({ name: n, via: via?.[n] || '' })))}
      {'\n'}Runs read it as empty until it is defined.
      <div style={{ marginTop: 6 }}><button className="btn small" onClick={add}>Add to project variables</button></div>
    </div>
  );
}

/** Right-hand panel for project items. */
export function ExplorerEditor({ sel, setSel }: { sel: ExplorerSel; setSel(s: ExplorerSel | null): void }) {
  return (
    <aside className="side"><div className="tabbody">
      {(sel.kind === 'resource' || sel.kind === 'newResource') && <ResourceEditor key={sel.kind === 'resource' ? sel.id : 'new' + sel.resourceKind} sel={sel} setSel={setSel} />}
      {(sel.kind === 'schema' || sel.kind === 'newSchema') && <SchemaEditor key={sel.kind === 'schema' ? sel.id : 'new' + sel.schemaKind} sel={sel} setSel={setSel} />}
      {sel.kind === 'variables' && <VariablesEditor />}
      {sel.kind === 'ops' && <OpsEditor />}
      {sel.kind === 'logging' && <LoggingEditor />}
      {sel.kind === 'log' && <ProjectLog />}
      {sel.kind === 'releases' && <ReleasesPanel />}
    </div></aside>
  );
}

function ResourceEditor({ sel, setSel }: { sel: Extract<ExplorerSel, { kind: 'resource' | 'newResource' }>; setSel(s: ExplorerSel | null): void }) {
  const { meta, resources, secrets, projectId, project, reload } = useCatalog();
  const toast = useToast();
  const existing = sel.kind === 'resource' ? resources.find(r => r.id === sel.id) : undefined;
  const kind = existing?.kind || (sel.kind === 'newResource' ? sel.resourceKind : '');
  const k = meta.resourceKinds.find(x => x.kind === kind);
  const defaults = () => Object.fromEntries((k?.fields || []).map(f => [f.k, structuredClone(f.def ?? '')]));
  const [r, setR] = useState<Resource>(() => existing ? { ...structuredClone(existing), config: { ...defaults(), ...structuredClone(existing.config) } } : {
    id: '', kind, name: uniqueName(k?.name || 'Resource', resources.map(x => x.name)), project_id: projectId, config: defaults(),
  });
  const [test, setTest] = useState<{ ok: boolean; message: string; ms: number } | 'running' | null>(null);
  const runTest = async () => {
    setTest('running');
    try { setTest(await post('/api/resources/test', { ...r, project_id: projectId })); } catch (e: any) { setTest({ ok: false, message: e.message, ms: 0 }); }
  };
  if (!k) return <p className="muted">Resource not found.</p>;
  const save = async () => {
    try {
      const saved = r.id ? await put(`/api/resources/${r.id}`, r) : await post('/api/resources', { ...r, project_id: projectId });
      await reload();
      setSel({ kind: 'resource', id: saved.id });
      toast('Saved');
    } catch (e: any) { toast(e.message, true); }
  };
  const remove = async () => {
    if (!confirm(`Delete "${r.name}"? Activities and services using it stop working until you pick another.`)) return;
    await del(`/api/resources/${r.id}`);
    await reload();
    setSel(null);
  };
  return (
    <>
      <div className="phead rhead"><span className="kicon" aria-hidden>{k.icon || '⚙'}</span><div><h2>{r.name || k.name}</h2><p><b>{k.name}</b> · {k.desc}</p></div></div>
      <div className="fld"><label htmlFor="rname">Name</label><input id="rname" type="text" value={r.name} autoFocus={!r.id} onChange={e => setR({ ...r, name: e.target.value })} /><div className="hint">Your name for it: shown in activity settings and used as its key in the deployment config. Settings marked {'{x}'} take project variables.</div></div>
      <MissingVariables names={missingInResource(r, project)} />
      <FieldList fields={k.fields} values={r.config} onChange={(fk, v) => { setR({ ...r, config: { ...r.config, [fk]: v } }); setTest(null); }} resources={resources} secrets={secrets} />
      {test && test !== 'running' && <div className={test.ok ? 'okbox' : 'errbox'} role="status"><b>{test.ok ? 'Connection works.' : 'Connection failed.'}</b> {test.message}{test.ms ? <span className="muted"> ({test.ms} ms)</span> : null}</div>}
      <div className="row">
        <button className="btn primary" onClick={save}>Save</button>
        {k.kind !== 'inboundPolicy' && <button className="btn" onClick={runTest} disabled={test === 'running'}>{test === 'running' ? 'Testing' : 'Test connection'}</button>}
        {r.id && <button className="btn danger" onClick={remove}>Delete</button>}
      </div>
      {r.kind === 'aiProvider' && <AiModels r={r} projectId={projectId} setModel={m => { setR({ ...r, config: { ...r.config, model: m } }); setTest(null); }} />}
      {r.kind === 'oauthApp' && r.id && <OAuthPanel id={r.id} />}
    </>
  );
}

/** Connect / disconnect an OAuth account; the provider redirects back to the studio. */
function OAuthPanel({ id }: { id: string }) {
  const toast = useToast();
  const [st, setSt] = useState<{ connected: boolean; connectedAt?: string; expiresAt?: string; canRefresh?: boolean; redirectUri: string } | null>(null);
  const load = () => get(`/api/oauth/${id}`).then(setSt).catch(e => toast(e.message, true));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const connect = async () => {
    try {
      const { url } = await get(`/api/oauth/${id}/start`);
      const w = window.open(url, 'sutra-oauth', 'width=560,height=720');
      const t = window.setInterval(() => { if (!w || w.closed) { window.clearInterval(t); load(); } }, 800);
    } catch (e: any) { toast(e.message, true); }
  };
  if (!st) return null;
  return (
    <>
      <div className="group">Account</div>
      {st.connected
        ? <div className="okbox">Connected {st.connectedAt ? new Date(st.connectedAt).toLocaleString() : ''}{st.canRefresh ? '. Tokens refresh automatically.' : '. No refresh token: connect again when it expires.'}</div>
        : <div className="warnbox">Not connected yet.</div>}
      <div className="row"><button className="btn go" onClick={connect}>{st.connected ? 'Reconnect account' : 'Connect account'}</button>
        {st.connected && <button className="btn danger" onClick={() => del(`/api/oauth/${id}`).then(load)}>Disconnect</button>}</div>
      <p className="muted xs" style={{ marginTop: 8 }}>Register this redirect URI in the provider's developer console: <code>{st.redirectUri}</code>. Save the connection before connecting.</p>
    </>
  );
}

const SCHEMA_STARTERS = {
  json: '{\n  "$schema": "https://json-schema.org/draft/2020-12/schema",\n  "type": "object",\n  "required": ["orderId"],\n  "properties": {\n    "orderId": { "type": "string" },\n    "lines": {\n      "type": "array",\n      "items": {\n        "type": "object",\n        "properties": { "sku": { "type": "string" }, "qty": { "type": "integer" } }\n      }\n    }\n  }\n}',
  xsd: '<?xml version="1.0" encoding="UTF-8"?>\n<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">\n  <xs:element name="Order">\n    <xs:complexType>\n      <xs:sequence>\n        <xs:element name="OrderId" type="xs:string"/>\n        <xs:element name="Line" maxOccurs="unbounded">\n          <xs:complexType>\n            <xs:sequence>\n              <xs:element name="Sku" type="xs:string"/>\n              <xs:element name="Qty" type="xs:int"/>\n            </xs:sequence>\n          </xs:complexType>\n        </xs:element>\n      </xs:sequence>\n      <xs:attribute name="version" type="xs:string"/>\n    </xs:complexType>\n  </xs:element>\n</xs:schema>',
  wsdl: '',
};

function SchemaEditor({ sel, setSel }: { sel: Extract<ExplorerSel, { kind: 'schema' | 'newSchema' }>; setSel(s: ExplorerSel | null): void }) {
  const { projectId, schemas, reload } = useCatalog();
  const toast = useToast();
  const info: SchemaInfo | undefined = sel.kind === 'schema' ? schemas.find(s => s.id === sel.id) : undefined;
  const [form, setForm] = useState<{ name: string; kind: 'json' | 'xsd' | 'wsdl'; root: string; text: string } | null>(
    sel.kind === 'newSchema' ? { name: '', kind: sel.schemaKind, root: '', text: SCHEMA_STARTERS[sel.schemaKind] } : null);
  const [tree, setTree] = useState<SNode | null>(null);
  useEffect(() => {
    if (sel.kind !== 'schema') return;
    get(`/api/schemas/${sel.id}`).then(s => setForm({ name: s.name, kind: s.kind, root: s.root || '', text: s.text })).catch(e => toast(e.message, true));
    get(`/api/schemas/${sel.id}/tree`).then(setTree).catch(() => setTree(null));
  }, [sel, toast]);
  if (!form) return <p className="muted">Loading</p>;
  const save = async () => {
    try {
      const body = { ...form, project_id: projectId };
      const s = info ? await put(`/api/schemas/${info.id}`, body) : await post('/api/schemas', body);
      await reload();
      setSel({ kind: 'schema', id: s.id });
      setTree(await get(`/api/schemas/${s.id}/tree`).catch(() => null));
      toast('Schema saved');
    } catch (e: any) { toast(e.message, true); }
  };
  const loadFile = (f: File) => f.text().then(text => setForm({ ...form, text, name: form.name || f.name.replace(/\.(json|xsd|wsdl|xml)$/i, ''), kind: /\.xsd$/i.test(f.name) ? 'xsd' : /\.wsdl$/i.test(f.name) ? 'wsdl' : form.kind }));
  return (
    <>
      <div className="phead"><div><h2>{form.kind === 'wsdl' ? 'Service descriptor (WSDL)' : 'Shared schema'}</h2>
        <p>{form.kind === 'wsdl' ? 'Invoke SOAP service can call it ("WSDL from: project").' : 'Activities pick it to describe data (Payload schema, Body schema, Target schema). JSON accepts a JSON Schema or a sample document.'}</p></div></div>
      <div className="fld"><label htmlFor="sn">Name</label><input id="sn" type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
      <div className="row">
        <div className="fld" style={{ flex: 1 }}><label htmlFor="sk">Type</label>
          <select id="sk" value={form.kind} onChange={e => {
            const kind = e.target.value as 'json' | 'xsd' | 'wsdl';
            // Swap the starter content when the user has not edited it yet.
            const untouched = !form.text.trim() || Object.values(SCHEMA_STARTERS).includes(form.text);
            setForm({ ...form, kind, text: untouched ? SCHEMA_STARTERS[kind] : form.text });
          }}><option value="json">JSON (schema or sample)</option><option value="xsd">XML (XSD)</option><option value="wsdl">WSDL</option></select></div>
        {form.kind === 'xsd' && info?.roots?.length ? (
          <div className="fld" style={{ flex: 1 }}><label htmlFor="sr">Default root element</label>
            <select id="sr" value={form.root} onChange={e => setForm({ ...form, root: e.target.value })}><option value="">(first)</option>{info.roots.map(r => <option key={r}>{r}</option>)}</select></div>
        ) : null}
      </div>
      <div className="fld"><label htmlFor="st">Content</label><textarea id="st" className="code" rows={14} spellCheck={false} value={form.text} onChange={e => setForm({ ...form, text: e.target.value })} />
        <div className="hint">Or load a file: <input type="file" accept=".json,.xsd,.wsdl,.xml" aria-label="Load schema file" onChange={e => e.target.files?.[0] && loadFile(e.target.files[0])} /></div></div>
      <div className="row"><button className="btn primary" disabled={!form.name.trim() || !form.text.trim()} onClick={save}>Save</button>
        {info && <button className="btn danger" onClick={async () => { if (!confirm(`Delete ${info.name}?`)) return; await del(`/api/schemas/${info.id}`); await reload(); setSel(null); }}>Delete</button>}</div>
      {tree && <><div className="group">Fields</div><SchemaTreeView n={tree} depth={0} /></>}
    </>
  );
}

export function SchemaTreeView({ n, depth }: { n: SNode; depth: number }) {
  return (
    <div className={depth === 0 ? 'otree' : ''}>
      <div className="orow" style={{ paddingLeft: depth * 14 }}>
        <span className="nm">{n.name}{n.repeats ? <span className="rep">*</span> : null}{n.required ? <span className="req">*</span> : null}</span>
        <span className="muted mono">{n.type}{n.enum ? ` (${n.enum.join(' | ')})` : ''}</span>
      </div>
      {n.children?.map(c => <SchemaTreeView key={c.name} n={c} depth={depth + 1} />)}
    </div>
  );
}

function VariablesEditor() {
  const { project, secrets, reload } = useCatalog();
  const toast = useToast();
  const [vars, setVars] = useState<ProjectVariable[]>(() => structuredClone(project?.config.variables || []));
  const set = (i: number, k: keyof ProjectVariable, v: string) => setVars(vs => vs.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const save = async () => {
    try { await put(`/api/projects/${project!.id}`, { name: project!.name, config: { variables: vars } }); await reload(); toast('Variables saved'); }
    catch (e: any) { toast(e.message, true); }
  };
  return (
    <>
      <div className="phead"><div><h2>Project variables</h2><p>Shared by every Sutra in {project?.name} as <code>{'{gv.NAME}'}</code> ($_projectVariables). The deployment config can override them per environment. Secret variables name a vault secret and are masked in run history.</p></div></div>
      <table className="t"><thead><tr><th>Name</th><th>Type</th><th>Default value</th><th /></tr></thead><tbody>
        {vars.map((v, i) => (
          <tr key={i}>
            <td><input className="inp code" aria-label={`Variable ${i + 1} name`} value={v.name} onChange={e => set(i, 'name', e.target.value)} /></td>
            <td><select className="inp" aria-label={`Variable ${i + 1} type`} value={v.type} onChange={e => set(i, 'type', e.target.value)}>{['string', 'number', 'boolean', 'secret'].map(t => <option key={t}>{t}</option>)}</select></td>
            <td>{v.type === 'secret'
              ? <select className="inp" aria-label={`Variable ${i + 1} secret`} value={v.value} onChange={e => set(i, 'value', e.target.value)}><option value="">(none)</option>{secrets.map(s => <option key={s.name}>{s.name}</option>)}</select>
              : <input className="inp code" aria-label={`Variable ${i + 1} value`} value={v.value} onChange={e => set(i, 'value', e.target.value)} />}
              <input className="inp" style={{ marginTop: 4, fontSize: 12 }} placeholder="Description" aria-label={`Variable ${i + 1} description`} value={v.description || ''} onChange={e => set(i, 'description', e.target.value)} /></td>
            <td><button className="x" aria-label="Remove variable" onClick={() => setVars(vs => vs.filter((_, j) => j !== i))}>✕</button></td>
          </tr>
        ))}
      </tbody></table>
      <div className="row" style={{ marginTop: 8 }}><button className="btn small" onClick={() => setVars(vs => [...vs, { name: '', type: 'string', value: '' }])}>+ Variable</button><button className="btn primary" onClick={save}>Save</button></div>
    </>
  );
}

function OpsEditor() {
  const { project, resources } = useCatalog();
  const toast = useToast();
  const [ops, setOps] = useState<{ variables: Record<string, string>; resources: Record<string, Record<string, any>>; logging: Record<string, any> } | null>(null);
  const [resText, setResText] = useState('');
  useEffect(() => {
    if (!project) return;
    get(`/api/projects/${project.id}/ops`).then(o => { setOps(o); setResText(JSON.stringify(o.resources, null, 2)); }).catch(e => toast(e.message, true));
  }, [project, toast]);
  if (!project || !ops) return <p className="muted">Loading</p>;
  const save = async () => {
    let resourcesOv: any;
    try { resourcesOv = resText.trim() ? JSON.parse(resText) : {}; } catch (e: any) { toast(`Resource overrides are not valid JSON: ${e.message}`, true); return; }
    try { setOps(await put(`/api/projects/${project.id}/ops`, { ...ops, resources: resourcesOv })); toast('Deployment config saved'); }
    catch (e: any) { toast(e.message, true); }
  };
  const exportFile = async () => {
    const f = await get(`/api/projects/${project.id}/ops/file`);
    const blob = new Blob([JSON.stringify(f, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${project.name.replace(/[^\w.-]+/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importFile = async (f: File) => {
    try {
      const o = await post(`/api/projects/${project.id}/ops/file`, JSON.parse(await f.text()));
      setOps(o); setResText(JSON.stringify(o.resources, null, 2));
      toast('Deployment config imported');
    } catch (e: any) { toast(e.message, true); }
  };
  return (
    <>
      <div className="phead"><div><h2>Deployment config</h2><p>Values operations change per environment without touching the Sutras. Any value may read an environment variable: <code>{'${env:DB_HOST}'}</code> or <code>{'${env:DB_HOST:-localhost}'}</code>. The same file can be dropped in <code>data/config/{project.name}.json</code> before start.</p></div></div>
      <div className="row"><button className="btn" onClick={exportFile}>Export config file</button>
        <label className="btn">Import config file<input type="file" accept=".json" hidden onChange={e => e.target.files?.[0] && importFile(e.target.files[0])} /></label></div>
      <div className="group">Variable overrides</div>
      {project.config.variables.length ? (
        <table className="t"><tbody>{project.config.variables.map(v => (
          <tr key={v.name}><td><code>{v.name}</code><div className="muted xs">default: {v.type === 'secret' ? `secret ${v.value}` : v.value || '(empty)'}</div></td>
            <td><input className="inp code" aria-label={`Override ${v.name}`} placeholder="(use default)" value={ops.variables[v.name] ?? ''} onChange={e => {
              const vars = { ...ops.variables };
              if (e.target.value === '') delete vars[v.name]; else vars[v.name] = e.target.value;
              setOps({ ...ops, variables: vars });
            }} /></td></tr>
        ))}</tbody></table>
      ) : <p className="muted">No project variables yet.</p>}
      <RuntimeValues projectId={project.id} />
      <div className="group">Resource overrides</div>
      <div className="fld"><textarea className="code inp" rows={8} spellCheck={false} aria-label="Resource overrides JSON" value={resText} onChange={e => setResText(e.target.value)} />
        <div className="hint">By resource name, only the settings that differ, e.g. {`{ "${resources[0]?.name || 'Billing API'}": { "baseUrl": "\${env:BILLING_URL}" } }`}</div></div>
      <div className="group">Logging overrides</div>
      <div className="fld"><label htmlFor="ol">Level</label>
        <select id="ol" value={ops.logging.level || ''} onChange={e => setOps({ ...ops, logging: { ...ops.logging, level: e.target.value || undefined } })}><option value="">(project setting)</option>{['debug', 'info', 'warn', 'error'].map(l => <option key={l}>{l}</option>)}</select></div>
      <div className="fld"><label htmlFor="of">Log file</label><input id="of" type="text" className="code" placeholder="(project setting)" value={ops.logging.file || ''} onChange={e => setOps({ ...ops, logging: { ...ops.logging, file: e.target.value || undefined } })} /></div>
      <button className="btn primary" onClick={save}>Save</button>
    </>
  );
}

function LoggingEditor() {
  const { project, reload } = useCatalog();
  const toast = useToast();
  const [l, setL] = useState<LoggingConfig>(() => structuredClone(project!.config.logging));
  const save = async () => {
    try { await put(`/api/projects/${project!.id}`, { name: project!.name, config: { logging: l } }); await reload(); toast('Logging saved'); }
    catch (e: any) { toast(e.message, true); }
  };
  return (
    <>
      <div className="phead"><div><h2>Logging</h2><p>Where this project's runs are logged. Relative paths are inside the data folder; <code>{'{project}'}</code> and <code>{'{date}'}</code> are replaced.</p></div></div>
      <div className="fld"><label className="check"><input type="checkbox" checked={l.enabled} onChange={e => setL({ ...l, enabled: e.target.checked })} /> Write a log file</label></div>
      <div className="fld"><label htmlFor="lf">File</label><input id="lf" type="text" className="code" value={l.file} onChange={e => setL({ ...l, file: e.target.value })} /></div>
      <div className="row">
        <div className="fld"><label htmlFor="ll">Level</label><select id="ll" value={l.level} onChange={e => setL({ ...l, level: e.target.value })}>{['debug', 'info', 'warn', 'error'].map(x => <option key={x}>{x}</option>)}</select></div>
        <div className="fld"><label htmlFor="lfm">Format</label><select id="lfm" value={l.format} onChange={e => setL({ ...l, format: e.target.value })}><option>text</option><option>json</option></select></div>
        <div className="fld"><label htmlFor="ls">Rotate at (MB)</label><input id="ls" type="number" value={l.maxSizeMb} onChange={e => setL({ ...l, maxSizeMb: Number(e.target.value) })} /></div>
        <div className="fld"><label htmlFor="lk">Files kept</label><input id="lk" type="number" value={l.maxFiles} onChange={e => setL({ ...l, maxFiles: Number(e.target.value) })} /></div>
      </div>
      <div className="fld"><label className="check"><input type="checkbox" checked={l.stepData} onChange={e => setL({ ...l, stepData: e.target.checked })} /> Log each activity's input and output (debug level)</label></div>
      <div className="row"><button className="btn primary" onClick={save}>Save</button></div>
      <p className="muted xs">Read, search and clear the log under Configuration &gt; Project log.</p>
    </>
  );
}

/** One log line with its server and run origin as coloured tags (text lines "{production, deployed v3}" or JSON lines). */
function LogLine({ line }: { line: string }) {
  let env = '', origin = '', rest = line;
  const m = /^(\S+ \S+\s+)\{(production|test|development)(?:, ([^}]+))?\} ?(.*)$/.exec(line);
  if (m) { env = m[2]; origin = m[3] || ''; rest = m[1] + m[4]; }
  else if (line.startsWith('{')) { try { const j = JSON.parse(line); env = j.environment || ''; origin = j.origin || ''; } catch { /* plain */ } }
  return (
    <div>
      {env && <span className={`ltag env-${env}`}>{env}</span>}
      {origin && <span className={`ltag ${origin.startsWith('deployed') ? 'org-deployed' : 'org-editor'}`}>{origin}</span>}
      {rest}
    </div>
  );
}

const sizeText = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b > 1024 ? `${Math.round(b / 1024)} KB` : `${b} bytes`);

/**
 * The project's log file: newest lines, by level and words, refreshed on demand or every 5 seconds.
 * Developers clear it, and their own test runs, on development and test servers; on a production
 * server only an administrator can.
 */
function ProjectLog() {
  const { project } = useCatalog();
  const toast = useToast();
  const [f, setF] = useState({ level: '', q: '', lines: '200', origin: '' });
  const [auto, setAuto] = useState(false);
  const [data, setData] = useState<{ file: string | null; lines: string[]; bytes: number; files: number; environment: string } | null>(null);
  const [confirm, setConfirm] = useState<'log' | 'runs' | null>(null);
  const load = () => {
    const p = new URLSearchParams({ lines: f.lines, ...(f.level ? { level: f.level } : {}), ...(f.q ? { q: f.q } : {}), ...(f.origin ? { origin: f.origin } : {}) });
    return get<any>(`/api/projects/${project!.id}/log?${p}`).then(setData).catch(e => toast(e.message, true));
  };
  useEffect(() => { load(); }, [project?.id, f.level, f.lines, f.origin]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!auto) return; const t = window.setInterval(load, 5000); return () => window.clearInterval(t); }, [auto, f]); // eslint-disable-line react-hooks/exhaustive-deps
  const prod = data?.environment === 'production';
  const clear = async () => {
    try {
      if (confirm === 'log') { const r = await post<any>(`/api/projects/${project!.id}/log/clear`, {}); toast(`Log cleared (${sizeText(r.cleared)})`); }
      else { const r = await post<any>(`/api/projects/${project!.id}/runs/clear-tests`, {}); toast(`${r.deleted} test runs deleted`); }
      setConfirm(null); load();
    } catch (e: any) { toast(e.message, true); }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([(data?.lines || []).join('\n') + '\n'], { type: 'text/plain' }));
    const a = document.createElement('a'); a.href = url; a.download = `${project!.name.replace(/[^\w.-]+/g, '-')}-log.txt`; a.click(); URL.revokeObjectURL(url);
  };
  return (
    <>
      <div className="phead"><div><h2>Project log</h2><p>What this project's runs wrote to its log file, newest at the bottom. <span className={`badge ${prod ? 'failed' : 'done'}`}>{data?.environment || 'development'} server</span></p></div></div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        <div className="fld"><label htmlFor="pl-level">Level</label><select id="pl-level" value={f.level} onChange={e => setF({ ...f, level: e.target.value })}><option value="">All</option><option value="info">Info and above</option><option value="warn">Warnings and errors</option><option value="error">Errors</option></select></div>
        <div className="fld"><label htmlFor="pl-origin">Runs from</label><select id="pl-origin" value={f.origin} onChange={e => setF({ ...f, origin: e.target.value })}><option value="">All</option><option value="deployed">Deployed Sutras</option><option value="editor">Designer tests</option></select></div>
        <div className="fld"><label htmlFor="pl-lines">Lines</label><select id="pl-lines" value={f.lines} onChange={e => setF({ ...f, lines: e.target.value })}>{['200', '500', '2000'].map(x => <option key={x}>{x}</option>)}</select></div>
        <div className="fld" style={{ flex: 1, minWidth: 140 }}><label htmlFor="pl-q">Contains</label><input id="pl-q" type="text" value={f.q} onChange={e => setF({ ...f, q: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') load(); }} placeholder="Sutra, run id, words" /></div>
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <button className="btn" onClick={load}>Refresh</button>
        <label className="check"><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} /> Every 5 s</label>
        <button className="btn" disabled={!data?.lines.length} onClick={download}>Download</button>
        <button className="btn danger" disabled={!data?.bytes} onClick={() => setConfirm('log')}>Clear log</button>
        <button className="btn danger" onClick={() => setConfirm('runs')}>Clear test runs</button>
      </div>
      <p className="muted xs">{data?.file ? `${data.file} · ${sizeText(data.bytes)}${data.files > 1 ? ` in ${data.files} files` : ''}` : 'Logging is off: turn it on under Configuration > Logging.'}{prod ? ' On a production server only an administrator can clear.' : ''}</p>
      {confirm && (
        <div className="warnbox" role="alertdialog" aria-label="Confirm">
          {confirm === 'log' ? `Empty the log file and delete its rotated copies (${sizeText(data?.bytes || 0)})?` : 'Delete the finished test and debug runs of this project? Deployed runs are kept.'} This cannot be undone.
          <div className="row" style={{ marginTop: 6 }}><button className="btn danger small" onClick={clear}>Delete</button><button className="btn small" onClick={() => setConfirm(null)}>Cancel</button></div>
        </div>
      )}
      <p className="muted xs">Each line says where it comes from: <span className="ltag env-production">production</span> <span className="ltag env-test">test</span> <span className="ltag env-development">development</span> server, and <span className="ltag org-deployed">deployed v3</span> (a deployed Sutra and its version) or <span className="ltag org-editor">editor test</span> (a test or debug run from the designer).</p>
      {data && (data.lines.length
        ? <pre className="json loglines" style={{ maxHeight: '60vh', overflow: 'auto' }}>{data.lines.map((l, i) => <LogLine key={i} line={l} />)}</pre>
        : <p className="muted">{f.level || f.q || f.origin ? 'No lines match.' : 'Empty.'}</p>)}
    </>
  );
}

/** Values changed by set-project-variable() while flows ran; cleared by saving the deployment config. */
function RuntimeValues({ projectId }: { projectId: string }) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const load = () => get(`/api/projects/${projectId}/runtime-variables`).then(setVals).catch(() => {});
  useEffect(() => { load(); }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  const keys = Object.keys(vals);
  if (!keys.length) return null;
  return (
    <div className="warnbox" style={{ marginTop: 8 }}>
      <b>Set while running</b> (set-project-variable): {keys.map(k => <span key={k}><code>{k}</code> = {vals[k]} </span>)}
      <div><button className="btn small" style={{ marginTop: 6 }} onClick={() => del(`/api/projects/${projectId}/runtime-variables`).then(load)}>Clear</button></div>
    </div>
  );
}

/** "HTTP connection", then "HTTP connection 2" and so on. */
function uniqueName(base: string, taken: string[]) {
  const t = new Set(taken.map(x => x.toLowerCase()));
  if (!t.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!t.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}

/** AI provider: list the engine's models; for Ollama, pull one (online) or import model files from this server (offline). */
function AiModels({ r, projectId, setModel }: { r: Resource; projectId: string; setModel(m: string): void }) {
  const [models, setModels] = useState<string[] | null>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pull, setPull] = useState('qwen3');
  const [file, setFile] = useState('');
  const [name, setName] = useState('');
  const [take, setTake] = useState('');
  const engine = r.config.engine || 'Claude API';
  if (/CLI$/.test(engine)) return null;
  const body = { ...r, project_id: projectId };
  const run = async (what: string, fn: () => Promise<string>) => {
    setBusy(what); setMsg(null);
    try { setMsg({ ok: true, text: await fn() }); } catch (e: any) { setMsg({ ok: false, text: e.message }); } finally { setBusy(''); }
  };
  const list = () => run('list', async () => { const res = await post<{ models: string[] }>('/api/resources/models', body); setModels(res.models); return res.models.length ? `${res.models.length} model${res.models.length === 1 ? '' : 's'}: click one to use it.` : 'No models yet.'; });
  return (
    <div className="aimodels">
      <div className="row"><button className="btn small" onClick={list} disabled={!!busy}>{busy === 'list' ? 'Listing' : 'List models'}</button><span className="muted xs">Models this {engine} offers.</span></div>
      {models && models.length > 0 && <div className="chips">{models.map(m => <button key={m} className={`chip${r.config.model === m ? ' on' : ''}`} onClick={() => setModel(m)}>{m}</button>)}</div>}
      {engine === 'Ollama' && <>
        <p className="h">Add a model to Ollama</p>
        <div className="fld"><label htmlFor="opull">Pull from the Ollama library (needs internet)</label>
          <div className="row"><input id="opull" type="text" className="code" value={pull} onChange={e => setPull(e.target.value)} placeholder="qwen3, phi4-mini, llama3.3" />
            <button className="btn small" disabled={!!busy || !pull.trim()} onClick={() => run('pull', async () => { const m = await post<{ message: string }>('/api/resources/ollama/pull', { ...body, model: pull.trim() }); await list(); return m.message; })}>{busy === 'pull' ? 'Pulling (can take minutes)' : 'Pull'}</button></div></div>
        <div className="fld"><label htmlFor="ofile">Import from a path on this server (offline)</label>
          <input id="ofile" type="text" className="code" value={file} onChange={e => setFile(e.target.value)} placeholder="D:\models\qwen3-8b.gguf" />
          <div className="hint">A .gguf file; a Modelfile (FROM file.gguf, TEMPLATE, SYSTEM, PARAMETER); a Safetensors model folder; or an Ollama models folder copied from another machine (it has manifests and blobs). The files go to Ollama through its API at the address above.</div></div>
        <div className="row2">
          <div className="fld"><label htmlFor="oname">Name in Ollama</label><input id="oname" type="text" className="code" value={name} onChange={e => setName(e.target.value)} placeholder="qwen3-offline" /></div>
          <div className="fld"><label htmlFor="otake">Model in the folder</label><input id="otake" type="text" className="code" value={take} onChange={e => setTake(e.target.value)} placeholder="only for Ollama folders, e.g. qwen3:8b" /></div>
        </div>
        <button className="btn small" disabled={!!busy || !file.trim() || !name.trim()} onClick={() => run('import', async () => { const m = await post<{ message: string }>('/api/resources/ollama/import', { ...body, file: file.trim(), model: name.trim(), take: take.trim() }); await list(); setModel(name.trim()); return m.message; })}>{busy === 'import' ? 'Importing (large files take a while)' : 'Import'}</button>
      </>}
      {msg && <div className={msg.ok ? 'okbox' : 'errbox'} role="status">{msg.text}</div>}
    </div>
  );
}

/** Releases: build a package of this project, deploy a package here, see the history and roll back. */
function ReleasesPanel() {
  const { projectId, project, reload } = useCatalog();
  const toast = useToast();
  const [version, setVersion] = useState('1.0.0');
  const [note, setNote] = useState('');
  const [hist, setHist] = useState<any[]>([]);
  const [pending, setPending] = useState<{ pkg: any; check: any; config?: any; zip?: string; files?: string[] } | null>(null);
  const [keepOthers, setKeepOthers] = useState(false);
  const [busy, setBusy] = useState('');
  const load = () => get<any[]>(`/api/projects/${projectId}/packages`).then(setHist).catch(() => setHist([]));
  useEffect(() => { load(); }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  const build = async () => {
    setBusy('build');
    try {
      const p = await get<any>(`/api/projects/${projectId}/package?version=${encodeURIComponent(version)}&note=${encodeURIComponent(note)}`);
      const url = URL.createObjectURL(new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = `${p.name.replace(/[^\w.-]+/g, '-')}-${p.version}.sutra`; a.click(); URL.revokeObjectURL(url);
      toast(`Package ${p.version}: ${p.sutras.length} Sutras, ${p.manifest.secrets.length} secrets needed`);
    } catch (e: any) { toast(e.message, true); } finally { setBusy(''); }
  };
  /** The release zip: package, deployment config to fill in for the target, README. */
  const buildZip = async () => {
    setBusy('zip');
    try {
      const r = await fetch(`/api/projects/${projectId}/release?version=${encodeURIComponent(version)}&note=${encodeURIComponent(note)}`, { credentials: 'same-origin' });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || `${r.status} ${r.statusText}`);
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement('a'); a.href = url; a.download = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') || '')?.[1] || 'release.zip'; a.click(); URL.revokeObjectURL(url);
      toast(`Release ${version} downloaded`);
    } catch (e: any) { toast(e.message, true); } finally { setBusy(''); }
  };
  const pick = async (f: File | undefined) => {
    if (!f) return;
    try {
      const body = /\.zip$/i.test(f.name)
        ? { zip: await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).replace(/^data:[^,]*,/, '')); fr.onerror = () => rej(fr.error); fr.readAsDataURL(f); }) }
        : { package: JSON.parse(await f.text()) };
      const o = await post<any>('/api/packages/open', { ...body, project: project?.name });
      setPending({ pkg: o.package, check: o.check, config: o.config ?? undefined, zip: 'zip' in body ? body.zip : undefined, files: o.files });
    } catch (e: any) { toast(`Not a release: ${e.message}`, true); }
  };
  const deploy = async () => {
    if (!pending) return;
    setBusy('deploy');
    try {
      const r = await post<any>('/api/packages/deploy', { ...(pending.zip ? { zip: pending.zip } : { package: pending.pkg }), project: project?.name, ops: pending.config, keepOthers });
      toast(`Deployed ${r.package.name} ${r.package.version}${r.unchanged ? ': nothing changed' : ''}`);
      setPending(null); await load(); await reload();
    } catch (e: any) { toast(e.message, true); } finally { setBusy(''); }
  };
  const rollback = async (to?: string) => {
    if (!confirm(to ? 'Deploy this earlier package again?' : 'Deploy the package before the current one again?')) return;
    try { const r = await post<any>(`/api/projects/${projectId}/rollback`, { to }); toast(`Rolled back to ${r.package.version}`); await load(); await reload(); } catch (e: any) { toast(e.message, true); }
  };
  return (
    <>
      <div className="phead"><div><h2>Releases</h2><p>A package holds the whole project: every deployed Sutra at its version, connections (secret names, never values), schemas and variables. Promote the same file from test to production; each environment keeps its own deployment config. The command-line tool does the same: <code>sutra package</code>, <code>sutra deploy</code>.</p></div></div>
      <p className="h">Build a package</p>
      <div className="row2">
        <div className="fld"><label htmlFor="rv">Version</label><input id="rv" className="code" value={version} onChange={e => setVersion(e.target.value)} placeholder="1.4.0" /></div>
        <div className="fld"><label htmlFor="rn">Note</label><input id="rn" value={note} onChange={e => setNote(e.target.value)} placeholder="What changed" /></div>
      </div>
      <div className="row">
        <button className="btn primary" disabled={busy === 'zip'} onClick={buildZip} title="Package, deployment config and README in one zip, for the production team">{busy === 'zip' ? 'Building' : 'Download release (.zip)'}</button>
        <button className="btn" disabled={busy === 'build'} onClick={build}>{busy === 'build' ? 'Building' : 'Package only (.sutra)'}</button>
      </div>
      <p className="muted xs">The zip carries the project's documentation, made from the Sutras and the descriptions of their steps: <a href={`/api/projects/${projectId}/documentation`} target="_blank" rel="noopener">open it now</a> or <a href={`/api/projects/${projectId}/documentation?format=md`}>as Markdown</a>.</p>
      <p className="muted xs">For production, a CI pipeline builds the same zip from the Git repository: <code>sutra package --from-git &lt;repository&gt; --ref v1.4.0 --version 1.4.0</code>, and deploys it with <code>sutra deploy</code> or the Admin Console (Releases).</p>
      <p className="h" style={{ marginTop: 18 }}>Deploy a package here</p>
      <input type="file" accept=".zip,.sutra,.json" aria-label="Release zip or package file" onChange={e => pick(e.target.files?.[0])} />
      {pending && (
        <div className={pending.check.ok ? 'okbox' : 'errbox'} role="status">
          <b>{pending.pkg.name} {pending.pkg.version}</b>: {pending.pkg.sutras.length} Sutras{pending.config ? ', with its deployment config' : ''}{pending.files?.length ? ` and ${pending.files.length} files` : ''}. {pending.check.ok ? 'Ready to deploy.' : 'Cannot be deployed:'}
          <ul>{[...pending.check.errors, ...pending.check.warnings].map((x: string) => <li key={x}>{x}</li>)}</ul>
          {pending.check.ok && <>
            <label className="check"><input type="checkbox" checked={keepOthers} onChange={e => setKeepOthers(e.target.checked)} /> Keep Sutras that are not in the package deployed</label>
            <div className="row"><button className="btn primary" disabled={busy === 'deploy'} onClick={deploy}>Deploy to {project?.name}</button><button className="btn" onClick={() => setPending(null)}>Cancel</button></div>
          </>}
        </div>
      )}
      <p className="h" style={{ marginTop: 18 }}>History</p>
      {!hist.length ? <p className="muted">No package deployed to this project yet.</p> : (
        <table className="t"><thead><tr><th>Deployed</th><th>Package</th><th>By</th><th /></tr></thead><tbody>
          {hist.map((h, i) => (
            <tr key={h.id}><td>{new Date(h.deployed_at).toLocaleString()}</td><td>{h.name} <b>{h.version}</b> <span className="muted xs">{h.checksum.slice(7, 19)}</span>{i === 0 && <span className="pill ok" style={{ marginLeft: 6 }}>current</span>}</td><td>{h.deployed_by}</td>
              <td>{i > 0 && <button className="btn small" onClick={() => rollback(h.id)}>Deploy again</button>}</td></tr>
          ))}
        </tbody></table>
      )}
      {hist.length > 1 && <button className="btn" style={{ marginTop: 8 }} onClick={() => rollback()}>Roll back to the previous package</button>}
    </>
  );
}
