# SutraFlow 2.1.1 soak test

2026-10-26T16:51:44.685Z to 2026-10-26T16:58:10.335Z (0.1 hours), 3 processes (a studio and 2 engines) on PostgreSQL, AMD Ryzen 7 7435HS, 16 threads, 24 GB, win32, Node v24.21.0, AI: phi4-mini on Ollama.

Run **amr-2.1.1-20261026-2221-b9b2** (scenarios: core, amaron, brokers, kafka, mongo, remote, ai). Every row and message of this run carries this id; the run is recorded in amaron.soak_runs.

Amaron: 211 orders (1054 units), 21 care tickets, 1 order events through Kafka, 0 reviews in MongoDB, 1 second opinions from the model.

**36 of 38 checks passed.**

| Check | Result | Detail |
|---|---|---|
| No engine stopped by itself | pass | 0 unexpected stops |
| No run left running | pass | 0 runs still open after starters stopped |
| No step ran twice | pass | 0 steps of single-pass Sutras completed more than once |
| Requests that failed | pass | 28 of 8280 outside the planned faults (0.338%); 28 with the fault windows included |
| PostgreSQL DB Ops stayed correct | pass | 63 completed, 0 failed (0 outside the planned faults) |
| MySQL DB Ops stayed correct | pass | 63 completed, 0 failed (0 outside the planned faults) |
| SQLite DB Ops stayed correct | pass | 63 completed, 0 failed (0 outside the planned faults) |
| RabbitMQ delivered every message | pass | 625 published (0 big), 625 consumed, 0 failed; subscriber runs {"done":625} |
| ActiveMQ delivered every message | pass | 625 published (0 big), 625 consumed, 0 failed; subscriber runs {"done":625} |
| Kafka delivered every message | pass | 1 published (0 big), 1 consumed, 0 failed; subscriber runs {"done":1} |
| Remote MySQL DB Ops stayed correct | pass | 2 completed, 0 failed, 0 outside the planned faults (one every 2 minutes, over the internet) |
| Remote PostgreSQL DB Ops stayed correct | pass | 2 completed, 0 failed, 0 outside the planned faults (one every 2 minutes, over the internet) |
| MongoDB Atlas stayed correct | pass | 5 lifecycles completed, 0 failed, 0 outside the planned faults (one a minute) |
| MongoDB Atlas left nothing behind | pass | 0 documents left in the soak collection |
| Timer kept time | pass | 33 runs of 36 expected (every 10 s) |
| Every channel message reached its subscriber | pass | 63 subscriber runs for 63 published |
| Bus messages acknowledged | pass | 135 accepted, 0 released, 0 rejected of 135 sent (0 handed out again after a link closed or a release); subscriber runs {"done":135} |
| WebSocket client trigger ran for the server's messages | pass | 55 runs for 55 messages pushed |
| WebSocket broadcasts arrived | pass | 50 received of 50 expected (10 broadcasts to the clients connected at the time) |
| Amaron: every order placed is saved with this run | pass | 211 orders of run amr-2.1.1-20261026-2221-b9b2 (211 placed through the API, 0 failed); ₹81,04,456 in total |
| Amaron: lines and stock agree | pass | 536 lines, 1054 units ordered; stock reserved grew by 1054 |
| Amaron: the warehouse packed every order (RabbitMQ) | **fail** | 0 shipments and 0 orders packed for 211 orders |
| Amaron: every care ticket saved and decided (ActiveMQ) | pass | 21 tickets of 21 raised, 21 decisions, 0 not as expected |
| Amaron: tickets are in the pgvector knowledge | pass | 21 passages added for 21 tickets (21 in all runs) |
| Amaron: the model gave its second opinions | pass | 1 decisions by phi4-mini for 1 asked |
| Amaron: order events came back through Kafka | pass | 1 events recorded for 1 published to amaron-order-events |
| Amaron: reviews are in MongoDB with this run | **fail** | 5 reviews of run amr-2.1.1-20261026-2221-b9b2 for 0 written |
| Engine 0 stays responsive | pass | event loop delay: p99 per minute 35 ms typical, 45 ms in the worst 5% of minutes; longest single wait 713 ms |
| Engine 1 stays responsive | pass | event loop delay: p99 per minute 35 ms typical, 35 ms in the worst 5% of minutes; longest single wait 387 ms |
| Engine 2 stays responsive | pass | event loop delay: p99 per minute 35 ms typical, 37 ms in the worst 5% of minutes; longest single wait 693 ms |
| REST orders stays as fast | pass | p95 220 ms in the first period, 220 ms in the last |
| REST in memory stays as fast | pass | p95 36 ms in the first period, 27 ms in the last |
| REST signed and validated stays as fast | pass | p95 234 ms in the first period, 239 ms in the last |
| SOAP UsernameToken stays as fast | pass | p95 235 ms in the first period, 236 ms in the last |
| WebSocket echo stays as fast | pass | p95 273 ms in the first period, 217 ms in the last |
| RabbitMQ publish stays as fast | pass | p95 580 ms in the first period, 546 ms in the last |
| ActiveMQ publish stays as fast | pass | p95 583 ms in the first period, 554 ms in the last |
| Amaron orders stays as fast | pass | p95 320 ms in the first period, 299 ms in the last |

