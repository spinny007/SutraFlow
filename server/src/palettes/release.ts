/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Activity, ExecCtx } from '../engine/types.js';
import { F, when } from './common.js';
import { listProjects, getProject, releasesAllowed } from '../projects.js';
import { buildPackage, checkPackage, deployPackage, readPackage, rollbackPackage } from '../packages.js';

/**
 * Release palette: a Sutra that builds, checks, deploys and rolls back project packages, on this
 * server or on a remote engine (its admin token comes from the vault). A release becomes a Sutra:
 * timer or REST call, build, deploy to test, approval, deploy to production, email the result.
 * Off until an administrator allows release activities (Server & APIs).
 */
const TARGETS = ['this server', 'remote server'];

function guard() {
  if (!releasesAllowed()) throw new Error('Release activities are switched off on this server. An administrator can allow them in Server & APIs.');
}

const targetFields = () => [
  F('target', 'Server', 'select', TARGETS[0], { options: TARGETS }),
  F('server', 'Server address', 'text', 'https://engine-1:4800', { help: 'The engine\'s admin address. May use {{gv.PROD_ENGINE}}.', ...when('target', 'remote server') }),
  F('tokenSecret', 'Admin token', 'secret', '', { help: 'Vault secret holding that server\'s SUTRA_ADMIN_TOKEN.', ...when('target', 'remote server') }),
];

/** Calls a remote SutraFlow admin API with its token. */
async function remote(c: ExecCtx, method: string, p: string, body?: unknown) {
  const server = String(c.raw('server') || '').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(server)) throw new Error('Server address must start with http:// or https://');
  const token = c.secret(c.raw('tokenSecret'), 'Admin token');
  const r = await fetch(server + p, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined, signal: c.signal });
  const text = await r.text();
  let j: any; try { j = JSON.parse(text); } catch { j = { error: text }; }
  if (!r.ok) throw Object.assign(new Error(`${server}: ${j?.error || r.status}`), { details: j?.check });
  return j;
}

/** The package: from an earlier step (object or JSON text) or from a file on this server. */
function packageOf(c: ExecCtx) {
  if (c.raw('packageFrom') === 'file') {
    const f = String(c.v('file') || '').trim();
    if (!f || !fs.existsSync(f)) throw new Error(`Package file not found: ${f}`);
    return readPackage(fs.readFileSync(f, 'utf8'));
  }
  return readPackage(c.v('package'));
}

const packageFields = () => [
  F('packageFrom', 'Package from', 'select', 'previous step', { options: ['previous step', 'file'] }),
  F('package', 'Package', 'text', '{{input.package}}', { tpl: true, help: 'The package an earlier Build package produced.', ...when('packageFrom', 'previous step') }),
  F('file', 'Package file', 'text', '', { tpl: true, help: 'A .sutra file on this server.', ...when('packageFrom', 'file') }),
];

const projectName = (c: ExecCtx) => String(c.v('project') || '').trim() || getProject(c.projectId || '')?.name || '';

