/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 2.0.0
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as acme from 'acme-client';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the committed vendor policy and trees pass the offline build gate', () => {
  const result = spawnSync(process.execPath, [path.join(root, 'tools', 'check-vendor.mjs')], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /acme-client .*runtime, shipped/);
  assert.match(result.stdout, /ftp-srv .*test, test only/);
});

test('the maintained ACME client still provides SutraFlow certificate APIs', async () => {
  const accountKey = await acme.crypto.createPrivateKey();
  assert.match(accountKey.toString(), /BEGIN (?:RSA )?PRIVATE KEY/);
  const [certificateKey, csr] = await acme.crypto.createCsr({ commonName: 'gateway.example.test', altNames: ['gateway.example.test', 'api.example.test'] });
  assert.match(certificateKey.toString(), /BEGIN (?:RSA )?PRIVATE KEY/);
  assert.match(csr.toString(), /BEGIN CERTIFICATE REQUEST/);
  assert.match(acme.directory.letsencrypt.staging, /^https:/);
  const client = new acme.Client({ directoryUrl: acme.directory.letsencrypt.staging, accountKey });
  assert.equal(typeof client.auto, 'function');
});
