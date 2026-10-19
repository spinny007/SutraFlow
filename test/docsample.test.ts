import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { testEnv } from './helpers.js';

/**
 * The AI document assistant sample: a timed feed reads a folder of PDF, Word, PowerPoint and
 * Markdown files into a knowledge base (unchanged files skipped, deleted ones removed), and the
 * documents answer through a REST API, an MCP tool and an agent. Also: step descriptions and the
 * documentation made from them.
 */
const env = testEnv(20150);
process.env.SUTRA_ADMIN_TOKEN = 'docsample-admin-token-0123456789';
const { boot } = await import('../server/src/index.js');
const { engine } = await import('../server/src/engine/engine.js');
const { q } = await import('../server/src/db.js');
const { config } = await import('../server/src/config.js');
const projects = await import('../server/src/projects.js');
const flows = await import('../server/src/flows.js');
const { addSamples } = await import('../server/src/samples.js');
const { listResources, saveResource, getResource } = await import('../server/src/resources.js');
const { listSources } = await import('../server/src/ai/knowledge.js');
const { sampleDocuments } = await import('../server/src/sampledocs.js');
const { documentText } = await import('../server/src/ai/documents.js');

let srv: Awaited<ReturnType<typeof boot>>;
let pid = '';
let fake: http.Server;
const asked: string[] = [];
const H = { authorization: `Bearer ${process.env.SUTRA_ADMIN_TOKEN}` };

before(async () => {
  srv = await boot({ listenAdmin: false });
  pid = projects.saveProject({ name: 'Docs', config: { variables: [] } }).id;
  // A stand-in for Ollama: answers from the passages it was given.
  fake = http.createServer((req, res) => {
    let b = ''; req.on('data', d => (b += d)); req.on('end', () => {
      const body = JSON.parse(b || '{}');
      const all = JSON.stringify(body.messages || body.prompt || '');
      asked.push(all);
      const content = /30 days/.test(all) ? 'You can return an item within 30 days of delivery [returns-policy.pdf#1].' : 'NOT FOUND';
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ model: 'fake', message: { role: 'assistant', content }, prompt_eval_count: 10, eval_count: 10 }));
    });
  });
  await new Promise<void>(r => fake.listen(0, '127.0.0.1', () => r()));
});
after(async () => { fake.close(); await srv.stop(); });

const runFlow = async (name: string, input?: any) => {
  const f = flows.listFlows(pid).find(x => x.name === name)!;
  const id = engine.startRun({ doc: flows.getFlow(f.id)!.doc, flowId: f.id, projectId: pid, input, source: 'test' });
  await engine.waitFor(id, 60000);
  const r: any = q.get('select status, error, state from runs where id = ?', id);
  return { status: r.status, error: r.error, out: JSON.parse(r.state).outputs };
};

test('the sample documents are a real PDF, Word document, PowerPoint deck and Markdown file', async () => {
  const docs = sampleDocuments();
  assert.deepEqual(docs.map(d => d[0]), ['returns-policy.pdf', 'shipping-guide.docx', 'tea-catalogue.pptx', 'faq.md']);
  const text = Object.fromEntries(await Promise.all(docs.map(async ([n, b]) => [n, await documentText(b, { name: n, type: 'auto' })] as const)));
  assert.equal(text['returns-policy.pdf'].type, 'pdf');
  assert.equal(text['returns-policy.pdf'].pages, 2);
  assert.match(text['returns-policy.pdf'].text, /within 30 days of delivery/);
  assert.match(text['shipping-guide.docx'].text, /Shipping is free for orders of Rs\. 999/);
  assert.equal(text['tea-catalogue.pptx'].pages, 6);
  assert.match(text['tea-catalogue.pptx'].text, /Brew at 85 C for 3 minutes/);
});

