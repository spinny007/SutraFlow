# SutraFlow 1.9.0 soak test

2026-10-20T20:20:54.594Z to 2026-10-20T20:26:12.601Z (0.1 hours), 3 processes (a studio and 2 engines) on PostgreSQL, AMD Ryzen 7 7435HS, 16 threads, 24 GB, win32, Node v24.21.0.

**20 of 22 checks passed.**

| Check | Result | Detail |
|---|---|---|
| No engine stopped by itself | pass | 0 unexpected stops |
| No run left running | pass | 0 runs still running 10 minutes after the load stopped |
| No step ran twice | pass | 0 steps of single-pass Sutras completed more than once |
| Requests that failed | **fail** | 33 of 5295 (0.623%), fault windows included |
| Timer kept time | pass | 28 runs of 30 expected (every 10 s) |
| Every channel message reached its subscriber | pass | 55 subscriber runs for 55 published |
| Bus messages acknowledged | **fail** | 130 accepted, 0 released, 0 rejected of 132 sent |
| WebSocket client trigger ran for the server's messages | pass | 62 runs for 62 messages pushed |
| WebSocket broadcasts arrived | pass | 45 received of 45 expected (9 broadcasts to the clients connected at the time) |
| Every CSV in the folder was streamed whole | pass | 4 of 4 files with every row counted (1 MB, 1 MB, 2 MB, 2 MB) |
| Every SFTP CSV was streamed whole | pass | 4 of 4 files with every row counted (2 MB, 2 MB, 1 MB, 1 MB) |
| Every FTP CSV was streamed whole | pass | 4 of 4 files with every row counted (1 MB, 1 MB, 2 MB, 2 MB) |
| RAG passages are in the pgvector table | pass | 4292 passages in soak_knowledge |
| RAG documents were learned | pass | 2 MB done in 4 s; 1 MB done in 3 s |
| Engine 0 stays responsive | pass | event loop delay: p99 per minute 36 ms typical, 55 ms in the worst 5% of minutes; longest single wait 22649 ms |
| Engine 1 stays responsive | pass | event loop delay: p99 per minute 35 ms typical, 36 ms in the worst 5% of minutes; longest single wait 22632 ms |
| Engine 2 stays responsive | pass | event loop delay: p99 per minute 36 ms typical, 36 ms in the worst 5% of minutes; longest single wait 22649 ms |
| REST orders stays as fast | pass | p95 118 ms in the first period, 184 ms in the last |
| REST in memory stays as fast | pass | p95 10 ms in the first period, 9 ms in the last |
| REST signed and validated stays as fast | pass | p95 206 ms in the first period, 194 ms in the last |
| SOAP UsernameToken stays as fast | pass | p95 221 ms in the first period, 202 ms in the last |
| WebSocket echo stays as fast | pass | p95 218 ms in the first period, 193 ms in the last |

## Scenarios

| Scenario | Done | Failed | p50 / p95 / p99 ms (last period) | Most frequent error |
|---|---|---|---|---|
| REST orders | 2452 | 13 | - | status 500: {"error":"read ECONNRESET"} (8) |
| REST in memory | 1263 | 6 | - | fetch failed (3) |
| REST signed and validated | 261 | 1 | - | fetch failed (1) |
| SOAP UsernameToken | 261 | 2 | - | fetch failed (2) |
| SOAP X.509 signed and encrypted | 67 | 1 | - | fetch failed (1) |
| WebSocket echo | 652 | 1 | - | not connected (1) |
| WebSocket broadcast | 9 | 0 | - |  |
| Channel publish | 55 | 0 | - |  |
| Error handler | 55 | 0 | - |  |
| Called Sutra and approval | 9 | 0 | - |  |
| MCP tool | 28 | 0 | - |  |
| Bus message | 132 | 9 | - | the subscriber is not connected (9) |
| RAG search | 4 | 0 | - |  |
| Folder CSV (streamed) | 4 | 0 | - |  |
| SFTP CSV | 4 | 0 | - |  |
| FTP CSV (streamed) | 4 | 0 | - |  |
| RAG document ingest | 2 | 0 | - |  |

## Faults on purpose

- engine killed at 2026-10-20T20:22:49.592Z
- database cut at 2026-10-20T20:24:29.593Z

## Big files

| Kind | File | Size | Result |
|---|---|---|---|
| Folder CSV (streamed) | soak-1186-1mb.csv | 1 MB, 22000 rows | see check |
| Folder CSV (streamed) | soak-2384-1mb.csv | 1 MB, 22000 rows | see check |
| Folder CSV (streamed) | soak-3589-2mb.csv | 2 MB, 42000 rows | see check |
| Folder CSV (streamed) | soak-4383-2mb.csv | 2 MB, 42000 rows | see check |
| SFTP CSV | soak-1187-2mb.csv | 2 MB, 42000 rows | see check |
| SFTP CSV | soak-2386-2mb.csv | 2 MB, 42000 rows | see check |
| SFTP CSV | soak-3590-1mb.csv | 1 MB, 22000 rows | see check |
| SFTP CSV | soak-4384-1mb.csv | 1 MB, 22000 rows | see check |
| FTP CSV (streamed) | soak-1188-1mb.csv | 1 MB, 22000 rows | see check |
| FTP CSV (streamed) | soak-2387-1mb.csv | 1 MB, 22000 rows | see check |
| FTP CSV (streamed) | soak-3591-2mb.csv | 2 MB, 42000 rows | see check |
| FTP CSV (streamed) | soak-4387-2mb.csv | 2 MB, 42000 rows | see check |
| RAG document (streamed to pgvector) | soak-doc-2383-2mb.txt | 2 MB | done in 4 s, 3 parts |
| RAG document (streamed to pgvector) | soak-doc-4382-1mb.txt | 1 MB | done in 3 s, 2 parts |

