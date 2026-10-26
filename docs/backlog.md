# SutraFlow planned backlog

This is the canonical list of work that is intentionally not complete, prioritised with MoSCoW: **Must have** (the next release is not done without it), **Should have** (important, planned next), **Could have** (worth doing when there is room; proposals set aside for now land here), **Won't have (this time)** (decided against, recorded so they are not re-proposed by accident). Completed work belongs in `RELEASE-NOTES.md`, not here; an item that ships is removed in the same change. Updated for 2.1.0, 25 October 2026.

## Must have

- [ ] **Web installer and upgrader (2.1.1).** A browser-based installer, in the style of a Joomla installation, so a new server needs no command line after the package is unpacked:
  - **Install:** checks the system (Node.js version, free ports, writable data folder, file permissions); the first administrator (user name, password with strength rules, email); the engine database (SQLite, or PostgreSQL with host, port, database, user, password and SSL off, require or verify) with **Test connection**, making the database when allowed and the tables; the master key and admin token made and shown once for safe keeping; server name, environment, admin and gateway ports, TLS choice; optional sample projects. It writes `sutraflow.env` and locks itself when done (it cannot run again without a reset step on the server).
  - **Upgrade:** from 2.1.0 onwards, it recognises an existing installation and shows its version, database and data counts; checks that it can stop the running engines gracefully; takes a backup (data folder, `sutraflow.env`, and for PostgreSQL a dump checked by listing it); moves the old runtime aside rather than deleting it; installs the new runtime, applies database changes and compares counts and content before and after (projects, Sutras, deployments, schemas, connections, secrets, users, settings); then starts and checks health. A failed step leaves a one-click way back. It writes any new `sutraflow.env` values with their defaults.
  - **Engine clusters:** sets up a cluster in the same flow: the shared PostgreSQL, the studio and headless engines (their ids, ports, whether they may lead), worker counts, heartbeat and drain settings, and gateway addresses behind a proxy; it produces the `sutraflow.env` (or service file) for each further engine with what that machine needs, and a join check that each engine sees the others. It can add an engine to an existing cluster later.
  - **Also:** a clear summary page of what was done, a log to download, the same steps as `sutraflow` commands for automated installs, an offline mode (the offline package), and a guide chapter. Upgrades before 2.1.0 keep the manual steps in the deployment receipts.

- [ ] **2.1.0 release gates.** Full regression suite on SQLite, PGlite and a real PostgreSQL server (including `connlimits-pg.test.ts` with two engines and a limit of 1), live MongoDB M0 suite with Bulk Write, release archives, clean-install and upgrade-from-2.0.11 checks on SQLite and PostgreSQL, then deployment to 4800 and Laragon 4810 with preservation snapshots, as for 2.0.11 (`docs/releases/2.0.11-deployment.md`).
- [ ] **Anonymous visitors on agent channels.** Since 2.1.0, conversations and job results of authenticated callers are bound to their realm (policy and token issuer), caller, project and agent. Callers without a security policy are still one anonymous caller, protected only by unguessable session and job ids. Give each anonymous browser or client its own signed visitor token (see Opaque conversation tokens) and bind memory and jobs to it; add tenant to the binding once tenant mapping exists.
- [ ] **24-hour remote-PostgreSQL soak — release gate.** Run `tools/soak.mjs` for 24 hours with PostgreSQL on a separate machine. Preserve the generated report and verify recovery, latency, memory, duplicate-step and database-log assertions. Include capped connections (steps, polls and a scheduled refresh) in the scenario.
- [ ] **Linux runtime test.** The Linux archive is packaged on every release but has not been installed and run on Linux. Install, set up, start, upgrade and run the regression suite on a Linux machine.

## Should have

- [ ] **Large broker messages without blocking the engine.** In the 2.1.0 ten-minute soak, 2 MB bodies on every fourth RabbitMQ and ActiveMQ message (about 1 MB/s) raised event-loop p99 from 36–42 ms to 400–780 ms and doubled engine CPU; every message still arrived whole. A body is copied and serialized several times (publish run input and step data, broker, subscriber run input and step data). Keep large bodies out of run data (a reference to a file or the message store, read on demand), parse them off the main thread, and document a size guide. Also check the ten-minute WebSocket broadcast count (185 of 190 with an engine kill; the six-hour run passed) by fault window.

