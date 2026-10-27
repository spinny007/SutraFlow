# SutraFlow 2.1.1 soak test

2026-10-26T17:01:03.824Z to 2026-10-26T17:05:28.932Z (0.1 hours), 2 processes (a studio and 1 engines) on PostgreSQL, AMD Ryzen 7 7435HS, 16 threads, 24 GB, win32, Node v24.21.0.

Run **amr-2.1.1-20261026-2231-6a94** (scenarios: amaron, brokers, mongo). Every row and message of this run carries this id; the run is recorded in amaron.soak_runs.

Amaron: 134 orders (671 units), 13 care tickets, 0 order events through Kafka, 3 reviews in MongoDB, 0 second opinions from the model.

**22 of 23 checks passed.**

| Check | Result | Detail |
|---|---|---|
| No engine stopped by itself | pass | 0 unexpected stops |
| No run left running | pass | 0 runs still open after starters stopped |
| No step ran twice | pass | 0 steps of single-pass Sutras completed more than once |
| Requests that failed | pass | 0 of 1016 outside the planned faults (0.000%); 0 with the fault windows included |
| RabbitMQ delivered every message | pass | 398 published (0 big), 398 consumed, 0 failed; subscriber runs {"done":398} |
| ActiveMQ delivered every message | pass | 398 published (0 big), 398 consumed, 0 failed; subscriber runs {"done":398} |
| MongoDB Atlas stayed correct | pass | 3 lifecycles completed, 0 failed, 0 outside the planned faults (one a minute) |
| MongoDB Atlas left nothing behind | pass | 0 documents left in the soak collection |
| Timer kept time | **fail** | 21 runs of 24 expected (every 10 s) |
| Every channel message reached its subscriber | pass | 0 subscriber runs for 0 published |
| Bus messages acknowledged | pass | 0 accepted, 0 released, 0 rejected of 0 sent (0 handed out again after a link closed or a release); subscriber runs {} |
| WebSocket client trigger ran for the server's messages | pass | 37 runs for 37 messages pushed |
| WebSocket broadcasts arrived | pass | 0 received of 0 expected (0 broadcasts to the clients connected at the time) |
| Amaron: every order placed is saved with this run | pass | 134 orders of run amr-2.1.1-20261026-2231-6a94 (134 placed through the API, 0 failed); ₹50,65,189 in total |
| Amaron: lines and stock agree | pass | 341 lines, 671 units ordered; stock reserved grew by 671 |
| Amaron: the warehouse packed every order (RabbitMQ) | pass | 134 shipments and 134 orders packed for 134 orders |
| Amaron: every care ticket saved and decided (ActiveMQ) | pass | 13 tickets of 13 raised, 13 decisions, 0 not as expected |
| Amaron: tickets are in the pgvector knowledge | pass | 13 passages added for 13 tickets (34 in all runs) |
| Amaron: reviews are in MongoDB with this run | pass | 3 reviews of run amr-2.1.1-20261026-2231-6a94 for 3 written |
| Engine 0 stays responsive | pass | event loop delay: p99 per minute 34 ms typical, 47 ms in the worst 5% of minutes; longest single wait 408 ms |
| Engine 1 stays responsive | pass | event loop delay: p99 per minute 33 ms typical, 34 ms in the worst 5% of minutes; longest single wait 117 ms |
| RabbitMQ publish stays as fast | pass | p95 539 ms in the first period, 534 ms in the last |
| ActiveMQ publish stays as fast | pass | p95 540 ms in the first period, 536 ms in the last |

## Scenarios

| Scenario | Done | Failed | p50 / p95 / p99 ms (last period) | Most frequent error |
|---|---|---|---|---|
| RabbitMQ publish | 398 | 0 | 68 / 539 / 945 |  |
| ActiveMQ publish | 398 | 0 | 520 / 538 / 1088 |  |
| MongoDB Atlas (gentle) | 3 | 0 | 2862 / 2862 / 2862 |  |
| Amaron orders | 134 | 0 | 154 / 312 / 312 |  |
| Amaron order status | 67 | 0 | 39 / 173 / 173 |  |
| Amaron care tickets | 13 | 0 | 223 / 223 / 223 |  |
| Amaron reviews (gentle) | 3 | 0 | 1835 / 1835 / 1835 |  |

## Faults on purpose

- none

## Big files

| Kind | File | Size | Result |
|---|---|---|---|

## Resources

| Engine | Highest memory | Last memory | Restarts |
|---|---|---|---|
| studio | 345 MB | 345 MB | 0 |
| engine 1 | 232 MB | 232 MB | 0 |

Database: 23 MB at the end; runs {"done":2017}.

## Events

