import crypto from 'node:crypto';
import { q, tx, now } from './db.js';
import { hashPassword, verifyPassword } from './auth.js';

/**
 * Who may do what. People and system accounts get roles; a role is granted for all projects or for
 * one project. A role is a set of permissions: project permissions apply to the projects of the grant,
 * server permissions only come from grants for all projects.
 *
 * System accounts are not people: engines, CI pipelines and API callers. They sign in to the admin API
 * with tokens (shown once, stored as hashes) and, when they have a password, to gateway services
 * whose API policy accepts system accounts.
 */

export type Scope = 'project' | 'server';
export const PERMISSIONS: { id: string; scope: Scope; name: string; help: string }[] = [
  { id: 'view', scope: 'project', name: 'View', help: 'See the project, its Sutras, connections, runs and logs.' },
  { id: 'design', scope: 'project', name: 'Design', help: 'Edit Sutras, schemas and project settings; test and debug runs.' },
  { id: 'connections', scope: 'project', name: 'Connections', help: 'Add and change connections and API security policies.' },
  { id: 'deploy', scope: 'project', name: 'Deploy', help: 'Deploy and undeploy Sutras, deploy packages, roll back, edit the deployment config.' },
  { id: 'operate', scope: 'project', name: 'Operate', help: 'Start, cancel and resubmit runs; clear runtime variable values.' },
  { id: 'approve', scope: 'project', name: 'Approve', help: 'Decide approvals of running Sutras.' },
  { id: 'call', scope: 'project', name: 'Call services', help: 'System accounts: call the project\'s gateway services with Basic sign-in.' },
  { id: 'secrets', scope: 'server', name: 'Secrets', help: 'Store and delete vault secrets.' },
  { id: 'engines', scope: 'server', name: 'Engines', help: 'Drain engines, run housekeeping, change tuning.' },
  { id: 'server', scope: 'server', name: 'Server settings', help: 'Gateway ports and certificates, Sengine variables, scripts and release policies, model installs.' },
  { id: 'users', scope: 'server', name: 'Users and roles', help: 'Provision users and system accounts, roles and access.' },
  { id: 'audit', scope: 'server', name: 'Audit', help: 'Read and export the audit log.' },
  { id: 'alerts', scope: 'server', name: 'Alerts', help: 'Alert rules and channels.' },
];
const PERM_IDS = new Set(PERMISSIONS.map(p => p.id));
const SERVER_PERMS = new Set(PERMISSIONS.filter(p => p.scope === 'server').map(p => p.id));

export const BUILTIN_ROLES: { id: string; name: string; description: string; perms: string[] }[] = [
  { id: 'administrator', name: 'Administrator', description: 'Everything, including users, roles and server settings.', perms: PERMISSIONS.map(p => p.id) },
  { id: 'developer', name: 'Developer', description: 'Designs and tests Sutras and connections.', perms: ['view', 'design', 'connections', 'operate'] },
  { id: 'deployer', name: 'Deployer', description: 'Releases: deploys packages and Sutras, rolls back.', perms: ['view', 'deploy'] },
  { id: 'operator', name: 'Operator', description: 'Runs production: runs, approvals, engines, alerts, audit.', perms: ['view', 'operate', 'approve', 'engines', 'alerts', 'audit'] },
  { id: 'approver', name: 'Approver', description: 'Decides approvals.', perms: ['view', 'approve'] },
  { id: 'viewer', name: 'Viewer', description: 'Reads everything it is granted, changes nothing.', perms: ['view'] },
  { id: 'apiCaller', name: 'API caller', description: 'For system accounts that call gateway services.', perms: ['call'] },
];

/** The caller of an admin API request. */
export interface Caller { u: string; kind: 'user' | 'system' | 'token'; all?: boolean }

const ALL = '';

// ---------- roles ----------

