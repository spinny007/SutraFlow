/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { del, get, post } from './api';
import { Modal, useCatalog, useToast } from './ui';

/**
 * Source control for a project, in the manner of a code editor's Git view: connect (initialize or
 * clone), changes by item with diffs, commit, push, pull and sync, branches, conflicts, history.
 * Every push and pull uses the signed-in person's own Git account.
 */
interface Change { path: string; change: 'M' | 'A' | 'D' | 'U'; conflict: boolean; kind: string; name: string }
interface State {
  connected: boolean; engine: string; kind?: 'shared' | 'personal'; owner?: string; projectName?: string; remoteUrl?: string | null; branch?: string; upstream?: string | null;
  ahead?: number; behind?: number; merging?: boolean; trusted?: boolean; hasAccount?: boolean; changes?: Change[]; conflicts?: string[];
}
interface Commit { sha: string; parents: string[]; author: string; email: string; date: string; subject: string; refs: string[] }
interface Account { id: string; provider: string; host: string; label: string; login: string; authorName: string; authorEmail: string; lastUsed: string | null }

const ICON: Record<string, string> = { sutra: '⧉', connection: '⚙', schema: 'S', project: '★', file: '·' };
const short = (u?: string | null) => (u || '').replace(/^https?:\/\//, '').replace(/\.git$/, '');
const ago = (iso: string) => { const s = (Date.now() - Date.parse(iso)) / 1000; return s < 90 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(iso).toLocaleDateString(); };

export function GitPanel({ onChanged }: { onChanged(): void | Promise<void> }) {
  const { projectId, project, setProjectId, reload } = useCatalog();
  const toast = useToast();
  const [st, setSt] = useState<State | null>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [log, setLog] = useState<Commit[]>([]);
  const [dialog, setDialog] = useState<null | 'init' | 'clone' | 'accounts' | 'branch' | 'publish'>(null);
  const [diff, setDiff] = useState<{ path: string; sha?: string; title: string } | null>(null);
  const [openSha, setOpenSha] = useState<string | null>(null);
  const [shaFiles, setShaFiles] = useState<Change[]>([]);
  const [conflicts, setConflicts] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const s = await get<State>(`/api/projects/${projectId}/git`);
      setSt(s);
      if (s.connected) setLog(await get<Commit[]>(`/api/projects/${projectId}/git/log?max=60`)); else setLog([]);
    } catch (e: any) { toast(e.message, true); }
  }, [projectId, toast]);
  useEffect(() => { setSt(null); setConflicts([]); load(); }, [load]);

  /** Runs a Git action, shows its result, and reloads the project when the action changed it. */
  const run = async (label: string, fn: () => Promise<any>, changesProject = false) => {
    setBusy(label);
    try {
      const r = await fn();
      if (r?.conflicts) setConflicts(r.conflicts);
      if (r?.report?.problems?.length) toast(`Loaded with problems: ${r.report.problems.slice(0, 3).join('; ')}`, true);
      if (changesProject) { await reload(); await onChanged(); }
      await load();
      return r;
    } catch (e: any) { toast(e.message, true); } finally { setBusy(''); }
  };
  const commit = (then?: 'push' | 'sync') => run('Committing', async () => {
    const r = await post(`/api/projects/${projectId}/git/commit`, { message: msg, push: then === 'push' });
    setMsg('');
    if (then === 'sync') { const p = await post<any>(`/api/projects/${projectId}/git/pull`, {}); if (!p.conflicts?.length) await post(`/api/projects/${projectId}/git/push`, {}); return p; }
    toast(then === 'push' ? 'Committed and pushed' : 'Committed');
    return r;
  }, then === 'sync');
  const sync = () => run('Syncing', async () => { const p = await post<any>(`/api/projects/${projectId}/git/pull`, {}); if (!p.conflicts?.length) await post(`/api/projects/${projectId}/git/push`, {}); return p; }, true);

  useEffect(() => {
    if (!openSha) return;
    get<Change[]>(`/api/projects/${projectId}/git/commits/${openSha}`).then(setShaFiles).catch(e => toast(e.message, true));
  }, [openSha, projectId, toast]);

  if (!st) return <p className="muted xs" style={{ padding: 8 }}>Reading the repository...</p>;

  // ---------- not connected ----------
  if (!st.connected) return (
    <div className="gitp">
      <p className="sub">Source control</p>
      <p className="muted xs">{project?.name} is not in a Git repository yet. Keep its Sutras, connections (secrets by name only) and schemas as files in GitHub, GitLab, Bitbucket, Azure DevOps or any Git server, with history and branches.</p>
      <button className="btn primary wide" onClick={() => setDialog('init')}>Initialize repository</button>
      <p className="muted xs">Puts this project in a new repository; publish it to a server next.</p>
      <button className="btn wide" onClick={() => setDialog('clone')}>Clone repository</button>
      <p className="muted xs">Makes your own copy of a project from a repository: only you see it, and your changes reach others when you push.</p>
      <button className="btn link small" onClick={() => setDialog('accounts')}>My Git accounts</button>
      <p className="muted xs">Git: {st.engine === 'system' ? 'the git command' : st.engine === 'builtin' ? 'built in (HTTPS only; install git for merges with conflicts)' : 'not available'}</p>
      {dialog === 'init' && <InitDialog onClose={() => setDialog(null)} onDone={async () => { setDialog(null); await load(); }} />}
      {dialog === 'clone' && <CloneDialog onClose={() => setDialog(null)} onDone={async (id) => { setDialog(null); setProjectId(id); await reload(); }} />}
      {dialog === 'accounts' && <AccountsDialog onClose={() => setDialog(null)} />}
    </div>
  );

  // ---------- connected ----------
  const changes = st.changes || [];
  const open = conflicts.length ? conflicts : changes.filter(c => c.conflict).map(c => c.path);
  return (
    <div className="gitp">
      <div className="gitbar">
        <button className="btn small" title="Branches" onClick={() => setDialog('branch')}>⑂ {st.branch}</button>
        <span className="muted xs" title={st.upstream ? `Tracking ${st.upstream}` : 'Not on the server yet'}>{st.upstream ? `↑${st.ahead} ↓${st.behind}` : 'not published'}</span>
        <span style={{ flex: 1 }} />
        {st.remoteUrl
          ? <>
            <button className="btn small" disabled={!!busy} title="Pull, then push" onClick={sync}>⟳</button>
            <button className="btn small" disabled={!!busy} title="Pull" onClick={() => run('Pulling', () => post(`/api/projects/${projectId}/git/pull`, {}), true)}>↓</button>
            <button className="btn small" disabled={!!busy} title="Push" onClick={() => run('Pushing', () => post(`/api/projects/${projectId}/git/push`, {}))}>↑</button>
          </>
          : <button className="btn small primary" onClick={() => setDialog('publish')}>Publish</button>}
      </div>
      <p className="muted xs gitremote" title={st.remoteUrl || ''}>{st.remoteUrl ? short(st.remoteUrl) : 'Local repository'}{st.kind === 'personal' ? ' · your own copy' : ' · team project'}{busy ? ` · ${busy}...` : ''}</p>
      {st.remoteUrl && !st.hasAccount && /^https?:/.test(st.remoteUrl) && <div className="warnbox">Add your Git account for this server to pull and push. <button className="btn small" onClick={() => setDialog('accounts')}>My Git accounts</button></div>}
      {st.kind === 'personal' && !st.trusted && (
        <div className="warnbox" role="alert">
          <strong>Restricted mode.</strong> Steps that run code or commands from this repository (PowerShell, shell, programs, JavaScript, release steps, MCP commands) do not run until you trust its authors.
          <div style={{ marginTop: 6 }}><button className="btn small" onClick={() => run('Trusting', () => post(`/api/projects/${projectId}/git/trust`, {}))}>Trust the authors</button></div>
        </div>
      )}

      {open.length > 0 ? (
        <div className="gitsec">
          <p className="sub">Merge conflicts ({open.length})</p>
          <p className="muted xs">Both sides changed these. Keep yours or theirs for each; when none are left, the merge is finished and loaded.</p>
          {open.map(p => (
            <div key={p} className="gitrow">
              <span className="xl" title={p}>{p.split('/').pop()}</span>
              <button className="btn small" onClick={() => run('Resolving', () => post(`/api/projects/${projectId}/git/resolve`, { path: p, side: 'ours' }), true)}>Mine</button>
              <button className="btn small" onClick={() => run('Resolving', () => post(`/api/projects/${projectId}/git/resolve`, { path: p, side: 'theirs' }), true)}>Theirs</button>
            </div>
          ))}
          <button className="btn small danger" onClick={() => run('Aborting', () => post(`/api/projects/${projectId}/git/abort`, {}), true).then(() => setConflicts([]))}>Abort the merge</button>
        </div>
      ) : (
        <>
          <textarea className="gitmsg" rows={2} placeholder={`Message (Ctrl+Enter to commit on "${st.branch}")`} value={msg} onChange={e => setMsg(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && msg.trim() && changes.length) commit(); }} aria-label="Commit message" />
          <div className="gitcommit">
            <button className="btn primary" disabled={!msg.trim() || !changes.length || !!busy} onClick={() => commit()}>✓ Commit</button>
            {st.remoteUrl && <button className="btn" disabled={!msg.trim() || !changes.length || !!busy} title="Commit, then push" onClick={() => commit('push')}>Commit & Push</button>}
          </div>
          <div className="gitsec">
            <div className="gitsechead"><span className="sub">Changes</span><span className="badge">{changes.length}</span>{changes.length > 0 && <button className="btn link small" title="Undo every change since the last commit" onClick={() => { if (confirm('Undo all changes since the last commit?')) run('Discarding', () => post(`/api/projects/${projectId}/git/discard`, {}), true); }}>Discard all</button>}</div>
            {!changes.length && <p className="muted xs">No changes since the last commit.</p>}
            {changes.map(c => (
              <div key={c.path} className="gitrow" title={c.path}>
                <button className="gitname" onClick={() => setDiff({ path: c.path, title: `${c.name} (since the last commit)` })}><span className="xi">{ICON[c.kind] || '·'}</span><span className="xl">{c.name}</span><span className="muted xs">{c.kind}</span></button>
                <button className="xmore" title="Discard this change" aria-label={`Discard ${c.name}`} onClick={() => run('Discarding', () => post(`/api/projects/${projectId}/git/discard`, { path: c.path }), true)}>↺</button>
                <span className={`gitchg chg-${c.change}`}>{c.change}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="gitsec">
        <div className="gitsechead"><span className="sub">Graph</span><button className="btn link small" title="Refresh" onClick={() => run('Fetching', () => (st.remoteUrl ? post(`/api/projects/${projectId}/git/fetch`, {}) : load()))}>⟳</button></div>
        {!log.length && <p className="muted xs">No commits yet.</p>}
        {log.map((c, i) => (
          <div key={c.sha}>
            <button className={`gitcommitrow${openSha === c.sha ? ' act' : ''}`} onClick={() => setOpenSha(openSha === c.sha ? null : c.sha)} title={`${c.sha.slice(0, 8)} · ${c.author} <${c.email}> · ${new Date(c.date).toLocaleString()}`}>
              <span className={`gitdot${i === 0 ? ' head' : ''}${c.parents.length > 1 ? ' merge' : ''}`} />
              <span className="xl">{c.subject}</span>
              {c.refs.filter(r => !r.startsWith('tag:')).slice(0, 2).map(r => <span key={r} className={`gitref${r.startsWith('origin/') ? ' remote' : ''}`}>{r}</span>)}
            </button>
            {openSha === c.sha && (
              <div className="gitfiles">
                <div className="muted xs">{c.author} · {ago(c.date)} · {c.sha.slice(0, 8)}</div>
                {shaFiles.map(f => (
                  <button key={f.path} className="gitname" onClick={() => setDiff({ path: f.path, sha: c.sha, title: `${f.name} in "${c.subject}"` })}>
                    <span className="xi">{ICON[f.kind] || '·'}</span><span className="xl">{f.name}</span><span className={`gitchg chg-${(f as any).status}`}>{(f as any).status}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="gitfoot">
        <button className="btn link small" onClick={() => setDialog('accounts')}>My Git accounts</button>
        <button className="btn link small danger" onClick={() => { if (confirm(st.kind === 'personal' ? 'Remove your copy? The project and its working copy are deleted from this server; what you pushed stays in the repository.' : 'Disconnect the project from Git? The project stays; its working copy is removed.')) run('Disconnecting', async () => { const r = await del<any>(`/api/projects/${projectId}/git`); if (r.removedProject) { await reload(); } return r; }, true); }}>{st.kind === 'personal' ? 'Remove my copy' : 'Disconnect'}</button>
      </div>
      <p className="muted xs">Git: {st.engine === 'system' ? 'the git command' : 'built in'}</p>
      {dialog === 'accounts' && <AccountsDialog onClose={() => { setDialog(null); load(); }} />}
      {dialog === 'branch' && <BranchDialog current={st.branch || ''} onClose={() => setDialog(null)} onSwitch={(b, create) => { setDialog(null); run('Switching branch', () => post(`/api/projects/${projectId}/git/switch`, { branch: b, create }), true); }} />}
      {dialog === 'publish' && <PublishDialog onClose={() => setDialog(null)} onDone={async () => { setDialog(null); await load(); }} />}
      {diff && <DiffDialog {...diff} onClose={() => setDiff(null)} />}
    </div>
  );
}

// ---------- dialogs ----------
function useAccounts() {
  const [list, setList] = useState<Account[]>([]);
  const load = useCallback(() => get<Account[]>('/api/git/accounts').then(setList).catch(() => setList([])), []);
  useEffect(() => { load(); }, [load]);
  return { list, load };
}
function AccountPick({ value, onChange, list }: { value: string; onChange(v: string): void; list: Account[] }) {
  return (
    <div className="fld"><label htmlFor="gacc">Git account</label>
      <select id="gacc" value={value} onChange={e => onChange(e.target.value)}><option value="">Chosen by the server address</option>{list.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}</select>
      <div className="hint">Your own: pushes and pulls use only your account. Public repositories clone without one.</div></div>
  );
}

function InitDialog({ onClose, onDone }: { onClose(): void; onDone(): void }) {
  const { projectId } = useCatalog();
  const toast = useToast();
  const [branch, setBranch] = useState('main');
  const go = async () => { try { await post(`/api/projects/${projectId}/git/init`, { branch }); toast('Repository started'); onDone(); } catch (e: any) { toast(e.message, true); } };
  return (
    <Modal title="Initialize repository" onClose={onClose} actions={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={go}>Initialize</button></>}>
      <p className="muted">Starts a Git repository with this project's Sutras, connections (secret names only, never values) and schemas, and makes the first commit. Then publish it to GitHub, GitLab, Bitbucket, Azure DevOps or your own server.</p>
      <div className="fld"><label htmlFor="gbr">Branch</label><input id="gbr" value={branch} onChange={e => setBranch(e.target.value)} /></div>
    </Modal>
  );
}

function PublishDialog({ onClose, onDone }: { onClose(): void; onDone(): void }) {
  const { projectId } = useCatalog();
  const toast = useToast();
  const { list } = useAccounts();
  const [url, setUrl] = useState('');
  const [acc, setAcc] = useState('');
  const go = async () => { try { await post(`/api/projects/${projectId}/git/publish`, { url, accountId: acc || undefined }); toast('Published'); onDone(); } catch (e: any) { toast(e.message, true); } };
  return (
    <Modal title="Publish to a server" onClose={onClose} actions={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!url.trim()} onClick={go}>Publish</button></>}>
      <p className="muted">Create an empty repository on the server first (no README), then paste its address.</p>
      <div className="fld"><label htmlFor="gurl">Repository address</label><input id="gurl" placeholder="https://github.com/acme/orders.git" value={url} onChange={e => setUrl(e.target.value)} /></div>
      <AccountPick value={acc} onChange={setAcc} list={list} />
    </Modal>
  );
}

function CloneDialog({ onClose, onDone }: { onClose(): void; onDone(projectId: string): void }) {
  const toast = useToast();
  const { list } = useAccounts();
  const [url, setUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [acc, setAcc] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { const r = await post<any>('/api/git/clone', { url, branch: branch || undefined, accountId: acc || undefined }); toast(`Cloned as ${r.name}: ${r.report.sutras} Sutras, ${r.report.connections} connections, ${r.report.schemas} schemas`); onDone(r.projectId); }
    catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  return (
    <Modal title="Clone repository" onClose={onClose} actions={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!url.trim() || busy} onClick={go}>{busy ? 'Cloning...' : 'Clone'}</button></>}>
      <p className="muted">Makes your own copy: a project named "&lt;name&gt; (you)" that only you see. It opens in restricted mode: code and commands from the repository do not run until you trust its authors. It can be tested, not deployed; deploy from the team's project.</p>
      <div className="fld"><label htmlFor="gcu">Repository address</label><input id="gcu" placeholder="https://github.com/acme/orders.git" value={url} onChange={e => setUrl(e.target.value)} /></div>
      <div className="fld"><label htmlFor="gcb">Branch</label><input id="gcb" placeholder="The default branch" value={branch} onChange={e => setBranch(e.target.value)} /></div>
      <AccountPick value={acc} onChange={setAcc} list={list} />
    </Modal>
  );
}

function BranchDialog({ current, onClose, onSwitch }: { current: string; onClose(): void; onSwitch(b: string, create: boolean): void }) {
  const { projectId } = useCatalog();
  const [b, setB] = useState<{ local: string[]; remote: string[] } | null>(null);
  const [name, setName] = useState('');
  useEffect(() => { get<any>(`/api/projects/${projectId}/git/branches`).then(setB).catch(() => setB({ local: [], remote: [] })); }, [projectId]);
  const remoteOnly = (b?.remote || []).filter(r => !b!.local.includes(r));
  return (
    <Modal title="Branches" onClose={onClose}>
      <p className="muted xs">Switching loads that branch into the project. Commit or discard your changes first.</p>
      {b?.local.map(x => <button key={x} className={`gitname${x === current ? ' act' : ''}`} disabled={x === current} onClick={() => onSwitch(x, false)}><span className="xi">⑂</span><span className="xl">{x}</span>{x === current && <span className="muted xs">current</span>}</button>)}
      {remoteOnly.length > 0 && <p className="sub">On the server</p>}
      {remoteOnly.map(x => <button key={x} className="gitname" onClick={() => onSwitch(x, false)}><span className="xi">☁</span><span className="xl">{x}</span></button>)}
      <div className="fld" style={{ marginTop: 10 }}><label htmlFor="gnb">New branch from {current}</label>
        <div className="row" style={{ gap: 6 }}><input id="gnb" style={{ flex: 1 }} placeholder="feature/new-orders" value={name} onChange={e => setName(e.target.value)} /><button className="btn primary" disabled={!name.trim()} onClick={() => onSwitch(name.trim(), true)}>Create</button></div></div>
    </Modal>
  );
}

function AccountsDialog({ onClose }: { onClose(): void }) {
  const toast = useToast();
  const { list, load } = useAccounts();
  const [providers, setProviders] = useState<Record<string, { name: string; host: string; login: string; tokenHelp: string }>>({});
  const [f, setF] = useState({ provider: 'github', host: '', login: '', token: '', label: '', authorName: '', authorEmail: '' });
  const [testUrl, setTestUrl] = useState('');
  useEffect(() => { get<any>('/api/git/providers').then(r => setProviders(r.providers)).catch(() => {}); }, []);
  const p = providers[f.provider];
  const add = async () => { try { await post('/api/git/accounts', f); setF({ ...f, token: '' }); toast('Account added'); load(); } catch (e: any) { toast(e.message, true); } };
  const test = async (id: string) => { try { const r = await post<any>(`/api/git/accounts/${id}/test`, { url: testUrl }); toast(`Signed in: ${r.branches.length} branches (${r.branches.slice(0, 4).join(', ')})`); } catch (e: any) { toast(e.message, true); } };
  return (
    <Modal title="My Git accounts" onClose={onClose}>
      <p className="muted xs">Only you see and use these. Tokens are encrypted and never shown again; commits carry the author below, or your name and email.</p>
      {list.map(a => (
        <div key={a.id} className="gitrow">
          <span className="xl"><strong>{a.label}</strong> <span className="muted xs">{a.host} · {a.login}{a.lastUsed ? ` · used ${ago(a.lastUsed)}` : ''}</span></span>
          <button className="btn small" disabled={!testUrl} title="Try it against the repository address below" onClick={() => test(a.id)}>Test</button>
          <button className="btn small danger" onClick={() => del(`/api/git/accounts/${a.id}`).then(load).catch(e => toast(e.message, true))}>Remove</button>
        </div>
      ))}
      {list.length > 0 && <div className="fld"><label htmlFor="gtu">Repository address to test with</label><input id="gtu" placeholder="https://github.com/acme/orders.git" value={testUrl} onChange={e => setTestUrl(e.target.value)} /></div>}
      <p className="sub">Add an account</p>
      <div className="row" style={{ gap: 6 }}>
        <div className="fld" style={{ flex: 1 }}><label htmlFor="gpv">Provider</label><select id="gpv" value={f.provider} onChange={e => setF({ ...f, provider: e.target.value, host: '', login: '' })}>{Object.entries(providers).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}</select></div>
        <div className="fld" style={{ flex: 1 }}><label htmlFor="gho">Host</label><input id="gho" placeholder={p?.host || 'git.example.com'} value={f.host} onChange={e => setF({ ...f, host: e.target.value })} /></div>
      </div>
      <div className="row" style={{ gap: 6 }}>
        <div className="fld" style={{ flex: 1 }}><label htmlFor="glo">Login</label><input id="glo" placeholder={p?.login || 'user name'} value={f.login} onChange={e => setF({ ...f, login: e.target.value })} /></div>
        <div className="fld" style={{ flex: 2 }}><label htmlFor="gtk">Access token</label><input id="gtk" type="password" autoComplete="off" value={f.token} onChange={e => setF({ ...f, token: e.target.value })} /></div>
      </div>
      {p && <div className="hint">{p.tokenHelp}</div>}
      <div className="row" style={{ gap: 6 }}>
        <div className="fld" style={{ flex: 1 }}><label htmlFor="gan">Author name</label><input id="gan" placeholder="Your name" value={f.authorName} onChange={e => setF({ ...f, authorName: e.target.value })} /></div>
        <div className="fld" style={{ flex: 1 }}><label htmlFor="gae">Author email</label><input id="gae" placeholder="Your email" value={f.authorEmail} onChange={e => setF({ ...f, authorEmail: e.target.value })} /></div>
      </div>
      <button className="btn primary" disabled={f.token.length < 8} onClick={add}>Add account</button>
    </Modal>
  );
}

// ---------- diff ----------
/** Line diff (longest common subsequence), enough for Sutra files of a few thousand lines. */
function lineDiff(a: string[], b: string[]) {
  const n = a.length, m = b.length;
  if (n * m > 4_000_000) return [...a.map(t => ({ t, k: '-' as const })), ...b.map(t => ({ t, k: '+' as const }))];
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: { t: string; k: ' ' | '-' | '+' }[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) { if (a[i] === b[j]) { out.push({ t: a[i], k: ' ' }); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) out.push({ t: a[i++], k: '-' }); else out.push({ t: b[j++], k: '+' }); }
  while (i < n) out.push({ t: a[i++], k: '-' });
  while (j < m) out.push({ t: b[j++], k: '+' });
  return out;
}
/** For Sutra files: steps added, removed and changed, by name, above the line diff. */
function stepSummary(before: string | null, after: string | null) {
  try {
    const nodes = (t: string | null) => new Map<string, any>(((t ? JSON.parse(t).doc?.nodes : []) || []).map((n: any) => [n.id, n]));
    const a = nodes(before), b = nodes(after);
    const added = [...b.values()].filter(n => !a.has(n.id)).map(n => n.name);
    const removed = [...a.values()].filter(n => !b.has(n.id)).map(n => n.name);
    const changed = [...b.values()].filter(n => a.has(n.id) && JSON.stringify(a.get(n.id)) !== JSON.stringify(n)).map(n => n.name);
    return { added, removed, changed };
  } catch { return null; }
}

function DiffDialog({ path, sha, title, onClose }: { path: string; sha?: string; title: string; onClose(): void }) {
  const { projectId } = useCatalog();
  const [d, setD] = useState<{ before: string | null; after: string | null } | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => { get<any>(`/api/projects/${projectId}/git/diff?path=${encodeURIComponent(path)}${sha ? `&sha=${sha}` : ''}`).then(setD).catch(() => setD({ before: null, after: null })); }, [projectId, path, sha]);
  const lines = useMemo(() => (d ? lineDiff((d.before || '').split('\n'), (d.after || '').split('\n')) : []), [d]);
  const steps = useMemo(() => (d && path.endsWith('.sutra.json') ? stepSummary(d.before, d.after) : null), [d, path]);
  // Unchanged stretches longer than 6 lines are folded unless "Show all".
  const shown = all ? lines : lines.filter((l, i) => l.k !== ' ' || lines.slice(Math.max(0, i - 3), i + 4).some(x => x.k !== ' '));
  return (
    <Modal title={title} onClose={onClose}>
      <p className="muted xs mono">{path}{d && d.before === null ? ' · new' : d && d.after === null ? ' · removed' : ''}</p>
      {steps && (steps.added.length + steps.removed.length + steps.changed.length > 0) && (
        <p className="xs">{steps.added.length > 0 && <span className="chg-A">Added: {steps.added.join(', ')}. </span>}{steps.removed.length > 0 && <span className="chg-D">Removed: {steps.removed.join(', ')}. </span>}{steps.changed.length > 0 && <span className="chg-M">Changed: {steps.changed.join(', ')}.</span>}</p>
      )}
      {!d ? <p className="muted">Loading...</p> : (
        <pre className="gitdiff">{shown.map((l, i) => <div key={i} className={l.k === '+' ? 'add' : l.k === '-' ? 'rem' : ''}>{l.k} {l.t}</div>)}</pre>
      )}
      <label className="check"><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} /> Show unchanged lines</label>
    </Modal>
  );
}

