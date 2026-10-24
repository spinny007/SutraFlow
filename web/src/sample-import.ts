/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 2.0.7
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
/** Sample creation also creates shared schemas, resources and properties. Publish the result only
 * after both lists are refreshed, so opening the first flow cannot show stale missing references. */
export async function importSamplesWithCatalog<T>(
  create: () => Promise<T>, refreshFlows: () => Promise<unknown>, refreshCatalog: () => Promise<unknown>,
): Promise<T> {
  const added = await create();
  await Promise.all([refreshFlows(), refreshCatalog()]);
  return added;
}
