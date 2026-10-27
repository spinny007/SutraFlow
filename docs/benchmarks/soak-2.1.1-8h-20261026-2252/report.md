# SutraFlow 2.1.1 soak test

2026-10-26T17:19:34.053Z to 2026-10-27T01:35:08.499Z (8 hours), 3 processes (a studio and 2 engines) on PostgreSQL, AMD Ryzen 7 7435HS, 16 threads, 24 GB, win32, Node v24.21.0, AI: phi4-mini on Ollama.

Run **amr-2.1.1-20261026-2249-b333** (scenarios: core, files, ai, faults, amaron, brokers, kafka, mongo, remote, regression). Every row and message of this run carries this id; the run is recorded in amaron.soak_runs.

Amaron: 19058 orders (94994 units), 1914 care tickets, 159 order events through Kafka, 478 reviews in MongoDB, 94 second opinions from the model.

Regression suite on the same servers: 556 passed, 3 failed, 6 skipped of 566 (14.7 min).

**58 of 62 checks passed.**

| Check | Result | Detail |
|---|---|---|
| No engine stopped by itself | pass | 0 unexpected stops |
| No run left running | pass | 0 runs still open after starters stopped |
| No step ran twice | pass | 0 steps of single-pass Sutras completed more than once |
| Requests that failed | pass | 72 of 745653 outside the planned faults (0.010%); 583 with the fault windows included |
| PostgreSQL DB Ops stayed correct | pass | 5740 completed, 5 failed (0 outside the planned faults) |
| MySQL DB Ops stayed correct | pass | 5740 completed, 5 failed (0 outside the planned faults) |
| SQLite DB Ops stayed correct | pass | 5739 completed, 5 failed (0 outside the planned faults) |
| RabbitMQ delivered every message | pass | 56131 published (0 big), 56131 consumed, 0 failed; subscriber runs {"done":56131} |
| ActiveMQ delivered every message | **fail** | 56133 published (0 big), 56134 consumed, 2 failed; subscriber runs {"done":56134,"failed":2} |
| Kafka delivered every message | pass | 159 published (0 big), 160 consumed, 0 failed; subscriber runs {"done":160} |
| Remote MySQL DB Ops stayed correct | pass | 236 completed, 3 failed, 2 outside the planned faults (one every 2 minutes, over the internet) |
| Remote PostgreSQL DB Ops stayed correct | pass | 238 completed, 1 failed, 0 outside the planned faults (one every 2 minutes, over the internet) |
| MongoDB Atlas stayed correct | pass | 478 lifecycles completed, 1 failed, 0 outside the planned faults (one a minute) |
| MongoDB Atlas left nothing behind | pass | 0 documents left in the soak collection |
| Timer kept time | pass | 2873 runs of 2877 expected (every 10 s) |
| Every channel message reached its subscriber | pass | 5740 subscriber runs for 5740 published |
| Bus messages acknowledged | pass | 14266 accepted, 473 released, 0 rejected of 14266 sent (477 handed out again after a link closed or a release); subscriber runs {"done":14270,"failed":46} |
| WebSocket client trigger ran for the server's messages | pass | 5717 runs for 5722 messages pushed |
| WebSocket broadcasts arrived | pass | 4785 received of 4790 expected (958 broadcasts to the clients connected at the time) |
| Every CSV in the folder was streamed whole | pass | 23 of 23 files with every row counted (10 MB, 40 MB, 10 MB, 30 MB, 60 MB, 30 MB, 50 MB, 20 MB, 50 MB, 10 MB, 40 MB, 10 MB, 30 MB, 60 MB, 30 MB, 50 MB, 20 MB, 50 MB, 10 MB, 40 MB, 10 MB, 30 MB, 60 MB) |
| Every SFTP CSV was streamed whole | pass | 15 of 15 files with every row counted (20 MB, 60 MB, 40 MB, 20 MB, 60 MB, 40 MB, 20 MB, 60 MB, 40 MB, 20 MB, 60 MB, 40 MB, 20 MB, 60 MB, 40 MB) |
| Every FTP CSV was streamed whole | pass | 15 of 15 files with every row counted (30 MB, 20 MB, 50 MB, 40 MB, 10 MB, 60 MB, 30 MB, 20 MB, 50 MB, 40 MB, 10 MB, 60 MB, 30 MB, 20 MB, 50 MB) |
| RAG passages are in the pgvector table | pass | 263753 passages in soak_knowledge |
| RAG documents were learned | **fail** | 50 MB failed in 9 s; 10 MB done in 13 s; 30 MB done in 37 s; 50 MB done in 66 s; 10 MB done in 25 s; 30 MB done in 58 s; 50 MB done in 84 s |
| Amaron: every order placed is saved with this run | pass | 19058 orders of run amr-2.1.1-20261026-2249-b333 (19058 placed through the API, 17 failed); ₹73,45,51,286 in total |
| Amaron: lines and stock agree | pass | 47484 lines, 94994 units ordered; stock reserved grew by 94994 |
| Amaron: the warehouse packed every order (RabbitMQ) | pass | 19058 shipments and 19058 orders packed for 19058 orders |
| Amaron: every care ticket saved and decided (ActiveMQ) | pass | 1914 tickets of 1914 raised, 1914 decisions, 0 not as expected |
| Amaron: tickets are in the pgvector knowledge | pass | 1914 passages added for 1914 tickets (1948 in all runs) |
| Amaron: the model gave its second opinions | pass | 94 decisions by phi4-mini for 94 asked |
| Amaron: order events came back through Kafka | pass | 159 events recorded for 159 published to amaron-order-events |
| Amaron: reviews are in MongoDB with this run | pass | 478 reviews of run amr-2.1.1-20261026-2249-b333 for 478 written |
| Engine 0 stays responsive | pass | event loop delay: p99 per minute 35 ms typical, 39 ms in the worst 5% of minutes; longest single wait 3022 ms |
| Engine 1 stays responsive | pass | event loop delay: p99 per minute 34 ms typical, 36 ms in the worst 5% of minutes; longest single wait 6157 ms |
| Engine 2 stays responsive | pass | event loop delay: p99 per minute 34 ms typical, 35 ms in the worst 5% of minutes; longest single wait 5931 ms |
| Engine 0 memory steady | pass | -30.6 MB per hour over the second half; highest 1254 MB |
| Engine 1 memory steady | pass | -9.3 MB per hour over the second half; highest 699 MB |
| Engine 2 memory steady | **fail** | 249.0 MB per hour over the second half; highest 1289 MB |
| REST orders stays as fast | pass | p95 225 ms in the first period, 216 ms in the last |
| REST in memory stays as fast | pass | p95 33 ms in the first period, 23 ms in the last |
| REST signed and validated stays as fast | pass | p95 257 ms in the first period, 241 ms in the last |
| SOAP UsernameToken stays as fast | pass | p95 246 ms in the first period, 234 ms in the last |
| SOAP X.509 signed and encrypted stays as fast | pass | p95 285 ms in the first period, 240 ms in the last |
| WebSocket echo stays as fast | pass | p95 246 ms in the first period, 235 ms in the last |
| WebSocket broadcast stays as fast | pass | p95 1418 ms in the first period, 241 ms in the last |
| PostgreSQL DB Ops stays as fast | pass | p95 601 ms in the first period, 573 ms in the last |
| MySQL DB Ops stays as fast | pass | p95 609 ms in the first period, 571 ms in the last |
| SQLite DB Ops stays as fast | pass | p95 619 ms in the first period, 576 ms in the last |
| RabbitMQ publish stays as fast | pass | p95 571 ms in the first period, 551 ms in the last |
| ActiveMQ publish stays as fast | pass | p95 575 ms in the first period, 553 ms in the last |
| MongoDB Atlas (gentle) stays as fast | pass | p95 6463 ms in the first period, 3786 ms in the last |
| Channel publish stays as fast | pass | p95 619 ms in the first period, 581 ms in the last |
| Error handler stays as fast | pass | p95 1100 ms in the first period, 1102 ms in the last |
| Called Sutra and approval stays as fast | pass | p95 10998 ms in the first period, 10108 ms in the last |
| MCP tool stays as fast | pass | p95 238 ms in the first period, 229 ms in the last |
| Bus message stays as fast | pass | p95 1 ms in the first period, 0 ms in the last |
| RAG search stays as fast | pass | p95 1945 ms in the first period, 1806 ms in the last |
| Amaron orders stays as fast | pass | p95 315 ms in the first period, 284 ms in the last |
| Amaron order status stays as fast | pass | p95 252 ms in the first period, 232 ms in the last |
| Amaron care tickets stays as fast | pass | p95 283 ms in the first period, 224 ms in the last |
| Amaron reviews (gentle) stays as fast | pass | p95 5455 ms in the first period, 2329 ms in the last |
| Regression suite on the same servers | **fail** | 556 passed, 3 failed, 6 skipped of 566 in 14.7 min; failing: JSON, XML, text, map and bytes round-trip through Kafka activities; Atlas M0 activities use isolated seeded data, strict boundaries and real engine execution; every in-process suite passes on PostgreSQL (PGlite) (log: regression.log) |

