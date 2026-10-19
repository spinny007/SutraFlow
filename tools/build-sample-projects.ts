/**
 * Builds the sample project zips in samples/: whole projects as release zips (package, deployment
 * config, README, documentation, and their files), to import in New project or deploy with
 * `sutra deploy`. Run with `npm run samples`; a throw-away data folder is used.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-samples-'));
process.env.SUTRA_DATA_DIR = data;
process.env.SUTRA_MASTER_KEY = crypto.randomBytes(32).toString('base64');
delete process.env.SUTRA_DB;

const { openDb, closeDb } = await import('../server/src/db.js');
const { engine } = await import('../server/src/engine/engine.js');
const { allActivities } = await import('../server/src/palettes/index.js');
openDb();
engine.register(allActivities);
const { saveProject } = await import('../server/src/projects.js');
const { addSamples } = await import('../server/src/samples.js');
const { buildPackage } = await import('../server/src/packages.js');
const { buildBundle } = await import('../server/src/bundles.js');
const { sampleDocuments } = await import('../server/src/sampledocs.js');

/** The sample projects: name, file, what it shows, the samples it holds, and files it brings. */
const SAMPLE_PROJECTS = [
  {
    file: 'ai-document-assistant.zip',
    name: 'AI document assistant',
    description: 'RAG over a folder of documents: every 15 minutes the PDF, Word, PowerPoint and Markdown files of the documents folder are read into a knowledge base (changed files again, deleted ones removed), and the documents answer as a REST API, an MCP tool for AI assistants such as Claude, and a chat agent. Sample documents of a tea shop are included.',
    samples: ['agentdocs'],
    files: () => sampleDocuments().map(([n, b]) => [`files/documents/${n}`, b] as [string, Buffer]),
  },
];

const outDir = path.join(root, 'samples');
fs.mkdirSync(outDir, { recursive: true });
const index: { file: string; name: string; description: string; sutras: string[]; bytes: number }[] = [];
try {
  for (const s of SAMPLE_PROJECTS) {
    const p = saveProject({ name: s.name, description: s.description, config: { variables: [] } });
    addSamples(p.id, s.samples);
    const pkg = buildPackage(p.id, { version: '1.0.0', note: 'Sample project' });
    const zip = buildBundle(pkg, undefined, s.files());
    fs.writeFileSync(path.join(outDir, s.file), zip);
    index.push({ file: s.file, name: s.name, description: s.description, sutras: pkg.sutras.map(x => x.name), bytes: zip.length });
    console.log(`Wrote samples/${s.file}: ${pkg.sutras.length} Sutras, ${pkg.resources.length} connections, ${zip.length} bytes`);
  }
  fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index, null, 2) + '\n');
} finally {
  closeDb();
  try { fs.rmSync(data, { recursive: true, force: true }); } catch { /* files in use */ }
}
