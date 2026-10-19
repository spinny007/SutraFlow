/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { useState } from 'react';
import { del, post, put } from './api';
import { FieldList } from './Fields';
import { fmtTime, useCatalog, useToast } from './ui';
import type { Resource } from './types';

/** Shared resources (connections, security profiles, API policies, AI provider) and the secret vault. */
export function Resources() {
  const { meta, resources, secrets, reload, projectId, project } = useCatalog();
  const toast = useToast();
  const [kind, setKind] = useState<string>('secrets');
  const [edit, setEdit] = useState<Resource | null>(null);
  const k = meta.resourceKinds.find(x => x.kind === kind);

  const startNew = (kk: string) => {
    const rk = meta.resourceKinds.find(x => x.kind === kk)!;
    const config: Record<string, any> = {};
    rk.fields.forEach(f => (config[f.k] = structuredClone(f.def ?? '')));
    setEdit({ id: '', kind: kk, name: `New ${rk.name.toLowerCase()}`, config });
  };
  const save = async () => {
    if (!edit) return;
    try {
      const r = edit.id ? await put(`/api/resources/${edit.id}`, edit) : await post('/api/resources', { ...edit, project_id: projectId });
      await reload();
      setEdit(r);
      toast('Saved');
    } catch (e: any) { toast(e.message, true); }
  };
  const remove = async () => {
    if (!edit?.id || !confirm(`Delete "${edit.name}"? Steps and services using it will stop working until you pick another.`)) return;
    await del(`/api/resources/${edit.id}`);
    await reload();
    setEdit(null);
  };

  return (
    <div className="page"><div className="page-inner">
      <h1>Resources</h1>
      <p className="lead">Shared resources of <b>{project?.name}</b> (switch projects in the designer's Project tab). Passwords, keys and tokens live in the encrypted vault, shared by all projects, and are referenced by name.</p>
      <div className="cols">
        <div className="card">
          <ul className="list">
            <li><button className={kind === 'secrets' ? 'act' : ''} onClick={() => { setKind('secrets'); setEdit(null); }}><b>Secrets</b><span className="muted" style={{ marginLeft: 'auto' }}>{secrets.length}</span></button></li>
            {meta.resourceKinds.map(rk => (
              <li key={rk.kind}><button className={kind === rk.kind ? 'act' : ''} onClick={() => { setKind(rk.kind); setEdit(null); }}><b>{rk.name}</b><span className="muted" style={{ marginLeft: 'auto' }}>{resources.filter(r => r.kind === rk.kind).length}</span></button></li>
            ))}
          </ul>
        </div>
        <div>
          {kind === 'secrets' ? <Secrets /> : k && (
            <>
              <div className="card">
                <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>{k.name}</h2><button className="btn primary small" onClick={() => startNew(k.kind)}>+ New</button></div>
                <p className="muted" style={{ fontSize: 13 }}>{k.desc}</p>
                <ul className="list">
                  {resources.filter(r => r.kind === k.kind).map(r => (
                    <li key={r.id}><button className={edit?.id === r.id ? 'act' : ''} onClick={() => setEdit(structuredClone(r))}>{r.name}<span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>{r.config.type || r.config.auth || r.config.baseUrl || ''}</span></button></li>
                  ))}
                </ul>
              </div>
              {edit && edit.kind === k.kind && (
                <div className="card">
                  <div className="fld"><label htmlFor="rname">Name</label><input id="rname" type="text" value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} /></div>
                  <FieldList fields={k.fields} values={edit.config} onChange={(fk, v) => setEdit({ ...edit, config: { ...edit.config, [fk]: v } })} resources={resources} secrets={secrets} />
                  <div className="row"><button className="btn primary" onClick={save}>Save</button>{edit.id && <button className="btn danger" onClick={remove}>Delete</button>}</div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div></div>
  );
}

function Secrets() {
  const { secrets, reload } = useCatalog();
  const toast = useToast();
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const save = async () => {
    try {
      await put(`/api/secrets/${encodeURIComponent(name.trim())}`, { value });
      setName(''); setValue('');
      await reload();
      toast('Secret stored');
    } catch (e: any) { toast(e.message, true); }
  };
  return (
    <div className="card">
      <h2>Secrets</h2>
      <p className="muted" style={{ fontSize: 13 }}>Encrypted with AES-256-GCM using the server's master key. Values can be replaced but never read back. Use them in resources, or in any field as <code>{'{{secret.NAME}}'}</code>; run history shows them masked.</p>
      <table className="t"><tbody>
        {secrets.map(s => (
          <tr key={s.name}><td><code>{s.name}</code></td><td className="muted">updated {fmtTime(s.updated_at)}</td>
            <td style={{ textAlign: 'right' }}><button className="btn small" onClick={() => { setName(s.name); setValue(''); }}>Replace</button> <button className="btn small danger" onClick={() => confirm(`Delete secret ${s.name}?`) && del(`/api/secrets/${s.name}`).then(reload)}>Delete</button></td></tr>
        ))}
      </tbody></table>
      <div className="group">Add or replace</div>
      <div className="fld"><label htmlFor="sn">Name</label><input id="sn" type="text" className="code" value={name} onChange={e => setName(e.target.value)} placeholder="PARTNER_API_KEY" /></div>
      <div className="fld"><label htmlFor="sv">Value</label><textarea id="sv" className="code" rows={value.includes('\n') ? 6 : 2} value={value} onChange={e => setValue(e.target.value)} placeholder="Password, token, PEM private key or SAML assertion" spellCheck={false} autoComplete="off" /></div>
      <button className="btn primary" disabled={!name.trim() || !value} onClick={save}>Store secret</button>
    </div>
  );
}
