# SutraFlow 2.1.0 soak test

2026-10-26T05:10:21.992Z to 2026-10-26T05:21:15.780Z (0.2 hours), 3 processes (a studio and 2 engines) on PostgreSQL, AMD Ryzen 7 7435HS, 16 threads, 24 GB, win32, Node v24.21.0, AI: phi4-mini on Ollama.

**38 of 41 checks passed.**

| Check | Result | Detail |
|---|---|---|
| No engine stopped by itself | pass | 0 unexpected stops |
| No run left running | pass | 0 runs still open after starters stopped |
| No step ran twice | pass | 0 steps of single-pass Sutras completed more than once |
| Requests that failed | pass | 56 of 19523 outside the planned faults (0.287%); 888 with the fault windows included |
| PostgreSQL DB Ops stayed correct | pass | 215 completed, 8 failed (0 outside the planned faults) |
| MySQL DB Ops stayed correct | pass | 215 completed, 9 failed (0 outside the planned faults) |
| SQLite DB Ops stayed correct | pass | 217 completed, 9 failed (0 outside the planned faults) |
| RabbitMQ delivered every message | pass | 698 published (180 big), 698 consumed, 0 failed; subscriber runs {"done":698} |
| ActiveMQ delivered every message | pass | 650 published (167 big), 651 consumed, 0 failed; subscriber runs {"done":651} |
| Kafka delivered every message | pass | 8 published (2 big), 8 consumed, 0 failed; subscriber runs {"done":8} |
| Remote MySQL DB Ops stayed correct | pass | 4 completed, 0 failed, 0 outside the planned faults (one every 2 minutes, over the internet) |
| Remote PostgreSQL DB Ops stayed correct | pass | 4 completed, 0 failed, 0 outside the planned faults (one every 2 minutes, over the internet) |
| MongoDB Atlas stayed correct | pass | 9 lifecycles completed, 0 failed, 0 outside the planned faults (one a minute) |
| MongoDB Atlas left nothing behind | pass | 0 documents left in the soak collection |
| Timer kept time | pass | 55 runs of 60 expected (every 10 s) |
| Every channel message reached its subscriber | pass | 221 subscriber runs for 221 published |
| Bus messages acknowledged | pass | 502 accepted, 776 released, 0 rejected of 501 sent (826 handed out again after a link closed or a release); subscriber runs {"done":551} |
| WebSocket client trigger ran for the server's messages | pass | 198 runs for 207 messages pushed |
| WebSocket broadcasts arrived | **fail** | 185 received of 190 expected (38 broadcasts to the clients connected at the time) |
| Every CSV in the folder was streamed whole | pass | 0 of 0 files with every row counted () |
| Every SFTP CSV was streamed whole | pass | 0 of 0 files with every row counted () |
| Every FTP CSV was streamed whole | pass | 0 of 0 files with every row counted () |
| RAG passages are in the pgvector table | pass | 0 passages in soak_knowledge |
| RAG documents were learned | pass | none |
| Engine 0 stays responsive | **fail** | event loop delay: p99 per minute 533 ms typical, 1326 ms in the worst 5% of minutes; longest single wait 1725 ms |
| Engine 1 stays responsive | pass | event loop delay: p99 per minute 708 ms typical, 814 ms in the worst 5% of minutes; longest single wait 1574 ms |
| Engine 2 stays responsive | **fail** | event loop delay: p99 per minute 665 ms typical, 1267 ms in the worst 5% of minutes; longest single wait 1634 ms |
| REST orders stays as fast | pass | p95 3723 ms in the first period, 2829 ms in the last |
| REST in memory stays as fast | pass | p95 1378 ms in the first period, 863 ms in the last |
| REST signed and validated stays as fast | pass | p95 4418 ms in the first period, 2626 ms in the last |
| SOAP UsernameToken stays as fast | pass | p95 3761 ms in the first period, 2504 ms in the last |
| SOAP X.509 signed and encrypted stays as fast | pass | p95 4081 ms in the first period, 2465 ms in the last |
| WebSocket echo stays as fast | pass | p95 2943 ms in the first period, 2330 ms in the last |
| PostgreSQL DB Ops stays as fast | pass | p95 4254 ms in the first period, 3201 ms in the last |
| MySQL DB Ops stays as fast | pass | p95 4276 ms in the first period, 3211 ms in the last |
| SQLite DB Ops stays as fast | pass | p95 4269 ms in the first period, 2692 ms in the last |
| RabbitMQ publish stays as fast | pass | p95 4070 ms in the first period, 2618 ms in the last |
| ActiveMQ publish stays as fast | pass | p95 3576 ms in the first period, 2768 ms in the last |
| Channel publish stays as fast | pass | p95 4173 ms in the first period, 2725 ms in the last |
| Error handler stays as fast | pass | p95 6552 ms in the first period, 4868 ms in the last |
| Bus message stays as fast | pass | p95 1 ms in the first period, 1 ms in the last |

