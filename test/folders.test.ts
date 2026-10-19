/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { testEnv } from './helpers.js';
import { sftpServer } from './sftpserver.js';

/** Sutra folders, and the samples for SOAP, JSON microservices, SQL install scripts and SFTP / FTP. */
const env = testEnv(19850);
const { boot } = await import('../server/src/index.js');
const { engine } = await import('../server/src/engine/engine.js');
const { q } = await import('../server/src/db.js');
const flows = await import('../server/src/flows.js');
const projects = await import('../server/src/projects.js');
const { listResources, saveResource, getResource } = await import('../server/src/resources.js');
const { setSecret } = await import('../server/src/secrets.js');
const { addSamples, SAMPLES, SAMPLE_SUTRAS, fileSamples } = await import('../server/src/samples.js');
const { buildPackage, importPackage } = await import('../server/src/packages.js');
const folders = await import('../server/src/folders.js');
const schemas = await import('../server/src/schemas.js');
const require = createRequire(import.meta.url);

let srv: Awaited<ReturnType<typeof boot>>;
before(async () => { srv = await boot({ listenAdmin: false }); });
after(async () => { await srv.stop(); });

const start = { id: 's', type: 'start', name: 'Start', x: 0, y: 0, config: {} };

test('resources, schemas and service descriptors have folders of their own', () => {
  const pid = projects.saveProject({ name: 'Areas', config: { variables: [] } }).id;
  const r = saveResource({ kind: 'httpConnection', name: 'Orders API', project_id: pid, config: {} });
  const js = schemas.saveSchema({ project_id: pid, name: 'Order', kind: 'json', text: '{"id": "A-1"}' });
  folders.setItemFolder('resources', r.id, 'Partners/HTTP');
  folders.setItemFolder('schemas', js.id, 'Orders');
  folders.createFolder(pid, 'Inbound', 'wsdl');
  assert.deepEqual(folders.listFolders(pid, 'resources'), ['Partners', 'Partners/HTTP']);
  assert.deepEqual(folders.listFolders(pid, 'schemas'), ['Orders']);
  assert.deepEqual(folders.listFolders(pid, 'wsdl'), ['Inbound']);
  assert.deepEqual(folders.listFolders(pid, 'sutras'), [], 'each area is its own tree');
  assert.throws(() => folders.setItemFolder('wsdl', js.id, 'x'), /not found/, 'a JSON schema is not a service descriptor');
  assert.equal(listResources(undefined, pid)[0].folder, 'Partners/HTTP');
  saveResource({ ...listResources(undefined, pid)[0], name: 'Orders API v2' });
  assert.equal(listResources(undefined, pid)[0].folder, 'Partners/HTTP', 'saving a connection keeps its folder');
  folders.moveFolder(pid, 'Partners', 'Outside', 'resources');
  assert.equal(listResources(undefined, pid)[0].folder, 'Outside/HTTP');
  assert.throws(() => folders.areaOf('pictures'), /Unknown folder area/);
});

