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

/** Boots the single-process server: engine workers, timers, gateway listeners and the studio. */
export async function boot(opts: { dbFile?: string; listenAdmin?: boolean } = {}) {
  openDb(opts.dbFile);
  engine.register(allActivities);
  setVariableHooks({
    getProject: (pid, name) => effectiveVariables(pid).values[name],
    setProject: (pid, name, value) => setRuntimeVariable(pid, name, value),
    getEngine: name => engineVariableValues()[name],
    setEngine: (name, value) => setEngineVariable(name, value),
  });
  loadOpsFiles(m => console.log(m));
  engine.start();
  const relisten = () => { rebuildListeners().catch(e => console.error('Listeners:', e)); };
  onDeploymentsChange.push(rebuildRoutes, rebuildSchedules, relisten);
  onResourceChange.push(() => { rebuildRoutes(); relisten(); });
  onProjectChange.push(() => relisten());
  rebuildSchedules();
  relisten();
  await startGateway();
  startRenewal(reloadTls);
  const admin = await buildAdmin();
  if (opts.listenAdmin !== false) {
    const { config } = await import('./config.js');
    await admin.listen({ host: config.adminHost, port: config.adminPort });
  }
  return {
    admin,
    async stop() {
      stopSchedules();
      await stopListeners();
      await closeBusPublishers();
      await closeDbPools();
      engine.stop();
      await stopGateway();
      await admin.close();
    },
  };
}
