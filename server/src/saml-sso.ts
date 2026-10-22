/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 2.0.0
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
/** SAML 2.0 browser sign-on: Redirect AuthnRequest and signed HTTP-POST Response verification. */
import crypto from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { DOMParser } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';

const SAML = 'urn:oasis:names:tc:SAML:2.0:assertion';
const SAMLP = 'urn:oasis:names:tc:SAML:2.0:protocol';
const DSIG = 'http://www.w3.org/2000/09/xmldsig#';
const SUCCESS = 'urn:oasis:names:tc:SAML:2.0:status:Success';

export class SamlError extends Error {}

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const kids = (n: Node | null | undefined): Element[] => {
  const out: Element[] = [];
  for (let c = n?.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) out.push(c as Element);
  return out;
};
const child = (n: Node | null | undefined, local: string, ns?: string) => kids(n).find(e => e.localName === local && (!ns || e.namespaceURI === ns));
function all(n: Node, local: string, ns?: string): Element[] {
  const out: Element[] = [];
  const walk = (x: Node) => { for (const e of kids(x)) { if (e.localName === local && (!ns || e.namespaceURI === ns)) out.push(e); walk(e); } };
  walk(n);
  return out;
}
const text = (e: Element | undefined) => (e?.textContent || '').trim();
const id = (e: Element) => e.getAttribute('ID') || '';

function parse(xml: string) {
  if (Buffer.byteLength(xml) > 2 * 1024 * 1024) throw new SamlError('The SAML response is larger than 2 MB');
  if (/<!DOCTYPE/i.test(xml)) throw new SamlError('DOCTYPE is not allowed in a SAML response');
  const errors: string[] = [];
  const doc = new DOMParser({ errorHandler: { warning: () => {}, error: (m: string) => errors.push(m), fatalError: (m: string) => errors.push(m) } }).parseFromString(xml, 'text/xml');
  if (errors.length || !doc?.documentElement) throw new SamlError(`The SAML response is not valid XML${errors[0] ? `: ${errors[0]}` : ''}`);
  return doc as unknown as Document;
}

export function buildAuthnRequest(requestId: string, entityId: string, acsUrl: string) {
  const xml = `<samlp:AuthnRequest xmlns:samlp="${SAMLP}" xmlns:saml="${SAML}" ID="${esc(requestId)}" Version="2.0" IssueInstant="${new Date().toISOString()}" Destination="${esc(acsUrl)}" AssertionConsumerServiceURL="${esc(acsUrl)}" ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"><saml:Issuer>${esc(entityId)}</saml:Issuer><samlp:NameIDPolicy AllowCreate="true" Format="urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified"/></samlp:AuthnRequest>`;
  return deflateRawSync(Buffer.from(xml)).toString('base64');
}

function certs(pem: string) {
  const blocks = String(pem || '').match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [];
  if (!blocks.length) throw new SamlError('The SAML settings have no identity-provider signing certificate');
  return blocks;
}

