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
  return `<p class="h">${esc(caption)}</p><p class="muted">${esc(r.label)}; ${esc(r.database)}; Node ${esc(r.node)}; ${r.scenarios[0].runs} runs of ${r.scenarios[0].steps} steps plus the trigger, ${r.scenarios[0].workers} steps at once per engine${r.scenarios[0].cpus ? `, each engine held to ${r.scenarios[0].cpus} core and ${r.scenarios[0].mem} MB` : ''}.</p>
<table class="t"><thead><tr><th>Execution</th><th>Engines</th><th>Output per step</th><th>Steps/s</th><th>Runs/s</th><th>Step ms p50 / p95 / p99</th><th>Queue wait p95 ms</th><th>Run p95 ms</th><th>Engine CPU (cores)</th><th>Engine memory</th><th>Failed</th><th>Repeated</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export function benchmarksSection(root: string) {
  const parts = [
    scenarios(read(root, 'pg-before'), 'Before this release (1.6.0 as first released): PostgreSQL'),
    scenarios(read(root, 'pg-after'), 'This release: PostgreSQL, durable and in memory'),
    scenarios(read(root, 'pg-spread'), 'This release: REST calls spread over the engines (as behind a load balancer)'),
    scenarios(read(root, 'pg-workers32'), 'This release: 32 steps at once on one engine'),
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
  const b = read(root, 'bigfile');
  if (b) parts.push(`<p class="h">A big file streamed on a small heap</p><p>One engine with Node held to <strong>${b.heapLimitMb} MB</strong> read a <strong>${b.fileMb} MB</strong> CSV file with Stream in batches (${b.batchRows} rows per batch, a step per batch): <strong>${esc(b.status)}</strong> in ${b.seconds} s (${b.mbPerSec} MB/s), ${b.steps} steps, peak memory of the process <strong>${b.rssPeakMb} MB</strong> (${b.rssStartMb} MB at the start), database ${b.dbMb} MB at the end with <em>Step data in history: none</em>.</p>`);
  return parts.join('\n') || '<p>No measurements yet: run <code>node tools/loadtest.mjs</code>.</p>';
}
