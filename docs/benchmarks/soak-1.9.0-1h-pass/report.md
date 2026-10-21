# SutraFlow 1.9.0 soak test

2026-10-21T04:36:27.423Z to 2026-10-21T05:36:53.215Z (1 hours), 3 processes (a studio and 2 engines) on PostgreSQL, AMD Ryzen 7 7435HS, 16 threads, 24 GB, win32, Node v24.21.0.

**26 of 26 checks passed.**

| Check | Result | Detail |
|---|---|---|
| No engine stopped by itself | pass | 0 unexpected stops |
| No run left running | pass | 0 runs still open after starters stopped |
| No step ran twice | pass | 0 steps of single-pass Sutras completed more than once |
| Requests that failed | pass | 26 of 70885 (0.037%), fault windows included |
| Timer kept time | pass | 357 runs of 360 expected (every 10 s) |
| Every channel message reached its subscriber | pass | 715 subscriber runs for 715 published |
| Bus messages acknowledged | pass | 1772 accepted, 0 released, 0 rejected of 1774 sent |
| WebSocket client trigger ran for the server's messages | pass | 720 runs for 720 messages pushed |
| WebSocket broadcasts arrived | pass | 595 received of 594 expected (119 broadcasts to the clients connected at the time) |
| Every CSV in the folder was streamed whole | pass | 2 of 2 files with every row counted (10 MB, 50 MB) |
| Every SFTP CSV was streamed whole | pass | 1 of 1 files with every row counted (20 MB) |
| Every FTP CSV was streamed whole | pass | 1 of 1 files with every row counted (30 MB) |
| RAG passages are in the pgvector table | pass | 57125 passages in soak_knowledge |
| RAG documents were learned | pass | 40 MB done in 67 s |
| Engine 0 stays responsive | pass | event loop delay: p99 per minute 35 ms typical, 37 ms in the worst 5% of minutes; longest single wait 827 ms |
| Engine 1 stays responsive | pass | event loop delay: p99 per minute 35 ms typical, 36 ms in the worst 5% of minutes; longest single wait 693 ms |
| Engine 2 stays responsive | pass | event loop delay: p99 per minute 35 ms typical, 36 ms in the worst 5% of minutes; longest single wait 845 ms |
| REST orders stays as fast | pass | p95 212 ms in the first period, 217 ms in the last |
| REST in memory stays as fast | pass | p95 9 ms in the first period, 16 ms in the last |
| REST signed and validated stays as fast | pass | p95 216 ms in the first period, 230 ms in the last |
| SOAP UsernameToken stays as fast | pass | p95 216 ms in the first period, 230 ms in the last |
| SOAP X.509 signed and encrypted stays as fast | pass | p95 232 ms in the first period, 249 ms in the last |
| WebSocket echo stays as fast | pass | p95 213 ms in the first period, 222 ms in the last |
| Channel publish stays as fast | pass | p95 531 ms in the first period, 551 ms in the last |
| Error handler stays as fast | pass | p95 1035 ms in the first period, 1056 ms in the last |
| MCP tool stays as fast | pass | p95 217 ms in the first period, 221 ms in the last |

## Scenarios

| Scenario | Done | Failed | p50 / p95 / p99 ms (last period) | Most frequent error |
|---|---|---|---|---|
| REST orders | 33130 | 5 | - | fetch failed (2) |
| REST in memory | 17048 | 6 | - | fetch failed (4) |
| REST signed and validated | 3533 | 3 | - | fetch failed (2) |
| SOAP UsernameToken | 3536 | 0 | - |  |
| SOAP X.509 signed and encrypted | 893 | 0 | - |  |
| WebSocket echo | 8856 | 1 | - | connection closed (1) |
| WebSocket broadcast | 119 | 0 | - |  |
| Channel publish | 715 | 0 | - |  |
| Error handler | 715 | 0 | - |  |
| Called Sutra and approval | 118 | 1 | - | POST /api/flows/f035a185-d99b-4066-8d95-1dd2e8956663/run: gave up after 1 tries: fetch failed (1) |
| MCP tool | 358 | 0 | - |  |
| Bus message | 1774 | 10 | - | the subscriber is not connected (10) |
| RAG search | 59 | 0 | - |  |
| Folder CSV (streamed) | 2 | 0 | - |  |
| SFTP CSV | 1 | 0 | - |  |
| FTP CSV (streamed) | 1 | 0 | - |  |
| RAG document ingest | 1 | 0 | - |  |

## Faults on purpose

- engine killed at 2026-10-21T04:56:41.693Z
- database cut at 2026-10-21T05:16:41.543Z

## Big files

| Kind | File | Size | Result |
|---|---|---|---|
| Folder CSV (streamed) | soak-23906-10mb.csv | 10 MB, 198000 rows | see check |
| Folder CSV (streamed) | soak-47714-50mb.csv | 50 MB, 968000 rows | see check |
| SFTP CSV | soak-35867-20mb.csv | 20 MB, 390000 rows | see check |
| FTP CSV (streamed) | soak-35868-30mb.csv | 30 MB, 582000 rows | see check |
| RAG document (streamed to pgvector) | soak-doc-35869-40mb.txt | 40 MB | done in 67 s, 43 parts |