function signedIds(sig: Element, xml: string, certPem: string) {
  // xml-crypto already treats ID, Id and id as reference identifiers. Adding ID
  // again makes its wrapping-attack check see every legitimate ID twice.
  const sx = new SignedXml({ publicCert: certPem, getCertFromKeyInfo: () => null });
  sx.loadSignature(sig);
  let ok = false;
  try { ok = sx.checkSignature(xml); } catch { return null; }
  if (!ok) return null;
  return sx.getReferences().map(r => String(r.uri || '').replace(/^#/, ''));
}

function verifyElement(el: Element, xml: string, trustedPem: string) {
  const sig = child(el, 'Signature', DSIG);
  if (!sig || !id(el)) return false;
  for (const cert of certs(trustedPem)) {
    const refs = signedIds(sig, xml, cert);
    if (refs?.includes(id(el))) return true;
  }
  return false;
}

export interface SamlIdentity { subject: string; name: string; email: string; issuer: string; attributes: Record<string, string[]> }

export function verifySamlResponse(xml: string, o: {
  trustedCertPem: string; idpIssuer?: string; audience: string; recipient: string; requestId: string; skewSec?: number;
}): SamlIdentity {
  const doc = parse(xml);
  const response = doc.documentElement;
  if (response.localName !== 'Response' || response.namespaceURI !== SAMLP) throw new SamlError('The identity provider did not send a SAML Response');
  if (response.getAttribute('InResponseTo') !== o.requestId) throw new SamlError('The SAML response does not match the sign-in this browser started');
  if (response.getAttribute('Destination') !== o.recipient) throw new SamlError('The SAML response was sent to another address');
  const status = child(child(response, 'Status', SAMLP), 'StatusCode', SAMLP)?.getAttribute('Value');
  if (status !== SUCCESS) throw new SamlError(`The identity provider refused the sign-in (${status || 'no SAML status'})`);
  const assertions = kids(response).filter(e => e.localName === 'Assertion' && e.namespaceURI === SAML);
  if (assertions.length !== 1) throw new SamlError(assertions.length ? 'The SAML response contains more than one assertion' : 'The SAML response has no assertion');
  const assertion = assertions[0];
  if (!verifyElement(assertion, xml, o.trustedCertPem) && !verifyElement(response, xml, o.trustedCertPem)) throw new SamlError('The SAML response or assertion does not have a valid trusted signature');

  const issuer = text(child(assertion, 'Issuer', SAML));
  if (!issuer) throw new SamlError('The SAML assertion has no issuer');
  if (o.idpIssuer && issuer !== o.idpIssuer) throw new SamlError(`The SAML assertion comes from ${issuer || 'an unnamed issuer'}, not ${o.idpIssuer}`);
  const skew = (o.skewSec ?? 60) * 1000, now = Date.now();
  const conditions = child(assertion, 'Conditions', SAML);
  const nb = conditions?.getAttribute('NotBefore'), na = conditions?.getAttribute('NotOnOrAfter');
  if (nb && Date.parse(nb) - skew > now) throw new SamlError('The SAML assertion is not valid yet');
  if (!na || !Number.isFinite(Date.parse(na)) || Date.parse(na) + skew <= now) throw new SamlError('The SAML assertion has expired or has no expiry');
  const audiences = conditions ? all(conditions, 'Audience', SAML).map(text) : [];
  if (!audiences.includes(o.audience)) throw new SamlError(`The SAML assertion is not meant for ${o.audience}`);

  const subject = child(assertion, 'Subject', SAML);
  const nameId = text(child(subject, 'NameID', SAML));
  if (!nameId) throw new SamlError('The SAML assertion names no person');
  const confirmations = kids(subject).filter(e => e.localName === 'SubjectConfirmation' && e.namespaceURI === SAML
    && e.getAttribute('Method') === 'urn:oasis:names:tc:SAML:2.0:cm:bearer')
    .map(e => child(e, 'SubjectConfirmationData', SAML)).filter((e): e is Element => !!e);
  const confirmation = confirmations.find(c => {
    const recipient = c.getAttribute('Recipient'), expires = c.getAttribute('NotOnOrAfter') || '';
    return recipient === o.recipient && c.getAttribute('InResponseTo') === o.requestId
      && Number.isFinite(Date.parse(expires)) && Date.parse(expires) + skew > now;
  });
  if (!confirmation) throw new SamlError('The SAML assertion is not a current response for this sign-in address');

  const attributes: Record<string, string[]> = {};
  for (const a of all(assertion, 'Attribute', SAML)) {
    const name = a.getAttribute('Name') || a.getAttribute('FriendlyName') || '';
    if (name) attributes[name] = all(a, 'AttributeValue', SAML).map(text);
  }
  const first = (name: string) => attributes[name]?.[0] || '';
  return { subject: nameId, issuer, attributes, name: first('name') || first('displayName'), email: first('email') || first('mail') };
}

