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
<li><strong>The studio</strong> at <code>http://127.0.0.1:4800</code>: the Designer, Runs, Resources and Server &amp; APIs screens.</li>
<li><strong>The engine</strong>, which runs Sutras step by step and saves each finished step, so runs survive a restart and long waits cost nothing.</li>
<li><strong>The gateway</strong> on ports 8080 (HTTP) and 8443 (HTTPS), which serves deployed APIs, separately from the studio.</li>
</ul>
[[note:Words used in this guide|A <em>project</em> holds Sutras, shared resources (connections), schemas and variables. A <em>Sutra</em> is one process diagram. An <em>activity</em> is one box on it; a <em>step</em> is one execution of an activity in a run; a <em>run</em> is one execution of a Sutra. <em>Sutra variables</em> live for one run, <em>Project variables</em> are shared by a project's Sutras, and <em>Sengine variables</em> are server settings made by the administrator.]]
[[img:designer|The Designer: palettes on the left, the process in the middle, the selected activity's tabs on the right.]]`,
  },
  {
    id: 'start', title: 'Install and start the server',
    html: `
<p>SutraFlow needs Node.js 22.13 or later; version 24 is recommended. Nothing else is installed: the database is SQLite, built into Node.</p>
<p class="h">Procedure</p>
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
[[tip:Guidelines|Back up the <code>data</code> folder, and above all <code>data/master.key</code>: without it the encrypted secrets cannot be read.<br>Keep the studio on 127.0.0.1. Publish APIs through the gateway ports, not the studio port.]]
<p class="h">Server settings</p>
<table class="t"><thead><tr><th>Environment variable</th><th>Default</th><th>Meaning</th></tr></thead><tbody>
<tr><td><code>SUTRA_DATA_DIR</code></td><td><code>./data</code></td><td>Database, master key, deployment config files.</td></tr>
<tr><td><code>SUTRA_MASTER_KEY</code></td><td>the key file</td><td>The vault key, 32 bytes in base64.</td></tr>
<tr><td><code>SUTRA_ADMIN_HOST</code>, <code>SUTRA_ADMIN_PORT</code></td><td>127.0.0.1, 4800</td><td>Where the studio listens.</td></tr>
<tr><td><code>SUTRA_GATEWAY_HTTP_PORT</code>, <code>SUTRA_GATEWAY_HTTPS_PORT</code></td><td>8080, 8443</td><td>Gateway ports until changed in Server &amp; APIs.</td></tr>
<tr><td><code>SUTRA_WORKERS</code></td><td>16</td><td>Steps that run at the same time.</td></tr>
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
<p>The top bar holds the four screens, the version in the middle, <strong>Admin Console</strong> (deployed projects, engines, gateway, users and audit, in its own page), <strong>Guide</strong> (this guide in a new tab), the light/dark switch and Sign out.</p>
<table class="t"><thead><tr><th>Screen</th><th>What it is for</th></tr></thead><tbody>
<tr><td><strong>Designer</strong></td><td>Building, testing, debugging and deploying Sutras. Left: the <em>Project</em> explorer and the <em>Palettes</em>. Middle: the canvas and its toolbar. Right: the selected activity's General, Input, Output and Settings tabs.</td></tr>
<tr><td><strong>Runs</strong></td><td>Every run with its status, steps, inputs and outputs, logs; approvals waiting for a person.</td></tr>
<tr><td><strong>Resources</strong></td><td>Shared connections and security of the current project, and the secrets vault.</td></tr>
<tr><td><strong>Server &amp; APIs</strong></td><td>Exposed services, Sengine variables, gateway ports, TLS certificate, active listeners.</td></tr>
</tbody></table>
<p class="h">The Designer toolbar</p>
<ul>
<li><strong>Sutra list</strong>: opens another Sutra of the project.</li>
<li><strong>+ New Sutra</strong>: a blank Sutra or a starter (REST API, SOAP service, approval with timer).</li>
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
<li>The <strong>⋯</strong> button beside a Sutra moves it by typing or picking a folder. Beside a folder it renames or moves the folder with everything in it, makes a folder inside, or removes the folder. Removing a folder never deletes Sutras: they move up one level.</li>
<li>A new Sutra goes in the folder of the Sutra open at the time.</li>
<li>Samples go to <code>Samples/&lt;topic&gt;</code>, for example <em>Samples/SQL</em> and <em>Samples/REST and microservices</em>, and the connections made for them to <em>Resources &gt; Samples</em>. Samples added before folders existed were filed there once, when the server was updated. Move them anywhere afterwards.</li>
<li>Packages and project copies keep each item's folder.</li>
<li>Importing chosen Sutras (a new project from a package or a copy) brings the connections, schemas and service descriptors those Sutras use, directly or through each other (an MCP server and its policy), in their folders, and nothing else.</li>
</ul>
<p class="h">Project log</p>
<p><em>Configuration &gt; Project log</em> shows what this project's runs wrote to its log file (set it up under <em>Logging</em>), newest at the bottom. Filter by level, by <em>Runs from</em> (deployed Sutras or designer tests) and by words; refresh it every 5 seconds; download what is shown. Every line carries two tags: the server it ran on (<em>production</em>, <em>test</em>, <em>development</em>) and the run, <em>deployed v3</em> for a deployed Sutra and its version, or <em>editor test</em> / <em>editor debug</em> for the designer's own runs. In the file a line reads <code>2026-10-19T09:12:03Z INFO  {development, editor test} [Orders / 3f2a91c0 / Check stock] ...</code>.</p>
<p><strong>Clear log</strong> empties the file and its rotated copies; <strong>Clear test runs</strong> deletes the finished test and debug runs of the project and keeps deployed runs. Developers may do both on development and test servers; on a production server only an administrator may. Both are recorded in the audit log.</p>
<p class="h">Missing project variables</p>
<p>When a step reads a project variable the project does not define (<code>{{gv.X}}</code>, <code>{gv.X}</code>, <code>$gv.X</code> in JSONata or <code>get-project-variable('X')</code>), the activity shows ⚠ on the canvas and a warning at the top of its tabs, and it reads as empty while running. The same warning shows on a connection that reads one, and on every step that uses that connection. <strong>Add to project variables</strong> adds the missing names; give them values under <em>Configuration &gt; Project variables</em>. <em>Deploy</em> lists the same warnings.</p>
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
<p><strong>My Git accounts</strong> holds your personal access tokens for each server. They are encrypted, never shown again, and used only for your pull and push; nobody else, not even an administrator, can see them or push with them. Commits carry the account's author name and email, or your own. Each provider says which token to make (GitHub: a fine-grained token with Contents read and write). Public repositories clone without an account. Sign-in with a GitHub, GitLab or Bitbucket button comes later, once an administrator registers an app with them.</p>
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
<li>Click <strong>+ New Sutra</strong> and choose a starter, or start blank.</li>
<li>Drag a <strong>trigger</strong> from the Triggers palette (or keep Manual start). A Sutra has one trigger.</li>
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
<tr><td><strong>When a condition is true</strong></td><td>A formula on the previous activity's output, which it reads as <code>{input.x}</code>; for example <code>={input.amount} &gt; 1000</code> named <em>Order &gt; 1000</em>. Several "when" connections can be taken together.</td></tr>
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
<tr><td><strong>General</strong></td><td>The activity's name and its fixed settings: folders, URLs, methods, connections, formats. Fields with <strong>{x}</strong> accept project and Sengine variables (<code>{{gv.OUTBOX}}</code>, <code>{{ev.REGION}}</code>) and <code>=</code> formulas. <em>Map inputs</em> opens the Input tab.</td></tr>
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
=concat({gv.OUT}, '\\', current-timestamp('YYYYMMDD'), '.csv')
=set-project-variable('LAST_RUN', current-dateTime())</pre>
<p>Backslashes in quoted text are literal, so Windows paths need no escaping. Write a quote twice to include it: <code>'O''Brien'</code>. Function names ignore case. Every function is listed in <a href="#ch-functions">Function reference</a>.</p>
<p class="h">Templates in text fields</p>
<p>Text fields such as an email body or a log message use <code>{{ }}</code> templates with pipes: <code>Order {{input.id | upper}} for {{input.amount | number:2}}</code>. The pipes are listed in <a href="#ch-pipes">Template pipes</a>.</p>
[[tip:When to use JSONata instead|For heavy reshaping of repeating JSON (filter, group, total and nest in one go) a single [[jsonata]] activity is often clearer than many mapper rules.]]`,
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
<tr><td><strong>Sutra variables</strong></td><td><code>{vars.name}</code></td><td>Sutra properties; [[setVar]]</td><td>One run.</td></tr>
<tr><td><strong>Project variables</strong></td><td><code>{gv.NAME}</code>, <code>{{gv.NAME}}</code>, <code>get-project-variable('NAME')</code></td><td>Project &rarr; Configuration; the deployment config; <code>set-project-variable</code></td><td>Kept; a value set at run time lasts until the server restarts or the config changes.</td></tr>
<tr><td><strong>Sengine variables</strong></td><td><code>{ev.NAME}</code>, <code>{{ev.NAME}}</code>, <code>get-sengine-variable('NAME')</code></td><td>Server &amp; APIs (administrator)</td><td>Kept; shared by every project on the server. Sutras read them only.</td></tr>
</tbody></table>
<p>Project variables have a type: string, number, boolean or secret. A secret variable holds the name of a vault secret, never the value.</p>
[[tip:Read Sengine variables, do not change them|Sengine variables are mostly engine settings (a region, a data centre, a shared folder) that every project relies on. Read them in Sutras; change them only in Server &amp; APIs. <code>set-sengine-variable</code> works only when the administrator ticks <em>Allow Sutras to change Sengine variables</em>, and one Sutra could then change the behaviour of every project.]]
<p class="h">The deployment config file</p>
<p>Operations staff change settings per environment without opening the studio. The deployment config holds overrides for project variables, resource settings (hosts, ports, URLs, queue names) and logging. Export it from the project, edit it, and import it, or place it at <code>data/config/&lt;project&gt;.json</code>.</p>
<pre>{
  "variables": { "OUTBOX": "D:\\\\exports", "API_BASE": "\${env:ORDERS_API:-https://test.example.com}" },
  "resources": { "Orders DB": { "host": "\${env:DB_HOST}", "port": 5432 } },
  "logging":   { "path": "D:\\\\logs\\\\orders.log", "level": "info" }
}</pre>
<p><code>\${env:NAME}</code> reads an environment variable of the server; <code>\${env:NAME:-default}</code> gives a default.</p>
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
<p>The Runs screen lists every run: Sutra, version, trigger, status, time. Open one to see each step with its input, output, time and error, and the run log. <em>Approvals</em> lists runs waiting for a person.</p>
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
</ul>`,
  },
  {
    id: 'expose', title: 'Exposing APIs: security and TLS',
    html: `
<p>A [[restService]] or [[soapService]] trigger publishes the Sutra on the gateway. Server &amp; APIs lists every exposed service with its addresses and security policy.</p>
[[img:server|Server &amp; APIs: exposed services, engine variables, gateway ports and the TLS certificate.]]
<p class="h">API security policy</p>
<p>Create a policy in Resources &rarr; <em>API security policy</em> and pick it on the trigger. It checks, in order: HTTPS required, IP allow list (addresses or IPv4 ranges), caller authentication, then a rate limit per caller. CORS origins are optional.</p>
<table class="t"><thead><tr><th>Authentication</th><th>How callers prove who they are</th></tr></thead><tbody>
<tr><td>None</td><td>Open to anyone. For testing only.</td></tr>
<tr><td>Basic</td><td>User name and password; passwords are vault secrets.</td></tr>
<tr><td>API key</td><td>A key in a header; keys are vault secrets.</td></tr>
<tr><td>JWT bearer</td><td>A signed token, checked with a JWKS URL, a public key or a shared secret; issuer, audience and scopes.</td></tr>
<tr><td>WS-Security UsernameToken</td><td>SOAP only; password digest with a time window and replay protection.</td></tr>
<tr><td>Mutual TLS</td><td>A client certificate signed by the client CA set in Server &amp; APIs; optionally only listed subjects.</td></tr>
</tbody></table>
[[img:resources|Resources: an API security policy using API keys held in the vault.]]
<p class="h">TLS certificate of the gateway</p>
<ul>
<li><strong>Self-signed</strong>: for testing.</li>
<li><strong>Own certificate</strong>: paste the PEM chain and key; the key is checked against the certificate and stored encrypted.</li>
<li><strong>Let's Encrypt</strong>: enter the domains and an email. The gateway's HTTP port must be reachable as port 80 on each domain. Start with staging; certificates renew 30 days before they expire, without dropping connections.</li>
<li><strong>Client CA</strong>: enables mutual TLS for policies that use it.</li>
</ul>
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
</tbody></table>
<p>See [[httpRequest]] and [[soapInvoke]].</p>`,
  },
  {
    id: 'messaging', title: 'Messaging: Kafka, RabbitMQ and ActiveMQ',
    html: `
<p>The Service Bus palette works the JMS way: [[busPublish]] sends, [[busSubscribe]] starts a run per message, and [[busConfirm]] acknowledges at a point you choose.</p>
<ul>
<li>Put queue and topic names in project variables (<code>{{gv.ORDER_QUEUE}}</code>) so each environment can use its own.</li>
<li>JMS headers: delivery mode (persistent or not), priority, time to live, message id, correlation id, reply-to and type; plus your own properties.</li>
<li>Acknowledgement: <em>auto</em> on receipt, <em>client</em> after the run succeeds, <em>explicit</em> with Confirm message. On failure: requeue, or send to the dead-letter queue after a number of redeliveries.</li>
</ul>`,
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
<p class="h">SFTP and FTP servers</p>
<p>The <strong>SFTP / FTP</strong> palette works with files on another server: [[remoteTrigger]], [[remoteList]], [[remoteRead]], [[remoteWrite]] and [[remoteMove]]. Each step names the protocol and an <em>SFTP server</em> or <em>FTP server</em> connection.</p>
<ul>
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
    id: 'code', title: 'Custom code, HTML and AI',
    html: `
<ul>
<li>[[jsCode]] runs your JavaScript in a sandbox without host access, with time and memory limits.</li>
<li>[[htmlTemplate]] builds HTML with escaped placeholders, loops and conditions.</li>
<li>[[jsonata]] transforms JSON with one expression.</li>
<li>The <strong>Scripts</strong> palette runs [[powershell]], [[shellScript]] (bash, sh or cmd) and [[runProgram]] on the server, capturing the output, the error output and the exit code. An administrator must allow scripts in Server &amp; APIs first; values reach scripts as environment variables, never as script text.</li>
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
[[tip:Guidelines|Route AI decisions that matter (money, customers) through [[approval]] until you trust them.]]`,
  },
  {
    id: 'mcp', title: 'AI skills over MCP',
    html: `
<p>A Sutra that starts with an [[mcpTool]] trigger is a <strong>skill</strong>: AI assistants such as Claude connect to SutraFlow over the Model Context Protocol (MCP), see the skills, and call them. Each call runs the Sutra with the arguments the AI chose, and [[mcpReply]] sends the outcome back. Skills can do anything a Sutra does: write a CSV file, post to a Facebook page, look up an order in a database, start an approval.</p>
<p class="h">Build a skill</p>
<ol>
<li>Under Resources, add an <strong>MCP server</strong>: its address on the gateway (for example <code>/mcp/orders</code>), a title, instructions for the AI, and an API security policy. One server holds many skills.</li>
<li>Create a Sutra that starts with <strong>MCP skill</strong>, choose the server, and describe the tool: name, title, what it does and when to use it, and its inputs.</li>
<li>Build the work, and end every branch with <strong>Reply to AI</strong>; on error branches tick <em>Is an error</em>.</li>
<li>Test it in the studio with the trigger's test arguments, then Deploy. Server &amp; APIs lists each skill with its address.</li>
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
    id: 'secrets', title: 'Secrets and studio security',
    html: `
<ul>
<li>Passwords, keys and tokens live in the <strong>vault</strong> (Resources &rarr; Secrets), encrypted with AES-256-GCM. Settings hold the secret's <em>name</em>.</li>
<li>Secret values are never returned by the API. A secret used in a step is masked in stored outputs and logs.</li>
<li>The studio listens on 127.0.0.1 by default. Sessions are HttpOnly, SameSite=Strict cookies; every change needs a request header that browsers cannot forge across sites; repeated failed sign-ins are slowed down.</li>
</ul>`,
  },
  {
    id: 'releases', title: 'Releases: packages and the command line',
    html: `
<p>Build in the studio; release a <strong>package</strong>: one <code>.sutra</code> file with the whole project. It has every deployed Sutra at its version, the connections and API policies (secret names, never secret values), shared schemas and WSDLs, project variables and logging. The same file goes from test to production; each environment keeps its own deployment config and secrets.</p>
<p class="h">In the studio</p>
<ol>
<li>Open <strong>Project &rarr; Configuration &rarr; Releases (packages)</strong>.</li>
<li>Give a version, such as <code>1.4.0</code>, and a note, then <strong>Build and download</strong>.</li>
<li>On the target server, open the same panel, choose the file, read the check (missing secrets, addresses already used by another project), and <strong>Deploy</strong>.</li>
<li>The history lists every deployment; <strong>Deploy again</strong> or <strong>Roll back</strong> returns to an earlier package.</li>
</ol>
<p>Deploying matches everything by name. A Sutra whose content changed gets a new version; an unchanged one is left alone, so the same package twice changes nothing. Sutras not in the package are undeployed (kept, not deleted) unless you tick <em>Keep Sutras that are not in the package deployed</em>.</p>
<p class="h">From the command line or a CI pipeline</p>
<pre>sutra package  --project "Orders" --version 1.4.0 --out orders-1.4.0.sutra
sutra check    orders-1.4.0.sutra
sutra test     orders-1.4.0.sutra --secrets-from-env
sutra deploy   orders-1.4.0.sutra --server https://engine:4800 --token $TOKEN
sutra rollback --project "Orders" --server https://engine:4800 --token $TOKEN</pre>
<p>The token is a system account's API token (Admin Console, System accounts), limited to its roles, or the server's <code>SUTRA_ADMIN_TOKEN</code>. Without <code>--server</code> the tool works on the local data folder. Exit code 0 means success, 1 a failed check, test or deploy, 2 wrong usage. <code>sutra test</code> runs every Sutra of the package with its test data in a throw-away server.</p>
<p class="h">From a Sutra</p>
<p>The <strong>Release</strong> palette does the same steps inside a Sutra, so a release can itself be a Sutra: on a timer or a REST call, [[releasePackage]], [[releaseDeploy]] to a test engine, [[approval]], [[releaseDeploy]] to production, then [[emailSend]] the result. [[releaseCheck]] and [[releaseRollback]] complete it. These activities are off until an administrator allows them in Server &amp; APIs.</p>`,
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
    id: 'console', title: 'The Admin Console',
    html: `
<p>The Admin Console manages what is deployed: running projects and Sutras, approvals, engines, people, system accounts, roles and the audit log. Designing stays in the designer. Open it with <strong>Admin Console</strong> in the designer's top bar, or at <code>/admin</code> on the admin port (<code>http://127.0.0.1:4800/admin</code>). Headless engines serve the console too, without the designer.</p>
[[img:console-overview|The Overview: engines, deployed Sutras, runs of the last day, approvals, the work queue and the gateway, with recent failures.]]
<p class="h">Operate</p>
<ul>
<li><strong>Overview</strong>: tiles for engines, deployed Sutras, runs of the last 24 hours, waiting approvals, the work queue and the gateway certificate, and the latest failed runs with <em>Resubmit</em>. Test runs from the designer are not counted.</li>
<li><strong>Applications</strong>: every deployed project with its package version and its Sutras: version, started or stopped, what starts it (REST path, SOAP path, timer, skill), runs of the last day and the last run. <em>Stop</em> makes the Sutra's triggers start nothing (its address answers 404, timers and listeners pause) while it stays deployed; <em>Start</em> brings it back on every engine; <em>Restart</em> does both at once, so its address, timers and listeners start fresh with the current connections. <em>Runs</em> opens its runs with every step's result, <em>Resubmit</em> and <em>Cancel run</em>; <em>Versions</em> deploys an earlier version; <em>Tuning</em> sets how the Sutra runs (below); <em>Package history</em> rolls the project back to an earlier package.</li>
<li><strong>Approvals</strong>: running Sutras waiting for a person, with a comment and <em>Approve</em> or <em>Reject</em>.</li>
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
    id: 'production', title: 'Running in production: engines, Docker, clusters',
    html: `
<p class="h">Headless engines</p>
<p>The same program started with <code>SUTRA_MODE=engine</code> runs Sutras without the studio: no designer pages and no editing. It keeps <code>/health</code>, <code>/ready</code> and <code>/metrics</code>, the Admin Console at <code>/admin</code> for its users, and an automation API for API tokens (the admin token or system account tokens). Packages in <code>SUTRA_DEPLOY_DIR</code> are deployed when it starts; a package that cannot be deployed stops the start.</p>
<p class="h">Docker</p>
<pre>docker build -t sutraflow:1.0.0 .
docker run -e SUTRA_MODE=engine -e SUTRA_ADMIN_TOKEN=... -e SUTRA_MASTER_KEY=... \\
           -v ./deploy:/deploy:ro -p 8080:8080 sutraflow:1.0.0</pre>
<p>The image runs as a non-root user, checks its own health, and writes JSON logs. <code>docker-compose.yml</code> has a studio and an engine; <code>docker-compose.cluster.yml</code> has PostgreSQL, a studio and two engines.</p>
<p class="h">Clusters</p>
<p>Several engines share one database (<code>SUTRA_DB=postgres://...</code>), each with its own <code>SUTRA_ENGINE_ID</code> and all with the same <code>SUTRA_MASTER_KEY</code>.</p>
<ul>
<li>Work is shared, and each step is run by exactly one engine.</li>
<li>One engine leads and runs timers and folder, mailbox, queue and Drive listeners, so they fire once. If it stops, another takes over within a few heartbeats.</li>
<li>Steps of an engine that stopped are finished by another.</li>
<li>Callers get their replies from whichever engine they reached.</li>
<li>A deploy reaches every engine.</li>
</ul>
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
    id: 'trouble', title: 'Troubleshooting',
    html: `
<table class="t"><thead><tr><th>Symptom</th><th>Cause and remedy</th></tr></thead><tbody>
<tr><td>A mapping shows <em>not run</em></td><td>The activity was on a branch that was not taken in the last test. Test with data that takes that branch.</td></tr>
<tr><td>An API caller waits a minute, then gets 504</td><td>A branch ended without [[httpResponse]] or [[soapReply]]. Add replies on every branch, including error branches.</td></tr>
<tr><td>A timer or file trigger does nothing</td><td>Only the deployed version listens. Deploy, then check the listeners table in Server &amp; APIs.</td></tr>
<tr><td>Required fields not mapped</td><td>The Input tab names them. Map them, or remove the requirement from the schema.</td></tr>
<tr><td>Formula error</td><td>The preview under the formula names the problem: an unknown function, a missing bracket, or a quote not doubled.</td></tr>
<tr><td>The run stops after 10000 steps</td><td>A loop that never ends. Check the condition that leaves it.</td></tr>
<tr><td>Let's Encrypt fails</td><td>Port 80 on the domain must reach the gateway's HTTP port.</td></tr>
</tbody></table>`,
  },
];
