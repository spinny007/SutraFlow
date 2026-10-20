# SutraFlow 1.8.0 release notes

Released 2026-10-20. Copyright (c) 2026-27 Surya Partap Singh, [MixAgile.com](https://mixagile.com). Licensed under the GNU Affero General Public License v3.0 only (AGPL-3.0-only); a commercial licence is available, see `COMMERCIAL-LICENSE.md`.

| Download | For |
|---|---|
| `sutraflow-1.8.0-windows.zip` | Windows 10, 11 and Windows Server 2019 or later |
| `sutraflow-1.8.0-linux.tar.gz` | Linux (x64 or arm64); also macOS |

Each comes with a `.sha256` file to check the download.

## What is new since 1.7.6

### Leaner run state
- Each step writes only its own output (a table of step outputs) instead of the run state with every earlier output. One engine on PostgreSQL:

  | Output per step | 1.7.6 | 1.8.0 |
  |---|---|---|
  | 0.1 KB | 719 steps/s | 845 |
  | 64 KB | 60 | 145 |
  | 256 KB | 14.3 | 40.7 |
  | 1 MB | 2.6 | 7.7 |

- Runs started by an older version (their outputs in the state) go on after the upgrade.

### API security
- **Message validation**: REST bodies against a JSON Schema (drafts 07, 2019-09, 2020-12), a JSON sample or an XSD element; SOAP operations against an XSD element. *Validate requests: reject invalid* answers 400 with the errors, or a Client fault, before a run starts.
- **Threat protection** on every API security policy: nesting depth (checked before parsing), fields, list items, text length, body size. XML with a DOCTYPE is always refused.
- **HMAC-signed requests**, incoming and outgoing: timestamp and body, or method, path, timestamp and body, or the body only; several secrets while one is replaced; old timestamps and replays refused on every engine.
- **OAuth token introspection** for opaque access tokens, with audience and scopes; answers kept until the token expires.
- **Scopes per REST service and per SOAP operation**, from tokens and gateway apps.

### WS-Security completed
- Incoming **X.509 signatures**: the certificate trusted (listed, or issued by a listed CA), Body and Timestamp signed, one Body only.
- Incoming **SAML assertions**: the identity provider's signature, issuer, audience and validity.
- **Timestamps** checked with an allowed clock difference, and can be required.
- **XML encryption** both ways: encrypted requests decrypted with the service's key (and can be required); outgoing calls encrypt the Body for the receiver after signing. AES-GCM or AES-CBC, keys by RSA-OAEP; RSA 1.5 refused.

### The Approval Center
- A page of its own for business people, `/approvals` on every server: approvals and questions waiting for the signed-in person, everything they may see, and what was decided; it works on a phone and signs in with a password or single sign-on.
- Human approval and Ask a person steps name their approvers: roles and/or accounts (from the data too), any one of them, all of them or a number of them; details shown as labelled fields; a comment required on rejection. Only those people decide; administrators can decide on their behalf, recorded so.
- A due time that escalates to other roles or goes on through an *expired* output; reminders and email notices through an SMTP connection; every vote kept in the run and the history.
- The Admin Console's Approvals page lists what waits and for whom, and opens the Approval Center.

### Single sign-on
- People sign in to the designer and the Admin Console with an OpenID Connect provider (authorization code with PKCE, state and nonce; the ID token checked against the provider's keys). Accounts are created or linked only when allowed; roles follow the provider's groups. Password sign-in stays available. Admin Console → Users → Single sign-on.

### WebSockets
- **WebSocket service** trigger on the gateway: a run per message (in order per connection), and on connect and disconnect; the same security policies, with the token or key in the query for browsers; size, nesting and schema checks.
- **WebSocket send**: answer, push to a connection, broadcast to a service, close; across engines through the database.
- **WebSocket connections**, a **client trigger** that reconnects and subscribes again (leader engine), and a **client send** step that can wait for its answer.

### Clusters and operations
- `SUTRA_CAN_LEAD=0` keeps an engine from becoming the leader (for machines that cannot reach watched folders); the Admin Console shows *never leads*.
- `sutra_event_loop_delay_ms` on `/metrics`: how long work waited for an engine's event loop.
- Read remote file (SFTP, FTP) can **stream** big CSV and line files in batches, like Read file.
- Microsoft OAuth connections have a **Tenant** setting: apps registered for one organisation sign in at its tenant (they refuse the common endpoint).
- User guide: *OAuth connections step by step* for Google (Drive, Sheets, Docs, YouTube), Microsoft (SharePoint, OneDrive), Dropbox, Facebook, Twitch and custom services, from creating the client to signing in on production servers; how to find folder and file IDs; troubleshooting.
- Google Drive reads big CSV and text files **as they download**, in batches of rows, without saving them (*Save to: rows in batches*).
- Google Drive uploads a **server file streamed** (a resumable upload), and has *Wait for each call* (5 minutes by default) for slow links; Drive steps get a 30-minute time limit.
- Built-in knowledge bases write and read through the connection pool in batches, and make vectors in slices, so learning a big document no longer holds the engine.
- A new user guide chapter, *Setting up a cluster, step by step*: one machine, two machines, engines only, Docker; what every engine and what the leader does. And *WebSockets: live connections*.

### Soak test
- `tools/soak.mjs` runs unattended for hours on a cluster: every starter that runs on one machine (REST, SOAP with WS-Security, WebSocket service and client, timer, called Sutras and approvals, error handler, channels, MCP, a message bus, SFTP and folder files of 10 to 60 MB, RAG documents of 10 to 60 MB, an AI agent on a local Ollama model), with an engine killed and the database cut on the way. Database connections are tried 10 times, engines that stop are started again, and it writes `report.md` and `report.html` itself. The 1.8.0 run: 8 hours, 500,338 requests, 0.089% failed with the engine kill and the database cut included; 50 CSV files of 10 to 60 MB streamed whole through a folder, SFTP and FTP; 328,490 passages learned into pgvector. Its report and notes are in `docs/benchmarks/soak-1.8.0`.

### New settings
`SUTRA_CAN_LEAD`, `SUTRA_PUBLIC_URL` (the studio's address behind a proxy, for single sign-on).

## Fixes in 1.8.0

What went wrong before, and what happens now. Most were found by the soak test (`docs/benchmarks/soak-1.8.0`).

| # | What you would have seen | Cause | Now |
|---|---|---|---|
| 1 | After PostgreSQL restarted or the network to it dropped for a moment, an engine stopped answering: pages and API calls waited, and every request took two minutes to fail. Only restarting the engine helped. | The engine's background connection to the database ended itself when the connection was lost, and nothing opened a new one. | The engine opens the connection again by itself (up to 10 tries, with growing waits). A statement that may already have run is never sent twice, and a transaction that lost its connection is rolled back instead of half committed. |
| 2 | An engine started (or restarted) while the others were busy sometimes stopped at once with "deadlock detected", and was started again by the service manager. | At start, every engine re-ran the database set-up statements, which lock tables the running engines are writing. | An engine joining a running cluster finds the tables there and runs no set-up statements; a deadlock during a real set-up is tried again. |
| 3 | An engine stopped by itself when the database came back after an outage. | A trigger (folder, mailbox, queue, timer) started a run while the database was unreachable, and the failure was not caught; Node stops a process for that. | The trigger shows "A run could not start" on its listener (the file or message is tried again later), and the server logs any such failure and keeps running. |
| 4 | Learning a big document into a built-in knowledge base (tens of MB) made the whole engine unresponsive for seconds to minutes; API calls and other runs waited. | Passages were written one by one through the engine's blocking connection, and vectors were made without a pause. | Passages are written in batches through the connection pool and vectors are made in slices, so the engine keeps serving. For big or many documents the guide now points to a vector database such as pgvector. |
| 5 | Reading a big CSV from SFTP or FTP (tens of MB) slowed every other run and request on that engine, and could run it out of memory. | The whole file was read into one step output. | *Read remote file* can stream CSV and line files in batches, one batch in memory at a time, like *Read file*. |
| 6 | Uploading a big file to Google Drive needed the whole file in a step's output, and calls on a slow link failed after 60 seconds. | Uploads took their content from the step input, and Drive calls had a fixed one-minute limit. | *Upload from: server file* streams the file in a resumable upload; *Save to: rows in batches* reads CSV and text files as they download, never saved; *Wait for each call* (5 minutes by default) and a 30-minute step limit suit slow links. |
| 7 | A Microsoft (SharePoint, OneDrive) connection registered for one organisation could not sign in: "AADSTS50194". | Sign-in always used Microsoft's shared "common" address, which such apps refuse. | Microsoft connections have a *Tenant* setting. |
| 8 | The *Assignee* of a Human approval step was only a label: anyone with the Approve permission on the project could decide any approval. | Approvers were not part of the step. | Steps name their approver roles and accounts, and only those people decide (administrators on their behalf, recorded so). Steps that name nobody keep the old behaviour. |
| 9 | Sutras whose steps pass big data along got slower with every step, and 1 MB outputs managed about 2.6 steps a second. | Every step rewrote the run's state with the outputs of all earlier steps. | Each step writes only its own output (7.7 steps a second with 1 MB outputs; 145 with 64 KB, was 60). |

## In 1.7.6

- Asynchronous PostgreSQL storage: a connection pool, explicit transactions, fencing of claimed steps. One engine 153 to 719 steps a second; four engines 1,602; a database 28 ms away 3.4 to 102.
- Pool figures on `/metrics`; SOAP X.509 signing without the deprecated call; `SUTRA_PG_POOL`, `SUTRA_PG_ASYNC`.

## Since 1.6.0 (in 1.7.5)

- Engines scale: PostgreSQL write transactions lock one run, steps are claimed with `skip locked`; about half the database work per step.
- Sutras that run in memory (*Execution* tuning) for short request-reply work; *Stream in batches* for big files.
- Memory tables for small reference data, with an admin page, hot reload and `=memory-lookup()`.
- Sizing by machine, engine display names, new tuning settings.
- Reliability fixes for heavy load, shared SQLite files and stopping servers; idle connections kept 65 s for load balancers.
- Copyright and AGPL headers on every source file.

## Requirements

- **Node.js 24** (the LTS line). Check with `node -v`.
- Internet access to the npm registry once, during `setup` (or a local npm mirror).
- Disk: about 400 MB for SutraFlow and its packages, plus your data.
- Memory: 1 GB is enough for a small server with SQLite (see the guide chapter *Sizing and performance*).
- Optional: PostgreSQL 14 or later for several engines.

## Install on Windows

1. Install Node.js 24 from nodejs.org (or with nvm-windows) and open a new PowerShell window.
2. Check the download:
   ```powershell
   (Get-FileHash .\sutraflow-1.8.0-windows.zip -Algorithm SHA256).Hash.ToLower()
   Get-Content .\sutraflow-1.8.0-windows.zip.sha256
   ```
   The two values must match.
3. Unpack it, for example to `C:\SutraFlow`:
   ```powershell
   Expand-Archive .\sutraflow-1.8.0-windows.zip -DestinationPath C:\SutraFlow
   cd C:\SutraFlow\sutraflow-1.8.0
   ```
4. Install the runtime packages and make the settings file:
   ```powershell
   .\bin\sutraflow.cmd setup
   ```
5. Review `sutraflow.env` (ports, `SUTRA_ENVIRONMENT`, the data folder). The defaults run the studio at http://127.0.0.1:4800 with SQLite in `data\`.
6. Start and open it:
   ```powershell
   .\bin\sutraflow.cmd start
   .\bin\sutraflow.cmd open
   ```
   The first visit asks you to create the administrator account.
7. Start with Windows (optional): `.\bin\sutraflow.cmd service` prints the scheduled-task command to run in an administrator terminal.

## Install on Linux

1. Install Node.js 24 (from your distribution, NodeSource or nvm).
2. Check the download:
   ```sh
   sha256sum -c sutraflow-1.8.0-linux.tar.gz.sha256
   ```
3. Unpack it, for example to `/opt`:
   ```sh
   sudo mkdir -p /opt/sutraflow && sudo chown "$USER" /opt/sutraflow
   tar -xzf sutraflow-1.8.0-linux.tar.gz -C /opt/sutraflow
   cd /opt/sutraflow/sutraflow-1.8.0
   ```
4. Install the runtime packages and make the settings file:
   ```sh
   bin/sutraflow setup
   ```
5. Review `sutraflow.env`. Keep `SUTRA_ADMIN_HOST=127.0.0.1` and put a reverse proxy with TLS in front for access from other machines.
6. Start and open it:
   ```sh
   bin/sutraflow start
   bin/sutraflow status
   ```
   Browse to http://127.0.0.1:4800 (through an SSH tunnel on a remote server); the first visit asks you to create the administrator account.
7. Start at boot (optional): `bin/sutraflow service` prints a systemd unit with the steps to enable it.

## Upgrade from 1.7.x or 1.6.x

1. Back up: the data folder with `master.key`, and for PostgreSQL a `pg_dump` of the database.
2. Stop gracefully: `sutraflow stop all` (running steps finish first).
3. Unpack 1.8.0 into a new folder beside the old one. Copy `sutraflow.env` from the old folder; keep `SUTRA_DATA_DIR` pointing at the same data folder (or copy the folder).
4. Run `sutraflow setup`, then `sutraflow start`. The database is upgraded at start (from 1.7.6: the tables `run_outputs`, `replay_guard`, `ws_connections` and `ws_outbox`, and the columns `users.idp_subject` and `engines.can_lead`; from 1.7.5 also `tasks.claim`; from 1.6 also the new indexes and the memory table tables); nothing is removed. Runs that were open go on.
5. In a cluster, **upgrade every engine before starting any of them again**: 1.8.0 engines keep step outputs apart from the run state, which older engines do not read, so the two must not share a database.
6. On PostgreSQL, check `max_connections`: each engine opens its pool (`SUTRA_PG_POOL`, at most 20 by default) plus one connection. Engines × (pool + 1) must fit, with room for other clients.
7. Optional: *Admin Console → Engines → This machine → Apply recommended tuning*.

To go back, stop 1.8.0 and restore the backup taken before the upgrade: runs that 1.8.0 ran keep their outputs in a table older versions do not read.

## Docker

The images are built from the source repository (`Dockerfile`, `docker-compose.yml`): `docker build -t sutraflow:1.8.0 .`. The release archives are for installs without Docker.

## Known limitations

- MySQL and the other single-connection stores run one transaction at a time per engine; use PostgreSQL for the highest throughput.
- Engines poll the work queue (waking them through LISTEN/NOTIFY is on the roadmap).
- The soak test ran with PostgreSQL on the same machine; a run with the database on its own machine is on the roadmap.
- SOAP replies are not encrypted for the caller; SAML sign-on for people is not offered (OpenID Connect is).
- A Sutra that runs in memory loses the runs open at a restart, and cannot wait (approvals, Call Sutra with wait).
- Memory tables are for small reference data: at most 100,000 rows and 256 MB each.
- See also *Known limitations* in `README.md`.
