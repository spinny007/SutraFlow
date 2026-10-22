/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.8.0
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
/**
 * WS-Security on the raw XML of a SOAP message, where parsed objects are not enough:
 *
 *  XML encryption  incoming: EncryptedData in the message decrypted with this server's private key
 *                  (the content key comes in an EncryptedKey, RSA-OAEP); outgoing: the Body content
 *                  encrypted for the recipient's certificate, its EncryptedKey first in wsse:Security
 *                  (so a receiver decrypts before it checks a signature). AES-GCM or AES-CBC.
 *                  RSA 1.5 key transport is refused (it is open to padding attacks).
 *  X.509           a signed request: the signature checked with the certificate it carries
 *                  (BinarySecurityToken or X509Data), that certificate trusted (listed itself, or
 *                  issued by a listed certificate, and in its validity period), and the Body and any
 *                  Timestamp covered by the signature.
 *  SAML            an assertion in wsse:Security: its own signature by the identity provider's
 *                  certificate, the issuer, the audience and the validity times.
 *  Timestamp       Created not in the future and Expires not past, within the allowed clock skew.
 */
import crypto from 'node:crypto';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';
import { NS, text } from './wss.js';

const DSIG = 'http://www.w3.org/2000/09/xmldsig#';
const XENC = 'http://www.w3.org/2001/04/xmlenc#';
const XENC11 = 'http://www.w3.org/2009/xmlenc11#';
const SAML2 = 'urn:oasis:names:tc:SAML:2.0:assertion';
const SAML1 = 'urn:oasis:names:tc:SAML:1.0:assertion';

export class WssError extends Error {}

// ---------- DOM helpers ----------

function parse(xml: string): Document {
  const errors: string[] = [];
  const doc = new DOMParser({ errorHandler: { warning: () => {}, error: (m: string) => errors.push(m), fatalError: (m: string) => errors.push(m) } }).parseFromString(xml, 'text/xml');
  if (errors.length || !doc?.documentElement) throw new WssError(`The message is not valid XML${errors.length ? `: ${errors[0]}` : ''}`);
  return doc as unknown as Document;
}
const kids = (n: Node | null | undefined): Element[] => {
  const out: Element[] = [];
  for (let c = n?.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) out.push(c as Element);
  return out;
};
const child = (n: Node | null | undefined, local: string, ns?: string) => kids(n).find(e => e.localName === local && (!ns || e.namespaceURI === ns));
/** All elements of a name, in document order. */
function all(n: Node, local: string, ns?: string): Element[] {
  const out: Element[] = [];
  const walk = (x: Node) => { for (const e of kids(x)) { if (e.localName === local && (!ns || e.namespaceURI === ns)) out.push(e); walk(e); } };
  walk(n);
  return out;
}
const idOf = (e: Element) => {
  for (let i = 0; i < e.attributes.length; i++) {
    const a = e.attributes[i];
    if (['Id', 'ID', 'id', 'AssertionID'].includes(a.localName || a.name)) return a.value;
  }
  return '';
};
const textOf = (e: Element | undefined | null) => (e?.textContent || '').trim();

function envelopeParts(doc: Document) {
  const env = doc.documentElement;
  if (env.localName !== 'Envelope') throw new WssError('Request is not a SOAP envelope');
  const bodies = kids(env).filter(e => e.localName === 'Body');
  if (bodies.length !== 1) throw new WssError('The SOAP envelope must have exactly one Body');
  const header = child(env, 'Header');
  const securities = header ? kids(header).filter(e => e.localName === 'Security' && e.namespaceURI === NS.wsse) : [];
  if (securities.length > 1) throw new WssError('The message has more than one wsse:Security header');
  return { env, body: bodies[0], header, security: securities[0] };
}

// ---------- certificates ----------

function pemList(pems: string): crypto.X509Certificate[] {
  const blocks = String(pems || '').match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [];
  return blocks.map(b => { try { return new crypto.X509Certificate(b); } catch { throw new WssError('A trusted certificate in the policy is not a valid PEM certificate'); } });
}
const cnOf = (c: crypto.X509Certificate) => /(?:^|\n|,\s*)CN=([^\n,]+)/.exec(c.subject)?.[1]?.trim() || c.subject;