## Scenarios

| Scenario | Done | Failed | p50 / p95 / p99 ms (last period) | Most frequent error |
|---|---|---|---|---|
| REST orders | 275795 | 202 | 97 / 216 / 412 | status 500: {"statusCode":500,"code":"ECONNRESET","error":"Internal Server Error","message":"read ECONNRESET"} (169) |
| REST in memory | 140308 | 106 | 11 / 23 / 215 | status 500 (99) |
| REST signed and validated | 28523 | 21 | 81 / 241 / 623 | expected 200, got 500: {"statusCode":500,"code":"ECONNRESET","error":"Internal Server Error","message":"read ECONNRESET"} (20) |
| SOAP UsernameToken | 28521 | 24 | 68 / 234 / 627 | status 500: {"statusCode":500,"code":"ECONNRESET","error":"Internal Server Error","message":"read ECONNRESET"} (18) |
| SOAP X.509 signed and encrypted | 7174 | 6 | 95 / 240 / 313 | status 500: {"statusCode":500,"code":"ECONNRESET","error":"Internal Server Error","message":"read ECONNRESET"} (5) |
| WebSocket echo | 71571 | 6 | 91 / 235 / 744 | no echo within 30 s (5) |
| WebSocket broadcast | 957 | 1 | 84 / 241 / 416 | status 500 (1) |
| PostgreSQL DB Ops | 5740 | 5 | 537 / 573 / 1546 | POST /api/flows/14a72fba-abe8-4b50-bed2-7a57e29e3146/run?wait=30000: gave up after 1 tries: 500 PostgreSQL cannot be reached; trying again in a moment (4) |
| MySQL DB Ops | 5740 | 5 | 539 / 571 / 1392 | POST /api/flows/e2917c30-bd5f-4071-ae47-666d2eb3eca2/run?wait=30000: gave up after 1 tries: 500 PostgreSQL cannot be reached; trying again in a moment (5) |
| SQLite DB Ops | 5739 | 5 | 540 / 576 / 1412 | POST /api/flows/b581c01d-dada-48c8-bcba-5f1ef52fb5c6/run?wait=30000: gave up after 1 tries: 500 PostgreSQL cannot be reached; trying again in a moment (5) |
| RabbitMQ publish | 56131 | 43 | 523 / 551 / 1288 | POST /api/flows/d5b6f59b-96a6-4196-978e-597597ecddbd/run?wait=60000: gave up after 1 tries: 500 PostgreSQL cannot be reached; trying again in a moment (37) |
| ActiveMQ publish | 56133 | 41 | 524 / 553 / 1304 | POST /api/flows/21e59661-7ed7-4faa-a76d-1d9ca69fe645/run?wait=60000: gave up after 1 tries: 500 PostgreSQL cannot be reached; trying again in a moment (41) |
| Kafka publish (gentle) | 159 | 0 | 1143 / 2095 / 2095 |  |
| Remote MySQL DB Ops (gentle) | 236 | 3 | 1972 / 2449 / 4305 | run failed: Write atomically: read ECONNRESET (2) |
| Remote PostgreSQL DB Ops (gentle) | 238 | 1 | 2477 / 3503 / 5866 | POST /api/flows/296e246c-e04d-4b3c-b82a-9b0742b31019/run?wait=60000: gave up after 1 tries: 500 PostgreSQL cannot be reached; trying again in a moment (1) |
| MongoDB Atlas (gentle) | 478 | 1 | 3279 / 3786 / 4505 | POST /api/flows/aeb2ef4c-d534-484b-9e61-755dc2e8d78d/run?wait=60000: gave up after 1 tries: 500 PostgreSQL cannot be reached; trying again in a moment (1) |
| Channel publish | 5740 | 5 | 541 / 581 / 1420 | POST /api/flows/bb99de70-f000-4e1b-99ae-1dd5f8754060/run?wait=30000: gave up after 1 tries: 500 PostgreSQL cannot be reached; trying again in a moment (5) |
| Error handler | 5740 | 5 | 700 / 1102 / 2006 | POST /api/flows/a9bc0489-cbf3-4960-ad2b-651936a9b1f4/run?wait=30000: gave up after 1 tries: 500 PostgreSQL cannot be reached; trying again in a moment (5) |
| Called Sutra and approval | 957 | 1 | 10063 / 10108 / 10172 | POST /api/flows/348d5ac9-aa13-48a2-8dda-b83db532f553/run: gave up after 1 tries: 500 PostgreSQL cannot be reached; trying again in a moment (1) |
| MCP tool | 2872 | 2 | 93 / 229 / 297 | status 500: {"statusCode":500,"code":"ECONNRESET","error":"Internal Server Error","message":"read ECONNRESET"} (2) |
| Bus message | 14266 | 69 | 0 / 0 / 0 | the subscriber is not connected (69) |
| RAG search | 478 | 1 | 1725 / 1806 / 1868 | POST /api/flows/3e260a3c-8f22-4001-97ab-af4dbf1f2dd5/run?wait=60000: gave up after 1 tries: 500 PostgreSQL cannot be reached; trying again in a moment (1) |
| RAG ask (Ollama) | 94 | 1 | 2552 / 5874 / 5874 | POST /api/flows/f07f7554-1403-42b8-8243-f57de38d86a1/run?wait=600000: gave up after 1 tries: 500 PostgreSQL cannot be reached; trying again in a moment (1) |
| AI agent chat (Ollama) | 159 | 0 | 1977 / 3711 / 3711 |  |
| Folder CSV (streamed) | 23 | 0 | 402 / 402 / 402 |  |
| SFTP CSV | 15 | 0 | 268 / 268 / 268 |  |
| FTP CSV (streamed) | 15 | 0 | 324 / 324 / 324 |  |
| RAG document ingest | 6 | 1 | 84613 / 84613 / 84613 | run failed: Learn: duplicate key value violates unique constraint "pg_type_typname_nsp_index" (1) |
| Amaron orders | 19058 | 17 | 136 / 284 / 1012 | status 500: {"statusCode":500,"code":"ECONNRESET","error":"Internal Server Error","message":"read ECONNRESET"} (12) |
| Amaron order status | 9559 | 7 | 95 / 232 / 563 | status 500: {"statusCode":500,"code":"ECONNRESET","error":"Internal Server Error","message":"read ECONNRESET"} (7) |
| Amaron care tickets | 1914 | 2 | 97 / 224 / 255 | status 500: {"statusCode":500,"code":"ECONNRESET","error":"Internal Server Error","message":"read ECONNRESET"} (1) |
| Amaron care second opinion (Ollama) | 94 | 1 | 2143 / 3073 / 3073 | POST /api/flows/fbdd6bcf-d869-4838-a08f-6799c2028561/run?wait=600000: gave up after 1 tries: 500 PostgreSQL cannot be reached; trying again in a moment (1) |
| Amaron order events to Kafka (gentle) | 159 | 0 | 1507 / 1700 / 1700 |  |
| Amaron reviews (gentle) | 478 | 1 | 2227 / 2329 / 2740 | POST /api/flows/66e84a65-304c-49f0-94a1-30de21c991c2/run?wait=60000: gave up after 1 tries: 500 PostgreSQL cannot be reached; trying again in a moment (1) |

