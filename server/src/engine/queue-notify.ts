/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.9.0
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { createRequire } from 'node:module';
import { config } from '../config.js';

const require = createRequire(import.meta.url);

/** PostgreSQL queue wake hint. Polling remains the durable fallback and source of truth. */
export class QueueNotifications {
  private client: any;
  private stopped = true;
  private retry: NodeJS.Timeout | null = null;

  constructor(private readonly wake: () => void) {}

  get enabled() {
    return config.pgNotify && /^postgres(ql)?:/.test(config.dbUrl);
  }

  async start() {
    if (!this.enabled || !this.stopped) return;
    this.stopped = false;
    await this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    const client = this.client;
    this.client = undefined;
    void client?.end().catch(() => {});
  }

  private later() {
    if (this.stopped || this.retry) return;
    this.retry = setTimeout(() => { this.retry = null; void this.connect(); }, 1000);
    this.retry.unref?.();
  }

  private async connect() {
    if (this.stopped || this.client) return;
    const pg = require('pg');
    const password = process.env.SUTRA_DB_PASSWORD;
    const client = new pg.Client({ connectionString: config.dbUrl, application_name: 'sutraflow-listener', ...(password ? { password } : {}) });
    this.client = client;
    const lost = () => {
      if (this.client !== client) return;
      this.client = undefined;
      void client.end().catch(() => {});
      this.later();
    };
    client.on('notification', (m: any) => { if (m.channel === 'sutraflow_queue') this.wake(); });
    client.on('error', lost);
    client.on('end', lost);
    try {
      await client.connect();
      await client.query('listen sutraflow_queue');
    } catch {
      lost();
    }
  }
}
