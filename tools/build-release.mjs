#!/usr/bin/env node
/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 2.0.0
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
/**
 * Builds the installable release of SutraFlow:
 *   release/sutraflow-<version>-windows.zip
 *   release/sutraflow-<version>-linux.tar.gz   (the launcher and shell scripts executable)
 * each with a .sha256 file. They hold the built server and web pages, the launcher, the
 * user and operations guides, runtime samples, deployment templates, the database migration tool
 * and the licences; not source, tests, benchmarks, development tools or node_modules. On the
 * server, `sutraflow setup` installs the runtime packages
 * (npm ci --omit=dev).
 *
 *   npm run build && npm run guide && npm run architecture && node tools/build-release.mjs
 *
 * --offline also builds sutraflow-<version>-<os>-<cpu>-offline.zip (Windows) or .tar.gz (Linux, macOS)
 * with the runtime packages inside, for servers without access to the npm registry. They are made
 * for the system they are built on (the GitHub release workflow builds them on each system).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import os from 'node:os';
import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HOME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(HOME, 'package.json'), 'utf8'));
const vendorPolicy = JSON.parse(fs.readFileSync(path.join(HOME, 'vendor', 'vendor-lock.json'), 'utf8'));
const VERSION = pkg.version;
const top = `sutraflow-${VERSION}`;
const fail = m => { console.error(m); process.exit(1); };

if (!fs.existsSync(path.join(HOME, 'dist', 'server', 'main.js'))) fail('Build first: npm run build');
execFileSync(process.execPath, [path.join(HOME, 'tools', 'check-vendor.mjs')], { cwd: HOME, stdio: 'inherit' });
for (const f of ['RELEASE-NOTES.md', 'LICENSE', 'docs/sutraflow-user-guide.html', 'docs/sutraflow-architecture.html']) if (!fs.existsSync(path.join(HOME, f))) fail(`Missing ${f}`);
if (!fs.readFileSync(path.join(HOME, 'RELEASE-NOTES.md'), 'utf8').includes(VERSION)) fail(`RELEASE-NOTES.md does not describe ${VERSION}`);

/** What the release holds: compiled/runtime folders and explicitly selected guides. */
const shippedVendors = Object.entries(vendorPolicy.packages).filter(([, rule]) => rule.ship).map(([name]) => `vendor/${name}`);
const FOLDERS = ['dist', 'bin', 'samples', 'deploy', 'docs/guide-images', ...shippedVendors];
const FILES = [
  'package.json', 'package-lock.json', 'LICENSE', 'COMMERCIAL-LICENSE.md', 'SECURITY.md', 'README.md', 'RELEASE-NOTES.md',
  'sutraflow.env.example',
  'docs/sutraflow-user-guide.html', 'docs/sutraflow-architecture.html', 'docs/deployment.md', 'docs/architecture.md',
  'tools/migrate-to-postgres.mjs', 'tools/migrate-to-postgres.cmd', 'tools/migrate-to-postgres.sh',
];
const skip = rel => /(^|\/)(node_modules|\.git)(\/|$)/.test(rel) || /\.(log|map)$/.test(rel);

const files = [];
const walk = rel => {
  const full = path.join(HOME, rel);
  if (!fs.existsSync(full) || skip(rel)) return;
  if (fs.statSync(full).isDirectory()) { for (const n of fs.readdirSync(full).sort()) walk(`${rel}/${n}`); return; }
  files.push(rel);
};
FOLDERS.forEach(walk);
for (const f of FILES) if (fs.existsSync(path.join(HOME, f))) files.push(f); else fail(`Missing ${f}`);
const forbidden = files.filter(rel => /^(test|server\/src|web\/src|web\/admin|web\/approvals|docs\/benchmarks)(\/|$)/.test(rel)
  || /^tools\/(?!migrate-to-postgres\.(mjs|cmd|sh)$)/.test(rel));
if (forbidden.length) fail(`Non-runtime files in the release: ${forbidden.join(', ')}`);