export function ensureBuiltins() {
  for (const r of BUILTIN_ROLES) {
    q.run(`insert into roles(id, name, description, perms, builtin, updated_at) values(?, ?, ?, ?, 1, ?)
      on conflict(id) do update set name = excluded.name, description = excluded.description, perms = excluded.perms, builtin = 1`,
    r.id, r.name, r.description, JSON.stringify(r.perms), now());
  }
  // Accounts from before roles existed: administrators keep everything, others get Developer.
  for (const u of q.all<{ username: string; role: string }>(`select username, role from users u where not exists (select 1 from grants g where g.username = u.username)`)) {
    q.run('insert into grants(username, role_id, project_id) values(?, ?, ?)', u.username, u.role === 'admin' ? 'administrator' : 'developer', ALL);
  }
}

export function listRoles() {
  return q.all<any>('select * from roles order by builtin desc, name').map(r => ({
    id: r.id, name: r.name, description: r.description || '', perms: JSON.parse(r.perms), builtin: !!r.builtin,
    holders: Number(q.get<any>('select count(distinct username) n from grants where role_id = ?', r.id)?.n || 0),
  }));
}

export function saveRole(input: { id?: string; name: string; description?: string; perms: string[] }) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('Role name is required');
  const perms = [...new Set((input.perms || []).map(String))];
  const unknown = perms.filter(p => !PERM_IDS.has(p));
  if (unknown.length) throw new Error(`Unknown permission: ${unknown.join(', ')}`);
  const id = input.id || 'r-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + crypto.randomBytes(2).toString('hex');
  const existing = q.get<any>('select builtin from roles where id = ?', id);
  if (existing?.builtin) throw new Error('Built-in roles cannot be changed; make a new role instead');
  if (q.get('select 1 from roles where lower(name) = lower(?) and id != ?', name, id)) throw new Error(`A role named "${name}" exists`);
  q.run(`insert into roles(id, name, description, perms, builtin, updated_at) values(?, ?, ?, ?, 0, ?)
    on conflict(id) do update set name = excluded.name, description = excluded.description, perms = excluded.perms, updated_at = excluded.updated_at`,
  id, name, String(input.description || ''), JSON.stringify(perms), now());
  return listRoles().find(r => r.id === id)!;
}

export function deleteRole(id: string) {
  const r = q.get<any>('select builtin from roles where id = ?', id);
  if (!r) throw new Error('Role not found');
  if (r.builtin) throw new Error('Built-in roles cannot be deleted');
  if (q.get('select 1 from grants where role_id = ?', id)) throw new Error('The role is still granted; remove it from users first');
  q.run('delete from roles where id = ?', id);
}

// ---------- permissions ----------

export interface Grant { role: string; project: string }

export function grantsOf(username: string): Grant[] {
  return q.all<any>('select role_id, project_id from grants where username = ? order by project_id, role_id', username).map(g => ({ role: g.role_id, project: g.project_id || ALL }));
}

/** Permissions by project ('' = all projects). */
export function permissionsOf(c: Caller): { all: Set<string>; byProject: Map<string, Set<string>> } {
  const all = new Set<string>(), byProject = new Map<string, Set<string>>();
  if (c.all) { for (const p of PERM_IDS) all.add(p); return { all, byProject }; }
  for (const g of q.all<any>('select g.project_id, r.perms from grants g join roles r on r.id = g.role_id where g.username = ?', c.u)) {
    const perms: string[] = JSON.parse(g.perms);
    if (!g.project_id) perms.forEach(p => all.add(p));
    else {
      const s = byProject.get(g.project_id) || new Set<string>();
      perms.filter(p => !SERVER_PERMS.has(p)).forEach(p => s.add(p));
      byProject.set(g.project_id, s);
    }
  }
  return { all, byProject };
}

/**
 * Whether the caller holds a permission. project: that project; undefined: anywhere (any project for
 * project permissions); '' : on all projects.
 */
