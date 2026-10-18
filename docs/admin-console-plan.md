# Admin Console plan

The Admin Console manages what is **deployed**: running projects and Sutras, engines, people and system
accounts, access, the gateway, audit and alerts. Design work (drawing Sutras, mapping, connections in
draft) stays in the designer. The console is served at `/admin` on the admin port of every server,
including headless engines, so one console can manage a production engine that has no designer.

Every phase ships with automated tests in the regression suite and updates to the user guide and the
architecture page.

| Phase | State |
|---|---|
| 1. Users, roles, access and audit | Done |
| 2. The console | Done |
| 3. Tuning parameters | Done (with Sutra restart, the Console panel and shell commands for every action) |
| 4. Gateway management | Done |
| 5. Alerts and dashboard | Done |
| 6. SFTP / FTP palette | Done (with time limits per connection, Sutra folders and new samples) |
| 7. Git projects from the designer | Next |
| 8. Cluster throughput | Planned |

## Phase 1: Users, roles, access and audit (server)

- **Users**: provisioned by an administrator (display name, email), enable / disable, reset password,
  must change password at next sign-in, lockout after repeated failures, sign out everywhere.
- **System accounts**: non-human accounts for engines, CI and API callers. Each has API tokens
  (shown once, stored hashed, with expiry and last use) for the admin API, and may have a password for
  gateway Basic sign-in.
- **Roles**: built-in Administrator, Developer, Deployer, Operator, Approver, Viewer and API caller,
  plus custom roles made from permissions.
- **Access per project**: a role is granted to a user or system account for all projects or for one
  project. Every admin API route checks a permission, and project routes check it for that project.
- **Gateway Basic with system accounts**: an API security policy can accept system accounts that may
  call services of the service's project.
- **Audit log**: every change (who, when, from where, what, which project, result), sign-ins and
  refused requests, searchable and exportable, kept for `SUTRA_AUDIT_RETENTION_DAYS` (365).

## Phase 2: The console (web)

- Overview: engines, deployed projects, runs today, failures, alerts.
- **Applications**: deployed projects and their Sutras: version, enabled, start / stop triggers,
  recent runs, failures, resubmit, package history and rollback.
- **Engines**: every engine of the cluster: heartbeat, leader, workers, running steps, draining;
  drain, housekeeping now.
- **Users and roles**, **System accounts**, **Audit**.
- Headless engines serve the console with user sign-in (the designer stays off).

## Phase 3: Tuning parameters

Changed in the console while running, stored in the database, applied by every engine without a
restart. Environment variables stay the defaults.

- Engine: workers, steps per run limit, reply timeout, run retention, log level, step data logging,
  trace sampling.
- Per deployed Sutra: maximum runs at once, priority, run time limit, default retries and delay, log
  level, keep step data, run retention.

## Phase 4: Gateway management

- **Apps**: API consumers with keys or client credentials, scopes per service, enable / disable,
  key rotation.
- **Rate limits and plans**: requests per minute / hour / day per app, user or service; plans with
  quotas; 429 replies.
- **Firewall**: IP allow / deny lists for the whole gateway.
- **Request log and statistics**: every gateway call (service, app, status, time, size), errors, top
  and slowest services, charts.
- OpenAPI for deployed REST services. A developer portal comes later.

## Phase 5: Alerts and dashboard

- Rules: failed runs of a Sutra over a window, error rate, slow runs, engine down, work waiting too
  long, gateway 5xx rate, certificate expiry, listener errors.
- Channels: email (SMTP connection), webhook, or start a Sutra.
- Alert history with acknowledge and resolve; dashboard charts of runs, errors and gateway traffic.

## Phase 6: SFTP / FTP palette

Done. List, read, write, move / copy / delete and a Remote file trigger over SFTP (password or key
from the vault, host key fingerprint) and FTP / FTPS, fenced into a base folder.

- **Time limits** per connection for slow or far-away servers: connect, response per operation,
  attempts and the wait between them (sign-in and host key errors are not retried), SFTP keep-alive.
  SFTP / FTP steps allow 10 minutes by default; an activity may now declare its own default step time limit.
- **Samples**: public SOAP service (WSDL), mock SOAP service and its caller, JSON microservices
  (Customers, Stock, and Orders calling both), SQL install script with a stored procedure exposed as a
  REST microservice (MySQL), SFTP and FTP. New **SQL script** activity for install scripts.
- **Sample connections**: every connection a sample uses is made once in the project as "Sample ...".
- **Folders for Sutras**: folders and sub-folders in the explorer, drag and drop, rename, move, remove
  (contents move up; nothing deleted). Samples go to `Samples/<topic>`; packages keep folders.

## Phase 7: Git projects from the designer

A project linked to a Git repository (any remote; HTTPS token or SSH key from the vault): commit,
push, pull, branches, history and diffs of Sutra versions from the designer; CI builds packages from a
commit with `sutra package --from-git`.

## Phase 8: Cluster throughput

Per-run locks instead of one write lock on PostgreSQL, and queue consumers shared across engines
instead of the leader only.