## Faults on purpose

- engine killed at 2026-10-26T20:00:19.874Z
- database cut at 2026-10-26T22:40:19.876Z

## Big files

| Kind | File | Size | Result |
|---|---|---|---|
| Folder CSV (streamed) | soak-29821-10mb.csv | 10 MB, 198000 rows | see check |
| Folder CSV (streamed) | soak-59418-40mb.csv | 40 MB, 776000 rows | see check |
| Folder CSV (streamed) | soak-89255-10mb.csv | 10 MB, 198000 rows | see check |
| Folder CSV (streamed) | soak-119066-30mb.csv | 30 MB, 582000 rows | see check |
| Folder CSV (streamed) | soak-148898-60mb.csv | 60 MB, 1156000 rows | see check |
| Folder CSV (streamed) | soak-178688-30mb.csv | 30 MB, 582000 rows | see check |
| Folder CSV (streamed) | soak-208482-50mb.csv | 50 MB, 968000 rows | see check |
| Folder CSV (streamed) | soak-238261-20mb.csv | 20 MB, 390000 rows | see check |
| Folder CSV (streamed) | soak-268092-50mb.csv | 50 MB, 968000 rows | see check |
| Folder CSV (streamed) | soak-297890-10mb.csv | 10 MB, 198000 rows | see check |
| Folder CSV (streamed) | soak-327691-40mb.csv | 40 MB, 776000 rows | see check |
| Folder CSV (streamed) | soak-357497-10mb.csv | 10 MB, 198000 rows | see check |
| Folder CSV (streamed) | soak-387294-30mb.csv | 30 MB, 582000 rows | see check |
| Folder CSV (streamed) | soak-417079-60mb.csv | 60 MB, 1156000 rows | see check |
| Folder CSV (streamed) | soak-446889-30mb.csv | 30 MB, 582000 rows | see check |
| Folder CSV (streamed) | soak-476693-50mb.csv | 50 MB, 968000 rows | see check |
| Folder CSV (streamed) | soak-506416-20mb.csv | 20 MB, 390000 rows | see check |
| Folder CSV (streamed) | soak-536218-50mb.csv | 50 MB, 968000 rows | see check |
| Folder CSV (streamed) | soak-566003-10mb.csv | 10 MB, 198000 rows | see check |
| Folder CSV (streamed) | soak-595809-40mb.csv | 40 MB, 776000 rows | see check |
| Folder CSV (streamed) | soak-625582-10mb.csv | 10 MB, 198000 rows | see check |
| Folder CSV (streamed) | soak-655364-30mb.csv | 30 MB, 582000 rows | see check |
| Folder CSV (streamed) | soak-685165-60mb.csv | 60 MB, 1156000 rows | see check |
| SFTP CSV | soak-44474-20mb.csv | 20 MB, 390000 rows | see check |
| SFTP CSV | soak-89252-60mb.csv | 60 MB, 1156000 rows | see check |
| SFTP CSV | soak-133971-40mb.csv | 40 MB, 776000 rows | see check |
| SFTP CSV | soak-178673-20mb.csv | 20 MB, 390000 rows | see check |
| SFTP CSV | soak-223345-60mb.csv | 60 MB, 1156000 rows | see check |
| SFTP CSV | soak-268082-40mb.csv | 40 MB, 776000 rows | see check |
| SFTP CSV | soak-312773-20mb.csv | 20 MB, 390000 rows | see check |
| SFTP CSV | soak-357491-60mb.csv | 60 MB, 1156000 rows | see check |
| SFTP CSV | soak-402180-40mb.csv | 40 MB, 776000 rows | see check |
| SFTP CSV | soak-446877-20mb.csv | 20 MB, 390000 rows | see check |
| SFTP CSV | soak-491502-60mb.csv | 60 MB, 1156000 rows | see check |
| SFTP CSV | soak-536206-40mb.csv | 40 MB, 776000 rows | see check |
| SFTP CSV | soak-580890-20mb.csv | 20 MB, 390000 rows | see check |
| SFTP CSV | soak-625574-60mb.csv | 60 MB, 1156000 rows | see check |
| SFTP CSV | soak-670243-40mb.csv | 40 MB, 776000 rows | see check |
| FTP CSV (streamed) | soak-44475-30mb.csv | 30 MB, 582000 rows | see check |
| FTP CSV (streamed) | soak-89263-20mb.csv | 20 MB, 390000 rows | see check |
| FTP CSV (streamed) | soak-133984-50mb.csv | 50 MB, 968000 rows | see check |
| FTP CSV (streamed) | soak-178691-40mb.csv | 40 MB, 776000 rows | see check |
| FTP CSV (streamed) | soak-223369-10mb.csv | 10 MB, 198000 rows | see check |
| FTP CSV (streamed) | soak-268098-60mb.csv | 60 MB, 1156000 rows | see check |
| FTP CSV (streamed) | soak-312798-30mb.csv | 30 MB, 582000 rows | see check |
| FTP CSV (streamed) | soak-357509-20mb.csv | 20 MB, 390000 rows | see check |
| FTP CSV (streamed) | soak-402204-50mb.csv | 50 MB, 968000 rows | see check |
| FTP CSV (streamed) | soak-446895-40mb.csv | 40 MB, 776000 rows | see check |
| FTP CSV (streamed) | soak-491524-10mb.csv | 10 MB, 198000 rows | see check |
| FTP CSV (streamed) | soak-536228-60mb.csv | 60 MB, 1156000 rows | see check |
| FTP CSV (streamed) | soak-580911-30mb.csv | 30 MB, 582000 rows | see check |
| FTP CSV (streamed) | soak-625591-20mb.csv | 20 MB, 390000 rows | see check |
| FTP CSV (streamed) | soak-670268-50mb.csv | 50 MB, 968000 rows | see check |
| RAG document (streamed to pgvector) | soak-doc-89251-50mb.txt | 50 MB | failed in 9 s: Learn: duplicate key value violates unique constraint "pg_type_typname_nsp_index" |
| RAG document (streamed to pgvector) | soak-doc-178655-10mb.txt | 10 MB | done in 13 s, 11 parts |
| RAG document (streamed to pgvector) | soak-doc-268069-30mb.txt | 30 MB | done in 37 s, 33 parts |
| RAG document (streamed to pgvector) | soak-doc-357470-50mb.txt | 50 MB | done in 66 s, 54 parts |
| RAG document (streamed to pgvector) | soak-doc-446861-10mb.txt | 10 MB | done in 25 s, 11 parts |
| RAG document (streamed to pgvector) | soak-doc-536187-30mb.txt | 30 MB | done in 58 s, 33 parts |
| RAG document (streamed to pgvector) | soak-doc-625551-50mb.txt | 50 MB | done in 84 s, 54 parts |

