# SutraFlow 1.9.0 soak test

2026-10-21T01:50:07.576Z to 2026-10-21T01:56:51.645Z (0.1 hours), 3 processes (a studio and 2 engines) on PostgreSQL, AMD Ryzen 7 7435HS, 16 threads, 24 GB, win32, Node v24.21.0.

**20 of 22 checks passed.**

| Check | Result | Detail |
|---|---|---|
| No engine stopped by itself | pass | 0 unexpected stops |
| No run left running | pass | 0 runs still running 10 minutes after the load stopped |
| No step ran twice | pass | 0 steps of single-pass Sutras completed more than once |
| Requests that failed | pass | 17 of 6496 (0.262%), fault windows included |
| Timer kept time | pass | 34 runs of 36 expected (every 10 s) |
| Every channel message reached its subscriber | pass | 66 subscriber runs for 66 published |
| Bus messages acknowledged | **fail** | 160 accepted, 0 released, 0 rejected of 162 sent |
| WebSocket client trigger ran for the server's messages | pass | 74 runs for 74 messages pushed |
| WebSocket broadcasts arrived | pass | 55 received of 55 expected (11 broadcasts to the clients connected at the time) |
| Every CSV in the folder was streamed whole | **fail** | 1 of 2 files with every row counted (10 MB, 40 MB) |
| Every SFTP CSV was streamed whole | pass | 0 of 0 files with every row counted () |
| Every FTP CSV was streamed whole | pass | 0 of 0 files with every row counted () |
| RAG passages are in the pgvector table | pass | 0 passages in soak_knowledge |
| RAG documents were learned | pass | none |
| Engine 0 stays responsive | pass | event loop delay: p99 per minute 35 ms typical, 38 ms in the worst 5% of minutes; longest single wait 146 ms |
| Engine 1 stays responsive | pass | event loop delay: p99 per minute 35 ms typical, 36 ms in the worst 5% of minutes; longest single wait 758 ms |
| Engine 2 stays responsive | pass | event loop delay: p99 per minute 35 ms typical, 36 ms in the worst 5% of minutes; longest single wait 22632 ms |
| REST orders stays as fast | pass | p95 212 ms in the first period, 213 ms in the last |
| REST in memory stays as fast | pass | p95 14 ms in the first period, 12 ms in the last |
| REST signed and validated stays as fast | pass | p95 223 ms in the first period, 220 ms in the last |
| SOAP UsernameToken stays as fast | pass | p95 215 ms in the first period, 229 ms in the last |
| WebSocket echo stays as fast | pass | p95 247 ms in the first period, 217 ms in the last |

## Scenarios

| Scenario | Done | Failed | p50 / p95 / p99 ms (last period) | Most frequent error |
|---|---|---|---|---|
| REST orders | 3028 | 3 | - | status 500: {"error":"read ECONNRESET"} (2) |
| REST in memory | 1561 | 1 | - | fetch failed (1) |
| REST signed and validated | 323 | 0 | - |  |
| SOAP UsernameToken | 322 | 0 | - |  |
| SOAP X.509 signed and encrypted | 83 | 1 | - | fetch failed (1) |
| WebSocket echo | 805 | 0 | - |  |
| WebSocket broadcast | 11 | 0 | - |  |
| Channel publish | 66 | 1 | - | POST /api/flows/7efbcc8b-f2c8-4c94-97da-08a529007b3e/run?wait=30000: gave up after 1 tries: fetch failed (1) |
| Error handler | 66 | 1 | - | POST /api/flows/4f658569-a031-408b-a75a-9de045229f1a/run?wait=30000: gave up after 1 tries: fetch failed (1) |
| Called Sutra and approval | 11 | 0 | - |  |
| MCP tool | 34 | 0 | - |  |
| Bus message | 162 | 10 | - | the subscriber is not connected (10) |
| RAG search | 5 | 0 | - |  |
| Folder CSV (streamed) | 2 | 0 | - |  |
| SFTP CSV | 0 | 0 | - |  |
| FTP CSV (streamed) | 0 | 0 | - |  |
| RAG document ingest | 0 | 0 | - |  |

## Faults on purpose

- database cut at 2026-10-21T01:54:22.029Z

## Big files

| Kind | File | Size | Result |
|---|---|---|---|
| Folder CSV (streamed) | soak-2384-10mb.csv | 10 MB, 198000 rows | see check |
| Folder CSV (streamed) | soak-4778-40mb.csv | 40 MB, 776000 rows | see check |

## Resources

| Engine | Highest memory | Last memory | Restarts |
|---|---|---|---|
| studio | 268 MB | 268 MB | 0 |
| engine 1 | 291 MB | 291 MB | 0 |
| engine 2 | 253 MB | 253 MB | 0 |