export function can(c: Caller, perm: string, project?: string): boolean {
  if (c.all) return true;
  const p = permissionsOf(c);
  if (p.all.has(perm)) return true;
  if (SERVER_PERMS.has(perm) || project === ALL) return false;
  if (project === undefined) return [...p.byProject.values()].some(s => s.has(perm));
  return !!p.byProject.get(project)?.has(perm);
}

/** Projects the caller may see: 'all', or a set of ids. */
export function visibleProjects(c: Caller): 'all' | Set<string> {
  if (c.all) return 'all';
  const p = permissionsOf(c);
  if (p.all.size && [...p.all].some(x => !SERVER_PERMS.has(x))) return 'all';
  return new Set([...p.byProject.keys()]);
}

export function me(c: Caller) {
  const p = permissionsOf(c);
  const u = c.kind === 'token' ? null : q.get<any>('select display_name, email, kind, must_change from users where username = ?', c.u);
  return {
    username: c.u, kind: c.kind, displayName: u?.display_name || c.u, email: u?.email || '', mustChange: !!u?.must_change,
    permissions: { all: [...p.all], projects: Object.fromEntries([...p.byProject].map(([k, v]) => [k, [...v]])) },
  };
}

// ---------- users and system accounts ----------

export type AccountKind = 'user' | 'system';
const USERNAME = /^[\w.@-]{2,64}$/;

export function checkPassword(pw: string, username = '') {
  if (pw.length < 10) throw new Error('Password must have at least 10 characters');
  if (username && pw.toLowerCase().includes(username.toLowerCase())) throw new Error('Password must not contain the username');
  if (!/[a-zA-Z]/.test(pw) || !/[^a-zA-Z]/.test(pw)) throw new Error('Password needs letters and at least one digit or symbol');
}

function userRow(r: any) {
  return {
    username: r.username, kind: (r.kind || 'user') as AccountKind, displayName: r.display_name || '', email: r.email || '',
    disabled: !!r.disabled, locked: Number(r.locked_until || 0) > Date.now(), mustChange: !!r.must_change, hasPassword: !!r.hash,
    lastLogin: r.last_login || null, createdAt: r.created_at, grants: grantsOf(r.username),
    tokens: Number(q.get<any>('select count(*) n from api_tokens where username = ?', r.username)?.n || 0),
  };
}

export function listUsers(kind?: AccountKind) {
  return q.all<any>(`select * from users ${kind ? 'where coalesce(kind, \'user\') = ?' : ''} order by username`, ...(kind ? [kind] : [])).map(userRow);
}

export function getUser(username: string) {
  const r = q.get<any>('select * from users where username = ?', username);
  return r ? userRow(r) : null;
}

function setGrants(username: string, grants: Grant[]) {
  const roles = new Set(q.all<any>('select id from roles').map(r => r.id));
  const projects = new Set(q.all<any>('select id from projects').map(r => r.id));
  for (const g of grants) {
    if (!roles.has(g.role)) throw new Error(`Unknown role: ${g.role}`);
    if (g.project && !projects.has(g.project)) throw new Error(`Unknown project: ${g.project}`);
  }
  q.run('delete from grants where username = ?', username);
  for (const g of grants) q.run('insert into grants(username, role_id, project_id) values(?, ?, ?) on conflict do nothing', username, g.role, g.project || ALL);
}

/** Active accounts holding Administrator (or every server permission) on all projects. */
function administrators() {
  return q.all<any>(`select distinct u.username from users u join grants g on g.username = u.username join roles r on r.id = g.role_id
    where coalesce(u.disabled, 0) = 0 and g.project_id = '' and r.id = 'administrator'`).map(r => r.username);
}
function keepsAnAdministrator(change: () => void) {
  tx(() => {
    change();
    if (!administrators().length) throw new Error('At least one active administrator must remain');
  });
}

