/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { get, put } from './api';
import type { Field, Resource } from './types';
import { useCatalog } from './ui';

/** MIME type used when dragging a data reference from the mapper tree. */
export const REF_MIME = 'application/x-sutra-ref';

type El = HTMLInputElement | HTMLTextAreaElement;

export function insertAtCaret(el: El, text: string) {
  const s = el.selectionStart ?? el.value.length, e = el.selectionEnd ?? el.value.length;
  const v = el.value.slice(0, s) + text + el.value.slice(e);
  const setter = Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!;
  setter.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.focus();
  try { el.setSelectionRange(s + text.length, s + text.length); } catch { /* number inputs */ }
}

/** Accepts drops from the data tree into any mapping-enabled input. */
export const dropProps = (enabled: boolean) => enabled ? {
  onDragOver: (e: DragEvent<El>) => { if (e.dataTransfer.types.includes(REF_MIME)) { e.preventDefault(); e.currentTarget.classList.add('dropping'); } },
  onDragLeave: (e: DragEvent<El>) => e.currentTarget.classList.remove('dropping'),
  onDrop: (e: DragEvent<El>) => {
    const ref = e.dataTransfer.getData(REF_MIME);
    e.currentTarget.classList.remove('dropping');
    if (!ref) return;
    e.preventDefault();
    const el = e.currentTarget;
    // Replace the whole value when it is empty or a single reference; otherwise insert at the caret.
    if (!el.value.trim() || /^\s*\{\{[^{}]*\}\}\s*$/.test(el.value)) { el.select(); }
    insertAtCaret(el, ref);
  },
} : {};

function holds(c: { k: string; in: any[] }, values: Record<string, any>, all: Field[]): boolean {
  const dep = all.find(x => x.k === c.k);
  if (dep && !visible(dep, values, all)) return false;
  return c.in.includes(values[c.k] ?? dep?.def);
}

export function visible(f: Field, values: Record<string, any>, all: Field[]): boolean {
  if (f.showIf && !holds(f.showIf, values, all)) return false;
  if (f.showIfAny && !f.showIfAny.some(c => holds(c, values, all))) return false;
  return true;
}

interface Props {
  fields: Field[];
  values: Record<string, any>;
  onChange(k: string, v: any): void;
  resources: Resource[];
  secrets: { name: string }[];
  onFocusField?(el: El | null): void;
  extra?(f: Field): React.ReactNode;
  inlineCredentials?: boolean;
}

export function FieldList({ fields, values, onChange, resources, secrets, onFocusField, extra, inlineCredentials }: Props) {
  let lastGroup: string | undefined;
  return (
    <>
      {fields.filter(f => visible(f, values, fields)).map(f => {
        const header = f.group && f.group !== lastGroup ? <div className="group">{f.group}</div> : null;
        lastGroup = f.group;
        return <div key={f.k}>{header}<FieldInput f={f} value={values[f.k] ?? f.def ?? ''} onChange={v => onChange(f.k, v)} resources={resources} secrets={secrets} onFocusField={onFocusField} inlineCredentials={inlineCredentials} />{extra?.(f)}</div>;
      })}
    </>
  );
}

