# SutraFlow 2.1.0 release notes

Prepared 2026-10-25. Copyright (c) 2026-27 Surya Partap Singh, MixAgile.com. AGPL-3.0-only; a commercial licence is available.

| Download | For |
|---|---|
| `sutraflow-2.1.0-windows.zip` | Windows 10, 11 and Windows Server 2019 or later |
| `sutraflow-2.1.0-windows-x64-offline.zip` | The same with the runtime packages inside, for servers without the npm registry |
| `sutraflow-2.1.0-linux.tar.gz` | Linux (x64 or arm64); also macOS |

Each comes with a `.sha256` file to check the download.

## What is new in 2.1.0

### Traceability in the Admin Console
- **Operate, Traceability**: each project's Sutras with their runs by outcome over an hour to 90 days, their runs, and each run as stored: what it started with, every step's input and output, error, try, time and engine, its reply and log, and the runs it called or was called by. Find a run by its id, by who started it, or by a value in its input such as an order number; download it as JSON.
- **Started by** is now kept with every run: the account (Run in the designer or Admin Console), the API client (policy method, caller, address, gateway app; anonymous where the route has no policy), the timer, listener, channel or alert, or the calling run. Older runs show the kind of starter only. Separate identities for anonymous callers remain on the backlog.

### Connection limits cover the work behind the scenes, listeners and background jobs
- **Behind the scenes**: a step is counted on the connections it selects *and* on those their settings select: a knowledge base with its vector database and its AI provider, an AI memory with its database and summary provider, a memory table with its database. An AI agent or Search knowledge step is held back when the database behind its knowledge base is full. All the places a step needs are taken at once or none, so two steps never block each other halfway.
- **Listener polls** (SFTP/FTP folders, mailboxes, Google Drive, OneDrive/SharePoint, Discord, Twitch, Data Factory) take a short lease for each poll, renewed while it runs. With no room the poll is skipped, the trigger's status says why, and the next poll tries again; nothing is lost.
- **Scheduled memory-table refreshes** take a lease on the table and its database, waiting up to a minute for room.
- **Subscriptions hold no place** (Kafka, RabbitMQ, ActiveMQ / AMQP 1.0, WebSocket client, Telegram), so a limit of 1 never blocks a subscriber's own Sutra; the steps of the runs they start count as usual.
- **Generous waiting**: a waiting step keeps its place in the queue without using a retry attempt or holding a worker, and its timeout (10 minutes for AI steps) starts only when it runs. Waiting steps are checked again with a pause growing up to 5 seconds. Durable waits (approvals, timers, Call Sutra, agent tools) give the place back.
- **Leases survive a crash safely**: renewed every 30 seconds, they run out 2 minutes after an engine stops; a lost lease stops its poll.
- **Project properties**: a limit can be `{{gv.CRM_LIMIT}}`, so each server has its own value; an invalid value fails the step that needs the connection with a message naming it, and shows in the Admin Console.
- **In-memory Sutras** still refuse a limited connection (fail closed), now also when the limit is on a connection behind the one selected, with a message naming it.
- **Admin Console, Operate, Connection limits**: every limited connection across all engines with its limit (and the property behind it), use by steps and by listener or background work, waiting steps with their reason (for example *Waiting for Orders DB (used through Manuals): 2 of 2 in use*) and a graph of use, waiting and limit over 1 hour to 7 days. The leader samples every 30 seconds and keeps 7 days.
- **User guide**: a new chapter, *Connection limits*, compares this limit with pool size, rate limits, Runs at once, Messages in parallel and Steps at once, lists exactly what counts, explains the effect on listeners and background work, and suggests values per kind of connection.

### MongoDB Bulk Write
- **Bulk write MongoDB documents** sends up to 1000 insertOne, updateOne, updateMany, replaceOne, deleteOne and deleteMany operations to one collection in one request, ordered (stop at the first failure) or unordered. It applies the guards of the single activities (operators for updates, plain replacement documents, no server-side JavaScript, an explicit opt-in for an empty updateMany/deleteMany filter) and strict schema validation of inserted and replacement documents before anything is sent. Any failed operation fails the step with the counts already written and the first errors, so a partial write is never shown as success. Tested live on Atlas M0; the shipped MongoDB sample uses it.

