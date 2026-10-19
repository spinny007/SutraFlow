#!/usr/bin/env node
// SutraFlow launcher: start, stop, status and the rest, on Windows and Linux, with or without Docker.
// Settings come from sutraflow.env in the SutraFlow folder (made on first use from sutraflow.env.example),
// or from the file named by SUTRAFLOW_ENV. Run "sutraflow help" for the commands.
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WIN = process.platform === 'win32';
const out = (...a) => console.log(...a);
const fail = m => { console.error(`sutraflow: ${m}`); process.exit(1); };

const HELP = `sutraflow <command>

  setup                      Installs the packages and builds SutraFlow (from a source folder),
                             and makes sutraflow.env and the local admin token.
  start [engine] [--foreground]
                             Starts the studio (designer, Admin Console, engine and gateway), or a
                             headless engine beside it on the same database. In the background
                             unless --foreground; its output goes to <data>/logs/<name>.out.log.
  stop [engine|all] [--force]
                             Stops gracefully: no new work, running steps finish (up to 30 s).
                             --force ends the process when it does not stop in time.
  restart [engine]           Stops, then starts.
  status                     Studio and engine: running or not, ready, addresses, database.
  logs [engine] [--follow]   The last lines of the output log.
  open [designer|admin|guide|architecture]
                             Opens the page in the browser.
  cli <sutra command ...>    The sutra command, pointed at this studio with the local admin token,
                             for example: sutraflow cli sutras list
  db info | db copy --to <postgres://...> [--replace]
                             Which database is in use; copies the data to PostgreSQL (stop first).
  service                    How to start SutraFlow with the machine (systemd unit or Windows task).
  docker up | down | status | logs [service] | build
                             The studio and an engine in Docker (docker-compose.yml).
  docker cluster up | down | status | logs
                             PostgreSQL, a studio and two engines (docker-compose.cluster.yml).
  version                    The SutraFlow version.

Settings: ${path.join(HOME, 'sutraflow.env')}  (ports, data folder, SUTRA_DB, Node path)`;

