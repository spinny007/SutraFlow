/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 2.0.7
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import type { FlowDoc, FlowNode } from './engine/types.js';
export function typedMappingSamples(): FlowDoc[] {
  const node = (id: string, type: string, name: string, x: number, config: Record<string, any>): FlowNode => ({ id, type, name, x, y: 180, config: type === 'start' ? { ...config, validateSchema: true } : config, description: name + ': typed mapping demonstration; see the Input tab and mapped-result preview.' });
  const edges = [{ id: 'sm', from: 's', port: 'out', to: 'm' }, { id: 'mr', from: 'm', port: 'out', to: 'r' }];
  const samples: FlowDoc[] = [{
    name: 'Sample: Typed JSON mapping',
    description: 'Map JSON Data uses a shared typed target with required id, boolean active and a repeating integer list; Render JSON produces text. Preview without executing downstream steps.',
    nodes: [
      node('s', 'start', 'User input', 60, { payload: JSON.stringify({ id: 'U-7', active: true, scores: [2, 5] }) }),
      node('m', 'mapperJson', 'Build typed JSON', 380, { schema: '', mapping: {
        fields: ['id', 'active', 'scores[]'],
        definitions: { id: { type: 'string', required: true }, active: { type: 'boolean' }, scores: { type: 'integer', repeats: true, minItems: 1, maxItems: 10 } },
        rules: { id: { expr: '{input.id}' }, active: { expr: '{input.active}' }, scores: { expr: '{input.scores}' } },
      } }),
      node('r', 'renderJson', 'Serialize JSON', 700, { source: 'value', value: '{{input}}', pretty: true }),
    ], edges,
  }, {
    name: 'Sample: Typed XML mapping',
    description: 'Manually typed XML: User is the single root, status a required attribute, id an integer, Score a repeating integer element and urn:sutra:sample:user the default namespace. Select a target to change its options; Render XML produces text.',
    nodes: [
      node('s', 'start', 'User input', 60, { payload: JSON.stringify({ id: 7, status: 'active', scores: [2, 5] }) }),
      node('m', 'mapperXml', 'Build typed XML', 380, { schema: '', mapping: {
        fields: ['User/@_status', 'User/id', 'User/Score[]'],
        definitions: { User: { type: 'object', required: true, namespace: 'urn:sutra:sample:user' }, 'User/@_status': { type: 'string', required: true }, 'User/id': { type: 'integer', required: true }, 'User/Score': { type: 'integer', repeats: true, minItems: 1 } },
        rules: { 'User/@_status': { expr: '{input.status}' }, 'User/id': { expr: '{input.id}' }, 'User/Score': { expr: '{input.scores}' } },
      } }),
      node('r', 'renderXml', 'Serialize XML', 700, { source: 'mapping', schema: '', mapping: { fields: ['User'], rules: { User: { expr: '{input.User}' } } }, declaration: true }),
    ], edges,
  }];
  const renamed = structuredClone(samples[1]);
  renamed.name = 'Sample: Renamed fields to XML';
  renamed.description = 'Transform JSON zone:[2,5] into two XML User/Score integer elements. Source and target names intentionally differ. Expected output contains Score 2 and Score 5; no scores source field is needed. Manual typed targets enforce the field types; no XSD contract is selected.';
  renamed.nodes[0].config.payload = JSON.stringify({ id: 7, status: 'active', zone: [2, 5] });
  renamed.nodes[0].description = 'Supplies JSON id=7, status=active and zone=[2,5]. The imported source schema is inferred from this payload. There is intentionally no scores property.';
  renamed.nodes[1].config.mapping.rules['User/Score'].expr = '{input.zone}';
  renamed.nodes[1].description = 'Maps input.zone to repeating integer User/Score, input.id to User/id and input.status to the status attribute. Renaming and JSON-to-XML transformation do not require matching field names.';
  renamed.nodes[2].description = 'Serializes the transformed User object to XML with status="active", id 7 and two Score elements containing 2 and 5. View the full output text to inspect every repeated element.';
  return [...samples, renamed];
}
