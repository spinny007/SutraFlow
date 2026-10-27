# Soak runbook (2.1.1)

One soak tool for everything: `tools/soak.mjs`. Every run gets an id (`amr-<version>-<yyyymmdd-hhmm>-<4 hex>`). It is stamped on every row and message the run writes, and the run is recorded in `amaron.soak_runs`.

## Before a run

- Node 24 and `npm ci` done in the repo. Then run `npm run build`: the soak runs `dist/`.
- Laragon running:
  - PostgreSQL 18 on 127.0.0.1:5432, user `postgres`, no password, with pgvector.
  - MySQL on 3306, user `root`, no password.
- Ollama on 127.0.0.1:11434 with the `phi4-mini` model, for the `ai` scenario.
- Local RabbitMQ (`C:\rabbitmq_server-4.4.0`) and ActiveMQ (`C:\apache-activemq-6.3.2`). The soak starts them when they are not running and stops only the ones it started.
- Connection notes: `C:\Users\kunwa\OneDrive\Documents\Sutra-connections.txt`. They cover remote PostgreSQL, remote MySQL, Kafka and the MongoDB login.
  - The MongoDB cluster address comes from `--mongo-env C:\Users\kunwa\Downloads\atlas-credentials.env` until a `Cluster: <name>.mongodb.net` line is added under "Mongo DB" in the notes.
  - Only the cluster address is taken from the env file; the login always comes from the notes.

## Commands

A 10-minute check (everything except the regression suite):

```
node tools/soak.mjs --pg postgres://postgres@127.0.0.1:5432/postgres --mysql mysql://root@127.0.0.1:3306 --connections "C:\Users\kunwa\OneDrive\Documents\Sutra-connections.txt" --mongo-env "C:\Users\kunwa\Downloads\atlas-credentials.env" --scenarios core,files,ai,faults,amaron,brokers,kafka,mongo,remote --minutes 10 --out docs/benchmarks/soak-2.1.1-10min-all
```

The long run, with the regression suite at the end:

```
node tools/soak.mjs --pg postgres://postgres@127.0.0.1:5432/postgres --mysql mysql://root@127.0.0.1:3306 --connections "C:\Users\kunwa\OneDrive\Documents\Sutra-connections.txt" --mongo-env "C:\Users\kunwa\Downloads\atlas-credentials.env" --scenarios all --hours 8 --out docs/benchmarks/soak-2.1.1-8h
```

- `--scenarios` picks the parts: `core, files, ai, faults, amaron, brokers, kafka, mongo, remote, regression` (or `all`).
- `--regression test/a.test.ts,test/b.test.ts` limits the suite to the files listed.
- The 24-hour release gate needs the **engine database on a separate machine**, so `--pg` must point at that server. Its user must be allowed to `CREATE DATABASE`. A pooled or managed endpoint such as Prisma's usually is not allowed to.

## Rules

- Never print, log or commit anything from the notes or the env file. The soak prints only a masked summary of them.
- Do not drop the `amaron` database, the remote `sutra_soak_remote` database, the remote MySQL table `sutra_soak`, the Kafka topics `sutra-soak` and `amaron-order-events`, or the MongoDB `amaron.reviews` collection. They are kept on purpose, and every row in them carries its run id.
- Each run makes its own engine database (`sutra_soak_<time>`) and drops it at the end. If a run is killed, drop the leftover databases by hand.
- When a run is killed, also stop any brokers it started:
  - `C:\apache-activemq-6.3.2\bin\activemq.bat stop`
  - `C:\rabbitmq_server-4.4.0\sbin\rabbitmqctl.bat stop`
- Exit code 0 means every check passed. Results are in `<out>/report.md` and `report.html`, the suite's output in `regression.log`, and the stored result in `select * from amaron.soak_runs order by started_at desc`.
- Warnings that are expected:
  - `TimeoutNegativeWarning` from the Kafka client library.
  - A `url.parse()` deprecation from a library.
