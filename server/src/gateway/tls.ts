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
import * as acme from 'acme-client';
import { generate } from 'selfsigned';
import { getSetting, setSetting } from '../db.js';
import { encrypt, decrypt } from '../secrets.js';

/**
 * Gateway TLS. Modes:
 *  off        - HTTPS listener disabled
 *  selfSigned - generated certificate, for testing
 *  uploaded   - your PEM certificate chain and key
 *  acme       - Let's Encrypt via HTTP-01; the gateway HTTP port must be reachable as port 80
 *               on every domain. Renewed automatically 30 days before expiry.
 * Mutual TLS: set a client CA; services whose policy uses "mtls" then require a client certificate.
 */
export interface TlsSettings {
  mode: 'off' | 'selfSigned' | 'uploaded' | 'acme';
  domains: string[];
  email: string;
  staging: boolean;
  agreeTos: boolean;
  clientCaPem: string;
}

export interface StoredCert {
  certPem: string;
  key: { iv: string; tag: string; data: string };
  source: string;
  issuedAt: string;
}

export const defaultTls: TlsSettings = { mode: 'off', domains: [], email: '', staging: true, agreeTos: false, clientCaPem: '' };

export const getTls = () => ({ ...defaultTls, ...getSetting<Partial<TlsSettings>>('tls', {}) });
export const setTls = (t: Partial<TlsSettings>) => setSetting('tls', { ...getTls(), ...t });

export function getCert(): { certPem: string; keyPem: string; source: string } | null {
  const c = getSetting<StoredCert | null>('tlsCert', null);
  return c ? { certPem: c.certPem, keyPem: decrypt(c.key), source: c.source } : null;
}

export function storeCert(certPem: string, keyPem: string, source: string) {
  // Validate: the key must match the leaf certificate.
  const leaf = new crypto.X509Certificate(firstPem(certPem));
  const key = crypto.createPrivateKey(keyPem);
  if (!leaf.checkPrivateKey(key)) throw new Error('The private key does not match the certificate');
  setSetting('tlsCert', { certPem, key: encrypt(keyPem), source, issuedAt: new Date().toISOString() } satisfies StoredCert);
}

export function certInfo() {
  const c = getSetting<StoredCert | null>('tlsCert', null);
  if (!c) return null;
  try {
    const x = new crypto.X509Certificate(firstPem(c.certPem));
    return {
      source: c.source,
      subject: x.subject,
      issuer: x.issuer,
      altNames: x.subjectAltName || '',
      validFrom: new Date(x.validFrom).toISOString(),
      validTo: new Date(x.validTo).toISOString(),
      daysLeft: Math.floor((Date.parse(x.validTo) - Date.now()) / 86400000),
      fingerprint256: x.fingerprint256,
    };
  } catch (e: any) {
    return { source: c.source, error: e.message };
  }
}

const firstPem = (pem: string) => {
  const m = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/);
  if (!m) throw new Error('No PEM certificate found');
  return m[0];
};

export async function makeSelfSigned(domains: string[]) {
  const names = domains.length ? domains : ['localhost'];
  const notAfterDate = new Date(Date.now() + 365 * 86400000);
  const pems = await generate([{ name: 'commonName', value: names[0] }], {
    keySize: 2048,
    algorithm: 'sha256',
    notAfterDate,
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        altNames: [
          ...names.map(n => (/^[\d.]+$|:/.test(n) ? { type: 7 as const, ip: n } : { type: 2 as const, value: n })),
          ...(names.includes('localhost') ? [{ type: 7 as const, ip: '127.0.0.1' }] : []),
        ],
      },
    ],
  } as any);
  storeCert(pems.cert, pems.private, 'self-signed');
}

// ---------- Let's Encrypt (ACME HTTP-01) ----------

const challenges = new Map<string, string>();
export const acmeChallenge = (token: string) => challenges.get(token);

let acmeRunning: Promise<void> | null = null;
export const acmeStatus: { state: string; message: string; at?: string } = { state: 'idle', message: '' };

export function requestAcme(onIssued: () => void) {
  if (acmeRunning) return acmeRunning;
  acmeRunning = (async () => {
    const t = getTls();
    try {
      if (!t.domains.length) throw new Error('Add at least one domain');
      if (!t.email) throw new Error('A contact email is required by Let\'s Encrypt');
      if (!t.agreeTos) throw new Error('Accept the Let\'s Encrypt Subscriber Agreement first');
      Object.assign(acmeStatus, { state: 'running', message: `Requesting a certificate for ${t.domains.join(', ')}`, at: new Date().toISOString() });
      const stored = getSetting<{ iv: string; tag: string; data: string } | null>('acmeAccountKey', null);
      let accountKey: string;
      if (stored) accountKey = decrypt(stored);
      else {
        accountKey = (await acme.crypto.createPrivateKey()).toString();
        setSetting('acmeAccountKey', encrypt(accountKey));
      }
      const client = new acme.Client({
        directoryUrl: t.staging ? acme.directory.letsencrypt.staging : acme.directory.letsencrypt.production,
        accountKey,
      });
      const [key, csr] = await acme.crypto.createCsr({ commonName: t.domains[0], altNames: t.domains });
      const cert = await client.auto({
        csr,
        email: t.email,
        termsOfServiceAgreed: true,
        challengePriority: ['http-01'],
        challengeCreateFn: async (_a, ch, keyAuth) => { challenges.set(ch.token, keyAuth); },
        challengeRemoveFn: async (_a, ch) => { challenges.delete(ch.token); },
      });
      storeCert(cert, key.toString(), t.staging ? 'letsencrypt-staging' : 'letsencrypt');
      Object.assign(acmeStatus, { state: 'ok', message: `Certificate issued for ${t.domains.join(', ')}`, at: new Date().toISOString() });
      onIssued();
    } catch (e: any) {
      Object.assign(acmeStatus, { state: 'error', message: e?.message || String(e), at: new Date().toISOString() });
      throw e;
    } finally {
      acmeRunning = null;
    }
  })();
  return acmeRunning;
}

/** Daily check: renew Let's Encrypt certificates with fewer than 30 days left. */
export function startRenewal(onIssued: () => void) {
  const check = () => {
    const t = getTls();
    if (t.mode !== 'acme') return;
    const info = certInfo();
    if (!info || !('daysLeft' in info) || (info.daysLeft ?? 0) < 30) requestAcme(onIssued).catch(() => {});
  };
  const timer = setInterval(check, 12 * 3600 * 1000);
  timer.unref?.();
  setTimeout(check, 10000).unref?.();
}
