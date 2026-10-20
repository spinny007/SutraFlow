/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { config } from './config.js';
import { boot } from './index.js';
import { gatewayStatus } from './gateway/gateway.js';

// A promise that fails with nobody to catch it (a run start while the database is unreachable, say)
// is logged; the engine keeps serving instead of stopping with every step it was running.
process.on('unhandledRejection', e => { console.error('Unhandled error (the engine keeps running):', (e as any)?.stack || e); });

boot({ exitOnDrain: true }).then(({ stop }) => {
  console.log(config.mode === 'engine'
    ? `SutraFlow engine ${config.engineId} (headless): health and automation API on http://${config.adminHost}:${config.adminPort}`
    : `SutraFlow studio:  http://${config.adminHost}:${config.adminPort}`);
  console.log(`Gateway:           ${gatewayStatus.http || '(not listening)'} ${gatewayStatus.https}`);
  if (gatewayStatus.error) console.log(`Gateway problem:   ${gatewayStatus.error}`);
  // SIGTERM (docker stop, Kubernetes) and Ctrl+C drain running steps first (SUTRA_DRAIN_MS).
  const shutdown = () => { console.log('Stopping: draining running steps'); stop().finally(() => process.exit(0)); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}).catch(e => {
  console.error(e);
  process.exit(1);
});
