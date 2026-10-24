/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 2.0.9
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import fs from 'node:fs';

/** Opt-in broker tests accept process-only PEMs; private credentials need not be written to disk. */
export function readTestPem(fileVariable: string): string {
  const inline = process.env[fileVariable.replace(/_FILE$/, '_PEM')];
  if (inline) {
    const blocks = [...inline.matchAll(/-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/g)];
    if (!blocks.length) throw new Error('Inline test certificate/key must contain PEM blocks');
    return blocks.map(m => `-----BEGIN ${m[1]}-----\n${m[2].replace(/\s/g, '').match(/.{1,64}/g)?.join('\n') || ''}\n-----END ${m[1]}-----`).join('\n');
  }
  return process.env[fileVariable] ? fs.readFileSync(process.env[fileVariable]!, 'utf8') : '';
}