// ---------- settings ----------
function readEnvFile(file) {
  const vals = {};
  if (!fs.existsSync(file)) return vals;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith('#')) continue;
    vals[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return vals;
}
function settings() {
  const file = process.env.SUTRAFLOW_ENV || path.join(HOME, 'sutraflow.env');
  const example = path.join(HOME, 'sutraflow.env.example');
  if (!process.env.SUTRAFLOW_ENV && !fs.existsSync(file) && fs.existsSync(example)) {
    fs.copyFileSync(example, file);
    out(`Made ${file} from sutraflow.env.example; change ports and folders there.`);
  }
  const s = { ...readEnvFile(file), ...Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(SUTRA_|STUDIO_|ENGINE_)/.test(k))) };
  const dataDir = path.resolve(HOME, s.SUTRA_DATA_DIR || 'data');
  return {
    file, dataDir,
    host: s.SUTRA_ADMIN_HOST || '127.0.0.1',
    node: s.SUTRA_NODE || process.execPath,
    db: s.SUTRA_DB || '',
    extra: s,
    roles: {
      studio: { name: 'studio', mode: 'studio', port: Number(s.STUDIO_PORT || 4800), http: Number(s.STUDIO_GATEWAY_HTTP || 8080), https: Number(s.STUDIO_GATEWAY_HTTPS || 8443), id: s.STUDIO_ENGINE_ID || `${os.hostname()}-studio` },
      engine: { name: 'engine', mode: 'engine', port: Number(s.ENGINE_PORT || 4801), http: Number(s.ENGINE_GATEWAY_HTTP || 9080), https: Number(s.ENGINE_GATEWAY_HTTPS || 9443), id: s.ENGINE_ENGINE_ID || `${os.hostname()}-engine` },
    },
  };
}
/** The local admin token: made once, kept in the data folder; lets stop, status and cli work. */
function adminToken(cfg) {
  if (cfg.extra.SUTRA_ADMIN_TOKEN) return cfg.extra.SUTRA_ADMIN_TOKEN;
  const f = path.join(cfg.dataDir, 'admin-token.txt');
  if (!fs.existsSync(f)) { fs.mkdirSync(cfg.dataDir, { recursive: true }); fs.writeFileSync(f, crypto.randomBytes(24).toString('hex'), { mode: 0o600 }); }
  return fs.readFileSync(f, 'utf8').trim();
}
function envFor(cfg, role) {
  const passOn = Object.fromEntries(Object.entries(cfg.extra).filter(([k]) => k.startsWith('SUTRA_')));
  return {
    ...process.env, ...passOn,
    SUTRA_DATA_DIR: cfg.dataDir, SUTRA_MODE: role.mode, SUTRA_ADMIN_HOST: cfg.host, SUTRA_ADMIN_PORT: String(role.port),
    SUTRA_GATEWAY_HTTP_PORT: String(role.http), SUTRA_GATEWAY_HTTPS_PORT: String(role.https), SUTRA_ENGINE_ID: role.id,
    SUTRA_ADMIN_TOKEN: adminToken(cfg), ...(cfg.db ? { SUTRA_DB: cfg.db } : {}),
  };
}
const runDir = cfg => path.join(cfg.dataDir, 'run');
const pidFile = (cfg, role) => path.join(runDir(cfg), `${role.name}.pid`);
const logFile = (cfg, role) => path.join(cfg.dataDir, 'logs', `${role.name}.out.log`);
const base = (cfg, role) => `http://${cfg.host === '0.0.0.0' ? '127.0.0.1' : cfg.host}:${role.port}`;
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const readPid = (cfg, role) => { try { const p = Number(fs.readFileSync(pidFile(cfg, role), 'utf8')); return p && alive(p) ? p : 0; } catch { return 0; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url, o = {}) {
  try { const r = await fetch(url, { ...o, signal: AbortSignal.timeout(o.timeout || 3000) }); return { status: r.status, body: await r.json().catch(() => null) }; } catch { return null; }
}

// ---------- commands ----------
function roleOf(cfg, a) { return a === 'engine' ? cfg.roles.engine : cfg.roles.studio; }

async function start(cfg, role, foreground) {
  const main = path.join(HOME, 'dist', 'server', 'main.js');
  if (!fs.existsSync(main)) fail(`SutraFlow is not built yet (no ${path.relative(HOME, main)}). Run: sutraflow setup`);
  const running = readPid(cfg, role);
  if (running || (await get(`${base(cfg, role)}/health`))) { out(`The ${role.name} is already running at ${base(cfg, role)}${running ? ` (process ${running})` : ''}.`); return; }
  const env = envFor(cfg, role);
  const args = ['--disable-warning=ExperimentalWarning', main];
  if (foreground) {
    const p = spawn(cfg.node, args, { cwd: HOME, env, stdio: 'inherit' });
    p.on('exit', code => process.exit(code ?? 0));
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => p.kill(sig));
    return new Promise(() => {});
  }
  fs.mkdirSync(path.dirname(logFile(cfg, role)), { recursive: true });
  fs.mkdirSync(runDir(cfg), { recursive: true });
  const fd = fs.openSync(logFile(cfg, role), 'a');
  fs.writeSync(fd, `\n---- ${new Date().toISOString()} starting the ${role.name} ----\n`);
  const p = spawn(cfg.node, args, { cwd: HOME, env, detached: true, stdio: ['ignore', fd, fd], windowsHide: true });
  fs.writeFileSync(pidFile(cfg, role), String(p.pid));
  p.unref();
  fs.closeSync(fd);
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    if (!alive(p.pid)) fail(`The ${role.name} stopped while starting. Last lines of ${logFile(cfg, role)}:\n${tail(logFile(cfg, role), 15)}`);
    const r = await get(`${base(cfg, role)}/ready`);
    if (r?.status === 200) {
      out(`The ${role.name} is running (process ${p.pid}).`);
      out(`  ${role.mode === 'studio' ? 'Designer      ' : 'Admin Console '} ${base(cfg, role)}${role.mode === 'studio' ? `\n  Admin Console  ${base(cfg, role)}/admin` : '/admin'}`);
      out(`  Gateway        http://127.0.0.1:${role.http}`);
      out(`  Output log     ${logFile(cfg, role)}`);
      return;
    }
  }
  out(`The ${role.name} started (process ${p.pid}) but is not ready yet; see ${logFile(cfg, role)}.`);
}

async function stop(cfg, role, force) {
  const pid = readPid(cfg, role);
  const r = await get(`${base(cfg, role)}/api/engine/drain`, { method: 'POST', headers: { authorization: `Bearer ${adminToken(cfg)}`, 'content-type': 'application/json' }, body: '{}' });
  if (!r && !pid) { out(`The ${role.name} is not running.`); return; }
  if (r && r.status >= 400) out(`The ${role.name} refused to drain (${r.status}); ${pid ? 'ending its process' : 'stop it by hand'}.`);
  else if (r) out(`The ${role.name} is stopping: running steps finish first.`);
  for (let i = 0; i < 90; i++) {
    const up = await get(`${base(cfg, role)}/health`, { timeout: 1500 });
    if (!up && (!pid || !alive(pid))) { fs.rmSync(pidFile(cfg, role), { force: true }); out(`The ${role.name} has stopped.`); return; }
    await sleep(500);
  }
  if (pid && (force || (r && r.status >= 400))) {
    try { process.kill(pid, WIN ? undefined : 'SIGTERM'); } catch { /* gone */ }
    await sleep(2000);
    if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
    fs.rmSync(pidFile(cfg, role), { force: true });
    out(`The ${role.name} was ended (process ${pid}).`);
  } else fail(`The ${role.name} did not stop within 45 s. Run: sutraflow stop ${role.name === 'engine' ? 'engine ' : ''}--force`);
}

