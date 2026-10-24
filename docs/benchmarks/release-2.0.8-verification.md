# SutraFlow 2.0.8 engineering verification

2026-10-24, Windows, local PostgreSQL and MySQL. Working-tree changes only: no Git commit/tag, package publication or deployment is part of this verification. Functional regression is not third-party certification, exhaustive standards conformance, a load benchmark or a new soak.

## Expanded messaging certification

Windows x64, Node.js 22.23.2, bundled OpenSSL 3.5.7. Native clients: KafkaJS 2.2.4, rhea 3.0.5 and amqplib 2.2.0.

| Service / transport | Passed |
|---|---|
| ActiveMQ Classic 6.3.2: plain AMQP 1.0, including two-way Java OpenWire/Jakarta Messaging interoperability | 15/15 |
| ActiveMQ: strict private-CA mutual TLS through a local protocol-forwarding test proxy | 15/15 |
| RabbitMQ 4.4.0: plain AMQP 0-9-1 | 9/9 |
| RabbitMQ: strict private-CA mutual TLS through a local protocol-forwarding test proxy | 9/9 |
| Hosted Aiven Kafka: provider-CA TLS with SASL PLAIN | 9/9 |
| Hosted Aiven Kafka: provider-CA mutual TLS without SASL | 9/9 |

**66 successful native scenario executions**, not message counts. All five formats (JSON/XML/text/map/bytes) round-trip through activities. XML retains exact text, namespaces, attributes and Unicode. Malformed JSON/XML fails before business processing and respects delivery ceilings. Other cases cover headers/properties, auto/client/explicit acknowledgement, Confirm/requeue/reject/missing Confirm, duplicates, listener rebuild and concurrency. ActiveMQ/RabbitMQ cover expiry and topics; ActiveMQ also covers selectors and OpenWire interoperability. The generated XML queue sample runs against ActiveMQ in both transport modes: receive, publish exact XML to a second queue, then explicitly confirm.

The local mTLS proxies authenticate the client and forward the actual broker protocol. They do not certify native Java keystores or RabbitMQ TLS listener setup; the Java OpenWire probe uses plain local TCP. JMS is an API/message model, not an encryption protocol. Java ObjectMessage serialization is not supported. No throughput, sustained-outage or exactly-once external-side-effect guarantee is implied.

**Broker REST: 4/4 passed**: RabbitMQ publish/fetch/ack/cleanup; ActiveMQ Jolokia create/send/browse/remove/cleanup; Kafka publish and create/subscribe/poll/commit/close; engine execution of all four generated REST samples, including Kafka REST subscribe. Native Kafka and its REST endpoint use different issuers: the REST endpoint passes with public trust, not the native broker's private CA. Verification stays enabled.

### Transcripts

Local transcripts are in the Codex task workspace, not release archives.

| Transcript | SHA-256 |
|---|---|
| messaging-208-kafka-sasl.log | d059f899f556a71f0d853c1c9c9459c0834b9d4e246ac5b863300985d7bb4e62 |
| messaging-208-kafka-mtls.log | c95be8f6e99d6874e3a310e40a5d23e7315f759ed285b088857f6c0047596ff3 |
| messaging-208-mtls-final.log | 1e06593e7e179b2b95f39fb288d026ae1afc443c910f1859a5fdafdc4bdb0d51 |
| messaging-208-rest-final.log | 1461e383c14ff23b1ac38cef760228f6b84e749d1eb416e68ac28b58e0b12e29 |
| remote-db-208-final.log | 34268c5a6a89a6104f7e007ad88400d6bdd9f98b53f1957dddc351cd5d51a142 |

Reproduce native suites with `test/activemq.test.ts`, `test/rabbitmq.test.ts`, `test/kafka.test.ts`; REST with `test/broker-rest.test.ts`; external database engine queries with `test/remotedb.test.ts`. Supply their opt-in flags/credentials through the environment. `test/fixtures/broker-tls-proxy.mjs` runs both local broker suites with generated short-lived mTLS fixtures; those fixtures are not packaged. Concurrent test runs require distinct `SUTRA_TEST_PORT_OFFSET` values.