### Admin Console graphs with Apache ECharts
- The Overview's runs and gateway graphs and the new Connection limits graphs use Apache ECharts 6, bundled into the console (no CDN; works offline), coloured from the theme and redrawn when it switches.

### Security
- **Agent conversations belong to their caller.** A conversation that comes through an agent channel (chat page and API, OpenAI-compatible API, MCP, A2A, a hand-off) is kept in AI memory under the authenticated caller, the project and the agent as well as its session id. Another caller sending the same session id starts a conversation of their own. The session id people see is unchanged. Conversations saved before 2.1.0 under a bare session id are not shown to anyone through a channel any more (they stay in the store until its days to keep run out).
- **A job's answer only for the caller who started it.** Asking for a job (chat jobs, OpenAI-compatible `status <id>`, MCP `job`, A2A `tasks/get`) with another caller's job id answers "no such job", as for an id that does not exist.
- The caller includes its **realm**: the security policy that let it in and, for tokens, their issuer. Two identity providers that know the same subject are two different owners.
- Callers without a security policy are all one anonymous caller: their conversations and jobs are protected only by unguessable session and job ids. Put an API security policy on public channels, or wait for visitor tokens (backlog).
- **Connections stay in their project.** A step, a listener poll or Test connection can use connections of its own project and connections that belong to no project (shared), never another project's, however the id arrives (a setting, a property, run data, a connection behind a connection). Saving a connection that points at another project's connection is refused.
- **Mappings cannot reach JavaScript's object machinery.** A target path, a formula's `object()` or a schema field named `__proto__`, `prototype` or `constructor` is refused or ignored, and permission checks trust only flags a caller really holds.
- **Git imports read only the repository.** A schema file, a sidecar or a symlink that points outside the cloned repository is refused before anything is read.
- **Sign-in return paths are plain paths.** The address a person returns to after single sign-on may contain only ordinary path characters, and the page that sends them on escapes it for its script and its link.
- **Zip files are read within limits.** Office documents (64 MB per entry, 256 MB in all, 5000 entries) and release packages (256 MB, 1 GB, 10,000 entries) are refused when an entry unpacks past its limit, measured on the real output, before the memory is used.

### Documentation
- **User guide for the people who use SutraFlow**: Sutra designers, administrators, approvers and, later, developers using the developer portal. A new section in *Mapping data* explains picking data: paths, repeating elements (one item, the last, those that match, a field of every item, totals), filters, For-Each with `{item}`, `{index}` and `{outer}`, and pipes, with the two counting rules (from 1 in formulas, from 0 in text templates). *How a Sutra runs* now describes what designers see; the engine's internals moved to the architecture page.
- **Sutra-Contributor Information** (`docs/Sutra-Contributor Information.html`, in the source repository, generated with the guide) is new: building from source and development mode, where the code is, file headers and overviews, tests and their real-service settings, security rules for contributors, vendored packages, release builds, and the load, soak and big-file test tools. These moved out of the user guide. It is not part of the release packages.
- **Architecture page, The engine**: workers and the two engines, the ten stages of a step (start, queue, claim, admission, prepare, execute, checkpoint, route, wait, finish) with their code and what is stored, retries and recovery, guarantees and limits.

### Backlog
- `docs/backlog.md` is prioritised with MoSCoW. The MongoDB query preview and connection limits for in-memory Sutras were set aside (Could have); an ECharts palette and dashboard hosting are planned for discussion (Should have).

### Database
- Additive: columns `kind`, `holder`, `project`, `since` and `expires_at` on `connection_permits`, and the tables `connection_waits` and `connection_usage`. Existing data is unchanged. Upgrade every engine together: 2.0.11 engines do not know leases and would remove them.

### Fixes in 2.1.0

