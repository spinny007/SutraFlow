/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { useEffect, useRef, useState } from 'react';
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
import { Releases } from './Releases';
import { Database } from './Database';
import { Memory } from './Memory';
import { Traffic, GwApps, Plans, Firewall, Apis } from './Gateway';
import { AlertsPage, RulesPage, ChannelsPage } from './Alerts';
import { ConsolePanel, useEntries } from './log';

/**
 * Admin Console: manages what is deployed (projects, Sutras, runs, approvals), the engines, people,
 * system accounts, roles and the audit log. Design work stays in the designer.
 */
type Page = 'overview' | 'apps' | 'approvals' | 'engines' | 'alerts' | 'rules' | 'channels' | 'traffic' | 'gwapps' | 'plans' | 'firewall' | 'apis' | 'people' | 'systems' | 'roles' | 'audit' | 'releases' | 'database' | 'memory';

const NAV: { group: string; items: { id: Page; label: string; perm?: string }[] }[] = [
  { group: 'Operate', items: [{ id: 'overview', label: 'Overview' }, { id: 'apps', label: 'Applications' }, { id: 'approvals', label: 'Approvals' }, { id: 'releases', label: 'Releases', perm: 'view' }, { id: 'engines', label: 'Engines' }, { id: 'memory', label: 'Memory tables', perm: 'view' }] },
  { group: 'Alerts', items: [{ id: 'alerts', label: 'Alerts', perm: 'view' }, { id: 'rules', label: 'Alert rules', perm: 'view' }, { id: 'channels', label: 'Channels', perm: 'alerts' }] },
  { group: 'Gateway', items: [{ id: 'traffic', label: 'Traffic', perm: 'gateway' }, { id: 'gwapps', label: 'Apps and keys', perm: 'gateway' }, { id: 'plans', label: 'Plans', perm: 'gateway' }, { id: 'firewall', label: 'Firewall', perm: 'gateway' }, { id: 'apis', label: 'APIs', perm: 'gateway' }] },
  { group: 'Access', items: [{ id: 'people', label: 'Users', perm: 'users' }, { id: 'systems', label: 'System accounts', perm: 'users' }, { id: 'roles', label: 'Roles', perm: 'users' }] },
  { group: 'Records', items: [{ id: 'audit', label: 'Audit log', perm: 'audit' }] },
  { group: 'Server', items: [{ id: 'database', label: 'Database', perm: 'server' }] },
];

export function Console() {
  const [auth, setAuth] = useState<{ setup: boolean; user: (Me & { mustChange?: boolean }) | null; version: string; mode: Status['mode'] } | null>(null);
  const [page, setPage] = useState<Page>(() => (location.hash.slice(1) as Page) || 'overview');
  const [menu, setMenu] = useState(false);
  const [panel, setPanel] = useState(() => { try { return localStorage.getItem('sutra.console') === 'open'; } catch { return false; } });
  const entries = useEntries();
  // Open alerts, shown beside Alerts in the navigation.
  const [openAlerts, setOpenAlerts] = useState(0);
  const [critical, setCritical] = useState(0);
  useEffect(() => {
    if (!auth?.user) return;
    const load = () => get<any>('/api/alerts/summary').then(s => { setOpenAlerts(s.open); setCritical(s.critical); }).catch(() => {});
    load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 15000);
    return () => clearInterval(t);
  }, [auth?.user?.username]);
  const seen = useRef(0);
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
  useEffect(() => { try { localStorage.setItem('sutra.console', panel ? 'open' : 'closed'); } catch { /* ignore */ } if (panel) seen.current = entries.length; }, [panel, entries.length]);

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
                    {items.map(i => <a key={i.id} href={'#' + i.id} className={current === i.id ? 'act' : ''} aria-current={current === i.id ? 'page' : undefined} onClick={() => setPage(i.id)}>{i.label}{i.id === 'alerts' && openAlerts > 0 && <span className={`c-navcount${critical ? ' crit' : ''}`} aria-label={`${openAlerts} open`}>{openAlerts}</span>}</a>)}
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
              <button className={`btn small${panel ? ' c-on' : ''}`} aria-pressed={panel} onClick={() => setPanel(p => !p)} title="Actions taken here, their output, and the same action as a command">
                Console{!panel && entries.length > seen.current && <span className="c-count">{entries.length - seen.current}</span>}
              </button>
              <button className="btn small" onClick={toggleTheme} aria-label="Switch light or dark theme">◐</button>
              <button className="btn small" onClick={() => post('/api/auth/logout').then(check)}>Sign out</button>
            </header>
            <div className="c-body">
              {current === 'overview' && <Overview go={setPage} />}
              {current === 'apps' && <Apps />}
              {current === 'approvals' && <Approvals />}
              {current === 'releases' && <Releases />}
              {current === 'engines' && <Engines />}
              {current === 'memory' && <Memory />}
              {current === 'alerts' && <AlertsPage />}
              {current === 'rules' && <RulesPage />}
              {current === 'channels' && <ChannelsPage />}
              {current === 'traffic' && <Traffic />}
              {current === 'gwapps' && <GwApps />}
              {current === 'plans' && <Plans />}
              {current === 'firewall' && <Firewall />}
              {current === 'apis' && <Apis />}
              {current === 'people' && <People kind="user" />}
              {current === 'systems' && <People kind="system" />}
              {current === 'roles' && <Roles />}
              {current === 'audit' && <Audit />}
              {current === 'database' && <Database />}
            </div>
            {panel && <ConsolePanel onClose={() => setPanel(false)} />}
          </main>
        </div>
      </MeCtx.Provider>
    </ToastHost>
  );
}