- [ ] **Connection limits for in-memory Sutras (2.1.1).** In-memory Sutras refuse a limited connection today (fail closed). Keep their payloads and results in memory but store a small permit record in the shared engine database, so memory and durable Sutras respect the same cluster-wide limit; when the engine database cannot be reached, capped in-memory work waits or fails clearly, never bypasses the limit. Test mixed memory and durable work on a limit of 1.
- [ ] **Connection limits at the connector boundary (2.1.1).** Admission is checked per step today, including connections behind the one selected, so nested calls never count twice; parallel calls inside one step (an AI agent calling tools at once, RAG fan-out) share one place. Move admission to the shared client boundary so genuinely parallel calls take separate places while nested calls still do not double-count; keep the all-or-none order that prevents deadlocks.
- [ ] **Connection-limit verification gaps (2.1.1).** Add explicit tests that cancellation and an engine crash give places back (permits of a stopped engine freed by lease expiry or orphan recovery), and run the limit-of-1 matrix (memory and durable, two engines, listener backpressure, nested calls, cancellation, crash, database outage) on PostgreSQL in CI.

- [ ] **1-hour hosted Kafka soak (gentle).** Run `tools/soak.mjs` for one hour against the hosted Kafka trial service (TLS with client certificate, free tier): one publish and subscribe every few minutes, a topic of its own, at-least-once delivery checked end to end. The soak tool's `--kafka kafka://user@host:port?sasl=scram-sha-256&ca=ca.pem` option does this (password from `KAFKA_PASSWORD`; optional `cert=`/`key=` files for mutual TLS); connection details are collected and a SASL/SCRAM-SHA-256 connection over verified TLS works. Kafka now also runs gently inside the 6-hour 2.1.0 soak, reusing an existing topic (`topic=`); the dedicated 1-hour run remains to do. Keep the credentials outside the repository.
- [ ] **Kafka: one message without a finished subscriber run (6-hour 2.1.0 soak).** 118 published, 117 subscriber runs done, 0 failed, yet the consumer group committed every partition to its end offset. Either an offset was committed without a run that finished (an at-least-once gap, most likely around the planned engine kill at 120 min or the database cut at 240 min), or the run ended in another status. The soak's check now prints every subscriber run status; repeat the Kafka run with both faults, keep the soak database, and match message keys to runs.
- [ ] **Vector index for pgvector knowledge bases.** Search scans the whole table (no HNSW / IVFFlat index): in the 6-hour soak the table grew to 457,034 passages and search p95 went from 1.7 s to 26.6 s. Create an HNSW index (`vector_cosine_ops`) for new tables, offer it for existing ones as an explicit, admin-started step (building it on a large table takes time and blocks writes), and document sizing.
- [ ] **Engine event loop stalled 23.6 s during the database cut.** In the 6-hour 2.1.0 soak, engine 2 reported one 23.6 s event-loop wait in the minute of the planned 20 s database cut (240 min); the other engines did not. Find what ran synchronously while the database was away. Also watch memory: engine 2 grew 52 MB per hour over the second half (it restarted at 121 min, so this includes warm-up; engines 0 and 1 grew 36–40 MB per hour, peak 1,078 MB); repeat with heap snapshots.

