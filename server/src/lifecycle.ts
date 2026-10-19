import { config, version } from './config.js';
import { q, dbKind } from './db.js';
import { gatewayStatus } from './gateway/gateway.js';

/**
 * Health and readiness for load balancers and orchestrators.
 *  /health  the process is alive (liveness).
 *  /ready   it should receive traffic: storage answers, packages are deployed, the gateway listens,
 *           and it is not draining for shutdown (readiness).
 */
export const lifecycle = {
  startedAt: new Date().toISOString(),
  packagesDeployed: false,
  draining: false,
  gatewayWanted: true,
  problems: [] as string[],
  /** Graceful stop of this server, set by boot(); used by signals and POST /api/engine/drain. */
  shutdown: null as null | (() => Promise<void>),
};

export function health() {
  return { ok: true, version, mode: config.mode, environment: config.environment, engine: config.engineId, database: dbKind(), startedAt: lifecycle.startedAt };
}

export function readiness() {
  const reasons: string[] = [];
  try { q.get('select 1 as ok'); } catch (e: any) { reasons.push(`storage: ${e.message}`); }
  if (!lifecycle.packagesDeployed) reasons.push('deploying packages');
  if (lifecycle.draining) reasons.push('draining for shutdown');
  if (lifecycle.gatewayWanted && !gatewayStatus.http && !gatewayStatus.https) reasons.push(`gateway not listening${gatewayStatus.error ? `: ${gatewayStatus.error}` : ''}`);
  reasons.push(...lifecycle.problems);
  return { ready: !reasons.length, reasons };
}
