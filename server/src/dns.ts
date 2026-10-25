/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 2.0.10
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available; see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';
export function processDnsServers(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  const servers = value.split(',').map(s => s.trim());
  if (servers.length > 8 || servers.some(s => !isIP(s))) throw new Error('SUTRA_DNS_SERVERS must be a comma-separated list of up to eight DNS server IP addresses.');
  return [...new Set(servers)];
}
let configured = '';
/** Startup-only, administrator-controlled override. Never changes Windows DNS or disables TLS. */
export function configureProcessDns(value = process.env.SUTRA_DNS_SERVERS) {
  const servers = processDnsServers(value), key = servers.join(',');
  if (key && key !== configured) { dns.setServers(servers); configured = key; }
}