- [ ] **ECharts palette and dashboard hosting — to discuss after 2.1.0.** The Admin Console graphs use Apache ECharts since 2.1.0 (bundled, offline). Next: a palette that turns rows into chart options (and, optionally, an SVG image rendered on the server for e-mails and reports), and dashboards served by the gateway with ECharts from SutraFlow itself, never a CDN. Settle first: who may see a dashboard (API security policies), whether AI-written chart options are accepted and how they are checked, refresh and caching, and image export. Starting point: `docs/ai-echarts-dashboard-guide.md` (method 2; its CDN examples must become self-hosted).
- [ ] **MCP conversation binding.** Bind an agent tool's returned session to the authenticated gateway application and caller. Define how clients such as ChatGPT, Claude, Copilot, Antigravity and Cursor continue a conversation, without assuming that the MCP transport session is a user identity.
- [ ] **Opaque conversation tokens.** Issue signed, opaque tokens for public chat sessions. Anonymous visitors need a device/browser identity without being represented as a verified person.
- [ ] **First-class tenant mapping.** Add an optional tenant/customer identifier to gateway applications and configurable trusted JWT/OIDC claims. Keep this distinct from Microsoft Entra's connection tenant setting.
- [ ] **Document the two agent patterns.** Clearly distinguish public customer-service agents, where SutraFlow owns the conversation, from MCP skills that extend an outside assistant, where that assistant normally owns the conversation and SutraFlow supplies governed integrations.
- [ ] **MongoDB P1 — durable change streams.** Leader-owned listeners, persisted resume tokens and atomic run/checkpoint bookkeeping, failover fencing, invalid-token recovery, replay/idempotency and duplicate handling. Promise at-least-once delivery with an explicit deduplication contract, not exactly-once merely because resume tokens exist. As a subscription it holds no connection-limit permit; its runs' steps do.
- [ ] **MongoDB P1 — Atlas Vector Search / RAG backend.** Dedicated similarity activity plus knowledge-store integration, embedding dimensions/model/index agreement, authorization filters, index readiness and real vector-index tests. Require supported Atlas capabilities; renaming the palette does not certify DocumentDB/Cosmos compatibility.
- [ ] **Build the real Docker image.** The Docker configuration and compiled-server smoke test pass, but the release machine has no compatible Linux Docker daemon. Build and start the image on both the single-server and cluster Compose paths.
- [ ] **Let's Encrypt staging certification.** Exercise a real public domain, port 80 HTTP-01 challenge, issuance, renewal and multi-engine certificate reload against the Let's Encrypt staging service.
- [ ] **Extend real-service connector certification.** The 2.0.8 record covers 66 native scenario executions across ActiveMQ 6.3 plain/mTLS, RabbitMQ 4.4 plain/mTLS and hosted Kafka TLS/SASL/mTLS, including all five formats and malformed-payload retries; four broker REST checks also pass. External PostgreSQL 17.2 and MariaDB 11.8.9 TLS/bound-query/rollback and engine-activity checks pass, without replacing the remote 24-hour soak. Certify SQL Server, Oracle, IMAP, Qdrant, Chroma and Pinecone, followed by Google, Microsoft, Dropbox, YouTube, Twitch, Discord, Telegram, Facebook, Azure Data Factory and Databricks APIs. Record service/version, test date and limitations rather than treating a stand-in as certification.
- [ ] **Push-based Twitch and Discord triggers.** Replace or complement polling with the providers' supported event/webhook mechanisms. Keep durable polling or reconciliation where it is needed to recover missed events.

## Could have

