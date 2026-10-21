# SutraFlow 1.9.0 soak test

2026-10-21T02:51:52.073Z to 2026-10-21T04:02:09.853Z (1 hours), 3 processes (a studio and 2 engines) on PostgreSQL, AMD Ryzen 7 7435HS, 16 threads, 24 GB, win32, Node v24.21.0.

**25 of 26 checks passed.**

| Check | Result | Detail |
|---|---|---|
| No engine stopped by itself | pass | 0 unexpected stops |
| No run left running | **fail** | 1 runs still running 10 minutes after the load stopped |
| No step ran twice | pass | 0 steps of single-pass Sutras completed more than once |
| Requests that failed | pass | 20 of 71105 (0.028%), fault windows included |
| Timer kept time | pass | 418 runs of 360 expected (every 10 s) |
| Every channel message reached its subscriber | pass | 714 subscriber runs for 714 published |
| Bus messages acknowledged | pass | 1774 accepted, 0 released, 0 rejected of 1776 sent |
| WebSocket client trigger ran for the server's messages | pass | 840 runs for 841 messages pushed |
| WebSocket broadcasts arrived | pass | 595 received of 595 expected (119 broadcasts to the clients connected at the time) |
| Every CSV in the folder was streamed whole | pass | 2 of 2 files with every row counted (10 MB, 50 MB) |
| Every SFTP CSV was streamed whole | pass | 1 of 1 files with every row counted (20 MB) |
| Every FTP CSV was streamed whole | pass | 1 of 1 files with every row counted (30 MB) |
| RAG passages are in the pgvector table | pass | 57125 passages in soak_knowledge |
| RAG documents were learned | pass | 40 MB done in 28 s |
| Engine 0 stays responsive | pass | event loop delay: p99 per minute 35 ms typical, 35 ms in the worst 5% of minutes; longest single wait 500 ms |
| Engine 1 stays responsive | pass | event loop delay: p99 per minute 35 ms typical, 35 ms in the worst 5% of minutes; longest single wait 449 ms |
| Engine 2 stays responsive | pass | event loop delay: p99 per minute 35 ms typical, 35 ms in the worst 5% of minutes; longest single wait 22700 ms |
| REST orders stays as fast | pass | p95 213 ms in the first period, 212 ms in the last |
| REST in memory stays as fast | pass | p95 12 ms in the first period, 9 ms in the last |
| REST signed and validated stays as fast | pass | p95 220 ms in the first period, 217 ms in the last |
| SOAP UsernameToken stays as fast | pass | p95 220 ms in the first period, 219 ms in the last |
| SOAP X.509 signed and encrypted stays as fast | pass | p95 244 ms in the first period, 230 ms in the last |
| WebSocket echo stays as fast | pass | p95 216 ms in the first period, 214 ms in the last |
| Channel publish stays as fast | pass | p95 539 ms in the first period, 531 ms in the last |
| Error handler stays as fast | pass | p95 1052 ms in the first period, 1033 ms in the last |
| MCP tool stays as fast | pass | p95 220 ms in the first period, 217 ms in the last |

## Scenarios

| Scenario | Done | Failed | p50 / p95 / p99 ms (last period) | Most frequent error |
|---|---|---|---|---|
| REST orders | 33230 | 6 | - | fetch failed (5) |
| REST in memory | 17147 | 3 | - | fetch failed (2) |
| REST signed and validated | 3539 | 0 | - |  |
| SOAP UsernameToken | 3538 | 1 | - | fetch failed (1) |
| SOAP X.509 signed and encrypted | 893 | 0 | - |  |
| WebSocket echo | 8874 | 1 | - | connection closed (1) |
| WebSocket broadcast | 119 | 0 | - |  |
| Channel publish | 714 | 0 | - |  |
| Error handler | 714 | 0 | - |  |
| Called Sutra and approval | 119 | 0 | - |  |
| MCP tool | 358 | 0 | - |  |
| Bus message | 1776 | 9 | - | the subscriber is not connected (9) |
| RAG search | 59 | 0 | - |  |
| Folder CSV (streamed) | 2 | 0 | - |  |
| SFTP CSV | 1 | 0 | - |  |
| FTP CSV (streamed) | 1 | 0 | - |  |
| RAG document ingest | 1 | 0 | - |  |

## Faults on purpose

- engine killed at 2026-10-21T03:12:08.124Z
- database cut at 2026-10-21T03:32:08.310Z

## Big files

| Kind | File | Size | Result |
|---|---|---|---|
| Folder CSV (streamed) | soak-23906-10mb.csv | 10 MB, 198000 rows | see check |
| Folder CSV (streamed) | soak-47833-50mb.csv | 50 MB, 968000 rows | see check |
| SFTP CSV | soak-35877-20mb.csv | 20 MB, 390000 rows | see check |
| FTP CSV (streamed) | soak-35878-30mb.csv | 30 MB, 582000 rows | see check |
| RAG document (streamed to pgvector) | soak-doc-35879-40mb.txt | 40 MB | done in 28 s, 43 parts |

## Resources