Database: 53 MB at the end; runs {"done":6633}.

## Events

- 0 min, start: SutraFlow 1.9.0, 3 processes, 6 minutes, database sutra_soak_1792547407666, 16 threads, 24 GB
- 0.1 min, setup: 21 Sutras deployed
- 0.2 min, load: 17 scenarios running
- 2.2 min, file: soak-2384-10mb.csv: 198000 rows to the watched folder
- 4.2 min, file: soak-4778-40mb.csv: 776000 rows to the watched folder
- 4.2 min, fault: database cut for 20 seconds
- 4.6 min, fault: database back
- 6 min, load: load stopped; waiting for open runs to end (at most 10 minutes)
- 6.3 min, check: PASS No engine stopped by itself: 0 unexpected stops
- 6.3 min, check: PASS No run left running: 0 runs still running 10 minutes after the load stopped
- 6.3 min, check: PASS No step ran twice: 0 steps of single-pass Sutras completed more than once
- 6.3 min, check: PASS Requests that failed: 17 of 6496 (0.262%), fault windows included
- 6.3 min, check: PASS Timer kept time: 34 runs of 36 expected (every 10 s)
- 6.3 min, check: PASS Every channel message reached its subscriber: 66 subscriber runs for 66 published
- 6.3 min, check: FAIL Bus messages acknowledged: 160 accepted, 0 released, 0 rejected of 162 sent
- 6.3 min, check: PASS WebSocket client trigger ran for the server's messages: 74 runs for 74 messages pushed
- 6.3 min, check: PASS WebSocket broadcasts arrived: 55 received of 55 expected (11 broadcasts to the clients connected at the time)
- 6.3 min, check: FAIL Every CSV in the folder was streamed whole: 1 of 2 files with every row counted (10 MB, 40 MB)
- 6.3 min, check: PASS Every SFTP CSV was streamed whole: 0 of 0 files with every row counted ()
- 6.3 min, check: PASS Every FTP CSV was streamed whole: 0 of 0 files with every row counted ()
- 6.3 min, retry: soak database query (1/10): relation "soak_knowledge" does not exist
- 6.3 min, retry: soak database query (2/10): relation "soak_knowledge" does not exist
- 6.4 min, retry: soak database query (3/10): relation "soak_knowledge" does not exist
- 6.4 min, retry: soak database query (4/10): relation "soak_knowledge" does not exist
- 6.5 min, retry: soak database query (5/10): relation "soak_knowledge" does not exist
- 6.5 min, retry: soak database query (6/10): relation "soak_knowledge" does not exist
- 6.6 min, retry: soak database query (7/10): relation "soak_knowledge" does not exist
- 6.6 min, retry: soak database query (8/10): relation "soak_knowledge" does not exist
- 6.7 min, retry: soak database query (9/10): relation "soak_knowledge" does not exist
- 6.7 min, check: PASS RAG passages are in the pgvector table: 0 passages in soak_knowledge
- 6.7 min, check: PASS RAG documents were learned: none
- 6.7 min, check: PASS Engine 0 stays responsive: event loop delay: p99 per minute 35 ms typical, 38 ms in the worst 5% of minutes; longest single wait 146 ms
- 6.7 min, check: PASS Engine 1 stays responsive: event loop delay: p99 per minute 35 ms typical, 36 ms in the worst 5% of minutes; longest single wait 758 ms
- 6.7 min, check: PASS Engine 2 stays responsive: event loop delay: p99 per minute 35 ms typical, 36 ms in the worst 5% of minutes; longest single wait 22632 ms
- 6.7 min, check: PASS REST orders stays as fast: p95 212 ms in the first period, 213 ms in the last
- 6.7 min, check: PASS REST in memory stays as fast: p95 14 ms in the first period, 12 ms in the last
- 6.7 min, check: PASS REST signed and validated stays as fast: p95 223 ms in the first period, 220 ms in the last
- 6.7 min, check: PASS SOAP UsernameToken stays as fast: p95 215 ms in the first period, 229 ms in the last
- 6.7 min, check: PASS WebSocket echo stays as fast: p95 247 ms in the first period, 217 ms in the last

## Starters covered

Run here: Manual start (API), Timer, REST service, SOAP service, WebSocket service, WebSocket client, Folder (file) trigger on a shared location, Remote file trigger (SFTP and FTP), Message bus subscriber (AMQP 1.0 stand-in), Channel trigger, Error handler, MCP tool, AI agent channel (chat); Google Drive upload and fetch when its account is set up. Every file is streamed.

Not run here (they need outside accounts or servers): Email (IMAP), Kafka and RabbitMQ subscribers, the Google Drive trigger, Microsoft files, Twitch, Discord, Telegram, Azure Data Factory.