- [ ] **MongoDB read-only query preview — set aside 25 October 2026.** Try a Find or Aggregate in the activity editor without running the Sutra: the activity's own connection, database and collection; limits on records, response size and time; write operations and `$out`/`$merge` refused; results temporary, never runtime input or saved in the Sutra. Not convincing enough for now: a test run in the designer already shows the same result.
- [ ] **Connection limits for in-memory Sutras — set aside 25 October 2026 (risky).** A small permit record in the shared database would let in-memory steps share a limit with durable ones, at the cost of database round trips on the fast path and a hard dependency on the database for in-memory work. Until then an in-memory step whose connection is limited is refused (fail closed), never run unlimited.
- [ ] **MongoDB X.509 live authentication test — deferred by user (25 October 2026).** Configuration/unit checks do not constitute live X.509 certification. Resume only when requested, using an authorized database client certificate and matching database user; do not provision users or grant admin privileges automatically.
- [ ] **MongoDB certification expansion.** Document activities, List Collections and Bulk Write have live M0 evidence. Certify private-CA self-hosted TLS, non-TLS loopback development, General-profile disk/output stages and other read preferences against real deployments, plus pool/cancellation stress tests. API management keys are not database credentials. No automatic admin grants, MapReduce or server-side JavaScript.
- [ ] **MongoDB P2 — streaming Find.** Bounded batches and durable stable-key checkpoints with an explicit concurrent-update consistency policy. Ordinary Find cursors do not have change-stream resume tokens and must not be serialized across restarts. Test million-record bounded-memory behavior, cancellation and restart recovery.
- [ ] **MongoDB P2 — transaction scope.** Design a single-execution/session boundary with retry/idempotency rules; sessions cannot be persisted through arbitrary waits or distributed steps. Verify multi-collection rollback and failover on a supported replica set before exposing transaction activities.
- [ ] **MongoDB P2 — index management / GridFS.** List/create/drop indexes with explicit destructive opt-in, unique/compound/TTL tests and privileges; bounded GridFS upload/download/delete with cleanup and cancellation. Existing driver probes alone do not certify these activities.
- [ ] **Developer chat SDK.** Keep the existing zero-code chat page and `widget.js`, and add a small browser SDK for custom public-facing chat interfaces: authenticated requests, conversation tokens, history, job polling, attachments, cancellation and structured errors.
- [ ] **Conversation operations UI.** Add an access-controlled Admin Console view for conversation metadata, usage, retention, deletion, failures and human hand-offs. Do not expose message content merely because someone can operate the server.
- [ ] **Developer portal.** Build a consumer-facing portal around the existing OpenAPI output, service discovery, application registration, credentials, plans, examples and usage. The present Admin Console API page is an operator view, not a developer portal.
- [ ] **OAuth sign-in for personal Git accounts.** Administrators register GitHub, GitLab or Bitbucket OAuth applications; users connect an account without manually creating a personal access token. Preserve encrypted per-user credentials, repository permissions and auditable disconnect/revocation.
- [ ] **DNS-01 ACME and wildcard certificates.** HTTP-01 works for ordinary host names; wildcard certificates require DNS-01 provider integrations and secure DNS credentials.
- [ ] **Additional AI-memory database backends.** Decide whether dedicated SQL Server and Oracle memory backends are needed. Normal database activities already support them; AI memory currently supports built-in storage, folders, SQLite, PostgreSQL and MySQL.
- [ ] **Separate gateway and worker deployments.** Replace process-local reply handles with a durable or pub/sub reply path before gateways and workers run independently.
- [ ] **Large-payload object storage.** Store large task inputs and outputs in object storage and keep durable references in the run database.
- [ ] **Tenant quotas.** After tenant identity exists, enforce per-tenant concurrency and consumption limits at the durable claim boundary (the connection-limit admission of 2.1.0 is the model).

## Won't have (this time)

- **Connection limits as a request rate.** Maximum concurrent activities counts work at once; calls per second stay with the gateway's rate limits and plans, and with the outside system's own rules.
- **Recalling a request already sent.** A lost lease or a cancelled step stops further work; a request already accepted by an outside system cannot be withdrawn. Outside calls must be idempotent instead.
- **Counting gateway, Admin Console and Test connection traffic against connection limits.** These are people and callers, governed by sign-in, rate limits and plans.
- **Connectors for Bluesky, Mastodon, TikTok, Instagram and LinkedIn** (decided earlier; X needs a paid API and was not asked for).
- **MapReduce and server-side JavaScript in MongoDB activities.**

## Documentation maintenance

- [ ] Keep README, the generated user guide, architecture page and release notes aligned when any item above ships; remove the item here in the same change.

## Implementation playbook

The sections below describe a safe implementation path. They are design guidance, not a claim that the item has shipped.

### 1. Conversation ownership, tenant identity and jobs

Implement these together because conversation memory and delayed job results must use the same ownership rule.

