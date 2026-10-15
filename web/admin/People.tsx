import { useState } from 'react';
import { del, get, post, put } from '../src/api';
import { useToast } from '../src/ui';
import { PageHead, State, Err, Empty, Confirm, useLoad, ago, when, newPassword, useMe } from './shared';
import { Drawer } from './Apps';

interface Grant { role: string; project: string }
interface Account {
  username: string; kind: 'user' | 'system'; displayName: string; email: string; disabled: boolean; locked: boolean;
  mustChange: boolean; hasPassword: boolean; lastLogin: string | null; createdAt: string; grants: Grant[]; tokens: number;
}
interface Role { id: string; name: string }
interface Project { id: string; name: string }

/** Users (people) or system accounts: provision, roles per project, passwords, tokens. */
export function People({ kind }: { kind: 'user' | 'system' }) {
  const { me } = useMe();
  const toast = useToast();
  const list = useLoad<Account[]>(`/api/access/users?kind=${kind}`, [kind]);
  const roles = useLoad<Role[]>('/api/access/roles');
  const projects = useLoad<Project[]>('/api/projects');
  const [edit, setEdit] = useState<Account | 'new' | null>(null);
  const [filter, setFilter] = useState('');
  const people = kind === 'user';
  const f = filter.trim().toLowerCase();
  const rows = (list.data || []).filter(a => !f || [a.username, a.displayName, a.email].some(x => x.toLowerCase().includes(f)));
  const roleName = (id: string) => roles.data?.find(r => r.id === id)?.name || id;
  const projName = (id: string) => (id ? projects.data?.find(p => p.id === id)?.name || id : 'all projects');

  return (
    <>
      <PageHead title={people ? 'Users' : 'System accounts'} sub={people
        ? 'People who sign in to the designer and this console. A role applies to all projects or to one project.'
        : 'Accounts for engines, CI pipelines and API callers. They use API tokens for the admin API, and a password for gateway services whose policy accepts system accounts.'}>
        <input className="inp c-search" type="search" placeholder="Find" aria-label="Find an account" value={filter} onChange={e => setFilter(e.target.value)} />
        <button className="btn primary small" onClick={() => setEdit('new')}>{people ? 'Add user' : 'Add system account'}</button>
      </PageHead>
      <Err text={list.error} />
      {list.data && !list.data.length && <Empty title={people ? 'No users' : 'No system accounts'}>{people ? 'Add the people who work with SutraFlow.' : 'Add one for each pipeline or partner, so each can be limited and revoked on its own.'}</Empty>}
      {!!rows.length && (
        <div className="c-tablewrap"><table className="t c-table">
          <thead><tr><th>{people ? 'User' : 'Account'}</th><th>State</th><th>Roles</th><th>{people ? 'Last sign-in' : 'Tokens'}</th><th /></tr></thead>
          <tbody>{rows.map(a => (
            <tr key={a.username} className="click" tabIndex={0} onClick={() => setEdit(a)} onKeyDown={e => { if (e.key === 'Enter') setEdit(a); }}>
              <td><strong>{a.displayName || a.username}</strong>{a.username === me.username && <span className="c-badge soft">you</span>}<div className="muted xs">{a.username}{a.email ? ` · ${a.email}` : ''}</div></td>
              <td>{a.disabled ? <State kind="idle">disabled</State> : a.locked ? <State kind="err">locked</State> : a.mustChange ? <State kind="warn">new password due</State> : <State kind="ok">active</State>}</td>
              <td>{a.grants.length ? a.grants.map(g => <span key={g.role + g.project} className="c-grant">{roleName(g.role)} <span className="muted">on {projName(g.project)}</span></span>) : <span className="muted">no roles</span>}</td>
              <td className="nowrap muted">{people ? (a.lastLogin ? ago(a.lastLogin) : 'never') : `${a.tokens} token${a.tokens === 1 ? '' : 's'}${a.hasPassword ? ' · gateway password' : ''}`}</td>
              <td className="right"><button className="btn small" onClick={e => { e.stopPropagation(); setEdit(a); }}>Open</button></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {edit && <AccountDrawer kind={kind} account={edit === 'new' ? null : edit} roles={roles.data || []} projects={projects.data || []}
        onClose={() => setEdit(null)} onSaved={(a, msg) => { toast(msg); list.reload(); if (a) setEdit(a); else setEdit(null); }} />}
    </>
  );
}

function GrantsEditor({ value, onChange, roles, projects, kind }: { value: Grant[]; onChange(g: Grant[]): void; roles: Role[]; projects: Project[]; kind: string }) {
  const set = (i: number, g: Partial<Grant>) => onChange(value.map((x, j) => (j === i ? { ...x, ...g } : x)));
  return (
    <div className="c-grants">
      {value.map((g, i) => (
        <div key={i} className="c-grantrow">
          <select className="inp" aria-label="Role" value={g.role} onChange={e => set(i, { role: e.target.value })}>{roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
          <span className="muted xs">on</span>
          <select className="inp" aria-label="Project" value={g.project} onChange={e => set(i, { project: e.target.value })}>
            <option value="">All projects</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button type="button" className="btn small" aria-label="Remove this role" onClick={() => onChange(value.filter((_x, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <button type="button" className="btn small" onClick={() => onChange([...value, { role: kind === 'system' ? 'apiCaller' : 'viewer', project: '' }])}>Add role</button>
    </div>
  );
}

function AccountDrawer({ kind, account, roles, projects, onClose, onSaved }: { kind: 'user' | 'system'; account: Account | null; roles: Role[]; projects: Project[]; onClose(): void; onSaved(a: Account | null, msg: string): void }) {
  const { me } = useMe();
  const toast = useToast();
  const people = kind === 'user';
  const [form, setForm] = useState({
    username: account?.username || '', displayName: account?.displayName || '', email: account?.email || '',
    password: '', mustChange: true, grants: account?.grants || [{ role: people ? 'viewer' : 'apiCaller', project: '' }],
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; text: string; action: string; danger?: boolean; run(): Promise<void> } | null>(null);
  const [pw, setPw] = useState<{ value: string; mustChange: boolean } | null>(null);
  const self = account?.username === me.username;

  const save = async () => {
    setBusy(true); setErr('');
    try {
      if (account) {
        const a = await put<Account>(`/api/access/users/${encodeURIComponent(account.username)}`, { displayName: form.displayName, email: form.email, grants: form.grants });
        onSaved(a, 'Saved');
      } else {
        const a = await post<Account>('/api/access/users', { username: form.username, kind, displayName: form.displayName, email: form.email, password: form.password || undefined, mustChange: form.mustChange, grants: form.grants });
        onSaved(a, people ? `User ${a.username} added` : `System account ${a.username} added`);
      }
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const act = (title: string, text: string, action: string, fn: () => Promise<unknown>, msg: string, danger = false, close = false) =>
    setConfirm({ title, text, action, danger, run: async () => { await fn(); if (close) onSaved(null, msg); else onSaved(await get<Account>(`/api/access/users/${encodeURIComponent(account!.username)}`), msg); } });
  const u = account ? encodeURIComponent(account.username) : '';

  return (
    <Drawer title={account ? account.displayName || account.username : people ? 'Add user' : 'Add system account'} sub={account ? <>{account.username} · added {when(account.createdAt)}</> : undefined} onClose={onClose}>
      <Err text={err} />
      <div className="c-form">
        {!account && <div className="fld"><label htmlFor="c-u">{people ? 'Username' : 'Account name'}</label><input id="c-u" type="text" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} autoComplete="off" /><div className="hint">2 to 64 letters, digits, . _ @ -. Cannot be changed later.</div></div>}
        <div className="fld"><label htmlFor="c-d">{people ? 'Full name' : 'Description'}</label><input id="c-d" type="text" value={form.displayName} onChange={e => setForm({ ...form, displayName: e.target.value })} /></div>
        {people && <div className="fld"><label htmlFor="c-e">Email</label><input id="c-e" type="text" inputMode="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>}
        {!account && (
          <div className="fld">
            <label htmlFor="c-p">{people ? 'First password' : 'Gateway password (optional)'}</label>
            <div className="c-inline"><input id="c-p" type="text" className="mono" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} autoComplete="off" /><button type="button" className="btn small" onClick={() => setForm({ ...form, password: newPassword() })}>Generate</button></div>
            <div className="hint">{people ? 'Give it to the person in a safe way. ' : 'Only for gateway services whose policy accepts system accounts. '}At least 10 characters, with letters and a digit or symbol.</div>
          </div>
        )}
        {!account && people && <label className="c-check"><input type="checkbox" checked={form.mustChange} onChange={e => setForm({ ...form, mustChange: e.target.checked })} /> Ask for a new password at the first sign-in</label>}
        <div className="fld"><span className="lbl">Roles</span><GrantsEditor value={form.grants} onChange={g => setForm({ ...form, grants: g })} roles={roles} projects={projects} kind={kind} /></div>
        <div className="c-actions"><button className="btn primary" disabled={busy} onClick={save}>{account ? 'Save' : people ? 'Add user' : 'Add system account'}</button></div>
      </div>

      {account && (
        <section className="c-section">
          <h3>Account</h3>
          <div className="c-actions wrap">
            <button className="btn small" onClick={() => setPw({ value: newPassword(), mustChange: people })}>{people ? 'Set a new password' : account.hasPassword ? 'Change gateway password' : 'Set gateway password'}</button>
            {account.locked && <button className="btn small" onClick={() => act('Unlock', `${account.username} can sign in again at once.`, 'Unlock', () => post(`/api/access/users/${u}/unlock`), 'Unlocked')}>Unlock</button>}
            {people && !self && <button className="btn small" onClick={() => act('Sign out everywhere', 'Every session of this user ends now; they sign in again.', 'Sign out', () => post(`/api/access/users/${u}/sign-out`), 'Signed out everywhere')}>Sign out everywhere</button>}
            {!self && (account.disabled
              ? <button className="btn small" onClick={() => act('Enable', `${account.username} can sign in and use tokens again.`, 'Enable', () => put(`/api/access/users/${u}`, { disabled: false }), 'Enabled')}>Enable</button>
              : <button className="btn small c-danger-soft" onClick={() => act('Disable', `${account.username} cannot sign in, sessions end now, and tokens stop working. Everything is kept.`, 'Disable', () => put(`/api/access/users/${u}`, { disabled: true }), 'Disabled', true)}>Disable</button>)}
            {!self && <button className="btn small c-danger-soft" onClick={() => act('Delete', `${account.username} is deleted with its roles and tokens. The audit log keeps what it did.`, 'Delete', () => del(`/api/access/users/${u}`), 'Deleted', true, true)}>Delete</button>}
          </div>
          {pw && (
            <div className="c-subform">
              <div className="fld"><label htmlFor="c-np">New password</label>
                <div className="c-inline"><input id="c-np" type="text" className="mono" value={pw.value} onChange={e => setPw({ ...pw, value: e.target.value })} /><button type="button" className="btn small" onClick={() => setPw({ ...pw, value: newPassword() })}>Generate</button></div></div>
              {people && <label className="c-check"><input type="checkbox" checked={pw.mustChange} onChange={e => setPw({ ...pw, mustChange: e.target.checked })} /> Ask for a new password at the next sign-in</label>}
              <div className="c-actions">
                <button className="btn" onClick={() => setPw(null)}>Cancel</button>
                <button className="btn primary" onClick={async () => { try { await post(`/api/access/users/${u}/password`, { password: pw.value, mustChange: pw.mustChange }); setPw(null); toast('Password set; existing sessions ended'); } catch (e: any) { toast(e.message, true); } }}>Set password</button>
              </div>
            </div>
          )}
        </section>
      )}
      {account && !people && <Tokens username={account.username} />}
      {confirm && <Confirm title={confirm.title} text={confirm.text} action={confirm.action} danger={confirm.danger} onYes={confirm.run} onClose={() => setConfirm(null)} />}
    </Drawer>
  );
}

function Tokens({ username }: { username: string }) {
  const toast = useToast();
  const u = encodeURIComponent(username);
  const list = useLoad<{ id: string; name: string; createdAt: string; expiresAt: string | null; lastUsed: string | null; expired: boolean }[]>(`/api/access/users/${u}/tokens`);
  const [name, setName] = useState('');
  const [days, setDays] = useState('90');
  const [shown, setShown] = useState<string | null>(null);
  const [revoke, setRevoke] = useState<{ id: string; name: string } | null>(null);
  const create = async () => {
    try { const r = await post<{ token: string }>(`/api/access/users/${u}/tokens`, { name: name || 'token', expiresDays: Number(days) || 0 }); setShown(r.token); setName(''); list.reload(); } catch (e: any) { toast(e.message, true); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(shown!); toast('Copied'); } catch { toast('Select the token and copy it', true); } };
  return (
    <section className="c-section">
      <h3>API tokens</h3>
      <p className="muted xs">Send as <code>Authorization: Bearer &lt;token&gt;</code>. A token can do what the account's roles allow, no more.</p>
      {shown && (
        <div className="c-shown" role="status">
          <strong>Copy this token now. It is not shown again.</strong>
          <div className="c-inline"><input className="inp mono" readOnly value={shown} onFocus={e => e.currentTarget.select()} aria-label="New token" /><button className="btn small" onClick={copy}>Copy</button><button className="btn small" onClick={() => setShown(null)}>Done</button></div>
        </div>
      )}
      <div className="c-inline c-newtoken">
        <input className="inp" type="text" placeholder="Name, such as GitHub Actions" aria-label="Token name" value={name} onChange={e => setName(e.target.value)} />
        <select className="inp" aria-label="Expires" value={days} onChange={e => setDays(e.target.value)}>
          <option value="30">Expires in 30 days</option><option value="90">Expires in 90 days</option><option value="365">Expires in 1 year</option><option value="0">Never expires</option>
        </select>
        <button className="btn small primary" onClick={create}>Create token</button>
      </div>
      <Err text={list.error} />
      {!!list.data?.length && (
        <div className="c-tablewrap"><table className="t c-table">
          <thead><tr><th>Name</th><th>Created</th><th>Expires</th><th>Last used</th><th /></tr></thead>
          <tbody>{list.data.map(t => (
            <tr key={t.id}>
              <td><strong>{t.name}</strong> <span className="muted xs mono">sut_{t.id}</span></td>
              <td className="nowrap">{when(t.createdAt)}</td>
              <td className="nowrap">{t.expired ? <State kind="err">expired</State> : t.expiresAt ? when(t.expiresAt) : 'never'}</td>
              <td className="nowrap muted">{t.lastUsed ? ago(t.lastUsed) : 'never'}</td>
              <td className="right"><button className="btn small c-danger-soft" onClick={() => setRevoke(t)}>Revoke</button></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {revoke && <Confirm title={`Revoke ${revoke.name}`} text="Calls with this token are refused from now on." action="Revoke" danger
        onYes={async () => { await del(`/api/access/users/${u}/tokens/${revoke.id}`); toast('Token revoked'); list.reload(); }} onClose={() => setRevoke(null)} />}
    </section>
  );
}
