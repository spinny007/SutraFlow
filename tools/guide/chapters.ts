/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
/**
 * User guide chapters. Plain HTML with a few markers the builder expands:
 *   [[img:name|Caption]]   a screenshot from docs/guide-images/name.jpg
 *   [[type]]               a link to an activity's reference entry
 *   [[note:Title|text]]    a blue note;  [[tip:Title|text]] a yellow guideline box
 */
export interface Chapter { id: string; title: string; html: string }

export const CHAPTERS: Chapter[] = [
  {
    id: 'overview', title: 'What SutraFlow is',
    html: `
<p>SutraFlow is a visual integration designer and engine. You build a <strong>Sutra</strong> by dragging <strong>activities</strong> from palettes onto a canvas and connecting them; you map data from earlier activities into later ones; you test and debug it in the studio; and you <strong>deploy</strong> it to run on the server: on a schedule, when a file or message arrives, or as a REST or SOAP API protected by a security policy and TLS.</p>
<p>One program contains three parts:</p>
<ul>
<li><strong>The studio</strong> at <code>http://127.0.0.1:4800</code>: the Designer, Runs, Resources and read-only Services screens.</li>
<li><strong>The engine</strong>, which runs Sutras step by step and saves each finished step, so runs survive a restart and long waits cost nothing.</li>
<li><strong>The gateway</strong> on ports 8080 (HTTP) and 8443 (HTTPS), which serves deployed APIs, separately from the studio.</li>
</ul>
[[note:Words used in this guide|A <em>project</em> holds Sutras, shared resources (connections), schemas and properties. A <em>Sutra</em> is one process diagram. An <em>activity</em> is one box on it; a <em>step</em> is one execution of an activity in a run; a <em>run</em> is one execution of a Sutra. <em>Local variables</em> live for one run, <em>Project properties</em> are shared by a project's Sutras, and <em>Engine properties</em> are server settings made by the administrator.]]
[[img:designer|The Designer: palettes on the left, the process in the middle, the selected activity's tabs on the right.]]`,
  },
  {
    id: 'start', title: 'Install and start the server',
    html: `
<p>SutraFlow needs Node.js 22.13 or later; version 24 is recommended. Nothing else is installed: the database is SQLite, built into Node.</p>
<p class="h">From a release (servers)</p>
<p>Each release comes as <code>sutraflow-&lt;version&gt;-windows.zip</code> and <code>sutraflow-&lt;version&gt;-linux.tar.gz</code>, already built, each with a <code>.sha256</code> file; offline archives with the packages inside are there for servers without access to the npm registry. <code>RELEASE-NOTES.md</code> in the archive has the steps for each system and for upgrades.</p>
<ol>
<li>Check the download: <code>sha256sum -c sutraflow-2.0.3-linux.tar.gz.sha256</code>, or on Windows <code>Get-FileHash sutraflow-2.0.3-windows.zip -Algorithm SHA256</code> against the <code>.sha256</code> file.</li>
<li>Unpack it: <code>tar -xzf sutraflow-2.0.3-linux.tar.gz -C /opt/sutraflow</code>, or <code>Expand-Archive sutraflow-2.0.3-windows.zip C:\\SutraFlow</code>.</li>
<li>In the unpacked folder: <code>bin/sutraflow setup</code> (Windows: <code>bin\\sutraflow.cmd setup</code>) installs the runtime packages and makes <code>sutraflow.env</code>.</li>
<li><code>bin/sutraflow start</code>, then open <code>http://127.0.0.1:4800</code> and create the administrator account.</li>
</ol>
<p>To upgrade, stop gracefully, back up the data folder (with <code>master.key</code>), unpack the new release beside the old one, bring over <code>sutraflow.env</code> and the data folder, run <code>setup</code> and start; the database is upgraded at start. In a cluster, upgrade every engine before starting any of them.</p>
<p class="h">From the source</p>
<ol>
<li>Open a terminal in the SutraFlow folder.</li>
<li>Install and build: <code>bin/sutraflow setup</code> (Windows: <code>bin\\sutraflow.cmd setup</code>). It runs <code>npm install</code> and <code>npm run build</code>, and makes <code>sutraflow.env</code>, where the ports, the data folder and the database are set.</li>
<li>Start: <code>bin/sutraflow start</code></li>
<li>Open the designer: <code>bin/sutraflow open</code> (<code>http://127.0.0.1:4800</code>). The first time, create the administrator account.</li>
</ol>
<p class="h">The sutraflow command</p>
<p>Every way of running SutraFlow uses one launcher: <code>bin/sutraflow</code> on Linux and macOS, <code>bin\\sutraflow.cmd</code> on Windows (after <code>npm install -g</code> it is simply <code>sutraflow</code>). Its settings come from <code>sutraflow.env</code> in the SutraFlow folder, made from <code>sutraflow.env.example</code> on first use.</p>
<table class="t"><thead><tr><th>Command</th><th>What it does</th></tr></thead><tbody>
<tr><td><code>start</code>, <code>start engine</code></td><td>Starts the studio, or a headless engine beside it on the same database, in the background (output in <code>&lt;data&gt;/logs</code>). <code>--foreground</code> keeps it in the terminal, for services and Laragon.</td></tr>
<tr><td><code>stop</code>, <code>stop engine</code>, <code>stop all</code></td><td>Graceful: no new work, running steps finish first. <code>--force</code> ends a process that does not stop.</td></tr>
<tr><td><code>restart</code>, <code>status</code>, <code>logs [--follow]</code></td><td>Restart; whether each part is ready, its process, addresses and database; the output log.</td></tr>
<tr><td><code>open [designer|admin|guide|architecture]</code></td><td>Opens the page in the browser.</td></tr>
<tr><td><code>cli ...</code></td><td>The <code>sutra</code> command against this studio with the local admin token, for example <code>sutraflow cli sutras list</code>.</td></tr>
<tr><td><code>db info</code>, <code>db copy --to ...</code></td><td>Which database is in use; copies the data to PostgreSQL.</td></tr>
<tr><td><code>service</code></td><td>Starting with the machine: a systemd unit on Linux, a scheduled task on Windows.</td></tr>
<tr><td><code>docker up|down|status|logs|build</code>, <code>docker cluster up|down|...</code></td><td>The studio and an engine in Docker, or PostgreSQL with a studio and two engines. Missing passwords and the master key are made once into <code>.env</code>.</td></tr>
</tbody></table>
<p>For development with automatic reload, run <code>npm run dev</code> and open <code>http://localhost:5173</code>. The tests run with <code>npm test</code>.</p>
[[tip:Guidelines|Back up the <code>data</code> folder, and above all <code>data/master.key</code>: without it the encrypted secrets cannot be read (see <em>Where SutraFlow keeps its data</em>).<br>Keep the studio on 127.0.0.1: port 4800 is for your team (designer, Admin Console, admin API). Everything others call goes through the API gateway: ports 8080 (HTTP) and 8443 (HTTPS), which serve only deployed Sutras (see <em>The API gateway</em>).]]
<p class="h">Server settings</p>
<table class="t"><thead><tr><th>Environment variable</th><th>Default</th><th>Meaning</th></tr></thead><tbody>
<tr><td><code>SUTRA_DATA_DIR</code></td><td><code>./data</code></td><td>Database, master key, deployment config files.</td></tr>
<tr><td><code>SUTRA_MASTER_KEY</code></td><td>the key file</td><td>The vault key, 32 bytes in base64.</td></tr>
<tr><td><code>SUTRA_ADMIN_HOST</code>, <code>SUTRA_ADMIN_PORT</code></td><td>127.0.0.1, 4800</td><td>Where the studio listens.</td></tr>
<tr><td><code>SUTRA_GATEWAY_HTTP_PORT</code>, <code>SUTRA_GATEWAY_HTTPS_PORT</code></td><td>8080, 8443</td><td>Gateway ports until changed in Admin Console &rarr; Server &rarr; Gateway &amp; TLS.</td></tr>
<tr><td><code>SUTRA_WORKERS</code></td><td>by machine</td><td>Steps that run at the same time: 4 on 1 vCPU / 1 GB, up to 32 on 8 cores (see <a href="#ch-sizing">Sizing and performance</a>).</td></tr>
<tr><td><code>SUTRA_MAX_STEPS</code></td><td>10000</td><td>Safety limit of steps per run.</td></tr>
<tr><td><code>SUTRA_REPLY_TIMEOUT_MS</code></td><td>60000</td><td>How long an API caller waits for the reply step.</td></tr>
<tr><td><code>SUTRA_DB</code></td><td>SQLite in the data folder</td><td><code>postgres://user:pass@host/db</code> to keep everything in PostgreSQL.</td></tr>
<tr><td><code>SUTRA_ENVIRONMENT</code></td><td>development (studio), production (headless engine)</td><td>What the server is for: <code>development</code>, <code>test</code> or <code>production</code>. Shown on every log line and audit entry; on production only administrators clear project logs.</td></tr>
</tbody></table>
<p class="h">A development machine on Windows: Laragon</p>
<p>For development and proofs of concept on Windows, <strong>Laragon</strong> is a convenient base: one installer brings Apache, MySQL, PostgreSQL, PHP, Node.js and HeidiSQL, starts them from one window, and keeps everything under <code>C:\\laragon</code>. The DB Ops samples use its MySQL as it comes (127.0.0.1:3306, user root, no password), and SutraFlow itself can keep its data in its PostgreSQL.</p>
<ol>
<li>Install Laragon (the full edition) and click <strong>Start All</strong>.</li>
<li>Put SutraFlow in <code>C:\\laragon\\www\\sutra</code> and copy <code>deploy/laragon/sutraflow.env</code> beside it: studio on 4810 (gateway 8090), engine on 4811 (gateway 8091), data in <code>C:\\laragon\\data\\sutraflow</code> outside the web folder. Every command is the launcher: <code>bin\\sutraflow.cmd start</code>, <code>stop</code>, <code>status</code>, <code>cli sutras list</code> and so on.</li>
<li>Let Laragon start it: Menu &gt; Procfile, add <code>SutraFlow: autorun C:\\laragon\\www\\sutra\\bin\\sutraflow.cmd start --foreground PWD=www/sutra</code>.</li>
<li>To use PostgreSQL instead of SQLite, run <code>bin\\sutraflow.cmd stop all</code>, then <code>bin\\sutraflow.cmd db copy --to postgres://postgres@127.0.0.1:5432/sutraflow</code> (the database is created when missing), and set the same address as <code>SUTRA_DB</code> in <code>sutraflow.env</code>. <code>bin\\sutraflow.cmd db info</code> shows which database is in use.</li>
</ol>
<p class="h">HeidiSQL and PostgreSQL</p>
<p>HeidiSQL needs the PostgreSQL client library to open a PostgreSQL session; without it the connection fails with a missing <code>libpq.dll</code>. Either choose the library in the session's <em>Library</em> field from <code>C:\\laragon\\bin\\postgresql\\&lt;version&gt;\\bin\\libpq.dll</code>, or copy <code>libpq.dll</code> with the <code>libcrypto-*.dll</code>, <code>libssl-*.dll</code> (and, when present, <code>libiconv-*.dll</code> and <code>libintl-*.dll</code>) from that folder into <code>C:\\laragon\\bin\\heidisql</code> and restart HeidiSQL. pgAdmin and DBeaver bring their own drivers, if you prefer them.</p>
<p class="h">pgvector: knowledge bases in PostgreSQL</p>
<p>A knowledge base stored in <em>PostgreSQL (pgvector)</em> needs the <strong>pgvector</strong> extension in the server. Laragon's PostgreSQL does not include it; add a Windows build that matches the major version of your PostgreSQL:</p>
<ol>
<li>Find the version: in Laragon's terminal run <code>postgres -V</code> (for example 18).</li>
<li>Download a Windows x64 build of pgvector for that version. pgvector itself publishes source only; community builds exist (for example the <em>pgvector_pgsql_windows</em> releases on GitHub). Use one you trust, for the same PostgreSQL major version and 64-bit.</li>
<li>Stop PostgreSQL in Laragon.</li>
<li>From the zip, copy <code>lib\\vector.dll</code> into <code>C:\\laragon\\bin\\postgresql\\&lt;version&gt;\\lib\\</code>, and every file of <code>share\\extension\\</code> (<code>vector.control</code> and the <code>vector--*.sql</code> files) into <code>C:\\laragon\\bin\\postgresql\\&lt;version&gt;\\share\\extension\\</code>.</li>
<li>Start PostgreSQL again.</li>
<li>Check it: <code>SELECT name, default_version FROM pg_available_extensions WHERE name = 'vector';</code> returns a row.</li>
</ol>
<p>SutraFlow then turns the extension on in the knowledge base's database by itself (<code>CREATE EXTENSION IF NOT EXISTS vector</code>) the first time a document is added, when its database user may do so (the <code>postgres</code> user can). With a user without that right, run <code>CREATE EXTENSION vector;</code> once in that database as an administrator; <code>SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';</code> confirms it. Without pgvector, use the <em>built-in</em> or <em>folder</em> store, which need nothing else.</p>
<p class="h">A development machine on Linux</p>
<p>Laragon is for Windows only. On Linux the same set comes from the distribution's packages, or from Docker:</p>
<table class="t"><thead><tr><th>Part</th><th>Debian / Ubuntu</th><th>Fedora / RHEL</th></tr></thead><tbody>
<tr><td>Node.js 24</td><td colspan="2">Through nvm (<code>nvm install 24</code>), or the NodeSource packages.</td></tr>
<tr><td>MySQL or MariaDB</td><td><code>sudo apt install mariadb-server</code></td><td><code>sudo dnf install mariadb-server</code></td></tr>
<tr><td>PostgreSQL</td><td><code>sudo apt install postgresql</code> (newer versions from the PostgreSQL apt repository)</td><td><code>sudo dnf install postgresql-server</code>, then <code>sudo postgresql-setup --initdb</code></td></tr>
<tr><td>pgvector</td><td><code>sudo apt install postgresql-&lt;version&gt;-pgvector</code> from the PostgreSQL apt repository, for example <code>postgresql-17-pgvector</code></td><td><code>sudo dnf install pgvector_&lt;version&gt;</code> from the PostgreSQL yum repository</td></tr>
<tr><td>A database tool</td><td colspan="2">DBeaver, pgAdmin, or the <code>psql</code> and <code>mysql</code> command lines.</td></tr>
</tbody></table>
<p>With Docker, one command gives PostgreSQL with pgvector already in it: <code>docker run -d --name sutra-pg -e POSTGRES_PASSWORD=dev -p 5432:5432 pgvector/pgvector:pg17</code>, and <code>docker run -d --name sutra-mysql -e MYSQL_ROOT_PASSWORD=dev -p 3306:3306 mysql:8.4</code> adds MySQL. Then:</p>
<ol>
<li>Install SutraFlow (Procedure above: <code>bin/sutraflow setup</code>), and set <code>SUTRA_DATA_DIR</code> in <code>sutraflow.env</code>, for example <code>/home/me/sutraflow-data</code>.</li>
<li>To keep SutraFlow in PostgreSQL: <code>bin/sutraflow db copy --to postgres://postgres:dev@127.0.0.1:5432/sutraflow</code>, then set <code>SUTRA_DB</code> to the same address in <code>sutraflow.env</code> and <code>bin/sutraflow start</code>.</li>
<li>Start it with the machine: <code>bin/sutraflow service</code> prints a systemd unit to install.</li>
<li>Check pgvector as on Windows: <code>SELECT name, default_version FROM pg_available_extensions WHERE name = 'vector';</code></li>
</ol>
[[tip:Guidelines|Laragon and these Linux set-ups are for development machines. For servers, run SutraFlow as a service or in Docker with a managed PostgreSQL (see Running in production).<br>Keep the master key safe: the file <code>master.key</code> in the data folder (made the first time a secret is saved), or <code>SUTRA_MASTER_KEY</code>. Moving to PostgreSQL copies the encrypted secrets, and only this key opens them.]]`,
  },
  {
    id: 'tour', title: 'The studio, screen by screen',
    html: `
<p>The top bar holds the four screens, the version in the middle, <strong>Admin Console</strong> (deployed projects, engines, gateway, users and audit, in its own page), <strong>Approval Center</strong> (approvals waiting for people, in a new tab), <strong>Guide</strong> (this guide in a new tab), the light/dark switch and Sign out.</p>
<table class="t"><thead><tr><th>Screen</th><th>What it is for</th></tr></thead><tbody>
<tr><td><strong>Designer</strong></td><td>Building, testing, debugging and deploying Sutras. Left: the <em>Project</em> explorer and the <em>Palettes</em>. Middle: the canvas and its toolbar. Right: the selected activity's General, Input, Output and Settings tabs.</td></tr>
<tr><td><strong>Runs</strong></td><td>Every run with its status, steps, inputs and outputs, logs; approvals waiting for a person (approvers decide in the Approval Center, <code>/approvals</code>).</td></tr>
<tr><td><strong>Resources</strong></td><td>Shared connections and security of the current project, and the secrets vault.</td></tr>
<tr><td><strong>Services</strong></td><td>Read-only addresses and listener health for exposed services. Server-wide controls are in <strong>Admin Console → Server</strong>.</td></tr>
</tbody></table>
<p class="h">The Designer toolbar</p>
<ul>
<li><strong>Sutra list</strong>: opens another Sutra of the project.</li>
<li><strong>+ New Sutra</strong>: type a <em>Name</em> (left empty, the starter's name is used), then pick a blank Sutra or a starter (REST API, SOAP service, approval with timer).</li>
<li><strong>&#9654; Test</strong>: runs the current draft once with the trigger's test data, without deploying.</li>
<li><strong>Debug</strong>: runs the draft one activity at a time (see <a href="#ch-debug">Testing and debugging</a>).</li>
<li><strong>&#8630; Undo</strong> and <strong>&#8631; Redo</strong> (Ctrl+Z, Ctrl+Y or Ctrl+Shift+Z): step back and forward through your changes to the Sutra, up to 100 of them, such as a deleted activity or connection, a move or a changed mapping. While you type in a field, Ctrl+Z undoes the typing in that field instead.</li>
<li><strong>Deploy</strong>: makes the current draft the live version.</li>
<li>Status badges: <em>Saved</em>, <em>Deployed v2</em> or <em>Draft only</em>, and the last test result.</li>
</ul>
<p>The <strong>Delete</strong> key deletes the selected activity or connection (Backspace does not, so editing text never removes an activity). Changes save automatically. Zoom with the wheel or the + and &minus; buttons; the small map at the bottom left shows where you are.</p>`,
  },
  {
    id: 'projects', title: 'Projects and the explorer',
    html: `
<p>Open the <strong>Project</strong> tab on the left of the Designer. The project list at the top switches projects; <strong>+</strong> creates one, starting from:</p>
<ul>
<li><strong>Empty</strong>: a name, nothing else.</li>
<li><strong>Samples</strong>: the sample Sutras you choose. Type in the search box (each word must start a word of the sample, so <em>AI</em> finds the AI samples) and use <em>Select shown</em>; nothing is chosen until you choose.</li>
<li><strong>Package file</strong>: chosen Sutras of a <code>.sutra</code> package from any SutraFlow server, with the project's connections, schemas and variables. They come in as drafts, so nothing starts and no address clashes with the original; tick <em>Deploy the Sutras that are deployed in the package</em> to deploy them as well. Secret values never travel: the import tells you which secrets to add.</li>
<li><strong>Copy a project</strong>: chosen Sutras of a project on this server, as drafts in a new project. The original is not changed. Good for a proof of concept or a study copy.</li>
</ul>
[[img:new-project|New project from samples: the search "AI" and Select shown chose the five AI samples; nothing is chosen until you choose.]]
<p>Each project holds:</p>
<table class="t"><thead><tr><th>Section</th><th>What it holds</th></tr></thead><tbody>
<tr><td><strong>Sutras</strong></td><td>The Sutras, with their deployed version. Each Sutra also has <em>Sutra variables</em>, read as <code>{vars.name}</code>.</td></tr>
<tr><td><strong>Resources</strong></td><td>The project's connections and security, each listed under the name you gave it with a symbol for its kind. <strong>+</strong> opens the list of kinds: HTTP connection, Outbound security, API security policy, AI provider, Email (SMTP and IMAP), Database, Kafka, RabbitMQ, ActiveMQ, Firebase, OAuth connection. The name is its key in the deployment config, so you can rename it safely.</td></tr>
<tr><td><strong>Schemas</strong></td><td>Shared JSON (JSON Schema or a sample document) and XML (XSD) schemas. Activities pick them to describe payloads, bodies, CSV rows and mapping targets.</td></tr>
<tr><td><strong>Service descriptors</strong></td><td>WSDL files that [[soapInvoke]] can call.</td></tr>
<tr><td><strong>Configuration</strong></td><td>Project variables, the deployment config and the log file settings.</td></tr>
</tbody></table>
[[img:project-explorer|The Project explorer with a shared XSD schema open: its fields are shown as a tree, as activities will see them.]]
<p class="h">Folders</p>
<p>Sutras, Resources, Schemas and Service descriptors can each sit in folders, and folders in folders, so a large project stays tidy. Each section has its own folders. Folders only arrange the explorer: a name is still unique in the project, and deploying, calling and packages work as before.</p>
<ul>
<li><strong>+ Folder</strong> under the list makes a folder; type <code>Orders/Inbound</code> for one inside another.</li>
<li><strong>Drag</strong> a Sutra or a folder onto a folder to move it there, or onto the line <em>Drag here for the top level</em>.</li>
<li>The <strong>⋯</strong> button beside an item, or a <strong>right-click</strong> on it, opens its menu: <strong>Rename</strong>, <strong>Move</strong> (type or pick a folder) and <strong>Delete</strong>. Renaming breaks nothing: steps and connections refer to an item by its id.</li>
<li>Beside a folder (or with a right-click) the menu renames or moves the folder with everything in it, makes a folder inside, <strong>removes the folder</strong> (its contents move up one level; nothing is deleted) or <strong>deletes the folder and everything in it</strong>.</li>
<li>A new Sutra goes in the folder of the Sutra open at the time.</li>
<li>Samples go to <code>Samples/&lt;topic&gt;</code>, for example <em>Samples/SQL</em> and <em>Samples/REST and microservices</em>, and the connections made for them to <em>Resources &gt; Samples</em>. Samples added before folders existed were filed there once, when the server was updated. Move them anywhere afterwards.</li>
<li>Packages and project copies keep each item's folder.</li>
<li>Importing chosen Sutras (a new project from a package or a copy) brings the connections, schemas and service descriptors those Sutras use, directly or through each other (an MCP server and its policy), in their folders, and nothing else.</li>
</ul>
<p class="h">Deleting</p>
<p>Sutras, connections, schemas and service descriptors can be deleted one by one (the item's menu, or the <strong>Delete</strong> button of its editor or of the Sutra), or a whole folder with everything in it. Every delete asks first:</p>
<ol>
<li>The dialog says what goes, and lists the Sutras and connections that still use the item: they stop working until you pick another one.</li>
<li>Type <code>delete</code> in the box. Until you do, the Delete button stays off, so a stray click or Enter deletes nothing.</li>
<li>A <strong>deployed</strong> Sutra cannot be deleted: undeploy it first, so a delete never stops a running service by accident. A folder with a deployed Sutra in it is refused the same way, and nothing in it is deleted.</li>
</ol>
<ul>
<li>Deleting a Sutra deletes its saved versions too; its run history is kept.</li>
<li>Deleting a connection leaves its secrets in the vault (they may serve other connections).</li>
<li>The <em>Configuration</em> section (project variables, deployment config, logging) belongs to the project and cannot be deleted; change its values instead.</li>
<li>Deleting needs the same permission as changing the item: <em>Design</em> for Sutras, schemas and service descriptors, <em>Connections</em> for connections. Viewers and approvers cannot delete.</li>
<li>In a project connected to Git, a deleted item shows at once in the Git tab as a deleted file: commit it like any other change (or discard it to bring the item back before the commit).</li>
</ul>
<p class="h">Project log</p>
<p><em>Configuration &gt; Project log</em> shows what this project's runs wrote to its log file (set it up under <em>Logging</em>), newest at the bottom. Filter by level, by <em>Runs from</em> (deployed Sutras or designer tests) and by words; refresh it every 5 seconds; download what is shown. Every line carries two tags: the server it ran on (<em>production</em>, <em>test</em>, <em>development</em>) and the run, <em>deployed v3</em> for a deployed Sutra and its version, or <em>editor test</em> / <em>editor debug</em> for the designer's own runs. In the file a line reads <code>2026-10-19T09:12:03Z INFO  {development, editor test} [Orders / 3f2a91c0 / Check stock] ...</code>.</p>
<p><strong>Clear log</strong> empties the file and its rotated copies; <strong>Clear test runs</strong> deletes the finished test and debug runs of the project and keeps deployed runs. Developers may do both on development and test servers; on a production server only an administrator may. Both are recorded in the audit log.</p>
<p class="h">Missing project variables</p>
<p>When a step reads a project variable the project does not define (<code>{{gv.X}}</code>, <code>{gv.X}</code>, <code>$gv.X</code> in JSONata or <code>get-project-variable('X')</code>), the activity shows ⚠ on the canvas and a warning at the top of its tabs, and it reads as empty while running. The same warning shows on a connection that reads one, and on every step that uses that connection. <strong>Add to project variables</strong> adds the missing names; give them values under <em>Configuration &gt; Project variables</em>. <em>Deploy</em> lists the same warnings.</p>
<p>Every palette supports Project properties. General settings such as a folder, address, API path, schedule, queue, mailbox, model, limit or SQL text show <strong>{x}</strong> where a property can be inserted; mapped Input fields may use <code>{gv.NAME}</code> in formulas. Connection settings, including nested headers, are resolved the same way. SQL text and procedure names accept only Project/Engine properties; a run-input, trigger, earlier-output, Local-variable or secret reference there is refused. Put those values in bound <code>:name</code> parameters.</p>
<p class="h">Add a connection</p>
<ol>
<li>Next to <em>Resources</em>, click <strong>+</strong> and choose the kind, for example <em>HTTP connection</em>.</li>
<li>Give it your own name, such as <em>Orders API</em>. The explorer lists it under that name.</li>
<li>Fill in its settings: address and port, user, the vault secret for the password. Settings marked <strong>{x}</strong> take a project variable, such as <code>{{gv.ORDERS_URL}}</code>, so each environment can use its own value.</li>
<li>Click <strong>Test connection</strong>. SutraFlow tries the settings as they are on screen, with variables filled in, and says what happened: the HTTP status, the database it reached, the mailbox count, the AI model that answered.</li>
<li>Click <strong>Save</strong>.</li>
</ol>
[[img:resource-menu|Resources: + opens the list of kinds. Existing connections are listed under their own names.]]
[[img:resource-new|A new HTTP connection named Orders API, after Test connection.]]
<p class="h">Add a shared schema</p>
<ol>
<li>Next to <em>Schemas</em>, click <strong>+</strong>.</li>
<li>Give it a name and choose the type: JSON or XML (XSD).</li>
<li>Paste the content, or load a file. A JSON sample document is enough; SutraFlow works out the fields.</li>
<li>For an XSD with several root elements, choose the default root element.</li>
<li>Save. The <em>Fields</em> tree shows the result: <code>*</code> marks a required field, <code>**</code> a repeating one.</li>
</ol>`,
  },
  {
    id: 'git', title: 'Git: source control in the designer',
    html: `
<p>The <strong>Git</strong> tab beside Project and Palettes keeps a project in a Git repository (GitHub, GitLab, Bitbucket, Azure DevOps or any Git server), with commits, branches, history and diffs, in the manner of a code editor's source control view.</p>
[[img:git-tab|The Git tab of a project that is not in a repository yet: Initialize or Clone.]]
<p class="h">Where the files live</p>
<p>The designer works on the project in SutraFlow's database as always. A project in Git also has a working copy on the SutraFlow server (<code>&lt;data&gt;/workspaces</code>): before Git looks at it, SutraFlow writes the project there as files, and after a pull, a branch switch or a discard it reads the files back. The repository holds readable files:</p>
<table class="t"><thead><tr><th>File</th><th>Holds</th></tr></thead><tbody>
<tr><td><code>sutraflow.json</code></td><td>The project: description, variables (secret values never), logging, empty folders.</td></tr>
<tr><td><code>sutras/&lt;folder&gt;/&lt;name&gt;.sutra.json</code></td><td>One Sutra (its draft), in its folder.</td></tr>
<tr><td><code>connections/&lt;folder&gt;/&lt;name&gt;.connection.json</code></td><td>One connection; passwords and keys by secret <em>name</em> only, the values stay in each server's vault.</td></tr>
<tr><td><code>schemas/&lt;folder&gt;/&lt;name&gt;.json|.xsd|.wsdl</code></td><td>A schema or WSDL as given, with its <code>.schema.json</code> beside it.</td></tr>
</tbody></table>
<p class="h">Team project and personal copies</p>
<ul>
<li><strong>Initialize repository</strong> puts a team project in a new repository and makes the first commit; <strong>Publish</strong> sends it to an empty repository on the server. Everyone with Design on the project commits and pushes it, each with their own Git account. This is the project that is deployed.</li>
<li><strong>Clone repository</strong> makes <em>your own copy</em>, named "&lt;name&gt; (you)". Only you see it; it can be tested, never deployed; your changes reach others when you push, and theirs reach you when you pull. Several people's copies of one repository never share ids or edits.</li>
<li><strong>Restricted mode</strong>: a clone opens restricted. Steps that run code or commands from the repository (PowerShell, shell scripts, programs, JavaScript, release steps, MCP commands) do not run until you click <strong>Trust the authors</strong>. Reading, editing and other steps work as usual.</li>
</ul>
<p class="h">Your own Git account</p>
<p><strong>My Git accounts</strong> holds your personal access tokens for each server. They are encrypted, never shown again, and used only for your pull and push; nobody else, not even an administrator, can see them or push with them. Commits carry the account's author name and email, or your own. Each provider says which token to make (GitHub: a fine-grained token with Contents read and write). Public repositories clone without an account. OAuth sign-in buttons are not available; connect a personal access token.</p>
<p class="h">Working with changes</p>
[[img:git-changes|A project in Git: branch main, two changed Sutras (M changed, A added), the commit message, and the graph.]]
<ol>
<li><strong>Changes</strong> lists what differs from the last commit, by item: Sutra, connection, schema or project settings, marked M (changed), A (added), D (removed). Click an item for its diff; a Sutra's diff names the steps added, removed and changed above the lines. ↺ undoes one change; <em>Discard all</em> undoes every change.</li>
<li>Write a message and <strong>Commit</strong> (Ctrl+Enter), or <strong>Commit &amp; Push</strong>.</li>
<li><strong>⟳</strong> syncs (pull, then push); <strong>↓</strong> pulls; <strong>↑</strong> pushes. ↑2 ↓1 beside the branch counts commits to push and to pull. A pull needs no uncommitted changes.</li>
<li><strong>⑂ branch</strong> lists branches here and on the server and creates new ones; switching loads that branch into the project.</li>
<li><strong>Graph</strong> shows the history with branch labels; click a commit for the items it changed and their diffs.</li>
</ol>
<p class="h">Conflicts</p>
<p>When a pull finds that both sides changed the same item, the project is left as it was and the conflicting items are listed. Choose <strong>Mine</strong> or <strong>Theirs</strong> for each; when none are left the merge is finished and loaded. <strong>Abort the merge</strong> goes back to before the pull.</p>
<p class="h">The Git program</p>
<p>SutraFlow uses the <code>git</code> command when it is installed (all features, SSH addresses), and its built-in Git otherwise (HTTPS only; a pull whose changes overlap needs the git command). <code>SUTRA_GIT=system</code> or <code>builtin</code> chooses. Tokens reach Git only through settings of the one command, never on its command line.</p>
[[tip:Guidelines|Deploy to production from packages built by your pipeline from the repository, not from a personal copy (Releases).<br>Keep secret values out of Git: connections name their secrets, and each server's vault holds the values.<br>Give each repository's tokens the narrowest rights: Contents read and write on that repository only.]]`,
  },
  {
    id: 'build', title: 'Building a Sutra',
    html: `
<ol>
<li>Click <strong>+ New Sutra</strong>, type its name, and choose a starter or start blank.</li>
<li>Drag a process starter (or keep Manual start). Starters carry a green <strong>▶</strong>: the common ones are in Triggers, while file, remote-file, email, queue/topic, cloud, chat, ADF, agent and MCP starters stay beside their related activities. A Sutra has one starter.</li>
<li>Drag activities onto the canvas. Search the palettes with the box at the top.</li>
<li>Connect an activity's output (a circle on its right) to the next activity's input (on its left). Activities with several outputs, such as [[if]] or [[router]], have one circle per output.</li>
<li>Select each activity and fill in its tabs.</li>
<li>Click <strong>Test</strong>. Each activity shows its result; select one and open <strong>Output</strong> to see the values.</li>
<li>When it works, click <strong>Deploy</strong>.</li>
</ol>
<p class="h">Branches, errors and ends</p>
<ul>
<li>Every activity except triggers and End has a red <strong>error</strong> output. Connect it to handle a failure; otherwise the failure ends the run as failed.</li>
<li>A branch that is not taken is <em>skipped</em>; a [[merge]] after it still continues.</li>
<li>[[end]] ends a branch. With <em>Sutra: success</em> or <em>Sutra: error</em> it stops the whole Sutra at once and cancels the other branches.</li>
<li>[[throw]] fails a branch with your message, so an error output before it can handle it.</li>
<li>The [[catch]] activity catches every error whose activity has no error output connected: one place to log, alert and clean up.</li>
</ul>
<p class="h">Connections: names and conditions</p>
<p>Click a connection to name it and decide when it is taken. The name and condition show on the canvas.</p>
<table class="t"><thead><tr><th>Taken</th><th>Meaning</th></tr></thead><tbody>
<tr><td><strong>Always</strong></td><td>Every time the activity finishes on that output. The default.</td></tr>
<tr><td><strong>When a condition is true</strong></td><td>A formula on the previous activity's output, which it reads as <code>{input.x}</code>. Browse <strong>Condition data</strong> to insert the previous activity, earlier activities, trigger data, Local variables or Project/Engine properties; the <strong>{x}</strong> button is the quick Project/Engine picker. For example, <code>={input.amount} &gt; {gv.LIMIT}</code> can be named <em>Over project limit</em>. Several "when" connections can be taken together.</td></tr>
<tr><td><strong>Otherwise</strong></td><td>Taken when none of the "when" connections from the same output was taken.</td></tr>
</tbody></table>
<p>A connection that is not taken counts as a skipped branch, so a [[merge]] after it still continues. For many routes, or for routes on the same message used in several places, a [[router]] activity keeps them in one place.</p>
<p class="h">Sample Sutras</p>
<p>Samples that need a connection get one in the project, named <em>Sample ...</em> (Sample MySQL, Sample SFTP, Sample SMTP and so on), already chosen in their activities. Fill in its address, user and password, click <strong>Test connection</strong>, and the sample runs. Adding more samples later reuses these connections. The SQL samples use Laragon's MySQL defaults (127.0.0.1:3306, user root, no password).</p>
<p>Click <strong>+ New Sutra</strong>, then <strong>Choose samples</strong> to tick the ones you want, or <strong>Add all</strong>. Test each one and open its activities' Input and Output tabs to see how it is built. Samples that write files use <code>C:/sutra/samples</code>; change the folder to suit your machine.</p>
[[samples]]
[[img:sample-foreach|Sample: For-Each mapping. The repeating target <em>lines</em> is selected: its For-Each takes the order lines, keeps rows where qty &gt; 0 and sorts them by sku.]]
[[img:sample-trycatch|Sample: Try and catch with logs after a test: Check stock's own error output handled one failure; the Error handler caught Reject and logged it.]]
<p class="h">Reusable Sutras</p>
<p>Put logic used in several places in its own Sutra: a Manual start with a payload schema, the steps, and [[return]] with the result. Other Sutras run it with [[callProcess]], wait for the result and continue; a failure inside it arrives on Call Sutra's error output. While you test, the draft of the called Sutra runs; deployed Sutras call its deployed version.</p>
<p class="h">Loops</p>
<p>Any activity can run more than once (Settings tab &rarr; <em>Loop</em>):</p>
<ul>
<li><strong>For each item of a list</strong>: once per item of <em>Loop over</em>. Map <code>{iteration.value}</code> (or <code>{item}</code>) and <code>{iteration.index}</code>; the mapper lists them under <code>$iteration</code>. The output is <code>iterations</code> (every result) and <code>count</code>.</li>
<li><strong>Repeat while a condition holds</strong>: runs, then checks the condition, for example <code>={iteration.output.status} != 'DONE'</code>, with a delay between runs: polling until a job is finished. The output is the last result plus <code>_iterations</code>.</li>
</ul>
<p>A looping activity shows &#8635; after its type on the canvas. Each loop has a maximum number of runs (1000 by default).</p>
<p class="h">Sutras working together</p>
<ul>
<li>[[callProcess]]: run another Sutra and use its result.</li>
<li>[[channelPublish]] and [[channelTrigger]]: tell other deployed Sutras that something happened, in memory.</li>
<li>[[counter]]: a number shared by all runs of the project, such as a sequence or a daily total.</li>
</ul>
[[tip:Guidelines|Name activities by what they do (<em>Get order</em>, not <em>HTTP 1</em>): mappings refer to activities by name, and renaming one updates them.<br>Give every API branch a reply, including the error branches.]]`,
  },
  {
    id: 'tabs', title: 'The activity tabs',
    html: `
<table class="t"><thead><tr><th>Tab</th><th>What it holds</th></tr></thead><tbody>
<tr><td><strong>General</strong></td><td>The activity's name and its fixed settings: folders, URLs, methods, connections, formats. Fields with <strong>{x}</strong> accept Project and Engine properties (<code>{{gv.OUTBOX}}</code>, <code>{{ev.REGION}}</code>) and <code>=</code> formulas. <em>Map inputs</em> opens the Input tab.</td></tr>
<tr><td><strong>Input</strong></td><td>The mapper: values that come from earlier activities (see <a href="#ch-mapping">Mapping data</a>).</td></tr>
<tr><td><strong>Output</strong></td><td>The fields this activity produces, before any run; after a run, the values it received and produced.</td></tr>
<tr><td><strong>Settings</strong></td><td>Retries with a growing delay, a timeout, a breakpoint for debugging, and <em>skip this activity</em>.</td></tr>
</tbody></table>
[[img:general-tab|The General tab of Write file: the folder accepts variables through {x}; Append and Overwrite are checkboxes.]]
[[img:output-tab|The Output tab after a test: the fields and their values.]]
<p class="h">Settings tab reference</p>
<table class="t"><thead><tr><th>Setting</th><th>What it does</th><th>Default</th></tr></thead><tbody>
<tr><td><strong>Retries on failure</strong></td><td>Runs the activity again after a failure, up to this many times (at most 20), before the error output is used.</td><td>0</td></tr>
<tr><td><strong>First retry delay (ms)</strong></td><td>Wait before the first retry; each retry waits twice as long as the one before.</td><td>1000</td></tr>
<tr><td><strong>Timeout (ms)</strong></td><td>Fails the activity if it takes longer.</td><td>120000</td></tr>
<tr><td><strong>Skip this activity</strong></td><td>Passes the input through without running the activity.</td><td>off</td></tr>
<tr><td><strong>Breakpoint</strong></td><td>The debugger pauses before this activity.</td><td>off</td></tr>
<tr><td><strong>Loop</strong></td><td>Run once, for each item of a list, or repeat while a condition holds (see <a href="#ch-build">Loops</a>).</td><td>Run once</td></tr>
<tr><td><strong>Loop over</strong> / <strong>Repeat while</strong></td><td>The list, or the condition checked after each run.</td><td>&mdash;</td></tr>
<tr><td><strong>Delay between runs (ms)</strong></td><td>Wait between two runs of the loop.</td><td>0</td></tr>
<tr><td><strong>Maximum runs</strong></td><td>Fails the activity when the loop would run more often (at most 10000).</td><td>1000</td></tr>
</tbody></table>`,
  },
  {
    id: 'mapping', title: 'Mapping data',
    html: `
<p>Select an activity and open <strong>Input</strong>. <strong>Sutra Data</strong> on the left lists everything the activity can use: <code>$_projectVariables</code>, <code>$_sengineVariables</code> (read only), <code>$_sutraContext</code> (this run: id, name, version, step), <code>$_sutraVariables</code>, the previous step as <code>input</code>, and every earlier activity by name. <strong>Activity Input</strong> on the right lists what the activity needs; for structured inputs, the tree of the chosen schema.</p>
[[img:mapper|The mapper: Process Data on the left, the target on the right, the selected target's formula below with the function library.]]
<p class="h">Procedure</p>
<ol>
<li>Drag a field from the left onto a target field on the right. A line shows the link.</li>
<li>Or select a target and write its formula in the box below. Click a function in the library to insert it; the preview under the box shows the result against the last test run.</li>
<li>Drop a <strong>list</strong> onto a <strong>repeating</strong> target: a For-Each is created and fields with the same names are mapped. Inside it, <code>{item.x}</code> is the current row and <code>{index}</code> its position.</li>
<li>Click <strong>Auto map</strong> to map every field that has the same name on both sides.</li>
<li>Click any field, on either side, to highlight where it is mapped; other lines fade.</li>
</ol>
[[img:mapper-highlight|A selected source field: its mapping line is highlighted and the others fade.]]
<p class="h">For-Each, If and Choose</p>
<ul>
<li><strong>Where</strong> keeps only rows where a condition holds, using the row's own column names: <code>upper-case(Country) = 'INDIA'</code>.</li>
<li><strong>Group by</strong> makes one element per distinct value; inside, <code>{group.key}</code>, <code>{group.items}</code> and <code>{group.count}</code>.</li>
<li><strong>Sort by</strong> orders the rows, ascending or descending.</li>
<li><strong>If</strong> includes the target only when its condition is true.</li>
<li><strong>Choose</strong> takes the first <em>When</em> whose condition is true, otherwise the <em>Otherwise</em> value.</li>
</ul>
<p class="h">Formulas</p>
<p>A formula starts with <code>=</code> in a plain field, and is implied in mapping targets. References are written in braces: <code>{input.name}</code>, <code>{nodes.Get order.body.id}</code>, <code>{gv.OUTBOX}</code>, <code>{vars.total}</code>.</p>
<pre>=concat('Name : ', {input.name})
=upper-case(substring-before({input.email}, '@'))
=format-date('DD-MM-YY', {nodes.Parse XML.Order.date})
=format-dateTime('DD MMM YYYY HH:mm', current-dateTime(), 'Asia/Kolkata')
=string-to-base64(concat({gv.USER}, ':', {gv.PASSWORD}))
=if({input.amount} &gt; 1000, 'bulk', 'retail')
={input.rows}[upper-case(Country) = 'INDIA']        rows where the condition holds
=count({input.rows}[Amount &gt; 1000])
={input.rows}[1].City                                  first row, then a field
=xs:integer({input.qty})
=concat({gv.OUT}, '\\', current-timestamp('YYYYMMDD'), '.csv')</pre>
<p>Backslashes in quoted text are literal, so Windows paths need no escaping. Write a quote twice to include it: <code>'O''Brien'</code>. Function names ignore case. Every function is listed in <a href="#ch-functions">Function reference</a>.</p>
<p class="h">Templates in text fields</p>
<p>Text fields such as an email body or a log message use <code>{{ }}</code> templates with pipes: <code>Order {{input.id | upper}} for {{input.amount | number:2}}</code>. The pipes are listed in <a href="#ch-pipes">Template pipes</a>.</p>
[[tip:When to use JSONata instead|For heavy reshaping of repeating JSON (filter, group, total and nest in one go) a single <strong>JSONata</strong> activity is often clearer than many mapper rules.]]`,
  },
  {
    id: 'schemas', title: 'Schemas and WSDLs',
    html: `
<p>Activities that receive or produce structured data let you pick a <strong>shared schema</strong>: Manual start (payload), REST service (request body), Send HTTP request (body and response), Map data (target), Parse/Render JSON and XML, the file activities (CSV row schema), Invoke SOAP service (arguments and response).</p>
<ul>
<li>With a schema, later activities see the fields in the mapper before any run, with types and repeating markers.</li>
<li>Without one, SutraFlow infers the fields from the test data or the first run.</li>
<li>Activities keep their standard fields when a schema is chosen: for example Read file still returns the file name, path and size next to the rows, and Write file always returns the written file's details.</li>
</ul>
<p>An XSD with several global elements is chosen as <code>Schema::Element</code>. A WSDL added under <em>Service descriptors</em> appears in [[soapInvoke]], which lists its services, ports and operations.</p>`,
  },
  {
    id: 'variables', title: 'Variables and the deployment config',
    html: `
<table class="t"><thead><tr><th>Kind</th><th>Read as</th><th>Set where</th><th>Lifetime</th></tr></thead><tbody>
<tr><td><strong>Local variables</strong></td><td><code>{vars.name}</code>; [[getVar]]</td><td>[[setVar]] in the Sutra</td><td>One run; saved with a durable wait or restart.</td></tr>
<tr><td><strong>Project properties</strong></td><td><code>{gv.NAME}</code>, <code>{{gv.NAME}}</code>, <code>get-project-variable('NAME')</code>; [[getProperties]]</td><td>Project &rarr; Configuration or the deployment config, by an administrator</td><td>Shared by this project's Sutras; read-only to Sutras.</td></tr>
<tr><td><strong>Engine properties</strong></td><td><code>{ev.NAME}</code>, <code>{{ev.NAME}}</code>, <code>get-engine-variable('NAME')</code>; [[getProperties]]</td><td>Admin Console → Server → Runtime</td><td>Shared by every project on the server; read-only to Sutras.</td></tr>
</tbody></table>
<p>Project properties have a type: string, number, boolean or secret. A secret property holds the name of a vault secret, never the value. <strong>Get Properties</strong> never returns secret Project properties. Only an administrator changes Project or Engine properties; the engines discard their cached copy immediately on this engine and through the cluster deployment signal on the others.</p>
<p>The same properties work throughout every palette. Use the <strong>{x}</strong> button in General settings, use <code>{gv.NAME}</code> in mapped Input formulas, and use them in connections. Gateway paths and limits, Timer schedules and listener settings are resolved when deployed listeners are rebuilt. SQL statement fields accept them for administrator-controlled identifiers and clauses; values coming from a request or an earlier step must remain bound <code>:name</code> parameters.</p>
[[tip:Use the right scope|Use Local variables for values calculated during one run, Project properties for environment configuration shared inside one project, and Engine properties only for values shared by every project on a server.]]
<p class="h">The deployment config file</p>
<p>Operations staff change settings per environment without opening the studio. The deployment config holds overrides for project variables, resource settings (hosts, ports, URLs, queue names) and logging. Export it from the project, edit it, and import it, or place it at <code>data/config/&lt;project&gt;.json</code>.</p>
<pre>{
  "variables": { "OUTBOX": "D:\\\\exports", "API_BASE": "\${env:ORDERS_API:-https://test.example.com}" },
  "resources": { "Orders DB": { "host": "\${env:DB_HOST}", "port": 5432 } },
  "logging":   { "path": "D:\\\\logs\\\\orders.log", "level": "info" }
}</pre>
<p><code>\${env:NAME}</code> reads an environment variable of the server; <code>\${env:NAME:-default}</code> gives a default.</p>
<p>Renaming a project keeps its stable id and also renames its <code>data/files/&lt;project&gt;</code> folder and matching <code>data/config/&lt;project&gt;.json</code> deployment config, including the config's project name.</p>
<p class="h">Logging</p>
<p>Each project writes its own log file: path, level, text or JSON lines, rotation by size, and optionally each step's input and output. Set it under Configuration or in the deployment config.</p>`,
  },
  {
    id: 'debug', title: 'Testing and debugging',
    html: `
<p><strong>Test</strong> runs the draft once with the trigger's test data. Each activity shows a status dot; select one and open <strong>Output</strong> to read what it received and produced. API triggers use their <em>test request</em>, message and file triggers their test message or event.</p>
<p><strong>Debug</strong> runs the draft one activity at a time:</p>
<ol>
<li>Optionally set breakpoints: Settings tab &rarr; <em>Breakpoint: pause here when debugging</em>.</li>
<li>Click <strong>Debug</strong>. The run pauses before the first activity. The canvas outlines it, and its Output tab shows the input it will receive.</li>
<li><strong>Step</strong> runs that activity and pauses before the next. <strong>Continue</strong> runs to the next breakpoint. <strong>Pause</strong> stops before the next activity. <strong>Stop</strong> cancels the run.</li>
</ol>
[[img:debugger|Debugging: paused before Build order. The toolbar shows Step, Continue, Pause and Stop; the Output tab shows the input it will receive.]]
<p class="h">Runs</p>
<p>The Runs screen lists every run: Sutra, version, trigger, status, time. Open one to see each step with its input, output, time and error, and the run log. <em>Approvals</em> lists runs waiting for a person; designers can decide their own test runs there, and approvers decide deployed ones in the <a href="#ch-approvals">Approval Center</a>.</p>
[[img:runs|A run: its steps, each with input and output, and the log.]]`,
  },
  {
    id: 'deploy', title: 'Deploying and versions',
    html: `
<p>The Sutra you edit is a <strong>draft</strong>. <strong>Deploy</strong> saves it as the next version (v1, v2, ...) and makes it live: its timer, file, email, message or Drive trigger starts listening, and its REST or SOAP service is published on the gateway.</p>
<ul>
<li>Runs already in progress finish on the version they started with.</li>
<li>Editing after a deploy changes only the draft until you deploy again.</li>
<li>Other systems start a deployed Sutra with the Run API: <code>POST /api/flows/{flowId}/run?wait=30000</code> with <code>{ "input": { ... } }</code>.</li>
</ul>
<p><strong>Deploy</strong> is for development and system test servers. A server with <code>SUTRA_ENVIRONMENT=production</code> refuses it: production receives whole projects as release zips (Releases, below), so what runs there is always a reviewed, versioned package.</p>`,
  },
  {
    id: 'documentation', title: 'Documenting Sutras',
    html: `
<p>Every step has a <strong>Description</strong> in its General tab, below its name: what the step does and why, in your words. SutraFlow makes the documentation of a Sutra or a whole project from the steps, their descriptions and settings, so the documentation is always the design itself.</p>
[[img:step-description|A step's General tab: its name, then its Description, used by the canvas and the documentation.]]
<ul>
<li>On the canvas, a described step shows &equiv; after its name; pointing at it shows the description.</li>
<li>The Sutra's General tab (click the canvas background) counts the steps without a description and has <strong>Documentation</strong> (a page to read, print or share) and <strong>Markdown</strong> (for a repository or wiki).</li>
<li>Releases has the documentation of the whole project, and every release zip carries it as <code>documentation.html</code> and <code>documentation.md</code>.</li>
<li>From a shell or a pipeline: <code>sutra doc --project "Orders" --out orders.html</code>, <code>--sutra "Order lookup"</code> for one Sutra, <code>--format md</code> for Markdown, or <code>sutra doc release.zip</code> for a release.</li>
</ul>
[[img:sutra-documentation|The documentation of a Sutra: what starts it and its steps in run order, each with its description.]]
<p class="h">What the documentation holds</p>
<ul>
<li>The Sutra's description, folder, version and whether it is deployed.</li>
<li><strong>How it starts</strong>: each trigger with its main settings (REST path, timer schedule, folder, tool name).</li>
<li><strong>Steps</strong> in the order a run reaches them, each with its activity, description and settings. Connections are named, never their ids; secrets by name only, never their values.</li>
<li>Where each step goes next, with the output and conditions, and which steps handle errors.</li>
<li>Connections and project variables used; Sutra variables; and the steps still without a description.</li>
</ul>
[[tip:Writing good descriptions|Say why, not only what: "Skips unchanged files so no vectors are made again" beats "Add to knowledge".<br>Name the business rule a step carries out and who owns it.<br>Describe triggers for the people who call them: address, input, who may call.]]`,
  },
  {
    id: 'engine-inside', title: 'How a Sutra runs: inside the engine',
    html: `
<p>Knowing what the engine does with a Sutra explains most design choices: why a step should be safe to repeat, why large data should not travel from step to step, why waiting costs nothing, and how work spreads over engines. This chapter follows one run from its trigger to its end.</p>
<p class="h">Runs, steps and the work queue</p>
<p>A <strong>run</strong> is one row in the <code>runs</code> table: the Sutra as it was when the run started (a later deploy never changes a run in progress), its trigger input, its status, and its <strong>state</strong>: the output of every step so far (by step name), the Sutra variables, which paths are live, and the run's log. Each <strong>step execution</strong> is one row in the <code>tasks</code> table, which is also the work queue. Nothing about a run is held in memory between two steps: every step reads the run from the database and writes it back.</p>
<p class="h">One run, step by step</p>
<ol>
<li><strong>Trigger.</strong> A deployed trigger fires: a REST call on the gateway, a timer, a new file, a queue message, a Drive or SharePoint change, an AI tool call, a chat message; or a person presses Test, or another Sutra calls this one. The engine writes the run row (status <em>running</em>) and a task for the trigger step (<em>pending</em>), in one transaction. When the Sutra's <em>Runs at once</em> limit is reached, the run is <em>queued</em> instead and starts when another one ends.</li>
<li><strong>Claim.</strong> Every engine has a number of workers (<em>Steps at once</em>, 16 by default). A free worker takes the next due task in one database statement: highest Sutra priority first, then the oldest; due means its not-before time has passed. With several engines on one database, exactly one of them wins each task and records itself as its owner. Engines look for work every quarter of a second, and at once when a step ends.</li>
<li><strong>Prepare.</strong> The step sees: <code>{input}</code> (what the previous step sent on the connection), <code>{nodes.Step name}</code> (any earlier step's output), <code>{trigger}</code>, <code>{vars}</code> (Local variables), <code>{gv}</code> (Project properties with the deployment config applied), <code>{ev}</code> (Engine properties), <code>{run}</code> and secrets by name. Settings and mappings are resolved now, not earlier.</li>
<li><strong>Execute.</strong> The activity runs within its time limit (the step's Settings, else the activity's own: 2 minutes for most, 10 for AI steps, longer for data platform steps). A step set to loop runs here many times: <em>for each item</em> one after the other, <em>repeat while</em> until the condition is false.</li>
<li><strong>Checkpoint.</strong> In one transaction the engine stores the step's output (one row per step, apart from the run state), marks the task done, and inserts tasks for the next steps. This is the checkpoint: if the engine stops after it, nothing is lost and nothing is repeated.</li>
<li><strong>Route.</strong> The output goes out on one port (<em>out</em>, <em>true</em>, <em>error</em>, <em>approved</em> ...). Each connection from that port carries a <em>live</em> token, or a <em>skip</em> token when its condition is false or the port was not used. A step runs once for each live token that reaches it. A <strong>Merge</strong> step waits until every incoming connection has delivered a token (live or skip) and then runs once with the live ones; so a branch not taken never blocks it.</li>
<li><strong>Wait.</strong> A step that waits (Approval, Ask a person, Call Sutra with wait, an AI agent waiting for a tool) stores what it waits for and its task becomes <em>waiting</em>: no worker, thread or memory is held, for a minute or a month. Wait (a delay) puts its task back as pending with a not-before time. When the answer comes, the step continues on whichever engine claims it.</li>
<li><strong>Reply.</strong> For REST, SOAP and AI tool callers, the first reply step (Send HTTP response, SOAP reply, Reply to AI) answers the caller at once; the run may continue after it. A caller gets 504 if no reply comes within <em>Reply wait</em> (60 seconds by default).</li>
<li><strong>End.</strong> When no task of the run is pending, running, paused or waiting, the run is <em>done</em>, or <em>failed</em> if a step failed without an error connection. An End step can stop the run at once (as success or as an error). The run's log, metrics (<code>/metrics</code>) and trace (OpenTelemetry) are written, a Call Sutra caller is resumed, and the next queued run of the Sutra starts.</li>
</ol>
<p class="h">When a step fails</p>
<ol>
<li><strong>Retries</strong> (the step's Settings, else the Sutra's tuning): the task goes back to the queue with a not-before time; the wait doubles each time (1 s, 2 s, 4 s ...). Other branches carry on meanwhile.</li>
<li>Then the step's <strong>error output</strong>, when connected: it carries <code>{input.error.message}</code>, the step name and the input that failed; the run continues on that path.</li>
<li>Else the Sutra's <strong>Error handler</strong>, when it has one: the other branches stop and the handler's path decides how the run ends.</li>
<li>Else the run <strong>fails</strong>, with the step and the message. A failed run can be <strong>resubmitted</strong> (Runs, Admin Console, <code>sutra runs resubmit</code>): it runs again from the failed step with the same input, keeping everything before it.</li>
</ol>
<p class="h">Limits that protect the server</p>
<table class="t"><thead><tr><th>Limit</th><th>Default</th><th>Set in</th></tr></thead><tbody>
<tr><td>Steps at once, per engine</td><td>by machine size (4 to 32)</td><td>Admin Console &gt; Engines &gt; Tuning; <code>SUTRA_WORKERS</code></td></tr>
<tr><td>Steps per run</td><td>10,000 (a loop that never ends is stopped)</td><td>Engine tuning; <code>SUTRA_MAX_STEPS</code></td></tr>
<tr><td>Step time limit</td><td>2 minutes (AI 10 minutes)</td><td>The step's Settings tab</td></tr>
<tr><td>Run time limit, runs at once, priority, retries</td><td>none</td><td>Sutra tuning (Admin Console &gt; Applications)</td></tr>
<tr><td>Reply wait for callers</td><td>60 seconds</td><td>Engine tuning; <code>SUTRA_REPLY_TIMEOUT_MS</code></td></tr>
<tr><td>Call Sutra depth</td><td>10 levels</td><td>Fixed</td></tr>
<tr><td>Loop on a step</td><td>1,000 items (at most 10,000)</td><td>The step's Settings tab</td></tr>
<tr><td>Run log</td><td>the last 500 lines in the run (the project log keeps everything)</td><td>Fixed</td></tr>
</tbody></table>
<p class="h">Engines and the cluster</p>
<ul>
<li>The <strong>studio</strong> is an engine with the designer; <strong>headless engines</strong> (<code>SUTRA_MODE=engine</code>) run Sutras only. All engines on one database share the work queue: add engines to run more steps at once.</li>
<li>Every engine writes a <strong>heartbeat</strong> every 5 seconds. One engine holds the <strong>leader</strong> lease and runs what must happen once: timers, file, mailbox, queue and Drive listeners, alert checks and housekeeping. If the leader stops, another engine takes the lease within three beats.</li>
<li>Every engine serves the <strong>gateway</strong>; a REST call may start a run on one engine whose steps then run on others.</li>
<li>An engine silent for three beats is dead: the leader puts the steps it was running back in the queue, and another engine runs them again. <strong>Drain</strong> (Admin Console, <code>sutraflow stop</code>) lets running steps finish and hands the rest back without loss.</li>
<li>A deploy raises a generation number; every engine notices on its next beat and reloads its routes; the leader restarts its listeners.</li>
</ul>
<p class="h">What follows for design</p>
<ul>
<li><strong>At least once.</strong> A step whose engine dies mid-step runs again on another. Steps that change things (insert an order, send money, post a message) should be safe to repeat: use the run id or a business key as an idempotency key, or check before writing.</li>
<li><strong>Waiting is free.</strong> Approvals, people and long timers cost nothing while they wait; no need to avoid them.</li>
<li><strong>Outputs are kept for the run.</strong> Every step's output stays available to later steps for the rest of the run. Since 1.8.0 a step writes only its own output, so later steps no longer pay for earlier large ones; outputs still take database space and time to read (see <em>Designing Sutras</em>, large data).</li>
<li><strong>Names are the keys.</strong> <code>{nodes.Step name}</code> holds the latest output of that step; in parallel branches (For each) read the item from <code>{input}</code>, or call a Sutra per item.</li>
</ul>`,
  },
  {
    id: 'design', title: 'Designing Sutras: patterns and good practice',
    html: `
<p>How to shape Sutras so they are correct, fast, cheap to run and easy to look after. It builds on <em>How a Sutra runs</em>.</p>
<p class="h">Choose the pattern</p>
<table class="t"><thead><tr><th>You need</th><th>Pattern</th><th>Build with</th></tr></thead><tbody>
<tr><td>An answer within seconds (an API, a lookup)</td><td><strong>Request and reply</strong>: a short path to the reply step, nothing slow before it</td><td>[[restService]] or [[soapService]], work, [[httpResponse]]</td></tr>
<tr><td>Accept now, work later (an order, a long job)</td><td><strong>Acknowledge, then work</strong>: reply 202 with an id at once, continue after the reply; the caller checks a status API or gets a callback</td><td>[[httpResponse]] early, then the work; or [[callProcess]] without waiting</td></tr>
<tr><td>React to something happening</td><td><strong>Event driven</strong>: one Sutra per kind of event</td><td>[[fileTrigger]], [[busSubscribe]], [[googleDriveTrigger]], [[msFilesTrigger]], [[emailTrigger]], [[adfRunTrigger]]</td></tr>
<tr><td>Work on a schedule, or many records</td><td><strong>Batch</strong>: a timer, read a page of records, process, mark done, repeat</td><td>[[timer]], [[dbQuery]] with paging, [[forEach]] or a called Sutra per record</td></tr>
<tr><td>The same logic in several Sutras</td><td><strong>Sub-Sutra</strong>: one Sutra called by others</td><td>[[callProcess]] and [[return]]</td></tr>
<tr><td>Decouple a fast producer from a slow consumer</td><td><strong>Queue</strong>: publish, and let a subscriber Sutra work at its own pace</td><td>[[busPublish]] and [[busSubscribe]], or channels</td></tr>
<tr><td>A person decides</td><td><strong>Approval</strong> (below)</td><td>[[approval]], [[askPerson]]</td></tr>
<tr><td>Language, documents, judgement</td><td><strong>AI step, RAG or agent</strong> (below and <em>AI concepts</em>)</td><td>The AI palette</td></tr>
<tr><td>Heavy data work</td><td><strong>Orchestrate, do not carry</strong>: let the database or the data platform do the work, the Sutra starts and checks it</td><td>[[dbScript]], [[adfRun]], [[databricksRun]], [[databricksSql]]</td></tr>
</tbody></table>
<p class="h">Keep each Sutra small and named well</p>
<ul>
<li>One business purpose per Sutra; ten to thirty steps is a comfortable size. Split larger ones into sub-Sutras.</li>
<li>Name steps by what they do (<em>Find the customer</em>, not <em>SQL query 2</em>): mappings, logs and the generated documentation use the names. Describe every step (General tab).</li>
<li>Keep values that differ per environment in project variables and connections, never in steps; secrets only in the vault.</li>
<li>Put Sutras in folders by business area; keep shared connections and schemas in the project, not copied.</li>
</ul>
<p class="h">Authentication and authorization at run time</p>
<p>Every running Sutra has two identity questions: <strong>who is calling it</strong>, and <strong>who it is</strong> when it calls other systems. Decide both when you design it, not when it goes live.</p>
<p><strong>Who may call (inbound)</strong>: every trigger on the gateway gets an API security policy (Resources). Choose by caller:</p>
<table class="t"><thead><tr><th>Caller</th><th>Policy authentication</th></tr></thead><tbody>
<tr><td>Another system of yours, few callers</td><td>API key (keys in the vault), or Basic</td></tr>
<tr><td>Partners, apps, many callers with limits</td><td>Gateway apps: an app per caller with scopes and a plan; key or OAuth client-credentials token (<code>/oauth/token</code>)</td></tr>
<tr><td>Your company's single sign-on (Entra ID, Okta, Keycloak, Auth0)</td><td>JWT: the identity provider issues tokens; the policy checks signature (JWKS), issuer, audience and scopes</td></tr>
<tr><td>Machines in a closed network, banks, B2B</td><td>Mutual TLS (client certificates), with an IP allow list</td></tr>
<tr><td>SOAP partners</td><td>WS-Security UsernameToken (with a time window and replay protection), or mutual TLS</td></tr>
<tr><td>AI assistants (MCP) and agent chats</td><td>A policy on the MCP server resource and on each agent channel entry (chat, OpenAI-compatible, A2A)</td></tr>
</tbody></table>
<p>Add HTTPS-only, a rate limit and, for browsers, CORS origins. The designer and Deploy warn about a service without a policy.</p>
<p><strong>Who the caller is, inside the Sutra</strong>: the trigger's output carries <code>{trigger.auth.method}</code>, <code>{trigger.auth.subject}</code> (the key's name, user, app or token subject) and, for JWT, <code>{trigger.auth.claims}</code>; and <code>{trigger.client.ip}</code>. Use them for <strong>authorization</strong>: a customer token may read only its own orders (<code>where customer_id = :sub</code>), a scope decides who may refund. Authentication says who; your Sutra decides what that caller may do.</p>
<p><strong>Who the Sutra is (outbound)</strong>: each call to another system signs in with a connection, never with values typed into steps:</p>
<table class="t"><thead><tr><th>Calling</th><th>Sign in with</th></tr></thead><tbody>
<tr><td>REST and SOAP services</td><td>An HTTP connection with a security profile: Basic, bearer token, API key, OAuth2 client credentials (tokens fetched and refreshed for you), WS-Security (UsernameToken, SAML, X.509), client certificate</td></tr>
<tr><td>Google, Microsoft 365, YouTube, Twitch, Dropbox, Facebook</td><td>An OAuth connection: an account connected once (Connect account, <code>sutra connect</code>, or a refresh token secret)</td></tr>
<tr><td>Azure Data Factory, Databricks</td><td>A service principal or managed identity (or a Databricks token)</td></tr>
<tr><td>Databases, SFTP, mail, queues</td><td>A user of their own for SutraFlow; SFTP with a key and the host fingerprint checked</td></tr>
</tbody></table>
<ul>
<li><strong>Least rights</strong>: an account per purpose and environment, with only the rights the Sutras use (read-only where reading is enough).</li>
<li><strong>Secrets only in the vault</strong>, named in connections; each environment has its own values. Rotate them by changing the secret: no Sutra changes.</li>
<li><strong>Do not pass the caller's credentials on</strong>: call other systems as the Sutra's own identity, and send the caller's subject as data when the other system needs to know who asked.</li>
<li><strong>People in the run</strong>: approvals and Ask a person are answered by signed-in users with the right role; the answer records who decided. Pipelines and scripts use system accounts with API tokens, never a person's password.</li>
</ul>
<p class="h">Errors and reliability</p>
<ul>
<li>Every step that talks to another system gets retries (Settings: 3 retries, 1 s first wait is a good start) and its <strong>error output</strong> connected where you can do something useful: a fallback, a message to the caller, a log with the input.</li>
<li>Use an <strong>Error handler</strong> for what is common to every failure: log it, alert, reply 500 to an API caller.</li>
<li>Make changing steps <strong>safe to repeat</strong>: an <code>insert ... on conflict do nothing</code> with a business key, an upsert, or a check first. Send the run id as an idempotency key to APIs that accept one.</li>
<li>Set time limits that fit: a short one on calls that should be quick, so a stuck system fails fast; a <em>circuit breaker</em> on HTTP connections stops calling a system that keeps failing.</li>
<li>Validate input at the door: a body schema on REST services, If steps with clear 400 replies.</li>
</ul>
<p class="h">Logging: what, when, where</p>
<table class="t"><thead><tr><th>Level</th><th>Use for</th><th>Example</th></tr></thead><tbody>
<tr><td>error</td><td>Something failed that a person must look at</td><td><em>Payment for A-1001 refused by the bank: card expired</em></td></tr>
<tr><td>warn</td><td>Unexpected but handled; worth noticing if it repeats</td><td><em>Stock service slow (4.2 s); used the cached price</em></td></tr>
<tr><td>info</td><td>Business milestones, one or two per run</td><td><em>Order A-1001 accepted: 3 lines, 2,450 INR</em></td></tr>
<tr><td>debug</td><td>Details for finding a problem; switched on only while needed</td><td><em>Price rule matched: wholesale, 15%</em></td></tr>
</tbody></table>
<ul>
<li>Log business keys (order number, customer id) so a line can be found from a support call; the run id is added for you.</li>
<li>Never log secrets, passwords, card numbers or whole personal records; secret values are masked, other personal data is your care.</li>
<li>Where it goes: the run's log (Runs), the <strong>project log</strong> file (Project &gt; Logging: file, level, size, rotation; JSON for log collectors) and, from the server, metrics and traces.</li>
<li><em>Step data in history</em> (Sutra tuning): <em>all</em> while you build, <em>errors only</em> in production for busy Sutras, <em>none</em> for Sutras that handle sensitive data.</li>
<li>Let alert rules watch for you (failed runs, slow runs, approvals waiting, gateway errors) instead of reading logs.</li>
</ul>
<p class="h">Database work</p>
<ul>
<li>Always <strong>parameters</strong> (<code>:name</code> or <code>?</code>), never values pasted into SQL: safe and faster (the database reuses the plan).</li>
<li>Select only the columns you need, with a <code>where</code> on indexed columns; set <em>Maximum rows</em>.</li>
<li>Many rows: page them (<code>order by id limit 500</code> after the last id), or let one SQL statement do the work (<code>insert ... select</code>, <code>update ... where</code>) instead of a step per row.</li>
<li>Several changes that belong together: one [[dbTransaction]] (all or nothing), or a stored procedure ([[dbProcedure]]).</li>
<li>Connections are pooled per connection resource; keep pool sizes within what the database allows when several engines run.</li>
<li>Schema changes and setup scripts: [[dbScript]] in a release Sutra, not by hand.</li>
</ul>
<p class="h">Parallel work</p>
<ul>
<li>Steps run in parallel when the Sutra branches: two connections from one output start both steps at once, on free workers of any engine. A <strong>Merge</strong> waits for all of them.</li>
<li>[[forEach]] sends every item down its <em>item</em> branch as its own task, so items run in parallel too (up to the free workers), and <em>done</em> follows with the whole list. For work per item with several steps, call a sub-Sutra per item: each item then has its own run, its own <code>{trigger}</code>, retries and history.</li>
<li>A step's <em>Loop</em> setting runs the items one after the other, in order: for calls that must not overlap, or with a pause between them (rate-limited APIs).</li>
<li>To limit how much runs at once: <em>Runs at once</em> per Sutra (extra runs queue), <em>Steps at once</em> per engine, plans for gateway callers. AI conversations are kept in order per session by themselves.</li>
<li>To do more at once: raise <em>Steps at once</em> where steps mostly wait on other systems, or add engines on PostgreSQL.</li>
</ul>
<p class="h">Approval processes</p>
<ol>
<li>Prepare everything the approver needs first (amount, customer, history, a link), and put it in the question and the step's <em>Details for the approvers</em>: the approver decides in the <a href="#ch-approvals">Approval Center</a>, on a computer or a phone, without opening other systems.</li>
<li>[[approval]] for yes or no (outputs <em>approved</em>, <em>rejected</em>); [[askPerson]] when the answer is text (outputs <em>answered</em>, <em>declined</em>). Name an <em>assignee</em> (a person or a role) so it lands with the right people.</li>
<li>Decide by rules first: an If before the approval sends small amounts straight through, so people see only what needs them.</li>
<li>Several levels: approvals in a row (manager, then finance above a limit), each with its own assignee.</li>
<li>Escalation: an alert rule <em>Approvals waiting</em> notifies when one waits too long; a run time limit on the Sutra ends approvals nobody answers.</li>
<li>After the decision: record it (who, when, comment are in the output) in your system, and tell the requester.</li>
</ol>
<p>A waiting approval holds no resources, survives restarts and deploys, and is answered on any engine.</p>
<p class="h">AI agents</p>
<ul>
<li>Use the smallest AI that does the job: a single AI step to classify or extract; [[knowledgeAsk]] to answer from documents; an agent only when the path to the answer is not known in advance.</li>
<li>Rules stay in ordinary steps: refunds, limits, approvals are decided by If and Approval, never by the model.</li>
<li>Few tools with clear names and descriptions; tools that change data are marked so, and checked inside the tool Sutra.</li>
<li>[[aiGuard]] before the agent on public entry points; limits on steps, tokens and time; <em>needs a person</em> connected to [[askPerson]].</li>
<li>Keep <em>Save steps</em> on so every answer can be explained; review a sample of conversations regularly.</li>
</ul>
<p class="h">Large data</p>
<p>Every step's output is kept for the rest of the run and read by the steps after it. Steps of 1 MB measured 7.7 a second on one engine (2.6 before 1.8.0): it works, but data that does not need to be in a step's output should not be. So:</p>
<ul>
<li><strong>Carry references, not content</strong>: a file path, a row id, a blob address. Files: [[fileList]] without reading, then a sub-Sutra per file; save downloads to server files (Google Drive <em>Save to: server file</em>), not into outputs.</li>
<li><strong>Stream large files</strong> with the steps that do (file copy and move, SFTP, Drive save, YouTube upload) rather than reading them into a step's output.</li>
<li><strong>Page</strong> big queries and lists: 500 to 5,000 rows a page, one page per run or per sub-Sutra call.</li>
<li><strong>Push the work down</strong>: SQL in the database, Spark in Databricks, copy activities in Data Factory; the Sutra orchestrates and checks.</li>
<li>Keep step outputs under a few megabytes; history keeps at most about 1 MB per step (larger outputs are cut to a preview there). Set <em>Step data in history</em> to <em>errors only</em> or <em>none</em> for Sutras that move a lot of data.</li>
<li>Use mappings to keep only the fields the next steps need.</li>
</ul>
<p class="h">Making a process faster</p>
<ol>
<li>Measure first: Runs shows each step's time; Admin Console &gt; Applications shows runs and failures per Sutra; Traffic shows gateway time per service; <code>/metrics</code> and traces give the details.</li>
<li>Run independent calls in parallel branches with a Merge instead of one after the other.</li>
<li>Reply to callers as early as possible; do the rest after the reply.</li>
<li>Fewer, bigger operations: one SQL statement for many rows, bulk APIs, batches of messages.</li>
<li>Avoid needless steps: a mapping can often replace several small transform steps.</li>
<li>Cache what rarely changes (reference data in a project variable, a counter, or a small table read once).</li>
<li>Keep step outputs small (large data, above).</li>
</ol>
<p class="h">Tuning a deployed app</p>
<table class="t"><thead><tr><th>Symptom</th><th>Look at</th><th>Change</th></tr></thead><tbody>
<tr><td>Work waits in the queue</td><td>Overview: work waiting; Engines: steps running</td><td>More <em>Steps at once</em> (steps mostly waiting on other systems), more engines (busy CPU), priorities for urgent Sutras</td></tr>
<tr><td>A system you call is overloaded</td><td>Its errors and time in Runs</td><td><em>Runs at once</em> for the Sutra; a loop with a pause; a circuit breaker on the connection</td></tr>
<tr><td>API callers get 504</td><td>Traffic: time per service</td><td>Reply earlier; make the work asynchronous; raise <em>Reply wait</em> only as a last resort</td></tr>
<tr><td>The database grows</td><td>Database page row counts</td><td>Retention of runs, audit and the request log; <em>Step data</em> errors only; smaller outputs</td></tr>
<tr><td>Runs hang</td><td>Runs with status waiting or running</td><td>Step time limits, a run time limit, alerts on slow runs and waiting approvals</td></tr>
</tbody></table>
<p class="h">Changes, versions and CI/CD</p>
<ul>
<li>Keep the project in Git (the Git tab): a branch per change, a review before merging to main, a version tag for each release (<code>v1.4.0</code>).</li>
<li>Give every trigger realistic <strong>test data</strong> (test request, payload, test event): <code>sutra test</code> in the pipeline runs every Sutra with it, so a broken Sutra stops the release.</li>
<li>Build the release zip once, from the tag, in the pipeline; promote the same zip to UAT and production with each environment's deployment config; never deploy to production from the designer (production refuses it).</li>
<li>Change APIs so callers do not break: add fields rather than rename them; for a change that breaks callers, publish a new path (<code>/v2/orders</code>) beside the old one and retire the old one later.</li>
<li>Schema and database changes travel as [[dbScript]] steps in a release Sutra, written to run twice safely (<code>create table if not exists</code>).</li>
<li>Know the way back: <code>sutra rollback</code> or Releases &gt; Roll back; a run in progress finishes on the version it started with.</li>
</ul>
<p>The full pipeline, with GitHub Actions, GitLab, Azure DevOps and Jenkins examples, is in <em>CI/CD pipelines</em>.</p>
[[tip:In short|Small Sutras with one purpose, steps named and described.<br>Retries and an error path on every call to another system; changes safe to repeat.<br>References instead of large data; the database and data platforms do the heavy work.<br>Rules decide, people approve, AI assists.<br>Every entry point has a policy; every connection its own least-rights identity.<br>Release from Git through the pipeline; the same zip everywhere.<br>Measure before tuning; alert rules watch so people do not have to.]]`,
  },
  {
    id: 'gateway', title: 'The API gateway',
    html: `
<p>SutraFlow listens on two kinds of ports, each for its own people. The <strong>studio port</strong> is for the team that builds and runs SutraFlow. The <strong>gateway</strong> is the front door for everyone and everything that uses your Sutras: other systems, websites, partners, mobile apps, AI assistants.</p>
<table class="t"><thead><tr><th>Port</th><th>Default</th><th>Serves</th><th>Who reaches it</th></tr></thead><tbody>
<tr><td>Studio (admin)</td><td><code>127.0.0.1:4800</code></td><td>The designer, the Admin Console (<code>/admin</code>), this guide, and the admin API (<code>/api/...</code>) used by the designer, the console and the <code>sutra</code> command</td><td>Only your team: keep it on 127.0.0.1, or reach it over a VPN or an internal reverse proxy with HTTPS</td></tr>
<tr><td>Gateway HTTP</td><td><code>8080</code> (all addresses)</td><td>The deployed Sutras: REST and SOAP services, MCP, AI agents, access tokens</td><td>Callers. Point a load balancer or reverse proxy here, or use HTTPS</td></tr>
<tr><td>Gateway HTTPS</td><td><code>8443</code> (all addresses)</td><td>The same, with TLS (a self-signed, your own or a Let's Encrypt certificate)</td><td>Callers over the internet</td></tr>
<tr><td>Headless engine</td><td>admin <code>4801</code>, gateway <code>9080</code> / <code>9443</code></td><td>An engine without the designer: its Admin Console and its own gateway, serving the same deployed Sutras</td><td>Admin port: operations; gateway: callers</td></tr>
</tbody></table>
<p>The ports are set in <code>sutraflow.env</code> (<code>STUDIO_PORT</code>, <code>STUDIO_GATEWAY_HTTP</code>, <code>STUDIO_GATEWAY_HTTPS</code>, and <code>ENGINE_...</code> for an engine). The Designer's read-only <strong>Services</strong> page shows every gateway address; administrators change listener settings in <strong>Admin Console &rarr; Server &rarr; Gateway &amp; TLS</strong>. A Laragon installation uses for example studio 4810 and gateway 8090 and 8453, with Apache forwarding <code>http://sutra.test</code> to the studio.</p>
<p class="h">What the gateway serves</p>
<table class="t"><thead><tr><th>Address on the gateway</th><th>What</th><th>Made by</th></tr></thead><tbody>
<tr><td>Your paths, for example <code>GET /orders/:id</code></td><td>REST services</td><td>A deployed Sutra that starts with [[restService]]</td></tr>
<tr><td>Your paths, for example <code>/soap/orders</code>, and <code>?wsdl</code></td><td>SOAP services and their WSDL</td><td>[[soapService]]</td></tr>
<tr><td><code>/mcp</code>, or an MCP server's address such as <code>/mcp/orders</code></td><td>Tools for AI assistants (Model Context Protocol)</td><td>[[mcpTool]] Sutras and published agents</td></tr>
<tr><td><code>/chat/&lt;name&gt;</code>, <code>/chat/&lt;name&gt;/api</code>, <code>/chat/&lt;name&gt;/widget.js</code></td><td>An agent's chat page, its API, and a chat button for any website</td><td>[[agentChannel]]</td></tr>
<tr><td><code>/v1/models</code>, <code>/v1/chat/completions</code></td><td>Agents as OpenAI-compatible models</td><td>[[agentChannel]] with OpenAI-compatible ticked</td></tr>
<tr><td><code>/a2a/&lt;name&gt;</code></td><td>Agent-to-agent (A2A) with its agent card</td><td>[[agentChannel]] with A2A ticked</td></tr>
<tr><td><code>POST /oauth/token</code></td><td>Access tokens for gateway apps (client credentials)</td><td>Admin Console &rarr; Gateway &rarr; Apps and keys</td></tr>
<tr><td><code>/openapi.json</code></td><td>The OpenAPI description of the REST services, for Postman, Swagger UI or code generators</td><td>When publishing is switched on (Admin Console &rarr; Gateway &rarr; APIs)</td></tr>
<tr><td><code>/health</code></td><td>Up or not, for load balancers</td><td>Always</td></tr>
</tbody></table>
<p>The gateway never serves the designer, the Admin Console or the admin API; and a Sutra is on the gateway only while it is deployed. In the designer, <strong>Test</strong> runs a Sutra without the gateway.</p>
<p class="h">Publish a REST API: step by step</p>
<ol>
<li>New Sutra; first step [[restService]]: method <code>GET</code>, path <code>/orders/:id</code>. Its test request lets you run it in the designer.</li>
<li>Do the work: a database query, a call to another system, a mapping.</li>
<li>End with [[httpResponse]]: status 200 and the JSON to return; a second response for errors (404, 400).</li>
<li>Choose an <strong>API security policy</strong> on the trigger (next section); Deploy.</li>
<li>Call it on the gateway:</li>
</ol>
<pre>curl http://127.0.0.1:8080/orders/A-1001 -H "X-API-Key: your-key"
Invoke-RestMethod http://127.0.0.1:8080/orders/A-1001 -Headers @{ "X-API-Key" = "your-key" }</pre>
<p>The Designer's <strong>Services</strong> page lists the service with its full address; the Admin Console's Applications shows it running, and Gateway &rarr; Traffic shows its calls.</p>
<p class="h">Who may call, and how much</p>
<p>Every request passes through, in order: the <strong>firewall</strong> (addresses allowed or refused for the whole gateway), the service's <strong>API security policy</strong> (HTTPS only, IP allow list, authentication, a rate limit per caller, CORS for browsers), and for gateway apps their <strong>plan</strong>. A refused request gets 403, 401 or 429 and never starts the Sutra.</p>
<ul>
<li><strong>Simple</strong>: a policy with API keys (vault secrets) or Basic sign-in; see <em>Exposing APIs: security and TLS</em>.</li>
<li><strong>For many callers</strong>: Admin Console &rarr; Gateway. Make a <strong>plan</strong> (requests per minute, hour, day and a monthly quota), an <strong>app</strong> per caller (partner, mobile app, team) with its scopes and plan, and give it a <strong>key</strong> (<code>sfk_...</code>, shown once, stored as a hash). Set the policy to <em>Gateway apps</em>. Callers send the key in <code>X-API-Key</code>, or exchange it for a short-lived token:</li>
</ul>
<pre>curl -X POST http://127.0.0.1:8080/oauth/token -d "grant_type=client_credentials&amp;client_id=APP_ID&amp;client_secret=sfk_..."
curl http://127.0.0.1:8080/orders/A-1001 -H "Authorization: Bearer ACCESS_TOKEN"</pre>
<p>Disabling an app, or deleting a key, stops it at once on every engine. Gateway &rarr; Traffic shows requests, errors and time taken by service and app; the request log keeps every call (path, app, status, time, run) for the days set there.</p>
<p class="h">HTTPS and the internet</p>
<ul>
<li>Give the gateway a certificate in Admin Console &rarr; Server &rarr; Gateway &amp; TLS: your own, or Let's Encrypt (the gateway's HTTP port must answer as port 80 for the domain while the certificate is made and renewed).</li>
<li>Or put a reverse proxy or load balancer in front (Apache, nginx, IIS, Azure Application Gateway, AWS ALB) that ends TLS and forwards to the gateway's HTTP port; send <code>/health</code> as its health check, and <code>/ready</code> on the admin port for engines.</li>
<li>Open only the gateway port in the firewall, never the studio port.</li>
</ul>
[[tip:Good practice|Every public service gets a policy; a service without one is open to anyone who reaches the gateway, and the designer warns about it.<br>Use an app per caller, so one can be throttled or switched off without touching the others.<br>Keep the studio port private; the gateway is the only door you open.]]`,
  },
  {
    id: 'expose', title: 'Exposing APIs: security and TLS',
    html: `
<p>A [[restService]] or [[soapService]] trigger publishes the Sutra on the gateway. The Designer's read-only <strong>Services</strong> page lists every exposed service with its addresses and security policy.</p>
[[img:server|Services: the read-only inventory of exposed services and listener health.]]
<p class="h">API security policy</p>
<p>Create a policy in Resources &rarr; <em>API security policy</em> and pick it on the trigger. It checks, in order: HTTPS required, IP allow list (addresses or IPv4 ranges), caller authentication, then a rate limit per caller. CORS origins are optional.</p>
<table class="t"><thead><tr><th>Authentication</th><th>How callers prove who they are</th></tr></thead><tbody>
<tr><td>None</td><td>Open to anyone. For testing only.</td></tr>
<tr><td>Basic</td><td>User name and password; passwords are vault secrets.</td></tr>
<tr><td>API key</td><td>A key in a header; keys are vault secrets.</td></tr>
<tr><td>JWT bearer</td><td>A signed token, checked with a JWKS URL, a public key or a shared secret; issuer, audience and scopes.</td></tr>
<tr><td>Gateway apps</td><td>Keys and OAuth client-credentials tokens of apps in the Admin Console, with scopes and plans.</td></tr>
<tr><td>OAuth token introspection</td><td>An opaque access token, checked at the identity provider's introspection endpoint (answers kept until the token expires or the cache time); audience and scopes.</td></tr>
<tr><td>HMAC signature</td><td>The request signed with a shared secret, as webhook senders do: the timestamp and body, or the method, path, timestamp and body, or the body only. Old timestamps and replays are refused.</td></tr>
<tr><td>WS-Security UsernameToken</td><td>SOAP only; password digest with a time window and replay protection.</td></tr>
<tr><td>WS-Security X.509</td><td>SOAP only; the request signed with a certificate the policy trusts (the certificate itself, or a CA that issued it). The Body and the Timestamp must be signed.</td></tr>
<tr><td>WS-Security SAML</td><td>SOAP only; a SAML 1.1 or 2.0 assertion signed by the identity provider, from the expected issuer, for this audience, in its validity period.</td></tr>
<tr><td>Mutual TLS</td><td>A client certificate signed by the client CA set in Admin Console &rarr; Server &rarr; Gateway &amp; TLS; optionally only listed subjects.</td></tr>
</tbody></table>
<p class="h">Scopes per service and per operation</p>
<p>A token or gateway app carries scopes. The policy can require some for everything it protects; a [[restService]] can require more (<em>Required scopes</em>), and a [[soapService]] per operation (<em>Scopes per operation</em>: <code>CancelOrder = orders:cancel</code>). A caller without them gets 403 <code>insufficient_scope</code>.</p>
<p class="h">Message validation</p>
<p>Give the trigger a schema and set <em>Validate requests</em> to <em>reject invalid</em>: the body is checked before a run starts, and a bad request gets 400 (REST, with the list of errors) or a Client fault (SOAP).</p>
<ul>
<li><strong>JSON Schema</strong> (drafts 07, 2019-09 and 2020-12): required fields, types, patterns, formats such as email and date-time, ranges, allowed values, no extra fields when the schema says so.</li>
<li><strong>A JSON sample</strong>: the types of the fields it shows; other fields are allowed.</li>
<li><strong>An XSD element</strong>: required elements and attributes, types, single or repeated, allowed values, and nothing the XSD does not declare. A SOAP service checks each operation against the element of the same name.</li>
</ul>
<p class="h">Threat protection</p>
<p>Every policy limits what a message may hold, before the Sutra sees it: nesting depth (checked on the raw text, before parsing), fields per message, items per list, the length of one text value, and the body size. XML with a DOCTYPE is always refused, so entity tricks (billion laughs, external entities) never reach the parser. Services without a policy get generous limits (depth 64, 50,000 fields).</p>
<p class="h">HMAC-signed webhooks, step by step</p>
<ol>
<li>Put the shared secret in the vault (Resources &rarr; Secrets), for example <code>PARTNER_HOOK_SECRET</code>.</li>
<li>Create an API security policy with <em>hmac</em>, the secret under <em>Accepted secrets</em>, and the sender's header names, algorithm, encoding and prefix (many senders: <code>X-Hub-Signature-256</code>, <code>sha256=</code>, body only).</li>
<li>To change the secret without missing calls, list the new one beside the old one until the sender has switched.</li>
<li>Pick the policy on the [[restService]]. The caller's <code>auth.subject</code> is the name of the secret that matched.</li>
</ol>
<p class="h">WS-Security on incoming SOAP</p>
<ul>
<li><strong>Timestamps</strong>: a Timestamp that is present is always checked (created not in the future, not expired, within the allowed clock difference); set <em>Timestamp: required</em> to refuse messages without one.</li>
<li><strong>X.509</strong>: paste the callers' certificates, or the CA that issues them, into <em>Trusted certificates</em>. A changed body, an untrusted or expired certificate, an unsigned Timestamp or a second Body is refused.</li>
<li><strong>SAML</strong>: paste the identity provider's signing certificate, and set the issuer and audience.</li>
<li><strong>Encrypted requests</strong>: put this service's private key in the vault and pick it under <em>XML encryption</em>; give callers the matching certificate. Requests encrypted for it are decrypted first (AES-GCM or AES-CBC, keys by RSA-OAEP; RSA 1.5 is refused), then checked. <em>Require an encrypted body</em> refuses plain ones.</li>
<li><strong>Encrypted responses</strong>: choose <em>caller certificate</em> to encrypt replies for the certificate in a successfully verified X.509 request, or <em>configured certificate</em> and paste the recipient certificate for UsernameToken, SAML or another caller. Successful replies and faults after authentication are encrypted; a failure before a caller certificate is trusted stays a plain SOAP fault. AES-GCM is the default; use CBC only for an older partner.</li>
</ul>
[[img:resources|Resources: an API security policy using API keys held in the vault.]]
<p class="h">TLS certificate of the gateway</p>
<ul>
<li><strong>Self-signed</strong>: for testing.</li>
<li><strong>Own certificate</strong>: paste the PEM chain and key; the key is checked against the certificate and stored encrypted.</li>
<li><strong>Let's Encrypt</strong>: SutraFlow uses ACME to ask Let's Encrypt for a publicly trusted certificate and renew it automatically. No certificate files need to be copied by hand.</li>
<li><strong>Client CA</strong>: enables mutual TLS for policies that use it.</li>
</ul>
<p class="h">Issue a Let's Encrypt certificate</p>
<p>Before requesting one:</p>
<ul>
<li>Use public DNS names that resolve to the firewall, load balancer or machine in front of this gateway. Let's Encrypt does not issue a certificate for <code>localhost</code> or a private-only host name.</li>
<li>Make public TCP port 80 reach the gateway's HTTP listener for every name. Forwarding public port 80 to a different internal gateway HTTP port is fine. Keep HTTP available for later renewals.</li>
<li>Allow the server to make outbound HTTPS connections to Let's Encrypt. A reverse proxy must pass <code>/.well-known/acme-challenge/</code> to the SutraFlow gateway unchanged rather than authenticating it.</li>
<li>Know the contact email and be authorised to accept the Let's Encrypt Subscriber Agreement. Wildcard names are not supported because SutraFlow uses the HTTP-01 challenge, not DNS-01.</li>
</ul>
<p>SutraFlow does not require an OpenSSL program for this operation. Certificate keys, the CSR and ACME signatures use Node's cryptography inside the server. OpenSSL is used only by the development release gate when it creates a temporary TLS test server.</p>
<ol>
<li>Open <strong>Admin Console &rarr; Server &rarr; Gateway &amp; TLS</strong>. Confirm the gateway bind address and its HTTP and HTTPS ports.</li>
<li>Select <strong>Let's Encrypt</strong>, enter the names separated by commas (the first becomes the common name), and enter the contact email.</li>
<li>For the first attempt, select <strong>Use the staging environment</strong>. Accept the Subscriber Agreement and choose <strong>Request certificate</strong>.</li>
<li>Watch the status shown below the button. Test HTTPS after it succeeds. A staging certificate is deliberately untrusted; it proves that DNS, forwarding and the challenge route work.</li>
<li>Clear staging and request again to obtain the trusted production certificate. The HTTPS listener reloads the certificate without dropping existing connections.</li>
</ol>
<p>The server checks twice a day. When fewer than 30 days remain it repeats the same HTTP-01 proof and installs the renewed certificate. The ACME account key and certificate private key are stored encrypted with this server's master key. In a cluster, a database lease lets one engine place the order, every gateway can answer its shared HTTP-01 tokens, and all engines reload the new certificate on their next heartbeat. The load balancer may therefore send the challenge to any healthy gateway node.</p>
<p>TLS 1.2 is the minimum.</p>`,
  },
  {
    id: 'call', title: 'Calling services: REST, SOAP and WS-Security',
    html: `
<p>Outbound calls take two shared resources:</p>
<ul>
<li><strong>HTTP connection</strong>: base URL, timeout, default headers, certificate checking, extra trusted CAs, client certificate and key for mutual TLS, proxy.</li>
<li><strong>Outbound security</strong>: how SutraFlow proves who it is.</li>
</ul>
<p class="h">Circuit breaker</p>
<p>When a service is down, waiting for every call to time out slows every run. On the HTTP connection, set <em>Open the circuit after</em> to a number of failures in a row (errors or 5xx replies). The circuit then opens: calls through that connection fail at once with "Circuit open" for the time you set, then one trial call decides whether it closes again. SOAP faults do not count; they mean the service is up. Combine it with retries and an error output that, for example, queues the work for later.</p>
<table class="t"><thead><tr><th>Method</th><th>For</th><th>What is sent</th></tr></thead><tbody>
<tr><td>Basic</td><td>REST, SOAP</td><td><code>Authorization: Basic</code></td></tr>
<tr><td>Bearer</td><td>REST, SOAP</td><td><code>Authorization: Bearer</code></td></tr>
<tr><td>API key</td><td>REST, SOAP</td><td>A header or query parameter.</td></tr>
<tr><td>OAuth 2.0 client credentials</td><td>REST, SOAP</td><td>A token from the token URL, cached until it expires.</td></tr>
<tr><td>Custom headers</td><td>REST, SOAP</td><td>Any headers; values may use <code>{{secret.X}}</code>.</td></tr>
<tr><td>WS-Security UsernameToken</td><td>SOAP</td><td>Password digest (nonce and created) or text, optional timestamp.</td></tr>
<tr><td>WS-Security SAML token</td><td>SOAP</td><td>A SAML 1.1 or 2.0 assertion from the vault or from an earlier step (for example a token service call).</td></tr>
<tr><td>WS-Security X.509</td><td>SOAP</td><td>A binary security token and an XML signature over Body and Timestamp.</td></tr>
<tr><td>HMAC</td><td>HTTP</td><td>The body (with a timestamp, or the method, path and timestamp) signed with a shared secret, in the receiver's header names and format.</td></tr>
</tbody></table>
<p>Every WS-Security profile can also <strong>encrypt the Body</strong> for the receiving service: paste its certificate under <em>Encrypt the body for</em>. A signed message is signed first, then encrypted, as receivers expect. AES-256-GCM is the default; choose CBC only for services that do not support GCM.</p>
<p>See [[httpRequest]] and [[soapInvoke]].</p>`,
  },
  {
    id: 'messaging', title: 'Messaging: Kafka, RabbitMQ and ActiveMQ',
    html: `
<p>The Service Bus palette works the JMS way: [[busPublish]] sends, the <strong>Queue / topic trigger</strong> [[busSubscribe]] starts a run per message, and [[busConfirm]] acknowledges at a point you choose. It is a process starter even though it stays in the Service Bus palette, where its green ▶ identifies it.</p>
<ul>
<li>Put queue and topic names in project variables (<code>{{gv.ORDER_QUEUE}}</code>) so each environment can use its own.</li>
<li>JMS headers: delivery mode (persistent or not), priority, time to live, message id, correlation id, reply-to and type; plus your own properties.</li>
<li>Only the elected leader subscribes. Other engines may execute the run's steps, but they do not open a second consumer. A replacement leader reopens the subscription after the lease changes.</li>
</ul>
<p class="h">Choose when to acknowledge</p>
<table><thead><tr><th>Mode</th><th>Use it when</th><th>Do not use it when</th><th>What SutraFlow does</th></tr></thead><tbody>
<tr><td><strong>Client — after success</strong><br>(recommended default)</td><td>Every successful path may finish before the broker message is removed. Good for normal validation, transformation, database work and short integrations.</td><td>You must confirm after one particular irreversible step, or the run may wait a long time for a person or child process.</td><td>Acknowledges only when the whole run is done. A failed or cancelled run follows <em>When the Sutra fails</em>.</td></tr>
<tr><td><strong>Explicit — Confirm message</strong></td><td>The safe acknowledgement boundary is visible in the design: for example, after an order is committed or a reply is published. Put Confirm message after that operation on every success path.</td><td>You cannot identify one safe boundary, or a later step must be part of the same guarantee. Do not place it before the required outside effect: a later failure cannot bring an acknowledged message back.</td><td><em>confirm</em> acknowledges; <em>requeue</em> asks for another delivery; <em>reject (dead-letter)</em> rejects it. If the run ends without reaching Confirm message, SutraFlow treats that as failure and releases or rejects it according to the trigger settings.</td></tr>
<tr><td><strong>Auto — on receipt</strong></td><td>Only for disposable events where losing a message is acceptable, such as best-effort telemetry already stored elsewhere.</td><td>Orders, payments, file movement, customer requests, approvals, or anything that must survive an engine crash.</td><td>The broker considers the message handled before the Sutra runs. A crash or failure therefore cannot redeliver it.</td></tr>
</tbody></table>
<p class="h">Failure, redelivery and duplicate protection</p>
<ol>
<li>Before a protected delivery starts, SutraFlow reserves its identity in the shared database and binds it to the run. Kafka always provides topic/partition/offset. RabbitMQ and AMQP publishers must set a stable, unique message id; without one the broker can redeliver, but SutraFlow cannot recognise the delivery across a leader change.</li>
<li>If a run fails, choose <em>requeue</em> to try it again, or <em>reject (dead-letter)</em> to let the broker's dead-letter policy receive it. <em>Reject after this many deliveries</em> changes repeated requeues into a rejection at the configured count; zero means never reject because of the count. Configure the broker's dead-letter exchange/address as well—SutraFlow rejects the delivery but does not create the broker's dead-letter destination.</li>
<li>If acknowledgement is lost, or a new leader receives the same message, it reads the durable reservation. A completed run is acknowledged without a second run. A failed or cancelled run releases the reservation and may run again. An active or waiting run causes the duplicate delivery to be released promptly for later redelivery, so it neither starts twice nor occupies a consumer slot throughout an approval.</li>
<li>The database reservation prevents a second Sutra run for the same protected identity; it cannot undo an outside call made just before a crash. Pass the message identity as an idempotency key to payment, order and other write APIs, and make database writes unique where possible.</li>
</ol>
[[tip:Practical default|Use <strong>client</strong>, duplicate protection <strong>on</strong>, <strong>requeue</strong>, a finite redelivery limit and a broker dead-letter destination. Use <strong>explicit</strong> only when the process has a deliberate commit point. Use <strong>auto</strong> only when loss is acceptable. For a long approval, consider persisting the request and acknowledging at that deliberate point rather than retaining one broker delivery for hours.]]`,
  },
  {
    id: 'websocket', title: 'WebSockets: live connections',
    html: `
<p>A WebSocket is a connection that stays open, so either side can send at any time: a page that shows an order's status as it changes, a dashboard, a device. SutraFlow serves WebSockets on the gateway, and connects to other WebSocket servers.</p>
<p class="h">A WebSocket service, step by step</p>
<ol>
<li>Add a [[wsService]] trigger. Set its path (<code>/ws/orders</code>) and an API security policy.</li>
<li>Connect its <em>message</em> output to the steps that handle a message, and end with [[wsSend]] (<em>this connection</em>) to answer.</li>
<li>Optionally connect <em>open</em> (a client connected: send a welcome, or keep its <code>connectionId</code> in a memory table) and <em>close</em>.</li>
<li>Deploy. Clients connect to <code>ws://host:8080/ws/orders</code> or <code>wss://host:8443/ws/orders</code>.</li>
</ol>
<pre>const ws = new WebSocket('wss://api.example.com:8443/ws/orders?access_token=' + token);
ws.onmessage = e =&gt; console.log(JSON.parse(e.data));
ws.onopen = () =&gt; ws.send(JSON.stringify({ type: 'watch', orderId: 'A-1001' }));</pre>
<p class="h">Security</p>
<ul>
<li>The policy is checked once, when the client connects: API keys, JWT, token introspection, gateway apps, Basic, mutual TLS, IP lists and rate limits work as for REST.</li>
<li>Browsers cannot set headers on a WebSocket: they pass a token as <code>?access_token=</code>, or the API key under the policy's key header name, such as <code>?X-API-Key=</code>.</li>
<li>With CORS origins on the policy, only pages from those origins may connect.</li>
<li>Each message is checked for size (<em>Max message size</em>), nesting and the policy's threat limits, and against the message schema when <em>Validate messages</em> is on. A bad message gets an error message back and starts no run.</li>
</ul>
<p class="h">Pushing and broadcasting</p>
<p>[[wsSend]] can write to any connection by its id (from an earlier message, a memory table, or a database), or to every connection of a service. In a cluster a connection stays on the engine that accepted it; a step on another engine leaves the message in the database and that engine delivers it within a fraction of a second. The Designer's <strong>Services</strong> page lists the WebSocket services with their ws:// and wss:// addresses.</p>
<p class="h">Order and load</p>
<p>By default a connection's messages are handled one at a time, so answers come back in order. Turn <em>One message at a time per connection</em> off for independent messages that may run side by side. A client that sends faster than its runs finish is closed after 1,000 waiting messages rather than filling memory; a client that stops answering pings is dropped after 30 seconds.</p>
<p class="h">Connecting to other WebSocket servers</p>
<ol>
<li>Create a <em>WebSocket connection</em> in Resources: the address (<code>wss://...</code>), headers such as <code>Authorization = Bearer {{secret.STREAM_TOKEN}}</code>, and how it reconnects.</li>
<li>For a stream, add a [[wsClientTrigger]] with the subscribe message the server expects. Each message it receives starts a run; when the connection drops it reconnects and subscribes again. In a cluster the leader holds the connection.</li>
<li>To ask once and wait for the answer, use [[wsClientSend]], with <em>Answer has field</em> when the server sends other messages on the same connection.</li>
</ol>`,
  },
  {
    id: 'files', title: 'Files',
    html: `
<p>File activities read and write text, CSV rows, lines, JSON, XML and binary (base64) in UTF-8, UTF-16, ISO-8859-1, Windows-1252 and other encodings.</p>
<ul>
<li>With a <strong>row schema</strong>, CSV and lines become typed, repeating rows, ready for a For-Each in the mapper.</li>
<li>[[fileList]] takes wildcards: <code>C:\\in\\*.csv</code>, or <code>=concat({gv.DIR}, '\\*.csv')</code>.</li>
<li>[[fileWrite]] appends or overwrites, and always returns the file's name, path, size and what it did.</li>
<li>[[fileTrigger]] reacts to added, modified and removed files; move processed files away with [[fileMove]].</li>
</ul>
<p class="h">Big files: Stream in batches</p>
<p>A file read whole is held in memory, as text and again as rows, so [[fileRead]] refuses files over its <em>Maximum size</em> (50 MB by default). CSV and line files of any size can be <strong>streamed</strong> instead: tick <em>Stream in batches</em> on [[fileRead]] or [[fileList]].</p>
<ul>
<li>The file is read piece by piece. Every <em>Rows per batch</em> rows (1,000 by default) go out on the <strong>batch</strong> port as <code>{input.rows}</code>, with <code>{input.batch}</code> (1, 2, 3 ...), <code>{input.count}</code> and <code>{input.file}</code>. The steps connected to batch start at once, while reading goes on.</li>
<li>When the whole file is read, <strong>out</strong> gives the file details with <code>{input.count}</code> (rows) and <code>{input.batches}</code>: connect the steps that should run once, at the end, there.</li>
<li>Only a few batches are in memory or in the work queue at a time: when more wait than the engine runs at once, reading pauses until they are taken (back pressure). Memory and disk use stay the same for a 10 MB file and a 10 GB one.</li>
<li>The time limit of a streaming step counts from its last batch, so a long file is not cut off while it keeps sending batches.</li>
<li>The run keeps a summary of each batch in <code>{nodes.Read orders}</code> (number, count, file), not its rows: map the rows from <code>{input.rows}</code> in the step on the batch port.</li>
<li>Each batch is a step of its own, and counts towards <em>Steps per run</em> (10,000 by default): for 10 million rows, use batches of 5,000 or more, or raise the limit.</li>
<li>Set <em>Step data in history</em> to <strong>none</strong> for such Sutras: each batch step then keeps no input or output once it is done, and the database stays small. With <em>all</em> or <em>errors only</em>, every batch is kept until the run ends, so the database grows by about twice the file for a while. Measured: a 1 GB CSV file (18.6 million rows) on a 384 MB heap took about 2.5 minutes, the engine peaked at 270 MB, and the database ended at 4 MB with <em>none</em>, against 1.8 GB when every batch was kept until the end.</li>
<li>When the read step fails halfway and is retried, it starts the file again: make the batch steps safe to repeat (an upsert rather than an insert).</li>
<li>Stream big files in <em>durable</em> Sutras. In a Sutra that runs in memory, batches waiting for a worker are held in memory too.</li>
</ul>
<p class="h">SFTP and FTP servers</p>
<p>The <strong>SFTP / FTP</strong> palette works with files on another server: [[remoteTrigger]], [[remoteList]], [[remoteRead]], [[remoteWrite]] and [[remoteMove]]. Each step names the protocol and an <em>SFTP server</em> or <em>FTP server</em> connection.</p>
<ul>
<li>Keep the server settings in that shared connection; do not repeat host names or credentials in activities. Every remote-file activity and trigger selects the connection in the designer and resolves it again on the engine at runtime.</li>
<li>Host, port, user, base folder, limits and even the <em>name</em> of the password or key secret can use Project variables such as <code>{{gv.FTP_HOST}}</code>. Deployment configuration has the last word, so an administrator can give test and production different values before deployment without editing the Sutra. Secret values themselves stay in each server's vault.</li>
<li><strong>SFTP</strong> signs in with a password or a private key from the vault. Paste the server's <em>host key fingerprint</em> (Test connection shows it, as <code>SHA256:...</code>) so a different server is refused.</li>
<li><strong>FTP</strong> uses explicit TLS (FTPS) by default; implicit TLS and plain FTP are there for old servers.</li>
<li>The <em>base folder</em> fences the steps in: a path such as <code>../../etc</code> is refused.</li>
</ul>
<p class="h">Time limits for slow or far-away servers</p>
<p>A server in another region, or a busy one, can take a while to answer. Each SFTP or FTP connection has its own limits:</p>
<table class="t"><thead><tr><th>Setting</th><th>Default</th><th>What it limits</th></tr></thead><tbody>
<tr><td>Connect time limit</td><td>30 s</td><td>Reaching the server and signing in.</td></tr>
<tr><td>Response time limit</td><td>60 s</td><td>Each operation: a listing, a read, a write, a rename. A large file is one operation, so allow for its transfer time.</td></tr>
<tr><td>Connection attempts</td><td>3</td><td>Tries after a network failure. A wrong password or host key is not tried again.</td></tr>
<tr><td>Wait between attempts</td><td>5 s</td><td>The pause before the next try.</td></tr>
<tr><td>Keep-alive every</td><td>15 s</td><td>SFTP only: keeps a slow session open through firewalls. 0 turns it off.</td></tr>
</tbody></table>
<p>The step itself has a time limit too, in its <em>Settings</em> tab. SFTP and FTP steps and every AI activity allow 10 minutes by default (other activities 2 minutes); raise it for very large files or slow models. When a limit is passed, the error says which one, for example <em>Reading inbox/big.csv took longer than 60 s (Response time limit of the connection)</em>.</p>`,
  },
  {
    id: 'apps', title: 'Databases, email, Firebase and apps',
    html: `
<ul>
<li><strong>DB Ops</strong> works with PostgreSQL, MySQL/MariaDB, SQL Server, Oracle and SQLite. Parameters are written <code>:name</code> and are always bound, never pasted into the SQL. [[dbScript]] runs install scripts (tables, procedures, seed rows); a REST service with [[dbProcedure]] then turns a stored procedure into a microservice, as <em>Sample: Procedure as a microservice</em> shows.</li>
<li><strong>Email</strong>: SMTP to send, IMAP to start a run per incoming message.</li>
<li><strong>Firebase</strong>: Firestore, Realtime Database and push notifications, with a service-account key held in the vault.</li>
<li><strong>Apps</strong> (Google Sheets, Drive and Docs, Dropbox, YouTube, Facebook Pages) use an <strong>OAuth connection</strong>: create it in Resources, then click <em>Connect account</em> and sign in once. Tokens are stored in the vault and refreshed automatically. [[oauthRequest]] reaches any other API of the same account.</li>
</ul>`,
  },
  {
    id: 'memory', title: 'Memory tables: fast reference data',
    html: `
<p>A <strong>memory table</strong> keeps small reference data in the memory of each engine, so a step or a mapping finds a value without a database round trip: currency rates, product and country codes, routing rules, limits per customer, reusable values that many Sutras read again and again. It is made like a connection (Resources &rarr; New &rarr; <em>Memory table</em>) and used with the [[memGet]], [[memPut]], [[memDelete]], [[memQuery]] and [[memReload]] steps, or with <code>=memory-lookup('Table', key, 'field')</code> in any mapping or setting.</p>
[[note:Small data only|Memory tables are for values looked up often, not for big tables or files: each has a limit of rows and megabytes (10,000 rows and 16 MB by default, at most 100,000 and 256 MB), and a load query that returns more is refused. Big data stays in the database; big files are streamed in batches.]]
<p class="h">Where the rows come from</p>
<ul>
<li><strong>A load query</strong> on an Oracle, SQL Server, MySQL, PostgreSQL or SQLite connection loads the table at first use and on demand, at an interval, or from a cron expression with an IANA time zone. A <code>WHERE</code> clause loads only the part that is looked up often (active products, this year's rates).</li>
<li><strong>A lookup query</strong> (optional) fetches a row that is not in memory, such as <code>SELECT ... WHERE code = :key</code>, and keeps it: the rest of a table is read only when asked for.</li>
<li><strong>Sutras</strong> add and change cached rows with [[memPut]]; this never updates the external source database. An administrator can change a cached value by hand in the Admin Console.</li>
<li>Rows can expire after a time (<em>Rows expire after</em>), and when the table is full the least recently used rows go first.</li>
</ul>
<p class="h">Failsafe</p>
<table class="t"><thead><tr><th></th><th>Copy in the database (default)</th><th>Memory only</th></tr></thead><tbody>
<tr><td>A change (put, delete, by hand)</td><td>Saved in memory and in the SutraFlow database</td><td>In memory of this engine only</td></tr>
<tr><td>Other engines of a cluster</td><td>See the change within a second</td><td>Have their own rows</td></tr>
<tr><td>An engine restarts</td><td>Has every row at once, from the copy (the source is not asked)</td><td>Loads from the source again; rows put by Sutras are gone</td></tr>
<tr><td>Cost of a change</td><td>One small database write</td><td>None</td></tr>
</tbody></table>
<p class="h">How it works</p>
<ul>
<li>Each engine keeps a table as a key-value map in its own Node.js process (a JavaScript <code>Map</code> that also keeps the order of use, for dropping the least recently used rows). There is no extra server to run.</li>
<li>The failsafe copy is two tables of the SutraFlow database (SQLite or PostgreSQL): <code>mem_rows</code> holds each row with the version of the change that wrote it, <code>mem_meta</code> the latest version per table. An engine compares versions at most once a second (<code>SUTRA_MEMORY_SYNC_MS</code>) and reads only the rows changed since.</li>
<li>Reads (Get Memory Record, memory-lookup) cost no database work while the table is in sync.</li>
<li>A refresh builds and validates a replacement first, then swaps it atomically. A failed query, missing key or quota failure leaves the last good table available.</li>
<li>For a failsafe table, only the cluster leader runs a scheduled refresh; after failover the new leader continues. A memory-only table refreshes independently on every engine.</li>
<li>Connection details and Project and Engine properties are cached for the <em>Settings refresh</em> time and cleared when administrators change them.</li>
</ul>
<p class="h">The Admin Console</p>
[[img:console-memory|Admin Console, Memory tables: each table with its rows, memory and hit rate; an open table with its settings and rows, a page at a time]]
<p><strong>Operate &rarr; Memory tables</strong> lists every table with its project, rows and memory against its limits, hit rate, when it was loaded and its failsafe, filtered by project, name or failsafe. An administrator configures the source connection and queries, interval or cron refresh, time zone and table limits there; sets cluster and per-project record/MB quotas; and opens a table to inspect records, their approximate size and expiry.</p>
<ul>
<li><strong>Reload</strong> is a hot reload: this engine loads the table again now, and every other engine within a second. Sutras keep running.</li>
<li><strong>Edit</strong>, <strong>Add row</strong> and <strong>Remove</strong> change a single value by hand, such as a rate, without a deploy.</li>
<li><strong>Clear</strong> empties the table; a lookup query fills it again as rows are asked for.</li>
<li>The same from a command line: <code>sutra memory list</code>, <code>rows</code>, <code>reload</code>, <code>clear</code>, <code>set</code> and <code>remove</code>.</li>
</ul>
<p>Project release packages carry a Memory-table deployment descriptor: key fields, source database name and driver, referenced source objects, load and lookup queries, refresh/time zone, limits and failsafe mode. Package preflight rejects a missing database dependency, unsupported driver, empty load query, invalid cron expression or invalid limits before deployment.</p>
[[tip:Good uses|Values read on almost every run and changed rarely: rates, codes, mappings between systems, limits, feature switches. Keep it durable in your own database too when it matters (the memory table is a fast copy), and prefer a load query with a WHERE clause plus a lookup query over loading a whole table.]]`,
  },
  {
    id: 'code', title: 'Custom code, HTML and AI',
    html: `
<ul>
<li>[[jsCode]] runs your JavaScript in a sandbox without host access, with time and memory limits.</li>
<li>[[htmlTemplate]] builds HTML with escaped placeholders, loops and conditions.</li>
<li>[[jsonata]] transforms JSON with one expression.</li>
<li>The <strong>Scripts</strong> palette runs [[powershell]], [[shellScript]] (bash, sh or cmd) and [[runProgram]] on the server, capturing the output, the error output and the exit code. An administrator must allow scripts in Admin Console &rarr; Server &rarr; Runtime first; values reach scripts as environment variables, never as script text.</li>
<li>The <strong>AI</strong> palette: [[aiPrompt]], [[aiClassify]], [[aiRouter]], [[aiExtract]], [[aiSummarize]], [[aiTranslate]] and [[aiSentiment]]. Each also returns <code>ai</code>: the provider, engine, model, input, output and total tokens, and the time taken.</li>
</ul>
<p class="h">AI providers</p>
<p>An <em>AI provider</em> connection chooses the engine. Several can exist side by side, for example a fast one for routing and a strong one for summaries.</p>
<table class="t"><thead><tr><th>Engine</th><th>What it needs</th><th>Default model</th></tr></thead><tbody>
<tr><td>Claude API</td><td>An Anthropic API key in the vault.</td><td><code>claude-opus-5-5</code>; also <code>claude-sonnet-5-5</code>, <code>claude-haiku-5-5</code></td></tr>
<tr><td>Gemini API</td><td>A Google AI Studio or Vertex API key.</td><td><code>gemini-3-pro-preview</code>; also other Gemini 3 models</td></tr>
<tr><td>OpenAI API</td><td>An OpenAI API key. Any compatible server works with its own API base URL.</td><td><code>gpt-5</code></td></tr>
<tr><td>Ollama</td><td>An Ollama server; on this machine by default (<code>http://127.0.0.1:11434</code>). A full endpoint such as <code>http://localhost:11434/api/generate</code> also works, and the <em>Ollama API</em> setting chooses chat or generate. No key; nothing leaves your network, so it works offline.</td><td>The first model installed, or the one you pick</td></tr>
<tr><td>LM Studio</td><td>LM Studio's local server (<code>http://127.0.0.1:1234/v1</code>).</td><td>The model loaded in LM Studio</td></tr>
<tr><td>Hugging Face</td><td>A Hugging Face token; uses Hugging Face Inference Providers.</td><td>A model id such as <code>Qwen/Qwen3-8B</code></td></tr>
<tr><td>Hugging Face TGI (local)</td><td>Text Generation Inference running on your machine (default <code>http://127.0.0.1:8090/v1</code>; SutraFlow's gateway uses 8080).</td><td>The model TGI serves</td></tr>
<tr><td>OpenAI-compatible server</td><td>Any server with the OpenAI chat API: llama.cpp, vLLM, LocalAI, Jan. Key only when the server asks for one.</td><td>The server's first model, or the one you pick</td></tr>
<tr><td>Claude CLI, Gemini CLI, OpenAI Codex CLI</td><td>The command-line tool installed and signed in on the server (<code>claude</code>, <code>gemini</code>, <code>codex</code>). Uses that tool's own account.</td><td>The tool's default, or the one you set</td></tr>
</tbody></table>
<p>Click <strong>List models</strong> to see the models the engine offers and pick one; <strong>Test connection</strong> shows which model answered, with tokens and time.</p>
<p class="h">Adding models to Ollama, online or offline</p>
<ul>
<li><strong>Pull</strong> a model by name, such as <code>qwen3</code>, when the Ollama machine has internet.</li>
<li><strong>Import from a path on this server</strong> when it does not. Copy the files over (USB drive, share), then give their path: a <code>.gguf</code> file; a Modelfile (FROM file.gguf, with TEMPLATE, SYSTEM and PARAMETER); a Safetensors model folder; or an Ollama models folder copied from another machine (it holds <code>manifests</code> and <code>blobs</code>), with the model to take from it. SutraFlow sends the files to Ollama through its API and registers them under the name you choose.</li>
</ul>
<p class="h">One setting per environment</p>
<p>The deployment config overrides any connection setting, the engine included. Test with a local Ollama and run production on another engine without changing a Sutra:</p>
<pre>"resources": { "AI provider": { "engine": "Claude API", "model": "claude-sonnet-5-5", "apiKeySecret": "ANTHROPIC_KEY" } }</pre>
[[tip:Command-line tools|The prompt is sent to the tool on standard input, never on the command line, and the tool runs in an empty folder as the SutraFlow server user. Keep the tool's own permissions for running commands and editing files switched off: a message from outside could otherwise ask it to act on the server.]]
[[tip:Guidelines|Route AI decisions that matter (money, customers) through an <strong>Approval</strong> step until you trust them.]]`,
  },
  {
    id: 'ai-concepts', title: 'AI concepts: models, RAG, tools, MCP and agents',
    html: `
<p>This chapter explains the ideas behind the AI palettes in plain words, and which SutraFlow part does each. The next chapters build with them.</p>
<p class="h">Models and providers</p>
<ul>
<li><strong>Model</strong>: the program that writes text (a <em>large language model</em>). It reads a <strong>prompt</strong> and writes an answer. Large models (Claude, GPT, Gemini) are strong and paid per use; small local models (phi4-mini, qwen, llama in Ollama) are free, private and good at short, guided tasks.</li>
<li><strong>AI provider</strong> (Resources): where the model runs and how to reach it: Claude, OpenAI, Gemini, Ollama, LM Studio, any OpenAI-compatible server, or a command-line assistant. Every AI step names one, so changing the model is one setting.</li>
<li><strong>Tokens</strong>: models read and write in pieces of words, about four characters each. Prices, limits and speed are counted in tokens. The <strong>context window</strong> is how many tokens one call can hold: instructions, history, passages and the question together.</li>
<li><strong>Instructions</strong> (the system prompt): the standing rules for a step, such as who it speaks for, how long answers are, what it must never do. <strong>Effort</strong> trades speed for care.</li>
</ul>
<p class="h">Single AI steps</p>
<p>Most AI work is one call: [[aiPrompt]] (any prompt), [[aiClassify]] (pick a label), [[aiRouter]] (choose a branch), [[aiExtract]] (fields from text into JSON), [[aiSummarize]], [[aiTranslate]], [[aiSentiment]], and [[ollama]] for a local model. They fit anywhere in a Sutra, and their output maps like any other step's.</p>
<p class="h">Embeddings, vectors and similarity</p>
<p>An <strong>embedding</strong> turns a text into a list of numbers, a <strong>vector</strong>, so that texts with similar meaning get similar numbers. "How long can I return an item?" and "Returns are accepted within 30 days" share few words but have close vectors. Vectors come from an <strong>embedding model</strong> (Ollama <code>nomic-embed-text</code>, OpenAI <code>text-embedding-3-small</code>, Gemini) or, offline and free, from SutraFlow's built-in word vectors, which match shared words rather than meaning. [[aiEmbed]] gives you vectors directly.</p>
<p class="h">Knowledge bases and RAG</p>
<p><strong>Retrieval-augmented generation</strong> (RAG) lets a model answer from your documents instead of from memory: find the passages that matter, put them in the prompt, and have the model answer only from them, naming its sources. It is how an assistant knows today's price list, your leave policy or a contract it was never trained on, and it keeps answers checkable.</p>
<ol>
<li><strong>Feed</strong>: read each document ([[docText]] takes the text out of PDF, Word, PowerPoint, Excel, OpenDocument and HTML), split it into <strong>passages</strong> (chunks of a few hundred tokens that overlap a little, so no sentence is cut off from its context), make a vector of each, and store them with the <strong>source</strong> (file name or address) and <strong>details</strong> (metadata such as department or date). [[knowledgeAdd]] does all of it.</li>
<li><strong>Store</strong>: the passages and vectors live in a <strong>vector store</strong>: built-in or a folder (nothing to install, fine for tens of thousands of passages), PostgreSQL with pgvector, Qdrant, Chroma or Pinecone (millions of passages, shared by several servers).</li>
<li><strong>Retrieve</strong>: the question gets a vector too, and the closest passages are found. SutraFlow scores by meaning (70%) and shared words (30%), so names and codes such as TEA-01 still match. [[knowledgeSearch]].</li>
<li><strong>Generate</strong>: the model answers from the passages, citing them as [source#passage]; with no fitting passage it says it does not know. [[knowledgeAsk]] does retrieve and generate in one step.</li>
</ol>
<p>The <strong>Knowledge base</strong> resource holds the store, where vectors come from, and the passage size; feeds, searches and agents name it.</p>
<p class="h">Tools</p>
<p>A model alone only writes text. A <strong>tool</strong> lets it act or look things up: check an order, read stock, create a ticket. In SutraFlow every tool is a Sutra that starts with [[mcpTool]]: you describe it (name, what it does, its inputs), build the work with any palette, and end with [[mcpReply]]. The model never touches your systems; it only asks for the tool, and the Sutra does the work with its own connections and checks. Tick <em>Changes data</em> on tools that change something.</p>
<p class="h">MCP: the Model Context Protocol</p>
<p>MCP is the open standard AI assistants use to find and call tools. It has two sides, and SutraFlow is both:</p>
<ul>
<li><strong>MCP server</strong>: SutraFlow publishes your AI tool Sutras on the gateway at <code>/mcp</code> (or an address of an <strong>MCP server</strong> resource with its own policy). Claude Desktop, Claude Code, ChatGPT, Copilot, Cursor and others connect and call them. A published agent appears there too, as <code>ask_&lt;name&gt;</code>.</li>
<li><strong>MCP client</strong>: an <strong>MCP client</strong> resource connects SutraFlow to someone else's MCP server (by address, or a command such as <code>npx @modelcontextprotocol/server-filesystem</code>). [[mcpCall]] calls its tools directly; an agent with the client set may use them; <em>Allowed tools</em> limits which.</li>
</ul>
<p>A tool's test arguments let you run it in the designer without any assistant: Test runs the Sutra as if a caller had sent them, and shows <em>studio test</em> as the caller.</p>
<p class="h">Agents</p>
<p>An <strong>agent</strong> ([[aiAgent]]) is a model in a loop: it reads the goal, thinks, picks a tool, reads the result, and repeats until it can answer, within limits of steps, tokens and time you set. It can use your AI tool Sutras, a knowledge base (the tool <code>search_knowledge</code>, and passages fetched before it starts), and outside MCP tools. Each step is saved in the run, so you can see why it answered as it did.</p>
<ul>
<li><strong>Memory</strong>: runs stand alone, so a conversation is kept in an <strong>AI memory</strong> store under its session id; older turns are summarised when the history grows ([[memoryLoad]], [[memorySave]], [[memoryClear]]).</li>
<li><strong>Guardrails</strong>: [[aiGuard]] checks a message before the model sees it: hides personal data, stops hidden instructions (<em>prompt injection</em>), blocks topics, limits length.</li>
<li><strong>Human in the loop</strong>: an agent may stop with a question (<em>needs a person</em>); [[askPerson]] puts it in Approvals and the run waits for the answer.</li>
<li><strong>Several agents</strong>: a supervisor routes each question ([[aiClassify]] or [[aiRouter]]) and [[agentHandoff]] passes it, with the same session, to a specialist agent.</li>
<li><strong>Channels</strong>: [[agentChannel]] publishes an agent as a chat page and widget, an OpenAI-compatible model, an MCP tool and an A2A agent; [[agentReply]] answers on whichever the question came by. Long work answers with a job id at once.</li>
</ul>
<p class="h">Which to use</p>
<table class="t"><thead><tr><th>You want</th><th>Use</th></tr></thead><tbody>
<tr><td>Classify, extract or summarise text inside a process</td><td>A single AI step</td></tr>
<tr><td>Answers from your documents, with sources</td><td>A knowledge base with [[knowledgeAsk]]</td></tr>
<tr><td>Claude or another assistant to use your systems</td><td>AI tool Sutras published over MCP</td></tr>
<tr><td>A conversation that looks things up and acts</td><td>An agent with tools, memory and a channel</td></tr>
<tr><td>Fixed business rules (refunds, approvals, limits)</td><td>Ordinary steps (If, Switch, Ask a person) before or after the AI, never left to the model</td></tr>
</tbody></table>
[[tip:Good practice|Keep decisions that matter in ordinary steps; let the model read, write and choose among safe options.<br>Ask for JSON when a later step needs fields; <strong>AI extract</strong> checks it.<br>Log what the model was given and what it answered (Save steps), so answers can be explained.<br>Start with a small local model; move to a larger one only where answers fall short.]]`,
  },
  {
    id: 'mcp', title: 'AI skills over MCP',
    html: `
<p>A Sutra that starts with an [[mcpTool]] trigger (<strong>AI tool</strong>) is a <strong>skill</strong>: AI assistants such as Claude connect to SutraFlow over the Model Context Protocol (MCP), see the skills, and call them. Each call runs the Sutra with the arguments the AI chose, and [[mcpReply]] sends the outcome back. Skills can do anything a Sutra does: write a CSV file, post to a Facebook page, look up an order in a database, start an approval.</p>
<p class="h">Build a skill</p>
<ol>
<li>Under Resources, add an <strong>MCP server</strong>: its address on the gateway (for example <code>/mcp/orders</code>), a title, instructions for the AI, and an API security policy. One server holds many skills.</li>
<li>Create a Sutra that starts with <strong>AI tool</strong>, choose the server, and describe the tool: name, title, what it does and when to use it, and its inputs.</li>
<li>Build the work, and end every branch with <strong>Reply to AI</strong>; on error branches tick <em>Is an error</em>.</li>
<li>Test it in the studio with the trigger's test arguments, then Deploy. The <strong>Services</strong> page lists each skill with its address.</li>
</ol>
<p class="h">Connect an assistant</p>
<p>Give the assistant the server's address and, when a policy is set, the key or token as a header. With Claude Code:</p>
<pre>claude mcp add --transport http orders https://your-server:8443/mcp/orders --header "X-API-Key: your-key"</pre>
<p>Other assistants that support MCP over HTTP take the same address and header. Skills without a server are at <code>/mcp</code>.</p>
<p class="h">Sample skills</p>
<p><strong>Add sample Sutras</strong> also adds an MCP server named <em>Sample skills</em> (<code>/mcp/samples</code>) with two skills: <em>Skill: Write CSV file</em> and <em>Skill: Post to Facebook page</em>. Choose a security policy on the server, a Facebook connection and page on the second skill, and deploy them.</p>
[[tip:Guidelines|Protect every MCP server with an API security policy: a skill acts with the server's rights.<br>Tick <em>Changes data</em> on skills that create, change or delete something, so the assistant asks the user first.<br>Write descriptions for someone who has never seen the Sutra: the AI chooses skills by them.]]`,
  },
  {
    id: 'agents', title: 'AI agents and knowledge bases (RAG)',
    html: `
<p>An [[aiAgent]] works towards a goal in steps: it thinks, picks a tool, uses it, reads the result, and repeats until it can answer. Its tools are your own Sutras: any Sutra that starts with an [[mcpTool]] trigger is a tool for the agents of its project. A knowledge base and an outside MCP server add more tools.</p>
<p class="h">Build an agent</p>
<ol>
<li>Make the tools: Sutras that start with <strong>AI tool</strong>, describe what they do, and end with <strong>Reply to AI</strong>. The description is what the agent chooses by.</li>
<li>Under Resources, add an <strong>AI memory store</strong> (built-in is enough to start) and, for documents, a <strong>Knowledge base</strong>.</li>
<li>Make the agent Sutra: [[agentChannel]] (or any trigger), [[aiGuard]], [[aiAgent]], and [[agentReply]] on every branch. Connect <em>needs a person</em> to [[askPerson]].</li>
<li>Test it with the trigger's test message; the Output tab shows each step the agent took.</li>
<li>Deploy the tools and the agent.</li>
</ol>
<p class="h">Memory and the context window</p>
<p>Every run stands alone, so a conversation lives in the memory store under its session id. Each step sends, in this order: instructions and tools, the running summary, knowledge passages (at most a quarter of the window), the newest turns that still fit, and the message. When the history no longer fits, the oldest turns are folded into the summary. Messages of one session are handled one at a time, in arrival order; other sessions run alongside, and the queue survives restarts.</p>
<p class="h">Where the agent lives</p>
<p>A deployed Sutra with an [[agentChannel]] trigger is reachable at once at every entry point you tick:</p>
<table class="t"><thead><tr><th>Entry point</th><th>Address</th><th>Used by</th></tr></thead><tbody>
<tr><td>Chat page and API</td><td><code>/chat/&lt;name&gt;</code>, <code>POST /chat/&lt;name&gt;/api</code>, <code>/chat/&lt;name&gt;/widget.js</code></td><td>People; any web page (one script tag adds a chat button)</td></tr>
<tr><td>OpenAI-compatible</td><td><code>POST /v1/chat/completions</code> with model = name</td><td>Apps and SDKs that take an OpenAI base address</td></tr>
<tr><td>MCP</td><td>the tool <code>ask_&lt;name&gt;</code> on <code>/mcp</code> or your MCP server</td><td>Claude, ChatGPT, Copilot, Antigravity, Cursor</td></tr>
<tr><td>A2A</td><td><code>/a2a/&lt;name&gt;</code> and its agent card</td><td>Other agents</td></tr>
</tbody></table>
<p>Work that takes longer than <em>Answer within</em>, or waits for a person, answers at once with a job id; the caller fetches the answer later with it (<code>GET /chat/&lt;name&gt;/jobs/&lt;id&gt;</code>, the job argument of the MCP tool, <code>tasks/get</code> in A2A, or the message <code>status &lt;id&gt;</code> in the OpenAI API). The same agent can run on several servers; point them at one PostgreSQL database to share sessions.</p>
<p class="h">Knowledge bases (RAG)</p>
<p>A knowledge base keeps documents as passages with vectors, so agents find them by meaning. Store them built-in or in a folder, or in PostgreSQL with pgvector, Qdrant, Chroma or Pinecone. Vectors come from a model (Ollama nomic-embed-text, OpenAI, Gemini) or, offline, from built-in word vectors.</p>
<ul>
<li><strong>Fill it</strong> with a feed Sutra: a source ([[msFilesTrigger]], [[googleDriveTrigger]], [[fileTrigger]], [[remoteTrigger]], a list of web pages) &rarr; [[docText]] &rarr; [[knowledgeAdd]]. A removed file goes to [[knowledgeRemove]].</li>
<li><strong>Use it</strong> with [[knowledgeAsk]] (answers only from the documents, with sources), [[knowledgeSearch]], or an agent with the knowledge base set.</li>
<li><strong>Who sees what</strong>: store details with each source (for example <code>groups = finance</code>) and filter on them when searching.</li>
</ul>
[[tip:Guidelines|Put rules before the agent: route refunds, cancellations and other decisions with an If, not by asking the model to choose.<br>Give small models few tools and short instructions; they look things up well but may wander.<br>Protect public entry points with a policy that has a rate limit.]]`,
  },
  {
    id: 'rag-build', title: 'Build RAG step by step: from a folder of documents to answers',
    html: `
<p>This chapter builds a complete RAG system: documents in a folder are read into a knowledge base every 15 minutes, and the knowledge answers as a REST API, an MCP tool for AI assistants, and a chat agent. The <strong>AI document assistant</strong> sample project is this system ready-made (New project &rarr; Package file &rarr; <em>Or a sample project</em>); build it yourself once to understand each part. Sources other than a local folder (Google Drive, SharePoint, SFTP, web pages, databases) are at the end; only the feed changes.</p>
<p class="h">Step 1: a model (AI provider)</p>
<p>Answers need a language model; vectors can come from a model or from the built-in word vectors. For a private, free setup install <a href="https://ollama.com" target="_blank" rel="noopener">Ollama</a> and pull two models:</p>
<pre>ollama pull phi4-mini          # answers (about 2.5 GB; qwen3 or llama3.2 work too)
ollama pull nomic-embed-text   # vectors (about 270 MB)</pre>
<p>Under Resources add an <strong>AI provider</strong>: engine Ollama, model <code>phi4-mini</code>, address empty for this machine (<code>http://127.0.0.1:11434</code>). <em>Test connection</em> lists the models. A cloud model (Claude, OpenAI, Gemini) works the same: choose the engine and give its API key as a secret.</p>
<p class="h">Step 2: a vector store</p>
<table class="t"><thead><tr><th>Store</th><th>Good for</th><th>Set up</th></tr></thead><tbody>
<tr><td>built-in</td><td>Starting, up to tens of thousands of passages, one server</td><td>Nothing: passages live in SutraFlow's database</td></tr>
<tr><td>folder</td><td>The same, kept as a file you can back up or copy</td><td>A folder path</td></tr>
<tr><td>PostgreSQL (pgvector)</td><td>Hundreds of thousands to millions of passages; several SutraFlow servers sharing one knowledge base</td><td>PostgreSQL with the pgvector extension (below)</td></tr>
<tr><td>Qdrant</td><td>A dedicated vector database, fast filters</td><td><code>docker run -p 6333:6333 qdrant/qdrant</code></td></tr>
<tr><td>Chroma</td><td>A light vector database in Python</td><td><code>pip install chromadb</code>, then <code>chroma run --path ./chroma</code> (port 8000)</td></tr>
<tr><td>Pinecone</td><td>A hosted service, nothing to run</td><td>Create an index whose dimension matches the vector model (below); give its address and API key</td></tr>
</tbody></table>
<p><strong>pgvector on Windows (Laragon)</strong>: see <em>Development machines</em> for the download and the three files to copy, then in HeidiSQL or psql: <code>CREATE EXTENSION IF NOT EXISTS vector;</code></p>
<p><strong>pgvector on Linux</strong> (Debian or Ubuntu with the PostgreSQL apt repository):</p>
<pre>sudo apt install postgresql-16-pgvector      # match your PostgreSQL version
sudo -u postgres psql -d sutraflow -c "CREATE EXTENSION IF NOT EXISTS vector;"</pre>
<p>Then add a <strong>Database connection</strong> to that PostgreSQL in Resources. SutraFlow makes the table and its index itself on the first add.</p>
<p><strong>Vector sizes</strong>: each model makes vectors of a fixed length, and a store keeps one length. <code>nomic-embed-text</code> 768, <code>mxbai-embed-large</code> 1024, OpenAI <code>text-embedding-3-small</code> 1536, built-in 512. After changing the vector model run [[knowledgeRemove]] with <em>rebuild vectors</em> (or start a new collection).</p>
<p class="h">Step 3: the knowledge base</p>
<p>Under Resources add a <strong>Knowledge base</strong>:</p>
<table class="t"><thead><tr><th>Setting</th><th>Choose</th></tr></thead><tbody>
<tr><td>Vector store</td><td>From step 2; with pgvector also the database connection and a table name</td></tr>
<tr><td>Vectors from</td><td><em>AI provider</em> with model <code>nomic-embed-text</code> for meaning; <em>built-in</em> to start offline</td></tr>
<tr><td>Passage size</td><td>200 to 400 tokens. Smaller finds precise facts; larger keeps more context. Policies and manuals: 250; long reports: 400</td></tr>
<tr><td>Overlap</td><td>About 15% of the passage size (40 for 250)</td></tr>
</tbody></table>
<p><em>Test connection</em> makes a vector, reaches the store and tells how many passages and sources it holds.</p>
<p class="h">Step 4: the documents folder</p>
<p>Add a project variable <code>DOCS_FOLDER</code> with the folder to read, for example <code>D:/Shared/Policies</code> or <code>/srv/docs</code>. The value <code>\${files}/documents</code> means the project's own files folder (<code>&lt;data&gt;/files/&lt;project&gt;/documents</code>): release zips carry files there, so the same project works on every server. Production overrides the value in its deployment config.</p>
<p class="h">Step 5: the feed, one document</p>
<p>Make a Sutra <em>Add one document to knowledge</em> that handles one file; the folder feed calls it for each. With the file as its trigger, every step can say <code>{{trigger.relativePath}}</code>.</p>
<ol>
<li>[[start]] with test data of one file: <code>{"name": "returns-policy.pdf", "relativePath": "returns-policy.pdf", "extension": "pdf"}</code>.</li>
<li>[[if]] <em>Document type</em>: <code>=lower-case({trigger.extension})</code> matches regex <code>^(pdf|docx|pptx|xlsx|odt|html|txt|md|csv)$</code>. False: log and [[return]].</li>
<li>[[fileRead]] folder <code>{{gv.DOCS_FOLDER}}</code>, path <code>{{trigger.relativePath}}</code>, read as <em>base64 (binary)</em>.</li>
<li>[[docText]] content <code>{{input.content}}</code>, content is base64, file name <code>{{trigger.name}}</code>, type auto.</li>
<li>[[knowledgeAdd]] knowledge base from step 3, source <code>{{trigger.relativePath}}</code>, text <code>{{input.text}}</code>, details <code>type = {{trigger.extension}}</code> and <code>title = {{input.title}}</code>, <strong>Same text as before: skip</strong> (unchanged files make no new vectors).</li>
<li>[[return]] the result. Connect the error outputs of the read, text and add steps to a warning [[log]] and a Return, so one bad file never stops the feed.</li>
</ol>
<p class="h">Step 6: the feed, the whole folder on a timer</p>
<ol>
<li>[[timer]] cron <code>0 */15 * * * *</code> (every 15 minutes; nightly <code>0 0 2 * * *</code> for large folders).</li>
<li>[[fileList]] location <code>{{gv.DOCS_FOLDER}}</code>, pattern <code>*</code>, include sub-folders, read content: <em>do not read</em>. Connect <em>empty</em> to a warning log.</li>
<li>[[forEach]] list <code>{{input.files}}</code>.</li>
<li><em>item</em> &rarr; [[callProcess]] <em>Add one document to knowledge</em>, input <code>{{input}}</code>, wait.</li>
<li><em>done</em> &rarr; [[knowledgeRemove]] action <strong>keep only these sources</strong>, sources <code>{{input.items}}</code>: files deleted from the folder leave the knowledge base.</li>
<li>A [[log]] with the counts.</li>
</ol>
<p>Press <strong>Test</strong> once: the knowledge base fills (watch the run's steps). Test again: every file is skipped as unchanged. Deploy both Sutras to keep it current. For changes within seconds rather than minutes, start the one-document Sutra from a [[fileTrigger]] on the folder instead (added and changed files &rarr; add; removed &rarr; [[knowledgeRemove]]).</p>
<p class="h">Step 7: check what it finds</p>
<p>Make a small Sutra with [[start]] <code>{"question": "How many days do I have to return an item?"}</code> and [[knowledgeSearch]]. The output lists passages with source and score (0 to 1). Good passages for a clear question score 0.3 and more. If answers miss: ask with the words your documents use, lower the passage size, raise <em>Passages</em>, or switch to model vectors. Filter by details (<em>Only with details</em>, for example <code>type = pdf</code> or <code>department = HR</code>) to search part of the knowledge.</p>
<p class="h">Step 8: answers as a REST API</p>
<ol>
<li>[[restService]] POST <code>/docs/ask</code>, body <code>{"question": "..."}</code>.</li>
<li>[[knowledgeAsk]] provider from step 1, question <code>{{input.body.question}}</code>, passages 4, instructions <em>Answer in two or three sentences, only from the passages. Name the document you used.</em></li>
<li>[[httpResponse]] 200 <code>{"answer": {{input.answer | json}}, "sources": {{input.sources | json}}}</code>; on <em>not found</em> a 404 that says the documents do not tell; on error a 502.</li>
</ol>
<pre>curl -X POST http://127.0.0.1:8080/docs/ask -H "content-type: application/json" -d "{\"question\": \"Is shipping free?\"}"</pre>
<p class="h">Step 9: the documents as an MCP tool for Claude and other assistants</p>
<ol>
<li>[[mcpTool]] tool name <code>search_documents</code>, a description that says what the documents cover, input <code>question</code>.</li>
<li>[[knowledgeSearch]] question <code>{{input.arguments.question}}</code>, 5 passages.</li>
<li>[[mcpReply]] with <code>{{input.hits}}</code>; on <em>empty</em>, a reply that nothing matches.</li>
</ol>
<p>Deploy it and connect an assistant. This tool needs no model on SutraFlow: the assistant reads the passages and writes the answer. Claude Code:</p>
<pre>claude mcp add --transport http shop-docs http://127.0.0.1:8080/mcp</pre>
<p>Claude Desktop (<code>claude_desktop_config.json</code>), through the <code>mcp-remote</code> bridge:</p>
<pre>{ "mcpServers": { "shop-docs": { "command": "npx", "args": ["-y", "mcp-remote", "http://127.0.0.1:8080/mcp"] } } }</pre>
<p>Outside your own machine use the HTTPS gateway and an MCP server resource with an API security policy, and give the key as a header.</p>
<p class="h">Step 10: a chat agent over the documents</p>
<ol>
<li>[[agentChannel]] agent name <code>docs-assistant</code>, chat, OpenAI-compatible and MCP ticked.</li>
<li>[[aiAgent]] with the knowledge base set, <em>Passages fetched before the first step</em> 3, an AI memory store, session <code>{{trigger.sessionId}}</code>, tools <em>none</em> (or your AI tools), instructions to search first and name the documents.</li>
<li>[[agentReply]] on <em>done</em>; a polite reply on <em>limit reached</em> and <em>needs a person</em>. Put [[aiGuard]] first when the chat is public.</li>
</ol>
<p>Deploy and open <code>/chat/docs-assistant</code> on the gateway, or add <code>&lt;script src="http://127.0.0.1:8080/chat/docs-assistant/widget.js"&gt;&lt;/script&gt;</code> to any web page.</p>
<p class="h">Other sources for the feed</p>
<table class="t"><thead><tr><th>Source</th><th>Feed</th></tr></thead><tbody>
<tr><td>Google Drive or Google Docs</td><td>[[googleDriveTrigger]] on a folder (added, modified, removed) &rarr; [[googleDrive]] <em>export</em> as text/plain for Google Docs, or <em>download</em> for PDF and Office files &rarr; [[docText]] &rarr; [[knowledgeAdd]] with source = the file id or name; removed &rarr; [[knowledgeRemove]]. Needs a Google OAuth connection.</td></tr>
<tr><td>SharePoint or OneDrive</td><td>[[msFilesTrigger]] on a library folder &rarr; [[msFiles]] <em>read</em> as document text &rarr; [[knowledgeAdd]]; removed &rarr; [[knowledgeRemove]]. Sample: <em>Knowledge feed from SharePoint</em>. Needs a Microsoft OAuth connection.</td></tr>
<tr><td>SFTP or FTP server</td><td>[[remoteTrigger]] or a timer with the SFTP / FTP steps (list, read as base64) &rarr; [[docText]] &rarr; [[knowledgeAdd]].</td></tr>
<tr><td>Web pages</td><td>[[docText]] from a web address (HTML or PDF) &rarr; [[knowledgeAdd]] with the address as source. Sample: <em>Knowledge feed from web pages</em>.</td></tr>
<tr><td>Database rows</td><td>[[timer]] &rarr; [[dbQuery]] (for example products changed today) &rarr; [[forEach]] &rarr; [[knowledgeAdd]] with text built from the columns and source = the row key.</td></tr>
<tr><td>Email attachments</td><td>An email trigger &rarr; [[forEach]] attachment &rarr; [[docText]] &rarr; [[knowledgeAdd]].</td></tr>
</tbody></table>
<p class="h">Who may see what</p>
<p>Store details with each source (<code>department = HR</code>, <code>groups = finance,managers</code>) and pass the caller's group in <em>Only with details</em> when searching or asking. Keep documents that some people must never see in a separate knowledge base.</p>
<p class="h">To production</p>
<p>Build a release zip of the project (Releases). Put the documents in the project's files folder or set <code>DOCS_FOLDER</code> to the production share in the deployment config; set the AI provider's address and model, and the knowledge base's store, for production too (pgvector or Qdrant shared by every engine). Deploy the feed, its called Sutra, and the API, tool or agent.</p>
[[tip:Good practice|Feed and answer in separate Sutras; the feed can fail or run long without touching answers.<br>Skip unchanged files; making vectors is the slow, costly part.<br>Answer only from passages and show sources; say when the documents do not tell.<br>Re-feed after changing passage size, and rebuild vectors after changing the vector model.]]`,
  },
  {
    id: 'ai-samples', title: 'AI samples and sample projects',
    html: `
<p>Every AI sample is in <strong>New Sutra &rarr; Samples &rarr; AI agents</strong> (and the AI folder), with the connections it needs as <em>Sample ...</em> resources to fill in. Every step of the newer samples has a description: open <strong>Documentation</strong> on a Sutra's General tab for the whole design on one page.</p>
<table class="t"><thead><tr><th>Sample</th><th>Shows</th><th>Needs</th></tr></thead><tbody>
<tr><td>AI tool order status, AI tool stock check</td><td>Two AI tool Sutras: describe a tool, look the answer up (JSONata over sample data), Reply to AI. Test runs them with their test arguments.</td><td>Nothing; an assistant or agent to call them</td></tr>
<tr><td>Order desk agent</td><td>A full agent: chat, OpenAI-compatible, MCP and A2A entry points; AI guard; refunds routed to a person by an If, never by the model; memory; Ask a person.</td><td>Ollama with a model; the two tools deployed</td></tr>
<tr><td>Knowledge feed from web pages</td><td>For each address: Read document text from the web, Add to knowledge.</td><td>Internet access</td></tr>
<tr><td>Knowledge feed from SharePoint</td><td>A SharePoint library kept in step with a knowledge base: added, modified, removed.</td><td>A Microsoft OAuth connection</td></tr>
<tr><td>Policy assistant</td><td>Ask knowledge behind a chat channel; a reply when the documents do not say.</td><td>Ollama; a fed knowledge base</td></tr>
<tr><td>Agent fed by a queue</td><td>Questions from RabbitMQ or ActiveMQ, one session at a time, answers to a reply queue, confirmed after sending.</td><td>A queue connection; Ollama</td></tr>
<tr><td>Supervisor agent</td><td>AI classify chooses the specialist; Hand off to agent passes the question with the session.</td><td>The order desk and policy samples</td></tr>
<tr><td>Agent with outside MCP tools</td><td>An MCP client (the file system server by npx), Call MCP tool, and an agent limited to read-only tools.</td><td>Node.js npx; Ollama</td></tr>
<tr><td><strong>Document feed from a folder</strong> and <strong>Add one document to knowledge</strong></td><td>RAG over a folder every 15 minutes: PDF, Word, PowerPoint, Markdown; unchanged files skipped; deleted files removed. The documents come with the sample.</td><td>Nothing (built-in vectors)</td></tr>
<tr><td><strong>Document questions API</strong></td><td>POST <code>/samples/docs/ask</code>: Ask knowledge, answer with sources, 404 when not found.</td><td>Ollama with a model</td></tr>
<tr><td><strong>AI tool search documents</strong></td><td>The documents as the MCP tool <code>search_documents</code> for Claude and other assistants.</td><td>Nothing on SutraFlow</td></tr>
<tr><td><strong>Document assistant</strong></td><td>A chat agent with the knowledge base, passages fetched first, memory.</td><td>Ollama with a model</td></tr>
</tbody></table>
<p class="h">Sample projects</p>
<p>A <strong>sample project</strong> is a whole project as a release zip: its Sutras, connections, project variables, documentation and files. Import one with <strong>New project &rarr; Package file &rarr; Or a sample project</strong>, or deploy it to any server with <code>sutra deploy</code>. The zips are in the <code>samples</code> folder of SutraFlow (<code>npm run samples</code> makes them again).</p>
<p><strong>AI document assistant</strong> (<code>samples/ai-document-assistant.zip</code>): the five document Sutras above, the connections Local Ollama, Sample document knowledge base and Sample AI memory, the project variable <code>DOCS_FOLDER = \${files}/documents</code>, and four documents of a tea shop (a PDF policy, a Word shipping guide, a PowerPoint catalogue, a Markdown FAQ) that go to the project's files folder. After importing:</p>
<ol>
<li>Open <em>Local Ollama</em> and choose a model (for example <code>phi4-mini</code>).</li>
<li>Open <em>Sample: Document feed from a folder</em> and press Test: the knowledge base fills.</li>
<li>Test <em>Sample: AI tool search documents</em> and <em>Sample: Document questions API</em>; then deploy the feed, its called Sutra and the ones you want to publish.</li>
<li>Put your own documents in the folder (or point <code>DOCS_FOLDER</code> at yours); the next feed reads them.</li>
</ol>`,
  },
  {
    id: 'data-platforms', title: 'Azure Data Factory and Databricks',
    html: `
<p>The <strong>Azure Data Factory &amp; Databricks</strong> palette runs and watches data work on those platforms from a Sutra: start a pipeline, notebook or job when something happens (a file arrived, an order batch closed, a person approved), wait for it, and act on the outcome.</p>
<p class="h">Connections and sign-in</p>
<table class="t"><thead><tr><th>Sign in with</th><th>When</th><th>Set up</th></tr></thead><tbody>
<tr><td>Service principal (client secret)</td><td>Servers anywhere: the usual choice for production</td><td>Entra ID &gt; App registrations &gt; New; a client secret; give the app the <em>Data Factory Contributor</em> role on the factory (Access control), or add it to the Databricks workspace as a service principal. Put the secret in the vault and name it on the connection.</td></tr>
<tr><td>Managed identity</td><td>SutraFlow running on an Azure VM, App Service or container</td><td>Turn the identity on for that resource and give it the same role. No secret at all.</td></tr>
<tr><td>Azure CLI (az login)</td><td>Development machines</td><td>Run <code>az login</code> as the account SutraFlow runs under.</td></tr>
<tr><td>Personal access token (Databricks)</td><td>Trying things out</td><td>User Settings &gt; Developer &gt; Access tokens; keep it as a secret.</td></tr>
<tr><td>Databricks OAuth (service principal)</td><td>Databricks on AWS or Google Cloud, or without Entra ID</td><td>A service principal in the account console with an OAuth secret.</td></tr>
</tbody></table>
<p><strong>Test connection</strong> signs in and reads the factory and its pipelines, or the workspace user, the default cluster and the default SQL warehouse, so a wrong secret, role or address shows before any run. Azure China and US Government clouds are a setting.</p>
<p class="h">Steps</p>
<ul>
<li>[[adfRun]] runs a pipeline with parameters and waits: <em>out</em> on success, <em>failed</em> with the failing activities. It can rerun an earlier run from the failed activity.</li>
<li>[[adfMonitor]] gets, waits for or cancels a run, lists activity runs, recent runs and pipelines, and starts or stops factory triggers.</li>
<li>[[adfRunTrigger]] starts a Sutra when any pipeline run ends: alerts, approvals before a rerun, follow-on work.</li>
<li>[[databricksRun]] runs a job or a notebook (cluster, serverless or a new job cluster) and returns the notebook's exit value.</li>
<li>[[databricksCommand]] runs one Python, SQL, Scala or R block on a cluster, starting it when stopped.</li>
<li>[[databricksSql]] runs SQL on a SQL warehouse with named parameters.</li>
</ul>
<p>Long work is polled with the step's own wait limit; when the limit runs out the run is cancelled (if ticked) and the step says where to look. The designer and Deploy warn when a connection, pipeline name, notebook path or SQL is missing.</p>
<p class="h">Templates</p>
<p>New Sutra &rarr; Samples &rarr; <em>Azure Data Factory: run, monitor, rerun</em> and <em>Databricks: notebooks, SQL and code blocks</em> add four Sutras in Samples/Azure and Databricks, with placeholder connections to fill in.</p>
[[tip:Good practice|Give each environment its own service principal with only the roles it needs; production uses a managed identity where it can.<br>Keep pipeline and notebook logic in the platform; let the Sutra decide when to run and what to do with the outcome.<br>Connect the failed output: a quiet failure is the costly one.]]`,
  },
  {
    id: 'python', title: 'Python scripts',
    html: `
<p>[[python]] runs Python 3 on the SutraFlow server: code written in the step, or a .py file. It is in the Scripts palette, so an administrator first opens <strong>Admin Console → Server → Runtime</strong> and allows scripts in the <strong>Scripts</strong> card. The same card shows which Python is used and lets you choose another (<code>sutra python</code> does the same from a shell).</p>
<p class="h">Install Python</p>
<ul>
<li><strong>Windows</strong>: python.org, and tick <em>Add python.exe to PATH</em>; SutraFlow also finds the <code>py</code> launcher.</li>
<li><strong>Linux</strong>: <code>sudo apt install python3 python3-venv</code> (Debian, Ubuntu) or <code>sudo dnf install python3</code>.</li>
<li><strong>Containers</strong>: add Python to the image, or set <code>SUTRA_PYTHON</code> to its path.</li>
<li>Packages: one virtual environment per project is tidy: <code>python -m venv D:/venvs/sales</code>, then <code>D:/venvs/sales/Scripts/python -m pip install pandas</code>, and give that folder as the step's <em>Virtual environment folder</em>.</li>
</ul>
<p class="h">What a script gets and gives</p>
<pre>import json, os, sys
params = json.load(open(os.environ["SUTRA_PARAMS_FILE"]))     # the step's Parameters
previous = json.load(open(os.environ["SUTRA_INPUT_FILE"]))    # the previous step's output
args = sys.argv[1:]                                           # the step's Arguments
print(json.dumps({"total": 42}))                              # the last line, as JSON, becomes result</pre>
<p>Parameters are also environment variables of the same names. Text is UTF-8 both ways. A non-zero exit code or an uncaught exception fails the step with the last lines of the traceback; untick <em>Fail when the exit code is not 0</em> to branch on <code>exitCode</code> yourself.</p>
<p class="h">Fewer surprises in production</p>
<p>Before anything runs, the designer and Deploy warn when Python is missing on this server, the code has a syntax error (with the line), the script file or virtual environment is missing, or a package in <em>Packages it imports</em> is not installed (with the pip command). Deploying to a server checks that server.</p>
<p class="h">Templates</p>
<p><em>Python scripts</em> in New Sutra &rarr; Samples adds an inline script with parameters and a script file (<code>sales_report.py</code>, in the project's files folder, found through the project variable <code>SCRIPTS_FOLDER</code>).</p>`,
  },
  {
    id: 'social', title: 'YouTube, Twitch and social media',
    html: `
<p>The Apps and social palette works with YouTube ([[youtube]]), Twitch ([[twitch]], [[twitchLiveTrigger]]), Discord ([[discord]], [[discordTrigger]]), Telegram ([[telegram]], [[telegramTrigger]]), Facebook Pages ([[facebookPage]]), Google Drive and Sheets, Dropbox, and any other service with OAuth through [[oauthRequest]].</p>
<p class="h">Accounts: OAuth, not passwords</p>
<p>These services do not accept a user name and password from other programs; an account is connected once with OAuth, and SutraFlow keeps its tokens encrypted and refreshes them. For each service:</p>
<ol>
<li>Register an app with the service: Google Cloud console (APIs: YouTube Data API v3, YouTube Analytics API, Drive, Sheets; an OAuth client of type Web application), or dev.twitch.tv &gt; Your Console &gt; Applications.</li>
<li>Give the app the redirect address shown on the connection (<code>http(s)://your-server:port/api/oauth/callback</code>).</li>
<li>Add an <strong>OAuth connection</strong>: the service, the client id, the client secret (as a vault secret), and the scopes.</li>
<li>Sign in: <strong>Connect account</strong> in the studio. <strong>Test connection</strong> then names the account, YouTube channel or Twitch user.</li>
</ol>
<p class="h">Discord and Telegram</p>
<p>These use keys, not OAuth. <strong>Discord</strong>: a webhook address (Channel settings &gt; Integrations &gt; Webhooks) posts to one channel with nothing to install; a bot (discord.com/developers &gt; Applications &gt; Bot) sends to any channel it is invited to and, with Message Content Intent on, lets [[discordTrigger]] answer commands such as <code>!status A-1001</code>. <strong>Telegram</strong>: @BotFather's <code>/newbot</code> gives a token; [[telegramTrigger]] receives messages by long polling, so the server needs no public address. Keep the webhook address and bot tokens as secrets: on production, set them in that server's vault.</p>
<p class="h">Videos from Google Drive to YouTube</p>
<p>YouTube uploads a file on the server. For videos kept in Google Drive, put [[googleDrive]] first with <em>download</em> and <em>Save to: server file</em> (streamed, so large videos are fine), then [[youtube]] <em>upload video</em> with <code>{{input.path}}</code>. The sample <em>Publish Drive videos to YouTube</em> does it for every new video in a Drive folder and removes the server copy afterwards. Upload as private, check, then publish with <em>update video</em> or <em>Publish at</em>.</p>
<p class="h">Templates</p>
<p><em>YouTube: publish from Google Drive, weekly analytics</em>, <em>Twitch: going live</em>, <em>Discord: order status bot</em> and <em>Telegram: order status bot and alerts</em> in New Sutra &rarr; Samples (folder Samples/Social media).</p>`,
  },
  {
    id: 'oauth-setup', title: 'OAuth connections step by step: Google, Microsoft, Dropbox, Facebook, Twitch',
    html: `
<p class="h">How OAuth works in SutraFlow</p>
<p>OAuth lets SutraFlow act for an account without ever knowing its password. The account owner signs in at the provider (Google, Microsoft and the others) and agrees to what SutraFlow may do (the <em>scopes</em>); the provider then gives SutraFlow two tokens:</p>
<ul>
<li>an <strong>access token</strong>: the key a step shows with every call; it works for about an hour;</li>
<li>a <strong>refresh token</strong>: used by SutraFlow to get a new access token when the old one runs out, without asking the person again. It lasts until the access is withdrawn (or, for some providers and settings, a set time: see the notes below).</li>
</ul>
<ol>
<li>You press <em>Connect account</em>. SutraFlow opens the provider's sign-in page with your client ID, the scopes and its redirect address, plus a signed code (<em>state</em>) that expires in 10 minutes.</li>
<li>The account owner signs in and allows the access. The provider sends the browser back to SutraFlow's redirect address with a one-time code.</li>
<li>SutraFlow checks the state, then exchanges the code for the tokens with your client secret, read from the vault at that moment.</li>
<li>The tokens are stored <strong>encrypted</strong> in SutraFlow's database. Every engine of a cluster reads them there, so one sign-in serves them all; another server (test, production) signs in on its own.</li>
<li>Each step that calls the service uses the access token. Shortly before it expires SutraFlow refreshes it by itself; you see nothing of this.</li>
</ol>
<p>So the <em>client ID and secret</em> identify SutraFlow (your app at the provider), the <em>sign-in</em> picks the account, and the <em>scopes</em> say what may be done with it. Disconnect (or withdraw the access at the provider) and the tokens stop working.</p>
<table class="t"><thead><tr><th>OAuth also appears in SutraFlow as</th><th>What it is for</th></tr></thead><tbody>
<tr><td>Outbound security profile <em>OAuth client credentials</em></td><td>Calling an API as a machine (no person signs in): a client ID and secret get a token directly. See <a href="#ch-call">Calling services</a>.</td></tr>
<tr><td>Gateway apps</td><td>The other way round: SutraFlow gives tokens (<code>POST /oauth/token</code>) to the apps that call your services. See <a href="#ch-gateway">The API gateway</a>.</td></tr>
<tr><td>JWT and token introspection in API security policies</td><td>Checking tokens your identity provider gave to callers of your services. See <a href="#ch-expose">Exposing APIs</a>.</td></tr>
<tr><td>Single sign-on</td><td>People signing in to the designer, the Admin Console and the Approval Center with your identity provider (OpenID Connect, built on OAuth). See <a href="#ch-secrets">Secrets and studio security</a>.</td></tr>
</tbody></table>
<p class="h">Setting up a connection</p>
<p>Google Drive, Sheets, Docs and YouTube, SharePoint and OneDrive, Dropbox, Facebook Pages and Twitch are all set up the same way, in three places:</p>
<ol>
<li><strong>At the provider</strong> (once): register an app. It gives a <em>client ID</em> and a <em>client secret</em>, and you tell it SutraFlow's <em>redirect address</em>.</li>
<li><strong>In the designer</strong>: an <em>OAuth connection</em> holds the client ID, the secret's name and the scopes; <em>Connect account</em> signs in once, and the tokens are kept encrypted.</li>
<li><strong>On each server you deploy to</strong> (Admin Console, command line): the secret is put in that server's vault and the account signed in there, because tokens never travel with a release.</li>
</ol>
[[note:The redirect address|It is where the provider sends the browser back after sign-in: your studio's address followed by <code>/api/oauth/callback</code>, for example <code>http://127.0.0.1:4800/api/oauth/callback</code> on your own computer or <code>https://sutra.example.com/api/oauth/callback</code> behind a proxy. The OAuth connection shows the exact address under <em>Account</em>; copy it from there. Providers want <code>https://</code> for anything but 127.0.0.1 and localhost.]]

<p class="h">In the designer: the part that is the same for every provider</p>
<ol>
<li><strong>Keep the client secret in the vault.</strong> Project explorer &rarr; Resources &rarr; <strong>+</strong> &rarr; Secret, for example <code>GOOGLE_CLIENT_SECRET</code>. Paste the value; it is encrypted, and nobody can read it back.</li>
<li><strong>Create the connection.</strong> Resources &rarr; <strong>+</strong> &rarr; <em>OAuth connection</em>. Choose the <em>Service</em> (google, microsoft, dropbox, facebook, twitch, or custom), paste the <em>Client ID</em>, pick the secret under <em>Client secret</em>, and set the <em>Scopes</em> (the provider sections below say which). Save.</li>
<li><strong>Register the redirect address.</strong> The connection now shows <em>Register this redirect URI</em> with the address to copy into the provider's app (each provider section says where).</li>
<li><strong>Sign in.</strong> Click <em>Connect account</em>. A window opens at the provider: sign in with the account the Sutras should use and allow the access asked for. The window closes and the connection says <em>Connected</em>, and <em>Tokens refresh automatically</em> when the provider gave a refresh token.</li>
<li><strong>Check.</strong> <em>Test connection</em> reads the account (the Drive user, the YouTube channel, the Microsoft user, the Dropbox account).</li>
<li><strong>Use it.</strong> Pick the connection in [[googleDrive]], [[googleSheets]], [[youtube]], [[msFiles]], [[dropbox]], [[facebookPage]], [[twitch]] or [[oauthRequest]] (Connected API call), and in their triggers.</li>
</ol>
[[tip:One app per environment|Make one app (one client ID) for development and another for production, ideally in separate projects or registrations, each with its own redirect address. A test account in development and a service account or shared mailbox in production keep people's own files out of your Sutras.]]

<p class="h">Google: Drive, Sheets, Docs, YouTube</p>
<ol>
<li>Open <a href="https://console.cloud.google.com" target="_blank" rel="noopener">console.cloud.google.com</a> and sign in. Top left, next to the Google Cloud logo, choose a project or <em>New project</em> (for example <em>SutraFlow production</em>).</li>
<li><strong>Turn on the APIs</strong>: menu &rarr; <em>APIs &amp; Services</em> &rarr; <em>Library</em>. Search and <em>Enable</em> each one the Sutras use: <em>Google Drive API</em>, <em>Google Sheets API</em>, <em>Google Docs API</em>, <em>YouTube Data API v3</em>, <em>YouTube Analytics API</em>.</li>
<li><strong>The consent screen</strong>: <em>APIs &amp; Services</em> &rarr; <em>OAuth consent screen</em> (newer consoles: <em>Google Auth Platform</em>). Choose the user type: <strong>Internal</strong> if you have Google Workspace and only your organisation's accounts sign in (no review, tokens do not expire); otherwise <strong>External</strong>. Fill in the app name and support email.</li>
<li>With <em>External</em>, add the accounts that will sign in under <em>Audience</em> &rarr; <em>Test users</em> while the app is in <em>Testing</em>.</li>
<li><strong>Create the client</strong>: <em>APIs &amp; Services</em> &rarr; <em>Credentials</em> &rarr; <em>Create credentials</em> &rarr; <em>OAuth client ID</em>. Application type: <strong>Web application</strong>. Name it. Under <strong>Authorized redirect URIs</strong> (not <em>Authorized JavaScript origins</em>, which takes no path) click <em>Add URI</em> and paste the connection's redirect address. <em>Create</em>.</li>
<li>Copy the <strong>Client ID</strong> and the <strong>Client secret</strong> (or <em>Download JSON</em>). The secret goes into the vault; the ID into the connection.</li>
<li>Scopes in the connection, space separated, only what the Sutras need:
<table class="t"><thead><tr><th>Scope</th><th>Gives</th></tr></thead><tbody>
<tr><td><code>https://www.googleapis.com/auth/drive</code></td><td>Every file and folder the account can open (Drive steps and trigger)</td></tr>
<tr><td><code>https://www.googleapis.com/auth/drive.readonly</code></td><td>Reading only</td></tr>
<tr><td><code>https://www.googleapis.com/auth/drive.file</code></td><td>Only files SutraFlow made or uploaded; not folders and files made in Drive by people</td></tr>
<tr><td><code>https://www.googleapis.com/auth/spreadsheets</code></td><td>Google Sheets</td></tr>
<tr><td><code>https://www.googleapis.com/auth/documents</code></td><td>Google Docs</td></tr>
<tr><td><code>https://www.googleapis.com/auth/youtube.upload</code>, <code>.../youtube.readonly</code>, <code>.../yt-analytics.readonly</code></td><td>YouTube upload, reading, analytics</td></tr>
</tbody></table></li>
<li>Back in the designer: <em>Connect account</em>, sign in, <em>Test connection</em>.</li>
</ol>
[[note:Testing apps lose their sign-in after 7 days|While an External app's publishing status is Testing, Google ends its refresh tokens after seven days, and the connection must sign in again. For anything that runs unattended, use an Internal app, or press Publish app on the consent screen. Apps that ask for the full drive scope and are used by more than 100 people outside your organisation need Google's verification; for your own accounts the warning page at sign-in (Advanced, Go to the app) is enough.]]
<p><strong>Folder and file IDs.</strong> Open the folder in <a href="https://drive.google.com" target="_blank" rel="noopener">drive.google.com</a>: the address ends with its ID, <code>https://drive.google.com/drive/folders/<strong>1bWYnLxM6Ea_YecThA1FUQyQXN1cWMWTq</strong></code>. A file: <code>https://drive.google.com/file/d/<strong>FILE_ID</strong>/view</code>; a Doc or Sheet: <code>https://docs.google.com/document/d/<strong>ID</strong>/edit</code> or <code>/spreadsheets/d/<strong>ID</strong>/edit</code>. Folders on a shared drive work the same way; <code>root</code> is the top of My Drive. [[googleDrive]] with <em>List</em> shows the ID of every file in a folder. Keep folder IDs in project variables (<code>{{gv.DRIVE_INBOX}}</code>) so each environment can have its own.</p>
<p><strong>Big files and slow links.</strong> Download with <em>Save to: server file</em> and upload with <em>Upload from: server file</em>: both stream, whatever the size. <em>Wait for each call</em> (5 minutes by default) and the step's time limit (30 minutes) can be raised for slow connections.</p>

<p class="h">Microsoft: SharePoint and OneDrive</p>
<ol>
<li>Open <a href="https://portal.azure.com" target="_blank" rel="noopener">portal.azure.com</a> &rarr; <em>Microsoft Entra ID</em> &rarr; <em>App registrations</em> &rarr; <em>New registration</em>.</li>
<li>Name it. <em>Supported account types</em>: <strong>this organizational directory only</strong> for your company's SharePoint and OneDrive (most cases); <em>any organizational directory and personal Microsoft accounts</em> for personal OneDrive too.</li>
<li><em>Redirect URI</em>: platform <strong>Web</strong>, the connection's redirect address. <em>Register</em>.</li>
<li>On the app's <em>Overview</em>, copy the <strong>Application (client) ID</strong> and the <strong>Directory (tenant) ID</strong>.</li>
<li><em>Certificates &amp; secrets</em> &rarr; <em>New client secret</em>: a description and an expiry (at most 24 months; note the date, the connection stops working when it passes). Copy the <strong>Value</strong> (not the Secret ID); it is shown only once. Put it in the vault.</li>
<li><em>API permissions</em> &rarr; <em>Add a permission</em> &rarr; <em>Microsoft Graph</em> &rarr; <em>Delegated permissions</em>: <code>Files.Read.All</code>, <code>Sites.Read.All</code>, <code>offline_access</code>, <code>User.Read</code> (and <code>Files.ReadWrite.All</code> to write). Then <em>Grant admin consent</em> if your organisation requires it.</li>
<li>In the designer: Service <strong>microsoft</strong>, <strong>Tenant</strong> = the Directory (tenant) ID or your domain (<code>contoso.onmicrosoft.com</code>) for a single-organisation app, <code>common</code> otherwise; Client ID; the secret; Scopes <code>Files.Read.All Sites.Read.All offline_access User.Read</code>. <em>Connect account</em>.</li>
</ol>
<p><strong>Sites and folders.</strong> [[msFiles]] takes a SharePoint site address (<code>https://contoso.sharepoint.com/sites/Finance</code>), a document library (empty = the default one, <em>Documents</em>) and a folder path inside it (<code>Invoices/2026</code>); or, with <em>Where: OneDrive</em>, paths in the signed-in account's OneDrive. Paths, not IDs.</p>

<p class="h">Dropbox</p>
<ol>
<li>Open <a href="https://www.dropbox.com/developers/apps" target="_blank" rel="noopener">dropbox.com/developers/apps</a> &rarr; <em>Create app</em> &rarr; <em>Scoped access</em>; <em>App folder</em> (only a folder of its own, safest) or <em>Full Dropbox</em>; a name.</li>
<li><em>Permissions</em> tab: tick <code>files.metadata.read</code>, <code>files.content.read</code> and, to write, <code>files.content.write</code>; <em>Submit</em>.</li>
<li><em>Settings</em> tab: under <em>OAuth 2</em> &rarr; <em>Redirect URIs</em> add the connection's redirect address. Copy the <strong>App key</strong> (the client ID) and the <strong>App secret</strong>.</li>
<li>In the designer: Service <strong>dropbox</strong>, the App key as Client ID, the secret, Scopes <code>files.metadata.read files.content.read files.content.write</code>. <em>Connect account</em>.</li>
</ol>
<p>Dropbox works with paths (<code>/Invoices/2026</code>); with an App folder app, <code>/</code> is that app's folder.</p>

<p class="h">Facebook Pages</p>
<ol>
<li>Open <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener">developers.facebook.com/apps</a> &rarr; <em>Create app</em>; choose the business use case and connect your business portfolio.</li>
<li>Add <em>Facebook Login for Business</em>; under its <em>Settings</em>, <em>Valid OAuth Redirect URIs</em>: the connection's redirect address.</li>
<li><em>App settings</em> &rarr; <em>Basic</em>: copy the <strong>App ID</strong> and <strong>App secret</strong>.</li>
<li>Scopes: <code>pages_show_list pages_read_engagement pages_manage_posts</code>. In <em>Development</em> mode they work for people with a role on the app; others need App Review.</li>
<li>In the designer: Service <strong>facebook</strong>; <em>Connect account</em> with a Page administrator. Facebook gives no refresh token: the sign-in lasts about 60 days, then <em>Reconnect account</em>.</li>
</ol>
<p>The Page ID is on the Page under <em>About</em> &rarr; <em>Page transparency</em>, or in Meta Business Suite &rarr; <em>Settings</em> &rarr; <em>Business assets</em>. Use it in [[facebookPage]].</p>

<p class="h">Twitch</p>
<ol>
<li>Open <a href="https://dev.twitch.tv/console" target="_blank" rel="noopener">dev.twitch.tv/console</a> &rarr; <em>Register Your Application</em>: a name, <em>OAuth Redirect URLs</em> = the connection's redirect address, a category, client type <strong>Confidential</strong>.</li>
<li><em>Manage</em>: copy the <strong>Client ID</strong>; <em>New Secret</em> and put it in the vault.</li>
<li>In the designer: Service <strong>twitch</strong>, scopes such as <code>user:read:email channel:manage:broadcast clips:edit</code>. <em>Connect account</em> with the channel's account.</li>
</ol>

<p class="h">Other services (custom)</p>
<p>Service <strong>custom</strong> works with any provider that offers the OAuth 2.0 authorization code flow: give its <em>Authorization URL</em>, <em>Token URL</em> and <em>API base URL</em> from its documentation, register the redirect address there, and use [[oauthRequest]] for its API. A provider that issues refresh tokens keeps the connection signed in; one that does not needs <em>Reconnect account</em> when the token ends.</p>

<p class="h">On production servers (Admin Console and deployment)</p>
<p>A release carries the connection (service, client ID, scopes) and the <em>name</em> of its secret, never the secret's value or the account's tokens. On each server:</p>
<ol>
<li><strong>Register the server's redirect address</strong> in the provider's app (<code>https://prod.example.com/api/oauth/callback</code>), or use a separate production app.</li>
<li><strong>Put the client secret in the server's vault</strong>, from your pipeline's secret store: <code>sutra secret set GOOGLE_CLIENT_SECRET --from-env GOOGLE_CLIENT_SECRET --server https://prod:4800 --token $TOKEN</code>. The release check (Admin Console &rarr; Releases) shows every secret a release needs and whether the server has it.</li>
<li><strong>A different client ID per environment</strong>: write <code>{{gv.GOOGLE_CLIENT_ID}}</code> in the connection's Client ID and set the variable in each environment's deployment config, or override the connection's setting there (<code>\${env:GOOGLE_CLIENT_ID}</code> reads it from the server's environment).</li>
<li><strong>Sign in on that server</strong>, one of three ways:
<ul>
<li><code>sutra connect "Google Drive" --project Media --server https://prod:4800 --token $TOKEN</code> prints the sign-in address; open it, sign in, and the command reports when the server is connected (headless engines too).</li>
<li>Or open the server's studio, if it has one, and use <em>Connect account</em> on the connection.</li>
<li>Or, when nobody may sign in on production, give the connection a <em>Refresh token (secret)</em>: a refresh token of the account, kept in the server's vault and set by the pipeline. For Google, get one with the OAuth Playground (<a href="https://developers.google.com/oauthplayground" target="_blank" rel="noopener">developers.google.com/oauthplayground</a>): gear &rarr; <em>Use your own OAuth credentials</em> (add <code>https://developers.google.com/oauthplayground</code> to the client's redirect URIs), choose the scopes, <em>Authorize APIs</em>, <em>Exchange authorization code for tokens</em>, copy the refresh token.</li>
</ul></li>
<li><strong>Check</strong>: <em>Test connection</em> on the server, then deploy or start the Sutras. Tokens are encrypted with that server's master key and refresh by themselves.</li>
</ol>

<p class="h">When it does not work</p>
<table class="t"><thead><tr><th>Message</th><th>Cause and remedy</th></tr></thead><tbody>
<tr><td><code>redirect_uri_mismatch</code></td><td>The provider's app does not list the exact address the connection shows (http or https, port, path). Add it under the redirect URIs (Google: not under JavaScript origins), wait a few minutes, connect again.</td></tr>
<tr><td><code>access_denied</code>, <em>app not verified</em>, <em>not a test user</em></td><td>The account is not a test user of a Google app in Testing, or a Facebook app in Development mode has no role for it. Add it, or publish the app.</td></tr>
<tr><td><code>invalid_grant</code>, <em>No refresh token</em></td><td>The sign-in ended: a Google app in Testing (7 days), a revoked access, a changed password, Facebook's 60 days. <em>Reconnect account</em>; publish the Google app or make it Internal.</td></tr>
<tr><td><code>AADSTS50194</code> (Microsoft)</td><td>A single-organisation app signs in at <em>common</em>: set the connection's Tenant to the Directory (tenant) ID.</td></tr>
<tr><td><code>AADSTS7000215</code> (Microsoft)</td><td>The secret is the Secret ID or expired: copy the secret's Value, or make a new one.</td></tr>
<tr><td>403 <em>insufficient permissions</em> or <em>scope</em></td><td>The scopes in the connection or the app's permissions do not cover the operation. Add them, then <em>Reconnect account</em> (new scopes need a new sign-in).</td></tr>
<tr><td>404 on a folder or file that exists</td><td>The account cannot see it (not shared with it), or the scope is Google's <code>drive.file</code>, which sees only files SutraFlow made.</td></tr>
<tr><td>Time-outs on big files</td><td>Stream to and from server files, raise <em>Wait for each call</em> and the step's time limit.</td></tr>
</tbody></table>`,
  },
  {
    id: 'prod-connections', title: 'Connections on production servers',
    html: `
<p>A project deployed to another server brings its connections, but never their passwords, keys or tokens. Each server signs in on its own, so test and production can use different accounts, and a package can go to production without anyone copying a secret.</p>
<table class="t"><thead><tr><th>Credential</th><th>How production gets it</th></tr></thead><tbody>
<tr><td>Passwords, keys, client secrets, access tokens</td><td>Fields of type secret hold only a <em>name</em>. The package lists the names (README, Releases check); put the values in the production vault with <code>sutra secret set NAME --from-env NAME</code> from the pipeline's secret store, or Resources &gt; Secrets. A missing secret stops the deploy before anything changes.</td></tr>
<tr><td>Other settings (hosts, factory, workspace, folders)</td><td>The deployment config of that environment; any value may read <code>\${env:NAME}</code>.</td></tr>
<tr><td>Azure identities</td><td>Best: a managed identity on the production server (no secret). Else a service principal per environment, its secret in that server's vault.</td></tr>
<tr><td>OAuth accounts (Google, YouTube, Twitch, Dropbox, Facebook, Microsoft)</td><td>One of: <strong>sutra connect</strong> (below); a <strong>refresh token secret</strong> on the connection; or Connect account in that server's studio. Tokens are encrypted with that server's master key and never leave it.</td></tr>
</tbody></table>
<p>Setting up each provider's app (client ID, secret, redirect address, scopes) and signing in, step by step: <a href="#ch-oauth-setup">OAuth connections step by step</a>.</p>
<p class="h">sutra connect</p>
<pre>sutra connect "Sample Google (Drive and YouTube)" --project Media --server https://prod-engine:4800 --token $TOKEN</pre>
<p>It prints the sign-in address for that server; open it in a browser, sign in to the account, and the command reports when the server has its tokens. The OAuth app must list that server's redirect address (shown by the command). Headless engines accept it too.</p>
<p class="h">A refresh token secret</p>
<p>When no person may sign in on production, give the OAuth connection a <em>Refresh token (secret)</em>: a refresh token of the account, kept as a secret on that server and set by the pipeline. The server signs in with it on first use. Get the refresh token once with the provider's tools (for Google, the OAuth Playground with your own client), store it in your secret manager, and rotate it like any other secret.</p>
[[tip:Good practice|Separate accounts per environment: a test YouTube channel, a test factory, a test workspace.<br>Least rights: only the scopes and roles the Sutras use.<br>Test connection after every deploy, from the Admin Console or the Releases check.]]`,
  },
  {
    id: 'secrets', title: 'Secrets and studio security',
    html: `
<p class="h">Single sign-on (OpenID Connect or SAML 2.0)</p>
<p>People can sign in to the designer, Admin Console and Approval Center with an OpenID Connect or SAML 2.0 identity provider (Microsoft Entra ID, Okta, Keycloak, Google, Auth0 and compatible providers). Password sign-in stays available, so an administrator can always get in.</p>
<ol>
<li>Open Admin Console &rarr; Users &rarr; Single sign-on and choose <em>OpenID Connect</em> or <em>SAML 2.0</em>. Register the callback address shown there, such as <code>https://sutra.example.com/api/auth/sso/callback</code>. Behind a proxy, set <code>SUTRA_PUBLIC_URL</code> so it is the public address people use.</li>
<li>For OpenID Connect, register a web application using the authorization-code flow, put its client secret in the vault, then enter the issuer, client id, secret name and claims. Ask the provider to include the person's groups in the ID token.</li>
<li>For SAML, register SutraFlow as a service provider using the HTTP-POST response binding. Enter the identity-provider Redirect SSO address, the service-provider entity id/audience, the IdP issuer and its signing certificate. Choose the assertion attributes for username and groups, or use <code>NameID</code> as the username.</li>
<li>Map groups to roles: <code>sutra-admins</code> to Administrator on all projects, <code>shop-team</code> to Operator on the Shop project. At every sign-in a person's roles become those of their groups.</li>
<li>Choose <em>Create accounts</em> (people get an account at their first sign-in) and, only when the provider controls usernames, <em>Link existing accounts</em>.</li>
<li>Turn on <em>Offer single sign-on</em>. The sign-in pages show <em>Sign in with</em> your provider.</li>
</ol>
<p>OpenID Connect uses the authorization-code flow with PKCE, state and nonce; the ID token's signature, issuer, audience and expiry are checked against the provider's published keys. SAML responses must carry a trusted signature and a single assertion bound to the one-time sign-in request, callback address, entity id, issuer and validity period. The one-time state is stored briefly in the shared database, and a signed short-lived cookie proves that the same browser or API client started the sign-in. A browserless client follows the same two requests: retain the <code>sutra_sso</code> cookie from <code>/api/auth/sso/start</code> and send it with the callback. A person is recognised by the provider subject or SAML NameID, so a renamed account stays the same person. Sign-ins with either protocol are in the audit log.</p>
<p class="h">The vault and sessions</p>
<ul>
<li>Passwords, keys and tokens live in the <strong>vault</strong> (Resources &rarr; Secrets), encrypted with AES-256-GCM. Settings hold the secret's <em>name</em>.</li>
<li>Secret values are never returned by the API. A secret used in a step is masked in stored outputs and logs.</li>
<li>The studio listens on 127.0.0.1 by default. Sessions are HttpOnly, SameSite=Strict cookies; every change needs a request header that browsers cannot forge across sites; repeated failed sign-ins are slowed down.</li>
</ul>`,
  },
  {
    id: 'releases', title: 'Releases: build, package and deploy',
    html: `
<p>A release moves a whole project, unchanged, from the studio to test and on to production. This chapter covers what a release is, building it, deploying it, and rolling back. The next chapter automates it in a CI/CD pipeline.</p>
<p class="h">The parts of a release</p>
<table class="t"><thead><tr><th>Part</th><th>What it is</th></tr></thead><tbody>
<tr><td><strong>Package</strong> (<code>.sutra</code>)</td><td>One file with the whole project: every Sutra at a fixed version (marked deployed or not), connections and API policies with secret <em>names</em> (never values), schemas and WSDLs, project variables, logging, and a sha256 checksum. A changed or damaged package is refused.</td></tr>
<tr><td><strong>Deployment config</strong> (<code>deployment-config.json</code>)</td><td>The values that differ per environment: project variables, connection settings (hosts, ports, folders, queues, users, which secret), logging. Values may read environment variables: <code>\${env:DB_HOST}</code>, <code>\${env:DB_HOST:-localhost}</code>. Each environment keeps its own.</td></tr>
<tr><td><strong>Secrets</strong></td><td>Passwords and keys stay in each server's vault and never travel. The package lists the names it needs.</td></tr>
<tr><td><strong>Files</strong></td><td>Documents, templates and other files the project needs, in the release zip's <code>files/</code>; they go to the project's files folder (<code>\${files}</code> in variables).</td></tr>
<tr><td><strong>Release zip</strong></td><td>All of it for a production team: <code>package.sutra</code>, <code>deployment-config.json</code> (filled with the package's own values, to change), <code>README.txt</code> (contents, secrets, where it was built from, commands), <code>documentation.html</code> and <code>.md</code>, and <code>files/</code>.</td></tr>
</tbody></table>
<p class="h">Versions</p>
<ul>
<li>Each Sutra has its own versions: v1, v2, ... made by Deploy or by a package. Runs in progress finish on the version they started with.</li>
<li>A package has a version you choose, like <code>1.4.0</code> (major.minor.patch, optionally <code>-rc.1</code>): raise the patch for fixes, the minor for new Sutras or features, the major for changes callers must adapt to (a REST path or body changed). In Git, tag the commit with the same version (<code>v1.4.0</code>).</li>
<li>The same package deployed twice changes nothing: Sutras whose content is unchanged keep their version.</li>
</ul>
<p class="h">Who deploys how</p>
<table class="t"><thead><tr><th>Environment</th><th>How Sutras get there</th></tr></thead><tbody>
<tr><td>Development (each designer)</td><td><strong>Deploy</strong> in the designer, Sutra by Sutra; Test and Debug without deploying</td></tr>
<tr><td>System test, integration</td><td>Designer Deploy, or packages from the pipeline</td></tr>
<tr><td>UAT, pre-production</td><td>Release zips from the pipeline: the exact files that will go to production</td></tr>
<tr><td>Production (<code>SUTRA_ENVIRONMENT=production</code>)</td><td>Release zips only: <code>sutra deploy</code> from the pipeline, or Admin Console &rarr; Releases. Designer Deploy is refused.</td></tr>
</tbody></table>
<p class="h">Build a release in the studio</p>
<ol>
<li>Write a description for every step: the release documentation is made from them (see <em>Documenting Sutras</em>).</li>
<li>Deploy and test the Sutras that belong in the release on your development server. The package takes each deployed Sutra at its deployed version; Sutras never deployed come along as not deployed.</li>
<li>Open <strong>Project &rarr; Configuration &rarr; Releases (packages)</strong>, give a version and a note (what changed), and choose <strong>Download release (.zip)</strong>, or <em>Package only (.sutra)</em>.</li>
<li>Open the zip: check <code>README.txt</code> (Sutras, addresses, secrets) and <code>documentation.html</code>, and fill in <code>deployment-config.json</code> for the target (or hand it to the team that owns that environment).</li>
</ol>
<p class="h">Build a release from the command line</p>
<pre># from a running studio or engine
sutra package --project "Orders" --version 1.4.0 --note "Faster lookup" --zip --server https://studio:4800 --token $TOKEN
# on the server itself, from its data folder
sutra package --project "Orders" --version 1.4.0 --out orders-1.4.0.zip
# from the project's Git repository, with no server at all (CI)
sutra package --from-git https://github.com/acme/orders.git --ref v1.4.0 --version 1.4.0 --out orders-1.4.0.zip</pre>
<p><code>--sutras "A,B"</code> takes only those Sutras with the connections and schemas they use. From Git every Sutra in the repository is deployed by the release; the package records the repository (without credentials), the ref and the commit.</p>
<p class="h">Prepare the target</p>
<ol>
<li><strong>Secrets</strong>: add every name the README lists to the target's vault, from a secret store or the pipeline: <code>sutra secret set ORDERS_DB --from-env ORDERS_DB --server ... --token ...</code>, or Resources &rarr; Secrets.</li>
<li><strong>Deployment config</strong>: hosts, folders and users of this environment; keep one file per environment in the pipeline or a config repository, with <code>\${env:...}</code> for values the server's environment gives.</li>
<li><strong>Access</strong>: a system account with the Deploy permission on the project (Admin Console &rarr; System accounts), and an API token for it.</li>
</ol>
<p class="h">Deploy</p>
<ul>
<li><strong>Admin Console &rarr; Releases</strong>: choose the zip; read its check (Sutras and addresses, secrets present or missing, where it was built from, the config and files it brings); change the project name or give another deployment config; <strong>Deploy</strong>.</li>
<li><strong>Command line</strong>: <code>sutra check orders-1.4.0.zip --server ... --token ...</code>, then <code>sutra deploy orders-1.4.0.zip --config prod-config.json --server ... --token ...</code>. The zip's own config applies unless <code>--config</code> gives another.</li>
<li><strong>Designer</strong> (non-production): Releases &rarr; <em>Deploy a package here</em>.</li>
<li><strong>Headless engines</strong> can also take packages from a folder at start (<code>SUTRA_DEPLOY_DIR</code>), for container images.</li>
</ul>
<p>Before anything changes the package is checked: checksum, activities this server knows, every secret present, and no REST or SOAP path already served by another project. Then everything is matched by name: the project (made when missing), schemas, connections, Sutras. Changed Sutras get a new version and are deployed; unchanged ones are left alone; Sutras of the project not in the package are undeployed (kept, not deleted) unless <em>keep others</em>. The deployment config is applied and the files written. Every deployment is recorded with who deployed it.</p>
<p class="h">Check and roll back</p>
<ul>
<li>After a deploy: Admin Console &rarr; Applications for the Sutras and their state, Runs for failures, Alerts for rules that fire. <code>sutra test release.zip</code> runs every Sutra of a package with its test data in a throw-away server, before you deploy.</li>
<li><strong>Roll back</strong>: Admin Console &rarr; Releases &rarr; <em>Roll back</em>, or <em>Deploy again</em> on any earlier package; <code>sutra rollback --project "Orders"</code>. A rollback is itself a deployment, recorded like any other.</li>
</ul>
<p class="h">From a Sutra</p>
<p>The <strong>Release</strong> palette does the same steps inside a Sutra, so a release can itself be a Sutra: on a timer or a REST call, [[releasePackage]], [[releaseDeploy]] to a test engine, [[approval]], [[releaseDeploy]] to production, then [[emailSend]] the result. [[releaseCheck]] and [[releaseRollback]] complete it. These activities are off until an administrator allows them in Admin Console &rarr; Server &rarr; Runtime.</p>
[[tip:Good practice|Promote the same zip from UAT to production; never rebuild it for production.<br>Keep deployment configs and secrets out of the package and out of Git; keep configs per environment, secrets in each vault.<br>Write the note: it shows in the history and the README.]]`,
  },
  {
    id: 'cicd', title: 'CI/CD pipelines',
    html: `
<p>A pipeline builds the release from Git and takes it through test to production with no hand work and no designer access. Every step is a <code>sutra</code> command that ends with exit code 0 (success), 1 (a failed check, test or deploy) or 2 (wrong usage), so any CI system stops at the first problem.</p>
<p class="h">The stages</p>
<ol>
<li><strong>Source</strong>: designers commit and push the project from the Git tab; a merge to the main branch, or a version tag such as <code>v1.4.0</code>, starts the pipeline.</li>
<li><strong>Build</strong>: <code>sutra package --from-git . --ref $TAG --version $VERSION --out release.zip</code> on the build agent; no SutraFlow server is needed.</li>
<li><strong>Test</strong>: <code>sutra test release.zip --secrets-from-env</code> runs every Sutra with its test data in a throw-away server; test secrets come from the pipeline's secret variables.</li>
<li><strong>Document</strong>: <code>sutra doc release.zip --out documentation.html</code> (also inside the zip) for reviewers.</li>
<li><strong>Deploy to UAT</strong>: <code>sutra check</code> then <code>sutra deploy release.zip --config config/uat.json</code> against the UAT engine.</li>
<li><strong>Approve</strong>: a person approves in the CI system (environments with required reviewers, manual jobs, approval gates).</li>
<li><strong>Deploy to production</strong>: the same zip, <code>--config config/prod.json</code>, against the production engine. Keep the zip as the pipeline's artifact.</li>
</ol>
<p class="h">What the pipeline needs</p>
<table class="t"><thead><tr><th>Item</th><th>Where to keep it</th></tr></thead><tbody>
<tr><td>The <code>sutra</code> command</td><td>Node.js 24 and SutraFlow on the build agent (<code>npm ci</code> in a checkout of SutraFlow, then <code>npm run sutra --</code>), or the SutraFlow container image</td></tr>
<tr><td>Server addresses</td><td>Pipeline variables: <code>UAT_SERVER</code>, <code>PROD_SERVER</code> (the admin port, for example <code>https://prod-engine:4800</code>)</td></tr>
<tr><td>Tokens</td><td>Secret variables: an API token of a system account with Deploy on the project, one per environment</td></tr>
<tr><td>Deployment configs</td><td>A <code>config/</code> folder in the repository (no secrets in it), or a separate config repository</td></tr>
<tr><td>Secret values</td><td>The CI system's secret store; set them on the target with <code>sutra secret set NAME --from-env NAME</code> as a pipeline step, or by the operations team</td></tr>
<tr><td>Git access for <code>--from-git &lt;address&gt;</code></td><td><code>SUTRA_GIT_TOKEN</code> (and <code>SUTRA_GIT_LOGIN</code>); not needed when the pipeline has checked out the repository and passes <code>.</code></td></tr>
</tbody></table>
<p class="h">GitHub Actions</p>
<pre>name: release
on:
  push:
    tags: ['v*']
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7                      # the project repository
      - uses: actions/checkout@v7
        with: { repository: your-org/sutraflow, path: sutraflow }
      - uses: actions/setup-node@v7
        with: { node-version: 24 }
      - run: npm ci
        working-directory: sutraflow
      - name: Build the release
        run: npm run --prefix sutraflow sutra -- package --from-git "$GITHUB_WORKSPACE" --ref "$GITHUB_REF_NAME" --version "\${GITHUB_REF_NAME#v}" --out "$GITHUB_WORKSPACE/release.zip"
      - name: Test it
        run: npm run --prefix sutraflow sutra -- test "$GITHUB_WORKSPACE/release.zip" --secrets-from-env
        env: { ORDERS_DB: '\${{ secrets.TEST_ORDERS_DB }}' }
      - uses: actions/upload-artifact@v4
        with: { name: release, path: release.zip }
  production:
    needs: build
    runs-on: ubuntu-latest
    environment: production                           # required reviewers approve here
    steps:
      - uses: actions/download-artifact@v4
        with: { name: release }
      - uses: actions/checkout@v7
        with: { repository: your-org/sutraflow, path: sutraflow }
      - uses: actions/setup-node@v7
        with: { node-version: 24 }
      - run: npm ci
        working-directory: sutraflow
      - run: |
          npm run --prefix sutraflow sutra -- check  "$PWD/release.zip" --server "$PROD_SERVER" --token "$PROD_TOKEN"
          npm run --prefix sutraflow sutra -- deploy "$PWD/release.zip" --server "$PROD_SERVER" --token "$PROD_TOKEN" --config "$PWD/sutraflow/../config/prod.json"
        env:
          PROD_SERVER: '\${{ vars.PROD_SERVER }}'
          PROD_TOKEN: '\${{ secrets.PROD_TOKEN }}'</pre>
<p class="h">GitLab CI</p>
<pre>stages: [build, test, uat, production]
image: node:24
variables: { VERSION: "\${CI_COMMIT_TAG}" }
before_script:
  - git clone --depth 1 https://gitlab.example.com/tools/sutraflow.git /opt/sutraflow && (cd /opt/sutraflow && npm ci)
  - alias sutra="node --import tsx /opt/sutraflow/server/src/cli.ts"
build:
  stage: build
  rules: [{ if: $CI_COMMIT_TAG }]
  script: [ 'sutra package --from-git . --ref "$CI_COMMIT_TAG" --version "\${VERSION#v}" --out release.zip' ]
  artifacts: { paths: [release.zip] }
test:
  stage: test
  script: [ sutra test release.zip --secrets-from-env ]
uat:
  stage: uat
  environment: uat
  script: [ sutra deploy release.zip --config config/uat.json --server "$UAT_SERVER" --token "$UAT_TOKEN" ]
production:
  stage: production
  environment: production
  when: manual
  script:
    - sutra check  release.zip --server "$PROD_SERVER" --token "$PROD_TOKEN"
    - sutra deploy release.zip --config config/prod.json --server "$PROD_SERVER" --token "$PROD_TOKEN"</pre>
<p class="h">Azure DevOps</p>
<pre>trigger: { tags: { include: ['v*'] } }
pool: { vmImage: ubuntu-latest }
stages:
- stage: Build
  jobs:
  - job: package
    steps:
    - checkout: self
    - checkout: git://Tools/sutraflow
    - task: NodeTool@0
      inputs: { versionSpec: '24.x' }
    - script: cd sutraflow &amp;&amp; npm ci
    - script: node --import tsx sutraflow/server/src/cli.ts package --from-git $(Build.SourcesDirectory)/orders --ref $(Build.SourceBranchName) --version $(Build.SourceBranchName) --out $(Build.ArtifactStagingDirectory)/release.zip
    - publish: $(Build.ArtifactStagingDirectory)/release.zip
      artifact: release
- stage: Production
  dependsOn: Build
  jobs:
  - deployment: deploy
    environment: production                           # approvals and checks on the environment
    strategy:
      runOnce:
        deploy:
          steps:
          - script: node --import tsx $(Pipeline.Workspace)/sutraflow/server/src/cli.ts deploy $(Pipeline.Workspace)/release/release.zip --server $(PROD_SERVER) --token $(PROD_TOKEN) --config config/prod.json</pre>
<p class="h">Jenkins</p>
<pre>pipeline {
  agent { docker { image 'node:24' } }
  environment { SUTRA = 'node --import tsx /opt/sutraflow/server/src/cli.ts' }
  stages {
    stage('Build')  { steps { sh '$SUTRA package --from-git . --ref "$TAG_NAME" --version "\${TAG_NAME#v}" --out release.zip' } }
    stage('Test')   { steps { sh '$SUTRA test release.zip --secrets-from-env' } }
    stage('UAT')    { steps { withCredentials([string(credentialsId: 'uat-token', variable: 'T')]) { sh '$SUTRA deploy release.zip --config config/uat.json --server $UAT_SERVER --token $T' } } }
    stage('Approve') { steps { input 'Deploy to production?' } }
    stage('Production') { steps { withCredentials([string(credentialsId: 'prod-token', variable: 'T')]) { sh '$SUTRA deploy release.zip --config config/prod.json --server $PROD_SERVER --token $T' } } }
  }
  post { success { archiveArtifacts 'release.zip' } }
}</pre>
<p class="h">Container images</p>
<p>For immutable production, bake the release into an engine image: <code>FROM sutraflow:2.0.3</code>, <code>COPY release.zip /deploy/</code>, and start it with <code>SUTRA_MODE=engine SUTRA_DEPLOY_DIR=/deploy</code>; the engine deploys every package in the folder at start. A new release is a new image.</p>
[[tip:Good practice|One zip, many environments: build once, deploy the same artifact to UAT and production.<br>Give each environment its own system account and token, with Deploy on the project only.<br>Let the pipeline fail on <code>sutra check</code> before anything changes; keep rollback one command away.<br>Store the zip with the pipeline run: it is the record of exactly what went live.]]`,
  },
  {
    id: 'commands', title: 'Command reference',
    html: `
<p>SutraFlow has two command line tools. Both lists below are read from the tools themselves when this guide is built, so they always match the version you have; <code>sutraflow help</code> and <code>sutra help</code> print the same.</p>
<ul>
<li><strong>sutraflow</strong> runs SutraFlow on this machine: install, start, stop, status, logs, Docker. Windows: <code>bin\\sutraflow.cmd</code>; Linux and macOS: <code>bin/sutraflow</code>; <code>sutraflow</code> after <code>npm install -g</code>.</li>
<li><strong>sutra</strong> works with what is in SutraFlow: packages and releases, users, secrets, deployed Sutras, runs, approvals, engines, alerts and the gateway. It works on the data folder directly, or on a running server with <code>--server</code> and <code>--token</code>. <code>sutraflow cli &lt;command&gt;</code> runs it against the local studio, already signed in; on its own it is <code>npm run sutra -- &lt;command&gt;</code> or <code>sutra</code> after <code>npm install -g</code>.</li>
</ul>
<p class="h">sutraflow: running SutraFlow</p>
[[commands:sutraflow]]
<p class="h">sutra: releases, people and operations</p>
[[commands:sutra]]
<p class="h">Examples</p>
<pre>sutraflow setup                               install and build
sutraflow start                               the studio, in the background
sutraflow start engine                        a second engine on the same database
sutraflow status                              what runs, where, on which database
sutraflow cli sutras list                     deployed Sutras with their runs today
sutraflow cli runs list --status failed       failed runs
sutraflow cli user add meera --role developer --password-from-env NEW_PASSWORD
sutraflow db copy --to postgres://postgres@127.0.0.1:5432/sutraflow
sutraflow stop all                            graceful: running steps finish first
sutra package --project Shop --version 1.4.0 --out shop-1.4.0.sutra
sutra deploy shop-1.4.0.sutra --server https://prod:4800 --token $SUTRA_TOKEN</pre>
[[tip:Guidelines|Run sutraflow stop before db copy, so nothing changes while the data is copied.<br>Give scripts a system account and its API token (sutra user add --system, sutra token create) rather than the local admin token.]]`,
  },
  {
    id: 'approvals', title: 'The Approval Center: decisions by business people',
    html: `
<p>When a Sutra needs a person (a refund over a limit, a new supplier, a purchase order, a question an AI agent may not answer alone), a [[approval]] or [[askPerson]] step waits, and the people it names decide in the <strong>Approval Center</strong>: a page of its own at <code>/approvals</code> on every SutraFlow server, made for business people. It shows only their approvals: nothing of the designer or the Admin Console, and it works on a phone.</p>
[[img:approvals|The Approval Center: what waits for the signed-in approver, with the details the step chose to show.]]
<p class="h">Set up the approvers (an administrator, once)</p>
<ol>
<li>Admin Console &rarr; <strong>Roles</strong>: make a role per group of approvers, for example <em>Finance approver</em> (it needs no permissions of its own; <em>View</em> lets its members also see the other waiting items of the project).</li>
<li>Admin Console &rarr; <strong>Users</strong>: add the people, with their email address, and give them the role (on all projects or one). With single sign-on, map an identity provider group to the role instead.</li>
<li>Send them the address: <code>https://your-server/approvals</code>. They sign in with their password or with single sign-on. Designers and administrators reach it with <strong>Approval Center</strong> in the designer's top bar and in the Admin Console beside <em>Guide</em>.</li>
</ol>
<p class="h">In the Sutra</p>
<ol>
<li>Add a [[approval]] step. Write the question with references: <code>Approve purchase order {{input.ref}}?</code>.</li>
<li><strong>Details for the approvers</strong>: label = value, such as <code>Amount = {{input.total}}</code>, <code>Supplier = {{input.supplier}}</code>. They see these first; the full data is one click away.</li>
<li><strong>Approver roles</strong> (<em>Finance approver</em>) and/or <strong>approver accounts</strong> (usernames, or from the data: <code>{{input.managerAccount}}</code>).</li>
<li><strong>Who must approve</strong>: any one of them, all of them, or a number of them (any 2 of 5). One rejection rejects.</li>
<li><strong>Comment required</strong>: on rejection (default), always, or never.</li>
<li><strong>Time</strong> (optional): <em>Due in</em> hours, then keep waiting, <em>escalate</em> (the escalation roles can decide too, with the same time again) or the <em>expired</em> output; <em>Remind every</em> hours; <em>Email the approvers through</em> an SMTP connection, so they get an email with a link when the approval arrives, at each reminder and on escalation.</li>
<li>Connect <em>approved</em>, <em>rejected</em> (and <em>expired</em>). The output's <code>approval</code> holds who decided, the comment, and every approver's vote.</li>
</ol>
<p class="h">What the approvers see</p>
<ul>
<li><strong>Waiting for me</strong>: what they may decide and have not yet, newest last, with the details, who else must approve, how many approvals are in, and the due time.</li>
<li><strong>All waiting</strong>: everything of the projects they may view, including items waiting for others.</li>
<li><strong>Decided</strong>: their decisions and, for those who may view the project, everyone's, for 30 days.</li>
</ul>
<p class="h">Who may decide</p>
<table class="t"><thead><tr><th>The step names</th><th>Who decides</th></tr></thead><tbody>
<tr><td>Roles and/or accounts</td><td>Only those people (members of the roles on that project or on all projects, and the named accounts).</td></tr>
<tr><td>Nobody (older steps)</td><td>Anyone with the <em>Approve</em> permission on the project, as before.</td></tr>
<tr><td>Test and debug runs in the designer</td><td>Also the designers of the project, so a Sutra can be tried without the approvers.</td></tr>
</tbody></table>
<p>Administrators who are not approvers see the item and can decide <em>on behalf of the approvers</em>, which is recorded so; Operators can reassign an approval to other roles or accounts or give it a new due time (<code>POST /api/approvals/:id/reassign</code>). Every decision is in the run, in the history and in the audit log.</p>
[[tip:Who decides, not who can see|Approver roles need no permissions to decide what names them. Give the role View on the project only if its members should also see the other waiting items and the history of the project.]]
<p>The Admin Console's <em>Approvals</em> page lists what waits and for whom, and opens the Approval Center.</p>`,
  },
  {
    id: 'console', title: 'The Admin Console',
    html: `
<p>The Admin Console manages what is deployed: running projects and Sutras, approvals, engines, people, system accounts, roles and the audit log. Designing stays in the designer. Open it with <strong>Admin Console</strong> in the designer's top bar, or at <code>/admin</code> on the admin port (<code>http://127.0.0.1:4800/admin</code>). Headless engines serve the console too, without the designer.</p>
[[img:console-overview|The Overview: engines, deployed Sutras, runs of the last day, approvals, the work queue and the gateway, with recent failures.]]
<p class="h">Operate</p>
<ul>
<li><strong>Overview</strong>: tiles for engines, deployed Sutras, runs of the last 24 hours, waiting approvals, the work queue and the gateway certificate, and the latest failed runs with <em>Resubmit</em>. Test runs from the designer are not counted.</li>
<li><strong>Applications</strong>: every deployed project with its package version and its Sutras: version, started or stopped, what starts it (REST path, SOAP path, timer, skill), runs of the last day and the last run. <em>Stop</em> makes the Sutra's triggers start nothing (its address answers 404, timers and listeners pause) while it stays deployed; <em>Start</em> brings it back on every engine; <em>Restart</em> does both at once, so its address, timers and listeners start fresh with the current connections. <em>Runs</em> opens its runs with every step's result, <em>Resubmit</em> and <em>Cancel run</em>; <em>Versions</em> deploys an earlier version; <em>Tuning</em> sets how the Sutra runs (below); <em>Package history</em> rolls the project back to an earlier package.</li>
<li><strong>Approvals</strong>: what waits for a person and for whom (roles, accounts, progress, due time), with a button to open the <a href="#ch-approvals">Approval Center</a>, where the approvers decide.</li>
<li><strong>Releases</strong>: deploy a release zip (or <code>.sutra</code> package): choose the file, see its Sutras, the secrets present or missing on this server, where it was built from and its deployment config, change the project or give another config, then <em>Deploy</em>. Below, every project's current package with its history: <em>Roll back</em>, or <em>Deploy again</em> for any earlier one. This is how a production server receives Sutras.</li>
<li><strong>Engines</strong>: every engine sharing the database: alive or silent, leader, steps running, heartbeat. <em>Drain and stop</em> asks one engine to finish its steps, hand the rest to the others and stop; your service manager starts it again. <em>Delete old runs now</em> runs housekeeping at once. <em>Tuning</em> on the same page sets engine values (below).</li>
</ul>
[[img:console-command|Every confirmation offers the same action from a shell: the sutra command and the HTTP call, for Windows PowerShell or Linux and macOS.]]
<p class="h">The Console panel and commands for every action</p>
<p><strong>Console</strong> in the top bar opens a panel with every action taken in this browser tab: what was done, whether it worked, how long it took, and the server's answer. Each entry also shows the same action as a command, for <strong>Windows PowerShell</strong> and for <strong>Linux and macOS</strong> shells: the <code>sutra</code> command and the HTTP call (<code>Invoke-RestMethod</code> or <code>curl</code>). Every confirmation has <em>Run it from a shell instead</em> with the same commands, so an action can be scripted, put in a runbook, or tried again from a shell when the console is not at hand. Commands read the server address and token from <code>SUTRA_SERVER</code> and <code>SUTRA_ADMIN_TOKEN</code>; use a system account's API token. Passwords never appear in commands: they read <code>NEW_PASSWORD</code> from the environment.</p>
<pre>sutra sutras list
sutra sutras restart "Order lookup API" --project "Orders"
sutra runs list --status failed
sutra runs resubmit 3f2c...
sutra approvals approve 42 --comment "checked"
sutra engines drain engine-2</pre>
[[img:console-panel|The Console panel: what was done, its output, and the same action as commands to copy.]]
<p class="h">Tuning</p>
<p>Tuning changes how deployed Sutras run, while they run. Every engine applies a change within a heartbeat, without a restart. Values set by environment variables stay the defaults, and an empty field returns to them.</p>
<table class="t s"><thead><tr><th>Engine tuning</th><th>What it does</th></tr></thead><tbody>
<tr><td>Steps at once</td><td>Steps one engine runs at the same time. Set for all engines, or for one engine (a bigger machine, or 0 for a studio that should not run work).</td></tr>
<tr><td>Steps per run limit</td><td>Stops runs that take more steps, such as loops that never end.</td></tr>
<tr><td>Reply wait</td><td>How long REST, SOAP and MCP callers wait for a reply step.</td></tr>
<tr><td>Keep finished runs, Keep audit entries</td><td>Days before housekeeping deletes them.</td></tr>
<tr><td>Trace sampling</td><td>Share of runs sent to the OpenTelemetry collector.</td></tr>
</tbody></table>
<table class="t s"><thead><tr><th>Sutra tuning</th><th>What it does</th></tr></thead><tbody>
<tr><td>Runs at once</td><td>More runs wait as <em>queued</em> and start, oldest first, when one ends. Protects a slow partner system or a database.</td></tr>
<tr><td>Priority</td><td>Steps of higher priority Sutras are taken from the shared work queue first.</td></tr>
<tr><td>Run time limit</td><td>Runs still open after this many minutes are cancelled with an error.</td></tr>
<tr><td>Retries, First retry after</td><td>For steps whose own settings have no retries.</td></tr>
<tr><td>Step data in history</td><td><em>all</em>, <em>errors only</em> (step data is kept only for runs that did not finish well), or <em>none</em> (for personal or bulky data).</td></tr>
<tr><td>Keep finished runs</td><td>Days for this Sutra, instead of the engine setting.</td></tr>
</tbody></table>
[[img:console-tuning|Tuning of one deployed Sutra. Empty fields show what they mean when left empty.]]
[[img:console-engines|Engines with their tuning for every engine, and Steps at once for one engine.]]
<p>Sutra tuning applies to every run of the deployed Sutra, whatever started it: REST or SOAP request, timer, file, mailbox, queue, MCP skill, channel or the Run API. A Sutra with several triggers shares one limit. Test and debug runs from the designer are not tuned, and runs started by Call Sutra always start (they count toward the limit, but never wait behind their own caller). Sutra tuning stays when a new version is deployed. Tuned Sutras show <em>tuned</em> in Applications.</p>
[[img:console-apps|Applications: deployed projects and Sutras with their triggers, state and runs; Stop and Start per Sutra.]]
<p class="h">Alerts</p>
<p>The <strong>Overview</strong> shows open alerts, runs of the last day and gateway traffic as charts. Under <strong>Alerts</strong>:</p>
<ul>
<li><strong>Channels</strong> say where alerts go: <em>email</em> through any project's SMTP connection, a <em>webhook</em> (a JSON POST with <code>event</code>, <code>text</code> and <code>alert</code>; chat tools that read a text field show the message; optionally signed with <code>X-Sutra-Signature</code> from a vault secret), or a deployed <em>Sutra</em> that starts with the alert as its input, to open a ticket or call someone. <em>Send a test</em> tries a channel.</li>
<li><strong>Alert rules</strong> say what to watch: failed runs (of one Sutra or any), slow runs, gateway error rate, gateway latency (p95), engines (one stopped beating, or fewer alive than needed), work waiting in the queue too long, approvals waiting too long, the gateway certificate ending soon, listeners in error. Each rule has a severity (warning or critical), channels, whether to tell when it resolves, and reminders every few minutes while nobody acknowledged it. <em>Check now</em> shows what the rule finds at this moment.</li>
<li><strong>Alerts</strong> lists what is open, newest first, and the history. The cluster leader checks every rule every 30 seconds, so a cluster alerts once; one alert per rule stays open until its condition clears. <em>Acknowledge</em> says someone is on it and stops reminders; <em>Resolve</em> closes it by hand. Each alert shows what was sent where, and whether it arrived.</li>
</ul>
[[img:alerts-open|Alerts: an open critical alert with what was found, Acknowledge and Resolve; Details shows what was sent where.]]
[[img:alerts-rule|An alert rule: what to watch, its settings, severity, channels and reminders; Check now shows what it finds at this moment.]]
<pre>sutra alerts                 (open alerts; exit code 1 while a critical alert is firing)
sutra alerts ack &lt;id&gt;
sutra alerts test "Operations team"</pre>
<p class="h">Gateway: apps, keys, plans, firewall, traffic</p>
<ul>
<li><strong>Apps and keys</strong>: an app is a consumer of your APIs (a partner, a mobile app, a team) with <em>scopes</em> such as <code>orders:read</code> and a plan. Create keys for it; each is shown once. Callers send a key in <code>X-API-Key</code>, or exchange it for an access token at <code>POST /oauth/token</code> on the gateway (client credentials: the app id and a key). Disabling an app or revoking a key refuses its calls at once.</li>
<li>To protect a service with apps, give its <strong>API security policy</strong> the authentication <em>apps</em> and the <em>Required scopes</em>.</li>
<li><strong>Plans</strong>: requests per minute, hour and day and a monthly quota. All engines count together; over a limit the caller gets 429 with <code>Retry-After</code>, and every answer carries <code>X-RateLimit-Limit</code> and <code>X-RateLimit-Remaining</code>.</li>
<li><strong>Firewall</strong>: addresses or ranges the whole gateway allows or denies.</li>
<li><strong>Traffic</strong>: requests over time (answered, refused, errors), latency p50/p95/p99, the busiest and slowest services, apps, status codes, and the request log with every request's caller, time and error.</li>
<li><strong>APIs</strong>: what is served, with its policy; OpenAPI for the REST services, and the options to publish it at <code>/openapi.json</code> and to keep the request log.</li>
</ul>
[[img:gateway-traffic|Traffic: requests over time split into answered, refused and errors, latency percentiles, busiest and slowest services, apps and status codes; the request log follows below.]]
[[img:gateway-apis|APIs: what the gateway serves with its policy, OpenAPI, and the gateway options.]]
<pre>sutra gateway plan set Partner --per-minute 120 --per-day 50000
sutra gateway app add "Acme shop" --scopes "orders:read" --plan Partner
sutra gateway key create "Acme shop" --name production --expires-days 365
sutra gateway stats --period 24h</pre>
<p class="h">Users, system accounts and roles</p>
<ul>
<li><strong>Users</strong> are people. An administrator adds them with a first password (<em>Generate</em> makes a strong one); by default they choose their own at the first sign-in. Five wrong passwords lock an account for 15 minutes; <em>Unlock</em> ends it sooner. <em>Disable</em> ends the person's sessions at once and keeps everything; <em>Sign out everywhere</em> ends sessions only.</li>
<li><strong>System accounts</strong> are for engines, CI pipelines and API callers. They do not sign in to the designer. They get <strong>API tokens</strong> for the admin API, shown once and stored only as a hash, with an expiry and a <em>Revoke</em> button. A system account with a password can call gateway services whose API security policy accepts system accounts.</li>
<li><strong>Roles</strong> are sets of permissions. A role is granted for all projects or for one project, and an account can hold several. Built-in roles: Administrator, Developer, Deployer, Operator, Approver, Viewer and API caller. <em>New role</em> combines permissions differently.</li>
</ul>
<table class="t s"><thead><tr><th>Permission</th><th>Allows</th></tr></thead><tbody>
<tr><td>View</td><td>See the project, its Sutras, connections, runs and logs.</td></tr>
<tr><td>Design</td><td>Edit Sutras, schemas and project settings; test and debug runs.</td></tr>
<tr><td>Connections</td><td>Add and change connections and API security policies.</td></tr>
<tr><td>Deploy</td><td>Deploy and undeploy Sutras, deploy packages, roll back, edit the deployment config.</td></tr>
<tr><td>Operate</td><td>Start, stop, cancel and resubmit; clear runtime variable values.</td></tr>
<tr><td>Approve</td><td>Decide approvals.</td></tr>
<tr><td>Call services</td><td>System accounts: call the project's gateway services with Basic sign-in.</td></tr>
<tr><td>Secrets, Engines, Gateway, Server settings, Users and roles, Audit, Alerts (channels, rules, acknowledging)</td><td>Server permissions: they only come with a grant on all projects.</td></tr>
</tbody></table>
[[note:Always one administrator|Nobody can disable or delete their own account, and the last active administrator cannot lose the role.]]
<p class="h">Audit log</p>
<p>Every change, sign-in and refused request is recorded with who, when, from which address, what and the result, and with where it happened:</p>
<ul>
<li><strong>Where</strong>: the server (<em>production</em>, <em>test</em> or <em>development</em>, from <code>SUTRA_ENVIRONMENT</code>) and the engine, and whether it was a designer test run or a deployed Sutra.</li>
<li><strong>Project</strong> and <strong>Sutra</strong>: name and id. The names are kept with the entry, so a renamed or deleted Sutra still reads as it was.</li>
</ul>
<p>Filter by server, project, Sutra (choose the project first), person, result, words and dates; <em>Export CSV</em> saves what the filters show, with all these columns. Passwords, secret values and tokens are never recorded. Entries recorded before this version show no server.</p>
<p class="h">Audit retention and clearing</p>
<p>The <em>Retention</em> card at the top of the Audit page shows how many entries there are, the oldest, and when the log was last cleared and by whom. With the <strong>Audit settings and clearing</strong> permission (Administrators have it):</p>
<ul>
<li><strong>Keep entries (days)</strong>: housekeeping deletes older entries; 0 keeps everything. The default is <code>SUTRA_AUDIT_RETENTION_DAYS</code> (365).</li>
<li><strong>Delete older entries now</strong>, <strong>Clear before</strong> a date, or <strong>Clear all</strong>, each after a confirmation.</li>
</ul>
<p>Clearing is recorded as an entry of its own (who, what, how many), so the log always shows that it was cleared. From a shell: <code>sutra audit retention 180</code>, <code>sutra audit clear --before 2026-01-01</code>.</p>
<p class="h">The first administrator of a headless engine</p>
<p>A headless engine has no first-start page, so nobody who reaches it can claim it. Add the first administrator on the server, then sign in at <code>/admin</code>:</p>
<pre>sutra user add admin --role administrator --password-from-env ADMIN_PASSWORD
sutra user add ci-orders --system --role deployer --project "Orders"
sutra user list</pre>`,
  },
  {
    id: 'move-postgres', title: 'Moving to PostgreSQL',
    html: `
<p>SutraFlow keeps its own data (projects, Sutras, runs, people, the vault) in SQLite until you move it to PostgreSQL. PostgreSQL lets several engines share the data and holds more. The move takes a minute and is one button in the Admin Console, or one script on Windows and Linux.</p>
[[note:Do you need to move?|On a single server, SQLite needs no database server and handles about 420 small steps a second. Move when you add engines, need failover, need more throughput on one busy server, or must run the database apart. See <a href="#ch-sizing">Sizing and performance</a>.]]
<p class="h">1. Prepare PostgreSQL</p>
<ul>
<li>On this machine (Laragon includes PostgreSQL), on another server, or hosted: Azure Database for PostgreSQL, Amazon RDS, Google Cloud SQL. Version 14 or later.</li>
<li>A user for SutraFlow with a password. Either an empty database it owns (<code>CREATE DATABASE sutraflow OWNER sutra;</code>), or <code>CREATEDB</code>, so the move makes the database.</li>
<li><strong>Remote servers</strong>: PostgreSQL must listen on the network (<code>listen_addresses</code>), its <code>pg_hba.conf</code> must accept the SutraFlow machine (for example <code>hostssl sutraflow sutra 10.0.0.15/32 scram-sha-256</code>), and the firewall or network security group must open port 5432 to it. Hosted services do this in their portal.</li>
<li>Knowledge bases stored in PostgreSQL also need pgvector; SutraFlow's own data does not.</li>
</ul>
<p class="h">2. Save and test the connection</p>
[[img:console-database|The Database page: the database in use, the PostgreSQL connection with Test connection, and Migrate now.]]
<p><strong>Admin Console &rarr; Server &rarr; Database</strong> shows the database in use. Fill in host, port, database, user, password and SSL:</p>
<table class="t"><thead><tr><th>SSL</th><th>Use for</th></tr></thead><tbody>
<tr><td>off</td><td>PostgreSQL on this machine or a trusted private network</td></tr>
<tr><td>require</td><td>Encrypted; the server's certificate is not checked. Servers with their own (self-signed) certificate</td></tr>
<tr><td>verify</td><td>Encrypted and the certificate checked against the host name. Hosted PostgreSQL (Azure, AWS, Google Cloud)</td></tr>
</tbody></table>
<p><strong>Test connection</strong> signs in and reports the PostgreSQL version, whether it signed in with the password and over SSL, whether the database exists or will be made, pgvector, and SutraFlow tables already there. Its messages say what to fix: a refused password, a host name that cannot be found, a port a firewall blocks, a server that does not accept this machine (pg_hba.conf) or wants SSL, a certificate that cannot be checked. <strong>Save</strong> keeps the connection; the password goes to the vault and never comes back to the page. A changed connection must be tested again before it can be used.</p>
<p class="h">3. Migrate</p>
<p><strong>Migrate now</strong> runs <code>tools/migrate-to-postgres</code>. The page shows each step and waits while SutraFlow restarts:</p>
<ol>
<li>SutraFlow stops gracefully: no new work, running steps finish. Triggers and APIs pause for about a minute.</li>
<li>Every table is copied to PostgreSQL (the database is made when missing), and the rows of every table are counted on both sides.</li>
<li><code>sutraflow.env</code> gets <code>SUTRA_DB=postgres://user@host:5432/sutraflow</code> and the password apart as <code>SUTRA_DB_PASSWORD</code> (so the address can be shown and logged); the old file is kept beside it; on Linux the file is made readable only by its owner.</li>
<li>SutraFlow starts again (and the engine, when it was running) and must answer on PostgreSQL.</li>
<li>If the copy or the start fails, the old <code>sutraflow.env</code> is put back and SutraFlow starts on SQLite again. The SQLite file is never changed, so it stays as a backup.</li>
</ol>
<p>Tick <em>Replace SutraFlow tables already in the target database</em> only to overwrite an earlier copy.</p>
<p class="h">By hand, or on a server without the Admin Console</p>
<pre>tools\\migrate-to-postgres.cmd                         (Windows)
tools/migrate-to-postgres.sh                          (Linux, macOS)
tools/migrate-to-postgres.sh --url "postgres://sutra:password@db.example.com:5432/sutraflow?sslmode=verify-full"</pre>
<p>Without <code>--url</code> the script uses the connection saved on the Database page. It needs SutraFlow started with the launcher (<code>sutraflow start</code>, the Laragon Procfile, the Windows task or the systemd unit), because it stops and starts it. With a systemd unit, stop the service first, run the script, then start the service again. Progress goes to the console and to <code>&lt;data&gt;/migration/status.json</code>; the full output is in <code>&lt;data&gt;/migration/migration.log</code>.</p>
<p class="h">Afterwards</p>
<ul>
<li>Back up PostgreSQL (<code>pg_dump</code>, or the hosted service's backups); the master key in the data folder still decrypts the vault and must be kept with the backups.</li>
<li>More engines on other machines use the same <code>SUTRA_DB</code>, <code>SUTRA_DB_PASSWORD</code> and master key (see <em>Running in production</em>).</li>
<li>To go back to SQLite: stop SutraFlow, put the kept <code>sutraflow.env.sqlite-...</code> file back, start it (changes made on PostgreSQL stay there).</li>
</ul>`,
  },
  {
    id: 'data', title: 'Where SutraFlow keeps its data',
    html: `
<p>Everything SutraFlow knows is in one database and one data folder. This chapter says what is where, what is encrypted, what grows, and how to back it up. Look, but change things through the designer, the Admin Console or the <code>sutra</code> command: they check permissions, write the audit log and keep the engines in step, which a direct database change does not.</p>
<p class="h">The database</p>
<ul>
<li><strong>SQLite</strong> (the start): the file <code>&lt;data&gt;/sutra.db</code>. Open it read-only with DB Browser for SQLite or HeidiSQL, ideally from a copy.</li>
<li><strong>PostgreSQL</strong> (after <em>Moving to PostgreSQL</em>): the database named in <code>SUTRA_DB</code>, for example <code>sutraflow</code>, schema <code>public</code>. In HeidiSQL or pgAdmin, open that database; the server's other databases (such as <code>postgres</code>) hold nothing of SutraFlow.</li>
</ul>
<p>Text columns hold JSON and ISO dates, so the same tables work on both databases and move between them as they are. The Admin Console's Database page shows which database is in use and its main row counts.</p>
<p class="h">The data folder</p>
<table class="t"><thead><tr><th>In <code>&lt;data&gt;</code></th><th>What</th></tr></thead><tbody>
<tr><td><code>master.key</code></td><td>The key that encrypts the vault, OAuth and Git tokens and the TLS key (made with the first secret). Without it those values cannot be read: back it up apart from the database, and keep it secret. <code>SUTRA_MASTER_KEY</code> can give it instead.</td></tr>
<tr><td><code>sutra.db</code></td><td>The SQLite database (kept as a backup after a move to PostgreSQL).</td></tr>
<tr><td><code>admin-token.txt</code></td><td>The local admin token the launcher uses to stop and query the server.</td></tr>
<tr><td><code>logs/</code></td><td>Project logs and the server's output log.</td></tr>
<tr><td><code>files/&lt;project&gt;/</code></td><td>Each project's files folder (<code>\${files}</code> in variables): documents, scripts and files that release zips bring.</td></tr>
<tr><td><code>workspaces/</code></td><td>Git working copies of projects in Git.</td></tr>
<tr><td><code>knowledge/</code></td><td>Knowledge bases kept in a folder.</td></tr>
<tr><td><code>config/</code></td><td>Deployment configs dropped here as <code>&lt;project&gt;.json</code> are loaded at start.</td></tr>
<tr><td><code>run/</code>, <code>migration/</code></td><td>The launcher's process ids; the status and log of a move to PostgreSQL.</td></tr>
</tbody></table>
<p class="h">The tables</p>
<p>36 tables, by what they are for. <em>Encrypted</em> marks values only readable with the master key; <em>Grows</em> marks tables that get longer with use, and what keeps them in check.</p>
[[tables]]
<p class="h">Backups</p>
<ul>
<li><strong>SQLite</strong>: stop SutraFlow (or use <code>sqlite3 sutra.db ".backup copy.db"</code> while it runs) and copy the whole data folder.</li>
<li><strong>PostgreSQL</strong>: <code>pg_dump -Fc sutraflow &gt; sutraflow.dump</code> (or the hosted service's backups), plus the data folder without <code>sutra.db</code>.</li>
<li>Always <code>master.key</code>, kept apart from the database backup: a stolen database backup without the key reveals no secrets.</li>
<li>Restore: put the folder and the key back (and <code>pg_restore</code> for PostgreSQL), then start SutraFlow.</li>
</ul>`,
  },
  {
    id: 'production', title: 'Running in production: engines, Docker, clusters',
    html: `
<p class="h">Headless engines</p>
<p>The same program started with <code>SUTRA_MODE=engine</code> runs Sutras without the studio: no designer pages and no editing. It keeps <code>/health</code>, <code>/ready</code> and <code>/metrics</code>, the Admin Console at <code>/admin</code> for its users, and an automation API for API tokens (the admin token or system account tokens). Packages in <code>SUTRA_DEPLOY_DIR</code> are deployed when it starts; a package that cannot be deployed stops the start.</p>
<p class="h">Docker</p>
<pre>docker build -t sutraflow:2.0.3 .
docker run -e SUTRA_MODE=engine -e SUTRA_ADMIN_TOKEN=... -e SUTRA_MASTER_KEY=... \\
           -v ./deploy:/deploy:ro -p 8080:8080 sutraflow:2.0.3</pre>
<p>The image runs as a non-root user, checks its own health, and writes JSON logs. <code>docker-compose.yml</code> has a studio and an engine; <code>docker-compose.cluster.yml</code> has PostgreSQL, a studio and two engines.</p>
<p class="h">Clusters</p>
<p>Several engines share one database (<code>SUTRA_DB=postgres://...</code>), each with its own <code>SUTRA_ENGINE_ID</code> and all with the same <code>SUTRA_MASTER_KEY</code>.</p>
<p class="h">A cluster needs a load balancer</p>
<ul>
<li><strong>Put a load balancer in front of the engines' gateways</strong> (Apache, nginx, IIS, a cloud load balancer) and send every caller of REST, SOAP, MCP and agent services to it, with <code>/ready</code> on the admin port as the health check. A run starts on the engine that receives its call. Measured: four engines did about three times the work of one with calls spread over them, and little more than one when every call went to the same engine.</li>
<li>Timers, folder and mailbox listeners run on the leader only, so they never start twice; the steps that follow are shared by every engine.</li>
<li>Sutras that run in memory stay on the engine that started them: only a load balancer spreads them.</li>
</ul>
<p class="h">Database connections</p>
<ul>
<li>On PostgreSQL each engine runs its steps through a pool of connections (<code>SUTRA_PG_POOL</code>, by default half of <em>Steps at once</em>, from 4 to 20) and keeps one more for everything else. Many steps then have their database work in flight at once.</li>
<li>Keep <em>engines &times; (pool + 1)</em>, plus the studio and your own tools, under PostgreSQL's <code>max_connections</code> (100 by default). Four engines with a pool of 8 use 36.</li>
<li><code>/metrics</code> shows the pool: <code>sutra_db_pool_connections</code>, <code>sutra_db_pool_waiting</code> (transactions waiting for a connection), <code>sutra_db_pool_acquire_ms</code> and <code>sutra_db_transaction_ms</code>. Waiting that grows means the pool is too small for the work; transactions that grow mean the database is the limit.</li>
<li><code>SUTRA_PG_ASYNC=0</code> runs the engine through one synchronous connection as before 1.7.6: a fallback, several times slower.</li>
<li>PostgreSQL <code>LISTEN/NOTIFY</code> wakes engines when committed work enters the durable queue. Polling remains active as the correctness fallback. Set <code>SUTRA_PG_NOTIFY=0</code> only to disable the wake hint.</li>
</ul>
<p><strong>Engine names.</strong> <code>SUTRA_ENGINE_ID</code> is an engine's identity in the cluster: the steps it runs record it as their owner, and the leader uses it to hand a stopped engine's steps to the others. Without it, the launcher uses the computer name (<code>vm-west-01-studio</code>, <code>vm-west-01-engine</code>); the Laragon set-up names its engines <code>laragon</code> and <code>laragon-engine</code>. Set it once per engine (in <code>sutraflow.env</code>: <code>STUDIO_ENGINE_ID</code>, <code>ENGINE_ENGINE_ID</code>) and keep it. For the name people see, use <strong>Rename</strong> in <em>Admin Console &rarr; Engines</em> or <code>sutra engines name &lt;id&gt; "Azure West Europe 1"</code>: a display name that can change at any time.</p>
<ul>
<li>Work is shared, and each step is run by exactly one engine.</li>
<li>One engine leads and runs timers and folder, mailbox, queue and Drive listeners, so they fire once. If it stops, another takes over within a few heartbeats.</li>
<li>Steps of an engine that stopped are finished by another.</li>
<li>Callers get their replies from whichever engine they reached.</li>
<li>A deploy reaches every engine.</li>
</ul>
<p>Step-by-step set-ups for one machine, two machines, engines only and Docker are in <a href="#ch-cluster">Setting up a cluster, step by step</a>. <code>SUTRA_CAN_LEAD=0</code> keeps an engine from ever leading.</p>
<p>Engines with <code>SUTRA_WORKERS=0</code> only serve APIs. <code>sutra status</code> or <code>GET /api/engine/status</code> lists the engines, the leader and the queue.</p>
<p class="h">Stopping without losing work</p>
<p>On <code>docker stop</code>, Ctrl+C or <code>POST /api/engine/drain</code>, an engine:</p>
<ol>
<li>reports not ready, so load balancers stop sending it requests;</li>
<li>hands leadership over;</li>
<li>lets running steps finish for <code>SUTRA_DRAIN_MS</code>, and hands the rest back to the queue for another engine;</li>
<li>closes.</li>
</ol>
<p class="h">Monitoring</p>
<table class="t"><thead><tr><th>What</th><th>Where</th></tr></thead><tbody>
<tr><td>Liveness and readiness</td><td><code>/health</code>, <code>/ready</code> on the admin port</td></tr>
<tr><td>Metrics</td><td><code>/metrics</code> (Prometheus): runs, steps by outcome, retries, durations, gateway requests, queue, leader, listeners</td></tr>
<tr><td>Traces</td><td>Set <code>OTEL_EXPORTER_OTLP_ENDPOINT</code>: each run is a trace with a span per step, continuing a caller's <code>traceparent</code></td></tr>
<tr><td>Logs</td><td><code>SUTRA_LOG_FORMAT=json</code>: one JSON line per event on standard output, plus each project's log file</td></tr>
</tbody></table>
<p class="h">Runs</p>
<p>Finished runs older than <code>SUTRA_RUN_RETENTION_DAYS</code> (30 by default) are deleted; waiting runs are kept. A failed run can continue with <strong>Run again from the failed step</strong> in Runs: the failed step runs again with the same input, and the earlier steps' results are kept.</p>
<p class="h">Checklist</p>
<ol>
<li>Set <code>SUTRA_MASTER_KEY</code> from your secret store, the same on every engine.</li>
<li>Keep the studio on 127.0.0.1 or behind a VPN. Expose only the engines' gateway ports, behind a load balancer pointed at <code>/ready</code>.</li>
<li>Set a long <code>SUTRA_ADMIN_TOKEN</code>; give it only to the release pipeline.</li>
<li>Set the gateway certificate and require HTTPS in every API policy.</li>
<li>Put environment-specific values in the deployment config, with <code>\${env:NAME}</code> for anything secret or host-specific.</li>
<li>Release with packages; keep the files, they are your rollback.</li>
<li>Back up the database (or the <code>data</code> folder).</li>
</ol>
<p>The full operations guide is <code>docs/deployment.md</code> in the SutraFlow folder.</p>`,
  },
  {
    id: 'cluster', title: 'Setting up a cluster, step by step',
    html: `
<p>A cluster is several SutraFlow processes (a studio and engines) sharing one PostgreSQL database. They share the work, and keep running when one of them stops. This chapter sets one up from scratch, for each common layout.</p>
<p class="h">What every engine does, and what the leader does</p>
<p>Every process of a cluster is an <strong>engine</strong>: it runs steps, and it serves the <strong>gateway</strong> (REST, SOAP, WebSocket, MCP and agent services) on its own ports, applying the services' API security policies itself. There is no central gateway: a caller reaches whichever engine the load balancer picks, and that engine checks the caller, starts the run and answers.</p>
<p>One engine at a time is also the <strong>leader</strong>. The leader runs what must happen <em>once</em> in the cluster, not once per engine:</p>
<table class="t"><thead><tr><th>Every engine</th><th>The leader as well</th></tr></thead><tbody>
<tr><td>Runs steps from the shared work queue (each step exactly once)</td><td>Timers (each timer fires once, not once per engine)</td></tr>
<tr><td>Serves the gateway: REST, SOAP, WebSocket, MCP, chat, OpenAI-compatible and A2A</td><td>Listeners: folders, SFTP and FTP, mailboxes, queues and topics, Drive, Microsoft files, Discord, Telegram, Twitch, Data Factory, WebSocket client streams</td></tr>
<tr><td>Applies API security policies, validation and threat protection to its callers</td><td>Recovery: steps of an engine that stopped are put back in the queue for the others</td></tr>
<tr><td>Writes a heartbeat every 5 seconds</td><td>Run time limits, queued runs, alerts (every 30 seconds) and housekeeping (old runs, logs, audit)</td></tr>
<tr><td>Reloads deploys and settings on its next heartbeat</td><td>Forgetting engines that have been silent for ten minutes</td></tr>
</tbody></table>
<p>The leader holds a <em>lease</em> in the database and renews it every heartbeat. If it stops renewing (stopped, crashed, cut off), the lease runs out after three heartbeats (15 seconds) and another engine takes it, starting the timers and listeners there. Nothing needs to be told: there is no leader to configure, only engines that may or may not lead (below).</p>
[[note:Leader and gateway are separate|Security does not depend on the leader: each engine checks its own callers with the same policies, read from the shared database. A cluster whose leader stops keeps serving APIs on every other engine without a pause; only timers and listeners wait up to 15 seconds for the new leader.]]
<p class="h">The settings that make a cluster</p>
<table class="t"><thead><tr><th>Setting</th><th>On every process</th></tr></thead><tbody>
<tr><td><code>SUTRA_DB</code></td><td>The same PostgreSQL address (<code>postgres://user@host:5432/sutraflow</code>), with <code>SUTRA_DB_PASSWORD</code> when it needs a password.</td></tr>
<tr><td><code>SUTRA_MASTER_KEY</code></td><td>The same key on every machine (it decrypts the vault). Copy it from the first machine's <code>data/master.key</code>, or put it in each <code>sutraflow.env</code>.</td></tr>
<tr><td><code>SUTRA_ENGINE_ID</code></td><td>Different on every process: its name in the cluster. The launcher names them <code>&lt;computer&gt;-studio</code> and <code>&lt;computer&gt;-engine</code> (<code>STUDIO_ENGINE_ID</code>, <code>ENGINE_ENGINE_ID</code> in <code>sutraflow.env</code> to choose).</td></tr>
<tr><td><code>SUTRA_ADMIN_TOKEN</code></td><td>Optional; the same long token lets one release pipeline talk to every engine.</td></tr>
<tr><td><code>SUTRA_CAN_LEAD</code></td><td><code>0</code> on engines that must never lead, for example machines that cannot reach the folders the folder triggers watch. At least one process must be able to lead.</td></tr>
<tr><td><code>SUTRA_PG_POOL</code></td><td>Optional: connections per engine. Keep <em>processes &times; (pool + 1)</em> under PostgreSQL's <code>max_connections</code>.</td></tr>
<tr><td><code>SUTRA_PG_NOTIFY</code></td><td>PostgreSQL queue wake hint (default on). Set to <code>0</code> to use polling alone; polling always remains enabled.</td></tr>
</tbody></table>
<p class="h">Before you start: PostgreSQL</p>
<ol>
<li>Install PostgreSQL 14 or later on its own machine (or use a managed service). On one test machine, the local one will do.</li>
<li>Create a database and a user: <code>CREATE USER sutra_owner PASSWORD '...'; CREATE DATABASE sutraflow OWNER sutra_owner;</code></li>
<li>Allow the engine machines in <code>pg_hba.conf</code> (with <code>scram-sha-256</code>), and turn SSL on for anything that crosses a network.</li>
<li>If you already have data in SQLite, move it once: Admin Console &rarr; Server &rarr; Database, or <code>sutraflow db copy --to postgres://...</code> (see <a href="#ch-move-postgres">Moving to PostgreSQL</a>).</li>
</ol>
<p class="h">Layout 1: one machine, a studio and an engine</p>
<p>The simplest cluster, and a good way to try one: two processes on one server share the work, and one keeps serving while the other restarts.</p>
<ol>
<li>Install SutraFlow (<a href="#ch-start">Install and start the server</a>) and set <code>SUTRA_DB</code> in <code>sutraflow.env</code> to the PostgreSQL address.</li>
<li>Start the studio: <code>sutraflow start</code>. It listens on 4800, its gateway on 8080 and 8443.</li>
<li>Start an engine beside it: <code>sutraflow start engine</code>. It uses the same folder and settings, and listens on 4801, its gateway on 9080 and 9443 (<code>ENGINE_PORT</code>, <code>ENGINE_GATEWAY_HTTP</code>, <code>ENGINE_GATEWAY_HTTPS</code>).</li>
<li>Check: <code>sutraflow status</code>, or Admin Console &rarr; Engines: two engines alive, one marked <em>leader</em>.</li>
<li>Point your load balancer (or Apache or nginx on the same machine) at both gateways: 8080 and 9080, health check <code>/ready</code> on 4800 and 4801.</li>
<li>Start both with the machine: <code>sutraflow service</code> prints the systemd units or the Windows scheduled tasks, one for the studio and one for the engine.</li>
</ol>
<p class="h">Layout 2: two machines, the studio and an engine on one, an engine on the other</p>
<ol>
<li>On machine A, set up layout 1, or just the studio.</li>
<li>Copy <code>data/master.key</code> from machine A (or set <code>SUTRA_MASTER_KEY</code> on both).</li>
<li>On machine B, install SutraFlow, and in its <code>sutraflow.env</code> set the same <code>SUTRA_DB</code> and <code>SUTRA_MASTER_KEY</code>, and <code>SUTRA_ADMIN_HOST=0.0.0.0</code> only if a load balancer checks its <code>/ready</code> from another machine.</li>
<li>Start only an engine on B: <code>sutraflow start engine</code>. Machine B has no studio: design on A, deploy from A, and B picks the deploy up on its next heartbeat.</li>
<li>Check Admin Console &rarr; Engines on A: the engines of both machines are listed.</li>
<li>Add B's gateway (9080, 9443) to the load balancer.</li>
<li>Folder triggers: the leader may be either machine. Make the watched folders reachable from both (a shared drive), or set <code>SUTRA_CAN_LEAD=0</code> on B so A always leads (and A's engines take over from each other).</li>
</ol>
<p class="h">Layout 3: engines only, behind a load balancer, with a separate studio</p>
<p>For production: no designer on the servers that serve traffic.</p>
<ol>
<li>Keep the studio on a design or test server; build releases there (<a href="#ch-releases">Releases</a>) or from Git in a pipeline (<a href="#ch-cicd">CI/CD</a>).</li>
<li>On each production machine install SutraFlow with the same <code>SUTRA_DB</code> (the production database) and <code>SUTRA_MASTER_KEY</code>, <code>SUTRA_ENVIRONMENT=production</code>, and start engines only: <code>sutraflow start engine</code>. On a machine with many cores, a second process (another folder with other ports) uses them better than one big one.</li>
<li>Create the first administrator for the engines' Admin Console: <code>sutraflow cli user add admin --role administrator</code>.</li>
<li>Deploy a release: <code>sutra deploy release.zip</code> against any engine (with its admin token), or drop the package in <code>SUTRA_DEPLOY_DIR</code>; every engine loads it.</li>
<li>Put the load balancer in front of every engine's gateway port, health check <code>/ready</code>. Leave the admin ports (4801) on the private network.</li>
</ol>
<p class="h">Layout 4: Docker</p>
<p><code>sutraflow docker cluster up</code> starts <code>docker-compose.cluster.yml</code>: PostgreSQL, a studio and two engines with the shared settings filled in. To add engines, copy the <code>engine-2</code> service as <code>engine-3</code> and so on, each with its own <code>SUTRA_ENGINE_ID</code>.</p>
<p class="h">Which layout</p>
<table class="t"><thead><tr><th>Need</th><th>Layout</th></tr></thead><tbody>
<tr><td>One server, more throughput, restarts without downtime</td><td>1: studio and engine on one machine</td></tr>
<tr><td>Survive the loss of a machine</td><td>2 or 3, with PostgreSQL replicated or managed</td></tr>
<tr><td>Separate design from production</td><td>3: engines only in production</td></tr>
<tr><td>Containers or Kubernetes</td><td>4: Docker, one engine per container</td></tr>
</tbody></table>
<p class="h">Checking a cluster</p>
<ul>
<li>Admin Console &rarr; Engines: every engine, alive or not, the leader, steps running, <em>never leads</em> where set; drain one from there.</li>
<li><code>sutraflow status</code> or <code>GET /api/engine/status</code>: the same as JSON.</li>
<li><code>/metrics</code>: <code>sutra_engine_leader</code> is 1 on exactly one engine; <code>sutra_engines_alive</code> counts the others.</li>
<li>To restart an engine without losing work: <code>sutraflow stop engine</code> drains it (running steps finish or go back to the queue), then start it again.</li>
</ul>
[[tip:Try a failover|With two engines running, stop the leader (sutraflow stop). Within 15 seconds the other one shows as leader in Engines, and its timers fire. Calls to the remaining gateway never stopped.]]`,
  },
  {
    id: 'sizing', title: 'Sizing and performance',
    html: `
<p>How much work a server takes, what to run on which machine, and the settings that change it. Every number here was measured with the load test that comes with SutraFlow (<code>tools/loadtest.mjs</code>), on the machine named under each table; run it on your own servers before you size production.</p>

<p class="h">What a step costs</p>
<p>A Sutra runs <strong>durable</strong> by default: before a step starts, it is a row in the work queue, and when it ends, its output, the run state and the next steps are written in one database transaction. That is why a run survives a crash, a restart or a redeploy, and why it can wait for days for an approval. The price is a few database round trips per step. For most integrations this does not matter: a step that calls an API or a database takes 20 to 500 ms, and the engine's own work is 2 to 5 ms of it.</p>
<p>It matters when a Sutra has many tiny steps and must answer fast, such as a REST service that maps a request, checks it and replies in 30 ms. For those, a Sutra can run <strong>in memory</strong>.</p>

<p class="h">Durable or in memory</p>
<table class="t"><thead><tr><th></th><th>Durable (default)</th><th>In memory</th></tr></thead><tbody>
<tr><td>Where the steps live while the run is open</td><td>The database</td><td>A private in-memory database of the engine</td></tr>
<tr><td>Written to the database</td><td>Every step</td><td>Once, when the run ends: the run and all its steps</td></tr>
<tr><td>A restart or crash while the run is open</td><td>The run carries on, on this engine or another</td><td>The run is lost (the caller gets an error or no answer)</td></tr>
<tr><td>Waits: approvals, Ask a person, Call Sutra with wait</td><td>Yes</td><td>No: the tuning is refused, or the step fails with the reason</td></tr>
<tr><td>Wait steps, timers, retries with a delay</td><td>Yes</td><td>Yes, within the engine</td></tr>
<tr><td>Run history, logs, resubmit</td><td>Yes</td><td>Yes, once the run has ended</td></tr>
<tr><td>Seen in Runs while open, cancel</td><td>Yes</td><td>Cancel yes; the run shows up in Runs when it ends</td></tr>
<tr><td>Small steps per second, one engine (measured below)</td><td>about 120 on PostgreSQL, 520 on SQLite</td><td>about 460 on PostgreSQL, 680 on SQLite</td></tr>
<tr><td>Which engine runs it</td><td>Any engine of the cluster takes the next step</td><td>The engine that started it runs all its steps: spread the callers over the engines (a load balancer in front of the gateways)</td></tr>
</tbody></table>
<p>Set it per deployed Sutra: <em>Admin Console &gt; Applications &gt; the Sutra &gt; Tuning &gt; Execution</em>, or <code>sutra sutras tune "Quote API" --project Shop --execution in-memory</code>. Tests and debugging in the designer always run durable.</p>
[[tip:Choosing|In memory suits short request-reply Sutras (REST, SOAP and MCP services, lookups, mappings, validations) where a lost run is simply retried by the caller. Keep durable everything that moves money or data one way (orders, payments, file transfers, queue consumers that acknowledge), everything that waits, and every long run.]]

<p class="h">Machine profiles</p>
<p>When the environment does not set them, an engine takes its <em>Steps at once</em>, <em>Queue check</em> and <em>Settings refresh</em> from the profile of the machine it runs on: the smaller of what its cores and its memory allow. The engine reads its machine each time it starts, so the advice is for each install: a laptop, an Azure or Google VM of 2 vCPU, a container held to 1 core (a container limit counts). In a cluster, each engine reads its own machine.</p>
<p><em>Steps at once</em> counts steps, not Sutras or palettes: a step is one activity box running in one run. With 32, an engine runs up to 32 boxes at the same moment, from any runs of any Sutras; the rest wait in the queue for a moment. <em>Admin Console &gt; Engines &gt; Tuning &gt; This machine</em> shows the profile of the server, with <strong>Apply recommended tuning</strong>; <code>sutra engines machine</code> prints it.</p>
[[img:console-machine|Admin Console, Engines: the profile of this machine and its recommended tuning]]
[[profiles]]
<ul>
<li><strong>Steps at once</strong> is more than the cores because most steps wait for a network or a database, and an engine runs other steps meanwhile. It does not speed up steps that only compute: in the measurements below, 32 steps at once did no better than 16. Raise it for Sutras that mostly wait (APIs, AI); lower it when steps compute (big mappings, scripts) and the engine CPU is near 1 core.</li>
<li>One engine is one Node.js process and uses about one core for its own work. To use more cores, run <strong>more engines</strong> on the same machine against PostgreSQL (the launcher starts them: <code>sutraflow start engine</code>), not more steps at once.</li>
<li><strong>Node memory</strong> is the heap limit to give each engine: <code>NODE_OPTIONS=--max-old-space-size=384</code> on the smallest machines, so the operating system and the database keep the rest.</li>
<li><strong>SQLite</strong> runs inside the engine, with nothing to install: about 420 small steps a second on one engine. Use it on small machines (a PostgreSQL server needs its own few hundred MB) and for most single servers. <strong>PostgreSQL</strong> runs many steps' database work at the same time through a pool: about 720 small steps a second on one engine on the same machine, and 1,600 with four. Use it for several engines or machines, for failover, for a busy single server, or when the database must be managed apart, ideally on a machine (or a managed service) of its own.</li>
</ul>

<p class="h">SQLite or PostgreSQL</p>
<p><strong>For smaller workloads, use SQLite.</strong> It is the default, needs nothing installed and nothing to look after: the database runs inside the engine. Measured with REST calls on one engine, SQLite ran about <strong>420 small steps a second</strong>; held to one core and 512 MB, 365 a second durable and 750 in memory. PostgreSQL on the same machine ran about 720 on one engine (since 1.7.6 the engine works with PostgreSQL through a pool of connections) and 1,600 with four engines, so a busy server with a PostgreSQL server to hand gains from it.</p>
<table class="t"><thead><tr><th>Use SQLite when</th><th>Use PostgreSQL when</th></tr></thead><tbody>
<tr><td>One server runs SutraFlow (a VM, a desktop, a Raspberry Pi class box)</td><td>Several engines share the work, on one machine or several</td></tr>
<tr><td>Small and medium workloads: up to millions of steps a day</td><td>You need failover: another engine takes over when one stops</td></tr>
<tr><td>Request-reply APIs and short Sutras at moderate volume</td><td>Runs must survive the loss of the whole machine (PostgreSQL replicated or managed)</td></tr>
<tr><td>Steady load up to a few hundred steps a second</td><td>A busy server that needs more (PostgreSQL ran about 70% more on one engine, four times as much with four)</td></tr>
<tr><td>Small machines (1 to 2 GB): no database server to feed</td><td>Your company requires databases to be run, backed up and monitored by its DBAs</td></tr>
<tr><td>Development, testing, demos, edge sites, departments</td><td>Run history must be queried by other tools while SutraFlow runs</td></tr>
</tbody></table>
<p>Getting the most out of SQLite:</p>
<ul>
<li>Keep the data folder on a <strong>local disk</strong>, ideally an SSD. Never on a network share (SMB, NFS): SQLite's locking is not safe there, and every write waits for the network.</li>
<li>Run <strong>one engine</strong> per data folder; for more throughput on the same machine, use Sutras that run <em>in memory</em> and raise <em>Steps at once</em> before you think of more engines. (Several engines on one SQLite file work, but they take turns to write, so they add little.)</li>
<li>Keep the database small: <em>Keep finished runs</em> at 7 to 30 days, and <em>Step data in history</em> on <em>errors only</em> or <em>none</em> for busy Sutras. A small database stays fast and backs up in seconds.</li>
<li>Back up while it runs with <code>sqlite3 sutra.db ".backup copy.db"</code>, or stop SutraFlow and copy the data folder, together with <code>master.key</code> kept apart.</li>
<li>When you outgrow it (several engines, failover), the move to PostgreSQL is one button: see <a href="#ch-move-postgres">Moving to PostgreSQL</a>. Nothing in the Sutras changes.</li>
</ul>
[[tip:Rule of thumb|One server with a moderate load: SQLite, with the least to look after. A busy server, more than one engine, or a need for failover: PostgreSQL, ideally on a machine of its own.]]

<p class="h">What to run on which machine</p>
<table class="t"><thead><tr><th>Machine</th><th>Good for</th><th>Avoid</th></tr></thead><tbody>
<tr><td><strong>1 vCPU, 1 GB</strong><br>(a small cloud VM, a Raspberry Pi class box)</td><td>Timers and file moves, a few REST or SOAP services, webhooks, email and chat notifications, SFTP transfers, CSV files of any size streamed in batches. Measured on one core with 512 MB and SQLite: 365 small durable steps a second (1.3 million an hour), 750 in memory. Real steps that call APIs take longer, so plan for tens of thousands of runs a day.</td><td>Local AI models, Python steps that load big libraries, files read whole over 10 MB, a database server on the same machine, many Sutras with Runs at once above 20.</td></tr>
<tr><td><strong>2 vCPU, 2 to 4 GB</strong></td><td>A department's integrations: tens of Sutras, REST APIs with in-memory Sutras for the fast ones, AI agents that call a cloud model, RAG over a folder with the built-in store, files read whole up to 25 MB.</td><td>Local models above 3B parameters, PostgreSQL on the same machine with heavy runs.</td></tr>
<tr><td><strong>4 vCPU, 8 GB</strong></td><td>Production for a company: two engines and PostgreSQL, hundreds of Sutras, queue consumers (Kafka, RabbitMQ), databases, Databricks and Data Factory orchestration, small local models (Ollama phi4-mini class) for light use.</td><td>Many local-model calls at once.</td></tr>
<tr><td><strong>8 vCPU, 16 GB</strong></td><td>Heavy traffic: four engines, high-volume APIs, large file and data movements, local models of 7 to 8B parameters, vector stores (pgvector).</td><td>Running the model, the database and the engines all on one machine at peak load.</td></tr>
<tr><td><strong>16 vCPU and more</strong></td><td>A cluster member, or several engines plus a gateway; PostgreSQL on its own machine.</td><td>A single engine: it would use only a fraction of the machine.</td></tr>
</tbody></table>

<p class="h">Files: what size to read whole</p>
<ul>
<li>A file read whole is held in memory several times over (bytes, text, rows, the step output), about <strong>5 to 8 times its size</strong> for CSV. Keep <em>Maximum size</em> of [[fileRead]] at or below the profile's <em>Read files whole up to</em>.</li>
<li>Bigger CSV and line files: tick <strong>Stream in batches</strong> (see <a href="#ch-files">Files</a>). Memory then depends on the batch, not the file: a batch of 1,000 rows of 200 bytes is about 1 MB as data.</li>
<li>JSON and XML are read whole. For very big ones, ask the source for paged or line-delimited output (one JSON document per line, read as lines and streamed).</li>
<li>Binary files (base64) grow by a third in memory as text; move big binary files with [[fileMove]] or SFTP, which stream, rather than reading them.</li>
<li>Each step output is kept in the run history up to 1 MB (bigger ones are cut to a preview). For Sutras that handle big data, set <em>Step data in history</em> to <em>errors only</em> or <em>none</em>.</li>
</ul>

<p class="h">Settings that change throughput</p>
<table class="t"><thead><tr><th>Setting</th><th>Where</th><th>Effect</th></tr></thead><tbody>
<tr><td>Steps at once</td><td>Engine tuning; <code>SUTRA_WORKERS</code></td><td>Steps one engine runs together. Too low: steps wait in the queue (see Queue wait in the Overview). Too high: memory and the database get busy.</td></tr>
<tr><td>Steps at once in memory</td><td>Engine tuning; <code>SUTRA_MEMORY_WORKERS</code></td><td>The same for Sutras that run in memory; 0 = as Steps at once.</td></tr>
<tr><td>Queue check</td><td>Engine tuning; <code>SUTRA_POLL_MS</code></td><td>How often an idle engine looks for due steps. Steps queued on the same engine start at once anyway; this only delays steps queued by another engine and retries. Lower answers sooner, higher saves database reads on small machines.</td></tr>
<tr><td>Settings refresh</td><td>Engine tuning; <code>SUTRA_SETTINGS_REFRESH_MS</code></td><td>How long an engine keeps Project and Engine properties before reading them again (a local administrator change applies at once, and the cluster signal clears other engines).</td></tr>
<tr><td>Execution</td><td>Sutra tuning</td><td>Durable or in memory (above).</td></tr>
<tr><td>Runs at once, Priority</td><td>Sutra tuning</td><td>Protect a slow back end; let urgent Sutras go first.</td></tr>
<tr><td>Step data in history</td><td>Sutra tuning</td><td><em>none</em> or <em>errors only</em> keeps the database small for busy Sutras.</td></tr>
<tr><td>Keep finished runs</td><td>Engine and Sutra tuning</td><td>Fewer days, smaller database, faster history.</td></tr>
</tbody></table>

<p class="h">Measurements</p>
<p>The load test starts a studio and engines on a database of their own and runs a benchmark Sutra: a trigger and ten Transform steps, each computing a little and putting out the size of data shown. It counts finished steps per second, the time steps waited in the queue and took, what the database did, and the CPU and memory of the engines. Engines and PostgreSQL ran on the <strong>same</strong> machine, so the database took cores from the engines: a real cluster with PostgreSQL on its own server does better with several engines.</p>
[[benchmarks]]
<ul>
<li><strong>What changed in this release.</strong> Engines used to take one lock for every write in the cluster, so a second engine added nothing (82 steps a second with one engine or two); each run now has its own lock, and engines claim steps with <em>skip locked</em>. Project and Engine properties are cached for the settings refresh time instead of read for every step; the run state, step count and status are saved in one statement. Database transactions per step went from 14 to 7, and one engine went from 82 to about 120 steps a second. In memory, a step costs less than one transaction.</li>
<li><strong>More engines</strong> scale when callers reach all of them, as behind a load balancer: with REST calls spread over the gateways, four engines did about three times the durable steps of one (352 against 116 a second), and in memory 1,660 against 540. When every run starts on one engine (a single timer, say), the others only help with the following steps, and in-memory runs not at all.</li>
<li><strong>Bigger outputs cost more</strong>: each step writes its own output and reads the earlier ones. Since 1.8.0 (outputs kept apart from the run state) one engine on PostgreSQL ran 145 steps a second with 64 KB outputs (60 before), 40.7 with 256 KB (14.3) and 7.7 with 1 MB (2.6). For steps that pass large data along, keep the data in a file or a table and pass its name, or stream it.</li>
<li>No run failed and none was lost in any scenario, including the one where an engine was killed.</li>
</ul>

<p class="h">Soak test: hours of mixed load, unattended</p>
<p><code>tools/soak.mjs</code>, in the source repository (it is a test tool, not part of the release packages), runs a studio and engines on a PostgreSQL database of their own for hours and writes its own report (<code>report.md</code> and <code>report.html</code>, with charts), so nobody has to watch it:</p>
<pre class="code">node tools/soak.mjs --pg postgres://postgres@db:5432/postgres --hours 8
node tools/soak.mjs --pg ... --hours 24 --share //fileserver/soak     # the folder trigger watches a real share
node tools/soak.mjs --report-only docs/benchmarks/soak-1.8.0               # the report again, from the samples</pre>
<ul>
<li><strong>Every starter that runs on one machine</strong>: REST (plain, in memory, HMAC with schema validation), SOAP (UsernameToken; X.509 signed and encrypted), WebSocket service and client, timer, called Sutras with approvals, the error handler, channels, MCP, a message bus (a stand-in AMQP 1.0 broker), and an AI agent and RAG answers on a local Ollama model.</li>
<li><strong>Big files, all streamed</strong>: CSV files of 10 to 60 MB to a watched folder, over SFTP and over FTP; documents of 10 to 60 MB learned in batches into a pgvector table; and Google Drive uploads and downloads of the same sizes when an account is set up (below).</li>
<li><strong>Faults on purpose</strong>: an engine is killed a third of the way in and started again a minute later, and the database is cut for 20 seconds two thirds of the way in.</li>
<li><strong>Unattended</strong>: the tool's own database connections are tried 10 times; an engine that stops by itself is started again, at most 10 times. Samples and events are written every minute, so a report can be made even from a run that was stopped.</li>
<li><strong>Checks</strong>: no engine stopped by itself, no run left running, no step run twice, failed requests under 0.5%, timers on time, every channel, bus and WebSocket message handled, every file's rows all counted, memory steady, engines responsive (event loop delay), and each scenario as fast at the end as at the start.</li>
</ul>
<p><strong>The 1.8.0 run</strong> (8 hours, a studio and two engines, PostgreSQL on the same machine): 500,338 requests with 0.089% failed, the engine kill and the database cut included; no step ran twice and no run was left open; 50 CSV files of 10 to 60 MB streamed whole; 328,490 passages learned into pgvector; engines kept a typical event loop delay of 35 ms. Report and notes: <code>docs/benchmarks/soak-1.8.0</code>.</p>
<p>For Google Drive, set <code>SOAK_GOOGLE_CLIENT_ID</code>, <code>SOAK_GOOGLE_CLIENT_SECRET</code> (a Desktop app OAuth client of your Google Cloud project) and <code>SOAK_DRIVE_FOLDER</code> (the folder id), then run <code>node tools/soak.mjs --google-sign-in</code> once and sign in in the browser: the refresh token is kept in <code>data/soak-google.json</code>, outside Git. The soak then uploads files of each size to that folder (replacing the earlier one of the same size) and fetches them back.</p>
<p class="h">Run the load test on your own servers</p>
<pre class="code">node tools/loadtest.mjs --pg postgres://user:pass@db:5432/postgres --engines 1,2,4 --payload 0.1,64 --out results.json
node tools/loadtest.mjs --sqlite --cpus 1 --mem 512 --workers 4 --execution durable,memory
node tools/loadtest.mjs --pg ... --engines 2 --kill        # kill one engine under load, check nothing is lost
node tools/loadtest.mjs --pg ... --soak 60                 # an hour of timers, waits, failures and a redeploy
node tools/bigfiletest.mjs --mb 1000 --mem 384             # stream a 1 GB file with a 384 MB heap</pre>
<p>The PostgreSQL address is an administrator connection: the test makes a database of its own for each scenario and drops it afterwards. <code>--cpus</code> and <code>--mem</code> hold each engine to that many cores and that heap, the closest a big machine gets to a small server. Compare <em>Queue wait</em>: when it grows, the engines are full; add steps at once (I/O-bound work) or engines (CPU-bound work).</p>`,
  },
  {
    id: 'trouble', title: 'Troubleshooting',
    html: `
<table class="t"><thead><tr><th>Symptom</th><th>Cause and remedy</th></tr></thead><tbody>
<tr><td>A mapping shows <em>not run</em></td><td>The activity was on a branch that was not taken in the last test. Test with data that takes that branch.</td></tr>
<tr><td>An API caller waits a minute, then gets 504</td><td>A branch ended without [[httpResponse]] or [[soapReply]]. Add replies on every branch, including error branches.</td></tr>
<tr><td>A timer or file trigger does nothing</td><td>Only the deployed version listens. Deploy, then check listener health on the Designer's <strong>Services</strong> page.</td></tr>
<tr><td>Required fields not mapped</td><td>The Input tab names them. Map them, or remove the requirement from the schema.</td></tr>
<tr><td>Formula error</td><td>The preview under the formula names the problem: an unknown function, a missing bracket, or a quote not doubled.</td></tr>
<tr><td>The run stops after 10000 steps</td><td>A loop that never ends. Check the condition that leaves it.</td></tr>
<tr><td>Let's Encrypt fails</td><td>Port 80 on the domain must reach the gateway's HTTP port.</td></tr>
</tbody></table>`,
  },
];
