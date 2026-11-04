# SutraFlow 2.1.6 release notes

Prepared 2026-11-04. Copyright (c) 2026-27 Surya Partap Singh, MixAgile.com. AGPL-3.0-only; a commercial licence is available.

| Download | For |
|---|---|
| `sutraflow-2.1.6-windows.zip` | Windows 10, 11 and Windows Server 2019 or later |
| `sutraflow-2.1.6-windows-x64-offline.zip` | The same with the runtime packages inside, for servers without the npm registry |
| `sutraflow-2.1.6-linux.tar.gz` | Linux (x64 or arm64); also macOS |
| `sutraflow-2.1.6-docs.zip` | The user guide, the Administration Guide, the Sutra Design Guide and the architecture page, to put on a website |

Each comes with a `.sha256` file to check the download: `sha256sum -c <archive>.sha256`, or on Windows `Get-FileHash <archive> -Algorithm SHA256`.

2.1.5 was built but not published: a review of its new features found four serious problems (fixed below). **2.1.6 holds everything 2.1.5 brought** (the sections *What is new in 2.1.5* below) **with those fixes**, plus 2.1.6's own changes. Upgrade from 2.1.4 straight to 2.1.6.

## In short

- **Redeploying needs a person** (2.1.6): a release may replace Sutras already deployed, but only after someone has seen the plan (each Sutra new, unchanged or replacing the version here, those undeployed) and approved it: `yes` typed at `sutra deploy`, `--approve <plan id>` in pipelines (exit code 3 without it), or the project name typed in the Admin Console. A plan id no longer matches once the server changes.
- **Never overwritten without a list** (2.1.6): deployments and config files create connections, project properties and settings that are missing and keep the ones already there, listing them in a checklist (name, type, where it points, the fields that differ, never values) for the operations team to verify.
- **Configuration as files** (2.1.6): `sutra config export | check | apply` keeps a server's settings (engine properties, roles, system accounts, shared connections, gateway, firewall, plans and apps, alerts, server knowledge bases) and projects' connections and properties in YAML or JSON in Git, with one small environment file per environment; secrets from `${env:}` or `file:` into the vault. Apply is all or nothing.
- **Containers, Kubernetes and pipelines** (2.1.6): an official image `ghcr.io/spinny007/sutraflow`, signed and with an SBOM, for amd64 and arm64; `sutraflow image build | save` for sites without internet; Compose files and Kustomize manifests (engines, optional studio, test and prod overlays, a config-and-deploy Job) in `deploy/`; release pipelines for GitHub Actions, GitLab CI, Azure DevOps and Jenkins with a manual approval of the plan.
- **Fixes to 2.1.5's new features** (2.1.6): a knowledge base offered as an MCP tool is never served without a policy; dashboards cached per caller keep callers with the same subject but another issuer or other claims apart; a project granted an area cannot remove another area that differs only in case; removing the samples keeps a Samples project that holds connections, schemas or properties of the site; write grants keep working when every project may search.
- **Dashboards**: a new Dashboards palette publishes a Sutra as a page of Apache ECharts charts on the gateway (`/dash/<name>`), on a database, an API or any JSON, behind a security policy, with filters (slicers) and click-to-filter, KPI cards, grouping of raw rows, refreshed on a schedule with results shared by every viewer, and PNG and SVG export; an AI may plan or suggest charts, used only after an allow-list check.
- **Knowledge admin**: an administrator shares a project's knowledge base with other projects (every project to search, or granted projects by area, to search or also to change), keeps areas in step with folders, SFTP, SharePoint, Google Drive, web pages, a database or an API on the leader (only changed items get new vectors), offers it as an MCP search tool, and exports a source as a Sutra; one writer per area, enforced by the engine.
- **Conversation tokens**: every answer of a published agent carries a token signed by SutraFlow. It continues the conversation only for the caller who started it, and only for a set time; administrators clear expired conversations and their memory.
- **Who is chatting**: the caller's verified claims and scopes reach the agent (`{trigger.caller.claims.role}`), so one agent can serve customers and support staff differently; the chat button carries a website's own login.
- **Knowledge from databases and APIs**: sample *Knowledge feed from a database* turns a MySQL product table into a knowledge base (changed rows again, unchanged skipped, unpublished removed) with a search API; tested on a local and a hosted remote MySQL.
- **A chat example with a website**: sample *Chat for customers and support* with the PHP website *Sutra Sample Shop* (`samples/sutra-sample-shop`, also a download of its own) that signs people in and hands the chat their token; eight skills, and the website can use a SutraFlow on another server.
- **Sample data named sample_**: everything the samples store is named `sample_<objective>` (tables, databases, collections, counters, queues, folders), and the installer's new *Samples* mode adds the samples to an installation or lists and removes them with their data, also through the *Sample ...* connections; earlier versions' sample names are recognised. No samples and no AI knowledge are set up unless chosen.
- **Installer**: server name, the gateway certificate (self-signed, your files or Let's Encrypt), sample Sutras, steps at once per engine, heartbeat and drain, a check that the engines see each other, `sutraflow engine-file` for an engine joining later, and YAML install files.

## Install and upgrade

Install as for 2.1.4. Upgrade from 2.1.0 to 2.1.4 (or a 2.1.5 build): unpack 2.1.6 in a folder of its own and run `bin/sutraflow upgrade` from there. It adds six tables (`agent_conversations`, and for Knowledge admin `kb_admin`, `kb_grants`, `kb_sources`, `kb_source_items`, `kb_sync_runs`), made on upgrade, and no required settings.

**What changes for you:**
- **Deployments that replace Sutras** already deployed (or undeploy them) need approval (2.1.6). Pipelines that ran `sutra deploy` unattended stop with exit code 3 and the plan: add a manual approval and `--approve <plan id>` from `sutra check` (templates in `deploy/ci`). Packages in `SUTRA_DEPLOY_DIR` and rollbacks are not affected.
- **A release's deployment config no longer changes connections and project properties already on the server** (2.1.6); it creates missing ones and lists the rest in the checklist. Change an existing connection in the Admin Console or the designer, on purpose.
- **Clients that made up their own session ids** for a published agent (the chat API, the OpenAI-compatible API, A2A `contextId`, the MCP tool's `session`) now get a new conversation each time, until they send back the token SutraFlow returns (`sessionId`, `X-Session-Id`, `contextId`, `session`). The chat page and widget already do. OpenAI-compatible clients that send the whole history are not affected.
- **Conversations end** after the agent channel's *Conversation lasts* time (24 hours unless set); the next message starts a new one.
- **Chat visitors** (no policy) get a new kind of signed identity; 2.1.4 identities are renewed on their next message, so nobody loses a conversation.

## Fixes in 2.1.6

| Seen | Cause | Now |
|---|---|---|
| Clearing the policy of an MCP server that offers a knowledge base as a tool opened the knowledge base to anyone: an anonymous request got private passages | Knowledge admin asked for a policy only when the tool was set up; the MCP handler served anonymously when the server had none | A knowledge tool answers only behind its MCP server's policy; without one it answers 503 and shows nothing |
| A dashboard cached *for each caller* could show one caller's result to another: two tokens with the same subject from different issuers shared the cache | The cache key held only the method, the subject and the app, while the Sutra also sees the issuer, roles, scopes and other claims | The key covers everything the Sutra receives about the caller (except the token's own times and id, so a renewed token keeps its cache) |
| A project granted the area `products` could remove `Products/private` from a knowledge base kept in SQLite | The access check compares areas with their case; the removal used SQLite's LIKE, which ignores case | Areas are matched exactly, with their case, on SQLite and PostgreSQL |
| Removing the samples could delete connections, schemas and properties someone had added to the Samples project, without listing them | The project went once no other Sutras were left in it, and deleting a project takes all its connections, schemas and folders | The project goes only when nothing but the listed sample items is in it; otherwise it is kept and the list says what it holds |
| Choosing *Every project may search* took away a project's grant to add and remove in its area | The access check returned search-only before reading the project's grants | Every project searches the whole base and write grants still apply; Knowledge admin shows the grants in both modes |
| The upgrader refused an installation already on the package's version ("It already runs 2.1.6"), leaving no safe way to repair damaged program files | Only a lower version counted as upgradable | *Reinstall* runs the same safe steps over the same version, only when asked for |

## What is new in 2.1.6

### Redeploying needs approval

- **The plan**: `sutra check`, the Admin Console's Releases page and the designer's Releases page show what a release does before it changes anything: each Sutra *new*, *unchanged*, *deployed again* or *replaces* (with the version here), Sutras *undeployed*, changed schemas, what is created, the checklist, and a **plan id** (a hash of the release and of what is on the server now).
- **Approval**: replacing or undeploying needs a person: `yes` typed in a terminal, `sutra deploy --approve <plan id>` in a pipeline, the project name typed in the Admin Console, or the *Approved plan* field of the Release palette's *Deploy package*. Without it, `sutra deploy` stops with exit code 3 and the API answers 409 with the plan; an id that no longer matches is refused. Who approved, and the plan id, go into the deployment record and the audit log.
- **Checklist**: connections, project properties and logging already on the server are kept and listed (name, type, where it points without credentials, which fields differ); `--checklist file.md` writes it as Markdown. `sutra check --json` gives the plan to scripts.

### Configuration as files

- `sutra config export --server-settings --project "A,B" --out sutraflow.yaml`: what is set now, YAML or JSON. Never people; system accounts without tokens, gateway apps without keys; secrets as `${env:SUTRA_<PROJECT>_<NAME>}` placeholders; a run-time `${env:}` reference stays one (`$${env:}`).
- `sutra config check <file> [--env env/prod.yaml]`: what applying would create and the checklist; runs the apply and undoes it, so it finds every error an apply would. Warns about secrets written directly, unless `--allow-plain-secrets`.
- `sutra config apply <file> [--env] [--yes] [--checklist]`: creates what is missing, all or nothing; asks first in a terminal; each item created is audited. Permissions follow what the file holds.
- Values: direct, `${env:NAME}` from where the command runs, `file:/path` for secret, private key and certificate properties (Kubernetes and Docker secrets). The environment file is merged over the config file, lists matched by name.
- `sutra deploy` and `sutra check` take `--env` too, and `--config` may be YAML.

### Containers, Kubernetes and pipelines

- **Official image** `ghcr.io/spinny007/sutraflow:2.1.6` (and `2.1`, `latest`) for amd64 and arm64, built by the release workflow after the tests, smoke-tested (health, version, guides, non-root, clean stop), signed with cosign keyless, with an SBOM and provenance. OCI labels name the version, commit and source.
- **Offline**: `sutraflow image build` builds the image from a release package (`deploy/docker/Dockerfile.package`, no npm needed) or a source folder; `sutraflow image save` writes it to a file for `docker load`.
- **Docker**: `deploy/docker/compose.yml` (studio and engine) and `compose.cluster.yml` (PostgreSQL with pgvector, studio, two engines) from the image, with `env.example`; `sutraflow docker up` in a release package uses them.
- **Kubernetes**: `deploy/kubernetes`: engines with readiness on `/ready`, liveness on `/health` and time to drain, a disruption budget and network policy; an optional studio; `overlays/test` and `overlays/prod` (autoscaler, Ingress); a Job that applies the config file and deploys an approved release.
- **CI/CD**: `deploy/ci`: GitHub Actions, GitLab CI, Azure DevOps and Jenkins, each building from Git, testing, checking (plan and checklist), waiting for a person's approval and deploying with `--approve`.
- The Administration Guide has four new chapters: *Redeploying needs a person*, *Configuration as files*, *Containers and Kubernetes* and *CI/CD pipelines*.
- **`sutra` inside the image**: `docker exec <container> sutra status` (or `docker compose exec engine-1 sutra ...`) works with no address or token: it uses the container's own server and `SUTRA_ADMIN_TOKEN`. An empty `SUTRA_SERVER` works on the database directly.
- A new Administration Guide part, *Docker, Kubernetes and the application lifecycle*, for teams new to containers: *Docker in plain words, and making the image*, *From development to production, step by step* (with and without Docker, by hand or by pipeline), *Adding an application to a running cluster*, *One Admin Console for the whole cluster* (any engine shows all of it; what happens when the leader stops) and *Questions from DevOps teams*.
- **The admin API, documented**: a new Administration Guide part, *The admin API*, covers all 258 endpoints of the admin port. It covers addresses, signing in (admin token, system account tokens, sessions and the `X-Sutra` header), permissions, status codes, curl and PowerShell examples, and the `sutra` command beside each endpoint. Then come eight chapters by area, each endpoint with what it does, who may call it, and whether headless engines serve it. The tables are made from the server's own route and permission tables (`server/src/api-docs.ts`, `guard.ts`), and a test fails when an endpoint has no description or a route the `sutra` command calls has no command named.
- **Upgrading in containers**: engines of different versions must not share a database, so a SutraFlow upgrade stops every engine and starts them on the new tag; rolling restarts are for the same version only (guide and `deploy/kubernetes/README.md`).
- **Reinstall the same version** (a repair): the upgrader no longer only refuses an installation that already runs the package's version. *Check* says so, and ticking *Reinstall* (or `"reinstall": true` in `upgrade.json`) puts the package's program files in place again through the upgrade's own steps: graceful stop, backup (pg_dump checked), old files moved into the backup, data compared, started and checked, and the previous files put back if a step fails. Data, settings and deployed Sutras stay. It also works when the launcher is missing, and it never takes a newer installation back. *Upgrading* and *Troubleshooting servers* in the Administration Guide explain it.
- **Keep PostgreSQL near the engines** (about 2 ms round trip or less). Measured with the image and two engines: PostgreSQL 18.2 on the same machine answered 120 simultaneous calls in 3.9 s and survived a hard kill of the leader; a hosted PostgreSQL 17.2 over the internet (75 ms) worked correctly but took 3 to 8 s per call.

## What is new in 2.1.5

### Dashboards

- **Dashboard page** (trigger): the page `/dash/<name>` while deployed, with a title, a description, filters (list, multi list, date range, number range, search: their values in the page address, `{{trigger.params.<field>}}` for SQL as bound parameters and `{{trigger.filters}}` for Chart steps; a click on a chart sets the filter of its category field), who may see it (a security policy: the page holds no data, its data request goes through the policy), a refresh time, whether results are the same for everyone or kept per caller, and the number of columns. `/dash/<name>/embed.js` puts it on another web page; a page with its own login passes it with `window.SutraDashboard = { token: () => accessToken }`.
- **Chart**: rows to a chart: bar, horizontal bar, line, area, pie, donut, scatter, a number, a KPI card (the total or the latest period, the change against the one before, a trend line, a target), a gauge or a table, with category and value fields, stacking, sorting, a row limit, a unit and a colour palette. Rows from SQL, an API answer (*List inside*), any JSON; raw rows grouped and added up (sum, average, count, distinct count, min, max), dates by day, week, month, quarter or year, series split by a field, nested fields such as `customer.city`; the page filters applied to the rows. Plain JSON options only: no code, no links.
- **Charts from AI** (new): plans the charts of a dashboard for rows of any shape. With an AI provider the model chooses from field names and kinds (and a few rows only when allowed); without one, built-in rules choose. Every chart passes the allow-list, and the numbers are worked out from the rows.
- **Settings from a step**: a Chart takes its settings from an earlier step, such as an AI prompt asked to choose a chart, only when they pass the allow-list (known settings, chart types and palettes, fields that are in the rows); anything else is refused and logged, and the step's own settings are used. The data always comes from the rows.
- **Dashboard reply**: the charts in the order the page shows them (a Charts from AI list counts as its charts), the choices of list filters, and a note. A dashboard run that ends without it (such as an SQL query with no rows whose *empty* port is not connected) now says so on the page.
- **Refresh and cache**: the page asks for data every refresh time; the answer is kept on the server for that time and shared by every viewer (or per caller), and viewers arriving during a run wait for it instead of starting another. The page's query parameters reach the Sutra as `params`.
- **Apache ECharts from SutraFlow itself**: `npm run build` copies ECharts (6.1.0, Apache-2.0, with its licence and notice) into `dist/web/vendor/echarts`; the gateway serves it at `/dash/vendor/echarts.min.js`. No CDN; dashboards work offline. Light and dark follow the viewer's system.
- **Export**: PNG and SVG buttons on every chart.
- **Sample: Sales dashboard on a database** (new, Samples/Dashboards): with *Sample: Sales orders install*, a MySQL table `sample_sutraflow.sample_sales_orders` (180 orders) and the page `/dash/sales-db`: filters for region, categories and dates as bound parameters, KPI cards with the change and a target, revenue by month split by region, click-to-filter by category and region, best customers and the latest orders.
- **Sample: Dashboard from JSON** (new, Samples/Dashboards): `/dash/orders-json` from an API-style answer, grouped by month, split by channel, a nested field, four filters including a search, and three charts planned by Charts from AI.
- **Sample: Sales dashboard** (new, Samples/Dashboards): five charts from SQL queries on the built-in SQLite file (total revenue, revenue by month, orders by category, top products, latest orders), and a suggestion step standing in for an AI whose unknown field is refused.

### Knowledge admin

- **Admin Console, Knowledge admin** (new page, Server permission): every knowledge base with its home project. *Server knowledge base* on: *Every project* may search the whole base, or *Granted projects only*, each grant naming the project, the area (a folder of sources such as `products`; empty = whole base) and whether it may add and remove there. The home project keeps full use; removing everything, rebuilding vectors and building the search index stay with it and administrators.
- The engine checks every step, agent tool and API call: a project searches only its granted areas (a search without a filter searches all of them), and changing outside its areas fails with the reason. A granted knowledge base appears in the project's knowledge base lists marked with its home project and areas; its own connections are used through it, never offered to the project.
- **Managed sources**: files in a server folder, an SFTP or FTP folder, SharePoint or OneDrive, a Google Drive folder, web pages, a database query or an HTTP API (JSON), each writing one area, on a schedule (minutes or cron) or *Sync now*, on the leader only and one after another. Only new and changed items are read and get vectors (files by size and time, rows by their text and details); items gone from the source are removed; an item that cannot be read keeps its passages; an empty listing removes nothing. *History* (the last 50 syncs), *Re-index*, *Remove* with its passages. A *Sutra of a project* source gives that project changes to one area.
- **One writer per area**: an enabled managed source, a Sutra exported from one, or one granted project; a second writer on the same or an inner area is refused, naming the current one.
- **Export as Sutra** (database, folder and web sources): a Sutra of ordinary steps in the home project; the managed sync stops, and the exported Sutra may change only its area.
- **MCP search tool**: a server knowledge base as a tool on an MCP server connection of its home project, for an area; the MCP server must have a security policy.
- `sutra knowledge list | sync <base> <source> [--reindex] | runs <base> <source>`. New tables `kb_admin`, `kb_grants`, `kb_sources`, `kb_source_items`, `kb_sync_runs` (made on upgrade; nothing changes for existing knowledge bases until an administrator shares one).

### Agent conversations

- A conversation token `c1.<id>.<expiry>.<signature>` is signed with a key derived from the master key over the conversation id, its expiry, the agent and the caller (policy and token issuer, subject, gateway app, or the visitor). A missing, altered, foreign or expired token, or a made-up session id, starts a new conversation. The Sutra sees the conversation id as `{trigger.sessionId}`; answers name the conversation by its token, with `conversationExpires`.
- The same in every entry point: chat page and API, OpenAI-compatible API (without a token, the same conversation for the same first message until it expires), A2A, and the MCP tool `ask_<agent>`, where each assistant user's conversation is bound to the gateway app and caller the assistant signed in with. Jobs name their conversation again.
- *Conversation lasts (hours)* on the Agent channel (24 by default).
- **Admin Console, Agent conversations** (new page): every agent's conversations, active and expired, with their messages; *Clear expired* removes expired conversations with their AI memory (messages, summaries, queue places) for one agent or all, for administrators (Server permission), recorded in the audit log. `sutra agents conversations` and `sutra agents clear-expired [--agent name]` do the same. The new table `agent_conversations` keeps no message text.
- Visitor identities (`v2`) expire after `SUTRA_VISITOR_DAYS` (30) and are renewed once half of that has passed while the visitor keeps coming back.

### Who is chatting

- The caller's verified claims and scopes reach the agent Sutra as `trigger.caller.claims` and `trigger.caller.scopes` (JWT, OAuth introspection and gateway apps), beside the subject.
- The chat page and widget carry a website's login: the page sets `window.SutraChat = { token: () => accessToken }` before the widget script; the chat asks for it before each message, sends it as a bearer token, and asks again when it is refused as expired. The widget answers only its own frame and sends the token only to the SutraFlow address it came from. Without a login, the chat says to sign in on the website. `SutraChat.reload()` reopens the chat after a sign-in change.

### Samples

- **Sample data named sample_**: the samples' tables, databases, collections, counters, channels, queues and folders are named `sample_<objective>`: MySQL `sample_sutraflow` (tables `sample_sales_orders`, `sample_products`, `sample_customers`, `sample_orders`, procedure `sample_customer_orders`, was `sutraflow_samples`), SQLite `sample_sutraflow.sqlite` (was `samples.sqlite`), MongoDB `sample_orders`, queues `sample_orders.in`/`.out`, and folders in the project's files folder (`sample_csv`, `sample_inbox`, `sample_outbox`, `sample_documents`, `sample_scripts`, `sample_downloads`, `sample_validation`) through project properties instead of `C:/sutra/...`. Samples added before keep their old names until they are removed and added again.
- **Knowledge feed from a database** (new, Samples/AI agents): *Sample: Product catalogue install* makes a product table in MySQL; *Sample: Product knowledge feed* reads the published rows of the table in the project property `PRODUCTS_TABLE` every 30 minutes, adds each product as a passage under `products/<id>` with its category, price and link as details (*Same text as before: skip*), and removes the products no longer published; *Sample: Product search API* (`POST /samples/products/search`) answers the closest products with their details. No AI model needed.
- **Chat for customers and support** (new, Samples/AI agents): *Sample: Customer and support chat*, published as `shop-help`, with the policy *Sample chat website sign-in* (JWT with a shared secret in the Secret property `CHAT_SITE_SECRET`, issuer `sutra-sample-shop`). Eight skills chosen by keywords: order status, tracking a parcel, returns and refunds (within 30 days of delivery), invoices, the delivery address, products and stock, a person from the support desk, and help. Customers see only their own orders, the support desk every order and every order of a customer; no AI model needed.
- **Sutra Sample Shop** (new): the PHP website for that sample, ready to ship as a repository of its own. Its own sign-in with two demo accounts, a 15-minute token per person, the chat button, a setup check page (`check.php`), settings in `config.local.php` or environment variables (never in the shipped files), and `SUTRAFLOW_URL` to use this SutraFlow or one on another server. Download it from *New Sutra*, *Samples* (*Download the website (zip)*), or as `sutra-sample-shop-<version>.zip` beside the release packages; its README is the install guide.

### Installer

- **Server page**: *Server name* (`SUTRA_PUBLIC_URL`) and *Gateway certificate*: off, self-signed, your certificate files (checked against the key; the key kept in the vault) or Let's Encrypt (domains, email, staging or production, agreement).
- **Cluster page**: *Steps at once* per engine (`STUDIO_WORKERS`, `ENGINE_WORKERS`, and in further engines' files), *Heartbeat* (`SUTRA_HEARTBEAT_MS`) and *Finish steps on stop* (`SUTRA_DRAIN_MS`).
- **Review page**: *Add the sample Sutras* in a project named Samples.
- **Samples** (new, on the first page): add the samples to an installation of this version, or remove them and their data. *List* shows everything first (the sample Sutras and connections, their knowledge, memory, counters, properties and files, and the `sample_` tables, collections and files reached through *Sample ...* connections; what your own Sutras use is kept); SutraFlow is stopped while they change and started again. The same from the command line: `sutraflow samples list|add|remove [--folder <installation>]`.
- **Samples on upgrade**: the upgrade's Review page and `upgrade.json` (`"samples": "keep" | "add" | "remove" | "refresh"`) keep, add, remove or refresh the samples after the upgrade; a sample connection that cannot be reached is reported and does not undo the upgrade. The Administration Guide says when to add samples (designers' machines, training, proofs of concept) and when not (production).
- **Engines see each other**: after starting a studio and an engine beside it, the install checks that both beat in the shared database.
- **`sutraflow engine-file <name>`**: a settings file for an engine joining the cluster later, from the installed server's settings, without the database password.
- **YAML install files**: `sutraflow install --config install.yaml` (the same fields as JSON). The silent install takes the new fields too (`docs/install-example.json`).

### Documentation

- User guide: *Dashboards*. Sutra Design Guide: *Blueprint: dashboards*, *Blueprint: knowledge bases from databases, APIs and files* (the feed Sutra, rules, a Joomla example, answering from it), and *Blueprint: chat agents for customers and support staff*, with the two agent patterns (a public agent that owns the conversation, and skills for an outside assistant), who is chatting from a third-party login, customers and staff, conversation tokens and their expiry, and the PHP example.
- User guide: conversations and who is chatting; the Agent conversations page. Administration Guide: the new installer choices, `engine-file`, YAML, `SUTRA_VISITOR_DAYS`.
- Administration Guide: *Knowledge admin: server knowledge bases* (settings, sources, grants, and using it: from a granted project's steps, from an assistant over MCP with curl and Claude Desktop examples, from the command line), and *The command line by task*: every `sutraflow` and `sutra` command grouped by task (installing and upgrading, starting and watching, engines and Docker, the database, releases, people and secrets, operating, alerts and the gateway), with what each does, when to use it and examples. User guide: *Exporting a Sutra application from the command line* in *Deploying and versions*, with deployment on servers pointing to the Administration Guide; server knowledge bases in *AI agents and knowledge bases*. Sutra Design Guide: one knowledge base for many projects, designed by area.

### Fixes in 2.1.5

| Seen | Cause | Now |
|---|---|---|
| A client could choose any session id for a published agent and keep reusing it; conversations never ended | Session ids came from the caller and had no lifetime (each caller's memory was already kept apart) | Session ids are signed tokens issued by SutraFlow, bound to the caller, that expire |
| A chat visitor's identity lasted for ever | Visitor tokens had no time in them | They expire after 30 days and renew while the visitor keeps coming back |
| An agent could not tell a customer from a support agent signed in on the same website | Only the caller's subject, method and app reached the Sutra | The verified claims and scopes reach it too |
| The built-in chat button worked only for anonymous visitors | It could not send a website's login | It asks the page for its token and sends it as a bearer token |
| A knowledge base used by several projects had to be copied into each, and every copy fed again | A knowledge base belonged to one project only | An administrator shares it, by area, in Knowledge admin; managed sources feed it once |
| The installer could not set the server name, the gateway certificate, steps at once, heartbeat or drain, nor add an engine later | Those were only in the Admin Console or `sutraflow.env` | The install pages, the silent install and `sutraflow engine-file` set them |
| `sutra knowledge sync` with a misspelt knowledge base said the names were missing | Not found and not given shared one message | It names the knowledge base not found and lists the ones there are |
| GitHub CI proved upgrades from 2.1.0 only | The previous release was written into the workflow | CI upgrades from the newest published release other than the one being built (2.1.4 for 2.1.5) |

## 2.1.5 release gate

See `docs/releases/2.1.5-packages.md`.

## Previous release: 2.1.4

### In short

- **Trusted proxies**: behind Apache, nginx or IIS, SutraFlow now sees each caller's real address and the HTTPS the proxy ended, from the proxies you list, and from no one else.
- **Big documents use less memory**: streaming a 48 MB document into a pgvector knowledge base with 32 workers peaks at about 140 MB of live heap instead of 300 MB, and is faster.
- **Keys shown once**: the web installer shows the new master key and admin token on its last page, for safe keeping.
- **WebSocket broadcasts in a cluster**: a client that has just connected gets the next broadcast, and an engine that died stops collecting broadcasts it would later send to the wrong clients.
- **A new book, the Sutra Design Guide**: design standards for Sutras, from naming and functions to REST, SOAP, integration patterns, messaging, error handling and microservices; blueprints for a microservices platform, mobile APIs, broker integration and notifications; tracing an order from project to Sutra to run; every sample explained with what to change before production; a review checklist.
- **A new sample, Traceability and notifications**: one order through an intake Sutra, a called credit check and a notification hub on an internal channel, with one correlation id in every log line.

### Install and upgrade

Install as for 2.1.3: `bin/sutraflow install` in the unpacked folder (Windows `bin\sutraflow.cmd install`), or silently with `--config`. Upgrade from 2.1.0, 2.1.1, 2.1.2 or 2.1.3: unpack 2.1.4 in a folder of its own and run `bin/sutraflow upgrade` from there (the Administration Guide's *Upgrading*). 2.1.4 changes no database tables and adds no required settings.

**What changes for you:**
- **Behind a reverse proxy**: nothing changes until you list the proxy under Admin Console, Gateway, Firewall, *Trusted proxies*. Then the request log, firewall, IP rules, rate limits and sign-in attempts see the caller's address, and *Require HTTPS* accepts calls the proxy received over HTTPS. Make sure the proxy replaces `X-Forwarded-For` and `X-Forwarded-Proto` (the Administration Guide has the Apache, nginx and IIS settings).
- **Streaming steps** (Read file or List with *Stream in batches*) may pause a little more often: they wait while the batches they handed on hold more than 8 MB of input. `SUTRA_STREAM_BUFFER_MB` raises or lowers it.

### Trusted proxies

- Admin Console, Gateway, Firewall has a *Trusted proxies* list (addresses or IPv4 ranges); `sutra gateway proxies --trusted 127.0.0.1` sets it from the command line, and `GET/PUT /api/gateway/proxies` from the admin API (Gateway permission).
- From a trusted proxy, `X-Forwarded-For` gives the caller's address, read from the nearest hop back to the first address that is not a trusted proxy (a caller cannot hide behind a forged first entry), and `X-Forwarded-Proto: https` counts as HTTPS. From anyone else both are ignored.
- It applies to the gateway (REST, SOAP, MCP, AI agents, WebSocket upgrades, the firewall, policies' IP rules, Require HTTPS and rate limits, the request log, Started by) and to the studio (sign-in attempts, the audit log, secure cookies). Every engine applies a change within two seconds.

### Knowledge bases and big documents

- PostgreSQL (pgvector) knowledge bases store passages 100 to a statement instead of one: a 1 MB part took 800 round trips.
- A new source is learned 500 passages at a time (vectors made, then stored), so a big text never holds all its vectors at once. Replacing a source still makes every vector first, so a failure keeps the old passages.
- Streaming steps wait while the steps they handed on, waiting or running, hold more than `SUTRA_STREAM_BUFFER_MB` (8) of input; one batch always goes on. Before, only the number of waiting steps counted, and 32 workers could each hold a 1 MB part with its passages and vectors.
- Measured (one engine, 32 workers, a 48 MB document in 54 parts of 2,000 lines into pgvector): live heap during the run about 140 MB instead of 300 MB, the run 58 s instead of 88 s, and back to the starting 69 MB afterwards. The 8-hour 2.1.1 soak's 1.2 GB was memory not yet given back while load went on, not memory held: after the run the heap returns to where it started.

### Samples


- **Traceability and notifications** (new, Samples/Flow control): *Sample: Trace order intake* makes a correlation id from the order number, logs it, calls *Sample: Trace credit check* and announces the result on the channel `sample-order-events`; *Sample: Trace notification hub*, deployed, decides whom to tell. Every log line carries the order number, the correlation id and the run ids, so an order is found in Traceability (Find a run with the order number) and in the project log.

### Installer

- A new **Master key** step makes `data/master.key` before the tables (which used to make it without saying so).
- The last page shows a newly made master key and admin token once, with Copy buttons and the files they are in, until *I have kept a copy* and *Hide them*. They never go to the installer's log or the saved answers; a silent install prints only where they are.

### WebSocket services in a cluster

- A connection is registered before the client sees it open, so a broadcast sent at once reaches it.
- The leader removes the connections of an engine that stopped beating, and the broadcasts queued for it; an engine clears what was left for it when it starts, and drops a message older than 30 seconds instead of sending it to whoever connected since.

### Documentation

- **Sutra Design Guide** (`docs/sutraflow-design-guide.html`, new): the design standards for designers and reviewers, in 38 chapters. Foundations (principles, projects, folders and naming conventions); building blocks (the anatomy of a Sutra, functions and transformations in detail with the pitfalls of each function group, called Sutras as functions, variables and counters, data contracts, configuration and secrets); APIs and web services (REST resources, methods, status codes and a standard error body, SOAP contract-first, API security and the gateway with trusted proxies, calling other services, WebSockets and AI tools); integration processes (a catalogue of integration patterns built with Sutras, orchestration or choreography, messaging and acknowledgement, files and batch, databases, error handling with retries and compensation, logging and traceability); microservices (boundaries, synchronous and asynchronous communication, anti-patterns, resilience and performance); solution blueprints (packaging with properties, connections and secrets; a microservices platform with its deployment strategy; an API for mobile apps; integration through a message broker; notifications through an internal channel, a broker, Call Sutra or alert rules; error handling through logs and tracing an order from the project to each Sutra and run); every sample explained group by group with its design lessons and what to change before production; delivery (testing, versions and releases) and a design review checklist. Rules are marked Must, Should and May. It links into the user and administration guides, ships in every package and in the docs archive.
- The user and administration guides describe trusted proxies (with Apache, nginx and IIS settings), the master key and admin token (what they are, what losing them means, how to keep them), the keys shown once by the installer, and `SUTRA_STREAM_BUFFER_MB`.

### Fixes in 2.1.4

| Seen | Cause | Now |
|---|---|---|
| Learning a big streamed document took the engine's heap to about 300 MB with 32 workers (518 MB at the peak), and in the 8-hour soak the engine stayed at 1.2 GB | 32 Learn steps ran at once, each holding a 1 MB part with its passages and vectors while it waited for one of the knowledge base's 4 database connections; each passage was a statement of its own | Passages go 100 to a statement, a new source is learned 500 passages at a time, and streaming waits while 8 MB of input is in flight: about 140 MB, and faster |
| Behind a proxy every caller had the proxy's address (one caller's rate limit stopped everyone), and calls the proxy received over HTTPS were refused by Require HTTPS | The gateway never read forwarded headers | Forwarded headers are read from the trusted proxies you list, and only from them |
| A WebSocket client that had just connected could miss the next broadcast | Its connection was written to the database after the upgrade, without waiting | It is registered before the upgrade |
| After an engine was killed, broadcasts kept being queued for its connections, and when it started again it could send them to new clients | Nothing removed a dead engine's connections or its queued messages | The leader removes them; an engine clears its queue at start and drops messages older than 30 seconds |
| The soak reported 185 of 190 broadcasts during a planned engine kill | It counted a broadcast as expected before sending it, so one sent to the engine being killed (and refused) still counted | A broadcast is counted only when it was accepted |
| The installer made a new master key without saying so, and showed neither it nor the admin token | The tables step made the key as a side effect | A Master key step makes it, and the last page shows both once |
| Test connection on a MongoDB Atlas connection said only "MongoDB operation failed" after about 37 seconds, when Atlas had refused this server (its IP not on the project's Network Access list), and the same when Atlas refused the user name or password (code 8000) | Driver errors are not shown (they can hold the URI and its password), and these two had no category of their own | "server refused the TLS connection" says to add the server's public IP to Atlas Network Access; "no server reachable within the server selection timeout" lists what to check; code 8000 is "authorization/authentication failed". Still no driver text in the message |
| The first GitHub CI run (2.1.3) failed on Linux and Windows before any test ran | `npm audit --audit-level=high` found GHSA-mrwp-f3q8-3g9p in follow-redirects 1.16.1 (used by soap and by axios in acme-client): custom credentials could follow a redirect to another host | follow-redirects 1.16.2 in the lockfile; the audit passes. Five moderate advisories remain (glob and minimatch under @fastify/static and rimraf), below the CI threshold; their fixes need a major upgrade of @fastify/static |
| The 2.1.3 release notes showed their tables as loose lines, with a blank line after every line | The file had been saved with a blank line inserted after each line (the same fault as the guide chapters in 2.1.3) | Repaired; every Markdown and source file was checked for it |

## 2.1.4 release gate

See `docs/releases/2.1.4-packages.md`.

## Previous release: 2.1.3

### In short

This release adds explicit AI model selection and timeout controls alongside step logs and formula-learning improvements.

- **A new sample, Functions**: every function of the formula language on one order, a Map data step per group (text, conversion, encoding, variables, utility, dates, numbers, logic, sequences, lists), each followed by a Log of its results.
- **Local variables as records by ID**: Set Local Variable has a Record ID (1 for new steps), so many values of a run sit in one structure, `{ "1": { … }, "2": { … } }`, read as `{vars.1.name}`; Get Local Variables reads the whole structure or one ID, with the run id.
- **Set Local Variable shows what it set**: one log line per variable, and every step's Output tab now lists that step's own log lines.
- **The counter sample explains itself**: every step is described, and the local variable is read back with Get Local Variables.

### Install and upgrade

Install as for 2.1.2: `bin/sutraflow install` in the unpacked folder (Windows `bin\sutraflow.cmd install`), or silently with `--config`. Upgrade from 2.1.0, 2.1.1 or 2.1.2: unpack 2.1.3 in a folder of its own and run `bin/sutraflow upgrade` from there (the Administration Guide's *Upgrading*). 2.1.3 changes no database tables. AI connections gain model-selection and timeout settings.

**What changes for you:**
- **Set Local Variable steps you add now** start with Record ID 1: their values are read as `{vars.1.name}`. Clear the Record ID to set plain variables (`{vars.name}`) as before. Steps saved before 2.1.3 keep working unchanged.
- **Get Local Variables** returns one more field, `runId`. A mapping or check that compares its whole output with a fixed value needs that field added.
- **Samples already in a project** stay as they were. Adding a sample again gives the 2.1.3 version beside the old one, named with a number.

### Local variable usability

- General supports explicit plain-versus-record storage, declared variable selection, custom names and manual/formula values; Input mapping remains synchronised.
- Get shows name/value pairs from its own completed output, and General lists declared initial values. Earlier Get snapshots are never substituted with later run state.
- Both mapper data trees now retain record-ID nesting rather than presenting record children as plain variables.
- Cancelled-step output explains the run failure and distinguishes queued input from completed output. The engine’s cancellation and variable storage behavior are unchanged.

### AI credential setup usability fix

- Empty credential selectors now explain that a Secret property is needed instead of displaying empty group headings.
- Create and select a named encrypted project Secret directly beside a connection credential field; existing names are never overwritten. The same selector supports AI providers and other connection credentials.
- Refresh properties reloads project/administrator Secret choices. Connection Save retains the selected gv/ev reference; raw values never enter the connection configuration.

### AI connections and execution

- Explicit model selection is required by default across API, local-server and CLI providers. Automatic — first available model is a deliberate opt-in for API/server connections; missing models never silently switch.
- Fetch models uses the configured local/network/API URL and credentials. Gemini discovery follows pagination and generation capabilities, including available Gemini 3.x/4.x models.
- Resolve provider/model previews the provider, model and timeout without inference; step logs record the actual engine/model before requests.
- Connection timeouts default to 120 seconds. AI activities inherit them, with an optional activity override; cancellation reaches HTTP and CLI calls. Embedding models must be explicit.
- API key versus CLI sign-in guidance is visible in the connection editor. Secret values remain masked.
- Upgrade action: select a model on previously blank connections or explicitly opt into Automatic; existing positive step timeouts remain overrides.

### Samples
- **Sample: Functions** (Samples/Data and mapping): an order message with text, numbers, dates, lists and an empty field; then, group by group, a Map data step with one field per function, named after it, and a Log writing that group's results as JSON. All 122 functions have a working formula; a test fails when a new function has none. It brings a small Memory table, *Sample currency rates*, so `memory-lookup()` can show an empty result rather than an error.
- **Sample: Counter, Wait and Sutra variables** now says what each step is for: a local variable lives for one run, a Counter for the project across runs (test twice and the count grows). A *Get Local Variables* step reads the variable back, and the log line uses both.

### Designer
- **Step logs on the Output tab**: after a test, the Output tab lists the selected step's own log lines (what Log wrote, retries, warnings).
- **Set Local Variable** writes one log line per variable it sets (`batch = batch-0930`; secrets are masked in run logs). Its output is still its input, passed on, so existing Sutras behave as before.
- **Record IDs for local variables**: Set Local Variable has a *Record ID*, 1 for new steps. Steps with the same ID add to one record, another ID makes another, and an ID can come from the data (`{{input.orderId}}`), so a For-Each keeps one record per order instead of overwriting one value. All of a run's values sit in one structure, for example `{ "1": { "name": "Jane Doe", "role": "admin" }, "2": { "who": "jane.doe@example.com" } }`, read as `{vars.1.name}`.
- **Get Local Variables** reads the whole structure, one ID (new choice *one ID*), or a plain variable, and returns `runId`, the id of the run the variables belong to. Local variables are kept per run: runs at the same time never see each other's.
- Steps saved before 2.1.3 have no Record ID and keep setting plain variables (`{vars.name}`), so existing Sutras behave as before; the designer shows their Record ID empty.

### Fixes in 2.1.3

| Seen | Cause | Now |
|---|---|---|
| Set Local Variable's Output tab showed only `{}` after a test, as if nothing was set | Its output is its input, passed on; what it set was visible only in later steps | Its log says what it set, and the Output tab shows the step's log |
| The counter sample did not say what a Counter is for, nor how to read a variable back | Its steps had no descriptions and it never used Get Local Variables | Every step is described; it reads the variable back |
| In the Functions sample, trim, left-trim, right-trim and normalize-space all showed `asha KUMAR` on the Output tab, as if they did the same | The functions were right (string-length of the trimmed name is 12); the page collapsed the spaces when showing text | Text keeps its spaces on the Output tab, and text starting or ending with a space is shown in quotes; pointing at a value shows it exactly |
| Code examples in the guides had a blank line after every line | The guide chapters' source file had been saved with a blank line inserted after each line | The file is repaired; the guides are built from it again |
| `npm run architecture` stopped with "no description" for `server/src/ai/policy.ts` and `web/src/local-variables.ts` | The two files added for 2.1.3 had no entry in the architecture's file list | They are described |

## 2.1.3 release gate

See `docs/releases/2.1.3-packages.md`.

## Previous release: 2.1.2

### In short

A release on top of 2.1.1: a guide of its own for administrators, documentation in a clearer order, safer upgrades, and two installer conveniences.

- **SutraFlow Administration Guide**, new, at `/admin-guide` and in the Admin Console: planning a server, the web installer page by page, silent installation, how an upgrade works, the launcher and settings, PostgreSQL, engines and clusters, sizing, the Admin Console, security, receiving releases, monitoring and troubleshooting, with new pictures of every page. It replaces `docs/deployment.md`.
- **The user guide is for designers** and reads in order: what SutraFlow is and getting it, building Sutras, the palettes with their connections, AI, APIs and security, and releasing, under part headings in the contents.
- **Upgrades are safer**: the engine beside the studio stops and starts with it, a folder in use by a web server, terminal or Explorer no longer stops it (a file held without sharing is found before anything changes, with the process that holds it), the way back restores only what an upgrade changes and always starts the old version again, and an SQLite file of its own is upgraded as SQLite.
- **Connection pictures**: every common connection (HTTP, PostgreSQL and MySQL on this machine and remote, Kafka, RabbitMQ, ActiveMQ, MongoDB) shown filled in and tested, in its palette's chapter.
- **Save the installer's answers as a config file** on the Review page, to install the next server silently with the same choices. The file holds no password.
- **The web installer keeps a log**, in `data/logs/installer.log`, with a download link on its last page and when a step fails.

### Install

- **Web installer**: unpack, then `bin/sutraflow install` (Windows: `bin\sutraflow.cmd install`). It opens in the browser of that machine.
- **Silent**: `bin/sutraflow install --config install.json`; the example is `docs/install-example.json`, or the file the web installer saved; `--dry-run` prints the plan.
- **By hand**: `bin/sutraflow setup`, then `bin/sutraflow start`.

Node.js 22.13 or later is needed (24 recommended).

### Upgrade from 2.1.0 or 2.1.1

Unpack 2.1.2 beside the installation and run `bin/sutraflow upgrade` from the new folder (or `upgrade --config upgrade.json`). It stops SutraFlow gracefully, backs it up, upgrades, compares the data and starts it again, and puts the previous version back if a step fails: the Administration Guide's *Upgrading* has every step with pictures. 2.1.2 changes no database tables and no settings.

**What changes for you:**
- **Nothing needs closing for an upgrade** but programs that hold SutraFlow's files without sharing: web servers, terminals and Explorer windows in the folder can stay. When a file is held, the upgrade says which and by which process before changing anything.
- **`docs/deployment.md` is gone**: its content is in the Administration Guide (`/admin-guide`). Links and bookmarks to it should point there.
- **Administration chapters moved** from the user guide to the Administration Guide; links between the two guides open the other one at the right chapter.

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
