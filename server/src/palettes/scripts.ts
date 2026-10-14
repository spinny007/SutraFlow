import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Activity, ExecCtx } from '../engine/types.js';
import { F, when } from './common.js';
import { scriptsAllowed } from '../projects.js';

/**
 * Scripts palette: PowerShell, shell scripts and programs run on the SutraFlow server.
 *
 * Safety: nothing runs until an administrator allows scripts (Server & APIs). Values reach a script as
 * environment variables and the previous step's output as a JSON file, never pasted into the script
 * text, so data from a request or a file cannot become commands. Programs get their arguments one by
 * one, without a shell. Each run has a time limit and an output cap.
 */
const MAX_OUT = 5 * 1024 * 1024;
const SHELLS = ['bash', 'sh', 'cmd (Windows)'];
const POWERSHELLS = ['Windows PowerShell', 'PowerShell 7 (pwsh)'];

interface RunResult {
  exitCode: number | null; stdout: string; stderr: string; output: string; lines: string[]; json: any;
  ms: number; command: string; timedOut: boolean; truncated: boolean;
}

/** Runs a program and captures standard output and error, apart and interleaved. */
function run(command: string, args: string[], o: { cwd: string; env: Record<string, string>; stdin?: string; timeoutMs: number; signal: AbortSignal; shell?: boolean }): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const child = spawn(command, args, { cwd: o.cwd, env: { ...process.env, ...o.env }, windowsHide: true, shell: o.shell ?? false });
    let stdout = '', stderr = '', output = '', size = 0, truncated = false, timedOut = false;
    const take = (which: 'out' | 'err') => (b: Buffer) => {
      if (size >= MAX_OUT) { truncated = true; return; }
      const t = b.toString('utf8').slice(0, MAX_OUT - size);
      size += t.length;
      if (which === 'out') stdout += t; else stderr += t;
      output += t;
    };
    child.stdout.on('data', take('out'));
    child.stderr.on('data', take('err'));
    const kill = () => { try { child.kill(); } catch { /* gone */ } };
    const to = setTimeout(() => { timedOut = true; kill(); }, o.timeoutMs);
    o.signal.addEventListener('abort', kill, { once: true });
    child.on('error', (e: any) => { clearTimeout(to); reject(new Error(e.code === 'ENOENT' ? `"${command}" was not found on this server` : e.message)); });
    child.on('close', code => {
      clearTimeout(to);
      o.signal.removeEventListener('abort', kill);
      const trimmed = stdout.trim();
      let json: any = null;
      if (/^[[{]/.test(trimmed)) { try { json = JSON.parse(trimmed); } catch { /* not JSON */ } }
      resolve({ exitCode: code, stdout, stderr, output, lines: stdout.split(/\r?\n/).filter(l => l.length), json, ms: Date.now() - t0, command: [command, ...args].join(' '), timedOut, truncated });
    });
    child.stdin.on('error', () => { /* the program may not read its input */ });
    child.stdin.end(o.stdin ?? '');
  });
}

/** Environment for a script: the Variables rows, and SUTRA_INPUT_FILE with the previous step's output. */
function envFor(c: ExecCtx, dir: string) {
  const env: Record<string, string> = {};
  for (const r of (c.raw('env') as any[]) || []) {
    const k = String(r?.k || '').trim();
    if (!k) continue;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw new Error(`"${k}" is not a valid variable name (letters, digits and _)`);
    const v = c.resolve(r.v);
    env[k] = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  }
  const inputFile = path.join(dir, 'input.json');
  fs.writeFileSync(inputFile, JSON.stringify(c.input ?? null));
  env.SUTRA_INPUT_FILE = inputFile;
  env.SUTRA_RUN_ID = c.runId;
  env.SUTRA_STEP = c.node.name;
  return env;
}

function guard(c: ExecCtx) {
  if (!scriptsAllowed()) throw new Error('Script activities are switched off on this server. An administrator can allow them in Server & APIs.');
  const cwd = String(c.raw('workDir') || '').trim();
  if (cwd && !fs.existsSync(cwd)) throw new Error(`Working folder not found: ${cwd}`);
  return cwd;
}

