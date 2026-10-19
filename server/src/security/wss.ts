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
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// node-soap ships CommonJS; WSSecurityCert does XML signing (xml-crypto) for X.509 profiles.
const { WSSecurityCert } = require('soap') as typeof import('soap');

export const NS = {
  wsse: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd',
  wsu: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd',
  pwText: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText',
  pwDigest: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest',
  b64: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary',
  soap11: 'http://schemas.xmlsoap.org/soap/envelope/',
  soap12: 'http://www.w3.org/2003/05/soap-envelope',
};

const esc = (s: string) => s.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);
const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

/** WS-Security header options, built from an outbound security profile. */
export interface WssOptions {
  username?: { user: string; password: string; type: 'PasswordText' | 'PasswordDigest'; nonce?: boolean; created?: boolean };
  timestampTtlSec?: number;
  /** A complete SAML 1.1/2.0 <Assertion> element, inserted as-is. */
  samlAssertion?: string;
  /** Sign Body (and Timestamp) with an X.509 key. */
  x509?: { keyPem: string; certPem: string; passphrase?: string; signatureAlgorithm?: string; digestAlgorithm?: string };
  mustUnderstand?: boolean;
}

export function passwordDigest(nonceB64: string, created: string, password: string) {
  return crypto.createHash('sha1')
    .update(Buffer.concat([Buffer.from(nonceB64, 'base64'), Buffer.from(created, 'utf8'), Buffer.from(password, 'utf8')]))
    .digest('base64');
}

export function usernameTokenXml(u: NonNullable<WssOptions['username']>) {
  const created = iso(new Date());
  const nonce = crypto.randomBytes(16).toString('base64');
  const digest = u.type === 'PasswordDigest';
  const pw = digest ? passwordDigest(nonce, created, u.password) : u.password;
  return `<wsse:UsernameToken wsu:Id="UsernameToken-${crypto.randomUUID()}">`
    + `<wsse:Username>${esc(u.user)}</wsse:Username>`
    + `<wsse:Password Type="${digest ? NS.pwDigest : NS.pwText}">${esc(pw)}</wsse:Password>`
    + (digest || u.nonce ? `<wsse:Nonce EncodingType="${NS.b64}">${nonce}</wsse:Nonce>` : '')
    + (digest || u.created ? `<wsu:Created>${created}</wsu:Created>` : '')
    + `</wsse:UsernameToken>`;
}

/** The inner part of <wsse:Security> (without signature). */
export function securityHeaderXml(o: WssOptions, envKey: string) {
  let inner = '';
  // With X.509 signing, WSSecurityCert adds its own signed Timestamp.
  if (o.timestampTtlSec && !o.x509) {
    const c = new Date();
    inner += `<wsu:Timestamp wsu:Id="TS-${crypto.randomUUID()}"><wsu:Created>${iso(c)}</wsu:Created><wsu:Expires>${iso(new Date(c.getTime() + o.timestampTtlSec * 1000))}</wsu:Expires></wsu:Timestamp>`;
  }
  if (o.samlAssertion) inner += stripXmlDecl(o.samlAssertion.trim());
  if (o.username) inner += usernameTokenXml(o.username);
  const mu = o.mustUnderstand === false ? '' : ` ${envKey}:mustUnderstand="1"`;
  return `<wsse:Security xmlns:wsse="${NS.wsse}" xmlns:wsu="${NS.wsu}"${mu}>${inner}</wsse:Security>`;
}

const stripXmlDecl = (s: string) => s.replace(/^<\?xml[^>]*\?>\s*/, '');

