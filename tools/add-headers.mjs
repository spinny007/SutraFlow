#!/usr/bin/env node
/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
/**
 * The copyright and licence header of every SutraFlow source file: code, styles, page templates,
 * scripts and configuration examples. Each file keeps the version it was first given ("File version");
 * a file without a header gets the current version from package.json, so new files carry their own.
 *
 *   node tools/add-headers.mjs           adds the header where it is missing
 *   node tools/add-headers.mjs --check   lists files without it (exit 1); the tests run this
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = JSON.parse(fs.readFileSync(path.join(HOME, 'package.json'), 'utf8')).version;
export const SPDX = 'SPDX-License-Identifier: AGPL-3.0-only';

/** The header lines (without comment marks) for a file of a version. */
export const headerLines = version => [
  'SutraFlow',
  'Copyright (c) 2026-27 Surya Partap Singh',
  'Developer: Surya Partap Singh | Website: MixAgile.com',
  `File version: ${version}`,
  'License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.',
  'A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.',
  SPDX,
];

/** How a file type writes comments, or null for files that take no header. */
function styleOf(rel) {
  const base = path.basename(rel);
  if (/^(docs\/.*\.html|dist\/|node_modules\/|samples\/|vendor\/)/.test(rel)) return null; // generated, data, or third-party code under its own licence
  if (/\.(ts|tsx|mjs|js|cjs|css)$/.test(base)) return 'block';
  if (/\.html$/.test(base)) return 'html';
  if (/\.cmd$/.test(base)) return 'rem';
  if (/\.(sh|yml|yaml|conf|example|htaccess)$/.test(base) || base === 'Dockerfile' || base === '.htaccess' || rel === 'bin/sutraflow') return 'hash';
  if (/README\.txt$/.test(base)) return 'text';
  return null;
}

function render(style, version) {
  const l = headerLines(version);
  if (style === 'block') return ['/*', ...l.map(x => ` * ${x}`), ' */'].join('\n') + '\n';
  if (style === 'html') return ['<!--', ...l.map(x => `  ${x}`), '-->'].join('\n') + '\n';
  if (style === 'rem') return l.map(x => `@rem ${x}`).join('\r\n') + '\r\n';
  if (style === 'hash') return l.map(x => `# ${x}`).join('\n') + '\n';
  return l.join('\n') + '\n\n';
}

/** The project's files: tracked, and new ones not ignored. */
function files() {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: HOME, encoding: 'utf8' });
  return out.split(/\r?\n/).filter(Boolean).filter(f => fs.existsSync(path.join(HOME, f)));
}

/** Whether a file has the header (within its first lines). */
export const hasHeader = text => text.split(/\r?\n/, 20).some(l => l.includes(SPDX));

/** Adds the header after a first line that must stay first (#!, @echo off, <!doctype>). */
function add(text, style) {
  const nl = style === 'rem' || text.includes('\r\n') ? '\r\n' : '\n';
  const head = render(style, VERSION).replace(/\r?\n/g, nl);
  const first = text.split(/\r?\n/, 1)[0];
  if (/^#!|^@echo off|^<!doctype/i.test(first)) {
    const rest = text.slice(first.length).replace(/^\r?\n/, '');
    return first + nl + head + rest;
  }
  return head + text;
}

const check = process.argv.includes('--check');
const missing = [];
let added = 0;
for (const rel of files()) {
  const style = styleOf(rel);
  if (!style) continue;
  const full = path.join(HOME, rel);
  const text = fs.readFileSync(full, 'utf8');
  if (hasHeader(text)) continue;
  if (check) { missing.push(rel); continue; }
  fs.writeFileSync(full, add(text, style));
  added++;
}
if (check) {
  if (missing.length) { console.error(`Without the copyright header (run node tools/add-headers.mjs):\n  ${missing.join('\n  ')}`); process.exit(1); }
  console.log('Every source file has the copyright header.');
} else console.log(`Added the header to ${added} files (version ${VERSION}).`);