## Scenarios

| Scenario | Done | Failed | p50 / p95 / p99 ms (last period) | Most frequent error |
|---|---|---|---|---|
| REST orders | 6431 | 375 | 872 / 2829 / 4060 | status 500: {"statusCode":500,"code":"ECONNRESET","error":"Internal Server Error","message":"read ECONNRESET"} (347) |
| REST in memory | 5029 | 209 | 90 / 863 / 1133 | status 500 (195) |
| REST signed and validated | 991 | 41 | 762 / 2626 / 3423 | expected 200, got 500: {"statusCode":500,"code":"ECONNRESET","error":"Internal Server Error","message":"read ECONNRESET"} (36) |
| SOAP UsernameToken | 984 | 44 | 728 / 2504 / 3579 | status 500: {"statusCode":500,"code":"ECONNRESET","error":"Internal Server Error","message":"read ECONNRESET"} (40) |
| SOAP X.509 signed and encrypted | 277 | 10 | 785 / 2465 / 2934 | status 500: {"statusCode":500,"code":"ECONNRESET","error":"Internal Server Error","message":"read ECONNRESET"} (10) |
| WebSocket echo | 1750 | 7 | 632 / 2330 / 3296 | not connected (4) |
| WebSocket broadcast | 37 | 1 | 2033 / 4417 / 4417 | status 500 (1) |
| PostgreSQL DB Ops | 215 | 8 | 1543 / 3201 / 4890 | POST /api/flows/f1bb69e6-958a-4a83-9d85-67cf1d3c681d/run?wait=30000: gave up after 1 tries: 500 PostgreSQL cannot be reached; trying again in a moment (8) |
| MySQL DB Ops | 215 | 9 | 1452 / 3211 / 4879 | POST /api/flows/fa4efae4-08f8-4ad3-9f1f-be30747f9d44/run?wait=30000: gave up after 1 tries: 500 PostgreSQL cannot be reached; trying again in a moment (8) |
| SQLite DB Ops | 217 | 9 | 1250 / 2692 / 3282 | POST /api/flows/b5184427-8226-4829-9fa2-e83b3b8e44d8/run?wait=30000: gave up after 1 tries: 500 PostgreSQL cannot be reached; trying again in a moment (8) |
| RabbitMQ publish | 698 | 79 | 1040 / 2618 / 4028 | POST /api/flows/ca59cc1c-0fe4-463d-a684-81e9847a2978/run?wait=60000: gave up after 1 tries: 500 PostgreSQL cannot be reached; trying again in a moment (77) |
| ActiveMQ publish | 650 | 1 | 1190 / 2768 / 3758 | run running: {} (1) |
| Kafka publish (gentle) | 8 | 1 | 5194 / 5194 / 5194 | POST /api/flows/54af6eec-0b06-4094-84ca-9f629bb9dfe9/run?wait=60000: gave up after 1 tries: 500 PostgreSQL cannot be reached; trying again in a moment (1) |
| Remote MySQL DB Ops (gentle) | 4 | 0 | 7175 / 7175 / 7175 |  |
| Remote PostgreSQL DB Ops (gentle) | 4 | 0 | 7008 / 7008 / 7008 |  |
| MongoDB Atlas (gentle) | 9 | 0 | 8596 / 8596 / 8596 |  |
| Channel publish | 221 | 8 | 1238 / 2725 / 3459 | POST /api/flows/e3b7d331-f9d3-4fa2-b6d4-3bcc459d4816/run?wait=30000: gave up after 1 tries: 500 PostgreSQL cannot be reached; trying again in a moment (8) |
| Error handler | 220 | 9 | 1642 / 4868 / 5016 | POST /api/flows/d2a614c7-6f94-4678-a5b3-81917a680ace/run?wait=30000: gave up after 1 tries: 500 PostgreSQL cannot be reached; trying again in a moment (9) |
| Called Sutra and approval | 36 | 2 | 11777 / 13223 / 13223 | POST /api/approvals/36575: gave up after 5 tries: 400 PostgreSQL cannot be reached; trying again in a moment (1) |
| MCP tool | 110 | 4 | 895 / 1473 / 2286 | status 500: {"statusCode":500,"code":"ECONNRESET","error":"Internal Server Error","message":"read ECONNRESET"} (4) |
| Bus message | 501 | 71 | 0 / 1 / 1 | the subscriber is not connected (71) |
| RAG search | 19 | 0 | 1691 / 3561 / 3561 |  |
| RAG ask (Ollama) | 3 | 0 | 243 / 243 / 243 |  |
| AI agent chat (Ollama) | 6 | 0 | 4463 / 4463 / 4463 |  |
| Folder CSV (streamed) | 0 | 0 | - |  |
| SFTP CSV | 0 | 0 | - |  |
| FTP CSV (streamed) | 0 | 0 | - |  |
| RAG document ingest | 0 | 0 | - |  |