function FieldInput({ f, value, onChange, resources, secrets, onFocusField, inlineCredentials }: {
  f: Field; value: any; onChange(v: any): void; resources: Resource[]; secrets: { name: string }[]; onFocusField?(el: El | null): void; inlineCredentials?: boolean;
}) {
  const id = `f-${f.k}`;
  const focus = (e: React.FocusEvent<El>) => f.tpl && onFocusField?.(e.currentTarget);
  const code = f.type === 'code' || f.tpl;
  let input: React.ReactNode;
  switch (f.type) {
    case 'select':
      return <div className="fld"><label htmlFor={id}>{f.label}<VarPicker target={id} onInsert={onChange} /></label>
        <select id={id} value={value} onChange={e => onChange(e.target.value)}>
          {typeof value === 'string' && (value.startsWith('=') || value.includes('{{')) && <option value={value}>{value}</option>}
          {(f.options || []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>{f.help && <div className="hint">{f.help}</div>}</div>;
    case 'bool': {
      const dyn = typeof value === 'string' && (value.startsWith('=') || value.includes('{{'));
      const fixedOn = typeof value === 'string' ? /^(true|on|yes|1)$/i.test(value.trim()) : value === true || value === 1;
      const invalidLiteral = typeof value === 'string' && !/^(true|false|on|off|yes|no|1|0)$/i.test(value.trim());
      return dyn || invalidLiteral
        ? <div className="fld"><label htmlFor={id}>{f.label}<VarPicker target={id} onInsert={onChange} /></label><div className="row"><input id={id} type="text" className="code" value={value} onChange={e => onChange(e.target.value)} /><button type="button" className="btn small" onClick={() => onChange(false)}>Use fixed value</button></div><div className="hint">Property-controlled: true/on/yes/1 = On; false/off/no/0 = Off. Missing or other values are errors.</div>{f.help && <div className="hint">{f.help}</div>}</div>
        : <div className="fld"><span className="lbl">{f.label}<VarPicker target={id} onInsert={onChange} /></span><label className="check"><input type="checkbox" checked={fixedOn} onChange={e => onChange(e.target.checked)} /> {fixedOn ? 'On' : 'Off'}</label>{f.help && <div className="hint">{f.help}</div>}</div>;
    }
    case 'number': {
      // A number, or a variable / formula such as {{gv.TIMEOUT}}.
      const dyn = typeof value === 'string' && (value.startsWith('=') || value.includes('{{'));
      input = dyn
        ? <input id={id} type="text" className="code" spellCheck={false} value={value} onChange={e => onChange(e.target.value === '' ? '' : /^-?\d+(\.\d+)?$/.test(e.target.value) ? Number(e.target.value) : e.target.value)} />
        : <input id={id} type="number" value={value} onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))} />;
      return <div className="fld"><label htmlFor={id}>{f.label}<VarPicker target={id} onInsert={ref => onChange(dyn ? `${value}${ref}` : ref)} /></label>{input}{f.help && <div className="hint">{f.help}</div>}</div>;
    }
    case 'textarea':
    case 'code':
      input = <textarea id={id} className={code ? 'code' : ''} spellCheck={false} value={typeof value === 'string' ? value : JSON.stringify(value, null, 2)} onChange={e => onChange(e.target.value)} onFocus={focus} {...dropProps(!!f.tpl)} rows={f.type === 'code' ? 6 : 3} />;
      break;
    case 'resource': {
      const opts = resources.filter(r => r.kind === f.resourceKind);
      input = (
        <select id={id} value={value} onChange={e => onChange(e.target.value)}>
          <option value="">(none)</option>
          {opts.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          {value && !opts.some(r => r.id === value) && <option value={value}>(missing resource)</option>}
        </select>
      );
      break;
    }
    case 'secret':
      if (inlineCredentials) return <div className="fld"><label htmlFor={id}>{f.label}</label><SecretPropertyPick id={id} label={f.label} value={String(value || '')} onChange={onChange} />{f.help && <div className="hint">{f.help}</div>}</div>;
      input = (
        <>
          <select id={id} value={value} onChange={e => onChange(e.target.value)}>
            <option value="">(none)</option>
            {secrets.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
            {value && !secrets.some(s => s.name === value) && <option value={value}>{/^\{\{\s*(gv|ev)\.[A-Za-z_][A-Za-z0-9_]*\s*\}\}$/.test(value) ? value : '(missing or invalid credential reference)'}</option>}
          </select>
          <VarPicker target={id} onInsert={onChange} secretOnly />
          <div className="hint">Prefer a Secret-type project property (gv), or an administrator-provided Secret engine property (ev). Never use an ordinary string property for passwords.</div>
          {inlineCredentials && <InlineCredential key={f.k} label={f.label} onStored={onChange} />}
        </>
      );
      break;
    case 'schema':
      return <SchemaPick f={f} id={id} value={value} onChange={onChange} />;
    case 'process':
      return <ProcessPick f={f} id={id} value={value} onChange={onChange} />;
    case 'mapping':
      return (
        <div className="fld"><span className="lbl">{f.label}</span>
          <div className="hint">Mapped field by field in the <b>Input</b> tab.</div></div>
      );
    case 'list':
      if (f.options?.length) {
        const on = new Set(Array.isArray(value) ? value : []);
        return (
          <div className="fld"><span className="lbl">{f.label}</span>
            {f.options.map(o => <label key={o} className="check"><input type="checkbox" checked={on.has(o)} onChange={e => onChange(f.options!.filter(x => (x === o ? e.target.checked : on.has(x))))} /> {o}</label>)}
            {f.help && <div className="hint">{f.help}</div>}</div>
        );
      }
      input = <textarea id={id} className="code" rows={3} spellCheck={false} value={Array.isArray(value) ? value.join('\n') : String(value || '')} onChange={e => onChange(e.target.value.split('\n'))} onBlur={e => onChange(e.target.value.split('\n').map(x => x.trim()).filter(Boolean))} />;
      break;
    case 'kv':
      return <KvInput f={f} rows={Array.isArray(value) ? value : []} onChange={onChange} onFocusField={onFocusField} />;
    default:
      input = <input id={id} type="text" className={code || String(value).includes('{{') || String(value).startsWith('=') ? 'code' : ''} spellCheck={false} placeholder={f.placeholder} value={value} onChange={e => onChange(e.target.value)} onFocus={focus} {...dropProps(!!f.tpl)} />;
  }
  // Settings fields can use project ({{gv.X}}) and engine ({{ev.X}}) variables.
  const picker = !f.tpl && (f.type === 'text' || f.type === 'list' || f.type === undefined || !!f.vars)
    ? <VarPicker target={id} onInsert={ref => {
      const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
      if (el && document.activeElement === el) insertAtCaret(el, ref);
      else if (f.type === 'list') onChange([...(Array.isArray(value) ? value : []), ref]);
      else onChange(String(value ?? '') + ref);
    }} />
    : null;
  return <div className="fld"><label htmlFor={id}>{f.label}{picker}</label>{input}{f.help && <div className="hint">{f.help}</div>}</div>;
}

/** Explicit encrypted storage; plaintext never enters resource configuration or GV values. */
export type CredentialStore = () => Promise<string | undefined>;
export type RegisterCredentialStore = (store: CredentialStore) => () => void;
export function InlineCredential({ label, onStored, registerStore, propertyName }: { label: string; onStored(name: string): void; registerStore?: RegisterCredentialStore; propertyName?: string }) {
  const { projectId, reload } = useCatalog();
  const saveValue = propertyName !== undefined ? async (secretValue: string) => (await put(`/api/projects/${encodeURIComponent(projectId)}/variables/${encodeURIComponent(propertyName)}/secret`, { secretValue, create: true })).secretRef : undefined;
  return <SecretValueEntry label={label} onStored={onStored} namespace={projectId} onReload={reload} registerStore={registerStore} saveValue={saveValue} />;
}
export function SecretValueEntry({ label, onStored, namespace, onReload, registerStore, saveValue }: { label: string; onStored(name: string): void; namespace?: string; onReload?(): Promise<void>; registerStore?: RegisterCredentialStore; saveValue?(plain: string): Promise<string> }) {
  const [open, setOpen] = useState(false), [plain, setPlain] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [show, setShow] = useState(false);
  const latest = useRef(onStored), alive = useRef(true);
  latest.current = onStored;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const inFlight = useRef<Promise<string | undefined> | null>(null);
  const store: CredentialStore = () => {
    if (inFlight.current) return inFlight.current;
    if (!open || !plain) return Promise.resolve(undefined);
    setBusy(true); setError('');
    const request = (async () => {
    try {
      let name: string;
      if (saveValue) name = await saveValue(plain);
      else {
        const entropy = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
        name = `conn_${String(namespace || 'shared').replace(/[^A-Za-z0-9]/g, '').slice(0, 12)}_${entropy}`;
        await put(`/api/secrets/${name}`, { value: plain });
      }
      if (alive.current) { latest.current(name); setPlain(''); setOpen(false); setShow(false); void onReload?.().catch(() => {}); }
      return name;
    } catch { const message = 'Could not store the encrypted value. Check your Manage secrets permission and server connection.'; if (alive.current) setError(message); throw new Error(message); }
    finally { if (alive.current) setBusy(false); }
    })();
    inFlight.current = request;
    void request.then(() => { inFlight.current = null; }, () => { inFlight.current = null; });
    return request;
  };
  const currentStore = useRef(store); currentStore.current = store;
  useEffect(() => registerStore?.(() => currentStore.current()), [registerStore]);
  return <div style={{ marginTop: 6 }}>
    {!open ? <button type="button" className="btn small" onClick={() => { setPlain(''); setError(''); setShow(false); setOpen(true); }}>Enter new value</button> : <>
      <div className="row"><input type={show ? 'text' : 'password'} aria-label={`New ${label}`} autoComplete="new-password" value={plain} onChange={e => setPlain(e.target.value)} disabled={busy} /><button type="button" className="btn small" aria-label={show ? 'Hide entered value' : 'Reveal entered value'} aria-pressed={show} disabled={busy} onClick={() => setShow(s => !s)}><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>{show && <path d="m3 3 18 18"/>}</svg></button></div>
      <div className="row"><button type="button" className="btn small" disabled={!plain || busy} onClick={() => { void store().catch(() => {}); }}>{busy ? 'Storing…' : 'Store encrypted value'}</button><button type="button" className="btn small" disabled={busy} onClick={() => { setPlain(''); setOpen(false); setError(''); setShow(false); }}>Cancel</button></div>
    </>}
    <div className="hint">{registerStore ? 'Save also encrypts a value still being entered and saves its reference. ' : 'Store the encrypted value, then save the connection/property. '}Stored values are never read back; the eye reveals only a value you are entering. Requires Manage secrets permission.</div>
    {error && <div className="errbox" role="alert">{error}</div>}
  </div>;
}

/** Connection credentials reference named Secret properties, not a list of vault implementation keys. */
function SecretPropertyPick({ id, label, value, onChange }: { id: string; label: string; value: string; onChange(value: string): void }) {
  const { project, projectId, reload } = useCatalog();
  const [engine, setEngine] = useState<{ name: string; type?: string }[]>([]);
  const [creating, setCreating] = useState(false), [name, setName] = useState('');
  useEffect(() => { get('/api/engine-variables').then(setEngine).catch(() => setEngine([])); }, []);
  const properties = (project?.config.variables || []).filter(v => v.type === 'secret');
  const reference = /^\{\{\s*(gv|ev)\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/.exec(value);
  const gv = reference?.[1] === 'gv' ? reference[2] : undefined;
  const known = properties.some(v => value === `{{gv.${v.name}}}`) || engine.some(v => v.type === 'secret' && value === `{{ev.${v.name}}}`);
  const saveProperty = async (property: string, plain: string, create: boolean) => {
    const result = await put(`/api/projects/${encodeURIComponent(projectId)}/variables/${encodeURIComponent(property)}/secret`, { secretValue: plain, create, onlyCreate: create });
    return String(result.reference);
  };
  return <>
    <select id={id} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">(choose a Secret property)</option>
      <optgroup label="Project Secret properties">{properties.map(v => <option key={v.name} value={`{{gv.${v.name}}}`}>gv.{v.name} (Secret)</option>)}</optgroup>
      <optgroup label="Administrator Secret engine properties">{engine.filter(v => v.type === 'secret').map(v => <option key={v.name} value={`{{ev.${v.name}}}`}>ev.{v.name} (Secret)</option>)}</optgroup>
      {value && !known && <option value={value}>{reference ? `${reference[1]}.${reference[2]} (unavailable or not Secret-type)` : 'Existing encrypted reference (legacy)'}</option>}
    </select>
    <div className="hint">One named Secret property, encrypted internally. Connections store only its gv/ev reference; internal vault keys are not extra variables. Engine properties can be edited only by administrators.</div>
    {gv && properties.some(v => v.name === gv) && <><SecretValueEntry key={`${projectId}:${gv}`} label={`gv.${gv}`} saveValue={plain => saveProperty(gv, plain, false)} onStored={onChange} onReload={reload} /><div className="hint">Updating gv.{gv} changes all uses of this property in this project. Save the connection if its selected property changed.</div></>}
    {!creating ? <button type="button" className="btn small" onClick={() => { setName(''); setCreating(true); }}>+ Secret project variable</button> : <div>
      <label htmlFor={`${id}-property`}>New Secret variable name</label><input id={`${id}-property`} className="inp code" value={name} onChange={e => setName(e.target.value)} placeholder="MONGODB_URI or DB_PASSWORD" maxLength={64} />
      {/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name) && !project?.config.variables.some(v => v.name === name) && <SecretValueEntry key={`${projectId}:${name}`} label={`gv.${name}`} saveValue={plain => saveProperty(name, plain, true)} onStored={ref => { onChange(ref); setCreating(false); }} onReload={reload} />}
      <button type="button" className="btn small" onClick={() => setCreating(false)}>Cancel new variable</button>
      <div className="hint">Use a new variable name; existing properties are never silently replaced or converted.</div>
    </div>}
  </>;
}

function KvInput({ f, rows, onChange, onFocusField }: { f: Field; rows: { k: string; v: string }[]; onChange(v: any): void; onFocusField?(el: El | null): void }) {
  const lastAdded = useRef(false);
  const set = (i: number, part: 'k' | 'v', val: string) => onChange(rows.map((r, j) => (j === i ? { ...r, [part]: val } : r)));
  const mapper = f.k === 'map';
  return (
    <div className="fld">
      <span className="lbl">{f.label}</span>
      {rows.length > 0 && (
        <div className="kv muted" style={{ fontSize: 11, marginBottom: 2 }}>
          <span>{mapper ? 'Target field' : 'Name'}</span><span>{f.tpl ? (mapper ? 'Mapped from (drop data here)' : 'Value') : 'Value'}</span><span />
        </div>
      )}
      {rows.map((r, i) => (
        <div className="kv" key={i}>
          <input className="inp code" aria-label={`${f.label} name ${i + 1}`} value={r.k} spellCheck={false} onChange={e => set(i, 'k', e.target.value)} autoFocus={lastAdded.current && i === rows.length - 1} />
          <span className="kv-var"><input className="inp code" aria-label={`${f.label} value ${i + 1}`} value={r.v} spellCheck={false} onChange={e => set(i, 'v', e.target.value)} onFocus={e => f.tpl && onFocusField?.(e.currentTarget)} {...dropProps(!!f.tpl)} />{!f.tpl && <VarPicker target={`${f.k}-${i}`} onInsert={ref => set(i, 'v', `${r.v || ''}${ref}`)} />}</span>
          <button className="x" aria-label="Remove row" onClick={() => onChange(rows.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button className="btn small" onClick={() => { lastAdded.current = true; onChange([...rows, { k: '', v: '' }]); }}>+ Add row</button>
      {f.help && <div className="hint">{f.help}</div>}
    </div>
  );
}

/** Picks a shared schema of the project; XSDs with several top-level elements list each root. */
export function SchemaPick({ f, id, value, onChange }: { f: Field; id: string; value: string; onChange(v: any): void }) {
  const { schemas } = useCatalog();
  const kinds = f.schemaKinds || ['json', 'xsd'];
  const opts = schemas.filter(s => kinds.includes(s.kind)).flatMap(s => [
    { v: s.id, l: `${s.name} (${s.kind.toUpperCase()})` },
    ...(s.kind === 'xsd' && (s.roots.length > 1 || String(value).startsWith(s.id + '::')) ? s.roots.map(r => ({ v: `${s.id}::${r}`, l: `${s.name} / ${r}` })) : []),
  ]);
  return (
    <div className="fld"><label htmlFor={id}>{f.label}</label>
      <select id={id} value={value || ''} onChange={e => onChange(e.target.value)}>
        <option value="">(none)</option>
        {opts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
        {value && !opts.some(o => o.v === value) && <option value={value}>(missing schema)</option>}
      </select>
      <div className="hint">{f.help || 'Shared schemas live in the project explorer under Schemas.'}</div>
    </div>
  );
}

/** Small menu that inserts a project or engine variable reference. */
export function VarPicker({ target, onInsert, secretOnly }: { target: string; onInsert(ref: string): void; secretOnly?: boolean }) {
  const { project } = useCatalog();
  const [open, setOpen] = useState(false);
  const [engine, setEngine] = useState<{ name: string; description?: string; type?: string }[] | null>(null);
  const vars = (project?.config.variables || []).filter(v => !secretOnly || v.type === 'secret');
  const engineVars = (engine || []).filter(v => !secretOnly || v.type === 'secret');
  const toggle = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!open && engine === null) get('/api/engine-variables').then(setEngine).catch(() => setEngine([]));
    setOpen(o => !o);
  };
  return (
    <span className="varpick">
      <button type="button" className="varbtn" title="Insert a project or engine variable" aria-label={`Insert a variable into ${target}`} onMouseDown={e => e.preventDefault()} onClick={toggle}>{'{x}'}</button>
      {open && (
        <span className="varmenu" role="menu">
          {!vars.length && !engineVars.length && <span className="muted xs" style={{ padding: 6 }}>{secretOnly ? 'No Secret properties yet. Add one under Project variables, or ask an administrator for a Secret engine property.' : 'No variables yet. Add them under Project variables.'}</span>}
          {vars.map(v => <button type="button" key={'gv' + v.name} role="menuitem" onMouseDown={e => e.preventDefault()} onClick={() => { onInsert(`{{gv.${v.name}}}`); setOpen(false); }}><code>gv.{v.name}</code><span className="muted xs">{v.type === 'secret' ? 'secret' : v.value}</span></button>)}
          {engineVars.map(v => <button type="button" key={'ev' + v.name} role="menuitem" onMouseDown={e => e.preventDefault()} onClick={() => { onInsert(`{{ev.${v.name}}}`); setOpen(false); }}><code>ev.{v.name}</code><span className="muted xs">{v.type === 'secret' ? '••••••' : 'engine'}</span></button>)}
        </span>
      )}
    </span>
  );
}

/** Another Sutra of the current project (Call Sutra). */
function ProcessPick({ f, id, value, onChange }: { f: Field; id: string; value: any; onChange(v: any): void }) {
  const { projectId } = useCatalog();
  const [list, setList] = useState<{ id: string; name: string; deployed: { version: number } | null }[]>([]);
  useEffect(() => { get<typeof list>(`/api/flows?projectId=${encodeURIComponent(projectId)}`).then(setList).catch(() => setList([])); }, [projectId]);
  return (
    <div className="fld"><label htmlFor={id}>{f.label}</label>
      <select id={id} value={value || ''} onChange={e => onChange(e.target.value)}>
        <option value="">(choose a Sutra)</option>
        {list.map(p => <option key={p.id} value={p.id}>{p.name}{p.deployed ? ` (deployed v${p.deployed.version})` : ' (not deployed)'}</option>)}
        {value && !list.some(p => p.id === value) && <option value={value}>(missing Sutra)</option>}
      </select>
      {f.help && <div className="hint">{f.help}</div>}
    </div>
  );
}
