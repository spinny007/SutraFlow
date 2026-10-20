# SutraFlow 1.8.0 soak test

2026-10-20T04:04:28.749Z to 2026-10-20T12:04:57.818Z (8 hours), 3 processes (a studio and 2 engines) on PostgreSQL, AMD Ryzen 7 7435HS, 16 threads, 24 GB, win32, Node v24.21.0, AI: phi4-mini on Ollama.

**27 of 31 checks passed.**

| Check | Result | Detail |
|---|---|---|
| No engine stopped by itself | **fail** | 1 unexpected stops (see events) |
| No run left running | pass | 0 runs still running 10 minutes after the load stopped |
| No step ran twice | pass | 0 steps of single-pass Sutras completed more than once |
| Requests that failed | pass | 444 of 500338 (0.089%), fault windows included |
| Timer kept time | **fail** | 2498 runs of 2880 expected (every 10 s) |
| Every channel message reached its subscriber | pass | 4986 subscriber runs for 4986 published |
| Bus messages acknowledged | pass | 12437 accepted, 0 released, 0 rejected of 12439 sent |
| WebSocket client trigger ran for the server's messages | pass | 4995 runs for 5000 messages pushed |
| WebSocket broadcasts arrived | pass | 4170 received of 4170 expected (834 broadcasts to the clients connected at the time) |
| Every CSV in the folder was streamed whole | pass | 22 of 22 files with every row counted (10 MB, 40 MB, 20 MB, 30 MB, 60 MB, 40 MB, 50 MB, 20 MB, 60 MB, 10 MB, 40 MB, 20 MB, 30 MB, 60 MB, 40 MB, 50 MB, 20 MB, 60 MB, 10 MB, 40 MB, 20 MB, 30 MB) |
| Every SFTP CSV was streamed whole | pass | 14 of 14 files with every row counted (20 MB, 60 MB, 40 MB, 20 MB, 60 MB, 40 MB, 20 MB, 60 MB, 40 MB, 20 MB, 60 MB, 40 MB, 20 MB, 60 MB) |
| Every FTP CSV was streamed whole | pass | 14 of 14 files with every row counted (30 MB, 10 MB, 50 MB, 30 MB, 10 MB, 50 MB, 30 MB, 10 MB, 50 MB, 30 MB, 10 MB, 50 MB, 30 MB, 10 MB) |
| RAG passages are in the pgvector table | pass | 328490 passages in soak_knowledge |
| RAG documents were learned | pass | 50 MB done in 67 s; 10 MB done in 14 s; 30 MB done in 36 s; 50 MB done in 57 s; 10 MB done in 14 s; 30 MB done in 36 s; 50 MB done in 75 s |
| Engine 0 stays responsive | pass | event loop delay: p99 per minute 35 ms typical, 48 ms in the worst 5% of minutes; longest single wait 2327872 ms |
| Engine 1 stays responsive | pass | event loop delay: p99 per minute 34 ms typical, 37 ms in the worst 5% of minutes; longest single wait 2327872 ms |
| Engine 2 stays responsive | pass | event loop delay: p99 per minute 34 ms typical, 36 ms in the worst 5% of minutes; longest single wait 2327872 ms |
| Engine 0 memory steady | pass | 23.8 MB per hour over the second half; highest 773 MB |
| Engine 1 memory steady | **fail** | 60.7 MB per hour over the second half; highest 758 MB |
| Engine 2 memory steady | pass | 17.4 MB per hour over the second half; highest 577 MB |
| REST orders stays as fast | pass | p95 152 ms in the first period, 210 ms in the last |
| REST in memory stays as fast | pass | p95 11 ms in the first period, 32 ms in the last |
| REST signed and validated stays as fast | pass | p95 217 ms in the first period, 303 ms in the last |
| SOAP UsernameToken stays as fast | pass | p95 215 ms in the first period, 275 ms in the last |
| SOAP X.509 signed and encrypted stays as fast | pass | p95 227 ms in the first period, 289 ms in the last |
| WebSocket echo stays as fast | pass | p95 214 ms in the first period, 228 ms in the last |
| WebSocket broadcast stays as fast | pass | p95 428 ms in the first period, 212 ms in the last |
| Channel publish stays as fast | **fail** | p95 529 ms in the first period, 1110 ms in the last |
| Error handler stays as fast | pass | p95 1035 ms in the first period, 1657 ms in the last |
| MCP tool stays as fast | pass | p95 203 ms in the first period, 214 ms in the last |
| RAG search stays as fast | pass | p95 1784 ms in the first period, 2758 ms in the last |

