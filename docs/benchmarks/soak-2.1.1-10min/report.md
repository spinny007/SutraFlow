# SutraFlow 2.1.1 soak test

2026-10-26T16:01:55.633Z to 2026-10-26T16:12:47.905Z (0.2 hours), 3 processes (a studio and 2 engines) on PostgreSQL, AMD Ryzen 7 7435HS, 16 threads, 24 GB, win32, Node v24.21.0, AI: phi4-mini on Ollama.

**25 of 25 checks passed.**

| Check | Result | Detail |
|---|---|---|
| No engine stopped by itself | pass | 0 unexpected stops |
| No run left running | pass | 0 runs still open after starters stopped |
| No step ran twice | pass | 0 steps of single-pass Sutras completed more than once |
| Requests that failed | pass | 3 of 11964 outside the planned faults (0.025%); 379 with the fault windows included |
| PostgreSQL DB Ops stayed correct | pass | 111 completed, 5 failed (0 outside the planned faults) |
| SQLite DB Ops stayed correct | pass | 111 completed, 5 failed (0 outside the planned faults) |
| Timer kept time | pass | 57 runs of 60 expected (every 10 s) |
| Every channel message reached its subscriber | pass | 111 subscriber runs for 111 published |
| Bus messages acknowledged | pass | 287 accepted, 392 released, 0 rejected of 287 sent (392 handed out again after a link closed or a release); subscriber runs {"done":287,"failed":16} |
| WebSocket client trigger ran for the server's messages | pass | 112 runs for 117 messages pushed |
| WebSocket broadcasts arrived | pass | 95 received of 95 expected (19 broadcasts to the clients connected at the time) |
| Every CSV in the folder was streamed whole | pass | 0 of 0 files with every row counted () |
| Every SFTP CSV was streamed whole | pass | 0 of 0 files with every row counted () |
| Every FTP CSV was streamed whole | pass | 0 of 0 files with every row counted () |
| RAG passages are in the pgvector table | pass | 0 passages in soak_knowledge |
| RAG documents were learned | pass | none |
| Engine 0 stays responsive | pass | event loop delay: p99 per minute 37 ms typical, 55 ms in the worst 5% of minutes; longest single wait 908 ms |
| Engine 1 stays responsive | pass | event loop delay: p99 per minute 36 ms typical, 57 ms in the worst 5% of minutes; longest single wait 426 ms |
| Engine 2 stays responsive | pass | event loop delay: p99 per minute 36 ms typical, 44 ms in the worst 5% of minutes; longest single wait 510 ms |
| REST orders stays as fast | pass | p95 217 ms in the first period, 225 ms in the last |
| REST in memory stays as fast | pass | p95 34 ms in the first period, 42 ms in the last |
| REST signed and validated stays as fast | pass | p95 246 ms in the first period, 243 ms in the last |
| SOAP UsernameToken stays as fast | pass | p95 241 ms in the first period, 250 ms in the last |
| WebSocket echo stays as fast | pass | p95 258 ms in the first period, 264 ms in the last |
| Bus message stays as fast | pass | p95 1 ms in the first period, 1 ms in the last |

## Scenarios