- 0 min, run: amr-2.1.1-20261026-2231-6a94: scenarios amaron, brokers, mongo
- 0 min, connections: remote PostgreSQL pooled.db.prisma.io:5432
- 0 min, connections: remote MySQL srv1880.hstgr.io:3306/<db> password yes
- 0 min, connections: Kafka SASL ? (password no, CA no); client certificate kafkaxxx-a1-kafka-39c8.a.aivencloud.com:13358 (files no)
- 0 min, connections: MongoDB user yes, password yes, cluster missing (add "Cluster: <name>.mongodb.net" under Mongo DB)
- 0 min, connections: RabbitMQ 127.0.0.1:5672 (default local)
- 0 min, connections: ActiveMQ 127.0.0.1:5673 (default local)
- 0 min, setup: RabbitMQ is starting from C:\rabbitmq_server-4.4.0
- 0.2 min, setup: RabbitMQ is running on 127.0.0.1:5672
- 0.2 min, setup: ActiveMQ is starting from C:\apache-activemq-6.3.2
- 0.3 min, setup: ActiveMQ is running on 127.0.0.1:5673
- 0.4 min, start: SutraFlow 2.1.1, 2 processes, 4 minutes, database sutra_soak_1793034063921, 16 threads, 24 GB
- 0.5 min, setup: 34 Sutras deployed
- 0.6 min, load: 7 scenarios running
- 4.1 min, load: load stopped and starters undeployed; waiting for open runs to end (at most 10 minutes)
- 4.4 min, check: PASS No engine stopped by itself: 0 unexpected stops
- 4.4 min, check: PASS No run left running: 0 runs still open after starters stopped
- 4.4 min, check: PASS No step ran twice: 0 steps of single-pass Sutras completed more than once
- 4.4 min, check: PASS Requests that failed: 0 of 1016 outside the planned faults (0.000%); 0 with the fault windows included
- 4.4 min, check: PASS RabbitMQ delivered every message: 398 published (0 big), 398 consumed, 0 failed; subscriber runs {"done":398}
- 4.4 min, check: PASS ActiveMQ delivered every message: 398 published (0 big), 398 consumed, 0 failed; subscriber runs {"done":398}
- 4.4 min, check: PASS MongoDB Atlas stayed correct: 3 lifecycles completed, 0 failed, 0 outside the planned faults (one a minute)
- 4.4 min, check: PASS MongoDB Atlas left nothing behind: 0 documents left in the soak collection
- 4.4 min, check: FAIL Timer kept time: 21 runs of 24 expected (every 10 s)
- 4.4 min, check: PASS Every channel message reached its subscriber: 0 subscriber runs for 0 published
- 4.4 min, check: PASS Bus messages acknowledged: 0 accepted, 0 released, 0 rejected of 0 sent (0 handed out again after a link closed or a release); subscriber runs {}
- 4.4 min, check: PASS WebSocket client trigger ran for the server's messages: 37 runs for 37 messages pushed
- 4.4 min, check: PASS WebSocket broadcasts arrived: 0 received of 0 expected (0 broadcasts to the clients connected at the time)
- 4.4 min, check: PASS Amaron: every order placed is saved with this run: 134 orders of run amr-2.1.1-20261026-2231-6a94 (134 placed through the API, 0 failed); ₹50,65,189 in total
- 4.4 min, check: PASS Amaron: lines and stock agree: 341 lines, 671 units ordered; stock reserved grew by 671
- 4.4 min, check: PASS Amaron: the warehouse packed every order (RabbitMQ): 134 shipments and 134 orders packed for 134 orders
- 4.4 min, check: PASS Amaron: every care ticket saved and decided (ActiveMQ): 13 tickets of 13 raised, 13 decisions, 0 not as expected
- 4.4 min, check: PASS Amaron: tickets are in the pgvector knowledge: 13 passages added for 13 tickets (34 in all runs)
- 4.4 min, check: PASS Amaron: reviews are in MongoDB with this run: 3 reviews of run amr-2.1.1-20261026-2231-6a94 for 3 written
- 4.4 min, check: PASS Engine 0 stays responsive: event loop delay: p99 per minute 34 ms typical, 47 ms in the worst 5% of minutes; longest single wait 408 ms
- 4.4 min, check: PASS Engine 1 stays responsive: event loop delay: p99 per minute 33 ms typical, 34 ms in the worst 5% of minutes; longest single wait 117 ms
- 4.4 min, check: PASS RabbitMQ publish stays as fast: p95 539 ms in the first period, 534 ms in the last
- 4.4 min, check: PASS ActiveMQ publish stays as fast: p95 540 ms in the first period, 536 ms in the last

## Starters covered

Run here: Manual start (API), Timer, REST service, SOAP service, WebSocket service, WebSocket client, Folder (file) trigger on a shared location, Remote file trigger (SFTP and FTP), Message bus subscriber (AMQP 1.0 stand-in), Channel trigger, Error handler, MCP tool, AI agent channel (chat); Google Drive upload and fetch when its account is set up. Every file is streamed.

Not run here (they need outside accounts or servers): Email (IMAP), Kafka and RabbitMQ subscribers, the Google Drive trigger, Microsoft files, Twitch, Discord, Telegram, Azure Data Factory.