## Scenarios

| Scenario | Done | Failed | p50 / p95 / p99 ms (last period) | Most frequent error |
|---|---|---|---|---|
| REST orders | 235300 | 31 | 24 / 210 / 2366 | fetch failed (22) |
| REST in memory | 120220 | 11 | 7 / 32 / 889 | fetch failed (10) |
| REST signed and validated | 24791 | 4 | 77 / 303 / 2260 | fetch failed (3) |
| SOAP UsernameToken | 24790 | 5 | 53 / 275 / 2095 | fetch failed (5) |
| SOAP X.509 signed and encrypted | 6232 | 4 | 66 / 289 / 2799 | fetch failed (4) |
| WebSocket echo | 62127 | 5 | 52 / 228 / 1568 | not connected (3) |
| WebSocket broadcast | 833 | 1 | 83 / 1013 / 5091 | The operation was aborted due to timeout (1) |
| Channel publish | 4986 | 5 | 514 / 1110 / 3889 | POST /api/flows/896abdfb-7243-4fb3-b530-02ca959aafea/run?wait=30000: gave up after 1 tries: fetch failed (5) |
| Error handler | 4985 | 6 | 681 / 1657 / 4057 | POST /api/flows/c2db8a85-58cf-4ab3-a6eb-dda8fe935eaa/run?wait=30000: gave up after 1 tries: fetch failed (5) |
| Called Sutra and approval | 0 | 355 | - | the run did not end within 2 minutes of approval (354) |
| MCP tool | 2498 | 0 | 24 / 214 / 598 |  |
| Bus message | 12439 | 10 | 0 / 0 / 1 | the subscriber is not connected (10) |
| RAG search | 416 | 1 | 1839 / 11074 / 15758 | POST /api/flows/6ed5caf9-4dc6-4f95-98b6-b2c343ba00e2/run?wait=60000: gave up after 1 tries: The operation was aborted due to timeout (1) |
| RAG ask (Ollama) | 84 | 1 | 3772 / 14462 / 14462 | POST /api/flows/0b6bec37-19cd-4745-aa57-314ee18a68a1/run?wait=600000: gave up after 1 tries: The operation was aborted due to timeout (1) |
| AI agent chat (Ollama) | 136 | 5 | 1939 / 14360 / 14360 | The operation was aborted due to timeout (2) |
| Folder CSV (streamed) | 22 | 0 | 305 / 305 / 305 |  |
| SFTP CSV | 14 | 0 | 743 / 743 / 743 |  |
| FTP CSV (streamed) | 14 | 0 | 147 / 147 / 147 |  |
| RAG document ingest | 7 | 0 | 75998 / 75998 / 75998 |  |

## Faults on purpose

- engine killed at 2026-10-20T06:44:42.796Z
- database cut at 2026-10-20T09:24:42.795Z

## Big files