| Scenario | Done | Failed | p50 / p95 / p99 ms (last period) | Most frequent error |
|---|---|---|---|---|
| REST orders | 5382 | 196 | - | status 500: {"statusCode":500,"code":"ECONNRESET","error":"Internal Server Error","message":"read ECONNRESET"} (173) |
| REST in memory | 2742 | 100 | - | status 500 (100) |
| REST signed and validated | 556 | 22 | - | expected 200, got 500: {"statusCode":500,"code":"ECONNRESET","error":"Internal Server Error","message":"read ECONNRESET"} (16) |
| SOAP UsernameToken | 558 | 20 | - | status 500: {"statusCode":500,"code":"ECONNRESET","error":"Internal Server Error","message":"read ECONNRESET"} (18) |
| SOAP X.509 signed and encrypted | 139 | 6 | - | status 500: {"statusCode":500,"code":"ECONNRESET","error":"Internal Server Error","message":"read ECONNRESET"} (4) |
| WebSocket echo | 1375 | 5 | - | no echo within 30 s (5) |
| WebSocket broadcast | 19 | 0 | - |  |
| PostgreSQL DB Ops | 111 | 5 | - | POST /api/flows/c7f3f67f-eb96-4561-a617-133c9fe046cc/run?wait=30000: gave up after 1 tries: 500 PostgreSQL cannot be reached; trying again in a moment (5) |
| SQLite DB Ops | 111 | 5 | - | POST /api/flows/d0899257-6e0a-4159-a217-f5387ea9ed97/run?wait=30000: gave up after 1 tries: 500 PostgreSQL cannot be reached; trying again in a moment (5) |
| Channel publish | 111 | 5 | - | POST /api/flows/14929788-c9de-4a81-bdea-2f2804da0cfb/run?wait=30000: gave up after 1 tries: 500 PostgreSQL cannot be reached; trying again in a moment (5) |
| Error handler | 111 | 5 | - | POST /api/flows/1a20ed55-5872-4f4e-b680-0cacbcc0653e/run?wait=30000: gave up after 1 tries: 500 PostgreSQL cannot be reached; trying again in a moment (5) |
| Called Sutra and approval | 17 | 2 | - | GET /api/runs/bc0e03de-67e7-4c22-a17c-1ea574655fef: gave up after 5 tries: 500 PostgreSQL cannot be reached: read ECONNRESET (1) |
| MCP tool | 54 | 4 | - | status 500: {"statusCode":500,"code":"SUTRA_DB_UNREACHABLE","error":"Internal Server Error","message":"PostgreSQL cannot be reached; trying again in a moment"} (2) |
| Bus message | 287 | 3 | - | the subscriber is not connected (3) |
| RAG search | 8 | 1 | - | POST /api/flows/5a201ae1-a759-4905-903e-40338329a96c/run?wait=60000: gave up after 1 tries: 500 PostgreSQL cannot be reached; trying again in a moment (1) |
| RAG ask (Ollama) | 1 | 0 | - |  |
| AI agent chat (Ollama) | 3 | 0 | - |  |
| Folder CSV (streamed) | 0 | 0 | - |  |
| SFTP CSV | 0 | 0 | - |  |
| FTP CSV (streamed) | 0 | 0 | - |  |
| RAG document ingest | 0 | 0 | - |  |

## Faults on purpose

- engine killed at 2026-10-26T16:05:32.011Z
- database cut at 2026-10-26T16:08:52.001Z

## Big files

| Kind | File | Size | Result |
|---|---|---|---|

## Resources

| Engine | Highest memory | Last memory | Restarts |
|---|---|---|---|
| studio | 288 MB | 176 MB | 0 |
| engine 1 | 280 MB | 280 MB | 0 |
| engine 2 | 267 MB | 267 MB | 0 |

Database: 89 MB at the end; runs {"done":11836,"failed":17}.

## Events

