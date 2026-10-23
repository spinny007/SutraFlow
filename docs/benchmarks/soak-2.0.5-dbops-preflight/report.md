# SutraFlow 2.0.5 soak test

2026-10-23T01:53:44.340Z to 2026-10-23T01:56:17.742Z (0 hours), 3 processes (a studio and 2 engines) on PostgreSQL, AMD Ryzen 7 7435HS, 16 threads, 24 GB, win32, Node v24.21.0, AI: phi4-mini:latest on Ollama.

**20 of 20 checks passed.**

| Check | Result | Detail |
|---|---|---|
| No engine stopped by itself | pass | 0 unexpected stops |
| No run left running | pass | 0 runs still open after starters stopped |
| No step ran twice | pass | 0 steps of single-pass Sutras completed more than once |
| Requests that failed | pass | 3 of 4022 (0.075%), fault windows included |
| PostgreSQL DB Ops stayed correct | pass | 40 completed, 0 failed |
| MySQL DB Ops stayed correct | pass | 40 completed, 0 failed |
| SQLite DB Ops stayed correct | pass | 40 completed, 0 failed |
| Timer kept time | pass | 11 runs of 12 expected (every 10 s) |
| Every channel message reached its subscriber | pass | 40 subscriber runs for 40 published |
| Bus messages acknowledged | pass | 100 accepted, 0 released, 0 rejected of 100 sent |
| WebSocket client trigger ran for the server's messages | pass | 46 runs for 46 messages pushed |
| WebSocket broadcasts arrived | pass | 30 received of 30 expected (6 broadcasts to the clients connected at the time) |
| Engine 0 stays responsive | pass | event loop delay: p99 per minute 36 ms typical, 71 ms in the worst 5% of minutes; longest single wait 210 ms |
| Engine 1 stays responsive | pass | event loop delay: p99 per minute 35 ms typical, 35 ms in the worst 5% of minutes; longest single wait 553 ms |
| Engine 2 stays responsive | pass | event loop delay: p99 per minute 35 ms typical, 35 ms in the worst 5% of minutes; longest single wait 560 ms |
| REST orders stays as fast | pass | p95 228 ms in the first period, 221 ms in the last |
| REST in memory stays as fast | pass | p95 19 ms in the first period, 13 ms in the last |
| REST signed and validated stays as fast | pass | p95 665 ms in the first period, 629 ms in the last |
| SOAP UsernameToken stays as fast | pass | p95 444 ms in the first period, 624 ms in the last |
| WebSocket echo stays as fast | pass | p95 222 ms in the first period, 219 ms in the last |

## Scenarios

| Scenario | Done | Failed | p50 / p95 / p99 ms (last period) | Most frequent error |
|---|---|---|---|---|
| REST orders | 1779 | 0 | - |  |
| REST in memory | 961 | 0 | - |  |
| REST signed and validated | 200 | 0 | - |  |
| SOAP UsernameToken | 200 | 0 | - |  |
| SOAP X.509 signed and encrypted | 50 | 0 | - |  |
| WebSocket echo | 493 | 3 | - | not connected (3) |
| WebSocket broadcast | 6 | 0 | - |  |
| PostgreSQL DB Ops | 40 | 0 | - |  |
| MySQL DB Ops | 40 | 0 | - |  |
| SQLite DB Ops | 40 | 0 | - |  |
| Channel publish | 40 | 0 | - |  |
| Error handler | 40 | 0 | - |  |
| Called Sutra and approval | 6 | 0 | - |  |
| MCP tool | 20 | 0 | - |  |
| Bus message | 100 | 0 | - |  |
| RAG search | 3 | 0 | - |  |
| RAG ask (Ollama) | 0 | 0 | - |  |
| AI agent chat (Ollama) | 1 | 0 | 18923 / 18923 / 18923 |  |

## Faults on purpose

- none

## Big files

| Kind | File | Size | Result |
|---|---|---|---|

## Resources

| Engine | Highest memory | Last memory | Restarts |
|---|---|---|---|
| studio | 271 MB | 271 MB | 0 |
| engine 1 | 253 MB | 251 MB | 0 |
| engine 2 | 261 MB | 261 MB | 0 |

Database: 39 MB at the end; runs {"done":4103}.

## Events

- 0 min, start: SutraFlow 2.0.5, 3 processes, 2 minutes, database sutra_soak_1792720424500, 16 threads, 24 GB
- 0.2 min, setup: 26 Sutras deployed
- 0.3 min, load: 18 scenarios running
- 2.1 min, load: load stopped and starters undeployed; waiting for open runs to end (at most 10 minutes)
- 2.6 min, check: PASS No engine stopped by itself: 0 unexpected stops
- 2.6 min, check: PASS No run left running: 0 runs still open after starters stopped
- 2.6 min, check: PASS No step ran twice: 0 steps of single-pass Sutras completed more than once
- 2.6 min, check: PASS Requests that failed: 3 of 4022 (0.075%), fault windows included
- 2.6 min, check: PASS PostgreSQL DB Ops stayed correct: 40 completed, 0 failed
- 2.6 min, check: PASS MySQL DB Ops stayed correct: 40 completed, 0 failed
- 2.6 min, check: PASS SQLite DB Ops stayed correct: 40 completed, 0 failed
- 2.6 min, check: PASS Timer kept time: 11 runs of 12 expected (every 10 s)
- 2.6 min, check: PASS Every channel message reached its subscriber: 40 subscriber runs for 40 published
- 2.6 min, check: PASS Bus messages acknowledged: 100 accepted, 0 released, 0 rejected of 100 sent
- 2.6 min, check: PASS WebSocket client trigger ran for the server's messages: 46 runs for 46 messages pushed
- 2.6 min, check: PASS WebSocket broadcasts arrived: 30 received of 30 expected (6 broadcasts to the clients connected at the time)
- 2.6 min, check: PASS Engine 0 stays responsive: event loop delay: p99 per minute 36 ms typical, 71 ms in the worst 5% of minutes; longest single wait 210 ms
- 2.6 min, check: PASS Engine 1 stays responsive: event loop delay: p99 per minute 35 ms typical, 35 ms in the worst 5% of minutes; longest single wait 553 ms
- 2.6 min, check: PASS Engine 2 stays responsive: event loop delay: p99 per minute 35 ms typical, 35 ms in the worst 5% of minutes; longest single wait 560 ms
- 2.6 min, check: PASS REST orders stays as fast: p95 228 ms in the first period, 221 ms in the last
- 2.6 min, check: PASS REST in memory stays as fast: p95 19 ms in the first period, 13 ms in the last
- 2.6 min, check: PASS REST signed and validated stays as fast: p95 665 ms in the first period, 629 ms in the last
- 2.6 min, check: PASS SOAP UsernameToken stays as fast: p95 444 ms in the first period, 624 ms in the last
- 2.6 min, check: PASS WebSocket echo stays as fast: p95 222 ms in the first period, 219 ms in the last

## Starters covered

Run here: Manual start (API), Timer, REST service, SOAP service, WebSocket service, WebSocket client, Folder (file) trigger on a shared location, Remote file trigger (SFTP and FTP), Message bus subscriber (AMQP 1.0 stand-in), Channel trigger, Error handler, MCP tool, AI agent channel (chat); Google Drive upload and fetch when its account is set up. Every file is streamed.

Not run here (they need outside accounts or servers): Email (IMAP), Kafka and RabbitMQ subscribers, the Google Drive trigger, Microsoft files, Twitch, Discord, Telegram, Azure Data Factory.
