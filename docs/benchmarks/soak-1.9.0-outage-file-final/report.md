# SutraFlow 1.9.0 soak test

2026-10-21T02:09:34.827Z to 2026-10-21T02:19:22.329Z (0.2 hours), 3 processes (a studio and 2 engines) on PostgreSQL, AMD Ryzen 7 7435HS, 16 threads, 24 GB, win32, Node v24.21.0.

**20 of 23 checks passed.**

| Check | Result | Detail |
|---|---|---|
| No engine stopped by itself | **fail** | 1 unexpected stops (see events) |
| No run left running | pass | 0 runs still running 10 minutes after the load stopped |
| No step ran twice | pass | 0 steps of single-pass Sutras completed more than once |
| Requests that failed | pass | 33 of 10110 (0.326%), fault windows included |
| Timer kept time | pass | 53 runs of 54 expected (every 10 s) |
| Every channel message reached its subscriber | pass | 103 subscriber runs for 103 published |
| Bus messages acknowledged | pass | 251 accepted, 0 released, 0 rejected of 253 sent |
| WebSocket client trigger ran for the server's messages | pass | 111 runs for 111 messages pushed |
| WebSocket broadcasts arrived | **fail** | 80 received of 84 expected (17 broadcasts to the clients connected at the time) |
| Every CSV in the folder was streamed whole | **fail** | 1 of 2 files with every row counted (10 MB, 40 MB) |
| Every SFTP CSV was streamed whole | pass | 0 of 0 files with every row counted () |
| Every FTP CSV was streamed whole | pass | 0 of 0 files with every row counted () |
| RAG passages are in the pgvector table | pass | 0 passages in soak_knowledge |
| RAG documents were learned | pass | none |
| Engine 0 stays responsive | pass | event loop delay: p99 per minute 34 ms typical, 59 ms in the worst 5% of minutes; longest single wait 387 ms |
| Engine 1 stays responsive | pass | event loop delay: p99 per minute 34 ms typical, 35 ms in the worst 5% of minutes; longest single wait 401 ms |
| Engine 2 stays responsive | pass | event loop delay: p99 per minute 35 ms typical, 35 ms in the worst 5% of minutes; longest single wait 489 ms |
| REST orders stays as fast | pass | p95 214 ms in the first period, 213 ms in the last |
| REST in memory stays as fast | pass | p95 13 ms in the first period, 13 ms in the last |
| REST signed and validated stays as fast | pass | p95 229 ms in the first period, 215 ms in the last |
| SOAP UsernameToken stays as fast | pass | p95 214 ms in the first period, 210 ms in the last |
| WebSocket echo stays as fast | pass | p95 226 ms in the first period, 215 ms in the last |
| Bus message stays as fast | pass | p95 1 ms in the first period, 0 ms in the last |

## Scenarios

| Scenario | Done | Failed | p50 / p95 / p99 ms (last period) | Most frequent error |
|---|---|---|---|---|
| REST orders | 4712 | 4 | - | fetch failed (2) |
| REST in memory | 2419 | 2 | - | status 500 (2) |
| REST signed and validated | 504 | 1 | - | fetch failed (1) |
| SOAP UsernameToken | 504 | 1 | - | fetch failed (1) |
| SOAP X.509 signed and encrypted | 129 | 2 | - | fetch failed (2) |
| WebSocket echo | 1255 | 11 | - | not connected (11) |
| WebSocket broadcast | 16 | 1 | - | fetch failed (1) |
| Channel publish | 103 | 1 | - | POST /api/flows/e21653d9-8102-442f-97e2-df60e4fe71f8/run?wait=30000: gave up after 1 tries: fetch failed (1) |
| Error handler | 104 | 0 | - |  |
| Called Sutra and approval | 16 | 1 | - | POST /api/flows/d176c5a1-fe22-40da-a82a-19685f7a466d/run: gave up after 1 tries: fetch failed (1) |
| MCP tool | 52 | 0 | - |  |
| Bus message | 253 | 9 | - | the subscriber is not connected (9) |
| RAG search | 8 | 0 | - |  |
| Folder CSV (streamed) | 2 | 0 | - |  |
| SFTP CSV | 0 | 0 | - |  |
| FTP CSV (streamed) | 0 | 0 | - |  |
| RAG document ingest | 0 | 0 | - |  |

## Faults on purpose

- database cut at 2026-10-21T02:15:49.590Z

## Big files

| Kind | File | Size | Result |
|---|---|---|---|
| Folder CSV (streamed) | soak-3566-10mb.csv | 10 MB, 198000 rows | see check |
| Folder CSV (streamed) | soak-7147-40mb.csv | 40 MB, 776000 rows | see check |

## Resources

| Engine | Highest memory | Last memory | Restarts |
|---|---|---|---|
| studio | 269 MB | 269 MB | 0 |
| engine 1 | 264 MB | 263 MB | 0 |
| engine 2 | 307 MB | 195 MB | 1 |

Database: 76 MB at the end; runs {"done":10314}.

