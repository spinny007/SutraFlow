# SutraFlow 1.9.0 soak test

2026-10-20T20:40:03.773Z to 2026-10-20T21:40:52.009Z (1 hours), 3 processes (a studio and 2 engines) on PostgreSQL, AMD Ryzen 7 7435HS, 16 threads, 24 GB, win32, Node v24.21.0.

**24 of 26 checks passed.**

| Check | Result | Detail |
|---|---|---|
| No engine stopped by itself | **fail** | 1 unexpected stops (see events) |
| No run left running | pass | 0 runs still running 10 minutes after the load stopped |
| No step ran twice | pass | 0 steps of single-pass Sutras completed more than once |
| Requests that failed | pass | 67 of 71087 (0.094%), fault windows included |
| Timer kept time | pass | 358 runs of 360 expected (every 10 s) |
| Every channel message reached its subscriber | pass | 712 subscriber runs for 712 published |
| Bus messages acknowledged | pass | 1774 accepted, 0 released, 0 rejected of 1776 sent |
| WebSocket client trigger ran for the server's messages | pass | 718 runs for 718 messages pushed |
| WebSocket broadcasts arrived | pass | 592 received of 592 expected (119 broadcasts to the clients connected at the time) |
| Every CSV in the folder was streamed whole | **fail** | 1 of 2 files with every row counted (10 MB, 40 MB) |
| Every SFTP CSV was streamed whole | pass | 1 of 1 files with every row counted (20 MB) |
| Every FTP CSV was streamed whole | pass | 1 of 1 files with every row counted (30 MB) |
| RAG passages are in the pgvector table | pass | 0 passages in soak_knowledge |
| RAG documents were learned | pass | none |
| Engine 0 stays responsive | pass | event loop delay: p99 per minute 35 ms typical, 35 ms in the worst 5% of minutes; longest single wait 701 ms |
| Engine 1 stays responsive | pass | event loop delay: p99 per minute 35 ms typical, 35 ms in the worst 5% of minutes; longest single wait 22666 ms |
| Engine 2 stays responsive | pass | event loop delay: p99 per minute 35 ms typical, 35 ms in the worst 5% of minutes; longest single wait 498 ms |
| REST orders stays as fast | pass | p95 212 ms in the first period, 212 ms in the last |
| REST in memory stays as fast | pass | p95 9 ms in the first period, 8 ms in the last |
| REST signed and validated stays as fast | pass | p95 219 ms in the first period, 216 ms in the last |
| SOAP UsernameToken stays as fast | pass | p95 218 ms in the first period, 215 ms in the last |
| SOAP X.509 signed and encrypted stays as fast | pass | p95 231 ms in the first period, 228 ms in the last |
| WebSocket echo stays as fast | pass | p95 214 ms in the first period, 212 ms in the last |
| Channel publish stays as fast | pass | p95 535 ms in the first period, 531 ms in the last |
| Error handler stays as fast | pass | p95 1037 ms in the first period, 1033 ms in the last |
| MCP tool stays as fast | pass | p95 460 ms in the first period, 203 ms in the last |

## Scenarios

| Scenario | Done | Failed | p50 / p95 / p99 ms (last period) | Most frequent error |
|---|---|---|---|---|
| REST orders | 33205 | 5 | - | fetch failed (4) |
| REST in memory | 17122 | 1 | - | fetch failed (1) |
| REST signed and validated | 3538 | 1 | - | fetch failed (1) |
| SOAP UsernameToken | 3539 | 1 | - | fetch failed (1) |
| SOAP X.509 signed and encrypted | 892 | 2 | - | fetch failed (2) |
| WebSocket echo | 8869 | 36 | - | not connected (36) |
| WebSocket broadcast | 118 | 1 | - | fetch failed (1) |
| Channel publish | 712 | 4 | - | POST /api/flows/7c58be28-a146-4e55-8fbb-4d4b58dc7e2a/run?wait=30000: gave up after 1 tries: fetch failed (4) |
| Error handler | 712 | 4 | - | POST /api/flows/30d5ba2d-e005-4d29-be86-349e1d50b595/run?wait=30000: gave up after 1 tries: fetch failed (4) |
| Called Sutra and approval | 118 | 1 | - | POST /api/flows/cf22bbd5-48e5-4f70-8519-873926a65fa8/run: gave up after 1 tries: fetch failed (1) |
| MCP tool | 357 | 1 | - | fetch failed (1) |
| Bus message | 1776 | 9 | - | the subscriber is not connected (9) |
| RAG search | 58 | 1 | - | POST /api/flows/c677f00e-d7db-4487-b99b-4c3799996ab0/run?wait=60000: gave up after 1 tries: fetch failed (1) |
| Folder CSV (streamed) | 2 | 0 | - |  |
| SFTP CSV | 1 | 0 | - |  |
| FTP CSV (streamed) | 1 | 0 | - |  |
| RAG document ingest | 0 | 0 | - |  |

## Faults on purpose

- engine killed at 2026-10-20T21:00:18.542Z
- database cut at 2026-10-20T21:20:18.680Z

## Big files

| Kind | File | Size | Result |
|---|---|---|---|
| Folder CSV (streamed) | soak-23839-10mb.csv | 10 MB, 198000 rows | see check |
| Folder CSV (streamed) | soak-47760-40mb.csv | 40 MB, 776000 rows | see check |
| SFTP CSV | soak-35802-20mb.csv | 20 MB, 390000 rows | see check |
| FTP CSV (streamed) | soak-35803-30mb.csv | 30 MB, 582000 rows | see check |

## Resources

| Engine | Highest memory | Last memory | Restarts |
|---|---|---|---|
| studio | 545 MB | 266 MB | 1 |
| engine 1 | 516 MB | 498 MB | 0 |
| engine 2 | 277 MB | 277 MB | 0 |

