/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.8.0
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { useState } from 'react';
import { act as run } from './log';
import { useToast } from '../src/ui';
import { Err, useLoad } from './shared';
import { Drawer } from './Apps';

interface GroupRole { group: string; role: string; project?: string }
interface Settings {
  enabled: boolean; name: string; issuer: string; clientId: string; clientSecret: string; scopes: string;
  usernameClaim: string; groupsClaim: string; groupRoles: GroupRole[]; createAccounts: boolean; linkExisting: boolean; redirectUri: string;
}
interface Role { id: string; name: string }
interface Project { id: string; name: string }

/** Single sign-on with an OpenID Connect identity provider: the settings, and groups to roles. */
export function SsoDrawer({ onClose }: { onClose(): void }) {
  const toast = useToast();
  const s = useLoad<Settings>('/api/access/sso');
  const roles = useLoad<Role[]>('/api/access/roles');
  const projects = useLoad<Project[]>('/api/projects');
  const [form, setForm] = useState<Settings | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const f = form || s.data;
  if (!f) return <Drawer title="Single sign-on" onClose={onClose}><Err text={s.error} /></Drawer>;
  const set = (patch: Partial<Settings>) => setForm({ ...f, ...patch });
  const setGroup = (i: number, patch: Partial<GroupRole>) => set({ groupRoles: f.groupRoles.map((g, j) => (j === i ? { ...g, ...patch } : g)) });
  const save = async () => {
    setBusy(true); setErr('');
    try {
      const { redirectUri: _r, ...body } = f;
      await run({ label: f.enabled ? 'Turn on single sign-on' : 'Save single sign-on settings', method: 'PUT', url: '/api/access/sso', body });
      toast('Saved'); onClose();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const text = (k: keyof Settings, label: string, hint?: string, placeholder?: string) => (
    <div className="fld"><label htmlFor={`sso-${k}`}>{label}</label><input id={`sso-${k}`} type="text" value={String(f[k] ?? '')} placeholder={placeholder} onChange={e => set({ [k]: e.target.value } as Partial<Settings>)} />{hint && <div className="hint">{hint}</div>}</div>
  );
  const check = (k: 'enabled' | 'createAccounts' | 'linkExisting', label: string, hint: string) => (
    <div className="fld"><label className="c-check"><input type="checkbox" checked={!!f[k]} onChange={e => set({ [k]: e.target.checked } as Partial<Settings>)} /> {label}</label><div className="hint">{hint}</div></div>
  );

  return (
    <Drawer title="Single sign-on" sub="OpenID Connect: people sign in at your identity provider. Password sign-in stays available." onClose={onClose}>
      <Err text={err} />
      <div className="c-form">
        {check('enabled', 'Offer single sign-on', 'Shows a sign-in button on the designer and Admin Console sign-in pages.')}
        {text('name', 'Button name', 'Sign in with this name, such as Contoso or Okta.')}
        {text('issuer', 'Issuer', 'The provider\'s address; its /.well-known/openid-configuration is read.', 'https://login.example.com/realms/company')}
        {text('clientId', 'Client id')}
        {text('clientSecret', 'Client secret', 'Name of the vault secret holding it. Empty for a public client (PKCE only).')}
        <div className="fld"><label>Redirect address</label><code className="c-code">{f.redirectUri}</code><div className="hint">Register it at the provider. Behind a proxy, set SUTRA_PUBLIC_URL so it shows the address people use.</div></div>
        {text('scopes', 'Scopes')}
        {text('usernameClaim', 'Username from claim', 'preferred_username, email, upn or sub.')}
        {text('groupsClaim', 'Groups claim', 'The claim with the person\'s groups; ask the provider to include it in the ID token.')}
        <div className="fld">
          <label>Groups to roles</label>
          <div className="hint">At every sign-in the person's roles become those of their groups. Without rows, roles are given here in Users.</div>
          {f.groupRoles.map((g, i) => (
            <div className="c-grantrow" key={i}>
              <input type="text" aria-label="Group" placeholder="Group" value={g.group} onChange={e => setGroup(i, { group: e.target.value })} />
              <select aria-label="Role" value={g.role} onChange={e => setGroup(i, { role: e.target.value })}>
                <option value="">Role</option>{(roles.data || []).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <select aria-label="Project" value={g.project || ''} onChange={e => setGroup(i, { project: e.target.value })}>
                <option value="">All projects</option>{(projects.data || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button className="btn small" type="button" onClick={() => set({ groupRoles: f.groupRoles.filter((_, j) => j !== i) })}>Remove</button>
            </div>
          ))}
          <button className="btn small" type="button" onClick={() => set({ groupRoles: [...f.groupRoles, { group: '', role: 'viewer', project: '' }] })}>Add group</button>
        </div>
        {check('createAccounts', 'Create accounts', 'A person without an account gets one at their first sign-in.')}
        {check('linkExisting', 'Link existing accounts', 'An account with the same username is linked to the person at the provider. Only when the provider controls the usernames.')}
        <div className="c-actions"><button className="btn primary" disabled={busy} onClick={save}>Save</button></div>
      </div>
    </Drawer>
  );
}
