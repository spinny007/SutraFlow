# SutraFlow 2.1.0 soak test

2026-10-25T20:18:31.855Z to 2026-10-26T02:21:47.592Z (6 hours), 3 processes (a studio and 2 engines) on PostgreSQL, AMD Ryzen 7 7435HS, 16 threads, 24 GB, win32, Node v24.21.0, AI: phi4-mini on Ollama.

**45 of 48 checks passed.**

| Check | Result | Detail |
|---|---|---|
| No engine stopped by itself | pass | 0 unexpected stops |
| No run left running | pass | 0 runs still open after starters stopped |
| No step ran twice | pass | 0 steps of single-pass Sutras completed more than once |
| Requests that failed | pass | 107 of 1018735 (0.011%), fault windows included |
| PostgreSQL DB Ops stayed correct | pass | 8603 completed, 1 failed |
| MySQL DB Ops stayed correct | pass | 8604 completed, 0 failed |
| SQLite DB Ops stayed correct | pass | 8602 completed, 2 failed |
| RabbitMQ delivered every message | pass | 64889 published, 64889 consumed, 0 failed |
| ActiveMQ delivered every message | pass | 64802 published, 64802 consumed, 0 failed |
| Kafka delivered every message | **fail** | 118 published, 117 consumed, 0 failed |
| Remote MySQL DB Ops stayed correct | pass | 178 completed, 1 failed (one every 2 minutes, over the internet) |
| Remote PostgreSQL DB Ops stayed correct | pass | 178 completed, 1 failed (one every 2 minutes, over the internet) |
| MongoDB Atlas stayed correct | pass | 359 lifecycles completed, 0 failed (one a minute) |
| MongoDB Atlas left nothing behind | pass | 0 documents left in the soak collection |
| Timer kept time | pass | 2169 runs of 2160 expected (every 10 s) |
| Every channel message reached its subscriber | pass | 8616 subscriber runs for 8616 published |
| Bus messages acknowledged | pass | 21371 accepted, 0 released, 0 rejected of 21371 sent (2 handed out again after a link closed or a release); subscriber runs {"done":21373} |
| WebSocket client trigger ran for the server's messages | pass | 8670 runs for 8670 messages pushed |
| WebSocket broadcasts arrived | pass | 7185 received of 7190 expected (1438 broadcasts to the clients connected at the time) |
| Every CSV in the folder was streamed whole | pass | 35 of 35 files with every row counted (10 MB, 40 MB, 10 MB, 30 MB, 60 MB, 30 MB, 50 MB, 20 MB, 50 MB, 10 MB, 40 MB, 10 MB, 30 MB, 60 MB, 30 MB, 50 MB, 20 MB, 50 MB, 10 MB, 40 MB, 10 MB, 30 MB, 60 MB, 30 MB, 50 MB, 20 MB, 50 MB, 10 MB, 40 MB, 10 MB, 30 MB, 60 MB, 30 MB, 50 MB, 20 MB) |
| Every SFTP CSV was streamed whole | pass | 23 of 23 files with every row counted (20 MB, 60 MB, 40 MB, 20 MB, 60 MB, 40 MB, 20 MB, 60 MB, 40 MB, 20 MB, 60 MB, 40 MB, 20 MB, 60 MB, 40 MB, 20 MB, 60 MB, 40 MB, 20 MB, 60 MB, 40 MB, 20 MB, 60 MB) |
| Every FTP CSV was streamed whole | pass | 23 of 23 files with every row counted (30 MB, 20 MB, 50 MB, 40 MB, 10 MB, 60 MB, 30 MB, 20 MB, 50 MB, 40 MB, 10 MB, 60 MB, 30 MB, 20 MB, 50 MB, 40 MB, 10 MB, 60 MB, 30 MB, 20 MB, 50 MB, 40 MB, 10 MB) |
| RAG passages are in the pgvector table | pass | 457034 passages in soak_knowledge |
| RAG documents were learned | pass | 50 MB done in 55 s; 10 MB done in 18 s; 30 MB done in 41 s; 50 MB done in 86 s; 10 MB done in 18 s; 30 MB done in 49 s; 50 MB done in 73 s; 30 MB done in 49 s; 50 MB done in 85 s; 10 MB done in 24 s |
| Engine 0 stays responsive | pass | event loop delay: p99 per minute 40 ms typical, 64 ms in the worst 5% of minutes; longest single wait 1797 ms |
| Engine 1 stays responsive | pass | event loop delay: p99 per minute 37 ms typical, 54 ms in the worst 5% of minutes; longest single wait 1769 ms |
| Engine 2 stays responsive | pass | event loop delay: p99 per minute 37 ms typical, 48 ms in the worst 5% of minutes; longest single wait 23622 ms |
| Engine 0 memory steady | pass | 39.8 MB per hour over the second half; highest 1078 MB |
| Engine 1 memory steady | pass | 35.9 MB per hour over the second half; highest 905 MB |
| Engine 2 memory steady | **fail** | 52.0 MB per hour over the second half; highest 754 MB |
| REST orders stays as fast | pass | p95 240 ms in the first period, 270 ms in the last |
| REST in memory stays as fast | pass | p95 34 ms in the first period, 45 ms in the last |
| REST signed and validated stays as fast | pass | p95 280 ms in the first period, 315 ms in the last |
| SOAP UsernameToken stays as fast | pass | p95 262 ms in the first period, 323 ms in the last |
| SOAP X.509 signed and encrypted stays as fast | pass | p95 297 ms in the first period, 366 ms in the last |
| WebSocket echo stays as fast | pass | p95 263 ms in the first period, 301 ms in the last |
| WebSocket broadcast stays as fast | pass | p95 756 ms in the first period, 329 ms in the last |
| PostgreSQL DB Ops stays as fast | pass | p95 625 ms in the first period, 854 ms in the last |
| MySQL DB Ops stays as fast | pass | p95 626 ms in the first period, 1121 ms in the last |
| SQLite DB Ops stays as fast | pass | p95 629 ms in the first period, 1109 ms in the last |
| RabbitMQ publish stays as fast | pass | p95 572 ms in the first period, 596 ms in the last |
| ActiveMQ publish stays as fast | pass | p95 574 ms in the first period, 594 ms in the last |
| MongoDB Atlas (gentle) stays as fast | pass | p95 5798 ms in the first period, 8316 ms in the last |
| Channel publish stays as fast | pass | p95 645 ms in the first period, 954 ms in the last |
| Error handler stays as fast | pass | p95 1113 ms in the first period, 1593 ms in the last |
| Called Sutra and approval stays as fast | pass | p95 10751 ms in the first period, 10223 ms in the last |
| MCP tool stays as fast | pass | p95 339 ms in the first period, 315 ms in the last |
| RAG search stays as fast | **fail** | p95 1668 ms in the first period, 26635 ms in the last |