| Kind | File | Size | Result |
|---|---|---|---|
| Folder CSV (streamed) | soak-24010-10mb.csv | 10 MB, 198000 rows | see check |
| Folder CSV (streamed) | soak-48017-40mb.csv | 40 MB, 776000 rows | see check |
| Folder CSV (streamed) | soak-72086-20mb.csv | 20 MB, 390000 rows | see check |
| Folder CSV (streamed) | soak-96142-30mb.csv | 30 MB, 582000 rows | see check |
| Folder CSV (streamed) | soak-120254-60mb.csv | 60 MB, 1156000 rows | see check |
| Folder CSV (streamed) | soak-144345-40mb.csv | 40 MB, 776000 rows | see check |
| Folder CSV (streamed) | soak-168454-50mb.csv | 50 MB, 968000 rows | see check |
| Folder CSV (streamed) | soak-192540-20mb.csv | 20 MB, 390000 rows | see check |
| Folder CSV (streamed) | soak-216617-60mb.csv | 60 MB, 1156000 rows | see check |
| Folder CSV (streamed) | soak-231168-10mb.csv | 10 MB, 198000 rows | see check |
| Folder CSV (streamed) | soak-255233-40mb.csv | 40 MB, 776000 rows | see check |
| Folder CSV (streamed) | soak-279310-20mb.csv | 20 MB, 390000 rows | see check |
| Folder CSV (streamed) | soak-303375-30mb.csv | 30 MB, 582000 rows | see check |
| Folder CSV (streamed) | soak-327414-60mb.csv | 60 MB, 1156000 rows | see check |
| Folder CSV (streamed) | soak-351465-40mb.csv | 40 MB, 776000 rows | see check |
| Folder CSV (streamed) | soak-375075-50mb.csv | 50 MB, 968000 rows | see check |
| Folder CSV (streamed) | soak-399081-20mb.csv | 20 MB, 390000 rows | see check |
| Folder CSV (streamed) | soak-423078-60mb.csv | 60 MB, 1156000 rows | see check |
| Folder CSV (streamed) | soak-447074-10mb.csv | 10 MB, 198000 rows | see check |
| Folder CSV (streamed) | soak-471093-40mb.csv | 40 MB, 776000 rows | see check |
| Folder CSV (streamed) | soak-473422-20mb.csv | 20 MB, 390000 rows | see check |
| Folder CSV (streamed) | soak-497144-30mb.csv | 30 MB, 582000 rows | see check |
| SFTP CSV | soak-36022-20mb.csv | 20 MB, 390000 rows | see check |
| SFTP CSV | soak-72084-60mb.csv | 60 MB, 1156000 rows | see check |
| SFTP CSV | soak-108181-40mb.csv | 40 MB, 776000 rows | see check |
| SFTP CSV | soak-144331-20mb.csv | 20 MB, 390000 rows | see check |
| SFTP CSV | soak-180491-60mb.csv | 60 MB, 1156000 rows | see check |
| SFTP CSV | soak-216603-40mb.csv | 40 MB, 776000 rows | see check |
| SFTP CSV | soak-231169-20mb.csv | 20 MB, 390000 rows | see check |
| SFTP CSV | soak-267265-60mb.csv | 60 MB, 1156000 rows | see check |
| SFTP CSV | soak-303382-40mb.csv | 40 MB, 776000 rows | see check |
| SFTP CSV | soak-339443-20mb.csv | 20 MB, 390000 rows | see check |
| SFTP CSV | soak-375080-60mb.csv | 60 MB, 1156000 rows | see check |
| SFTP CSV | soak-411078-40mb.csv | 40 MB, 776000 rows | see check |
| SFTP CSV | soak-447085-20mb.csv | 20 MB, 390000 rows | see check |
| SFTP CSV | soak-473420-60mb.csv | 60 MB, 1156000 rows | see check |
| FTP CSV (streamed) | soak-36023-30mb.csv | 30 MB, 582000 rows | see check |
| FTP CSV (streamed) | soak-72085-10mb.csv | 10 MB, 198000 rows | see check |
| FTP CSV (streamed) | soak-108195-50mb.csv | 50 MB, 968000 rows | see check |
| FTP CSV (streamed) | soak-144342-30mb.csv | 30 MB, 582000 rows | see check |
| FTP CSV (streamed) | soak-180497-10mb.csv | 10 MB, 198000 rows | see check |
| FTP CSV (streamed) | soak-216614-50mb.csv | 50 MB, 968000 rows | see check |
| FTP CSV (streamed) | soak-231170-30mb.csv | 30 MB, 582000 rows | see check |
| FTP CSV (streamed) | soak-267270-10mb.csv | 10 MB, 198000 rows | see check |
| FTP CSV (streamed) | soak-303385-50mb.csv | 50 MB, 968000 rows | see check |
| FTP CSV (streamed) | soak-339450-30mb.csv | 30 MB, 582000 rows | see check |
| FTP CSV (streamed) | soak-375086-10mb.csv | 10 MB, 198000 rows | see check |
| FTP CSV (streamed) | soak-411086-50mb.csv | 50 MB, 968000 rows | see check |
| FTP CSV (streamed) | soak-447096-30mb.csv | 30 MB, 582000 rows | see check |
| FTP CSV (streamed) | soak-473421-10mb.csv | 10 MB, 198000 rows | see check |
| RAG document (streamed to pgvector) | soak-doc-72083-50mb.txt | 50 MB | done in 67 s, 54 parts |
| RAG document (streamed to pgvector) | soak-doc-144308-10mb.txt | 10 MB | done in 14 s, 11 parts |
| RAG document (streamed to pgvector) | soak-doc-216583-30mb.txt | 30 MB | done in 36 s, 33 parts |
| RAG document (streamed to pgvector) | soak-doc-259143-50mb.txt | 50 MB | done in 57 s, 54 parts |
| RAG document (streamed to pgvector) | soak-doc-331319-10mb.txt | 10 MB | done in 14 s, 11 parts |
| RAG document (streamed to pgvector) | soak-doc-402983-30mb.txt | 30 MB | done in 36 s, 33 parts |
| RAG document (streamed to pgvector) | soak-doc-473418-50mb.txt | 50 MB | done in 75 s, 54 parts |

