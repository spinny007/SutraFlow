# SutraFlow 2.1.2 release notes

Prepared 2026-10-27. Copyright (c) 2026-27 Surya Partap Singh, MixAgile.com. AGPL-3.0-only; a commercial licence is available.

| Download | For |
|---|---|
| `sutraflow-2.1.2-windows.zip` | Windows 10, 11 and Windows Server 2019 or later |
| `sutraflow-2.1.2-windows-x64-offline.zip` | The same with the runtime packages inside, for servers without the npm registry |
| `sutraflow-2.1.2-linux.tar.gz` | Linux (x64 or arm64); also macOS |

Each comes with a `.sha256` file to check the download: `sha256sum -c <archive>.sha256`, or on Windows `Get-FileHash <archive> -Algorithm SHA256`.

## In short

A release on top of 2.1.1: a guide of its own for administrators, documentation in a clearer order, safer upgrades, and two installer conveniences.

- **SutraFlow Administration Guide**, new, at `/admin-guide` and in the Admin Console: planning a server, the web installer page by page, silent installation, how an upgrade works, the launcher and settings, PostgreSQL, engines and clusters, sizing, the Admin Console, security, receiving releases, monitoring and troubleshooting, with new pictures of every page. It replaces `docs/deployment.md`.
- **The user guide is for designers** and reads in order: what SutraFlow is and getting it, building Sutras, the palettes with their connections, AI, APIs and security, and releasing, under part headings in the contents.
- **Upgrades are safer**: the engine beside the studio stops and starts with it, a folder in use by a web server, terminal or Explorer no longer stops it (a file held without sharing is found before anything changes, with the process that holds it), the way back restores only what an upgrade changes and always starts the old version again, and an SQLite file of its own is upgraded as SQLite.
- **Connection pictures**: every common connection (HTTP, PostgreSQL and MySQL on this machine and remote, Kafka, RabbitMQ, ActiveMQ, MongoDB) shown filled in and tested, in its palette's chapter.
- **Save the installer's answers as a config file** on the Review page, to install the next server silently with the same choices. The file holds no password.
- **The web installer keeps a log**, in `data/logs/installer.log`, with a download link on its last page and when a step fails.

## Install

- **Web installer**: unpack, then `bin/sutraflow install` (Windows: `bin\sutraflow.cmd install`). It opens in the browser of that machine.
- **Silent**: `bin/sutraflow install --config install.json`; the example is `docs/install-example.json`, or the file the web installer saved; `--dry-run` prints the plan.
- **By hand**: `bin/sutraflow setup`, then `bin/sutraflow start`.

Node.js 22.13 or later is needed (24 recommended).

## Upgrade from 2.1.0 or 2.1.1

Unpack 2.1.2 beside the installation and run `bin/sutraflow upgrade` from the new folder (or `upgrade --config upgrade.json`). It stops SutraFlow gracefully, backs it up, upgrades, compares the data and starts it again, and puts the previous version back if a step fails: the Administration Guide's *Upgrading* has every step with pictures. 2.1.2 changes no database tables and no settings.

**What changes for you:**
- **Nothing needs closing for an upgrade** but programs that hold SutraFlow's files without sharing: web servers, terminals and Explorer windows in the folder can stay. When a file is held, the upgrade says which and by which process before changing anything.
- **`docs/deployment.md` is gone**: its content is in the Administration Guide (`/admin-guide`). Links and bookmarks to it should point there.
- **Administration chapters moved** from the user guide to the Administration Guide; links between the two guides open the other one at the right chapter.

## What is new in 2.1.2

### Documentation
- **SutraFlow Administration Guide** (`docs/sutraflow-admin-guide.html`, served at `/admin-guide`, **Admin guide** in the Admin Console, `sutraflow open admin-guide`): for the people who install and run SutraFlow. Parts: Getting started (what administrators do, planning a server), Installing and upgrading (each installer page with its picture, silent installation, how an upgrade works with its pictures, Laragon and Linux development machines), Running SutraFlow (the launcher and every server setting, data, PostgreSQL, monitoring), Engines and clusters, The Admin Console, Security and connections, Releases on servers, Reference and troubleshooting. The administration chapters moved here from the user guide, and `docs/deployment.md` is folded in and retired.
- **New pictures** taken on a real installation by `tools/capture-admin-shots.mjs`: the installer pages, the upgrade pages from a real upgrade, and the Admin Console (overview, applications, tuning, traceability, releases, engines with the cluster name and May lead, alerts, gateway apps and traffic, users, roles, audit, runtime, database).
- **User guide in parts**, for designers: Getting started, Building Sutras, Palettes and connections, AI, APIs security and approvals, Releasing, Reference. Release-specific chapters (strict boundaries, MongoDB) moved from the front to their topics. A link to a chapter that moved opens the Administration Guide there.
- **Connection pictures** beside their palettes: HTTP in *Calling services*, PostgreSQL and MySQL in *Databases*, MongoDB in its chapter, Kafka, RabbitMQ and ActiveMQ in *Broker connections*. Remote ones take host, database and user from Project properties and the password from a Secret property.
- **`sutraflow-2.1.2-docs.zip`**, new beside the archives: the user guide, the Administration Guide and the architecture page with an `index.html`, in one folder to upload to a website as it is. Every page holds its pictures and links to the others by file name.
- **README** keeps Python with the palettes; the architecture page has a section on installing and upgrading, and its section titles no longer carry version numbers.

