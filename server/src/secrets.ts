/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config, ensureDataDir } from './config.js';
import { q, now } from './db.js';

/**
 * Secret vault. Values are encrypted with AES-256-GCM using a master key from
 * SUTRA_MASTER_KEY (base64, 32 bytes) or data/master.key, created on first start.
 * Values are never returned by the API; flows reference them as {{secret.NAME}}.
 */
let masterKey: Buffer | null = null;

function key(): Buffer {
  if (masterKey) return masterKey;
  if (process.env.SUTRA_MASTER_KEY) {
    masterKey = Buffer.from(process.env.SUTRA_MASTER_KEY, 'base64');
  } else {
    ensureDataDir();
    const file = path.join(config.dataDir, 'master.key');
    if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
    masterKey = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
  }
  if (masterKey.length !== 32) throw new Error('The master key must be 32 bytes, base64 encoded');
  return masterKey;
}

export function encrypt(plain: string) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}

export function decrypt(e: { iv: string; tag: string; data: string }) {
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(e.iv, 'base64'));
  d.setAuthTag(Buffer.from(e.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(e.data, 'base64')), d.final()]).toString('utf8');
}

export const SECRET_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
/** A mistaken secret reference can itself contain a complete credential-bearing URI. */
export const missingSecretError = (_name: string, what = 'Secret') => new Error(`${what}: the selected stored secret is missing or the reference is invalid (value withheld). Enter an encrypted value in the connection or select a stored secret.`);

export function setSecret(name: string, value: string) {
  if (!SECRET_NAME.test(name)) throw new Error('Secret names use letters, digits and _ and start with a letter or _');
  const e = encrypt(value);
  q.run(
    `insert into secrets(name, iv, tag, data, updated_at) values(?, ?, ?, ?, ?)
     on conflict(name) do update set iv = excluded.iv, tag = excluded.tag, data = excluded.data, updated_at = excluded.updated_at`,
    name, e.iv, e.tag, e.data, now(),
  );
}

export function getSecret(name: string): string | undefined {
  const r = q.get<{ iv: string; tag: string; data: string }>('select iv, tag, data from secrets where name = ?', name);
  return r ? decrypt(r) : undefined;
}

export function requireSecret(name: string, what = 'Secret'): string {
  if (!name) throw new Error(`${what} is not set`);
  const v = getSecret(name);
  if (v === undefined) throw missingSecretError(name, what);
  return v;
}

export function listSecrets() {
  return q.all<{ name: string; updated_at: string }>('select name, updated_at from secrets order by name');
}

export function deleteSecret(name: string) {
  q.run('delete from secrets where name = ?', name);
}

/** Replaces any revealed secret values in a JSON-able value with a mask, so run history never stores them. */
export function maskSecrets<T>(value: T, revealed: Set<string>): T {
  if (!revealed.size || value === undefined) return value;
  let s = JSON.stringify(value);
  if (s === undefined) return value;
  for (const v of [...revealed].sort((a, b) => b.length - a.length)) {
    if (v.length < 4) continue;
    const enc = JSON.stringify(v).slice(1, -1);
    s = s.split(enc).join('••••••');
  }
  return JSON.parse(s);
}
