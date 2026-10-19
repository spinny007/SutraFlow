# SutraFlow

**A visual integration designer and engine.** Drag activities onto a canvas, map data between steps, test and debug, and deploy *Sutras* (integration processes) that run as REST, SOAP and MCP services, on schedules, or on events: files, queues, mail, cloud drives, chat messages and more.

![Version](https://img.shields.io/badge/version-1.7.5-2f6fd8)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)
[![Commercial licence available](https://img.shields.io/badge/commercial%20licence-available-orange)](COMMERCIAL-LICENSE.md)
![Node.js](https://img.shields.io/badge/node-%E2%89%A5%2022.13-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-7-3178c6?logo=typescript&logoColor=white)
![Database](https://img.shields.io/badge/database-SQLite%20%7C%20PostgreSQL-4169e1?logo=postgresql&logoColor=white)
![Platforms](https://img.shields.io/badge/platforms-Windows%20%7C%20Linux%20%7C%20macOS%20%7C%20Docker-555)
![Tests](https://img.shields.io/badge/tests-275-success)

![The SutraFlow designer: palettes, canvas and the step inspector](docs/guide-images/designer.jpg)

## Contents

- [Features](#features)
- [Download](#download)
- [Quick start](#quick-start)
- [Documentation](#documentation)
- [Palettes](#palettes)
- [Releases and CI/CD](#releases-and-cicd)
- [Running in production](#running-in-production)
- [Performance and sizing](#performance-and-sizing)
- [Configuration](#configuration)
- [Development](#development)
- [Project layout](#project-layout)
- [Testing](#testing)
- [Known limitations](#known-limitations)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)

## Features

- **Visual designer**: 118 activities in 18 palettes, drag-and-drop data mapping with For-Each, Where, Group by and Sort by, more than 100 formula functions, JSONata, live previews, step-by-step debugging with breakpoints, undo and redo, folders, and a description on every step.
- **Durable engine**: every step is checkpointed in the database; approvals and long waits cost nothing while they wait; runs survive restarts and resume where they stopped; retries with backoff, error branches, an Error handler, loops, Merge, sub-Sutras, and resubmitting failed runs from the failed step. Short request-reply Sutras can run **in memory** instead, saved once when they end, several times faster.
- **Memory tables**: small reference data (rates, codes, routing, reusable values) in each engine's memory for lookups without a database round trip, loaded from a query or filled by Sutras, with a failsafe copy, hot reload from the Admin Console and enforced limits.
- **Big files on small servers**: CSV and line files of any size are streamed in batches of rows, each batch a step of its own, so memory depends on the batch, not the file.
- **APIs and gateway**: REST and SOAP services with generated WSDL and OpenAPI; security policies (API keys, Basic, JWT, mutual TLS, WS-Security UsernameToken, IP allow lists, rate limits, CORS); gateway apps with keys, OAuth client-credentials tokens, plans and a firewall; TLS with your own certificate or Let's Encrypt.
- **AI**: AI steps (prompt, classify, route, extract, summarize, translate, sentiment) on Claude, OpenAI, Gemini, Ollama and other providers; AI agents with tools, memory, guardrails, people in the loop and hand-offs; knowledge bases for RAG (built-in, pgvector, Qdrant, Chroma, Pinecone); Sutras published as MCP tools for Claude and other assistants; agents as chat pages, an OpenAI-compatible API and A2A.
- **Connectors**: HTTP, SOAP with WS-Security, files, SFTP and FTP, PostgreSQL, MySQL, SQL Server, Oracle and SQLite, Kafka, RabbitMQ and ActiveMQ, email, Firebase, Google Drive, Sheets and Docs, SharePoint and OneDrive, Dropbox, YouTube, Twitch, Discord, Telegram, Facebook Pages, Azure Data Factory, Databricks, Python, PowerShell and shell scripts, and any OAuth REST API.
- **Operations**: an Admin Console for deployed applications (start, stop, tuning, runs, approvals, engines, alerts, gateway traffic, users and roles, system accounts, audit log, releases, the database); clusters of engines on PostgreSQL with a leader, failover and graceful drain; Prometheus metrics, OpenTelemetry traces and JSON logs.
- **Releases**: projects in Git from the designer; release zips with the deployment config, documentation and files; built by a CI/CD pipeline straight from Git with the `sutra` command; deployed by command line or the Admin Console, with history and rollback.
- **Documentation from the design**: each Sutra and project produces its own documentation (HTML and Markdown) from its steps and their descriptions.

![The Admin Console: deployed applications and their Sutras](docs/guide-images/console-apps.jpg)

## Download

Each release has a Windows zip and a Linux tar.gz, already built, with SHA-256 files and offline archives (packages included) on the GitHub Releases page. Unpack, run `bin/sutraflow setup` (Windows: `bin\sutraflow.cmd setup`), then `bin/sutraflow start`. Steps for each system and for upgrades: [RELEASE-NOTES.md](RELEASE-NOTES.md).

## Quick start

**Requirements**: [Node.js](https://nodejs.org) 22.13 or later (24 recommended). Nothing else: the database is SQLite, built into Node. Python 3, PostgreSQL, Docker and AI models are optional.

```bash
git clone https://github.com/spinny007/SutraFlow.git
cd SutraFlow
bin/sutraflow setup     # npm install, build, and sutraflow.env      (Windows: bin\sutraflow.cmd setup)
bin/sutraflow start     # the studio, in the background
bin/sutraflow open      # http://127.0.0.1:4800
```

Create the administrator account on the first visit, then **+ New Sutra → Samples** for working examples, or **New project → Package file → Or a sample project** for a whole project (an AI document assistant over a folder of PDF, Word and PowerPoint files).

The `sutraflow` launcher is the one place for every command on Windows and Linux: `start [engine]`, `stop [engine|all]`, `restart`, `status`, `logs [--follow]`, `open`, `cli <sutra command>`, `db`, `service` (start with the machine) and `docker [cluster] up|down|status|logs|build`. Settings are in `sutraflow.env`.

| Port | Default | For |
|---|---|---|
| Studio (admin) | `127.0.0.1:4800` | The designer, the Admin Console (`/admin`), the user guide (`/guide`) and the admin API. Keep it private. |
| Gateway | `8080` (HTTP), `8443` (HTTPS) | The deployed Sutras: REST, SOAP, MCP, agents, `/oauth/token`, `/openapi.json`, `/health`. |
| Headless engine | `4801`, gateway `9080` / `9443` | An engine without the designer, beside the studio or on other machines. |

## Documentation

| Document | What it covers |
|---|---|
| [User guide](docs/sutraflow-user-guide.html) (also at `/guide`) | 44 chapters: every screen, every activity with its settings, connection types, functions; designing Sutras, how the engine runs them, AI, RAG step by step, the API gateway, releases and CI/CD, PostgreSQL, the data tables, production. |
| [Architecture](docs/sutraflow-architecture.html) (also at `/architecture`) | How SutraFlow works inside: every source file, every table, every API route, the settings, with diagrams. |
| [Deployment](docs/deployment.md) | Packages, the `sutra` command, headless engines, Docker, clusters, monitoring. |
| [Engine design](docs/architecture.md) | Runs, tasks, checkpoints and the cluster in short. |
| [Laragon (Windows development)](deploy/laragon/README.txt) | Running SutraFlow in Laragon with PostgreSQL. |

The guide and the architecture page are built from the code (`npm run guide`, `npm run architecture`), so they list exactly what the code does.

## Palettes

| Palette | Activities |
|---|---|
| Triggers | Manual start, Timer, REST service, SOAP service, Channel trigger |
| HTTP / REST | Send HTTP request, Send HTTP response |
| SOAP / Web services | Invoke SOAP service, SOAP reply |
| Data & mapping | Map data, Parse / Render JSON, Parse / Render XML, Parse / Render CSV, Filter list, Sort list, Aggregate, Transform (JSONata) |
| Flow control | If / else, Switch, Router, For each, Merge, Wait, Human approval, Set variables, Throw error, End, Call Sutra, Return, Error handler, No operation |
| Files | File trigger, Read file, List / read directory, Write file, Move / copy / delete file |
| SFTP / FTP | Remote file trigger, List, Read, Write, Move / copy / delete remote file |
| DB Ops | SQL query, SQL update, Call procedure, SQL script, SQL transaction |
| Service Bus | Publish message, Message subscriber, Confirm message (Kafka, RabbitMQ, ActiveMQ / AMQP 1.0) |
| Email | Send email, Email trigger |
| Firebase | Firestore, Realtime Database, Push notification (FCM) |
| Apps and social | Connected API call, Google Sheets, Google Drive / Docs (and trigger), SharePoint / OneDrive (and trigger), Dropbox, YouTube, Facebook Page, Twitch (and live trigger), Discord (and trigger), Telegram (and trigger) |
| Azure Data Factory & Databricks | Run ADF pipeline, ADF pipeline run, ADF run finished trigger, Run Databricks job or notebook, Databricks code block, Databricks SQL |
| Custom code | JavaScript code (sandboxed), HTML template |
| Scripts | Python script, PowerShell script, Shell script, Run program (off until an administrator allows scripts) |
| Release | Build package, Check package, Deploy package, Roll back |
| General | Log, Validate fields, Send to channel, Counter |
| AI | AI prompt, classify, router, extract, summarize, translate, sentiment, Ollama; AI agent, Ask a person, Hand off to agent, memory, knowledge (add, read document text, search, ask, remove, embed), Call MCP tool, Agent channel, Agent reply, AI guard, AI tool, Reply to AI |

Every activity except triggers has an **error** output, retries with backoff, a time limit, a breakpoint, a loop setting, and a description. Connections (22 kinds) are shared per project with secrets kept in an encrypted vault and named, never copied.

## Releases and CI/CD

A release is a zip with the whole project (Sutras at fixed versions, connections without secret values, schemas, variables), a deployment config to fill in per environment, documentation and files. Development and test servers may deploy from the designer; production takes release zips only.

```bash
# In a pipeline (GitHub Actions, GitLab, Azure DevOps, Jenkins): build from Git, test, deploy.
sutra package --from-git . --ref v1.4.0 --version 1.4.0 --out orders-1.4.0.zip
sutra test   orders-1.4.0.zip --secrets-from-env
sutra deploy orders-1.4.0.zip --config prod-config.json --server https://prod-engine:4800 --token $TOKEN
sutra rollback --project "Orders" --server https://prod-engine:4800 --token $TOKEN
```

Full pipelines for GitHub Actions, GitLab CI, Azure DevOps and Jenkins are in the user guide (*CI/CD pipelines*).

## Running in production

- **Headless engines**: `SUTRA_MODE=engine`, with the Admin Console and the gateway, packages from `SUTRA_DEPLOY_DIR` at start.
- **PostgreSQL and clusters**: move from SQLite with one button (Admin Console → Database → Migrate now) or `tools/migrate-to-postgres`; then add engines on the same database. Work is shared, each step runs once, a leader runs timers and listeners with failover, and a stopped engine's steps are finished by another.
- **Docker**: `Dockerfile`, `docker-compose.yml` (studio and engine) and `docker-compose.cluster.yml` (PostgreSQL, a studio and two engines).
- **Monitoring**: `/health`, `/ready`, Prometheus `/metrics`, OpenTelemetry traces, JSON logs, alert rules (failed runs, slow runs, waiting approvals, gateway errors, engines, certificates) to email, webhooks or Sutras.
- **Sign-in on production servers**: secrets per server vault; Azure managed identities or service principals; OAuth accounts connected with `sutra connect` or a refresh token secret.

See [docs/deployment.md](docs/deployment.md) and the user guide's *Running in production*.

## Performance and sizing

SutraFlow sizes itself: an engine takes its steps at once, queue check and settings refresh from the machine it runs on (from 1 vCPU / 1 GB up), unless environment variables set them. The Admin Console (*Engines → Tuning → This machine*) shows the profile and applies it; `sutra engines machine` prints it.

- Load test: `node tools/loadtest.mjs` (durable or in memory, one or more engines, small or big outputs, a killed engine, a soak, one core and a small heap); big files: `node tools/bigfiletest.mjs`.
- Results measured for this release are in [docs/benchmarks](docs/benchmarks), and explained in the user guide's *Sizing and performance*, with which services suit which machine and what file sizes to read whole or stream.

## Configuration

Settings are environment variables, set in `sutraflow.env` for the launcher. The most used:

| Variable | Default | Meaning |
|---|---|---|
| `SUTRA_DATA_DIR` | `./data` | Data folder: SQLite database, master key, logs, project files |
| `SUTRA_DB` | (SQLite) | `postgres://user@host:5432/sutraflow` for PostgreSQL; password in `SUTRA_DB_PASSWORD` |
| `SUTRA_MASTER_KEY` | `data/master.key` | Vault key (base64, 32 bytes); the same on every engine of a cluster |
| `SUTRA_MODE` | `studio` | `engine` for a headless engine |
| `SUTRA_ENVIRONMENT` | `development` | `development`, `test` or `production` (production refuses designer deploys) |
| `SUTRA_ADMIN_HOST`, `SUTRA_ADMIN_PORT` | `127.0.0.1`, `4800` | Studio and admin API |
| `SUTRA_GATEWAY_HTTP_PORT`, `SUTRA_GATEWAY_HTTPS_PORT` | `8080`, `8443` | Gateway |
| `SUTRA_WORKERS` | by machine | Steps one engine runs at once (4 on 1 vCPU / 1 GB, up to 32) |

Every setting is listed in the architecture page (*Settings*); the build fails when the code reads one it does not list.

## Development

```bash
npm install
npm run dev            # studio with hot reload on http://localhost:5173 (API proxied to 4800)
npm test               # the whole test suite (builds first)
npm run typecheck      # server and web
npm run build          # production build into dist/
npm run guide          # rebuild the user guide from the code
npm run guide:shots    # retake the guide's screenshots from a running server (headless Edge or Chrome)
npm run architecture   # rebuild the architecture page
npm run samples        # rebuild the sample project zips in samples/
```

Stack: Node.js and TypeScript, Fastify, React with React Flow, Vite; SQLite (`node:sqlite`) or PostgreSQL.

## Project layout

```
bin/                    the sutraflow launcher (Windows .cmd, Linux and macOS sh)
server/src/             the server: engine, gateway, admin API, connectors, palettes, AI, Git, the sutra command
web/src/                the designer (React)
web/admin/              the Admin Console (React)
tools/                  builds of the guide, architecture page and sample zips; migrate-to-postgres
docs/                   user guide, architecture page, deployment and design notes, guide screenshots
samples/                sample project zips (release zips with their files)
deploy/                 Laragon and other deployment templates
test/                   the test suites
```

## Testing

`npm test` discovers 275 tests. A normal local run executes 262 and skips 13 that need external infrastructure. The suite uses real child processes and network calls for HTTP, SOAP with WS-Security, TLS, SMTP, AMQP 1.0, SFTP and FTP servers, SQLite, Python, multi-process clusters, the launcher and the command-line tool. It also runs every in-process suite again through PostgreSQL compatibility using PGlite.

The process-level tests exercise the central durability claims directly: engines share work without duplicating completed steps, elect and replace a leader, recover work from an engine killed mid-step, hand work back during drain, persist approvals and long waits without holding a worker, and deploy and call packages through both local and remote CLI paths.

Optional tests use a real PostgreSQL server for DB Ops steps (queries, bound parameters, transactions, plpgsql install scripts, procedures with output parameters), database migration and cluster behavior (`SUTRA_TEST_PG_URL`), PostgreSQL tools for password- and SSL-protected migration (`SUTRA_TEST_PG_BIN`), and a real MySQL server for DB Ops steps and install scripts (`SUTRA_TEST_MYSQL_URL`). With Laragon's MySQL and PostgreSQL:

```bash
SUTRA_TEST_PG_URL=postgres://postgres@127.0.0.1:5432/postgres SUTRA_TEST_MYSQL_URL=mysql://root@127.0.0.1:3306/sutraflow_test SUTRA_TEST_PG_BIN=C:/laragon/bin/postgresql/postgresql/bin npm test
``` The pgvector storage path is covered with a protocol-compatible test server; run an additional deployment test against the intended PostgreSQL/pgvector version before relying on it in production.

Tested against stand-in services that answer like the real ones, but not yet against the real services: SQL Server, Oracle, Kafka, RabbitMQ, IMAP, Let's Encrypt, Qdrant, Chroma, Pinecone, and the Google, Microsoft, Dropbox, YouTube, Twitch, Discord, Telegram, Facebook, Azure Data Factory and Databricks APIs.

## Known limitations

- **WS-Security**: no XML encryption, and signatures of incoming SAML and X.509 tokens are not validated. Incoming SOAP calls accept UsernameToken (with replay protection); outgoing calls can sign with X.509 and send SAML tokens.
- **Message validation**: a REST service's body schema describes the data for mapping but is not enforced as JSON Schema or XSD; *Validate fields* checks required fields.
- **Single sign-on for people**: studio and Admin Console users sign in with SutraFlow accounts; JWT from an identity provider protects APIs, not the studio.
- **Twitch and Discord triggers** poll (every minute and every few seconds) rather than receive pushed events.

## Roadmap

- **Asynchronous PostgreSQL storage**: the biggest remaining gain, and the reason SQLite is about four times faster on one server. Today each PostgreSQL statement is answered through a worker thread while the engine waits; an asynchronous storage layer with a connection pool would let one engine overlap the database work of many steps. It is a large change.
- **Leaner run state**: each step currently rewrites the run state with the outputs of earlier steps, which costs Sutras that pass big data along. Keeping outputs only in the step rows removes that cost.
- **Waking engines on new work**: PostgreSQL can notify engines when work arrives (LISTEN/NOTIFY), instead of them polling the queue.

## Contributing

Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md). Code and documentation contributions need the [Contributor License Agreement](CLA.md), agreed once in your first pull request: you keep your copyright, and your contribution is published under the AGPL and may also be offered under commercial licences.

## Security

Secrets are encrypted in a vault, the studio stays on 127.0.0.1 with roles and an audit log, and gateway services are protected by policies and TLS. Report security problems privately: see [SECURITY.md](SECURITY.md).

## License

SutraFlow is **dual-licensed**:

- **[GNU Affero General Public License v3.0](LICENSE)**: free for everyone. Use, change and run it for any purpose; if you change SutraFlow and people use your changed version over a network, or you distribute it, you share your changes under the AGPL.
- **[Commercial licence](COMMERCIAL-LICENSE.md)**: for organisations that do not want to share their changes, for example in-house deployments with private changes, or SutraFlow inside a proprietary product or service. Terms per customer; contact [mixagile.com](https://mixagile.com).

Running SutraFlow unchanged needs no commercial licence, and the Sutras, projects and packages you build with it are yours, whichever licence applies.

Copyright (C) Surya Partap Singh and SutraFlow contributors.