## Scenarios

| Scenario | Done | Failed | p50 / p95 / p99 ms (last period) | Most frequent error |
|---|---|---|---|---|
| REST orders | 3083 | 0 | 81 / 220 / 261 |  |
| REST in memory | 1561 | 0 | 13 / 27 / 39 |  |
| REST signed and validated | 316 | 0 | 79 / 207 / 253 |  |
| SOAP UsernameToken | 316 | 0 | 79 / 234 / 305 |  |
| SOAP X.509 signed and encrypted | 79 | 0 | 161 / 456 / 456 |  |
| WebSocket echo | 790 | 0 | 102 / 217 / 231 |  |
| WebSocket broadcast | 10 | 0 | 1156 / 1156 / 1156 |  |
| PostgreSQL DB Ops | 63 | 0 | 552 / 697 / 697 |  |
| MySQL DB Ops | 63 | 0 | 537 / 709 / 709 |  |
| SQLite DB Ops | 63 | 0 | 550 / 990 / 990 |  |
| RabbitMQ publish | 625 | 0 | 521 / 546 / 1362 |  |
| ActiveMQ publish | 625 | 0 | 525 / 554 / 1281 |  |
| Kafka publish (gentle) | 1 | 0 | - |  |
| Remote MySQL DB Ops (gentle) | 2 | 0 | - |  |
| Remote PostgreSQL DB Ops (gentle) | 2 | 0 | - |  |
| MongoDB Atlas (gentle) | 5 | 0 | 3759 / 3759 / 3759 |  |
| Channel publish | 63 | 0 | 551 / 995 / 995 |  |
| Error handler | 63 | 0 | 566 / 1065 / 1065 |  |
| Called Sutra and approval | 10 | 0 | 10882 / 10882 / 10882 |  |
| MCP tool | 31 | 0 | 131 / 512 / 512 |  |
| Bus message | 135 | 23 | 0 / 1 / 1 | the subscriber is not connected (23) |
| RAG search | 5 | 0 | 1721 / 1721 / 1721 |  |
| RAG ask (Ollama) | 1 | 0 | 1731 / 1731 / 1731 |  |
| AI agent chat (Ollama) | 1 | 0 | - |  |
| Amaron orders | 211 | 0 | 186 / 288 / 1364 |  |
| Amaron order status | 105 | 0 | 107 / 247 / 247 |  |
| Amaron care tickets | 21 | 0 | 143 / 817 / 817 |  |
| Amaron care second opinion (Ollama) | 1 | 0 | 2747 / 2747 / 2747 |  |
| Amaron order events to Kafka (gentle) | 1 | 0 | - |  |
| Amaron reviews (gentle) | 0 | 5 | - | run done: {"documents":[{"_id":"amr-2.1.1-20261026-2221-b9b2","reviews":{"$numberInt":"1"},"rating":{"$numberInt":"5"}}],"count":1} (1) |

