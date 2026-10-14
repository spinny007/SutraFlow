# SutraFlow

A visual integration designer and engine. You drag activities from palettes onto a canvas, map data between steps, test-run, and deploy Sutras that run on the server, either on a schedule or as REST and SOAP APIs secured by policies and TLS.

One Node.js Sutra contains the studio, the engine and the gateway. Storage is SQLite, built into Node, so there is no database to install.

## Quick start

Requires Node.js 22.13 or later (24 recommended).

```bash
npm install
```

```bash
npm run build
```

```bash
npm start
```

Open http://127.0.0.1:4800 and create the administrator account. Deployed services are served by the gateway on port 8080 (HTTP) and 8443 (HTTPS once a certificate is set).

For development with hot reload (studio on http://localhost:5173, API proxied to 4800):

```bash
npm run dev
```

Run the test suite:

```bash
npm test
```

## Sample Sutras

**+ New Sutra → Choose samples** adds working examples (all, or the ones you tick): For-Each mapping; loops on an activity; a sub-Sutra with Return; try / catch with logs; a REST API with validation; CSV import and totals; a folder of files; a SQLite database; XML in and out; JSONata, JavaScript and HTML; Router, Switch and Merge; connection conditions; channels between Sutras; counter, wait and Sutra variables; local AI with Ollama; emailing a report; a queue in and out; and two MCP skills (write a CSV file, post to a Facebook page). Those needing a connection or a local model say so.

## MCP skills

A Sutra that starts with **MCP skill** is a tool AI assistants call over the Model Context Protocol; **Reply to AI** returns the outcome. An **MCP server** connection groups skills at an address on the gateway (for example `/mcp/orders`) with instructions and a security policy:

```
claude mcp add --transport http orders https://your-server:8443/mcp/orders --header "X-API-Key: your-key"
```

## User guide

The full user guide is [docs/sutraflow-user-guide.html](docs/sutraflow-user-guide.html), also served by the studio at http://127.0.0.1:4800/guide (the **Guide** button in the top bar). It covers every screen, chapter by chapter, and every activity, connection type, function and pipe with its settings.

```bash
npm run guide          # rebuild the guide from the code (tools/build-user-guide.ts)
npm run guide:shots    # retake its screenshots from a running server (headless Edge or Chrome)
```

## Projects

The Designer's left panel has two tabs: **Project** (explorer) and **Palettes**. A project holds:

| Item | Use |
|---|---|
| Sutras | the Sutras, each with **Sutra variables** (`{vars.x}`) |
| Resources | shared connections and security: HTTP, outbound security, API policies, databases, Kafka / RabbitMQ / ActiveMQ, SMTP / IMAP, Firebase, OAuth accounts, AI provider. Renameable; the name is the key in the deployment config |
| Schemas | shared JSON (JSON Schema or a sample document) and XML (XSD) schemas that activities pick for payloads, bodies and mapping targets |
| Service descriptors | WSDL files that Invoke SOAP service can call |
| Project variables | `{gv.NAME}` ($_projectVariables) of type string, number, boolean or secret |
| Deployment config | per-environment overrides for variables, resource settings and logging; exported/imported as one JSON file, or dropped in `data/config/<project>.json`; values may use `${env:NAME}` or `${env:NAME:-default}` |
| Logging | log file per project (path, level, text/JSON, rotation, optional step input/output) |

## What is in the palettes

| Palette | Activities |
|---|---|
| Triggers | Manual start, Timer (cron or interval), REST service, SOAP service (one output per operation, generated WSDL), Channel trigger |
| HTTP / REST | Send HTTP request (headers, query, JSON/XML/text/form or body mapped to a schema; outbound security; TLS/mTLS), Send HTTP response |
| SOAP / Web services | Invoke SOAP service (WSDL URL or project service descriptor, operation picker, raw envelope; WS-Security), SOAP reply (response or fault) |
| Data & mapping | Map data (target schema, For-Each with Where / Group by / Sort by, If, Choose), Transform (JSONata), Parse/Render JSON and XML (with schemas), Parse/Render CSV, Filter, Sort, Aggregate |
| Flow control | If/else, Switch, Router (named conditions, first or all matches, otherwise), For each, Merge, Wait (durable), Human approval, Set variables, Throw error, End (this branch, or stop the whole Sutra as succeeded or failed), Call Sutra and Return (reusable Sutras), Error handler (one per Sutra), No operation |
| Files | File trigger (added / modified / removed), Read file, List / read directory (`C:\in\*.csv`), Write file (Append / Overwrite), Move / copy / delete. Content as text, CSV rows or lines (repeating, typed by a schema), JSON, XML or base64, in UTF-8, UTF-16, ISO-8859-1, Windows-1252 and more |
| DB Ops | SQL query, SQL update, Call procedure, SQL transaction, for PostgreSQL, MySQL/MariaDB, SQL Server, Oracle and SQLite; `:name` parameters always bound |
| Service Bus | Publish message, Message subscriber (trigger), Confirm message, for ActiveMQ / AMQP 1.0, RabbitMQ and Kafka: queue or topic, JMS headers (delivery mode, priority, time to live, message/correlation id, reply-to, type), custom properties, selectors, durable subscriptions; acknowledge auto, client (after success) or explicit (Confirm message); requeue or dead-letter on failure |
| Email | Send email (SMTP, HTML, attachments), Email trigger (IMAP; mark read or move after success) |
| Firebase | Firestore (get, set, add, query, delete), Realtime Database, Push notification (FCM) |
| Apps | Google Sheets, Google Drive / Docs, Google Drive / Docs trigger, Dropbox, YouTube, Facebook Page, Connected API call (any REST API of an OAuth account) |
| Custom code | JavaScript code (sandboxed: no host access, time and memory limits), HTML template (escaped placeholders, each / if) |
| Scripts | PowerShell script (Windows PowerShell or 7), Shell script (bash, sh, cmd), Run program (arguments without a shell). Output, error output, exit code and JSON output captured; failures carry them on the error output. Off until an administrator allows scripts in Server & APIs; values arrive as environment variables, never as script text |
| General | Log, Validate fields, Send to channel (in-memory messages to other deployed Sutras), Counter (per project, kept across restarts) |
| AI | AI prompt, AI classify, AI router, AI extract, AI summarize, AI translate, AI sentiment. Engines: Claude, Gemini and OpenAI APIs, Ollama, and the Claude, Gemini and Codex command-line tools. Every AI activity also returns the provider, model, tokens and time |

Every activity except triggers also has an **error** output. Connect it to handle failures; otherwise the Sutra's **Error handler** runs, or the run fails. Each activity can have retries with exponential backoff, a timeout, a breakpoint, a **loop** (for each item of a list, collecting the results, or repeat while a condition holds, with a delay), and can be skipped. HTTP connections have an optional **circuit breaker**.

## Mapping (Input tab)

Select an activity and open **Input**. **Sutra Data** (left) lists `$_projectVariables`, `$_sengineVariables` (read only), `$_sutraContext`, `$_sutraVariables`, the previous step and every upstream activity; **Activity Input** (right) lists the activity's inputs and, for structured inputs, the tree of the chosen schema. Lines show what is mapped from where.

- Drag a field from left to right, or select a target and write its formula below. The function browser groups String, Encode/Decode, Date/Time, Number, Logical and List functions; a live preview evaluates the formula against the last run.
- Drop a list onto a repeating target: a **For-Each** is created and fields with matching names are mapped (`{item.x}` is the current item, `{index}` its position). Targets also take **If** (include only when true) and **Choose / When / Otherwise**. **Auto map** maps every field with the same name.
- **For-Each** options: **Where** keeps rows where a condition holds, **Group by** gives one element per distinct value (`{group.key}`, `{group.items}`, `{group.count}`), **Sort by** orders them. These use the row's column names directly: `upper-case(Country) = 'INDIA'`.
- Click a field on either side to highlight where it is mapped; other lines fade.
- Before a run, the trees show field names and types; after a run, values. An activity whose branch was not taken shows "not run" with its fields.

Formulas (any input starting with `=`, and every mapping target):

```
=concat('Name : ', {input.name})
=upper-case(substring-before({input.email}, '@'))
=format-date('DD-MM-YY', {nodes.Parse XML.Order.date})
=format-dateTime('DD MMM YYYY HH:mm', current-dateTime(), 'Asia/Kolkata')
=string-to-base64(concat({gv.USER}, ':', {gv.PASSWORD}))
=if({input.amount} > 1000, 'bulk', 'retail')
=format-number(sum({input.lines}, 'price'), '#,##0.00')
={input.rows}[upper-case(Country) = 'INDIA']          rows where the condition holds (XPath style)
=count({input.rows}[Amount > 1000])
={input.rows}[1].City                                    first row, then a field
=sum({group.items}, 'Amount')                            inside a For-Each grouped by a field
=xs:integer({input.qty})                                 casting: xs:string, xs:decimal, xs:boolean, xs:date...
=concat({gv.OUT}, '\', current-timestamp('YYYYMMDD'), '.csv')
=set-project-variable('LAST_RUN', current-dateTime())
```

Function groups: String, Conversion, Encode/Decode, Date/Time, Number, Logical, Sequence (`count`, `position()`, `last()`, `exists`, `empty`), List (`group-by`, `flatten`, `pluck`, `sort`), Variables (`get-project-variable`, `set-project-variable`, `get-sengine-variable`, `set-sengine-variable`) and Utility (`uuid`, `timestamp`, `current-timestamp`, `file-name`, `dir-name`, `path-join`, `format-bytes`, `newline`). Backslashes in quoted text are literal (Windows paths); write a quote twice to include it.

For larger reshaping of repeating JSON (filter, group, aggregate, nest in one expression), the **Transform (JSONata)** activity runs a JSONata expression, the same language as Node-RED and AWS Step Functions:

```
{ "orders": rows[$uppercase(Country) = "INDIA"].{ "id": OrderId, "total": Qty * Price },
  "byCity": rows{ City: $sum($.(Qty * Price)) } }
```

Plain text inputs may still use `{{input.x}}` templates with pipes. Field references: `input`, `nodes.<Activity name>`, `trigger`, `vars`, `gv` (project variables), `ev` (Sengine variables), `sutra` (the run: id, name, version, step), `secret`, `item`, `index`, `group`.

Settings in the **General** tab (folders, URLs, queue and topic names, cron expressions) and connection settings also accept `{{gv.NAME}}`, `{{ev.NAME}}` and `=` formulas; the `{x}` button next to a field inserts a variable. **Sengine variables** are server settings made by the administrator in Server & APIs and shared by all projects. Sutras read them; changing them from a Sutra (`set-sengine-variable`) is off unless the administrator allows it, and is not advised.

Names used in the studio: a process is a **Sutra**; its local variables are **Sutra variables** (`{vars.x}`); project-wide values are **Project variables** (`{gv.X}`); server-wide settings are **Sengine variables** (`{ev.X}`).

## Debugging

**Debug** runs the draft one activity at a time: it pauses before each activity (the canvas highlights it and its Output tab shows the input it will receive). **Step** runs the next activity, **Continue** runs to the next breakpoint, **Pause** stops before the next one, **Stop** cancels. Breakpoints are set per activity in its Settings tab.

## Security

### Calling out (Resources > Outbound security)

| Method | Applies to | What is sent |
|---|---|---|
| Basic | REST, SOAP | `Authorization: Basic` |
| Bearer | REST, SOAP | `Authorization: Bearer` |
| API key | REST, SOAP | header or query parameter |
| OAuth 2.0 client credentials | REST, SOAP | token fetched from the token URL, cached until expiry |
| Custom headers | REST, SOAP | any headers, values may use `{{secret.X}}` |
| WS-Security UsernameToken | SOAP | `wsse:UsernameToken`, PasswordDigest (nonce + created) or PasswordText, optional Timestamp |
| WS-Security SAML token | SOAP | the SAML 1.1/2.0 `<Assertion>` in `wsse:Security`, from the vault or mapped from an earlier step (for example an STS call), optionally with a UsernameToken |
| WS-Security X.509 | SOAP | BinarySecurityToken plus XML signature over Body and Timestamp (RSA-SHA256 or SHA1) |

TLS for outbound calls comes from an **HTTP connection** resource: extra trusted CAs, client certificate and key (mutual TLS), proxy, timeout and certificate checking.

### Exposing APIs (Resources > API security policy)

A policy attached to a REST or SOAP service trigger checks, in order: HTTPS required, IP allow list (exact or IPv4 CIDR), caller authentication, then a per-caller rate limit. CORS origins are optional.

Caller authentication: none, Basic (users map to vault secrets), API key (header; keys in the vault), JWT bearer (JWKS URL, PEM public key, or HS256 shared secret; issuer, audience and required scopes), WS-Security UsernameToken for SOAP (digest with time window and nonce replay protection), and mutual TLS (client CA in Server settings; optional allowed subjects).

### Gateway TLS (Server & APIs)

- **Self-signed**: for testing.
- **Own certificate**: paste the PEM chain and key; the key is checked against the certificate and stored encrypted.
- **Let's Encrypt**: HTTP-01 challenge answered by the gateway's HTTP listener, which must be reachable as port 80 on each domain. Staging is on by default. Certificates renew automatically 30 days before expiry and are swapped in without dropping connections.
- **Client CA**: enables mutual TLS for services whose policy uses `mtls`.

TLS 1.2 is the minimum.

### Secrets and the studio

- Secrets are encrypted with AES-256-GCM using `SUTRA_MASTER_KEY` (32 bytes, base64) or `data/master.key`, which is created on first start. Back that key up: without it the vault cannot be read.
- Secret values are never returned by the API. Any secret used during a step is masked in stored outputs and logs.
- The studio listens on 127.0.0.1 by default. Sessions are HttpOnly SameSite=Strict cookies, every change needs an `X-Sutra` header (CSRF guard), and sign-in attempts are throttled.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `SUTRA_DATA_DIR` | `./data` next to the install | database, master key |
| `SUTRA_MASTER_KEY` | (file) | vault key, base64 32 bytes |
| `SUTRA_ADMIN_HOST` / `SUTRA_ADMIN_PORT` | 127.0.0.1 / 4800 | studio and admin API |
| `SUTRA_GATEWAY_HTTP_PORT` / `SUTRA_GATEWAY_HTTPS_PORT` | 8080 / 8443 | defaults until changed in Server & APIs |
| `SUTRA_WORKERS` | 16 | steps executed at the same time |
| `SUTRA_MAX_STEPS` | 10000 | per-run safety cap |
| `SUTRA_REPLY_TIMEOUT_MS` | 60000 | how long a REST/SOAP caller waits for the reply step |

## How runs are managed

See [docs/architecture.md](docs/architecture.md). In short: a run is a database row and each step execution is a task row. Workers pick pending tasks, and each finished step is checkpointed in one transaction together with the tasks for the next steps. Approvals and long waits cost nothing while they wait. After a crash, steps that were in flight go back to pending and resume. Runs that are in progress finish on the Sutra version they started with.

## Run API

Start the deployed version of a Sutra from another system (studio session required):

```
POST /api/flows/{flowId}/run?wait=30000
{ "input": { "orderId": "A-1" } }
```

## Tested here, and not

The test suite (`npm test`, 76 tests) runs real servers for HTTP, SOAP with WS-Security, TLS, SMTP, an AMQP 1.0 peer (the ActiveMQ protocol), SQLite, and mock Google / Firebase / OAuth endpoints. PostgreSQL, MySQL, SQL Server, Oracle, Kafka, RabbitMQ, IMAP, Let's Encrypt and the live Google, Dropbox, YouTube and Facebook APIs use their standard client libraries but have not been run against real servers yet.

## Not yet included

WS-Security encryption and validation of incoming SAML/X.509 signatures; JSON Schema / XSD validation of messages; multiple studio users with roles; clustering several engine nodes on a shared database; SFTP/FTP and more SaaS connectors (the Connected API call activity reaches any REST API of an OAuth account meanwhile). New connectors register in `server/src/palettes/index.ts`.
