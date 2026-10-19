/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Git for workspaces: the git command when it is installed (all features, SSH), else isomorphic-git
 * (built in, HTTPS only; merges that conflict need the git command). SUTRA_GIT=system|builtin chooses.
 * Credentials are given per call and only for that call: through environment settings for the git
 * command (never on its command line, so other users of the machine cannot see them), or through
 * the onAuth callback of isomorphic-git.
 */
export interface Auth { login: string; token: string }
export interface Who { name: string; email: string }
export interface FileState { path: string; index: string; work: string; conflict: boolean }
export interface Status { branch: string; upstream: string | null; ahead: number; behind: number; files: FileState[]; merging: boolean }
export interface Commit { sha: string; parents: string[]; author: string; email: string; date: string; subject: string; refs: string[] }

export interface GitEngine {
  kind: 'system' | 'builtin';
  init(dir: string, branch: string): Promise<void>;
  clone(url: string, dir: string, branch: string | undefined, auth?: Auth): Promise<string>;
  setRemote(dir: string, url: string): Promise<void>;
  status(dir: string): Promise<Status>;
  commitAll(dir: string, message: string, who: Who): Promise<string | null>;
  push(dir: string, branch: string, auth?: Auth): Promise<void>;
  fetch(dir: string, auth?: Auth): Promise<void>;
  pull(dir: string, branch: string, who: Who, auth?: Auth): Promise<{ conflicts: string[] }>;
  branches(dir: string): Promise<{ current: string; local: string[]; remote: string[] }>;
  switchBranch(dir: string, branch: string, create: boolean): Promise<void>;
  log(dir: string, max: number): Promise<Commit[]>;
  fileAt(dir: string, ref: string, file: string): Promise<string | null>;
  changedIn(dir: string, sha: string): Promise<{ status: string; path: string }[]>;
  resolve(dir: string, file: string, side: 'ours' | 'theirs'): Promise<void>;
  abortMerge(dir: string): Promise<void>;
  testRemote(url: string, auth?: Auth): Promise<string[]>;
  /** Checks out a branch, tag or commit (detached) for reading, as a package build does. */
  checkout(dir: string, ref: string): Promise<void>;
  /** The commit checked out. */
  head(dir: string): Promise<string>;
}

// ---------- the git command ----------
const authEnv = (auth?: Auth): Record<string, string> => (auth?.token
  ? { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.extraHeader', GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`${auth.login}:${auth.token}`).toString('base64')}` }
  : {});
const whoEnv = (w?: Who): Record<string, string> => (w ? { GIT_AUTHOR_NAME: w.name, GIT_AUTHOR_EMAIL: w.email, GIT_COMMITTER_NAME: w.name, GIT_COMMITTER_EMAIL: w.email } : {});
/** Hides tokens and passwords from git's messages before they are shown. */
const scrub = (s: string, auth?: Auth) => (auth?.token ? s.split(auth.token).join('***') : s).replace(/(https?:\/\/)[^@/\s]+@/g, '$1***@');

function git(dir: string | null, args: string[], o: { auth?: Auth; who?: Who; allowFail?: boolean; timeoutMs?: number } = {}): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_ASKPASS: '', SSH_ASKPASS: '', LC_ALL: 'C', ...authEnv(o.auth), ...whoEnv(o.who) };
    const p = spawn('git', ['-c', 'core.quotepath=off', '-c', 'credential.helper=', ...args], { cwd: dir || undefined, env, windowsHide: true });
    let out = '', err = '';
    const t = setTimeout(() => p.kill(), o.timeoutMs || 120000);
    p.stdout.on('data', d => (out += d));
    p.stderr.on('data', d => (err += d));
    p.on('error', e => { clearTimeout(t); reject(e); });
    p.on('close', code => {
      clearTimeout(t);
      if (code !== 0 && !o.allowFail) return reject(new Error(scrub(err.trim() || out.trim() || `git ${args[0]} failed (${code})`, o.auth)));
      resolve({ code: code ?? 1, out, err: scrub(err, o.auth) });
    });
  });
}

