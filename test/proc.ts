import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Starts SutraFlow (server/src/main.ts) as its own process, for headless and cluster tests. */
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export interface Proc { child: ChildProcess; out: () => string; admin: string; http: string; exited: Promise<number | null>; stop(): Promise<void> }

export function startServer(o: { env: Record<string, string>; adminPort: number; httpPort: number }): Proc {
  let log = '';
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', 'tsx', path.join(root, 'server/src/main.ts')], {
    cwd: root,
    env: { ...process.env, SUTRA_ADMIN_PORT: String(o.adminPort), SUTRA_GATEWAY_HTTP_PORT: String(o.httpPort), SUTRA_GATEWAY_HTTPS_PORT: String(o.httpPort + 1), ...o.env },
  });
  child.stdout!.on('data', d => (log += d));
  child.stderr!.on('data', d => (log += d));
  const exited = new Promise<number | null>(res => child.on('exit', code => res(code)));
  return {
    child, out: () => log, admin: `http://127.0.0.1:${o.adminPort}`, http: `http://127.0.0.1:${o.httpPort}`, exited,
    async stop() { if (child.exitCode === null) { child.kill(); await exited; } },
  };
}

/** Waits until GET url answers with the status (or the process exits, or time runs out). */
export async function waitFor(url: string, p: Proc, status = 200, timeoutMs = 60000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (p.child.exitCode !== null) throw new Error(`The server exited (${p.child.exitCode}):\n${p.out()}`);
    try { const r = await fetch(url); if (r.status === status) return r; } catch { /* not listening yet */ }
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error(`${url} did not answer ${status} in time:\n${p.out()}`);
}
