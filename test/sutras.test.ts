import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { testEnv, captureServer, node, edge } from './helpers.js';

testEnv(18910);
const { boot } = await import('../server/src/index.js');
const { engine } = await import('../server/src/engine/engine.js');
const { q } = await import('../server/src/db.js');
const projects = await import('../server/src/projects.js');
const flows = await import('../server/src/flows.js');
const { saveResource } = await import('../server/src/resources.js');
const { setSecret } = await import('../server/src/secrets.js');
const { addSamples } = await import('../server/src/samples.js');
const { testResource } = await import('../server/src/resourceTest.js');
const { evalExpression, functionCatalog } = await import('../server/src/expr.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let srv: Awaited<ReturnType<typeof boot>>;
let pid = '';
before(async () => {
  srv = await boot({ listenAdmin: false });
  pid = projects.saveProject({ name: 'Sutras', config: { variables: [] } }).id;
  setSecret('AI_KEY', 'sk-test');
});
after(async () => { await srv.stop(); });

async function runDoc(doc: any, input?: any) {
  const id = engine.startRun({ doc, projectId: pid, input });
  await engine.waitFor(id, 20000);
  const r: any = q.get('select * from runs where id = ?', id);
  return { status: r.status, error: r.error, state: JSON.parse(r.state) };
}

test('sample Sutras: For-Each mapping, activity loops, sub-Sutra, try and catch', async () => {
  const added = addSamples(pid, ['foreach', 'loops', 'subsutra', 'trycatch', 'skills']);
  assert.equal(added.length, 7);
  const doc = (n: string) => flows.getFlow(added.find(a => a.name.startsWith(n))!.id)!.doc;

  let r = await runDoc(doc('Sample: For-Each'));
  assert.equal(r.status, 'done', r.error);
  const inv = r.state.outputs['Build invoice'];
  assert.equal(inv.invoiceNo, 'INV-A-1001');
  assert.equal(inv.customer, 'Asha Traders');
  assert.deepEqual(inv.lines.map((l: any) => [l.no, l.sku, l.amount]), [[1, 'CUP-12', 180], [2, 'POT-02', 900], [3, 'TEA-250', 480]]);
  assert.deepEqual(inv.byCountry.map((g: any) => [g.country, g.lines]), [['IN', 1], ['LK', 2]]);

  r = await runDoc(doc('Sample: Loop'));
  assert.equal(r.status, 'done', r.error);
  assert.equal(r.state.outputs['Price one order'].count, 3);
  assert.equal(r.state.outputs['Price one order'].iterations[2].gross, 4720);
  assert.equal(r.state.outputs['Poll counter']._iterations, 3);

  r = await runDoc(doc('Sample: Invoice'));
  assert.equal(r.status, 'done', r.error);
  assert.deepEqual(r.state.outputs['Calculate tax'], { amount: 2500, rate: 0.18, tax: 450, total: 2950 });
  assert.match(r.state.logs.map((l: any) => l.msg).join('\n'), /tax 450, total 2950/);

  r = await runDoc(doc('Sample: Try'));
  assert.equal(r.status, 'done', r.error);
  assert.match(r.state.outputs['Log stock problem'] ? 'ok' : '', /ok/);
  assert.equal(r.state.outputs['Error handler'].error.step, 'Reject');
  const logs = r.state.logs.map((l: any) => `${l.level} ${l.msg}`).join('\n');
  assert.match(logs, /warn Handled here: TEA-250 is out of stock/);
  assert.match(logs, /error Reject failed: Amount -5 is not valid/);

  // The CSV skill, run as a test with its test arguments, writes the file and replies with its details.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-skill-'));
  const skill = doc('Skill: Write CSV');
  skill.nodes.find((n: any) => n.type === 'fileWrite')!.config.folder = dir;
  r = await runDoc(skill);
  assert.equal(r.status, 'done', r.error);
  assert.equal(r.state.outputs['Reply with the file'].result.rows, 2);
  assert.match(fs.readFileSync(path.join(dir, 'skill-test.csv'), 'utf8'), /sku,qty\r?\nTEA-250,4/);

  assert.equal(addSamples(pid, ['foreach'])[0].name, 'Sample: For-Each mapping 2', 'adding again keeps names unique');
});

test('AI engines: OpenAI, Gemini, Ollama and a command-line tool return text plus provider, model and tokens', async () => {
  const cap = await captureServer((req, body) => {
    const b = JSON.parse(body || '{}');
    if (req.url!.includes('/chat/completions')) return { body: JSON.stringify({ model: b.model, choices: [{ message: { content: '{"label":"refund","confidence":0.9,"reason":"asks for money back"}' } }], usage: { prompt_tokens: 11, completion_tokens: 5 } }) };
    if (req.url!.includes(':generateContent')) return { body: JSON.stringify({ modelVersion: 'gemini-3-pro-preview', candidates: [{ content: { parts: [{ text: 'Bonjour' }] } }], usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 2, totalTokenCount: 9 } }) };
    if (req.url === '/api/chat') return { body: JSON.stringify({ model: b.model, message: { content: 'local answer' }, prompt_eval_count: 4, eval_count: 3 }) };
    return { status: 404, body: '{}' };
  });
  const fake = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-cli-')), 'fake-claude.mjs');
  fs.writeFileSync(fake, "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{process.stdout.write(JSON.stringify({type:'result',result:'CLI saw: '+s.trim().split('\\n').pop(),usage:{input_tokens:20,output_tokens:4},modelUsage:{'claude-sonnet-5-5':{}},total_cost_usd:0.001}))});");
  try {
    const mk = (name: string, config: any) => saveResource({ kind: 'aiProvider', name, project_id: pid, config }).id;
    const openai = mk('OpenAI', { engine: 'OpenAI API', apiKeySecret: 'AI_KEY', baseUrl: cap.url, model: 'gpt-5' });
    const gemini = mk('Gemini', { engine: 'Gemini API', apiKeySecret: 'AI_KEY', baseUrl: cap.url, model: 'gemini-3-pro-preview' });
    const ollama = mk('Local', { engine: 'Ollama', baseUrl: cap.url, model: 'llama3.3' });
    const cli = mk('Claude CLI', { engine: 'Claude CLI', command: process.execPath, args: `"${fake}"` });
    const s = node('start', 'Start');
    const cls = node('aiClassify', 'Classify', { provider: openai, text: 'I want my money back', labels: 'refund, question' });
    const tr = node('aiPrompt', 'Gemini', { provider: gemini, system: 'Translate to French', prompt: 'Hello' });
    const ol = node('aiPrompt', 'Ollama', { provider: ollama, system: '', prompt: 'Hi' });
    const cl = node('aiPrompt', 'CLI', { provider: cli, system: 'Be brief', prompt: 'Say hi' });
    const r = await runDoc({ name: 'AI', nodes: [s, cls, tr, ol, cl], edges: [edge(s, cls), edge(s, tr), edge(s, ol), edge(s, cl)] });
    assert.equal(r.status, 'done', r.error);
    const o = r.state.outputs;
    assert.equal(o.Classify.label, 'refund');
    assert.deepEqual({ ...o.Classify.ai, ms: 0 }, { provider: 'OpenAI', engine: 'OpenAI API', model: 'gpt-5', inputTokens: 11, outputTokens: 5, totalTokens: 16, ms: 0 });
    assert.equal(o.Gemini.text, 'Bonjour');
    assert.equal(o.Gemini.ai.totalTokens, 9);
    assert.equal(o.Ollama.text, 'local answer');
    assert.equal(o.Ollama.ai.engine, 'Ollama');
    assert.equal(o.CLI.text, 'CLI saw: Say hi');
    assert.equal(o.CLI.ai.model, 'claude-sonnet-5-5');
    assert.equal(o.CLI.ai.costUsd, 0.001);
    const gemCall = cap.seen.find(x => x.url.includes(':generateContent'))!;
    assert.equal(gemCall.headers['x-goog-api-key'], 'sk-test');
    assert.equal(cap.seen.find(x => x.url.includes('/chat/completions'))!.headers.authorization, 'Bearer sk-test');

    // Test connection on the AI provider uses the same call.
    const t = await testResource({ kind: 'aiProvider', name: 'Local', project_id: pid, config: { engine: 'Ollama', baseUrl: cap.url, model: 'llama3.3' } });
    assert.equal(t.ok, true, t.message);
    assert.match(t.message, /Ollama answered/);
    const missing = await testResource({ kind: 'aiProvider', name: 'No CLI', project_id: pid, config: { engine: 'Gemini CLI', command: 'surely-not-installed-cli-xyz' } });
    assert.equal(missing.ok, false);
  } finally { await cap.close(); }
});

