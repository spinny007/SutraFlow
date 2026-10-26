# 2.1.0 six-hour soak: findings and improvement plan

25–26 October 2026, Windows, Node.js 24.21, SutraFlow 2.1.0 (source state before the SQLite fix below). The generated record is `report.md` / `report.html` beside this file; this page is the reading of it.

## What ran

Three engines on a local PostgreSQL engine database, 360 minutes of load at double rate (`--scale 2`), then a drain and 41 checks.

| Area | Systems | Pace |
| --- | --- | --- |
| Requests | REST (plain, in memory, HMAC-signed and validated), SOAP (UsernameToken, X.509 signed and encrypted), WebSocket echo and broadcast, MCP tool | several per second |
| Databases (DB Ops) | Local PostgreSQL, MySQL (Laragon), SQLite | every 2.5 s each |
| Brokers | Local RabbitMQ 4.4 (AMQP 0-9-1), ActiveMQ 6.3 (AMQP 1.0), stand-in AMQP broker | 2 messages a second each |
| Remote, kept gentle (free tier) | Hosted PostgreSQL (TLS verified), hosted MariaDB 11.8, MongoDB Atlas, hosted Kafka 4.3 (SASL SCRAM-SHA-256 over verified TLS) | every 1–3 minutes |
| Files | CSV of 10–60 MB to a watched folder, SFTP and FTP, streamed | every 5–10 minutes |
| AI | RAG ingest (10–50 MB documents into pgvector), search, ask, agent chat; Ollama phi4-mini | every 1–5 minutes |
| Faults | Engine 2 killed at 120 min; engine database cut for 20 s at 240 min | planned |

## Result

**38 of 41 checks passed.** One defect was found and fixed; three findings remain.

| Measure | Result |
| --- | --- |
| Runs finished | about 1.16 million |
| Requests | 1,018,735, of which 107 failed (0.011%), all inside the two fault windows |
| Engine stops not planned | 0; no run left open; no step ran twice |
| RabbitMQ / ActiveMQ / stand-in broker | 64,889 / 64,802 / 21,371 messages, every one consumed |
| DB Ops | about 8,600 runs each on PostgreSQL, MySQL, SQLite; remote MySQL and PostgreSQL 178 each; MongoDB Atlas 359 lifecycles, nothing left behind |
| Big files | 35 folder, 23 SFTP, 23 FTP CSVs, every row counted |
| RAG documents | 10 ingested (50 MB in 55–86 s); 457,034 passages stored |
| Event loop | p99 per minute 37–40 ms typical; worst 5% of minutes 48–64 ms |
| Latency, first vs last period (p95) | REST 240 → 270 ms, SOAP X.509 297 → 366 ms, DB Ops 625 → 854–1121 ms, brokers ~575 → ~595 ms; all within the check |

Through the faults: the engine kill cost 38 requests on the killed engine and no run; the database cut cost 69 requests that could not start and no run that had started.

## Defect found and fixed

**SQLite DB Ops: two transaction steps at the same time on one connection.** 2 of 8,604 SQLite runs failed with "cannot start a transaction within a transaction". A SQLite connection is one database handle and a transaction stays open while its step works through its statements; a second step's `BEGIN` landed inside it, and a plain statement of another step could have become part of a transaction still open. Fixed in `server/src/connectors/db.ts` (each SQLite connection runs one transaction or statement at a time); regression test in `test/connectors.test.ts` (fails on the old code, passes with the fix); row in the 2.1.0 Fixes table. Server type check passes. The 2.1.0 archives built before this fix must be rebuilt.

## Open findings

| # | Finding | Evidence | Severity |
| --- | --- | --- | --- |
| F1 | **Kafka: one message without a finished subscriber run.** | 118 published, 117 subscriber runs done, 0 failed; the consumer group committed all three partitions to their end offsets. | High if confirmed: a possible at-least-once gap. |
| F2 | **pgvector search slows as the knowledge base grows.** | p95 1.7 s in the first period, 26.6 s in the last; no vector index on the table (exact scan of 457,034 passages). | Medium: a sizing limit, not a correctness issue. |
| F3 | **Engine event loop blocked 23.6 s during the database cut.** | Engine 2 only, in the minute of the 20 s cut; engines 0 and 1 did not. | Medium: something waits synchronously when the database is away. |
| F4 | **Memory slope.** | Engine 2: 52 MB per hour over the second half (check failed; it restarted at 121 min, so warm-up is included). Engines 0 and 1: 36–40 MB per hour (passed); peak 1,078 MB. | Low until confirmed. |
| F5 | Kafka publish: one sign-in dropped by the hosted service. | `SASL SCRAM SHA256 authentication failed: Closed connection`, once in 6 hours; the publisher reconnected. | Low: covered by step retries in real Sutras. |

