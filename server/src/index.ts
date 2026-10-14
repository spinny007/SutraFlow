import { openDb } from './db.js';
import { engine } from './engine/engine.js';
import { allActivities } from './palettes/index.js';
import { onDeploymentsChange } from './flows.js';
import { onResourceChange } from './resources.js';
import { rebuildSchedules, stopSchedules } from './scheduler.js';
import { rebuildRoutes, startGateway, stopGateway, reloadTls } from './gateway/gateway.js';
import { startRenewal } from './gateway/tls.js';
import { buildAdmin } from './api.js';
import { loadOpsFiles, onProjectChange, effectiveVariables, setRuntimeVariable, engineVariableValues, setEngineVariable } from './projects.js';
import { setVariableHooks } from './expr.js';
import { rebuildListeners, stopListeners } from './listeners.js';
import { closeBusPublishers } from './connectors/bus.js';
import { closeDbPools } from './connectors/db.js';
import { config } from './config.js';
import { lifecycle } from './lifecycle.js';
import { deployPackage, readPackage, packageHistory } from './packages.js';
import { listProjects } from './projects.js';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Deploys every .sutra package in the folder (in name order) whose checksum is not already the
 * latest deployment of its project. A package that cannot be deployed stops the start: a container
 * should fail loudly rather than serve an incomplete release.
 */
function deployFolder(dir: string) {
  if (!dir) return;
  if (!fs.existsSync(dir)) throw new Error(`SUTRA_DEPLOY_DIR ${dir} does not exist`);
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
export async function boot(opts: { dbFile?: string; listenAdmin?: boolean; gateway?: boolean } = {}) {
  openDb(opts.dbFile);
  engine.register(allActivities);
  lifecycle.gatewayWanted = opts.gateway !== false;
  lifecycle.packagesDeployed = false;
  lifecycle.draining = false;
  setVariableHooks({
    getProject: (pid, name) => effectiveVariables(pid).values[name],
    setProject: (pid, name, value) => setRuntimeVariable(pid, name, value),
    getEngine: name => engineVariableValues()[name],
    setEngine: (name, value) => setEngineVariable(name, value),
  });
  loadOpsFiles(m => console.log(m));
  deployFolder(config.deployDir);
  lifecycle.packagesDeployed = true;
  engine.start();
  const relisten = () => { rebuildListeners().catch(e => console.error('Listeners:', e)); };
  onDeploymentsChange.push(rebuildRoutes, rebuildSchedules, relisten);
  onResourceChange.push(() => { rebuildRoutes(); relisten(); });
  onProjectChange.push(() => relisten());
  rebuildSchedules();
  relisten();
  if (opts.gateway !== false) {
    await startGateway();
    startRenewal(reloadTls);
  }
  const admin = await buildAdmin();
  if (opts.listenAdmin !== false) await admin.listen({ host: config.adminHost, port: config.adminPort });
  return {
    admin,
    async stop() {
      stopSchedules();
      await stopListeners();
      await closeBusPublishers();
      await closeDbPools();
      engine.stop();
      if (opts.gateway !== false) await stopGateway();
      await admin.close();
    },
  };
}
