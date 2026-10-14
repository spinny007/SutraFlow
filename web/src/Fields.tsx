import { useEffect, useRef, useState, type DragEvent } from 'react';
import { get } from './api';
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
}

export function FieldList({ fields, values, onChange, resources, secrets, onFocusField, extra }: Props) {
  let lastGroup: string | undefined;
  return (
    <>
      {fields.filter(f => visible(f, values, fields)).map(f => {
        const header = f.group && f.group !== lastGroup ? <div className="group">{f.group}</div> : null;
        lastGroup = f.group;
        return <div key={f.k}>{header}<FieldInput f={f} value={values[f.k] ?? f.def ?? ''} onChange={v => onChange(f.k, v)} resources={resources} secrets={secrets} onFocusField={onFocusField} />{extra?.(f)}</div>;
      })}
    </>
  );
}

function FieldInput({ f, value, onChange, resources, secrets, onFocusField }: {
  f: Field; value: any; onChange(v: any): void; resources: Resource[]; secrets: { name: string }[]; onFocusField?(el: El | null): void;
}) {
  const id = `f-${f.k}`;
  const focus = (e: React.FocusEvent<El>) => f.tpl && onFocusField?.(e.currentTarget);
  const code = f.type === 'code' || f.tpl;
  let input: React.ReactNode;
  switch (f.type) {
    case 'select':
      input = <select id={id} value={value} onChange={e => onChange(e.target.value)}>{(f.options || []).map(o => <option key={o} value={o}>{o}</option>)}</select>;
      break;
    case 'bool':
      return (
        <div className="fld"><label className="check"><input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} /> {f.label}</label>{f.help && <div className="hint">{f.help}</div>}</div>
      );
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
      input = (
        <select id={id} value={value} onChange={e => onChange(e.target.value)}>
          <option value="">(none)</option>
          {secrets.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
          {value && !secrets.some(s => s.name === value) && <option value={value}>{value} (not created yet)</option>}
        </select>
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
      input = <textarea id={id} className="code" rows={3} spellCheck={false} value={Array.isArray(value) ? value.join('\n') : String(value || '')} onChange={e => onChange(e.target.value.split('\n'))} onBlur={e => onChange(e.target.value.split('\n').map(x => x.trim()).filter(Boolean))} />;
      break;
    case 'kv':
      return <KvInput f={f} rows={Array.isArray(value) ? value : []} onChange={onChange} onFocusField={onFocusField} />;
    default:
      input = <input id={id} type="text" className={code || String(value).includes('{{') || String(value).startsWith('=') ? 'code' : ''} spellCheck={false} placeholder={f.placeholder} value={value} onChange={e => onChange(e.target.value)} onFocus={focus} {...dropProps(!!f.tpl)} />;
  }
  // Settings fields can use project ({{gv.X}}) and engine ({{ev.X}}) variables.
  const picker = !f.tpl && (f.type === 'text' || f.type === 'list' || f.type === undefined)
    ? <VarPicker target={id} onInsert={ref => {
      const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
      if (el && document.activeElement === el) insertAtCaret(el, ref);
      else if (f.type === 'list') onChange([...(Array.isArray(value) ? value : []), ref]);
      else onChange(String(value ?? '') + ref);
    }} />
    : null;
  return <div className="fld"><label htmlFor={id}>{f.label}{picker}</label>{input}{f.help && <div className="hint">{f.help}</div>}</div>;
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
          <input className="inp code" aria-label={`${f.label} value ${i + 1}`} value={r.v} spellCheck={false} onChange={e => set(i, 'v', e.target.value)} onFocus={e => f.tpl && onFocusField?.(e.currentTarget)} {...dropProps(!!f.tpl)} />
          <button className="x" aria-label="Remove row" onClick={() => onChange(rows.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button className="btn small" onClick={() => { lastAdded.current = true; onChange([...rows, { k: '', v: '' }]); }}>+ Add row</button>
      {f.help && <div className="hint">{f.help}</div>}
    </div>
  );
}

/** Picks a shared schema of the project; XSDs with several top-level elements list each root. */
function SchemaPick({ f, id, value, onChange }: { f: Field; id: string; value: string; onChange(v: any): void }) {
  const { schemas } = useCatalog();
  const kinds = f.schemaKinds || ['json', 'xsd'];
  const opts = schemas.filter(s => kinds.includes(s.kind)).flatMap(s =>
    s.kind === 'xsd' && s.roots.length > 1 ? s.roots.map(r => ({ v: `${s.id}::${r}`, l: `${s.name} / ${r}` })) : [{ v: s.id, l: `${s.name} (${s.kind.toUpperCase()})` }]);
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
function VarPicker({ target, onInsert }: { target: string; onInsert(ref: string): void }) {
  const { project } = useCatalog();
  const [open, setOpen] = useState(false);
  const [engine, setEngine] = useState<{ name: string; description?: string }[] | null>(null);
  const vars = project?.config.variables || [];
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
          {!vars.length && !engine?.length && <span className="muted xs" style={{ padding: 6 }}>No variables yet. Add them under Project variables.</span>}
          {vars.map(v => <button type="button" key={'gv' + v.name} role="menuitem" onMouseDown={e => e.preventDefault()} onClick={() => { onInsert(`{{gv.${v.name}}}`); setOpen(false); }}><code>gv.{v.name}</code><span className="muted xs">{v.type === 'secret' ? 'secret' : v.value}</span></button>)}
          {(engine || []).map(v => <button type="button" key={'ev' + v.name} role="menuitem" onMouseDown={e => e.preventDefault()} onClick={() => { onInsert(`{{ev.${v.name}}}`); setOpen(false); }}><code>ev.{v.name}</code><span className="muted xs">engine</span></button>)}
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
