/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 2.0.7
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { useEffect, useState } from 'react';
import { get, post, put } from './api';
import { Modal, useCatalog } from './ui';
import { SchemaPick } from './Fields';
import { deleteMappingField } from './mapping-fields';
import { XmlOutput } from './XmlOutput';
import type { Field, FlowNode, MappingValue, SNode } from './types';

export function MappingSchemaTools({ node, field, setCfg }: { node: FlowNode; field: Field; setCfg(k: string, v: any): void }) {
  const { projectId, schemas, reload } = useCatalog();
  const [form, setForm] = useState<{ id?: string; name: string; kind: string; text: string; root: string; sample: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uses, setUses] = useState<string[]>([]);
  const ref = String(node.config[field.k] || '').split('::')[0];
  const info = schemas.find(s => s.id === ref);
  const kind = node.type === 'mapperXml' || node.type === 'renderXml' ? 'xsd' : node.type === 'mapperJson' || node.type === 'renderJson' ? 'json' : info?.kind;
  const open = async (edit: boolean) => {
    setError(''); setUses([]);
    if (edit && info) {
      const stored = await get<any>(`/api/schemas/${info.id}`);
      const usage = await get<any>(`/api/projects/${projectId}/usage?item=${info.id}`);
      setUses(usage.sutras || []);
      setForm({ ...stored, root: stored.root || '', sample: '' });
    } else setForm({ name: '', kind: kind || 'json', root: '', text: '', sample: '' });
  };
  return <div className="mapping-schema-tools">
    <SchemaPick f={field} id={`input-${node.id}-${field.k}`} value={String(node.config[field.k] || '')} onChange={v => setCfg(field.k, v)} />
    <div className="row"><button className="btn small" onClick={() => open(false).catch(e => setError(e.message))}>Create schema</button>
      {info && <button className="btn small" onClick={() => open(true).catch(e => setError(e.message))}>Edit shared schema</button>}</div>
    {error && !form && <div className="errbox">{error}</div>}
    {form && <Modal title={form.id ? 'Edit shared schema' : 'Create shared schema'} onClose={() => setForm(null)}>
      {form.id && <div className="warnbox">Changing this shared schema affects other activities that use it. Sutras: {uses.join(', ') || 'none saved yet'}. Review mappings after saving.</div>}
      <label className="fld">Schema name<input className="inp" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
      <label className="fld">Schema kind<select value={form.kind} disabled={!!form.id || !!kind} onChange={e => setForm({ ...form, kind: e.target.value })}><option value="json">JSON Schema</option><option value="xsd">XML Schema (XSD)</option></select></label>
      {!form.id && <details><summary>Create from sample JSON/XML</summary>
        <textarea className="inp code" aria-label="Schema sample" value={form.sample} onChange={e => setForm({ ...form, sample: e.target.value })} />
        <button className="btn small" disabled={busy || !form.sample.trim()} onClick={async () => { setBusy(true); setError(''); try {
          const result = await post<any>('/api/design/schema-from-sample', { projectId, kind: form.kind, sample: form.sample });
          setForm({ ...form, text: result.text, root: result.root || '' });
        } catch (e: any) { setError(e.message); } finally { setBusy(false); } }}>Generate proposed schema</button>
        <p className="hint">Review inferred types and occurrences before saving. XML inference does not preserve namespace bindings; use an authored XSD and explicit namespace mappings for namespaced documents.</p>
      </details>}
      <label className="fld">Schema definition<textarea className="inp code" rows={12} value={form.text} onChange={e => setForm({ ...form, text: e.target.value })} /></label>
      {form.kind === 'xsd' && <label className="fld">Default root element<input className="inp" value={form.root} onChange={e => setForm({ ...form, root: e.target.value })} /></label>}
      {error && <div role="alert" className="errbox">{error}</div>}
      <button className="btn go" disabled={busy || !form.name.trim() || !form.text.trim()} onClick={async () => {
        setBusy(true); setError('');
        try {
          const body = { project_id: projectId, name: form.name, kind: form.kind, text: form.text, root: form.root };
          const saved = form.id ? await put<any>(`/api/schemas/${form.id}`, body) : await post<any>('/api/schemas', body);
          await reload(); setCfg(field.k, saved.id); setForm(null);
        } catch (e: any) { setError(e.message); } finally { setBusy(false); }
      }}>Save and select schema</button>
    </Modal>}
  </div>;
}

