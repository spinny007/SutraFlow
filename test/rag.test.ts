import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { testEnv, node, edge, port } from './helpers.js';

/** RAG: vector databases (Qdrant, Chroma, Pinecone), document text, SharePoint / OneDrive feeding a knowledge base. */
testEnv(19930);
const { boot } = await import('../server/src/index.js');
const { engine } = await import('../server/src/engine/engine.js');
const { q, setSetting } = await import('../server/src/db.js');
const projects = await import('../server/src/projects.js');
const { saveResource, getResource } = await import('../server/src/resources.js');
const { setSecret, encrypt } = await import('../server/src/secrets.js');
const kn = await import('../server/src/ai/knowledge.js');
const { documentText, unzip } = await import('../server/src/ai/documents.js');

/** A zip of stored (uncompressed) files, enough for Office documents in tests. */
function zip(files: Record<string, string>) {
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  const crcTable = Array.from({ length: 256 }, (_x, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text), nm = Buffer.from(name), c = crc(data);
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt32LE(c, 14); l.writeUInt32LE(data.length, 18); l.writeUInt32LE(data.length, 22); l.writeUInt16LE(nm.length, 26);
    const ce = Buffer.alloc(46); ce.writeUInt32LE(0x02014b50, 0); ce.writeUInt16LE(20, 4); ce.writeUInt16LE(20, 6); ce.writeUInt32LE(c, 16); ce.writeUInt32LE(data.length, 20); ce.writeUInt32LE(data.length, 24); ce.writeUInt16LE(nm.length, 28); ce.writeUInt32LE(offset, 42);
    locals.push(l, nm, data); centrals.push(ce, nm);
    offset += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
/** A one-page PDF with a line of text. */
function pdf(text: string) {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>'];
  const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
  objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let out = '%PDF-1.4\n';
  const at: number[] = [];
  objs.forEach((o, i) => { at.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${at.map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}
const DOCX = zip({ 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Returns are accepted within 30 days.</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Refunds take 7 days &amp; go to the card.</w:t></w:r></w:p></w:body></w:document>', 'docProps/core.xml': '<cp:coreProperties><dc:title>Returns policy</dc:title></cp:coreProperties>' });

// ---------- a fake vector database server speaking the Qdrant, Chroma (v2) and Pinecone APIs ----------
const cos = (a: number[], b: number[]) => { let d = 0, x = 0, y = 0; a.forEach((v, i) => { d += v * b[i]; x += v * v; y += b[i] * b[i]; }); return x && y ? d / Math.sqrt(x * y) : 0; };
const points = new Map<string, { id: string; vector: number[]; payload: any }>();
const seenKeys: string[] = [];
const qMatch = (p: any, f: any): boolean => !f || (f.must || []).every((c: any) => (c.should ? c.should.some((s: any) => qMatch(p, { must: [s] })) : (() => { const v = c.key.split('.').reduce((o: any, k: string) => o?.[k], p); return Array.isArray(v) ? v.includes(c.match.value) : v === c.match.value; })()));
const cMatch = (m: any, w: any): boolean => { if (!w) return true; if (w.$and) return w.$and.every((x: any) => cMatch(m, x)); if (w.$or) return w.$or.some((x: any) => cMatch(m, x)); const [k, c] = Object.entries(w)[0] as [string, any]; return c.$eq !== undefined ? m[k] === c.$eq : Array.isArray(m[k]) ? c.$in.some((v: any) => m[k].includes(v)) : c.$in.includes(m[k]); };
let vdb: http.Server, vdbUrl = '';
function vdbHandler(req: http.IncomingMessage, res: http.ServerResponse, body: any) {
  const u = new URL(req.url!, 'http://x');
  const p = u.pathname;
  const send = (o: any, s = 200) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  seenKeys.push(String(req.headers['api-key'] || req.headers['x-chroma-token'] || ''));
  // Qdrant
  let m = /^\/collections\/([^/]+)(\/points(?:\/(search|delete|count|scroll))?)?$/.exec(p);
  if (m) {
    const col = m[1];
    if (!m[2]) { if (req.method === 'GET') return points.has(`q:${col}:created`) ? send({ result: {} }) : send({ status: { error: 'Not found' } }, 404); points.set(`q:${col}:created`, { id: '', vector: [], payload: body }); return send({ result: true }); }
    const all = [...points.entries()].filter(([k]) => k.startsWith(`q:${col}:p:`)).map(([, v]) => v);
    if (!m[3] && req.method === 'PUT') { for (const pt of body.points) points.set(`q:${col}:p:${pt.id}`, pt); return send({ result: { status: 'completed' } }); }
    if (m[3] === 'search') return send({ result: all.filter(x => qMatch(x.payload, body.filter)).map(x => ({ id: x.id, score: cos(body.vector, x.vector), payload: x.payload })).sort((a, b) => b.score - a.score).slice(0, body.limit) });
    if (m[3] === 'count') return send({ result: { count: all.filter(x => qMatch(x.payload, body.filter)).length } });
    if (m[3] === 'delete') { for (const x of all) if (qMatch(x.payload, body.filter)) points.delete(`q:${col}:p:${x.id}`); return send({ result: { status: 'completed' } }); }
    if (m[3] === 'scroll') return send({ result: { points: all.filter(x => qMatch(x.payload, body.filter)).map(x => ({ id: x.id, payload: x.payload })), next_page_offset: null } });
  }
  // Chroma v2
  m = /^\/api\/v2\/tenants\/default_tenant\/databases\/default_database\/collections(?:\/([^/]+)\/(add|query|delete|get))?$/.exec(p);
  if (m) {
    if (!m[1]) return send({ id: 'col-1', name: body.name });
    const all = [...points.entries()].filter(([k]) => k.startsWith('c:')).map(([, v]) => v);
    if (m[2] === 'add') { body.ids.forEach((id: string, i: number) => points.set(`c:${id}`, { id, vector: body.embeddings[i], payload: { doc: body.documents[i], meta: body.metadatas[i] } })); return send({}); }
    const hit = all.filter(x => cMatch(x.payload.meta, body.where));
    if (m[2] === 'query') { const r = hit.map(x => ({ x, d: 1 - cos(body.query_embeddings[0], x.vector) })).sort((a, b) => a.d - b.d).slice(0, body.n_results); return send({ ids: [r.map(y => y.x.id)], documents: [r.map(y => y.x.payload.doc)], metadatas: [r.map(y => y.x.payload.meta)], distances: [r.map(y => y.d)] }); }
    if (m[2] === 'get') return send({ ids: hit.map(x => x.id), documents: hit.map(x => x.payload.doc), metadatas: hit.map(x => x.payload.meta) });
    if (m[2] === 'delete') { for (const x of hit) points.delete(`c:${x.id}`); return send({}); }
  }
  // Pinecone
  if (p === '/vectors/upsert') { for (const v of body.vectors) points.set(`p:${v.id}`, { id: v.id, vector: v.values, payload: v.metadata }); return send({ upsertedCount: body.vectors.length }); }
  if (p === '/vectors/list') { const pre = u.searchParams.get('prefix') || ''; return send({ vectors: [...points.keys()].filter(k => k.startsWith(`p:${pre}`)).map(k => ({ id: k.slice(2) })), pagination: {} }); }
  if (p === '/vectors/delete') { for (const id of body.ids) points.delete(`p:${id}`); return send({}); }
  if (p === '/vectors/fetch') return send({ vectors: Object.fromEntries(u.searchParams.getAll('ids').map(id => [id, { id, values: points.get(`p:${id}`)!.vector, metadata: points.get(`p:${id}`)!.payload }])) });
  if (p === '/query') return send({ matches: [...points.entries()].filter(([k]) => k.startsWith('p:')).map(([, v]) => v).filter(x => cMatch(x.payload, body.filter)).map(x => ({ id: x.id, score: cos(body.vector, x.vector), metadata: x.payload })).sort((a, b) => b.score - a.score).slice(0, body.topK) });
  send({ error: `fake vector db: no ${req.method} ${p}` }, 404);
}

// ---------- a fake Microsoft Graph ----------
let graph: http.Server, graphUrl = '';
const graphCalls: string[] = [];
function graphHandler(req: http.IncomingMessage, res: http.ServerResponse) {
  const p = decodeURIComponent(new URL(req.url!, 'http://x').pathname);
  graphCalls.push(`${req.method} ${p} ${req.headers.authorization || ''}`);
  const send = (o: any, s = 200) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  const file = (name: string, folder: string, mod: string) => ({ id: `id-${name}`, name, size: 1234, file: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }, lastModifiedDateTime: mod, webUrl: `https://contoso.sharepoint.com/sites/Policies/${folder}/${name}`, parentReference: { driveId: 'd1', path: `/drives/d1/root:/${folder}` } });
  if (p === '/v1.0/sites/contoso.sharepoint.com:/sites/Policies') return send({ id: 'site-1', displayName: 'Policies' });
  if (p === '/v1.0/sites/site-1/drive/root:/Customer:/children') return send({ value: [file('Returns.docx', 'Customer', '2026-10-18T09:00:00Z'), { id: 'f-sub', name: 'Old', folder: { childCount: 0 } }] });
  if (p === '/v1.0/sites/site-1/drive/root:/Customer/Returns.docx') return send({ ...file('Returns.docx', 'Customer', '2026-10-18T09:00:00Z'), '@microsoft.graph.downloadUrl': `${graphUrl}/download/returns` });
  if (p === '/download/returns') { res.writeHead(200, { 'content-type': 'application/octet-stream' }); res.end(DOCX); return; }
  send({ error: { message: `fake graph: no ${p}` } }, 404);
}

let srv: Awaited<ReturnType<typeof boot>>;
let pid = '';
const listen = (h: (req: http.IncomingMessage, res: http.ServerResponse, body: any) => void) => new Promise<{ s: http.Server; url: string }>(r => {
  const s = http.createServer((req, res) => { let b = ''; req.on('data', d => (b += d)); req.on('end', () => { let body: any = null; try { body = b ? JSON.parse(b) : null; } catch { body = b; } h(req, res, body); }); });
  s.listen(0, '127.0.0.1', () => r({ s, url: `http://127.0.0.1:${(s.address() as any).port}` }));
});
before(async () => {
  ({ s: vdb, url: vdbUrl } = await listen(vdbHandler));
  ({ s: graph, url: graphUrl } = await listen((req, res) => graphHandler(req, res)));
  srv = await boot({ listenAdmin: false, gateway: false });
  pid = projects.saveProject({ name: 'RAG', config: { variables: [] } }).id;
  setSecret('VDB_KEY', 'vdb-secret');
});
after(async () => { await srv.stop(); vdb.close(); graph.close(); });

// PostgreSQL with pgvector: PGlite with the vector extension behind a PostgreSQL socket.
let pgServer: any, pgDb = '';
before(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { vector } = await import('@electric-sql/pglite/vector');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  const db = await PGlite.create({ extensions: { vector } });
  pgServer = new PGLiteSocketServer({ db, port: port(19935), host: '127.0.0.1' });
  await pgServer.start();
  pgDb = saveResource({ kind: 'database', name: 'Vectors PG', project_id: pid, config: { driver: 'postgres', host: '127.0.0.1', port: port(19935), database: 'postgres', user: 'postgres', poolMax: 1 } }).id;
});
after(async () => { const { closeDbPools } = await import('../server/src/connectors/db.js'); await closeDbPools(); await pgServer?.stop(); });

for (const store of ['PostgreSQL (pgvector)', 'Qdrant', 'Chroma', 'Pinecone']) {
  test(`knowledge in ${store}: add, replace, search with folder and detail filters, remove a folder, rebuild`, async () => {
    const kb = getResource(saveResource({ kind: 'aiKnowledge', name: `KB ${store}`, project_id: pid, config: { store, url: vdbUrl, collection: 'kb', apiKeySecret: 'VDB_KEY', database: pgDb, table: 'kb_test', embedWith: 'built-in', chunkTokens: 60 } }).id)!;
    const s = () => '' as any;
    const secret = (n: string) => (n === 'VDB_KEY' ? 'vdb-secret' : s());
    await kn.addKnowledge(kb, secret, 'Policies/HR/leave.md', 'Staff get 24 days of paid leave each year. Leave must be approved by the manager.', { team: 'hr' });
    await kn.addKnowledge(kb, secret, 'Policies/Customer/returns.md', 'Customers may return items within 30 days of delivery for a refund.', { team: 'support' });
    const again = await kn.addKnowledge(kb, secret, 'Policies/Customer/returns.md', 'Customers may return unused items within 30 days of delivery for a full refund.', { team: 'support' });
    assert.equal(again.replaced, 1);
    let hits = await kn.searchKnowledge(kb, secret, 'How many days of paid leave do staff get?');
    assert.equal(hits[0].source, 'Policies/HR/leave.md');
    hits = await kn.searchKnowledge(kb, secret, 'days', { source: 'Policies/Customer' });
    assert.deepEqual([...new Set(hits.map(h => h.source))], ['Policies/Customer/returns.md'], 'folder filter');
    hits = await kn.searchKnowledge(kb, secret, 'days', { meta: { team: 'hr' } });
    assert.deepEqual([...new Set(hits.map(h => h.source))], ['Policies/HR/leave.md'], 'detail filter');
    assert.match(hits[0].text, /24 days/);
    assert.deepEqual(await kn.knowledgeStats(kb, secret), { chunks: 2, sources: 2 });
    assert.equal((await kn.rebuildKnowledge(kb, secret)).chunks, 2);
    assert.equal(await kn.removeKnowledge(kb, 'Policies/HR', false, secret), 1, 'a folder of sources');
    assert.deepEqual(await kn.knowledgeStats(kb, secret), { chunks: 1, sources: 1 });
    if (store !== 'PostgreSQL (pgvector)') assert.ok(seenKeys.includes('vdb-secret'), 'the API key is sent');
  });
}

test('document text: Word, PowerPoint, Excel, PDF, HTML', async () => {
  let d = await documentText(DOCX, { name: 'Returns.docx' });
  assert.equal(d.type, 'docx');
  assert.equal(d.title, 'Returns policy');
  assert.equal(d.text, 'Returns are accepted within 30 days.\nRefunds take 7 days & go to the card.');
  d = await documentText(zip({ 'ppt/presentation.xml': '<p/>', 'ppt/slides/slide2.xml': '<p:sld><a:p><a:r><a:t>Second slide</a:t></a:r></a:p></p:sld>', 'ppt/slides/slide1.xml': '<p:sld><a:p><a:r><a:t>Welcome</a:t></a:r></a:p></p:sld>' }));
  assert.equal(d.type, 'pptx');
  assert.equal(d.text, 'Slide 1\nWelcome\n\nSlide 2\nSecond slide');
  d = await documentText(zip({ 'xl/workbook.xml': '<workbook><sheets><sheet name="Prices" sheetId="1"/></sheets></workbook>', 'xl/sharedStrings.xml': '<sst><si><t>Item</t></si><si><t>Tea</t></si></sst>', 'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Price</t></is></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>240</v></c></row></sheetData></worksheet>' }), { name: 'prices.xlsx' });
  assert.equal(d.text, 'Sheet Prices\nItem\tPrice\nTea\t240');
  d = await documentText(pdf('Hello from a PDF'));
  assert.equal(d.type, 'pdf');
  assert.match(d.text, /Hello from a PDF/);
  assert.equal(d.pages, 1);
  d = await documentText(Buffer.from('<html><head><title>Shipping</title><style>p{}</style></head><body><nav>Menu</nav><h1>Shipping</h1><p>We ship in 2&nbsp;days.</p><script>x()</script></body></html>'), { name: 'shipping.html' });
  assert.equal(d.title, 'Shipping');
  assert.equal(d.text, 'Menu\nShipping\nWe ship in 2 days.');
  assert.equal(unzip(DOCX).size, 2);
});

test('SharePoint: list a library folder, read a Word file as text, feed a knowledge base', async () => {
  const app = saveResource({ kind: 'oauthApp', name: 'Microsoft', project_id: pid, config: { provider: 'microsoft', clientId: 'cid', apiBase: graphUrl } });
  setSetting(`oauth:${app.id}`, { access: encrypt('graph-token'), expiresAt: Date.now() + 3600e3, connectedAt: new Date().toISOString() });
  const kb = saveResource({ kind: 'aiKnowledge', name: 'Policies', project_id: pid, config: { store: 'built-in', embedWith: 'built-in' } }).id;
  const place = { connection: app.id, location: 'SharePoint site', site: 'https://contoso.sharepoint.com/sites/Policies' };
  const s = node('start', 'Go', { payload: '{}' });
  const list = node('msFiles', 'List', { ...place, op: 'list', folder: 'Customer', pattern: '*.docx' });
  const each = node('forEach', 'Each', { list: '{{input.items}}' });
  const read = node('msFiles', 'Read', { ...place, op: 'read', path: '{{input.path}}', readAs: 'document text' });
  const add = node('knowledgeAdd', 'Add', { knowledge: kb, source: '{{input.path}}', text: '{{input.text}}', meta: [{ k: 'url', v: '{{input.webUrl}}' }] });
  const id = engine.startRun({ doc: { name: 'Feed', nodes: [s, list, each, read, add], edges: [edge(s, list), edge(list, each), edge(each, read, 'item'), edge(read, add)] }, projectId: pid });
  await engine.waitFor(id, 20000);
  const r: any = q.get('select status, error, state from runs where id = ?', id);
  assert.equal(r.status, 'done', r.error);
  const st = JSON.parse(r.state);
  assert.equal(st.outputs.List.count, 1, 'the sub-folder is not a file');
  assert.equal(st.outputs.Read.text, 'Returns are accepted within 30 days.\nRefunds take 7 days & go to the card.');
  assert.ok(graphCalls.some(c => c.includes('Bearer graph-token')));
  assert.ok(graphCalls.some(c => c.startsWith('GET /download/returns ') && !c.includes('Bearer')), 'the download address is fetched without the token');
  const hits = await kn.searchKnowledge(getResource(kb)!, () => '', 'refund to card');
  assert.equal(hits[0].source, 'Customer/Returns.docx');
  assert.equal(hits[0].meta.url, 'https://contoso.sharepoint.com/sites/Policies/Customer/Returns.docx');
});