test('Test connection: HTTP, database, mail failure, with project variables resolved', async () => {
  const cap = await captureServer(() => ({ status: 200, body: 'ok' }));
  try {
    projects.saveProject({ id: pid, name: 'Sutras', config: { variables: [{ name: 'API', type: 'string', value: cap.url }] } } as any);
    let t = await testResource({ kind: 'httpConnection', project_id: pid, config: { baseUrl: '{{gv.API}}' } });
    assert.equal(t.ok, true, t.message);
    assert.match(t.message, /HTTP 200/);
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-db-')), 't.db');
    t = await testResource({ kind: 'database', project_id: pid, config: { driver: 'sqlite', file } });
    assert.equal(t.ok, true, t.message);
    t = await testResource({ kind: 'smtp', project_id: pid, config: { host: '127.0.0.1', port: 1, security: 'none' } });
    assert.equal(t.ok, false);
    t = await testResource({ kind: 'oauthApp', project_id: pid, config: {} });
    assert.match(t.message, /Save the connection/);
  } finally { await cap.close(); }
});

test('Sengine variables are read-only for Sutras unless the administrator allows changes', () => {
  projects.saveEngineVariables([{ name: 'REGION', value: 'south' }]);
  const ctx = { process: { project: pid } };
  assert.equal(evalExpression("get-sengine-variable('REGION')", ctx), 'south');
  assert.equal(evalExpression("get-engine-variable('REGION')", ctx), 'south', 'the earlier name still works');
  assert.throws(() => evalExpression("set-sengine-variable('REGION', 'north')", ctx), /read-only for Sutras/);
  projects.setSutrasMayChangeSengine(true);
  assert.equal(evalExpression("set-sengine-variable('REGION', 'north')", ctx), 'north');
  projects.setSutrasMayChangeSengine(false);
  const names = functionCatalog().map(f => f.name);
  assert.ok(names.includes('get-sengine-variable') && !names.includes('get-engine-variable'));
});