## Scenarios

| Scenario | Done | Failed | p50 / p95 / p99 ms (last period) | Most frequent error |
|---|---|---|---|---|
| REST orders | 406210 | 21 | - | fetch failed (20) |
| REST in memory | 208536 | 9 | - | fetch failed (8) |
| REST signed and validated | 42471 | 3 | - | fetch failed (3) |
| SOAP UsernameToken | 42487 | 2 | - | fetch failed (1) |
| SOAP X.509 signed and encrypted | 10760 | 2 | - | fetch failed (2) |
| WebSocket echo | 104853 | 9 | - | not connected (6) |
| WebSocket broadcast | 1437 | 1 | - | fetch failed (1) |
| PostgreSQL DB Ops | 8603 | 1 | - | POST /api/flows/79aaf432-5d57-4414-8cc0-daadb2f38487/run?wait=30000: gave up after 1 tries: 500 read ECONNRESET (1) |
| MySQL DB Ops | 8604 | 0 | - |  |
| SQLite DB Ops | 8602 | 2 | - | run failed: Write atomically: cannot start a transaction within a transaction (2) |
| RabbitMQ publish | 64889 | 0 | - |  |
| ActiveMQ publish | 64802 | 0 | - |  |
| Kafka publish (gentle) | 118 | 1 | - | run failed: Publish: SASL SCRAM SHA256 authentication failed: Closed connection (1) |
| Remote MySQL DB Ops (gentle) | 178 | 1 | - | POST /api/flows/a0b90402-8088-48d1-bb76-ddb025d80288/run?wait=60000: gave up after 1 tries: fetch failed (1) |
| Remote PostgreSQL DB Ops (gentle) | 178 | 1 | - | POST /api/flows/312dbf65-3de0-4130-9b7e-99524ac1b7a3/run?wait=60000: gave up after 1 tries: fetch failed (1) |
| MongoDB Atlas (gentle) | 359 | 0 | - |  |
| Channel publish | 8616 | 0 | - |  |
| Error handler | 8614 | 0 | - |  |
| Called Sutra and approval | 1438 | 0 | - |  |
| MCP tool | 4313 | 0 | - |  |
| Bus message | 21371 | 53 | - | the subscriber is not connected (53) |
| RAG search | 716 | 0 | - |  |
| RAG ask (Ollama) | 143 | 0 | - |  |
| AI agent chat (Ollama) | 239 | 0 | - |  |
| Folder CSV (streamed) | 35 | 0 | - |  |
| SFTP CSV | 23 | 0 | - |  |
| FTP CSV (streamed) | 23 | 0 | - |  |
| RAG document ingest | 10 | 1 | - | POST /api/flows/a27c5ea2-e3cf-4f6f-bc03-42839db0b6e9/run?wait=120000: gave up after 1 tries: 500 read ECONNRESET (1) |

