# SutraFlow 1.7.5 release notes

Released 2026-10-19. Copyright (c) 2026-27 Surya Partap Singh, [MixAgile.com](https://mixagile.com). Licensed under the GNU Affero General Public License v3.0 only (AGPL-3.0-only); a commercial licence is available, see `COMMERCIAL-LICENSE.md`.

| Download | For |
|---|---|
| `sutraflow-1.7.5-windows.zip` | Windows 10, 11 and Windows Server 2019 or later |
| `sutraflow-1.7.5-linux.tar.gz` | Linux (x64 or arm64); also macOS |

Each comes with a `.sha256` file to check the download.

## What is new since 1.6.0

### Performance under load
- **Engines scale.** PostgreSQL write transactions lock one run instead of the whole cluster, and engines claim steps with `skip locked`. With calls spread over the engines, four engines ran 352 steps a second against 116 for one (four engines managed 90 before).
- **Half the database work per step.** Project and Sengine variables and connection details are cached for the *Settings refresh* time, state and status are saved in one statement, and new covering indexes serve the work queue. One engine went from 82 to about 120 steps a second on PostgreSQL.
- **Sutras that run in memory.** A new *Execution* tuning per Sutra: short request-reply Sutras keep their steps in memory and save the run once when it ends, at about four times the throughput. Durable stays the default.
- **Big files on small servers.** *Stream in batches* on Read file and List / read directory: CSV and line files are read piece by piece and their rows sent in batches, with back pressure. A 1 GB file streamed on a 384 MB heap (peak 270 MB).
- **Memory tables.** Small reference data (rates, codes, routing, reusable values) kept in each engine's memory for lookups without a database round trip: loaded from a query, filled by Sutras or fetched on a miss, with limits, expiry, a failsafe copy in the database, and `=memory-lookup()` in mappings. New palette *Memory tables* (get, put, delete, query, reload).
- **SQLite recommended for single servers.** It measured about four times the throughput of PostgreSQL on the same machine; PostgreSQL is for several engines and failover.

### Administration
- **Sizing by machine.** Engines take their steps at once, queue check and settings refresh from the machine they run on (profiles from 1 vCPU / 1 GB up). *Admin Console → Engines → This machine* shows the profile and applies it; `sutra engines machine` prints it.
- **New tuning:** Execution (durable or in memory), Steps at once in memory, Queue check, Settings refresh.
- **Memory tables page** (*Operate → Memory tables*): every table with its settings, figures and rows, a page at a time with filters; hot reload on every engine; values changed by hand. Also `sutra memory list | rows | reload | clear | set | remove`.
- **Engine display names:** Rename in *Engines*, or `sutra engines name <id> "<name>"`. The engine id (`SUTRA_ENGINE_ID`) stays its identity.

### Reliability
- Fixed: the PostgreSQL connection could miss an answer under heavy load and stop the engine.
- Fixed: engines starting together on one SQLite file could fail on the same new column.
- Fixed: a stopping server stayed open until idle connections timed out. Servers now keep idle connections 65 s (above the idle time of load balancers, avoiding 502 errors) and close them on stop.
- Outgoing calls are sent once more when a kept connection is reset before any answer (methods safe to repeat, AI model and embedding calls).
- Load test (`tools/loadtest.mjs`), big file test (`tools/bigfiletest.mjs`) and a 30-minute soak; results in `docs/benchmarks` and the user guide chapter *Sizing and performance*.

### Other
- Every source file carries the copyright and AGPL licence header with its own file version (`tools/add-headers.mjs`; a test enforces it).
- New settings: `SUTRA_POLL_MS`, `SUTRA_MEMORY_WORKERS`, `SUTRA_SETTINGS_REFRESH_MS`, `SUTRA_MEMORY_SYNC_MS`, `SUTRA_KEEPALIVE_MS`. `SUTRA_WORKERS` now defaults to the machine's profile.

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
   (Get-FileHash .\sutraflow-1.7.5-windows.zip -Algorithm SHA256).Hash.ToLower()
   Get-Content .\sutraflow-1.7.5-windows.zip.sha256
   ```
   The two values must match.
3. Unpack it, for example to `C:\SutraFlow`:
   ```powershell
   Expand-Archive .\sutraflow-1.7.5-windows.zip -DestinationPath C:\SutraFlow
   cd C:\SutraFlow\sutraflow-1.7.5
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
   sha256sum -c sutraflow-1.7.5-linux.tar.gz.sha256
   ```
3. Unpack it, for example to `/opt`:
   ```sh
   sudo mkdir -p /opt/sutraflow && sudo chown "$USER" /opt/sutraflow
   tar -xzf sutraflow-1.7.5-linux.tar.gz -C /opt/sutraflow
   cd /opt/sutraflow/sutraflow-1.7.5
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

## Upgrade from 1.6.x

1. Back up: the data folder with `master.key`, and for PostgreSQL a `pg_dump` of the database.
2. Stop gracefully: `sutraflow stop all` (running steps finish first).
3. Unpack 1.7.5 into a new folder beside the old one. Copy `sutraflow.env` from the old folder; keep `SUTRA_DATA_DIR` pointing at the same data folder (or copy the folder).
4. Run `sutraflow setup`, then `sutraflow start`. The database is upgraded at start (new columns, indexes and the memory table tables); nothing is removed.
5. In a cluster, **upgrade every engine before starting any of them again**: 1.6 and 1.7.5 engines lock runs differently and must not share a database.
6. Optional: *Admin Console → Engines → This machine → Apply recommended tuning*.

To go back, stop 1.7.5, start the old folder, and restore the backup if 1.7.5 already ran on the data (the added tables and columns are not used by 1.6, so the data stays readable).

## Docker

The images are built from the source repository (`Dockerfile`, `docker-compose.yml`): `docker build -t sutraflow:1.7.5 .`. The release archives are for installs without Docker.

## Known limitations

- On one server, SQLite is faster than PostgreSQL, because SutraFlow talks to PostgreSQL through a synchronous bridge. Use PostgreSQL for several engines and failover.
- A Sutra that runs in memory loses the runs open at a restart, and cannot wait (approvals, Call Sutra with wait).
- Memory tables are for small reference data: at most 100,000 rows and 256 MB each.
- See also *Known limitations* in `README.md`.
