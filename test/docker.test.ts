/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { root, waitFor, type Proc } from './proc.js';

const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
const compose = fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8');
/** Instructions of the final stage, with line continuations joined. */
const finalStage = dockerfile.split(/^FROM /m).pop()!.replace(/\\\r?\n\s*/g, ' ');
const instr = (name: string) => finalStage.split(/\r?\n/).filter(l => l.startsWith(`${name} `)).map(l => l.slice(name.length + 1).trim());
const envOfImage = () => Object.fromEntries([...instr('ENV').join(' ').matchAll(/(\w+)=(\S+)/g)].map(m => [m[1], m[2]]));

test('the image runs as a non-root user, with health check, init, volumes and the documented ports', () => {
  assert.equal(instr('USER')[0], 'node');
  assert.match(instr('HEALTHCHECK')[0], /\/health/);
  assert.match(instr('ENTRYPOINT')[0], /tini/);
  assert.deepEqual(instr('EXPOSE')[0].split(/\s+/), ['4800', '8080', '8443']);
  const env = envOfImage();
  assert.equal(env.SUTRA_DATA_DIR, '/data');
  assert.equal(env.SUTRA_DEPLOY_DIR, '/deploy');
  assert.equal(env.SUTRA_ADMIN_HOST, '0.0.0.0', 'reachable from outside the container');
  assert.equal(env.SUTRA_LOG_FORMAT, 'json');
  assert.match(instr('CMD')[0], /dist\/server\/main\.js/);
  assert.match(dockerfile, /npm prune --omit=dev/, 'no development packages in the image');
});

test('the build context leaves out local state, secrets and build output', () => {
  const ignored = fs.readFileSync(path.join(root, '.dockerignore'), 'utf8').split(/\r?\n/).map(l => l.trim());
  for (const x of ['node_modules', 'data', 'dist', '.git', '.env', '*.sutra']) assert.ok(ignored.includes(x), `${x} is ignored`);
});

test('the Docker build context keeps every vendor review test required by the build gate', () => {
  const ignored = fs.readFileSync(path.join(root, '.dockerignore'), 'utf8').split(/\r?\n/).map(l => l.trim());
  const policy = JSON.parse(fs.readFileSync(path.join(root, 'vendor', 'vendor-lock.json'), 'utf8'));
  const testTreeIgnored = ignored.some(l => ['test', 'test/', 'test/*', 'test/**'].includes(l));
  if (!testTreeIgnored) return;
  for (const rule of Object.values(policy.packages) as any[]) {
    for (const rel of rule.tests || []) {
      if (rel.startsWith('test/')) assert.ok(ignored.includes(`!${rel}`), `${rel} must be available to npm run vendor:check in the Docker build`);
    }
  }
});

test('compose: a studio and a headless engine with a token, separate data, a read-only deploy folder and time to drain', () => {
  assert.match(compose, /studio:[\s\S]*SUTRA_MODE: studio/);
  assert.match(compose, /engine:[\s\S]*SUTRA_MODE: engine/);
  assert.match(compose, /SUTRA_ADMIN_TOKEN: \$\{SUTRA_ADMIN_TOKEN:\?/, 'compose refuses to start without a token');
  assert.match(compose, /\.\/deploy:\/deploy:ro/);
  assert.match(compose, /stop_grace_period: \d+s/);
  assert.match(compose, /studio-data:\/data/);
  assert.match(compose, /engine-data:\/data/);
});

test('smoke test: the compiled server started as the image starts it passes the image\'s own health check', async () => {
  const main = path.join(root, 'dist/server/main.js');
  assert.ok(fs.existsSync(main), 'run npm run build first (npm test does)');
  const env = { ...process.env, ...envOfImage(), SUTRA_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-img-')), SUTRA_DEPLOY_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-imgd-')),
    SUTRA_ADMIN_HOST: '127.0.0.1', SUTRA_ADMIN_PORT: '19210', SUTRA_GATEWAY_HTTP_PORT: '19220', SUTRA_GATEWAY_HTTPS_PORT: '19221', SUTRA_MASTER_KEY: crypto.randomBytes(32).toString('base64') };
  const [cmd, ...args] = JSON.parse(instr('CMD')[0]) as string[];
  const child = spawn(cmd === 'node' ? process.execPath : cmd, args, { cwd: root, env });
  let log = '';
  child.stdout.on('data', d => (log += d)); child.stderr.on('data', d => (log += d));
  const p: Proc = { child, out: () => log, admin: 'http://127.0.0.1:19210', http: 'http://127.0.0.1:19220', exited: new Promise(r => child.on('exit', r)), stop: async () => { child.kill(); await p.exited; } };
  try {
    await waitFor(`${p.admin}/ready`, p);
    const hc = JSON.parse(instr('HEALTHCHECK')[0].replace(/^.*?CMD\s+/, '')) as string[];
    const r = spawnSync(process.execPath, hc.slice(1), { env, encoding: 'utf8', timeout: 20000 });
    assert.equal(r.status, 0, `health check: ${r.stderr}`);
    assert.equal((await fetch(`${p.admin}/`)).status, 200, 'the studio is served in studio mode');
    assert.match(log, /SutraFlow studio/);
  } finally { await p.stop(); }
});

test('the image builds (when Docker is installed)', { skip: spawnSync('docker', ['--version']).status !== 0 && 'Docker is not installed here' }, () => {
  const r = spawnSync('docker', ['build', '-t', 'sutraflow:test', '.'], { cwd: root, encoding: 'utf8', timeout: 900000 });
  assert.equal(r.status, 0, r.stderr);
});

test('cluster compose: PostgreSQL, a studio and two engines with one master key and token', () => {
  const c = fs.readFileSync(path.join(root, 'docker-compose.cluster.yml'), 'utf8');
  assert.match(c, /image: postgres:\d+/);
  assert.match(c, /SUTRA_DB: postgres:\/\/sutra:/);
  assert.match(c, /SUTRA_MASTER_KEY: \$\{SUTRA_MASTER_KEY:\?/, 'one vault key for every engine');
  assert.match(c, /engine-1:[\s\S]*SUTRA_ENGINE_ID: engine-1/);
  assert.match(c, /engine-2:[\s\S]*SUTRA_ENGINE_ID: engine-2/);
  assert.match(c, /condition: service_healthy/, 'engines wait for the database');
  assert.match(c, /SUTRA_WORKERS: "0"/, 'the studio leaves the work to the engines');
});