## Faults on purpose

- engine killed at 2026-10-25T22:18:56.724Z
- database cut at 2026-10-26T00:18:56.284Z

## Big files

| Kind | File | Size | Result |
|---|---|---|---|
| Folder CSV (streamed) | soak-28462-10mb.csv | 10 MB, 198000 rows | see check |
| Folder CSV (streamed) | soak-56771-40mb.csv | 40 MB, 776000 rows | see check |
| Folder CSV (streamed) | soak-85179-10mb.csv | 10 MB, 198000 rows | see check |
| Folder CSV (streamed) | soak-112774-30mb.csv | 30 MB, 582000 rows | see check |
| Folder CSV (streamed) | soak-141181-60mb.csv | 60 MB, 1156000 rows | see check |
| Folder CSV (streamed) | soak-169588-30mb.csv | 30 MB, 582000 rows | see check |
| Folder CSV (streamed) | soak-197767-50mb.csv | 50 MB, 968000 rows | see check |
| Folder CSV (streamed) | soak-226191-20mb.csv | 20 MB, 390000 rows | see check |
| Folder CSV (streamed) | soak-254566-50mb.csv | 50 MB, 968000 rows | see check |
| Folder CSV (streamed) | soak-282646-10mb.csv | 10 MB, 198000 rows | see check |
| Folder CSV (streamed) | soak-311133-40mb.csv | 40 MB, 776000 rows | see check |
| Folder CSV (streamed) | soak-339556-10mb.csv | 10 MB, 198000 rows | see check |
| Folder CSV (streamed) | soak-366666-30mb.csv | 30 MB, 582000 rows | see check |
| Folder CSV (streamed) | soak-395278-60mb.csv | 60 MB, 1156000 rows | see check |
| Folder CSV (streamed) | soak-423913-30mb.csv | 30 MB, 582000 rows | see check |
| Folder CSV (streamed) | soak-452337-50mb.csv | 50 MB, 968000 rows | see check |
| Folder CSV (streamed) | soak-480800-20mb.csv | 20 MB, 390000 rows | see check |
| Folder CSV (streamed) | soak-509378-50mb.csv | 50 MB, 968000 rows | see check |
| Folder CSV (streamed) | soak-537249-10mb.csv | 10 MB, 198000 rows | see check |
| Folder CSV (streamed) | soak-565827-40mb.csv | 40 MB, 776000 rows | see check |
| Folder CSV (streamed) | soak-594514-10mb.csv | 10 MB, 198000 rows | see check |
| Folder CSV (streamed) | soak-621608-30mb.csv | 30 MB, 582000 rows | see check |
| Folder CSV (streamed) | soak-650337-60mb.csv | 60 MB, 1156000 rows | see check |
| Folder CSV (streamed) | soak-679079-30mb.csv | 30 MB, 582000 rows | see check |
| Folder CSV (streamed) | soak-706738-50mb.csv | 50 MB, 968000 rows | see check |
| Folder CSV (streamed) | soak-735477-20mb.csv | 20 MB, 390000 rows | see check |
| Folder CSV (streamed) | soak-763961-50mb.csv | 50 MB, 968000 rows | see check |
| Folder CSV (streamed) | soak-791734-10mb.csv | 10 MB, 198000 rows | see check |
| Folder CSV (streamed) | soak-820394-40mb.csv | 40 MB, 776000 rows | see check |
| Folder CSV (streamed) | soak-849021-10mb.csv | 10 MB, 198000 rows | see check |
| Folder CSV (streamed) | soak-875998-30mb.csv | 30 MB, 582000 rows | see check |
| Folder CSV (streamed) | soak-904593-60mb.csv | 60 MB, 1156000 rows | see check |
| Folder CSV (streamed) | soak-933236-30mb.csv | 30 MB, 582000 rows | see check |
| Folder CSV (streamed) | soak-961752-50mb.csv | 50 MB, 968000 rows | see check |
| Folder CSV (streamed) | soak-990433-20mb.csv | 20 MB, 390000 rows | see check |
| SFTP CSV | soak-42623-20mb.csv | 20 MB, 390000 rows | see check |
| SFTP CSV | soak-85178-60mb.csv | 60 MB, 1156000 rows | see check |
| SFTP CSV | soak-126958-40mb.csv | 40 MB, 776000 rows | see check |
| SFTP CSV | soak-169569-20mb.csv | 20 MB, 390000 rows | see check |
| SFTP CSV | soak-211951-60mb.csv | 60 MB, 1156000 rows | see check |
| SFTP CSV | soak-254556-40mb.csv | 40 MB, 776000 rows | see check |
| SFTP CSV | soak-296888-20mb.csv | 20 MB, 390000 rows | see check |
| SFTP CSV | soak-339548-60mb.csv | 60 MB, 1156000 rows | see check |
| SFTP CSV | soak-380972-40mb.csv | 40 MB, 776000 rows | see check |
| SFTP CSV | soak-423900-20mb.csv | 20 MB, 390000 rows | see check |
| SFTP CSV | soak-466587-60mb.csv | 60 MB, 1156000 rows | see check |
| SFTP CSV | soak-509364-40mb.csv | 40 MB, 776000 rows | see check |
| SFTP CSV | soak-551456-20mb.csv | 20 MB, 390000 rows | see check |
| SFTP CSV | soak-594507-60mb.csv | 60 MB, 1156000 rows | see check |
| SFTP CSV | soak-635940-40mb.csv | 40 MB, 776000 rows | see check |
| SFTP CSV | soak-679069-20mb.csv | 20 MB, 390000 rows | see check |
| SFTP CSV | soak-721085-60mb.csv | 60 MB, 1156000 rows | see check |
| SFTP CSV | soak-763951-40mb.csv | 40 MB, 776000 rows | see check |
| SFTP CSV | soak-806031-20mb.csv | 20 MB, 390000 rows | see check |
| SFTP CSV | soak-849015-60mb.csv | 60 MB, 1156000 rows | see check |
| SFTP CSV | soak-890306-40mb.csv | 40 MB, 776000 rows | see check |
| SFTP CSV | soak-933213-20mb.csv | 20 MB, 390000 rows | see check |
| SFTP CSV | soak-976077-60mb.csv | 60 MB, 1156000 rows | see check |
| FTP CSV (streamed) | soak-42624-30mb.csv | 30 MB, 582000 rows | see check |
| FTP CSV (streamed) | soak-85185-20mb.csv | 20 MB, 390000 rows | see check |
| FTP CSV (streamed) | soak-126968-50mb.csv | 50 MB, 968000 rows | see check |
| FTP CSV (streamed) | soak-169593-40mb.csv | 40 MB, 776000 rows | see check |
| FTP CSV (streamed) | soak-211968-10mb.csv | 10 MB, 198000 rows | see check |
| FTP CSV (streamed) | soak-254577-60mb.csv | 60 MB, 1156000 rows | see check |
| FTP CSV (streamed) | soak-296920-30mb.csv | 30 MB, 582000 rows | see check |
| FTP CSV (streamed) | soak-339562-20mb.csv | 20 MB, 390000 rows | see check |
| FTP CSV (streamed) | soak-380985-50mb.csv | 50 MB, 968000 rows | see check |
| FTP CSV (streamed) | soak-423916-40mb.csv | 40 MB, 776000 rows | see check |
| FTP CSV (streamed) | soak-466613-10mb.csv | 10 MB, 198000 rows | see check |
| FTP CSV (streamed) | soak-509386-60mb.csv | 60 MB, 1156000 rows | see check |
| FTP CSV (streamed) | soak-551489-30mb.csv | 30 MB, 582000 rows | see check |
| FTP CSV (streamed) | soak-594520-20mb.csv | 20 MB, 390000 rows | see check |
| FTP CSV (streamed) | soak-635961-50mb.csv | 50 MB, 968000 rows | see check |
| FTP CSV (streamed) | soak-679085-40mb.csv | 40 MB, 776000 rows | see check |
| FTP CSV (streamed) | soak-721100-10mb.csv | 10 MB, 198000 rows | see check |
| FTP CSV (streamed) | soak-763966-60mb.csv | 60 MB, 1156000 rows | see check |
| FTP CSV (streamed) | soak-806074-30mb.csv | 30 MB, 582000 rows | see check |
| FTP CSV (streamed) | soak-849038-20mb.csv | 20 MB, 390000 rows | see check |
| FTP CSV (streamed) | soak-890339-50mb.csv | 50 MB, 968000 rows | see check |
| FTP CSV (streamed) | soak-933244-40mb.csv | 40 MB, 776000 rows | see check |
| FTP CSV (streamed) | soak-976096-10mb.csv | 10 MB, 198000 rows | see check |
| RAG document (streamed to pgvector) | soak-doc-85177-50mb.txt | 50 MB | done in 55 s, 54 parts |
| RAG document (streamed to pgvector) | soak-doc-169552-10mb.txt | 10 MB | done in 18 s, 11 parts |
| RAG document (streamed to pgvector) | soak-doc-254537-30mb.txt | 30 MB | done in 41 s, 33 parts |
| RAG document (streamed to pgvector) | soak-doc-339541-50mb.txt | 50 MB | done in 86 s, 54 parts |
| RAG document (streamed to pgvector) | soak-doc-423865-10mb.txt | 10 MB | done in 18 s, 11 parts |
| RAG document (streamed to pgvector) | soak-doc-509351-30mb.txt | 30 MB | done in 49 s, 33 parts |
| RAG document (streamed to pgvector) | soak-doc-594490-50mb.txt | 50 MB | done in 73 s, 54 parts |
| RAG document (streamed to pgvector) | soak-doc-763925-30mb.txt | 30 MB | done in 49 s, 33 parts |
| RAG document (streamed to pgvector) | soak-doc-848997-50mb.txt | 50 MB | done in 85 s, 54 parts |
| RAG document (streamed to pgvector) | soak-doc-933177-10mb.txt | 10 MB | done in 24 s, 11 parts |