- 0 min, start: SutraFlow 2.1.1, 3 processes, 10 minutes, database sutra_soak_1793030515828, 16 threads, 24 GB
- 0.1 min, setup: 25 Sutras deployed
- 0.3 min, load: 21 scenarios running
- 3.6 min, fault: engine 2 killed on purpose
- 4.6 min, fault: engine 2 started again
- 6.9 min, fault: database cut for 20 seconds
- 7 min, retry: GET /api/runs/bc0e03de-67e7-4c22-a17c-1ea574655fef (1/5): 500 PostgreSQL cannot be reached; trying again in a moment
- 7 min, retry: GET /api/runs/bc0e03de-67e7-4c22-a17c-1ea574655fef (2/5): 500 PostgreSQL cannot be reached: read ECONNRESET
- 7 min, retry: GET /api/runs/bc0e03de-67e7-4c22-a17c-1ea574655fef (3/5): 500 PostgreSQL cannot be reached: read ECONNRESET
- 7.1 min, retry: GET /api/runs/bc0e03de-67e7-4c22-a17c-1ea574655fef (4/5): 500 PostgreSQL cannot be reached: read ECONNRESET
- 7.3 min, fault: database back
- 10.1 min, load: load stopped and starters undeployed; waiting for open runs to end (at most 10 minutes)
- 10.4 min, check: PASS No engine stopped by itself: 0 unexpected stops
- 10.4 min, check: PASS No run left running: 0 runs still open after starters stopped
- 10.4 min, check: PASS No step ran twice: 0 steps of single-pass Sutras completed more than once
- 10.4 min, check: PASS Requests that failed: 3 of 11964 outside the planned faults (0.025%); 379 with the fault windows included
- 10.4 min, check: PASS PostgreSQL DB Ops stayed correct: 111 completed, 5 failed (0 outside the planned faults)
- 10.4 min, check: PASS SQLite DB Ops stayed correct: 111 completed, 5 failed (0 outside the planned faults)
- 10.4 min, check: PASS Timer kept time: 57 runs of 60 expected (every 10 s)
- 10.4 min, check: PASS Every channel message reached its subscriber: 111 subscriber runs for 111 published
- 10.4 min, check: PASS Bus messages acknowledged: 287 accepted, 392 released, 0 rejected of 287 sent (392 handed out again after a link closed or a release); subscriber runs {"done":287,"failed":16}
- 10.4 min, check: PASS WebSocket client trigger ran for the server's messages: 112 runs for 117 messages pushed
- 10.4 min, check: PASS WebSocket broadcasts arrived: 95 received of 95 expected (19 broadcasts to the clients connected at the time)
- 10.4 min, check: PASS Every CSV in the folder was streamed whole: 0 of 0 files with every row counted ()
- 10.4 min, check: PASS Every SFTP CSV was streamed whole: 0 of 0 files with every row counted ()
- 10.4 min, check: PASS Every FTP CSV was streamed whole: 0 of 0 files with every row counted ()
- 10.4 min, retry: soak database query (1/10): relation "soak_knowledge" does not exist
- 10.5 min, retry: soak database query (2/10): relation "soak_knowledge" does not exist
- 10.5 min, retry: soak database query (3/10): relation "soak_knowledge" does not exist
- 10.6 min, retry: soak database query (4/10): relation "soak_knowledge" does not exist
- 10.6 min, retry: soak database query (5/10): relation "soak_knowledge" does not exist
- 10.7 min, retry: soak database query (6/10): relation "soak_knowledge" does not exist
- 10.7 min, retry: soak database query (7/10): relation "soak_knowledge" does not exist
- 10.8 min, retry: soak database query (8/10): relation "soak_knowledge" does not exist
- 10.8 min, retry: soak database query (9/10): relation "soak_knowledge" does not exist
- 10.9 min, check: PASS RAG passages are in the pgvector table: 0 passages in soak_knowledge
- 10.9 min, check: PASS RAG documents were learned: none
- 10.9 min, check: PASS Engine 0 stays responsive: event loop delay: p99 per minute 37 ms typical, 55 ms in the worst 5% of minutes; longest single wait 908 ms
- 10.9 min, check: PASS Engine 1 stays responsive: event loop delay: p99 per minute 36 ms typical, 57 ms in the worst 5% of minutes; longest single wait 426 ms
- 10.9 min, check: PASS Engine 2 stays responsive: event loop delay: p99 per minute 36 ms typical, 44 ms in the worst 5% of minutes; longest single wait 510 ms
- 10.9 min, check: PASS REST orders stays as fast: p95 217 ms in the first period, 225 ms in the last
- 10.9 min, check: PASS REST in memory stays as fast: p95 34 ms in the first period, 42 ms in the last
- 10.9 min, check: PASS REST signed and validated stays as fast: p95 246 ms in the first period, 243 ms in the last
- 10.9 min, check: PASS SOAP UsernameToken stays as fast: p95 241 ms in the first period, 250 ms in the last
- 10.9 min, check: PASS WebSocket echo stays as fast: p95 258 ms in the first period, 264 ms in the last
- 10.9 min, check: PASS Bus message stays as fast: p95 1 ms in the first period, 1 ms in the last

## Starters covered

Run here: Manual start (API), Timer, REST service, SOAP service, WebSocket service, WebSocket client, Folder (file) trigger on a shared location, Remote file trigger (SFTP and FTP), Message bus subscriber (AMQP 1.0 stand-in), Channel trigger, Error handler, MCP tool, AI agent channel (chat); Google Drive upload and fetch when its account is set up. Every file is streamed.

Not run here (they need outside accounts or servers): Email (IMAP), Kafka and RabbitMQ subscribers, the Google Drive trigger, Microsoft files, Twitch, Discord, Telegram, Azure Data Factory.
