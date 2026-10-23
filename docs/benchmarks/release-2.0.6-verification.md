# SutraFlow 2.0.6 release verification

Verified on 23 October 2026. This records the local release gate, not a sustained messaging performance benchmark.

## Code and dependencies

- Final complete regression: **387 tests; 379 passed, 0 failed, 8 skipped**, including real PostgreSQL and MySQL and the secondary PGlite suite (284 seconds).
- Skips: unavailable Linux Docker image build, three opt-in native broker placeholders and four opt-in REST checks. Broker coverage was executed separately below.
- Server, web and test TypeScript checks: passed.
- Clean build: passed.
- npm audit: **0 vulnerabilities**.
- Vendor integrity and upstream npm freshness: passed.
- Final diff whitespace check and guide/architecture internal anchor checks: passed.

## Messaging certification

| Broker | Mode | Result |
|---|---|---|
| ActiveMQ Classic 6.3.2 | Plain AMQP 1.0, including Java OpenWire/Jakarta Messaging interoperability | 13/13 |
| ActiveMQ Classic 6.3.2 | Strict private-CA mTLS through the test TLS proxy | 13/13 |
| RabbitMQ 4.4.0 | Plain AMQP 0-9-1 | 8/8 |
| RabbitMQ 4.4.0 | Strict private-CA mTLS through the test TLS proxy | 8/8 |
| Hosted Aiven Kafka | TLS + SASL PLAIN | 7/7 |
| Hosted Aiven Kafka | Client-certificate mutual TLS | 7/7 |

Total: **56 native scenario executions passed**. REST checks: **4/4 passed**, covering Kafka publish and consumer lifecycle; RabbitMQ publish/fetch/ack/cleanup; ActiveMQ Jolokia create/send/browse/remove/cleanup; engine execution of all four generated REST samples. See [architecture certification](../sutraflow-architecture.html#messaging-certification) for scenario details and limits.

Two further local documentation runs completed on the refreshed development server: deployed RabbitMQ and ActiveMQ starters each processed a real message and completed their explicit Confirm activity. Their application and run screenshots are embedded in the user guide.

## Release archives

| Artifact | SHA-256 |
|---|---|
| `sutraflow-2.0.6-windows.zip` | `449da6e9d25969b956dda1cd2214030e3c5db392dbd4f0a45b56efea92390f6c` |
| `sutraflow-2.0.6-linux.tar.gz` | `b023e2f384970ff7fe6241e3c4fb903be2acb3f9fc24895f37bcb8140586715f` |

Each archive contains 206 runtime/guide files. SHA files verified, manifests and all file bytes match across Windows/Linux archives, and the Linux executable permission bits are correct. Tests, source trees, soak output, benchmark reports and development dependencies are excluded. Temporary Kafka password/private-key values were checked against every shipped file and were absent; the four temporary Kafka credential files were removed after certification.

Both archives were extracted independently and each installed 328 production packages using `npm ci --omit=dev`. Each extracted runtime passed readiness, Designer, Admin Console, Approval Center, user guide, architecture, availability of the four REST samples, a deployed REST response and saved run verification.

**OS boundary:** both extracted runtimes were executed on Windows. Shell syntax was checked with Git Bash; tar permissions and Windows/Linux content parity were verified. Native Linux execution and Docker image build were unavailable because this machine has neither WSL nor a compatible Linux Docker runtime. These results do not claim a native Linux smoke run.

## Local deployment

- Development: `http://127.0.0.1:4800`, version 2.0.6, ready.
- Laragon: `C:\laragon\www\sutra`, version 2.0.6, `http://127.0.0.1:4810`, gateway 8090, ready.
- Existing Laragon `sutraflow.env` checksum preserved and data folder retained at `C:\laragon\data\sutraflow`.
- Existing PostgreSQL database retained; a custom-format PostgreSQL dump and runtime/config/data rollback copy were created before replacement.
- All 206 installed Laragon files matched the tested Windows archive byte-for-byte.
- Live Laragon readiness, Designer, Admin Console, user guide and architecture returned HTTP 200; no listener errors reported.
- No commit or push performed.
