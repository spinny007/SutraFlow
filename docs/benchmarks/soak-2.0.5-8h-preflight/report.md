# SutraFlow 2.0.5 soak test

2026-10-22T19:28:00.559Z to 2026-10-22T19:32:25.386Z (0.1 hours), 3 processes (a studio and 2 engines) on PostgreSQL, AMD Ryzen 7 7435HS, 16 threads, 24 GB, win32, Node v22.23.2, AI: phi4-mini:latest on Ollama.

**17 of 21 checks passed.**

| Check | Result | Detail |
|---|---|---|
| No engine stopped by itself | pass | 0 unexpected stops |
| No run left running | pass | 0 runs still open after starters stopped |
| No step ran twice | pass | 0 steps of single-pass Sutras completed more than once |
| Requests that failed | **fail** | 396 of 11396 (3.475%), fault windows included |
| PostgreSQL DB Ops stayed correct | **fail** | 0 completed, 131 failed |
| MySQL DB Ops stayed correct | **fail** | 0 completed, 131 failed |
| SQLite DB Ops stayed correct | **fail** | 0 completed, 130 failed |
| Timer kept time | pass | 23 runs of 24 expected (every 10 s) |
| Every channel message reached its subscriber | pass | 130 subscriber runs for 130 published |
| Bus messages acknowledged | pass | 326 accepted, 0 released, 0 rejected of 326 sent |
| WebSocket client trigger ran for the server's messages | pass | 140 runs for 140 messages pushed |
| WebSocket broadcasts arrived | pass | 105 received of 105 expected (21 broadcasts to the clients connected at the time) |
| Engine 0 stays responsive | pass | event loop delay: p99 per minute 37 ms typical, 77 ms in the worst 5% of minutes; longest single wait 647 ms |
| Engine 1 stays responsive | pass | event loop delay: p99 per minute 35 ms typical, 38 ms in the worst 5% of minutes; longest single wait 662 ms |
| Engine 2 stays responsive | pass | event loop delay: p99 per minute 36 ms typical, 48 ms in the worst 5% of minutes; longest single wait 657 ms |
| REST orders stays as fast | pass | p95 240 ms in the first period, 225 ms in the last |
| REST in memory stays as fast | pass | p95 29 ms in the first period, 23 ms in the last |
| REST signed and validated stays as fast | pass | p95 253 ms in the first period, 220 ms in the last |
| SOAP UsernameToken stays as fast | pass | p95 243 ms in the first period, 219 ms in the last |
| WebSocket echo stays as fast | pass | p95 248 ms in the first period, 227 ms in the last |
| Bus message stays as fast | pass | p95 1 ms in the first period, 1 ms in the last |

## Scenarios

| Scenario | Done | Failed | p50 / p95 / p99 ms (last period) | Most frequent error |
|---|---|---|---|---|
| REST orders | 4058 | 0 | - |  |
| REST in memory | 3168 | 0 | - |  |
| REST signed and validated | 648 | 0 | - |  |
| SOAP UsernameToken | 648 | 0 | - |  |
| SOAP X.509 signed and encrypted | 164 | 0 | - |  |
| WebSocket echo | 1606 | 4 | - | not connected (4) |
| WebSocket broadcast | 21 | 0 | - |  |
| PostgreSQL DB Ops | 0 | 131 | - | run done: {} (131) |
| MySQL DB Ops | 0 | 131 | - | run failed: Read: Bind parameters must not contain undefined. To pass SQL NULL specify JS null (131) |
| SQLite DB Ops | 0 | 130 | - | run failed: Read: Provided value cannot be bound to SQLite parameter 1. (130) |
| Channel publish | 130 | 0 | - |  |
| Error handler | 130 | 0 | - |  |
| Called Sutra and approval | 21 | 0 | - |  |
| MCP tool | 65 | 0 | - |  |
| Bus message | 326 | 0 | - |  |
| RAG search | 10 | 0 | - |  |
| RAG ask (Ollama) | 2 | 0 | - |  |
| AI agent chat (Ollama) | 3 | 0 | - |  |

