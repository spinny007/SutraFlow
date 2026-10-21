# SutraFlow 1.9.0 soak test

2026-10-21T02:19:35.195Z to 2026-10-21T02:29:20.165Z (0.2 hours), 3 processes (a studio and 2 engines) on PostgreSQL, AMD Ryzen 7 7435HS, 16 threads, 24 GB, win32, Node v24.21.0.

**22 of 23 checks passed.**

| Check | Result | Detail |
|---|---|---|
| No engine stopped by itself | pass | 0 unexpected stops |
| No run left running | pass | 0 runs still running 10 minutes after the load stopped |
| No step ran twice | pass | 0 steps of single-pass Sutras completed more than once |
| Requests that failed | pass | 15 of 10038 (0.149%), fault windows included |
| Timer kept time | pass | 52 runs of 54 expected (every 10 s) |
| Every channel message reached its subscriber | pass | 102 subscriber runs for 102 published |
| Bus messages acknowledged | pass | 249 accepted, 0 released, 0 rejected of 251 sent |
| WebSocket client trigger ran for the server's messages | pass | 110 runs for 110 messages pushed |
| WebSocket broadcasts arrived | pass | 85 received of 85 expected (17 broadcasts to the clients connected at the time) |
| Every CSV in the folder was streamed whole | **fail** | 1 of 2 files with every row counted (10 MB, 40 MB) |
| Every SFTP CSV was streamed whole | pass | 0 of 0 files with every row counted () |
| Every FTP CSV was streamed whole | pass | 0 of 0 files with every row counted () |
| RAG passages are in the pgvector table | pass | 0 passages in soak_knowledge |
| RAG documents were learned | pass | none |
| Engine 0 stays responsive | pass | event loop delay: p99 per minute 35 ms typical, 54 ms in the worst 5% of minutes; longest single wait 789 ms |
| Engine 1 stays responsive | pass | event loop delay: p99 per minute 35 ms typical, 35 ms in the worst 5% of minutes; longest single wait 432 ms |
| Engine 2 stays responsive | pass | event loop delay: p99 per minute 35 ms typical, 35 ms in the worst 5% of minutes; longest single wait 22649 ms |
| REST orders stays as fast | pass | p95 215 ms in the first period, 213 ms in the last |
| REST in memory stays as fast | pass | p95 14 ms in the first period, 10 ms in the last |
| REST signed and validated stays as fast | pass | p95 216 ms in the first period, 216 ms in the last |
| SOAP UsernameToken stays as fast | pass | p95 216 ms in the first period, 221 ms in the last |
| WebSocket echo stays as fast | pass | p95 232 ms in the first period, 214 ms in the last |
| Bus message stays as fast | pass | p95 1 ms in the first period, 1 ms in the last |

## Scenarios

| Scenario | Done | Failed | p50 / p95 / p99 ms (last period) | Most frequent error |
|---|---|---|---|---|
| REST orders | 4685 | 1 | - | fetch failed (1) |
| REST in memory | 2407 | 2 | - | fetch failed (2) |
| REST signed and validated | 501 | 0 | - |  |
| SOAP UsernameToken | 501 | 0 | - |  |
| SOAP X.509 signed and encrypted | 128 | 0 | - |  |
| WebSocket echo | 1250 | 0 | - |  |
| WebSocket broadcast | 17 | 0 | - |  |
| Channel publish | 102 | 1 | - | POST /api/flows/d3a7475a-1e5d-43c4-b1d8-b9368f53995e/run?wait=30000: gave up after 1 tries: fetch failed (1) |
| Error handler | 103 | 0 | - |  |
| Called Sutra and approval | 16 | 1 | - | POST /api/flows/9a245082-94ea-4d88-8bd6-934c800d453f/run: gave up after 1 tries: fetch failed (1) |
| MCP tool | 52 | 0 | - |  |
| Bus message | 251 | 10 | - | the subscriber is not connected (10) |
| RAG search | 8 | 0 | - |  |
| Folder CSV (streamed) | 2 | 0 | - |  |
| SFTP CSV | 0 | 0 | - |  |
| FTP CSV (streamed) | 0 | 0 | - |  |
| RAG document ingest | 0 | 0 | - |  |

## Faults on purpose

- database cut at 2026-10-21T02:25:50.334Z

## Big files

| Kind | File | Size | Result |
|---|---|---|---|
| Folder CSV (streamed) | soak-3562-10mb.csv | 10 MB, 198000 rows | see check |
| Folder CSV (streamed) | soak-7143-40mb.csv | 40 MB, 776000 rows | see check |

## Resources

| Engine | Highest memory | Last memory | Restarts |
|---|---|---|---|
| studio | 267 MB | 267 MB | 0 |
| engine 1 | 262 MB | 261 MB | 0 |
| engine 2 | 297 MB | 296 MB | 0 |

