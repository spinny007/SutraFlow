import { useEffect, useState } from 'react';
import { get, post } from '../src/api';
import { ToastHost } from '../src/ui';
import { Logo, SignIn, ChangePassword } from '../src/Auth';
import { MeCtx, can, type Me, type Status } from './shared';
import { Overview } from './Overview';
import { Apps } from './Apps';
import { Approvals } from './Approvals';
import { Engines } from './Engines';
import { People } from './People';
import { Roles } from './Roles';
import { Audit } from './Audit';

/**
 * Admin Console: manages what is deployed (projects, Sutras, runs, approvals), the engines, people,
 * system accounts, roles and the audit log. Design work stays in the designer.
 */
type Page = 'overview' | 'apps' | 'approvals' | 'engines' | 'people' | 'systems' | 'roles' | 'audit';

const NAV: { group: string; items: { id: Page; label: string; perm?: string }[] }[] = [
  { group: 'Operate', items: [{ id: 'overview', label: 'Overview' }, { id: 'apps', label: 'Applications' }, { id: 'approvals', label: 'Approvals' }, { id: 'engines', label: 'Engines' }] },
  { group: 'Access', items: [{ id: 'people', label: 'Users', perm: 'users' }, { id: 'systems', label: 'System accounts', perm: 'users' }, { id: 'roles', label: 'Roles', perm: 'users' }] },
  { group: 'Records', items: [{ id: 'audit', label: 'Audit log', perm: 'audit' }] },
];

export function Console() {
  const [auth, setAuth] = useState<{ setup: boolean; user: (Me & { mustChange?: boolean }) | null; version: string; mode: Status['mode'] } | null>(null);
  const [page, setPage] = useState<Page>(() => (location.hash.slice(1) as Page) || 'overview');
  const [menu, setMenu] = useState(false);
  const check = () => get('/api/auth/status').then(setAuth).catch(() => setAuth({ setup: false, user: null, version: '', mode: 'studio' }));
  useEffect(() => {
    check();
    const out = () => setAuth(a => (a ? { ...a, user: null } : a));
    window.addEventListener('sutra:signed-out', out);
    const onHash = () => setPage((location.hash.slice(1) as Page) || 'overview');
    window.addEventListener('hashchange', onHash);
    return () => { window.removeEventListener('sutra:signed-out', out); window.removeEventListener('hashchange', onHash); };
  }, []);
  useEffect(() => { if (location.hash.slice(1) !== page) history.replaceState(null, '', '#' + page); setMenu(false); }, [page]);

  if (!auth) return null;
  const engineSetup = auth.setup && auth.mode === 'engine';
  if (!auth.user) {
    if (engineSetup) return (
      <div className="auth"><div className="card">
        <div className="brand" style={{ marginBottom: 12 }}><Logo /> SutraFlow Admin Console</div>
        <h2>No administrator yet</h2>
        <p className="muted">This headless engine has no users. On the server, add the first administrator:</p>
        <pre className="c-code">sutra user add admin --role administrator --password-from-env ADMIN_PASSWORD</pre>
        <p className="muted">Then reload this page and sign in.</p>
      </div></div>
    );
    return <ToastHost><SignIn setup={auth.setup} onDone={check} title="SutraFlow Admin Console" subtitle="Deployed projects and Sutras, engines, users and audit." /></ToastHost>;
  }
  if (auth.user.mustChange) return <ToastHost><ChangePassword onDone={check} /></ToastHost>;

  const me = auth.user;
  const status: Status = { version: auth.version, mode: auth.mode };
  const allowed = (perm?: string) => !perm || can(me, perm);
  const current = NAV.flatMap(g => g.items).find(i => i.id === page && allowed(i.perm)) ? page : 'overview';
  const toggleTheme = () => {
    const r = document.documentElement;
    const dark = r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    r.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('sutra.theme', r.dataset.theme); } catch { /* ignore */ }
  };

  return (
    <ToastHost>
      <MeCtx.Provider value={{ me, status }}>
        <div className="c-shell">
          <aside className={`c-side${menu ? ' open' : ''}`}>
            <div className="c-brand">
              <Logo /><div><strong>SutraFlow</strong><span>Admin Console</span></div>
              <button className="c-menu btn small" aria-expanded={menu} aria-controls="c-nav" onClick={() => setMenu(m => !m)}>Menu</button>
            </div>
            <nav id="c-nav" className="c-nav" aria-label="Admin Console">
              {NAV.map(g => {
                const items = g.items.filter(i => allowed(i.perm));
                return items.length ? (
                  <div key={g.group} className="c-navgroup">
                    <div className="c-navlabel">{g.group}</div>
                    {items.map(i => <a key={i.id} href={'#' + i.id} className={current === i.id ? 'act' : ''} aria-current={current === i.id ? 'page' : undefined} onClick={() => setPage(i.id)}>{i.label}</a>)}
                  </div>
                ) : null;
              })}
            </nav>
            <div className="c-sidefoot">
              {status.mode === 'studio' && <a className="btn small" href="/">Designer</a>}
              <a className="btn small" href="/guide" target="_blank" rel="noopener">Guide</a>
              <span className="muted xs">v{status.version}{status.mode === 'engine' ? ' · headless' : ''}</span>
            </div>
          </aside>
          <main className="c-main">
            <header className="c-top">
              <div className="c-who"><strong>{me.displayName || me.username}</strong><span className="muted xs">{me.username}</span></div>
              <button className="btn small" onClick={toggleTheme} aria-label="Switch light or dark theme">◐</button>
              <button className="btn small" onClick={() => post('/api/auth/logout').then(check)}>Sign out</button>
            </header>
            <div className="c-body">
              {current === 'overview' && <Overview go={setPage} />}
              {current === 'apps' && <Apps />}
              {current === 'approvals' && <Approvals />}
              {current === 'engines' && <Engines />}
              {current === 'people' && <People kind="user" />}
              {current === 'systems' && <People kind="system" />}
              {current === 'roles' && <Roles />}
              {current === 'audit' && <Audit />}
            </div>
          </main>
        </div>
      </MeCtx.Provider>
    </ToastHost>
  );
}