| Engine | Highest memory | Last memory | Restarts |
|---|---|---|---|
| studio | 389 MB | 162 MB | 0 |
| engine 1 | 478 MB | 154 MB | 0 |
| engine 2 | 496 MB | 170 MB | 0 |

Database: 693 MB at the end; runs {"done":72833,"running":1}.

## Events

- 0 min, start: SutraFlow 1.9.0, 3 processes, 60 minutes, database sutra_soak_1792551112182, 16 threads, 24 GB
- 0.1 min, setup: 21 Sutras deployed
- 0.3 min, load: 17 scenarios running
- 20.3 min, file: soak-23906-10mb.csv: 198000 rows to the watched folder
- 20.3 min, fault: engine 2 killed on purpose
- 21.3 min, fault: engine 2 started again
- 30.3 min, file: soak-35877-20mb.csv: 390000 rows to the SFTP inbox
- 30.3 min, file: soak-35878-30mb.csv: 582000 rows to the FTP inbox
- 30.7 min, document: soak-doc-35879-40mb.txt: done in 28 s
- 40.3 min, file: soak-47833-50mb.csv: 968000 rows to the watched folder
- 40.3 min, fault: database cut for 20 seconds
- 40.6 min, fault: database back
- 60 min, load: load stopped; waiting for open runs to end (at most 10 minutes)
- 70.3 min, check: PASS No engine stopped by itself: 0 unexpected stops
- 70.3 min, check: FAIL No run left running: 1 runs still running 10 minutes after the load stopped
- 70.3 min, check: PASS No step ran twice: 0 steps of single-pass Sutras completed more than once
- 70.3 min, check: PASS Requests that failed: 20 of 71105 (0.028%), fault windows included
- 70.3 min, check: PASS Timer kept time: 418 runs of 360 expected (every 10 s)
- 70.3 min, check: PASS Every channel message reached its subscriber: 714 subscriber runs for 714 published
- 70.3 min, check: PASS Bus messages acknowledged: 1774 accepted, 0 released, 0 rejected of 1776 sent
- 70.3 min, check: PASS WebSocket client trigger ran for the server's messages: 840 runs for 841 messages pushed
- 70.3 min, check: PASS WebSocket broadcasts arrived: 595 received of 595 expected (119 broadcasts to the clients connected at the time)
- 70.3 min, check: PASS Every CSV in the folder was streamed whole: 2 of 2 files with every row counted (10 MB, 50 MB)
- 70.3 min, check: PASS Every SFTP CSV was streamed whole: 1 of 1 files with every row counted (20 MB)
- 70.3 min, check: PASS Every FTP CSV was streamed whole: 1 of 1 files with every row counted (30 MB)
- 70.3 min, check: PASS RAG passages are in the pgvector table: 57125 passages in soak_knowledge
- 70.3 min, check: PASS RAG documents were learned: 40 MB done in 28 s
- 70.3 min, check: PASS Engine 0 stays responsive: event loop delay: p99 per minute 35 ms typical, 35 ms in the worst 5% of minutes; longest single wait 500 ms
- 70.3 min, check: PASS Engine 1 stays responsive: event loop delay: p99 per minute 35 ms typical, 35 ms in the worst 5% of minutes; longest single wait 449 ms
- 70.3 min, check: PASS Engine 2 stays responsive: event loop delay: p99 per minute 35 ms typical, 35 ms in the worst 5% of minutes; longest single wait 22700 ms
- 70.3 min, check: PASS REST orders stays as fast: p95 213 ms in the first period, 212 ms in the last
- 70.3 min, check: PASS REST in memory stays as fast: p95 12 ms in the first period, 9 ms in the last
- 70.3 min, check: PASS REST signed and validated stays as fast: p95 220 ms in the first period, 217 ms in the last
- 70.3 min, check: PASS SOAP UsernameToken stays as fast: p95 220 ms in the first period, 219 ms in the last
- 70.3 min, check: PASS SOAP X.509 signed and encrypted stays as fast: p95 244 ms in the first period, 230 ms in the last
- 70.3 min, check: PASS WebSocket echo stays as fast: p95 216 ms in the first period, 214 ms in the last
- 70.3 min, check: PASS Channel publish stays as fast: p95 539 ms in the first period, 531 ms in the last
- 70.3 min, check: PASS Error handler stays as fast: p95 1052 ms in the first period, 1033 ms in the last
- 70.3 min, check: PASS MCP tool stays as fast: p95 220 ms in the first period, 217 ms in the last

## Starters covered

Run here: Manual start (API), Timer, REST service, SOAP service, WebSocket service, WebSocket client, Folder (file) trigger on a shared location, Remote file trigger (SFTP and FTP), Message bus subscriber (AMQP 1.0 stand-in), Channel trigger, Error handler, MCP tool, AI agent channel (chat); Google Drive upload and fetch when its account is set up. Every file is streamed.

Not run here (they need outside accounts or servers): Email (IMAP), Kafka and RabbitMQ subscribers, the Google Drive trigger, Microsoft files, Twitch, Discord, Telegram, Azure Data Factory.