export function createAccount(input: { username: string; kind?: AccountKind; displayName?: string; email?: string; password?: string; mustChange?: boolean; grants?: Grant[] }) {
  const username = String(input.username || '').trim();
  const kind: AccountKind = input.kind === 'system' ? 'system' : 'user';
  if (!USERNAME.test(username)) throw new Error('Username: 2 to 64 letters, digits, . _ @ -');
  if (q.get('select 1 from users where lower(username) = lower(?)', username)) throw new Error(`"${username}" exists`);
  const pw = input.password ? String(input.password) : '';
  if (kind === 'user' && !pw) throw new Error('A password is required for a user');
  if (pw) checkPassword(pw, username);
  tx(() => {
    q.run(`insert into users(username, hash, role, created_at, kind, display_name, email, disabled, must_change, failed, locked_until, sessions_after, updated_at)
      values(?, ?, ?, ?, ?, ?, ?, 0, ?, 0, 0, 0, ?)`,
    username, pw ? hashPassword(pw) : '', 'member', now(), kind, String(input.displayName || ''), String(input.email || ''), kind === 'user' && input.mustChange !== false ? 1 : 0, now());
    setGrants(username, input.grants || []);
  });
  return getUser(username)!;
}

export function updateAccount(username: string, input: { displayName?: string; email?: string; disabled?: boolean; grants?: Grant[] }, by?: string) {
  const u = getUser(username);
  if (!u) throw new Error('Account not found');
  if (input.disabled && by === username) throw new Error('You cannot disable your own account');
  keepsAnAdministrator(() => {
    q.run(`update users set display_name = ?, email = ?, disabled = ?, updated_at = ?${input.disabled && !u.disabled ? ', sessions_after = ?' : ''} where username = ?`,
      input.displayName ?? u.displayName, input.email ?? u.email, input.disabled === undefined ? (u.disabled ? 1 : 0) : input.disabled ? 1 : 0, now(),
      ...(input.disabled && !u.disabled ? [Date.now()] : []), username);
    if (input.grants) setGrants(username, input.grants);
  });
  return getUser(username)!;
}

export function deleteAccount(username: string, by?: string) {
  if (by === username) throw new Error('You cannot delete your own account');
  if (!getUser(username)) throw new Error('Account not found');
  keepsAnAdministrator(() => {
    q.run('delete from grants where username = ?', username);
    q.run('delete from api_tokens where username = ?', username);
    q.run('delete from users where username = ?', username);
  });
}

/** An administrator sets a new password (and usually asks for a change at next sign-in). */
export function resetPassword(username: string, pw: string, mustChange = true) {
  const u = getUser(username);
  if (!u) throw new Error('Account not found');
  checkPassword(pw, username);
  q.run('update users set hash = ?, must_change = ?, failed = 0, locked_until = 0, sessions_after = ?, updated_at = ? where username = ?',
    hashPassword(pw), u.kind === 'user' && mustChange ? 1 : 0, Date.now(), now(), username);
}

/** The signed-in person changes their own password. */
export function changeOwnPassword(username: string, current: string, next: string) {
  const r = q.get<any>('select hash from users where username = ?', username);
  if (!r?.hash || !verifyPassword(current, r.hash)) throw new Error('The current password is wrong');
  if (current === next) throw new Error('Choose a password different from the current one');
  checkPassword(next, username);
  q.run('update users set hash = ?, must_change = 0, sessions_after = ?, updated_at = ? where username = ?', hashPassword(next), Date.now() - 1000, now(), username);
}

export function unlock(username: string) {
  q.run('update users set failed = 0, locked_until = 0 where username = ?', username);
}

/** Ends every session of the account (sign out everywhere). */
export function endSessions(username: string) {
  q.run('update users set sessions_after = ? where username = ?', Date.now(), username);
}

// ---------- sign-in ----------

export const LOCK_AFTER = 5;
export const LOCK_MINUTES = 15;

