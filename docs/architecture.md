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

A project has an immutable GUID independent of its display name. Renaming it keeps that identity and moves only its name-based files folder and deployment configuration, updating the configuration's project name at the same time.

## Properties in every palette

Project (`gv`) and Engine (`ev`) properties use one runtime resolver across all palettes and transition-line conditions. General settings such as folders, addresses, gateway paths and limits, schedules, queue/topic names and numeric limits resolve when an activity, route, timer or long-running listener is built. Mapped Input fields and connection conditions resolve against the same scope, as do recursively nested connection settings such as default headers. The transition editor provides the same property picker and missing-Project-property warning as activity fields, and a Condition data tree built from `input`, earlier `nodes`, Local `vars`, Project `gv`, Engine `ev`, `trigger` and `now`. SQL statement fields may use properties for administrator-controlled identifiers or clauses; values from callers and previous activities stay in bound `:name` parameters.

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

**Queue/topic starters.** Kafka, RabbitMQ and ActiveMQ/AMQP subscriptions are owned only by the elected leader. Client acknowledgement waits for the full run to succeed; explicit acknowledgement waits for Confirm message. Before a protected delivery starts, `bus_messages` stores its Kafka topic/partition/offset or RabbitMQ/AMQP message id with a reserved run id. If a replacement leader receives the delivery, it waits for that durable run or acknowledges an already completed result instead of creating another run. Kafka always supplies its offset identity; external AMQP publishers must set a unique message id. RabbitMQ in-place requeues are counted by the listener because they do not create `x-death`; ActiveMQ AMQP connections use distinct publisher/listener container IDs. Java OpenWire/JMS and SutraFlow AMQP can share an ActiveMQ destination; Classic must use `transport.transformer=jms` on the AMQP connector for ordinary JMS bodies. Kafka, RabbitMQ and ActiveMQ connectors all enforce certificate verification and support system or private CA trust plus optional mutual TLS with vault-held private keys; Kafka additionally supports SASL plain and SCRAM. The broker/outside-effect boundary is still at least once, so effects should accept an idempotency key.

**Locks on PostgreSQL.** Each write transaction about a run takes an advisory lock for that run (`run:<id>`), or for a Sutra's queue when it has a Runs at once limit; other writes take one shared lock. Engines therefore save different runs at the same time. Engines claim tasks with `for update skip locked`.

**In memory.** A Sutra tuned to run in memory goes to a second engine in the same process, whose runs and tasks live in a private in-memory SQLite database. The run row and its task rows are written to the database in one transaction when the run ends. Steps cost no database writes, but a run open when the process stops is lost, and steps that wait (approvals, Call Sutra with wait) are refused. Tests and debugging always run durable.

**Request/reply.** The gateway registers a reply handle for the run. The first Send HTTP response or SOAP reply step answers the caller, and the Sutra may continue afterwards. If the run ends without a reply step, the caller receives the last output (200) or the error (500 or a SOAP fault). Callers wait at most `SUTRA_REPLY_TIMEOUT_MS`; the run itself continues after that.

**Masking.** Secrets revealed while a step runs (through a resource or `{{secret.X}}`) are replaced by `••••••` in its stored output, logs and variables.

## Messaging certification and benchmark record

