import { useEffect, useState, type FormEvent } from 'react';
import { get, post } from './api';
import { CatalogHost, ToastHost, useCatalog } from './ui';

/** Product version, centred in the top bar. */
function Version() {
  const { meta } = useCatalog();
  return <span className="ver" title="SutraFlow version">v{meta.version}</span>;
}
import { Designer } from './Designer';
import { Runs } from './Runs';
import { Resources } from './Resources';
import { Server } from './Server';

type Page = 'designer' | 'runs' | 'resources' | 'server';

function Logo() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M5 22c4-10 8-10 11-4s7 6 11-4" fill="none" stroke="var(--c-auto)" strokeWidth="3" strokeLinecap="round" />
      <circle cx="5" cy="22" r="3" fill="var(--c-general)" /><circle cx="16" cy="17" r="3" fill="var(--c-ai)" /><circle cx="27" cy="14" r="3" fill="var(--c-data)" />
    </svg>
  );
}

function SignIn({ setup, onDone }: { setup: boolean; onDone(): void }) {
  const [username, setUser] = useState('admin');
  const [password, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    if (setup && password !== confirm) return setErr('The passwords do not match');
    try {
      await post(setup ? '/api/auth/setup' : '/api/auth/login', { username, password });
      onDone();
    } catch (x: any) { setErr(x.message); }
  };
  return (
    <div className="auth">
      <form className="card" onSubmit={submit}>
        <div className="brand" style={{ marginBottom: 12 }}><Logo /> SutraFlow</div>
        <h2>{setup ? 'Create the administrator' : 'Sign in'}</h2>
        <p className="muted" style={{ marginTop: 0 }}>{setup ? 'First start: this account manages Sutras, secrets and server security.' : 'Studio for designing, deploying and monitoring integration Sutras.'}</p>
        {err && <div className="errbox">{err}</div>}
        <div className="fld"><label htmlFor="u">Username</label><input id="u" type="text" value={username} onChange={e => setUser(e.target.value)} autoComplete="username" /></div>
        <div className="fld"><label htmlFor="p">Password</label><input id="p" type="password" value={password} onChange={e => setPw(e.target.value)} autoComplete={setup ? 'new-password' : 'current-password'} />{setup && <div className="hint">At least 10 characters.</div>}</div>
        {setup && <div className="fld"><label htmlFor="c">Confirm password</label><input id="c" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" /></div>}
        <button className="btn primary" type="submit">{setup ? 'Create account' : 'Sign in'}</button>
      </form>
    </div>
  );
}

/** Shown after an administrator set the password: the person chooses their own before anything else. */
function ChangePassword({ onDone }: { onDone(): void }) {
  const [current, setCurrent] = useState('');
  const [password, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    if (password !== confirm) return setErr('The passwords do not match');
    try { await post('/api/auth/password', { current, password }); onDone(); } catch (x: any) { setErr(x.message); }
  };
  return (
    <div className="auth">
      <form className="card" onSubmit={submit}>
        <div className="brand" style={{ marginBottom: 12 }}><Logo /> SutraFlow</div>
        <h2>Choose your password</h2>
        <p className="muted" style={{ marginTop: 0 }}>An administrator set your current password. Replace it with one only you know.</p>
        {err && <div className="errbox">{err}</div>}
        <div className="fld"><label htmlFor="cp-cur">Current password</label><input id="cp-cur" type="password" value={current} onChange={e => setCurrent(e.target.value)} autoComplete="current-password" /></div>
        <div className="fld"><label htmlFor="cp-new">New password</label><input id="cp-new" type="password" value={password} onChange={e => setPw(e.target.value)} autoComplete="new-password" /><div className="hint">At least 10 characters, with letters and a digit or symbol, not containing your username.</div></div>
        <div className="fld"><label htmlFor="cp-conf">Confirm new password</label><input id="cp-conf" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" /></div>
        <button className="btn primary" type="submit">Save password</button>
      </form>
    </div>
  );
}

export function App() {
  const [auth, setAuth] = useState<{ setup: boolean; user: { username: string; mustChange?: boolean } | null } | null>(null);
  const [page, setPage] = useState<Page>(() => (location.hash.slice(1) as Page) || 'designer');
  const check = () => get('/api/auth/status').then(setAuth).catch(() => setAuth({ setup: false, user: null }));
  useEffect(() => {
    check();
    const out = () => setAuth(a => (a ? { ...a, user: null } : a));
    window.addEventListener('sutra:signed-out', out);
    return () => window.removeEventListener('sutra:signed-out', out);
  }, []);
  useEffect(() => { if (location.hash.slice(1) !== page) history.pushState(null, '', '#' + page); }, [page]);
  useEffect(() => {
    const onHash = () => setPage((location.hash.slice(1) as Page) || 'designer');
    window.addEventListener('hashchange', onHash);
    window.addEventListener('popstate', onHash);
    return () => { window.removeEventListener('hashchange', onHash); window.removeEventListener('popstate', onHash); };
  }, []);

  if (!auth) return null;
  if (!auth.user) return <ToastHost><SignIn setup={auth.setup} onDone={check} /></ToastHost>;
  if (auth.user.mustChange) return <ToastHost><ChangePassword onDone={check} /></ToastHost>;

  const toggleTheme = () => {
    const r = document.documentElement;
    const dark = r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    r.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('sutra.theme', r.dataset.theme); } catch { /* ignore */ }
  };
  const nav: [Page, string][] = [['designer', 'Designer'], ['runs', 'Runs'], ['resources', 'Resources'], ['server', 'Server & APIs']];
  return (
    <ToastHost>
      <CatalogHost>
        <div className="app">
          <header className="top">
            <div className="brand"><Logo /><span>SutraFlow</span></div>
            <nav className="nav">{nav.map(([k, l]) => <button key={k} className={page === k ? 'act' : ''} onClick={() => setPage(k)}>{l}</button>)}</nav>
            <div className="spacer" />
            <Version />
            <a className="btn small" href="/guide" target="_blank" rel="noopener" title="Open the user guide in a new tab">Guide</a>
            <button className="btn small" onClick={toggleTheme} aria-label="Switch light or dark theme">◐</button>
            <span className="muted" style={{ fontSize: 12 }}>{auth.user.username}</span>
            <button className="btn small" onClick={() => post('/api/auth/logout').then(check)}>Sign out</button>
          </header>
          {page === 'designer' && <Designer />}
          {page === 'runs' && <Runs />}
          {page === 'resources' && <Resources />}
          {page === 'server' && <Server />}
        </div>
      </CatalogHost>
    </ToastHost>
  );
}
