# SutraFlow 2.0.11 release notes — source verified, packaging pending

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