export function TargetFieldOptions({ path, shape, mapping, xml, onChange }: { path: string; shape: SNode; mapping: MappingValue; xml: boolean; onChange(v: MappingValue): void }) {
  const [deleting, setDeleting] = useState(false);
  const def = mapping.definitions?.[path] || {};
  const change = (patch: Partial<typeof def>) => onChange({ ...mapping, definitions: { ...mapping.definitions, [path]: { ...def, type: shape.type, repeats: !!shape.repeats, required: !!shape.required, ...patch } } });
  const attribute = path.split('/').at(-1)?.startsWith('@_');
  return <div className="target-options">
    <b>Target field: {path}</b>
    <div className="row">
      <label>Type <select aria-label="Target field type" value={shape.type} onChange={e => change({ type: e.target.value as SNode['type'] })}>
        {['any', 'string', 'integer', 'number', 'boolean', 'date', 'object', 'null'].filter(t => !attribute || !['object', 'null'].includes(t)).map(t => <option key={t}>{t}</option>)}
      </select></label>
      <label><input type="checkbox" checked={!!shape.required} onChange={e => change({ required: e.target.checked })} />Required</label>
      <label><input type="checkbox" disabled={attribute} checked={!!shape.repeats} onChange={e => change({ repeats: e.target.checked, minItems: undefined, maxItems: undefined })} />Repeating / array</label>
    </div>
    {shape.repeats && <div className="row">{(['minItems', 'maxItems'] as const).map(k => <label key={k}>{k}<input aria-label={k} type="number" min={0} step={1} value={shape[k] ?? ''} onChange={e => change({ [k]: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>)}</div>}
    <label className="fld">Field description<input className="inp" value={def.description || ''} onChange={e => change({ description: e.target.value })} /></label>
    {xml && shape.type === 'object' && !attribute && <label className="fld">Namespace URI (declared on this element)<input className="inp" value={def.namespace || ''} onChange={e => change({ namespace: e.target.value })} /></label>}
    <button className="btn small danger" onClick={() => setDeleting(true)}>Delete target field</button>
    {deleting && <Modal title="Delete target field?" onClose={() => setDeleting(false)}>
      <p>Remove <b>{path}</b>, every child field, their type definitions and mapping formulas? Source fields are unchanged. Undo restores this change.</p>
      <button className="btn danger" onClick={() => { onChange(deleteMappingField(mapping, path)); setDeleting(false); }}>Delete field and child mappings</button>
    </Modal>}
  </div>;
}

export function MappingPreview({ config, scope, format, runLabel }: { config: Record<string, any>; scope: any; format: 'data' | 'json' | 'xml'; runLabel?: string }) {
  const { projectId } = useCatalog();
  const [open, setOpen] = useState(false);
  const [sample, setSample] = useState('');
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    let active = true;
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const input = sample.trim() ? JSON.parse(sample) : scope.input;
        const response = await post('/api/design/mapping-preview', { projectId, config, scope: { ...scope, input }, format });
        if (active) setResult(response);
      } catch (e: any) { if (active) setResult({ ok: false, errors: [e.message] }); }
      finally { if (active) setBusy(false); }
    }, 350);
    return () => { active = false; clearTimeout(timer); };
  }, [open, sample, projectId, config, scope, format]);
  return <div className="mapping-preview">
    <button className="btn" onClick={() => setOpen(!open)}>{open ? 'Hide mapped result' : 'Preview mapped result'}</button>
    {open && <>
      <p className="hint">Read-only: no activity, database write, message or downstream step is executed. {runLabel ? 'Data from test run ' + runLabel + '; it may be stale.' : 'No test run data. Enter sample input below.'}</p>
      <textarea className="inp code" aria-label="Preview sample input JSON" placeholder="Optional JSON sample to replace the previous step input" value={sample} onChange={e => setSample(e.target.value)} />
      {busy && <p>Updating preview…</p>}
      {result?.ok ? <pre className="okbox" style={{ maxHeight: 320, overflow: 'auto' }}>{result.text}</pre> : result?.errors?.length ? <div role="alert" className="errbox">{result.errors.join('\n')}</div> : null}
      {!!result?.warnings?.length && <div className="warnbox">{result.warnings.join('\n')}</div>}
      {result?.ok && format === 'xml' && <XmlOutput value={result.text} />}
    </>}
  </div>;
}
