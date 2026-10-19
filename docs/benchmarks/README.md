# Benchmarks

Load test results of SutraFlow 1.6.0, written by `tools/loadtest.mjs` and `tools/bigfiletest.mjs`. The user guide chapter *Sizing and performance* turns them into tables (`tools/guide/benchmarks.ts`), so the guide always shows these files.

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
