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
  workerConcurrency: Number(process.env.SUTRA_WORKERS || 16),
  /** Safety cap on steps per run (protects against accidental loops). */
  maxStepsPerRun: Number(process.env.SUTRA_MAX_STEPS || 10000),
  /** Default time a REST/SOAP caller waits for the flow to reply. */
  replyTimeoutMs: Number(process.env.SUTRA_REPLY_TIMEOUT_MS || 60000),
  webDir: process.env.SUTRA_WEB_DIR || '',
};

export function ensureDataDir() {
  fs.mkdirSync(config.dataDir, { recursive: true });
}
