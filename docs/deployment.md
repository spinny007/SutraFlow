# Deploying and running SutraFlow

This guide is for whoever releases Sutras and runs SutraFlow servers: packages, the `sutra` command-line tool, headless engines, Docker, clusters on PostgreSQL, and monitoring.

## Contents

1. [Releases are project packages](#1-releases-are-project-packages)
2. [The sutra command-line tool](#2-the-sutra-command-line-tool)
3. [Headless engines](#3-headless-engines)
4. [Docker](#4-docker)
5. [Clusters: several engines, PostgreSQL](#5-clusters-several-engines-postgresql)
6. [Monitoring: health, metrics, traces, logs](#6-monitoring-health-metrics-traces-logs)
7. [Runs: retention and running again](#7-runs-retention-and-running-again)
8. [Settings](#8-settings)

## 1. Releases are project packages

Build in the studio; release a **package**: one `.sutra` file holding the whole project.

| In the package | Not in the package |
|---|---|
| Every deployed Sutra at its deployed version (and, marked not deployed, the others) | Secret **values** (only their names) |
| Connections and API policies, matched by name | Run history |
| Shared schemas and WSDLs | Values that differ per environment |
| Project variables and logging | |

The same file goes from test to UAT to production. Each environment keeps its own **deployment config** (project variables, connection settings such as hosts and queue names, logging), and secrets in its own vault.

**Deploying a package**

- Everything is matched by name: the project (created if missing), schemas, connections and Sutras. References between them are remapped to the target's ids.
- A Sutra whose content changed gets a new version and is deployed; an unchanged one is left alone, so deploying the same package twice changes nothing.
- Sutras of the project that are not in the package are undeployed (kept, not deleted), unless you ask to keep them.
- Before anything changes, the package is checked: its checksum, activities this server knows, every secret it needs present here, and its API paths and MCP skill names not used by another project.
- Every deployment is recorded; **rollback** deploys the package before the current one, or any earlier one.

In the studio: **Project → Configuration → Releases (packages)**.

**Release zips for production**

A production team receives a release as one zip:

| File | Holds |
|---|---|
| `package.sutra` | The package, with its checksum |
| `deployment-config.json` | The deployment config to fill in for the target: every connection with its settings, every project variable, logging, and the vault secrets the server needs |
| `README.txt` | Sutras and their addresses, secrets, where it was built from (repository, ref, commit), deploy and rollback commands |

Development and system test servers deploy from the designer. A server with `SUTRA_ENVIRONMENT=production` refuses designer deploys: it gets Sutras only from packages, uploaded with `sutra deploy release.zip` or in the Admin Console under **Releases** (check, deploy, history, rollback).

## 2. The sutra command-line tool

```
sutra package  --project "Orders" --version 1.4.0 --note "Faster lookup" --out orders-1.4.0.sutra
sutra package  --project "Orders" --version 1.4.0 --zip                 # release zip: package + config + README
sutra package  --from-git <repository | folder> [--ref v1.4.0] --version 1.4.0 --out orders-1.4.0.zip
sutra check    orders-1.4.0.zip
sutra deploy   orders-1.4.0.zip [--config prod-config.json] [--keep-others]
sutra test     orders-1.4.0.sutra [--secret NAME=value] [--secrets-from-env]
sutra history  --project "Orders"
sutra rollback --project "Orders" [--to <deployment id>]
sutra secret   set ORDERS_DB_PW --from-env ORDERS_DB_PW
sutra status   --server https://engine-1:4800
```

- **Remote**: add `--server <url> --token <token>`, or set `SUTRA_SERVER` and `SUTRA_ADMIN_TOKEN`. The token is the server's `SUTRA_ADMIN_TOKEN`.
- **Local**: without `--server`, the tool works on the data folder (`SUTRA_DATA_DIR`) or the database (`SUTRA_DB`) directly. Use it when building container images.
- **`sutra test`** installs the package in a throw-away server and runs every Sutra with its trigger's test data. A Sutra passes when its run ends done. Give secrets the tests need with `--secret` or `--secrets-from-env`.
- **`--from-git`** builds the release from the project's files in Git with no server or database (a throw-away one is used). Every Sutra in the repository, or those in `--sutras`, is deployed by it. A private repository reads its token from `SUTRA_GIT_TOKEN` (login `SUTRA_GIT_LOGIN`); the repository address is recorded without credentials.
- **`deploy`** applies the zip's own `deployment-config.json`, or the file given with `--config`.
- Exit codes: 0 success, 1 failure (check failed, test failed, deploy refused), 2 wrong usage. CI pipelines can rely on them.

A pipeline, for example:

```
sutra package --from-git . --ref $TAG --version $VERSION --out orders.zip
sutra test orders.zip --secrets-from-env
sutra deploy orders.zip --server $UAT_ENGINE --token $UAT_TOKEN --config uat-config.json
# after approval
sutra deploy orders.zip --server $PROD_ENGINE --token $PROD_TOKEN --config prod-config.json
```

## 3. Headless engines

`SUTRA_MODE=engine` runs the engine, the gateway, timers and listeners without the studio:

- No designer pages and no editing API.
- The admin port keeps `/health`, `/ready`, `/metrics`, the **Admin Console** at `/admin`, and the API the console and automation need: packages, deployed Sutras and their versions, runs, approvals, secrets, engines, users and audit. Callers are signed-in console users, system account tokens (limited to their roles) or `SUTRA_ADMIN_TOKEN`.
- There is no first-start page, so nobody who reaches a fresh engine can claim it. Add the first administrator on the server:

  ```
  sutra user add admin --role administrator --password-from-env ADMIN_PASSWORD
  sutra user add ci-orders --system --role deployer --project "Orders"   # then create its token in the console
  ```
- Packages in `SUTRA_DEPLOY_DIR` are deployed at start, in file-name order. A package whose checksum is already deployed is skipped. A package that cannot be deployed stops the start with an error, so a bad release never serves half-deployed.

### Operating from a shell

Everything the Admin Console does can be done with the `sutra` command (and each console action shows its command for PowerShell and bash):

```
sutra sutras list [--project Orders]
sutra sutras stop|start|restart "Order lookup API" --project Orders
sutra sutras deploy "Order lookup API" --project Orders --version 3
sutra sutras tune "Order lookup API" --project Orders --max-runs 4 --priority 2 --run-timeout-min 30
sutra runs list --status failed;  sutra runs show|resubmit|cancel <run id>
sutra approvals list;  sutra approvals approve|reject <id> --comment "checked"
sutra engines list;  sutra engines drain engine-2;  sutra engines housekeeping
sutra engines tune --workers 32;  sutra engines tune --engine engine-2 --workers 8
sutra token create ci-orders --name github --expires-days 90
sutra audit --actor alice --outcome denied [--csv]
sutra alerts [history]  (exit code 1 while a critical alert is firing);  sutra alerts ack|resolve <id>
sutra alerts check;  sutra alerts rules;  sutra alerts channels;  sutra alerts test "Operations team"
sutra gateway apps|plans|stats|log
sutra gateway app add "Acme shop" --scopes "orders:read" --plan Partner
sutra gateway key create "Acme shop" --name production --expires-days 365
sutra gateway plan set Partner --per-minute 120 --per-day 50000
sutra gateway firewall --allow "10.0.0.0/8" --deny "203.0.113.9"
sutra gateway openapi > openapi.json
```

### The sutraflow launcher

One launcher runs SutraFlow everywhere: `bin/sutraflow` (Linux, macOS) and `bin\sutraflow.cmd` (Windows); `sutraflow` after `npm install -g`. Its settings are in `sutraflow.env` beside it, made from `sutraflow.env.example` on first use (ports, `SUTRA_DATA_DIR`, `SUTRA_DB`, `SUTRA_NODE`, and any other `SUTRA_` setting). `SUTRAFLOW_ENV` points it at another settings file.

| Command | Does |
|---|---|
| `setup` | `npm install` and `npm run build` in a source folder (`npm ci --omit=dev` in a built copy), the settings file and the local admin token |
| `start`, `start engine` | The studio, or a headless engine on the same database, in the background; output in `<data>/logs/<name>.out.log`. `--foreground` for services and Laragon |
| `stop`, `stop engine`, `stop all` | Graceful drain: running steps finish first; `--force` ends a process that does not stop within 45 s |
| `restart`, `status`, `logs [--follow]` | Restart; ready or not, process, addresses and database; the output log |
| `open [designer\|admin\|guide\|architecture]` | Opens the page |
| `cli ...` | The sutra command against this studio with the local admin token (`data/admin-token.txt`) |
| `db info`, `db copy --to ...` | The database in use; copy to PostgreSQL |
| `service` | A systemd unit (Linux) or a scheduled task (Windows) to start with the machine |
| `docker up\|down\|status\|logs\|build` | `docker-compose.yml`: a studio and an engine. Makes `SUTRA_ADMIN_TOKEN` and `SUTRA_MASTER_KEY` once into `.env` |
| `docker cluster up\|down\|status\|logs` | `docker-compose.cluster.yml`: PostgreSQL, a studio and two engines; also makes `POSTGRES_PASSWORD` |

### Windows with Laragon

Laragon uses the same launcher; `deploy/laragon/` holds only its settings, the Apache site and a README:

1. Build (`npm run build`), then copy `package.json`, `package-lock.json`, `bin/`, `dist/` and `docs/*.html` to `C:\laragon\www\sutra` and run `npm ci --omit=dev` there.
2. Copy `deploy/laragon/sutraflow.env` to `C:\laragon\www\sutra\sutraflow.env`: studio on 4810 (gateway 8090), engine on 4811 (gateway 8091), data in `C:\laragon\data\sutraflow` outside the web folder, Laragon's PostgreSQL, and the Node.js path. `admin-token.txt` in the data folder acts as an administrator; keep it private.
3. `01-sutra.conf` goes to `C:\laragon\etc\apache2\sites-enabled`: it loads Apache's proxy modules and forwards `http://sutra.test` to the studio.
4. Add to Laragon's Procfile (Menu > Procfile): `SutraFlow: autorun C:\laragon\www\sutra\bin\sutraflow.cmd start --foreground PWD=www/sutra`.
5. Everything else: `bin\sutraflow.cmd status`, `stop all`, `start engine`, `cli sutras list`, `open admin`.

Laragon's MySQL works as a DB Ops connection (driver mysql, host 127.0.0.1, port 3306, user root). `SUTRA_TEST_MYSQL_URL=mysql://root@127.0.0.1:3306/sutraflow_test npm test` also runs the MySQL tests.

## 4. Docker

One image serves both roles:

```
docker build -t sutraflow:1.7.5 .
docker run -p 4800:4800 -p 8080:8080 -v sutra-data:/data sutraflow:1.7.5                    # studio
docker run -e SUTRA_MODE=engine -e SUTRA_ADMIN_TOKEN=... -e SUTRA_MASTER_KEY=... \
           -v ./deploy:/deploy:ro -p 8080:8080 -p 8443:8443 sutraflow:1.7.5                  # engine
```

- Runs as the non-root `node` user, with `tini` as init so `docker stop` drains running steps.
- Health check on `/health`; volumes `/data` (database, vault key, logs) and `/deploy` (packages).
- JSON logs on standard output.
- `docker-compose.yml`: a studio and an engine. `docker-compose.cluster.yml`: PostgreSQL, a studio and two engines.

**Immutable releases**: `FROM sutraflow:1.7.5` + `COPY orders-1.4.0.sutra /deploy/` makes each release one image.

Keep `SUTRA_MASTER_KEY` in your secret store: it decrypts the vault. With it set, the vault survives replacing containers. Without it, the key file in `/data` must be kept.

## 5. Clusters: several engines, PostgreSQL

Point every engine at one database: `SUTRA_DB=postgres://user:pass@host/db` (or the same SQLite file, on one host). Give each engine a name (`SUTRA_ENGINE_ID`) and all of them the same `SUTRA_MASTER_KEY`.

**Moving from SQLite to PostgreSQL.** Stop the server, then copy everything (projects, Sutras and their versions, connections, the vault, users, runs, audit, gateway apps, AI memory and knowledge):

```
sutra db copy --to postgres://postgres@127.0.0.1:5432/sutraflow
```

A missing database is created. A target that already holds data is refused unless you add `--replace`. Then start the server with `SUTRA_DB` set to that address and the same master key (the `SUTRA_MASTER_KEY`, or the key file in the data folder), so the vault stays readable. `sutra db info` shows which database is in use and its row counts. With the launcher (and Laragon), `sutraflow.env` holds the `SUTRA_DB` line.

| Behaviour | How |
|---|---|
| Work is shared | Every engine claims due steps with one atomic statement; a step is run by exactly one engine |
| Each step runs once | The claim records the engine as owner; results are written in one transaction with the next steps |
| Timers and listeners fire once | One engine holds the leader lease (renewed every heartbeat) and runs timers, folder, mailbox, queue and Drive listeners |
| Failover | A leader that stops renewing loses the lease within three heartbeats; another engine takes over |
| Crash recovery | The leader puts steps of an engine that stopped beating back in the queue; another engine finishes them |
| API replies | A caller waits on the engine it reached, even when another engine runs the reply step |
| Deploys | A deploy through any engine or the command-line tool reaches every engine within a heartbeat |
| Serve-only engines | `SUTRA_WORKERS=0`: the engine serves APIs and leaves the steps to the others |

**Graceful shutdown** on `SIGTERM`, Ctrl+C or `POST /api/engine/drain` (use the API on Windows and in pre-stop hooks):

1. `/ready` reports draining, so load balancers stop sending requests.
2. Leadership is given up, so timers and listeners move to another engine.
3. Running steps get `SUTRA_DRAIN_MS` to finish. Those that do not are handed back to the queue and finished by another engine.
4. Callers still waiting get their replies, then the listeners close.

Give the orchestrator more grace time than `SUTRA_DRAIN_MS` (compose: `stop_grace_period`, Kubernetes: `terminationGracePeriodSeconds`).

`GET /api/engine/status` (and `sutra status`) lists the engines, the leader and the queue.

**Storage notes**: PostgreSQL write transactions are serialised cluster-wide, matching SQLite, so engines never overwrite each other's run state. This favours correctness over raw write throughput. The test suite runs every in-process suite on PostgreSQL through PGlite; set `SUTRA_TEST_PG_URL` to also run a check against a real PostgreSQL server.

## 6. Monitoring: health, metrics, traces, logs

| Endpoint | Purpose |
|---|---|
| `GET /health` | Liveness: the process answers |
| `GET /ready` | Readiness: storage answers, packages are deployed, the gateway listens, not draining. 503 with reasons otherwise |
| `GET /metrics` | Prometheus text. Protect it with `SUTRA_METRICS_TOKEN` |

**Metrics** (per engine; scrape each one):

- `sutra_runs_started_total{sutra,source}`, `sutra_runs_finished_total{sutra,status}`, `sutra_run_duration_seconds`
- `sutra_steps_total{activity,outcome}` (done, error = handled by an error output, failed), `sutra_step_duration_seconds`, `sutra_step_retries_total`
- `sutra_gateway_requests_total{kind,status}` (rest, soap, mcp), `sutra_gateway_request_duration_seconds`
- `sutra_tasks{status}` (the shared queue), `sutra_engine_running_steps`, `sutra_engine_workers`, `sutra_engine_leader`, `sutra_engines_alive`, `sutra_listeners{state}`, `sutra_info{version,mode,engine}`

**Traces**: set `OTEL_EXPORTER_OTLP_ENDPOINT` (an OpenTelemetry collector, Jaeger, Tempo, Honeycomb) and optionally `OTEL_SERVICE_NAME`.

- A run is one trace, with a span per step: the activity, outcome, attempt and engine, and the error on failed steps.
- Steps run by different engines land in the same trace.
- A caller's `traceparent` header is continued, and every gateway answer carries the run's `traceparent`.

**Logs**: `SUTRA_LOG_FORMAT=json` (the default in the image) writes one JSON object per line on standard output: time, level, engine, project, Sutra, run, step, message. Project log files stay as configured per project.

## 7. Runs: retention and running again

- Finished runs (done, failed, cancelled) older than `SUTRA_RUN_RETENTION_DAYS` (default 30; 0 keeps everything) are deleted with their steps by the leader, about once a minute. Waiting runs, such as approvals and timers, are never deleted. `POST /api/engine/housekeeping` runs it at once.
- **Run again from the failed step**: in Runs, or `POST /api/runs/<id>/resubmit`, a failed run continues from the step that failed. That step gets the same input; everything the earlier steps produced is kept. A run stopped on purpose (End with Sutra: error) has no failed step to repeat.

## 8. Settings

| Variable | Default | Meaning |
|---|---|---|
| `SUTRA_MODE` | `studio` | `studio`, or `engine` (headless) |
| `SUTRA_DATA_DIR` | `./data` | SQLite database, vault key, logs |
| `SUTRA_DB` | (SQLite) | `postgres://...` for clusters |
| `SUTRA_MASTER_KEY` | key file | Vault key, base64 32 bytes; the same on every engine |
| `SUTRA_ADMIN_TOKEN` | (none) | Bearer token for the command-line tool and automation; acts as an administrator. Prefer system account tokens, limited by their roles |
| `SUTRA_DEPLOY_DIR` | (none) | Folder of `.sutra` packages deployed at start |
| `SUTRA_ENGINE_ID` | host-pid | This engine's name in a cluster |
| `SUTRA_WORKERS` | by machine | Steps run at once (4 on 1 vCPU / 1 GB up to 32 on 8 cores); 0 = serve only |
| `SUTRA_MEMORY_WORKERS` | 0 | Steps at once for Sutras that run in memory; 0 = as `SUTRA_WORKERS` |
| `SUTRA_POLL_MS` | by machine | How often an idle engine looks for due steps (200 to 500 ms) |
| `SUTRA_SETTINGS_REFRESH_MS` | by machine | How long an engine keeps project and Sengine variables; 0 = every step |
| `SUTRA_KEEPALIVE_MS` | 65000 | Idle connections kept by the admin and gateway servers; keep it above the idle time of a load balancer in front |
| `SUTRA_HEARTBEAT_MS` | 5000 | Heartbeat; dead after three missed |
| `SUTRA_DRAIN_MS` | 30000 | Time running steps get on shutdown |
| `SUTRA_RUN_RETENTION_DAYS` | 30 | Delete finished runs after this many days; 0 = keep |
| `SUTRA_AUDIT_RETENTION_DAYS` | 365 | Delete audit entries after this many days; 0 = keep |
| `SUTRA_LOG_FORMAT` | `text` | `json`: log lines on standard output |
| `SUTRA_METRICS_TOKEN` | (none) | Bearer token for `/metrics` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | (none) | OpenTelemetry collector (OTLP/HTTP) |
| `OTEL_SERVICE_NAME` | `sutraflow` | Service name on traces |
| `SUTRA_ADMIN_HOST`, `SUTRA_ADMIN_PORT` | 127.0.0.1, 4800 | Studio / admin API |
| `SUTRA_GATEWAY_HTTP_PORT`, `SUTRA_GATEWAY_HTTPS_PORT` | 8080, 8443 | Gateway |
| `SUTRA_REPLY_TIMEOUT_MS` | 60000 | How long API callers wait for a reply |
| `SUTRA_MAX_STEPS` | 10000 | Safety limit of steps per run |