## Improvement plan

**Before the 2.1.0 release**

1. **Rebuild and re-verify 2.1.0** with the SQLite fix: full test suite on SQLite, PGlite and a real PostgreSQL; release archives; clean install and upgrade from 2.0.11. (The suite was run after the fix; its three failures were the README test badge and the generated file overviews, both refreshed since; the suite has to run again.)
2. **F1 Kafka: settle before release.** Run the 1-hour Kafka soak with the engine kill and the database cut, keep the soak database, and match each message key to its run. The soak check now prints every subscriber run status. If an offset can be committed without a finished run, fix the commit order in the Kafka listener (commit only after the run is recorded) and add a regression test with a kill between delivery and run creation.
3. **F3 event-loop stall: find the cause.** Reproduce the database cut with `--trace-sync-io` or CPU profiling on one engine; look for synchronous waits in the reconnect and heartbeat paths. Release-blocking only if it can stall live traffic beyond the outage itself.

**Next release (2.1.x)**

4. **F2 vector index.** New pgvector tables get an HNSW index (`vector_cosine_ops`); existing tables get an index build that an administrator starts in the Admin Console (it takes time and blocks writes on a large table). Add guide sizing: passages per GB, search time with and without the index. Soak check: search p95 stays within 2× of the first period.
5. **F4 memory.** Repeat 6 hours without the engine kill and take heap snapshots at 1, 3 and 6 hours on each engine; compare retained sizes. Keep the check but measure it from one hour after an engine's last start.
6. **F5 publisher resilience.** Document step retries for publish steps to hosted brokers; consider one automatic reconnect-and-resend for a closed connection at sign-in (safe, since the message was not sent).

**Soak tool and process**

7. Keep the soak database when any check fails (`--keep-on-fail`), so failed runs can be inspected after the report.
8. Record per-message keys for every broker scenario in the events file, so a missing delivery can be named.
9. Run the 24-hour remote-PostgreSQL release gate (Must have in the backlog) with these scenarios once items 1–3 are done.

## Status of the plan (26 October 2026)

| Item | Status |
| --- | --- |
| 1. Rebuild and re-verify | Full suite with real PostgreSQL and MySQL: 494 passed, 0 failed, 11 skipped (outside brokers). CI break found and fixed (generated file overviews on CRLF checkouts and the ignored code index). Archives still to rebuild. |
| 2. F1 Kafka gap | Cause found in a 10-minute soak with the soak database kept: a new consumer group had no committed offset on a partition, so when the partition moved to another engine its new owner started at "latest" and skipped messages. Fixed: the topic's end is recorded as the group's starting point when the Sutra starts listening. Being confirmed by the 10-minute soak with every service. |
| 3. F3 event-loop stall | Fixed: after a lost connection a statement tries briefly and fails at once (Admin Console, Database: tries, wait between, time per try); tests. Follow-ups found by the 10-minute soak and fixed: a timer that stopped an engine on that error, runs left open and steps left running when their closing writes failed (leader and engine sweeps); tests. |
| 4. F2 vector index | Done: HNSW index for new tables, Build search index (Admin Console, Knowledge search) for existing ones, iterative scan so shared tables keep full results; tests on a real PostgreSQL with pgvector. |
| 5. F4 memory | Leak found and fixed: engines kept the document of every run they had helped with. Test that the garbage collector frees finished runs. A heap-snapshot repeat run was not done (growth under parallel load accepted). |
| 6. F5 publish resend | Done: a Kafka connection dropped while signing in is opened again and the message sent once; test. |
| 7. Keep the soak database on failure | Done (`--keep-on-fail`). |
| 8. Per-message keys | Done: broker checks name each message without a finished run and what became of it. |
| 9. 24-hour remote-PostgreSQL gate | Not done (backlog, Must have). |
| Also found and fixed | SQLite DB Ops transactions overlapping on one connection; memory-table changes kept in memory when the database copy failed. |

## Changes made during the soak

- `tools/soak.mjs`: remote PostgreSQL and remote MySQL scenarios (gentle), real RabbitMQ / ActiveMQ / Kafka scenarios, `--keep-remote`, Kafka `topic=` reuse, gentle scenarios kept out of `--scale`, clean-up that reconnects and reports what it could not remove, a stand-in broker that hands unsettled messages out again (as real brokers do), subscriber run statuses in broker checks.
- `server/src/connectors/db.ts`, `test/connectors.test.ts`, `RELEASE-NOTES.md`: the SQLite fix.
- `docs/backlog.md`: F1–F4 and the 1-hour Kafka soak.
