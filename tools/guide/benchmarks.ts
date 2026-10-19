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
import { PROFILES } from '../../server/src/sizing.js';

/**
 * Guide tables from measurements: the machine profiles of server/src/sizing.ts, and the load test
 * results in docs/benchmarks/*.json (written by tools/loadtest.mjs and tools/bigfiletest.mjs).
 */
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function profilesTable() {
  return `<table class="t"><thead><tr><th>Profile</th><th>Machine</th><th>Steps at once</th><th>Queue check</th><th>Engines (PostgreSQL)</th><th>Node memory per engine</th><th>Read files whole up to</th><th>Rows per streamed batch</th><th>Database</th></tr></thead><tbody>${
    PROFILES.map(p => `<tr><td><strong>${esc(p.name)}</strong></td><td>${esc(p.machine)}</td><td>${p.workers}</td><td>${p.pollMs} ms</td><td>${p.engines}</td><td>${p.nodeMemoryMb} MB</td><td>${p.readWholeMb} MB</td><td>${p.batchRows}</td><td>${esc(p.database)}</td></tr>`).join('')
  }</tbody></table>`;
}

function read(root: string, name: string) {
  const f = path.join(root, 'docs', 'benchmarks', `${name}.json`);
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
}

/** One results table: a row per scenario. */
function scenarios(r: any, caption: string) {
  if (!r?.scenarios?.length) return '';
  const rows = r.scenarios.map((s: any) => `<tr><td>${esc(s.exec || 'durable')}</td><td>${s.engines}</td><td>${s.kb} KB</td><td><strong>${s.stepsPerSec}</strong></td><td>${s.runsPerSec}</td><td>${s.stepMs.p50} / ${s.stepMs.p95} / ${s.stepMs.p99}</td><td>${s.queueMs ? `${s.queueMs.p95}` : '-'}</td><td>${s.runMs.p95}</td><td>${s.engineCpuCores}</td><td>${s.engineMaxMemMb} MB</td><td>${s.failed}</td><td>${s.repeated}</td></tr>`).join('');
  const rtt = r.scenarios.find((s: any) => s.dbRttMs)?.dbRttMs;
  return `<p class="h">${esc(caption)}</p><p class="muted">${esc(r.label)}; ${esc(r.database)}${rtt ? `, ${rtt} ms round trip to the database` : ''}; Node ${esc(r.node)}; ${r.scenarios[0].runs} runs of ${r.scenarios[0].steps} steps plus the trigger, ${r.scenarios[0].workers} steps at once per engine${r.scenarios[0].cpus ? `, each engine held to ${r.scenarios[0].cpus} core and ${r.scenarios[0].mem} MB` : ''}.</p>
<table class="t"><thead><tr><th>Execution</th><th>Engines</th><th>Output per step</th><th>Steps/s</th><th>Runs/s</th><th>Step ms p50 / p95 / p99</th><th>Queue wait p95 ms</th><th>Run p95 ms</th><th>Engine CPU (cores)</th><th>Engine memory</th><th>Failed</th><th>Repeated</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export function benchmarksSection(root: string) {
  const parts = [
    scenarios(read(root, 'async-after-local'), '1.7.6, asynchronous PostgreSQL storage: REST calls spread over the engines'),
    scenarios(read(root, 'async-before-local'), '1.7.5, the same scenarios (synchronous PostgreSQL connection)'),
    scenarios(read(root, 'async-after-remote'), '1.7.6 with the database on another machine (round trip measured in the table caption)'),
    scenarios(read(root, 'async-before-remote'), '1.7.5 with the database on another machine (the same proxy)'),
    scenarios(read(root, 'async-after-64kb'), '1.7.6, one engine, 64 KB outputs per step'),
    scenarios(read(root, 'pg-before'), 'Before the load work (1.6.0 as first released): PostgreSQL'),
    scenarios(read(root, 'pg-after'), '1.7.5: PostgreSQL, durable and in memory'),
    scenarios(read(root, 'pg-spread'), '1.7.5: REST calls spread over the engines (as behind a load balancer)'),
    scenarios(read(root, 'pg-workers32'), '1.7.5: 32 steps at once on one engine'),
    scenarios(read(root, 'pg-1core'), 'Small server: one core and 512 MB per engine, PostgreSQL'),
    scenarios(read(root, 'sqlite'), 'SQLite, one engine'),
    scenarios(read(root, 'sqlite-1core'), 'Small server: one core and 512 MB, SQLite'),
  ].filter(Boolean);
  const k = read(root, 'pg-kill');
  if (k?.scenarios?.length) {
    const s = k.scenarios[0];
    const by = Object.entries(s.byEngine || {}).map(([e, n]) => `${esc(e)} ${n}`).join(', ');
    parts.push(`<p class="h">An engine killed under load</p><p>Two engines, ${s.runs} REST calls spread over both gateways; the second engine was killed (no drain) when a third of the runs were done. Result: <strong>every run done, ${s.failed} failed</strong>, in ${s.seconds} s (steps finished per engine: ${by}). ${s.startErrors ? `${s.startErrors} calls that were in flight to the killed engine failed for their caller and were sent again to the other one, as a load balancer or a client retry does. ` : ''}The leader saw the dead engine after three missed heartbeats (15 s), put its running steps back in the queue, and the first engine finished them, also the runs of the calls that had failed. So a caller that retries can start a second run: make such Sutras safe to repeat (an idempotency key from the caller), as with any at-least-once system.</p>`);
  }
  const soak = read(root, 'soak')?.soak, trend = read(root, 'soak-memory')?.soak;
  if (soak) {
    const by = (soak.byStatus as string[]).map(esc).join('; ');
    parts.push(`<p class="h">${soak.soakMinutes} minutes of mixed work</p><p>Two engines for ${soak.soakMinutes} minutes: a timer every 5 seconds, a Sutra that waits 2 seconds, one that always fails after two retries, the 5-step benchmark Sutra, and a redeploy halfway. <strong>${soak.started.toLocaleString('en')} runs</strong> were started; ${by}. Runs still open at the end: <strong>${soak.stillOpen}</strong>. The timer ran exactly once per 5 seconds in the whole cluster (from the leader only).</p>`);
  }
  if (trend?.memEveryMinuteMb?.length) {
    const first = trend.memEveryMinuteMb.map((m: number[]) => m[0]);
    parts.push(`<p>Memory of the busier engine, every minute of a ${trend.soakMinutes}-minute soak (MB): ${first.join(', ')}. It grows while caches and the heap warm up in the first minutes, then stays level: no leak.</p>`);
  }
  const b = read(root, 'bigfile');
  if (b) parts.push(`<p class="h">A big file streamed on a small heap</p><p>One engine with Node held to <strong>${b.heapLimitMb} MB</strong> read a <strong>${b.fileMb} MB</strong> CSV file with Stream in batches (${b.batchRows} rows per batch, a step per batch): <strong>${esc(b.status)}</strong> in ${b.seconds} s (${b.mbPerSec} MB/s), ${b.steps} steps, peak memory of the process <strong>${b.rssPeakMb} MB</strong> (${b.rssStartMb} MB at the start), database ${b.dbMb} MB at the end with <em>Step data in history: none</em>.</p>`);
  return parts.join('\n') || '<p>No measurements yet: run <code>node tools/loadtest.mjs</code>.</p>';
}