## Latest combined regression

Final build/regression passed: **447 tests, 440 passed, 0 failed, 7 skipped, 372.520 seconds**. This run includes real local PostgreSQL/MySQL, external PostgreSQL/MariaDB and plain local ActiveMQ/RabbitMQ. The seven skips are the separately executed hosted Kafka matrix and four broker REST checks, the standalone PostgreSQL SSL/bin-folder fixture, and the Linux Docker image build. Kafka and REST results above are actual separate passes, not inferred from skipped placeholders.

Transcript: `regression-2.0.8-certification-final.log`; SHA-256 `438f875fe2ba66b8c635bb274285003a820267b2302c1caf98e4e31092b0ec50`. An exploratory combined run exposed overlapping fixture ports and is not counted as passing. Broker fixtures now have distinct ports, and separate certification processes use explicit offsets.

After final guide/architecture/sample generation, `test/regression.test.ts` passed **26/26** in 4.622 seconds, including documentation/catalogue/version/link checks. Source-header and diff-whitespace checks also pass. Temporary Kafka client key/certificate copies and saved Kafka passwords were removed after certification; the user-requested remote database test settings remain ignored by Git.

## Completed earlier gates and external database checks

### Remote PostgreSQL connector check — 2026-10-24

The user-supplied temporary managed PostgreSQL endpoint passed a real external-network check through `dbConnection`: PostgreSQL 17.2, an exact bound string containing SQL metacharacters, and a transaction deliberately rolled back. A separate probe of the same driver TLS configuration confirmed an encrypted, authorized TLS 1.3 client connection with certificate verification enabled. No persistent database objects were created.

This is a pooled endpoint: `pg_stat_ssl` reports the pool-to-database backend connection as unencrypted. That does not describe the independently verified client-to-pool TLS connection. Confirm the provider's internal transport policy before production use. This short functional check is not the separate-machine 24-hour engine soak or certification of SQL Server/Oracle.

Credentials and the repeatable local check are retained only in Git-ignored `data/test-4800/`; neither connection URL nor password is included in this record. The existing 4800/4810 installations were not reconfigured.

The table below records the earlier strict-validation baseline. The expanded final full-suite gate above supersedes it.

### Remote MySQL/MariaDB connector check — 2026-10-24

The supplied remote server reports **11.8.9-MariaDB-log**. SutraFlow's MySQL connector connected on port 3306 with trusted-chain/hostname verification enabled and negotiated `TLS_AES_256_GCM_SHA384`. The bound-query injection-marker check and deliberate transaction rollback path passed. The first credentials were rejected; after the user reset the password, the same endpoint and connector succeeded. No persistent database objects were created, and no password is included in this document.

The opt-in `test/remotedb.test.ts` additionally executes SQL query activities through the engine against both external databases. Project properties select the host and TLS Boolean; an Engine property supplies the port. Both external cases passed before the final combined regression. Test configuration lives only in ignored `data/test-4800/` and is not a deployed 4800/4810 configuration.

| Gate | Result |
|---|---|
| Server, web and test TypeScript | Passed |
| Source copyright headers | Passed |
| Vendor integrity (build prerequisite) | Passed |
| npm audit | 0 vulnerabilities at verification time |
| Full clean-build regression with real PostgreSQL and MySQL | 417 tests: 408 passed, 0 failed, 9 skipped; 307.297 seconds |
| Focused settings / legacy files / properties / strict contracts | 51 passed, 0 failed |
| Focused contract / samples / generated process documentation | 31 passed, 0 failed |
| Latest strict JSON/XML and gateway boundaries | 13 passed, 0 failed |
| Final build and post-build JSON/XML / files / WebSocket / sample regression | Build passed; 28 passed, 0 failed |
| Guide, architecture and sample-project generators | Passed |

Full-run transcript: `regression-2.0.8-final.log` in the Codex task workspace. SHA-256: `07b84b869612f645994c4e2e1a59de52de30327e4833f5efe42ab16f0207c413`.

