# Benchmarks

Load test results measured during the 1.6 to 1.7.6 load work, written by `tools/loadtest.mjs` and `tools/bigfiletest.mjs`. The user guide chapter *Sizing and performance* turns them into tables (`tools/guide/benchmarks.ts`), so the guide always shows these files.

Machine: AMD Ryzen 7 7435HS (8 cores, 16 threads), 23.7 GB memory, NVMe, Windows 11, Node.js 24.21. PostgreSQL 18.2 ran on the same machine as the engines.

| File | What it measures |
|---|---|
| `pg-before.json` | 1.6.0 as first released (with the PostgreSQL bridge fix only): 1, 2 and 4 engines, outputs of 0.1 and 64 KB per step |
| `pg-after.json` | This release, the same scenarios, durable and in memory |
| `pg-spread.json` | REST calls spread over every engine's gateway, as behind a load balancer |
| `pg-workers32.json` | 32 steps at once on one engine |
| `pg-1core.json` | One engine held to one core and a 512 MB heap, on PostgreSQL |
| `sqlite.json`, `sqlite-1core.json` | The same on SQLite, on all cores and on one core with 512 MB |
| `pg-kill.json` | Two engines, one killed without a drain a third of the way in |
| `soak.json` | 30 minutes on two engines: timers, waits, retries, failures, the benchmark Sutra and a redeploy |
| `soak-memory.json` | 15 minutes of the same, with the memory of each engine every minute |
| `bigfile.json` | A 1 GB CSV file streamed in batches by one engine with a 384 MB heap |
| `async-before-local.json`, `async-after-local.json` | 1.7.5 and 1.7.6: REST calls spread over 1, 2 and 4 engines, local PostgreSQL |
| `async-before-remote.json`, `async-after-remote.json` | The same with the engines reaching PostgreSQL through a delaying proxy (about 28 ms round trip, measured; a database in another region) |
| `async-before-sqlite.json`, `async-after-sqlite.json` | 1.7.5 and 1.7.6 on SQLite, one engine |
| `async-after-64kb.json` | 1.7.6, one engine, 64 KB outputs per step |

The benchmark Sutra is a trigger and ten Transform steps; each run is 11 steps. Steps per second count finished steps.

Run them again:

```sh
node tools/loadtest.mjs --pg postgres://postgres@127.0.0.1:5432/postgres --engines 1,2,4 --payload 0.1,64 --execution durable,memory --out docs/benchmarks/pg-after.json
node tools/loadtest.mjs --pg postgres://postgres@127.0.0.1:5432/postgres --engines 1,2,4 --spread --runs 600 --execution durable,memory --out docs/benchmarks/pg-spread.json
node tools/loadtest.mjs --sqlite --cpus 1 --mem 512 --workers 4 --execution durable,memory --out docs/benchmarks/sqlite-1core.json
node tools/loadtest.mjs --pg postgres://postgres@127.0.0.1:5432/postgres --engines 2 --spread --kill --runs 600 --payload 1 --out docs/benchmarks/pg-kill.json
node tools/bigfiletest.mjs --mb 1000 --mem 384 --out docs/benchmarks/bigfile.json
npm run guide
```

## The load assessment and what was done

An external review rated SutraFlow at code 8, architecture 8, production readiness 7 and high-load proof 5.5. What it raised, and the answer in 1.7.5:

| Observation | Done |
|---|---|
| No proof under load: no load test, no numbers | `tools/loadtest.mjs` (throughput, queue wait, step and run percentiles, database lock waits and transactions, CPU, memory; 1 to 4 engines; small and large outputs; one core and a small heap; SQLite and PostgreSQL) and `tools/bigfiletest.mjs`; results in this folder and in the guide |
| One database lock for every write in the cluster: engines do not scale | A lock per run (or per Sutra queue) and `skip locked` claims: four engines behind a load balancer 352 steps/s against 116 for one (90 before for four) |
| Many database round trips per step | 14 transactions per step down to 7: settings and connection details cached, one statement for state, step count and status, no recount while a run goes on, covering indexes |
| Everything goes through the database, even short request-reply work | Sutras can run in memory (Execution tuning): about 4 times the throughput, saved once when the run ends |
| Large data and files held in memory | Read file and List stream CSV and line files in batches with back pressure: 1 GB on a 384 MB heap, peak 270 MB |
| Failure under load not shown | An engine killed under load: every run finished; the PostgreSQL bridge, startup and shutdown faults found under load were fixed with tests |
| Long running stability not shown | Soak tests (`--soak`): 17,619 runs in 30 minutes on two engines with none left open, the timer exactly once per 5 seconds, and memory level after warm-up (245 MB, no leak) |
| Sizing advice missing | Machine profiles from 1 vCPU / 1 GB, applied by default and in the Admin Console (This machine), with the guide chapter Sizing and performance |
| Repeated lookups of reference data hit the database | Memory tables: small reference data in each engine's memory, with a failsafe copy, hot reload and limits |

## 1.7.6: asynchronous PostgreSQL storage

The engine talks to PostgreSQL through a pool of connections instead of one synchronous connection, with explicit transactions, fencing of claimed steps, several steps claimed per statement and three round trips per step. REST calls spread over the engines; no run failed and no step ran twice in any 1.7.6 scenario.

| Scenario | 1.7.5 | 1.7.6 |
|---|---|---|
| 1 engine, local PostgreSQL | 153 steps/s | 719 |
| 2 engines | 284 | 1,268 |
| 4 engines | 457 | 1,602 |
| 1 engine, database 28 ms away | 3.4 | 102 |
| 4 engines, database 28 ms away | 17.7, 125 steps run twice | 622, none |
| 1 engine, SQLite | 390 to 412 | 419 to 427 |
| 1 engine, 64 KB outputs | 47 | 60 |

With the database far away, 1.7.5's synchronous connection held each engine's event loop so long that heartbeats were missed: the leader took engines for dead and handed their running steps to others, which ran them again. 1.7.6 keeps the event loop free, and fencing would refuse such a stale completion in any case.

## The second assessment

A second review (code 8.5, architecture 8.5, production readiness 8, moderate load 8.5, proven high load 7) asked for the following; 1.7.6 answers:

| Point | Done |
|---|---|
| Explicit transaction objects rather than implicit context | `transaction(key, async tx => ...)` hands the body its own query object; queries past it are refused |
| Never mix synchronous and asynchronous calls in one transaction | A synchronous write or transaction while an asynchronous one is open throws; tests cover it on every backend |
| Ownership fencing | A claim number per step; every change to a claimed step requires owner, claim and status to still match; a run ends by one conditional update |
| Bounded concurrency and pool metrics | The pool size follows Steps at once (SUTRA_PG_POOL); /metrics shows connections, waits, acquire, transaction and query times, retries |
| Precise expectations | Measured: several times the throughput; single-run latency falls with the round trips per step (three per step, several steps per claim) |
| Backend-specific completion | PostgreSQL: begin, lock and the run in one round trip, the last statement with the commit, steps claimed with their run; SQLite: the same statements locally, with a statement cache |
| A remote database benchmark | Through a measured 28 ms proxy: 102 steps/s on one engine, 622 on four |
| The load balancer requirement | Stated in the guide (production chapter) with the measured difference |
| The XML-signature deprecation warning | Fixed: xml-crypto places the signature itself; no deprecated call |
| The stale test badge | Now 303 tests, and a test keeps it equal to the files |
| Start errors under load | They were resets of kept connections (fixed in 1.7.5 with 65 s keep-alive); the load tool reports any it retries |

## What could still be faster

- Each step rewrites the run state with the outputs of earlier steps. Runs that pass large data along pay for it; keeping outputs only in the step rows would remove that cost.
- Engines poll the work queue; PostgreSQL LISTEN/NOTIFY could wake them at once and save idle reads.
- A soak of 8 to 24 hours on a cluster with PostgreSQL on its own machine is still to be run.