/** Finishes a run: fails on a non-zero exit code (when asked), with everything captured in the error. */
function finish(c: ExecCtx, r: RunResult) {
  if (r.timedOut) throw Object.assign(new Error(`${c.node.name} did not finish within its time limit${r.stderr ? `: ${r.stderr.trim().slice(-300)}` : ''}`), { details: r });
  if (r.exitCode !== 0 && c.raw('failOnExit') !== false) {
    const tail = (r.stderr.trim() || r.stdout.trim()).split(/\r?\n/).slice(-5).join(' | ');
    throw Object.assign(new Error(`Exit code ${r.exitCode}${tail ? `: ${tail.slice(0, 500)}` : ''}`), { details: r });
  }
  if (r.stderr.trim()) c.log('warn', `${c.node.name} wrote to its error output: ${r.stderr.trim().slice(0, 300)}`);
  return { out: r };
}

const common = (timeout = 60000) => [
  F('env', 'Variables', 'kv', [{ k: 'ORDER_ID', v: '{{input.orderId}}' }], { tpl: true, help: 'Passed as environment variables: $env:ORDER_ID in PowerShell, $ORDER_ID in bash, %ORDER_ID% in cmd. The previous step\'s output is in the JSON file named by SUTRA_INPUT_FILE.' }),
  F('workDir', 'Working folder', 'text', '', { help: 'Empty = a new temporary folder for each run.' }),
  F('timeoutMs', 'Time limit (ms)', 'number', timeout),
  F('failOnExit', 'Fail when the exit code is not 0', 'bool', true, { help: 'Then the error output carries the exit code and what the script printed. Untick to continue and check exitCode yourself.' }),
];

/** bash or sh: from PATH, or on Windows from Git for Windows when it is not on PATH. */
export function shellPath(name: 'bash' | 'sh') {
  if (process.platform !== 'win32') return name;
  const onPath = (process.env.PATH || '').split(';').map(d => path.join(d, `${name}.exe`)).find(f => fs.existsSync(f));
  if (onPath) return onPath;
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean) as string[];
  for (const r of roots) for (const sub of [['Git', 'bin'], ['Git', 'usr', 'bin']]) {
    const f = path.join(r, ...sub, `${name}.exe`);
    if (fs.existsSync(f)) return f;
  }
  return name;
}

const RESULT = { exitCode: 0, stdout: '', stderr: '', output: '', lines: [''], json: null, ms: 0, command: '', timedOut: false, truncated: false };

/** Writes the script to a temporary file and runs it with the interpreter. */
async function runScript(c: ExecCtx, kind: 'powershell' | 'shell') {
  const cwd = guard(c);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-script-'));
  try {
    const env = envFor(c, dir);
    const code = String(c.raw('script') ?? '');
    const timeoutMs = Math.max(1000, Number(c.raw('timeoutMs')) || 60000);
    const base = { cwd: cwd || dir, env, timeoutMs, signal: c.signal };
    let r: RunResult;
    if (kind === 'powershell') {
      const file = path.join(dir, 'script.ps1');
      // UTF-8 with a byte order mark, so Windows PowerShell reads non-English text correctly.
      fs.writeFileSync(file, '\ufeff' + code);
      const exe = c.raw('interpreter') === 'PowerShell 7 (pwsh)' ? 'pwsh' : process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
      r = await run(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], base);
    } else if (c.raw('interpreter') === 'cmd (Windows)') {
      if (process.platform !== 'win32') throw new Error('cmd scripts run only on Windows');
      const file = path.join(dir, 'script.cmd');
      fs.writeFileSync(file, '@echo off\r\n' + code.replace(/\r?\n/g, '\r\n'));
      r = await run('cmd.exe', ['/d', '/c', file], base);
    } else {
      const file = path.join(dir, 'script.sh');
      fs.writeFileSync(file, code.replace(/\r\n/g, '\n'));
      r = await run(shellPath(c.raw('interpreter') === 'sh' ? 'sh' : 'bash'), [file.split(path.sep).join('/')], base);
    }
    return finish(c, r);
  } finally {
    fs.rm(dir, { recursive: true, force: true }, () => {});
  }
}

