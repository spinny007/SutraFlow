# SutraFlow 1.9.0 soak test

2026-10-21T01:58:38.373Z to 2026-10-21T02:08:22.758Z (0.2 hours), 3 processes (a studio and 2 engines) on PostgreSQL, AMD Ryzen 7 7435HS, 16 threads, 24 GB, win32, Node v24.21.0.

**22 of 23 checks passed.**

| Check | Result | Detail |
|---|---|---|
| No engine stopped by itself | pass | 0 unexpected stops |
| No run left running | pass | 0 runs still running 10 minutes after the load stopped |
| No step ran twice | pass | 0 steps of single-pass Sutras completed more than once |
| Requests that failed | pass | 13 of 10078 (0.129%), fault windows included |
| Timer kept time | pass | 52 runs of 54 expected (every 10 s) |
| Every channel message reached its subscriber | pass | 103 subscriber runs for 103 published |
| Bus messages acknowledged | pass | 250 accepted, 0 released, 0 rejected of 252 sent |
| WebSocket client trigger ran for the server's messages | pass | 110 runs for 110 messages pushed |
| WebSocket broadcasts arrived | pass | 85 received of 85 expected (17 broadcasts to the clients connected at the time) |
| Every CSV in the folder was streamed whole | **fail** | 1 of 2 files with every row counted (10 MB, 40 MB) |
| Every SFTP CSV was streamed whole | pass | 0 of 0 files with every row counted () |
| Every FTP CSV was streamed whole | pass | 0 of 0 files with every row counted () |
| RAG passages are in the pgvector table | pass | 0 passages in soak_knowledge |
| RAG documents were learned | pass | none |
| Engine 0 stays responsive | pass | event loop delay: p99 per minute 35 ms typical, 41 ms in the worst 5% of minutes; longest single wait 406 ms |
| Engine 1 stays responsive | pass | event loop delay: p99 per minute 35 ms typical, 36 ms in the worst 5% of minutes; longest single wait 372 ms |
| Engine 2 stays responsive | pass | event loop delay: p99 per minute 35 ms typical, 36 ms in the worst 5% of minutes; longest single wait 855 ms |
| REST orders stays as fast | pass | p95 213 ms in the first period, 214 ms in the last |
| REST in memory stays as fast | pass | p95 10 ms in the first period, 13 ms in the last |
| REST signed and validated stays as fast | pass | p95 218 ms in the first period, 228 ms in the last |
| SOAP UsernameToken stays as fast | pass | p95 217 ms in the first period, 225 ms in the last |
| WebSocket echo stays as fast | pass | p95 217 ms in the first period, 209 ms in the last |
| Bus message stays as fast | pass | p95 1 ms in the first period, 0 ms in the last |

## Scenarios

| Scenario | Done | Failed | p50 / p95 / p99 ms (last period) | Most frequent error |
|---|---|---|---|---|
| REST orders | 4703 | 2 | - | status 500: {"error":"read ECONNRESET"} (1) |
| REST in memory | 2418 | 0 | - |  |
| REST signed and validated | 503 | 0 | - |  |
| SOAP UsernameToken | 502 | 0 | - |  |
| SOAP X.509 signed and encrypted | 129 | 0 | - |  |
| WebSocket echo | 1257 | 0 | - |  |
| WebSocket broadcast | 17 | 0 | - |  |
| Channel publish | 103 | 0 | - |  |
| Error handler | 103 | 0 | - |  |
| Called Sutra and approval | 16 | 1 | - | POST /api/flows/c23a9ae0-06a0-46fb-b47a-d5df917db3fd/run: gave up after 1 tries: fetch failed (1) |
| MCP tool | 52 | 0 | - |  |
| Bus message | 252 | 10 | - | the subscriber is not connected (10) |
| RAG search | 8 | 0 | - |  |
| Folder CSV (streamed) | 2 | 0 | - |  |
| SFTP CSV | 0 | 0 | - |  |
| FTP CSV (streamed) | 0 | 0 | - |  |
| RAG document ingest | 0 | 0 | - |  |

