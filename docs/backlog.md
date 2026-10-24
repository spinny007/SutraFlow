# SutraFlow planned backlog

This is the canonical list of work that is intentionally not complete. It separates release gates from product ideas so that a planned feature is not mistaken for a shipped one. Completed work belongs in `RELEASE-NOTES.md`, not here.

## Release and external validation

- [ ] **24-hour remote-PostgreSQL soak — release gate.** Run `tools/soak.mjs` for 24 hours with PostgreSQL on a separate machine. Preserve the generated report and verify recovery, latency, memory, duplicate-step and database-log assertions.
- [ ] **Build the real Docker image.** The Docker configuration and compiled-server smoke test pass, but the release machine used for 2.0.4 did not have a compatible Linux Docker daemon. Build and start the image on both the single-server and cluster Compose paths.
- [ ] **Let's Encrypt staging certification.** Exercise a real public domain, port 80 HTTP-01 challenge, issuance, renewal and multi-engine certificate reload against the Let's Encrypt staging service.
- [ ] **Extend real-service connector certification.** The 2.0.8 record covers 66 native scenario executions across ActiveMQ 6.3 plain/mTLS, RabbitMQ 4.4 plain/mTLS and hosted Kafka TLS/SASL/mTLS, including all five formats and malformed-payload retries; four broker REST checks also pass. External PostgreSQL 17.2 and MariaDB 11.8.9 TLS/bound-query/rollback and engine-activity checks pass, without replacing the remote 24-hour soak. Certify SQL Server, Oracle, IMAP, Qdrant, Chroma and Pinecone, followed by Google, Microsoft, Dropbox, YouTube, Twitch, Discord, Telegram, Facebook, Azure Data Factory and Databricks APIs. Record service/version, test date and limitations rather than treating a stand-in as certification.

## AI channels, memory and MCP identity

- [ ] **Server-enforced conversation ownership.** Scope AI memory by project, published agent, tenant, authenticated caller or anonymous visitor, and conversation. A client-provided session id must never select another caller's memory.
- [ ] **First-class tenant mapping.** Add an optional tenant/customer identifier to gateway applications and configurable trusted JWT/OIDC claims. Keep this distinct from Microsoft Entra's connection tenant setting.
- [ ] **Opaque conversation tokens.** Issue signed, opaque tokens for public chat sessions. Anonymous visitors need a device/browser identity without being represented as a verified person.
- [ ] **MCP conversation binding.** Bind an agent tool's returned session to the authenticated gateway application and caller. Define how clients such as ChatGPT, Claude, Copilot, Antigravity and Cursor continue a conversation, without assuming that the MCP transport session is a user identity.
- [ ] **Long-running job ownership.** Authorize chat, OpenAI-compatible, MCP and A2A job-result reads against the same agent and caller that started the work.
- [ ] **Developer chat SDK.** Keep the existing zero-code chat page and `widget.js`, and add a small browser SDK for custom public-facing chat interfaces: authenticated requests, conversation tokens, history, job polling, attachments, cancellation and structured errors.
- [ ] **Conversation operations UI.** Add an access-controlled Admin Console view for conversation metadata, usage, retention, deletion, failures and human hand-offs. Do not expose message content merely because someone can operate the server.
- [ ] **Document the two agent patterns.** Clearly distinguish public customer-service agents, where SutraFlow owns the conversation, from MCP skills that extend an outside assistant, where that assistant normally owns the conversation and SutraFlow supplies governed integrations.
- [ ] **Additional AI-memory database backends.** Decide whether dedicated SQL Server and Oracle memory backends are needed. Normal database activities already support them; AI memory currently supports built-in storage, folders, SQLite, PostgreSQL and MySQL.

## Gateway and connector capabilities

- [ ] **Push-based Twitch and Discord triggers.** Replace or complement polling with the providers' supported event/webhook mechanisms. Keep durable polling or reconciliation where it is needed to recover missed events.
- [ ] **Developer portal.** Build a consumer-facing portal around the existing OpenAPI output, service discovery, application registration, credentials, plans, examples and usage. The present Admin Console API page is an operator view, not a developer portal.
- [ ] **OAuth sign-in for personal Git accounts.** Administrators register GitHub, GitLab or Bitbucket OAuth applications; users connect an account without manually creating a personal access token. Preserve encrypted per-user credentials, repository permissions and auditable disconnect/revocation.
- [ ] **DNS-01 ACME and wildcard certificates.** HTTP-01 works for ordinary host names; wildcard certificates require DNS-01 provider integrations and secure DNS credentials.

## Scale-out work

- [ ] **Separate gateway and worker deployments.** Replace process-local reply handles with a durable or pub/sub reply path before gateways and workers run independently.
- [ ] **Large-payload object storage.** Store large task inputs and outputs in object storage and keep durable references in the run database.
- [ ] **Connector concurrency limits.** Apply per-connection limits at scheduling/claim time so a fast workflow cannot overwhelm an outside service.
- [ ] **Tenant quotas.** After tenant identity exists, enforce per-tenant concurrency and consumption limits at the durable claim boundary.

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

1. Conversation ownership, tenant mapping and job authorization.
2. MCP conversation contract and cross-client tests.
3. Chat SDK, then conversation operations UI.
4. Documentation for both AI patterns.
5. Remote PostgreSQL soak and real Docker/ACME gates.
6. Connector certification, push triggers and developer portal.
7. Scale-out payload, deployment and quota work.
8. Additional memory databases only when customer demand justifies their permanent test matrix.