export const scriptActivities: Activity[] = [
  {
    type: 'powershell', palette: 'scripts', name: 'PowerShell script', glyph: '❯', ports: ['out'],
    desc: 'Runs a PowerShell script on the server and captures its output, error output and exit code. Values come in as environment variables. Needs scripts to be allowed in Server & APIs.',
    fields: [
      F('interpreter', 'PowerShell', 'select', POWERSHELLS[0], { options: POWERSHELLS, help: 'Windows PowerShell 5.1 comes with Windows; PowerShell 7 must be installed (pwsh).' }),
      F('script', 'Script', 'code', '$order = Get-Content $env:SUTRA_INPUT_FILE -Raw | ConvertFrom-Json\n$files = Get-ChildItem -Path $env:TEMP -Filter *.log | Select-Object -First 5 Name, Length\n[pscustomobject]@{ orderId = $env:ORDER_ID; logs = $files } | ConvertTo-Json -Depth 4', { help: 'Print JSON (ConvertTo-Json) to hand structured data to the next step; it arrives as json.' }),
      ...common(),
    ],
    outputHint: RESULT,
    execute: c => runScript(c, 'powershell'),
  },
  {
    type: 'shellScript', palette: 'scripts', name: 'Shell script', glyph: '$', ports: ['out'],
    desc: 'Runs a bash, sh or Windows cmd script on the server and captures its output, error output and exit code. Values come in as environment variables. Needs scripts to be allowed in Server & APIs.',
    fields: [
      F('interpreter', 'Shell', 'select', 'bash', { options: SHELLS, help: 'On Windows, bash comes with Git for Windows or WSL.' }),
      F('script', 'Script', 'code', 'set -e\necho "Order $ORDER_ID"\nls -1 "${TMPDIR:-/tmp}" | head -5', { help: 'Print JSON to hand structured data to the next step; it arrives as json.' }),
      ...common(),
    ],
    outputHint: RESULT,
    execute: c => runScript(c, 'shell'),
  },
  {
    type: 'runProgram', palette: 'scripts', name: 'Run program', glyph: '▷', ports: ['out'],
    desc: 'Starts a program with its arguments, without a shell, and captures its output, error output and exit code. Each argument is passed as it is, so values cannot add commands. Needs scripts to be allowed in Server & APIs.',
    fields: [
      F('program', 'Program', 'text', process.platform === 'win32' ? 'C:/Program Files/7-Zip/7z.exe' : '/usr/bin/zip', { help: 'Full path, or a name on the server\'s PATH.' }),
      F('args', 'Arguments', 'list', ['a', 'archive.zip', '{{input.path}}'], { tpl: true, help: 'One per line; each may use {{ }} references and is passed as one argument.' }),
      F('stdin', 'Standard input', 'textarea', '', { tpl: true, help: 'Optional text sent to the program.' }),
      ...common(),
    ],
    outputHint: RESULT,
    execute: async c => {
      const cwd = guard(c);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-run-'));
      try {
        const program = String(c.raw('program') || '').trim();
        if (!program) throw new Error('Program is not set');
        const args = ((c.raw('args') as any[]) || []).map(a => { const v = c.resolve(a); return v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); });
        const stdin = c.v('stdin');
        const r = await run(program, args, { cwd: cwd || dir, env: envFor(c, dir), stdin: stdin == null ? '' : typeof stdin === 'object' ? JSON.stringify(stdin) : String(stdin), timeoutMs: Math.max(1000, Number(c.raw('timeoutMs')) || 60000), signal: c.signal });
        return finish(c, r);
      } finally {
        fs.rm(dir, { recursive: true, force: true }, () => {});
      }
    },
  },
];
