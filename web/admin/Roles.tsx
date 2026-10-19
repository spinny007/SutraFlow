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
import { act } from './log';
import { useToast } from '../src/ui';
import { PageHead, Err, Confirm, useLoad } from './shared';
import { Drawer } from './Apps';

interface Perm { id: string; scope: 'project' | 'server'; name: string; help: string }
interface Role { id: string; name: string; description: string; perms: string[]; builtin: boolean; holders: number }

/** Roles: built-in ones to read, custom ones made from permissions. */
export function Roles() {
  const toast = useToast();
  const roles = useLoad<Role[]>('/api/access/roles');
  const perms = useLoad<{ permissions: Perm[] }>('/api/access/permissions');
  const [edit, setEdit] = useState<Role | 'new' | null>(null);
  const all = perms.data?.permissions || [];
  return (
    <>
      <PageHead title="Roles" sub="A role is a set of permissions. Project permissions apply to the projects a role is granted on; server permissions only come with a grant on all projects.">
        <button className="btn primary small" onClick={() => setEdit('new')}>New role</button>
      </PageHead>
      <Err text={roles.error || perms.error} />
      {roles.data && all.length > 0 && (
        <div className="c-tablewrap"><table className="t c-table c-matrix">
          <thead><tr><th>Role</th>{all.map(p => <th key={p.id} title={p.help} className={`c-perm ${p.scope}`}>{p.name}</th>)}<th className="right">Holders</th></tr></thead>
          <tbody>{roles.data.map(r => (
            <tr key={r.id} className="click" tabIndex={0} onClick={() => setEdit(r)} onKeyDown={e => { if (e.key === 'Enter') setEdit(r); }}>
              <td><strong>{r.name}</strong>{r.builtin && <span className="c-badge soft">built-in</span>}<div className="muted xs">{r.description}</div></td>
              {all.map(p => <td key={p.id} className={`c-dot ${p.scope}`} aria-label={r.perms.includes(p.id) ? `${p.name}: yes` : `${p.name}: no`}>{r.perms.includes(p.id) ? '●' : ''}</td>)}
              <td className="right">{r.holders}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <p className="muted xs">Columns marked as server permissions are shaded.</p>
      {edit && <RoleDrawer role={edit === 'new' ? null : edit} perms={all} onClose={() => setEdit(null)} onSaved={msg => { toast(msg); roles.reload(); setEdit(null); }} />}
    </>
  );
}

function RoleDrawer({ role, perms, onClose, onSaved }: { role: Role | null; perms: Perm[]; onClose(): void; onSaved(msg: string): void }) {
  const [form, setForm] = useState({ name: role?.name || '', description: role?.description || '', perms: role?.perms || ['view'] });
  const [err, setErr] = useState('');
  const [confirm, setConfirm] = useState(false);
  const ro = !!role?.builtin;
  const toggle = (id: string) => setForm(f => ({ ...f, perms: f.perms.includes(id) ? f.perms.filter(p => p !== id) : [...f.perms, id] }));
  const save = async () => {
    try { await act(role ? { label: `Change role ${form.name}`, method: 'PUT', url: `/api/access/roles/${role.id}`, body: form } : { label: `Add role ${form.name}`, method: 'POST', url: '/api/access/roles', body: form }); onSaved(role ? 'Role saved' : 'Role added'); } catch (e: any) { setErr(e.message); }
  };
  return (
    <Drawer title={role ? role.name : 'New role'} sub={ro ? 'Built-in roles cannot change. Make a new role to combine permissions differently.' : undefined} onClose={onClose}>
      <Err text={err} />
      <div className="c-form">
        <div className="fld"><label htmlFor="c-rn">Name</label><input id="c-rn" type="text" value={form.name} disabled={ro} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
        <div className="fld"><label htmlFor="c-rd">Description</label><input id="c-rd" type="text" value={form.description} disabled={ro} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
        {(['project', 'server'] as const).map(scope => (
          <fieldset key={scope} className="c-perms" disabled={ro}>
            <legend>{scope === 'project' ? 'Project permissions' : 'Server permissions'}</legend>
            {perms.filter(p => p.scope === scope).map(p => (
              <label key={p.id} className="c-check"><input type="checkbox" checked={form.perms.includes(p.id)} onChange={() => toggle(p.id)} /> <span><strong>{p.name}</strong><span className="muted xs"> {p.help}</span></span></label>
            ))}
          </fieldset>
        ))}
        {!ro && <div className="c-actions">
          <button className="btn primary" onClick={save}>{role ? 'Save' : 'Add role'}</button>
          {role && <button className="btn c-danger-soft" onClick={() => setConfirm(true)}>Delete role</button>}
        </div>}
      </div>
      {confirm && role && <Confirm title={`Delete ${role.name}`} text={role.holders ? `${role.holders} accounts hold this role. Remove it from them first.` : 'The role is deleted.'} action="Delete" danger
        onYes={async () => { await act({ label: `Delete role ${role.name}`, method: 'DELETE', url: `/api/access/roles/${role.id}` }); onSaved('Role deleted'); }} onClose={() => setConfirm(false)} />}
    </Drawer>
  );
}