test('a Sutra imported alone brings only the connections and schemas it uses, in their folders', () => {
  const pid = projects.saveProject({ name: 'Source', config: { variables: [] } }).id;
  const policy = saveResource({ kind: 'inboundPolicy', name: 'Partner policy', project_id: pid, config: {} });
  const mcp = saveResource({ kind: 'mcpServer', name: 'Tools', project_id: pid, config: { policy: policy.id } });
  const unused = saveResource({ kind: 'httpConnection', name: 'Unused API', project_id: pid, config: {} });
  const sch = schemas.saveSchema({ project_id: pid, name: 'Order', kind: 'json', text: '{"id": "A-1"}' });
  schemas.saveSchema({ project_id: pid, name: 'Unused schema', kind: 'json', text: '{"x": 1}' });
  folders.setItemFolder('resources', mcp.id, 'AI/Servers');
  folders.setItemFolder('resources', policy.id, 'Security');
  folders.setItemFolder('schemas', sch.id, 'Orders');
  const doc = (name: string, config: any) => ({ name, nodes: [start, { id: 'm', type: 'log', name: 'Log', x: 0, y: 0, config }], edges: [] });
  flows.saveFlow(undefined, doc('Uses MCP', { message: 'x', server: mcp.id, schema: sch.id }), pid);
  flows.saveFlow(undefined, doc('Other', { message: 'y', conn: unused.id }), pid);

  const pkg = buildPackage(pid, { version: '1.0.0', sutras: ['Uses MCP'] });
  assert.deepEqual(pkg.resources.map(r => r.name).sort(), ['Partner policy', 'Tools'], 'the MCP server and, through it, its policy; not the unused connection');
  assert.deepEqual(pkg.schemas.map(s => s.name), ['Order']);
  importPackage(buildPackage(pid, { version: '1.0.1' }), { project: 'Picked', sutras: ['Uses MCP'] });
  const picked = projects.listProjects().find(p => p.name === 'Picked')!.id;
  assert.deepEqual(Object.fromEntries(listResources(undefined, picked).map(r => [r.name, r.folder])), { 'Partner policy': 'Security', Tools: 'AI/Servers' }, 'from a whole package, only what the chosen Sutra uses, with folders');
  assert.deepEqual(schemas.listSchemas(picked).map(s => [s.name, s.folder]), [['Order', 'Orders']]);
});

test('samples added before folders existed are filed; other Sutras stay put', async () => {
  const pid = projects.saveProject({ name: 'Old samples', config: { variables: [] } }).id;
  const mk = (name: string) => flows.saveFlow(undefined, { name, nodes: [start], edges: [] }, pid).id;
  mk('Sample: SQL update'); mk('Sample: Router, Switch and Merge 2'); mk('Skill: Write CSV file'); mk('Sample: Something I wrote'); mk('Orders');
  saveResource({ kind: 'smtp', name: 'Sample SMTP', project_id: pid, config: {} });
  saveResource({ kind: 'smtp', name: 'Office mail', project_id: pid, config: {} });
  assert.equal(fileSamples(pid), 4);
  assert.deepEqual(Object.fromEntries(flows.listFlows(pid).map(f => [f.name, f.folder])), {
    'Orders': '', 'Sample: Router, Switch and Merge 2': 'Samples/Flow control', 'Sample: Something I wrote': '', 'Sample: SQL update': 'Samples/SQL', 'Skill: Write CSV file': 'Samples/Apps',
  });
  assert.deepEqual(Object.fromEntries(listResources(undefined, pid).map(r => [r.name, r.folder])), { 'Office mail': '', 'Sample SMTP': 'Samples' });
  assert.equal(fileSamples(pid), 0, 'filed samples are left alone');
  // At start the server files every project once, so a sample moved back to the top later stays there.
  const { getSetting } = await import('../server/src/db.js');
  assert.equal(getSetting('folders.samplesFiled', false), true);
});

test('the list used to file old samples matches what addSamples makes', () => {
  const pid = projects.saveProject({ name: 'Sample list', config: { variables: [] } }).id;
  const listed = new Map(Object.entries(SAMPLE_SUTRAS).flatMap(([f, names]) => names.map(n => [n, f] as const)));
  for (const a of addSamples(pid)) assert.equal(listed.get(a.name.replace(/^Sample: /, '')), a.folder, a.name);
  assert.equal(listed.size, addSamples(projects.saveProject({ name: 'Sample list 2', config: { variables: [] } }).id).length, 'no stale names');
});