| What you would have seen | Cause | Now |
|---|---|---|
| A connection limit did not hold back an AI agent or Search knowledge step whose knowledge base used the limited database or AI provider. | Only connections a step selected itself were counted. | Connections behind the selected ones are counted too, all at once or none. |
| Listener polls and scheduled memory-table refreshes used a limited connection beside the steps, so the system behind it saw more than the limit. | Listeners and background work were not counted. | They take a lease for each poll or refresh and are skipped (or wait up to a minute) when there is no room. |
| Many steps waiting for one limited connection kept every engine busy re-checking them at its poll interval. | A waiting step went back to the queue with the same short pause every time. | The pause grows up to 5 seconds, and the reason the step waits is recorded. |
| With the engine database across the internet (650 to 750 ms per operation), work on limited connections crawled and could starve: a lease took 1.2 s to take and 0.7 s to give back, and everything queued behind one lock. | Every admission, lease and release took one cluster-wide lock and cleaned up old rows first, about six round trips each. | One lock per connection (several in id order), admission counts only what still holds a place in four round trips, a release needs no lock, and the leader cleans up every 30 s. Measured on a remote PostgreSQL: a lease 864 ms, a release 163 ms, four capped steps 12.5 s instead of 15.8 s. |
| The Admin Console could not show what used a limited connection or what waited for it. | Permits were not visible anywhere. | Admin Console, Connection limits. |
| The two-engine connection-limit test could, rarely, see a step run twice. | The test's second engine sent no heartbeat, so the leader handed its running steps back as orphans (correct for a dead engine). | The test engine heartbeats; the test also checks that every step runs exactly once. |
| Two callers of a published agent who sent the same session id shared one conversation history. | AI memory was keyed by the session id alone. | Conversations from agent channels are keyed by caller, project and agent as well. |
| A caller who learned another caller's job id could read that job's answer. | A job was checked against the agent's Sutra, not against who started it. | The caller must be the one who started the job; anyone else gets "no such job". |
| A designer of one project could, through a Map target such as `__proto__.all`, change an object shared by the whole server process and make other people's permission checks pass. | Mapping paths were followed into JavaScript's object prototype, and permission checks accepted an inherited flag. | Such path segments are refused or ignored everywhere data is read or written, and only a flag the caller object owns grants anything. |
| A Sutra of one project could use another project's connection (its credentials and data) by its id. | Connections were checked for existence and kind, not for their project. | Steps, listener polls and Test connection run as their project and may use only its own and shared connections; saving a cross-project reference is refused. |
| Importing a Git repository could copy a file from elsewhere on the server into a project as a schema. | A schema sidecar's file name (or a symlink) was joined to the repository path without checking where it led. | Only files inside the repository are read: relative paths, no `..`, symlinks never followed. |
| A crafted single sign-on link could run a script on the page shown right after signing in. | The return path could contain `</script>`, and the page wrote it into a script unescaped. | Return paths may contain only ordinary path characters, and the page escapes them for script and HTML. |
| With two identity providers on one agent, two people with the same user name could see each other's agent jobs and conversations. | The owner of a job or conversation was the subject alone, without the provider. | The owner includes the realm: the policy and the token issuer. |
| A small uploaded document or release zip could unpack to gigabytes and exhaust the server's memory. | Zip entries were unpacked without a size limit. | Per-entry, total and entry-count limits, measured on the real output. |
| *(found before release)* A connection limit naming a Secret property, or an invalid limit, could show the property's value in an error message to anyone watching the connection. | The error repeated the resolved value. | Secret properties are refused in limits (on save and at run time) and the message describes the problem without the value. |
| *(found before release)* On a connection shared by all projects, the Admin Console showed the names of other projects' Sutras, steps, runs and listeners. | Usage details were not filtered by the viewer's projects. | Other projects' work is counted but shown only as "Work of another project". |
| *(found before release)* When the engine database stopped answering, a listener poll could go on after its lease had run out, beside work that took its place. | Failed renewals were ignored until the database answered again. | The work is stopped a quarter of the lease before the expiry the database holds, unless a renewal reached it. |
| *(found in the 2.1.0 soak)* Two DB Ops transaction steps running at the same time on one SQLite connection could fail with "cannot start a transaction within a transaction", and a plain statement of another step could become part of a transaction that was still open. | A SQLite connection is a single database handle, and a transaction stays open while its step works through its statements; nothing kept other steps out meanwhile. | Each SQLite connection runs one transaction or statement at a time, in turn; PostgreSQL, MySQL, SQL Server and Oracle already give each transaction its own pooled connection. |
| *(found in the 2.1.0 soak)* During a 20-second cut of the engine database, one engine stood still for 23.6 seconds: no request, listener or step moved on it. | Some work reads the engine database synchronously; after a lost connection the database worker tried 10 times with growing waits (about 40 seconds) while the engine waited. | After a lost connection a statement tries once with a short time limit and fails at once; the work around it retries on its own. An administrator can set tries, wait between them and time per try (Admin Console, Database), and the page shows the longest pause they give. Start-up still tries 10 times. |
| *(found in the 2.1.0 soak)* Engine memory grew with the number of runs finished, faster on engines that only helped with runs. | Each engine kept the Sutra document of every run whose steps it ran; only the engine that ended a run dropped it. | Documents of runs are dropped once unused for 10 minutes (a run still going reads its document again). A test checks that the garbage collector frees finished runs. Waiters for a run removed by retention are answered instead of kept. |
| *(found in the 2.1.0 soak)* Knowledge search in PostgreSQL slowed as the knowledge base grew (1.7 s to 26.6 s at 457,034 passages). | The pgvector table had no search index, so every search compared each passage. | New tables get an HNSW search index; existing tables are indexed from Admin Console, Knowledge search (or a Remove knowledge step, build search index). Searches use iterative scans, so a small knowledge base in a shared table keeps its full results. Needs pgvector 0.8. |
| *(found in the 2.1.0 soak)* A Kafka publish failed when a hosted broker dropped the connection while signing in. | The error went straight to the step. | Nothing was sent then, so the message goes once more on a new connection; other errors are the step's, as before. |
| *(found while fixing the soak findings)* A memory-table change could stay in memory while its database copy failed to take it, so other engines, and this one after a crash, lost it. | The change was made in memory before it was written to the copy. | A change the copy does not take is taken back from memory and the step fails; its retry makes it again. |
| *(found in the 2.1.0 soaks)* A Kafka subscriber on an existing topic missed messages: 1 of 118 in six hours, 3 of 8 in ten minutes with an engine kill and a database cut. | A new consumer group has no committed offset on a partition until its first message there is handled; when the partition moved to another engine, the new owner started at "latest" and skipped what had arrived. | When a Sutra starts listening (not from the beginning), the topic's end is recorded as the group's starting point, so every later owner resumes from there. |
| *(found in the 2.1.0 ten-minute soak)* After a database cut moved the cluster leader, the ActiveMQ subscriber stopped receiving; 271 messages waited in the queue. | The new leader opened its listener under the same AMQP container id the old leader still held, ActiveMQ refused it, and a listener that failed to start was never tried again. A failed start also left its connection reconnecting in the background. | Queue listeners get a container id per engine (durable topic subscriptions keep theirs); a listener that fails to start is tried again (5 s doubling to a minute) until it starts; a failed start closes its connection. |
| *(found in the 2.1.0 ten-minute soak)* During a database cut, an engine stopped; runs stayed "running" with every step done; steps stayed "running" on a live engine. | A statement now fails at once when the database is away (see above): a timer's read went uncaught, and closing writes that failed were never retried; a step that failed to prepare stayed listed as running in its engine. | Database-unreachable errors in timers are logged and tried at the next tick; the leader closes runs whose steps all ended, each engine puts back steps it no longer runs, and a step is never left listed as running. |
| Docker and guide examples named older versions (2.0.4, 2.0.7). | They were not updated with each release. | They name 2.1.0. |