// package.json for a release: no build or test scripts that need the source, no development packages.
const { devDependencies: _dev, ...relPkg } = { ...pkg, scripts: { start: 'node --disable-warning=ExperimentalWarning dist/server/main.js' } };
const entries = files.map(rel => [`${top}/${rel}`, rel === 'package.json' ? Buffer.from(JSON.stringify(relPkg, null, 2) + '\n') : fs.readFileSync(path.join(HOME, rel))]);
if (process.argv.includes('--check')) {
  console.log(`Release manifest is valid: ${files.length} runtime and guide files`);
  process.exit(0);
}

/** Files that run as programs on Linux and macOS. */
const executable = name => name.endsWith('/bin/sutraflow') || name.endsWith('.sh');

/** A tar archive (ustar), so Linux keeps the launcher and scripts executable. */
function tar(list) {
  const blocks = [];
  const put = (buf, off, len, text) => buf.write(text, off, Math.min(len, Buffer.byteLength(text)), 'utf8');
  const octal = (n, len) => n.toString(8).padStart(len - 1, '0') + '\0';
  const mtime = Math.floor(Date.now() / 1000);
  for (const [name, data] of list) {
    let base = name, prefix = '';
    if (Buffer.byteLength(name) > 100) {
      const i = name.lastIndexOf('/', 155);
      prefix = name.slice(0, i); base = name.slice(i + 1);
    }
    if (Buffer.byteLength(base) > 100 || Buffer.byteLength(prefix) > 155) fail(`Path too long for tar: ${name}`);
    const h = Buffer.alloc(512);
    put(h, 0, 100, base);
    put(h, 100, 8, octal(executable(name) ? 0o755 : 0o644, 8));
    put(h, 108, 8, octal(0, 8));
    put(h, 116, 8, octal(0, 8));
    put(h, 124, 12, octal(data.length, 12));
    put(h, 136, 12, octal(mtime, 12));
    h.fill(0x20, 148, 156); // checksum field counts as spaces
    h[156] = 0x30; // a regular file
    put(h, 257, 6, 'ustar\0');
    put(h, 263, 2, '00');
    put(h, 345, 155, prefix);
    let sum = 0;
    for (const b of h) sum += b;
    put(h, 148, 8, sum.toString(8).padStart(6, '0') + '\0 ');
    blocks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

const { zipFiles } = await import(pathToFileURL(path.join(HOME, 'dist', 'server', 'bundles.js')).href);
const outDir = path.join(HOME, 'release');
fs.mkdirSync(outDir, { recursive: true });
const write = (file, buf) => {
  const p = path.join(outDir, file);
  fs.writeFileSync(p, buf);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  fs.writeFileSync(`${p}.sha256`, `${sha}  ${file}\n`);
  console.log(`Wrote release/${file}: ${files.length} files, ${(buf.length / 1048576).toFixed(1)} MB, SHA-256 ${sha}`);
};
// --only windows|linux: one system's archives (the release workflow builds each on its own system).
const only = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7);
if (only !== 'linux') write(`${top}-windows.zip`, zipFiles(entries));
if (only !== 'windows') write(`${top}-linux.tar.gz`, zlib.gzipSync(tar(entries), { level: 9 }));

if (process.argv.includes('--offline')) {
  // The runtime packages as `sutraflow setup` would install them, for this system.
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-release-'));
  try {
    fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(relPkg, null, 2));
    fs.copyFileSync(path.join(HOME, 'package-lock.json'), path.join(stage, 'package-lock.json'));
    fs.cpSync(path.join(HOME, 'vendor'), path.join(stage, 'vendor'), { recursive: true });
    execSync('npm ci --omit=dev --no-audit --no-fund', { cwd: stage, stdio: 'inherit' });
    const mods = [];
    const walkMods = rel => {
      const full = path.join(stage, rel);
      const st = fs.lstatSync(full);
      if (st.isSymbolicLink()) return;
      if (st.isDirectory()) { for (const n of fs.readdirSync(full).sort()) walkMods(`${rel}/${n}`); return; }
      mods.push([`${top}/${rel}`, fs.readFileSync(full)]);
    };
    walkMods('node_modules');
    const all = [...entries, ...mods];
    const plat = `${process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux'}-${process.arch}`;
    if (process.platform === 'win32') write(`${top}-${plat}-offline.zip`, zipFiles(all));
    else write(`${top}-${plat}-offline.tar.gz`, zlib.gzipSync(tar(all), { level: 9 }));
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}
process.exit(0);