test('missing project variables are warnings on the step that reads them', () => {
  const pid = projects.saveProject({ name: 'Vars', config: { variables: [{ name: 'INBOX', type: 'string', value: 'C:/in' }] } }).id;
  const conn = saveResource({ kind: 'httpConnection', name: 'Partner API', project_id: pid, config: { baseUrl: '{{gv.PARTNER_URL}}' } });
  const doc = { name: 'V', nodes: [start,
    { id: 'a', type: 'log', name: 'Uses vars', x: 0, y: 0, config: { message: '{{gv.INBOX}} {gv.OUTBOX} $gv.ARCHIVE get-project-variable(\'LIMIT\')' } },
    { id: 'b', type: 'httpRequest', name: 'Call partner', x: 0, y: 0, config: { connection: conn.id, url: '/x' } }], edges: [] };
  const w = flows.validateDoc(doc as any, pid).warnings.filter(x => /project variable/.test(x));
  assert.deepEqual(w.map(x => x.replace(/ is not defined.*$/, '')), [
    'Uses vars: project variable OUTBOX', 'Uses vars: project variable ARCHIVE', 'Uses vars: project variable LIMIT', 'Call partner: project variable PARTNER_URL',
  ]);
  assert.match(w[3], /used by the connection Partner API/);
  assert.equal(flows.validateDoc(doc as any).warnings.filter(x => /project variable/.test(x)).length, 0, 'without a project there is nothing to check against');
});

const run = async (doc: any, projectId: string, input?: any) => {
  const id = engine.startRun({ doc, projectId, input });
  await engine.waitFor(id, 30000);
  const r: any = q.get('select status, error, state from runs where id = ?', id);
  const st = JSON.parse(r.state);
  return { status: r.status, error: r.error, out: st.outputs, logs: (st.logs || []).map((l: any) => `${l.level} ${l.msg}`).join('\n') };
};

test('folders: make, move Sutras, rename, remove (nothing deleted), and travel in packages', () => {
  const pid = projects.saveProject({ name: 'Folders', config: { variables: [] } }).id;
  const doc = (name: string) => ({ name, nodes: [{ id: 's', type: 'start', name: 'Start', x: 0, y: 0, config: {} }], edges: [] });
  const a = flows.saveFlow(undefined, doc('Alpha'), pid);
  const b = flows.saveFlow(undefined, doc('Beta'), pid);
  assert.equal(flows.listFlows(pid).find(f => f.id === a.id)!.folder, '', 'new Sutras are at the top');

  assert.equal(flows.normFolder(' /Orders//Inbound/ '), 'Orders/Inbound');
  assert.throws(() => flows.normFolder('a/b/c/d/e/f/g/h/i'), /8 levels/);
  assert.deepEqual(flows.createFolder(pid, 'Empty/Later'), ['Empty', 'Empty/Later'], 'an empty folder is kept, with its parent');
  flows.setFlowFolder(a.id, 'Orders/Inbound');
  flows.setFlowFolder(b.id, 'Orders');
  assert.deepEqual(flows.listFolders(pid), ['Empty', 'Empty/Later', 'Orders', 'Orders/Inbound']);

  assert.throws(() => flows.moveFolder(pid, 'Orders', 'Orders/Inbound/x'), /inside itself/);
  flows.moveFolder(pid, 'Orders', 'Sales/Orders');
  const where = () => Object.fromEntries(flows.listFlows(pid).map(f => [f.name, f.folder]));
  assert.deepEqual(where(), { Alpha: 'Sales/Orders/Inbound', Beta: 'Sales/Orders' }, 'a folder moves with everything in it');

  flows.removeFolder(pid, 'Sales/Orders');
  assert.deepEqual(where(), { Alpha: 'Sales/Inbound', Beta: 'Sales' }, 'removing a folder lifts its contents one level');
  assert.equal(flows.listFlows(pid).length, 2, 'nothing deleted');
  flows.removeFolder(pid, 'Empty');
  assert.ok(!flows.listFolders(pid).some(f => f.startsWith('Empty')));

  const pkg = buildPackage(pid, { version: '1.0.0' });
  assert.equal(pkg.sutras.find(s => s.name === 'Alpha')!.folder, 'Sales/Inbound');
  importPackage(pkg, { project: 'Folders copy' });
  const copy = projects.listProjects().find(p => p.name === 'Folders copy')!;
  assert.deepEqual(Object.fromEntries(flows.listFlows(copy.id).map(f => [f.name, f.folder])), { Alpha: 'Sales/Inbound', Beta: 'Sales' }, 'imported Sutras keep their folders');
});