The latest service-boundary guards and JSON/XML writer schema-kind guard were checked again after the final build in `regression-2.0.8-postbuild.log` (28 passed). This focused post-build gate supplements the complete suite; no new soak is implied.

The nine skips are seven separately opt-in real-broker/broker-REST checks, the standalone PostgreSQL SSL/bin-folder fixture, and the Linux Docker image build. Real PostgreSQL pooling, database outage/reconnect, shared-engine behavior and real MySQL queries/transactions/procedures did run. PGlite passed as secondary compatibility coverage. Earlier sandbox Git/SFTP permission failures are not product failures; the machine-level run uses isolated fixture directories outside those restrictions. An earlier gate caught legacy file-default precedence, the old permissive-sample assertion and the stale README test count; these were corrected before the clean gate.

## New regression coverage

The initial codec/engine/TLS-option checks and local broker matrices passed 26/26. The expanded broker results above supersede that preliminary batch. New codec tests additionally reject multiple XML roots, undeclared entities, invalid XML characters and non-canonical base64. Designer envelopes cannot bypass format checks. Starter tests cover selected-starter and in-memory dispatch and simulate an old published multi-starter version: no HTTP route or broker listener is registered.

`test/strict208.test.ts` executes engine activity paths, not just the standalone validator:

- Parse JSON, Render JSON, Parse XML, Render XML, Map JSON Data and Map XML Data reject validation On without a contract; Deploy reports the missing contract.
- JSON/XML parsers and renderers reject missing fields, wrong-kind schemas and missing Boolean property references. Explicit Off and omitted default Off retain unchecked behavior.
- Fixed/property checkbox values use the same strict true/on/yes/1 and false/off/no/0 conversion. Invalid and missing values fail; typed Boolean Project properties accept On correctly.
- Strict JSON samples reject missing, extra, nested and wrong-type fields. Null and heterogeneous example arrays are covered. Keyword-only and Boolean JSON Schemas are recognized as contracts rather than mistaken for samples.
- Saving changed schema text invalidates its compiled check immediately, including same-timestamp edits.
- Old published REST, SOAP and WebSocket configurations with rejection enabled but no schema return errors and start no workflow runs. WebSocket text messages cannot skip the configured contract check.
- Process HTML/Markdown documents include defaults, inactive fields, long values, full mapping expressions and property-controlled Boolean references; known credentials are redacted.

Existing focused regressions additionally exercise strict JSON/XML file reads, unchecked reads, missing/wrong-kind contracts, shared local/FTP/SFTP validation paths, validation before file writes/business HTTP calls, XML namespace-preserved SOAP, authorized invalid requests and authentication/scope rejection without diagnostic leakage.

## Important boundaries

- Validation switches default Off. Existing imported drafts are not rewritten: inspect and retest them. Explicit On requires a matching selected contract. Manual typed target checks are independent of schema validation.
- JSON sample contracts are strict shapes, but JSON Schema follows its authored rules: an optional property stays optional and undeclared properties remain allowed unless its schema forbids them. Use explicit JSON Schema for those policies.
- XSD support remains XSD 1.0, with the documented isolated-worker bounds; XSD 1.1, remote schema fetching and DTD/entities are not supported. Large CSV streaming is unchanged. File-trigger failures retain their existing readError handling contract.
- Documentation shows declared defaults and stored configuration; it does not evaluate properties or retrieve vault contents. Known credential keys/headers, URL userinfo and private-key PEMs are redacted, but arbitrary secrets embedded in free-text scripts cannot be reliably inferred. Keep credentials in the vault and review exported documents.
- The current 4800/4810 installations have not been restarted/deployed by this task. No new release archives or soak were created.
- SQL Server/Oracle and other unprovided real-service endpoints are not newly certified. The 24-hour separate-machine PostgreSQL soak, Linux Docker image and public Let's Encrypt staging gates remain in the backlog. Multi-user AI conversation/job ownership is also still pending; passing messaging tests does not resolve it.