## Resources

| Engine | Highest memory | Last memory | Restarts |
|---|---|---|---|
| studio | 1254 MB | 384 MB | 0 |
| engine 1 | 699 MB | 350 MB | 0 |
| engine 2 | 1289 MB | 1114 MB | 0 |

Database: 6800 MB at the end; runs {"done":891076,"failed":62}.

## Events

- 0 min, run: amr-2.1.1-20261026-2249-b333: scenarios core, files, ai, faults, amaron, brokers, kafka, mongo, remote, regression
- 0 min, connections: remote PostgreSQL pooled.db.prisma.io:5432
- 0 min, connections: remote MySQL srv1880.hstgr.io:3306/<db> password yes
- 0 min, connections: Kafka SASL ? (password no, CA no); client certificate kafkaxxx-a1-kafka-39c8.a.aivencloud.com:13358 (files no)
- 0 min, connections: MongoDB user yes, password yes, cluster missing (add "Cluster: <name>.mongodb.net" under Mongo DB)
- 0 min, connections: RabbitMQ 127.0.0.1:5672 (default local)
- 0 min, connections: ActiveMQ 127.0.0.1:5673 (default local)
- 0 min, setup: RabbitMQ is starting from C:\rabbitmq_server-4.4.0
- 0.3 min, setup: RabbitMQ is running on 127.0.0.1:5672
- 0.3 min, setup: ActiveMQ is starting from C:\apache-activemq-6.3.2
- 0.4 min, setup: ActiveMQ is running on 127.0.0.1:5673
- 0.5 min, start: SutraFlow 2.1.1, 3 processes, 480 minutes, database sutra_soak_1793035174167, 16 threads, 24 GB
- 0.6 min, setup: 44 Sutras deployed
- 0.8 min, load: 34 scenarios running
- 20.8 min, file: soak-29821-10mb.csv: 198000 rows to the watched folder
- 30.8 min, file: soak-44474-20mb.csv: 390000 rows to the SFTP inbox
- 30.8 min, file: soak-44475-30mb.csv: 582000 rows to the FTP inbox
- 40.8 min, file: soak-59418-40mb.csv: 776000 rows to the watched folder
- 60.8 min, file: soak-89252-60mb.csv: 1156000 rows to the SFTP inbox
- 60.8 min, file: soak-89255-10mb.csv: 198000 rows to the watched folder
- 60.8 min, file: soak-89263-20mb.csv: 390000 rows to the FTP inbox
- 60.9 min, document: soak-doc-89251-50mb.txt: failed in 9 s: Learn: duplicate key value violates unique constraint "pg_type_typname_nsp_index"
- 80.8 min, file: soak-119066-30mb.csv: 582000 rows to the watched folder
- 90.8 min, file: soak-133971-40mb.csv: 776000 rows to the SFTP inbox
- 90.8 min, file: soak-133984-50mb.csv: 968000 rows to the FTP inbox
- 100.8 min, file: soak-148898-60mb.csv: 1156000 rows to the watched folder
- 120.8 min, file: soak-178673-20mb.csv: 390000 rows to the SFTP inbox
- 120.8 min, file: soak-178688-30mb.csv: 582000 rows to the watched folder
- 120.8 min, file: soak-178691-40mb.csv: 776000 rows to the FTP inbox
- 121 min, document: soak-doc-178655-10mb.txt: done in 13 s
- 140.8 min, file: soak-208482-50mb.csv: 968000 rows to the watched folder
- 150.8 min, file: soak-223345-60mb.csv: 1156000 rows to the SFTP inbox
- 150.8 min, file: soak-223369-10mb.csv: 198000 rows to the FTP inbox
- 160.8 min, fault: engine 2 killed on purpose
- 160.8 min, file: soak-238261-20mb.csv: 390000 rows to the watched folder
- 161.9 min, fault: engine 2 started again
- 180.8 min, file: soak-268082-40mb.csv: 776000 rows to the SFTP inbox
- 180.8 min, file: soak-268092-50mb.csv: 968000 rows to the watched folder
- 180.8 min, file: soak-268098-60mb.csv: 1156000 rows to the FTP inbox
- 181.4 min, document: soak-doc-268069-30mb.txt: done in 37 s
- 200.8 min, file: soak-297890-10mb.csv: 198000 rows to the watched folder
- 210.8 min, file: soak-312773-20mb.csv: 390000 rows to the SFTP inbox
- 210.8 min, file: soak-312798-30mb.csv: 582000 rows to the FTP inbox
- 220.8 min, file: soak-327691-40mb.csv: 776000 rows to the watched folder
- 240.8 min, file: soak-357491-60mb.csv: 1156000 rows to the SFTP inbox
- 240.8 min, file: soak-357497-10mb.csv: 198000 rows to the watched folder
- 240.8 min, file: soak-357509-20mb.csv: 390000 rows to the FTP inbox
- 241.9 min, document: soak-doc-357470-50mb.txt: done in 66 s
- 260.8 min, file: soak-387294-30mb.csv: 582000 rows to the watched folder
- 270.8 min, file: soak-402180-40mb.csv: 776000 rows to the SFTP inbox
- 270.8 min, file: soak-402204-50mb.csv: 968000 rows to the FTP inbox
- 280.8 min, file: soak-417079-60mb.csv: 1156000 rows to the watched folder
- 300.8 min, file: soak-446877-20mb.csv: 390000 rows to the SFTP inbox
- 300.8 min, file: soak-446889-30mb.csv: 582000 rows to the watched folder
- 300.8 min, file: soak-446895-40mb.csv: 776000 rows to the FTP inbox
- 301.2 min, document: soak-doc-446861-10mb.txt: done in 25 s
- 320.8 min, fault: database cut for 20 seconds
- 320.8 min, file: soak-476693-50mb.csv: 968000 rows to the watched folder
- 321.1 min, fault: database back
- 330.8 min, file: soak-491502-60mb.csv: 1156000 rows to the SFTP inbox
- 330.8 min, file: soak-491524-10mb.csv: 198000 rows to the FTP inbox
- 340.8 min, file: soak-506416-20mb.csv: 390000 rows to the watched folder
- 360.8 min, file: soak-536206-40mb.csv: 776000 rows to the SFTP inbox
- 360.8 min, file: soak-536218-50mb.csv: 968000 rows to the watched folder
- 360.8 min, file: soak-536228-60mb.csv: 1156000 rows to the FTP inbox
- 361.7 min, document: soak-doc-536187-30mb.txt: done in 58 s
- 380.8 min, file: soak-566003-10mb.csv: 198000 rows to the watched folder
- 390.8 min, file: soak-580890-20mb.csv: 390000 rows to the SFTP inbox
- 390.8 min, file: soak-580911-30mb.csv: 582000 rows to the FTP inbox
- 400.8 min, file: soak-595809-40mb.csv: 776000 rows to the watched folder
- 420.8 min, file: soak-625574-60mb.csv: 1156000 rows to the SFTP inbox
- 420.8 min, file: soak-625582-10mb.csv: 198000 rows to the watched folder
- 420.8 min, file: soak-625591-20mb.csv: 390000 rows to the FTP inbox
- 422.2 min, document: soak-doc-625551-50mb.txt: done in 84 s
- 440.8 min, file: soak-655364-30mb.csv: 582000 rows to the watched folder
- 450.8 min, file: soak-670243-40mb.csv: 776000 rows to the SFTP inbox
- 450.8 min, file: soak-670268-50mb.csv: 968000 rows to the FTP inbox
- 460.8 min, file: soak-685165-60mb.csv: 1156000 rows to the watched folder
- 480.2 min, load: load stopped and starters undeployed; waiting for open runs to end (at most 10 minutes)
- 480.5 min, check: PASS No engine stopped by itself: 0 unexpected stops
- 480.5 min, check: PASS No run left running: 0 runs still open after starters stopped
- 480.7 min, check: PASS No step ran twice: 0 steps of single-pass Sutras completed more than once
- 480.7 min, check: PASS Requests that failed: 72 of 745653 outside the planned faults (0.010%); 583 with the fault windows included
- 480.7 min, check: PASS PostgreSQL DB Ops stayed correct: 5740 completed, 5 failed (0 outside the planned faults)
- 480.7 min, check: PASS MySQL DB Ops stayed correct: 5740 completed, 5 failed (0 outside the planned faults)
- 480.7 min, check: PASS SQLite DB Ops stayed correct: 5739 completed, 5 failed (0 outside the planned faults)
- 480.7 min, check: PASS RabbitMQ delivered every message: 56131 published (0 big), 56131 consumed, 0 failed; subscriber runs {"done":56131}
- 480.7 min, check: FAIL ActiveMQ delivered every message: 56133 published (0 big), 56134 consumed, 2 failed; subscriber runs {"done":56134,"failed":2}
- 480.7 min, check: PASS Kafka delivered every message: 159 published (0 big), 160 consumed, 0 failed; subscriber runs {"done":160}
- 480.7 min, check: PASS Remote MySQL DB Ops stayed correct: 236 completed, 3 failed, 2 outside the planned faults (one every 2 minutes, over the internet)
- 480.7 min, check: PASS Remote PostgreSQL DB Ops stayed correct: 238 completed, 1 failed, 0 outside the planned faults (one every 2 minutes, over the internet)
- 480.7 min, check: PASS MongoDB Atlas stayed correct: 478 lifecycles completed, 1 failed, 0 outside the planned faults (one a minute)
- 480.8 min, check: PASS MongoDB Atlas left nothing behind: 0 documents left in the soak collection
- 480.8 min, check: PASS Timer kept time: 2873 runs of 2877 expected (every 10 s)
- 480.8 min, check: PASS Every channel message reached its subscriber: 5740 subscriber runs for 5740 published
- 480.8 min, check: PASS Bus messages acknowledged: 14266 accepted, 473 released, 0 rejected of 14266 sent (477 handed out again after a link closed or a release); subscriber runs {"done":14270,"failed":46}
- 480.8 min, check: PASS WebSocket client trigger ran for the server's messages: 5717 runs for 5722 messages pushed
- 480.8 min, check: PASS WebSocket broadcasts arrived: 4785 received of 4790 expected (958 broadcasts to the clients connected at the time)
- 480.8 min, check: PASS Every CSV in the folder was streamed whole: 23 of 23 files with every row counted (10 MB, 40 MB, 10 MB, 30 MB, 60 MB, 30 MB, 50 MB, 20 MB, 50 MB, 10 MB, 40 MB, 10 MB, 30 MB, 60 MB, 30 MB, 50 MB, 20 MB, 50 MB, 10 MB, 40 MB, 10 MB, 30 MB, 60 MB)
- 480.8 min, check: PASS Every SFTP CSV was streamed whole: 15 of 15 files with every row counted (20 MB, 60 MB, 40 MB, 20 MB, 60 MB, 40 MB, 20 MB, 60 MB, 40 MB, 20 MB, 60 MB, 40 MB, 20 MB, 60 MB, 40 MB)
- 480.8 min, check: PASS Every FTP CSV was streamed whole: 15 of 15 files with every row counted (30 MB, 20 MB, 50 MB, 40 MB, 10 MB, 60 MB, 30 MB, 20 MB, 50 MB, 40 MB, 10 MB, 60 MB, 30 MB, 20 MB, 50 MB)
- 480.8 min, check: PASS RAG passages are in the pgvector table: 263753 passages in soak_knowledge
- 480.8 min, check: FAIL RAG documents were learned: 50 MB failed in 9 s; 10 MB done in 13 s; 30 MB done in 37 s; 50 MB done in 66 s; 10 MB done in 25 s; 30 MB done in 58 s; 50 MB done in 84 s
- 480.8 min, check: PASS Amaron: every order placed is saved with this run: 19058 orders of run amr-2.1.1-20261026-2249-b333 (19058 placed through the API, 17 failed); ₹73,45,51,286 in total
- 480.8 min, check: PASS Amaron: lines and stock agree: 47484 lines, 94994 units ordered; stock reserved grew by 94994
- 480.8 min, check: PASS Amaron: the warehouse packed every order (RabbitMQ): 19058 shipments and 19058 orders packed for 19058 orders
- 480.8 min, check: PASS Amaron: every care ticket saved and decided (ActiveMQ): 1914 tickets of 1914 raised, 1914 decisions, 0 not as expected
- 480.8 min, check: PASS Amaron: tickets are in the pgvector knowledge: 1914 passages added for 1914 tickets (1948 in all runs)
- 480.8 min, check: PASS Amaron: the model gave its second opinions: 94 decisions by phi4-mini for 94 asked
- 480.8 min, check: PASS Amaron: order events came back through Kafka: 159 events recorded for 159 published to amaron-order-events
- 480.8 min, check: PASS Amaron: reviews are in MongoDB with this run: 478 reviews of run amr-2.1.1-20261026-2249-b333 for 478 written
- 480.8 min, check: PASS Engine 0 stays responsive: event loop delay: p99 per minute 35 ms typical, 39 ms in the worst 5% of minutes; longest single wait 3022 ms
- 480.8 min, check: PASS Engine 1 stays responsive: event loop delay: p99 per minute 34 ms typical, 36 ms in the worst 5% of minutes; longest single wait 6157 ms
- 480.8 min, check: PASS Engine 2 stays responsive: event loop delay: p99 per minute 34 ms typical, 35 ms in the worst 5% of minutes; longest single wait 5931 ms
- 480.8 min, check: PASS Engine 0 memory steady: -30.6 MB per hour over the second half; highest 1254 MB
- 480.8 min, check: PASS Engine 1 memory steady: -9.3 MB per hour over the second half; highest 699 MB
- 480.8 min, check: FAIL Engine 2 memory steady: 249.0 MB per hour over the second half; highest 1289 MB
- 480.8 min, check: PASS REST orders stays as fast: p95 225 ms in the first period, 216 ms in the last
- 480.8 min, check: PASS REST in memory stays as fast: p95 33 ms in the first period, 23 ms in the last
- 480.8 min, check: PASS REST signed and validated stays as fast: p95 257 ms in the first period, 241 ms in the last
- 480.8 min, check: PASS SOAP UsernameToken stays as fast: p95 246 ms in the first period, 234 ms in the last
- 480.8 min, check: PASS SOAP X.509 signed and encrypted stays as fast: p95 285 ms in the first period, 240 ms in the last
- 480.8 min, check: PASS WebSocket echo stays as fast: p95 246 ms in the first period, 235 ms in the last
- 480.8 min, check: PASS WebSocket broadcast stays as fast: p95 1418 ms in the first period, 241 ms in the last
- 480.8 min, check: PASS PostgreSQL DB Ops stays as fast: p95 601 ms in the first period, 573 ms in the last
- 480.8 min, check: PASS MySQL DB Ops stays as fast: p95 609 ms in the first period, 571 ms in the last
- 480.8 min, check: PASS SQLite DB Ops stays as fast: p95 619 ms in the first period, 576 ms in the last
- 480.8 min, check: PASS RabbitMQ publish stays as fast: p95 571 ms in the first period, 551 ms in the last
- 480.8 min, check: PASS ActiveMQ publish stays as fast: p95 575 ms in the first period, 553 ms in the last
- 480.8 min, check: PASS MongoDB Atlas (gentle) stays as fast: p95 6463 ms in the first period, 3786 ms in the last
- 480.8 min, check: PASS Channel publish stays as fast: p95 619 ms in the first period, 581 ms in the last
- 480.8 min, check: PASS Error handler stays as fast: p95 1100 ms in the first period, 1102 ms in the last
- 480.8 min, check: PASS Called Sutra and approval stays as fast: p95 10998 ms in the first period, 10108 ms in the last
- 480.8 min, check: PASS MCP tool stays as fast: p95 238 ms in the first period, 229 ms in the last
- 480.8 min, check: PASS Bus message stays as fast: p95 1 ms in the first period, 0 ms in the last
- 480.8 min, check: PASS RAG search stays as fast: p95 1945 ms in the first period, 1806 ms in the last
- 480.8 min, check: PASS Amaron orders stays as fast: p95 315 ms in the first period, 284 ms in the last
- 480.8 min, check: PASS Amaron order status stays as fast: p95 252 ms in the first period, 232 ms in the last
- 480.8 min, check: PASS Amaron care tickets stays as fast: p95 283 ms in the first period, 224 ms in the last
- 480.8 min, check: PASS Amaron reviews (gentle) stays as fast: p95 5455 ms in the first period, 2329 ms in the last
- 480.8 min, regression: 90 test files against PostgreSQL, MySQL, RabbitMQ, ActiveMQ, Kafka, MongoDB, the remote databases
- 495.6 min, check: FAIL Regression suite on the same servers: 556 passed, 3 failed, 6 skipped of 566 in 14.7 min; failing: JSON, XML, text, map and bytes round-trip through Kafka activities; Atlas M0 activities use isolated seeded data, strict boundaries and real engine execution; every in-process suite passes on PostgreSQL (PGlite) (log: regression.log)

## Starters covered

Run here: Manual start (API), Timer, REST service, SOAP service, WebSocket service, WebSocket client, Folder (file) trigger on a shared location, Remote file trigger (SFTP and FTP), Message bus subscriber (AMQP 1.0 stand-in), Channel trigger, Error handler, MCP tool, AI agent channel (chat); Google Drive upload and fetch when its account is set up. Every file is streamed.

Not run here (they need outside accounts or servers): Email (IMAP), Kafka and RabbitMQ subscribers, the Google Drive trigger, Microsoft files, Twitch, Discord, Telegram, Azure Data Factory.
