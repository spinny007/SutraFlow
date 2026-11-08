# SutraFlow planned backlog

This is the canonical list of work that is intentionally not complete, prioritised with MoSCoW: **Must have** (the next release is not done without it), **Should have** (important, planned next), **Could have** (worth doing when there is room; proposals set aside for now land here), **Won't have (this time)** (decided against, recorded so they are not re-proposed by accident). 2.1.7 is planned in [designer-plan-2.1.7.md](designer-plan-2.1.7.md); 2.1.8 (the security audit findings) in [security-plan-2.1.8.md](security-plan-2.1.8.md). Completed work belongs in `RELEASE-NOTES.md`, not here; an item that ships is removed in the same change. Updated for 2.1.6, 5 November 2026; 2.1.7 security audit findings added 8 November 2026.

## Must have

- [ ] **24-hour remote-PostgreSQL soak — release gate.** Run `tools/soak.mjs` for 24 hours with PostgreSQL on a separate machine. Preserve the generated report and verify recovery, latency, memory, duplicate-step and database-log assertions. Include capped connections (steps, polls and a scheduled refresh) in the scenario. Deferred again for 2.1.7 (decided 7 November 2026; recorded in `docs/releases/2.1.7-packages.md`).
- [ ] **Security — close the 2.1.7 audit findings (project boundaries and host commands).** Raised 8 November 2026 by the 2.1.7 security audit (revision `1238f52`). Six problems were reproduced through the admin API with a developer granted only Project A; each needs a signed-in studio account (nothing anonymous). Until they are fixed, project boundaries cannot be relied on between designers who do not trust each other, and this version must not be described as free of known vulnerabilities. In this order:
  - **F1 (High) — another project's vault secret can be sent out.** `GET /api/secrets` lists every vault reference to anyone with View somewhere, and model discovery (`POST /api/resources/models`) reads a raw `apiKeySecret` with `getSecret(name)` without checking its project, then sends it to an API address the caller chooses. Fix: resolve credentials through one project-aware check (the effective project's own references plus explicitly shared engine credentials) used by connection tests, discovery, inference, query previews and runtime; filter the list the same way. Code: `server/src/api.ts` (secrets list, model discovery), `server/src/guard.ts` (list permission), `server/src/resourceTest.ts` (secret reader).
  - **F2 (High) — AI CLI connections run any program while scripts are off.** `POST /api/resources/test` with an AI CLI provider starts a client-chosen executable, arguments and working folder as the SutraFlow process, with its environment; `scriptsAllowed()` and any allow-list are not applied, and the provider label does not limit the executable. Fix: OS-running AI providers become a capability an administrator grants, checked in the shared call path (test and runtime); executables and arguments allowed in server configuration only, a limited working folder, a minimal environment; decide whether the script switch also governs them. Code: `server/src/ai/providers.ts` (`cliCall`), compare `server/src/palettes/scripts.ts`.
  - **F3 (High) — two project fields bypass the check.** The guard authorises `body.projectId` first, while connection handlers and `prepare` use `body.project_id`, so a request can be checked against A and run in B (it created a connection in B and resolved B's `{{gv.…}}` property). Fix: settle the project once, refuse conflicting aliases, and pass that checked value to the handler instead of re-reading the body. Code: `server/src/guard.ts`, `server/src/api.ts` (resource create), `server/src/resourceTest.ts`.
  - **F4 (High) — create routes overwrite another project's connection or schema by id.** `POST /api/resources` and `POST /api/schemas` pass a client id to an upsert; the guard checks the submitted project, not the owner of the existing row. Fix: public create routes make their own ids and refuse an existing one; updates are checked against the stored owner; any import upsert stays internal with an ownership check in the same transaction. Code: `server/src/resources.ts`, `server/src/schemas.ts`, `server/src/api.ts`.
  - **F5 (Moderate) — design shape previews show other projects' schemas.** `POST /api/design/schemas` needs Design somewhere, then reads the schemas and called-Sutra contracts named in the submitted document without a project check. Fix: require the project context and check every referenced schema, called Sutra and nested resource, reusing the contract and runtime checks. Code: `server/src/guard.ts`, `server/src/design.ts`.
  - **F6 (Moderate) — the live event stream shows other projects' runs.** `GET /api/events` is open to any signed-in account and sends every run event (run id, status, Sutra id). Fix: send an event only when the person can View the run's project, applying role changes and revocation to open streams. Code: `server/src/guard.ts`, `server/src/api.ts` (event listener).

  Tests (negative regressions for every bypass above, expecting denial): A cannot list or use B's secret by raw reference, property reference, unsaved connection or nested resource, while shared engine properties still work; no arbitrary program through an unsaved or saved AI provider, discovery or inference while the capability is off, and approved AI CLI use still works; both project aliases present and equal, conflicting, missing, null and empty across resource create, connection test, model discovery, schemas and previews; no overwrite of another project's or a shared connection or schema through a create route, normal updates still work; no foreign schema through design previews; no foreign run on the event stream. Then rerun the audit's probes expecting denial, and the full regression and release gates. The audit report (`REPORT.md`), its reproduction script (`reproduce.mjs`, a new fixture each time), results and regression logs are kept outside the repository, in `C:\Users\kunwa\Documents\Codex\2026-10-19\i-want-a-x20\outputs\security-audit-217\`.
- [ ] **Security — update the glob/minimatch chain (2.1.7 audit F7, Moderate).** `@fastify/static` 10.1.6 brings `glob` 13.0.6 ([GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4), fixed in 14.0.2) and `minimatch` 10.2.6 ([GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), fixed in 11.0.1); npm reports three Moderate entries for these two advisories. No reachable exploit in SutraFlow was shown (fixed pattern, default wildcard mode). Move to a compatible fixed chain without forcing an incompatible major upgrade, check the lockfile, rerun the advisory query, and check static files, guide pages and startup.

## Should have

The items marked **P1** are AI work, put first (5 November 2026).

- [ ] **P1 — AI agent: tool approval, lasting sessions, cost and steering.** Raised 5 November 2026. To do:
  - **Tool approval:** a tool of an AI Agent step (an activity, a called Sutra, an MCP tool) can be set to *Needs approval*. The agent then pauses and the request goes to the existing Approval Center as one more kind of approval (an *AI tool call*), with the same approvers, roles, notifications, time limits, escalation and audit as the Approval step; no separate approval screen. The request shows the agent, the conversation so far, the tool and its arguments; the approver approves, changes the arguments or refuses with a reason. A refusal goes back to the model as the tool's answer. The run waits in the database, as Approval does. A chat page may show "waiting for approval" to the person chatting, but the decision is made in the Approval Center.
  - **Lasting sessions:** a conversation and its state (messages, summary, open tool calls) survive a restart, a redeploy and a leader change. An engine that takes over carries on from the last saved turn.
  - **Cost and time per call:** each model call and tool call records its model, input and output tokens, cost (from a price table per model that administrators keep), time and result. These show on the step in the run, in traces and metrics, and as totals per Sutra, project and conversation, with an optional budget per conversation or per day that stops the agent with a clear message.
  - **Steering:** while the agent answers, a person (or the calling page) can add a message that is taken into the next turn, or stop the answer; a stopped answer keeps what was already written.

  Tests: approve, change and refuse a tool call; a restart while waiting for an approval; a redeploy mid-conversation; token and cost totals against the provider's reported usage; a budget reached; a stop mid-answer.
- [ ] **P1 — Agent memory: profile, recall and background summaries.** Raised 5 November 2026. Today an AI memory store keeps a session: a running summary and the newest turns. To do, all in the existing AI memory stores (built-in, folder, SQLite, PostgreSQL, MySQL):
  - **Working memory (profile):** a structured record per customer or user (for example name, preferences, open case), defined by a JSON schema on the memory store. The agent reads it at every turn and updates it field by field (a field set to empty is removed); it carries across all of that person's conversations. Memory steps can read and change it too, so a Sutra can fill it from a CRM.
  - **Recall by meaning:** find the most relevant messages of the same person's earlier conversations (not only the newest turns of this one), using the embeddings and search of the knowledge bases, with a limit on how many and how far back.
  - **Background summaries:** when a conversation grows long, older turns are summarised in the background into notes the agent keeps, instead of being cut at the context window.
  - **Privacy:** memory belongs to the person (the conversation owner); one person's profile or recall never reaches another's conversation; deleting a person's data removes their profile, messages and embeddings.

  Tests: the profile updated over two conversations, recall finding an older conversation, a long conversation summarised without losing a stated fact, no recall across people, deletion.
- [ ] **P1 — Supervisor agents: control over hand-offs.** Raised 5 November 2026. Today *Hand off to agent* passes the whole conversation to the specialist agent Sutra. To do:
  - before a hand-off, the supervisor's rules (or a person, through the Approval Center) can let it go ahead, change the request, or refuse it with a reason that goes back to the supervisor;
  - choose what the specialist sees: the whole conversation, the last turns, or only the request;
  - each specialist keeps its own memory (its own session linked to the parent's), so specialists do not read each other's notes;
  - a finish check: a rule or a model's score decides whether the task is done, or the supervisor goes round again (with a maximum of rounds);
  - every hand-off, its decision and its result are shown in the run and in traces.

  Tests: allow, change and refuse a hand-off; each view of the conversation; separate memories; the finish check stopping and repeating; the round maximum.
- [ ] **P1 — More AI guard checks.** Raised 5 November 2026. The AI guard step hides personal data, catches prompt injection, blocks topics and checks length or JSON shape. Add: moderation categories with a threshold (block or warn); language detection with translation to a set language; a cost cap per conversation, Sutra or time window (with the budget of the AI agent item); a cache of answers for repeated identical questions (per Sutra, with a lifetime, never across people when the question uses their data); and redaction of personal data in traces and logs. Tests for each, including a cached answer never served to another person. **Built for 2.1.8 (8 November 2026), except the cost cap, which moves to 2.1.9 with the agent budget.**
- [ ] **P1 — Agents on channels and tools: chat channels, MCP, monitoring and search.** Raised 5 November 2026. To do:
  - **Chat channels:** Slack, Microsoft Teams, WhatsApp, Telegram and Discord as triggers for an agent Sutra and as the place its answer goes back to, with the person's identity from the channel mapped to the conversation owner, threads kept as sessions, and tool approvals shown as "waiting for approval" in the channel. The existing agent channel and the Telegram and Discord connectors are the base.
  - **MCP, both ways:** sign-in to outside MCP servers with OAuth (tokens kept per connection, encrypted); MCP tool calls can need approval in the Approval Center like any tool; an MCP server can offer dashboards and pages that open inside the assistant (from SutraFlow dashboards).
  - **AI monitoring tools:** send traces through OpenTelemetry to AI monitoring services with separate spans for model calls, steps and tool calls (model, tokens, cost, time), sampling, and personal data removed before they leave.
  - **Better knowledge search:** re-rank the closest passages with a model, and a choice of how documents are split (by size with overlap, by headings, by sentences).

  Tests: a conversation on each channel; an OAuth MCP server; an MCP tool call approved; traces arriving at a collector with no personal data; re-ranking changing the order on a known set.
- [ ] **P1 — Live progress and AI answers streamed to web pages.** Raised 5 November 2026. Today `/api/events` serves the studio, and only agent chats stream to the public. To do:
  - A *Progress* step (or a field on any step) sets a run's progress values (percentage, stage, counts), stored with the run.
  - AI steps stream their answer as it is written, and a run can stream a named output to a page.
  - A web page follows one run with a token that only opens that run (made when the run is started through the gateway, short-lived, read only), through server-sent events with resume after a lost connection.
  - A small browser client (with the chat SDK in Could have): follow a run, read its progress and status, and read a stream.

  Tests: a page sees progress and the streamed answer; a token cannot open another run; a lost connection resumes without missing or repeating text; many followers of one run.
- [ ] **P1 — SutraFlow generation (MCP server for building Sutras with AI).** Raised 5 November 2026. **Built for 2.1.8 (8 November 2026) as /mcp/studio: learn, create, change by confirmed difference, check, test, and hand over with a person's plan approval. The designer has no AI chat of its own; a chat panel that uses these tools would be a later item.** Today SutraFlow's MCP tools serve knowledge bases and gateway services, and the designer has its own AI chat. To do: an MCP server through which any AI assistant (the designer's chat, Claude, ChatGPT, VS Code and other MCP clients) builds and fixes Sutras from a description in plain words, using the same rules as a person in the designer:
  - **Learn what exists:** list projects, Sutras, the activity palette with each activity's fields and schemas, connections and properties by name (never secret values), and samples to follow.
  - **Generate:** create a new Sutra (or change a draft) from a description: steps, connections between them, mappings and schemas. The result is always a draft, never deployed, and opens in the designer for a person to look at; a change to an existing Sutra is shown as a difference before it is saved.
  - **Check and repair:** run the design checks and fix the problems they report; start a test run with a sample input, read each step's input, output and logs, and correct the Sutra until the test passes or the assistant stops and explains what is missing (a connection, a property, a decision).
  - **Hand over:** package and check a release; deploy only with the plan approval by a person with Deploy, as `sutra deploy --approve`.
  - **Safety:** signed in as a person or a system account with their roles; read tools for anyone with the project, generating and changing only with Design. Secret values are never readable; a generated Sutra picks secrets from properties only. Every call is recorded in the audit log with the client `mcp` and marked *generated*, and generated runs are design-time runs.

  Tests: generate a Sutra from a description that passes its design checks and a test run; a repair of a broken Sutra; a change shown as a difference; no secret readable; a deploy without approval refused; each tool against its role; the audit record.

- [x] **Knowledge admin** (done in 2.1.5). Server knowledge bases granted to projects by area; managed sources with connection, schedule, Sync now and history; incremental sync on the leader with deletions; an MCP tool per knowledge base; export as a Sutra that writes only its own area (one writer per area). Later: export for SharePoint, Google Drive, SFTP and API sources; change notifications (Graph, Drive) instead of listing.

- [ ] **2.1.3 hosted AI inference follow-up.** Gemini 3.1 Flash Lite and local Ollama passed real 4800 workflows. Gemini 4 Argon was discovered but its call was rejected by account quota (429); both supplied OpenAI keys passed model discovery but the current gpt-5.4-mini call was rejected for no credits (429). On 2 November 2026 the Gemini API passed live again (46 models fetched, an explicit model answered, an unknown model failed with 404 and no switch, a 1 ms timeout ended the request). Retest OpenAI inference after billing is available; never silently switch models. The deprecated gpt-4.1-nano response was surfaced explicitly. Credential-free evidence is retained outside the repository.

- [ ] **IIS check of the release's `web.config`.** The installer parts listed after 2.1.2 shipped in 2.1.4 (keys shown once) and 2.1.5 (server name, TLS choice, sample Sutras, steps at once, heartbeat and drain, the join check of an engine beside the studio, `sutraflow engine-file` for an engine joining later, YAML install files). Left: check the release's IIS `web.config` on a real IIS server (written for IIS, checked only on Apache), and a join check for engines on other machines once they start (the Admin Console's Engines page shows them today).

- [ ] **1-hour hosted Kafka soak (gentle).** Run `tools/soak.mjs` for one hour against the hosted Kafka trial service (TLS with client certificate, free tier): one publish and subscribe every few minutes, a topic of its own, at-least-once delivery checked end to end. The soak tool's `--kafka kafka://user@host:port?sasl=scram-sha-256&ca=ca.pem` option does this (password from `KAFKA_PASSWORD`; optional `cert=`/`key=` files for mutual TLS); connection details are collected and a SASL/SCRAM-SHA-256 connection over verified TLS works. Kafka now also runs gently inside the 6-hour 2.1.0 soak, reusing an existing topic (`topic=`); the dedicated 1-hour run remains to do. Keep the credentials outside the repository. The hosted Kafka trial used so far ended in November 2026: a new Kafka service (hosted or local) is needed first.

- [x] **ECharts palette and dashboard hosting — done in 2.1.5.** Gateway dashboards (`/dash/<name>`) with a policy each, charts from queries or JSON, KPI cards, slicers, AI-suggested chart settings checked by an allow-list, refresh with a shared cache, PNG/SVG export in the browser, an embed script; ECharts served by SutraFlow. Left for later: server-rendered SVG images for e-mails and reports.
- [ ] **First-class tenant mapping.** Add an optional tenant/customer identifier to gateway applications and configurable trusted JWT/OIDC claims. Keep this distinct from Microsoft Entra's connection tenant setting.
- [ ] **MongoDB P1 — durable change streams.** Leader-owned listeners, persisted resume tokens and atomic run/checkpoint bookkeeping, failover fencing, invalid-token recovery, replay/idempotency and duplicate handling. Promise at-least-once delivery with an explicit deduplication contract, not exactly-once merely because resume tokens exist. As a subscription it holds no connection-limit permit; its runs' steps do.
- [ ] **MongoDB P1 — Atlas Vector Search / RAG backend.** Dedicated similarity activity plus knowledge-store integration, embedding dimensions/model/index agreement, authorization filters, index readiness and real vector-index tests. Require supported Atlas capabilities; renaming the palette does not certify DocumentDB/Cosmos compatibility.
- [ ] **2.1.6: containers, Kubernetes, configuration as files, CI/CD.** Planned in [deployment-plan-2.1.6.md](deployment-plan-2.1.6.md): official image on GHCR (any registry for users), `sutraflow image build`, Kubernetes manifests and Docker templates, server and project config export/check/apply with per-environment files (secret values, `${env:}`, `file:`), pipelines for GitHub Actions, GitLab CI, Azure DevOps and Jenkins. Open questions listed there.
- [ ] **Build the real Docker image.** The Docker configuration and compiled-server smoke test pass, but the release machine has no compatible Linux Docker daemon. Build and start the image on both the single-server and cluster Compose paths.
- [ ] **Let's Encrypt staging certification.** Exercise a real public domain, port 80 HTTP-01 challenge, issuance, renewal and multi-engine certificate reload against the Let's Encrypt staging service.
- [ ] **Extend real-service connector certification.** The 2.0.8 record covers 66 native scenario executions across ActiveMQ 6.3 plain/mTLS, RabbitMQ 4.4 plain/mTLS and hosted Kafka TLS/SASL/mTLS, including all five formats and malformed-payload retries; four broker REST checks also pass. External PostgreSQL 17.2 and MariaDB 11.8.9 TLS/bound-query/rollback and engine-activity checks pass, without replacing the remote 24-hour soak. Certify SQL Server, Oracle, IMAP, Qdrant, Chroma and Pinecone, followed by Google, Microsoft, Dropbox, YouTube, Twitch, Discord, Telegram, Facebook, Azure Data Factory and Databricks APIs. Record service/version, test date and limitations rather than treating a stand-in as certification.
- [ ] **Push-based Twitch and Discord triggers.** Replace or complement polling with the providers' supported event/webhook mechanisms. Keep durable polling or reconciliation where it is needed to recover missed events.
- [ ] **Project files on a remote drive, a secure folder per person.** Raised 5 November 2026. Today a project lives in the server database, and a Git working copy, when there is one, is a folder on the server. To do:
  - An administrator sets a project storage location: a local folder, a network share (SMB/UNC on Windows, NFS or a mount on Linux), or object storage (S3, Azure Blob). The credentials for it are picked from engine properties, never typed in.
  - Each person gets a folder of their own in it, made on first use. The server alone reads and writes it, with permissions that shut out other users. File names are checked, so no path can lead outside it, and secrets are never written there.
  - A person's projects are saved only in their own space. Sharing a project with a team moves or links it to a team space, with the same Design / Deploy roles as now.
  - Git works in that folder as it does in a workspace today: commit, push, pull and branches with the person's own Git account and any remote. The folder holds the working copy, so a project can be kept in Git and on the drive at the same time.
  - The database keeps the index (the project, its owner, where it lives, the last version read) and the deployed versions, so a deployment does not depend on the drive being reachable.
  - When the drive is offline, the designer says so and does not lose changes. Two edits of the same file are detected and reported, never overwritten silently.

  Tests: a share and a local folder; a person cannot open another person's folder through the API or a crafted path; drive offline and back; a conflicting edit; Git push and pull from the folder; deploy while the drive is down.
- [ ] **SutraFlow designer for VS Code.** Raised 5 November 2026. A VS Code extension, so Sutras are edited and kept as code in VS Code and run by a local SutraFlow engine. To do:
  - Open a project folder (Sutras as `.sutra.json` files, plus project settings, schemas and mappings) and edit a Sutra on a canvas inside VS Code, built from the same React Flow designer. Editing the JSON directly is also possible, with a JSON schema for completion and checks.
  - Design checks show in the Problems view.
  - Run, test and debug against the local engine: started by the extension, or one already running (`sutraflow` from a release package). Breakpoints, step inputs and outputs, and logs show in VS Code.
  - Sign in to the engine with the person's account; the extension never holds a password. Projects, runs and logs are separated by the signed-in person: each person sees only their own projects and runs, and runs record the person, the client `vscode` and the design or runtime stage (see the item above).
  - Leave Git to VS Code (its own source control); the extension only reads and writes the files.
  - Deploy from VS Code: package, check and deploy with the plan approval, as `sutra check` and `sutra deploy` do.
  - Publish on the VS Code Marketplace and Open VSX, signed and with the same version as the engine; refuse an engine of an incompatible version.

  Tests: open, edit, save and reopen a Sutra; a test run on the local engine recorded with the right person, client and stage; two people on one engine cannot see each other's projects or runs; a version mismatch refused; deploy with approval.
- [ ] **Duplicate protection for every way a run starts.** Raised 5 November 2026. Today only broker triggers (Kafka, RabbitMQ, AMQP) recognise a message delivered again. To do:
  - a duplicate key on the Run API, gateway calls (a header such as `Idempotency-Key`) and Call Sutra; a repeat with the same key answers with the first run (its id, or its result when the caller waits) instead of starting a new one;
  - where a key applies: the whole server for that Sutra, or only within one parent run (so a retried parent does not call its child twice); how long a key is kept (default 30 days);
  - a failed run frees its key, so the caller can try again; a finished or cancelled run keeps it; administrators can clear a key in the Admin Console;
  - the key is shown on the run.

  The Recalling-a-request decision stands: this stops a second run, not a second call to an outside system, so the help says to pass a key to that system as well. Tests: a repeat while the first run is going and after it ended, the two scopes, expiry, a failed run freed, a cluster with two engines receiving the same key at once.
- [ ] **Concurrency limits per customer, and shared named limits.** Raised 5 November 2026. Builds on the connection limits of 2.1.0 and comes before Tenant quotas. To do:
  - a run started with a customer key (a field of the trigger, a header, or a claim once tenant mapping exists) gets its own pool of slots for that Sutra, with a total for all customers;
  - named limits shared by many Sutras (for example 25 calls at once to an AI provider), set in the Admin Console;
  - while the server runs, an administrator can change, pause and resume a limit, or one customer's, and see running and waiting counts; a change can be temporary (it expires);
  - a run waiting (Wait, Approval, a callback) gives its slots back and takes them again when it carries on.

  Tests: one busy customer does not hold up others, the total holds, a shared limit across Sutras, pause and resume, an engine lost while holding slots.
- [ ] **Wait for callback step and messages to a running run.** Raised 5 November 2026. Approval, Wait and Ask person exist; no step lets any outside system answer a run. To do:
  - a *Wait for callback* step makes a token with a timeout and a one-time callback address, gives them to later steps (to send to the outside system or a page), and waits in the database until the token is completed with a value, or times out (an error port);
  - the callback can be called server to server, or from a web page with a token that only completes this one wait (browser calls allowed for it alone);
  - typed pause and resume: a schema for what the step sends out while waiting (shown to the outside system or page) and a schema for the value it accepts back, checked when it arrives (a wrong value is refused with its problems and the step keeps waiting); later steps map from the accepted value's fields;
  - the tokens are listed in the run and in the Admin Console (waiting, completed, timed out);
  - messages to a running run: a named input a Sutra can wait for, or react to while it runs, for example to stop an AI answer partway through.

  Tests: completed before and after a restart, a timeout, a wrong token refused, a value failing its schema, a second completion refused, a message stopping an AI step.
- [ ] **Called Sutras and versions.** Raised 5 November 2026. Check what Call Sutra does today when the deployed version changes during a parent run, then make it explicit: a child started with *Wait for the result* runs the version deployed when the parent started (locked with the parent), a fire-and-forget child runs the current deployed version, and the run shows which version each child ran. Replay a past run with its original input on the version it ran or on the latest one (a choice, shown in the new run). Tests: a deploy during a parent run, both choices of replay.
- [ ] **Rerun from a step with changed input.** Raised 5 November 2026. In a past run (design or runtime), pick a step, change its input in the designer, and run from that step onwards: the steps before it are not repeated, their recorded outputs are reused. The new run is a design-time run linked to the original, never repeats a step that called an outside system before the chosen step, and shows what was changed. Runtime runs need Design on the project; secret values stay hidden. Tests: rerun from a middle step, from a step inside a For each, after a version change (uses the version chosen, as in replay), the link to the original run.

## Could have

- [ ] **AI evaluations (quality scores for AI steps and agents).** Raised 5 November 2026. A workflow test shows that a Sutra runs; this shows whether its AI answers are good. Added in three parts:
  - **A palette step, *Score answer*** (AI palette), placed after an AI step or agent. It scores that step's answer with checks you pick: built-in rules (contains, matches a JSON schema, called a given tool, length) and model-judged scores (correct against an expected answer, faithful to the knowledge passages used, relevant, tone, toxicity, a rubric in plain words), each 0 to 1 with a reason. It writes the scores to the run and has *pass* and *fail* ports (a threshold), so a Sutra can retry, ask a person or route on quality. *Sample* sets how many runs are scored (for example 10 % of runtime runs), so live quality is watched without scoring everything.
  - **Evaluation sets in the designer:** a list of example inputs with expected answers, kept with the project (and in Git). *Evaluate* runs the Sutra (design-time) over the set and shows a table of scores per example, the average per check, and a comparison with the last accepted result, so a new prompt or model is tried before it is deployed. `sutra evaluate` does the same in a pipeline and fails it below a set score.
  - **Scores over time** in the Admin Console: averages per Sutra and check, with an alert when a score drops.

  Model-judged scores record their own model, tokens and cost, and count as design-time when run from an evaluation set. Tests: each built-in rule, a model-judged score with a fixed judge answer, the pass/fail ports, sampling, an evaluation set compared with the last accepted result, `sutra evaluate` failing a pipeline.
- [ ] **Speech steps.** Raised 5 November 2026. *Speech to text* and *Text to speech* steps (AI palette) with a choice of provider (connection), for voice notes, call recordings and voice replies; audio in and out as files or base64, with language and voice settings. Tests with a short recording and each provider configured here.
- [ ] **More control over when runs start.** Raised 5 November 2026. To do:
  - **Debounce:** many triggers of one key in a burst become one run, with the first or the last payload, after a quiet time, and never later than a maximum delay.
  - **Delayed start:** start a run later (a time or a delay), reschedule or cancel it before it starts.
  - **Expiry:** a run not started within a set time is marked expired instead of starting late.
  - **Priority:** a run with a higher priority is taken before others waiting for the same slots.
  - **Batches:** start many runs in one call (Run API and a step), and wait for them all with each run's result or error.

  - **Loops:** For each gains *At once* (how many items run at the same time; default 1, results in the original order); a *Repeat* step that runs its branch until or while a condition holds, with a maximum of rounds. Wait already accepts *Or until (date/time)*.

  Tests for each, including a restart while runs are delayed, a debounce key on two engines, For each with several at once and one failing item, and Repeat reaching its maximum.
- [ ] **A preview environment per Git branch.** Raised 5 November 2026. For a project in Git, deploy a branch to a preview environment of its own on a studio or test engine (its own properties, connections from `env/<name>.yaml`, its own gateway address), with a clear label in the console, and remove it when the branch is merged or quiet for a set time. Never on a production engine.

- [ ] **Knowledge feed builder.** Since 2.1.5 a Sutra feeds a knowledge base from any database table or API (sample *Knowledge feed from a database*). A builder in the Designer would make that Sutra without building it: pick a connection (database or HTTP), a table or query (or an API address with paging), the key column, the columns that make the text, the details, the knowledge base and a schedule; it generates the feed Sutra (read, each row, add with skip unchanged, keep only), which can then be changed like any other.

- [ ] **MongoDB read-only query preview — set aside 25 October 2026.** Try a Find or Aggregate in the activity editor without running the Sutra: the activity's own connection, database and collection; limits on records, response size and time; write operations and `$out`/`$merge` refused; results temporary, never runtime input or saved in the Sutra. Not convincing enough for now: a test run in the designer already shows the same result.
- [ ] **MongoDB X.509 live authentication test — deferred by user (25 October 2026).** Configuration/unit checks do not constitute live X.509 certification. Resume only when requested, using an authorized database client certificate and matching database user; do not provision users or grant admin privileges automatically.
- [ ] **MongoDB certification expansion.** Document activities, List Collections and Bulk Write have live M0 evidence. Certify private-CA self-hosted TLS, non-TLS loopback development, General-profile disk/output stages and other read preferences against real deployments, plus pool/cancellation stress tests. API management keys are not database credentials. No automatic admin grants, MapReduce or server-side JavaScript.
- [ ] **MongoDB P2 — streaming Find.** Bounded batches and durable stable-key checkpoints with an explicit concurrent-update consistency policy. Ordinary Find cursors do not have change-stream resume tokens and must not be serialized across restarts. Test million-record bounded-memory behavior, cancellation and restart recovery.
- [ ] **MongoDB P2 — transaction scope.** Design a single-execution/session boundary with retry/idempotency rules; sessions cannot be persisted through arbitrary waits or distributed steps. Verify multi-collection rollback and failover on a supported replica set before exposing transaction activities.
- [ ] **MongoDB P2 — index management / GridFS.** List/create/drop indexes with explicit destructive opt-in, unique/compound/TTL tests and privileges; bounded GridFS upload/download/delete with cleanup and cancellation. Existing driver probes alone do not certify these activities.
- [ ] **Developer chat SDK.** Keep the existing zero-code chat page and `widget.js`, and add a small browser SDK for custom public-facing chat interfaces: authenticated requests, conversation tokens, history, job polling, attachments, cancellation and structured errors. Since 2.1.5 the chat page and widget carry a website's login (`window.SutraChat.token`) and every answer carries a signed conversation token.
- [ ] **Conversation operations UI.** Add an access-controlled Admin Console view for conversation metadata, usage, retention, deletion, failures and human hand-offs. Do not expose message content merely because someone can operate the server.
- [ ] **Developer portal.** Build a consumer-facing portal around the existing OpenAPI output, service discovery, application registration, credentials, plans, examples and usage. The present Admin Console API page is an operator view, not a developer portal.
- [ ] **Profile picture.** Raised 8 November 2026 with My profile (2.1.8, built without it): a picture per person, shown in the designer and the Admin Console; from a file (size and type checked) or from single sign-on.
- [ ] **OAuth sign-in for personal Git accounts.** Administrators register GitHub, GitLab or Bitbucket OAuth applications; users connect an account without manually creating a personal access token. Preserve encrypted per-user credentials, repository permissions and auditable disconnect/revocation.
- [ ] **DNS-01 ACME and wildcard certificates.** HTTP-01 works for ordinary host names; wildcard certificates require DNS-01 provider integrations and secure DNS credentials.
- [ ] **Additional AI-memory database backends.** Decide whether dedicated SQL Server and Oracle memory backends are needed. Normal database activities already support them; AI memory currently supports built-in storage, folders, SQLite, PostgreSQL and MySQL.
- [ ] **Separate gateway and worker deployments.** Replace process-local reply handles with a durable or pub/sub reply path before gateways and workers run independently.
- [ ] **Large-payload object storage.** Since 2.1.1 large parts of a run's input are stored once in the engine database (`payloads`). Left: values made inside a run (large step outputs), and keeping payloads in object storage (S3, Azure Blob) instead of the database for very large data.
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

