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

  Releases:
  package   --project <name> [--version 1.0.0] [--note text] [--sutras "A,B"] [--zip] [--out file]
            Builds a package of a project: every deployed Sutra at its deployed version. With --zip or
            an --out ending in .zip, a release zip: the package, a deployment config to fill in for
            the target (connections, project variables, secrets needed) and a README.
  package   --from-git <repository address | folder> [--ref <tag|branch|commit>] [--version 1.0.0]
                [--note text] [--sutras "A,B"] [--out release.zip]
            Builds a release zip from the project's files in Git, with no server or database, for
            CI/CD pipelines. Every Sutra in the repository (or the chosen ones) is deployed by it.
            A private repository reads its token from SUTRA_GIT_TOKEN (login SUTRA_GIT_LOGIN).
  check     <release.zip | file.sutra> [--project <name>]
            Checks a package against a server: activities, secrets, addresses in use.
  deploy    <release.zip | file.sutra> [--project <name>] [--config deployment-config.json] [--keep-others]
            Deploys a package with its deployment config (the zip's own, or --config); Sutras of the
            project not in it are undeployed unless --keep-others.
  test      <release.zip | file.sutra> [--skip "A,B"] [--secret NAME=value ...] [--secrets-from-env]
            Installs the package in a throw-away server and runs every Sutra with its test data.
  history   --project <name>
            Deployments of packages to a project.
  doc       (--project <name> [--sutra <name>] | <release.zip | file.sutra>) [--format html|md] [--out file]
            Documentation made from the Sutras and their step descriptions: what starts each Sutra,
            its steps in order with their settings, connections and variables.
  rollback  --project <name> [--to <id>]
            Deploys the package before the current one, or the deployment with that id.

  Server, data and people:
  status
            Server health, readiness and engines.
  connect   <connection> --project <name> [--wait-minutes 10]
            Signs in an OAuth connection (Google, YouTube, Twitch, ...) on a server without the studio:
            prints the sign-in address, and waits until the account is connected. The server's
            /api/oauth/callback address must be a redirect address of the OAuth app. Needs --server.
  python    [--set <path to python> | --clear]
            Which Python runs Python steps on the server; --set chooses an interpreter.
  secret    set <NAME> (--value <v> | --from-env <VAR>)
            Saves a secret in the vault (encrypted); Sutras and connections use it by name.
  db        copy --to <postgres://user:pass@host/db | file.db> [--replace]
            Copies this server's data (SUTRA_DATA_DIR or SUTRA_DB) to another database, for example
            from SQLite to PostgreSQL. A missing PostgreSQL database is created. Stop the server first;
            then start it with SUTRA_DB set to the new address and the same master key.
  db        info
            Which database the server uses, and its row counts.
  db        migrate [--url <postgres://...>] [--replace] [--write-env <sutraflow.env>]
            Copies this server's SQLite data to the PostgreSQL connection saved on the Admin Console's
            Database page (or --url), checks every table arrived, and with --write-env points that
            settings file at PostgreSQL (old file kept). Stop the server first; the script
            tools/migrate-to-postgres does the whole move, stop and start included.
  user      add <name> [--role administrator] [--project <name>] [--system] [--display "Name"] [--email e]
                [--password <p> | --password-from-env <VAR>] [--keep-password]
            Adds a person (or a system account) with a role for all projects or one project. People
            choose a new password at their first sign-in unless --keep-password. This is how a headless
            engine gets its first administrator.
  user      list
            People and system accounts with their roles.
  user      password <name> (--password <p> | --password-from-env <VAR>)
            Sets a new password; the person chooses their own at the next sign-in.
  user      disable | enable | unlock | sign-out | delete <name>
            Blocks or allows sign-in, clears a lock after wrong passwords, ends all sessions, or deletes.

  Operating deployed Sutras (the same actions as the Admin Console; need --server):
  sutras    list [--project <name>]
            Deployed Sutras with their state and runs of the last 24 hours.
  sutras    start | stop | restart <sutra> --project <name>
            Starts or stops a deployed Sutra's triggers; restart does both.
  sutras    deploy <sutra> --project <name> --version <n>
            Deploys a published version of a Sutra (an earlier one to go back).
  sutras    tune <sutra> --project <name> [--max-runs n] [--priority n] [--run-timeout-min n]
                [--retries n] [--retry-delay-ms n] [--step-data all|errors-only|none] [--retention-days n]
            Tuning of one Sutra: runs at a time, priority, time limit, retries, what runs keep and how long.
  runs      list [--sutra <name> --project <name>] [--status failed] [--limit 50]
            Recent runs, newest first.
  runs      show | resubmit | cancel <run id>
            One run step by step; runs it again from its failed steps; or cancels it.
  approvals list | approve <id> [--comment text] | reject <id> [--comment text]
            Steps waiting for a person, and the decision on one.
  engines   list | drain <engine> | housekeeping
            Engines of the cluster; stops one gracefully; deletes runs and audit entries past retention.
  engines   tune [--engine <id>] [--workers n] [--max-steps n] [--reply-timeout-ms n]
                [--retention-days n] [--audit-retention-days n] [--trace-sampling 0..1]
            Engine tuning, for every engine or one: workers, limits, retention, trace sampling.
  token     create <system account> [--name text] [--expires-days n] | list <account> | revoke <account> <id>
            API tokens of a system account, for scripts and pipelines.
  audit     [--actor name] [--outcome ok|failed|denied] [--from 2026-10-01] [--csv]
            Who did what, when, and with what outcome.
  audit     retention [<days>]
            How long audit entries are kept; with a number, sets it (0 = keep everything).
  audit     clear --before 2026-10-01 | --older | --all
            Clears audit entries before a date, older than the retention, or all; the clearing is recorded.

  Alerts (need --server):
  alerts    [list | history] | ack <id> | resolve <id> | check | rules | channels | test <channel>
            Open and past alerts, acknowledging and resolving them, checking now, the rules and channels,
            and a test message to a channel.

  Gateway (apps, keys, plans, firewall, traffic; need --server):
  gateway   apps | plans | stats [--period 1h|24h|7d|30d] | log [--status errors|refused|ok] [--limit n]
            Apps, plans, traffic statistics and the request log.
  gateway   app add <name> [--scopes "orders:read orders:write"] [--plan <name>] [--contact text]
            Adds an app that calls your APIs, with its scopes and plan.
  gateway   app disable | enable | delete <name>
            Blocks, allows or deletes an app.
  gateway   key create <app> [--name text] [--expires-days n] | key revoke <app> <key id>
            Makes an API key for an app (shown once) or revokes one.
  gateway   plan set <name> [--per-minute n] [--per-hour n] [--per-day n] [--per-month n] | plan delete <name>
            Request limits of a plan.
  gateway   firewall [--allow "10.0.0.0/8,192.168.1.5"] [--deny "203.0.113.9"]
            Addresses allowed and refused; with no options, shows them.
  gateway   openapi
            OpenAPI of the deployed services (JSON).

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
      const v = inline !== undefined ? inline : argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : true;
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

/** A release zip or a package file: the package and the zip's deployment config. */
const readRelease = async (f: string | undefined) => {
  if (!f) throw new Usage('Give the release zip or package file');
  if (!fs.existsSync(f)) throw new Error(`File not found: ${f}`);
  return (await import('./bundles.js')).readBundle(fs.readFileSync(f));
};
const readFile = (f: string | undefined) => { if (!f) throw new Usage('Give the package file'); if (!fs.existsSync(f)) throw new Error(`File not found: ${f}`); return fs.readFileSync(f, 'utf8'); };

function printCheck(c: any) {
  for (const e of c.errors || []) out(`  error    ${e}`);
  for (const w of c.warnings || []) out(`  warning  ${w}`);
  for (const s of c.secrets || []) out(`  secret   ${s.name}: ${s.present ? 'present' : 'MISSING'}`);
}

/**
 * sutra db migrate: SQLite to the saved (or given) PostgreSQL, every table counted on both sides, and
 * sutraflow.env switched with the password apart (SUTRA_DB_PASSWORD). Prints RESULT {json} last.
 */
async function dbMigrate(a: Args) {
  const { openDb, copyDatabase, dbKind, q, closeDb } = await import('./db.js');
  openDb();
  if (dbKind() !== 'sqlite') throw new Error('This data folder already uses PostgreSQL (SUTRA_DB is set)');
  const m = await import('./dbmigrate.js');
  let url = str(a, 'url') || '';
  let shown = url.replace(/\/\/([^:@/]+):[^@/]*@/, '//$1:***@');
  let user = '', password = '';
  if (!url) {
    const t = m.getTarget();
    if (!t) throw new Error('No PostgreSQL connection saved: save one on the Admin Console\'s Database page, or give --url');
    password = m.passwordOf();
    url = m.targetUrl(t, password);
    shown = m.targetUrl(t);
    user = t.user;
  } else {
    const u = new URL(url);
    user = decodeURIComponent(u.username); password = decodeURIComponent(u.password);
  }
  out(`From SQLite ${path.join((await import('./config.js')).config.dataDir, 'sutra.db')} to ${shown}`);
  await ensurePgDatabase(url);
  const r = copyDatabase(url, { replace: !!a.replace, log: msg => out(`  ${msg}`) });
  // Every table: the same number of rows on both sides.
  const { default: pg } = await import('pg');
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  const wrong: string[] = [];
  try {
    for (const t of r.tables) {
      const src = Number(q.get<any>(`select count(*) as n from ${t.table}`)?.n ?? 0);
      const dst = Number((await c.query(`select count(*) as n from ${t.table}`)).rows[0]?.n ?? 0);
      if (src !== dst) wrong.push(`${t.table}: ${src} in SQLite, ${dst} in PostgreSQL`);
    }
  } finally { await c.end(); }
  if (wrong.length) throw new Error(`Row counts differ after the copy:\n  ${wrong.join('\n  ')}`);
  out(`Checked ${r.tables.length} tables: the row counts match`);
  closeDb();
  let backup = '';
  const envFile = str(a, 'write-env');
  if (envFile) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    backup = `${envFile}.sqlite-${stamp}`;
    const text = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
    fs.writeFileSync(backup, text);
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const noPw = (() => { const u = new URL(url); u.password = ''; return u.toString(); })();
    // The settings reader trims values and takes off one pair of quotes: quote values that need it.
    const envValue = (v: string) => (/^\s|\s$|^["']|["']$/.test(v) ? `"${v}"` : v);
    const set: Record<string, string> = { SUTRA_DB: noPw, ...(password ? { SUTRA_DB_PASSWORD: envValue(password) } : {}) };
    const lines = text.split(/\r?\n/).filter((l, i, all) => !(i === all.length - 1 && l === ''));
    const done = new Set<string>();
    const outLines = lines.map(l => {
      const k = /^\s*#?\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(l)?.[1];
      if (k && k in set && !done.has(k)) { done.add(k); return `${k}=${set[k]}`; }
      return l;
    });
    for (const [k, v] of Object.entries(set)) if (!done.has(k)) outLines.push(`${k}=${v}`);
    if (!password) outLines.push('# SUTRA_DB_PASSWORD is not set: PostgreSQL signs in without a password (trust or peer)');
    fs.writeFileSync(envFile, outLines.join(eol) + eol);
    if (process.platform !== 'win32') { try { fs.chmodSync(envFile, 0o600); } catch { /* not the owner */ } }
    out(`${envFile} now uses PostgreSQL${user ? ` as ${user}` : ''}; the previous file is ${backup}`);
  }
  out(`RESULT ${JSON.stringify({ rows: r.rows, tables: r.tables.length, url: shown, backup })}`);
  return 0;
}

/** Creates the PostgreSQL database of an address when it does not exist yet. */
async function ensurePgDatabase(url: string) {
  const { default: pg } = await import('pg');
  const u = new URL(url);
  const name = decodeURIComponent(u.pathname.replace(/^\//, '')) || 'postgres';
  const c = new pg.Client({ connectionString: url });
  try { await c.connect(); await c.end(); return; } catch (e: any) {
    if (e.code !== '3D000') throw new Error(`PostgreSQL at ${u.host}: ${e.message}`);
  }
  if (!/^[A-Za-z_][\w-]{0,62}$/.test(name)) throw new Error(`"${name}" is not a database name SutraFlow will create; create it yourself`);
  u.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: u.toString() });
  await admin.connect();
  try { await admin.query(`CREATE DATABASE "${name}"`); out(`Created the database ${name}`); } finally { await admin.end(); }
}

/**
 * A package from a project's Git files, in a throw-away data folder: a repository address is cloned
 * (token from SUTRA_GIT_TOKEN), a folder is read as it is, or at --ref through a local clone.
 */
async function packageFromGit(src: string, o: { ref?: string; version?: string; note?: string; sutras?: string[] }) {
  const isUrl = /^(https?|ssh|git|file):\/\/|^[\w.-]+@[\w.-]+:/.test(src);
  if (!isUrl && !fs.existsSync(src)) throw new Error(`No folder or repository address: ${src}`);
  // The settings are read when the server modules load, so the throw-away data folder comes first.
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-build-')), data = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-build-data-'));
  process.env.SUTRA_DATA_DIR = data;
  delete process.env.SUTRA_DB;
  process.env.SUTRA_MASTER_KEY = crypto.randomBytes(32).toString('base64');
  const b = await import('./bundles.js');
  const { gitEngine } = await import('./git/engine.js');
  const g = gitEngine();
  try {
    let dir = src, commit: string | undefined;
    if (isUrl || o.ref) {
      const token = process.env.SUTRA_GIT_TOKEN;
      dir = path.join(work, 'repo');
      await g.clone(isUrl ? src : path.resolve(src), dir, undefined, token ? { login: process.env.SUTRA_GIT_LOGIN || 'git', token } : undefined);
      if (o.ref) await g.checkout(dir, o.ref);
    }
    try { commit = await g.head(dir); } catch { /* a folder that is not a repository */ }
    const { openDb, closeDb } = await import('./db.js');
    const { engine } = await import('./engine/engine.js');
    const { allActivities } = await import('./palettes/index.js');
    openDb();
    engine.register(allActivities);
    try {
      const { saveProject } = await import('./projects.js');
      const { readWorkingTree } = await import('./git/files.js');
      return b.packageFromFolder(dir, { version: o.version, note: o.note, sutras: o.sutras, source: { repository: isUrl ? b.cleanUrl(src) : undefined, ref: o.ref, commit } }, { saveProject, readWorkingTree });
    } finally { closeDb(); }
  } finally {
    for (const d of [work, data]) try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* files in use */ }
  }
}