## Faults on purpose

- none

## Big files

| Kind | File | Size | Result |
|---|---|---|---|

## Resources

| Engine | Highest memory | Last memory | Restarts |
|---|---|---|---|
| studio | 170 MB | 131 MB | 0 |
| engine 1 | 185 MB | 125 MB | 0 |
| engine 2 | 167 MB | 123 MB | 0 |

Database: 87 MB at the end; runs {"done":11381,"failed":261}.

## Events

- 0 min, start: SutraFlow 2.0.5, 3 processes, 4 minutes, database sutra_soak_1792697280712, 16 threads, 24 GB
- 0.2 min, setup: 26 Sutras deployed
- 0.3 min, load: 18 scenarios running
- 4.1 min, load: load stopped and starters undeployed; waiting for open runs to end (at most 10 minutes)
- 4.4 min, check: PASS No engine stopped by itself: 0 unexpected stops
- 4.4 min, check: PASS No run left running: 0 runs still open after starters stopped
- 4.4 min, check: PASS No step ran twice: 0 steps of single-pass Sutras completed more than once
- 4.4 min, check: FAIL Requests that failed: 396 of 11396 (3.475%), fault windows included
- 4.4 min, check: FAIL PostgreSQL DB Ops stayed correct: 0 completed, 131 failed
- 4.4 min, check: FAIL MySQL DB Ops stayed correct: 0 completed, 131 failed
- 4.4 min, check: FAIL SQLite DB Ops stayed correct: 0 completed, 130 failed
- 4.4 min, check: PASS Timer kept time: 23 runs of 24 expected (every 10 s)
- 4.4 min, check: PASS Every channel message reached its subscriber: 130 subscriber runs for 130 published
- 4.4 min, check: PASS Bus messages acknowledged: 326 accepted, 0 released, 0 rejected of 326 sent
- 4.4 min, check: PASS WebSocket client trigger ran for the server's messages: 140 runs for 140 messages pushed
- 4.4 min, check: PASS WebSocket broadcasts arrived: 105 received of 105 expected (21 broadcasts to the clients connected at the time)
- 4.4 min, check: PASS Engine 0 stays responsive: event loop delay: p99 per minute 37 ms typical, 77 ms in the worst 5% of minutes; longest single wait 647 ms
- 4.4 min, check: PASS Engine 1 stays responsive: event loop delay: p99 per minute 35 ms typical, 38 ms in the worst 5% of minutes; longest single wait 662 ms
- 4.4 min, check: PASS Engine 2 stays responsive: event loop delay: p99 per minute 36 ms typical, 48 ms in the worst 5% of minutes; longest single wait 657 ms
- 4.4 min, check: PASS REST orders stays as fast: p95 240 ms in the first period, 225 ms in the last
- 4.4 min, check: PASS REST in memory stays as fast: p95 29 ms in the first period, 23 ms in the last
- 4.4 min, check: PASS REST signed and validated stays as fast: p95 253 ms in the first period, 220 ms in the last
- 4.4 min, check: PASS SOAP UsernameToken stays as fast: p95 243 ms in the first period, 219 ms in the last
- 4.4 min, check: PASS WebSocket echo stays as fast: p95 248 ms in the first period, 227 ms in the last
- 4.4 min, check: PASS Bus message stays as fast: p95 1 ms in the first period, 1 ms in the last

## Starters covered

Run here: Manual start (API), Timer, REST service, SOAP service, WebSocket service, WebSocket client, Folder (file) trigger on a shared location, Remote file trigger (SFTP and FTP), Message bus subscriber (AMQP 1.0 stand-in), Channel trigger, Error handler, MCP tool, AI agent channel (chat); Google Drive upload and fetch when its account is set up. Every file is streamed.

Not run here (they need outside accounts or servers): Email (IMAP), Kafka and RabbitMQ subscribers, the Google Drive trigger, Microsoft files, Twitch, Discord, Telegram, Azure Data Factory.