export const releaseActivities: Activity[] = [
  {
    type: 'releasePackage', palette: 'release', name: 'Build package', glyph: '⬢', ports: ['out'],
    desc: 'Builds a package of a project: every deployed Sutra at its version, connections without secret values, schemas and variables. On this server or a remote one; can also save it as a file.',
    fields: [
      ...targetFields(),
      F('project', 'Project', 'text', '', { tpl: true, help: 'Project name. Empty = the project of this Sutra.' }),
      F('version', 'Version', 'text', "=concat('1.0.', format-dateTime('YYYYMMDDHHmm', current-dateTime(), 'UTC'))", { tpl: true, help: 'Like 1.4.0.' }),
      F('note', 'Note', 'text', '', { tpl: true }),
      F('sutras', 'Only these Sutras', 'list', [], { help: 'Empty = all of them.' }),
      F('saveTo', 'Also save to folder', 'text', '', { tpl: true, help: 'Optional: writes <project>-<version>.sutra there.' }),
    ],
    outputHint: { name: '', version: '', checksum: '', sutras: [''], secrets: [''], file: '', package: {} },
    execute: async c => {
      guard();
      const proj = projectName(c);
      const version = String(c.v('version') || '').trim();
      const sutras = ((c.raw('sutras') as string[]) || []).map(s => String(c.resolve(s) ?? '').trim()).filter(Boolean);
      let pkg: any;
      if (c.raw('target') === 'remote server') {
        const projects: any[] = await remote(c, 'GET', '/api/projects');
        const p = projects.find(x => x.name.toLowerCase() === proj.toLowerCase());
        if (!p) throw new Error(`No project named "${proj}" on ${c.raw('server')}`);
        const qs = new URLSearchParams({ version, note: String(c.v('note') || ''), ...(sutras.length ? { sutras: sutras.join(',') } : {}) });
        pkg = await remote(c, 'GET', `/api/projects/${p.id}/package?${qs}`);
      } else {
        const p = listProjects().find(x => x.name.toLowerCase() === proj.toLowerCase());
        if (!p) throw new Error(`No project named "${proj}"`);
        pkg = buildPackage(p.id, { version, note: String(c.v('note') || '') || undefined, sutras: sutras.length ? sutras : undefined });
      }
      let file = '';
      const dir = String(c.v('saveTo') || '').trim();
      if (dir) {
        fs.mkdirSync(dir, { recursive: true });
        file = path.join(dir, `${pkg.name.replace(/[^\w.-]+/g, '-')}-${pkg.version}.sutra`);
        fs.writeFileSync(file, JSON.stringify(pkg, null, 2));
      }
      return { out: { name: pkg.name, version: pkg.version, checksum: pkg.checksum, sutras: pkg.sutras.map((s: any) => s.name), secrets: pkg.manifest.secrets, file, package: pkg } };
    },
  },
  {
    type: 'releaseCheck', palette: 'release', name: 'Check package', glyph: '✓', ports: ['ok', 'problems'],
    desc: 'Checks whether a package can be deployed on a server: activities it knows, secrets present, API paths and skill names not used by another project.',
    fields: [...packageFields(), ...targetFields(), F('project', 'Deploy as project', 'text', '', { tpl: true, help: 'Empty = the package\'s project name.' })],
    outputHint: { ok: true, errors: [''], warnings: [''], secrets: [{ name: '', present: true }], package: {} },
    execute: async c => {
      guard();
      const pkg = packageOf(c);
      const project = String(c.v('project') || '').trim() || undefined;
      const r = c.raw('target') === 'remote server' ? await remote(c, 'POST', '/api/packages/check', { package: pkg, project }) : checkPackage(pkg, { project });
      return { port: r.ok ? 'ok' : 'problems', out: { ...r, package: pkg } };
    },
  },
  {
    type: 'releaseDeploy', palette: 'release', name: 'Deploy package', glyph: '⇪', ports: ['out'],
    desc: 'Deploys a package to this server or a remote engine. Refused, on the error output, when the check finds a problem; Sutras not in the package are undeployed unless kept.',
    fields: [
      ...packageFields(), ...targetFields(),
      F('project', 'Deploy as project', 'text', '', { tpl: true, help: 'Empty = the package\'s project name.' }),
      F('keepOthers', 'Keep Sutras that are not in the package deployed', 'bool', false),
      F('opsFile', 'Deployment config file', 'text', '', { tpl: true, help: 'Optional: a JSON deployment config on this server, applied with the package.' }),
    ],
    outputHint: { project: { id: '', name: '', created: false }, package: { name: '', version: '', checksum: '' }, sutras: [{ name: '', action: '', version: 0, deployed: true }], undeployed: [''], unchanged: false, warnings: [''] },
    execute: async c => {
      guard();
      const pkg = packageOf(c);
      const project = String(c.v('project') || '').trim() || undefined;
      const opsPath = String(c.v('opsFile') || '').trim();
      const ops = opsPath ? JSON.parse(fs.readFileSync(opsPath, 'utf8')) : undefined;
      const keepOthers = !!c.raw('keepOthers');
      const r = c.raw('target') === 'remote server'
        ? await remote(c, 'POST', '/api/packages/deploy', { package: pkg, project, ops, keepOthers })
        : deployPackage(pkg, { project, ops, keepOthers, by: `Sutra ${c.scope.sutra?.name ?? ''}`.trim() });
      c.log('info', `Deployed ${r.package.name} ${r.package.version} to ${r.project.name}${r.unchanged ? ' (nothing changed)' : ''}`);
      return { out: r };
    },
  },
  {
    type: 'releaseRollback', palette: 'release', name: 'Roll back', glyph: '↶', ports: ['out'],
    desc: 'Deploys the package that was current before the latest one (or a chosen earlier deployment) to a project, on this server or a remote engine.',
    fields: [...targetFields(), F('project', 'Project', 'text', '', { tpl: true, help: 'Empty = the project of this Sutra.' }), F('to', 'To deployment id', 'text', '', { tpl: true, help: 'Optional: from the history; empty = the previous package.' })],
    outputHint: { project: { name: '' }, package: { name: '', version: '' } },
    execute: async c => {
      guard();
      const proj = projectName(c);
      const to = String(c.v('to') || '').trim() || undefined;
      if (c.raw('target') === 'remote server') {
        const projects: any[] = await remote(c, 'GET', '/api/projects');
        const p = projects.find(x => x.name.toLowerCase() === proj.toLowerCase());
        if (!p) throw new Error(`No project named "${proj}" on ${c.raw('server')}`);
        return { out: await remote(c, 'POST', `/api/projects/${p.id}/rollback`, { to }) };
      }
      const p = listProjects().find(x => x.name.toLowerCase() === proj.toLowerCase());
      if (!p) throw new Error(`No project named "${proj}"`);
      return { out: rollbackPackage(p.id, { to, by: 'Sutra' }) };
    },
  },
];