## Events

- 0 min, start: SutraFlow 1.9.0, 3 processes, 9 minutes, database sutra_soak_1792548574915, 16 threads, 24 GB
- 0.1 min, setup: 21 Sutras deployed
- 0.2 min, load: 17 scenarios running
- 3.2 min, file: soak-3566-10mb.csv: 198000 rows to the watched folder
- 6.2 min, fault: database cut for 20 seconds
- 6.3 min, file: soak-7147-40mb.csv: 776000 rows to the watched folder
- 6.3 min, engine stopped: engine 2 stopped by itself (code 1, signal null)
- 6.3 min, engine restarted: engine 2 started again (1/10)
- 6.6 min, fault: database back
- 9.1 min, load: load stopped; waiting for open runs to end (at most 10 minutes)
- 9.3 min, check: FAIL No engine stopped by itself: 1 unexpected stops (see events)
- 9.3 min, check: PASS No run left running: 0 runs still running 10 minutes after the load stopped
- 9.3 min, check: PASS No step ran twice: 0 steps of single-pass Sutras completed more than once
- 9.3 min, check: PASS Requests that failed: 33 of 10110 (0.326%), fault windows included
- 9.3 min, check: PASS Timer kept time: 53 runs of 54 expected (every 10 s)
- 9.3 min, check: PASS Every channel message reached its subscriber: 103 subscriber runs for 103 published
- 9.3 min, check: PASS Bus messages acknowledged: 251 accepted, 0 released, 0 rejected of 253 sent
- 9.3 min, check: PASS WebSocket client trigger ran for the server's messages: 111 runs for 111 messages pushed
- 9.3 min, check: FAIL WebSocket broadcasts arrived: 80 received of 84 expected (17 broadcasts to the clients connected at the time)
- 9.3 min, check: FAIL Every CSV in the folder was streamed whole: 1 of 2 files with every row counted (10 MB, 40 MB)
- 9.3 min, check: PASS Every SFTP CSV was streamed whole: 0 of 0 files with every row counted ()
- 9.3 min, check: PASS Every FTP CSV was streamed whole: 0 of 0 files with every row counted ()
- 9.3 min, retry: soak database query (1/10): relation "soak_knowledge" does not exist
- 9.4 min, retry: soak database query (2/10): relation "soak_knowledge" does not exist
- 9.4 min, retry: soak database query (3/10): relation "soak_knowledge" does not exist
- 9.5 min, retry: soak database query (4/10): relation "soak_knowledge" does not exist
- 9.5 min, retry: soak database query (5/10): relation "soak_knowledge" does not exist
- 9.6 min, retry: soak database query (6/10): relation "soak_knowledge" does not exist
- 9.6 min, retry: soak database query (7/10): relation "soak_knowledge" does not exist
- 9.7 min, retry: soak database query (8/10): relation "soak_knowledge" does not exist
- 9.7 min, retry: soak database query (9/10): relation "soak_knowledge" does not exist
- 9.8 min, check: PASS RAG passages are in the pgvector table: 0 passages in soak_knowledge
- 9.8 min, check: PASS RAG documents were learned: none
- 9.8 min, check: PASS Engine 0 stays responsive: event loop delay: p99 per minute 34 ms typical, 59 ms in the worst 5% of minutes; longest single wait 387 ms
- 9.8 min, check: PASS Engine 1 stays responsive: event loop delay: p99 per minute 34 ms typical, 35 ms in the worst 5% of minutes; longest single wait 401 ms
- 9.8 min, check: PASS Engine 2 stays responsive: event loop delay: p99 per minute 35 ms typical, 35 ms in the worst 5% of minutes; longest single wait 489 ms
- 9.8 min, check: PASS REST orders stays as fast: p95 214 ms in the first period, 213 ms in the last
- 9.8 min, check: PASS REST in memory stays as fast: p95 13 ms in the first period, 13 ms in the last
- 9.8 min, check: PASS REST signed and validated stays as fast: p95 229 ms in the first period, 215 ms in the last
- 9.8 min, check: PASS SOAP UsernameToken stays as fast: p95 214 ms in the first period, 210 ms in the last
- 9.8 min, check: PASS WebSocket echo stays as fast: p95 226 ms in the first period, 215 ms in the last
- 9.8 min, check: PASS Bus message stays as fast: p95 1 ms in the first period, 0 ms in the last

## Starters covered

Run here: Manual start (API), Timer, REST service, SOAP service, WebSocket service, WebSocket client, Folder (file) trigger on a shared location, Remote file trigger (SFTP and FTP), Message bus subscriber (AMQP 1.0 stand-in), Channel trigger, Error handler, MCP tool, AI agent channel (chat); Google Drive upload and fetch when its account is set up. Every file is streamed.

Not run here (they need outside accounts or servers): Email (IMAP), Kafka and RabbitMQ subscribers, the Google Drive trigger, Microsoft files, Twitch, Discord, Telegram, Azure Data Factory.