async function main(argv: string[]) {
  const a = parse(argv);
  const cmd = a._[0];
  if (!cmd || cmd === 'help' || a.help) { out(HELP); return 0; }
  const call = remote(a);

  switch (cmd) {
    case 'package': {
      const sutras = str(a, 'sutras');
      const pick = sutras ? sutras.split(',').map(s => s.trim()).filter(Boolean) : undefined;
      const fromGit = a['from-git'] !== undefined;
      let pkg: any;
      if (fromGit) {
        pkg = await packageFromGit(need(a, 'from-git'), { ref: str(a, 'ref'), version: str(a, 'version'), note: str(a, 'note'), sutras: pick });
      } else if (call) {
        const id = await projectId(a, call);
        const qs = new URLSearchParams({ ...(str(a, 'version') ? { version: str(a, 'version')! } : {}), ...(str(a, 'note') ? { note: str(a, 'note')! } : {}), ...(sutras ? { sutras } : {}) });
        pkg = await call('GET', `/api/projects/${id}/package?${qs}`);
      } else {
        const l = await local();
        pkg = l.packages.buildPackage(await projectId(a, null), { version: str(a, 'version'), note: str(a, 'note'), sutras: pick });
      }
      const b = await import('./bundles.js');
      // The zip's documentation names each step's activity and settings.
      (await import('./engine/engine.js')).engine.register((await import('./palettes/index.js')).allActivities);
      const o = str(a, 'out') || '';
      const zip = !!a.zip || /\.zip$/i.test(o) || (fromGit && !/\.sutra$/i.test(o));
      const file = o || `${pkg.name.replace(/[^\w.-]+/g, '-')}-${pkg.version}${zip ? '.zip' : '.sutra'}`;
      fs.writeFileSync(file, zip ? b.buildBundle(pkg) : JSON.stringify(pkg, null, 2));
      out(`Wrote ${file}: ${pkg.name} ${pkg.version}, ${pkg.sutras.length} Sutras, ${pkg.manifest.secrets.length} secrets needed, ${pkg.checksum}`);
      if (pkg.source?.commit) out(`  from ${pkg.source.repository || 'Git'}${pkg.source.ref ? ` ${pkg.source.ref}` : ''}, commit ${pkg.source.commit.slice(0, 12)}`);
      return 0;
    }
    case 'check': {
      const rel = await readRelease(a._[1]);
      const c = call ? await call('POST', '/api/packages/check', { package: rel.package, project: str(a, 'project') })
        : (await local()).packages.checkPackage(rel.package, { project: str(a, 'project') });
      out(c.ok ? 'Package can be deployed.' : 'Package cannot be deployed:');
      printCheck(c);
      return c.ok ? 0 : 1;
    }
    case 'deploy': {
      const rel = await readRelease(a._[1]);
      const { configFor } = await import('./bundles.js');
      const ops = configFor(rel.package, str(a, 'config') ? JSON.parse(readFile(str(a, 'config'))) : rel.config, str(a, 'project'));
      let r: any;
      try {
        // A zip goes as it is, so its files reach the server too.
        const isZipFile = rel.files.length > 0;
        r = call ? await call('POST', '/api/packages/deploy', isZipFile ? { zip: fs.readFileSync(a._[1]).toString('base64'), project: str(a, 'project') || rel.package.project.name, ops, keepOthers: !!a['keep-others'] } : { package: rel.package, project: str(a, 'project'), ops, keepOthers: !!a['keep-others'] })
          : (await local()).packages.deployPackage(rel.package, { project: str(a, 'project'), ops, keepOthers: !!a['keep-others'], by: `cli ${os.userInfo().username}`, files: rel.files });
      } catch (e: any) { out(e.message); if (e.check) printCheck(e.check); return 1; }
      out(`Deployed ${r.package.name} ${r.package.version} to ${r.project.name}${r.project.created ? ' (new project)' : ''}${r.unchanged ? ': nothing changed' : ''}`);
      for (const s of r.sutras) out(`  ${s.action.padEnd(9)} ${s.name} v${s.version}${s.deployed ? '' : ' (not deployed)'}`);
      for (const n of r.undeployed) out(`  undeployed ${n}`);
      for (const w of r.warnings) out(`  warning  ${w}`);
      if (r.files) out(`  files    ${r.files} written to the project's files folder`);
      return 0;
    }
    case 'test': {
      const f = a._[1];
      if (!f) throw new Usage('Give the release zip or package file');
      if (!fs.existsSync(f)) throw new Error(`File not found: ${f}`);
      // A throw-away server: its own data folder and vault key, no gateway or listeners. Set before
      // any server module loads, as they read the settings when loaded.
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-test-'));
      process.env.SUTRA_DATA_DIR = dir;
      process.env.SUTRA_MASTER_KEY = crypto.randomBytes(32).toString('base64');
      const text = JSON.stringify((await readRelease(f)).package);
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
    case 'doc': {
      const format = str(a, 'format') === 'md' || /\.md$/i.test(str(a, 'out') || '') ? 'md' : 'html';
      let text: string, name: string;
      if (a._[1]) {
        const rel = await readRelease(a._[1]);
        const { engine } = await import('./engine/engine.js');
        const { allActivities } = await import('./palettes/index.js');
        engine.register(allActivities);
        const { packageDocumentation } = await import('./docs.js');
        const d = packageDocumentation(rel.package, rel.package.createdWith);
        text = format === 'md' ? d.markdown : d.html; name = `${rel.package.name}-${rel.package.version}`;
      } else if (call) {
        const id = await projectId(a, call);
        const sutra = str(a, 'sutra');
        let url = `/api/projects/${id}/documentation?format=${format}`;
        if (sutra) {
          const f = (await call('GET', `/api/flows?projectId=${id}`) as any[]).find(x => x.name.toLowerCase() === sutra.toLowerCase());
          if (!f) throw new Error(`No Sutra named "${sutra}"`);
          url = `/api/flows/${f.id}/documentation?format=${format}`;
        }
        text = String(await call('GET', url)); name = sutra || need(a, 'project');
      } else {
        await local();
        const { listFlows, getFlow } = await import('./flows.js');
        const { getProject } = await import('./projects.js');
        const { listResources } = await import('./resources.js');
        const { sutraDocumentation, projectDocumentation } = await import('./docs.js');
        const { version } = await import('./config.js');
        const id = await projectId(a, null);
        const p = getProject(id)!;
        const resources = listResources(undefined, id).map(r => ({ id: r.id, name: r.name, kind: r.kind }));
        const list = listFlows(id).map(f => ({ id: f.id, doc: getFlow(f.id)!.doc, version: f.deployed?.version, deployed: !!f.deployed, folder: f.folder }));
        const sutra = str(a, 'sutra');
        let d;
        if (sutra) {
          const s = list.find(x => x.doc.name.toLowerCase() === sutra.toLowerCase());
          if (!s) throw new Error(`No Sutra named "${sutra}"`);
          d = sutraDocumentation(s, { resources, sutras: list.map(x => ({ id: x.id, name: x.doc.name })), made: version });
        } else d = projectDocumentation({ name: p.name, description: p.description, variables: p.config.variables }, list, { resources, made: version });
        text = format === 'md' ? d.markdown : d.html; name = sutra || p.name;
      }
      const file = str(a, 'out') || `${name.replace(/[^\w.-]+/g, '-')}.${format === 'md' ? 'md' : 'html'}`;
      fs.writeFileSync(file, text);
      out(`Wrote ${file}`);
      return 0;
    }
    case 'connect': {
      if (!call) throw new Usage('connect needs --server (the server whose account is being connected)');
      const name = a._[1];
      if (!name) throw new Usage('Give the connection name');
      const pid = await projectId(a, call);
      const r = (await call('GET', `/api/resources?projectId=${pid}&kind=oauthApp`) as any[]).find(x => x.name.toLowerCase() === name.toLowerCase());
      if (!r) throw new Error(`No OAuth connection named "${name}" in the project`);
      const st0 = await call('GET', `/api/oauth/${r.id}`);
      const start = await call('GET', `/api/oauth/${r.id}/start`);
      out(`Open this address in a browser and sign in to the account for ${r.name}:\n\n  ${start.url}\n`);
      out(`The OAuth app must allow the redirect address ${st0.redirectUri}`);
      const until = Date.now() + Math.max(1, Number(str(a, 'wait-minutes')) || 10) * 60000;
      const was = st0.connectedAt || '';
      while (Date.now() < until) {
        await new Promise(res => setTimeout(res, 3000));
        const st = await call('GET', `/api/oauth/${r.id}`);
        if (st.connected && st.connectedAt !== was) { out(`Connected: ${r.name}${st.canRefresh ? ' (refreshed automatically)' : ''}`); return 0; }
      }
      out('No sign-in arrived in time. Run the command again.');
      return 1;
    }
    case 'python': {
      if (!call) {
        await local();
        const { findPython } = await import('./python.js');
        const p = findPython(str(a, 'set') ? { interpreter: str(a, 'set') } : {});
        out(p.message);
        return p.ok ? 0 : 1;
      }
      const p = a.set !== undefined || a.clear ? await call('PUT', '/api/scripts/python', { path: a.clear ? '' : str(a, 'set') || '' }) : await call('GET', '/api/scripts/python');
      out(p.message);
      return p.ok ? 0 : 1;
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
    case 'db': {
      const { openDb, copyDatabase, dbKind, q } = await import('./db.js');
      const { config } = await import('./config.js');
      if (a._[1] === 'info') {
        openDb();
        const counts = ['projects', 'flows', 'resources', 'runs', 'users', 'settings'].map(t => [t, String(q.get<any>(`select count(*) as n from ${t}`)?.n ?? 0)]);
        out(`${dbKind() === 'postgres' ? `PostgreSQL ${config.dbUrl.replace(/\/\/([^:@/]+):[^@/]*@/, '//$1:***@')}` : `SQLite ${config.dataDir}`}`);
        table([['TABLE', 'ROWS'], ...counts]);
        return 0;
      }
      if (a._[1] === 'migrate') return dbMigrate(a);
      if (a._[1] !== 'copy') throw new Usage('Use: sutra db copy --to <address> [--replace] | sutra db migrate [--replace] [--write-env <file>] | sutra db info');
      const to = need(a, 'to');
      if (/^postgres(ql)?:/.test(to)) await ensurePgDatabase(to);
      openDb();
      const r = copyDatabase(to, { replace: !!a.replace, log: m => out(`  ${m}`) });
      out(`Copied ${r.rows} rows in ${r.tables.length} tables. Start the server with SUTRA_DB=${to.replace(/\/\/([^:@/]+):[^@/]*@/, '//$1:***@')} and the same master key.`);
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
    case 'sutras': case 'runs': case 'approvals': case 'engines': case 'token': case 'audit': case 'gateway': case 'alerts':
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
      for (const [flag, k] of Object.entries(map)) if (str(a, flag) === '') delete values[k]; else if (str(a, flag) !== undefined) values[k] = num(a, flag);
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
      for (const [flag, k] of Object.entries(map)) if (str(a, flag) === '') delete values[k]; else if (str(a, flag) !== undefined) values[k] = num(a, flag);
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
  if (cmd === 'gateway') return gateway(a, call);
  if (cmd === 'alerts') {
    const id = a._[2];
    switch (sub || 'list') {
      case 'list': case 'history': {
        const rows: any[] = await call('GET', `/api/alerts?state=${sub === 'history' ? '' : 'open'}&limit=100`);
        if (!rows.length) { out(sub === 'history' ? 'No alerts' : 'Nothing is open'); return 0; }
        table([['ID', 'STATE', 'SEVERITY', 'RULE', 'OPENED', 'MESSAGE'], ...rows.map(r => [r.id, r.state, r.severity, r.ruleName, r.startedAt, String(r.message).slice(0, 80)])]);
        return sub === 'history' ? 0 : rows.some(r => r.state === 'firing' && r.severity === 'critical') ? 1 : 0;
      }
      case 'ack': case 'resolve': {
        if (!id) throw new Usage(`Use: sutra alerts ${sub} <alert id>`);
        const r = await call('POST', `/api/alerts/${id}/${sub === 'ack' ? 'acknowledge' : 'resolve'}`);
        out(`${r.ruleName}: ${r.state}`);
        return 0;
      }
      case 'check': { const r = await call('POST', '/api/alerts/check'); out(`${r.opened} opened, ${r.resolved} resolved, ${r.reminded} reminded`); return 0; }
      case 'rules': {
        const rows: any[] = await call('GET', '/api/alerts/rules');
        table([['RULE', 'WATCHES', 'SEVERITY', 'STATE', 'PARAMETERS'], ...rows.map(r => [r.name, r.kind, r.severity, r.enabled ? 'on' : 'off', JSON.stringify(r.params)])]);
        return 0;
      }
      case 'channels': {
        const rows: any[] = await call('GET', '/api/alerts/channels');
        table([['CHANNEL', 'KIND', 'TO', 'STATE'], ...rows.map(c => [c.name, c.kind, c.config.to || c.config.url || 'a Sutra', c.enabled ? 'on' : 'off'])]);
        return 0;
      }
      case 'test': {
        if (!id) throw new Usage('Use: sutra alerts test <channel name>');
        const ch = (await call('GET', '/api/alerts/channels') as any[]).find(c => c.name.toLowerCase() === id.toLowerCase() || c.id === id);
        if (!ch) throw new Error(`No channel named "${id}"`);
        const r = await call('POST', `/api/alerts/channels/${ch.id}/test`);
        out(`Sent: ${r.result}`);
        return 0;
      }
    }
    throw new Usage('Use: sutra alerts [list | history | ack <id> | resolve <id> | check | rules | channels | test <channel>]');
  }
  if (cmd === 'audit' && sub === 'retention') {
    if (a._[2] === undefined) { const s = await call('GET', '/api/audit/policy'); out(`Audit entries are kept ${s.retentionDays ? `${s.retentionDays} days` : 'for ever'}; ${s.entries} entries, the oldest from ${s.oldest || '-'}.`); return 0; }
    const s = await call('PUT', '/api/audit/policy', { retentionDays: Number(a._[2]) });
    out(`Audit entries are now kept ${s.retentionDays ? `${s.retentionDays} days` : 'for ever'}.`);
    return 0;
  }
  if (cmd === 'audit' && sub === 'clear') {
    const body = a.all ? { all: true } : a.older ? { olderThanRetention: true } : str(a, 'before') ? { before: str(a, 'before') } : null;
    if (!body) throw new Usage('Use: sutra audit clear --before 2026-10-01 | --older | --all');
    const r = await call('POST', '/api/audit/clear', body);
    out(`Cleared ${r.deleted} audit entries (${r.what}). The clearing itself is recorded.`);
    return 0;
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

/** Gateway management from a shell. */
async function gateway(a: Args, call: Call): Promise<number> {
  const [, sub, act, name, extra] = a._;
  const appBy = async (n: string | undefined) => {
    if (!n) throw new Usage('Give the app name');
    const app = (await call('GET', '/api/gateway/apps') as any[]).find(x => x.name.toLowerCase() === n.toLowerCase() || x.id === n);
    if (!app) throw new Error(`No gateway app named "${n}"`);
    return app;
  };
  const planBy = async (n: string) => (await call('GET', '/api/gateway/plans') as any[]).find(x => x.name.toLowerCase() === n.toLowerCase());
  const list = (v: string | undefined) => (v || '').split(/[,\s]+/).map(x => x.trim()).filter(Boolean);
  switch (sub) {
    case 'apps': {
      const apps: any[] = await call('GET', '/api/gateway/apps');
      const plans = new Map((await call('GET', '/api/gateway/plans') as any[]).map(p => [p.id, p.name]));
      table([['APP', 'STATE', 'PLAN', 'SCOPES', 'KEYS', 'TODAY'], ...apps.map(x => [x.name, x.disabled ? 'disabled' : 'active', plans.get(x.planId) || '', x.scopes.join(' '), String(x.keys), String(x.usage?.day ?? 0)])]);
      return 0;
    }
    case 'plans': {
      const plans: any[] = await call('GET', '/api/gateway/plans');
      table([['PLAN', 'PER MINUTE', 'PER HOUR', 'PER DAY', 'PER MONTH', 'APPS'], ...plans.map(p => [p.name, String(p.perMinute || '-'), String(p.perHour || '-'), String(p.perDay || '-'), String(p.perMonth || '-'), String(p.apps)])]);
      return 0;
    }
    case 'app': {
      if (act === 'add') {
        if (!name) throw new Usage('Give the app name');
        const plan = str(a, 'plan') ? await planBy(str(a, 'plan')!) : null;
        if (str(a, 'plan') && !plan) throw new Error(`No plan named "${str(a, 'plan')}"`);
        const r = await call('POST', '/api/gateway/apps', { name, scopes: list(str(a, 'scopes')), planId: plan?.id || '', contact: str(a, 'contact') || '' });
        out(`App ${r.name} added (id ${r.id})`);
        return 0;
      }
      if (act === 'disable' || act === 'enable') { const app = await appBy(name); await call('PUT', `/api/gateway/apps/${app.id}`, { ...app, disabled: act === 'disable' }); out(`${app.name}: ${act}d`); return 0; }
      if (act === 'delete') { const app = await appBy(name); await call('DELETE', `/api/gateway/apps/${app.id}`); out(`${app.name}: deleted`); return 0; }
      break;
    }
    case 'key': {
      const app = await appBy(name);
      if (act === 'create') {
        const r = await call('POST', `/api/gateway/apps/${app.id}/keys`, { name: str(a, 'name') || 'key', expiresDays: num(a, 'expires-days') || 0 });
        out(r.key);
        process.stderr.write(`Key for ${app.name} (client id ${app.id})${r.expiresAt ? `, expires ${r.expiresAt}` : ', never expires'}. It is not shown again.\n`);
        return 0;
      }
      if (act === 'revoke') { if (!extra) throw new Usage('Use: sutra gateway key revoke <app> <key id>'); await call('DELETE', `/api/gateway/apps/${app.id}/keys/${extra}`); out('Key revoked'); return 0; }
      break;
    }
    case 'plan': {
      if (!name) throw new Usage('Give the plan name');
      const cur = await planBy(name);
      if (act === 'delete') { if (!cur) throw new Error(`No plan named "${name}"`); await call('DELETE', `/api/gateway/plans/${cur.id}`); out(`Plan ${name} deleted`); return 0; }
      if (act === 'set') {
        const body = { name, perMinute: num(a, 'per-minute') ?? cur?.perMinute ?? 0, perHour: num(a, 'per-hour') ?? cur?.perHour ?? 0, perDay: num(a, 'per-day') ?? cur?.perDay ?? 0, perMonth: num(a, 'per-month') ?? cur?.perMonth ?? 0 };
        const r = cur ? await call('PUT', `/api/gateway/plans/${cur.id}`, body) : await call('POST', '/api/gateway/plans', body);
        out(`Plan ${r.name}: ${r.perMinute || '-'}/min, ${r.perHour || '-'}/hour, ${r.perDay || '-'}/day, ${r.perMonth || '-'}/month`);
        return 0;
      }
      break;
    }
    case 'firewall': {
      let f = await call('GET', '/api/gateway/firewall');
      if (str(a, 'allow') !== undefined || str(a, 'deny') !== undefined) f = await call('PUT', '/api/gateway/firewall', { allow: str(a, 'allow') !== undefined ? list(str(a, 'allow')) : f.allow, deny: str(a, 'deny') !== undefined ? list(str(a, 'deny')) : f.deny });
      out(`Allow: ${f.allow.join(', ') || 'every address'}\nDeny:  ${f.deny.join(', ') || 'none'}`);
      return 0;
    }
    case 'stats': {
      const s = await call('GET', `/api/gateway/stats?period=${encodeURIComponent(str(a, 'period') || '24h')}`);
      out(`${s.totals.requests} requests, ${s.totals.errors} errors (5xx), ${s.totals.refused} refused (4xx); p50 ${s.totals.p50Ms} ms, p95 ${s.totals.p95Ms} ms, p99 ${s.totals.p99Ms} ms`);
      table([['SERVICE', 'REQUESTS', 'ERRORS', 'AVG MS', 'P95 MS'], ...s.topServices.map((x: any) => [x.name, String(x.requests), String(x.errors), String(x.avgMs), String(x.p95Ms)])]);
      return 0;
    }
    case 'log': {
      const qs = new URLSearchParams({ limit: String(num(a, 'limit') || 50), ...(str(a, 'status') ? { status: str(a, 'status')! } : {}) });
      const rows: any[] = await call('GET', `/api/gateway/requests?${qs}`);
      table([['WHEN', 'STATUS', 'MS', 'METHOD', 'PATH', 'SERVICE', 'APP', 'ERROR'], ...rows.map(r => [r.at, String(r.status), String(r.ms), r.method, r.path, r.route, r.app, String(r.error || '').slice(0, 50)])]);
      return 0;
    }
    case 'openapi': out(await call('GET', '/api/gateway/openapi')); return 0;
  }
  throw new Usage('Use: sutra gateway apps | plans | stats | log | app ... | key ... | plan ... | firewall | openapi');
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
