# SutraFlow 1.9.0 soak test

2026-10-21T04:20:44.983Z to 2026-10-21T04:36:10.159Z (0.3 hours), 3 processes (a studio and 2 engines) on PostgreSQL, AMD Ryzen 7 7435HS, 16 threads, 24 GB, win32, Node v24.21.0.

**24 of 24 checks passed.**

| Check | Result | Detail |
|---|---|---|
| No engine stopped by itself | pass | 0 unexpected stops |
| No run left running | pass | 0 runs still open after starters stopped |
| No step ran twice | pass | 0 steps of single-pass Sutras completed more than once |
| Requests that failed | pass | 25 of 17212 (0.145%), fault windows included |
| Timer kept time | pass | 88 runs of 90 expected (every 10 s) |
| Every channel message reached its subscriber | pass | 175 subscriber runs for 175 published |
| Bus messages acknowledged | pass | 429 accepted, 0 released, 0 rejected of 431 sent |
| WebSocket client trigger ran for the server's messages | pass | 180 runs for 180 messages pushed |
| WebSocket broadcasts arrived | pass | 144 received of 144 expected (29 broadcasts to the clients connected at the time) |
| Every CSV in the folder was streamed whole | pass | 2 of 2 files with every row counted (10 MB, 10 MB) |
| Every SFTP CSV was streamed whole | pass | 2 of 2 files with every row counted (10 MB, 10 MB) |
| Every FTP CSV was streamed whole | pass | 2 of 2 files with every row counted (10 MB, 10 MB) |
| RAG passages are in the pgvector table | pass | 14294 passages in soak_knowledge |
| RAG documents were learned | pass | 10 MB done in 12 s |
| Engine 0 stays responsive | pass | event loop delay: p99 per minute 35 ms typical, 230 ms in the worst 5% of minutes; longest single wait 588 ms |
| Engine 1 stays responsive | pass | event loop delay: p99 per minute 35 ms typical, 220 ms in the worst 5% of minutes; longest single wait 567 ms |
| Engine 2 stays responsive | pass | event loop delay: p99 per minute 35 ms typical, 90 ms in the worst 5% of minutes; longest single wait 22616 ms |
| REST orders stays as fast | pass | p95 214 ms in the first period, 223 ms in the last |
| REST in memory stays as fast | pass | p95 15 ms in the first period, 13 ms in the last |
| REST signed and validated stays as fast | pass | p95 227 ms in the first period, 223 ms in the last |
| SOAP UsernameToken stays as fast | pass | p95 216 ms in the first period, 218 ms in the last |
| SOAP X.509 signed and encrypted stays as fast | pass | p95 279 ms in the first period, 228 ms in the last |
| WebSocket echo stays as fast | pass | p95 229 ms in the first period, 222 ms in the last |
| Bus message stays as fast | pass | p95 1 ms in the first period, 1 ms in the last |

## Scenarios

| Scenario | Done | Failed | p50 / p95 / p99 ms (last period) | Most frequent error |
|---|---|---|---|---|
| REST orders | 8018 | 9 | - | fetch failed (7) |
| REST in memory | 4143 | 4 | - | fetch failed (3) |
| REST signed and validated | 857 | 0 | - |  |
| SOAP UsernameToken | 856 | 1 | - | fetch failed (1) |
| SOAP X.509 signed and encrypted | 218 | 0 | - |  |
| WebSocket echo | 2148 | 1 | - | not connected (1) |
| WebSocket broadcast | 29 | 0 | - |  |
| Channel publish | 175 | 0 | - |  |
| Error handler | 175 | 0 | - |  |
| Called Sutra and approval | 28 | 1 | - | POST /api/flows/1300ff73-240f-4baa-b47d-9411350eb684/run: gave up after 1 tries: fetch failed (1) |
| MCP tool | 88 | 0 | - |  |
| Bus message | 431 | 9 | - | the subscriber is not connected (9) |
| RAG search | 14 | 0 | - |  |
| Folder CSV (streamed) | 2 | 0 | - |  |
| SFTP CSV | 2 | 0 | - |  |
| FTP CSV (streamed) | 2 | 0 | - |  |
| RAG document ingest | 1 | 0 | - |  |

## Faults on purpose

- engine killed at 2026-10-21T04:26:01.173Z
- database cut at 2026-10-21T04:31:01.164Z

## Big files

| Kind | File | Size | Result |
|---|---|---|---|
| Folder CSV (streamed) | soak-5949-10mb.csv | 10 MB, 198000 rows | see check |
| Folder CSV (streamed) | soak-11928-10mb.csv | 10 MB, 198000 rows | see check |
| SFTP CSV | soak-8338-10mb.csv | 10 MB, 198000 rows | see check |
| SFTP CSV | soak-16321-10mb.csv | 10 MB, 198000 rows | see check |
| FTP CSV (streamed) | soak-8339-10mb.csv | 10 MB, 198000 rows | see check |
| FTP CSV (streamed) | soak-16323-10mb.csv | 10 MB, 198000 rows | see check |
| RAG document (streamed to pgvector) | soak-doc-9539-10mb.txt | 10 MB | done in 12 s, 11 parts |