test('adding the sample writes the documents, sets DOCS_FOLDER and makes five described Sutras', () => {
  const made = addSamples(pid, ['agentdocs']);
  assert.deepEqual(made.map(m => m.name).sort(), ['Sample: AI tool search documents', 'Sample: Add one document to knowledge', 'Sample: Document assistant', 'Sample: Document feed from a folder', 'Sample: Document questions API']);
  assert.ok(made.every(m => m.folder === 'Samples/AI agents'));
  assert.equal(projects.getProject(pid)!.config.variables.find((v: any) => v.name === 'DOCS_FOLDER')!.value, '${files}/documents');
  const dir = projects.effectiveVariables(pid).values.DOCS_FOLDER;
  assert.equal(path.resolve(dir), path.resolve(config.dataDir, 'files', 'Docs', 'documents'));
  assert.deepEqual(fs.readdirSync(dir).sort(), ['faq.md', 'returns-policy.pdf', 'shipping-guide.docx', 'tea-catalogue.pptx']);
  for (const m of made) {
    const doc = flows.getFlow(m.id)!.doc;
    assert.ok(doc.nodes.every(n => n.description), `${m.name}: every step is described`);
  }
  // The AI connection points at the stand-in model.
  const ai = listResources('aiProvider', pid).find(r => r.name === 'Local Ollama')!;
  saveResource({ id: ai.id, kind: 'aiProvider', name: ai.name, project_id: pid, config: { ...ai.config, baseUrl: `http://127.0.0.1:${(fake.address() as any).port}`, model: 'fake' } });
});

