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
/** Checks committed local dependencies without silently replacing reviewed SutraFlow patches. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const POLICY_FILE = path.join(ROOT, 'vendor', 'vendor-lock.json');
const ONLINE = process.argv.includes('--online');
const WRITE = process.argv.includes('--write');
const fail = message => { throw new Error(message); };
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const posix = value => value.split(path.sep).join('/');

function filesUnder(dir, at = dir) {
  const out = [];
  for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(at, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(dir, full));
    else if (entry.isFile()) out.push(posix(path.relative(dir, full)));
  }
  return out.sort();
}

/** Normalize text line endings so the same checkout hashes equally on Windows and Linux. */
function treeHash(dir) {
  const hash = crypto.createHash('sha256');
  for (const rel of filesUnder(dir)) {
    const raw = fs.readFileSync(path.join(dir, rel));
    const data = raw.includes(0) ? raw : Buffer.from(raw.toString('utf8').replace(/\r\n/g, '\n'));
    hash.update(rel); hash.update('\0'); hash.update(data); hash.update('\0');
  }
  return hash.digest('hex');
}

function requireList(value, label) {
  if (!Array.isArray(value) || !value.length || value.some(x => !String(x).trim())) fail(`${label} must be a non-empty list`);
}

async function latest(name) {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) fail(`npm registry returned ${response.status} for ${name}`);
  return response.json();
}

const policy = json(POLICY_FILE);
if (policy.schema !== 1 || !policy.packages || typeof policy.packages !== 'object') fail('vendor/vendor-lock.json has an unsupported schema');
const rootPackage = json(path.join(ROOT, 'package.json'));
const packageLock = json(path.join(ROOT, 'package-lock.json'));
const knownDirs = fs.readdirSync(path.join(ROOT, 'vendor'), { withFileTypes: true }).filter(x => x.isDirectory()).map(x => x.name).sort();
const declared = Object.keys(policy.packages).sort();
if (JSON.stringify(knownDirs) !== JSON.stringify(declared)) fail(`Vendor folders and vendor-lock disagree: folders=${knownDirs.join(', ')} policy=${declared.join(', ')}`);

const results = [];
for (const [name, rule] of Object.entries(policy.packages)) {
  if (!['runtime', 'test'].includes(rule.scope)) fail(`${name}: scope must be runtime or test`);
  if (rule.ship !== (rule.scope === 'runtime')) fail(`${name}: runtime packages must ship and test packages must not`);
  requireList(rule.patches, `${name}.patches`);
  requireList(rule.consumers, `${name}.consumers`);
  requireList(rule.tests, `${name}.tests`);
  const dir = path.join(ROOT, 'vendor', name);
  for (const rel of [...rule.consumers, ...rule.tests]) if (!fs.existsSync(path.join(ROOT, rel))) fail(`${name}: referenced review file is missing: ${rel}`);
  for (const required of ['package.json', 'LICENSE']) if (!fs.existsSync(path.join(dir, required))) fail(`${name}: ${required} is missing`);
  const local = json(path.join(dir, 'package.json'));
  if (local.name !== name) fail(`${name}: local package name is ${local.name}`);
  if (local.version !== rule.localVersion) fail(`${name}: package version ${local.version} does not match vendor-lock ${rule.localVersion}`);
  if (!local.version.startsWith(`${rule.upstream?.version}-sutra.`) || !/^\d+$/.test(local.version.slice(`${rule.upstream?.version}-sutra.`.length))) fail(`${name}: local version must be ${rule.upstream?.version}-sutra.N`);
  const section = rule.scope === 'runtime' ? 'dependencies' : 'devDependencies';
  const other = rule.scope === 'runtime' ? 'devDependencies' : 'dependencies';
  const wanted = `file:vendor/${name}`;
  if (rootPackage[section]?.[name] !== wanted || rootPackage[other]?.[name]) fail(`${name}: package.json must contain ${section}.${name}=${wanted} only`);
  const rootLock = packageLock.packages?.[''];
  if (rootLock?.[section]?.[name] !== wanted || rootLock?.[other]?.[name]) fail(`${name}: package-lock root dependency does not match package.json`);
  if (packageLock.packages?.[`vendor/${name}`]?.version !== rule.localVersion) fail(`${name}: package-lock local version is stale; run npm install`);
  const link = packageLock.packages?.[`node_modules/${name}`];
  if (!link?.link || link.resolved !== `vendor/${name}`) fail(`${name}: package-lock is not linked to vendor/${name}`);
  if (!/^\d+\.\d+\.\d+$/.test(String(rule.upstream?.version || ''))) fail(`${name}: upstream version is missing`);
  if (!String(rule.upstream?.integrity || '').startsWith('sha512-')) fail(`${name}: upstream npm integrity is missing`);
  const digest = treeHash(dir);
  if (WRITE) rule.treeSha256 = digest;
  else if (digest !== rule.treeSha256) fail(`${name}: reviewed tree changed (${digest}); inspect the diff, run its targeted tests and the full suite, then run npm run vendor:lock`);
  if (ONLINE) {
    const remote = await latest(name);
    if (remote.version !== rule.upstream.version) fail(`${name}: npm latest is ${remote.version}, reviewed upstream is ${rule.upstream.version}. Review API/behavior changes, reapply patches, update vendor-lock, then run targeted and full regression tests.`);
    if (remote.dist?.integrity !== rule.upstream.integrity) fail(`${name}@${remote.version}: registry integrity differs from the reviewed tarball`);
  }
  results.push(`${name} ${rule.localVersion} (${rule.scope}${rule.ship ? ', shipped' : ', test only'})`);
}

if (WRITE) {
  fs.writeFileSync(POLICY_FILE, JSON.stringify(policy, null, 2) + '\n');
  console.log(`Updated ${posix(path.relative(ROOT, POLICY_FILE))}; review and commit it with the vendor changes.`);
} else {
  console.log(`Vendor gate passed${ONLINE ? ' with npm freshness' : ''}: ${results.join('; ')}`);
}