## Faults on purpose

- database cut at 2026-10-21T02:04:52.526Z

## Big files

| Kind | File | Size | Result |
|---|---|---|---|
| Folder CSV (streamed) | soak-3575-10mb.csv | 10 MB, 198000 rows | see check |
| Folder CSV (streamed) | soak-7158-40mb.csv | 40 MB, 776000 rows | see check |

## Resources

| Engine | Highest memory | Last memory | Restarts |
|---|---|---|---|
| studio | 266 MB | 257 MB | 0 |
| engine 1 | 251 MB | 249 MB | 0 |
| engine 2 | 300 MB | 300 MB | 0 |

Database: 75 MB at the end; runs {"done":10298}.

## Events

- 0 min, start: SutraFlow 1.9.0, 3 processes, 9 minutes, database sutra_soak_1792547918465, 16 threads, 24 GB
- 0.1 min, setup: 21 Sutras deployed
- 0.2 min, load: 17 scenarios running
- 3.2 min, file: soak-3575-10mb.csv: 198000 rows to the watched folder
- 6.2 min, fault: database cut for 20 seconds
- 6.2 min, file: soak-7158-40mb.csv: 776000 rows to the watched folder
- 6.6 min, fault: database back
- 9 min, load: load stopped; waiting for open runs to end (at most 10 minutes)
- 9.3 min, check: PASS No engine stopped by itself: 0 unexpected stops
- 9.3 min, check: PASS No run left running: 0 runs still running 10 minutes after the load stopped
- 9.3 min, check: PASS No step ran twice: 0 steps of single-pass Sutras completed more than once
- 9.3 min, check: PASS Requests that failed: 13 of 10078 (0.129%), fault windows included
- 9.3 min, check: PASS Timer kept time: 52 runs of 54 expected (every 10 s)
- 9.3 min, check: PASS Every channel message reached its subscriber: 103 subscriber runs for 103 published
- 9.3 min, check: PASS Bus messages acknowledged: 250 accepted, 0 released, 0 rejected of 252 sent
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
- 9.7 min, check: PASS Engine 0 stays responsive: event loop delay: p99 per minute 35 ms typical, 41 ms in the worst 5% of minutes; longest single wait 406 ms
- 9.7 min, check: PASS Engine 1 stays responsive: event loop delay: p99 per minute 35 ms typical, 36 ms in the worst 5% of minutes; longest single wait 372 ms
- 9.7 min, check: PASS Engine 2 stays responsive: event loop delay: p99 per minute 35 ms typical, 36 ms in the worst 5% of minutes; longest single wait 855 ms
- 9.7 min, check: PASS REST orders stays as fast: p95 213 ms in the first period, 214 ms in the last
- 9.7 min, check: PASS REST in memory stays as fast: p95 10 ms in the first period, 13 ms in the last
- 9.7 min, check: PASS REST signed and validated stays as fast: p95 218 ms in the first period, 228 ms in the last
- 9.7 min, check: PASS SOAP UsernameToken stays as fast: p95 217 ms in the first period, 225 ms in the last
- 9.7 min, check: PASS WebSocket echo stays as fast: p95 217 ms in the first period, 209 ms in the last
- 9.7 min, check: PASS Bus message stays as fast: p95 1 ms in the first period, 0 ms in the last

## Starters covered

Run here: Manual start (API), Timer, REST service, SOAP service, WebSocket service, WebSocket client, Folder (file) trigger on a shared location, Remote file trigger (SFTP and FTP), Message bus subscriber (AMQP 1.0 stand-in), Channel trigger, Error handler, MCP tool, AI agent channel (chat); Google Drive upload and fetch when its account is set up. Every file is streamed.

Not run here (they need outside accounts or servers): Email (IMAP), Kafka and RabbitMQ subscribers, the Google Drive trigger, Microsoft files, Twitch, Discord, Telegram, Azure Data Factory.
