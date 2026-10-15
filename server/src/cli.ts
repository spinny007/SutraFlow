#!/usr/bin/env node
/**
 * sutra: release Sutras as project packages, from a shell or a CI pipeline.
 *
 * Remote (a running studio or headless engine): --server http://host:4800 --token <SUTRA_ADMIN_TOKEN>
 *   or the SUTRA_SERVER and SUTRA_ADMIN_TOKEN environment variables.
 * Local (no --server): works on the data folder directly (SUTRA_DATA_DIR), for building container
 *   images and for machines without a running server.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const HELP = `sutra <command> [options]

  package   --project <name> [--version 1.0.0] [--note text] [--sutras "A,B"] [--out file.sutra]
            Builds a package of a project: every deployed Sutra at its deployed version.
  check     <file.sutra> [--project <name>]
            Checks a package against a server: activities, secrets, addresses in use.
  deploy    <file.sutra> [--project <name>] [--config ops.json] [--keep-others]
            Deploys a package; Sutras of the project not in it are undeployed unless --keep-others.
  test      <file.sutra> [--skip "A,B"] [--secret NAME=value ...] [--secrets-from-env]
            Installs the package in a throw-away server and runs every Sutra with its test data.
  history   --project <name>              Deployments of packages to a project.
  rollback  --project <name> [--to <id>]  Deploys the package before the current one.
  secret    set <NAME> (--value <v> | --from-env <VAR>)
  status                                  Server health, readiness and engines.
  user      add <name> [--role administrator] [--project <name>] [--system] [--display "Name"] [--email e]
                [--password <p> | --password-from-env <VAR>] [--keep-password]
            Adds a person (or a system account) with a role for all projects or one project. People
            choose a new password at their first sign-in unless --keep-password. This is how a headless
            engine gets its first administrator.
  user      list                          People and system accounts with their roles.
  user      password <name> (--password <p> | --password-from-env <VAR>)
  user      disable | enable | unlock | sign-out | delete <name>

  Operating deployed Sutras (the same actions as the Admin Console; need --server):
  sutras    list [--project <name>]
  sutras    start | stop | restart <sutra> --project <name>
  sutras    deploy <sutra> --project <name> --version <n>
  sutras    tune <sutra> --project <name> [--max-runs n] [--priority n] [--run-timeout-min n]
                [--retries n] [--retry-delay-ms n] [--step-data all|errors-only|none] [--retention-days n]
  runs      list [--sutra <name> --project <name>] [--status failed] [--limit 50]
  runs      show | resubmit | cancel <run id>
  approvals list | approve <id> [--comment text] | reject <id> [--comment text]
  engines   list | drain <engine> | housekeeping
  engines   tune [--engine <id>] [--workers n] [--max-steps n] [--reply-timeout-ms n]
                [--retention-days n] [--audit-retention-days n] [--trace-sampling 0..1]
  token     create <system account> [--name text] [--expires-days n] | list <account> | revoke <account> <id>
  audit     [--actor name] [--outcome ok|failed|denied] [--from 2026-10-01] [--csv]

  Remote: --server <url> --token <token>  (or SUTRA_SERVER, SUTRA_ADMIN_TOKEN). The token is a system
          account's API token (limited to its roles) or the server's SUTRA_ADMIN_TOKEN.
  Exit code 0 = success, 1 = failure, 2 = wrong usage.`;

type Args = { _: string[]; [k: string]: string | boolean | string[] };
function parse(argv: string[]): Args {
  const a: Args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) {
      const [k, inline] = t.slice(2).split(/=(.*)/s);
      const v = inline !== undefined ? inline : argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      if (k === 'secret') a.secret = [...((a.secret as string[]) || []), String(v)];
      else a[k] = v;
    } else a._.push(t);
  }
  return a;
}

class Usage extends Error {}
const str = (a: Args, k: string) => (typeof a[k] === 'string' ? (a[k] as string) : undefined);
const need = (a: Args, k: string) => { const v = str(a, k); if (!v) throw new Usage(`--${k} is required`); return v; };
const out = (o: unknown) => process.stdout.write(typeof o === 'string' ? o + '\n' : JSON.stringify(o, null, 2) + '\n');

/** Remote calls to the admin API with the token. */
function remote(a: Args) {
  const server = (str(a, 'server') || process.env.SUTRA_SERVER || '').replace(/\/+$/, '');
  if (!server) return null;
  const token = str(a, 'token') || process.env.SUTRA_ADMIN_TOKEN || '';
  if (!token) throw new Usage('A token is required with --server (--token or SUTRA_ADMIN_TOKEN)');
  return async (method: string, p: string, body?: unknown) => {
    const r = await fetch(server + p, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let j: any; try { j = JSON.parse(text); } catch { j = text; }
    if (!r.ok) throw Object.assign(new Error(j?.error || `${r.status} ${r.statusText}`), { check: j?.check });
    return j;
  };
}

/** Local mode: the data folder, activities registered, no listeners. */
async function local() {
  const { openDb } = await import('./db.js');
  const { engine } = await import('./engine/engine.js');
  const { allActivities } = await import('./palettes/index.js');
  openDb();
  engine.register(allActivities);
  return {
    packages: await import('./packages.js'),
    projects: await import('./projects.js'),
    secrets: await import('./secrets.js'),
    access: await (async () => { const m = await import('./access.js'); m.ensureBuiltins(); return m; })(),
  };
}

const projectId = async (a: Args, call: ReturnType<typeof remote>) => {
  const name = need(a, 'project');
  const list: any[] = call ? await call('GET', '/api/projects') : (await local()).projects.listProjects();
  const p = list.find(x => x.name.toLowerCase() === name.toLowerCase());
  if (!p) throw new Error(`No project named "${name}"`);
  return p.id as string;
};

const readFile = (f: string | undefined) => { if (!f) throw new Usage('Give the package file'); if (!fs.existsSync(f)) throw new Error(`File not found: ${f}`); return fs.readFileSync(f, 'utf8'); };

function printCheck(c: any) {
  for (const e of c.errors || []) out(`  error    ${e}`);
  for (const w of c.warnings || []) out(`  warning  ${w}`);
  for (const s of c.secrets || []) out(`  secret   ${s.name}: ${s.present ? 'present' : 'MISSING'}`);
}

async function main(argv: string[]) {
  const a = parse(argv);
  const cmd = a._[0];
  if (!cmd || cmd === 'help' || a.help) { out(HELP); return 0; }
  const call = remote(a);

  switch (cmd) {
    case 'package': {
      const sutras = str(a, 'sutras');
      let pkg: any;
      if (call) {
        const id = await projectId(a, call);
        const qs = new URLSearchParams({ ...(str(a, 'version') ? { version: str(a, 'version')! } : {}), ...(str(a, 'note') ? { note: str(a, 'note')! } : {}), ...(sutras ? { sutras } : {}) });
        pkg = await call('GET', `/api/projects/${id}/package?${qs}`);
      } else {
        const l = await local();
        pkg = l.packages.buildPackage(await projectId(a, null), { version: str(a, 'version'), note: str(a, 'note'), sutras: sutras ? sutras.split(',').map(s => s.trim()).filter(Boolean) : undefined });
      }
      const file = str(a, 'out') || `${pkg.name.replace(/[^\w.-]+/g, '-')}-${pkg.version}.sutra`;
      fs.writeFileSync(file, JSON.stringify(pkg, null, 2));
      out(`Wrote ${file}: ${pkg.name} ${pkg.version}, ${pkg.sutras.length} Sutras, ${pkg.manifest.secrets.length} secrets needed, ${pkg.checksum}`);
      return 0;
    }
    case 'check': {
      const text = readFile(a._[1]);
      const c = call ? await call('POST', '/api/packages/check', { package: JSON.parse(text), project: str(a, 'project') })
        : (await local()).packages.checkPackage((await local()).packages.readPackage(text), { project: str(a, 'project') });
      out(c.ok ? 'Package can be deployed.' : 'Package cannot be deployed:');
      printCheck(c);
      return c.ok ? 0 : 1;
    }
    case 'deploy': {
      const text = readFile(a._[1]);
      const ops = str(a, 'config') ? JSON.parse(readFile(str(a, 'config'))) : undefined;
      let r: any;
      try {
        r = call ? await call('POST', '/api/packages/deploy', { package: JSON.parse(text), project: str(a, 'project'), ops, keepOthers: !!a['keep-others'] })
          : (await local()).packages.deployPackage(text, { project: str(a, 'project'), ops, keepOthers: !!a['keep-others'], by: `cli ${os.userInfo().username}` });
      } catch (e: any) { out(e.message); if (e.check) printCheck(e.check); return 1; }
      out(`Deployed ${r.package.name} ${r.package.version} to ${r.project.name}${r.project.created ? ' (new project)' : ''}${r.unchanged ? ': nothing changed' : ''}`);
      for (const s of r.sutras) out(`  ${s.action.padEnd(9)} ${s.name} v${s.version}${s.deployed ? '' : ' (not deployed)'}`);
      for (const n of r.undeployed) out(`  undeployed ${n}`);
      for (const w of r.warnings) out(`  warning  ${w}`);
      return 0;
    }
    case 'test': {
      const text = readFile(a._[1]);
      // A throw-away server: its own data folder and vault key, no gateway or listeners.
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-test-'));
      process.env.SUTRA_DATA_DIR = dir;
      process.env.SUTRA_MASTER_KEY = crypto.randomBytes(32).toString('base64');
      const { boot } = await import('./index.js');
      const srv = await boot({ listenAdmin: false, gateway: false });
      try {
        const { setSecret } = await import('./secrets.js');
        const { deployPackage, testPackage, readPackage } = await import('./packages.js');
        const pkg = readPackage(text);
        for (const s of (a.secret as string[]) || []) { const [k, ...v] = s.split('='); setSecret(k, v.join('=')); }
        if (a['secrets-from-env']) for (const n of pkg.manifest.secrets) if (process.env[n] !== undefined) setSecret(n, process.env[n]!);
        deployPackage(pkg, { skipCheck: true, by: 'sutra test' });
        const r = await testPackage(pkg, { skip: str(a, 'skip')?.split(',').map(s => s.trim()) });
        for (const t of r.results) out(`  ${t.status === 'done' ? 'pass' : t.skipped ? 'skip' : 'FAIL'}  ${t.name} (${t.ms} ms)${t.error ? `: ${t.error}` : ''}`);
        out(`${r.passed} passed, ${r.failed} failed, ${r.skipped} skipped`);
        return r.ok ? 0 : 1;
      } finally {
        await srv.stop();
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* files in use */ }
      }
    }
    case 'history': {
      const id = await projectId(a, call);
      const h: any[] = call ? await call('GET', `/api/projects/${id}/packages`) : (await local()).packages.packageHistory(id);
      if (!h.length) out('No packages deployed yet.');
      for (const d of h) out(`${d.deployed_at}  ${d.name} ${d.version}  ${d.checksum.slice(0, 19)}  by ${d.deployed_by}  id ${d.id}`);
      return 0;
    }
    case 'rollback': {
      const id = await projectId(a, call);
      const r = call ? await call('POST', `/api/projects/${id}/rollback`, { to: str(a, 'to') }) : (await local()).packages.rollbackPackage(id, { to: str(a, 'to'), by: 'cli' });
      out(`Rolled back to ${r.package.name} ${r.package.version}`);
      return 0;
    }
    case 'secret': {
      if (a._[1] !== 'set' || !a._[2]) throw new Usage('Use: sutra secret set <NAME> --value <v> | --from-env <VAR>');
      const name = a._[2];
      const value = str(a, 'value') ?? (str(a, 'from-env') ? process.env[str(a, 'from-env')!] : undefined);
      if (value === undefined) throw new Usage('Give --value or --from-env (the variable must be set)');
      if (call) await call('PUT', `/api/secrets/${encodeURIComponent(name)}`, { value });
      else (await local()).secrets.setSecret(name, value);
      out(`Secret ${name} saved`);
      return 0;
    }
    case 'user': {
      const sub = a._[1], name = a._[2];
      const password = str(a, 'password') ?? (str(a, 'password-from-env') ? process.env[str(a, 'password-from-env')!] : undefined);
      if (sub === 'list') {
        const users: any[] = call ? await call('GET', '/api/access/users') : (await local()).access.listUsers();
        for (const u of users) out(`  ${u.kind === 'system' ? 'system' : 'person'}  ${u.username}${u.disabled ? ' (disabled)' : ''}  ${u.grants.map((g: any) => `${g.role}${g.project ? ' on ' + g.project : ''}`).join(', ') || 'no roles'}`);
        return 0;
      }
      if (name && ['disable', 'enable', 'unlock', 'sign-out', 'delete'].includes(sub)) {
        if (!call) throw new Usage(`user ${sub} needs --server and --token`);
        const u = `/api/access/users/${encodeURIComponent(name)}`;
        if (sub === 'disable' || sub === 'enable') await call('PUT', u, { disabled: sub === 'disable' });
        else if (sub === 'delete') await call('DELETE', u);
        else await call('POST', `${u}/${sub}`);
        const done: Record<string, string> = { disable: 'disabled', enable: 'enabled', unlock: 'unlocked', 'sign-out': 'signed out everywhere', delete: 'deleted' };
        out(`${name}: ${done[sub]}`);
        return 0;
      }
      if (!name || (sub !== 'add' && sub !== 'password')) throw new Usage('Use: sutra user add <name> ... | sutra user list | sutra user password <name> ... | sutra user disable <name>');
      if (sub === 'password') {
        if (!password) throw new Usage('Give --password or --password-from-env');
        if (call) await call('POST', `/api/access/users/${encodeURIComponent(name)}/password`, { password, mustChange: !a['keep-password'] });
        else (await local()).access.resetPassword(name, password, !a['keep-password']);
        out(`Password of ${name} set`);
        return 0;
      }
      const system = !!a.system;
      if (!system && !password) throw new Usage('A person needs --password or --password-from-env');
      const project = str(a, 'project') ? await projectId(a, call) : '';
      const body = { username: name, kind: system ? 'system' : 'user', displayName: str(a, 'display') || '', email: str(a, 'email') || '', password, mustChange: !a['keep-password'], grants: [{ role: str(a, 'role') || (system ? 'apiCaller' : 'viewer'), project }] };
      if (call) await call('POST', '/api/access/users', body);
      else (await local()).access.createAccount(body as any);
      out(`${system ? 'System account' : 'User'} ${name} added with role ${body.grants[0].role}${project ? ' on ' + str(a, 'project') : ' on all projects'}`);
      return 0;
    }
    case 'sutras': case 'runs': case 'approvals': case 'engines': case 'token': case 'audit':
      if (!call) throw new Usage(`${cmd} needs --server and --token`);
      return operate(cmd, a, call);
    case 'status': {
      if (!call) throw new Usage('status needs --server');
      const server = (str(a, 'server') || process.env.SUTRA_SERVER || '').replace(/\/+$/, '');
      const ready = await fetch(`${server}/ready`).then(async r => ({ status: r.status, body: await r.json() }));
      const engines = await call('GET', '/api/engine/status').catch((e: any) => ({ error: e.message }));
      out({ ready: ready.status === 200, reasons: ready.body.reasons, engines });
      return ready.status === 200 ? 0 : 1;
    }
  }
  throw new Usage(`Unknown command ${cmd}`);
}

