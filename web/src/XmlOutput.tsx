/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 2.0.7
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { useMemo, useState } from 'react';
type XmlNode = { name: string; attributes: [string, string][]; text?: string; children: XmlNode[] };
function fromObject(name: string, value: any, depth = 0): XmlNode {
  if (depth > 40) return { name, attributes: [], text: '(depth limit)', children: [] };
  if (!value || typeof value !== 'object') return { name, attributes: [], text: String(value ?? ''), children: [] };
  return { name, attributes: Object.entries(value).filter(([k]) => k.startsWith('@_')).map(([k, v]) => [k.slice(2), String(v)]),
    text: value['#text'] === undefined ? undefined : String(value['#text']),
    children: Object.entries(value).filter(([k]) => !k.startsWith('@_') && k !== '#text').flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map(item => fromObject(k, item, depth + 1))) };
}
function fromElement(element: Element, depth = 0): XmlNode {
  return { name: element.tagName, attributes: [...element.attributes].map(a => [a.name, a.value]),
    text: [...element.childNodes].filter(n => n.nodeType === 3 || n.nodeType === 4).map(n => n.textContent).join('').trim() || undefined,
    children: depth < 40 ? [...element.children].map(c => fromElement(c, depth + 1)) : [] };
}
/** Escaped React text only: no innerHTML, scripts, external resources or entity declarations. */
export function XmlOutput({ value, xmlActivity = false }: { value: any; xmlActivity?: boolean }) {
  const [open, setOpen] = useState(false);
  const result = useMemo(() => {
    const text = typeof value === 'string' ? value : [value?.text, value?.xml, value?.body, value?.content].find(v => typeof v === 'string' && v.trim().startsWith('<'));
    if (typeof text === 'string' && text.trim().startsWith('<')) {
      if (text.length > 1024 * 1024) return { error: 'XML tree is limited to 1 MB. Use raw output for larger documents.' };
      if (/<!DOCTYPE|<!ENTITY/i.test(text)) return { error: 'XML tree refuses DTD/entity declarations.' };
      const parsed = new DOMParser().parseFromString(text, 'application/xml');
      if (parsed.getElementsByTagName('parsererror').length) return { error: 'Output is not well-formed XML. Inspect the raw text.' };
      return { roots: [fromElement(parsed.documentElement)] };
    }
    if (xmlActivity && value && typeof value === 'object') return { roots: Object.entries(value).filter(([k]) => !k.startsWith('@_')).map(([k, v]) => fromObject(k, v)) };
    return null;
  }, [value, xmlActivity]);
  if (!result) return null;
  const branch = (n: XmlNode, path: string, depth: number): any => <details key={path} open={depth < 2} style={{ marginLeft: depth ? 14 : 0 }}>
    <summary><code>&lt;{n.name}&gt;</code> {n.text && <span>{n.text}</span>} {n.children.length > 0 && <small>({n.children.length} child elements)</small>}</summary>
    {n.attributes.map(([k, v]) => <div key={k} style={{ paddingLeft: 16 }}><code>@{k}</code> = {v}</div>)}
    {n.children.map((child, i) => branch(child, path + '/' + i, depth + 1))}
  </details>;
  return <div className="mapping-preview"><button className="btn small" onClick={() => setOpen(!open)}>{open ? 'Hide XML tree' : 'Show XML tree'}</button>
    {open && (result.error ? <div className="warnbox">{result.error}</div> : <div aria-label="XML output tree">{result.roots?.map((root, i) => branch(root, String(i), 0))}</div>)}
  </div>;
}
