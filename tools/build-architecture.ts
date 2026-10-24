/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
/**
 * Builds docs/sutraflow-architecture.html: how SutraFlow works, what every file does, deployments and
 * features, with diagrams and a search box. Served by the studio at /architecture.
 * The prose lives here; file sizes, tables, API routes, settings, palettes and test names are read
 * from the code, and the build fails when a source file has no description.
 *
 *   npm run architecture
 */
import { TABLE_TEXT, schemaTables } from './guide/tables.js';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
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

const CLI_COMMANDS = (() => { try { return cliCommands(); } catch { return 'see sutra help'; } })();
const FILES: Group[] = [
  {
    id: 'core', title: 'Server start, storage and cluster', intro: 'The process: how it starts and stops, where it keeps its data, and how several engines share one database.',
    files: [
      ['server/src/main.ts', 'Entry point of <code>npm start</code>. Boots the server, prints the studio and gateway addresses, and turns SIGTERM and Ctrl+C into a graceful stop (drain first).'],
      ['server/src/index.ts', '<code>boot()</code>: opens storage, registers every activity, loads deployment configs, deploys the packages in <code>SUTRA_DEPLOY_DIR</code> under a cluster-wide lock, starts the engine, the cluster beat, the gateway and the admin API, and wires change hooks (deploys rebuild routes, timers and listeners). Also the ordered <code>stop()</code>.'],
      ['server/src/config.ts', 'Process settings from environment variables (mode, environment, ports, folders, database with the password apart as SUTRA_DB_PASSWORD, engine id, drain, heartbeat, retention, logs, tracing, tokens) and the product version from package.json. Everything else is stored in the database and edited in the Designer or Admin Console according to ownership.'],
      ['server/src/lifecycle.ts', 'Liveness (<code>/health</code>, with the version, mode, environment and the database in use) and readiness (<code>/ready</code>): storage answers, packages are deployed, the gateway listens, and the server is not draining.'],
      ['server/src/cluster.ts', 'Heartbeat row per engine, the authoritative leader lease, recovery of a dead engine\'s steps, the deploy generation number that makes every engine reload its routes, leadership hand-over on stop, and the engine status list. A database interruption is contained and retried; after recovery the lease row decides whether this process still leads.'],
      ['server/src/housekeeping.ts', 'Deletes finished runs older than <code>SUTRA_RUN_RETENTION_DAYS</code>, with their steps, in batches. Run by the leader about once a minute; waiting runs are never deleted.'],
      ['server/src/db.ts', 'The synchronous compatibility storage layer: <code>q</code> (get, all, run) and <code>tx</code> (transaction) on SQLite or PostgreSQL, used by administrative and low-frequency paths. Holds the table definitions, converts them for PostgreSQL (bigint, double precision, bigserial) and <code>?</code> placeholders to <code>$n</code>, and takes an advisory lock for each PostgreSQL write transaction (per run or Sutra queue with a key, one shared lock without). Refuses a synchronous write while an asynchronous transaction is open (asyncTxScope), so a transaction is never split over two connections. <code>memoryStore</code> gives the private in-memory database of runs that run in memory.'],
      ['server/src/asyncdb.ts', 'Asynchronous storage for engine and gateway hot paths: on PostgreSQL a connection pool on the main thread (SUTRA_PG_POOL, metrics of waits and transaction times), on SQLite, PGlite and the in-memory engine one connection whose transactions take turns. Transactions are explicit objects (transaction(key, async tx => ...)); a first query travels with begin and the lock, and commitWith() sends the last statement with the commit, so a step completes in three round trips. Deadlocks and serialization failures are tried again.'],
      ['server/src/pgworker.ts', 'Worker thread that owns the synchronous PostgreSQL connection of db.ts (<code>pg</code>, or PGlite for <code>pglite:</code> addresses). The main thread posts a numbered statement and waits on a shared flag for the answer with the same number. A lost connection is opened again on the next statement (10 tries); a statement already sent is never repeated, and a transaction the connection was lost in fails until it is rolled back. The engine uses the pool of asyncdb.ts instead.'],
    ],
  },
  {
    id: 'engine', title: 'Engine', intro: 'The durable step runner and the types every activity follows.',
    files: [
      ['server/src/engine/engine.ts', 'The public durable-engine façade and composition root: activity registration, start and drain, starting runs, complete/fail orchestration, and the in-memory twin. It keeps the API stable while delegating claims, execution, routing, storage, waits and operator actions.'],
      ['server/src/engine/executor.ts', 'Executes one claimed activity: mapping context, variables and secrets, time limits and cancellation, loops, streamed emits, logs, and the complete-or-fail handoff. It does not own durable transition SQL.'],
      ['server/src/engine/scheduler.ts', 'Queue polling, batched claims, priority order, concurrency slots and coalesced wake calls. PostgreSQL claims include the run and its outputs in the same round trip.'],
      ['server/src/engine/queue-notify.ts', 'PostgreSQL LISTEN/NOTIFY wake hints with reconnect; durable polling remains authoritative and can be used alone with SUTRA_PG_NOTIFY=0.'],
      ['server/src/engine/transitions.ts', 'Atomic primitives shared by complete, fail, route and settle: fenced updates, output plus run commits, state and logs, cancellation of open tasks, and routing scope.'],
      ['server/src/engine/run-store.ts', 'The storage boundary for run loading, separately stored step outputs, claimed-task fencing, final settlement and copying ended in-memory runs into durable storage. A stale owner gets StaleStep and changes nothing.'],
      ['server/src/engine/router.ts', 'Conditional routing, joins and dead-path elimination. It sends live or skip tokens and schedules the next activity without putting graph traversal back into the façade.'],
      ['server/src/engine/waits.ts', 'Request/reply and finish callbacks, live run listeners, cross-engine completion checks and waitFor. Polling remains the correctness fallback when another engine finishes a run.'],
      ['server/src/engine/operator.ts', 'Stable boundary for operator actions: approval decisions, cancel, resubmit, debug, queued-run promotion, time limits and cancellation observed from another engine.'],
      ['server/src/engine/state.ts', 'Run-state types and pure helpers: separately stored outputs, initial process variables, compact streamed output and full state for API/history views.'],
      ['server/src/engine/types.ts', 'Types shared by the engine, palettes and studio: Sutra document (nodes with descriptions, edges with label and condition), activity definition (fields, ports, output hint, design checks, execute), step settings, execution context and step result (port, output, wait, reply, call, result, stop).'],
    ],
  },
  {
    id: 'data', title: 'Data, mapping and expressions', intro: 'How values move between steps: templates, formulas, structured mapping and design-time shapes.',
    files: [
      ['server/src/template.ts', '<code>{{ }}</code> templates: input, nodes, trigger, vars, gv, secret, run, item, index; pipes such as upper, default, number, length. Parsed, never evaluated as code.'],
      ['server/src/expr.ts', 'Formulas starting with <code>=</code>: functions (string, number, date, list, encoding), operators and predicates, plus read-only hooks for Project and Engine properties. Also the function catalog shown in the mapper.'],
      ['server/src/values.ts', 'Path and value helpers shared by templates and formulas.'],
      ['server/src/mapping.ts', 'Structured Activity Input mapping: a target tree from a schema or ad-hoc paths, with For-Each, where, group by, sort, conditions and Choose.'],
      ['server/src/mapping-check.ts', 'Shared static mapping checks and runtime/sample value checks: required targets, formula syntax, stale rules, XML root/name rules, typed values and list cardinality.'],
      ['server/src/schema-validation.ts', 'Shared asynchronous contract validation: AJV for JSON Schema and isolated libxml2 WebAssembly for original XML / namespace-preserved SOAP operations; bounded concurrency and project-local XSD dependencies.'],
      ['server/src/schema-impact.ts', 'Read-only proposed-schema structural comparison and project-scoped saved-draft usage analysis. Injects an isolated lookup into design analysis; never saves or swaps shared schema state. Reports new diagnostics and explicit runtime/deployed/transitive-dependency limitations.'],
      ['server/src/mapping-preview.ts', 'Read-only whole-mapping JSON/XML preview and proposed JSON Schema/XSD generation from bounded sample text. No activity dispatch or external connector is executed.'],
      ['server/src/sample-schemas.ts', 'Project-scoped schema contracts attached to newly added samples without replacing existing drafts or edited shared schemas.'],
      ['server/src/sample-mapping.ts', 'Executable typed JSON and XML mapping examples: shared JSON targets and manual XML attributes, namespaces and repeating elements.'],
      ['server/src/sample-validation.ts', 'Ten described contract-validation samples: schema-backed XML mapping, JSON/XML pipelines and expected rejection, strict file reads, and live HTTP/REST/SOAP examples; project-scoped schemas are reused without overwriting edits.'],
      ['server/src/design.ts', 'Design-time data shapes: what each step receives and returns before anything has run, and the warnings of each step (unmapped required fields, schema problems, and the activity\'s own design checks). Feeds the Process Data tree, the Output tab and the canvas warnings.'],
      ['server/src/schemas.ts', 'Shared schemas of a project: JSON Schema, sample JSON, XSD and WSDL, all converted to one tree format for the mapper.'],
      ['server/src/settings.ts', 'Common checkbox defaults and strict Boolean Project/Engine-property conversion for activities and gateway/listener configuration, preserving legacy non-Boolean aliases. Booleans accept true/on/yes/1 or false/off/no/0; missing or invalid property values fail rather than use string truthiness. Selected-schema validation is opt-in; On requires a valid matching contract. Strict sample JSON requires every shown field and forbids extras; JSON Schema follows its authored constraints. Compiled checks are reused only for unchanged persisted schema text. Executable SQL identifiers accept only administrator properties while run data remains bound.'],
    ],
  },
  {
    id: 'projects', title: 'Projects, Sutras, connections and releases', intro: 'What a team edits and ships.',
    files: [
      ['server/src/projects.ts', 'Projects: administrator-managed Project properties, logging, deployment (ops) configs with <code>${env:...}</code> values, the project files folder (<code>${files}</code> = <code>&lt;data&gt;/files/&lt;project&gt;</code>), Engine properties and server policies. Renaming a project keeps its id and moves its name-based files folder and deployment config.'],
      ['server/src/flows.ts', 'Sutras: draft, published versions, deploy and undeploy, step descriptions kept, validation (names, ports, connection conditions, Error handler, API paths, MCP skill names, and the design checks of each activity, such as a missing Python, file or connection), the change hooks, and missing project variables per step (also through its connections).'],
      ['server/src/git/files.ts', 'A project as Git files and back: sutraflow.json, sutras, connections (secret names only), schemas, in folders; stable JSON; repository ids mapped to each workspace\'s own ids, references translated both ways.'],
      ['server/src/git/engine.ts', 'Git for workspaces: the git command (tokens through one-command environment settings, never on the command line) or isomorphic-git built in (content-compared status); init, clone, status, commit, push, fetch, pull with conflicts, branches, history, files at a commit.'],
      ['server/src/git/accounts.ts', 'Each person\'s Git accounts (GitHub, GitLab, Bitbucket, Azure DevOps, others): encrypted tokens used only for that person, author name and email.'],
      ['server/src/git/workspaces.ts', 'Workspaces: initialize a team project, clone into a personal copy (owner only, not deployable, restricted until trusted), status by item, commit, push, pull, conflicts, discard, branches, history, diffs, disconnect.'],
      ['server/src/git/restricted.ts', 'Restricted mode: the steps that run code or commands from a repository, refused in an untrusted personal copy.'],
      ['server/src/folders.ts', 'Folders of the Project explorer for Sutras, Resources, Schemas and Service descriptors: a <code>folder</code> path on each item, empty folders in the <code>folders</code> table; rename and move take the contents along, remove lifts them one level, nothing is deleted.'],
      ['server/src/resources.ts', 'Connection types (HTTP, SOAP, security profiles, API policies, AI provider, MCP server and the connector kinds) with their fields and icons. Secret values are never stored here, only vault names.'],
      ['server/src/resourceTest.ts', '"Test connection": tries the settings as they are on screen, with variables resolved, and reports the result in one sentence; for every kind, including AI providers, knowledge bases, MCP, databases, SFTP and FTP, brokers, OAuth accounts (YouTube channel, Twitch user), Azure Data Factory, Databricks, Discord and Telegram.'],
      ['server/src/secrets.ts', 'The vault. AES-256-GCM with a key from <code>SUTRA_MASTER_KEY</code> or <code>data/master.key</code>. Values are never returned by the API and are masked in run history.'],
      ['server/src/samples.ts', 'The sample catalog offered in "New Sutra" (' + SAMPLES.length + ' samples covering every activity) and <code>addSamples()</code>: each goes to a <code>Samples/&lt;topic&gt;</code> folder, and every empty connection field it uses is set to a "Sample ..." connection made once in the project.'],
      ['server/src/channels.ts', 'Send to channel: starts every deployed Sutra of the project whose Channel trigger listens on that name. Reads deployments from the database, so it works across engines.'],
      ['server/src/bundles.ts', 'Release zips: the package, a deployment config to fill in (connections, project variables, secrets needed), a README, the documentation (HTML and Markdown) and the project files (<code>files/</code>, written to the project files folder on deploy and import); zip writer and reader; packages built from the Git files of a project without a server.'],
      ['server/src/connectors/websocket.ts', 'WebSocket palette: the WebSocket service trigger and send step (answer, push, broadcast, close), the WebSocket connection kind, the client trigger (reconnects with growing waits, subscribes again, leader engine only) and the client send step that can wait for its answer.'],
      ['server/src/connectors/chat.ts', 'Discord (webhook or bot) and Telegram bots: messages, embeds and files, reading a channel, Test connection, and triggers for messages and commands (channel polling, Telegram long polling).'],
      ['server/src/connectors/azure.ts', 'Azure Data Factory and Databricks: Entra ID sign-in (service principal, managed identity, Azure CLI) and Databricks tokens or OAuth; run, wait for, rerun and cancel pipelines; the run-finished trigger; jobs, notebooks, code blocks and SQL; Test connection.'],
      ['server/src/python.ts', 'Python on the server: finding the interpreter (setting, SUTRA_PYTHON, py, python3, python), and checks before a run: syntax, missing files, virtual environments and packages.'],
      ['server/src/dbmigrate.ts', 'Moving the server\'s own data from SQLite to PostgreSQL: the saved connection (password in the vault), Test connection with plain-word errors for remote servers, SSL modes, the migration status, and starting tools/migrate-to-postgres from the Admin Console.'],
      ['server/src/docs.ts', 'Documentation made from Sutras: triggers, steps in run order with their descriptions and settings (connections by name, secrets by name), next steps, error handling, connections and variables; Markdown and HTML, for one Sutra, a project or a package.'],
      ['server/src/sampledocs.ts', 'The documents of the RAG samples (a PDF, a Word document, a PowerPoint deck and a Markdown FAQ of a tea shop), made in code so they are always the same.'],
      ['server/src/packages.ts', 'Project packages: build (Sutras at their versions, connections, schemas, variables, a sha256 checksum), read, check, deploy (matched by name, prune or keep others, deployment config), history, rollback and test.'],
      ['server/src/cli.ts', 'The <code>sutra</code> command, on a remote server with a token or on the local data folder. Commands (read from <code>sutra help</code> when this page is built): ' + CLI_COMMANDS + '.'],
    ],
  },
  {
    id: 'services', title: 'Admin API, gateway and triggers', intro: 'The two network faces of the server and the long-running starters.',
    files: [
      ['server/src/api.ts', 'Admin API on port 4800 (Fastify): sign-in, projects, Sutras, runs, approvals, resources, secrets, packages and release zips, documentation, sample projects, Git, OAuth sign-in, engine control, server settings, Python, the database page and the move to PostgreSQL, design-time SQL previews capped at ten rows, <code>/health</code>, <code>/ready</code>, <code>/metrics</code>, <code>/guide</code>, <code>/architecture</code> and the studio files. Bearer tokens for automation; a headless engine allows only a short list of routes.'],
      ['server/src/access.ts', 'Users and system accounts (provision, disable, lockout, password rules, sign out everywhere), roles made of permissions, grants for all projects or one project, permission checks, API tokens of system accounts (stored as hashes), and Basic sign-in of system accounts at the gateway.'],
      ['server/src/guard.ts', 'The permission of every admin API route and the project it applies to. The server refuses to start when a route has no rule. Also writes each change and each refusal to the audit log, without passwords or secret values.'],
      ['server/src/console.ts', 'Data for the Admin Console: the overview (engines, deployed Sutras, runs of the last day, failures, approvals, gateway), deployed applications with their triggers and run counts, starting and stopping a deployed Sutra, and drain requests for any engine. Always limited to the projects the caller may see.'],
      ['server/src/tuning.ts', 'Tuning parameters: engine values for the cluster or one engine (steps at once, in memory too, steps per run, reply wait, retention, trace sampling, queue check, settings refresh) and per deployed Sutra (execution durable or in memory, runs at once, priority, run time limit, default retries, step data in history, retention). Stored in settings and deployments, applied by every engine on the next beat. Refuses in memory for Sutras with steps that wait.'],
      ['server/src/memtables.ts', 'Memory tables: small reference data each engine keeps in an LRU JavaScript Map; loaded from Oracle, SQL Server, MySQL, PostgreSQL or SQLite, filled by Sutras or fetched on a miss. Set Memory updates running row/byte counts and cached quotas in constant time; Refresh alone builds and measures a replacement before an atomic swap. Cron/interval schedules use the leader for failsafe tables and each engine for memory-only tables. Failsafe changes use mem_rows and mem_meta versioning; engines read deltas and hot-reload requests.'],
      ['server/src/palettes/memory.ts', 'Memory tables palette: Get Memory Record (read-through), Set Memory, Delete Memory Records, Query Memory Records and Refresh Memory Table. Cache mutation never writes to the external source database.'],
      ['server/src/sizing.ts', 'Machine profiles from 1 vCPU / 1 GB up, measured with tools/loadtest.mjs: steps at once, queue check, settings refresh, engines per machine, Node memory, files read whole, rows per streamed batch, database. Engine defaults and the Admin Console panel This machine come from here.'],
      ['server/src/alerts.ts', 'Alerts: channels (email, signed webhook, a Sutra), rules of nine kinds checked by the cluster leader every 30 seconds, alerts that open, remind, are acknowledged and resolve, delivery records, and the runs timeline of the Overview.'],
      ['server/src/audit.ts', 'The audit log: record, search, CSV export, and deletion after <code>SUTRA_AUDIT_RETENTION_DAYS</code>.'],
      ['server/src/approvals.ts', 'The Approval Center: who may decide an approval (roles and accounts the step names, from the data too; Approve permission when it names nobody; administrators on behalf), the rule (any, all, a number), votes, history, reassigning, and the leader\'s 30-second tick for email notices, reminders, escalation and expiry.'],
      ['server/src/deletes.ts', 'Deleting and renaming project items: one Sutra, connection, schema or service descriptor, or a folder with everything in it (confirm=delete, refused while a Sutra in it is deployed, in one transaction); what uses an item; the Git working copy written again at once. Configuration is never deleted here.'],
      ['server/src/sso.ts', 'Single sign-on for people with OpenID Connect or SAML 2.0. OIDC uses authorization code with PKCE, state and nonce. SAML combines one-time shared-database state with a signed client cookie, usable by browsers or cookie-aware API clients, and delegates signed assertion validation to saml-sso.ts. Accounts are found by the provider subject/NameID, created or linked only when allowed; roles come from groups.'],
      ['server/src/saml-sso.ts', 'SAML 2.0 browser sign-on: Redirect AuthnRequest generation and HTTP-POST Response verification. Requires one signed assertion or signed response and checks issuer, request, destination, bearer recipient, audience and time limits while refusing duplicate-ID wrapping.'],
      ['server/src/auth.ts', 'Studio sign-in: the first visit creates the administrator, sessions are signed cookies, and changing requests need the X-Sutra header (a cross-site form cannot send it).'],
      ['server/src/gateway/gateway.ts', 'The gateway façade and route dispatcher: HTTP and HTTPS listener lifecycle, deployed route tables, REST/SOAP service dispatch, policy checks, run start with the caller\'s traceparent, and waiting for replies. Protocol-specific MCP and OAuth handling is delegated.'],
      ['server/src/gateway/rest.ts', 'REST body decoding and response serialization, kept apart from listener and routing lifecycle.'],
      ['server/src/gateway/soap.ts', 'SOAP envelopes, faults, XML rendering and WSDL generation, kept apart from listener and routing lifecycle.'],
      ['server/src/gateway/mcp-handler.ts', 'Streamable HTTP MCP endpoint handling: protocol negotiation, sessions, JSON-RPC validation, tool discovery and calls; starts runs through the gateway callback without owning listener lifecycle.'],
      ['server/src/gateway/oauth-handler.ts', 'The OAuth 2.0 client-credentials token endpoint: form decoding, client authentication, scope checks and token response.'],
      ['server/src/gateway/agents.ts', 'Published agents on the gateway: chat page, chat API, jobs and the chat button script; OpenAI-compatible models and chat completions (plain and streamed); the ask_<name> MCP tool; A2A agent card, message/send and tasks/get. Answers within the agent time, else a job id.'],
      ['server/src/gateway/apps.ts', 'Gateway management: apps with scopes and plans, API keys (stored as hashes), OAuth2 client credentials tokens, cluster-wide plan limits, the firewall, request log, traffic statistics and OpenAPI. Authentication, quotas, firewall reads and request logging use the asynchronous pool on the request path; admin screens retain the compatibility layer.'],
      ['server/src/gateway/websocket.ts', 'WebSocket services on the gateway: upgrades through the firewall and the API security policy (token or key in the query for browsers, CORS origins), a run per message in order per connection, size and schema checks, pings, and an outbox table so a step on any engine reaches a connection held by another.'],
      ['server/src/gateway/tls.ts', 'Gateway certificates: off, self-signed, uploaded, or Let\'s Encrypt (ACME HTTP-01) with renewal 30 days before expiry, and client CA for mutual TLS.'],
      ['server/src/mcp.ts', 'Model Context Protocol over Streamable HTTP: tools/list from deployed MCP skill triggers, tools/call starts the Sutra and returns what Reply to AI sends. JSON Schema from shared schemas or simple input rows.'],
      ['server/src/scheduler.ts', 'Timer triggers (cron or interval) of deployed Sutras, on the leader.'],
      ['server/src/listeners.ts', 'Long-running process starters on the elected leader: folder watchers, mailbox polling, queue and topic subscriptions, Drive and chat polling. Rebuilt one after another when deployments, properties or connections change; General settings are resolved before a listener starts.'],
    ],
  },
  {
    id: 'security', title: 'Security', intro: 'Inbound checks, outbound authentication and protection of slow services.',
    files: [
      ['server/src/security/inbound.ts', 'API policies on gateway services: none, API key, Basic, JWT, mutual TLS, WS-Security UsernameToken; refusals become HTTP errors or SOAP faults.'],
      ['server/src/security/outbound.ts', 'Outbound security profiles for HTTP and SOAP calls: Basic, bearer, API key, OAuth client credentials, client certificates and TLS options.'],
      ['server/src/security/hmac.ts', 'HMAC request signing for incoming and outgoing requests (timestamp and body, or method, path, timestamp and body, or the body only; several secrets while one is replaced; replays refused through a table every engine shares) and OAuth 2.0 token introspection with answers kept until the token expires.'],
      ['server/src/security/validate.ts', 'Checks on what callers send to REST and SOAP services before a run starts: threat protection from the API security policy (nesting depth on the raw text, fields, list items, text length, body size, no DOCTYPE) and validation against the service schema (JSON Schema with ajv; XSD elements and JSON samples as schema trees).'],
      ['server/src/security/wssin.ts', 'WS-Security on the raw SOAP XML: incoming X.509 signatures (certificate trusted, Body and Timestamp signed, one Body only), signed SAML assertions (issuer, audience, validity), timestamps, and XML decryption (AES-GCM or AES-CBC, keys by RSA-OAEP; RSA 1.5 refused). The verified caller certificate may become the recipient of an encrypted service reply.'],
      ['server/src/security/wss.ts', 'WS-Security headers for SOAP calls: UsernameToken, timestamps, X.509 signatures, SAML assertions and body encryption; UsernameToken checks on incoming requests. The X.509 signature is placed in wsse:Security by xml-crypto while signing (no deprecated calls).'],
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
      ['server/src/palettes/index.ts', 'Palette order (with Azure Data Factory &amp; Databricks, Apps and social, Scripts with Python) and the list of all activities registered with the engine; AI steps get a 10-minute time limit.'],
      ['server/src/palettes/common.ts', 'Field builders (<code>F</code>, <code>when</code>) and write options shared by file-like activities.'],
      ['server/src/palettes/core.ts', 'Triggers (Start, Timer, REST service, SOAP service), flow control (If, Switch, Router, For each, Merge, Wait, Approval, Set variable, Throw, End with stop options), data (Mapper, JSON, XML, CSV, filter, sort, aggregate, validate) and Log.'],
      ['server/src/palettes/process.ts', 'Call Sutra and Return, Error handler, No operation, channels (send and trigger) and Counter.'],
      ['server/src/palettes/transform.ts', 'JSONata transform.'],
      ['server/src/palettes/http.ts', 'HTTP request (with connection, security profile and circuit breaker) and HTTP response.'],
      ['server/src/palettes/soap.ts', 'SOAP call from a WSDL (operation picker) and SOAP reply.'],
      ['server/src/palettes/file.ts', 'File trigger, read, list, write and move, confined to the configured folder. Write and Move always return file details. Read and List can stream big CSV and line files in batches on a batch port.'],
      ['server/src/palettes/fileformat.ts', 'Encodings and formats for file content: text, base64, CSV, lines, JSON, XML, with schema-typed columns. A CSV parser that takes text in pieces, and the streaming reader that hands rows over in batches with back pressure.'],
      ['server/src/palettes/code.ts', 'JavaScript code in a sandboxed worker (no host objects, time and memory limits) and HTML templates.'],
      ['server/src/palettes/scripts.ts', 'PowerShell, shell scripts, Python (code or a .py file, arguments, parameters, virtual environment, printed JSON as result, design checks for Python, syntax, files and packages) and programs, with output and errors captured; values arrive as environment variables and JSON files, never inside the script text. Off until allowed.'],
      ['server/src/palettes/release.ts', 'Build package, Check package, Deploy package and Roll back, on this server or a remote engine. Off until allowed.'],
      ['server/src/palettes/ai.ts', 'AI prompt, classify, router, extract, summarize, translate, sentiment and the Ollama activity (all endpoints). JSON answers are read leniently with one stricter retry.'],
      ['server/src/palettes/mcp.ts', 'AI tool trigger (describes the tool for agents and MCP clients) and Reply to AI.'],
      ['server/src/palettes/agent.ts', 'AI agent palette: AI agent, Ask a person, Hand off to agent, Load / Save / Clear memory, Read document text, Add to knowledge (skip unchanged), Search / Ask knowledge, Remove knowledge (a source, keep only listed sources, everything, rebuild vectors), AI embed, Call MCP tool, Agent channel, Agent reply, AI guard.'],
    ],
  },
  {
    id: 'connectors', title: 'Connectors', intro: 'Activities for outside systems and their connection kinds.',
    files: [
      ['server/src/connectors/kinds.ts', 'Connection kinds for email, databases, service bus, Firebase, SFTP and FTP, and OAuth apps (with the scopes each service needs and an optional refresh token secret).'],
      ['server/src/connectors/remote.ts', 'SFTP / FTP palette: Remote file trigger, list, read, write and move / copy / delete over SFTP (ssh2-sftp-client, host key fingerprint check) or FTP / FTPS (basic-ftp). Every activity selects a shared connector; host, port, user, base folder, limits and secret names resolve Project variables and deployment overrides at runtime. Paths are fenced into the base folder; connections have time limits, retry policy and SFTP keep-alive.'],
      ['server/src/connectors/db.ts', 'DB Ops for PostgreSQL, MySQL, SQL Server, Oracle and SQLite: query, update, stored procedure, SQL script and transaction, with <code>:name</code> parameters always bound (no SQL injection), and connection pools. <code>inlineRunData</code> writes Project and Engine properties into SQL text and turns every other <code>{{...}}</code> reference (run input, trigger data, earlier outputs) into a bound parameter, quoted literals as one text value; Databricks SQL uses it too. The shared named-parameter parser also performs design and deployment checks: every placeholder needs one case-sensitive Parameters row; missing, mismatched, duplicate and unnamed rows are errors, while an unused row is a warning. Quotes, comments and PostgreSQL <code>::</code> casts are excluded by the same parser used at runtime. Designer previews accept read-only SELECT / WITH SQL, reject data-changing CTEs, and apply the database or Databricks ten-row limit; normal run SQL is never rewritten with that preview limit.'],
      ['server/src/connectors/bus.ts', 'Service Bus for Kafka, RabbitMQ and AMQP 1.0 brokers: strict TLS with system or private CA trust, SASL where applicable, optional mutual TLS with vault-held private keys, publish, the Queue / topic trigger and explicit confirmation. Client acknowledgement waits for run success; the explicit handle is registered under the reserved run id before execution, so even a one-step Confirm is safe. A durable Kafka-offset or AMQP-message-id guard binds redelivery to its reserved run across leader changes; a copy delivered while the prior run is active or waiting is held unacknowledged (one extra prefetch or credit slot) and settled when that run ends, while Kafka pauses the partition. Kafka listeners report ready only after group join and the first completed fetch/offset round trip. ActiveMQ connections use unique role-suffixed container ids and normalize JMS destinations; RabbitMQ in-place requeues are counted even though the broker does not add x-death.'],
      ['server/src/connectors/message-body.ts', 'Shared JSON, XML, text, map and binary codecs for native broker publishers and receivers. XML retains exact text and rejects malformed markup and DTD/entities. Receive decoding captures a bodyError for the normal engine failure/acknowledgement policy instead of throwing outside the broker callback.'],
      ['server/src/connectors/email.ts', 'Send email (SMTP) and the mailbox trigger (IMAP).'],
      ['server/src/connectors/firebase.ts', 'Firestore, Realtime Database and Cloud Messaging with a service account.'],
      ['server/src/connectors/oauth.ts', 'OAuth 2.0 connections (Google, Microsoft, Dropbox, Facebook, Twitch, custom): authorization-code sign-in, tokens encrypted and refreshed, a refresh token secret for servers without the studio (set by a pipeline), Twitch client id on every call, and streamed requests for large uploads and downloads.'],
      ['server/src/connectors/microsoft.ts', 'SharePoint document libraries and OneDrive through Microsoft Graph: list, read (as document text), search, upload, and a polling trigger for added, changed and removed files.'],
      ['server/src/connectors/saas.ts', 'Google Sheets; Google Drive and Docs (list, upload, download or export, saving large files straight to a server file) and the Drive trigger; Dropbox; YouTube (videos, playlists, comments, channel and video statistics, Analytics reports, resumable streamed upload from a server file, update, thumbnail); Facebook Pages; Twitch (users, live status, channel, followers, videos, clips, schedule, update channel, clip, chat) and the Twitch live trigger; any REST API of a connected account.'],
    ],
  },
  {
    id: 'ai', title: 'AI engines', intro: 'One AI provider connection, many engines.',
    files: [
      ['server/src/ai/engines.ts', 'The list of AI engines. Has no imports so any module can load it first.'],
      ['server/src/ai/agent.ts', 'The AI agent loop: one JSON step per model call (tool, answer or ask), tool Sutras run as called Sutras with the step resumed afterwards, progress saved per step in ai_agent_state, limits, small-model tolerance and a last plain answer at the step limit.'],
      ['server/src/ai/memory.ts', 'AI memory stores (built-in, a database table, a folder): turns with token estimates, fitting the context window, the running summary, encryption, retention, and the first-in-first-out queue per session.'],
      ['server/src/ai/knowledge.ts', 'Knowledge bases: chunking, vectors from a model or built-in word vectors, stores (built-in, folder, pgvector, Qdrant, Chroma, Pinecone), search by meaning and shared words with folder and detail filters, add (skipping unchanged text by a content hash), replace, remove, keep only listed sources, list sources, rebuild.'],
      ['server/src/ai/documents.ts', 'Document text: a small zip reader for Word, PowerPoint, Excel and OpenDocument, PDF through unpdf, and HTML to text.'],
      ['server/src/ai/mcpClient.ts', 'MCP client over streamable HTTP (JSON or event-stream answers, session header) or a command on standard input and output: list and call tools.'],
      ['server/src/ai/guard.ts', 'AI guard rules: personal data patterns (with a card number checksum), hidden instruction phrases, blocked topics, length and JSON shape, and an optional model check.'],
      ['server/src/ai/providers.ts', 'Calls to the Claude, Gemini and OpenAI APIs, OpenAI-compatible servers (LM Studio, Hugging Face, local TGI), Ollama, and the Claude, Gemini and Codex command-line tools. Model lists, Ollama pull and import (gguf, Modelfile, safetensors, Ollama folder). Every call returns provider, engine, model, tokens and time.'],
    ],
  },
  {
    id: 'web', title: 'Studio (web/src)', intro: 'The browser application: React with React Flow, built by Vite into dist/web and served by the admin API.',
    files: [
      ['web/index.html', 'Page shell for the studio.'],
      ['web/vite.config.ts', 'Vite build of three pages (designer, Admin Console and Approval Center) and the development proxy to the admin API.'],
      ['web/src/main.tsx', 'Mounts the React application.'],
      ['web/src/App.tsx', 'Top bar, sign-in, and the switch between Designer, Runs, Resources and Server.'],
      ['web/src/NewProject.tsx', 'New project: empty, with chosen samples, from chosen Sutras of a release zip or package file (with its files), from a sample project, or a copy of chosen Sutras of a project; the searchable pick list also used for samples in New Sutra.'],
      ['web/src/Auth.tsx', 'Sign-in (password or single sign-on), first administrator and password change, shared by the designer, the Admin Console and the Approval Center.'],
      ['web/src/api.ts', 'Thin client for the admin API; changing calls carry the X-Sutra header.'],
      ['web/src/types.ts', 'Studio-side types of Sutras, activities, fields and runs.'],
      ['web/src/ui.tsx', 'Toasts and the catalog (current project, its connections and schemas, secret names).'],
      ['web/src/ConfirmDelete.tsx', 'The delete dialog of the designer: what goes, what still uses it, and Delete enabled only once delete is typed.'],
      ['web/src/Designer.tsx', 'The canvas: palette, drag and drop, connections with labels, step descriptions as tooltips (marked on the step), undo and redo, Delete-key handling, test and debug runs, sample picker.'],
      ['web/src/Inspector.tsx', 'Right panel for a step or a connection: General (with the step description), Input, Output and Settings tabs, loop settings, connection name and condition; the Sutra\'s General tab with its documentation (HTML and Markdown) and the count of steps without a description.'],
      ['web/src/Fields.tsx', 'Field editors (text, select, secret, resource, schema, Sutra picker) that accept drops from the data tree.'],
      ['web/src/Mapper.tsx', 'Input mapping: Process Data on the left, Activity Input on the right with lines between them, the formula editor with function browser, preview, For-Each, If and Choose.'],
      ['web/src/MappingTools.tsx', 'Input-tab schema selection/create/edit, typed manual-field options, explicit delete confirmation and bounded whole-result preview. Shared schema edits list affected Sutras.'],
      ['web/src/sample-import.ts', 'Sample-import completion barrier: refresh flows and the shared project catalog before selecting a created flow, so new schemas/resources/properties are immediately available.'],
      ['web/src/XmlOutput.tsx', 'Bounded, read-only XML output/preview tree: nested elements, attributes, text and repeated siblings.'],
      ['web/src/mapping-fields.ts', 'Immutable add, rename and subtree deletion operations preserving formulas, typed definitions and repeating-path markers. Designer history owns undo/redo.'],
      ['web/src/mapping-sources.ts', 'Names source activities with their palette types, distinguishes current-input candidates from named outputs and labels other branches without implying synchronization. Excludes downstream outputs.'],
      ['web/src/mapping-values.ts', 'Infers observed runtime fields independently of design contracts and summarizes repeated scalar values without hiding all but the first item. Shared activity-output rendering uses emitted data.'],
      ['web/src/SchemaImpact.tsx', 'Shared read-only schema impact report in both schema editors. Discards stale asynchronous results when the proposed definition changes; lists activity names/types and deployed-use cautions.'],
      ['web/src/test-session.ts', 'Confirms engine cancellation before discarding test preview state. Failed or unconfirmed stop requests retain controls; terminal completion races and repeated cancellation are safe.'],
      ['web/src/mapping-tools.css', 'Layout for Input-tab schemas, typed target controls and preview.'],
      ['web/src/DataTree.tsx', 'The data tree on the mapper\'s source side, from the last run or from output shapes.'],
      ['web/src/Project.tsx', 'Project panel: Sutras, Resources with the + menu and Test connection, schemas and service descriptors, each as a folder tree (drag and drop; the ⋯ menu or a right-click renames, moves and deletes items and folders), variables with the missing-variable warning, AI models, project log, releases (release zip or package download, deploying zips with their config and files, documentation, history).'],
      ['web/src/Git.tsx', 'The Git tab: initialize or clone, accounts, changes by item with diffs (steps added, removed, changed), commit, push, pull, sync, branches, conflicts, graph, trust.'],
      ['web/src/vars.ts', 'Which project variables a step or connection reads that the project does not define (the same rule as the server).'],
      ['web/src/Resources.tsx', 'Shared resources and the secret vault.'],
      ['web/src/Runs.tsx', 'Run history with steps, input and output, approvals, cancel and resubmit, and the engine that ran each run.'],
      ['web/src/Server.tsx', 'Read-only Services page for workflow authors: published REST, SOAP and MCP addresses, listener health and current run counts.'],
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
      ['web/admin/Console.tsx', 'Sign-in (or, on a headless engine without users, how to add the first administrator), password change, permission-based navigation, and the pages under Operate, Alerts, Gateway, Access, Records and Server.'],
      ['web/admin/Server.tsx', 'Server-only controls: Engine properties, script permission and Python interpreter, release-activity permission, gateway listeners, TLS certificates, ACME and mutual TLS. Kept out of the Designer so operational changes require the Server permission.'],
      ['web/admin/shared.tsx', 'What the signed-in account may do, loading and refresh helpers, state labels, in-page confirmation, password generator.'],
      ['web/admin/Overview.tsx', 'Tiles for engines, deployed Sutras, runs of the last day, approvals, work queue and gateway; recent failures with Resubmit.'],
      ['web/admin/Apps.tsx', 'Deployed projects and Sutras: start and stop, runs with step results, resubmit and cancel, deploy an earlier version, package history and roll back. Also the side panel used by other pages.'],
      ['web/admin/log.tsx', 'Every console action goes through act(): recorded with its output for the Console panel, and turned into the same action as a sutra command and an HTTP call for Windows PowerShell and Linux shells. Passwords and new tokens never appear.'],
      ['web/admin/Tuning.tsx', 'Tuning forms for a Sutra and for the engines, with the defaults shown and the change confirmed with its command.'],
      ['web/admin/Gateway.tsx', 'Gateway pages: Traffic (chart, percentiles, busiest and slowest services, apps, request log), Apps and keys, Plans, Firewall, APIs with OpenAPI and gateway options.'],
      ['web/admin/Alerts.tsx', 'Alerts pages: open alerts and history with acknowledge and resolve, alert rules with Check now, channels with Send a test.'],
      ['web/admin/Chart.tsx', 'Stacked bar chart over time drawn to one scale from the theme colours (Overview runs and gateway traffic).'],
      ['web/admin/Approvals.tsx', 'What waits for a person and for whom (roles, accounts, progress, due time), with a button to open the Approval Center.'],
      ['web/admin/Engines.tsx', 'Engines of the cluster: alive, leader, load, heartbeat; drain and stop one; delete old runs now.'],
      ['web/admin/Sso.tsx', 'Single sign-on settings: the identity provider, client, claims, groups to roles, creating and linking accounts; shows the redirect address to register.'],
      ['web/admin/People.tsx', 'Users and system accounts: add, roles per project, disable, unlock, passwords, sign out everywhere, delete; API tokens shown once.'],
      ['web/admin/Roles.tsx', 'Permission matrix of all roles; custom roles.'],
      ['web/admin/Database.tsx', 'Database page: the database in use, the PostgreSQL connection with Test connection, Migrate now, and the progress through the restart.'],
      ['web/admin/Memory.tsx', 'Memory tables: source/query and interval/cron configuration, cluster and per-project row/MB quotas, usage, next refresh, every table and its records with approximate size, hot reload, clear, and cached values changed by hand.'],
      ['web/admin/Releases.tsx', 'Releases: upload a release zip, see its check (Sutras, secrets, source, config), deploy it; the package history of each project with rollback.'],
      ['web/admin/Audit.tsx', 'Audit log with filters, plain-word actions, details and CSV export.'],
      ['web/admin/console.css', 'Console layout on the studio colour tokens, light and dark, one column on phones.'],
    ],
  },
  {
    id: 'approvalcenter', title: 'Approval Center (web/approvals)', intro: 'The third page of the web build, served at <code>/approvals</code> on every server, headless engines included: the approvals and questions of running Sutras for business people, nothing else. It signs in like the other pages (password or single sign-on), uses the approvals API (<code>/api/approvals</code>, decided per item by approvals.ts), and is laid out for phones first.',
    files: [
      ['web/approvals.html', 'The Approval Center page shell.'],
      ['web/approvals/Center.tsx', 'The Approval Center page (/approvals) for business people: sign-in, Waiting for me, All waiting, Decided; details, votes, due time, approve or reject with a comment, answers to questions; works on a phone.'],
      ['web/approvals/center.css', 'Styles of the Approval Center: one column, readable on a phone, light and dark.'],
      ['web/approvals/main.tsx', 'Entry of the Approval Center page.'],
    ],
  },
  {
    id: 'tools', title: 'Documentation tools', intro: 'Pages built from the code, so they stay accurate.',
    files: [
      ['tools/migrate-to-postgres.mjs', 'The SQLite to PostgreSQL move for Windows (.cmd) and Linux (.sh): stops SutraFlow with the launcher, copies and counts every table (sutra db migrate), switches sutraflow.env, starts SutraFlow, checks it, and puts SQLite back on any failure.'],
      ['tools/migrate-to-postgres.cmd', 'Windows wrapper of migrate-to-postgres.mjs: finds Node.js from sutraflow.env and passes the settings file.'],
      ['tools/migrate-to-postgres.sh', 'Linux and macOS wrapper of migrate-to-postgres.mjs: finds Node.js from sutraflow.env and passes the settings file.'],
      ['tools/add-headers.mjs', 'Puts the copyright and licence header (developer, website, years, file version, AGPL-3.0-only) on every source file that lacks it; with --check, lists files without it (a test runs this). Each file keeps its own version.'],
      ['tools/build-release.mjs', 'Builds the release archives: sutraflow-<version>-windows.zip and -linux.tar.gz (launcher and shell scripts executable) with SHA-256 files, holding the built server, launcher, docs, samples, deployment templates, runtime tools and licences; with --offline also an archive with the runtime packages for the system it runs on.'],
      ['.github/workflows/release.yml', 'GitHub release workflow: on a v* tag, tests, builds the archives on Windows and Linux (with offline archives), and attaches them with RELEASE-NOTES.md to a GitHub Release.'],
      ['tools/soak.mjs', 'Soak test: hours of mixed load on a cluster (every starter that runs on one machine, files and documents of 10 to 60 MB, AI on a local Ollama), an engine killed and a database cut on the way, unattended with retries; writes samples, events and a Markdown and HTML report.'],
      ['tools/loadtest.mjs', 'Load test: starts a studio and engines on their own temporary database, runs a benchmark Sutra (durable or in memory, small or big outputs), and reports steps and runs per second, queue wait and step time percentiles, database lock waits and transactions, CPU and memory; can kill an engine to check recovery, limit cores and memory, or soak. Results in docs/benchmarks.'],
      ['tools/bigfiletest.mjs', 'Big file test: one engine with a small memory limit streams a generated CSV file of any size through a Sutra (Read file, Stream in batches) and reports the time and the peak memory of the process.'],
      ['tools/build-sample-projects.ts', 'Builds the sample project zips in samples/ (<code>npm run samples</code>): whole projects as release zips with their files, listed in samples/index.json for New project.'],
      ['tools/build-user-guide.ts', 'Builds docs/sutraflow-user-guide.html (<code>npm run guide</code>): chapters, every activity with its settings table, connection types, functions, pipes and samples, read from the server code.'],
      ['tools/guide/tables.ts', 'The tables of SutraFlow itself, for the guide and this page: what each holds, groups, what is encrypted or grows, and the columns read from db.ts (the schema and the columns later versions add).'],
      ['tools/guide/chapters.ts', 'User guide chapters.'],
      ['tools/guide/activities.ts', 'Advice text for every activity in the user guide.'],
      ['tools/guide/benchmarks.ts', 'Guide tables made from measurements: the machine profiles of sizing.ts and the load test results in docs/benchmarks.'],
      ['tools/guide/logo.ts', 'The SutraFlow mark used by both pages.'],
      ['tools/capture-guide-shots.mjs', 'Takes the user guide screenshots with headless Edge while the server runs (<code>npm run guide:shots</code>).'],
      ['tools/check-vendor.mjs', 'Vendor dependency gate: verifies the reviewed source-tree hashes, package and lockfile links, licences, consumers, focused tests and runtime packaging scope; in online mode it also fails when npm latest or tarball integrity differs.'],
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
      ['.github/workflows/vendor.yml', 'Weekly and manual online check for newer upstream releases of maintained vendor dependencies.'],
      ['vendor/vendor-lock.json', 'Reviewed vendor provenance: upstream npm version and integrity, patched local version and tree hash, patch reasons, consumers, focused tests and release scope.'],
      ['vendor/README.md', 'The manual compatibility-review and update procedure for maintained vendor packages.'],
      ['docker-compose.yml', 'One container: studio, engine and gateway.'],
      ['docker-compose.cluster.yml', 'PostgreSQL, a studio without workers and two headless engines sharing the database.'],
      ['bin/sutraflow.mjs', 'The sutraflow launcher, the one place for every command on Windows and Linux: setup, start and stop (studio or engine, background or foreground, graceful drain), restart, status, logs, open, cli (the sutra command with the local admin token), db, service (systemd unit or Windows task), and docker and docker cluster (compose, with the token and master key made once into .env). Used by tools/migrate-to-postgres to stop and start SutraFlow.'],
      ['bin/sutraflow', 'Linux and macOS entry of the launcher; takes Node.js from SUTRA_NODE or sutraflow.env.'],
      ['bin/sutraflow.cmd', 'Windows entry of the launcher; takes Node.js from SUTRA_NODE or sutraflow.env.'],
      ['sutraflow.env.example', 'Launcher settings: data folder, ports of the studio and the engine, database, Node.js path; copied to sutraflow.env on first use.'],
      ['deploy/laragon/sutraflow.env', 'Laragon settings for the launcher: ports 4810 and 4811, data in C:/laragon/data/sutraflow, PostgreSQL, Node.js path.'],
      ['deploy/laragon/README.txt', 'Laragon: install steps and the launcher commands.'],
      ['deploy/laragon/01-sutra.conf', 'Laragon Apache site: forwards http://sutra.test to the Node.js server.'],
      ['deploy/laragon/.htaccess', 'Denies direct access to the SutraFlow folder under the Laragon www folder.'],
      ['deploy/README.md', 'The deploy folder: drop .sutra packages here for engines that deploy them at start.'],
      ['docs/deployment.md', 'Operations guide: packages, CLI, headless engines, Docker, clusters, monitoring, retention, settings.'],
      ['docs/architecture.md', 'Short text notes on the architecture (this page is the full version).'],
      ['docs/sutraflow-user-guide.html', 'The generated user guide, served at /guide.'],
      ['README.md', 'Project introduction and quick start.'],
      ['RELEASE-NOTES.md', 'Release notes of the current version: what is new, requirements, install steps for Windows and Linux, upgrade steps, known limitations. The release archives require it.'],
    ],
  },
  {
    id: 'tests', title: 'Tests (test/)', intro: 'Node\'s test runner with tsx. <code>npm test</code> compiles the server first, then runs every suite; the PostgreSQL suite runs the in-process suites again on PGlite with shifted ports.',
    files: [
      ['test/helpers.ts', 'Test environment per suite: temporary data folder, ports (with <code>SUTRA_TEST_PORT_OFFSET</code>), node and edge builders, a capture server.'],
      ['test/pem-fixtures.ts', 'Broker-test PEM input adapter supporting process-only certificate/key values and existing file-path fixtures without logging material. This is test infrastructure, not a production credential store.'],
      ['test/tsconfig.json', 'TypeScript settings for the tests (strict), so <code>npm run typecheck</code> checks them with the server and studio.'],
      ['test/proc.ts', 'Starts real server processes for multi-process tests and waits for their endpoints.'],
      ['test/mcpstdio.mjs', 'A small MCP server on standard input and output (one tool, add), for the MCP client tests.'],
      ['test/sftpserver.ts', 'A small SFTP server over a local folder (ssh2), with password and key sign-in and an optional slow read, for the SFTP tests.'],
      ['test/fixtures/ActiveMqOpenWireProbe.java', 'Test-only Java JMS client: sends and receives through ActiveMQ OpenWire so the real-broker matrix proves that SutraFlow AMQP 1.0 messages interoperate at the body, header and property level. It is source-file launched from the installed ActiveMQ client jars and is never packaged with SutraFlow.'],
      ['test/fixtures/tls-tcp-proxy.mjs', 'Test-only mutual-TLS TCP endpoint: validates an OpenSSL-generated client certificate and forwards the unchanged protocol to a local RabbitMQ or ActiveMQ broker, proving private-CA and client-certificate connector paths without changing the installed brokers. It is never packaged.'],
      ['test/fixtures/broker-tls-proxy.mjs', 'Repeatable local ActiveMQ/RabbitMQ mTLS matrix runner: generates short-lived test certificates, starts strict TLS transport proxies, executes both real broker suites and cleans up its generated fixtures. Native broker keystores are not changed or certified.'],
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
const tablesFromSchema = () => schemaTables(root);

/** The commands of the sutra tool, from its own help, so this page cannot fall behind it. */
function cliCommands() {
  const r = spawnSync(process.execPath, ['--import', 'tsx', path.join(root, 'server', 'src', 'cli.ts'), 'help'], { cwd: root, encoding: 'utf8' });
  const names = [...new Set(String(r.stdout || '').split(/\r?\n/).map(l => /^ {2}([a-z]+)\s/.exec(l)?.[1]).filter(Boolean))] as string[];
  return names.map(n => `<code>${n}</code>`).join(', ');
}

function apiRoutes() {
  const routes = [...read('server/src/api.ts').matchAll(/app\.(get|post|put|delete|patch)\('([^']+)'/g)].map(m => ({ method: m[1].toUpperCase(), path: m[2] }));
  const area = (p: string) => p.startsWith('/api/') ? p.split('/')[2] : 'service';
  const groups = new Map<string, typeof routes>();
  for (const r of routes) groups.set(area(r.path), [...(groups.get(area(r.path)) || []), r]);
  return { count: routes.length, html: [...groups].map(([g, rs]) => `<tr><td><strong>${esc(g)}</strong></td><td>${rs.map(r => `<code>${r.method} ${esc(r.path)}</code>`).join(' ')}</td></tr>`).join('') };
}

const SETTINGS: [string, string, string][] = [
  ['SUTRA_ENVIRONMENT', 'development (studio), production (engine)', '<code>development</code>, <code>test</code> or <code>production</code>: shown on log lines and audit entries; production refuses designer deploys and limits who may clear logs.'],
  ['SUTRA_DB_PASSWORD', '(none)', 'The PostgreSQL password, kept apart from <code>SUTRA_DB</code> so the address can be shown and logged (written by the move to PostgreSQL).'],
  ['SUTRA_PYTHON', '(found)', 'The Python that runs Python steps; else the setting in Admin Console &rarr; Server &rarr; Runtime, then <code>py</code>, <code>python3</code>, <code>python</code>.'],
  ['SUTRA_GIT', '(git if installed)', '<code>system</code> or <code>builtin</code>: the Git used by the Git tab.'],
  ['SUTRA_GIT_ALLOW_FILE', '(off)', '<code>1</code> allows <code>file://</code> repositories (tests, local mirrors).'],
  ['SUTRA_GIT_TOKEN, SUTRA_GIT_LOGIN', '(none)', 'CLI only: the token (and login) for <code>sutra package --from-git</code> of a private repository.'],
  ['SUTRA_NODE', 'node', 'Launcher and scripts: the Node.js program to use.'],
  ['SUTRAFLOW_ENV', 'sutraflow.env', 'Launcher and scripts: another settings file.'],
  ['STUDIO_PORT, STUDIO_GATEWAY_HTTP, STUDIO_GATEWAY_HTTPS, ENGINE_PORT, ENGINE_GATEWAY_HTTP, ENGINE_GATEWAY_HTTPS', '4800, 8080, 8443, 4801, 9080, 9443', 'Launcher (sutraflow.env): the ports of the studio and of a headless engine beside it.'],
  ['SUTRA_MODE', 'studio', '<code>studio</code>: studio, engine and gateway in one process. <code>engine</code>: headless, no studio and only the automation API with the admin token.'],
  ['SUTRA_DATA_DIR', './data', 'SQLite database, vault key file, log files and deployment configs.'],
  ['SUTRA_DB', '(SQLite)', '<code>postgres://user:pass@host/db</code> for clusters on several machines; <code>pglite:memory</code> in tests.'],
  ['SUTRA_PG_POOL', 'by workers', 'Connections of the engine\'s PostgreSQL pool (half of SUTRA_WORKERS, 4 to 20). Every engine opens up to this many plus one: keep the total under PostgreSQL\'s max_connections.'],
  ['SUTRA_COUNT_SYNC_SQL', '(none)', 'Diagnostics: a file where the engine writes, every 3 s, the statements it sent through the synchronous PostgreSQL connection and how often (to find what still waits for the database).'],
  ['SUTRA_CAN_LEAD', '1', '0: this engine never becomes the cluster leader (timers, listeners, recovery); for machines that cannot reach the folders that folder triggers watch.'],
  ['SUTRA_PUBLIC_URL', '(none)', 'The studio address as people reach it behind a proxy, for the single sign-on redirect address. Empty: taken from each request.'],
  ['SUTRA_PG_ASYNC', '1', '0 runs the engine through the synchronous PostgreSQL connection as before 1.7.6 (a fallback; slower).'],
  ['SUTRA_PG_NOTIFY', '1', 'PostgreSQL LISTEN/NOTIFY wakes idle engines for committed queue work. 0 disables the hint; durable polling always remains enabled.'],
  ['SUTRA_MASTER_KEY', 'key file', 'Vault key, base64 of 32 bytes. Must be the same on every engine of a cluster.'],
  ['SUTRA_ADMIN_TOKEN', '(none)', 'Bearer token for the CLI, CI and release activities on remote engines. Acts as an administrator.'],
  ['SUTRA_DEPLOY_DIR', '(none)', 'Folder of .sutra packages deployed at start (containers, headless engines).'],
  ['SUTRA_CONFIG_DIR', 'data/config', 'Deployment config files loaded at start.'],
  ['SUTRA_ENGINE_ID', 'host-pid', 'This engine\'s name in the cluster and on metrics.'],
  ['SUTRA_WORKERS', 'by machine', 'Steps run at the same time (4 on 1 vCPU / 1 GB up to 32 on 8 cores, see sizing.ts). 0 = serve only (a studio in a cluster).'],
  ['SUTRA_MEMORY_WORKERS', '0', 'Steps at once for Sutras that run in memory; 0 = the same as SUTRA_WORKERS.'],
  ['SUTRA_POLL_MS', 'by machine', 'How often an idle engine looks for due steps (500 ms on the smallest machines, 200 to 250 ms otherwise).'],
  ['SUTRA_SETTINGS_REFRESH_MS', 'by machine', 'How long an engine keeps Project and Engine properties before reading them again; 0 reads them on every step.'],
  ['SUTRA_MAX_STEPS', '10000', 'Safety limit of steps per run.'],
  ['SUTRA_REPLY_TIMEOUT_MS', '60000', 'How long REST and SOAP callers wait for a reply step.'],
  ['SUTRA_MEMORY_SYNC_MS', '1000', 'How often an engine checks the database copy of memory tables for changes and reloads asked for elsewhere.'],
  ['SUTRA_KEEPALIVE_MS', '65000', 'How long the admin and gateway servers keep an idle connection; longer than the idle time of a load balancer in front.'],
  ['SUTRA_HEARTBEAT_MS', '5000', 'Heartbeat interval; an engine silent for three beats is dead.'],
  ['SUTRA_DRAIN_MS', '30000', 'Time running steps get to finish on a graceful stop.'],
  ['SUTRA_RUN_RETENTION_DAYS', '30', 'Finished runs older than this are deleted; 0 keeps them.'],
  ['SUTRA_AUDIT_RETENTION_DAYS', '365', 'Audit entries older than this are deleted; 0 keeps them.'],
  ['SUTRA_TRACE_SAMPLING', '1', 'Share of runs traced, 0 to 1. Changed live by tuning.'],
  ['SUTRA_LOG_FORMAT', 'text', '<code>json</code>: engine events as JSON lines on standard output.'],
  ['SUTRA_METRICS_TOKEN', '(none)', 'When set, <code>/metrics</code> needs this Bearer token.'],
  ['OTEL_EXPORTER_OTLP_ENDPOINT', '(none)', 'OpenTelemetry collector address (OTLP/HTTP).'],
  ['OTEL_SERVICE_NAME', 'sutraflow', 'Service name on traces.'],
  ['SUTRA_ADMIN_HOST, SUTRA_ADMIN_PORT', '127.0.0.1, 4800', 'Studio and admin API address. Containers use 0.0.0.0.'],
  ['SUTRA_GATEWAY_HTTP_PORT, SUTRA_GATEWAY_HTTPS_PORT', '8080, 8443', 'Gateway ports until changed in Admin Console → Server → Gateway & TLS.'],
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
// Every setting the code reads is listed under Settings.
{
  const listed = new Set(SETTINGS.flatMap(([k]) => k.split(/,\s*/)));
  const sources = [...walk('server/src'), 'bin/sutraflow.mjs', 'tools/migrate-to-postgres.mjs'].filter(f => /\.(ts|mjs)$/.test(f));
  const used = new Set(sources.flatMap(f => [...read(f).matchAll(/process\.env\.(SUTRA_[A-Z_]+)/g)].map(m => m[1])));
  for (const k of used) if (!listed.has(k)) problems.push(`setting ${k} is read by the code but not listed under Settings`);
}

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
  ['Project properties', '<code>{{gv.NAME}}</code>: administrator-managed values per project, overridable per environment by the deployment config and read-only to Sutras.'],
  ['Sutra variables', '<code>{{vars.name}}</code>: values within one run.'],
  ['Engine properties', 'Server-level settings readable by every Sutra and changeable only by administrators.'],
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
<li><strong>Engine</strong> runs steps in worker slots (<code>SUTRA_WORKERS</code>, set by the machine size by default). Slots take tasks from the database. Sutras tuned to run <em>in memory</em> go to a second engine in the same process whose runs live in a private in-memory database and are written to the database in one transaction when they end.</li>
<li><strong>Timers and listeners</strong> start runs from schedules, folders, mailboxes, queues and Drive. In a cluster they run on the leader only, so nothing starts twice.</li>
<li><strong>Cluster beat</strong> writes this engine\'s heartbeat, holds or watches the leader lease, recovers dead engines' steps, and reloads routes after deploys elsewhere.</li>
<li><strong>Memory tables</strong> keep small reference data (rates, codes, routing, reusable values) in each engine: an LRU JavaScript <code>Map</code> per table inside the Node.js process. Each table, project and engine has row and byte quotas. Refresh creates a replacement off to the side and swaps it only after its query, keys and quotas pass, preserving the last good copy on failure. Failsafe tables schedule on the leader and use <code>mem_rows</code>/<code>mem_meta</code> versioning; memory-only tables schedule on every engine.</li>
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

sec('engine-inside', 'Inside the engine', `
${DIAGRAMS.engine}
<p>The 2.0 engine is split by responsibility so a change to queueing, graph routing, an activity, an operator command or a database transition can be reviewed without reading the whole runner. <code>engine.ts</code> is the public façade and composition root; it does not expose the internal services to callers.</p>
${tw(['File', 'Responsibility', 'Does not decide'], [
  ['<code>engine.ts</code>', 'Registers activities, starts and drains the durable and in-memory engines, starts runs, composes the services, and orchestrates complete and fail.', 'How a task is claimed, how graph tokens move, or how an activity implementation runs.'],
  ['<code>scheduler.ts</code>', 'Polls and wakes the queue, atomically claims due tasks by priority in batches, observes the worker limit, and dispatches each claim.', 'Business routing or step results.'],
  ['<code>executor.ts</code>', 'Builds the mapping context, resolves variables and secrets, enforces abort and time limits, executes loops and streamed emits, and hands the result to complete or fail.', 'Durable transition SQL.'],
  ['<code>transitions.ts</code>', 'Shared atomic helpers for fenced updates, state and log changes, run/output commits, cancellation of open tasks, and routing scope.', 'Which activity to execute.'],
  ['<code>run-store.ts</code>', 'Loads runs and separately stored outputs, owns the claim fence, derives final status atomically, and persists ended in-memory runs. An old owner receives <code>StaleStep</code> and cannot change the row.', 'Scheduling or graph-routing policy.'],
  ['<code>router.ts</code>', 'Evaluates connection conditions, sends live and skip tokens, joins branches and eliminates dead paths before scheduling the next activity.', 'Activity execution or durable fencing primitives.'],
  ['<code>waits.ts</code>', 'Keeps process-local reply and finish callbacks, notifies live views, and checks the durable run row when another engine completes it.', 'The durable status itself.'],
  ['<code>operator.ts</code>', 'Implements cancel, approval decisions, resubmit, debug controls, queued-run promotion and run-time limits.', 'Normal activity execution.'],
  ['<code>state.ts</code>', 'Pure run-state and output helpers: initial variables, output parsing, compact streamed output and API/history views.', 'I/O or database ownership.'],
  ['<code>types.ts</code>', 'Contracts shared by the engine, palettes and studio: Sutras, nodes, edges, activity fields, execution context and step results.', 'Runtime behavior.'],
  ['<code>queue-notify.ts</code>', 'Owns the PostgreSQL listener connection, reconnects after failure and turns notifications into coalesced scheduler wakes.', 'Queue correctness; notifications are hints only.'],
].map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join(''))}
<h3 id="engine-bus">The internal queue bus</h3>
<p>The engine bus is deliberately a <strong>durable database queue with a fast wake-up signal</strong>, not a second message broker. The <code>tasks</code> table is the source of truth. Starting or routing a run inserts a pending task in the same transaction as the run checkpoint. PostgreSQL transactions use the main-thread <code>pg.Pool</code>; each transaction keeps one checked-out connection and takes the appropriate advisory per-run lock. The claim counter is increased every time a task is claimed and is included in every completion fence.</p>
<ol>
<li>A transaction commits a new pending task. A database trigger calls <code>pg_notify('sutraflow_queue', '')</code> only after that transaction commits.</li>
<li>Every worker engine has one dedicated <code>LISTEN sutraflow_queue</code> connection. A notification coalesces into <code>scheduler.wake()</code>; it does not carry the task or assign it to an engine.</li>
<li>Free slots race through the atomic claim statement. PostgreSQL <code>SKIP LOCKED</code> lets engines take different rows instead of waiting behind one claim.</li>
<li>Periodic polling always continues. It covers a lost notification, listener reconnect, work that becomes due after a retry delay, and SQLite, which has no <code>LISTEN/NOTIFY</code>.</li>
</ol>
<p>This design keeps one recovery model: after a restart or network interruption the engine reads durable rows and needs no replay log held by another service. Notifications reduce idle latency and database polling traffic without being trusted for delivery. Set <code>SUTRA_PG_NOTIFY=0</code> to test or operate with polling alone.</p>`);

sec('lifecycle', 'How a run works', `
${DIAGRAMS.lifecycle}
<ol>
<li><strong>Start.</strong> A trigger (or a test run, the Run API, a channel, Call Sutra, an MCP call) calls <code>startRun</code>. It inserts the run row, which keeps a copy of the Sutra document it started with, and one pending task for the trigger step. Redeploying never changes a run in flight.</li>
<li><strong>Queue.</strong> A deployed Sutra tuned with <em>Runs at once</em> starts extra runs as <code>queued</code>; they move to running, oldest first, when one of its runs ends (and the leader checks on each beat).</li>
<li><strong>Claim.</strong> A free worker slot claims the next due task, highest Sutra priority first, with one atomic statement: <code>update tasks set status='running', owner=? where id = (select ... where status='pending' and not_before &lt;= now order by priority desc, id limit 1) and status='pending' returning *</code>. Two engines can never claim the same task.</li>
<li><strong>Run the activity.</strong> The engine resolves the step\'s settings (templates, formulas, Project and Engine properties, secrets) and its Input mapping, then calls the activity\'s <code>execute</code> with a context (logging, secrets, abort signal, time limit). Loop settings run it once per item of a list, or again while a condition holds, and collect the results.</li>
<li><strong>Checkpoint.</strong> In one transaction the engine stores the step\'s output, marks the task done, and inserts tasks for the next steps. A crash before the commit leaves the durable task unfinished; the activity may therefore run again after recovery. A crash after the commit finds the completed transition and its next tasks. The claim fence makes the durable transition apply once even if an old worker returns late. Nothing required for continuation is kept only in memory between steps.</li>
<li><strong>Route.</strong> The step\'s result names a port (out, error, ok, problems, approved, rejected...). Each connection from that port carries a live token or a skip token according to its condition. A merge waits for a token on every incoming connection.</li>
<li><strong>Finish.</strong> When no tasks remain the run is done; a failure with no error path fails the run; End and stop options (this branch, Sutra success, Sutra error) finish early. The run\'s status, duration and steps go to metrics, traces and logs.</li>
</ol>
<h3 id="task-states">Task states</h3>
${DIAGRAMS.states}
<h3 id="conditions">Connections, conditions and merges</h3>
${DIAGRAMS.branches}
<p>A connection can have a name (shown on the canvas) and a rule: <strong>always</strong> (the default), <strong>when</strong> a formula is true, or <strong>otherwise</strong> (when no <em>when</em> connection from the same output was taken). A condition uses the routing scope: <code>input</code>, earlier <code>nodes</code>, Local <code>vars</code>, Project <code>gv</code>, Engine <code>ev</code>, <code>trigger</code> and <code>now</code>. The transition inspector builds a browsable Condition data tree from that same scope; clicking a field inserts its path. Its <strong>{x}</strong> shortcut inserts a Project or Engine property and it warns when a referenced Project property is absent; for example <code>{input.amount} &gt; {gv.LIMIT}</code>. Branches that are not taken send skip tokens downstream, so merges never wait forever (dead-path elimination).</p>
<h3 id="waits">Waiting without holding anything</h3>
<p>A step can return a wait instead of an output. The task becomes <code>waiting</code> with its wait details and costs nothing while it waits:</p>
<ul>
<li><strong>Approval</strong>: a person decides in the studio (Runs, Approvals) or through the API; the task resumes on approved or rejected.</li>
<li><strong>Wait / timers</strong>: the task returns to pending with a not-before time.</li>
<li><strong>Call Sutra</strong>: a child run starts; the parent task waits until the child finishes and receives what its Return step sent.</li>
<li><strong>Replies across engines</strong>: a gateway caller waits on the engine that took the request even when another engine runs the reply step; the waiting engine polls the run row.</li>
</ul>
<h3 id="errors">Errors, retries and the Error handler</h3>
<p>Step settings give retries with a delay and a time limit. A failed attempt with retries left goes back to pending with a not-before time. When retries are spent, the step\'s <em>error</em> output is taken if it is connected; otherwise the Sutra\'s Error handler (an activity with no input) receives the error with the step name and message; otherwise the run fails. A failed run can be <strong>resubmitted</strong>: a new run starts with the same trigger input and the old run is marked resubmitted.</p>
<h3 id="debug">Test and debug runs</h3>
<p>A test run uses the draft, not the deployed version. A debug run pauses before each step (<code>paused</code> tasks) and continues one step at a time, so input and output can be checked in the studio.</p>`);

sec('data', 'Data, mapping and expressions', `
<p>Every step sees the same data: <code>trigger</code> (what started the run), <code>input</code> (the previous step\'s output), <code>nodes.&lt;Step name&gt;</code> (any earlier step), <code>vars</code> (Local variables), <code>gv</code> (Project properties), <code>ev</code> (Engine properties), <code>secret</code> (vault, server side only, masked in history), <code>run</code>, and inside loops <code>item</code>, <code>index</code> and <code>iteration</code>.</p>
<ul>
<li><strong>Templates</strong> (<code>template.ts</code>): <code>{{input.name | upper}}</code> inside text; a field that is only one template keeps the typed value (object, list, number).</li>
<li><strong>Formulas</strong> (<code>expr.ts</code>): a value starting with <code>=</code>, such as <code>=concat({input.first}, ' ', {input.last})</code>. Parsed into a tree and evaluated by the engine; there is no <code>eval</code>.</li>
<li><strong>Structured mapping</strong> (<code>mapping.ts</code>): the Activity Input tree from a shared schema or from paths, with For-Each on repeating nodes, where, group by, sort and conditions.</li>
<li><strong>Shapes before running</strong> (<code>design.ts</code>, <code>schemas.ts</code>): each activity\'s output hint, schemas and earlier steps give the mapper a tree to drag from before any run exists.</li>
</ul>`);

sec('mapping-contracts', 'Typed JSON/XML mapping (2.0.7)', `
<p><strong>Map JSON Data</strong> and <strong>Map XML Data</strong> are focused activity definitions over the same structured mapping engine as legacy Map data and Render JSON/XML. Mapping creates an object; rendering creates text. Existing generic activity identifiers remain valid.</p>
<p>Targets come from project-scoped JSON Schema/XSD references or a MappingValue containing path declarations, rules and optional typed definitions. Definitions carry scalar/object type, required/repeating flags, item bounds, description and object-element namespace URI. Attributes use <code>@_name</code>; list markers use <code>[]</code> in declarations and normalized paths in rules. XML has exactly one non-repeating element root. Namespace declarations become <code>@_xmlns</code> attributes on objects; qualified object names declare the corresponding prefix.</p>
<p><code>designSchemas</code> and <code>validateDoc</code> use the same static checks: malformed formulas, unmapped required targets, invalid XML target names/root and contradictory cardinalities are errors; stale target rules and references absent from known source shapes are warnings. Hidden mapping fields in value-mode renderers are not checked. Output coercion retains legacy behavior unless typed definitions or a new typed activity opt into strict value checks. Type failures follow ordinary engine error routing.</p>
<p>Whole-result preview is a project-authorized, CSRF-protected POST endpoint. It resolves only the selected project's schema, evaluates expressions against supplied sample scope and serializes the result; it does not dispatch activities, write business data, call connectors, or create runs. Scope is capped at 256 KB and preview text at 1 MB. The editor debounces edits and discards stale replies, and labels the test-run source as possibly stale. Sample-to-schema inference is capped at 128 KB; XML DTD/entities are rejected. Generated XSD is a proposal and does not preserve source namespace bindings.</p>
<p><strong>Instance validation is separate from mapping shape:</strong> <code>schema-validation.ts</code> reuses AJV for JSON Schema drafts 07/2019-09/2020-12 and <code>xmllint-wasm</code> (libxml2) for XSD 1.0. Runtime checks patterns, enums, ranges, conditional JSON rules and XML namespaces/order/choice/groups/cardinality even when the designer tree approximates them. XSD 1.1 is unsupported. Dependencies are preloaded from same-project XSD resources only; no network/host filesystem resolution. DTD/entities are rejected. Limits: 4 MB XML, 32 schema files / 1 MB schema text, four active validators / 64 waiting. Each WASM instance has a 32 MB linear-memory ceiling, excluding worker JavaScript overhead.</p>
<p>The shared boundary protects typed mapping, parse/render, Validate fields, structured local/FTP/SFTP files, outbound HTTP bodies/replies, received HTTP responses and opt-in REST/SOAP ingress. File reads validate JSON/XML only when <code>strictValidation === true</code>, a default-off checkbox shared by local/remote read, list and trigger fields; selecting a schema alone does not enable read validation. Strict reads require a matching JSON Schema/XSD. File writes with selected contracts are checked before creation/truncation; HTTP business requests before sending. Ordinary failures use engine error routing, Validate fields uses its invalid port, ingress rejects before run creation, and file triggers retain readError payloads. CSV streaming and schema-free behavior are unchanged. SOAP validates the namespace-preserved operation, not the full envelope or a prefix-stripped reconstruction. XML tree display is a separate bounded read-only view.</p>
<p>Certification evidence and exact executed checks are recorded in <code>docs/benchmarks/release-2.0.7-verification.md</code>. The functional mapping tests are not an industry certificate, XML standards-conformance claim, throughput benchmark or long-duration soak.</p>
<p><code>test/validation-samples.test.ts</code> executes the bundled samples, checks every node description and schema reference, preserves edited schemas across reimport, exercises strict file-read on/off/missing/wrong-kind cases, and drives real local REST/SOAP listeners plus the sample HTTP client. Invalid ingress is checked against the durable run counter to prove that no run starts; invalid client data must not create a server run. The XML sample renders the normalized parsed object against its schema before revalidating XML text, restoring the declared namespace rather than guessing it from prefix-stripped data.</p>
<p><strong>2.0.9 design integrity:</strong> shared Output, mapping and transition browsers derive observed fields from the explicit test session instead of projecting run values onto a different schema. Historical production outputs are not auto-loaded as samples; edits and schema reloads clear previews. Arrays show counts and complete small scalar lists. Activity sources and generated process documentation identify user names and activity types; documentation resolves named schema kinds/roots and connection kinds without resolving credentials.</p>
<p><code>POST /api/schemas/:id/impact</code> requires Design permission on the schema's owning project. It analyzes a proposed definition using a request-local tree resolver injected into <code>designSchemas</code>; there is no temporary database update or process-global cache swap. The report compares shapes and new diagnostics for directly referencing saved drafts, not runtime compatibility, deployed snapshots or transitive schema dependencies. Both editors share a report UI with stale-response cancellation. <code>npm run test:samples</code> combines catalogue-wide static consistency checks with executable mapping and validation fixtures; real external-service gates remain separate.</p>
<p>Protected ingress verifies authentication and scopes before returning schema diagnostics. Authorized invalid requests receive REST 400 with error details or a SOAP Client fault; missing credentials return 401 and insufficient scopes 403 without schema details. Dedicated JWT-protected REST/SOAP tests verify the response distinctions and the unchanged durable run count.</p>
`);

sec('gateway', 'Services: REST, SOAP and MCP', `
${DIAGRAMS.gateway}
<p>When a Sutra with a REST service, SOAP service or MCP skill trigger is deployed, <code>rebuildRoutes</code> resolves its General settings against the current Project and Engine properties, then adds its path to the gateway\'s route table on every engine. A request is matched (method and path with parameters, SOAP action, MCP endpoint), checked against the service\'s API policy, and starts a run of the deployed version with the request as trigger input. The gateway then waits for the run\'s reply step (HTTP response, SOAP reply, Reply to AI) up to <code>SUTRA_REPLY_TIMEOUT_MS</code>.</p>
${tw(['File', 'Boundary'], [
  ['<code>gateway.ts</code>', 'Listener lifecycle, deployed route tables and the small top-level dispatcher.'],
  ['<code>rest.ts</code>', 'REST body decoding and response serialization.'],
  ['<code>soap.ts</code>', 'SOAP envelopes, faults, XML rendering and WSDL generation.'],
  ['<code>mcp-handler.ts</code>', 'Streamable HTTP sessions, JSON-RPC validation, tool listing and tool calls.'],
  ['<code>oauth-handler.ts</code>', 'OAuth client-credentials token requests and responses.'],
  ['<code>websocket.ts</code>', 'Upgrade policy, connection ownership, ordered messages and cross-engine delivery.'],
  ['<code>agents.ts</code>', 'Chat, OpenAI-compatible, MCP-agent and A2A surfaces.'],
  ['<code>apps.ts</code>', 'Apps, keys, tokens, distributed quotas, firewall, traffic log and OpenAPI.'],
].map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join(''))}
<p>The request hot path does not wait on the synchronous PostgreSQL bridge: app/key lookup, token validation, replay protection, distributed rate limits, firewall reads, WebSocket registration, agent job polling and request logging use <code>asyncdb.ts</code>. Independent requests can therefore have database work in flight together. Administrative lists and infrequent housekeeping retain <code>q</code>/<code>tx</code> until their migration is useful.</p>
<ul>
<li><strong>TLS</strong> (<code>tls.ts</code>): self-signed for testing, uploaded certificates, or Let\'s Encrypt with automatic renewal; a client CA turns on mutual TLS for services whose policy asks for it.</li>
<li><strong>SOAP</strong>: the gateway publishes a WSDL for each SOAP service and wraps errors as SOAP faults; WS-Security headers are checked by policy. A policy may encrypt authenticated replies and faults for the verified X.509 caller certificate or a configured recipient certificate.</li>
<li><strong>MCP</strong> (<code>mcp.ts</code>): JSON-RPC over Streamable HTTP (protocol versions 2025-06-18, 2025-03-26 and 2024-11-05). <code>tools/list</code> returns every deployed MCP skill of that endpoint with its input schema; <code>tools/call</code> starts the Sutra and returns the Reply to AI content. An MCP server connection groups skills under their own path, such as <code>/mcp/orders</code>.</li>
<li><strong>Tracing</strong>: a caller\'s W3C <code>traceparent</code> continues into the run\'s trace.</li>
</ul>
<h3 id="gateway-acme">Gateway TLS and the ACME lifecycle</h3>
<p>ACME is used only for the gateway\'s <em>Let\'s Encrypt</em> certificate mode. Its purpose is to prove control of the configured public names, obtain a browser-trusted certificate and replace it before expiry without an administrator copying certificate files. Self-signed and uploaded-certificate modes do not call ACME. SutraFlow supports the HTTP-01 challenge; wildcard certificates, which require DNS-01, are outside this path.</p>
<ol>
<li><strong>Operator call.</strong> <code>web/admin/Server.tsx</code> first saves the TLS domains, contact email, staging choice and agreement through <code>PUT /api/server/tls</code>, then calls <code>POST /api/server/tls/acme</code>. The route requires the Server permission. <code>api.ts</code> switches the TLS mode to <code>acme</code> and starts <code>requestAcme(reloadTls)</code> without holding the HTTP request open for the whole issuance.</li>
<li><strong>Account and order.</strong> <code>gateway/tls.ts</code> takes the <code>acme-certificate</code> database lease, renewed while the order runs, so only one engine issues or renews the shared certificate. It decrypts the saved <code>acmeAccountKey</code>, or generates and encrypts one on first use, chooses the Let\'s Encrypt staging or production directory, and creates a fresh certificate private key and CSR containing all configured names. The maintained ACME client uses Node\'s native cryptography and <code>@peculiar/x509</code>; the removed <code>node-forge</code> compatibility export is neither installed nor called.</li>
<li><strong>HTTP-01 proof.</strong> For each authorisation the ACME client gives <code>tls.ts</code> a token and key authorisation. It is stored briefly in <code>acme_challenges</code> with the issuing engine and an expiry. Before normal gateway routing, every <code>gateway.ts</code> answers <code>/.well-known/acme-challenge/&lt;token&gt;</code> from that shared table. Public port 80 may therefore reach any healthy gateway node, but must reach the HTTP listener unchanged. The token is removed after validation and expired rows are cleaned before an order.</li>
<li><strong>Install.</strong> After Let\'s Encrypt validates every name, <code>tls.ts</code> saves the returned chain and matching private key through the encrypted settings store, records success or the error for the Admin Console, reloads its HTTPS context and raises the cluster generation. Every other engine reloads the shared certificate on its next heartbeat. Replacing the secure context does not deliberately drop existing connections.</li>
<li><strong>Renew.</strong> <code>index.ts</code> starts the renewal timer at boot. It checks after ten seconds and every twelve hours; in ACME mode, a missing certificate or one with fewer than 30 days left calls the same <code>requestAcme(reloadTls)</code> path. Failure leaves the current certificate in place and the next check retries.</li>
</ol>
<p>The ACME account key and installed private key are encrypted with the server master key in shared settings. Challenge rows contain public key authorisations, not private keys, and expire after 15 minutes. An issuance lease expires if its engine disappears; an in-flight ACME order itself is not transferable, so a later request or renewal check starts a new order after the lease expires. The certificate expiry alert remains the operational backstop for failed renewal.</p>
<h3 id="gateway-apps">Apps, plans, firewall and the request log</h3>
<p>Before routing, the gateway checks its firewall (deny wins; an allow list admits only its addresses). An API security policy with <em>Gateway apps</em> accepts an app\'s key (<code>X-API-Key</code>, or <code>Authorization: Bearer sfk_...</code>) or an access token from <code>POST /oauth/token</code> (OAuth2 client credentials, an hour, signed with a key kept in settings). The app must hold the scopes the policy requires; its plan is then counted in <code>gw_usage</code> in one transaction, so every engine of a cluster shares the count, and a full window answers 429 with <code>Retry-After</code>; answers carry <code>X-RateLimit-*</code> headers. Every request is written to <code>gw_requests</code> when it ends, for the Traffic page (timeline, p50/p95/p99, busiest and slowest services, apps) and the request log; housekeeping deletes entries after the chosen number of days. OpenAPI 3.1 is generated from the deployed REST services, their path parameters, body schemas and security, for the console and, when chosen, at <code>/openapi.json</code> on the gateway.</p>`);

sec('oauth', 'OAuth: connections, sign-in and tokens', `
${DIAGRAMS.oauth}
<p>SutraFlow uses OAuth 2.0 in five places. They share the standard, not the code: each is where its job is.</p>
${tw(['Use', 'SutraFlow is', 'Where'], [
  ['OAuth connections: Google, Microsoft, Dropbox, Facebook, Twitch, custom', 'a client of the provider, acting for an account that signed in', '<code>connectors/oauth.ts</code>'],
  ['Outbound security profile <em>OAuth client credentials</em>: calls to APIs as a machine', 'a client with its own ID and secret, no person', '<code>security/outbound.ts</code>'],
  ['Gateway apps: <code>POST /oauth/token</code> for the apps that call your services', 'the authorization server (it issues short tokens to apps)', '<code>gateway/apps.ts</code>'],
  ['API security policies: JWT and token introspection on incoming calls', 'a resource server (it checks tokens others issued)', '<code>security/inbound.ts</code>, <code>security/hmac.ts</code>'],
  ['Single sign-on for people (OpenID Connect or SAML 2.0)', 'a client/service provider of the identity provider; people get a SutraFlow session', '<code>sso.ts</code>, <code>saml-sso.ts</code>'],
].map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join(''))}
<h3 id="oauth-connections">OAuth connections step by step</h3>
<ol>
<li><strong>The connection</strong> (resource kind <code>oauthApp</code>) holds the service, the client ID, the <em>name</em> of the vault secret with the client secret, and the scopes. A release carries it without any secret value or token.</li>
<li><strong>Start.</strong> <code>GET /api/oauth/:id/start</code> (permission <em>Connections</em>) returns the provider's authorization address with <code>response_type=code</code>, the scopes, the redirect address (<code>&lt;this server&gt;/api/oauth/callback</code>) and a <code>state</code>: the connection id, the redirect address, an expiry 10 minutes ahead and a random part, signed with HMAC-SHA256 under a key kept in settings (<code>oauthStateKey</code>). Provider extras are added: Google <code>access_type=offline</code> and <code>prompt=consent</code> (to get a refresh token), Dropbox <code>token_access_type=offline</code>, Twitch <code>force_verify</code>. A Microsoft connection with a tenant signs in at that tenant instead of <code>common</code>.</li>
<li><strong>Consent</strong> happens at the provider; SutraFlow never sees the password.</li>
<li><strong>Callback.</strong> <code>GET /api/oauth/callback</code> (open: the browser comes back from the provider) checks the state's signature and expiry, then posts the code, the redirect address, the client ID and the client secret (read from the vault at that moment) to the token endpoint.</li>
<li><strong>Storage.</strong> The access token and the refresh token are encrypted with the master key (AES-256-GCM, as vault secrets) and saved in <code>settings</code> under <code>oauth:&lt;connection id&gt;</code> with the expiry and scopes. All engines read the same row, so one sign-in serves the whole cluster; tokens never leave the server, and a different server signs in on its own.</li>
<li><strong>Use.</strong> Every call goes through <code>accessToken()</code>: a token with more than a minute left is used as it is; otherwise the refresh token is exchanged for a new access token (one refresh at a time per engine; the refresh token is kept when the provider does not send a new one) and saved. <code>apiCall</code> adds <code>Authorization: Bearer</code>; <code>streamCall</code> does the same for streamed uploads and downloads.</li>
<li><strong>Without a person.</strong> A connection can name a <em>refresh token secret</em>: on first use the server takes the refresh token from its vault (set by a pipeline) and signs in with it; <code>sutra connect</code> runs the start and waits for the callback from the command line.</li>
</ol>
<h3 id="oauth-services">Per service</h3>
${tw(['Service', 'Sign-in and token addresses', 'What SutraFlow adds', 'Scopes the steps use', 'Set up at'], [
  ['Google (Drive, Sheets, Docs, YouTube)', '<code>accounts.google.com/o/oauth2/v2/auth</code>, <code>oauth2.googleapis.com/token</code>', '<code>access_type=offline</code>, <code>prompt=consent</code>, <code>include_granted_scopes</code>', '<code>.../auth/drive</code> (or <code>drive.readonly</code>, <code>drive.file</code>), <code>spreadsheets</code>, <code>documents</code>, <code>youtube.upload</code>, <code>youtube.readonly</code>, <code>yt-analytics.readonly</code>', 'Google Cloud console: APIs enabled, consent screen (Internal or External with test users), a Web application client with the redirect URI'],
  ['Microsoft (SharePoint, OneDrive)', '<code>login.microsoftonline.com/&lt;tenant or common&gt;/oauth2/v2.0/authorize</code> and <code>/token</code>', 'the connection\'s <em>Tenant</em> in both addresses', '<code>Files.Read.All</code>, <code>Sites.Read.All</code>, <code>offline_access</code>, <code>User.Read</code> (<code>Files.ReadWrite.All</code> to write)', 'Microsoft Entra ID: app registration, Web redirect URI, client secret (its Value), delegated Graph permissions, admin consent'],
  ['Dropbox', '<code>www.dropbox.com/oauth2/authorize</code>, <code>api.dropboxapi.com/oauth2/token</code>', '<code>token_access_type=offline</code>', '<code>files.metadata.read</code>, <code>files.content.read</code>, <code>files.content.write</code>', 'Dropbox App Console: scoped access, permissions, redirect URI; App key and App secret'],
  ['Facebook Pages', '<code>www.facebook.com/v19.0/dialog/oauth</code>, <code>graph.facebook.com/v19.0/oauth/access_token</code>', 'nothing (no refresh token: sign in again after about 60 days)', '<code>pages_show_list</code>, <code>pages_read_engagement</code>, <code>pages_manage_posts</code>', 'Meta for Developers: an app with Facebook Login for Business, valid redirect URIs; App ID and App secret'],
  ['Twitch', '<code>id.twitch.tv/oauth2/authorize</code>, <code>id.twitch.tv/oauth2/token</code>', '<code>force_verify=true</code>; the client ID on every API call', '<code>user:read:email</code>, <code>channel:manage:broadcast</code>, <code>clips:edit</code> and others', 'Twitch developer console: a Confidential application with the redirect URL'],
  ['Custom', 'the connection\'s <em>Authorization URL</em> and <em>Token URL</em>', 'nothing', 'the provider\'s', 'the provider\'s developer portal'],
].map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td><td>${r[4]}</td></tr>`).join(''))}
<p>The step-by-step set-up of each, with the screens to open and the fields to fill, is in the user guide: <a href="/guide#ch-oauth-setup">OAuth connections step by step</a>.</p>
<p>Design points: the client secret stays a vault secret read only when exchanging codes; the signed, expiring state stops forged or replayed callbacks; tokens are encrypted at rest and keyed by the connection, so two projects never share an account by accident; and the database is the one place every engine looks, so a leader change or a restarted engine needs no new sign-in.</p>`);

sec('triggers', 'Timers, listeners and channels', `
<p>Triggers that are not requests are started by the leader engine:</p>
<ul>
<li><strong>Timers</strong> (<code>scheduler.ts</code>): cron expressions or intervals, with Project and Engine properties resolved when schedules are rebuilt.</li>
<li><strong>Listeners</strong> (<code>listeners.ts</code>): folder watchers (File trigger), mailbox polling (Email trigger), queue and topic subscriptions (Service Bus), Drive and chat polling. General settings use the same property resolver as normal activities.</li>
<li><strong>Broker acknowledgement and deduplication</strong> (<code>connectors/bus.ts</code>): auto mode lets the broker settle on receipt; client mode acknowledges only after run success; explicit mode records Confirm message's confirm, requeue or reject decision. Before starting a protected delivery it writes <code>bus_messages</code> with a reserved run id, keyed by Kafka topic/partition/offset or RabbitMQ/AMQP message id. A new leader that receives the same delivery consults that run: completed is acknowledged, failed/cancelled removes the reservation for retry, and an active/waiting RabbitMQ or AMQP copy is held without starting a duplicate while Kafka pauses that partition. A run that ends without an explicit decision follows the trigger's failure rule.</li>
<li><strong>Broker protocols</strong>: Kafka uses KafkaJS and supports system or private CA trust, SASL plain/SCRAM and optional mutual TLS. RabbitMQ uses AMQP 0-9-1 over <code>amqp</code> or <code>amqps</code>. ActiveMQ/Artemis uses AMQP 1.0 over TCP or TLS. All three can use a private CA and an optional client certificate whose private key and passphrase remain vault secrets; certificate verification cannot be disabled. ActiveMQ resources use a container-id prefix and unique stable role suffixes, so publishers and listeners never contend for one client id. Java applications may use OpenWire/JMS against the same ActiveMQ destination; Classic needs <code>transport.transformer=jms</code> on its AMQP connector for body-level interoperability. Broker JVM/Erlang runtimes are server prerequisites, not SutraFlow client dependencies.</li>
<li><strong>Channels</strong> (<code>channels.ts</code>): Send to channel starts every deployed Sutra of the project whose Channel trigger listens on that name. It reads deployments from the database, so it works the same on one engine or many.</li>
</ul>
<p>When the leader stops or dies, another engine takes the lease and starts the timers and listeners itself. Kafka always supplies a stable offset identity; an external RabbitMQ or AMQP publisher must set a unique message id to receive the same duplicate-run protection. Requeue releases a delivery; reject asks the broker to dead-letter or discard it according to broker configuration. A configured delivery-count ceiling changes a requeue into reject. Broker delivery and outside activity effects remain at-least-once boundaries, so downstream idempotency keys are still required where an acknowledgement can be lost.</p>`);

sec('storage', 'Storage', `
${DIAGRAMS.storage}
<p>The default backend is SQLite built into Node (<code>node:sqlite</code>), in <code>data/sutra.db</code>, with WAL and a busy timeout. The administrative and low-frequency paths use <code>q</code> and <code>tx</code> in <code>db.ts</code>. With PostgreSQL those compatibility calls go through <code>pgworker.ts</code>, whose worker thread owns a connection while the caller waits on a SharedArrayBuffer.</p>
<p>The engine hot path is different: <code>asyncdb.ts</code> gives claim, complete, fail and settle truly asynchronous calls. On PostgreSQL it uses a main-thread <code>pg.Pool</code>, lets many independent runs have database work in flight, carries one pooled connection through each transaction, and discards a broken checked-out connection. SQLite and PGlite implement the same asynchronous interface over their existing connection. Advisory locks are keyed by run or queue operation, so transitions of one run are ordered while different runs proceed concurrently. The tests run the suite on SQLite and again on PGlite, with focused tests against a real PostgreSQL server.</p>
<h3 id="tables">Tables</h3>
${tw(['Table', 'Holds', 'Columns'], tables.map(t => `<tr id="tbl-${t.name}"><td><code>${t.name}</code></td><td>${TABLE_TEXT[t.name] || ''}</td><td class="cols">${t.cols.map(c => esc(c)).join(', ')}</td></tr>`).join(''))}`);

sec('cluster', 'Clusters: several engines', `
${DIAGRAMS.cluster}
<p>Engines that share one database form a cluster. No engine talks to another directly; the database is the only meeting point.</p>
<ul>
<li><strong>Work sharing.</strong> Every engine claims tasks with the atomic update above, so only one live claim owns a task at a time. A crash can make the activity execute again, so activities that call outside systems should use an idempotency key when the system supports one; the fenced database checkpoint itself applies once.</li>
<li><strong>Heartbeat.</strong> Each engine updates its <code>engines</code> row every <code>SUTRA_HEARTBEAT_MS</code> with its active steps and draining flag. An engine silent for three beats is dead.</li>
<li><strong>Leader.</strong> One engine holds the <code>leader</code> lease (renewed each beat, valid for three). It runs timers, listeners, recovery and housekeeping. If it stops renewing, another engine takes the lease.</li>
<li><strong>Recovery.</strong> The leader puts tasks owned by dead engines back to pending. A new claim increases the task\'s claim number; a late completion from the former owner fails its fence and changes nothing.</li>
<li><strong>Queue/topic takeover.</strong> Only the leader owns broker consumers. <code>bus_messages</code> binds a protected broker identity to its reserved run before that run starts. A replacement leader therefore follows the existing durable run instead of starting a duplicate. It acknowledges a completed run and clears a failed/cancelled reservation so retry can create a new run. An active/waiting duplicate is held unacknowledged on RabbitMQ/AMQP with an extra delivery slot; Kafka pauses only that partition and checks again. Settlement still occurs only at the configured on-receipt, run-success or explicit-confirmation boundary.</li>
<li><strong>Deploy propagation.</strong> A deploy, connection or project change raises a generation number in settings; every engine compares it on each beat and reloads its routes (and the leader its timers and listeners).</li>
<li><strong>Locks.</strong> The <code>leases</code> table also gives short cluster-wide locks, such as the deploy-folder lock so replicas starting together deploy a package once.</li>
<li><strong>Studio in a cluster.</strong> A studio with <code>SUTRA_WORKERS=0</code> edits and deploys; the engines run.</li>
</ul>
<h3 id="leader-failover">Leader failure, switch and return</h3>
${DIAGRAMS.failover}
<ol>
<li><strong>Normal operation.</strong> The leader renews the database lease on every beat. Only it owns timers, folder/mailbox/Drive/broker listeners, orphan recovery, run promotion, alerts and housekeeping. All engines can serve gateway requests and execute claimed tasks.</li>
<li><strong>Failure detection.</strong> If the process, host or network path disappears, it cannot renew the lease or heartbeat. Existing database rows do not disappear. After three heartbeat intervals the lease is eligible for takeover and the engine is considered dead.</li>
<li><strong>Takeover.</strong> Exactly one eligible engine updates the lease. Its <code>becameLeader</code> hook rebuilds timers and listeners and begins one-only maintenance. It resets running tasks owned by dead engines to pending; the next owner gets a higher claim number. Folder-trigger checkpoints in <code>file_listener_state</code> and <code>file_listener_files</code> let the new leader distinguish the first baseline from files that arrived, changed or failed under the old leader.</li>
<li><strong>Former leader returns.</strong> On its next successful heartbeat it reads and tries to renew the authoritative lease. If another engine owns a valid lease, its <code>lostLeader</code> hook stops timers and listeners. It remains a normal engine: its gateway can serve requests and its worker slots can claim ordinary tasks, but it does not run leader-only work. It may lead again only after the current lease is released or expires and it wins a later database update.</li>
</ol>
<h3 id="failure-modes">What happens during other failures</h3>
<ul>
<li><strong>Activity error or timeout.</strong> The executor aborts at the limit. The task retries after its configured delay, routes through its connected error output, invokes the Sutra Error handler, or fails the run in that order.</li>
<li><strong>Engine dies while an activity runs.</strong> Its uncommitted transition is absent. The leader requeues the task after the heartbeat threshold; the activity can run again, while fencing prevents the old claim from committing later.</li>
<li><strong>PostgreSQL is unavailable.</strong> No engine can safely claim, start or checkpoint durable work. Heartbeat errors are contained rather than terminating the process; broken pool clients are discarded, the notification listener reconnects, and periodic polling resumes from the durable queue after the database returns. A process keeps its last local leader state while the answer is unknown, but it cannot acquire or prove a new lease without PostgreSQL.</li>
<li><strong>Notification is lost.</strong> Nothing is lost from the queue. The next periodic poll sees the pending row.</li>
<li><strong>Graceful drain.</strong> Readiness turns off and leadership is released immediately. Current steps get the drain window; unfinished claims return to pending for another engine.</li>
</ul>
<p>The guarantee is <strong>durable at-least-once activity execution with exactly-once fenced state transitions</strong>, not exactly-once effects in an outside system. This is why request IDs, object keys or other idempotency controls should be passed to external APIs for non-repeatable operations.</p>`);

sec('deploy', 'Releases and deployment', `
${DIAGRAMS.release}
<h3 id="packages">Project packages</h3>
<p>A release is a <strong>project package</strong> (<code>packages.ts</code>): a JSON file with format <code>sutraflow-package</code> v1 holding every deployed Sutra at its version, the project\'s connections (secret names, never values), shared schemas and WSDLs, Project properties and logging, a manifest and a sha256 checksum. The manifest includes Sutras, secrets, activity types and each Memory table\'s key, database/driver, referenced source objects, queries, schedule/time zone, limits and failsafe. Preflight rejects missing Memory-table dependencies and invalid configuration before deployment.</p>
<ul>
<li><strong>Check</strong>: the server knows every activity type, the secrets exist in its vault, and API paths and MCP skill names are not used by another project.</li>
<li><strong>Deploy</strong>: Sutras are matched by name and created or updated as new versions (unchanged documents are left alone); Sutras not in the package are undeployed unless kept. Each deployment is stored in <code>package_deployments</code> with its report.</li>
<li><strong>Roll back</strong>: deploys the package before the latest one, or a chosen one from history.</li>
<li><strong>Test</strong>: deploys into a throw-away server and runs the package\'s Sutras.</li>
<li><strong>Import</strong>: a new project from chosen Sutras of a package, as drafts by default (no address clashes, missing secrets only warn), not recorded as a deployment. <strong>Copy</strong> builds a package of chosen Sutras of a project on the same server and imports it the same way.</li>
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
<p>The Release palette makes a release itself a Sutra: Build package, Check package, Deploy package and Roll back, on this server or on a remote engine whose admin token comes from the vault. The <em>Release pipeline</em> sample builds, checks, deploys to a test copy, waits for approval and deploys to production. Release activities are off until an administrator allows them in Admin Console &rarr; Server &rarr; Runtime.</p>
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
<h3 id="console">Admin Console on headless engines</h3>
<p>The console (<code>web/admin</code>, <code>server/src/console.ts</code>) is for what is deployed. Operators see the overview, start and stop deployed Sutras (their triggers stop starting runs while they stay deployed), look into runs and resubmit them, decide approvals, deploy an earlier version or roll a project back to an earlier package, and drain any engine: the request is stored on the engine\'s row and that engine drains on its next heartbeat. Administrators manage users, system accounts with their API tokens, roles, and read the audit log. Every page shows only the projects the signed-in account may see, and every action is checked again by the server.</p>
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

sec('alerts', 'Alerts', `
<p>The cluster leader checks every enabled rule every six heartbeats (30 seconds by default), so a cluster alerts once however many engines it has. A check reads the database: failed or slow runs in a window, the gateway request log for error rate and p95 latency, engine heartbeats, pending steps older than a limit, waiting approvals, the gateway certificate, and the listeners of the leader. When a rule\'s condition holds and it has no open alert, an alert opens and every channel of the rule is told; while it holds, the alert is updated and, unless acknowledged, a reminder goes out every chosen number of minutes; when it clears, the alert resolves and the channels are told if the rule says so. Deliveries are recorded on the alert with their result. Channels: email through an SMTP connection; a webhook with a JSON body (<code>event</code>, <code>text</code>, <code>alert</code>) signed with an HMAC of a vault secret in <code>X-Sutra-Signature</code>; or a deployed Sutra started with the alert as its input. Resolved alerts are deleted after <code>SUTRA_AUDIT_RETENTION_DAYS</code>. <code>sutra alerts</code> exits with 1 while a critical alert is firing, for scripts and monitors.</p>`);

sec('security', 'Security', `
<ul>
<li><strong>Studio</strong>: the first visit creates the administrator; signed session cookies that end when the account is disabled or signed out everywhere; changing requests need the X-Sutra header; the admin port listens on 127.0.0.1 unless set otherwise.</li>
<li><strong>Accounts and roles</strong>: people and system accounts hold roles (Administrator, Developer, Deployer, Operator, Approver, Viewer, API caller, or custom ones) for all projects or one project. Every admin API route checks a permission for its project (<code>guard.ts</code>); lists show only the caller\'s projects. Five wrong passwords lock an account for 15 minutes; an administrator-set password must be changed at the next sign-in; at least one active administrator always remains.</li>
<li><strong>Automation</strong>: <code>SUTRA_ADMIN_TOKEN</code> acts as an administrator, compared in constant time. System accounts get their own API tokens (stored as hashes, with expiry) limited to their roles; headless engines accept only tokens.</li>
<li><strong>Audit</strong>: every change, sign-in and refused request is recorded with who, when, from where and the result, searchable and exportable as CSV.</li>
<li><strong>Vault</strong>: AES-256-GCM; values never leave the server through the API; masked in run history and logs.</li>
<li><strong>Gateway</strong>: per-service API policies (API key, Basic with listed users or system accounts holding Call services on the project, JWT, mutual TLS, WS-Security); TLS with uploaded or Let\'s Encrypt certificates.</li>
<li><strong>Outbound</strong>: security profiles, client certificates, OAuth tokens stored encrypted, circuit breakers on HTTP connections.</li>
<li><strong>Data never becomes code</strong>: SQL text, transactions and procedure names may resolve only administrator-managed Project/Engine properties; input, trigger, earlier-output and Local-variable references there are rejected and runtime values must use bound parameters. Formulas and templates are parsed, not evaluated; scripts receive values as environment variables and a JSON file; programs get arguments without a shell; file activities stay inside their folder; custom JavaScript runs in a sandboxed worker with limits.</li>
<li><strong>SSO client binding</strong>: OpenID Connect uses PKCE, state and nonce. SAML uses a one-time request in the shared database plus a short-lived signed client cookie; the callback must present both. A browserless client follows the same contract by retaining the cookie returned by the start request and sending it with the SAML callback.</li>
<li><strong>Policies off by default</strong>: scripts and release activities each need an administrator\'s switch in Admin Console &rarr; Server &rarr; Runtime. Project and Engine properties are always read-only to Sutras.</li>
<li><strong>Vendor supply chain</strong>: every build checks reviewed local dependency trees and packaging scope; connected CI, releases and a weekly workflow compare them with npm. A newer upstream version must be reviewed for API and behavior changes and pass focused plus complete regression tests before its pinned baseline moves.</li>
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
<li>Runs with step data, approvals, cancel and resubmit; Releases with packages and history; the read-only Services page with endpoints; Admin Console &rarr; Server with runtime, gateway and TLS controls.</li>
<li>New project: empty, with chosen samples, from chosen Sutras of a package file, or a copy of chosen Sutras of a project, as drafts.</li>
</ul>
<h3 id="console-features">Admin Console features</h3>
<ul>
<li>Overview of engines, deployed Sutras, runs of the last day, failures, approvals, work queue and gateway certificate.</li>
<li>Applications: start, stop and restart deployed Sutras; runs with step results, resubmit and cancel; earlier versions; package history and roll back; per-Sutra tuning.</li>
<li>Engines of the cluster with drain and engine tuning; approvals; users, system accounts with API tokens, roles; audit log with CSV export.</li>
<li>Gateway: apps with keys, scopes and OAuth2 client credentials; plans with limits and quotas; firewall; traffic statistics and request log; APIs with OpenAPI.</li>
<li>A Console panel with every action\'s output, and each action as a sutra command and an HTTP call for Windows PowerShell and Linux shells.</li>
<li>Alerts: rules of nine kinds, channels (email, webhook, Sutra), open alerts with acknowledge and resolve, reminders; the Overview with open alerts and charts of runs and gateway traffic.</li>
</ul>`);

sec('files', 'What each file does', `
<p>Line counts are from this build. Use the search box to find a file by name or by what it does.</p>
${FILES.map(g => `<h3 id="files-${g.id}">Files: ${esc(g.title)}</h3><p>${g.intro}</p>${tw(['File', 'Lines', 'What it does'], g.files.map(([f, d]) => `<tr id="f-${slug(f)}" class="frow"><td><code>${esc(f)}</code></td><td class="num">${fs.existsSync(path.join(root, f)) ? lines(f) : ''}</td><td>${d}</td></tr>`).join(''))}`).join('')}`);

sec('api', 'Admin API routes', `
<p>${api.count} routes in <code>server/src/api.ts</code>. People use them through the studio with a session; automation sends the admin token. Headless engines allow only packages, the projects list, rollback, runs, secrets, meta and engine routes.</p>
${tw(['Area', 'Routes'], api.html)}`);

sec('settings', 'Environment settings', `
<p>Process settings come from environment variables (<code>config.ts</code>). Everything else (gateway ports after the first start, TLS, policies, Engine properties) is stored in the database and edited in Admin Console &rarr; Server.</p>
${tw(['Variable', 'Default', 'Meaning'], SETTINGS.map(([a, b, c]) => `<tr id="env-${slug(a)}"><td><code>${esc(a)}</code></td><td>${esc(b)}</td><td>${c}</td></tr>`).join(''))}`);

sec('messaging-certification', 'Messaging certification and benchmark record', `
<p><strong>2.0.8 increment, 24 October 2026.</strong> A shared body codec handles JSON/XML/text/map/bytes. Exact XML text retains namespaces and attributes; malformed explicit formats become failed starter runs and follow the settlement policy instead of escaping an asynchronous callback. DTD/entities, multiple XML roots, undeclared entities, invalid XML characters and non-canonical base64 are refused. Designer test envelopes use the same representation checks. The expanded matrices passed <strong>66 native scenario executions</strong>: ActiveMQ 15 plain + 15 strict mTLS; RabbitMQ 9 plain + 9 strict mTLS; hosted Kafka 9 TLS/SASL PLAIN + 9 mutual TLS. All five formats, malformed-payload retry ceilings, acknowledgement modes, duplicates and listener/concurrency behavior are covered. The generated XML queue sample forwards exact XML before Confirm against ActiveMQ in both modes. Four broker REST checks also pass, including execution of all four REST samples. Kafka REST uses public trust, separately from the native broker private CA. Details and transcript hashes are in <code>docs/benchmarks/release-2.0.8-verification.md</code>.</p>
<p>Deployment validation and the direct engine entry (including in-memory dispatch) require exactly one starter. Legacy multi-starter documents are not registered by gateway, scheduler, listener, MCP, agent or channel entry points. A single starter can expose multiple event/operation ports. Real external PostgreSQL 17.2 and MariaDB 11.8.9 passed bound SQL query activities, Project/Engine connection properties and rollback paths with client TLS verification. The managed PostgreSQL endpoint negotiates client TLS 1.3 but reports an unencrypted pool-to-database hop; confirm the provider's internal policy. No new 24-hour soak is implied.</p>
<p><strong>SutraFlow 2.0.6 · verified 23 October 2026.</strong> This is SutraFlow's internal interoperability and reliability certification against real services. It records the tested implementation and configuration; it is not a broker-vendor certification or an assurance for every broker version. Publish message, Queue / topic trigger and Confirm message are exercised through the engine, including the settlement and durable duplicate-guard paths.</p>
<h3 id="messaging-protocols">Protocols, security and certified environments</h3>
${tw(['Service / environment', 'Protocol and client', 'Security actually exercised', 'Result'], [
  ['Hosted Aiven Kafka', 'Native Apache Kafka wire protocol through KafkaJS; consumer groups, partitions and committed offsets.', 'TLS with the provider CA and SASL PLAIN; separately TLS client-certificate authentication (mutual TLS, no SASL).', '7/7 scenarios in each mode; 14 successful scenario executions.'],
  ['RabbitMQ 4.4.0, local Windows service', 'AMQP 0-9-1 through amqplib; queues, topic exchange bindings and publisher confirms.', 'Plain TCP; separately strict private-CA mutual TLS through the test TLS proxy.', '8/8 scenarios in each mode; 16 successful scenario executions.'],
  ['ActiveMQ Classic 6.3.2, local Windows / OpenJDK 21', 'AMQP 1.0 through rhea for SutraFlow; two-way interoperability with a Java Jakarta Messaging (JMS-style) client over OpenWire. Classic AMQP connector uses transport.transformer=jms.', 'Plain AMQP TCP; separately strict private-CA mutual TLS through the test TLS proxy. The Java OpenWire probe uses the local TCP connector.', '13/13 scenarios in each mode; 26 successful scenario executions.'],
].map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join(''))}
<p><strong>Terminology.</strong> TLS secures a transport; mutual TLS also authenticates the client certificate. SASL is an authentication framework; PLAIN and SCRAM are mechanisms. AMQP 0-9-1 and AMQP 1.0 are different messaging wire protocols. OpenWire is ActiveMQ's wire protocol. JMS (Java Message Service, now Jakarta Messaging) is a Java API and message model, not an encryption protocol. Kafka uses its own wire protocol. Broker Java/Erlang runtimes are separate from SutraFlow's Node.js clients.</p>
<p>The local mutual-TLS fixture validates the client certificate and forwards the original broker protocol to the installed broker. It proves SutraFlow's CA trust, hostname verification, client-certificate and vault-key paths, but does not certify a broker-native Java keystore or RabbitMQ TLS-listener configuration. TLS versions and cipher suites were negotiated by the runtime; no specific version/cipher benchmark is claimed. SCRAM-SHA-256/512 is configurable, but the hosted service run exercised PLAIN and certificates. Artemis and other broker versions have not been certified by this record.</p>
<h3 id="messaging-reliability">Reliability scenarios passed</h3>
${tw(['Coverage', 'Verified behavior'], [
  ['All three brokers', 'Connect and authenticate; publish and consume; preserve body and supported metadata; auto acknowledgement does not replay a failed run; client acknowledgement retries failure; explicit confirm, requeue, reject and missing Confirm obey the selected boundary; retry ceilings; listener restart and concurrent batches complete without missing or duplicate runs.'],
  ['Kafka details', 'Key, headers, custom properties, partition and offset; delivery counts; commit on terminal rejection/ceiling; durable offset identity across consumer rebuild; 12-message partition-concurrency batch. Readiness waits for group join and the first completed fetch, preventing a new latest-offset group from skipping a message published immediately after ready.'],
  ['RabbitMQ details', 'JSON, text, map and bytes; message-id duplicate suppression; in-place nack/requeue attempt counting; TTL; durable topic queue binding; publisher confirms.'],
  ['ActiveMQ details', 'JSON, text, map and bytes; headers, properties and JMS destination normalization; message selectors; TTL; durable topic subscription while undeployed; unique container identities; Java OpenWire producer to SutraFlow AMQP consumer and the reverse.'],
  ['Shared guard tests', 'A duplicate belonging to an active/waiting run does not create another run. RabbitMQ/AMQP copies are held and settled when that run ends; Kafka pauses that partition. Custom duplicate keys and the missing-id rejection policy are covered. These use controlled fixtures in addition to the real-broker matrices.'],
].map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join(''))}
<p>The native matrices total <strong>56 successful scenario executions</strong> across six connection-mode runs. This is delivery correctness coverage, not exactly-once execution of outside effects. A crash between an outside write and acknowledgement can repeat that effect: use idempotency keys. Kafka reject/ceiling commits the source offset; retaining the event requires an explicit retry/dead-letter topic. Retry counters belong to the current consumer and are not a durable lifetime attempt count across leader restarts.</p>
<h3 id="messaging-rest-certification">REST integration and executable samples</h3>
${tw(['Endpoint', 'Passed operation / sample', 'Semantic boundary'], [
  ['Aiven Karapace-compatible Kafka REST over HTTPS / Basic auth', 'Publish; create consumer, subscribe, poll JSON records, commit offsets and close. Sample: Kafka REST publish and Sample: Kafka REST subscribe both execute successfully.', 'The REST endpoint uses a publicly trusted Let’s Encrypt chain; its trust configuration differs from the native broker CA. The example uses earliest for a new group; latest can skip records sent before initial offset establishment.'],
  ['RabbitMQ management HTTP API', 'Declare durable queue, publish, fetch with ack_requeue_false and delete the sample queue. Generated sample executes successfully.', 'HTTP fetch acknowledges at the API call, not at later workflow completion. Native AMQP provides the production trigger and publisher-confirm path.'],
  ['ActiveMQ Jolokia management REST API', 'Create queue, send text, browse, remove the exact message and delete the sample queue. Generated sample executes successfully.', 'Browse/remove is management automation, not JMS receive/ack. Classic 6.3 disables the deprecated MessageServlet by default for security; the sample keeps it disabled.'],
].map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join(''))}
<p><code>test/broker-rest.test.ts</code> passed <strong>4/4 checks</strong>: three endpoint workflows and one engine-level check executing all four generated REST sample Sutras. The local management APIs used HTTP on loopback; broker-native mTLS results must not be read as certification of HTTPS for those management endpoints.</p>
<h3 id="messaging-benchmark-scope">Benchmark scope and reproducibility</h3>
<p>The runs above are functional and fault-handling certification. They did not measure sustained messages/second, end-to-end p50/p95/p99, maximum queue depth, TLS CPU cost or long-duration broker-outage recovery. The earlier engine soak figures elsewhere in the documentation are not messaging-protocol benchmarks. A messaging performance result must state broker/client versions, partitions or prefetch/credit, payload size, acknowledgement mode, durability, TLS/authentication, engine count, database/network topology and duration alongside throughput, latency, errors, redeliveries and duplicates.</p>
<p>Reproduce native coverage with <code>test/kafka.test.ts</code>, <code>test/rabbitmq.test.ts</code> and <code>test/activemq.test.ts</code>; enable their opt-in environment variables and supply credentials through the test environment. REST coverage is <code>test/broker-rest.test.ts</code>. <code>test/connectors.test.ts</code> covers guard and TLS configuration failures. The Java OpenWire and TLS proxy fixtures live under <code>test/fixtures</code> and are test-only. Certificates, passwords and keys are not included in source, sample packages or this report.</p>`);

sec('testing', 'Tests', `
<p><code>npm test</code> compiles the server, then runs every suite with Node\'s test runner. The build first runs the offline vendor integrity gate. Connected CI and release jobs also run its npm freshness mode; a weekly workflow detects an upstream release without waiting for a code change. Multi-process suites start real servers (headless engines, clusters on one database, drain and failover). The PostgreSQL suite runs the in-process suites again on PGlite with shifted ports. Three suites run only when their tools exist: the Docker image build, a real PostgreSQL server through <code>SUTRA_TEST_PG_URL</code>, and DB Ops against a real MySQL server through <code>SUTRA_TEST_MYSQL_URL</code> (for example Laragon\'s). A guard test fails if names of other products appear in the source or documents.</p>
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
<!-- SutraFlow ${version} | Copyright (c) 2026-27 Surya Partap Singh | Developer: Surya Partap Singh | Website: MixAgile.com | License: GNU AGPL v3.0 only (SPDX-License-Identifier: AGPL-3.0-only) -->
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
