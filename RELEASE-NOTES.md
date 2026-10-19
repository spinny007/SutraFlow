# SutraFlow 1.7.6 release notes

Released 2026-10-20. Copyright (c) 2026-27 Surya Partap Singh, [MixAgile.com](https://mixagile.com). Licensed under the GNU Affero General Public License v3.0 only (AGPL-3.0-only); a commercial licence is available, see `COMMERCIAL-LICENSE.md`.

| Download | For |
|---|---|
| `sutraflow-1.7.6-windows.zip` | Windows 10, 11 and Windows Server 2019 or later |
| `sutraflow-1.7.6-linux.tar.gz` | Linux (x64 or arm64); also macOS |

Each comes with a `.sha256` file to check the download.

## What is new since 1.7.5

### Asynchronous PostgreSQL storage
- **The engine works with PostgreSQL through a pool of connections** instead of one synchronous connection, so one engine overlaps the database work of many steps. Measured with REST calls spread over the engines (results in `docs/benchmarks`):

  | Scenario | 1.7.5 | 1.7.6 |
  |---|---|---|
  | 1 engine, local PostgreSQL | 153 steps/s | 719 |
  | 4 engines, local PostgreSQL | 457 | 1,602 |
  | 1 engine, database 28 ms away | 3.4 | 102 |
  | 4 engines, database 28 ms away | 17.7, 125 steps run twice | 622, none |
  | 1 engine, SQLite | 390 to 412 | 419 to 427 |

- **Explicit transactions.** Each transaction hands its body its own query object; a synchronous write or transaction while an asynchronous one is open is refused, never mixed in.
- **Fencing.** Every claimed step carries a claim number; a completion, failure or retry applies only while the same engine still holds the same claim, and a run ends exactly once. A slow engine whose step was taken over can no longer overwrite the newer result.
- **Fewer round trips.** Several steps are claimed in one statement together with their runs; the begin, the lock and the run travel together, and the last statement goes with the commit.
- **Pool figures** on `/metrics`: connections (size, open, idle), waiting acquisitions, acquire, transaction and query times, retries. Also in *Admin Console → Engines → This machine*.
- Deadlocks and serialization failures are retried.

### MySQL, SQLite and the in-memory store
- They keep their single connection, now behind the same transaction interface; their steps take turns as before. SQLite gains a cache of prepared statements and stays at least as fast as 1.7.5.

### Other changes
- The gateway's request log is written without holding the engine, and its firewall rules are cached for 2 seconds.
- Fixed: SOAP X.509 signing printed a deprecation warning from the XML signature library; the signature is now placed in the Security header through the supported call.
- Load test: `--db-latency` (a measured delay between engine and database), `--profile` (CPU profiles of every engine), `--spread`.
- Guide: load balancer and database connection sections in the production chapter; corrected SQLite and PostgreSQL advice.
- The README test badge is kept equal to the test files by a test; the tests are type checked with the server.
- New settings: `SUTRA_PG_POOL` (connections per engine, default from Steps at once), `SUTRA_PG_ASYNC=0` (the 1.7.5 synchronous connection, as a fallback), `SUTRA_COUNT_SYNC_SQL` (diagnostic).

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
   (Get-FileHash .\sutraflow-1.7.6-windows.zip -Algorithm SHA256).Hash.ToLower()
   Get-Content .\sutraflow-1.7.6-windows.zip.sha256
   ```
   The two values must match.
3. Unpack it, for example to `C:\SutraFlow`:
   ```powershell
   Expand-Archive .\sutraflow-1.7.6-windows.zip -DestinationPath C:\SutraFlow
   cd C:\SutraFlow\sutraflow-1.7.6
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
   sha256sum -c sutraflow-1.7.6-linux.tar.gz.sha256
   ```
3. Unpack it, for example to `/opt`:
   ```sh
   sudo mkdir -p /opt/sutraflow && sudo chown "$USER" /opt/sutraflow
   tar -xzf sutraflow-1.7.6-linux.tar.gz -C /opt/sutraflow
   cd /opt/sutraflow/sutraflow-1.7.6
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

## Upgrade from 1.7.5 or 1.6.x

1. Back up: the data folder with `master.key`, and for PostgreSQL a `pg_dump` of the database.
2. Stop gracefully: `sutraflow stop all` (running steps finish first).
3. Unpack 1.7.6 into a new folder beside the old one. Copy `sutraflow.env` from the old folder; keep `SUTRA_DATA_DIR` pointing at the same data folder (or copy the folder).
4. Run `sutraflow setup`, then `sutraflow start`. The database is upgraded at start (from 1.7.5: the `claim` column of `tasks`; from 1.6: also the new indexes and the memory table tables); nothing is removed.
5. In a cluster, **upgrade every engine before starting any of them again**: older engines do not fence claimed steps and must not share a database with 1.7.6 engines.
6. On PostgreSQL, check `max_connections`: each engine opens its pool (`SUTRA_PG_POOL`, at most 20 by default) plus one connection. Engines × (pool + 1) must fit, with room for other clients.
7. Optional: *Admin Console → Engines → This machine → Apply recommended tuning*.

To go back, stop 1.7.6, start the old folder, and restore the backup if 1.7.6 already ran on the data (the added column is not used by older versions, so the data stays readable).

## Docker

The images are built from the source repository (`Dockerfile`, `docker-compose.yml`): `docker build -t sutraflow:1.7.6 .`. The release archives are for installs without Docker.

## Known limitations

- MySQL and the other single-connection stores run one transaction at a time per engine; use PostgreSQL for the highest throughput.
- Engines poll the work queue; a long soak (8 to 24 hours) on a separate database machine is still to be run.
- A Sutra that runs in memory loses the runs open at a restart, and cannot wait (approvals, Call Sutra with wait).
- Memory tables are for small reference data: at most 100,000 rows and 256 MB each.
- See also *Known limitations* in `README.md`.