async function status(cfg) {
  out(`SutraFlow ${version()}  folder ${HOME}`);
  out(`Data      ${cfg.dataDir}`);
  out(`Database  ${cfg.db ? cfg.db.replace(/\/\/([^:@/]+):[^@/]*@/, '//$1:***@') : `SQLite (${path.join(cfg.dataDir, 'sutra.db')})`}`);
  for (const role of Object.values(cfg.roles)) {
    const pid = readPid(cfg, role);
    const r = await get(`${base(cfg, role)}/ready`);
    const state = r ? (r.status === 200 ? 'ready' : `not ready: ${(r.body?.reasons || []).join(', ') || r.status}`) : pid ? 'starting or not answering' : 'not running';
    out(`${role.name.padEnd(9)} ${state}${pid ? `  (process ${pid})` : ''}  ${base(cfg, role)}  gateway :${role.http}`);
  }
}

function tail(file, n) {
  try { return fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(-n - 1).join('\n'); } catch { return '(no log yet)'; }
}
async function logs(cfg, role, follow) {
  const f = logFile(cfg, role);
  out(tail(f, 60));
  if (!follow) return;
  let size = fs.existsSync(f) ? fs.statSync(f).size : 0;
  for (;;) {
    await sleep(1000);
    const now = fs.existsSync(f) ? fs.statSync(f).size : 0;
    if (now > size) { const fd = fs.openSync(f, 'r'); const b = Buffer.alloc(now - size); fs.readSync(fd, b, 0, b.length, size); fs.closeSync(fd); process.stdout.write(b.toString('utf8')); }
    size = now;
  }
}

function openPage(cfg, what) {
  const b = base(cfg, cfg.roles.studio);
  const url = { designer: b, admin: `${b}/admin`, guide: `${b}/guide`, architecture: `${b}/architecture` }[what || 'designer'];
  if (!url) fail('Open designer, admin, guide or architecture');
  if (WIN) spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).on('error', () => out(url)).unref();
  out(url);
}

function runSync(cmd, args, o = {}) {
  const r = spawnSync(cmd, args, { cwd: HOME, stdio: 'inherit', shell: WIN, ...o });
  if (r.error) fail(`${cmd}: ${r.error.message}`);
  return r.status ?? 1;
}
function cli(cfg, args, remote) {
  const env = { ...envFor(cfg, cfg.roles.studio), ...(remote ? { SUTRA_SERVER: base(cfg, cfg.roles.studio) } : {}) };
  if (!remote) delete env.SUTRA_SERVER;
  const main = path.join(HOME, 'dist', 'server', 'cli.js');
  if (!fs.existsSync(main)) fail('SutraFlow is not built yet. Run: sutraflow setup');
  return spawnSync(cfg.node, ['--disable-warning=ExperimentalWarning', main, ...args], { cwd: HOME, env, stdio: 'inherit' }).status ?? 1;
}

function setup(cfg) {
  const npm = WIN ? 'npm.cmd' : 'npm';
  if (fs.existsSync(path.join(HOME, 'server', 'src'))) {
    out('Installing packages ...');
    if (runSync(npm, ['install', '--no-audit', '--no-fund'])) fail('npm install failed');
    out('Building ...');
    if (runSync(npm, ['run', 'build'])) fail('The build failed');
  } else if (!fs.existsSync(path.join(HOME, 'node_modules'))) {
    if (runSync(npm, ['ci', '--omit=dev', '--no-audit', '--no-fund'])) fail('npm ci failed');
  }
  adminToken(cfg);
  out(`Ready. Settings: ${cfg.file}\nStart with: sutraflow start   (then sutraflow open)`);
}

function service(cfg) {
  const studio = cfg.roles.studio;
  if (WIN) {
    out(`Start SutraFlow when Windows starts, with a scheduled task (run in an administrator terminal):

  schtasks /Create /TN "SutraFlow" /SC ONSTART /RU SYSTEM /RL HIGHEST /TR "\\"${path.join(HOME, 'bin', 'sutraflow.cmd')}\\" start"

Remove it with: schtasks /Delete /TN "SutraFlow" /F
Laragon users can instead add a line to Laragon's Procfile: SutraFlow: "${path.join(HOME, 'bin', 'sutraflow.cmd')}" start --foreground`);
    return;
  }
  out(`# Save as /etc/systemd/system/sutraflow.service, then:
#   sudo systemctl daemon-reload && sudo systemctl enable --now sutraflow
# Stop gracefully with: sudo systemctl stop sutraflow   (running steps finish first)
[Unit]
Description=SutraFlow studio
After=network-online.target postgresql.service mysql.service
Wants=network-online.target

[Service]
Type=simple
User=${os.userInfo().username}
WorkingDirectory=${HOME}
Environment=SUTRAFLOW_ENV=${cfg.file}
ExecStart=${cfg.node} ${path.join(HOME, 'bin', 'sutraflow.mjs')} start --foreground
ExecStop=${cfg.node} ${path.join(HOME, 'bin', 'sutraflow.mjs')} stop
TimeoutStopSec=60
Restart=on-failure

[Install]
WantedBy=multi-user.target

# A second engine: copy this unit as sutraflow-engine.service with "start engine --foreground" and "stop engine".
# Studio: ${base(cfg, studio)}`);
}