## Resources

| Engine | Highest memory | Last memory | Restarts |
|---|---|---|---|
| studio | 536 MB | 284 MB | 0 |
| engine 1 | 528 MB | 279 MB | 0 |
| engine 2 | 441 MB | 287 MB | 0 |

Database: 689 MB at the end; runs {"done":72434}.

## Events

- 0 min, start: SutraFlow 1.9.0, 3 processes, 60 minutes, database sutra_soak_1792557387516, 16 threads, 24 GB
- 0.1 min, setup: 21 Sutras deployed
- 0.2 min, load: 17 scenarios running
- 20.2 min, file: soak-23906-10mb.csv: 198000 rows to the watched folder
- 20.2 min, fault: engine 2 killed on purpose
- 21.3 min, fault: engine 2 started again
- 30.2 min, file: soak-35867-20mb.csv: 390000 rows to the SFTP inbox
- 30.2 min, file: soak-35868-30mb.csv: 582000 rows to the FTP inbox
- 31.4 min, document: soak-doc-35869-40mb.txt: done in 67 s
- 40.2 min, fault: database cut for 20 seconds
- 40.2 min, file: soak-47714-50mb.csv: 968000 rows to the watched folder
- 40.6 min, fault: database back
- 60.1 min, load: load stopped and starters undeployed; waiting for open runs to end (at most 10 minutes)
- 60.4 min, check: PASS No engine stopped by itself: 0 unexpected stops
- 60.4 min, check: PASS No run left running: 0 runs still open after starters stopped
- 60.4 min, check: PASS No step ran twice: 0 steps of single-pass Sutras completed more than once
- 60.4 min, check: PASS Requests that failed: 26 of 70885 (0.037%), fault windows included
- 60.4 min, check: PASS Timer kept time: 357 runs of 360 expected (every 10 s)
- 60.4 min, check: PASS Every channel message reached its subscriber: 715 subscriber runs for 715 published
- 60.4 min, check: PASS Bus messages acknowledged: 1772 accepted, 0 released, 0 rejected of 1774 sent
- 60.4 min, check: PASS WebSocket client trigger ran for the server's messages: 720 runs for 720 messages pushed
- 60.4 min, check: PASS WebSocket broadcasts arrived: 595 received of 594 expected (119 broadcasts to the clients connected at the time)
- 60.4 min, check: PASS Every CSV in the folder was streamed whole: 2 of 2 files with every row counted (10 MB, 50 MB)
- 60.4 min, check: PASS Every SFTP CSV was streamed whole: 1 of 1 files with every row counted (20 MB)
- 60.4 min, check: PASS Every FTP CSV was streamed whole: 1 of 1 files with every row counted (30 MB)
- 60.4 min, check: PASS RAG passages are in the pgvector table: 57125 passages in soak_knowledge
- 60.4 min, check: PASS RAG documents were learned: 40 MB done in 67 s
- 60.4 min, check: PASS Engine 0 stays responsive: event loop delay: p99 per minute 35 ms typical, 37 ms in the worst 5% of minutes; longest single wait 827 ms
- 60.4 min, check: PASS Engine 1 stays responsive: event loop delay: p99 per minute 35 ms typical, 36 ms in the worst 5% of minutes; longest single wait 693 ms
- 60.4 min, check: PASS Engine 2 stays responsive: event loop delay: p99 per minute 35 ms typical, 36 ms in the worst 5% of minutes; longest single wait 845 ms
- 60.4 min, check: PASS REST orders stays as fast: p95 212 ms in the first period, 217 ms in the last
- 60.4 min, check: PASS REST in memory stays as fast: p95 9 ms in the first period, 16 ms in the last
- 60.4 min, check: PASS REST signed and validated stays as fast: p95 216 ms in the first period, 230 ms in the last
- 60.4 min, check: PASS SOAP UsernameToken stays as fast: p95 216 ms in the first period, 230 ms in the last
- 60.4 min, check: PASS SOAP X.509 signed and encrypted stays as fast: p95 232 ms in the first period, 249 ms in the last
- 60.4 min, check: PASS WebSocket echo stays as fast: p95 213 ms in the first period, 222 ms in the last
- 60.4 min, check: PASS Channel publish stays as fast: p95 531 ms in the first period, 551 ms in the last
- 60.4 min, check: PASS Error handler stays as fast: p95 1035 ms in the first period, 1056 ms in the last
- 60.4 min, check: PASS MCP tool stays as fast: p95 217 ms in the first period, 221 ms in the last

## Starters covered

Run here: Manual start (API), Timer, REST service, SOAP service, WebSocket service, WebSocket client, Folder (file) trigger on a shared location, Remote file trigger (SFTP and FTP), Message bus subscriber (AMQP 1.0 stand-in), Channel trigger, Error handler, MCP tool, AI agent channel (chat); Google Drive upload and fetch when its account is set up. Every file is streamed.

Not run here (they need outside accounts or servers): Email (IMAP), Kafka and RabbitMQ subscribers, the Google Drive trigger, Microsoft files, Twitch, Discord, Telegram, Azure Data Factory.