test('the feed adds every document, skips unchanged ones on the next run, and removes deleted files', async () => {
  const kb = getResource(listResources('aiKnowledge', pid).find(r => r.name === 'Sample document knowledge base')!.id)!;
  let r = await runFlow('Sample: Document feed from a folder');
  assert.equal(r.status, 'done', r.error);
  const sources = (await listSources(kb, () => '')).map(s => s.source);
  assert.deepEqual(sources, ['faq.md', 'returns-policy.pdf', 'shipping-guide.docx', 'tea-catalogue.pptx']);
  const firstAdded = Object.fromEntries((await listSources(kb, () => '')).map(s => [s.source, s.at]));

  await new Promise(res => setTimeout(res, 20));
  r = await runFlow('Sample: Document feed from a folder');
  assert.equal(r.status, 'done', r.error);
  assert.equal(r.out['Add the document'].skipped, true, 'unchanged files are skipped');
  assert.deepEqual(Object.fromEntries((await listSources(kb, () => '')).map(s => [s.source, s.at])), firstAdded, 'no passage was made again');

  const dir = projects.effectiveVariables(pid).values.DOCS_FOLDER;
  fs.rmSync(path.join(dir, 'faq.md'));
  fs.writeFileSync(path.join(dir, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.mkdirSync(path.join(dir, 'HR'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'HR', 'leave.md'), '# Leave\nStaff get 24 days of paid leave a year.');
  r = await runFlow('Sample: Document feed from a folder');
  assert.equal(r.status, 'done', r.error);
  assert.deepEqual((await listSources(kb, () => '')).map(s => s.source), ['HR/leave.md', 'returns-policy.pdf', 'shipping-guide.docx', 'tea-catalogue.pptx']);
  assert.equal(r.out['Remove deleted files'].removed, 1);
});

test('the MCP tool returns passages with sources; the API answers from the documents', async () => {
  let r = await runFlow('Sample: AI tool search documents', { tool: 'search_documents', arguments: { question: 'Which tea is best for milk tea?' } });
  assert.equal(r.status, 'done', r.error);
  const hits = r.out['Search documents'].hits;
  assert.ok(hits.length > 0);
  assert.ok(hits.some((h: any) => /Assam/.test(h.text)), JSON.stringify(hits.map((h: any) => [h.source, h.score, h.text.slice(0, 60)])));

  const api = flows.listFlows(pid).find(x => x.name === 'Sample: Document questions API')!;
  flows.deploy(api.id);
  const res = await fetch(`${env.http}/samples/docs/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'How many days do I have to return an item?' }) });
  const j = await res.json();
  assert.equal(res.status, 200, JSON.stringify(j));
  assert.match(j.answer, /30 days/);
  assert.ok(j.sources.includes('returns-policy.pdf'), JSON.stringify(j.sources));
  assert.ok(asked.some(a => /30 days/.test(a) && /returns-policy.pdf/.test(a)), 'the model was given the passage and its source');
  flows.undeploy(api.id);
});

test('documentation is made from the steps and their descriptions', async () => {
  const feed = flows.listFlows(pid).find(x => x.name === 'Sample: Document feed from a folder')!;
  const md = await srv.admin.inject({ method: 'GET', url: `/api/flows/${feed.id}/documentation?format=md`, headers: H });
  assert.equal(md.statusCode, 200);
  assert.match(md.body, /^# Sample: Document feed from a folder/);
  assert.match(md.body, /## How it starts\n\n- Timer: Every 15 minutes/);
  assert.match(md.body, /\| 1 \| Every 15 minutes \| Timer \| Starts the feed every 15 minutes/);
  assert.match(md.body, /Called Sutra|Call Sutra/);
  assert.match(md.body, /Sample: Add one document to knowledge/, 'the called Sutra by name, not id');
  assert.match(md.body, /Sample document knowledge base \(aiKnowledge\)/);
  assert.match(md.body, /Project variables used: DOCS_FOLDER/);
  assert.doesNotMatch(md.body, /Steps without a description/);
  const html = await srv.admin.inject({ method: 'GET', url: `/api/projects/${pid}/documentation`, headers: H });
  assert.equal(html.statusCode, 200);
  assert.match(String(html.headers['content-type']), /text\/html/);
  assert.match(html.body, /<h1>Docs<\/h1>/);
  assert.match(html.body, /DOCS_FOLDER/);
  assert.equal((html.body.match(/class="sutra"/g) || []).length, 5);
  // A step description is kept through save and shown; an empty one is dropped.
  const doc = flows.getFlow(feed.id)!.doc;
  const saved = flows.saveFlow(feed.id, { ...doc, nodes: doc.nodes.map((n, i) => (i === 0 ? { ...n, description: '  ' } : n)) }, pid);
  assert.equal(flows.getFlow(saved.id)!.doc.nodes[0].description, undefined);
  const again = await srv.admin.inject({ method: 'GET', url: `/api/flows/${feed.id}/documentation?format=md`, headers: H });
  assert.match(again.body, /Steps without a description: Every 15 minutes/);
});

test('the sample project zip imports as a new project with its documents, and its feed runs', async () => {
  const list = (await srv.admin.inject({ method: 'GET', url: '/api/sample-projects', headers: H })).json();
  assert.equal(list[0].file, 'ai-document-assistant.zip');
  const zip = (await srv.admin.inject({ method: 'GET', url: '/api/sample-projects/ai-document-assistant.zip', headers: H })).rawPayload;
  const opened = (await srv.admin.inject({ method: 'POST', url: '/api/packages/open', payload: { zip: zip.toString('base64') }, headers: H })).json();
  assert.deepEqual(opened.files.sort(), ['documents/faq.md', 'documents/returns-policy.pdf', 'documents/shipping-guide.docx', 'documents/tea-catalogue.pptx']);
  const r = await srv.admin.inject({ method: 'POST', url: '/api/projects/import', payload: { zip: zip.toString('base64'), project: 'Shop documents', asDrafts: true }, headers: H });
  assert.equal(r.statusCode, 200, r.body);
  const imported = r.json().project.id;
  const dir = projects.effectiveVariables(imported).values.DOCS_FOLDER;
  assert.equal(path.resolve(dir), path.resolve(projects.projectFilesDir('Shop documents'), 'documents'));
  assert.deepEqual(fs.readdirSync(dir).sort(), ['faq.md', 'returns-policy.pdf', 'shipping-guide.docx', 'tea-catalogue.pptx']);
  const feed = flows.listFlows(imported).find(x => x.name === 'Sample: Document feed from a folder')!;
  const id = engine.startRun({ doc: flows.getFlow(feed.id)!.doc, flowId: feed.id, projectId: imported, source: 'test' });
  await engine.waitFor(id, 60000);
  assert.equal((q.get<any>('select status from runs where id = ?', id)).status, 'done');
  const kb = getResource(listResources('aiKnowledge', imported)[0].id)!;
  assert.equal((await listSources(kb, () => '')).length, 4);
});

test('the project files folder is ${files}: a name of the project, never outside the data folder', () => {
  assert.equal(path.resolve(projects.projectFilesDir('Shop: A/B')), path.resolve(config.dataDir, 'files', 'Shop- A-B'));
  assert.ok(path.resolve(projects.projectFilesDir('../..')).startsWith(path.resolve(config.dataDir, 'files')));
});