Database: 468 MB at the end; runs {"done":72577}.

## Events

- 0 min, start: SutraFlow 1.9.0, 3 processes, 60 minutes, database sutra_soak_1792528803867, 16 threads, 24 GB
- 0.1 min, setup: 21 Sutras deployed
- 0.2 min, load: 17 scenarios running
- 20.2 min, file: soak-23839-10mb.csv: 198000 rows to the watched folder
- 20.2 min, fault: engine 2 killed on purpose
- 21.3 min, fault: engine 2 started again
- 30.2 min, file: soak-35802-20mb.csv: 390000 rows to the SFTP inbox
- 30.2 min, file: soak-35803-30mb.csv: 582000 rows to the FTP inbox
- 40.2 min, file: soak-47760-40mb.csv: 776000 rows to the watched folder
- 40.2 min, fault: database cut for 20 seconds
- 40.2 min, engine stopped: engine 0 stopped by itself (code 1, signal null)
- 40.3 min, engine restarted: engine 0 started again (1/10)
- 40.6 min, fault: database back
- 60.1 min, load: load stopped; waiting for open runs to end (at most 10 minutes)
- 60.3 min, check: FAIL No engine stopped by itself: 1 unexpected stops (see events)
- 60.3 min, check: PASS No run left running: 0 runs still running 10 minutes after the load stopped
- 60.4 min, check: PASS No step ran twice: 0 steps of single-pass Sutras completed more than once
- 60.4 min, check: PASS Requests that failed: 67 of 71087 (0.094%), fault windows included
- 60.4 min, check: PASS Timer kept time: 358 runs of 360 expected (every 10 s)
- 60.4 min, check: PASS Every channel message reached its subscriber: 712 subscriber runs for 712 published
- 60.4 min, check: PASS Bus messages acknowledged: 1774 accepted, 0 released, 0 rejected of 1776 sent
- 60.4 min, check: PASS WebSocket client trigger ran for the server's messages: 718 runs for 718 messages pushed
- 60.4 min, check: PASS WebSocket broadcasts arrived: 592 received of 592 expected (119 broadcasts to the clients connected at the time)
- 60.4 min, check: FAIL Every CSV in the folder was streamed whole: 1 of 2 files with every row counted (10 MB, 40 MB)
- 60.4 min, check: PASS Every SFTP CSV was streamed whole: 1 of 1 files with every row counted (20 MB)
- 60.4 min, check: PASS Every FTP CSV was streamed whole: 1 of 1 files with every row counted (30 MB)
- 60.4 min, retry: soak database query (1/10): relation "soak_knowledge" does not exist
- 60.4 min, retry: soak database query (2/10): relation "soak_knowledge" does not exist
- 60.5 min, retry: soak database query (3/10): relation "soak_knowledge" does not exist
- 60.5 min, retry: soak database query (4/10): relation "soak_knowledge" does not exist
- 60.6 min, retry: soak database query (5/10): relation "soak_knowledge" does not exist
- 60.6 min, retry: soak database query (6/10): relation "soak_knowledge" does not exist
- 60.7 min, retry: soak database query (7/10): relation "soak_knowledge" does not exist
- 60.7 min, retry: soak database query (8/10): relation "soak_knowledge" does not exist
- 60.8 min, retry: soak database query (9/10): relation "soak_knowledge" does not exist
- 60.8 min, check: PASS RAG passages are in the pgvector table: 0 passages in soak_knowledge
- 60.8 min, check: PASS RAG documents were learned: none
- 60.8 min, check: PASS Engine 0 stays responsive: event loop delay: p99 per minute 35 ms typical, 35 ms in the worst 5% of minutes; longest single wait 701 ms
- 60.8 min, check: PASS Engine 1 stays responsive: event loop delay: p99 per minute 35 ms typical, 35 ms in the worst 5% of minutes; longest single wait 22666 ms
- 60.8 min, check: PASS Engine 2 stays responsive: event loop delay: p99 per minute 35 ms typical, 35 ms in the worst 5% of minutes; longest single wait 498 ms
- 60.8 min, check: PASS REST orders stays as fast: p95 212 ms in the first period, 212 ms in the last
- 60.8 min, check: PASS REST in memory stays as fast: p95 9 ms in the first period, 8 ms in the last
- 60.8 min, check: PASS REST signed and validated stays as fast: p95 219 ms in the first period, 216 ms in the last
- 60.8 min, check: PASS SOAP UsernameToken stays as fast: p95 218 ms in the first period, 215 ms in the last
- 60.8 min, check: PASS SOAP X.509 signed and encrypted stays as fast: p95 231 ms in the first period, 228 ms in the last
- 60.8 min, check: PASS WebSocket echo stays as fast: p95 214 ms in the first period, 212 ms in the last
- 60.8 min, check: PASS Channel publish stays as fast: p95 535 ms in the first period, 531 ms in the last
- 60.8 min, check: PASS Error handler stays as fast: p95 1037 ms in the first period, 1033 ms in the last
- 60.8 min, check: PASS MCP tool stays as fast: p95 460 ms in the first period, 203 ms in the last

## Starters covered

Run here: Manual start (API), Timer, REST service, SOAP service, WebSocket service, WebSocket client, Folder (file) trigger on a shared location, Remote file trigger (SFTP and FTP), Message bus subscriber (AMQP 1.0 stand-in), Channel trigger, Error handler, MCP tool, AI agent channel (chat); Google Drive upload and fetch when its account is set up. Every file is streamed.

Not run here (they need outside accounts or servers): Email (IMAP), Kafka and RabbitMQ subscribers, the Google Drive trigger, Microsoft files, Twitch, Discord, Telegram, Azure Data Factory.