/** The certificate is listed, or issued (and signed) by a listed one; and it is within its validity period. */
export function trusted(cert: crypto.X509Certificate, list: crypto.X509Certificate[], skewMs = 0) {
  const now = Date.now();
  if (Date.parse(cert.validFrom) - skewMs > now || Date.parse(cert.validTo) + skewMs < now) throw new WssError(`The certificate of ${cnOf(cert)} is outside its validity period`);
  // Listed itself, or issued by a listed CA (basic constraints CA, its name as the issuer, its key verifying the signature).
  const ok = list.some(t => t.fingerprint256 === cert.fingerprint256 || (t.ca && cert.issuer === t.subject && cert.verify(t.publicKey)));
  if (!ok) throw new WssError(`The certificate of ${cnOf(cert)} is not trusted by this service`);
}

// ---------- timestamp ----------

/** Checks wsu:Timestamp of a parsed (namespace-stripped) Security header. */
export function checkTimestamp(security: any, required: boolean, skewSec = 300) {
  const ts = security?.Timestamp;
  if (!ts) { if (required) throw new WssError('A WS-Security Timestamp is required'); return; }
  const skew = skewSec * 1000, now = Date.now();
  const created = Date.parse(text(ts.Created));
  if (!Number.isFinite(created)) throw new WssError('The Timestamp has no valid Created time');
  if (created - skew > now) throw new WssError('The Timestamp is in the future (check the clocks)');
  const exp = text(ts.Expires);
  if (exp) {
    const e = Date.parse(exp);
    if (!Number.isFinite(e) || e + skew < now) throw new WssError('The message has expired (Timestamp)');
  }
}

// ---------- signatures ----------

