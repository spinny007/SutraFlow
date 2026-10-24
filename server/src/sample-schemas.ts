/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 2.0.6
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { adhocTree } from './mapping.js';
import { listSchemas, saveSchema, type SNode } from './schemas.js';
import { setItemFolder } from './folders.js';
import type { FlowDoc } from './engine/types.js';

/** Ship browsable contracts with samples; never overwrite a user's existing schema. */
export function attachSampleSchemas(projectId: string, doc: FlowDoc) {
  const existing = listSchemas(projectId);
  const schema = (label: string, kind: 'json' | 'xsd', text: string, root?: string) => {
    const name = `${doc.name} — ${label}`;
    const found = existing.find(s => s.name === name && s.kind === kind);
    if (found) return found.id;
    const saved = saveSchema({ project_id: projectId, name, kind, text, root });
    setItemFolder('schemas', saved.id, 'Samples/Data and mapping');
    existing.push(saved);
    return saved.id;
  };
  const targetSchema = (n: SNode): any => {
    const value = n.children?.length ? { type: 'object', properties: Object.fromEntries(n.children.map(c => [c.name, targetSchema(c)])), required: n.children.filter(c => c.required).map(c => c.name) } : n.type === 'any' ? {} : { type: n.type === 'date' ? 'string' : n.type };
    return n.repeats ? { type: 'array', items: value, minItems: n.minItems, maxItems: n.maxItems } : value;
  };
  const start = doc.nodes.find(n => n.type === 'start');
  let payload: any;
  try { payload = JSON.parse(String(start?.config.payload || '')); } catch { /* Not every starter carries JSON text. */ }
  for (const node of doc.nodes) {
    const cfg = node.config;
    if (node.type === 'start' && payload !== undefined && !cfg.schema) {
      cfg.schema = schema(`${node.name} payload`, 'json', JSON.stringify(payload, null, 2));
    }
    if ((node.type === 'mapper' || node.type === 'mapperJson' || (node.type === 'renderJson' && cfg.source === 'mapping')) && !cfg.schema) {
      const tree = adhocTree(cfg.mapping as any);
      if (tree.children?.length) cfg.schema = schema(`${node.name} target`, 'json', JSON.stringify({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        description: `Target fields for ${node.name}. Formulas define the values; unconstrained leaves preserve the sample's value types.`,
        ...targetSchema(tree),
      }, null, 2));
    }
    if (node.type === 'parseJson' && !cfg.schema && cfg.text === '{{input.json}}' && typeof payload?.json === 'string') {
      cfg.schema = schema(`${node.name} output`, 'json', JSON.stringify(JSON.parse(payload.json), null, 2));
    }
    if (node.type === 'parseXml' && doc.name === 'Sample: XML in and out' && !cfg.schema) {
      cfg.schema = schema('Order XML', 'xsd', `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="Order"><xs:complexType><xs:sequence><xs:element name="Line" maxOccurs="unbounded"><xs:complexType><xs:attribute name="sku" type="xs:string"/><xs:attribute name="qty" type="xs:decimal"/><xs:attribute name="price" type="xs:decimal"/></xs:complexType></xs:element></xs:sequence><xs:attribute name="id" type="xs:string"/><xs:attribute name="currency" type="xs:string"/></xs:complexType></xs:element></xs:schema>`, 'Order');
    }
    if (node.type === 'renderXml' && doc.name === 'Sample: XML in and out') {
      cfg.schema = schema('Invoice XML', 'xsd', `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="Invoice"><xs:complexType><xs:sequence><xs:element name="Number" type="xs:string"/><xs:element name="Currency" type="xs:string"/><xs:element name="Item" maxOccurs="unbounded"><xs:complexType><xs:sequence><xs:element name="Sku" type="xs:string"/><xs:element name="Amount" type="xs:decimal"/></xs:sequence></xs:complexType></xs:element></xs:sequence></xs:complexType></xs:element></xs:schema>`, 'Invoice');
      cfg.source = 'mapping';
      cfg.mapping = { rules: { Invoice: { expr: '{input}' } } };
    }
    if (node.type === 'renderJson' && !cfg.schema && cfg.source === 'value' && cfg.value === '{{input}}') {
      const previous = doc.nodes.find(n => doc.edges.some(e => e.to === node.id && e.from === n.id) && ['mapper', 'mapperJson'].includes(n.type));
      if (previous?.config.schema) cfg.schema = previous.config.schema;
    }
    if (cfg.schema && ['mapperJson', 'mapperXml', 'parseJson', 'parseXml', 'renderJson', 'renderXml'].includes(node.type)) {
      cfg.validateSchema ??= true;
      node.description = (node.description ? node.description + '\n' : '') + 'Validate against schema is enabled: a contract violation follows the red error output before downstream processing.';
    }
  }
}