## Faults on purpose

- engine killed at 2026-10-26T05:14:05.220Z
- database cut at 2026-10-26T05:17:25.210Z

## Big files

| Kind | File | Size | Result |
|---|---|---|---|

## Resources

| Engine | Highest memory | Last memory | Restarts |
|---|---|---|---|
| studio | 992 MB | 940 MB | 0 |
| engine 1 | 1139 MB | 1139 MB | 0 |
| engine 2 | 1099 MB | 1068 MB | 0 |

Database: 248 MB at the end; runs {"done":20467,"failed":1,"waiting":1}.

## Events

- 0.1 min, start: SutraFlow 2.1.0, 3 processes, 10 minutes, database sutra_soak_1792991422124, 16 threads, 24 GB
- 0.3 min, setup: 35 Sutras deployed
- 0.4 min, load: 28 scenarios running
- 3.7 min, fault: engine 2 killed on purpose
- 4.8 min, fault: engine 2 started again
- 7.1 min, fault: database cut for 20 seconds
- 7.4 min, fault: database back
- 10.1 min, load: load stopped and starters undeployed; waiting for open runs to end (at most 10 minutes)
- 10.4 min, check: PASS No engine stopped by itself: 0 unexpected stops
- 10.4 min, check: PASS No run left running: 0 runs still open after starters stopped
- 10.4 min, check: PASS No step ran twice: 0 steps of single-pass Sutras completed more than once
- 10.4 min, check: PASS Requests that failed: 56 of 19523 outside the planned faults (0.287%); 888 with the fault windows included
- 10.4 min, check: PASS PostgreSQL DB Ops stayed correct: 215 completed, 8 failed (0 outside the planned faults)
- 10.4 min, check: PASS MySQL DB Ops stayed correct: 215 completed, 9 failed (0 outside the planned faults)
- 10.4 min, check: PASS SQLite DB Ops stayed correct: 217 completed, 9 failed (0 outside the planned faults)
- 10.4 min, check: PASS RabbitMQ delivered every message: 698 published (180 big), 698 consumed, 0 failed; subscriber runs {"done":698}
- 10.4 min, check: PASS ActiveMQ delivered every message: 650 published (167 big), 651 consumed, 0 failed; subscriber runs {"done":651}
- 10.4 min, check: PASS Kafka delivered every message: 8 published (2 big), 8 consumed, 0 failed; subscriber runs {"done":8}
- 10.4 min, check: PASS Remote MySQL DB Ops stayed correct: 4 completed, 0 failed, 0 outside the planned faults (one every 2 minutes, over the internet)
- 10.4 min, check: PASS Remote PostgreSQL DB Ops stayed correct: 4 completed, 0 failed, 0 outside the planned faults (one every 2 minutes, over the internet)
- 10.4 min, check: PASS MongoDB Atlas stayed correct: 9 lifecycles completed, 0 failed, 0 outside the planned faults (one a minute)
- 10.4 min, check: PASS MongoDB Atlas left nothing behind: 0 documents left in the soak collection
- 10.4 min, check: PASS Timer kept time: 55 runs of 60 expected (every 10 s)
- 10.4 min, check: PASS Every channel message reached its subscriber: 221 subscriber runs for 221 published
- 10.4 min, check: PASS Bus messages acknowledged: 502 accepted, 776 released, 0 rejected of 501 sent (826 handed out again after a link closed or a release); subscriber runs {"done":551}
- 10.4 min, check: PASS WebSocket client trigger ran for the server's messages: 198 runs for 207 messages pushed
- 10.4 min, check: FAIL WebSocket broadcasts arrived: 185 received of 190 expected (38 broadcasts to the clients connected at the time)
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
- 10.9 min, check: FAIL Engine 0 stays responsive: event loop delay: p99 per minute 533 ms typical, 1326 ms in the worst 5% of minutes; longest single wait 1725 ms
- 10.9 min, check: PASS Engine 1 stays responsive: event loop delay: p99 per minute 708 ms typical, 814 ms in the worst 5% of minutes; longest single wait 1574 ms
- 10.9 min, check: FAIL Engine 2 stays responsive: event loop delay: p99 per minute 665 ms typical, 1267 ms in the worst 5% of minutes; longest single wait 1634 ms
- 10.9 min, check: PASS REST orders stays as fast: p95 3723 ms in the first period, 2829 ms in the last
- 10.9 min, check: PASS REST in memory stays as fast: p95 1378 ms in the first period, 863 ms in the last
- 10.9 min, check: PASS REST signed and validated stays as fast: p95 4418 ms in the first period, 2626 ms in the last
- 10.9 min, check: PASS SOAP UsernameToken stays as fast: p95 3761 ms in the first period, 2504 ms in the last
- 10.9 min, check: PASS SOAP X.509 signed and encrypted stays as fast: p95 4081 ms in the first period, 2465 ms in the last
- 10.9 min, check: PASS WebSocket echo stays as fast: p95 2943 ms in the first period, 2330 ms in the last
- 10.9 min, check: PASS PostgreSQL DB Ops stays as fast: p95 4254 ms in the first period, 3201 ms in the last
- 10.9 min, check: PASS MySQL DB Ops stays as fast: p95 4276 ms in the first period, 3211 ms in the last
- 10.9 min, check: PASS SQLite DB Ops stays as fast: p95 4269 ms in the first period, 2692 ms in the last
- 10.9 min, check: PASS RabbitMQ publish stays as fast: p95 4070 ms in the first period, 2618 ms in the last
- 10.9 min, check: PASS ActiveMQ publish stays as fast: p95 3576 ms in the first period, 2768 ms in the last
- 10.9 min, check: PASS Channel publish stays as fast: p95 4173 ms in the first period, 2725 ms in the last
- 10.9 min, check: PASS Error handler stays as fast: p95 6552 ms in the first period, 4868 ms in the last
- 10.9 min, check: PASS Bus message stays as fast: p95 1 ms in the first period, 1 ms in the last

## Starters covered

Run here: Manual start (API), Timer, REST service, SOAP service, WebSocket service, WebSocket client, Folder (file) trigger on a shared location, Remote file trigger (SFTP and FTP), Message bus subscriber (AMQP 1.0 stand-in), Channel trigger, Error handler, MCP tool, AI agent channel (chat); Google Drive upload and fetch when its account is set up. Every file is streamed.

Not run here (they need outside accounts or servers): Email (IMAP), Kafka and RabbitMQ subscribers, the Google Drive trigger, Microsoft files, Twitch, Discord, Telegram, Azure Data Factory.