const systemGit: GitEngine = {
  kind: 'system',
  async init(dir, branch) { fs.mkdirSync(dir, { recursive: true }); await git(dir, ['init', '-b', branch]); },
  async clone(url, dir, branch, auth) {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    await git(null, ['clone', ...(branch ? ['--branch', branch] : []), '--', url, dir], { auth, timeoutMs: 600000 });
    return (await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])).out.trim();
  },
  async setRemote(dir, url) {
    const has = (await git(dir, ['remote'], { allowFail: true })).out.split(/\s+/).includes('origin');
    await git(dir, has ? ['remote', 'set-url', 'origin', url] : ['remote', 'add', 'origin', url]);
  },
  async status(dir) {
    const r = await git(dir, ['status', '--porcelain=v1', '-b', '-uall']);
    const lines = r.out.split('\n').filter(Boolean);
    const head = lines[0]?.startsWith('## ') ? lines.shift()!.slice(3) : '';
    const m = /^(?:No commits yet on )?([^.\s]+)(?:\.\.\.(\S+))?(?: \[(?:ahead (\d+))?(?:, )?(?:behind (\d+))?\])?/.exec(head) || [];
    const files = lines.map(l => ({ index: l[0], work: l[1], path: l.slice(3).replace(/^.* -> /, '').replace(/^"|"$/g, ''), conflict: /^(DD|AU|UD|UA|DU|AA|UU)$/.test(l.slice(0, 2)) }));
    const merging = fs.existsSync(path.join(dir, '.git', 'MERGE_HEAD'));
    return { branch: m[1] || 'HEAD', upstream: m[2] || null, ahead: Number(m[3] || 0), behind: Number(m[4] || 0), files, merging };
  },
  async commitAll(dir, message, who) {
    await git(dir, ['add', '-A']);
    const st = await git(dir, ['diff', '--cached', '--quiet'], { allowFail: true });
    if (st.code === 0 && !fs.existsSync(path.join(dir, '.git', 'MERGE_HEAD'))) return null;
    await git(dir, ['commit', '-m', message], { who });
    return (await git(dir, ['rev-parse', 'HEAD'])).out.trim();
  },
  async push(dir, branch, auth) { await git(dir, ['push', '-u', 'origin', `HEAD:refs/heads/${branch}`], { auth, timeoutMs: 600000 }); },
  async fetch(dir, auth) { await git(dir, ['fetch', '--prune', 'origin'], { auth, timeoutMs: 600000 }); },
  async pull(dir, branch, who, auth) {
    await git(dir, ['fetch', 'origin'], { auth, timeoutMs: 600000 });
    const remote = (await git(dir, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`], { allowFail: true })).code === 0;
    if (!remote) return { conflicts: [] };
    const r = await git(dir, ['merge', '--no-edit', `origin/${branch}`], { who, allowFail: true });
    if (r.code === 0) return { conflicts: [] };
    const st = await systemGit.status(dir);
    const conflicts = st.files.filter(f => f.conflict).map(f => f.path);
    if (!conflicts.length) throw new Error(scrub(r.err.trim() || r.out.trim(), auth));
    return { conflicts };
  },
  async branches(dir) {
    const r = await git(dir, ['branch', '-a', '--format=%(HEAD)|%(refname)'], { allowFail: true });
    const local: string[] = [], remote: string[] = [];
    let current = '';
    for (const l of r.out.split('\n').filter(Boolean)) {
      const [h, ref] = l.split('|');
      if (ref.startsWith('refs/heads/')) { const b = ref.slice(11); local.push(b); if (h === '*') current = b; }
      else if (ref.startsWith('refs/remotes/origin/') && !ref.endsWith('/HEAD')) remote.push(ref.slice(20));
    }
    if (!current) current = (await git(dir, ['symbolic-ref', '--short', 'HEAD'], { allowFail: true })).out.trim();
    return { current, local, remote };
  },
  async switchBranch(dir, branch, create) {
    if (create) await git(dir, ['switch', '-c', branch]);
    else {
      const has = (await git(dir, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { allowFail: true })).code === 0;
      await git(dir, has ? ['switch', branch] : ['switch', '-c', branch, '--track', `origin/${branch}`]);
    }
  },
  async log(dir, max) {
    const r = await git(dir, ['log', '--all', '--date-order', `-n${max}`, '--format=%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%D%x1e'], { allowFail: true });
    return r.out.split('\x1e').map(s => s.trim()).filter(Boolean).map(s => {
      const [sha, parents, author, email, date, subject, refs] = s.split('\x1f');
      return { sha, parents: parents ? parents.split(' ') : [], author, email, date, subject, refs: refs ? refs.split(', ').map(x => x.replace(/^HEAD -> /, '')).filter(Boolean) : [] };
    });
  },
  async fileAt(dir, ref, file) { const r = await git(dir, ['show', `${ref}:${file}`], { allowFail: true }); return r.code === 0 ? r.out : null; },
  async changedIn(dir, sha) {
    const r = await git(dir, ['show', '--name-status', '--format=', '-m', '--first-parent', sha], { allowFail: true });
    return r.out.split('\n').filter(Boolean).map(l => { const [status, ...p] = l.split('\t'); return { status: status[0], path: p[p.length - 1] }; });
  },
  async resolve(dir, file, side) { await git(dir, ['checkout', `--${side}`, '--', file]); await git(dir, ['add', '--', file]); },
  async abortMerge(dir) { await git(dir, ['merge', '--abort']); },
  async checkout(dir, ref) {
    const remote = (await git(dir, ['rev-parse', '--verify', '--quiet', `origin/${ref}`], { allowFail: true })).code === 0;
    await git(dir, ['-c', 'advice.detachedHead=false', 'checkout', '--quiet', remote ? `origin/${ref}` : ref, '--']);
  },
  async head(dir) { return (await git(dir, ['rev-parse', 'HEAD'])).out.trim(); },
  async testRemote(url, auth) {
    const r = await git(null, ['ls-remote', '--heads', '--', url], { auth, timeoutMs: 60000 });
    return r.out.split('\n').filter(Boolean).map(l => l.split('\trefs/heads/')[1]).filter(Boolean);
  },
};

// ---------- built in (isomorphic-git) ----------
async function iso() {
  const g = await import('isomorphic-git');
  const http = await import('isomorphic-git/http/node');
  return { g: (g as any).default || g, http: (http as any).default || http };
}
/**
 * Changes against the last commit, by content: isomorphic-git's status trusts file times and sizes,
 * which misses an edit of the same size in the same second (SutraFlow writes files just before asking).
 */
async function contentChanges(dir: string) {
  const { g } = await iso();
  const head = new Map<string, string>();
  try {
    const oid = await g.resolveRef({ fs, dir, ref: 'HEAD' });
    await g.walk({ fs, dir, trees: [g.TREE({ ref: oid })], map: async (p: string, [e]: any[]) => { if (p !== '.' && (await e?.type()) === 'blob') head.set(p, await e.oid()); } });
  } catch { /* no commit yet */ }
  const out: { path: string; change: 'A' | 'M' | 'D' }[] = [];
  const walkDir = (sub: string): string[] => fs.readdirSync(path.join(dir, sub), { withFileTypes: true }).flatMap(e => (e.name === '.git' ? [] : e.isDirectory() ? walkDir(sub ? `${sub}/${e.name}` : e.name) : [sub ? `${sub}/${e.name}` : e.name]));
  const work = walkDir('');
  for (const f of work) {
    const { oid } = await g.hashBlob({ object: fs.readFileSync(path.join(dir, f)) });
    if (!head.has(f)) out.push({ path: f, change: 'A' }); else if (head.get(f) !== oid) out.push({ path: f, change: 'M' });
  }
  for (const f of head.keys()) if (!work.includes(f)) out.push({ path: f, change: 'D' });
  return out;
}
const onAuth = (auth?: Auth) => (auth?.token ? () => ({ username: auth.login, password: auth.token }) : undefined);
const builtinGit: GitEngine = {
  kind: 'builtin',
  async init(dir, branch) { const { g } = await iso(); fs.mkdirSync(dir, { recursive: true }); await g.init({ fs, dir, defaultBranch: branch }); },
  async clone(url, dir, branch, auth) {
    const { g, http } = await iso();
    await g.clone({ fs, http, dir, url, ref: branch, singleBranch: false, onAuth: onAuth(auth) });
    return (await g.currentBranch({ fs, dir })) || branch || 'main';
  },
  async setRemote(dir, url) { const { g } = await iso(); await g.addRemote({ fs, dir, remote: 'origin', url, force: true }); },
  async status(dir) {
    const { g } = await iso();
    const branch = (await g.currentBranch({ fs, dir })) || 'HEAD';
    const files = (await contentChanges(dir)).map(c => ({ path: c.path, index: ' ', work: c.change === 'A' ? '?' : c.change, conflict: false }));
    let ahead = 0, behind = 0, upstream: string | null = null;
    try {
      const local = await g.resolveRef({ fs, dir, ref: branch });
      const remote = await g.resolveRef({ fs, dir, ref: `refs/remotes/origin/${branch}` });
      upstream = `origin/${branch}`;
      const l = await g.log({ fs, dir, ref: local, depth: 500 }), r = await g.log({ fs, dir, ref: remote, depth: 500 });
      const ls = new Set(l.map((c: any) => c.oid)), rs = new Set(r.map((c: any) => c.oid));
      ahead = l.filter((c: any) => !rs.has(c.oid)).length; behind = r.filter((c: any) => !ls.has(c.oid)).length;
    } catch { /* no upstream yet */ }
    return { branch, upstream, ahead, behind, files, merging: false };
  },
  async commitAll(dir, message, who) {
    const { g } = await iso();
    const changes = await contentChanges(dir);
    if (!changes.length) return null;
    for (const c of changes) { if (c.change === 'D') await g.remove({ fs, dir, filepath: c.path }); else await g.add({ fs, dir, filepath: c.path }); }
    return g.commit({ fs, dir, message, author: { name: who.name, email: who.email } });
  },
  async push(dir, branch, auth) { const { g, http } = await iso(); await g.push({ fs, http, dir, remote: 'origin', ref: branch, remoteRef: branch, onAuth: onAuth(auth) }); },
  async fetch(dir, auth) { const { g, http } = await iso(); await g.fetch({ fs, http, dir, remote: 'origin', onAuth: onAuth(auth) }); },
  async pull(dir, branch, who, auth) {
    const { g, http } = await iso();
    await g.fetch({ fs, http, dir, remote: 'origin', ref: branch, onAuth: onAuth(auth) });
    try { await g.merge({ fs, dir, ours: branch, theirs: `origin/${branch}`, author: { name: who.name, email: who.email } }); await g.checkout({ fs, dir, ref: branch }); }
    catch (e: any) {
      if (/MergeConflict|MergeNotSupported/i.test(e.code || e.name || '')) throw new Error('Both sides changed the same Sutras. The built-in Git cannot merge these; install the git command (https://git-scm.com) and pull again.');
      if (!/NotFoundError/.test(e.code || e.name || '')) throw e;
    }
    return { conflicts: [] };
  },
  async branches(dir) {
    const { g } = await iso();
    return { current: (await g.currentBranch({ fs, dir })) || '', local: await g.listBranches({ fs, dir }), remote: (await g.listBranches({ fs, dir, remote: 'origin' }).catch(() => [])).filter((b: string) => b !== 'HEAD') };
  },
  async switchBranch(dir, branch, create) { const { g } = await iso(); if (create) await g.branch({ fs, dir, ref: branch, checkout: true }); else await g.checkout({ fs, dir, ref: branch }); },
  async log(dir, max) {
    const { g } = await iso();
    let list: any[] = [];
    try { list = await g.log({ fs, dir, depth: max }); } catch { return []; }
    const refs = new Map<string, string[]>();
    for (const b of await g.listBranches({ fs, dir })) { const o = await g.resolveRef({ fs, dir, ref: b }); refs.set(o, [...(refs.get(o) || []), b]); }
    return list.map((c: any) => ({ sha: c.oid, parents: c.commit.parent, author: c.commit.author.name, email: c.commit.author.email, date: new Date(c.commit.author.timestamp * 1000).toISOString(), subject: c.commit.message.split('\n')[0], refs: refs.get(c.oid) || [] }));
  },
  async fileAt(dir, ref, file) {
    const { g } = await iso();
    try { const oid = await g.resolveRef({ fs, dir, ref }); const r = await g.readBlob({ fs, dir, oid, filepath: file }); return Buffer.from(r.blob).toString('utf8'); } catch { return null; }
  },
  async changedIn(dir, sha) {
    const { g } = await iso();
    const c = await g.readCommit({ fs, dir, oid: sha });
    const parent = c.commit.parent[0];
    const out: { status: string; path: string }[] = [];
    await g.walk({ fs, dir, trees: [g.TREE({ ref: sha }), ...(parent ? [g.TREE({ ref: parent })] : [])], map: async (p: string, [a, b]: any[]) => {
      if (p === '.') return;
      if ((await a?.type()) === 'tree' || (await b?.type()) === 'tree') return;
      const ao = await a?.oid(), bo = await b?.oid();
      if (ao !== bo) out.push({ status: !bo ? 'A' : !ao ? 'D' : 'M', path: p });
    } });
    return out;
  },
  async resolve() { throw new Error('Resolving conflicts needs the git command'); },
  async abortMerge() { /* the built-in merge never leaves a merge open */ },
  async checkout(dir, ref) { const { g } = await iso(); await g.checkout({ fs, dir, ref, force: true }); },
  async head(dir) { const { g } = await iso(); return g.resolveRef({ fs, dir, ref: 'HEAD' }); },
  async testRemote(url, auth) { const { g, http } = await iso(); const info = await g.getRemoteInfo({ http, url, onAuth: onAuth(auth) }); return Object.keys(info.refs?.heads || {}); },
};

let chosen: GitEngine | null = null;
/** The engine in use: SUTRA_GIT, else the git command when found, else the built-in one. */
export function gitEngine(): GitEngine {
  if (chosen) return chosen;
  const want = String(process.env.SUTRA_GIT || '').toLowerCase();
  if (want === 'builtin') return (chosen = builtinGit);
  const has = spawnSync('git', ['--version'], { windowsHide: true }).status === 0;
  if (want === 'system' && !has) throw new Error('SUTRA_GIT=system but the git command was not found');
  return (chosen = has ? systemGit : builtinGit);
}
export const engines = { system: systemGit, builtin: builtinGit };