function checked(sig: Element, xml: string, certPem: string) {
  const sx = new SignedXml({ publicCert: certPem, getCertFromKeyInfo: () => null, idAttribute: 'AssertionID' });
  sx.loadSignature(sig);
  let ok = false;
  try { ok = sx.checkSignature(xml); } catch (e: any) { throw new WssError(`The signature is not valid: ${e.message}`); }
  if (!ok) throw new WssError('The signature is not valid');
  return sx.getReferences().map(r => String(r.uri || '').replace(/^#/, ''));
}

/** A request signed with X.509: who signed it (the certificate subject), once everything checks out. */
export function verifyX509(xml: string, o: { trustedPem: string; allowedSubjects?: string[]; requireTimestamp?: boolean; skewSec?: number }) {
  const doc = parse(xml);
  const { body, security } = envelopeParts(doc);
  if (!security) throw new WssError('WS-Security header is required');
  const sig = child(security, 'Signature', DSIG);
  if (!sig) throw new WssError('The message is not signed');
  // The signer's certificate: a BinarySecurityToken it refers to, or X509Data in KeyInfo.
  const keyInfo = child(sig, 'KeyInfo', DSIG);
  let b64 = '';
  const ref = child(child(keyInfo, 'SecurityTokenReference', NS.wsse), 'Reference', NS.wsse)?.getAttribute('URI');
  if (ref) {
    const bst = all(security, 'BinarySecurityToken', NS.wsse).find(e => `#${idOf(e)}` === ref);
    if (!bst) throw new WssError(`The signature refers to a token ${ref} that is not in the message`);
    b64 = textOf(bst);
  } else b64 = textOf(child(child(keyInfo, 'X509Data', DSIG), 'X509Certificate', DSIG));
  if (!b64) throw new WssError('The signature does not carry the signer\'s certificate');
  let cert: crypto.X509Certificate;
  try { cert = new crypto.X509Certificate(Buffer.from(b64.replace(/\s+/g, ''), 'base64')); } catch { throw new WssError('The signer\'s certificate cannot be read'); }
  const skewMs = (o.skewSec ?? 300) * 1000;
  trusted(cert, pemList(o.trustedPem), skewMs);
  const cn = cnOf(cert);
  if (o.allowedSubjects?.length && !o.allowedSubjects.includes(cn)) throw new WssError(`Certificate subject ${cn} is not allowed`);
  const signed = checked(sig, xml, cert.toString());
  // What counts must be signed: the Body, and the Timestamp when there is one.
  if (!idOf(body) || !signed.includes(idOf(body))) throw new WssError('The SOAP Body is not covered by the signature');
  const ts = child(security, 'Timestamp', NS.wsu);
  if (ts && (!idOf(ts) || !signed.includes(idOf(ts)))) throw new WssError('The Timestamp is not covered by the signature');
  if (!ts && o.requireTimestamp) throw new WssError('A signed WS-Security Timestamp is required');
  return { subject: cn, claims: { fingerprint256: cert.fingerprint256, issuer: cert.issuer, serial: cert.serialNumber, certificatePem: cert.toString() } };
}

/** A SAML 1.1 or 2.0 assertion in wsse:Security, signed by the identity provider. */
export function verifySaml(xml: string, o: { idpCertPem: string; issuer?: string; audience?: string; skewSec?: number }) {
  const doc = parse(xml);
  const { security } = envelopeParts(doc);
  if (!security) throw new WssError('WS-Security header is required');
  const assertions = kids(security).filter(e => e.localName === 'Assertion' && (e.namespaceURI === SAML2 || e.namespaceURI === SAML1));
  if (assertions.length !== 1) throw new WssError(assertions.length ? 'The message has more than one SAML assertion' : 'A SAML assertion is required');
  const a = assertions[0];
  const v2 = a.namespaceURI === SAML2;
  const sig = child(a, 'Signature', DSIG);
  if (!sig) throw new WssError('The SAML assertion is not signed');
  const certs = pemList(o.idpCertPem);
  if (!certs.length) throw new WssError('The policy has no identity provider certificate');
  // The assertion's own signature, by one of the provider's certificates, over the assertion itself.
  let signed: string[] | null = null, lastErr: Error | null = null;
  for (const c of certs) { try { signed = checked(sig, xml, c.toString()); break; } catch (e: any) { lastErr = e; } }
  if (!signed) throw lastErr || new WssError('The SAML assertion signature is not valid');
  if (signed.length !== 1 || signed[0] !== idOf(a)) throw new WssError('The SAML signature does not cover the assertion');
  const issuer = v2 ? textOf(child(a, 'Issuer', SAML2)) : a.getAttribute('Issuer') || '';
  if (o.issuer && issuer !== o.issuer) throw new WssError(`The SAML assertion comes from ${issuer || 'an unnamed issuer'}, not ${o.issuer}`);
  const skew = (o.skewSec ?? 300) * 1000, now = Date.now();
  const cond = child(a, 'Conditions', a.namespaceURI!);
  const nb = cond?.getAttribute('NotBefore'), na = cond?.getAttribute('NotOnOrAfter');
  if (nb && Date.parse(nb) - skew > now) throw new WssError('The SAML assertion is not valid yet');
  if (na && Date.parse(na) + skew <= now) throw new WssError('The SAML assertion has expired');
  if (o.audience) {
    const auds = cond ? all(cond, 'Audience', a.namespaceURI!).map(textOf) : [];
    if (!auds.includes(o.audience)) throw new WssError(`The SAML assertion is not meant for ${o.audience}`);
  }
  const nameId = textOf(all(a, v2 ? 'NameID' : 'NameIdentifier', a.namespaceURI!)[0]);
  if (!nameId) throw new WssError('The SAML assertion names no subject');
  const attributes: Record<string, string[]> = {};
  for (const at of all(a, 'Attribute', a.namespaceURI!)) attributes[at.getAttribute(v2 ? 'Name' : 'AttributeName') || ''] = all(at, 'AttributeValue', a.namespaceURI!).map(textOf);
  return { subject: nameId, claims: { issuer, attributes } };
}

// ---------- XML encryption ----------

const BLOCK: Record<string, { cipher: string; key: number; gcm: boolean }> = {
  [`${XENC}aes128-cbc`]: { cipher: 'aes-128-cbc', key: 16, gcm: false },
  [`${XENC}aes256-cbc`]: { cipher: 'aes-256-cbc', key: 32, gcm: false },
  [`${XENC11}aes128-gcm`]: { cipher: 'aes-128-gcm', key: 16, gcm: true },
  [`${XENC11}aes256-gcm`]: { cipher: 'aes-256-gcm', key: 32, gcm: true },
};
export const ENCRYPTION_ALGORITHMS: Record<string, string> = {
  'aes256-gcm': `${XENC11}aes256-gcm`, 'aes128-gcm': `${XENC11}aes128-gcm`, 'aes256-cbc': `${XENC}aes256-cbc`, 'aes128-cbc': `${XENC}aes128-cbc`,
};
const DIGESTS: Record<string, string> = { [`${DSIG}sha1`]: 'sha1', 'http://www.w3.org/2001/04/xmlenc#sha256': 'sha256', 'http://www.w3.org/2001/04/xmlenc#sha512': 'sha512' };

function decryptBlock(alg: string, key: Buffer, data: Buffer) {
  const b = BLOCK[alg];
  if (!b) throw new WssError(`Encryption algorithm ${alg} is not supported`);
  if (key.length !== b.key) throw new WssError('The content key does not fit the algorithm');
  if (b.gcm) {
    const iv = data.subarray(0, 12), tag = data.subarray(data.length - 16), ct = data.subarray(12, data.length - 16);
    const d = crypto.createDecipheriv(b.cipher, key, iv) as crypto.DecipherGCM;
    d.setAuthTag(tag);
    try { return Buffer.concat([d.update(ct), d.final()]); } catch { throw new WssError('The encrypted data cannot be decrypted (wrong key or changed data)'); }
  }
  // CBC with ISO 10126 padding: the last byte says how many bytes to drop.
  const iv = data.subarray(0, 16), ct = data.subarray(16);
  if (!ct.length || ct.length % 16) throw new WssError('The encrypted data has a wrong length');
  const d = crypto.createDecipheriv(b.cipher, key, iv);
  d.setAutoPadding(false);
  const out = Buffer.concat([d.update(ct), d.final()]);
  const pad = out[out.length - 1];
  if (!pad || pad > 16) throw new WssError('The encrypted data cannot be decrypted (wrong key or changed data)');
  return out.subarray(0, out.length - pad);
}

function unwrapKey(ek: Element, privateKey: crypto.KeyObject) {
  const method = child(ek, 'EncryptionMethod', XENC);
  const alg = method?.getAttribute('Algorithm') || '';
  if (alg === `${XENC}rsa-1_5`) throw new WssError('RSA 1.5 key transport is refused (it is open to padding attacks); use RSA-OAEP');
  if (alg !== `${XENC}rsa-oaep-mgf1p` && alg !== `${XENC11}rsa-oaep`) throw new WssError(`Key transport ${alg || '(none)'} is not supported`);
  const digest = DIGESTS[child(method, 'DigestMethod', DSIG)?.getAttribute('Algorithm') || `${DSIG}sha1`] || 'sha1';
  // Node uses one hash for OAEP and its mask function (MGF1): other combinations are not supported.
  const mgf = child(method, 'MGF', XENC11)?.getAttribute('Algorithm');
  if (mgf && !mgf.endsWith(`mgf1${digest}`)) throw new WssError('RSA-OAEP with a mask function other than its digest is not supported');
  const cv = textOf(child(child(ek, 'CipherData', XENC), 'CipherValue', XENC));
  try {
    return crypto.privateDecrypt({ key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: digest }, Buffer.from(cv, 'base64'));
  } catch { throw new WssError('The content key cannot be decrypted with this service\'s key'); }
}

/** Namespace declarations in scope at an element: decrypted content may use prefixes declared above it. */
function inScope(e: Element) {
  const ns = new Map<string, string>();
  for (let n: Node | null = e; n && n.nodeType === 1; n = n.parentNode) {
    const el = n as Element;
    for (let i = 0; i < el.attributes.length; i++) {
      const a = el.attributes[i];
      if ((a.name === 'xmlns' || a.name.startsWith('xmlns:')) && !ns.has(a.name)) ns.set(a.name, a.value);
    }
  }
  return [...ns].map(([k, v]) => `${k}="${v.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`).join(' ');
}

/**
 * Decrypts every EncryptedData of a message with this server's private key. Returns the message as it
 * was before encryption, and whether the Body was encrypted.
 */
export function decryptMessage(xml: string, keyPem: string, passphrase?: string): { xml: string; bodyEncrypted: boolean; parts: number } {
  if (!/EncryptedData/.test(xml)) return { xml, bodyEncrypted: false, parts: 0 };
  const doc = parse(xml);
  const { body } = envelopeParts(doc);
  const datas = all(doc, 'EncryptedData', XENC);
  if (!datas.length) return { xml, bodyEncrypted: false, parts: 0 };
  if (!keyPem) throw new WssError('The message is encrypted, but this service has no key to decrypt it');
  let privateKey: crypto.KeyObject;
  try { privateKey = crypto.createPrivateKey({ key: keyPem, passphrase }); } catch { throw new WssError('The decryption key of this service cannot be read'); }
  const keys = all(doc, 'EncryptedKey', XENC);
  let bodyEncrypted = false;
  for (const ed of datas) {
    const id = idOf(ed);
    // Its content key: an EncryptedKey inside it, one listing it in a ReferenceList, or the only one there is.
    const ek = child(child(ed, 'KeyInfo', DSIG), 'EncryptedKey', XENC)
      || keys.find(k => all(k, 'DataReference', XENC).some(r => r.getAttribute('URI') === `#${id}`))
      || (keys.length === 1 ? keys[0] : undefined);
    if (!ek) throw new WssError('The encrypted data has no content key in the message');
    const key = unwrapKey(ek, privateKey);
    const alg = child(ed, 'EncryptionMethod', XENC)?.getAttribute('Algorithm') || '';
    const plain = decryptBlock(alg, key, Buffer.from(textOf(child(child(ed, 'CipherData', XENC), 'CipherValue', XENC)), 'base64')).toString('utf8');
    const holder = parse(`<sutra-decrypted ${inScope(ed.parentNode as Element)}>${plain}</sutra-decrypted>`).documentElement;
    const parent = ed.parentNode!;
    if (parent === body || ed.getAttribute('Type') === `${XENC}Content`) bodyEncrypted ||= parent === body;
    for (let c = holder.firstChild; c; c = c.nextSibling) parent.insertBefore(doc.importNode(c, true), ed);
    parent.removeChild(ed);
  }
  // The EncryptedKeys and reference lists have done their work.
  for (const k of keys) k.parentNode?.removeChild(k);
  for (const r of all(doc, 'ReferenceList', XENC)) r.parentNode?.removeChild(r);
  return { xml: new XMLSerializer().serializeToString(doc as any), bodyEncrypted, parts: datas.length };
}

/** Encrypts the Body content for the recipient's certificate; the EncryptedKey goes first in wsse:Security. */
export function encryptBody(xml: string, recipientCertPem: string, algorithm = 'aes256-gcm'): string {
  const alg = ENCRYPTION_ALGORITHMS[algorithm] || algorithm;
  const b = BLOCK[alg];
  if (!b) throw new Error(`Encryption algorithm ${algorithm} is not supported`);
  let cert: crypto.X509Certificate;
  try { cert = new crypto.X509Certificate(recipientCertPem); } catch { throw new Error('The recipient certificate for encryption is not a valid PEM certificate'); }
  const doc = parse(xml);
  const { body, security } = envelopeParts(doc);
  if (!security) throw new Error('Encryption needs a wsse:Security header');
  const ser = new XMLSerializer();
  let content = '';
  for (let c = body.firstChild; c; c = c.nextSibling) content += ser.serializeToString(c as any);
  const key = crypto.randomBytes(b.key);
  let data: Buffer;
  if (b.gcm) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv(b.cipher, key, iv) as crypto.CipherGCM;
    data = Buffer.concat([iv, c.update(content, 'utf8'), c.final(), c.getAuthTag()]);
  } else {
    const iv = crypto.randomBytes(16);
    const c = crypto.createCipheriv(b.cipher, key, iv);
    data = Buffer.concat([iv, c.update(content, 'utf8'), c.final()]);
  }
  const wrapped = crypto.publicEncrypt({ key: cert.publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' }, key);
  const edId = `ED-${crypto.randomUUID()}`, ekId = `EK-${crypto.randomUUID()}`;
  const thumb = crypto.createHash('sha1').update(cert.raw).digest('base64');
  const ekXml = `<xenc:EncryptedKey xmlns:xenc="${XENC}" Id="${ekId}"><xenc:EncryptionMethod Algorithm="${XENC}rsa-oaep-mgf1p"><ds:DigestMethod xmlns:ds="${DSIG}" Algorithm="${DSIG}sha1"/></xenc:EncryptionMethod>`
    + `<ds:KeyInfo xmlns:ds="${DSIG}"><wsse:SecurityTokenReference xmlns:wsse="${NS.wsse}"><wsse:KeyIdentifier EncodingType="${NS.b64}" ValueType="http://docs.oasis-open.org/wss/oasis-wss-soap-message-security-1.1#ThumbprintSHA1">${thumb}</wsse:KeyIdentifier></wsse:SecurityTokenReference></ds:KeyInfo>`
    + `<xenc:CipherData><xenc:CipherValue>${wrapped.toString('base64')}</xenc:CipherValue></xenc:CipherData><xenc:ReferenceList><xenc:DataReference URI="#${edId}"/></xenc:ReferenceList></xenc:EncryptedKey>`;
  const edXml = `<xenc:EncryptedData xmlns:xenc="${XENC}" Id="${edId}" Type="${XENC}Content"><xenc:EncryptionMethod Algorithm="${alg}"/><xenc:CipherData><xenc:CipherValue>${data.toString('base64')}</xenc:CipherValue></xenc:CipherData></xenc:EncryptedData>`;
  while (body.firstChild) body.removeChild(body.firstChild);
  body.appendChild(doc.importNode(parse(edXml).documentElement, true));
  security.insertBefore(doc.importNode(parse(ekXml).documentElement, true), security.firstChild);
  return ser.serializeToString(doc as any);
}