test('samples go to Samples/<topic> folders and get the connections they need', () => {
  const pid = projects.saveProject({ name: 'All samples', config: { variables: [] } }).id;
  const added = addSamples(pid);
  assert.ok(SAMPLES.every(s => s.folder?.startsWith('Samples')), 'every sample has a folder');
  const list = flows.listFlows(pid);
  assert.equal(list.filter(f => !f.folder.startsWith('Samples/')).length, 0, 'no sample at the top');
  const folder = (n: string) => list.find(f => f.name === n)?.folder;
  assert.equal(folder('Sample: SQL install script'), 'Samples/SQL');
  assert.equal(folder('Sample: Microservice Orders'), 'Samples/REST and microservices');
  assert.equal(folder('Sample: Mock SOAP weather service'), 'Samples/SOAP');
  assert.equal(folder('Sample: SFTP upload list read archive'), 'Samples/SFTP and FTP');
  assert.ok(added.every(a => a.folder.startsWith('Samples/')));

  // Every visible connection field of every sample step is filled with a connection of this project.
  const meta = engine.activity.bind(engine);
  const empty: string[] = [];
  for (const f of list) {
    for (const n of flows.getFlow(f.id)!.doc.nodes) {
      for (const fld of meta(n.type)?.fields || []) {
        if (fld.type !== 'resource' || !['smtp', 'imap', 'database', 'kafka', 'rabbitmq', 'amqp1', 'firebase', 'sftp', 'ftp', 'aiProvider', 'oauthApp'].includes(fld.resourceKind!)) continue;
        const shown = !fld.showIf || fld.showIf.in.includes(fld.showIf.k in n.config ? n.config[fld.showIf.k] : meta(n.type)!.fields.find(x => x.k === fld.showIf!.k)?.def);
        if (!shown) continue;
        const r = n.config[fld.k] ? getResource(n.config[fld.k]) : undefined;
        if (!r || r.project_id !== pid || r.kind !== fld.resourceKind) empty.push(`${f.name} / ${n.name} / ${fld.k}`);
      }
    }
  }
  assert.deepEqual(empty, []);
  const names = listResources(undefined, pid).map(r => r.name).sort();
  for (const n of ['Sample SMTP', 'Sample IMAP', 'Sample MySQL', 'Sample ActiveMQ', 'Sample Firebase', 'Sample Google', 'Sample Dropbox', 'Sample Facebook', 'Sample SFTP', 'Sample FTP', 'Local Ollama', 'Sample SQLite']) assert.ok(names.includes(n), n);
  assert.equal(names.length, new Set(names).size, 'each connection made once');

  addSamples(pid, ['sftp', 'email']);
  assert.equal(listResources('sftp', pid).length, 1, 'adding samples again reuses the connections');
  for (const f of flows.listFlows(pid)) assert.deepEqual(flows.validateDoc(flows.getFlow(f.id)!.doc).errors, [], f.name);
});