type Call = NonNullable<ReturnType<typeof remote>>;

/** A deployed Sutra by project and name, through the Admin Console API. */
async function findSutra(call: Call, a: Args, name: string | undefined) {
  if (!name) throw new Usage('Give the Sutra name');
  const project = need(a, 'project');
  const apps: any[] = await call('GET', '/api/console/apps');
  const p = apps.find(x => x.name.toLowerCase() === project.toLowerCase());
  if (!p) throw new Error(`No deployed project named "${project}"`);
  const s = p.sutras.find((x: any) => x.name.toLowerCase() === name.toLowerCase());
  if (!s) throw new Error(`No deployed Sutra named "${name}" in ${p.name}`);
  return { project: p, sutra: s };
}

const num = (a: Args, k: string) => (str(a, k) !== undefined ? Number(str(a, k)) : undefined);
const table = (rows: string[][]) => {
  const w = rows[0].map((_c, i) => Math.max(...rows.map(r => (r[i] || '').length)));
  for (const r of rows) out('  ' + r.map((c, i) => (c || '').padEnd(w[i])).join('  ').trimEnd());
};

/** Commands for what is deployed: the Admin Console's actions from a shell. */
async function operate(cmd: string, a: Args, call: Call): Promise<number> {
  const sub = a._[1], arg = a._[2];
  switch (`${cmd} ${sub}`) {
    case 'sutras list': {
      const apps: any[] = await call('GET', '/api/console/apps');
      const rows = [['PROJECT', 'SUTRA', 'VERSION', 'STATE', 'RUNS 24H', 'FAILED']];
      for (const p of apps) if (!str(a, 'project') || p.name.toLowerCase() === str(a, 'project')!.toLowerCase())
        for (const s of p.sutras) rows.push([p.name, s.name, String(s.version), s.enabled ? 'started' : 'stopped', String(s.runs24h.done + s.runs24h.failed), String(s.runs24h.failed)]);
      table(rows);
      return 0;
    }
    case 'sutras start': case 'sutras stop': case 'sutras restart': {
      const { sutra } = await findSutra(call, a, arg);
      if (sub === 'restart') await call('POST', `/api/console/sutras/${sutra.id}/restart`);
      else await call('PUT', `/api/console/sutras/${sutra.id}/enabled`, { enabled: sub === 'start' });
      out(`${sutra.name}: ${sub === 'restart' ? 'restarted' : sub === 'start' ? 'started' : 'stopped'}`);
      return 0;
    }
    case 'sutras deploy': {
      const { sutra } = await findSutra(call, a, arg);
      const r = await call('POST', `/api/flows/${sutra.id}/deploy`, { version: Number(need(a, 'version')) });
      out(`${sutra.name}: version ${r.version} deployed`);
      return 0;
    }
    case 'sutras tune': {
      const { sutra } = await findSutra(call, a, arg);
      const values: Record<string, unknown> = { ...sutra.tuning };
      const map: Record<string, string> = { 'max-runs': 'maxRuns', priority: 'priority', 'run-timeout-min': 'runTimeoutMin', retries: 'retries', 'retry-delay-ms': 'retryDelayMs', 'retention-days': 'retentionDays' };
      for (const [flag, k] of Object.entries(map)) if (str(a, flag) !== undefined) values[k] = num(a, flag);
      if (str(a, 'step-data')) values.stepData = str(a, 'step-data')!.replace('errors-only', 'errors only');
      const r = await call('PUT', `/api/console/sutras/${sutra.id}/tuning`, { values });
      out(`${sutra.name} tuning: ${JSON.stringify(r.values)}`);
      return 0;
    }
    case 'runs list': {
      let qs = `limit=${num(a, 'limit') || 50}`;
      if (str(a, 'sutra')) qs += `&flowId=${(await findSutra(call, a, str(a, 'sutra'))).sutra.id}`;
      if (str(a, 'status')) qs += `&status=${encodeURIComponent(str(a, 'status')!)}`;
      const runs: any[] = await call('GET', `/api/runs?${qs}`);
      table([['RUN', 'SUTRA', 'STATUS', 'STARTED', 'BY', 'ERROR'], ...runs.map(r => [r.id, r.flowName, r.status, r.startedAt, r.source, String(r.error || '').slice(0, 60)])]);
      return 0;
    }
    case 'runs show': { if (!arg) throw new Usage('Give the run id'); const r = await call('GET', `/api/runs/${arg}`); out({ id: r.id, sutra: r.flowName, status: r.status, error: r.error, steps: r.tasks.map((t: any) => ({ step: r.doc.nodes.find((n: any) => n.id === t.node_id)?.name, status: t.status, ms: t.ms, error: t.error || undefined })) }); return 0; }
    case 'runs resubmit': { if (!arg) throw new Usage('Give the run id'); const r = await call('POST', `/api/runs/${arg}/resubmit`); out(`Run ${r.runId} runs again from its ${r.resubmitted} failed step(s)`); return 0; }
    case 'runs cancel': { if (!arg) throw new Usage('Give the run id'); const r = await call('POST', `/api/runs/${arg}/cancel`); out(r.ok ? 'Run cancelled' : 'The run was not open'); return r.ok ? 0 : 1; }
    case 'approvals list': {
      const list: any[] = await call('GET', '/api/approvals');
      table([['ID', 'SUTRA', 'STEP', 'MESSAGE'], ...list.filter(x => x.wait?.kind === 'approval').map(x => [String(x.id), x.flowName, x.step || '', String(x.wait?.message || '').slice(0, 70)])]);
      return 0;
    }
    case 'approvals approve': case 'approvals reject': {
      if (!arg) throw new Usage('Give the approval id');
      await call('POST', `/api/approvals/${arg}`, { approved: sub === 'approve', comment: str(a, 'comment') || '' });
      out(sub === 'approve' ? 'Approved' : 'Rejected');
      return 0;
    }
    case 'engines list': {
      const st = await call('GET', '/api/engine/status');
      table([['ENGINE', 'STATE', 'LEADER', 'STEPS', 'HOST', 'VERSION'], ...st.engines.map((e: any) => [e.id, !e.alive ? 'silent' : e.draining ? 'draining' : 'alive', e.leader ? 'yes' : '', `${e.running}/${e.workers}`, e.host, e.version])]);
      return 0;
    }
    case 'engines drain': { if (!arg) throw new Usage('Give the engine name'); await call('POST', `/api/console/engines/${encodeURIComponent(arg)}/drain`); out(`${arg} drains and stops on its next heartbeat`); return 0; }
    case 'engines housekeeping': { const r = await call('POST', '/api/engine/housekeeping', {}); out(`${r.deletedRuns} runs and ${r.deletedAudit ?? 0} audit entries deleted`); return 0; }
    case 'engines tune': {
      const cur = await call('GET', '/api/console/tuning');
      const engineId = str(a, 'engine');
      const values: Record<string, unknown> = { ...(engineId ? cur.perEngine[engineId] || {} : cur.cluster) };
      const map: Record<string, string> = { workers: 'workers', 'max-steps': 'maxStepsPerRun', 'reply-timeout-ms': 'replyTimeoutMs', 'retention-days': 'runRetentionDays', 'audit-retention-days': 'auditRetentionDays', 'trace-sampling': 'traceSampling' };
      for (const [flag, k] of Object.entries(map)) if (str(a, flag) !== undefined) values[k] = num(a, flag);
      const r = await call('PUT', engineId ? `/api/console/tuning/engines/${encodeURIComponent(engineId)}` : '/api/console/tuning/engine', { values });
      out(`${engineId || 'All engines'}: ${JSON.stringify(engineId ? r.perEngine[engineId] || {} : r.cluster)}`);
      return 0;
    }
    case 'token create': {
      if (!arg) throw new Usage('Give the system account');
      const r = await call('POST', `/api/access/users/${encodeURIComponent(arg)}/tokens`, { name: str(a, 'name') || 'token', expiresDays: num(a, 'expires-days') || 0 });
      out(r.token);
      process.stderr.write(`Token for ${arg}${r.expiresAt ? `, expires ${r.expiresAt}` : ', never expires'}. It is not shown again.\n`);
      return 0;
    }
    case 'token list': { if (!arg) throw new Usage('Give the system account'); const l: any[] = await call('GET', `/api/access/users/${encodeURIComponent(arg)}/tokens`); table([['ID', 'NAME', 'EXPIRES', 'LAST USED'], ...l.map(t => [t.id, t.name, t.expiresAt || 'never', t.lastUsed || 'never'])]); return 0; }
    case 'token revoke': { const id = a._[3]; if (!arg || !id) throw new Usage('Use: sutra token revoke <account> <id>'); await call('DELETE', `/api/access/users/${encodeURIComponent(arg)}/tokens/${id}`); out('Token revoked'); return 0; }
  }
  if (cmd === 'audit') {
    const p = new URLSearchParams();
    for (const k of ['actor', 'outcome', 'from', 'to']) if (str(a, k)) p.set(k, str(a, k)!);
    if (a.csv) { const r = await fetchText(a, `/api/audit/export?${p}`); out(r.trimEnd()); return 0; }
    const rows: any[] = await call('GET', `/api/audit?${p}`);
    table([['WHEN', 'WHO', 'ACTION', 'TARGET', 'RESULT'], ...rows.map(r => [r.at, r.actor, r.action, r.target, r.outcome])]);
    return 0;
  }
  throw new Usage(`Unknown command: ${cmd} ${sub || ''}`.trim());
}

/** Plain-text answers (CSV) from the admin API. */
async function fetchText(a: Args, p: string) {
  const server = (str(a, 'server') || process.env.SUTRA_SERVER || '').replace(/\/+$/, '');
  const token = str(a, 'token') || process.env.SUTRA_ADMIN_TOKEN || '';
  const r = await fetch(server + p, { headers: { authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.text();
}

main(process.argv.slice(2)).then(code => process.exit(code), e => {
  process.stderr.write(`${e instanceof Usage ? 'Usage: ' : 'Error: '}${e.message}\n`);
  process.exit(e instanceof Usage ? 2 : 1);
});
