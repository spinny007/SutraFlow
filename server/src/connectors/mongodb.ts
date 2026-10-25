/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 2.0.10
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available; see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import crypto from 'node:crypto';
import { MongoClient, BSON, type Document, type MongoClientOptions } from 'mongodb';
import type { Activity, ExecCtx } from '../engine/types.js';
import { requireResource, type Resource } from '../resources.js';
import { F, when } from '../palettes/common.js';
import { enforceContract, contractDefinition } from '../contracts.js';
import { mongoAuthMode } from './mongodb-kind.js';
import { SECRET_NAME } from '../secrets.js';
import { booleanSetting } from '../settings.js';

type Secret = (name: string, what?: string) => string;
const pools = new Map<string, { client: MongoClient; ready: Promise<MongoClient>; resourceId: string }>();
const number = (value: unknown, fallback: number, min: number, max: number, label: string) => {
  const n = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label}: enter an integer from ${min} to ${max}.`);
  return n;
};

/** Do not return raw driver errors: URIs, filters and document values can contain secrets. */
export function mongoError(error: any): Error {
  const code = Number.isInteger(error?.code) ? error.code : undefined;
  const category = /^query(?:Srv|Txt)\b/.test(String(error?.message || '')) ? 'DNS SRV/TXT resolution failed' : code === 11000 ? 'duplicate key' : code === 121 ? 'collection validation rejected the document' : code === 13 || code === 18 ? 'authorization/authentication failed' : error?.name === 'AbortError' ? 'cancelled' : 'operation failed';
  const guidance = category === 'DNS SRV/TXT resolution failed' ? 'The DNS lookup failed before authentication; changing Secret references will not fix DNS. Ask an administrator to check the process DNS resolver (SUTRA_DNS_SERVERS), or use the Atlas-provided standard mongodb:// seed-list URI. TLS verification remains enabled.' : 'Review the connection, database-user permissions, network access and operation settings.';
  return Object.assign(new Error(`MongoDB ${category}${code ? ` (code ${code})` : ''}. ${guidance}`), { details: { connector: 'mongodb', ...(code ? { code } : {}), category } });
}

export function mongoSettings(resource: Resource, secret: Secret) {
  const cfg = resource.config;
  const readSecret = (ref: unknown, label: string) => {
    if (typeof ref !== 'string' || !SECRET_NAME.test(ref)) throw new Error(`${label}: select a stored secret or enter its value in the connection; a secret reference is not a URI or password.`);
    try { return secret(ref, label); } catch { throw new Error(`${label}: stored value is unavailable. Enter and store it in the connection, or select an existing secret.`); }
  };
  const mode = mongoAuthMode(cfg);
  if (!['URI secret', 'username/password', 'X.509'].includes(mode)) throw new Error('Unknown MongoDB authentication configuration.');
  let address = String(cfg.uri || '').trim();
  if (mode !== 'URI secret' && !address) {
    const host = String(cfg.host || '').trim();
    if (!host || /[@/?#\s,]/.test(host)) throw new Error('Enter a MongoDB host without credentials, scheme or path; use the advanced URI for a seed list.');
    const srv = booleanSetting(cfg.srv ?? true, 'MongoDB DNS SRV');
    address = srv ? `mongodb+srv://${host}/` : `mongodb://${host}:${number(cfg.port, 27017, 1, 65535, 'MongoDB port')}/`;
  }
  const uri = mode === 'URI secret' ? readSecret(cfg.uriSecret, 'MongoDB connection URI') : address;
  let auth: { username: string; password: string } | undefined;
  if (mode !== 'URI secret') {
    const authority = /^mongodb(?:\+srv)?:\/\/([^/?#]+)/.exec(uri)?.[1];
    if (authority?.includes('@') || /[?&](?:password|proxyPassword|tlsCertificateKeyFilePassword)=/i.test(uri)) throw new Error('Server URI must not contain credentials. Use Username and Password, or the encrypted complete-URI option.');
    const username = String(cfg.username || '');
    if (mode === 'username/password') {
      if (!username) throw new Error('MongoDB username is required.');
      auth = { username, password: readSecret(cfg.passwordSecret, 'MongoDB password') };
      if (!['DEFAULT', 'SCRAM-SHA-256', 'SCRAM-SHA-1'].includes(cfg.authMechanism || 'DEFAULT')) throw new Error('Unsupported MongoDB authentication mechanism.');
    }
  }
  if (!/^mongodb(?:\+srv)?:\/\//.test(uri)) throw new Error('MongoDB URI must start with mongodb:// or mongodb+srv://.');
  const tls = booleanSetting(cfg.tlsEnabled ?? true, 'MongoDB TLS');
  if (/[?&](?:tlsInsecure|tlsAllowInvalidCertificates|tlsAllowInvalidHostnames)=true(?:&|$)/i.test(uri)) throw new Error('MongoDB certificate/hostname verification cannot be disabled.');
  if (tls && /[?&](?:tls|ssl)=false(?:&|$)/i.test(uri)) throw new Error('URI TLS setting conflicts with TLS enabled.');
  if (!tls) {
    const host = /^mongodb:\/\/([^/?#]+)/.exec(uri)?.[1]?.replace(/^.*@/, '');
    if (!host || !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host) || mode === 'X.509' || /[?&](?:tls|ssl)=true(?:&|$)/i.test(uri)) throw new Error('TLS can be disabled only for a direct loopback development connection, never X.509.');
  }
  const transport: MongoClientOptions = { tls, tlsAllowInvalidCertificates: false, tlsAllowInvalidHostnames: false };
  if (cfg.caCertSecret) { if (!tls) throw new Error('Trusted CA requires TLS.'); transport.ca = readSecret(cfg.caCertSecret, 'MongoDB trusted CA'); }
  if (mode === 'X.509') {
    if (!cfg.clientCertPem) throw new Error('X.509 requires a client certificate and private key.');
    transport.cert = cfg.clientCertPem; transport.key = readSecret(cfg.clientKeySecret, 'MongoDB client private key');
    if (cfg.clientKeyPassSecret) transport.passphrase = readSecret(cfg.clientKeyPassSecret, 'MongoDB client-key passphrase');
    transport.authMechanism = 'MONGODB-X509'; transport.authSource = '$external';
    if (cfg.username) transport.auth = { username: String(cfg.username) };
  }
  const readPreference = cfg.readPreference || 'primary';
  if (!['primary', 'primaryPreferred', 'secondary', 'secondaryPreferred', 'nearest'].includes(readPreference)) throw new Error('Unsupported MongoDB read preference.');
  if (!['Atlas M0 baseline', 'General MongoDB'].includes(cfg.capabilities || 'Atlas M0 baseline')) throw new Error('Unknown MongoDB deployment capabilities.');
  const database = String(cfg.database || '').trim();
  if (!database || ['admin', 'config', 'local'].includes(database) || /[\/\\. "$\0]/.test(database)) throw new Error('Choose an application MongoDB database, not admin/config/local.');
  const timeoutMS = number(cfg.timeoutMs, 15000, 100, 120000, 'MongoDB operation timeout');
  const maxPoolSize = number(cfg.maxPoolSize, 5, 1, 20, 'MongoDB pool size');
  const selection = number(cfg.serverSelectionTimeoutMS, 15000, 100, 120000, 'MongoDB server selection timeout');
  const options: MongoClientOptions = { ...transport, ...(auth ? { auth, authSource: String(cfg.authSource || 'admin'), ...(cfg.authMechanism && cfg.authMechanism !== 'DEFAULT' ? { authMechanism: cfg.authMechanism } : {}) } : {}), readPreference, maxPoolSize, minPoolSize: 0, timeoutMS, serverSelectionTimeoutMS: selection, waitQueueTimeoutMS: timeoutMS, appName: 'SutraFlow' };
  const key = crypto.createHash('sha256').update(JSON.stringify([resource.id, resource.rev, uri, database, options])).digest('hex');
  return { uri, database, timeoutMS, options, key };
}
export async function mongoConnection(resource: Resource, secret: Secret) {
  const { uri, database, timeoutMS, options, key } = mongoSettings(resource, secret);
  let pool = pools.get(key);
  if (!pool) {
    // A changed resource must not leave its old pool open indefinitely.
    for (const [oldKey, old] of pools) if (old.resourceId === resource.id) { pools.delete(oldKey); await old.client.close().catch(() => {}); }
    let client: MongoClient;
    try { client = new MongoClient(uri, options); }
    catch (error) { throw mongoError(error); }
    pool = { client, ready: client.connect(), resourceId: resource.id };
    pools.set(key, pool);
  }
  try { await pool.ready; return { client: pool.client, db: pool.client.db(database), timeoutMS }; }
  catch (error) { pools.delete(key); await pool.client.close().catch(() => {}); throw mongoError(error); }
}
export async function closeMongoPools() {
  const all = [...pools.values()]; pools.clear();
  await Promise.all(all.map(p => p.client.close().catch(() => {})));
}
export async function testMongoConnection(resource: Resource, secret: Secret) {
  // A test connection must not reuse or retire an active activity pool.
  const id = `mongo-test-${crypto.randomUUID()}`;
  try { const { db } = await mongoConnection({ ...resource, id }, secret); await db.command({ ping: 1 }); return 'Connected to MongoDB over verified TLS; no data changed.'; }
  finally { for (const [key, pool] of pools) if (pool.resourceId === id) { pools.delete(key); await pool.client.close().catch(() => {}); } }
}

/** Public durable values use canonical Extended JSON; BSON instances never enter engine storage. */
export const mongoPublic = (value: any): any => BSON.EJSON.serialize(value, { relaxed: false });
export function mongoDocument(value: unknown, label: string): Document {
  let parsed: any;
  try { parsed = typeof value === 'string' ? BSON.EJSON.parse(value, { relaxed: false }) : BSON.EJSON.deserialize(value as Document, { relaxed: false }); }
  catch { throw new Error(`${label} must be valid JSON/Extended JSON.`); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed instanceof Date || parsed._bsontype) throw new Error(`${label} must be a document object.`);
  return parsed;
}
function collectionName(value: unknown) {
  const name = String(value || '').trim();
  if (!name || name.startsWith('system.') || /[$\0]/.test(name)) throw new Error('MongoDB collection must be non-empty, non-system and contain no $ or NUL.');
  return name;
}
const connectionField = F('connection', 'MongoDB connection', 'resource', '', { resourceKind: 'mongodb', vars: true });
const collectionField = F('collection', 'Collection', 'text', 'documents');
const collectionInputField = F('collectionInput', 'Collection from input (optional override)', 'text', '', { tpl: true, help: 'Map an incoming collection name here. A supplied value overrides Collection; blank/unmapped uses the General setting.' });
function activityCollection(c: ExecCtx) {
  const input = c.v('collectionInput');
  const value = input === undefined || input === null || input === '' ? c.raw('collection') : input;
  if (typeof value !== 'string') throw new Error('MongoDB collection name must be a string.');
  return collectionName(value);
}
const filterField = F('filter', 'Filter (JSON / Extended JSON)', 'text', '{}', { tpl: true, help: 'Structured query operators are supported. No JavaScript or shell expressions.' });
const schemaFields = (label: string) => [F('schema', label, 'schema', '', { schemaKinds: ['json'], vars: true }), F('validateSchema', 'Strict schema validation', 'bool', false, { help: 'On requires the selected contract and validates the documented subject without coercion.' })];
const docField = (key: string, label: string, value = '{{input}}') => F(key, label, 'text', value, { tpl: true });
function resourceFor(c: ExecCtx) {
  const resource = requireResource(c.raw('connection'), 'mongodb', 'MongoDB connection');
  if (resource.project_id && resource.project_id !== c.projectId) throw new Error('MongoDB connection belongs to another project.');
  return resource;
}
const options = (c: ExecCtx) => ({ signal: c.signal, maxTimeMS: number(c.raw('maxTimeMS'), 15000, 1, 120000, 'MongoDB server operation budget') });
async function validate(c: ExecCtx, value: any, subject: string) {
  if (c.raw('validateSchema')) await enforceContract(c.resolve(c.raw('schema')), value, { projectId: c.projectId, subject: `${c.node.name} ${subject}`, kind: 'json' });
}
function noJavascript(value: unknown) {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (['$where', '$function', '$accumulator'].includes(key)) throw new Error('Server-side JavaScript is not supported by the M0 activities.');
    noJavascript(item);
  }
}
export function mongoAggregationPolicy(capabilities: unknown, disk: unknown, writes: unknown) {
  const allowDiskUse = booleanSetting(disk ?? false, 'Allow disk use'), allowOutputStages = booleanSetting(writes ?? false, 'Allow output stages');
  const general = capabilities === 'General MongoDB';
  if (!general && (allowDiskUse || allowOutputStages)) throw new Error('Disk spill and aggregation output stages require General MongoDB capabilities and compatible server permissions; the M0 baseline keeps them disabled.');
  return { allowDiskUse, allowOutputStages, maxStages: general ? 1000 : 50 };
}

const candidates: Activity[] = [
  {
    type: 'mongoListCollections', palette: 'mongodb', name: 'List MongoDB collections', glyph: '{}', ports: ['out'],
    desc: 'Lists authorized collection names and types in the selected application database. No documents or collection definitions are returned.',
    fields: [connectionField, filterField, ...schemaFields('Collection metadata schema')],
    outputHint: { collections: [{ name: '', type: 'collection' }], count: 0 },
    execute: async c => {
      const filter = mongoDocument(c.v('filter') ?? '{}', 'Collection filter'); noJavascript(filter);
      const { db } = await mongoConnection(resourceFor(c), c.secret);
      const cursor = db.listCollections(filter, { ...options(c), nameOnly: true, authorizedCollections: true });
      const collections: { name: string; type: string }[] = [];
      try { for await (const info of cursor) {
        if (collections.length >= 1000) throw new Error('Collection list exceeds the 1000-entry ceiling. Narrow the filter.');
        const value = { name: info.name, type: info.type || 'collection' };
        await validate(c, value, 'collection metadata'); collections.push(value);
      } } finally { await cursor.close(); }
      collections.sort((a, b) => a.name.localeCompare(b.name));
      return { out: { collections, count: collections.length } };
    },
  },
  {
    type: 'mongoInsert', palette: 'mongodb', name: 'Insert MongoDB documents', glyph: '{}', ports: ['out'],
    desc: 'Inserts one or several documents. Strict mode validates every input document before any write. Ordered/unordered server failures can still leave partial writes.',
    fields: [connectionField, collectionField, collectionInputField, docField('documents', 'Document or document list'), F('ordered', 'Stop batch on first server error', 'bool', true), ...schemaFields('Input document schema')],
    outputHint: { acknowledged: true, insertedCount: 0, insertedIds: {} },
    execute: async c => {
      const raw = c.v('documents');
      let list: unknown;
      try { list = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { throw new Error('Documents must be valid JSON.'); }
      const values = Array.isArray(list) ? list : [list];
      if (!values.length || values.length > 1000) throw new Error('Insert requires 1 to 1000 documents.');
      for (const value of values) await validate(c, value, 'input document');
      const docs = values.map(v => mongoDocument(v, 'Insert document'));
      const { db } = await mongoConnection(resourceFor(c), c.secret);
      const result = await db.collection(activityCollection(c)).insertMany(docs, { ...options(c), ordered: c.raw('ordered'), writeConcern: { w: 'majority' } });
      return { out: { acknowledged: result.acknowledged, insertedCount: result.insertedCount, insertedIds: mongoPublic(result.insertedIds) } };
    },
  },
  {
    type: 'mongoFind', palette: 'mongodb', name: 'Find MongoDB documents', glyph: '{}', ports: ['out'],
    desc: 'Finds one/many documents, counts matches or returns distinct values. Strict mode validates each returned document/value, not the result envelope. BSON is preserved as canonical Extended JSON.',
    fields: [connectionField, collectionField, collectionInputField, F('operation', 'Operation', 'select', 'find', { options: ['find', 'findOne', 'count', 'distinct'] }), filterField, docField('projection', 'Projection', '{}'), docField('sort', 'Sort', '{}'), F('skip', 'Skip', 'number', 0), F('limit', 'Runtime limit (0 = no query limit)', 'number', 0), F('field', 'Distinct field', 'text', '', when('operation', 'distinct')), ...schemaFields('Returned document/value schema')],
    outputHint: { documents: [], count: 0 },
    execute: async c => {
      const filter = mongoDocument(c.v('filter') ?? '{}', 'Filter'); noJavascript(filter);
      const { db } = await mongoConnection(resourceFor(c), c.secret);
      const col = db.collection(activityCollection(c)), op = c.raw('operation') || 'find';
      if (op === 'count') { const count = await col.countDocuments(filter, options(c)); await validate(c, count, 'count'); return { out: { count } }; }
      if (op === 'distinct') { const field = String(c.raw('field') || ''); if (!field) throw new Error('Choose a distinct field.'); const values = mongoPublic(await col.distinct(field, filter, options(c))); for (const value of values) await validate(c, value, 'distinct value'); return { out: { values, count: values.length } }; }
      if (!['find', 'findOne'].includes(op)) throw new Error('Unknown MongoDB query operation.');
      const limit = op === 'findOne' ? 1 : number(c.raw('limit'), 0, 0, 1000000, 'MongoDB runtime limit');
      const cursor = col.find(filter, { ...options(c), projection: mongoDocument(c.v('projection') ?? '{}', 'Projection'), sort: mongoDocument(c.v('sort') ?? '{}', 'Sort'), skip: number(c.raw('skip'), 0, 0, 1000000, 'MongoDB skip'), limit });
      const documents: any[] = []; let bytes = 0;
      try { for await (const doc of cursor) { const value = mongoPublic(doc); bytes += Buffer.byteLength(JSON.stringify(value)); if (documents.length >= 10000 || bytes > 8 * 1024 * 1024) throw new Error('MongoDB result exceeds the 10000-document/8 MB durable-output ceiling. Configure paging; no truncated success is returned.'); await validate(c, value, 'returned document'); documents.push(value); } }
      finally { await cursor.close(); }
      return { out: { documents, count: documents.length } };
    },
  },
  {
    type: 'mongoUpdate', palette: 'mongodb', name: 'Update MongoDB documents', glyph: '{}', ports: ['out'],
    desc: 'Updates one/many matches or replaces one document. Strict mode applies to the update/replacement request. Modifier validation is not a guarantee about the final stored document; collection validators remain authoritative.',
    fields: [connectionField, collectionField, collectionInputField, filterField, F('operation', 'Operation', 'select', 'updateOne', { options: ['updateOne', 'updateMany', 'replaceOne', 'findOneAndUpdate'] }), docField('update', 'Update operators or replacement'), docField('arrayFilters', 'Array filters (optional JSON array)', '[]'), F('returnDocument', 'Returned document', 'select', 'after', { options: ['after', 'before'], ...when('operation', 'findOneAndUpdate') }), F('upsert', 'Insert when not found', 'bool', false), F('allowAll', 'Allow empty filter for updateMany', 'bool', false), ...schemaFields('Update request / replacement schema')],
    outputHint: { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 0, upsertedId: null },
    execute: async c => {
      const filter = mongoDocument(c.v('filter') ?? '{}', 'Filter'), value = c.v('update'); noJavascript(filter);
      await validate(c, typeof value === 'string' ? JSON.parse(value) : value, 'update/replacement request');
      const update = mongoDocument(value, 'Update/replacement'); noJavascript(update);
      const op = c.raw('operation') || 'updateOne';
      if (!['updateOne', 'updateMany', 'replaceOne', 'findOneAndUpdate'].includes(op)) throw new Error('Unknown MongoDB update operation.');
      if (op === 'updateMany' && !Object.keys(filter).length && !c.raw('allowAll')) throw new Error('Empty-filter updateMany requires Allow empty filter.');
      if (op === 'replaceOne' ? Object.keys(update).some(k => k.startsWith('$')) : !Object.keys(update).length || Object.keys(update).some(k => !k.startsWith('$'))) throw new Error('Use update operators for updateOne/updateMany; replaceOne requires a plain replacement document.');
      const { db } = await mongoConnection(resourceFor(c), c.secret);
      const rawFilters = c.v('arrayFilters') || [];
      let arrayFilters: any;
      try { arrayFilters = typeof rawFilters === 'string' ? BSON.EJSON.parse(rawFilters, { relaxed: false }) : BSON.EJSON.deserialize(rawFilters); } catch { throw new Error('Array filters must be valid JSON.'); }
      if (!Array.isArray(arrayFilters) || arrayFilters.some(v => !v || typeof v !== 'object' || Array.isArray(v))) throw new Error('Array filters must be an array of filter documents.');
      noJavascript(arrayFilters);
      if (op === 'replaceOne' && arrayFilters.length) throw new Error('Array filters do not apply to replacement operations.');
      const col = db.collection(activityCollection(c));
      const opts = { ...options(c), upsert: c.raw('upsert'), ...(arrayFilters.length ? { arrayFilters } : {}), writeConcern: { w: 'majority' as const } };
      if (op === 'findOneAndUpdate') {
        const returnDocument = c.raw('returnDocument') || 'after';
        if (!['before', 'after'].includes(returnDocument)) throw new Error('Returned document must be before or after.');
        const document = mongoPublic(await col.findOneAndUpdate(filter, update, { ...opts, returnDocument, includeResultMetadata: false }));
        return { out: { document, hasDocument: document !== null } };
      }
      const result = op === 'replaceOne' ? await col.replaceOne(filter, update, opts) : op === 'updateMany' ? await col.updateMany(filter, update, opts) : await col.updateOne(filter, update, opts);
      return { out: { acknowledged: result.acknowledged, matchedCount: result.matchedCount, modifiedCount: result.modifiedCount, upsertedCount: result.upsertedCount, upsertedId: mongoPublic(result.upsertedId) } };
    },
  },
  {
    type: 'mongoDelete', palette: 'mongodb', name: 'Delete MongoDB documents', glyph: '{}', ports: ['out'],
    desc: 'Deletes one or many matching documents. Deleting all documents requires explicit opt-in. Strict mode validates the filter request before deletion.',
    fields: [connectionField, collectionField, collectionInputField, filterField, F('many', 'Delete all matches', 'bool', false), F('allowAll', 'Allow empty filter for delete-many', 'bool', false), ...schemaFields('Filter request schema')],
    outputHint: { acknowledged: true, deletedCount: 0 },
    execute: async c => {
      const raw = c.v('filter') ?? '{}', filter = mongoDocument(raw, 'Filter'); noJavascript(filter);
      await validate(c, typeof raw === 'string' ? JSON.parse(raw) : raw, 'filter request');
      if (c.raw('many') && !Object.keys(filter).length && !c.raw('allowAll')) throw new Error('Empty-filter delete-many requires Allow empty filter.');
      const { db } = await mongoConnection(resourceFor(c), c.secret);
      const col = db.collection(activityCollection(c)), opts = { ...options(c), writeConcern: { w: 'majority' as const } };
      const result = c.raw('many') ? await col.deleteMany(filter, opts) : await col.deleteOne(filter, opts);
      return { out: { acknowledged: result.acknowledged, deletedCount: result.deletedCount } };
    },
  },
  {
    type: 'mongoAggregate', palette: 'mongodb', name: 'Aggregate MongoDB documents', glyph: '{}', ports: ['out'],
    desc: 'Runs a read-only aggregation by default. General MongoDB connections can explicitly enable disk use and output stages when the server permits them. Strict mode validates each returned result document.',
    fields: [connectionField, collectionField, collectionInputField, docField('pipeline', 'Pipeline (JSON array)', '[]'), F('allowDiskUse', 'Allow disk use', 'bool', false, { help: 'Requires General MongoDB connection capabilities and server support; disabled for the M0 baseline.' }), F('allowOutputStages', 'Allow output stages ($merge / $out)', 'bool', false, { help: 'Explicit write opt-in on General MongoDB only. Output stages can modify data and may return no documents; a zero result count is not a zero-write guarantee.' }), ...schemaFields('Result document schema')],
    outputHint: { documents: [], count: 0 },
    execute: async c => {
      const raw = c.v('pipeline'); let pipeline: any;
      try { pipeline = typeof raw === 'string' ? BSON.EJSON.parse(raw, { relaxed: false }) : BSON.EJSON.deserialize(raw); } catch { throw new Error('Aggregation pipeline must be valid JSON.'); }
      const resource = resourceFor(c), policy = mongoAggregationPolicy(resource.config.capabilities, c.raw('allowDiskUse'), c.raw('allowOutputStages'));
      if (!Array.isArray(pipeline) || pipeline.length > policy.maxStages) throw new Error(`Aggregation requires an array of at most ${policy.maxStages} stages for this connection profile.`);
      const inspect = (v: any) => { if (!v || typeof v !== 'object') return; for (const [k, x] of Object.entries(v)) { if (['$currentOp', '$listLocalSessions', '$listSessions', '$planCacheStats'].includes(k) || (!policy.allowOutputStages && ['$out', '$merge'].includes(k))) throw new Error(`Aggregation stage ${k} is disabled for this activity.`); inspect(x); } };
      noJavascript(pipeline); inspect(pipeline);
      const { db } = await mongoConnection(resource, c.secret);
      const cursor = db.collection(activityCollection(c)).aggregate(pipeline, { ...options(c), allowDiskUse: policy.allowDiskUse });
      const documents: any[] = []; let bytes = 0;
      try { for await (const doc of cursor) { const value = mongoPublic(doc); bytes += Buffer.byteLength(JSON.stringify(value)); if (documents.length >= 10000 || bytes > 8 * 1024 * 1024) throw new Error('Aggregation exceeds the 10000-document/8 MB durable-output ceiling. Add explicit pipeline paging.'); await validate(c, value, 'result document'); documents.push(value); } }
      finally { await cursor.close(); }
      return { out: { documents, count: documents.length } };
    },
  },
];
// Six document activities have live M0 engine evidence; deployment-specific options need separate certification.
export const mongoCandidates = candidates.map(activity => {
  const execute = activity.execute;
  return { ...activity, execute: async (c: ExecCtx) => {
    try {
      if (c.raw('validateSchema')) contractDefinition(c.resolve(c.raw('schema')), { projectId: c.projectId, subject: c.node.name, kind: 'json' });
      return await execute(c);
    }
    catch (error: any) { if (error?.name?.startsWith('Mongo') || error?.name === 'AbortError') throw mongoError(error); throw error; }
  } } satisfies Activity;
});