The [architecture page's messaging certification record](sutraflow-architecture.html#messaging-certification) documents the 23 October 2026 SutraFlow 2.0.6 results, protocol terminology, security configurations, scenario matrix and measurement limits. This is internal interoperability certification, not a broker-vendor certificate.

| Real service | Protocol | Connection modes passed | Native results |
|---|---|---|---|
| Hosted Aiven Kafka | Kafka wire protocol / KafkaJS | TLS + SASL PLAIN; separately client-certificate mutual TLS | 7/7 per mode |
| RabbitMQ 4.4.0 | AMQP 0-9-1 / amqplib | Plain TCP; separately private-CA mutual TLS through a test proxy | 8/8 per mode |
| ActiveMQ Classic 6.3.2 | AMQP 1.0 / rhea, interoperating with Java Jakarta Messaging over OpenWire | Plain AMQP; separately private-CA mutual TLS through a test proxy; Java OpenWire probe on TCP | 13/13 per mode |

The 56 native scenario executions cover body/metadata, acknowledgement modes, confirm/requeue/reject, missing confirmation, retry ceilings, duplicate protection, listener replacement and concurrency. Broker-specific tests additionally cover Kafka keys/offsets/partitions, RabbitMQ TTL/durable topic bindings, and ActiveMQ selectors/TTL/durable topics/two-way Java interoperability. TLS is transport security; SASL is authentication; JMS/Jakarta Messaging is a Java API, while AMQP and OpenWire are wire protocols. The test proxy verifies SutraFlow's mTLS client path, not the broker's native TLS-listener setup. SCRAM is configurable but was not exercised by the hosted certification.

Four REST checks also passed: Kafka publish and create/subscribe/poll/commit/close over HTTPS, RabbitMQ management publish/fetch/ack/cleanup, ActiveMQ Jolokia create/send/browse/remove/cleanup, and engine execution of all four generated REST samples (including Kafka subscribe). The local management endpoints used loopback HTTP. ActiveMQ's deprecated MessageServlet remains disabled. REST management operations do not carry the native trigger's acknowledgement guarantees.

These are correctness and recovery checks. Sustained messaging throughput and p50/p95/p99 latency were not measured; engine soak figures must not be presented as broker-protocol benchmark results. The HTML record lists the exact suites, tested boundaries and information required for a future performance measurement.

## Security paths

Outbound: step → resource (HTTP connection: TLS/mTLS/proxy; outbound security: header auth or WS-Security) → undici, or node-soap for WSDL calls. For SOAP, the `wsse:Security` header is built by `wss.ts` (UsernameToken digest/text, Timestamp, SAML assertion) and signed by node-soap's `WSSecurityCert` (xml-crypto) for X.509. The same code serves WSDL and raw-envelope calls.

Inbound: gateway → policy: HTTPS required → IP allow list → authentication (Basic, API key, JWT through jose, WS-Security UsernameToken with replay cache, mTLS through the TLS socket) → rate limit → CORS. Failures return 401/403/429; SOAP callers get a SOAP fault.

## Reviewed vendor dependencies

`vendor/vendor-lock.json` is the supply-chain boundary for maintained local package forks. It records the reviewed npm version and tarball integrity, the patched local version and normalized tree hash, why every patch exists, consumers, focused tests, and whether the package is runtime or test-only. `npm run vendor:check` runs before every build without a network; CI, releases and the weekly freshness workflow add the official npm `latest` check. A newer upstream version blocks the connected gate until its API and behavior changes are reviewed, SutraFlow patches are reapplied, dependent code is aligned, and the focused and complete regression suites pass. `tools/build-release.mjs` reads the same policy so only shipped runtime entries enter an archive.

## Gateway TLS and ACME

ACME is called only when the gateway uses **Let's Encrypt**. It automates issuance and renewal of a publicly trusted gateway certificate; self-signed and uploaded-certificate modes never call it.

1. `web/admin/Server.tsx` saves the domains, email, staging choice and agreement, then calls `POST /api/server/tls/acme`.
2. `server/src/api.ts` requires the Server permission, selects ACME mode and starts `requestAcme(reloadTls)`.
3. `server/src/gateway/tls.ts` takes and renews the shared `acme-certificate` database lease, so only one engine orders at a time. It decrypts or creates the encrypted ACME account key, creates a fresh private key and CSR, and asks the Let's Encrypt staging or production directory for an HTTP-01 order. Its maintained client uses native Node cryptography and `@peculiar/x509`; it does not install or call `node-forge`.
4. While validation is active, `tls.ts` keeps each token and key authorization in the shared `acme_challenges` table with its engine and expiry. Every `server/src/gateway/gateway.ts` serves it at `/.well-known/acme-challenge/<token>` before normal route dispatch. Public port 80 may reach any healthy gateway, but must reach that listener unchanged.
5. On success, `tls.ts` stores the certificate chain and matching key through encrypted settings, reloads its HTTPS context and raises the cluster generation. Every other engine reloads the certificate on its next heartbeat without deliberately dropping existing connections.
6. `server/src/index.ts` starts the renewal check. It runs shortly after boot and every 12 hours; a missing certificate or fewer than 30 days remaining starts the same path. Failure leaves the existing certificate installed for the next retry.

Wildcard names are not supported because they require DNS-01. Challenge key authorizations are public proof values rather than private keys and expire after 15 minutes. A failed engine's issuance lease expires after 10 minutes; its in-flight ACME order is not transferred, so a later request or renewal check starts a new one.

Planned scale-out changes and their implementation order are maintained in [the backlog](backlog.md), rather than in this description of the current architecture.