// ---------- Docker ----------
function compose(args, file) {
  const has = spawnSync('docker', ['compose', 'version'], { stdio: 'ignore', shell: WIN });
  if (has.status !== 0) fail('Docker with the compose plugin is needed: https://docs.docker.com/get-docker/');
  return runSync('docker', ['compose', ...(file ? ['-f', file] : []), ...args]);
}
/** Values the compose files need, made once into .env beside them (Docker Compose reads it). */
function composeEnv(cluster) {
  const f = path.join(HOME, '.env');
  const have = readEnvFile(f);
  const add = {};
  const rand = n => crypto.randomBytes(n).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 32);
  if (!have.SUTRA_ADMIN_TOKEN) add.SUTRA_ADMIN_TOKEN = crypto.randomBytes(24).toString('hex');
  if (!have.SUTRA_MASTER_KEY) add.SUTRA_MASTER_KEY = crypto.randomBytes(32).toString('base64');
  if (cluster && !have.POSTGRES_PASSWORD) add.POSTGRES_PASSWORD = rand(24);
  if (Object.keys(add).length) {
    fs.appendFileSync(f, `${fs.existsSync(f) ? '\n' : ''}# Made by sutraflow docker on ${new Date().toISOString()}. Keep this file private; back up SUTRA_MASTER_KEY.\n${Object.entries(add).map(([k, v]) => `${k}=${v}`).join('\n')}\n`, { mode: 0o600 });
    out(`Wrote ${Object.keys(add).join(', ')} to ${f}`);
  }
}
async function docker(a) {
  const cluster = a[0] === 'cluster';
  const [cmd, ...rest] = cluster ? a.slice(1) : a;
  const file = cluster ? 'docker-compose.cluster.yml' : undefined;
  switch (cmd) {
    case 'up': composeEnv(cluster); return compose(['up', '-d', '--build'], file) || (out(cluster ? 'Cluster: studio http://localhost:4800, engines behind your load balancer (see docker-compose.cluster.yml).' : 'Studio: http://localhost:4800   Engine Admin Console: http://localhost:4801/admin   Engine APIs: http://localhost:9080'), 0);
    case 'down': return compose(['down'], file);
    case 'status': return compose(['ps'], file);
    case 'logs': return compose(['logs', '--tail', '200', ...rest], file);
    case 'build': return compose(['build'], file);
    default: fail('Use: sutraflow docker [cluster] up | down | status | logs [service] | build');
  }
}

function version() { try { return JSON.parse(fs.readFileSync(path.join(HOME, 'package.json'), 'utf8')).version; } catch { return '?'; } }

// ---------- main ----------
const argv = process.argv.slice(2);
const flag = f => argv.includes(f);
const pos = argv.filter(x => !x.startsWith('--'));
const [cmd, arg] = pos;
const cfg = settings();
switch (cmd) {
  case undefined: case 'help': out(HELP); break;
  case 'version': out(version()); break;
  case 'setup': setup(cfg); break;
  case 'start': await start(cfg, roleOf(cfg, arg), flag('--foreground')); break;
  case 'stop':
    if (arg === 'all') { await stop(cfg, cfg.roles.engine, flag('--force')); await stop(cfg, cfg.roles.studio, flag('--force')); }
    else await stop(cfg, roleOf(cfg, arg), flag('--force'));
    break;
  case 'restart': await stop(cfg, roleOf(cfg, arg), true); await start(cfg, roleOf(cfg, arg), false); break;
  case 'status': await status(cfg); break;
  case 'logs': await logs(cfg, roleOf(cfg, arg), flag('--follow') || flag('-f')); break;
  case 'open': openPage(cfg, arg); break;
  case 'cli': process.exit(cli(cfg, argv.slice(1), true));
  case 'db': process.exit(cli(cfg, argv, false));
  case 'service': service(cfg); break;
  case 'docker': process.exit(await docker(argv.slice(1)));
  default: fail(`Unknown command "${cmd}". Run: sutraflow help`);
}
