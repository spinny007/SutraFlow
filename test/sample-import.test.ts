/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 2.0.7
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importSamplesWithCatalog } from '../web/src/sample-import.js';

test('sample import waits for flow and shared schema/resource catalog refresh before opening the result', async () => {
  let releaseCreate!: (value: { id: string }[]) => void, releaseCatalog!: () => void, catalogStarted!: () => void;
  const created = new Promise<{ id: string }[]>(resolve => { releaseCreate = resolve; });
  const catalog = new Promise<void>(resolve => { releaseCatalog = resolve; });
  const started = new Promise<void>(resolve => { catalogStarted = resolve; });
  const events: string[] = [];
  let completed = false;
  const importing = importSamplesWithCatalog(
    () => { events.push('create'); return created; },
    async () => { events.push('flows'); },
    async () => { events.push('catalog'); catalogStarted(); await catalog; },
  ).then(added => { completed = true; events.push('open'); return added; });
  assert.deepEqual(events, ['create']);
  const result = [{ id: 'new-flow-with-schema' }];
  releaseCreate(result); await started;
  assert.deepEqual(events, ['create', 'flows', 'catalog']);
  assert.equal(completed, false, 'new flow must not open against stale schemas');
  releaseCatalog(); assert.equal(await importing, result);
  assert.deepEqual(events, ['create', 'flows', 'catalog', 'open']);
});

test('failed sample import/refresh is surfaced rather than reporting a fully refreshed import', async () => {
  let refreshes = 0;
  await assert.rejects(importSamplesWithCatalog(async () => { throw new Error('import failed'); }, async () => { refreshes++; }, async () => { refreshes++; }), /import failed/);
  assert.equal(refreshes, 0);
  await assert.rejects(importSamplesWithCatalog(async () => ['created'], async () => {}, async () => { throw new Error('schema refresh failed'); }), /schema refresh failed/);
});