Database: 76 MB at the end; runs {"done":10257}.

## Events

- 0 min, start: SutraFlow 1.9.0, 3 processes, 9 minutes, database sutra_soak_1792549175281, 16 threads, 24 GB
- 0.1 min, setup: 21 Sutras deployed
- 0.2 min, load: 17 scenarios running
- 3.2 min, file: soak-3562-10mb.csv: 198000 rows to the watched folder
- 6.3 min, file: soak-7143-40mb.csv: 776000 rows to the watched folder
- 6.3 min, fault: database cut for 20 seconds
- 6.6 min, fault: database back
- 9 min, load: load stopped; waiting for open runs to end (at most 10 minutes)
- 9.3 min, check: PASS No engine stopped by itself: 0 unexpected stops
- 9.3 min, check: PASS No run left running: 0 runs still running 10 minutes after the load stopped
- 9.3 min, check: PASS No step ran twice: 0 steps of single-pass Sutras completed more than once
- 9.3 min, check: PASS Requests that failed: 15 of 10038 (0.149%), fault windows included
- 9.3 min, check: PASS Timer kept time: 52 runs of 54 expected (every 10 s)
- 9.3 min, check: PASS Every channel message reached its subscriber: 102 subscriber runs for 102 published
- 9.3 min, check: PASS Bus messages acknowledged: 249 accepted, 0 released, 0 rejected of 251 sent
- 9.3 min, check: PASS WebSocket client trigger ran for the server's messages: 110 runs for 110 messages pushed
- 9.3 min, check: PASS WebSocket broadcasts arrived: 85 received of 85 expected (17 broadcasts to the clients connected at the time)
- 9.3 min, check: FAIL Every CSV in the folder was streamed whole: 1 of 2 files with every row counted (10 MB, 40 MB)
- 9.3 min, check: PASS Every SFTP CSV was streamed whole: 0 of 0 files with every row counted ()
- 9.3 min, check: PASS Every FTP CSV was streamed whole: 0 of 0 files with every row counted ()
- 9.3 min, retry: soak database query (1/10): relation "soak_knowledge" does not exist
- 9.3 min, retry: soak database query (2/10): relation "soak_knowledge" does not exist
- 9.4 min, retry: soak database query (3/10): relation "soak_knowledge" does not exist
- 9.4 min, retry: soak database query (4/10): relation "soak_knowledge" does not exist
- 9.5 min, retry: soak database query (5/10): relation "soak_knowledge" does not exist
- 9.5 min, retry: soak database query (6/10): relation "soak_knowledge" does not exist
- 9.6 min, retry: soak database query (7/10): relation "soak_knowledge" does not exist
- 9.6 min, retry: soak database query (8/10): relation "soak_knowledge" does not exist
- 9.7 min, retry: soak database query (9/10): relation "soak_knowledge" does not exist
- 9.7 min, check: PASS RAG passages are in the pgvector table: 0 passages in soak_knowledge
- 9.7 min, check: PASS RAG documents were learned: none
- 9.7 min, check: PASS Engine 0 stays responsive: event loop delay: p99 per minute 35 ms typical, 54 ms in the worst 5% of minutes; longest single wait 789 ms
- 9.7 min, check: PASS Engine 1 stays responsive: event loop delay: p99 per minute 35 ms typical, 35 ms in the worst 5% of minutes; longest single wait 432 ms
- 9.7 min, check: PASS Engine 2 stays responsive: event loop delay: p99 per minute 35 ms typical, 35 ms in the worst 5% of minutes; longest single wait 22649 ms
- 9.7 min, check: PASS REST orders stays as fast: p95 215 ms in the first period, 213 ms in the last
- 9.7 min, check: PASS REST in memory stays as fast: p95 14 ms in the first period, 10 ms in the last
- 9.7 min, check: PASS REST signed and validated stays as fast: p95 216 ms in the first period, 216 ms in the last
- 9.7 min, check: PASS SOAP UsernameToken stays as fast: p95 216 ms in the first period, 221 ms in the last
- 9.7 min, check: PASS WebSocket echo stays as fast: p95 232 ms in the first period, 214 ms in the last
- 9.7 min, check: PASS Bus message stays as fast: p95 1 ms in the first period, 1 ms in the last

## Starters covered

Run here: Manual start (API), Timer, REST service, SOAP service, WebSocket service, WebSocket client, Folder (file) trigger on a shared location, Remote file trigger (SFTP and FTP), Message bus subscriber (AMQP 1.0 stand-in), Channel trigger, Error handler, MCP tool, AI agent channel (chat); Google Drive upload and fetch when its account is set up. Every file is streamed.

Not run here (they need outside accounts or servers): Email (IMAP), Kafka and RabbitMQ subscribers, the Google Drive trigger, Microsoft files, Twitch, Discord, Telegram, Azure Data Factory.
