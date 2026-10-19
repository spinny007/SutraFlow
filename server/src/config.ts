import os from 'node:os';
import { profileFor } from './sizing.js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Install folder: two levels above this file (server/src or dist/server). */
export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Product version, from package.json. */
export const version: string = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')).version || '0.0.0'; } catch { return '0.0.0'; }
})();

/** Process-level configuration. Everything else (gateway ports, TLS, policies) lives in the database and is edited in the studio. */
export const config = {
  dataDir: path.resolve(process.env.SUTRA_DATA_DIR || path.join(rootDir, 'data')),
  adminHost: process.env.SUTRA_ADMIN_HOST || '127.0.0.1',
  adminPort: Number(process.env.SUTRA_ADMIN_PORT || 4800),
  /** Default gateway ports, used until changed in Server settings. */
  gatewayHttpPort: Number(process.env.SUTRA_GATEWAY_HTTP_PORT || 8080),
  gatewayHttpsPort: Number(process.env.SUTRA_GATEWAY_HTTPS_PORT || 8443),
  /** Steps executed at the same time across all runs. */
  /** Steps at once: SUTRA_WORKERS, or the recommendation for this machine (sizing.ts). */
  workerConcurrency: Number(process.env.SUTRA_WORKERS || profileFor().workers),
  /** Steps at once for Sutras that run in memory (0 = the same as SUTRA_WORKERS). */
  memoryWorkers: Number(process.env.SUTRA_MEMORY_WORKERS || 0),
  /**
   * How long the admin and gateway servers keep an idle connection open, in ms. Longer than the idle
   * time of a load balancer in front (60 s on most), so it never sends a request on a connection the
   * server is closing (a reset, or a 502 from the load balancer).
   */
  keepAliveMs: Math.max(1000, Number(process.env.SUTRA_KEEPALIVE_MS || 65000)),
  /** How often an idle engine looks for due steps in the queue, in ms. */
  pollMs: Math.max(20, Number(process.env.SUTRA_POLL_MS || profileFor().pollMs)),
  /** Safety cap on steps per run (protects against accidental loops). */
  maxStepsPerRun: Number(process.env.SUTRA_MAX_STEPS || 10000),
  /** Default time a REST/SOAP caller waits for the flow to reply. */
  replyTimeoutMs: Number(process.env.SUTRA_REPLY_TIMEOUT_MS || 60000),
  webDir: process.env.SUTRA_WEB_DIR || '',
  /** studio: studio, engine and gateway in one process. engine: headless, no studio and no editing API. */
  mode: (process.env.SUTRA_MODE === 'engine' ? 'engine' : 'studio') as 'studio' | 'engine',
  /** What this server is for. On production, only administrators may clear project logs. Default: development for a studio, production for a headless engine. */
  environment: (['development', 'test', 'production'].includes(String(process.env.SUTRA_ENVIRONMENT || '').toLowerCase())
    ? String(process.env.SUTRA_ENVIRONMENT).toLowerCase() : process.env.SUTRA_MODE === 'engine' ? 'production' : 'development') as 'development' | 'test' | 'production',
  /** Bearer token for the command-line tool and automation (Authorization: Bearer ...); acts as an administrator. */
  adminToken: process.env.SUTRA_ADMIN_TOKEN || '',
  /** Folder of .sutra packages deployed when the server starts (headless engines, container images). */
  deployDir: process.env.SUTRA_DEPLOY_DIR || '',
  /** Storage: empty = SQLite in the data folder; postgres://... for PostgreSQL (several engines); pglite: for tests. */
  // The PostgreSQL password may be kept apart as SUTRA_DB_PASSWORD, so the address can be shown and logged.
  dbUrl: ((u: string, pw?: string) => (pw && /^postgres(ql)?:\/\/[^:@/]+@/.test(u) ? u.replace(/^(postgres(?:ql)?:\/\/[^:@/]+)@/, (_m, a) => `${a}:${encodeURIComponent(pw)}@`) : u))(process.env.SUTRA_DB || '', process.env.SUTRA_DB_PASSWORD),
  /** This engine's name in a cluster. */
  engineId: process.env.SUTRA_ENGINE_ID || `${os.hostname()}-${process.pid}`,
  /** On shutdown, how long running steps may finish before they are handed back for another engine. */
  drainMs: Number(process.env.SUTRA_DRAIN_MS || 30000),
  /** Engines renew their heartbeat this often; one silent for three beats is presumed dead. */
  heartbeatMs: Number(process.env.SUTRA_HEARTBEAT_MS || 5000),
  /** Finished runs older than this are deleted (0 = keep forever). */
  runRetentionDays: Number(process.env.SUTRA_RUN_RETENTION_DAYS ?? 30),
  /** text (default) or json: engine events on standard output as JSON lines. */
  logFormat: (process.env.SUTRA_LOG_FORMAT === 'json' ? 'json' : 'text') as 'text' | 'json',
  /** OpenTelemetry: traces of runs and steps are sent to this OTLP/HTTP endpoint when set. */
  otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || '',
  serviceName: process.env.OTEL_SERVICE_NAME || 'sutraflow',
  /** Audit entries older than this are deleted (0 = keep forever). */
  auditRetentionDays: Number(process.env.SUTRA_AUDIT_RETENTION_DAYS ?? 365),
  /** Share of runs traced (OpenTelemetry), from 0 to 1. Changed live by tuning. */
  traceSampling: Math.min(1, Math.max(0, Number(process.env.SUTRA_TRACE_SAMPLING ?? 1))),
  /** When set, GET /metrics needs Authorization: Bearer <this>. */
  metricsToken: process.env.SUTRA_METRICS_TOKEN || '',
};

export function ensureDataDir() {
  fs.mkdirSync(config.dataDir, { recursive: true });
}