## Resources

| Engine | Highest memory | Last memory | Restarts |
|---|---|---|---|
| studio | 773 MB | 527 MB | 1 |
| engine 1 | 758 MB | 621 MB | 0 |
| engine 2 | 577 MB | 277 MB | 0 |

Database: 4502 MB at the end; runs {"done":510310,"failed":2,"waiting":357}.

## Events

- 0 min, start: SutraFlow 1.8.0, 3 processes, 480 minutes, database sutra_soak_1792469068848, 16 threads, 24 GB
- 0.1 min, setup: 23 Sutras deployed
- 0.2 min, load: 19 scenarios running
- 20.2 min, file: soak-24010-10mb.csv: 198000 rows to the watched folder
- 30.2 min, file: soak-36022-20mb.csv: 390000 rows to the SFTP inbox
- 30.2 min, file: soak-36023-30mb.csv: 582000 rows to the FTP inbox
- 40.2 min, file: soak-48017-40mb.csv: 776000 rows to the watched folder
- 60.3 min, file: soak-72084-60mb.csv: 1156000 rows to the SFTP inbox
- 60.3 min, file: soak-72085-10mb.csv: 198000 rows to the FTP inbox
- 60.3 min, file: soak-72086-20mb.csv: 390000 rows to the watched folder
- 61.4 min, document: soak-doc-72083-50mb.txt: done in 67 s
- 80.3 min, file: soak-96142-30mb.csv: 582000 rows to the watched folder
- 90.3 min, file: soak-108181-40mb.csv: 776000 rows to the SFTP inbox
- 90.3 min, file: soak-108195-50mb.csv: 968000 rows to the FTP inbox
- 100.3 min, file: soak-120254-60mb.csv: 1156000 rows to the watched folder
- 120.3 min, file: soak-144331-20mb.csv: 390000 rows to the SFTP inbox
- 120.3 min, file: soak-144342-30mb.csv: 582000 rows to the FTP inbox
- 120.3 min, file: soak-144345-40mb.csv: 776000 rows to the watched folder
- 120.5 min, document: soak-doc-144308-10mb.txt: done in 14 s
- 140.3 min, file: soak-168454-50mb.csv: 968000 rows to the watched folder
- 150.3 min, file: soak-180491-60mb.csv: 1156000 rows to the SFTP inbox
- 150.3 min, file: soak-180497-10mb.csv: 198000 rows to the FTP inbox
- 160.2 min, fault: engine 2 killed on purpose
- 160.3 min, file: soak-192540-20mb.csv: 390000 rows to the watched folder
- 161.3 min, fault: engine 2 started again
- 180.3 min, file: soak-216603-40mb.csv: 776000 rows to the SFTP inbox
- 180.3 min, file: soak-216614-50mb.csv: 968000 rows to the FTP inbox
- 180.3 min, file: soak-216617-60mb.csv: 1156000 rows to the watched folder
- 180.8 min, document: soak-doc-216583-30mb.txt: done in 36 s
- 217 min, file: soak-231168-10mb.csv: 198000 rows to the watched folder
- 217 min, file: soak-231169-20mb.csv: 390000 rows to the SFTP inbox
- 217 min, file: soak-231170-30mb.csv: 582000 rows to the FTP inbox
- 237 min, file: soak-255233-40mb.csv: 776000 rows to the watched folder
- 241.2 min, document: soak-doc-259143-50mb.txt: done in 57 s
- 247 min, file: soak-267265-60mb.csv: 1156000 rows to the SFTP inbox
- 247 min, file: soak-267270-10mb.csv: 198000 rows to the FTP inbox
- 257 min, file: soak-279310-20mb.csv: 390000 rows to the watched folder
- 277 min, file: soak-303375-30mb.csv: 582000 rows to the watched folder
- 277 min, file: soak-303382-40mb.csv: 776000 rows to the SFTP inbox
- 277 min, file: soak-303385-50mb.csv: 968000 rows to the FTP inbox
- 297 min, file: soak-327414-60mb.csv: 1156000 rows to the watched folder
- 300.5 min, document: soak-doc-331319-10mb.txt: done in 14 s
- 307 min, file: soak-339443-20mb.csv: 390000 rows to the SFTP inbox
- 307 min, file: soak-339450-30mb.csv: 582000 rows to the FTP inbox
- 317 min, file: soak-351465-40mb.csv: 776000 rows to the watched folder
- 320.2 min, fault: database cut for 20 seconds
- 320.6 min, fault: database back
- 320.6 min, retry: GET /api/approvals (1/5): fetch failed
- 320.6 min, retry: GET /api/approvals (1/5): fetch failed
- 320.6 min, engine stopped: engine 0 stopped by itself (code 1, signal null)
- 320.6 min, retry: GET /api/approvals (2/5): fetch failed
- 320.6 min, retry: GET /api/approvals (2/5): fetch failed
- 320.7 min, engine restarted: engine 0 started again (1/10)
- 320.7 min, retry: GET /api/approvals (3/5): fetch failed
- 320.7 min, retry: GET /api/approvals (3/5): fetch failed
- 337 min, file: soak-375075-50mb.csv: 968000 rows to the watched folder
- 337 min, file: soak-375080-60mb.csv: 1156000 rows to the SFTP inbox
- 337 min, file: soak-375086-10mb.csv: 198000 rows to the FTP inbox
- 357 min, file: soak-399081-20mb.csv: 390000 rows to the watched folder
- 360.8 min, document: soak-doc-402983-30mb.txt: done in 36 s
- 367 min, file: soak-411078-40mb.csv: 776000 rows to the SFTP inbox
- 367 min, file: soak-411086-50mb.csv: 968000 rows to the FTP inbox
- 377 min, file: soak-423078-60mb.csv: 1156000 rows to the watched folder
- 397 min, file: soak-447074-10mb.csv: 198000 rows to the watched folder
- 397 min, file: soak-447085-20mb.csv: 390000 rows to the SFTP inbox
- 397 min, file: soak-447096-30mb.csv: 582000 rows to the FTP inbox
- 417 min, file: soak-471093-40mb.csv: 776000 rows to the watched folder
- 457.7 min, file: soak-473420-60mb.csv: 1156000 rows to the SFTP inbox
- 457.7 min, file: soak-473421-10mb.csv: 198000 rows to the FTP inbox
- 457.8 min, file: soak-473422-20mb.csv: 390000 rows to the watched folder
- 459 min, document: soak-doc-473418-50mb.txt: done in 75 s
- 477.8 min, file: soak-497144-30mb.csv: 582000 rows to the watched folder
- 480.1 min, load: load stopped; waiting for open runs to end (at most 10 minutes)
- 480.3 min, check: FAIL No engine stopped by itself: 1 unexpected stops (see events)
- 480.3 min, check: PASS No run left running: 0 runs still running 10 minutes after the load stopped
- 480.5 min, check: PASS No step ran twice: 0 steps of single-pass Sutras completed more than once
- 480.5 min, check: PASS Requests that failed: 444 of 500338 (0.089%), fault windows included
- 480.5 min, check: FAIL Timer kept time: 2498 runs of 2880 expected (every 10 s)
- 480.5 min, check: PASS Every channel message reached its subscriber: 4986 subscriber runs for 4986 published
- 480.5 min, check: PASS Bus messages acknowledged: 12437 accepted, 0 released, 0 rejected of 12439 sent
- 480.5 min, check: PASS WebSocket client trigger ran for the server's messages: 4995 runs for 5000 messages pushed
- 480.5 min, check: PASS WebSocket broadcasts arrived: 4170 received of 4170 expected (834 broadcasts to the clients connected at the time)
- 480.5 min, check: PASS Every CSV in the folder was streamed whole: 22 of 22 files with every row counted (10 MB, 40 MB, 20 MB, 30 MB, 60 MB, 40 MB, 50 MB, 20 MB, 60 MB, 10 MB, 40 MB, 20 MB, 30 MB, 60 MB, 40 MB, 50 MB, 20 MB, 60 MB, 10 MB, 40 MB, 20 MB, 30 MB)
- 480.5 min, check: PASS Every SFTP CSV was streamed whole: 14 of 14 files with every row counted (20 MB, 60 MB, 40 MB, 20 MB, 60 MB, 40 MB, 20 MB, 60 MB, 40 MB, 20 MB, 60 MB, 40 MB, 20 MB, 60 MB)
- 480.5 min, check: PASS Every FTP CSV was streamed whole: 14 of 14 files with every row counted (30 MB, 10 MB, 50 MB, 30 MB, 10 MB, 50 MB, 30 MB, 10 MB, 50 MB, 30 MB, 10 MB, 50 MB, 30 MB, 10 MB)
- 480.5 min, check: PASS RAG passages are in the pgvector table: 328490 passages in soak_knowledge
- 480.5 min, check: PASS RAG documents were learned: 50 MB done in 67 s; 10 MB done in 14 s; 30 MB done in 36 s; 50 MB done in 57 s; 10 MB done in 14 s; 30 MB done in 36 s; 50 MB done in 75 s
- 480.5 min, check: PASS Engine 0 stays responsive: event loop delay: p99 per minute 35 ms typical, 48 ms in the worst 5% of minutes; longest single wait 2327872 ms
- 480.5 min, check: PASS Engine 1 stays responsive: event loop delay: p99 per minute 34 ms typical, 37 ms in the worst 5% of minutes; longest single wait 2327872 ms
- 480.5 min, check: PASS Engine 2 stays responsive: event loop delay: p99 per minute 34 ms typical, 36 ms in the worst 5% of minutes; longest single wait 2327872 ms
- 480.5 min, check: PASS Engine 0 memory steady: 23.8 MB per hour over the second half; highest 773 MB
- 480.5 min, check: FAIL Engine 1 memory steady: 60.7 MB per hour over the second half; highest 758 MB
- 480.5 min, check: PASS Engine 2 memory steady: 17.4 MB per hour over the second half; highest 577 MB
- 480.5 min, check: PASS REST orders stays as fast: p95 152 ms in the first period, 210 ms in the last
- 480.5 min, check: PASS REST in memory stays as fast: p95 11 ms in the first period, 32 ms in the last
- 480.5 min, check: PASS REST signed and validated stays as fast: p95 217 ms in the first period, 303 ms in the last
- 480.5 min, check: PASS SOAP UsernameToken stays as fast: p95 215 ms in the first period, 275 ms in the last
- 480.5 min, check: PASS SOAP X.509 signed and encrypted stays as fast: p95 227 ms in the first period, 289 ms in the last
- 480.5 min, check: PASS WebSocket echo stays as fast: p95 214 ms in the first period, 228 ms in the last
- 480.5 min, check: PASS WebSocket broadcast stays as fast: p95 428 ms in the first period, 212 ms in the last
- 480.5 min, check: FAIL Channel publish stays as fast: p95 529 ms in the first period, 1110 ms in the last
- 480.5 min, check: PASS Error handler stays as fast: p95 1035 ms in the first period, 1657 ms in the last
- 480.5 min, check: PASS MCP tool stays as fast: p95 203 ms in the first period, 214 ms in the last
- 480.5 min, check: PASS RAG search stays as fast: p95 1784 ms in the first period, 2758 ms in the last

## Starters covered

Run here: Manual start (API), Timer, REST service, SOAP service, WebSocket service, WebSocket client, Folder (file) trigger on a shared location, Remote file trigger (SFTP and FTP), Message bus subscriber (AMQP 1.0 stand-in), Channel trigger, Error handler, MCP tool, AI agent channel (chat); Google Drive upload and fetch when its account is set up. Every file is streamed.

Not run here (they need outside accounts or servers): Email (IMAP), Kafka and RabbitMQ subscribers, the Google Drive trigger, Microsoft files, Twitch, Discord, Telegram, Azure Data Factory.