/** Inserts the WS-Security header into a SOAP envelope and signs it when an X.509 key is given. */
export function applyWss(xml: string, o: WssOptions, envKey?: string): string {
  const key = envKey || detectEnvelopePrefix(xml);
  const hasAny = o.username || o.samlAssertion || o.timestampTtlSec || o.x509;
  if (!hasAny) return xml;
  xml = ensureHeader(xml, key);
  const header = securityHeaderXml(o, key);
  xml = insertBefore(xml, `</${key}:Header>`, header);
  if (o.x509) {
    const signer = new WSSecurityCert(o.x509.keyPem, o.x509.certPem, o.x509.passphrase || '', {
      hasTimeStamp: !!o.timestampTtlSec,
      signatureAlgorithm: o.x509.signatureAlgorithm || 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
      digestAlgorithm: o.x509.digestAlgorithm || 'http://www.w3.org/2001/04/xmlenc#sha256',
      signerOptions: { prefix: 'ds' },
    });
    xml = signer.postProcess(xml, key);
  }
  return xml;
}

export function detectEnvelopePrefix(xml: string) {
  const m = xml.match(/<([A-Za-z_][\w.-]*):Envelope[\s>]/);
  if (!m) throw new Error('The request is not a SOAP envelope (no prefixed Envelope element)');
  return m[1];
}

function ensureHeader(xml: string, key: string) {
  if (xml.includes(`</${key}:Header>`)) return xml;
  if (new RegExp(`<${key}:Header\\s*/>`).test(xml)) return xml.replace(new RegExp(`<${key}:Header\\s*/>`), `<${key}:Header></${key}:Header>`);
  const bodyAt = xml.search(new RegExp(`<${key}:Body[\\s>]`));
  if (bodyAt < 0) throw new Error('The SOAP envelope has no Body');
  return xml.slice(0, bodyAt) + `<${key}:Header></${key}:Header>` + xml.slice(bodyAt);
}

function insertBefore(xml: string, marker: string, add: string) {
  const i = xml.indexOf(marker);
  if (i < 0) throw new Error(`Could not find ${marker} in the SOAP envelope`);
  return xml.slice(0, i) + add + xml.slice(i);
}

/** node-soap security object: adds our WS-Security header (and HTTP auth headers) to WSDL-based calls. */
export class SutraSoapSecurity {
  constructor(private wss: WssOptions, private httpHeaders: Record<string, string>) {}
  addHeaders(headers: Record<string, string>) {
    Object.assign(headers, this.httpHeaders);
  }
  toXML() {
    return '';
  }
  postProcess(xml: string, envelopeKey: string) {
    return applyWss(xml, this.wss, envelopeKey);
  }
}

// ---------- inbound verification ----------

const seenNonces = new Map<string, number>();

/** Validates a UsernameToken from a parsed (namespace-stripped) Security header. */
export function verifyUsernameToken(
  security: any,
  lookup: (user: string) => string | undefined,
  opts: { maxSkewSec?: number } = {},
): { user: string } {
  const ut = security?.UsernameToken;
  if (!ut) throw new Error('WS-Security UsernameToken is missing');
  const user = text(ut.Username);
  const pwNode = ut.Password;
  const pw = text(pwNode);
  const type = (pwNode && typeof pwNode === 'object' && pwNode['@_Type']) || NS.pwText;
  const expected = lookup(user);
  if (expected === undefined) throw new Error('Unknown user');
  if (String(type).endsWith('#PasswordDigest')) {
    const nonce = text(ut.Nonce);
    const created = text(ut.Created);
    if (!nonce || !created) throw new Error('PasswordDigest needs Nonce and Created');
    const skew = (opts.maxSkewSec ?? 300) * 1000;
    const t = Date.parse(created);
    if (!isFinite(t) || Math.abs(Date.now() - t) > skew) throw new Error('UsernameToken Created is outside the allowed time window');
    const now = Date.now();
    for (const [k, exp] of seenNonces) if (exp < now) seenNonces.delete(k);
    if (seenNonces.has(nonce)) throw new Error('UsernameToken nonce was already used (replay)');
    if (!safeEqual(passwordDigest(nonce, created, expected), pw)) throw new Error('Invalid username or password');
    seenNonces.set(nonce, now + skew * 2);
  } else if (!safeEqual(expected, pw)) {
    throw new Error('Invalid username or password');
  }
  return { user };
}

export function text(v: any): string {
  if (v == null) return '';
  if (typeof v === 'object') return String(v['#text'] ?? '');
  return String(v);
}

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