/** Checks a password sign-in. ok: the account; otherwise why not (wrong, locked, disabled). */
export function passwordSignIn(username: string, pw: string): { ok: true; user: any } | { ok: false; reason: 'wrong' | 'locked' | 'disabled' } {
  const r = q.get<any>('select * from users where username = ?', username);
  if (!r || !r.hash) { if (!r) verifyPassword(pw, hashPassword('timing-equaliser-x1')); return { ok: false, reason: 'wrong' }; }
  if (Number(r.locked_until || 0) > Date.now()) return { ok: false, reason: 'locked' };
  if (!verifyPassword(pw, r.hash)) {
    const failed = Number(r.failed || 0) + 1;
    q.run('update users set failed = ?, locked_until = ? where username = ?', failed >= LOCK_AFTER ? 0 : failed, failed >= LOCK_AFTER ? Date.now() + LOCK_MINUTES * 60e3 : 0, username);
    return { ok: false, reason: failed >= LOCK_AFTER ? 'locked' : 'wrong' };
  }
  if (r.disabled) return { ok: false, reason: 'disabled' };
  q.run('update users set failed = 0, locked_until = 0, last_login = ? where username = ?', now(), username);
  return { ok: true, user: r };
}

/** Whether a session issued at iat is still valid for the account. */
export function sessionValid(username: string, iat: number) {
  const r = q.get<any>('select disabled, sessions_after from users where username = ?', username);
  return !!r && !r.disabled && iat >= Number(r.sessions_after || 0);
}

export function mustChangePassword(username: string) {
  return !!q.get<any>('select must_change from users where username = ?', username)?.must_change;
}

// ---------- API tokens of system accounts ----------

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export function listTokens(username: string) {
  return q.all<any>('select id, name, created_at, expires_at, last_used from api_tokens where username = ? order by created_at', username)
    .map(t => ({ id: t.id, name: t.name, createdAt: t.created_at, expiresAt: t.expires_at ? new Date(Number(t.expires_at)).toISOString() : null, lastUsed: t.last_used, expired: !!t.expires_at && Number(t.expires_at) < Date.now() }));
}

/** Creates a token; the value is returned once and only its hash is kept. */
export function createToken(username: string, name: string, expiresDays?: number) {
  const u = getUser(username);
  if (!u) throw new Error('Account not found');
  if (u.kind !== 'system') throw new Error('API tokens are for system accounts');
  const id = crypto.randomBytes(6).toString('hex'), secret = crypto.randomBytes(24).toString('base64url');
  const token = `sut_${id}_${secret}`;
  const days = Number(expiresDays) || 0;
  q.run('insert into api_tokens(id, username, name, hash, created_at, expires_at) values(?, ?, ?, ?, ?, ?)',
    id, username, String(name || 'token').slice(0, 80), sha(token), now(), days > 0 ? Date.now() + days * 86400e3 : 0);
  return { id, token, expiresAt: days > 0 ? new Date(Date.now() + days * 86400e3).toISOString() : null };
}

export function deleteToken(username: string, id: string) {
  q.run('delete from api_tokens where username = ? and id = ?', username, id);
}

/** The system account a bearer token belongs to, or null. */
export function tokenAccount(token: string): string | null {
  const m = /^sut_([0-9a-f]{12})_[\w-]+$/.exec(token);
  if (!m) return null;
  const t = q.get<any>('select t.username, t.hash, t.expires_at, u.disabled from api_tokens t join users u on u.username = t.username where t.id = ?', m[1]);
  if (!t || t.disabled) return null;
  const a = Buffer.from(sha(token)), b = Buffer.from(String(t.hash));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Number(t.expires_at) && Number(t.expires_at) < Date.now()) return null;
  q.run('update api_tokens set last_used = ? where id = ?', now(), m[1]);
  return t.username;
}

/** Gateway Basic sign-in with a system account: active, right password, may call the project's services. */
export function systemAccountMayCall(username: string, pw: string, projectId: string | undefined) {
  const r = q.get<any>(`select hash, disabled, kind from users where username = ?`, username);
  if (!r || r.kind !== 'system' || r.disabled || !r.hash || !verifyPassword(pw, r.hash)) return false;
  return can({ u: username, kind: 'system' }, 'call', projectId || undefined);
}