## Faults on purpose

- none

## Big files

| Kind | File | Size | Result |
|---|---|---|---|

## Resources

| Engine | Highest memory | Last memory | Restarts |
|---|---|---|---|
| studio | 401 MB | 401 MB | 0 |
| engine 1 | 303 MB | 303 MB | 0 |
| engine 2 | 285 MB | 283 MB | 0 |

Database: 106 MB at the end; runs {"done":9655,"failed":4132}.

## Events

- 0 min, run: amr-2.1.1-20261026-2221-b9b2: scenarios core, amaron, brokers, kafka, mongo, remote, ai
- 0 min, connections: remote PostgreSQL pooled.db.prisma.io:5432
- 0 min, connections: remote MySQL srv1880.hstgr.io:3306/<db> password yes
- 0 min, connections: Kafka SASL kafkaxxx-a1-kafka-39c8.a.aivencloud.com:13367 (password yes, CA yes); client certificate kafkaxxx-a1-kafka-39c8.a.aivencloud.com:13356 (files yes)
- 0 min, connections: MongoDB user yes, password yes, cluster missing (add "Cluster: <name>.mongodb.net" under Mongo DB)
- 0 min, connections: RabbitMQ 127.0.0.1:5672 (default local)
- 0 min, connections: ActiveMQ 127.0.0.1:5673 (default local)
- 0 min, setup: RabbitMQ is starting from C:\rabbitmq_server-4.4.0
- 0.2 min, setup: RabbitMQ is running on 127.0.0.1:5672
- 0.2 min, setup: ActiveMQ is starting from C:\apache-activemq-6.3.2
- 0.3 min, setup: ActiveMQ is running on 127.0.0.1:5673
- 0.4 min, start: SutraFlow 2.1.1, 3 processes, 6 minutes, database sutra_soak_1793033504799, 16 threads, 24 GB
- 0.6 min, setup: 44 Sutras deployed
- 0.7 min, load: 30 scenarios running
- 6.1 min, load: load stopped and starters undeployed; waiting for open runs to end (at most 10 minutes)
- 6.4 min, check: PASS No engine stopped by itself: 0 unexpected stops
- 6.4 min, check: PASS No run left running: 0 runs still open after starters stopped
- 6.4 min, check: PASS No step ran twice: 0 steps of single-pass Sutras completed more than once
- 6.4 min, check: PASS Requests that failed: 28 of 8280 outside the planned faults (0.338%); 28 with the fault windows included
- 6.4 min, check: PASS PostgreSQL DB Ops stayed correct: 63 completed, 0 failed (0 outside the planned faults)
- 6.4 min, check: PASS MySQL DB Ops stayed correct: 63 completed, 0 failed (0 outside the planned faults)
- 6.4 min, check: PASS SQLite DB Ops stayed correct: 63 completed, 0 failed (0 outside the planned faults)
- 6.4 min, check: PASS RabbitMQ delivered every message: 625 published (0 big), 625 consumed, 0 failed; subscriber runs {"done":625}
- 6.4 min, check: PASS ActiveMQ delivered every message: 625 published (0 big), 625 consumed, 0 failed; subscriber runs {"done":625}
- 6.4 min, check: PASS Kafka delivered every message: 1 published (0 big), 1 consumed, 0 failed; subscriber runs {"done":1}
- 6.4 min, check: PASS Remote MySQL DB Ops stayed correct: 2 completed, 0 failed, 0 outside the planned faults (one every 2 minutes, over the internet)
- 6.4 min, check: PASS Remote PostgreSQL DB Ops stayed correct: 2 completed, 0 failed, 0 outside the planned faults (one every 2 minutes, over the internet)
- 6.4 min, check: PASS MongoDB Atlas stayed correct: 5 lifecycles completed, 0 failed, 0 outside the planned faults (one a minute)
- 6.4 min, check: PASS MongoDB Atlas left nothing behind: 0 documents left in the soak collection
- 6.4 min, check: PASS Timer kept time: 33 runs of 36 expected (every 10 s)
- 6.4 min, check: PASS Every channel message reached its subscriber: 63 subscriber runs for 63 published
- 6.4 min, check: PASS Bus messages acknowledged: 135 accepted, 0 released, 0 rejected of 135 sent (0 handed out again after a link closed or a release); subscriber runs {"done":135}
- 6.4 min, check: PASS WebSocket client trigger ran for the server's messages: 55 runs for 55 messages pushed
- 6.4 min, check: PASS WebSocket broadcasts arrived: 50 received of 50 expected (10 broadcasts to the clients connected at the time)
- 6.4 min, check: PASS Amaron: every order placed is saved with this run: 211 orders of run amr-2.1.1-20261026-2221-b9b2 (211 placed through the API, 0 failed); ₹81,04,456 in total
- 6.4 min, check: PASS Amaron: lines and stock agree: 536 lines, 1054 units ordered; stock reserved grew by 1054
- 6.4 min, check: FAIL Amaron: the warehouse packed every order (RabbitMQ): 0 shipments and 0 orders packed for 211 orders
- 6.4 min, check: PASS Amaron: every care ticket saved and decided (ActiveMQ): 21 tickets of 21 raised, 21 decisions, 0 not as expected
- 6.4 min, check: PASS Amaron: tickets are in the pgvector knowledge: 21 passages added for 21 tickets (21 in all runs)
- 6.4 min, check: PASS Amaron: the model gave its second opinions: 1 decisions by phi4-mini for 1 asked
- 6.4 min, check: PASS Amaron: order events came back through Kafka: 1 events recorded for 1 published to amaron-order-events
- 6.4 min, check: FAIL Amaron: reviews are in MongoDB with this run: 5 reviews of run amr-2.1.1-20261026-2221-b9b2 for 0 written
- 6.4 min, check: PASS Engine 0 stays responsive: event loop delay: p99 per minute 35 ms typical, 45 ms in the worst 5% of minutes; longest single wait 713 ms
- 6.4 min, check: PASS Engine 1 stays responsive: event loop delay: p99 per minute 35 ms typical, 35 ms in the worst 5% of minutes; longest single wait 387 ms
- 6.4 min, check: PASS Engine 2 stays responsive: event loop delay: p99 per minute 35 ms typical, 37 ms in the worst 5% of minutes; longest single wait 693 ms
- 6.4 min, check: PASS REST orders stays as fast: p95 220 ms in the first period, 220 ms in the last
- 6.4 min, check: PASS REST in memory stays as fast: p95 36 ms in the first period, 27 ms in the last
- 6.4 min, check: PASS REST signed and validated stays as fast: p95 234 ms in the first period, 239 ms in the last
- 6.4 min, check: PASS SOAP UsernameToken stays as fast: p95 235 ms in the first period, 236 ms in the last
- 6.4 min, check: PASS WebSocket echo stays as fast: p95 273 ms in the first period, 217 ms in the last
- 6.4 min, check: PASS RabbitMQ publish stays as fast: p95 580 ms in the first period, 546 ms in the last
- 6.4 min, check: PASS ActiveMQ publish stays as fast: p95 583 ms in the first period, 554 ms in the last
- 6.4 min, check: PASS Amaron orders stays as fast: p95 320 ms in the first period, 299 ms in the last

## Starters covered

Run here: Manual start (API), Timer, REST service, SOAP service, WebSocket service, WebSocket client, Folder (file) trigger on a shared location, Remote file trigger (SFTP and FTP), Message bus subscriber (AMQP 1.0 stand-in), Channel trigger, Error handler, MCP tool, AI agent channel (chat); Google Drive upload and fetch when its account is set up. Every file is streamed.

Not run here (they need outside accounts or servers): Email (IMAP), Kafka and RabbitMQ subscribers, the Google Drive trigger, Microsoft files, Twitch, Discord, Telegram, Azure Data Factory.
