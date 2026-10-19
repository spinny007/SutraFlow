/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { openDb, q } from './db.js';
import { memTableByName, memPeek, stopMemTables } from './memtables.js';
import { fileSamplesOnce } from './samples.js';
import { engine } from './engine/engine.js';
import { allActivities } from './palettes/index.js';
import { onDeploymentsChange } from './flows.js';
import { onResourceChange } from './resources.js';
import { rebuildSchedules, stopSchedules } from './scheduler.js';
import { rebuildRoutes, startGateway, stopGateway, reloadTls } from './gateway/gateway.js';
import { startRenewal } from './gateway/tls.js';
import { buildAdmin } from './api.js';
import { loadOpsFiles, onProjectChange, effectiveVariables, setRuntimeVariable, engineVariableValues, setEngineVariable, forgetCachedSettings } from './projects.js';
import { setVariableHooks } from './expr.js';
import { rebuildListeners, stopListeners } from './listeners.js';
import { closeBusPublishers } from './connectors/bus.js';
import { closeDbPools } from './connectors/db.js';
import { config } from './config.js';
import { lifecycle, closeServer } from './lifecycle.js';
import { startCluster, stopCluster, bumpDeployGen, leaveLeadership, cluster } from './cluster.js';
import { housekeeping } from './housekeeping.js';
import { ensureBuiltins } from './access.js';
import { evaluate as evaluateAlerts } from './alerts.js';
import { applyTuning, onTuningChange, onWorkersChange, onPollChange } from './tuning.js';
import { onMemoryRunProject } from './guard.js';
import { flushTracing } from './tracing.js';
import { deployPackage, readPackage, packageHistory } from './packages.js';
import { listProjects } from './projects.js';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Deploys every .sutra package in the folder (in name order) whose checksum is not already the
 * latest deployment of its project. A package that cannot be deployed stops the start: a container
 * should fail loudly rather than serve an incomplete release.
 */
async function deployFolder(dir: string) {
  if (!dir) return;
  if (!fs.existsSync(dir)) throw new Error(`SUTRA_DEPLOY_DIR ${dir} does not exist`);
  // Replicas start with the same folder: one deploys while the others wait, then find it done.
  const lock = await takeLock('deploy-folder', 120000);
  try { deployFolderLocked(dir); } finally { lock(); }
}

/** A cluster-wide lock in the leases table; returns its release. */
async function takeLock(name: string, waitMs: number) {
  const end = Date.now() + waitMs;
  for (;;) {
    const t = Date.now();
    q.run(`insert into leases(name, holder, expires_at) values(?, ?, ?) on conflict(name) do nothing`, name, config.engineId, t + 60000);
    const got = Number(q.run(`update leases set holder = ?, expires_at = ? where name = ? and (holder = ? or expires_at < ?)`, config.engineId, t + 60000, name, config.engineId, t).changes) > 0;
    if (got) return () => { q.run('delete from leases where name = ? and holder = ?', name, config.engineId); };
    if (Date.now() > end) throw new Error(`Timed out waiting for the ${name} lock`);
    await new Promise(r => setTimeout(r, 200));
  }
}

function deployFolderLocked(dir: string) {
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.sutra')).sort()) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    let pkg;
    try { pkg = readPackage(text); } catch (e: any) { throw new Error(`${f}: ${e.message}`); }
    const project = listProjects().find(p => p.name.toLowerCase() === pkg.project.name.toLowerCase());
    if (project && packageHistory(project.id)[0]?.checksum === pkg.checksum) { console.log(`Package ${f}: already deployed`); continue; }
    try {
      const r = deployPackage(pkg, { by: 'deploy folder' });
      console.log(`Package ${f}: ${r.package.name} ${r.package.version} deployed (${r.sutras.length} Sutras${r.undeployed.length ? `, ${r.undeployed.length} undeployed` : ''})`);
    } catch (e: any) { throw new Error(`${f}: ${e.message}`); }
  }
}

/**
 * Boots the server: engine workers, timers, gateway listeners and the studio (SUTRA_MODE=studio),
 * or the same without the studio (SUTRA_MODE=engine). Packages in SUTRA_DEPLOY_DIR are deployed first.
 */
