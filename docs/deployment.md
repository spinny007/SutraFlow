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

## 2. The sutra command-line tool

```
sutra package  --project "Orders" --version 1.4.0 --note "Faster lookup" --out orders-1.4.0.sutra
sutra check    orders-1.4.0.sutra
sutra deploy   orders-1.4.0.sutra [--config prod-ops.json] [--keep-others]
sutra test     orders-1.4.0.sutra [--secret NAME=value] [--secrets-from-env]
sutra history  --project "Orders"
sutra rollback --project "Orders" [--to <deployment id>]
sutra secret   set ORDERS_DB_PW --from-env ORDERS_DB_PW
sutra status   --server https://engine-1:4800
```

- **Remote**: add `--server <url> --token <token>`, or set `SUTRA_SERVER` and `SUTRA_ADMIN_TOKEN`. The token is the server's `SUTRA_ADMIN_TOKEN`.
- **Local**: without `--server`, the tool works on the data folder (`SUTRA_DATA_DIR`) or the database (`SUTRA_DB`) directly. Use it when building container images.
- **`sutra test`** installs the package in a throw-away server and runs every Sutra with its trigger's test data. A Sutra passes when its run ends done. Give secrets the tests need with `--secret` or `--secrets-from-env`.
- Exit codes: 0 success, 1 failure (check failed, test failed, deploy refused), 2 wrong usage. CI pipelines can rely on them.

A pipeline, for example:

```
sutra package --project Orders --version $VERSION --server $STUDIO --token $TOKEN --out orders.sutra
sutra test orders.sutra --secrets-from-env
sutra deploy orders.sutra --server $UAT_ENGINE --token $UAT_TOKEN
# after approval
sutra deploy orders.sutra --server $PROD_ENGINE --token $PROD_TOKEN
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
sutra gateway apps|plans|stats|log
sutra gateway app add "Acme shop" --scopes "orders:read" --plan Partner
sutra gateway key create "Acme shop" --name production --expires-days 365
sutra gateway plan set Partner --per-minute 120 --per-day 50000
sutra gateway firewall --allow "10.0.0.0/8" --deny "203.0.113.9"
sutra gateway openapi > openapi.json
```

### Windows with Laragon

Templates in `deploy/laragon/` (copy them into `C:\laragon\www\sutra`; set the Node.js path in `_env.cmd`):

1. Build (`npm run build`), then copy `package.json`, `package-lock.json`, `dist/` and `docs/*.html` to `C:\laragon\www\sutra` and run `npm ci --omit=dev` there.
2. Scripts in that folder:

   | Script | Does |
   |---|---|
   | `start-sutra.cmd` | Studio: designer, Admin Console and engine, http://127.0.0.1:4810 (gateway 8090) |
   | `start-engine.cmd` | A headless engine on the same database, http://127.0.0.1:4811/admin (gateway 8091) |
   | `stop.cmd`, `stop.cmd engine` | Graceful stop: running steps finish first |
   | `status.cmd` | Ready or not, and every engine of the cluster |
   | `open-designer.cmd`, `open-admin.cmd`, `open-guide.cmd` | Open the pages |
   | `sutra.cmd ...` | The sutra command against this server, such as `sutra.cmd sutras list` |
   | `_env.cmd` | Shared settings: data folder, Node.js 24, ports, and a local admin token made once |

   Data stays outside the web folder in `C:\laragon\data\sutraflow`, with `admin-token.txt`, which acts as an administrator; keep it private.
3. `.htaccess` in `www\sutra` denies direct access to the folder.
4. `01-sutra.conf` goes to `C:\laragon\etcpache2\sites-enabled`: it loads Apache's proxy modules and forwards `http://sutra.test` to the studio.
5. Add to Laragon's Procfile (Menu > Procfile): `SutraFlow: autorun C:\laragon\www\sutra\start-sutra.cmd PWD=www/sutra`.

Laragon's MySQL works as a DB Ops connection (driver mysql, host 127.0.0.1, port 3306, user root). `SUTRA_TEST_MYSQL_URL=mysql://root@127.0.0.1:3306/sutraflow_test npm test` also runs the MySQL tests.

## 4. Docker

One image serves both roles:

```
docker build -t sutraflow:1.0.0 .
docker run -p 4800:4800 -p 8080:8080 -v sutra-data:/data sutraflow:1.0.0                    # studio
docker run -e SUTRA_MODE=engine -e SUTRA_ADMIN_TOKEN=... -e SUTRA_MASTER_KEY=... \
           -v ./deploy:/deploy:ro -p 8080:8080 -p 8443:8443 sutraflow:1.0.0                  # engine
```

- Runs as the non-root `node` user, with `tini` as init so `docker stop` drains running steps.
- Health check on `/health`; volumes `/data` (database, vault key, logs) and `/deploy` (packages).
- JSON logs on standard output.
- `docker-compose.yml`: a studio and an engine. `docker-compose.cluster.yml`: PostgreSQL, a studio and two engines.

**Immutable releases**: `FROM sutraflow:1.0.0` + `COPY orders-1.4.0.sutra /deploy/` makes each release one image.

Keep `SUTRA_MASTER_KEY` in your secret store: it decrypts the vault. With it set, the vault survives replacing containers. Without it, the key file in `/data` must be kept.

## 5. Clusters: several engines, PostgreSQL

Point every engine at one database: `SUTRA_DB=postgres://user:pass@host/db` (or the same SQLite file, on one host). Give each engine a name (`SUTRA_ENGINE_ID`) and all of them the same `SUTRA_MASTER_KEY`.

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
| `SUTRA_WORKERS` | 16 | Steps run at once; 0 = serve only |
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