### Installer
- **Save answers as a config file** (Review page): `sutraflow-install.json` for `sutraflow install --config` on the next server. Passwords are written as `{"env": "SUTRA_INSTALL_ADMIN_PASSWORD"}` and, when one was given, `{"env": "SUTRA_INSTALL_DB_PASSWORD"}`: set those on that server first.
- **Installer log**: every step of a web install or upgrade is written to `logs/installer.log` in the data folder of the installation it is for (an upgrade's in the upgraded installation's, not the new release's), as the silent install already did, and offered as a download on the Done page, which shows where it is kept, and next to an error.
- **The engine beside the studio** starts with it when *Start SutraFlow when installed* is ticked; an upgrade stops it with the studio and starts it again when it was running.
- **Upgrades work with the folder in use**: a folder a web server (Apache, IIS), a terminal or Explorer has open is copied into the backup and updated in place instead of moved. Program files are checked first (*Program files free*): a file held without sharing stops the upgrade before anything changes, with the file and, on Windows, the process id and name that hold it.
- **The way back after a failed upgrade** restores only what an upgrade changes (the SQLite database, the installer lock, the settings and, for PostgreSQL, the database from its dump, waiting at most a minute for locks), tries each part on its own, always starts the old version again, and reports anything it could not put back.
- The engine names on the installer's Cluster page are shown in full.

### Fixes in 2.1.2

| Seen | Cause | Now |
|---|---|---|
| The user guide opened with a 2.0.11 chapter and MongoDB before *What SutraFlow is* | New chapters were added at the front of the list | Chapters are listed by part; the build fails when a chapter is in no part or in two |
| A failed web install left no log to send | Only the silent install wrote `installer.log` | The web installer writes it too and offers it for download |
| `npm run architecture` stopped with "no description for tools/soak/RUNBOOK.md" | The soak runbook added in 2.1.1 had no entry in the file list | It has one |
| Three 2.0.10 notes looked like releases of their own in these notes | Their headings were one level too high | They sit under 2.0.10 |
| An upgrade of an installation with an engine beside the studio stopped only the studio; the engine ran on while the program and database changed, a failed upgrade's database restore waited for ever on the engine's tables, and after an upgrade only the studio started | The upgrader called the launcher's `stop` and `start`, which mean the studio only | It stops both, starts the engine again when it ran, and a restore waits at most a minute |
| With *A headless engine beside it* and *Start when installed*, only the studio started | The same: `start` means the studio | Both start |
| Upgrading a Laragon installation failed at "Move the old runtime aside: resource busy" after the backup | A console window had the folder's `bin` as its working folder, and Windows will not move a folder in use; web servers (Apache, IIS), terminals and Explorer windows can do the same | A folder in use is copied into the backup and updated in place; only a file held without sharing stops the upgrade, checked before anything changes (*Program files free*), naming the file and, on Windows, the process that holds it |
| After that failure the way back stopped at "Access is denied" on a Git object, leaving SutraFlow stopped | It copied the whole data folder back, and Git keeps its objects read-only; one error ended the way back before the start | Only what an upgrade changes is restored, each part on its own, and the old version is always started again |
| An installation on an SQLite file of its own (`shop.db`) could not be upgraded: the backup tried `pg_dump` | The upgrader took any `SUTRA_DB` for PostgreSQL, and that setting also names an SQLite file | Only a `postgres://` address is PostgreSQL |

## 2.1.2 release gate

See `docs/releases/2.1.2-packages.md`.

## Previous release: 2.1.1

### In short

- **A web installer and upgrader**, page by page like a CMS installer, or silent from a JSON file. It covers SQLite or PostgreSQL (with pgvector checked and enabled), ports, Node memory and cluster engines. Upgrades from 2.1.0 on make a backup, compare the data and roll back on failure.
- **Safe in a web folder**: unpacked under Laragon `www`, `htdocs` or IIS, a release shows only a page saying how to install it, never its settings or keys.
- **Node memory per engine**, set in the installer or the Admin Console and applied by Restart.
- **Certificates and keys** as files on the server (Windows or Linux), Certificate or Private key properties, or PEM text, in every connection and policy. Secrets are chosen from properties, never typed into a connection.
- **A separate identity for each anonymous visitor** of an agent channel.
- **Connection limits** now cover in-memory Sutras and each call inside a step.
- **Large messages are stored once**: a run with a 4 MB message took 93 ms instead of 536 ms.
- **One soak test** for everything, including the regression suite against real servers.

For PostgreSQL, the installer requires pgvector unless you choose to go on without it (below).

### Upgrade from 2.1.0

Unpack 2.1.1 beside the installation, then run from the new folder:

```
bin/sutraflow upgrade                              # the upgrade pages in the browser
bin/sutraflow upgrade --config upgrade.json        # silent: { "from": "/opt/sutraflow-2.1.0", "start": true }
```

The upgrade runs these steps; if one fails, it puts 2.1.0 back and starts it:
1. Stops SutraFlow gracefully.
2. Backs up the data folder and settings into `backups/2.1.0-<time>`. On PostgreSQL it also runs `pg_dump`, read back with `pg_restore --list` before anything changes.
3. Replaces the program and adds any new settings.
4. Applies the database changes and compares the data with a snapshot taken before.
5. Starts SutraFlow and checks it.

In a cluster, upgrade every engine's folder before starting any of them. Before 2.1.0, upgrade by hand as for earlier releases.

**What changes for you:**
- **Agent channels without a security policy.** An API client keeps its conversation across calls only by sending back its visitor token (the `X-Sutra-Visitor` header). Chat pages and the chat button do this for you. For integrations, a security policy is the better choice.
- **Secrets in connection forms are chosen from Secret properties.** Set or change their values under Configuration, Project variables, or in the Admin Console for engine properties. Connections that already reference a secret keep working.
- **Number properties are checked when saved.** A project holding a malformed number, such as `12,5`, must have it corrected before it can be saved again.
- **A site's own `.htaccess` and `web.config` are kept.** An installation without them gets the release's.

### Web installer and upgrader
- **`sutraflow install`** opens a page-by-page installer in the browser, on that machine only, at a one-time address:
  - welcome and system check;
  - administrator;
  - database: SQLite (a file name of your choice in the data folder) or PostgreSQL;
  - server ports, each checked free, with a free one suggested;
  - Node memory;
  - the cluster: its name, every engine's name, and which engines may lead, with a settings file for each further engine;
  - review, progress and done.

  It writes `sutraflow.env`, makes the tables and the first administrator, then locks itself (`--reset` unlocks it).
- **PostgreSQL**: host, port, database, user, password, SSL (off, require, verify), and create-the-database-when-missing. **Test connection** must pass before going on. It checks:
  - that the server can be reached, and the login;
  - that the database exists, or makes it;
  - the right to create tables;
  - the PostgreSQL version;
  - whether the database already holds SutraFlow data.
- **pgvector is required on PostgreSQL** (knowledge bases and AI memory search). The test enables it in the database (`CREATE EXTENSION vector`) when it is installed on the server. Otherwise it stops and says what to do:
  - **not installed on the server**: install it (the pgvector build on Windows, `postgresql-<version>-pgvector` on Linux, or allow the `vector` extension on a managed service);
  - **installed, but the user may not enable it**: a superuser runs `CREATE EXTENSION vector;` in that database.

  Choose **Continue without pgvector** on the page, or set `"pgvector": "optional"` in the config file, to go on without it; knowledge bases then use the built-in store or another vector database.
- **SQLite**: the database file is always in the data folder, with the master key and the backups; the installer asks for its name (`sutra.db` by default; `SUTRA_DB=shop.db` in `sutraflow.env`). SQLite has no user names or passwords: the file is protected by the data folder's permissions, and passwords and keys inside SutraFlow are encrypted with `master.key`. Choose PostgreSQL for a database with its own logins.
- **Cluster**:
  - a **cluster name**, shown in the Admin Console;
  - a **name for every engine**: this server (default `<machine>-studio`), the engine beside it, and further engines;
  - **May lead** for each engine. The leader runs timers, listeners, recovery and housekeeping. It is elected among the engines that may lead, and another takes over when it stops. Allowing only one fixes the leader, without failover; at least one must be allowed.

  In the Admin Console (Engines), **Name the cluster** and **May lead / Never lead** change these later (`sutra engines cluster-name`, `sutra engines lead <engine> --yes|--no`). The setting is kept in the shared database, so every engine follows it at its next heartbeat. The display names of engines were already changeable there.
- **Upgrade** from 2.1.0 on, as described above.
- **Silent install and upgrade**: `sutraflow install --config install.json` and `sutraflow upgrade --config upgrade.json` run the same steps from a JSON file.
  - Passwords are only ever environment variables or files.
  - Every problem is reported before anything changes.
  - `--dry-run` prints the plan.
  - Exit codes: 0 done, 1 a step failed, 2 the file is wrong.
  - Log: `<data>/logs/installer.log`.
- **`sutraflow setup`** asks for the ports when it makes `sutraflow.env` (or with `--ports`), checking each is free.
- **In a web folder** (Laragon `www`, `htdocs`, IIS `wwwroot`): the release's `.htaccess` (Apache) and `web.config` (IIS) let the web server show only `install-sutraflow.html`. That page says how to install, start and reach SutraFlow, and includes an Apache proxy example. Everything else is refused, so `sutraflow.env`, the data folder and the keys are never served.

### Node memory per engine
- Each engine is its own Node.js process with its own memory; engines do not draw from one shared pool. Its limit (`node --max-old-space-size`) can be set in any of these places; 0 lets Node.js decide, as before:
  - **Node memory** under Admin Console, Engines, Tuning (for every engine or one);
  - `sutra engines tune --memory-mb`;
  - `STUDIO_MEMORY_MB` / `ENGINE_MEMORY_MB` in `sutraflow.env`;
  - the installer: the Server page, and a Memory column for each engine of a cluster.
- The Engines list shows each engine's memory in use against its limit, and the machine's memory.
- A changed value is written by each engine to its own settings file and applies when the engine restarts.
  - **Restart** (or `sutra engines restart <engine>`) lets running steps finish and starts the engine again, for engines started with `sutraflow start`.
  - Engines started by a service manager or Docker show how to apply it there.
- The installer checks the sizes: 0, or 256 MB and more. The processes on one machine must leave at least 15% of its memory for the system.

### Certificates, keys and secrets in connections
- **One setting per certificate or key**, in every connection and security policy that uses one: databases, Kafka, RabbitMQ, ActiveMQ / AMQP 1.0, MongoDB, SFTP, outbound TLS and WS-Security, and inbound JWT, X.509 and SAML. Each takes any of:
  - a **file on the server**, on Windows (`C:\certs\ca.pem`, `\\server\certs\ca.pem`) or Linux (`/etc/ssl/ca.pem`, `~/certs/ca.pem`), optionally with a variable (`{{ev.CERTS}}/ca.pem`);
  - a **Certificate** or **Private key** property;
  - PEM text, which is what existing connections hold.

  On Linux, a backslash in a path is read as a folder separator, so settings written on Windows work. To renew a certificate, replace the file or change the property; the connections themselves don't change.
- **New property types** (project and engine):
  - **certificate**: PEM text or a file path, shown like a string;
  - **private key**: kept in the vault like a Secret, checked to be a PEM private key before it is encrypted, never shown again.
- **Secrets are chosen, not entered.** A password, key or passphrase setting in a connection is a pick of a Secret (or Private key) property; a key can also be a key file on the server. The value is entered once, where the property lives. Entering a value or creating a property from inside a connection is gone.
- Every certificate setting has the variable picker.
- Number properties take decimals (12.5, -0.075, 1e-3) and are checked when saved.

### Visitors on agent channels
- Callers of an agent channel without a security policy are no longer one anonymous caller. Each is a **visitor** with a signed visitor token, made with a key derived from the server's master key. The token comes back in the `X-Sutra-Visitor` response header, and as `visitor` in the chat API answer.
- Conversations, AI memory and job results are bound to the visitor, as they have been for authenticated callers since 2.1.0. A missing, forged or foreign token makes a new visitor, never someone else's.
- The chat page and chat button keep the token in the browser. Traceability shows such runs as started by `visitor <id>`.

### Connection limits: in-memory Sutras and each call
- **In-memory Sutras** can use limited connections. Each step takes a small lease in the shared engine database, renewed while it runs and expiring if its engine stops, so memory and durable Sutras share one cluster-wide limit.
  - With no room, the step waits with a growing pause.
  - A lost lease stops it.
  - If the engine database cannot be reached, the step fails with that reason. Before, such steps were refused.
- **Calls at the same time inside a step** are counted where the client makes them: database queries, procedures and transactions, AI requests and vectors.
  - Each extra call at the same time takes a place of its own, or waits for the step's own place, so a limit of 1 makes them take turns instead of deadlocking.
  - A query inside a transaction is not counted again.
  - MongoDB, HTTP and file connections are still counted per step.

### Large messages stored once
- A part of a run's input over 256 KB (a broker message body and its text, a file's content) is stored once, in the new `payloads` table. The run's input, step inputs and outputs, state and step data carry a small reference.
- Each step gets the whole value, through a cache bounded at 64 MB, and callers always get whole answers.
- Stored parts are removed with the run by retention; in-memory runs keep them when saved.
- 256 KB is where storing once starts, not a size limit: bigger inputs are accepted up to a service's Max body size. `SUTRA_PAYLOAD_STORE_KB` changes it (0 = never); `SUTRA_PAYLOAD_CACHE_MB` sets the cache.
- Measured on SQLite, on the same machine: a run with a 4 MB message used to write about 20 MB and now writes about 4 MB; it took 536 ms and now takes 93 ms.
- Traceability shows a stored part as *Stored once*, with a Download link (needs View permission on the run's project).

### One soak test
- `tools/soak.mjs` is now the one soak test; it is not shipped in the release. `--scenarios` picks the parts:
  - core, files, AI and faults;
  - **Amaron**, a made-up online shop kept between runs: orders, warehouse over RabbitMQ, customer care over ActiveMQ with AI decisions and pgvector, order events over Kafka, and reviews in MongoDB;
  - local RabbitMQ and ActiveMQ, started from their folders when needed;
  - remote Kafka, MongoDB, and remote PostgreSQL and MySQL;
  - the regression suite against the same servers.
- `--connections` reads the services' details from a notes file kept outside the repository.
- Every run has an id, stamped on every row and message it writes and recorded in `amaron.soak_runs`.
- How to run it: `tools/soak/RUNBOOK.md`.

### Fixes in 2.1.1

| What you would have seen | Cause | Now |
|---|---|---|
| A release unpacked under a web root (Laragon `www`, `htdocs`) was served by Apache file by file once installed, including `sutraflow.env` with the database password. | The archives carried no `.htaccess`; only installations set up by hand had one. | Every release carries an `.htaccess` (Apache) and a `web.config` (IIS) that refuse everything except the install page. An upgrade adds them where there are none and keeps a site's own. |
| A visitor of a published agent without a security policy could read another visitor's conversation or job answer by learning its session or job id. | All callers without a policy were one anonymous caller. | Each visitor has its own signed identity; conversations, memory and jobs are bound to it. |
| With large broker messages (2 MB, about 1 MB/s), engine event-loop delays rose from about 40 ms to 400–800 ms and CPU use doubled (2.1.0 soak). | Each message was written about five times per run: run input, step inputs, run outputs, run state, step data. | Large parts of a run's input are stored once and referenced: about 4 MB per run instead of about 20 MB, and 93 ms per run instead of 536 ms. |
| A message published as JSON whose body was written as JSON text with `{{...}}` values (for example `{"orderNo": "{{input.id}}"}`) arrived as a quoted string, and the subscriber found no fields. Found by the 2.1.1 soak. | The body field is text once its values are filled in, and the JSON message type encoded that text again. | Text that is a JSON object or array is published as that JSON; other text stays a string. |
| A number project property written with a comma (12,5), or as text, was accepted and arrived in Sutras as NaN. | Number properties were converted when used, never checked when saved. | A number property is checked when saved. Decimals with a point, negatives and exponents are allowed; anything else is refused with the reason. |
| The first large document learned into a new pgvector knowledge base could fail with `duplicate key value violates unique constraint "pg_type_typname_nsp_index"` (8-hour soak: the first 50 MB document). | Its parts are learned by steps running at the same time, and each tried to make the knowledge table at once; PostgreSQL's `CREATE TABLE IF NOT EXISTS` is not safe against that. The AI memory store made its table on every call, with the same risk. | Each table is made once per engine, every step waiting for it; a race lost to another engine is tried again. |
| On PostgreSQL, the installer went ahead when pgvector was missing; knowledge bases there then failed later. | pgvector was only noted. | The connection test enables pgvector, or stops and says how to install or enable it, unless you choose to go on without it. |

## 2.1.1 release gate

Done on 26 and 27 October 2026, from built 2.1.1 archives, in temporary folders on spare ports. Which check ran on which build is in `docs/releases/2.1.1-packages.md`.

- **Web installer, page by page in a browser.**
  - On SQLite: a busy port was found and a free one suggested.
  - On PostgreSQL: Next was refused until the connection test passed. Test connection made the database and enabled pgvector 0.8.6. The install made 52 tables.
  - Both times, the administrator signs in, a wrong password is refused, and the installer locks itself.
- **Silent install** on SQLite and on PostgreSQL, with Node memory. A cluster engine started from its generated settings file joined the studio.
- **Upgrade from 2.1.0**, with data and a deployed Sutra, on SQLite (twice) and on PostgreSQL. The data compared unchanged and the Sutra from before still runs.
  - **Rollback**: an upgrade to a deliberately broken build failed at start, then put 2.1.0 back with its database and started it.
- **Node memory**: set at install and changed in Tuning, then applied by Restart from the Admin Console with the new limit. This worked for the studio and for a cluster engine in another folder.
- **Web folder**: a release unpacked into Laragon `www` (Apache 2.4) served only the install page. `sutraflow.env`, the data folder, `bin`, `dist`, `docs` and `.htaccess` all returned 403.
- **Connection and property forms** were checked in a browser on a throwaway studio.
- **Full suite** on real PostgreSQL 18 (pgvector) and MySQL: 537 tests, 526 passed, 0 failed, 11 skipped. The skipped tests need outside brokers, Atlas M0, Docker or a remote database with TLS.
- **Runtime check** (`tools/runtime-check.mjs`) of the Linux archive, including the upgrade from the 2.1.0 Linux archive, passed on Windows. It now also runs in CI on Linux.
- **Eight-hour soak**, every scenario (run `amr-2.1.1-20261026-2249-b333`, report `docs/benchmarks/soak-2.1.1-8h-20261026-2252`). Three engines on local PostgreSQL, with Ollama, local RabbitMQ and ActiveMQ, the remote Kafka, MongoDB Atlas and the remote PostgreSQL and MySQL; an engine was killed and the database cut on purpose. **58 of 62 checks passed.**
  - The Amaron shop took 19,058 orders, 1,914 care tickets with 94 AI second opinions, 159 Kafka order events and 478 MongoDB reviews.
  - Every RabbitMQ and ActiveMQ message was delivered (56,131 and 56,133).
  - The four failures:
    - **The first 50 MB document failed to learn**: a real bug, fixed (Fixes table).
    - **ActiveMQ had 2 failed subscriber runs**: their messages were then delivered, and one was finished twice, which fits redelivery after the planned faults. The soak now keeps each failed run's error and time, and passes them only inside a planned fault.
    - **One engine's memory** rose from about 400 MB to 1.2 GB in the last hour, after it learned a 50 MB document, and stayed there; it was steady for the six and a half hours before. This is under investigation (backlog).
    - **Regression run on the same servers** (556 of 566 passed): the new `.htaccess` lacked its licence header (fixed); the MongoDB test was not given its login separately, and one Kafka test needs more than 3 minutes against a remote free-tier broker (both fixed in the soak).
- **Ten-minute soak** on local PostgreSQL, with three engines and Ollama: 25 checks passed, through a planned engine kill and a 20-second database cut.
  - Event-loop p99 was about 36 ms per engine.
  - REST, SOAP and WebSocket p95 stayed steady from the first period to the last.
  - The report is in `docs/benchmarks/soak-2.1.1-10min`.

**Still to do:**
- the 24-hour remote-PostgreSQL soak (runbook: `tools/soak/RUNBOOK.md`; it also covers the large-file and RAG phases, which do not start in ten minutes);
- the first CI run of the Linux runtime job on GitHub;
- a check of `web.config` on IIS.

### 2.1.0 follow-up checks
- A clean install of the final 2.1.0 offline archive passed, and so did the live MongoDB Atlas M0 suite (9 tests). See `docs/releases/2.1.0-packages.md`.

## Previous release: 2.1.0

Packaged 26 October 2026 and deployed to 4800 and Laragon 4810; see `docs/releases/2.1.0-packages.md`.

### Traceability in the Admin Console
- **Operate, Traceability**: each project's Sutras with their runs by outcome over an hour to 90 days, their runs, and each run as stored: what it started with, every step's input and output, error, try, time and engine, its reply and log, and the runs it called or was called by. Find a run by its id, by who started it, or by a value in its input such as an order number; download it as JSON.
- **Started by** is now kept with every run: the account (Run in the designer or Admin Console), the API client (policy method, caller, address, gateway app; anonymous where the route has no policy), the timer, listener, channel or alert, or the calling run. Older runs show the kind of starter only. Separate identities for anonymous callers remain on the backlog.

### Connection limits cover the work behind the scenes, listeners and background jobs
- **Behind the scenes**: a step is counted on the connections it selects *and* on those their settings select: a knowledge base with its vector database and its AI provider, an AI memory with its database and summary provider, a memory table with its database. An AI agent or Search knowledge step is held back when the database behind its knowledge base is full. All the places a step needs are taken at once or none, so two steps never block each other halfway.
- **Listener polls** (SFTP/FTP folders, mailboxes, Google Drive, OneDrive/SharePoint, Discord, Twitch, Data Factory) take a short lease for each poll, renewed while it runs. With no room the poll is skipped, the trigger's status says why, and the next poll tries again; nothing is lost.
- **Scheduled memory-table refreshes** take a lease on the table and its database, waiting up to a minute for room.
- **Subscriptions hold no place** (Kafka, RabbitMQ, ActiveMQ / AMQP 1.0, WebSocket client, Telegram), so a limit of 1 never blocks a subscriber's own Sutra; the steps of the runs they start count as usual.
- **Generous waiting**: a waiting step keeps its place in the queue without using a retry attempt or holding a worker, and its timeout (10 minutes for AI steps) starts only when it runs. Waiting steps are checked again with a pause growing up to 5 seconds. Durable waits (approvals, timers, Call Sutra, agent tools) give the place back.
- **Leases survive a crash safely**: renewed every 30 seconds, they run out 2 minutes after an engine stops; a lost lease stops its poll.
- **Project properties**: a limit can be `{{gv.CRM_LIMIT}}`, so each server has its own value; an invalid value fails the step that needs the connection with a message naming it, and shows in the Admin Console.
- **In-memory Sutras** still refuse a limited connection (fail closed), now also when the limit is on a connection behind the one selected, with a message naming it.
- **Admin Console, Operate, Connection limits**: every limited connection across all engines with its limit (and the property behind it), use by steps and by listener or background work, waiting steps with their reason (for example *Waiting for Orders DB (used through Manuals): 2 of 2 in use*) and a graph of use, waiting and limit over 1 hour to 7 days. The leader samples every 30 seconds and keeps 7 days.
- **User guide**: a new chapter, *Connection limits*, compares this limit with pool size, rate limits, Runs at once, Messages in parallel and Steps at once, lists exactly what counts, explains the effect on listeners and background work, and suggests values per kind of connection.

### MongoDB Bulk Write
- **Bulk write MongoDB documents** sends up to 1000 insertOne, updateOne, updateMany, replaceOne, deleteOne and deleteMany operations to one collection in one request, ordered (stop at the first failure) or unordered. It applies the guards of the single activities (operators for updates, plain replacement documents, no server-side JavaScript, an explicit opt-in for an empty updateMany/deleteMany filter) and strict schema validation of inserted and replacement documents before anything is sent. Any failed operation fails the step with the counts already written and the first errors, so a partial write is never shown as success. Tested live on Atlas M0; the shipped MongoDB sample uses it.

### Admin Console graphs with Apache ECharts
- The Overview's runs and gateway graphs and the new Connection limits graphs use Apache ECharts 6, bundled into the console (no CDN; works offline), coloured from the theme and redrawn when it switches.

### Security
- **Agent conversations belong to their caller.** A conversation that comes through an agent channel (chat page and API, OpenAI-compatible API, MCP, A2A, a hand-off) is kept in AI memory under the authenticated caller, the project and the agent as well as its session id. Another caller sending the same session id starts a conversation of their own. The session id people see is unchanged. Conversations saved before 2.1.0 under a bare session id are not shown to anyone through a channel any more (they stay in the store until its days to keep run out).
- **A job's answer only for the caller who started it.** Asking for a job (chat jobs, OpenAI-compatible `status <id>`, MCP `job`, A2A `tasks/get`) with another caller's job id answers "no such job", as for an id that does not exist.
- The caller includes its **realm**: the security policy that let it in and, for tokens, their issuer. Two identity providers that know the same subject are two different owners.
- Callers without a security policy are all one anonymous caller: their conversations and jobs are protected only by unguessable session and job ids. Put an API security policy on public channels, or wait for visitor tokens (backlog).
- **Connections stay in their project.** A step, a listener poll or Test connection can use connections of its own project and connections that belong to no project (shared), never another project's, however the id arrives (a setting, a property, run data, a connection behind a connection). Saving a connection that points at another project's connection is refused.
- **Mappings cannot reach JavaScript's object machinery.** A target path, a formula's `object()` or a schema field named `__proto__`, `prototype` or `constructor` is refused or ignored, and permission checks trust only flags a caller really holds.
- **Git imports read only the repository.** A schema file, a sidecar or a symlink that points outside the cloned repository is refused before anything is read.
- **Sign-in return paths are plain paths.** The address a person returns to after single sign-on may contain only ordinary path characters, and the page that sends them on escapes it for its script and its link.
- **Zip files are read within limits.** Office documents (64 MB per entry, 256 MB in all, 5000 entries) and release packages (256 MB, 1 GB, 10,000 entries) are refused when an entry unpacks past its limit, measured on the real output, before the memory is used.

### Documentation
- **User guide for the people who use SutraFlow**: Sutra designers, administrators, approvers and, later, developers using the developer portal. A new section in *Mapping data* explains picking data: paths, repeating elements (one item, the last, those that match, a field of every item, totals), filters, For-Each with `{item}`, `{index}` and `{outer}`, and pipes, with the two counting rules (from 1 in formulas, from 0 in text templates). *How a Sutra runs* now describes what designers see; the engine's internals moved to the architecture page.
- **Sutra-Contributor Information** (`docs/Sutra-Contributor Information.html`, in the source repository, generated with the guide) is new: building from source and development mode, where the code is, file headers and overviews, tests and their real-service settings, security rules for contributors, vendored packages, release builds, and the load, soak and big-file test tools. These moved out of the user guide. It is not part of the release packages.
- **Architecture page, The engine**: workers and the two engines, the ten stages of a step (start, queue, claim, admission, prepare, execute, checkpoint, route, wait, finish) with their code and what is stored, retries and recovery, guarantees and limits.

### Backlog
- `docs/backlog.md` is prioritised with MoSCoW. The MongoDB query preview and connection limits for in-memory Sutras were set aside (Could have); an ECharts palette and dashboard hosting are planned for discussion (Should have).

### Database
- Additive: columns `kind`, `holder`, `project`, `since` and `expires_at` on `connection_permits`, and the tables `connection_waits` and `connection_usage`. Existing data is unchanged. Upgrade every engine together: 2.0.11 engines do not know leases and would remove them.

### Fixes in 2.1.0

| What you would have seen | Cause | Now |
|---|---|---|
| A connection limit did not hold back an AI agent or Search knowledge step whose knowledge base used the limited database or AI provider. | Only connections a step selected itself were counted. | Connections behind the selected ones are counted too, all at once or none. |
| Listener polls and scheduled memory-table refreshes used a limited connection beside the steps, so the system behind it saw more than the limit. | Listeners and background work were not counted. | They take a lease for each poll or refresh and are skipped (or wait up to a minute) when there is no room. |
| Many steps waiting for one limited connection kept every engine busy re-checking them at its poll interval. | A waiting step went back to the queue with the same short pause every time. | The pause grows up to 5 seconds, and the reason the step waits is recorded. |
| With the engine database across the internet (650 to 750 ms per operation), work on limited connections crawled and could starve: a lease took 1.2 s to take and 0.7 s to give back, and everything queued behind one lock. | Every admission, lease and release took one cluster-wide lock and cleaned up old rows first, about six round trips each. | One lock per connection (several in id order), admission counts only what still holds a place in four round trips, a release needs no lock, and the leader cleans up every 30 s. Measured on a remote PostgreSQL: a lease 864 ms, a release 163 ms, four capped steps 12.5 s instead of 15.8 s. |
| The Admin Console could not show what used a limited connection or what waited for it. | Permits were not visible anywhere. | Admin Console, Connection limits. |
| The two-engine connection-limit test could, rarely, see a step run twice. | The test's second engine sent no heartbeat, so the leader handed its running steps back as orphans (correct for a dead engine). | The test engine heartbeats; the test also checks that every step runs exactly once. |
| Two callers of a published agent who sent the same session id shared one conversation history. | AI memory was keyed by the session id alone. | Conversations from agent channels are keyed by caller, project and agent as well. |
| A caller who learned another caller's job id could read that job's answer. | A job was checked against the agent's Sutra, not against who started it. | The caller must be the one who started the job; anyone else gets "no such job". |
| A designer of one project could, through a Map target such as `__proto__.all`, change an object shared by the whole server process and make other people's permission checks pass. | Mapping paths were followed into JavaScript's object prototype, and permission checks accepted an inherited flag. | Such path segments are refused or ignored everywhere data is read or written, and only a flag the caller object owns grants anything. |
| A Sutra of one project could use another project's connection (its credentials and data) by its id. | Connections were checked for existence and kind, not for their project. | Steps, listener polls and Test connection run as their project and may use only its own and shared connections; saving a cross-project reference is refused. |
| Importing a Git repository could copy a file from elsewhere on the server into a project as a schema. | A schema sidecar's file name (or a symlink) was joined to the repository path without checking where it led. | Only files inside the repository are read: relative paths, no `..`, symlinks never followed. |
| A crafted single sign-on link could run a script on the page shown right after signing in. | The return path could contain `</script>`, and the page wrote it into a script unescaped. | Return paths may contain only ordinary path characters, and the page escapes them for script and HTML. |
| With two identity providers on one agent, two people with the same user name could see each other's agent jobs and conversations. | The owner of a job or conversation was the subject alone, without the provider. | The owner includes the realm: the policy and the token issuer. |
| A small uploaded document or release zip could unpack to gigabytes and exhaust the server's memory. | Zip entries were unpacked without a size limit. | Per-entry, total and entry-count limits, measured on the real output. |
| *(found before release)* A connection limit naming a Secret property, or an invalid limit, could show the property's value in an error message to anyone watching the connection. | The error repeated the resolved value. | Secret properties are refused in limits (on save and at run time) and the message describes the problem without the value. |
| *(found before release)* On a connection shared by all projects, the Admin Console showed the names of other projects' Sutras, steps, runs and listeners. | Usage details were not filtered by the viewer's projects. | Other projects' work is counted but shown only as "Work of another project". |
| *(found before release)* When the engine database stopped answering, a listener poll could go on after its lease had run out, beside work that took its place. | Failed renewals were ignored until the database answered again. | The work is stopped a quarter of the lease before the expiry the database holds, unless a renewal reached it. |
| *(found in the 2.1.0 soak)* Two DB Ops transaction steps running at the same time on one SQLite connection could fail with "cannot start a transaction within a transaction", and a plain statement of another step could become part of a transaction that was still open. | A SQLite connection is a single database handle, and a transaction stays open while its step works through its statements; nothing kept other steps out meanwhile. | Each SQLite connection runs one transaction or statement at a time, in turn; PostgreSQL, MySQL, SQL Server and Oracle already give each transaction its own pooled connection. |
| *(found in the 2.1.0 soak)* During a 20-second cut of the engine database, one engine stood still for 23.6 seconds: no request, listener or step moved on it. | Some work reads the engine database synchronously; after a lost connection the database worker tried 10 times with growing waits (about 40 seconds) while the engine waited. | After a lost connection a statement tries once with a short time limit and fails at once; the work around it retries on its own. An administrator can set tries, wait between them and time per try (Admin Console, Database), and the page shows the longest pause they give. Start-up still tries 10 times. |
| *(found in the 2.1.0 soak)* Engine memory grew with the number of runs finished, faster on engines that only helped with runs. | Each engine kept the Sutra document of every run whose steps it ran; only the engine that ended a run dropped it. | Documents of runs are dropped once unused for 10 minutes (a run still going reads its document again). A test checks that the garbage collector frees finished runs. Waiters for a run removed by retention are answered instead of kept. |
| *(found in the 2.1.0 soak)* Knowledge search in PostgreSQL slowed as the knowledge base grew (1.7 s to 26.6 s at 457,034 passages). | The pgvector table had no search index, so every search compared each passage. | New tables get an HNSW search index; existing tables are indexed from Admin Console, Knowledge search (or a Remove knowledge step, build search index). Searches use iterative scans, so a small knowledge base in a shared table keeps its full results. Needs pgvector 0.8. |
| *(found in the 2.1.0 soak)* A Kafka publish failed when a hosted broker dropped the connection while signing in. | The error went straight to the step. | Nothing was sent then, so the message goes once more on a new connection; other errors are the step's, as before. |
| *(found while fixing the soak findings)* A memory-table change could stay in memory while its database copy failed to take it, so other engines, and this one after a crash, lost it. | The change was made in memory before it was written to the copy. | A change the copy does not take is taken back from memory and the step fails; its retry makes it again. |
| *(found in the 2.1.0 soaks)* A Kafka subscriber on an existing topic missed messages: 1 of 118 in six hours, 3 of 8 in ten minutes with an engine kill and a database cut. | A new consumer group has no committed offset on a partition until its first message there is handled; when the partition moved to another engine, the new owner started at "latest" and skipped what had arrived. | When a Sutra starts listening (not from the beginning), the topic's end is recorded as the group's starting point, so every later owner resumes from there. |
| *(found in the 2.1.0 ten-minute soak)* After a database cut moved the cluster leader, the ActiveMQ subscriber stopped receiving; 271 messages waited in the queue. | The new leader opened its listener under the same AMQP container id the old leader still held, ActiveMQ refused it, and a listener that failed to start was never tried again. A failed start also left its connection reconnecting in the background. | Queue listeners get a container id per engine (durable topic subscriptions keep theirs); a listener that fails to start is tried again (5 s doubling to a minute) until it starts; a failed start closes its connection. |
| *(found in the 2.1.0 ten-minute soak)* During a database cut, an engine stopped; runs stayed "running" with every step done; steps stayed "running" on a live engine. | A statement now fails at once when the database is away (see above): a timer's read went uncaught, and closing writes that failed were never retried; a step that failed to prepare stayed listed as running in its engine. | Database-unreachable errors in timers are logged and tried at the next tick; the leader closes runs whose steps all ended, each engine puts back steps it no longer runs, and a step is never left listed as running. |
| Docker and guide examples named older versions (2.0.4, 2.0.7). | They were not updated with each release. | They name 2.1.0. |

## 2.1.0 release gate

Source verified 25 and 26 October 2026 on Windows (Node.js 24.21).

- Full suite after the security fixes (26 October): **504 cases, 493 passed, 9 skipped**; the 2 failures were the README test count (one direct, one in the PGlite pass), corrected and rerun. With real PostgreSQL 18 and MySQL 8.4 together, the password-and-SSL PostgreSQL migration (Laragon's PostgreSQL binaries) and the live MongoDB Atlas M0 suite, which includes Bulk Write. The 9 skips need services not set up on this machine: a Linux Docker daemon, Kafka, RabbitMQ and ActiveMQ brokers with their REST checks, and the remote-database scenario.
- The PostgreSQL-compatible (PGlite) pass runs every in-process suite again, including the new connection-limit and security suites.
- Security review findings: each is reproduced by a test that now fails safely (`test/security210.test.ts`, the two-caller tests in `agentchannel.test.ts`, and `connlimits.test.ts`).
- Connection limits on a **remote PostgreSQL across the internet** (about 70 ms per round trip, 500 to 700 ms per transaction): before the security fixes 10 of 10 passed; after them 12 of 13, the lease test stopped once while the pooled endpoint dropped a connection ("server conn crashed?"), as the renewal deadline intends, and passed in two reruns. A probe on the same database showed a 6-second lease renewed every 0.75 s in about 80 ms and held for 13.5 s. The suite measures the database and stretches its time budgets (15 times over the internet); its temporary databases were removed.
- Connection limits on local PostgreSQL with two engines: repeated 10 times, every step ran exactly once and never beside another under a limit of 1.
- Type checks, production build, `npm audit` (0 vulnerabilities), file-overview drift check and documentation generators passed. The Admin Console's Connection limits page and ECharts graphs were checked in a browser on a separate test instance (light and dark theme, no console errors).

Not covered: Linux runtime, the 24-hour remote soak (Must have in the backlog), and certification of the connectors behind the skipped suites.

## Previous release: 2.0.11

Packaged and deployed to 4800 and Laragon 4810 on 25 October 2026; see `docs/releases/2.0.11-deployment.md`.

Core scope: schema-boundary audit, durable per-resource activity admission and code-maintenance housekeeping. Generic Map, MCP input/result, AI Guard and SOAP request/response/reply boundaries now have explicit enforcement; descriptive defaults remain compatible. Connection limits are shared by durable task claims across engines, acquire multiple explicit resources atomically and queue excess work without retry/worker consumption. Capped resources reject in-memory execution rather than silently bypassing admission. Limits do not cover implicit nested integrations, listeners or admin traffic and do not retract external side effects.

First-party files now carry maintainable overview comments with purpose/support, connected imports and function entry points. Non-comment configuration formats have a companion code-navigation index; generated/vendor/private files are excluded. A check-only regression detects drift. The 2.0.10 backlog/deployment history is reconciled with the actual 4800/4810 receipts.

Verification: 437 passed, 0 failed and 27 optional skips in the full suite (including the PostgreSQL-compatible suite); six additional real local PostgreSQL cases passed. Production build, type checks, documentation generators, overview/header gates and dependency audit passed. MongoDB read-only query preview and mixed Bulk Write remain optional next work, not claimed as implemented. X.509 live testing stays deferred. No 2.0.11 deployment or release package is implied by this source change; final evidence and limits are recorded in docs/releases/2.0.11-verification.md.

## Previous release: 2.0.10

Prepared 2026-10-24. Copyright (c) 2026-27 Surya Partap Singh, MixAgile.com. AGPL-3.0-only; a commercial licence is available.

### 25 October usability revision — verified for packaging

Aggregate input follow-up: pipeline help and guide examples distinguish database stages from incoming records. Source lines recognize run/process aliases; previews require current-run context and discard obsolete responses. MongoDB design-time output shapes follow Find/Count/Distinct and Update operation choices, with declared result schemas exposed without collection sampling. Sample descriptions explicitly identify final Delete cleanup. Focused checks: eight passed plus one optional skipped; separate live M0 checks: eight passed. See [Aggregate input verification](docs/releases/2.0.10-aggregate-input-usability.md); this focused follow-up does not replace the earlier full-suite release evidence.

Named Secret connection refinement: credential dropdowns show Secret GVs and administrator Secret EVs, not vault implementation keys. A permission-checked API stores each named project Secret and its backing reference transactionally, reuses that property's entry on rotation and prevents cross-project name collisions. Existing legacy references are preserved. MongoDB diagnostics distinguish DNS failure before authentication from credential-bearing public server URI misuse. Administrators can explicitly set SUTRA_DNS_SERVERS for the Node process only; no operating-system DNS change or implicit public-resolver fallback is made.

Follow-up project-variable correction: the variables Save button encrypts pending Secret text and persists its reference in the same workflow. Failed Secret storage aborts the property save. Existing variables start collapsed with +/− controls; new variables open for editing. Stable editor identities prevent one row inheriting another row's Secret draft after deletion. A selected reference is retained even if it is not listed in the current secret catalogue. The isolated browser save→refresh case and 16 focused credential/project tests passed; this is additional focused evidence, not a new full-suite or external-service recertification.

- MongoDB palette/connection branding is generic; Atlas M0 remains the tested baseline, not an implied compatibility certificate for other services.
- Separate host/SRV/port, username/password and complete-URI configuration, plus X.509 certificate/key options, private CA trust and read preference. Non-TLS is restricted to direct loopback development. No automatic database-user provisioning or admin grants.
- Secret project/engine properties can store encrypted values directly from their editors. Connection credential slots prefer Secret properties and resolve their vault reference once. Inline secret entry is available on other connection forms too. Values are masked by default; an eye reveals only text being entered, never retrieves an existing stored password. Existing permissions remain unchanged.
- Project variable editors use full-width cards so names, types and Secret entry remain readable in the narrow Designer panel.
- Credential lookup failures withhold supplied reference/value text instead of echoing a credential-bearing URI. Existing complete-URI configurations remain compatible.
- New List Collections activity and sample coverage; mapped collection input takes precedence over General configuration. Updates support array filters and findOneAndUpdate with Before/After documents.
- Aggregation remains read-only/no-spill in the M0 baseline. General MongoDB capabilities require explicit disk/output-stage opt-in and server authorization; X.509 and these advanced deployment options need separate live certification.
- The updated sample imports a Secret MONGODB_URI project property and does not replace a customized existing property or connection. The usability revision was deployed to 4800 and Laragon 4810 on 25 October with fresh backups and preservation checks; see the [deployment receipt](docs/releases/2.0.10-usability-deployment.md).
- Verification: 427 passed, 27 optional skipped, zero failures in the full regression; eight live M0 checks passed; final build/type checks and documentation generation passed; dependency audit found zero vulnerabilities. Live X.509 testing is explicitly deferred. P1/P2 MongoDB expansion remains in the backlog. See the dated verification amendment for scope and limitations.

### Implemented for verification

- Manual start has explicit strict schema validation. Engine admission rejects invalid configured/supplied input before creating a run; execution rechecks the actual payload. Off remains descriptive for existing flows, with an explicit warning.
- Strict contracts are project-scoped, do not coerce/remove/default data, and reject unsupported JSON Schema validation keywords instead of silently ignoring them.
- REST, SOAP and WebSocket reject-invalid modes also apply to direct engine, Test/Debug and Run API inputs, closing gateway-only enforcement gaps. SOAP admission uses real XSD pattern/namespace validation.
- Call Sutra has independent strict input/result controls, including resumed child results; Return and internal channel send/receive also have explicit contract controls.
- Strict local/remote file triggers reject invalid parsed test events and read-error envelopes before downstream processing. Strict file reading with an incompatible format fails explicitly.
- The source browser consolidates the unique immediate predecessor into current input. Earlier/parallel sources remain separate; existing named-output formulas remain valid.
- Native MongoDB connection and five M0-verified document activities: insert; find/find-one/count/distinct; update/update-many/replace/upsert; delete; read-only aggregation. TLS is verified, URI credentials use the vault, clients are pooled with bounded operations, and BSON is preserved as Extended JSON.
- Credential-free, run-ID-scoped MongoDB sample with imported strict starter schema, query modes, update, aggregation and precise deletion. New typed mapping imports also enable strict starters; customized imports are not overwritten.
- A regression inventory records every schema-aware activity/field so new contract fields require explicit review and negative tests.

### Scope and verification status

Live Atlas M0 seeded engine checks passed on MongoDB 8.0.34, including CRUD/query/aggregate behavior, duplicate-key rejection, strict invalid-input/no-write and invalid-output behavior, and the executable lifecycle sample. M0 driver-level probes also passed transaction rollback, change streams and a small GridFS round-trip; these are not finished/certified activities and are not exposed in the palette.

The default local DNS resolver refused SRV lookups; live verification used a process-local alternate resolver. Windows DNS and Atlas permissions were not changed. This environment caveat must remain in certification.

Build and server/web/test type checks passed. Full regression passed with 424 passed, 27 optional skipped and no failures; the separate opt-in Atlas gate passed all seven checks. Dependency audit reports zero vulnerabilities. The guide and architecture are regenerated. See [verification scope and limitations](docs/releases/2.0.10-verification.md).

Every exposed MongoDB activity is covered by the lifecycle sample, available both in the sample catalogue and as `samples/mongodb-m0-document-lifecycle.zip`. Its connection contains only a vault-secret name, never credentials.

The broader schema-boundary audit, advanced durable MongoDB activities and fresh interactive UI review remain in the canonical backlog. Packaging and deployment to Laragon 4810 are the current user-requested handoff; 4800 is not part of this upgrade. No commit/tag is made.

Previous release: [2.0.9](docs/releases/2.0.9.md).