test('no third-party product names in the code, docs or guide', () => {
  const hits: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.git', 'data', 'guide-images'].includes(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx|md|html|json|css|mjs)$/.test(e.name) && e.name !== 'package-lock.json') {
        const text = fs.readFileSync(p, 'utf8');
        if (new RegExp(['tib', 'co|flo', 'go'].join(''), 'i').test(text)) hits.push(path.relative(root, p));
      }
    }
  };
  walk(root);
  assert.deepEqual(hits, []);
});

test('connections: names, "when" conditions on the previous output, and "otherwise"', async () => {
  const s = node('start', 'Start'), chk = node('log', 'Check', { message: 'amount {{input.amount}}' });
  const big = node('log', 'Big order', { message: 'big' }), india = node('log', 'India', { message: 'IN' }), small = node('log', 'Small order', { message: 'small' });
  const edges = [
    edge(s, chk),
    { ...edge(chk, big), label: 'Order > 1000', when: 'when', condition: '={input.amount} > 1000' },
    { ...edge(chk, india), label: 'From India', when: 'when', condition: "=upper-case({input.country}) = 'IN'" },
    { ...edge(chk, small), label: 'Anything else', when: 'otherwise' },
  ];
  const doc = flows.normalizeDoc({ name: 'Edges', nodes: [s, chk, big, india, small], edges });
  assert.equal(doc.edges[1].label, 'Order > 1000');
  const ran = async (input: any) => Object.keys((await runDoc(doc, input)).state.outputs).filter(k => ['Big order', 'India', 'Small order'].includes(k)).sort();
  assert.deepEqual(await ran({ amount: 5000, country: 'in' }), ['Big order', 'India']);
  assert.deepEqual(await ran({ amount: 5000, country: 'US' }), ['Big order']);
  assert.deepEqual(await ran({ amount: 10, country: 'US' }), ['Small order']);

  const bad = flows.validateDoc({ name: 'x', nodes: [s, chk], edges: [edge(s, chk), { ...edge(chk, s), when: 'when' } as any] });
  assert.ok(bad.errors.some(e => /has no condition/.test(e)));
});

