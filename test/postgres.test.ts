import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import crypto from 'node:crypto';
import { root, startServer, waitFor } from './proc.js';

/**
 * The same suites again on PostgreSQL. PGlite (PostgreSQL compiled to run inside Node) needs no
 * server, so this always runs; each suite gets its own in-memory database. Suites that start
 * several processes on one database (headless, cluster, the command-line cases) need a real server:
 * set SUTRA_TEST_PG_URL=postgres://user:pass@host/db to run the cluster check below as well.
 */
const SUITES = ['admin', 'connectors', 'engine', 'expr', 'features', 'gateway', 'mcp', 'packages', 'palettes', 'process', 'project', 'scripts', 'sutras', 'template'];

/** The child is a test run of its own: drop the variable that makes node --test report to a parent run. */
function childEnv(extra: Record<string, string>) {
  const e: Record<string, string | undefined> = { ...process.env, ...extra };
  delete e.NODE_TEST_CONTEXT;
  return e as NodeJS.ProcessEnv;
}

function runSuites(env: Record<string, string>) {
  return new Promise<{ code: number | null; out: string }>(res => {
    const c = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', 'tsx', '--test', '--test-timeout=180000',
      '--test-skip-pattern=command line', ...SUITES.map(s => path.join('test', `${s}.test.ts`))], { cwd: root, env: childEnv(env) });
    let out = '';
    c.stdout.on('data', d => (out += d)); c.stderr.on('data', d => (out += d));
    c.on('close', code => res({ code, out }));
  });
}

test('every in-process suite passes on PostgreSQL (PGlite)', { timeout: 900000 }, async () => {
  const r = await runSuites({ SUTRA_DB: 'pglite:memory' });
  const pass = /ℹ pass (\d+)/.exec(r.out)?.[1], fail = /ℹ fail (\d+)/.exec(r.out)?.[1];
  const failing = r.out.split(/\r?\n/).filter(l => /^✖ /.test(l)).slice(0, 10).join('\n');
  assert.equal(r.code, 0, `PostgreSQL run: ${pass} passed, ${fail} failed\n${failing}`);
  assert.ok(Number(pass) >= 80, `ran ${pass} tests on PostgreSQL`);
});

test('two engines share a real PostgreSQL server', { skip: !process.env.SUTRA_TEST_PG_URL && 'set SUTRA_TEST_PG_URL to run against a PostgreSQL server' }, async () => {
  const url = process.env.SUTRA_TEST_PG_URL!;
  const env = { SUTRA_DB: url, SUTRA_MODE: 'engine', SUTRA_ADMIN_TOKEN: 'pg-token-0123456789abcdef', SUTRA_MASTER_KEY: crypto.randomBytes(32).toString('base64'), SUTRA_HEARTBEAT_MS: '400' };
  const a = startServer({ adminPort: 19410, httpPort: 19460, env: { ...env, SUTRA_ENGINE_ID: 'PG-A' } });
  const b = startServer({ adminPort: 19420, httpPort: 19470, env: { ...env, SUTRA_ENGINE_ID: 'PG-B' } });
  try {
    await Promise.all([waitFor(`${a.admin}/ready`, a), waitFor(`${b.admin}/ready`, b)]);
    const s = await (await fetch(`${a.admin}/api/engine/status`, { headers: { authorization: `Bearer ${env.SUTRA_ADMIN_TOKEN}` } })).json();
    assert.equal(s.engines.filter((e: any) => e.alive && e.id.startsWith('PG-')).length, 2);
    assert.equal(s.engines.filter((e: any) => e.leader).length, 1);
  } finally { await a.stop(); await b.stop(); }
});
