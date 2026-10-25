/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 2.0.10
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available; see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import type { FlowDoc, FlowNode } from './engine/types.js';
/** Shipped fixtures contain neither credentials nor captured database data. */
export function mongoSamples(connection: string): FlowDoc[] {
  const common = { connection, collection: 'sutraflow_sample_orders' };
  const filter = '=object(\'_id\', {run.id})';
  const definitions: [string, string, Record<string, any>, string][] = [
    ['start', 'Order input', { payload: '{"name":"SutraFlow sample","amount":25}', validateSchema: true }, 'Strict input contract is imported with this sample. Supplies only explicit fixture data.'],
    ['mongoInsert', 'Insert this run order', { ...common, documents: '=object(\'_id\', {run.id}, \'name\', {input.name}, \'amount\', {input.amount}, \'lines\', list(object(\'sku\', \'A\', \'quantity\', 1), object(\'sku\', \'B\', \'quantity\', 2)))', ordered: true }, 'Inserts one document keyed by the current run ID. Configure the connection using separate credentials or a complete-URI secret.'],
    ['mongoListCollections', 'List sample collection', { connection, filter: '{"name":"sutraflow_sample_orders"}' }, 'Lists authorized metadata for the sample collection, not its documents. Collection names are selected on each document activity; mapped Collection from input overrides the General value.'],
    ['mongoFind', 'Read this run order', { ...common, filter, operation: 'findOne' }, 'Reads only this run-ID document. BSON types are preserved using Extended JSON.'],
    ['mongoFind', 'Count this run order', { ...common, filter, operation: 'count' }, 'Counts only this run-ID document. Expected count=1. Ordinary Find does not implicitly run a total count.'],
    ['mongoFind', 'Distinct order name', { ...common, filter, operation: 'distinct', field: 'name' }, 'Returns one distinct name value for this run-ID document only: SutraFlow sample.'],
    ['mongoUpdate', 'Update this run order', { ...common, filter, operation: 'updateOne', update: '{"$set":{"status":"processed"}}' }, 'Updates only this run document. Expected matchedCount=1 and modifiedCount=1. An update modifier is not a full-document schema.'],
    ['mongoUpdate', 'Update selected order line', { ...common, filter, operation: 'findOneAndUpdate', update: '{"$set":{"lines.$[line].quantity":9}}', arrayFilters: '[{"line.sku":"B"}]', returnDocument: 'after' }, 'Updates only line B and returns the post-update document. Line A remains unchanged. Array filters select repeated nested elements; they do not make a multi-document batch atomic.'],
    ['mongoAggregate', 'Aggregate this run order', { ...common, pipeline: '=list(object(\'$match\', object(\'_id\', {run.id})))' }, 'Read-only pipeline returns this run document. No disk spill, write stages or server JavaScript.'],
    ['mongoDelete', 'Delete this run order', { ...common, filter, many: false }, 'Deletes only this run-ID document. On earlier failure, review that exact document; never delete a whole user collection.'],
  ];
  const nodes: FlowNode[] = definitions.map(([type, name, config, description], i) => ({ id: `m${i}`, type, name, config, description, x: 60 + i * 300, y: 200 }));
  return [{ name: 'Sample: MongoDB M0 document lifecycle', description: 'MongoDB insert/list collections/read/update/aggregate/delete scoped to one run ID, tested on Atlas M0. Configure separate credentials or a complete URI through Secret properties on the connection, plus database network access. The imported connection selects the MONGODB_URI Secret property by default. No credentials are included.', nodes, edges: nodes.slice(0, -1).map((n, i) => ({ id: `me${i}`, from: n.id, port: 'out', to: nodes[i + 1].id })) }];
}