test('more samples across the palettes run as tests (REST, files, database, XML, transform, routing, channels, counter)', async () => {
  const added = addSamples(pid, ['rest', 'csv', 'folder', 'database', 'xml', 'transform', 'routing', 'conditions', 'channels', 'counter', 'localai', 'email', 'queue']);
  const doc = (n: string) => flows.getFlow(added.find(a => a.name === n)!.id)!.doc;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-samples-'));
  const logs = (r: any) => r.state.logs.map((l: any) => `${l.level} ${l.msg}`).join('\n');
  const ok = async (d: any) => { const r = await runDoc(d); assert.equal(r.status, 'done', `${d.name}: ${r.error}`); return r; };

  let r = await ok(doc('Sample: REST API with validation'));
  assert.equal(r.state.outputs['Reply 200'].body.orderId, 'A-1001');

  const csv = doc('Sample: CSV import and totals');
  for (const n of csv.nodes) if (n.config.folder) n.config.folder = dir;
  r = await ok(csv);
  assert.equal(r.state.outputs['Total per country'].result, 2640);
  assert.deepEqual(r.state.outputs['Total per country'].groups, { IN: { result: 1650, count: 2 }, LK: { result: 990, count: 1 } });

  const folder = doc('Sample: Folder of files');
  folder.nodes.find((n: any) => n.type === 'fileList')!.config.location = `${dir}/*.csv`;
  r = await ok(folder);
  assert.match(logs(r), /sales\.csv: \d+ bytes/);
  assert.match(logs(r), /1 files handled/);

  r = await ok(doc('Sample: Database (SQLite)'));
  assert.deepEqual(r.state.outputs['Big orders'].rows.map((x: any) => x.id), ['A-1']);
  assert.match(logs(r), /1 orders above 500; largest Asha Traders/);

  r = await ok(doc('Sample: XML in and out'));
  assert.match(r.state.outputs['Render invoice'].text, /<Number>INV-A-7<\/Number>/);
  assert.match(r.state.outputs['Render invoice'].text, /<Amount>240<\/Amount>/);

  r = await ok(doc('Sample: JSONata, JavaScript and HTML'));
  assert.deepEqual(r.state.outputs['Rank countries'].ranked.map((c: any) => [c.rank, c.country]), [[1, 'IN'], [2, 'LK']]);
  assert.match(r.state.outputs.Report.html, /<td>IN<\/td>/);

  r = await ok(doc('Sample: Router, Switch and Merge'));
  assert.ok(r.state.outputs['Large order'] && r.state.outputs['Indian order'] && !r.state.outputs['Other order']);
  assert.ok(r.state.outputs['Ship it'] && !r.state.outputs.Remind);

  r = await ok(doc('Sample: Connection conditions'));
  assert.ok(r.state.outputs['Big order'] && !r.state.outputs['From India'] && !r.state.outputs['Small order']);

  r = await ok(doc('Sample: Channel sender'));
  assert.equal(r.state.outputs['Send to channel'].delivered, 0);

  r = await ok(doc('Sample: Counter, Wait and Sutra variables'));
  assert.match(logs(r), /batch-\d{4}: order number 1 today/);

  // These need a connection or a local model: they are added and pass validation.
  for (const n of ['Sample: Local AI with Ollama', 'Sample: Email a report', 'Sample: Queue in and out']) {
    assert.deepEqual(flows.validateDoc(doc(n)).errors, [], n);
  }
});
