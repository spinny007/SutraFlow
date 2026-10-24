/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 2.0.9
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readTestPem } from './pem-fixtures.js';
test('PEM fixture reader accepts process-only values without reading the configured path', () => {
  process.env.SUTRA_FIXTURE_PEM = '-----BEGIN CERTIFICATE----- c2Ft cGxl -----END CERTIFICATE-----';
  process.env.SUTRA_FIXTURE_FILE = 'does-not-exist';
  try { assert.equal(readTestPem('SUTRA_FIXTURE_FILE'), '-----BEGIN CERTIFICATE-----\nc2FtcGxl\n-----END CERTIFICATE-----'); }
  finally { delete process.env.SUTRA_FIXTURE_PEM; delete process.env.SUTRA_FIXTURE_FILE; }
});
test('PEM fixture file fallback stays compatible and missing settings return no material', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-public-pem-'));
  const file = path.join(dir, 'public-cert.txt');
  fs.writeFileSync(file, 'public test fixture');
  process.env.SUTRA_FIXTURE_FILE = file;
  try { assert.equal(readTestPem('SUTRA_FIXTURE_FILE'), 'public test fixture'); delete process.env.SUTRA_FIXTURE_FILE; assert.equal(readTestPem('SUTRA_FIXTURE_FILE'), ''); }
  finally { delete process.env.SUTRA_FIXTURE_FILE; fs.unlinkSync(file); fs.rmdirSync(dir); }
});
test('invalid inline material fails without reflecting its contents in the error', () => {
  process.env.SUTRA_FIXTURE_PEM = 'NEVER-ECHO-THIS';
  try { assert.throws(() => readTestPem('SUTRA_FIXTURE_FILE'), e => e instanceof Error && !e.message.includes('NEVER-ECHO-THIS')); }
  finally { delete process.env.SUTRA_FIXTURE_PEM; }
});
