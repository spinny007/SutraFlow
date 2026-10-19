# SutraFlow architecture

## Sutras and listeners

```
 Browser (studio, React + React Flow)
        │  HTTPS/HTTP, session cookie, X-Sutra header
        ▼
 ┌──────────────────────── one Node.js process ────────────────────────┐
 │ Admin API  (127.0.0.1:4800)   flows, versions, deploy, runs,        │
 │                               approvals, resources, secrets, TLS    │
 │                                                                     │
 │ Gateway    (:8080 HTTP, :8443 HTTPS)   deployed REST + SOAP         │
 │   policy check → start run → wait for reply step → respond          │
 │   /.well-known/acme-challenge for Let's Encrypt                     │
 │                                                                     │
 │ Scheduler  cron / interval timers of deployed flows                 │
 │                                                                     │
 │ Engine     worker slots (SUTRA_WORKERS) pulling tasks               │
 │   palettes: triggers, HTTP, SOAP, data, flow, general, AI           │
 │                                                                     │
 │ SQLite (data/sutra.db, WAL)   flows · versions · deployments ·      │
 │   runs · tasks · resources · secrets (AES-256-GCM) · settings       │
 └─────────────────────────────────────────────────────────────────────┘
```

| Module | File |
|---|---|
| Boot | `server/src/index.ts`, `server/src/main.ts` |
| Engine | `server/src/engine/engine.ts`, `types.ts` |
| Mapping expressions | `server/src/template.ts` |
| Palettes | `server/src/palettes/*.ts` |
| Outbound auth, TLS, HTTP | `server/src/security/outbound.ts` |
| WS-Security build/verify | `server/src/security/wss.ts` |
| Inbound policies | `server/src/security/inbound.ts` |
| Gateway, WSDL, SOAP envelopes | `server/src/gateway/gateway.ts` |
| Certificates, ACME | `server/src/gateway/tls.ts` |
| Sutras, versions, deploy | `server/src/flows.ts` |
| Admin API | `server/src/api.ts` |
| Studio | `web/src/*` |

## Sutra model

A Sutra document is JSON: `nodes` (id, type, name, position, config, settings) and `edges` (from, port, to). The canvas, the run history and the engine all use this one format. Step names are unique within a Sutra because mappings refer to them (`{{nodes.Get order.body}}`). Renaming a step rewrites those references.

Draft → **publish** (immutable version N) → **deploy** (pick a version). The gateway, timers and the Run API serve only deployed versions. Test runs use the draft. A run stores the document it started with, so in-flight runs keep their version after a redeploy.

## Engine: how a run executes

1. `startRun` inserts a run row and one **task** for the trigger step.
2. A worker slot claims the oldest pending task whose `not_before` has passed (status → running).
3. The activity's `execute` runs with its config resolved against the run context (`input`, `nodes`, `trigger`, `vars`, `secret`, `run`), under the step's timeout and an AbortSignal.
4. In **one transaction** the engine stores the step's output (the checkpoint), routes the result, and inserts tasks for the next steps.
   - Ports that fired carry a *live* token to the connected steps.
   - Ports that did not fire carry a *skip* token. A step that receives only skip tokens passes them on.
   - A **Merge** step fires once every incoming connection has delivered a token, with the outputs of the live branches. This is dead-path elimination.
5. The run's status is derived from its tasks: pending or running → running; only waiting → waiting; none left → done, or failed.

Results a step can return:

| Result | Effect |
|---|---|
| `out` / `port` | normal completion |
| `emits[]` | several outputs, e.g. For each sends one per item, then `done` |
| `wait` (approval) | task status waiting; no worker is held; `POST /api/approvals/:id` completes it |
| `deferUntil` | task goes back to pending with `not_before`, as a durable timer; it runs again with `phase = resume` |
| `emit(port, out)` while running | sends one output now (a streamed file batch); the connected steps start while the step goes on |
| throws | retry with exponential backoff (`retries`, `retryDelayMs`); then the **error** port if connected, otherwise the run fails and its open tasks are cancelled |

**Crash recovery.** At startup, tasks left as running go back to pending. Because a step can therefore run twice, steps with side effects should be idempotent: pass an idempotency key such as `{{run.id}}` to the target API.

**Locks on PostgreSQL.** Each write transaction about a run takes an advisory lock for that run (`run:<id>`), or for a Sutra's queue when it has a Runs at once limit; other writes take one shared lock. Engines therefore save different runs at the same time. Engines claim tasks with `for update skip locked`.

**In memory.** A Sutra tuned to run in memory goes to a second engine in the same process, whose runs and tasks live in a private in-memory SQLite database. The run row and its task rows are written to the database in one transaction when the run ends. Steps cost no database writes, but a run open when the process stops is lost, and steps that wait (approvals, Call Sutra with wait) are refused. Tests and debugging always run durable.

**Request/reply.** The gateway registers a reply handle for the run. The first Send HTTP response or SOAP reply step answers the caller, and the Sutra may continue afterwards. If the run ends without a reply step, the caller receives the last output (200) or the error (500 or a SOAP fault). Callers wait at most `SUTRA_REPLY_TIMEOUT_MS`; the run itself continues after that.

**Masking.** Secrets revealed while a step runs (through a resource or `{{secret.X}}`) are replaced by `••••••` in its stored output, logs and variables.

## Security paths

Outbound: step → resource (HTTP connection: TLS/mTLS/proxy; outbound security: header auth or WS-Security) → undici, or node-soap for WSDL calls. For SOAP, the `wsse:Security` header is built by `wss.ts` (UsernameToken digest/text, Timestamp, SAML assertion) and signed by node-soap's `WSSecurityCert` (xml-crypto) for X.509. The same code serves WSDL and raw-envelope calls.

Inbound: gateway → policy: HTTPS required → IP allow list → authentication (Basic, API key, JWT through jose, WS-Security UsernameToken with replay cache, mTLS through the TLS socket) → rate limit → CORS. Failures return 401/403/429; SOAP callers get a SOAP fault.

## Scaling path

The single Sutra with SQLite suits development and small production loads. Most of the work is waiting on I/O, so one Sutra with 16–64 worker slots handles many concurrent calls. The engine touches storage only through `db.ts` and the task table, which is the seam for growing:

1. Move to Postgres, and claim tasks with `SELECT … FOR UPDATE SKIP LOCKED` so several engine nodes can share one database.
2. Run the gateway and the workers as separate deployments; replies then go through the database or a pub/sub channel instead of in-memory handles.
3. Move large payloads to object storage and keep only references in task rows.
4. Add per-connector concurrency limits and per-tenant quotas at the claim step.