test('mock SOAP service and JSON microservices answer on the gateway', async () => {
  const pid = projects.saveProject({ name: 'Services', config: { variables: [] } }).id;
  addSamples(pid, ['soapmock', 'microservices']);
  const byName = (n: string) => flows.listFlows(pid).find(f => f.name === n)!;
  for (const n of ['Sample: Mock SOAP weather service', 'Sample: Microservice Customers', 'Sample: Microservice Stock', 'Sample: Microservice Orders']) flows.deploy(byName(n).id);

  const wsdl = await (await fetch(`${env.http}/samples/soap/weather?wsdl`)).text();
  assert.ok(wsdl.includes('GetWeather') && wsdl.includes('ListCities'), 'WSDL lists both operations');
  const caller = flows.getFlow(byName('Sample: Call the mock SOAP service').id)!.doc;
  assert.ok(caller.nodes.find(n => n.type === 'soapInvoke')!.config.endpoint.startsWith(env.http), 'the caller points at this gateway');
  let r = await run(caller, pid);
  assert.equal(r.status, 'done', r.error);
  assert.match(r.logs, /Pune: 31 C, Sunny/);
  r = await run(caller, pid, { city: 'Delhi' });
  assert.match(r.logs, /No weather for Delhi/, 'unknown city is a SOAP fault');

  const order = (body: any) => fetch(`${env.http}/samples/ms/orders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  let res = await order({ customerId: 'C-1', sku: 'TEA-01', qty: 3 });
  const o = await res.json();
  assert.equal(res.status, 201, JSON.stringify(o));
  assert.equal(o.customer.name, 'Asha Traders');
  assert.equal(o.total, 648, 'gold customers get 10% off 3 x 240');
  res = await order({ customerId: 'C-2', sku: 'CUP-02', qty: 10 });
  assert.equal(res.status, 409, 'too little stock');
  res = await order({ customerId: 'C-9', sku: 'TEA-01', qty: 1 });
  assert.equal(res.status, 404, 'unknown customer from the Customers service');
});

test('SFTP sample runs every remote step against a server', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-sftp-'));
  const sftp = await sftpServer(root, { user: 'sample', password: 'Sample-pass-1' });
  try {
    const pid = projects.saveProject({ name: 'Remote samples', config: { variables: [] } }).id;
    addSamples(pid, ['sftp']);
    const c = listResources('sftp', pid)[0];
    setSecret('SAMPLE_SFTP_PW', 'Sample-pass-1');
    saveResource({ ...c, config: { ...c.config, host: '127.0.0.1', port: sftp.port, passwordSecret: 'SAMPLE_SFTP_PW' } });
    const f = flows.listFlows(pid).find(x => x.name === 'Sample: SFTP upload list read archive')!;
    const r = await run(flows.getFlow(f.id)!.doc, pid);
    assert.equal(r.status, 'done', r.error);
    assert.match(r.logs, /1 CSV files listed, 4 order lines read on 127.0.0.1/);
    const archived = fs.readdirSync(path.join(root, 'archive'));
    assert.equal(archived.length, 1, 'the copy is deleted, the dated file stays');
    assert.match(archived[0], /^orders-\d{8}-\d{6}\.csv$/);
  } finally { await sftp.close(); }
});

const MYSQL = process.env.SUTRA_TEST_MYSQL_URL;
test('SQL install script and the procedure as a microservice (MySQL)', { skip: !MYSQL && 'set SUTRA_TEST_MYSQL_URL to test against a real MySQL server' }, async () => {
  const u = new URL(MYSQL!);
  const mysql = require('mysql2/promise');
  const admin = await mysql.createConnection({ host: u.hostname, port: Number(u.port) || 3306, user: decodeURIComponent(u.username), password: decodeURIComponent(u.password) || undefined });
  const [had] = await admin.query("show databases like 'sutraflow_samples'");
  try {
    const pid = projects.saveProject({ name: 'SQL samples', config: { variables: [] } }).id;
    addSamples(pid, ['sqlinstall']);
    const c = listResources('database', pid).find(r => r.name === 'Sample MySQL')!;
    if (u.password) setSecret('SAMPLE_MYSQL_PW', decodeURIComponent(u.password));
    saveResource({ ...c, config: { ...c.config, host: u.hostname, port: Number(u.port) || 3306, user: decodeURIComponent(u.username), passwordSecret: u.password ? 'SAMPLE_MYSQL_PW' : '' } });
    const byName = (n: string) => flows.listFlows(pid).find(f => f.name === n)!;
    const install = flows.getFlow(byName('Sample: SQL install script').id)!.doc;
    let r = await run(install, pid);
    assert.equal(r.status, 'done', r.error);
    assert.match(r.logs, /7 statements ran/);
    r = await run(install, pid);
    assert.equal(r.status, 'done', `the script can run again: ${r.error}`);

    flows.deploy(byName('Sample: Procedure as a microservice').id);
    const res = await fetch(`${env.http}/samples/sql/customers/C-1/orders?min=500`);
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.count, 2);
    assert.deepEqual(body.orders.map((o: any) => o.id), ['A-4', 'A-1'], 'largest first, the 300 order left out');
  } finally {
    if (!(had as any[]).length) await admin.query('drop database if exists sutraflow_samples');
    await admin.end();
  }
});
