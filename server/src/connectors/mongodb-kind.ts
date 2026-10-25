/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 2.0.10
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available; see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import type { Field, ResourceKind } from '../engine/types.js';
const F = (k: string, label: string, type: Field['type'], def?: any, extra: Partial<Field> = {}): Field => ({ k, label, type, def, ...extra });
export const mongoAuthMode = (config: Record<string, any>) => config.authMode || (config.uriSecret ? 'URI secret' : 'username/password');
/** Metadata is independent of runtime resource lookup to avoid registry initialization cycles. */
export const MONGODB_KIND: ResourceKind = {
  kind: 'mongodb', name: 'MongoDB', desc: 'Native MongoDB connection with project-specific credentials and a small reusable pool. Atlas M0 is the tested baseline, not a compatibility claim for every MongoDB-compatible service.',
  fields: [
    F('authMode', 'Authentication configuration', 'select', 'username/password', { options: ['username/password', 'URI secret', 'X.509'], help: 'A: encrypted complete URI. B: host plus separate credentials. X.509: certificate-based authentication. Each project can use its own connection.' }),
    F('host', 'Host', 'text', '', { showIf: { k: 'authMode', in: ['username/password', 'X.509'] }, placeholder: 'cluster.example.mongodb.net', help: 'No username/password or scheme. Or use the optional advanced server URI below.' }),
    F('srv', 'DNS SRV connection', 'bool', true, { showIf: { k: 'authMode', in: ['username/password', 'X.509'] }, help: 'On for Atlas SRV hosts. Off uses Host and Port directly.' }),
    F('port', 'Port', 'number', 27017, { showIf: { k: 'srv', in: [false] } }),
    F('uri', 'Advanced server URI (optional; no credentials)', 'text', '', { showIf: { k: 'authMode', in: ['username/password', 'X.509'] }, placeholder: 'Leave blank when using Host', help: 'Overrides Host when supplied. For Atlas host plus username/password, leave this blank. A complete URI containing credentials belongs only in a Secret GV with URI secret authentication.' }),
    F('username', 'Username / certificate subject (optional for X.509)', 'text', '', { showIf: { k: 'authMode', in: ['username/password', 'X.509'] } }),
    F('passwordSecret', 'Password', 'secret', '', { showIf: { k: 'authMode', in: ['username/password'] }, help: 'Enter and store the password here, or select a stored secret. Values are encrypted and never read back.' }),
    F('authSource', 'Authentication database', 'text', 'admin', { showIf: { k: 'authMode', in: ['username/password'] }, help: 'Atlas normally uses admin; this is separate from the application database.' }),
    F('authMechanism', 'Authentication mechanism', 'select', 'DEFAULT', { options: ['DEFAULT', 'SCRAM-SHA-256', 'SCRAM-SHA-1'], showIf: { k: 'authMode', in: ['username/password'] }, help: 'DEFAULT lets the official driver negotiate. Only choose a fixed mechanism when required by your server.' }),
    F('uriSecret', 'Complete URI — Secret property', 'secret', '', { showIf: { k: 'authMode', in: ['URI secret'] }, help: 'Select a Secret GV containing the complete mongodb+srv:// or mongodb:// URI, including credentials. Or create a named Secret project variable here. DNS SRV requires a working process DNS resolver.' }),
    F('tlsEnabled', 'TLS enabled', 'bool', true, { help: 'Keep On for Atlas and remote servers. Off is accepted only for a direct loopback development connection; never for X.509.' }),
    F('caCertSecret', 'Trusted CA certificates (PEM)', 'secret', '', { showIf: { k: 'tlsEnabled', in: [true] }, help: 'Optional private/enterprise CA bundle. Server certificate and hostname verification stay enabled.' }),
    F('clientCertPem', 'Client certificate (PEM)', 'code', '', { showIf: { k: 'authMode', in: ['X.509'] } }),
    F('clientKeySecret', 'Client private key', 'secret', '', { showIf: { k: 'authMode', in: ['X.509'] } }),
    F('clientKeyPassSecret', 'Client private-key passphrase (optional)', 'secret', '', { showIf: { k: 'authMode', in: ['X.509'] } }),
    F('readPreference', 'Read preference', 'select', 'primary', { options: ['primary', 'primaryPreferred', 'secondary', 'secondaryPreferred', 'nearest'] }),
    F('capabilities', 'Deployment capabilities', 'select', 'Atlas M0 baseline', { options: ['Atlas M0 baseline', 'General MongoDB'], help: 'M0 baseline retains its limits. General enables explicitly opted-in aggregation disk/write-stage options; server capabilities and privileges still apply. Compatible services require separate certification.' }),
    F('database', 'Database', 'text', 'sutraflow_test', { help: 'Explicit application database; authentication database remains an option in the secret URI. Supports project/engine variables.' }),
    F('maxPoolSize', 'Maximum pooled connections', 'number', 5),
    F('timeoutMs', 'Operation timeout (ms)', 'number', 15000),
    F('serverSelectionTimeoutMS', 'Server selection timeout (ms)', 'number', 15000),
  ],
};
