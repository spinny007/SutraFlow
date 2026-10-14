import { useEffect, useState } from 'react';
import { del, get, post, put } from './api';
import { FieldList } from './Fields';
import { Modal, useCatalog, useToast } from './ui';
import type { FlowSummary, LoggingConfig, ProjectVariable, Resource, SchemaInfo, SNode } from './types';

/** What the right-hand panel shows when a project item (not an activity) is selected. */
export type ExplorerSel =
  | { kind: 'resource'; id: string }
  | { kind: 'newResource'; resourceKind: string }
  | { kind: 'schema'; id: string }
  | { kind: 'newSchema'; schemaKind: 'json' | 'xsd' | 'wsdl' }
  | { kind: 'variables' }
  | { kind: 'ops' }
  | { kind: 'logging' };

export function ProjectExplorer({ flows, flowId, openFlow, newFlow, sel, setSel }: {
  flows: FlowSummary[]; flowId: string | null; openFlow(id: string): void; newFlow(): void;
  sel: ExplorerSel | null; setSel(s: ExplorerSel | null): void;
}) {
  const { meta, projects, projectId, setProjectId, resources, schemas, project, reload } = useCatalog();
  const toast = useToast();
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [creating, setCreating] = useState(false);
  const [kindMenu, setKindMenu] = useState(false);
  const kindOrder = (kind: string) => meta.resourceKinds.findIndex(k => k.kind === kind);
  const [name, setName] = useState('');
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

  const createProject = async () => {
    try {
      const p = await post('/api/projects', { name });
      setCreating(false); setName('');
      setProjectId(p.id);
      await reload();
    } catch (e: any) { toast(e.message, true); }
  };

  return (
    <div className="explorer">
      <div className="row" style={{ gap: 6, marginBottom: 6 }}>
        <select className="search" style={{ flex: 1 }} aria-label="Project" value={projectId} onChange={e => { setProjectId(e.target.value); setSel(null); }}>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button className="btn small" title="New project" onClick={() => setCreating(true)}>+</button>
      </div>
      {project?.description && <p className="muted xs" style={{ margin: '0 2px 6px' }}>{project.description}</p>}
      {sec('proc', 'Sutras', flows.length, newFlow, flows.map(f => item(f.name, f.id === flowId && !sel, () => { setSel(null); openFlow(f.id); }, '⧉', f.deployed ? `v${f.deployed.version}` : undefined)))}
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
        {[...resources].sort((a, b) => kindOrder(a.kind) - kindOrder(b.kind) || a.name.localeCompare(b.name)).map(r => {
          const k = meta.resourceKinds.find(x => x.kind === r.kind);
          return <div key={r.id} title={k?.name}>{item(r.name, isSel({ kind: 'resource', id: r.id }), () => setSel({ kind: 'resource', id: r.id }), k?.icon || '⚙')}</div>;
        })}
      </>)}
      {sec('sch', 'Schemas', schemas.filter(s => s.kind !== 'wsdl').length, () => setSel({ kind: 'newSchema', schemaKind: 'json' }),
        schemas.filter(s => s.kind !== 'wsdl').map(s => <div key={s.id}>{item(s.name, isSel({ kind: 'schema', id: s.id }), () => setSel({ kind: 'schema', id: s.id }), 'S', s.kind.toUpperCase())}</div>))}
      {sec('wsdl', 'Service descriptors', schemas.filter(s => s.kind === 'wsdl').length, () => setSel({ kind: 'newSchema', schemaKind: 'wsdl' }),
        schemas.filter(s => s.kind === 'wsdl').map(s => <div key={s.id}>{item(s.name, isSel({ kind: 'schema', id: s.id }), () => setSel({ kind: 'schema', id: s.id }), 'W', 'WSDL')}</div>))}
      {sec('cfg', 'Configuration', 3, undefined, <>
        {item(`Project variables (${project?.config.variables.length ?? 0})`, isSel({ kind: 'variables' }), () => setSel({ kind: 'variables' }), '$')}
        {item('Deployment config (ops)', isSel({ kind: 'ops' }), () => setSel({ kind: 'ops' }), '⇅')}
        {item('Logging', isSel({ kind: 'logging' }), () => setSel({ kind: 'logging' }), '≡')}
      </>)}
      {creating && (
        <Modal title="New project" onClose={() => setCreating(false)} actions={<><button className="btn" onClick={() => setCreating(false)}>Cancel</button><button className="btn primary" disabled={!name.trim()} onClick={createProject}>Create project</button></>}>
          <p className="muted">A project holds Sutras, shared resources, schemas, variables and its deployment config.</p>
          <div className="fld"><label htmlFor="pn">Name</label><input id="pn" type="text" value={name} autoFocus onChange={e => setName(e.target.value)} /></div>
        </Modal>
      )}
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
    </div></aside>
  );
}

function ResourceEditor({ sel, setSel }: { sel: Extract<ExplorerSel, { kind: 'resource' | 'newResource' }>; setSel(s: ExplorerSel | null): void }) {
  const { meta, resources, secrets, projectId, reload } = useCatalog();
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
      <FieldList fields={k.fields} values={r.config} onChange={(fk, v) => { setR({ ...r, config: { ...r.config, [fk]: v } }); setTest(null); }} resources={resources} secrets={secrets} />
      {test && test !== 'running' && <div className={test.ok ? 'okbox' : 'errbox'} role="status"><b>{test.ok ? 'Connection works.' : 'Connection failed.'}</b> {test.message}{test.ms ? <span className="muted"> ({test.ms} ms)</span> : null}</div>}
      <div className="row">
        <button className="btn primary" onClick={save}>Save</button>
        {k.kind !== 'inboundPolicy' && <button className="btn" onClick={runTest} disabled={test === 'running'}>{test === 'running' ? 'Testing' : 'Test connection'}</button>}
        {r.id && <button className="btn danger" onClick={remove}>Delete</button>}
      </div>
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
  const [tail, setTail] = useState<{ file: string | null; lines: string[] } | null>(null);
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
      <div className="row"><button className="btn primary" onClick={save}>Save</button>
        <button className="btn" onClick={() => get(`/api/projects/${project!.id}/log?lines=200`).then(setTail).catch(e => toast(e.message, true))}>View log</button></div>
      {tail && <><p className="sub" style={{ marginTop: 10 }}>{tail.file || 'Logging is off'}</p>{tail.lines.length ? <pre className="json">{tail.lines.join('\n')}</pre> : <p className="muted">Empty.</p>}</>}
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