## Resources

| Engine | Highest memory | Last memory | Restarts |
|---|---|---|---|
| studio | 1078 MB | 750 MB | 0 |
| engine 1 | 905 MB | 390 MB | 0 |
| engine 2 | 754 MB | 554 MB | 0 |

Database: 9100 MB at the end; runs {"done":1165137,"failed":3}.

## Events

- 0.1 min, start: SutraFlow 2.1.0, 3 processes, 360 minutes, database sutra_soak_1792959511978, 16 threads, 24 GB
- 0.3 min, setup: 35 Sutras deployed
- 0.4 min, load: 28 scenarios running
- 10.4 min, file: soak-28462-10mb.csv: 198000 rows to the watched folder
- 15.4 min, file: soak-42623-20mb.csv: 390000 rows to the SFTP inbox
- 15.4 min, file: soak-42624-30mb.csv: 582000 rows to the FTP inbox
- 20.4 min, file: soak-56771-40mb.csv: 776000 rows to the watched folder
- 30.4 min, file: soak-85178-60mb.csv: 1156000 rows to the SFTP inbox
- 30.4 min, file: soak-85179-10mb.csv: 198000 rows to the watched folder
- 30.4 min, file: soak-85185-20mb.csv: 390000 rows to the FTP inbox
- 31.3 min, document: soak-doc-85177-50mb.txt: done in 55 s
- 40.4 min, file: soak-112774-30mb.csv: 582000 rows to the watched folder
- 45.4 min, file: soak-126958-40mb.csv: 776000 rows to the SFTP inbox
- 45.4 min, file: soak-126968-50mb.csv: 968000 rows to the FTP inbox
- 50.4 min, file: soak-141181-60mb.csv: 1156000 rows to the watched folder
- 60.4 min, file: soak-169569-20mb.csv: 390000 rows to the SFTP inbox
- 60.4 min, file: soak-169588-30mb.csv: 582000 rows to the watched folder
- 60.4 min, file: soak-169593-40mb.csv: 776000 rows to the FTP inbox
- 60.7 min, document: soak-doc-169552-10mb.txt: done in 18 s
- 70.4 min, file: soak-197767-50mb.csv: 968000 rows to the watched folder
- 75.4 min, file: soak-211951-60mb.csv: 1156000 rows to the SFTP inbox
- 75.4 min, file: soak-211968-10mb.csv: 198000 rows to the FTP inbox
- 80.4 min, file: soak-226191-20mb.csv: 390000 rows to the watched folder
- 90.4 min, file: soak-254556-40mb.csv: 776000 rows to the SFTP inbox
- 90.4 min, file: soak-254566-50mb.csv: 968000 rows to the watched folder
- 90.4 min, file: soak-254577-60mb.csv: 1156000 rows to the FTP inbox
- 91.1 min, document: soak-doc-254537-30mb.txt: done in 41 s
- 100.4 min, file: soak-282646-10mb.csv: 198000 rows to the watched folder
- 105.4 min, file: soak-296888-20mb.csv: 390000 rows to the SFTP inbox
- 105.4 min, file: soak-296920-30mb.csv: 582000 rows to the FTP inbox
- 110.4 min, file: soak-311133-40mb.csv: 776000 rows to the watched folder
- 120.4 min, fault: engine 2 killed on purpose
- 120.4 min, file: soak-339548-60mb.csv: 1156000 rows to the SFTP inbox
- 120.4 min, file: soak-339556-10mb.csv: 198000 rows to the watched folder
- 120.4 min, file: soak-339562-20mb.csv: 390000 rows to the FTP inbox
- 121.5 min, fault: engine 2 started again
- 121.8 min, document: soak-doc-339541-50mb.txt: done in 86 s
- 130.4 min, file: soak-366666-30mb.csv: 582000 rows to the watched folder
- 135.4 min, file: soak-380972-40mb.csv: 776000 rows to the SFTP inbox
- 135.4 min, file: soak-380985-50mb.csv: 968000 rows to the FTP inbox
- 140.4 min, file: soak-395278-60mb.csv: 1156000 rows to the watched folder
- 150.4 min, file: soak-423900-20mb.csv: 390000 rows to the SFTP inbox
- 150.4 min, file: soak-423913-30mb.csv: 582000 rows to the watched folder
- 150.4 min, file: soak-423916-40mb.csv: 776000 rows to the FTP inbox
- 150.7 min, document: soak-doc-423865-10mb.txt: done in 18 s
- 160.4 min, file: soak-452337-50mb.csv: 968000 rows to the watched folder
- 165.4 min, file: soak-466587-60mb.csv: 1156000 rows to the SFTP inbox
- 165.4 min, file: soak-466613-10mb.csv: 198000 rows to the FTP inbox
- 170.4 min, file: soak-480800-20mb.csv: 390000 rows to the watched folder
- 180.4 min, file: soak-509364-40mb.csv: 776000 rows to the SFTP inbox
- 180.4 min, file: soak-509378-50mb.csv: 968000 rows to the watched folder
- 180.4 min, file: soak-509386-60mb.csv: 1156000 rows to the FTP inbox
- 181.2 min, document: soak-doc-509351-30mb.txt: done in 49 s
- 190.4 min, file: soak-537249-10mb.csv: 198000 rows to the watched folder
- 195.4 min, file: soak-551456-20mb.csv: 390000 rows to the SFTP inbox
- 195.4 min, file: soak-551489-30mb.csv: 582000 rows to the FTP inbox
- 200.4 min, file: soak-565827-40mb.csv: 776000 rows to the watched folder
- 210.4 min, file: soak-594507-60mb.csv: 1156000 rows to the SFTP inbox
- 210.4 min, file: soak-594514-10mb.csv: 198000 rows to the watched folder
- 210.4 min, file: soak-594520-20mb.csv: 390000 rows to the FTP inbox
- 211.6 min, document: soak-doc-594490-50mb.txt: done in 73 s
- 220.4 min, file: soak-621608-30mb.csv: 582000 rows to the watched folder
- 225.4 min, file: soak-635940-40mb.csv: 776000 rows to the SFTP inbox
- 225.4 min, file: soak-635961-50mb.csv: 968000 rows to the FTP inbox
- 230.4 min, file: soak-650337-60mb.csv: 1156000 rows to the watched folder
- 240.4 min, fault: database cut for 20 seconds
- 240.4 min, file: soak-679069-20mb.csv: 390000 rows to the SFTP inbox
- 240.4 min, file: soak-679079-30mb.csv: 582000 rows to the watched folder
- 240.4 min, file: soak-679085-40mb.csv: 776000 rows to the FTP inbox
- 240.7 min, fault: database back
- 250.4 min, file: soak-706738-50mb.csv: 968000 rows to the watched folder
- 255.4 min, file: soak-721085-60mb.csv: 1156000 rows to the SFTP inbox
- 255.4 min, file: soak-721100-10mb.csv: 198000 rows to the FTP inbox
- 260.4 min, file: soak-735477-20mb.csv: 390000 rows to the watched folder
- 270.4 min, file: soak-763951-40mb.csv: 776000 rows to the SFTP inbox
- 270.4 min, file: soak-763961-50mb.csv: 968000 rows to the watched folder
- 270.4 min, file: soak-763966-60mb.csv: 1156000 rows to the FTP inbox
- 271.2 min, document: soak-doc-763925-30mb.txt: done in 49 s
- 280.4 min, file: soak-791734-10mb.csv: 198000 rows to the watched folder
- 285.4 min, file: soak-806031-20mb.csv: 390000 rows to the SFTP inbox
- 285.4 min, file: soak-806074-30mb.csv: 582000 rows to the FTP inbox
- 290.4 min, file: soak-820394-40mb.csv: 776000 rows to the watched folder
- 300.4 min, file: soak-849015-60mb.csv: 1156000 rows to the SFTP inbox
- 300.4 min, file: soak-849021-10mb.csv: 198000 rows to the watched folder
- 300.4 min, file: soak-849038-20mb.csv: 390000 rows to the FTP inbox
- 301.8 min, document: soak-doc-848997-50mb.txt: done in 85 s
- 310.4 min, file: soak-875998-30mb.csv: 582000 rows to the watched folder
- 315.4 min, file: soak-890306-40mb.csv: 776000 rows to the SFTP inbox
- 315.4 min, file: soak-890339-50mb.csv: 968000 rows to the FTP inbox
- 320.4 min, file: soak-904593-60mb.csv: 1156000 rows to the watched folder
- 330.4 min, file: soak-933213-20mb.csv: 390000 rows to the SFTP inbox
- 330.4 min, file: soak-933236-30mb.csv: 582000 rows to the watched folder
- 330.4 min, file: soak-933244-40mb.csv: 776000 rows to the FTP inbox
- 330.8 min, document: soak-doc-933177-10mb.txt: done in 24 s
- 340.4 min, file: soak-961752-50mb.csv: 968000 rows to the watched folder
- 345.4 min, file: soak-976077-60mb.csv: 1156000 rows to the SFTP inbox
- 345.4 min, file: soak-976096-10mb.csv: 198000 rows to the FTP inbox
- 350.4 min, file: soak-990433-20mb.csv: 390000 rows to the watched folder
- 362.4 min, load: load stopped and starters undeployed; waiting for open runs to end (at most 10 minutes)
- 362.7 min, check: PASS No engine stopped by itself: 0 unexpected stops
- 362.7 min, check: PASS No run left running: 0 runs still open after starters stopped
- 363 min, check: PASS No step ran twice: 0 steps of single-pass Sutras completed more than once
- 363 min, check: PASS Requests that failed: 107 of 1018735 (0.011%), fault windows included
- 363 min, check: PASS PostgreSQL DB Ops stayed correct: 8603 completed, 1 failed
- 363 min, check: PASS MySQL DB Ops stayed correct: 8604 completed, 0 failed
- 363 min, check: PASS SQLite DB Ops stayed correct: 8602 completed, 2 failed
- 363.1 min, check: PASS RabbitMQ delivered every message: 64889 published, 64889 consumed, 0 failed
- 363.2 min, check: PASS ActiveMQ delivered every message: 64802 published, 64802 consumed, 0 failed
- 363.2 min, check: FAIL Kafka delivered every message: 118 published, 117 consumed, 0 failed
- 363.2 min, check: PASS Remote MySQL DB Ops stayed correct: 178 completed, 1 failed (one every 2 minutes, over the internet)
- 363.2 min, check: PASS Remote PostgreSQL DB Ops stayed correct: 178 completed, 1 failed (one every 2 minutes, over the internet)
- 363.2 min, check: PASS MongoDB Atlas stayed correct: 359 lifecycles completed, 0 failed (one a minute)
- 363.2 min, check: PASS MongoDB Atlas left nothing behind: 0 documents left in the soak collection
- 363.2 min, check: PASS Timer kept time: 2169 runs of 2160 expected (every 10 s)
- 363.2 min, check: PASS Every channel message reached its subscriber: 8616 subscriber runs for 8616 published
- 363.2 min, check: PASS Bus messages acknowledged: 21371 accepted, 0 released, 0 rejected of 21371 sent (2 handed out again after a link closed or a release); subscriber runs {"done":21373}
- 363.3 min, check: PASS WebSocket client trigger ran for the server's messages: 8670 runs for 8670 messages pushed
- 363.3 min, check: PASS WebSocket broadcasts arrived: 7185 received of 7190 expected (1438 broadcasts to the clients connected at the time)
- 363.3 min, check: PASS Every CSV in the folder was streamed whole: 35 of 35 files with every row counted (10 MB, 40 MB, 10 MB, 30 MB, 60 MB, 30 MB, 50 MB, 20 MB, 50 MB, 10 MB, 40 MB, 10 MB, 30 MB, 60 MB, 30 MB, 50 MB, 20 MB, 50 MB, 10 MB, 40 MB, 10 MB, 30 MB, 60 MB, 30 MB, 50 MB, 20 MB, 50 MB, 10 MB, 40 MB, 10 MB, 30 MB, 60 MB, 30 MB, 50 MB, 20 MB)
- 363.3 min, check: PASS Every SFTP CSV was streamed whole: 23 of 23 files with every row counted (20 MB, 60 MB, 40 MB, 20 MB, 60 MB, 40 MB, 20 MB, 60 MB, 40 MB, 20 MB, 60 MB, 40 MB, 20 MB, 60 MB, 40 MB, 20 MB, 60 MB, 40 MB, 20 MB, 60 MB, 40 MB, 20 MB, 60 MB)
- 363.3 min, check: PASS Every FTP CSV was streamed whole: 23 of 23 files with every row counted (30 MB, 20 MB, 50 MB, 40 MB, 10 MB, 60 MB, 30 MB, 20 MB, 50 MB, 40 MB, 10 MB, 60 MB, 30 MB, 20 MB, 50 MB, 40 MB, 10 MB, 60 MB, 30 MB, 20 MB, 50 MB, 40 MB, 10 MB)
- 363.3 min, check: PASS RAG passages are in the pgvector table: 457034 passages in soak_knowledge
- 363.3 min, check: PASS RAG documents were learned: 50 MB done in 55 s; 10 MB done in 18 s; 30 MB done in 41 s; 50 MB done in 86 s; 10 MB done in 18 s; 30 MB done in 49 s; 50 MB done in 73 s; 30 MB done in 49 s; 50 MB done in 85 s; 10 MB done in 24 s
- 363.3 min, check: PASS Engine 0 stays responsive: event loop delay: p99 per minute 40 ms typical, 64 ms in the worst 5% of minutes; longest single wait 1797 ms
- 363.3 min, check: PASS Engine 1 stays responsive: event loop delay: p99 per minute 37 ms typical, 54 ms in the worst 5% of minutes; longest single wait 1769 ms
- 363.3 min, check: PASS Engine 2 stays responsive: event loop delay: p99 per minute 37 ms typical, 48 ms in the worst 5% of minutes; longest single wait 23622 ms
- 363.3 min, check: PASS Engine 0 memory steady: 39.8 MB per hour over the second half; highest 1078 MB
- 363.3 min, check: PASS Engine 1 memory steady: 35.9 MB per hour over the second half; highest 905 MB
- 363.3 min, check: FAIL Engine 2 memory steady: 52.0 MB per hour over the second half; highest 754 MB
- 363.3 min, check: PASS REST orders stays as fast: p95 240 ms in the first period, 270 ms in the last
- 363.3 min, check: PASS REST in memory stays as fast: p95 34 ms in the first period, 45 ms in the last
- 363.3 min, check: PASS REST signed and validated stays as fast: p95 280 ms in the first period, 315 ms in the last
- 363.3 min, check: PASS SOAP UsernameToken stays as fast: p95 262 ms in the first period, 323 ms in the last
- 363.3 min, check: PASS SOAP X.509 signed and encrypted stays as fast: p95 297 ms in the first period, 366 ms in the last
- 363.3 min, check: PASS WebSocket echo stays as fast: p95 263 ms in the first period, 301 ms in the last
- 363.3 min, check: PASS WebSocket broadcast stays as fast: p95 756 ms in the first period, 329 ms in the last
- 363.3 min, check: PASS PostgreSQL DB Ops stays as fast: p95 625 ms in the first period, 854 ms in the last
- 363.3 min, check: PASS MySQL DB Ops stays as fast: p95 626 ms in the first period, 1121 ms in the last
- 363.3 min, check: PASS SQLite DB Ops stays as fast: p95 629 ms in the first period, 1109 ms in the last
- 363.3 min, check: PASS RabbitMQ publish stays as fast: p95 572 ms in the first period, 596 ms in the last
- 363.3 min, check: PASS ActiveMQ publish stays as fast: p95 574 ms in the first period, 594 ms in the last
- 363.3 min, check: PASS MongoDB Atlas (gentle) stays as fast: p95 5798 ms in the first period, 8316 ms in the last
- 363.3 min, check: PASS Channel publish stays as fast: p95 645 ms in the first period, 954 ms in the last
- 363.3 min, check: PASS Error handler stays as fast: p95 1113 ms in the first period, 1593 ms in the last
- 363.3 min, check: PASS Called Sutra and approval stays as fast: p95 10751 ms in the first period, 10223 ms in the last
- 363.3 min, check: PASS MCP tool stays as fast: p95 339 ms in the first period, 315 ms in the last
- 363.3 min, check: FAIL RAG search stays as fast: p95 1668 ms in the first period, 26635 ms in the last

## Starters covered

Run here: Manual start (API), Timer, REST service, SOAP service, WebSocket service, WebSocket client, Folder (file) trigger on a shared location, Remote file trigger (SFTP and FTP), Message bus subscriber (AMQP 1.0 stand-in), Channel trigger, Error handler, MCP tool, AI agent channel (chat); Google Drive upload and fetch when its account is set up. Every file is streamed.

Not run here (they need outside accounts or servers): Email (IMAP), Kafka and RabbitMQ subscribers, the Google Drive trigger, Microsoft files, Twitch, Discord, Telegram, Azure Data Factory.
