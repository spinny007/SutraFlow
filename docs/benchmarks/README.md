# Benchmarks

Load test results measured during the 1.6 to 1.7.5 load work, written by `tools/loadtest.mjs` and `tools/bigfiletest.mjs`. The user guide chapter *Sizing and performance* turns them into tables (`tools/guide/benchmarks.ts`), so the guide always shows these files.

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

## What could still be faster

- The PostgreSQL connection is synchronous (a worker thread answers each statement while the engine waits). On one server SQLite is about four times faster for this reason; an asynchronous storage layer would let one engine overlap its database work. It is the largest remaining step, and a large change.
- Each step rewrites the run state with the outputs of earlier steps. Runs that pass large data along pay for it; keeping outputs only in the step rows would remove that cost.
- Engines poll the work queue; PostgreSQL LISTEN/NOTIFY could wake them at once and save idle reads.