1. Introduce a `ConversationScope` value in the gateway/agent boundary with `projectId`, `agentName`, `channel`, optional `tenantId`, verified `subject`, `appId` and a client conversation id. Pass the value to the engine; do not reconstruct identity inside an activity from untrusted input.
2. Extend `Caller` with an optional tenant. For JWT/OIDC policies, add a configurable trusted tenant-claim name (for example `tenant_id`, `tid` or `org_id`). For gateway applications, add an optional tenant field. Basic and API-key callers may inherit the tenant configured on their account/application. Never accept a tenant from the message body.
3. Add an `ai_conversations` table whose internal id is an opaque UUID. Store the scope fields, a hash of the client conversation id, timestamps and retention state. Enforce a unique index across the normalized owner scope and client-id hash. Continue to use the internal conversation id as the storage session key so built-in, folder and external-database memory backends stay consistent.
4. Change the memory API from free-form `session: string` to either an internal conversation id or a server-created scope. Low-level memory activities may retain an explicitly labelled advanced/raw-session mode for non-public workflows; published agents must always use scoped conversations.
5. Sign the public conversation token with a rotating server key. Include only an internal conversation id, agent identity, owner fingerprint, issued/expiry times and key version. Verify the signature and current caller on every use; do not put message text or raw customer identifiers in the token.
6. Add an `agent_jobs` table mapping an opaque job id to run, conversation, project, agent and owner fingerprint. Chat, OpenAI-compatible, MCP and A2A result lookups must query through this table and return `404` for a non-owner, avoiding information leakage.
7. For anonymous chat, mint a signed visitor cookie/token and scope conversations to it. Clearing browser storage starts a new visitor; it does not establish a real-world identity. For authenticated chat, the verified subject replaces the anonymous owner.
8. Audit conversation creation, deletion and hand-off without logging full message content by default.

Regression tests must cover two tenants with the same subject and client session, two users in one tenant, two agents with the same session, forged/expired tokens, a caller attempting another caller's job, anonymous-browser separation, key rotation, engine restart and multi-engine races. Migration tests must prove existing non-agent memory can still be read or is deliberately migrated under the chosen 2.x upgrade policy.

Done means no public entry point can select memory or a job using only a caller-supplied session/run id, and the same ownership suite passes on SQLite and real PostgreSQL.

### 2. MCP and outside-assistant conversations

1. Keep ordinary MCP skill Sutras stateless unless their workflow explicitly stores state; ChatGPT, Claude or Copilot normally owns that conversation.
2. For an agent exposed as `ask_<name>`, replace the raw `session` contract with an optional opaque `conversation` token. Return that token in structured content and clearly describe that clients pass it back to continue.
3. Bind the token to the authenticated gateway application, caller and published agent. Treat the MCP transport `mcp-session-id` as transport lifecycle only, never as user identity.
4. Preserve a compatibility alias only if an upgrade requires it; otherwise, for the planned 2.x breaking change, reject unscoped public session ids rather than silently trusting them.
5. Add conformance fixtures shaped like the tool calls made by ChatGPT, Claude, Copilot, Antigravity and Cursor. Test a client that preserves structured content, one that only preserves text, reconnection with a new MCP transport session and two users behind the same client application.

Done means continuation is reliable when the client returns the token and safely starts a new conversation when it does not; knowing another token or session id is insufficient to cross an ownership boundary.

### 3. Public chat SDK and conversation operations

1. Extract the current chat page's request, token and job-polling logic into a small dependency-free browser client. Expose `start`, `send`, `resume`, `status`, `cancel` and event callbacks; accept an application-provided access-token callback.
2. Build the existing page and `widget.js` on that client so there is one protocol implementation. Add configurable origin/CORS rules, CSP-compatible loading, accessible focus behavior, reconnect/backoff and structured error codes.
3. Add attachments through a bounded upload endpoint that stores a durable file reference, scans/validates type and size, and passes references rather than large bytes through run state.
4. Add Admin Console pages for conversation metadata and hand-offs, protected by new least-privilege permissions such as `View conversations`, `View conversation content`, `Delete conversations` and `Handle agent escalation`.
5. Provide deletion and retention operations that clear the conversation record, summary, turns, queued ownership and attachments across every configured memory backend.

Done means a developer can build a custom customer-service UI without copying the embedded page source, and operators can diagnose or delete a conversation without gaining unnecessary access to its contents.

### 4. Document the two AI product patterns

Add one user-guide chapter with two end-to-end examples:

- A public customer-service agent: Agent channel → AI guard → AI agent → tool Sutras/knowledge → approval when needed → Agent reply, with scoped memory and the built-in page, widget and custom SDK options.
- An integration exposed to an outside assistant: MCP skill → governed Sutra → Reply to AI, with the outside assistant owning chat history and SutraFlow enforcing authentication, scopes, rate limits and auditing.

Update the architecture page with trust boundaries and sequence diagrams for chat and MCP, and explicitly explain caller, tenant, visitor, transport session, conversation token and memory store. Generate both HTML documents and run documentation regression tests.

### 5. AI-memory support for SQL Server and Oracle

First confirm demand because external AI memory adds operational complexity while built-in PostgreSQL already supports clustered storage. If implemented, add dialect adapters for table creation, bound parameters, upsert/sequence allocation, retention deletion and transaction isolation. Do not build SQL by interpolating values or table names beyond the existing validated identifier. Run the complete memory contract against real supported versions, including concurrent append, compaction, encryption, clear and recovery. Advertise a backend only after that real-database suite passes.

### 6. Push-based Twitch and Discord triggers

Create provider-owned webhook/event subscriptions during deployment, verify signatures and timestamps before starting a run, persist provider event ids for deduplication, renew subscriptions under the leader lease and reconcile periodically for missed events. Route inbound events through the same durable trigger path as polling. Keep polling as an explicit fallback until outage and redelivery tests show that no accepted event is lost.

### 7. Developer portal

Build the portal from the existing deployed-route catalogue, OpenAPI documents, gateway applications, plans and usage records. Start read-only with service discovery, documentation and examples; then add self-service application/key creation behind administrator approval. Never display stored secret material: show a new key once, store only its hash, support rotation and revocation, and audit every credential action.

### 8. DNS-01 and wildcard ACME

Add a DNS-provider interface with create/delete TXT operations and adapters only for providers that can be integration-tested. Store credentials in the vault, use the existing cluster issuance lease, wait for authoritative DNS propagation, clean records on success/failure and retain HTTP-01 for ordinary names. Test staging issuance, renewal, leader death during a challenge and cleanup after timeout before enabling wildcard requests.

### 9. Scale-out architecture

Implement in this order:

1. Add a durable `run_replies`/correlation record or PostgreSQL notification-backed reply signal while keeping the database authoritative. Remove process-local reply ownership assumptions, then run gateway-only and worker-only processes in tests.
2. Introduce a payload-store interface with filesystem and object-storage implementations, checksums, encryption metadata, reference counts and retention cleanup. Move only payloads above a configurable threshold.
3. Add per-connection permits to the claim transaction. A crashed engine's permits must expire with its task lease; retries must not double-count them.
4. Add tenant quotas only after verified tenant identity is available. Enforce them atomically at claim/start boundaries and expose current usage and rejection reasons to operators.

Done means gateway and worker deployments can restart independently, large payloads do not inflate task rows, and connector/tenant limits remain correct through engine and database outages.

### 10. External release validation

- **Remote soak:** provision a dedicated PostgreSQL host with production-like latency and TLS, capture server configuration and clocks, run the existing 24-hour scenario, and archive its report plus correlated PostgreSQL errors. Any assertion failure blocks release.
- **Docker:** build without relying on the developer's `node_modules`, start single and cluster Compose stacks, run health/login/deploy/call/drain checks, restart containers and verify non-root execution and persisted data.
- **Let's Encrypt:** use staging first with a disposable public hostname; test initial issue, forced near-expiry renewal, two engines, leader loss and certificate reload before one carefully monitored production issuance.
- **Connectors:** maintain a matrix of connector, real service/version, credentials/scopes used, operations exercised, date, result and known limits. Secrets and response bodies do not belong in the report.

### Recommended delivery order

Follows the MoSCoW order above.

1. Conversation ownership, tenant mapping and job authorization.
2. MCP conversation contract and cross-client tests.
3. Chat SDK, then conversation operations UI.
4. Documentation for both AI patterns.
5. Remote PostgreSQL soak and real Docker/ACME gates.
6. Connector certification, push triggers and developer portal.
7. Scale-out payload, deployment and quota work.
8. Additional memory databases only when customer demand justifies their permanent test matrix.