export async function boot(opts: { dbFile?: string; listenAdmin?: boolean; gateway?: boolean; exitOnDrain?: boolean } = {}) {
  openDb(opts.dbFile);
  ensureBuiltins();
  engine.register(allActivities);
  lifecycle.gatewayWanted = opts.gateway !== false;
  lifecycle.packagesDeployed = false;
  lifecycle.draining = false;
  setVariableHooks({
    getProject: (pid, name) => effectiveVariables(pid).values[name],
    setProject: (pid, name, value) => setRuntimeVariable(pid, name, value),
    getEngine: name => engineVariableValues()[name],
    setEngine: (name, value) => setEngineVariable(name, value),
    memoryLookup: (pid, table, key, field) => {
      const t = memTableByName(pid, table);
      const row = t ? memPeek(t, key) : undefined;
      return row === undefined ? null : field ? row?.[field] ?? null : row;
    },
  });
  loadOpsFiles(m => console.log(m));
  fileSamplesOnce();
  await deployFolder(config.deployDir);
  lifecycle.packagesDeployed = true;
  // Tuning from the Admin Console: applied now and whenever any engine changes it.
  onWorkersChange(n => { engine.concurrency = n; engine.pump(); });
  onPollChange(ms => engine.setPollMs(ms));
  onMemoryRunProject(id => engine.memoryRun(id)?.project_id ?? undefined);
  onTuningChange(bumpDeployGen);
  applyTuning();
  engine.start();
  // Timers and polling listeners run once per cluster, on the leader; routes are served by every engine.
  const relisten = () => { if (cluster.leader) rebuildListeners().catch(e => console.error('Listeners:', e)); };
  const reschedule = () => { if (cluster.leader) rebuildSchedules(); };
  onDeploymentsChange.push(rebuildRoutes, reschedule, relisten, bumpDeployGen);
  onResourceChange.push(() => { rebuildRoutes(); relisten(); bumpDeployGen(); });
  onProjectChange.push(() => { relisten(); bumpDeployGen(); });
  startCluster({
    becameLeader: () => { rebuildSchedules(); rebuildListeners().catch(e => console.error('Listeners:', e)); },
    lostLeader: () => { stopSchedules(); stopListeners().catch(() => {}); },
    deploymentsChanged: () => { forgetCachedSettings(); applyTuning(); rebuildRoutes(); reschedule(); relisten(); },
    housekeeping: () => { try { housekeeping(); } catch (e) { console.error('Housekeeping:', e); } },
    alerts: () => { evaluateAlerts().catch(e => console.error('Alerts:', e)); },
    drainRequested: () => { console.log('Drain requested from the Admin Console'); lifecycle.shutdown?.().finally(() => { if (opts.exitOnDrain) process.exit(0); }); },
  });
  rebuildRoutes();
  if (opts.gateway !== false) {
    await startGateway();
    startRenewal(reloadTls);
  }
  const admin = await buildAdmin();
  if (opts.listenAdmin !== false) await admin.listen({ host: config.adminHost, port: config.adminPort });
  let stopping: Promise<void> | null = null;
  const stop = () => (stopping ||= (async () => {
    // 1. Not ready: load balancers stop sending new requests. 2. Another engine takes over timers and
    // listeners. 3. Running steps finish, or go back to the queue for another engine. 4. Close.
    lifecycle.draining = true;
    leaveLeadership();
    stopSchedules();
    await stopListeners();
    const d = await engine.drain(config.drainMs);
    if (d.handedOver) console.log(`Drain: ${d.handedOver} running steps handed back to the queue`);
    // Callers still waiting on this gateway get their replies (run elsewhere) before it closes.
    if (opts.gateway !== false) await stopGateway();
    await closeBusPublishers();
    await closeDbPools();
    engine.stop();
    stopMemTables();
    await flushTracing();
    stopCluster();
    await closeServer(admin);
  })());
  lifecycle.shutdown = stop;
  return { admin, stop };
}
