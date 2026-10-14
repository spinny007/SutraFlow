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

  Remote: --server <url> --token <token>  (or SUTRA_SERVER, SUTRA_ADMIN_TOKEN)
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

main(process.argv.slice(2)).then(code => process.exit(code), e => {
  process.stderr.write(`${e instanceof Usage ? 'Usage: ' : 'Error: '}${e.message}\n`);
  process.exit(e instanceof Usage ? 2 : 1);
});