## 2.1.0 release gate

Source verified 25 and 26 October 2026 on Windows (Node.js 24.21).

- Full suite after the security fixes (26 October): **504 cases, 493 passed, 9 skipped**; the 2 failures were the README test count (one direct, one in the PGlite pass), corrected and rerun. With real PostgreSQL 18 and MySQL 8.4 together, the password-and-SSL PostgreSQL migration (Laragon's PostgreSQL binaries) and the live MongoDB Atlas M0 suite, which includes Bulk Write. The 9 skips need services not set up on this machine: a Linux Docker daemon, Kafka, RabbitMQ and ActiveMQ brokers with their REST checks, and the remote-database scenario.
- The PostgreSQL-compatible (PGlite) pass runs every in-process suite again, including the new connection-limit and security suites.
- Security review findings: each is reproduced by a test that now fails safely (`test/security210.test.ts`, the two-caller tests in `agentchannel.test.ts`, and `connlimits.test.ts`).
- Connection limits on a **remote PostgreSQL across the internet** (about 70 ms per round trip, 500 to 700 ms per transaction): before the security fixes 10 of 10 passed; after them 12 of 13, the lease test stopped once while the pooled endpoint dropped a connection ("server conn crashed?"), as the renewal deadline intends, and passed in two reruns. A probe on the same database showed a 6-second lease renewed every 0.75 s in about 80 ms and held for 13.5 s. The suite measures the database and stretches its time budgets (15 times over the internet); its temporary databases were removed.
- Connection limits on local PostgreSQL with two engines: repeated 10 times, every step ran exactly once and never beside another under a limit of 1.
- Type checks, production build, `npm audit` (0 vulnerabilities), file-overview drift check and documentation generators passed. The Admin Console's Connection limits page and ECharts graphs were checked in a browser on a separate test instance (light and dark theme, no console errors).

Not covered: Linux runtime, the 24-hour remote soak (Must have in the backlog), and certification of the connectors behind the skipped suites.

## Previous release: 2.0.11

Packaged and deployed to 4800 and Laragon 4810 on 25 October 2026; see `docs/releases/2.0.11-deployment.md`.

Core scope: schema-boundary audit, durable per-resource activity admission and code-maintenance housekeeping. Generic Map, MCP input/result, AI Guard and SOAP request/response/reply boundaries now have explicit enforcement; descriptive defaults remain compatible. Connection limits are shared by durable task claims across engines, acquire multiple explicit resources atomically and queue excess work without retry/worker consumption. Capped resources reject in-memory execution rather than silently bypassing admission. Limits do not cover implicit nested integrations, listeners or admin traffic and do not retract external side effects.

First-party files now carry maintainable overview comments with purpose/support, connected imports and function entry points. Non-comment configuration formats have a companion code-navigation index; generated/vendor/private files are excluded. A check-only regression detects drift. The 2.0.10 backlog/deployment history is reconciled with the actual 4800/4810 receipts.

Verification: 437 passed, 0 failed and 27 optional skips in the full suite (including the PostgreSQL-compatible suite); six additional real local PostgreSQL cases passed. Production build, type checks, documentation generators, overview/header gates and dependency audit passed. MongoDB read-only query preview and mixed Bulk Write remain optional next work, not claimed as implemented. X.509 live testing stays deferred. No 2.0.11 deployment or release package is implied by this source change; final evidence and limits are recorded in docs/releases/2.0.11-verification.md.

## Previous release: 2.0.10

Prepared 2026-10-24. Copyright (c) 2026-27 Surya Partap Singh, MixAgile.com. AGPL-3.0-only; a commercial licence is available.

## 25 October usability revision — verified for packaging

Aggregate input follow-up: pipeline help and guide examples distinguish database stages from incoming records. Source lines recognize run/process aliases; previews require current-run context and discard obsolete responses. MongoDB design-time output shapes follow Find/Count/Distinct and Update operation choices, with declared result schemas exposed without collection sampling. Sample descriptions explicitly identify final Delete cleanup. Focused checks: eight passed plus one optional skipped; separate live M0 checks: eight passed. See [Aggregate input verification](docs/releases/2.0.10-aggregate-input-usability.md); this focused follow-up does not replace the earlier full-suite release evidence.

Named Secret connection refinement: credential dropdowns show Secret GVs and administrator Secret EVs, not vault implementation keys. A permission-checked API stores each named project Secret and its backing reference transactionally, reuses that property's entry on rotation and prevents cross-project name collisions. Existing legacy references are preserved. MongoDB diagnostics distinguish DNS failure before authentication from credential-bearing public server URI misuse. Administrators can explicitly set SUTRA_DNS_SERVERS for the Node process only; no operating-system DNS change or implicit public-resolver fallback is made.

Follow-up project-variable correction: the variables Save button encrypts pending Secret text and persists its reference in the same workflow. Failed Secret storage aborts the property save. Existing variables start collapsed with +/− controls; new variables open for editing. Stable editor identities prevent one row inheriting another row's Secret draft after deletion. A selected reference is retained even if it is not listed in the current secret catalogue. The isolated browser save→refresh case and 16 focused credential/project tests passed; this is additional focused evidence, not a new full-suite or external-service recertification.

- MongoDB palette/connection branding is generic; Atlas M0 remains the tested baseline, not an implied compatibility certificate for other services.
- Separate host/SRV/port, username/password and complete-URI configuration, plus X.509 certificate/key options, private CA trust and read preference. Non-TLS is restricted to direct loopback development. No automatic database-user provisioning or admin grants.
- Secret project/engine properties can store encrypted values directly from their editors. Connection credential slots prefer Secret properties and resolve their vault reference once. Inline secret entry is available on other connection forms too. Values are masked by default; an eye reveals only text being entered, never retrieves an existing stored password. Existing permissions remain unchanged.
- Project variable editors use full-width cards so names, types and Secret entry remain readable in the narrow Designer panel.
- Credential lookup failures withhold supplied reference/value text instead of echoing a credential-bearing URI. Existing complete-URI configurations remain compatible.
- New List Collections activity and sample coverage; mapped collection input takes precedence over General configuration. Updates support array filters and findOneAndUpdate with Before/After documents.
- Aggregation remains read-only/no-spill in the M0 baseline. General MongoDB capabilities require explicit disk/output-stage opt-in and server authorization; X.509 and these advanced deployment options need separate live certification.
- The updated sample imports a Secret MONGODB_URI project property and does not replace a customized existing property or connection. The usability revision was deployed to 4800 and Laragon 4810 on 25 October with fresh backups and preservation checks; see the [deployment receipt](docs/releases/2.0.10-usability-deployment.md).
- Verification: 427 passed, 27 optional skipped, zero failures in the full regression; eight live M0 checks passed; final build/type checks and documentation generation passed; dependency audit found zero vulnerabilities. Live X.509 testing is explicitly deferred. P1/P2 MongoDB expansion remains in the backlog. See the dated verification amendment for scope and limitations.

## Implemented for verification

- Manual start has explicit strict schema validation. Engine admission rejects invalid configured/supplied input before creating a run; execution rechecks the actual payload. Off remains descriptive for existing flows, with an explicit warning.
- Strict contracts are project-scoped, do not coerce/remove/default data, and reject unsupported JSON Schema validation keywords instead of silently ignoring them.
- REST, SOAP and WebSocket reject-invalid modes also apply to direct engine, Test/Debug and Run API inputs, closing gateway-only enforcement gaps. SOAP admission uses real XSD pattern/namespace validation.
- Call Sutra has independent strict input/result controls, including resumed child results; Return and internal channel send/receive also have explicit contract controls.
- Strict local/remote file triggers reject invalid parsed test events and read-error envelopes before downstream processing. Strict file reading with an incompatible format fails explicitly.
- The source browser consolidates the unique immediate predecessor into current input. Earlier/parallel sources remain separate; existing named-output formulas remain valid.
- Native MongoDB connection and five M0-verified document activities: insert; find/find-one/count/distinct; update/update-many/replace/upsert; delete; read-only aggregation. TLS is verified, URI credentials use the vault, clients are pooled with bounded operations, and BSON is preserved as Extended JSON.
- Credential-free, run-ID-scoped MongoDB sample with imported strict starter schema, query modes, update, aggregation and precise deletion. New typed mapping imports also enable strict starters; customized imports are not overwritten.
- A regression inventory records every schema-aware activity/field so new contract fields require explicit review and negative tests.

## Scope and verification status

Live Atlas M0 seeded engine checks passed on MongoDB 8.0.34, including CRUD/query/aggregate behavior, duplicate-key rejection, strict invalid-input/no-write and invalid-output behavior, and the executable lifecycle sample. M0 driver-level probes also passed transaction rollback, change streams and a small GridFS round-trip; these are not finished/certified activities and are not exposed in the palette.

The default local DNS resolver refused SRV lookups; live verification used a process-local alternate resolver. Windows DNS and Atlas permissions were not changed. This environment caveat must remain in certification.

Build and server/web/test type checks passed. Full regression passed with 424 passed, 27 optional skipped and no failures; the separate opt-in Atlas gate passed all seven checks. Dependency audit reports zero vulnerabilities. The guide and architecture are regenerated. See [verification scope and limitations](docs/releases/2.0.10-verification.md).

Every exposed MongoDB activity is covered by the lifecycle sample, available both in the sample catalogue and as `samples/mongodb-m0-document-lifecycle.zip`. Its connection contains only a vault-secret name, never credentials.

The broader schema-boundary audit, advanced durable MongoDB activities and fresh interactive UI review remain in the canonical backlog. Packaging and deployment to Laragon 4810 are the current user-requested handoff; 4800 is not part of this upgrade. No commit/tag is made.

Previous release: [2.0.9](docs/releases/2.0.9.md).
