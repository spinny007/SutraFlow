/**
 * Builds docs/sutraflow-architecture.html: how SutraFlow works, what every file does, deployments and
 * features, with diagrams and a search box. Served by the studio at /architecture.
 * The prose lives here; file sizes, tables, API routes, settings, palettes and test names are read
 * from the code, and the build fails when a source file has no description.
 *
 *   npm run architecture
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allActivities, PALETTES } from '../server/src/palettes/index.js';
import { RESOURCE_KINDS } from '../server/src/resources.js';
import { SAMPLES } from '../server/src/samples.js';
import { version } from '../server/src/config.js';
import { LOGO_URI } from './guide/logo.js';
import { DIAGRAMS, ARROW_DEFS } from './architecture/diagrams.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'docs', 'sutraflow-architecture.html');
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const lines = (rel: string) => read(rel).split('\n').length;
const slug = (s: string) => s.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
const problems: string[] = [];

// ---------------------------------------------------------------------------------------------
// File map: every source file and what it does.
// ---------------------------------------------------------------------------------------------
type Group = { id: string; title: string; intro: string; files: [string, string][] };

const FILES: Group[] = [
  {
    id: 'core', title: 'Server start, storage and cluster', intro: 'The process: how it starts and stops, where it keeps its data, and how several engines share one database.',
    files: [
      ['server/src/main.ts', 'Entry point of <code>npm start</code>. Boots the server, prints the studio and gateway addresses, and turns SIGTERM and Ctrl+C into a graceful stop (drain first).'],
      ['server/src/index.ts', '<code>boot()</code>: opens storage, registers every activity, loads deployment configs, deploys the packages in <code>SUTRA_DEPLOY_DIR</code> under a cluster-wide lock, starts the engine, the cluster beat, the gateway and the admin API, and wires change hooks (deploys rebuild routes, timers and listeners). Also the ordered <code>stop()</code>.'],
      ['server/src/config.ts', 'Process settings from environment variables (mode, ports, folders, database, engine id, drain, heartbeat, retention, logs, tracing, tokens) and the product version from package.json. Everything else is stored in the database and edited in the studio.'],
      ['server/src/lifecycle.ts', 'Liveness (<code>/health</code>) and readiness (<code>/ready</code>): storage answers, packages are deployed, the gateway listens, and the server is not draining.'],
      ['server/src/cluster.ts', 'Heartbeat row per engine, the leader lease, recovery of a dead engine\'s steps, the deploy generation number that makes every engine reload its routes, leadership hand-over on stop, and the engine status list.'],
      ['server/src/housekeeping.ts', 'Deletes finished runs older than <code>SUTRA_RUN_RETENTION_DAYS</code>, with their steps, in batches. Run by the leader about once a minute; waiting runs are never deleted.'],
      ['server/src/db.ts', 'The storage layer. <code>q</code> (get, all, run) and <code>tx</code> (transaction) on SQLite or PostgreSQL. Holds the table definitions, converts them for PostgreSQL (bigint, double precision, bigserial), converts <code>?</code> placeholders to <code>$n</code>, and takes an advisory lock for every PostgreSQL write transaction.'],
      ['server/src/pgworker.ts', 'Worker thread that owns the PostgreSQL connection (<code>pg</code>, or PGlite for <code>pglite:</code> addresses). The main thread posts a statement and waits on a shared flag for the answer, which keeps the storage API synchronous.'],
    ],
  },
  {
    id: 'engine', title: 'Engine', intro: 'The durable step runner and the types every activity follows.',
    files: [
      ['server/src/engine/engine.ts', 'The durable engine: start a run, claim tasks with an owner, run activities with settings (retries, time limit, loop), checkpoint output and next tasks in one transaction, route connections (ports, conditions, skip tokens, merges), waits (approvals, timers, sub-Sutras, replies from other engines), Error handler, stop options, debug pause, cancel, resubmit, drain, metrics and spans.'],
      ['server/src/engine/types.ts', 'Types shared by the engine, palettes and studio: Sutra document (nodes, edges with label and condition), activity definition (fields, ports, output hint, execute), step settings, execution context and step result (port, output, wait, reply, call, result, stop).'],
    ],
  },
  {
    id: 'data', title: 'Data, mapping and expressions', intro: 'How values move between steps: templates, formulas, structured mapping and design-time shapes.',
    files: [
      ['server/src/template.ts', '<code>{{ }}</code> templates: input, nodes, trigger, vars, gv, secret, run, item, index; pipes such as upper, default, number, length. Parsed, never evaluated as code.'],
      ['server/src/expr.ts', 'Formulas starting with <code>=</code>: functions (string, number, date, list, encoding), operators and predicates, plus hooks to read and write Project and Sengine variables. Also the function catalog shown in the mapper.'],
      ['server/src/values.ts', 'Path and value helpers shared by templates and formulas.'],
      ['server/src/mapping.ts', 'Structured Activity Input mapping: a target tree from a schema or ad-hoc paths, with For-Each, where, group by, sort, conditions and Choose.'],
      ['server/src/design.ts', 'Design-time data shapes: what each step receives and returns before anything has run. Feeds the Process Data tree and the Output tab.'],
      ['server/src/schemas.ts', 'Shared schemas of a project: JSON Schema, sample JSON, XSD and WSDL, all converted to one tree format for the mapper.'],
      ['server/src/settings.ts', 'Resolves Project and Sengine variables in plain settings (folders, URLs, queue names) and in connection settings.'],
    ],
  },
  {
    id: 'projects', title: 'Projects, Sutras, connections and releases', intro: 'What a team edits and ships.',
    files: [
      ['server/src/projects.ts', 'Projects: Project variables, logging, deployment (ops) configs with <code>${env:...}</code> values, runtime variable values, Sengine variables and the server policies (Sengine variables writable, scripts allowed, release activities allowed).'],
      ['server/src/flows.ts', 'Sutras: draft, published versions, deploy and undeploy, validation (names, ports, connection conditions, Error handler, API paths, MCP skill names), and the change hooks.'],
      ['server/src/resources.ts', 'Connection types (HTTP, SOAP, security profiles, API policies, AI provider, MCP server and the connector kinds) with their fields and icons. Secret values are never stored here, only vault names.'],
      ['server/src/resourceTest.ts', '"Test connection": tries the settings as they are on screen, with variables resolved, and reports the result in one sentence.'],
      ['server/src/secrets.ts', 'The vault. AES-256-GCM with a key from <code>SUTRA_MASTER_KEY</code> or <code>data/master.key</code>. Values are never returned by the API and are masked in run history.'],
      ['server/src/samples.ts', 'The sample catalog offered in "New Sutra" (' + SAMPLES.length + ' samples covering every activity) and <code>addSamples()</code>.'],
      ['server/src/channels.ts', 'Send to channel: starts every deployed Sutra of the project whose Channel trigger listens on that name. Reads deployments from the database, so it works across engines.'],
      ['server/src/packages.ts', 'Project packages: build (Sutras at their versions, connections, schemas, variables, a sha256 checksum), read, check, deploy (matched by name, prune or keep others, deployment config), history, rollback and test.'],
      ['server/src/cli.ts', 'The <code>sutra</code> command: package, check, deploy, test, history, rollback, secret, status. Works on a remote server with a token or on the local data folder.'],
    ],
  },
  {
    id: 'services', title: 'Admin API, gateway and triggers', intro: 'The two network faces of the server and the long-running starters.',
    files: [
      ['server/src/api.ts', 'Admin API on port 4800 (Fastify): sign-in, projects, Sutras, runs, approvals, resources, secrets, packages, engine control, server settings, <code>/health</code>, <code>/ready</code>, <code>/metrics</code>, <code>/guide</code>, <code>/architecture</code> and the studio files. Bearer tokens for automation; a headless engine allows only a short list of routes.'],
      ['server/src/access.ts', 'Users and system accounts (provision, disable, lockout, password rules, sign out everywhere), roles made of permissions, grants for all projects or one project, permission checks, API tokens of system accounts (stored as hashes), and Basic sign-in of system accounts at the gateway.'],
      ['server/src/guard.ts', 'The permission of every admin API route and the project it applies to. The server refuses to start when a route has no rule. Also writes each change and each refusal to the audit log, without passwords or secret values.'],
      ['server/src/console.ts', 'Data for the Admin Console: the overview (engines, deployed Sutras, runs of the last day, failures, approvals, gateway), deployed applications with their triggers and run counts, starting and stopping a deployed Sutra, and drain requests for any engine. Always limited to the projects the caller may see.'],
      ['server/src/audit.ts', 'The audit log: record, search, CSV export, and deletion after <code>SUTRA_AUDIT_RETENTION_DAYS</code>.'],
      ['server/src/auth.ts', 'Studio sign-in: the first visit creates the administrator, sessions are signed cookies, and changing requests need the X-Sutra header (a cross-site form cannot send it).'],
      ['server/src/gateway/gateway.ts', 'The gateway: HTTP and HTTPS listeners for deployed REST and SOAP services and MCP endpoints, WSDL publishing, policy checks, run start with the caller\'s traceparent, and waiting for the reply step (also when another engine runs it).'],
      ['server/src/gateway/tls.ts', 'Gateway certificates: off, self-signed, uploaded, or Let\'s Encrypt (ACME HTTP-01) with renewal 30 days before expiry, and client CA for mutual TLS.'],
      ['server/src/mcp.ts', 'Model Context Protocol over Streamable HTTP: tools/list from deployed MCP skill triggers, tools/call starts the Sutra and returns what Reply to AI sends. JSON Schema from shared schemas or simple input rows.'],
      ['server/src/scheduler.ts', 'Timer triggers (cron or interval) of deployed Sutras, on the leader.'],
      ['server/src/listeners.ts', 'Long-running triggers on the leader: folder watchers, mailbox polling, queue and topic subscriptions, Drive polling. Rebuilt one after another when deployments or connections change.'],
    ],
  },
  {
    id: 'security', title: 'Security', intro: 'Inbound checks, outbound authentication and protection of slow services.',
    files: [
      ['server/src/security/inbound.ts', 'API policies on gateway services: none, API key, Basic, JWT, mutual TLS, WS-Security UsernameToken; refusals become HTTP errors or SOAP faults.'],
      ['server/src/security/outbound.ts', 'Outbound security profiles for HTTP and SOAP calls: Basic, bearer, API key, OAuth client credentials, client certificates and TLS options.'],
      ['server/src/security/wss.ts', 'WS-Security headers for SOAP calls: UsernameToken, timestamps, X.509 signatures and SAML assertions; verification of signed requests.'],
      ['server/src/security/breaker.ts', 'Circuit breaker per HTTP connection: after a number of failures in a row, calls fail at once for a while, then one trial call decides.'],
    ],
  },
  {
    id: 'observe', title: 'Observability', intro: 'What operations teams watch.',
    files: [
      ['server/src/metrics.ts', 'Prometheus counters, histograms and gauges per engine, served at <code>/metrics</code> (optionally behind <code>SUTRA_METRICS_TOKEN</code>).'],
      ['server/src/tracing.ts', 'OpenTelemetry traces over OTLP/HTTP JSON: one trace per run with a span per step; ids come from run and step ids, so steps on different engines join one trace.'],
      ['server/src/logger.ts', 'Per-project log files with level, format and rotation, and JSON lines on standard output when <code>SUTRA_LOG_FORMAT=json</code>.'],
    ],
  },
  {
    id: 'palettes', title: 'Palettes (activities)', intro: 'Each file defines activities: fields shown in the studio, ports, an output hint for mapping, and an <code>execute</code> function.',
    files: [
      ['server/src/palettes/index.ts', 'Palette order and the list of all activities registered with the engine.'],
      ['server/src/palettes/common.ts', 'Field builders (<code>F</code>, <code>when</code>) and write options shared by file-like activities.'],
      ['server/src/palettes/core.ts', 'Triggers (Start, Timer, REST service, SOAP service), flow control (If, Switch, Router, For each, Merge, Wait, Approval, Set variable, Throw, End with stop options), data (Mapper, JSON, XML, CSV, filter, sort, aggregate, validate) and Log.'],
      ['server/src/palettes/process.ts', 'Call Sutra and Return, Error handler, No operation, channels (send and trigger) and Counter.'],
      ['server/src/palettes/transform.ts', 'JSONata transform.'],
      ['server/src/palettes/http.ts', 'HTTP request (with connection, security profile and circuit breaker) and HTTP response.'],
      ['server/src/palettes/soap.ts', 'SOAP call from a WSDL (operation picker) and SOAP reply.'],
      ['server/src/palettes/file.ts', 'File trigger, read, list, write and move, confined to the configured folder. Write and Move always return file details.'],
      ['server/src/palettes/fileformat.ts', 'Encodings and formats for file content: text, base64, CSV, lines, JSON, XML, with schema-typed columns.'],
      ['server/src/palettes/code.ts', 'JavaScript code in a sandboxed worker (no host objects, time and memory limits) and HTML templates.'],
      ['server/src/palettes/scripts.ts', 'PowerShell, shell scripts and programs, with output and errors captured; values arrive as environment variables and a JSON input file, never inside the script text. Off until allowed.'],
      ['server/src/palettes/release.ts', 'Build package, Check package, Deploy package and Roll back, on this server or a remote engine. Off until allowed.'],
      ['server/src/palettes/ai.ts', 'AI prompt, classify, router, extract, summarize, translate, sentiment and the Ollama activity (all endpoints). JSON answers are read leniently with one stricter retry.'],
      ['server/src/palettes/mcp.ts', 'MCP skill trigger (describes the tool) and Reply to AI.'],
    ],
  },
  {
    id: 'connectors', title: 'Connectors', intro: 'Activities for outside systems and their connection kinds.',
    files: [
      ['server/src/connectors/kinds.ts', 'Connection kinds for email, databases, service bus, Firebase and OAuth apps.'],
      ['server/src/connectors/db.ts', 'DB Ops for PostgreSQL, MySQL, SQL Server, Oracle and SQLite: query, update, stored procedure and transaction, with <code>:name</code> parameters always bound (no SQL injection), and connection pools.'],
      ['server/src/connectors/bus.ts', 'Service Bus for Kafka, RabbitMQ and AMQP 1.0 brokers: publish, subscribe and confirm, with message headers, acknowledge modes and reply queues.'],
      ['server/src/connectors/email.ts', 'Send email (SMTP) and the mailbox trigger (IMAP).'],
      ['server/src/connectors/firebase.ts', 'Firestore, Realtime Database and Cloud Messaging with a service account.'],
      ['server/src/connectors/oauth.ts', 'OAuth 2.0 authorization-code connections with encrypted tokens and refresh.'],
      ['server/src/connectors/saas.ts', 'Google Sheets, Drive (and a Drive trigger), Dropbox, YouTube, Facebook Pages and any REST API of a connected account.'],
    ],
  },
  {
    id: 'ai', title: 'AI engines', intro: 'One AI provider connection, many engines.',
    files: [
      ['server/src/ai/engines.ts', 'The list of AI engines. Has no imports so any module can load it first.'],
      ['server/src/ai/providers.ts', 'Calls to the Claude, Gemini and OpenAI APIs, OpenAI-compatible servers (LM Studio, Hugging Face, local TGI), Ollama, and the Claude, Gemini and Codex command-line tools. Model lists, Ollama pull and import (gguf, Modelfile, safetensors, Ollama folder). Every call returns provider, engine, model, tokens and time.'],
    ],
  },
  {
    id: 'web', title: 'Studio (web/src)', intro: 'The browser application: React with React Flow, built by Vite into dist/web and served by the admin API.',
    files: [
      ['web/index.html', 'Page shell for the studio.'],
      ['web/vite.config.ts', 'Vite build of two pages (designer and Admin Console) and the development proxy to the admin API.'],
      ['web/src/main.tsx', 'Mounts the React application.'],
      ['web/src/App.tsx', 'Top bar, sign-in, and the switch between Designer, Runs, Resources and Server.'],
      ['web/src/Auth.tsx', 'Sign-in, first administrator and password change, shared by the designer and the Admin Console.'],
      ['web/src/api.ts', 'Thin client for the admin API; changing calls carry the X-Sutra header.'],
      ['web/src/types.ts', 'Studio-side types of Sutras, activities, fields and runs.'],
      ['web/src/ui.tsx', 'Toasts and the catalog (current project, its connections and schemas, secret names).'],
      ['web/src/Designer.tsx', 'The canvas: palette, drag and drop, connections with labels, undo and redo, Delete-key handling, test and debug runs, sample picker.'],
      ['web/src/Inspector.tsx', 'Right panel for a step or a connection: General, Input, Output and Settings tabs, loop settings, connection name and condition.'],
      ['web/src/Fields.tsx', 'Field editors (text, select, secret, resource, schema, Sutra picker) that accept drops from the data tree.'],
      ['web/src/Mapper.tsx', 'Input mapping: Process Data on the left, Activity Input on the right with lines between them, the formula editor with function browser, preview, For-Each, If and Choose.'],
      ['web/src/DataTree.tsx', 'The data tree on the mapper\'s source side, from the last run or from output shapes.'],
      ['web/src/Project.tsx', 'Project panel: Sutras, Resources with the + menu and Test connection, schemas, variables, AI models, releases (packages and history).'],
      ['web/src/Resources.tsx', 'Shared resources and the secret vault.'],
      ['web/src/Runs.tsx', 'Run history with steps, input and output, approvals, cancel and resubmit, and the engine that ran each run.'],
      ['web/src/Server.tsx', 'Server & APIs: gateway ports, TLS, Sengine variables and their policy, scripts and release policies, MCP endpoints.'],
      ['web/src/templates.ts', 'Starter Sutras offered by "New Sutra".'],
      ['web/src/styles.css', 'Studio styles.'],
      ['web/src/env.d.ts', 'Vite type declarations.'],
    ],
  },
  {
    id: 'console', title: 'Admin Console (web/admin)', intro: 'The second page of the web build, served at <code>/admin</code> on every server, headless engines included. It manages what is deployed; design stays in the designer.',
    files: [
      ['web/admin.html', 'Page shell of the Admin Console.'],
      ['web/admin/main.tsx', 'Mounts the console and applies the saved theme.'],
      ['web/admin/Console.tsx', 'Sign-in (or, on a headless engine without users, how to add the first administrator), password change, navigation by permission, and the pages.'],
      ['web/admin/shared.tsx', 'What the signed-in account may do, loading and refresh helpers, state labels, in-page confirmation, password generator.'],
      ['web/admin/Overview.tsx', 'Tiles for engines, deployed Sutras, runs of the last day, approvals, work queue and gateway; recent failures with Resubmit.'],
      ['web/admin/Apps.tsx', 'Deployed projects and Sutras: start and stop, runs with step results, resubmit and cancel, deploy an earlier version, package history and roll back. Also the side panel used by other pages.'],
      ['web/admin/Approvals.tsx', 'Waiting approvals with comment, Approve and Reject.'],
      ['web/admin/Engines.tsx', 'Engines of the cluster: alive, leader, load, heartbeat; drain and stop one; delete old runs now.'],
      ['web/admin/People.tsx', 'Users and system accounts: add, roles per project, disable, unlock, passwords, sign out everywhere, delete; API tokens shown once.'],
      ['web/admin/Roles.tsx', 'Permission matrix of all roles; custom roles.'],
      ['web/admin/Audit.tsx', 'Audit log with filters, plain-word actions, details and CSV export.'],
      ['web/admin/console.css', 'Console layout on the studio colour tokens, light and dark, one column on phones.'],
    ],
  },
  {
    id: 'tools', title: 'Documentation tools', intro: 'Pages built from the code, so they stay accurate.',
    files: [
      ['tools/build-user-guide.ts', 'Builds docs/sutraflow-user-guide.html (<code>npm run guide</code>): chapters, every activity with its settings table, connection types, functions, pipes and samples, read from the server code.'],
      ['tools/guide/chapters.ts', 'User guide chapters.'],
      ['tools/guide/activities.ts', 'Advice text for every activity in the user guide.'],
      ['tools/guide/logo.ts', 'The SutraFlow mark used by both pages.'],
      ['tools/capture-guide-shots.mjs', 'Takes the user guide screenshots with headless Edge while the server runs (<code>npm run guide:shots</code>).'],
      ['tools/build-architecture.ts', 'Builds this page (<code>npm run architecture</code>) and fails when a source file has no description.'],
      ['tools/architecture/diagrams.ts', 'The diagrams on this page, as inline SVG.'],
    ],
  },
  {
    id: 'ship', title: 'Build, containers and documents', intro: 'Files outside the source folders.',
    files: [
      ['package.json', 'Dependencies and scripts: dev, build, start, test, guide, architecture, sutra. The <code>sutra</code> command is its bin.'],
      ['server/tsconfig.json', 'TypeScript build of the server into dist/server.'],
      ['web/tsconfig.json', 'TypeScript settings of the studio.'],
      ['Dockerfile', 'Multi-stage image on node:24-bookworm-slim: builds studio and server, runs as the node user under tini, health check on /ready, headless by default with /data and /deploy volumes and JSON logs.'],
      ['.dockerignore', 'Keeps data, node_modules and builds out of the image context.'],
      ['docker-compose.yml', 'One container: studio, engine and gateway.'],
      ['docker-compose.cluster.yml', 'PostgreSQL, a studio without workers and two headless engines sharing the database.'],
      ['deploy/README.md', 'The deploy folder: drop .sutra packages here for engines that deploy them at start.'],
      ['docs/deployment.md', 'Operations guide: packages, CLI, headless engines, Docker, clusters, monitoring, retention, settings.'],
      ['docs/architecture.md', 'Short text notes on the architecture (this page is the full version).'],
      ['docs/sutraflow-user-guide.html', 'The generated user guide, served at /guide.'],
      ['README.md', 'Project introduction and quick start.'],
    ],
  },
  {
    id: 'tests', title: 'Tests (test/)', intro: 'Node\'s test runner with tsx. <code>npm test</code> compiles the server first, then runs every suite; the PostgreSQL suite runs the in-process suites again on PGlite with shifted ports.',
    files: [
      ['test/helpers.ts', 'Test environment per suite: temporary data folder, ports (with <code>SUTRA_TEST_PORT_OFFSET</code>), node and edge builders, a capture server.'],
      ['test/proc.ts', 'Starts real server processes for multi-process tests and waits for their endpoints.'],
    ],
  },
];

// Every test file gets a row, described by its test names.
const testFiles = fs.readdirSync(path.join(root, 'test')).filter(f => f.endsWith('.test.ts')).sort();
const testNames = (f: string) => [...read(`test/${f}`).matchAll(/\btest\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g)].map(m => m[2].replace(/\\'/g, "'"));
FILES.find(g => g.id === 'tests')!.files.push(...testFiles.map(f => [`test/${f}`, `${testNames(f).length} tests.`] as [string, string]));

// Every source file must be described.
const described = new Set(FILES.flatMap(g => g.files.map(f => f[0])));
const walk = (d: string): string[] => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]);
for (const f of [...walk('server/src'), ...walk('web/src'), ...walk('tools'), ...walk('test')]) if (!described.has(f)) problems.push(`no description for ${f}`);
for (const f of described) if (!fs.existsSync(path.join(root, f))) problems.push(`described file is missing: ${f}`);

// ---------------------------------------------------------------------------------------------
// Generated tables.
// ---------------------------------------------------------------------------------------------
function tablesFromSchema() {
  const src = read('server/src/db.ts');
  const schema = /const SCHEMA = `([\s\S]*?)`;/.exec(src)?.[1] || '';
  const out: { name: string; cols: string[] }[] = [];
  for (const m of schema.matchAll(/create table if not exists (\w+)\(([\s\S]*?)\);/g)) {
    const cols = m[2].replace(/\s+/g, ' ').split(/,(?![^(]*\))/).map(c => c.trim()).filter(c => c && !/^primary key/.test(c)).map(c => c.split(' ')[0]);
    out.push({ name: m[1], cols });
  }
  return out;
}
const TABLE_TEXT: Record<string, string> = {
  flows: 'Sutra drafts: the document being edited and its latest version number.',
  flow_versions: 'Published, unchangeable versions of each Sutra.',
  deployments: 'Which version of each Sutra is deployed, and whether it is enabled.',
  runs: 'One row per run: the Sutra document it started with, status, trigger input, state (outputs, variables, branch tokens, logs) and times.',
  tasks: 'One row per step execution: status, attempt, not-before time, owner engine, input, output, port, wait details, error and duration. The work queue.',
  resources: 'Connections, security profiles, API policies, AI providers and MCP servers (secret names only).',
  secrets: 'The vault: encrypted values with their IV and tag.',
  settings: 'Server settings and policies, gateway and TLS settings, Sengine variables, the deploy generation.',
  projects: 'Projects with their variables, logging and deployment config.',
  schemas: 'Shared schemas and WSDLs of each project.',
  counters: 'Counter activity values per project.',
  package_deployments: 'Package history per project: version, checksum, who deployed it, the report and the package itself (for rollback).',
  engines: 'Engines of the cluster: host, process, mode, version, heartbeat, workers, active steps, draining.',
  leases: 'Cluster-wide locks with an expiry: the leader lease and the deploy-folder lock.',
  users: 'People and system accounts: password hash, name, email, disabled, must change password, failed sign-ins, lock, sessions valid after, last sign-in.',
  roles: 'Built-in and custom roles with their permissions.',
  grants: 'Which role each account holds, for all projects (empty project) or one project.',
  api_tokens: 'API tokens of system accounts: hash, name, expiry and last use. Token values are never stored.',
  audit: 'Audit log: time, actor, address, action, target, project, status, outcome and safe details.',
};

function apiRoutes() {
  const routes = [...read('server/src/api.ts').matchAll(/app\.(get|post|put|delete|patch)\('([^']+)'/g)].map(m => ({ method: m[1].toUpperCase(), path: m[2] }));
  const area = (p: string) => p.startsWith('/api/') ? p.split('/')[2] : 'service';
  const groups = new Map<string, typeof routes>();
  for (const r of routes) groups.set(area(r.path), [...(groups.get(area(r.path)) || []), r]);
  return { count: routes.length, html: [...groups].map(([g, rs]) => `<tr><td><strong>${esc(g)}</strong></td><td>${rs.map(r => `<code>${r.method} ${esc(r.path)}</code>`).join(' ')}</td></tr>`).join('') };
}

const SETTINGS: [string, string, string][] = [
  ['SUTRA_MODE', 'studio', '<code>studio</code>: studio, engine and gateway in one process. <code>engine</code>: headless, no studio and only the automation API with the admin token.'],
  ['SUTRA_DATA_DIR', './data', 'SQLite database, vault key file, log files and deployment configs.'],
  ['SUTRA_DB', '(SQLite)', '<code>postgres://user:pass@host/db</code> for clusters on several machines; <code>pglite:memory</code> in tests.'],
  ['SUTRA_MASTER_KEY', 'key file', 'Vault key, base64 of 32 bytes. Must be the same on every engine of a cluster.'],
  ['SUTRA_ADMIN_TOKEN', '(none)', 'Bearer token for the CLI, CI and release activities on remote engines. Acts as an administrator.'],
  ['SUTRA_DEPLOY_DIR', '(none)', 'Folder of .sutra packages deployed at start (containers, headless engines).'],
  ['SUTRA_CONFIG_DIR', 'data/config', 'Deployment config files loaded at start.'],
  ['SUTRA_ENGINE_ID', 'host-pid', 'This engine\'s name in the cluster and on metrics.'],
  ['SUTRA_WORKERS', '16', 'Steps run at the same time. 0 = serve only (a studio in a cluster).'],
  ['SUTRA_MAX_STEPS', '10000', 'Safety limit of steps per run.'],
  ['SUTRA_REPLY_TIMEOUT_MS', '60000', 'How long REST and SOAP callers wait for a reply step.'],
  ['SUTRA_HEARTBEAT_MS', '5000', 'Heartbeat interval; an engine silent for three beats is dead.'],
  ['SUTRA_DRAIN_MS', '30000', 'Time running steps get to finish on a graceful stop.'],
  ['SUTRA_RUN_RETENTION_DAYS', '30', 'Finished runs older than this are deleted; 0 keeps them.'],
  ['SUTRA_AUDIT_RETENTION_DAYS', '365', 'Audit entries older than this are deleted; 0 keeps them.'],
  ['SUTRA_LOG_FORMAT', 'text', '<code>json</code>: engine events as JSON lines on standard output.'],
  ['SUTRA_METRICS_TOKEN', '(none)', 'When set, <code>/metrics</code> needs this Bearer token.'],
  ['OTEL_EXPORTER_OTLP_ENDPOINT', '(none)', 'OpenTelemetry collector address (OTLP/HTTP).'],
  ['OTEL_SERVICE_NAME', 'sutraflow', 'Service name on traces.'],
  ['SUTRA_ADMIN_HOST, SUTRA_ADMIN_PORT', '127.0.0.1, 4800', 'Studio and admin API address. Containers use 0.0.0.0.'],
  ['SUTRA_GATEWAY_HTTP_PORT, SUTRA_GATEWAY_HTTPS_PORT', '8080, 8443', 'Gateway ports until changed in Server & APIs.'],
  ['SUTRA_WEB_DIR', '(built in)', 'Folder of the built studio, when not next to the server.'],
  ['SUTRA_SERVER', '(none)', 'CLI only: the server address, instead of <code>--server</code>.'],
];

// ---------------------------------------------------------------------------------------------
// Sections.
// ---------------------------------------------------------------------------------------------
const pals = PALETTES.map(p => ({ ...p, acts: allActivities.filter(a => a.palette === p.id) })).filter(p => p.acts.length);
const tables = tablesFromSchema();
const api = apiRoutes();
for (const t of tables) if (!TABLE_TEXT[t.name]) problems.push(`no description for table ${t.name}`);

const S: { id: string; title: string; html: string }[] = [];
const sec = (id: string, title: string, html: string) => S.push({ id, title, html });
const tw = (head: string[], rows: string) => `<div class="tw"><table class="t"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;

sec('overview', 'What SutraFlow is', `
<p>SutraFlow is an integration designer and engine. People draw <strong>Sutras</strong> (integration processes) in a browser studio, and the engine runs them: REST and SOAP services, file and database jobs, queues, email, cloud apps, scripts, AI steps and skills for AI assistants. One Node.js program holds the studio, the engine and the gateway; the same program runs headless in production, alone or as a cluster on PostgreSQL.</p>
<h3 id="terms">Words used on this page</h3>
${tw(['Term', 'Meaning'], [
  ['Sutra', 'One process: steps (activities) joined by connections, stored as a JSON document with nodes and edges.'],
  ['Activity, palette', 'A step type (HTTP request, Write file, AI prompt) and the group it belongs to in the studio.'],
  ['Trigger', 'The first activity: what starts a run (REST request, timer, file, mailbox, queue, channel, MCP skill, Start for manual runs).'],
  ['Run, task', 'One execution of a Sutra, and one execution of one step within it. Both are database rows.'],
  ['Project', 'A group of Sutras with shared connections, schemas, Project variables and logging. The unit of release.'],
  ['Connection (resource)', 'Reusable settings for an outside system: HTTP, SOAP, database, bus, email, AI provider, MCP server and more.'],
  ['Project variables', '<code>{{gv.NAME}}</code>: values per project, overridable per environment by the deployment config.'],
  ['Sutra variables', '<code>{{vars.name}}</code>: values within one run.'],
  ['Sengine variables', 'Server-level settings readable by every Sutra. Sutras should read them and not change them; changing them is blocked unless an administrator allows it.'],
  ['Package', 'A .sutra file: a release of a whole project, with a checksum, deployed unchanged to test and production.'],
  ['Studio, engine, gateway', 'The browser application; the step runner; the listener for deployed services.'],
].map(([a, b]) => `<tr><td><strong>${a}</strong></td><td>${b}</td></tr>`).join(''))}
<p>Version ${esc(version)}: ${allActivities.length} activities in ${pals.length} palettes, ${RESOURCE_KINDS.length} connection types, ${SAMPLES.length} samples, ${api.count} admin API routes, ${tables.length} tables.</p>`);

sec('runtime', 'The running server', `
${DIAGRAMS.runtime}
<p>Everything runs in one Node.js 24 process written in TypeScript. Its parts:</p>
<ul>
<li><strong>Admin API</strong> (Fastify, port 4800, 127.0.0.1 by default) serves the studio, the user guide, this page, and every editing and operations route. People sign in with a session cookie; automation uses <code>Authorization: Bearer &lt;SUTRA_ADMIN_TOKEN&gt;</code>.</li>
<li><strong>Gateway</strong> (ports 8080 and 8443) serves only what is deployed: REST paths, SOAP services with their WSDL, and MCP endpoints. It is separate from the admin port so the studio never has to face the internet.</li>
<li><strong>Engine</strong> runs steps in worker slots (<code>SUTRA_WORKERS</code>, 16 by default). Slots take tasks from the database, never from memory.</li>
<li><strong>Timers and listeners</strong> start runs from schedules, folders, mailboxes, queues and Drive. In a cluster they run on the leader only, so nothing starts twice.</li>
<li><strong>Cluster beat</strong> writes this engine's heartbeat, holds or watches the leader lease, recovers dead engines' steps, and reloads routes after deploys elsewhere.</li>
<li><strong>Storage</strong> is SQLite in the data folder, or PostgreSQL for several machines. Sutras, runs, tasks, the vault, settings and cluster state all live there.</li>
</ul>
<h3 id="ports">Ports and addresses</h3>
${tw(['Address', 'What answers'], [
  ['<code>:4800/</code>', 'Studio (studio mode only)'],
  ['<code>:4800/api/...</code>', 'Admin API'],
  ['<code>:4800/health</code>, <code>/ready</code>', 'Liveness and readiness'],
  ['<code>:4800/metrics</code>', 'Prometheus metrics'],
  ['<code>:4800/admin</code>', 'Admin Console (also on headless engines)'],
  ['<code>:4800/guide</code>, <code>/architecture</code>', 'User guide and this page'],
  ['<code>:8080</code>, <code>:8443</code>', 'Gateway: deployed REST and SOAP services, <code>/mcp</code> and MCP server paths, ACME challenges'],
].map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join(''))}`);

sec('lifecycle', 'How a run works', `
${DIAGRAMS.lifecycle}
<ol>
<li><strong>Start.</strong> A trigger (or a test run, the Run API, a channel, Call Sutra, an MCP call) calls <code>startRun</code>. It inserts the run row, which keeps a copy of the Sutra document it started with, and one pending task for the trigger step. Redeploying never changes a run in flight.</li>
<li><strong>Claim.</strong> A free worker slot claims the next due task with one atomic statement: <code>update tasks set status='running', owner=? where id = (select ... where status='pending' and not_before &lt;= now limit 1) and status='pending' returning *</code>. Two engines can never claim the same task.</li>
<li><strong>Run the activity.</strong> The engine resolves the step's settings (templates, formulas, Project and Sengine variables, secrets) and its Input mapping, then calls the activity's <code>execute</code> with a context (logging, secrets, abort signal, time limit). Loop settings run it once per item of a list, or again while a condition holds, and collect the results.</li>
<li><strong>Checkpoint.</strong> In one transaction the engine stores the step's output, marks the task done, and inserts tasks for the next steps. A crash before the commit leaves the task as it was; after the commit the next steps exist. Nothing is kept in memory between steps.</li>
<li><strong>Route.</strong> The step's result names a port (out, error, ok, problems, approved, rejected...). Each connection from that port carries a live token or a skip token according to its condition. A merge waits for a token on every incoming connection.</li>
<li><strong>Finish.</strong> When no tasks remain the run is done; a failure with no error path fails the run; End and stop options (this branch, Sutra success, Sutra error) finish early. The run's status, duration and steps go to metrics, traces and logs.</li>
</ol>
<h3 id="task-states">Task states</h3>
${DIAGRAMS.states}
<h3 id="conditions">Connections, conditions and merges</h3>
${DIAGRAMS.branches}
<p>A connection can have a name (shown on the canvas) and a rule: <strong>always</strong> (the default), <strong>when</strong> a formula on the previous step's output is true (<code>{input.amount} &gt; 1000</code>), or <strong>otherwise</strong> (when no <em>when</em> connection from the same output was taken). Branches that are not taken send skip tokens downstream, so merges never wait forever (dead-path elimination).</p>
<h3 id="waits">Waiting without holding anything</h3>
<p>A step can return a wait instead of an output. The task becomes <code>waiting</code> with its wait details and costs nothing while it waits:</p>
<ul>
<li><strong>Approval</strong>: a person decides in the studio (Runs, Approvals) or through the API; the task resumes on approved or rejected.</li>
<li><strong>Wait / timers</strong>: the task returns to pending with a not-before time.</li>
<li><strong>Call Sutra</strong>: a child run starts; the parent task waits until the child finishes and receives what its Return step sent.</li>
<li><strong>Replies across engines</strong>: a gateway caller waits on the engine that took the request even when another engine runs the reply step; the waiting engine polls the run row.</li>
</ul>
<h3 id="errors">Errors, retries and the Error handler</h3>
<p>Step settings give retries with a delay and a time limit. A failed attempt with retries left goes back to pending with a not-before time. When retries are spent, the step's <em>error</em> output is taken if it is connected; otherwise the Sutra's Error handler (an activity with no input) receives the error with the step name and message; otherwise the run fails. A failed run can be <strong>resubmitted</strong>: a new run starts with the same trigger input and the old run is marked resubmitted.</p>
<h3 id="debug">Test and debug runs</h3>
<p>A test run uses the draft, not the deployed version. A debug run pauses before each step (<code>paused</code> tasks) and continues one step at a time, so input and output can be checked in the studio.</p>`);

sec('data', 'Data, mapping and expressions', `
<p>Every step sees the same data: <code>trigger</code> (what started the run), <code>input</code> (the previous step's output), <code>nodes.&lt;Step name&gt;</code> (any earlier step), <code>vars</code> (Sutra variables), <code>gv</code> (Project variables), Sengine variables (read only), <code>secret</code> (vault, server side only, masked in history), <code>run</code>, and inside loops <code>item</code>, <code>index</code> and <code>iteration</code>.</p>
<ul>
<li><strong>Templates</strong> (<code>template.ts</code>): <code>{{input.name | upper}}</code> inside text; a field that is only one template keeps the typed value (object, list, number).</li>
<li><strong>Formulas</strong> (<code>expr.ts</code>): a value starting with <code>=</code>, such as <code>=concat({input.first}, ' ', {input.last})</code>. Parsed into a tree and evaluated by the engine; there is no <code>eval</code>.</li>
<li><strong>Structured mapping</strong> (<code>mapping.ts</code>): the Activity Input tree from a shared schema or from paths, with For-Each on repeating nodes, where, group by, sort and conditions.</li>
<li><strong>Shapes before running</strong> (<code>design.ts</code>, <code>schemas.ts</code>): each activity's output hint, schemas and earlier steps give the mapper a tree to drag from before any run exists.</li>
</ul>`);

sec('gateway', 'Services: REST, SOAP and MCP', `
${DIAGRAMS.gateway}
<p>When a Sutra with a REST service, SOAP service or MCP skill trigger is deployed, <code>rebuildRoutes</code> adds its path to the gateway's route table on every engine. A request is matched (method and path with parameters, SOAP action, MCP endpoint), checked against the service's API policy, and starts a run of the deployed version with the request as trigger input. The gateway then waits for the run's reply step (HTTP response, SOAP reply, Reply to AI) up to <code>SUTRA_REPLY_TIMEOUT_MS</code>.</p>
<ul>
<li><strong>TLS</strong> (<code>tls.ts</code>): self-signed for testing, uploaded certificates, or Let's Encrypt with automatic renewal; a client CA turns on mutual TLS for services whose policy asks for it.</li>
<li><strong>SOAP</strong>: the gateway publishes a WSDL for each SOAP service and wraps errors as SOAP faults; WS-Security headers are checked by policy.</li>
<li><strong>MCP</strong> (<code>mcp.ts</code>): JSON-RPC over Streamable HTTP (protocol versions 2025-06-18, 2025-03-26 and 2024-11-05). <code>tools/list</code> returns every deployed MCP skill of that endpoint with its input schema; <code>tools/call</code> starts the Sutra and returns the Reply to AI content. An MCP server connection groups skills under their own path, such as <code>/mcp/orders</code>.</li>
<li><strong>Tracing</strong>: a caller's W3C <code>traceparent</code> continues into the run's trace.</li>
</ul>`);

sec('triggers', 'Timers, listeners and channels', `
<p>Triggers that are not requests are started by the leader engine:</p>
<ul>
<li><strong>Timers</strong> (<code>scheduler.ts</code>): cron expressions or intervals, rebuilt on each deploy.</li>
<li><strong>Listeners</strong> (<code>listeners.ts</code>): folder watchers (File trigger), mailbox polling (Email trigger), queue and topic subscriptions (Service Bus), Drive polling. Queue messages can be acknowledged only after the Sutra succeeded.</li>
<li><strong>Channels</strong> (<code>channels.ts</code>): Send to channel starts every deployed Sutra of the project whose Channel trigger listens on that name. It reads deployments from the database, so it works the same on one engine or many.</li>
</ul>
<p>When the leader stops or dies, another engine takes the lease and starts the timers and listeners itself.</p>`);

sec('storage', 'Storage', `
${DIAGRAMS.storage}
<p>All code reads and writes through <code>q</code> and <code>tx</code> in <code>db.ts</code>. The default backend is SQLite built into Node (<code>node:sqlite</code>), in <code>data/sutra.db</code>, with WAL and a busy timeout so several engines on one host can share the file. With <code>SUTRA_DB=postgres://...</code> the same calls go to PostgreSQL: a worker thread (<code>pgworker.ts</code>) holds the connection, and the caller waits on a SharedArrayBuffer with <code>Atomics.wait</code>, so the storage API stays synchronous like SQLite's. Each write transaction takes a PostgreSQL advisory lock, giving the same one-writer guarantee as SQLite. The tests run the whole suite again on PGlite (PostgreSQL compiled to WebAssembly) to keep both backends equal.</p>
<h3 id="tables">Tables</h3>
${tw(['Table', 'Holds', 'Columns'], tables.map(t => `<tr id="tbl-${t.name}"><td><code>${t.name}</code></td><td>${TABLE_TEXT[t.name] || ''}</td><td class="cols">${t.cols.map(c => esc(c)).join(', ')}</td></tr>`).join(''))}`);

sec('cluster', 'Clusters: several engines', `
${DIAGRAMS.cluster}
<p>Engines that share one database form a cluster. No engine talks to another directly; the database is the only meeting point.</p>
<ul>
<li><strong>Work sharing.</strong> Every engine claims tasks with the atomic update above, so each step runs exactly once, on whichever engine has a free slot.</li>
<li><strong>Heartbeat.</strong> Each engine updates its <code>engines</code> row every <code>SUTRA_HEARTBEAT_MS</code> with its active steps and draining flag. An engine silent for three beats is dead.</li>
<li><strong>Leader.</strong> One engine holds the <code>leader</code> lease (renewed each beat, valid for three). It runs timers, listeners, recovery and housekeeping. If it stops renewing, another engine takes the lease.</li>
<li><strong>Recovery.</strong> The leader puts tasks owned by dead engines back to pending; they run again elsewhere.</li>
<li><strong>Deploy propagation.</strong> A deploy, connection or project change raises a generation number in settings; every engine compares it on each beat and reloads its routes (and the leader its timers and listeners).</li>
<li><strong>Locks.</strong> The <code>leases</code> table also gives short cluster-wide locks, such as the deploy-folder lock so replicas starting together deploy a package once.</li>
<li><strong>Studio in a cluster.</strong> A studio with <code>SUTRA_WORKERS=0</code> edits and deploys; the engines run.</li>
</ul>
<p>Limits: PostgreSQL writes are serialised by the advisory lock, which favours safety over write throughput; bus listeners run on the leader only.</p>`);

sec('deploy', 'Releases and deployment', `
${DIAGRAMS.release}
<h3 id="packages">Project packages</h3>
<p>A release is a <strong>project package</strong> (<code>packages.ts</code>): a JSON file with format <code>sutraflow-package</code> v1 holding every deployed Sutra at its version, the project's connections (secret names, never values), shared schemas and WSDLs, Project variables and logging, a manifest (Sutras, secrets needed, activity types used) and a sha256 checksum over a canonical form. The same file goes to test and production; differences come from each server's <strong>deployment config</strong> (variables, connection settings, logging, with <code>${'${env:NAME}'}</code> values).</p>
<ul>
<li><strong>Check</strong>: the server knows every activity type, the secrets exist in its vault, and API paths and MCP skill names are not used by another project.</li>
<li><strong>Deploy</strong>: Sutras are matched by name and created or updated as new versions (unchanged documents are left alone); Sutras not in the package are undeployed unless kept. Each deployment is stored in <code>package_deployments</code> with its report.</li>
<li><strong>Roll back</strong>: deploys the package before the latest one, or a chosen one from history.</li>
<li><strong>Test</strong>: deploys into a throw-away server and runs the package's Sutras.</li>
</ul>
<h3 id="cli">The sutra command</h3>
${tw(['Command', 'Does'], [
  ['sutra package --project Shop --version 1.4.0', 'Writes Shop-1.4.0.sutra'],
  ['sutra check Shop-1.4.0.sutra', 'Checks it against the target server'],
  ['sutra deploy Shop-1.4.0.sutra [--ops prod.json] [--keep-others]', 'Deploys it'],
  ['sutra test Shop-1.4.0.sutra', 'Tests it on a throw-away server'],
  ['sutra history --project Shop', 'Lists deployments'],
  ['sutra rollback --project Shop', 'Goes back to the previous package'],
  ['sutra secret set NAME', 'Stores a vault secret'],
  ['sutra status', 'Engines, leader and work in the cluster'],
].map(([a, b]) => `<tr><td><code>${a}</code></td><td>${b}</td></tr>`).join(''))}
<p>With <code>--server</code> and <code>--token</code> (or <code>SUTRA_SERVER</code> and <code>SUTRA_ADMIN_TOKEN</code>) the CLI talks to a running studio or engine; without them it works on the local data folder, which is how container images are prepared.</p>
<h3 id="release-sutras">Release Sutras</h3>
<p>The Release palette makes a release itself a Sutra: Build package, Check package, Deploy package and Roll back, on this server or on a remote engine whose admin token comes from the vault. The <em>Release pipeline</em> sample builds, checks, deploys to a test copy, waits for approval and deploys to production. Release activities are off until an administrator allows them in Server &amp; APIs.</p>
<h3 id="strategies">Deployment strategies</h3>
${tw(['Strategy', 'How', 'When'], [
  ['One Sutra', 'Publish a version and deploy it in the studio', 'Development and quick fixes on one server'],
  ['Whole project', 'Package, check, deploy (studio, CLI or a Release Sutra)', 'Test and production: the same file everywhere'],
  ['Headless engine', '<code>SUTRA_MODE=engine</code>; only the automation API, with the token', 'Production servers without the studio'],
  ['Container image', 'Packages in <code>/deploy</code>, deployed at start; a failing package stops the start', 'Docker and Kubernetes'],
  ['Cluster', 'PostgreSQL, several engines, a load balancer on <code>/ready</code>', 'High availability and more throughput'],
].map(([a, b, c]) => `<tr><td><strong>${a}</strong></td><td>${b}</td><td>${c}</td></tr>`).join(''))}
<h3 id="headless">Headless engines</h3>
<p>With <code>SUTRA_MODE=engine</code> the designer is not served and its API is closed. The engine keeps the Admin Console at <code>/admin</code> for its users, and the API the console and automation need: packages, deployed Sutras and their versions, runs, approvals, secrets, engines, access and audit, for signed-in users and API tokens. There is no first-start page; the first administrator is added on the server with <code>sutra user add</code>. Health, readiness and metrics stay available.</p>
<h3 id="console">Admin Console</h3>
<p>The console (<code>web/admin</code>, <code>server/src/console.ts</code>) is for what is deployed. Operators see the overview, start and stop deployed Sutras (their triggers stop starting runs while they stay deployed), look into runs and resubmit them, decide approvals, deploy an earlier version or roll a project back to an earlier package, and drain any engine: the request is stored on the engine's row and that engine drains on its next heartbeat. Administrators manage users, system accounts with their API tokens, roles, and read the audit log. Every page shows only the projects the signed-in account may see, and every action is checked again by the server.</p>
<h3 id="docker">Docker</h3>
<p>The Dockerfile builds in one stage and runs in a slim Node 24 image as the <code>node</code> user under tini, with a health check on <code>/ready</code>. Defaults: headless mode, data in <code>/data</code>, packages from <code>/deploy</code>, admin on 0.0.0.0, JSON logs. <code>docker-compose.yml</code> runs one server; <code>docker-compose.cluster.yml</code> runs PostgreSQL, a studio and two engines with a shared <code>SUTRA_MASTER_KEY</code> and a 45-second stop grace period.</p>`);

sec('startstop', 'Start and stop', `
<h3 id="boot">Start order</h3>
<ol>
<li>Open storage and create missing tables.</li>
<li>Register every activity; connect the variable hooks; load deployment config files.</li>
<li>Deploy packages from <code>SUTRA_DEPLOY_DIR</code> under the deploy-folder lock (skipped when the checksum is already deployed). A package that fails stops the start.</li>
<li>Start the engine worker slots and the cluster beat; the leader starts timers and listeners.</li>
<li>Build the gateway routes, start the gateway listeners and certificate renewal.</li>
<li>Start the admin API. <code>/ready</code> now answers 200.</li>
</ol>
<h3 id="drain">Graceful stop</h3>
${DIAGRAMS.stop}
<p>On SIGTERM, Ctrl+C or <code>POST /api/engine/drain</code>: readiness turns off so load balancers stop sending requests; the engine leaves leadership and stops timers and listeners; running steps get up to <code>SUTRA_DRAIN_MS</code> to finish, and the rest go back to pending for another engine; the gateway closes after its waiting callers have their replies; database and bus pools close; traces are flushed.</p>`);

sec('monitoring', 'Monitoring', `
${tw(['Signal', 'Where', 'Details'], [
  ['Health', '<code>/health</code>, <code>/ready</code>', 'Liveness, and readiness (storage, packages, gateway, not draining)'],
  ['Metrics', '<code>/metrics</code>', 'sutra_runs_started_total, sutra_runs_finished_total, sutra_run_duration_seconds, sutra_steps_total, sutra_step_duration_seconds, sutra_step_retries_total, sutra_gateway_requests_total, sutra_gateway_request_duration_seconds, plus gauges for tasks and engines. Labelled by engine; scrape every engine.'],
  ['Traces', 'OTLP/HTTP to <code>OTEL_EXPORTER_OTLP_ENDPOINT</code>', 'One trace per run, one span per step, trace id from the run id, caller traceparent continued'],
  ['Logs', 'Project log files; standard output', 'Rotation per project; <code>SUTRA_LOG_FORMAT=json</code> for log collectors'],
  ['Engine status', '<code>GET /api/engine/status</code>, <code>sutra status</code>', 'Engines, heartbeats, leader, active steps, draining'],
  ['Run history', 'Studio Runs, <code>/api/runs</code>', 'Every step\'s input, output, error and duration; resubmit; retention by <code>SUTRA_RUN_RETENTION_DAYS</code>'],
].map(([a, b, c]) => `<tr><td><strong>${a}</strong></td><td>${b}</td><td>${c}</td></tr>`).join(''))}`);

sec('security', 'Security', `
<ul>
<li><strong>Studio</strong>: the first visit creates the administrator; signed session cookies that end when the account is disabled or signed out everywhere; changing requests need the X-Sutra header; the admin port listens on 127.0.0.1 unless set otherwise.</li>
<li><strong>Accounts and roles</strong>: people and system accounts hold roles (Administrator, Developer, Deployer, Operator, Approver, Viewer, API caller, or custom ones) for all projects or one project. Every admin API route checks a permission for its project (<code>guard.ts</code>); lists show only the caller's projects. Five wrong passwords lock an account for 15 minutes; an administrator-set password must be changed at the next sign-in; at least one active administrator always remains.</li>
<li><strong>Automation</strong>: <code>SUTRA_ADMIN_TOKEN</code> acts as an administrator, compared in constant time. System accounts get their own API tokens (stored as hashes, with expiry) limited to their roles; headless engines accept only tokens.</li>
<li><strong>Audit</strong>: every change, sign-in and refused request is recorded with who, when, from where and the result, searchable and exportable as CSV.</li>
<li><strong>Vault</strong>: AES-256-GCM; values never leave the server through the API; masked in run history and logs.</li>
<li><strong>Gateway</strong>: per-service API policies (API key, Basic with listed users or system accounts holding Call services on the project, JWT, mutual TLS, WS-Security); TLS with uploaded or Let's Encrypt certificates.</li>
<li><strong>Outbound</strong>: security profiles, client certificates, OAuth tokens stored encrypted, circuit breakers on HTTP connections.</li>
<li><strong>Data never becomes code</strong>: SQL parameters are bound; formulas and templates are parsed, not evaluated; scripts receive values as environment variables and a JSON file; programs get arguments without a shell; file activities stay inside their folder; custom JavaScript runs in a sandboxed worker with limits.</li>
<li><strong>Policies off by default</strong>: scripts, release activities and Sutras changing Sengine variables each need an administrator's switch in Server &amp; APIs.</li>
</ul>`);

sec('ai', 'AI and MCP', `
<p>One <strong>AI provider</strong> connection chooses the engine: the Claude, Gemini or OpenAI APIs; Ollama (online or offline, with models pulled or imported from server paths: gguf, Modelfile, safetensors, or a copied Ollama folder); LM Studio, Hugging Face, local TGI or any OpenAI-compatible server; or the Claude, Gemini and Codex command-line tools installed on the server. Test connection lists the models. Every AI activity returns its answer plus <code>ai</code>: provider, engine, model, tokens and time.</p>
<p>The other direction: a Sutra that starts with an <strong>MCP skill</strong> trigger becomes a tool for AI assistants, described by its name, purpose and inputs, and answered by <strong>Reply to AI</strong>. An MCP server connection groups skills under one address, so an assistant can be given, for example, only the order skills.</p>`);

sec('features', 'Features by palette', `
<p>${allActivities.length} activities in ${pals.length} palettes. The user guide (<a href="/guide">/guide</a>) describes each one with its settings.</p>
${tw(['Palette', 'Activities'], pals.map(p => `<tr id="pal-${p.id}"><td><strong>${esc(p.name)}</strong><span class="cond">${p.acts.length}</span></td><td>${p.acts.map(a => esc(a.name)).join(', ')}</td></tr>`).join(''))}
<h3 id="conn-types">Connection types</h3>
<p>${RESOURCE_KINDS.map(k => esc(k.name)).join(', ')}.</p>
<h3 id="studio-features">Studio</h3>
<ul>
<li>Canvas with palettes, named connections with conditions, undo and redo, test and debug runs.</li>
<li>Mapper: drag from Process Data to Activity Input, formula editor with functions and live preview, For-Each, If and Choose.</li>
<li>Default outputs on every activity (file details, HTTP status, AI model and tokens) even when a schema is set.</li>
<li>Resources with a + menu by kind, own names and icons, Test connection; AI model lists and Ollama management.</li>
<li>${SAMPLES.length} samples that together use every activity.</li>
<li>Runs with step data, approvals, cancel and resubmit; Releases with packages and history; Server &amp; APIs with gateway, TLS, policies and MCP endpoints.</li>
</ul>`);

sec('files', 'What each file does', `
<p>Line counts are from this build. Use the search box to find a file by name or by what it does.</p>
${FILES.map(g => `<h3 id="files-${g.id}">${esc(g.title)}</h3><p>${g.intro}</p>${tw(['File', 'Lines', 'What it does'], g.files.map(([f, d]) => `<tr id="f-${slug(f)}" class="frow"><td><code>${esc(f)}</code></td><td class="num">${fs.existsSync(path.join(root, f)) ? lines(f) : ''}</td><td>${d}</td></tr>`).join(''))}`).join('')}`);

sec('api', 'Admin API routes', `
<p>${api.count} routes in <code>server/src/api.ts</code>. People use them through the studio with a session; automation sends the admin token. Headless engines allow only packages, the projects list, rollback, runs, secrets, meta and engine routes.</p>
${tw(['Area', 'Routes'], api.html)}`);

sec('settings', 'Environment settings', `
<p>Process settings come from environment variables (<code>config.ts</code>). Everything else (gateway ports after the first start, TLS, policies, Sengine variables) is stored in the database and edited in Server &amp; APIs.</p>
${tw(['Variable', 'Default', 'Meaning'], SETTINGS.map(([a, b, c]) => `<tr id="env-${slug(a)}"><td><code>${esc(a)}</code></td><td>${esc(b)}</td><td>${c}</td></tr>`).join(''))}`);

sec('testing', 'Tests', `
<p><code>npm test</code> compiles the server, then runs every suite with Node's test runner. Multi-process suites start real servers (headless engines, clusters on one database, drain and failover). The PostgreSQL suite runs the in-process suites again on PGlite with shifted ports. Two suites run only when their tools exist: the Docker image build, and a real PostgreSQL server through <code>SUTRA_TEST_PG_URL</code>. A guard test fails if names of other products appear in the source or documents.</p>
${testFiles.map(f => `<h3 id="t-${slug(f)}">${esc(f)}</h3><ul class="tests">${testNames(f).map(n => `<li>${esc(n)}</li>`).join('')}</ul>`).join('')}`);

// ---------------------------------------------------------------------------------------------
// Page.
// ---------------------------------------------------------------------------------------------
const toc = S.map((s, i) => {
  const subs = [...s.html.matchAll(/<h3 id="([^"]+)">([^<]+)<\/h3>/g)];
  return `<li><a href="#${s.id}">${esc(s.title)}</a>${subs.length && s.id !== 'testing' ? `<ol class="sub">${subs.map(m => `<li><a href="#${m[1]}">${m[2]}</a></li>`).join('')}</ol>` : ''}</li>`;
}).join('');
const body = S.map(s => `<section id="${s.id}"><h2>${esc(s.title)}</h2>${s.html}</section>`).join('\n');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SutraFlow Architecture</title>
<link rel="icon" href="${LOGO_URI}">
<!-- Generated by tools/build-architecture.ts (npm run architecture). Do not edit by hand. -->
<style>
:root{--ink:#1c1c1e;--muted:#6e6e73;--bg:#f2f2f7;--card:#fff;--line:rgba(60,60,67,.12);--line2:rgba(60,60,67,.32);--accent:#0E7A62;--accent2:#007aff;--soft:#e8f5f1;--ext:#eef2f6;--code:rgba(118,118,128,.12)}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--ink:#f2f2f7;--muted:#a1a1a6;--bg:#111214;--card:#1c1c1e;--line:rgba(235,235,245,.14);--line2:rgba(235,235,245,.34);--accent:#3fbf9b;--accent2:#4da3ff;--soft:#12302a;--ext:#1d2630;--code:rgba(118,118,128,.28);color-scheme:dark}}
:root[data-theme=dark]{--ink:#f2f2f7;--muted:#a1a1a6;--bg:#111214;--card:#1c1c1e;--line:rgba(235,235,245,.14);--line2:rgba(235,235,245,.34);--accent:#3fbf9b;--accent2:#4da3ff;--soft:#12302a;--ext:#1d2630;--code:rgba(118,118,128,.28);color-scheme:dark}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Roboto,Arial,sans-serif;color:var(--ink);line-height:1.6;-webkit-font-smoothing:antialiased;background:var(--bg)}
body::before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;background:url("${LOGO_URI}") no-repeat 70% 55%/min(78vw,900px);opacity:.06}
a{color:var(--accent2);text-decoration:none}a:hover{text-decoration:underline}
code{font-family:ui-monospace,'SF Mono',Consolas,monospace;font-size:.86em;background:var(--code);padding:1px 5px;border-radius:5px;overflow-wrap:anywhere}
.wrap{max-width:1320px;margin:0 auto;padding:28px 24px 60px}
header.top{display:flex;align-items:center;gap:16px;margin-bottom:6px}
header.top img{width:58px;height:58px}
h1{margin:0;font-size:2.4em;font-weight:800;line-height:1.1;letter-spacing:-.02em}
.sub1{color:var(--muted);margin:0 0 18px}
.layout{display:flex;gap:26px;align-items:flex-start}
nav.toc{flex:0 0 270px;position:sticky;top:16px;max-height:calc(100vh - 32px);overflow:auto;border:1px solid var(--line);border-radius:16px;padding:14px 16px;background:color-mix(in srgb,var(--card) 88%,transparent);backdrop-filter:saturate(180%) blur(20px);box-shadow:0 8px 30px rgba(0,0,0,.06);font-size:.92em}
nav.toc ol{margin:0 0 6px 18px;padding:0}nav.toc li{margin:2px 0}nav.toc ol.sub{font-size:.9em;margin-left:14px}
#asearch{margin:-14px -16px 12px;padding:12px 16px;background:var(--card);border-bottom:1px solid var(--line);border-radius:16px 16px 0 0}
#asearch.dock{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);width:min(560px,calc(100vw - 32px));margin:0;border:1px solid var(--line);border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.18);z-index:20}
#aq{width:100%;padding:9px 12px;border:0;border-radius:10px;font:inherit;background:var(--code);color:var(--ink);outline-color:var(--accent)}
#ares{max-height:46vh;overflow:auto}#ares a{display:block;padding:5px 8px;border-radius:8px;color:var(--ink)}#ares a:hover,#ares a:focus{background:var(--code);text-decoration:none}#ares small{color:var(--muted)}#ares .x{display:block;color:var(--muted);font-size:.82em;line-height:1.35}
main{flex:1;min-width:0}
section{scroll-margin-top:12px}
h2{margin:56px 0 14px;padding:18px 22px;font-size:1.75em;font-weight:700;line-height:1.2;letter-spacing:-.01em;background:linear-gradient(135deg,var(--card) 0%,var(--soft) 100%);border:1px solid var(--line);border-radius:16px;box-shadow:0 2px 10px rgba(0,0,0,.05);text-wrap:balance}
section:first-child h2{margin-top:0}
h3{margin:34px 0 8px;font-size:1.25em;color:var(--accent);scroll-margin-top:12px}
p,li{max-width:80ch}ul,ol{padding-left:22px}li{margin:4px 0}
.tw{overflow-x:auto;margin:8px 0 16px;border-radius:12px}
table.t{width:100%;border-collapse:separate;border-spacing:0;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;font-size:.94em}
table.t th{text-align:left;border-bottom:1px solid var(--line);padding:10px 12px;font-size:.76em;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}
table.t td{border-bottom:1px solid var(--line);padding:9px 12px;vertical-align:top}table.t tr:last-child td{border-bottom:0}
table.t td.num{font-variant-numeric:tabular-nums;color:var(--muted);text-align:right;width:60px}
table.t td.cols{color:var(--muted);font-size:.88em}
tr.hit td{background:var(--soft)}
.cond{display:block;color:var(--muted);font-size:.82em;font-weight:400}
ul.tests{columns:2 360px;column-gap:28px;font-size:.92em}ul.tests li{break-inside:avoid}
figure.dg{margin:18px 0 22px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 12px 4px}
.dgs{overflow-x:auto}
figure.dg svg{display:block;width:100%;height:auto;font-family:inherit}
figure.dg figcaption{color:var(--muted);font-size:.88em;padding:8px 4px 6px}
.bx rect{fill:var(--card);stroke:var(--line2);stroke-width:1.2}
.bx.acc rect{fill:var(--soft);stroke:var(--accent);stroke-width:1.6}
.bx.ext rect{fill:var(--ext);stroke:var(--line2);stroke-dasharray:5 4}
.bx text{text-anchor:middle}.bx .t{fill:var(--ink);font-size:13.5px;font-weight:650}.bx .s{fill:var(--muted);font-size:11.5px}
.ar{fill:none;stroke:var(--muted);stroke-width:1.6}.ar.dash{stroke-dasharray:5 4}
.ahp{fill:var(--muted)}
.al{fill:var(--accent);font-size:11.5px;font-weight:600;text-anchor:middle;paint-order:stroke;stroke:var(--card);stroke-width:4px}
.grp rect{fill:none;stroke:var(--accent);stroke-width:1.4;stroke-dasharray:7 5}.grp text{fill:var(--accent);font-size:13px;font-weight:700}
.nt{fill:var(--muted);font-size:12px}
#atop{position:fixed;right:22px;bottom:22px;z-index:21;border:0;border-radius:999px;padding:10px 16px;font:600 .9em inherit;background:var(--accent);color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.2);cursor:pointer;opacity:0;pointer-events:none;transition:opacity .2s}
#atop.on{opacity:1;pointer-events:auto}
:focus-visible{outline:2px solid var(--accent2);outline-offset:2px}
footer{margin-top:60px;color:var(--muted);font-size:.88em;text-align:center}
@media (max-width:900px){.layout{display:block}nav.toc{position:static;max-height:none;margin-bottom:20px}.wrap{padding:18px 16px 60px}h1{font-size:1.8em}h2{font-size:1.4em}table.t{min-width:600px}}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}#atop{transition:none}}
</style>
</head>
<body>
${ARROW_DEFS}
<div class="wrap">
<header class="top"><img src="${LOGO_URI}" alt=""><div><h1>SutraFlow Architecture</h1></div></header>
<p class="sub1">Version ${esc(version)} &middot; how it works, what each file does, deployment and features &middot; <a href="/guide">User guide</a></p>
<div class="layout">
<nav class="toc">
  <div id="asearch"><input id="aq" type="search" placeholder="Search files, tables, settings, topics" aria-label="Search the architecture page" autocomplete="off"><div id="ares" role="list"></div></div>
  <strong style="display:block;margin-bottom:8px">Contents</strong>
  <ol>${toc}</ol>
</nav>
<main>
${body}
<footer>&copy; 2026 SutraFlow &middot; generated from SutraFlow ${esc(version)}</footer>
</main>
</div>
</div>
<button id="atop" type="button" aria-label="Back to the top">&uarr; Top</button>
<script>
(function(){
  function txt(el){return (el.textContent||'').replace(/\\s+/g,' ').trim();}
  var idx=[];
  [].forEach.call(document.querySelectorAll('main section'),function(s){
    var h=s.querySelector('h2');var t='',n=h.nextElementSibling;
    for(;n&&n.tagName!=='H3';n=n.nextElementSibling)t+=' '+txt(n);
    idx.push({id:s.id,title:txt(h),kind:'Section',text:(txt(h)+' '+t).toLowerCase(),x:''});
  });
  [].forEach.call(document.querySelectorAll('main h3[id]'),function(h){
    var t='',n=h.nextElementSibling;for(;n&&!/^H[23]$/.test(n.tagName);n=n.nextElementSibling)t+=' '+txt(n);
    var sec=h.closest('section').querySelector('h2');
    idx.push({id:h.id,title:txt(h),kind:txt(sec),text:(txt(h)+' '+t).toLowerCase(),x:''});
  });
  [].forEach.call(document.querySelectorAll('main tr[id]'),function(r){
    var c=r.cells,k=r.id.slice(0,2)==='f-'?'File':r.id.indexOf('tbl-')===0?'Table':r.id.indexOf('env-')===0?'Setting':'Palette';
    idx.push({id:r.id,title:txt(c[0]),kind:k,text:txt(r).toLowerCase(),x:txt(k==='Table'?c[1]:c[c.length-1]).slice(0,110)});
  });
  [].forEach.call(document.querySelectorAll('main figure.dg'),function(f){
    idx.push({id:f.id,title:txt(f.querySelector('figcaption')),kind:'Diagram',text:txt(f).toLowerCase(),x:''});
  });
  var q=document.getElementById('aq'),r=document.getElementById('ares'),box=document.getElementById('asearch'),top=document.getElementById('atop'),nav=box.parentNode;
  function e(s){return s.replace(/[&<>]/g,function(c){return c==='&'?'&amp;':c==='<'?'&lt;':'&gt;';});}
  function show(){
    var v=q.value.trim().toLowerCase();if(!v){r.innerHTML='';return;}
    var words=v.split(/\\s+/),hits=idx.filter(function(i){return words.every(function(w){return i.text.indexOf(w)>=0;});});
    function sc(i){var t=i.title.toLowerCase(),f=t.split('/').pop(),k=t.indexOf(v);if(t===v||f===v||f===v+'.ts')return 5;if(k===0||f.indexOf(v)===0)return 4;if(k>0&&!/[a-z0-9]/.test(t.charAt(k-1)))return 3;return k>=0?2:0;}
    hits.forEach(function(i,n){i.n=n;i.s=sc(i);});hits.sort(function(a,b){return b.s-a.s||a.n-b.n;});
    r.innerHTML=hits.length?hits.slice(0,40).map(function(i){return '<a role="listitem" href="#'+i.id+'">'+e(i.title)+' <small>'+e(i.kind)+'</small>'+(i.x?'<span class="x">'+e(i.x)+'</span>':'')+'</a>';}).join(''):'<small>Nothing found.</small>';
  }
  q.addEventListener('input',show);
  q.addEventListener('keydown',function(ev){if(ev.key==='Enter'){var a=r.querySelector('a');if(a){a.click();}}if(ev.key==='Escape'){q.value='';show();}});
  r.addEventListener('click',function(ev){var a=ev.target.closest('a');if(!a)return;var el=document.getElementById(a.getAttribute('href').slice(1));
    [].forEach.call(document.querySelectorAll('tr.hit'),function(t){t.classList.remove('hit');});if(el&&el.tagName==='TR')el.classList.add('hit');q.value='';show();});
  function onScroll(){var y=window.scrollY>320;top.classList.toggle('on',y);var d=y&&window.innerWidth>900;if(d!==box.classList.contains('dock')){var f=document.activeElement===q;box.classList.toggle('dock',d);if(d)document.body.appendChild(box);else nav.insertBefore(box,nav.firstChild);if(f)q.focus();}}
  window.addEventListener('scroll',onScroll,{passive:true});
  top.addEventListener('click',function(){window.scrollTo({top:0});});
  document.addEventListener('keydown',function(ev){if(ev.key==='/'&&document.activeElement!==q){ev.preventDefault();q.focus();}});
})();
</script>
</body>
</html>
`;

fs.writeFileSync(OUT, html);
console.log(`Wrote ${path.relative(root, OUT)} (${Math.round(fs.statSync(OUT).size / 1024)} KB): ${S.length} sections, ${described.size} files, ${tables.length} tables, ${api.count} routes.`);
if (problems.length) { console.error('Problems:\n  ' + problems.join('\n  ')); process.exitCode = 1; }