## Resources

| Engine | Highest memory | Last memory | Restarts |
|---|---|---|---|
| studio | 325 MB | 325 MB | 0 |
| engine 1 | 324 MB | 324 MB | 0 |
| engine 2 | 192 MB | 192 MB | 0 |

Database: 65 MB at the end; runs {"done":5398}.

## Events

- 0 min, start: SutraFlow 1.9.0, 3 processes, 5 minutes, database sutra_soak_1792527654686, 16 threads, 24 GB
- 0.1 min, setup: 21 Sutras deployed
- 0.2 min, load: 17 scenarios running
- 1.3 min, file: soak-1186-1mb.csv: 22000 rows to the watched folder
- 1.3 min, file: soak-1187-2mb.csv: 42000 rows to the SFTP inbox
- 1.3 min, file: soak-1188-1mb.csv: 22000 rows to the FTP inbox
- 1.9 min, fault: engine 2 killed on purpose
- 2.3 min, file: soak-2384-1mb.csv: 22000 rows to the watched folder
- 2.3 min, file: soak-2386-2mb.csv: 42000 rows to the SFTP inbox
- 2.3 min, file: soak-2387-1mb.csv: 22000 rows to the FTP inbox
- 2.3 min, document: soak-doc-2383-2mb.txt: done in 4 s
- 3 min, fault: engine 2 started again
- 3.3 min, file: soak-3589-2mb.csv: 42000 rows to the watched folder
- 3.3 min, file: soak-3590-1mb.csv: 22000 rows to the SFTP inbox
- 3.3 min, file: soak-3591-2mb.csv: 42000 rows to the FTP inbox
- 3.6 min, fault: database cut for 20 seconds
- 3.9 min, fault: database back
- 4.3 min, file: soak-4383-2mb.csv: 42000 rows to the watched folder
- 4.3 min, file: soak-4384-1mb.csv: 22000 rows to the SFTP inbox
- 4.3 min, file: soak-4387-2mb.csv: 42000 rows to the FTP inbox
- 4.3 min, document: soak-doc-4382-1mb.txt: done in 3 s
- 5 min, load: load stopped; waiting for open runs to end (at most 10 minutes)
- 5.3 min, check: PASS No engine stopped by itself: 0 unexpected stops
- 5.3 min, check: PASS No run left running: 0 runs still running 10 minutes after the load stopped
- 5.3 min, check: PASS No step ran twice: 0 steps of single-pass Sutras completed more than once
- 5.3 min, check: FAIL Requests that failed: 33 of 5295 (0.623%), fault windows included
- 5.3 min, check: PASS Timer kept time: 28 runs of 30 expected (every 10 s)
- 5.3 min, check: PASS Every channel message reached its subscriber: 55 subscriber runs for 55 published
- 5.3 min, check: FAIL Bus messages acknowledged: 130 accepted, 0 released, 0 rejected of 132 sent
- 5.3 min, check: PASS WebSocket client trigger ran for the server's messages: 62 runs for 62 messages pushed
- 5.3 min, check: PASS WebSocket broadcasts arrived: 45 received of 45 expected (9 broadcasts to the clients connected at the time)
- 5.3 min, check: PASS Every CSV in the folder was streamed whole: 4 of 4 files with every row counted (1 MB, 1 MB, 2 MB, 2 MB)
- 5.3 min, check: PASS Every SFTP CSV was streamed whole: 4 of 4 files with every row counted (2 MB, 2 MB, 1 MB, 1 MB)
- 5.3 min, check: PASS Every FTP CSV was streamed whole: 4 of 4 files with every row counted (1 MB, 1 MB, 2 MB, 2 MB)
- 5.3 min, check: PASS RAG passages are in the pgvector table: 4292 passages in soak_knowledge
- 5.3 min, check: PASS RAG documents were learned: 2 MB done in 4 s; 1 MB done in 3 s
- 5.3 min, check: PASS Engine 0 stays responsive: event loop delay: p99 per minute 36 ms typical, 55 ms in the worst 5% of minutes; longest single wait 22649 ms
- 5.3 min, check: PASS Engine 1 stays responsive: event loop delay: p99 per minute 35 ms typical, 36 ms in the worst 5% of minutes; longest single wait 22632 ms
- 5.3 min, check: PASS Engine 2 stays responsive: event loop delay: p99 per minute 36 ms typical, 36 ms in the worst 5% of minutes; longest single wait 22649 ms
- 5.3 min, check: PASS REST orders stays as fast: p95 118 ms in the first period, 184 ms in the last
- 5.3 min, check: PASS REST in memory stays as fast: p95 10 ms in the first period, 9 ms in the last
- 5.3 min, check: PASS REST signed and validated stays as fast: p95 206 ms in the first period, 194 ms in the last
- 5.3 min, check: PASS SOAP UsernameToken stays as fast: p95 221 ms in the first period, 202 ms in the last
- 5.3 min, check: PASS WebSocket echo stays as fast: p95 218 ms in the first period, 193 ms in the last

## Starters covered

Run here: Manual start (API), Timer, REST service, SOAP service, WebSocket service, WebSocket client, Folder (file) trigger on a shared location, Remote file trigger (SFTP and FTP), Message bus subscriber (AMQP 1.0 stand-in), Channel trigger, Error handler, MCP tool, AI agent channel (chat); Google Drive upload and fetch when its account is set up. Every file is streamed.

Not run here (they need outside accounts or servers): Email (IMAP), Kafka and RabbitMQ subscribers, the Google Drive trigger, Microsoft files, Twitch, Discord, Telegram, Azure Data Factory.