## Resources

| Engine | Highest memory | Last memory | Restarts |
|---|---|---|---|
| studio | 433 MB | 425 MB | 0 |
| engine 1 | 419 MB | 393 MB | 0 |
| engine 2 | 376 MB | 354 MB | 0 |

Database: 184 MB at the end; runs {"done":17568}.

## Events

- 0 min, start: SutraFlow 1.9.0, 3 processes, 15 minutes, database sutra_soak_1792556445087, 16 threads, 24 GB
- 0.1 min, setup: 21 Sutras deployed
- 0.3 min, load: 17 scenarios running
- 5.3 min, file: soak-5949-10mb.csv: 198000 rows to the watched folder
- 5.3 min, fault: engine 2 killed on purpose
- 6.3 min, fault: engine 2 started again
- 7.3 min, file: soak-8338-10mb.csv: 198000 rows to the SFTP inbox
- 7.3 min, file: soak-8339-10mb.csv: 198000 rows to the FTP inbox
- 8.5 min, document: soak-doc-9539-10mb.txt: done in 12 s
- 10.3 min, file: soak-11928-10mb.csv: 198000 rows to the watched folder
- 10.3 min, fault: database cut for 20 seconds
- 10.6 min, fault: database back
- 14.3 min, file: soak-16321-10mb.csv: 198000 rows to the SFTP inbox
- 14.3 min, file: soak-16323-10mb.csv: 198000 rows to the FTP inbox
- 15.1 min, load: load stopped and starters undeployed; waiting for open runs to end (at most 10 minutes)
- 15.4 min, check: PASS No engine stopped by itself: 0 unexpected stops
- 15.4 min, check: PASS No run left running: 0 runs still open after starters stopped
- 15.4 min, check: PASS No step ran twice: 0 steps of single-pass Sutras completed more than once
- 15.4 min, check: PASS Requests that failed: 25 of 17212 (0.145%), fault windows included
- 15.4 min, check: PASS Timer kept time: 88 runs of 90 expected (every 10 s)
- 15.4 min, check: PASS Every channel message reached its subscriber: 175 subscriber runs for 175 published
- 15.4 min, check: PASS Bus messages acknowledged: 429 accepted, 0 released, 0 rejected of 431 sent
- 15.4 min, check: PASS WebSocket client trigger ran for the server's messages: 180 runs for 180 messages pushed
- 15.4 min, check: PASS WebSocket broadcasts arrived: 144 received of 144 expected (29 broadcasts to the clients connected at the time)
- 15.4 min, check: PASS Every CSV in the folder was streamed whole: 2 of 2 files with every row counted (10 MB, 10 MB)
- 15.4 min, check: PASS Every SFTP CSV was streamed whole: 2 of 2 files with every row counted (10 MB, 10 MB)
- 15.4 min, check: PASS Every FTP CSV was streamed whole: 2 of 2 files with every row counted (10 MB, 10 MB)
- 15.4 min, check: PASS RAG passages are in the pgvector table: 14294 passages in soak_knowledge
- 15.4 min, check: PASS RAG documents were learned: 10 MB done in 12 s
- 15.4 min, check: PASS Engine 0 stays responsive: event loop delay: p99 per minute 35 ms typical, 230 ms in the worst 5% of minutes; longest single wait 588 ms
- 15.4 min, check: PASS Engine 1 stays responsive: event loop delay: p99 per minute 35 ms typical, 220 ms in the worst 5% of minutes; longest single wait 567 ms
- 15.4 min, check: PASS Engine 2 stays responsive: event loop delay: p99 per minute 35 ms typical, 90 ms in the worst 5% of minutes; longest single wait 22616 ms
- 15.4 min, check: PASS REST orders stays as fast: p95 214 ms in the first period, 223 ms in the last
- 15.4 min, check: PASS REST in memory stays as fast: p95 15 ms in the first period, 13 ms in the last
- 15.4 min, check: PASS REST signed and validated stays as fast: p95 227 ms in the first period, 223 ms in the last
- 15.4 min, check: PASS SOAP UsernameToken stays as fast: p95 216 ms in the first period, 218 ms in the last
- 15.4 min, check: PASS SOAP X.509 signed and encrypted stays as fast: p95 279 ms in the first period, 228 ms in the last
- 15.4 min, check: PASS WebSocket echo stays as fast: p95 229 ms in the first period, 222 ms in the last
- 15.4 min, check: PASS Bus message stays as fast: p95 1 ms in the first period, 1 ms in the last

## Starters covered

Run here: Manual start (API), Timer, REST service, SOAP service, WebSocket service, WebSocket client, Folder (file) trigger on a shared location, Remote file trigger (SFTP and FTP), Message bus subscriber (AMQP 1.0 stand-in), Channel trigger, Error handler, MCP tool, AI agent channel (chat); Google Drive upload and fetch when its account is set up. Every file is streamed.

Not run here (they need outside accounts or servers): Email (IMAP), Kafka and RabbitMQ subscribers, the Google Drive trigger, Microsoft files, Twitch, Discord, Telegram, Azure Data Factory.
