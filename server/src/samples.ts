/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { getFlow, listFlows, saveFlow, setFlowFolder } from './flows.js';
import { listResources, RESOURCE_KINDS, saveResource } from './resources.js';
import { allActivities } from './palettes/index.js';
import { config } from './config.js';
import { getSetting, q, setSetting } from './db.js';
import { setItemFolder } from './folders.js';
import type { Field, FlowNode } from './engine/types.js';
import fs from 'node:fs';
import path from 'node:path';
import { getProject, saveProject, projectFilesDir } from './projects.js';
import { writeSampleDocuments } from './sampledocs.js';

/**
 * Sample Sutras added to a project from "New Sutra": For-Each mapping, loops on an activity,
 * a Sutra that calls another (sub-Sutra with Return), try / catch with logs, and two MCP skills
 * (Write CSV file, Post to Facebook page) on a sample MCP server.
 */
const N = (id: string, type: string, name: string, x: number, y: number, config: Record<string, any> = {}, settings?: FlowNode['settings']): FlowNode =>
  ({ id, type, name, x, y, config, ...(settings ? { settings } : {}) });
let e = 0;
const E = (from: string, to: string, port = 'out') => ({ id: `e${++e}`, from, port, to });

/** The samples offered in "New Sutra"; needs = what must be set up before the sample can run; folder = where its Sutras go. */
export const SAMPLES: { id: string; name: string; desc: string; palettes: string; needs?: string; folder?: string }[] = [
  { id: 'foreach', name: 'For-Each mapping', palettes: 'Data & mapping', desc: 'Invoice lines from order lines: Where, Sort by, position(), and a For-Each grouped by country.' },
  { id: 'loops', name: 'Loop on an activity', palettes: 'Data & mapping, General', desc: 'One activity run per order, and a counter repeated while below 3, like polling a job.' },
  { id: 'subsutra', name: 'Sub-Sutra (Call Sutra and Return)', palettes: 'Flow control', desc: 'A reusable tax Sutra and an invoice Sutra that calls it and logs its result or its failure.' },
  { id: 'trycatch', name: 'Try and catch with logs', palettes: 'Flow control, General', desc: 'An error handled on one activity, and the Error handler catching the rest, with logs at each level.' },
  { id: 'rest', name: 'REST API with validation', palettes: 'Triggers, HTTP', desc: 'GET /samples/orders/:id: checks the id, shapes the reply, answers 200 or 400.' },
  { id: 'csv', name: 'CSV import and totals', palettes: 'Files, Data & mapping', desc: 'Writes a CSV file, reads it back as typed rows, keeps the paid rows and totals them per country.' },
  { id: 'folder', name: 'Folder of files', palettes: 'Files, Flow control', desc: 'Lists the CSV files in a folder with a wildcard and handles each one with For each.' },
  { id: 'database', name: 'Database (SQLite)', palettes: 'DB Ops', desc: 'Creates a table and rows in one transaction, then queries it with a bound :parameter. A built-in SQLite file, nothing to install.' },
  { id: 'xml', name: 'XML in and out', palettes: 'Data & mapping', desc: 'Parses an XML order with attributes, maps its repeating lines, and renders an XML invoice.' },
  { id: 'transform', name: 'JSONata, JavaScript and HTML', palettes: 'Data & mapping, Custom code', desc: 'Groups orders with JSONata, scores them in JavaScript, and builds an HTML report.' },
  { id: 'routing', name: 'Router, Switch and Merge', palettes: 'Flow control', desc: 'Routes on conditions (all matches), joins the branches with Merge, then switches on the status.' },
  { id: 'conditions', name: 'Connection conditions', palettes: 'Flow control', desc: 'Named connections taken when their condition on the output is true, and an otherwise connection.' },
  { id: 'channels', name: 'Channels between Sutras', palettes: 'General, Triggers', desc: 'One Sutra sends to a channel; a deployed Sutra with a Channel trigger receives each message.' },
  { id: 'counter', name: 'Counter, Wait and Sutra variables', palettes: 'General, Flow control', desc: 'A daily order counter, a pause, and Sutra variables used in a log line.' },
  { id: 'scripts', name: 'Scripts: PowerShell and Run program', palettes: 'Scripts', desc: 'A PowerShell disk report that hands JSON to the next step, and a program run with arguments; failures carry the exit code and error output.', needs: 'scripts allowed by an administrator in Admin Console > Server > Runtime' },
  { id: 'timer', name: 'Timer: nightly archive', palettes: 'Triggers, Files, Flow control', desc: 'Every night at 02:00, lists the CSV files in a folder (oldest first) and moves each one to an archive folder.' },
  { id: 'filetrigger', name: 'File trigger: CSV drop folder', palettes: 'Triggers, Files, Data & mapping', desc: 'Starts when a CSV file arrives, sorts its rows, writes a cleaned copy and moves the original to processed/.' },
  { id: 'textformats', name: 'Parse JSON and CSV text', palettes: 'Data & mapping, Flow control', desc: 'Parses JSON text and CSV text from a message, sorts the rows, and renders them as CSV with a semicolon; a No operation marks a step still to design.' },
  { id: 'dbmore', name: 'SQL update and stored procedure', palettes: 'DB Ops', desc: 'Updates a row with a bound parameter and fails clearly when no row matched; a second Sutra calls a stored procedure.', needs: 'the Database sample run first; for the procedure, a PostgreSQL, MySQL, SQL Server or Oracle connection' },
  { id: 'soapcall', name: 'Call a SOAP service', palettes: 'SOAP / Web services', desc: 'Calls the GetOrder operation of the "Order SOAP service" starter with a raw envelope and maps the reply; a SOAP fault has its own output.', needs: 'the "SOAP service: orders" starter deployed' },
  { id: 'emailin', name: 'Email trigger: orders by email', palettes: 'Triggers, Email, AI', desc: 'Starts for each new email in a mailbox, pulls the order number and amount out of the text with AI extract, and logs them.', needs: 'an Email (IMAP) connection and an AI provider' },
  { id: 'firebase', name: 'Firebase: order to app', palettes: 'Firebase', desc: 'Saves the order in Firestore, updates its live status in the Realtime Database, and sends a push notification to the customer\'s phone.', needs: 'a Firebase connection' },
  { id: 'google', name: 'Google Drive and Sheets', palettes: 'Triggers, Apps, AI', desc: 'Starts when a Google Doc changes in a folder, exports its text, summarises it, and appends a row to a Google Sheet.', needs: 'a Google OAuth connection, a folder and a spreadsheet; an AI provider' },
  { id: 'apps', name: 'Dropbox, YouTube and any API', palettes: 'Apps', desc: 'Searches YouTube, saves the results to Dropbox as JSON, and calls any API of the connected account with Connected API call.', needs: 'Google and Dropbox OAuth connections' },
  { id: 'aimore', name: 'AI: translate, extract, route and reply', palettes: 'AI', desc: 'With a local Ollama: lists the models, translates a Spanish message to English, extracts its fields, routes it to a team and drafts a reply.', needs: 'Ollama running on this machine with at least one model' },
  { id: 'release', name: 'Release pipeline', palettes: 'Release, Flow control, Email', desc: 'A Sutra that releases a project: builds a package, checks it, deploys it to a test copy, waits for approval, deploys to production, and logs each step; any problem goes to one handler.', needs: 'release activities allowed in Admin Console > Server > Runtime; for remote engines, their admin tokens in the vault' },
  { id: 'localai', name: 'Local AI with Ollama', palettes: 'AI', desc: 'Classifies, summarises and rates a customer email with a local Ollama model, offline.', needs: 'Ollama running on this machine with at least one model' },
  { id: 'email', name: 'Email a report', palettes: 'Email, Custom code', desc: 'Builds an HTML report and emails it; a failure is logged.', needs: 'an Email (SMTP) connection' },
  { id: 'queue', name: 'Queue in and out', palettes: 'Service Bus', desc: 'Takes orders from a queue, reshapes them, publishes them on, and confirms each message.', needs: 'a Kafka, RabbitMQ or ActiveMQ connection' },
  { id: 'soappublic', name: 'Call a public SOAP service', palettes: 'SOAP / Web services', desc: 'Loads the WSDL of a free public calculator service and calls its Add and Multiply operations; a fault and a network error each have their own output.', needs: 'internet access' },
  { id: 'soapmock', name: 'Mock SOAP service and its caller', palettes: 'Triggers, SOAP / Web services', desc: 'A mock weather SOAP service with a WSDL and canned replies (and a fault for an unknown city), and a Sutra that calls it with a raw envelope, as you would before the real service exists.', needs: 'the mock service deployed' },
  { id: 'microservices', name: 'JSON microservices', palettes: 'Triggers, HTTP, Data & mapping', desc: 'Three small REST services: Customers and Stock answer JSON on their own, Orders calls both over HTTP and returns one combined JSON reply (or 404 / 409 / 502).', needs: 'the three services deployed' },
  { id: 'sqlinstall', name: 'SQL install script and procedure as a service', palettes: 'DB Ops, Triggers, HTTP', desc: 'A SQL script creates a MySQL database, two tables, seed rows and a stored procedure; a REST service then calls the procedure and returns its rows as JSON.', needs: 'MySQL (Laragon: 127.0.0.1:3306, user root, no password); the service deployed' },
  { id: 'sftp', name: 'SFTP: upload, list, read, archive', palettes: 'SFTP / FTP, Triggers', desc: 'Writes a CSV to an SFTP server, appends to it, lists and reads it back, copies it to an archive folder and deletes the copy; a Remote file trigger picks up new files in inbox/.', needs: 'an SFTP server: set the host, user and password of the "Sample SFTP" connection' },
  { id: 'ftp', name: 'FTP: upload, list, read, archive', palettes: 'SFTP / FTP, Triggers', desc: 'The same steps over FTP or FTPS: write, list with rows, read lines, move to a dated archive name; a Remote file trigger picks up new files and deletes them after the run.', needs: 'an FTP server: set the host, user and password of the "Sample FTP" connection' },
  { id: 'agentdesk', name: 'AI agent: order desk with tools and memory', palettes: 'AI', desc: 'A published agent (chat page, OpenAI API, MCP tool, A2A) that checks its input with the AI guard, looks orders and stock up with two AI tool Sutras, remembers each conversation, and asks a person before any refund.', needs: 'Ollama with a model (phi4-mini works); the three Sutras deployed to chat at /chat/order-desk' },
  { id: 'agentrag', name: 'AI agent: knowledge base (RAG)', palettes: 'AI, Apps', desc: 'Fills a knowledge base from web pages and from a SharePoint library (kept up to date by a trigger), and a policy assistant that answers only from it, with sources.', needs: 'Ollama with a model; for SharePoint, a Microsoft OAuth connection' },
  { id: 'agentqueue', name: 'AI agent: fed by a message queue', palettes: 'AI, Service Bus', desc: 'Takes questions from a RabbitMQ or ActiveMQ queue, answers each with the agent (one at a time per conversation), publishes the answer to a reply queue and confirms the message.', needs: 'a RabbitMQ or ActiveMQ connection; Ollama with a model' },
  { id: 'agentteam', name: 'AI agent: supervisor and specialists', palettes: 'AI', desc: 'A supervisor agent published at /chat/help sends each question to the order desk or the policy assistant with Hand off to agent, and answers with what they say.', needs: 'the order desk and knowledge base samples; Ollama with a model' },
  { id: 'agentmcp', name: 'AI agent: tools from another MCP server', palettes: 'AI', desc: 'Lists the tools of an outside MCP server (the file system server started with npx), calls one directly, and gives them to an agent that answers questions about files.', needs: 'Node.js npx on the server; Ollama with a model' },
  { id: 'agentdocs', name: 'AI document assistant: RAG over a folder', palettes: 'AI, Files, Triggers, REST', desc: 'Every 15 minutes, reads the PDF, Word, PowerPoint and Markdown files of a folder into a knowledge base (changed files again, deleted ones out), and answers from it three ways: a REST API, an MCP tool for AI assistants, and a chat agent. Sample documents included.', needs: 'Ollama with a model for the API and the agent (the MCP tool needs none)' },
  { id: 'adf', name: 'Azure Data Factory: run, monitor, rerun', palettes: 'Azure, Flow control, AI', desc: 'Runs a pipeline with parameters and waits for it, reruns from the failed activity, and watches the factory for failed runs, asking a person before a rerun.', needs: 'an Azure service principal with Data Factory Contributor on the factory' },
  { id: 'databricks', name: 'Databricks: notebooks, SQL and code blocks', palettes: 'Azure', desc: 'Runs a notebook with parameters and reads its exit value; queries a SQL warehouse with a named parameter and runs a Python cell on a cluster.', needs: 'a Databricks workspace with a cluster and a SQL warehouse; a token or service principal' },
  { id: 'python', name: 'Python scripts', palettes: 'Scripts', desc: 'Python written in the step and a .py file from the project files, with arguments, parameters and the previous output, printing JSON for the next step.', needs: 'Python 3 on the server; scripts allowed in Admin Console > Server > Runtime' },
  { id: 'youtube', name: 'YouTube: publish from Google Drive, weekly analytics', palettes: 'Apps and social', desc: 'New videos in a Drive folder are saved to the server and uploaded to YouTube; every week the channel\'s analytics go to a Google Sheet.', needs: 'a Google OAuth app with the Drive, YouTube and Sheets scopes' },
  { id: 'twitch', name: 'Twitch: going live', palettes: 'Apps and social', desc: 'When the channel goes live, a welcome in the chat; after the stream, the follower count.', needs: 'a Twitch application (dev.twitch.tv)' },
  { id: 'discord', name: 'Discord: order status bot', palettes: 'Apps and social', desc: 'A bot answers !status <order> in a channel with an embed.', needs: 'a Discord bot token' },
  { id: 'telegram', name: 'Telegram: order status bot and alerts', palettes: 'Apps and social', desc: 'A bot answers /status <order> in any chat; an alert Sutra other Sutras call posts to the team chat.', needs: 'a Telegram bot token from @BotFather' },
  { id: 'skills', name: 'MCP skills: Write CSV file, Post to Facebook page', palettes: 'Triggers, AI, Files, Apps', desc: 'Two Sutras that AI assistants call as tools, on a sample MCP server.', needs: 'a security policy on the MCP server; a Facebook connection for posting' },
];

export function addSamples(projectId: string, ids?: string[]) {
  // want() also notes which sample is being built, so save() knows the folder of the Sutras it makes.
  let current = '';
  const want = (id: string) => { current = id; return !ids?.length || ids.includes(id); };
  const taken = new Set(listFlows(projectId).map(f => f.name.toLowerCase()));
  const resourcesBefore = new Set(listResources(undefined, projectId).map(r => r.id));
  const name = (base: string) => { let n = base; for (let i = 2; taken.has(n.toLowerCase()); i++) n = `${base} ${i}`; taken.add(n.toLowerCase()); return n; };
  const made: { id: string; sample: string }[] = [];
  const save = (doc: any) => { const f = saveFlow(undefined, { ...doc, name: name(doc.name) }, projectId); made.push({ id: f.id, sample: current }); return f; };
  const conn = (kind: string, cname: string, cfg: Record<string, any>) => listResources(kind, projectId).find(r => r.name === cname) || saveResource({ kind, name: cname, project_id: projectId, config: cfg });
  const gw = `http://127.0.0.1:${getSetting<{ httpPort?: number }>('gateway', {}).httpPort || config.gatewayHttpPort}`;

  const order = {
    orderId: 'A-1001', customer: 'asha traders', country: 'IN',
    lines: [
      { sku: 'TEA-250', qty: 4, price: 120, country: 'IN' },
      { sku: 'MUG-01', qty: 0, price: 250, country: 'IN' },
      { sku: 'CUP-12', qty: 2, price: 90, country: 'LK' },
      { sku: 'POT-02', qty: 1, price: 900, country: 'LK' },
    ],
  };

  // 1. For-Each mapping: filter, sort, number and group repeating lines inside Map data.
  const forEach = want('foreach') && save({
    name: 'Sample: For-Each mapping',
    description: 'Map data builds an invoice from order lines: For-Each with Where (skip zero quantities) and Sort by, position(), and a second For-Each grouped by country.',
    nodes: [
      N('s', 'start', 'Order', 60, 200, { payload: JSON.stringify(order, null, 2) }),
      N('m', 'mapper', 'Build invoice', 400, 200, { start: 'empty', schema: '', mapping: {
        fields: ['invoiceNo', 'customer', 'lines[]/no', 'lines[]/sku', 'lines[]/amount', 'byCountry[]/country', 'byCountry[]/lines', 'byCountry[]/total'],
        rules: {
          invoiceNo: { expr: "concat('INV-', {input.orderId})" },
          customer: { expr: 'capitalize({input.customer})' },
          lines: { forEach: '{input.lines}', where: 'qty > 0', sortBy: 'sku' },
          'lines/no': { expr: 'position()' },
          'lines/sku': { expr: '{item.sku}' },
          'lines/amount': { expr: '{item.qty} * {item.price}' },
          byCountry: { forEach: '{input.lines}', where: 'qty > 0', groupBy: 'country' },
          'byCountry/country': { expr: '{group.key}' },
          'byCountry/lines': { expr: '{group.count}' },
          'byCountry/total': { expr: "sum({group.items}, 'price')" },
        },
      } }),
      N('l', 'log', 'Log invoice', 740, 200, { level: 'info', message: "=concat('Invoice ', {input.invoiceNo}, ': ', count({input.lines}), ' lines in ', count({input.byCountry}), ' countries')" }),
      N('end', 'end', 'Done', 1080, 200, { stop: 'this branch', result: '{{nodes.Build invoice}}' }),
    ],
    edges: [E('s', 'm'), E('m', 'l'), E('l', 'end')],
  });

  // 2. Loops on an activity (Settings tab > Loop): for each item, and repeat while.
  const loops = want('loops') && save({
    name: 'Sample: Loop on an activity',
    description: 'Price one order runs once per order (Loop: for each item) and collects the results. Poll counter repeats while its value is below 3, with a delay, like polling a job until it is done.',
    nodes: [
      N('s', 'start', 'Orders', 60, 200, { payload: JSON.stringify({ orders: [{ id: 'A-1', amount: 1000 }, { id: 'A-2', amount: 250 }, { id: 'A-3', amount: 4000 }] }, null, 2) }),
      N('m', 'mapper', 'Price one order', 400, 120, { start: 'empty', schema: '', mapping: { rules: {
        id: { expr: '{iteration.value.id}' },
        no: { expr: '{iteration.index} + 1' },
        gross: { expr: 'round({iteration.value.amount} * 1.18, 2)' },
      } } }, { loop: 'for each item', loopOver: '{{input.orders}}', loopMax: 1000 }),
      N('l1', 'log', 'Log prices', 740, 120, { level: 'info', message: "=concat(count({input.iterations}), ' orders priced, total ', sum({input.iterations}, 'gross'))" }),
      N('c', 'counter', 'Poll counter', 400, 320, { name: "=concat('sample-poll-', {sutra.id})", op: 'increment', by: 1 },
        { loop: 'repeat while', loopWhile: '={iteration.output.value} < 3', loopDelayMs: 300, loopMax: 10 }),
      N('l2', 'log', 'Log polls', 740, 320, { level: 'info', message: "=concat('Polled ', {input._iterations}, ' times; counter is ', {input.value})" }),
      N('g', 'merge', 'Both done', 1080, 220),
    ],
    edges: [E('s', 'm'), E('m', 'l1'), E('s', 'c'), E('c', 'l2'), E('l1', 'g'), E('l2', 'g')],
  });

  // 3 + 4. A reusable sub-Sutra and a Sutra that calls it.
  const tax = want('subsutra') && save({
    name: 'Sample: Calculate tax (called Sutra)',
    description: 'A reusable Sutra: takes an amount and a country, returns tax and total with Return. Called by "Sample: Invoice with a sub-Sutra".',
    nodes: [
      N('s', 'start', 'Amount', 60, 200, { payload: JSON.stringify({ amount: 1000, country: 'IN' }, null, 2) }),
      N('m', 'mapper', 'Work out tax', 400, 200, { start: 'empty', schema: '', mapping: { rules: {
        amount: { expr: 'number({input.amount})' },
        rate: { expr: "if({input.country} = 'IN', 0.18, 0.2)" },
        tax: { expr: "round({input.amount} * if({input.country} = 'IN', 0.18, 0.2), 2)" },
        total: { expr: "round({input.amount} * (1 + if({input.country} = 'IN', 0.18, 0.2)), 2)" },
      } } }),
      N('r', 'return', 'Return result', 740, 200, { source: 'value', value: '{{input}}' }),
    ],
    edges: [E('s', 'm'), E('m', 'r')],
  });
  const invoice = tax && save({
    name: 'Sample: Invoice with a sub-Sutra',
    description: 'Calls "Sample: Calculate tax (called Sutra)" with Call Sutra, waits for its result and logs it. A failure inside the called Sutra arrives on the error output.',
    nodes: [
      N('s', 'start', 'Invoice', 60, 200, { payload: JSON.stringify({ orderId: 'A-1001', amount: 2500, country: 'IN' }, null, 2) }),
      N('c', 'callProcess', 'Calculate tax', 400, 200, { process: tax ? tax.id : '', use: 'deployed (draft while testing)', wait: true, source: 'value', input: '{{input}}', resultSchema: '' }),
      N('l', 'log', 'Log totals', 740, 140, { level: 'info', message: "=concat('Order ', {trigger.orderId}, ': tax ', {input.tax}, ', total ', {input.total})" }),
      N('x', 'log', 'Log tax failure', 740, 320, { level: 'error', message: 'Tax could not be worked out: {{input.error.message}}' }),
    ],
    edges: [E('s', 'c'), E('c', 'l'), E('c', 'x', 'error')],
  });

  // 5. Try / catch: an error output handled where it happens, and the Error handler for the rest.
  const tryCatch = want('trycatch') && save({
    name: 'Sample: Try and catch with logs',
    description: 'Check stock fails and its own error output handles it (try / catch around one activity). Reject fails with nothing connected, so the Error handler catches it, logs it and ends the Sutra.',
    nodes: [
      N('s', 'start', 'Order', 60, 200, { payload: JSON.stringify({ orderId: 'A-1002', amount: -5, sku: 'TEA-250' }, null, 2) }),
      N('l0', 'log', 'Log received', 340, 200, { level: 'info', message: 'Order {{input.orderId}} received for {{input.amount}}' }),
      N('t1', 'throw', 'Check stock', 620, 80, { message: '{{input.sku}} is out of stock' }),
      N('l1', 'log', 'Log stock problem', 900, 80, { level: 'warn', message: 'Handled here: {{input.error.message}}' }),
      N('i', 'if', 'Amount above 0', 620, 300, { left: '{{input.amount}}', op: 'greater than', right: '0' }),
      N('ok', 'log', 'Log accepted', 900, 240, { level: 'info', message: 'Order {{input.orderId}} accepted' }),
      N('t2', 'throw', 'Reject', 900, 380, { message: 'Amount {{input.amount}} is not valid for order {{input.orderId}}' }),
      N('h', 'catch', 'Error handler', 340, 500),
      N('l2', 'log', 'Log the error', 620, 500, { level: 'error', message: '{{input.error.step}} failed: {{input.error.message}}' }),
      N('end', 'end', 'End handled', 900, 520, { stop: 'this branch', result: '{{input.error}}' }),
    ],
    edges: [E('s', 'l0'), E('l0', 't1'), E('t1', 'l1', 'error'), E('l0', 'i'), E('i', 'ok', 'true'), E('i', 't2', 'false'), E('h', 'l2'), E('l2', 'end')],
  });

  // 6 + 7. MCP skills: Sutras that AI assistants call as tools, on one MCP server.
  const server = !want('skills') ? null : listResources('mcpServer', projectId).find(r => r.name === 'Sample skills')
    || saveResource({ kind: 'mcpServer', name: 'Sample skills', project_id: projectId, config: { path: '/mcp/samples', title: 'Sample skills', instructions: 'Skills that write files and post to the company Facebook page. Confirm with the user before posting.', policy: '' } });
  const csvSkill = server && save({
    name: 'Skill: Write CSV file',
    description: 'An MCP skill: an AI assistant gives a file name and rows; the Sutra writes them as a CSV file and returns the file details. Pick an API security policy on the MCP server before deploying.',
    nodes: [
      N('t', 'mcpTool', 'Write CSV skill', 60, 200, {
        server: server.id, toolName: 'write_csv_file', title: 'Write CSV file', changesData: true,
        description: 'Writes rows to a CSV file in the outbox folder and returns its path, size and row count. Use it when the user asks to export, save or download data as CSV. Each row is an object; its fields become the columns.',
        inputs: [{ k: 'fileName', v: 'The file name, for example orders-today.csv' }, { k: 'rows', v: 'array: the rows to write, each an object with the same fields' }],
        testArguments: JSON.stringify({ fileName: 'skill-test.csv', rows: [{ sku: 'TEA-250', qty: 4 }, { sku: 'CUP-12', qty: 2 }] }, null, 2),
      }),
      N('w', 'fileWrite', 'Write the file', 400, 200, { folder: 'C:/sutra/outbox', path: '{{input.arguments.fileName}}', format: 'CSV from rows', rows: '{{input.arguments.rows}}', delimiter: ',', header: true, encoding: 'utf-8', lineEnding: 'LF', append: false, overwrite: true }),
      N('ok', 'mcpReply', 'Reply with the file', 740, 140, { source: 'value', result: "=object('path', {input.path}, 'rows', {input.rowsWritten}, 'size', format-bytes({input.size}))" }),
      N('bad', 'mcpReply', 'Reply with the problem', 740, 320, { source: 'value', result: 'The file could not be written: {{input.error.message}}', isError: true }),
    ],
    edges: [E('t', 'w'), E('w', 'ok'), E('w', 'bad', 'error')],
  });
  const fbSkill = server && save({
    name: 'Skill: Post to Facebook page',
    description: 'An MCP skill: an AI assistant gives the text (and an optional link); the Sutra posts it on the Facebook page and returns the post id. Choose a Facebook OAuth connection and the page id before deploying.',
    nodes: [
      N('t', 'mcpTool', 'Facebook post skill', 60, 200, {
        server: server.id, toolName: 'post_to_facebook_page', title: 'Post to Facebook page', changesData: true,
        description: 'Publishes a post on the company Facebook page and returns the new post id. Use it only after the user has approved the exact text.',
        inputs: [{ k: 'message', v: 'The text of the post' }, { k: 'link', v: 'optional: a link to attach' }],
        testArguments: JSON.stringify({ message: 'New arrivals this week', link: '' }, null, 2),
      }),
      N('p', 'facebookPage', 'Post it', 400, 200, { connection: '', op: 'post', pageId: '', message: '{{input.arguments.message}}', link: '{{input.arguments.link}}' }),
      N('ok', 'mcpReply', 'Reply with the post', 740, 140, { source: 'value', result: "=object('posted', true, 'postId', {input.id})" }),
      N('bad', 'mcpReply', 'Reply with the problem', 740, 320, { source: 'value', result: 'The post was not published: {{input.error.message}}', isError: true }),
    ],
    edges: [E('t', 'p'), E('p', 'ok'), E('p', 'bad', 'error')],
  });

  const folder = 'C:/sutra/samples';
  const sales = [
    { orderId: 'A-1', customer: 'Asha Traders', country: 'IN', status: 'paid', amount: 1200 },
    { orderId: 'A-2', customer: 'Lanka Tea', country: 'LK', status: 'pending', amount: 300 },
    { orderId: 'A-3', customer: 'Pune Cafe', country: 'IN', status: 'paid', amount: 450 },
    { orderId: 'A-4', customer: 'Kandy Stores', country: 'LK', status: 'paid', amount: 990 },
  ];

  // REST API: trigger, Validate fields, Map data, Send HTTP response (200 and 400).
  const rest = want('rest') && save({
    name: 'Sample: REST API with validation',
    description: 'GET /samples/orders/:id. Validate fields checks the id; Map data shapes the reply; Send HTTP response answers 200, or 400 when the id is missing. Test runs use the trigger\'s test request; deploy it to call it on the gateway.',
    nodes: [
      N('t', 'restService', 'Orders API', 60, 200, { method: 'GET', path: '/samples/orders/:id', policy: '', maxBodyKb: 64, bodySchema: '', testRequest: JSON.stringify({ method: 'GET', params: { id: 'A-1001' }, query: { lang: 'en' }, headers: {}, body: null }, null, 2) }),
      N('v', 'validate', 'Check id', 400, 200, { required: ['params.id'], source: '{{input}}' }),
      N('m', 'mapper', 'Shape reply', 740, 120, { start: 'empty', schema: '', mapping: { rules: {
        orderId: { expr: 'upper-case({input.params.id})' },
        status: { expr: "'SHIPPED'" },
        checkedAt: { expr: "format-dateTime('DD-MM-YYYY HH:mm', current-dateTime(), 'Asia/Kolkata')" },
        language: { expr: "coalesce({input.query.lang}, 'en')" },
      } } }),
      N('ok', 'httpResponse', 'Reply 200', 1080, 120, { status: '200', contentType: 'application/json', bodySource: 'template', body: '{{input}}', headers: [] }),
      N('bad', 'httpResponse', 'Reply 400', 740, 320, { status: '400', contentType: 'application/json', bodySource: 'template', body: '{"errors": {{input.problems | json}}}', headers: [] }),
    ],
    edges: [E('t', 'v'), E('v', 'm', 'valid'), E('m', 'ok'), E('v', 'bad', 'invalid')],
  });

  // Files: write CSV from rows, read it back as rows, filter, aggregate per country, render JSON.
  const csv = want('csv') && save({
    name: 'Sample: CSV import and totals',
    description: `Writes the payload's rows as ${folder}/sales.csv, reads the file back as CSV rows, keeps the paid ones and totals the amount per country. Change the folders to suit your machine.`,
    nodes: [
      N('s', 'start', 'Sales', 60, 200, { payload: JSON.stringify({ rows: sales }, null, 2) }),
      N('w', 'fileWrite', 'Write sales.csv', 360, 200, { folder, path: 'sales.csv', format: 'CSV from rows', rows: '{{input.rows}}', delimiter: ',', header: true, encoding: 'utf-8', lineEnding: 'LF', append: false, overwrite: true }),
      N('r', 'fileRead', 'Read sales.csv', 660, 200, { folder, path: '{{input.name}}', format: 'CSV rows', encoding: 'utf-8', delimiter: ',', header: true, trimValues: true, decimal: '.', schema: '', maxMb: 10 }),
      N('f', 'filter', 'Paid only', 960, 200, { list: '{{input.rows}}', field: 'status', op: 'equals', value: 'paid' }),
      N('a', 'aggregate', 'Total per country', 1260, 200, { list: '{{input.items}}', field: 'amount', fn: 'sum', groupBy: 'country' }),
      N('j', 'renderJson', 'As JSON', 1560, 200, { source: 'value', value: '{{input}}', pretty: true }),
      N('l', 'log', 'Log totals', 1860, 200, { level: 'info', message: 'Paid total {{nodes.Total per country.result}}: {{input.text}}' }),
    ],
    edges: [E('s', 'w'), E('w', 'r'), E('r', 'f'), E('f', 'a'), E('a', 'j'), E('j', 'l')],
  });

  // Folder: list files with a wildcard, For each file, then a summary.
  const filesFolder = want('folder') && save({
    name: 'Sample: Folder of files',
    description: `Lists ${folder}/*.csv (run "Sample: CSV import and totals" first to create one), logs each file in a For each, then logs how many there were. Nothing matched goes to the empty output.`,
    nodes: [
      N('s', 'start', 'Start', 60, 200, { payload: '{}' }),
      N('d', 'fileList', 'List CSV files', 360, 200, { location: `${folder}/*.csv`, pattern: '', recursive: false, sort: 'newest first', max: 100, format: 'do not read' }),
      N('fe', 'forEach', 'Each file', 660, 140, { list: '{{input.files}}', max: 100 }),
      N('l1', 'log', 'Log file', 960, 80, { level: 'info', message: '{{input.name}}: {{input.size}} bytes, changed {{input.modifiedAt}}' }),
      N('l2', 'log', 'Log count', 960, 220, { level: 'info', message: '{{input.count}} files handled' }),
      N('l3', 'log', 'Log nothing found', 660, 340, { level: 'warn', message: 'No CSV files in the folder' }),
    ],
    edges: [E('s', 'd'), E('d', 'fe'), E('fe', 'l1', 'item'), E('fe', 'l2', 'done'), E('d', 'l3', 'empty')],
  });

  // Database: SQLite file in the data folder; a transaction, then a query with a bound parameter.
  const dbConn = !want('database') ? null : listResources('database', projectId).find(r => r.name === 'Sample SQLite')
    || saveResource({ kind: 'database', name: 'Sample SQLite', project_id: projectId, config: { driver: 'sqlite', file: 'samples.sqlite' } });
  const database = dbConn && save({
    name: 'Sample: Database (SQLite)',
    description: 'Uses the "Sample SQLite" connection (a file in the data folder). SQL transaction creates the table and saves the rows together; SQL query reads orders above an amount with a bound :min parameter.',
    nodes: [
      N('s', 'start', 'Orders', 60, 200, { payload: JSON.stringify({ min: 500, orders: sales }, null, 2) }),
      N('t', 'dbTransaction', 'Save orders', 360, 200, { connection: dbConn.id, sql: "CREATE TABLE IF NOT EXISTS sample_orders (id TEXT PRIMARY KEY, customer TEXT, country TEXT, amount REAL)\n;\nINSERT OR REPLACE INTO sample_orders VALUES (:id1, :c1, :k1, :a1)\n;\nINSERT OR REPLACE INTO sample_orders VALUES (:id2, :c2, :k2, :a2)\n;\nINSERT OR REPLACE INTO sample_orders VALUES (:id3, :c3, :k3, :a3)",
        params: [1, 2, 3].flatMap(i => [{ k: `id${i}`, v: `{{input.orders[${i - 1}].orderId}}` }, { k: `c${i}`, v: `{{input.orders[${i - 1}].customer}}` }, { k: `k${i}`, v: `{{input.orders[${i - 1}].country}}` }, { k: `a${i}`, v: `{{input.orders[${i - 1}].amount}}` }]) }),
      N('q', 'dbQuery', 'Big orders', 660, 200, { connection: dbConn.id, sql: 'SELECT id, customer, amount FROM sample_orders WHERE amount > :min ORDER BY amount DESC', params: [{ k: 'min', v: '{{trigger.min}}' }], maxRows: 1000 }),
      N('l', 'log', 'Log result', 960, 140, { level: 'info', message: "=concat(count({input.rows}), ' orders above ', {trigger.min}, '; largest ', {input.first.customer})" }),
      N('n', 'log', 'Log none', 960, 300, { level: 'info', message: 'No orders above {{trigger.min}}' }),
    ],
    edges: [E('s', 't'), E('t', 'q'), E('q', 'l'), E('q', 'n', 'empty')],
  });

  // XML: parse with attributes, map repeating lines, render XML.
  const xml = want('xml') && save({
    name: 'Sample: XML in and out',
    description: 'Parse XML reads an order whose ids are attributes (@_id); Map data turns its repeating Line elements into invoice lines with a For-Each; Render XML writes the invoice.',
    nodes: [
      N('s', 'start', 'XML order', 60, 200, { payload: JSON.stringify({ xml: '<Order id="A-7" currency="INR"><Line sku="TEA-250" qty="2" price="120"/><Line sku="CUP-12" qty="1" price="90"/></Order>' }, null, 2) }),
      N('p', 'parseXml', 'Parse order', 360, 200, { schema: '', text: '{{input.xml}}' }),
      N('m', 'mapper', 'Build invoice', 660, 200, { start: 'empty', schema: '', mapping: {
        fields: ['Number', 'Currency', 'Item[]/Sku', 'Item[]/Amount'],
        rules: {
          Number: { expr: "concat('INV-', {input.Order.@_id})" },
          Currency: { expr: '{input.Order.@_currency}' },
          Item: { forEach: '{input.Order.Line}' },
          'Item/Sku': { expr: '{item.@_sku}' },
          'Item/Amount': { expr: 'number({item.@_qty}) * number({item.@_price})' },
        },
      } }),
      N('r', 'renderXml', 'Render invoice', 960, 200, { source: 'value', root: 'Invoice', value: '{{input}}', declaration: true }),
      N('l', 'log', 'Log XML', 1260, 200, { level: 'info', message: '{{input.text}}' }),
    ],
    edges: [E('s', 'p'), E('p', 'm'), E('m', 'r'), E('r', 'l')],
  });

  // Transform: JSONata grouping, JavaScript scoring, HTML report.
  const transform = want('transform') && save({
    name: 'Sample: JSONata, JavaScript and HTML',
    description: 'Transform (JSONata) totals the orders per country in one expression; JavaScript code ranks the countries; HTML template builds a report table.',
    nodes: [
      N('s', 'start', 'Orders', 60, 200, { payload: JSON.stringify({ orders: sales }, null, 2) }),
      N('j', 'jsonata', 'Total per country', 360, 200, { source: '{{input}}', expression: '{\n  "countries": orders{ country: $sum(amount) } ~> $each(function($v, $k) { { "country": $k, "total": $v } })\n}' }),
      N('c', 'jsCode', 'Rank countries', 660, 200, { code: "const list = [].concat(input.countries || []);\nlist.sort((a, b) => b.total - a.total);\nreturn { ranked: list.map((c, i) => ({ ...c, rank: i + 1, share: Math.round(c.total / list.reduce((s, x) => s + x.total, 0) * 100) })) };", timeoutMs: 5000, memoryMb: 64 }),
      N('h', 'htmlTemplate', 'Report', 960, 200, { html: '<h2>Sales by country</h2>\n<table>\n  <tr><th>#</th><th>Country</th><th>Total</th><th>Share</th></tr>\n  {{#each input.ranked}}<tr><td>{{this.rank}}</td><td>{{this.country}}</td><td>{{this.total}}</td><td>{{this.share}}%</td></tr>{{/each}}\n</table>' }),
      N('l', 'log', 'Log report', 1260, 200, { level: 'info', message: '{{input.html}}' }),
    ],
    edges: [E('s', 'j'), E('j', 'c'), E('c', 'h'), E('h', 'l')],
  });

  // Routing: Router (all matches), Merge, Switch.
  const routing = want('routing') && save({
    name: 'Sample: Router, Switch and Merge',
    description: 'Router takes every route whose condition holds (a large order from India takes both); Merge waits for the branches, including those not taken; Switch then branches on the status.',
    nodes: [
      N('s', 'start', 'Order', 60, 220, { payload: JSON.stringify({ orderId: 'A-9', amount: 1500, country: 'IN', status: 'paid' }, null, 2) }),
      N('r', 'router', 'Route order', 360, 220, { routes: [{ k: 'large', v: '={input.amount} > 1000' }, { k: 'india', v: "={input.country} = 'IN'" }], mode: 'all matches' }),
      N('l1', 'log', 'Large order', 680, 80, { level: 'info', message: 'Large order {{input.orderId}}: needs a second check' }),
      N('l2', 'log', 'Indian order', 680, 220, { level: 'info', message: 'Order {{input.orderId}} ships from the Pune warehouse' }),
      N('l3', 'log', 'Other order', 680, 360, { level: 'info', message: 'Standard order {{input.orderId}}' }),
      N('g', 'merge', 'Checks done', 1000, 220),
      N('w', 'switch', 'By status', 1300, 220, { value: '{{trigger.status}}', cases: 'paid, pending' }),
      N('p1', 'log', 'Ship it', 1600, 120, { level: 'info', message: 'Paid: shipping {{trigger.orderId}}' }),
      N('p2', 'log', 'Remind', 1600, 260, { level: 'warn', message: 'Pending: payment reminder for {{trigger.orderId}}' }),
      N('p3', 'log', 'Unknown status', 1600, 400, { level: 'warn', message: 'Unknown status {{trigger.status}}' }),
    ],
    edges: [E('s', 'r'), E('r', 'l1', 'large'), E('r', 'l2', 'india'), E('r', 'l3', 'otherwise'), E('l1', 'g'), E('l2', 'g'), E('l3', 'g'), E('g', 'w'), E('w', 'p1', 'paid'), E('w', 'p2', 'pending'), E('w', 'p3', 'default')],
  });

  // Connection conditions: named "when" connections and an "otherwise".
  const conditions = want('conditions') && save({
    name: 'Sample: Connection conditions',
    description: 'Click each connection after Check order: "Order > 1000" and "From India" are taken when their conditions on the output hold; "Anything else" is taken when neither is.',
    nodes: [
      N('s', 'start', 'Order', 60, 220, { payload: JSON.stringify({ orderId: 'A-10', amount: 2500, country: 'LK' }, null, 2) }),
      N('c', 'log', 'Check order', 380, 220, { level: 'info', message: 'Order {{input.orderId}} for {{input.amount}} from {{input.country}}' }),
      N('b', 'log', 'Big order', 720, 80, { level: 'info', message: 'Big order: manager review' }),
      N('i', 'log', 'From India', 720, 220, { level: 'info', message: 'GST invoice' }),
      N('o', 'log', 'Small order', 720, 360, { level: 'info', message: 'Standard handling' }),
    ],
    edges: [E('s', 'c'),
      { ...E('c', 'b'), label: 'Order > 1000', when: 'when', condition: '={input.amount} > 1000' },
      { ...E('c', 'i'), label: 'From India', when: 'when', condition: "=upper-case({input.country}) = 'IN'" },
      { ...E('c', 'o'), label: 'Anything else', when: 'otherwise' }],
  });

  // Channels: a sender and a deployed listener.
  const chSend = want('channels') && save({
    name: 'Sample: Channel sender',
    description: 'Sends each order to the channel "sample-orders". Deploy "Sample: Channel listener" first; then every test here starts it.',
    nodes: [
      N('s', 'start', 'Order', 60, 200, { payload: JSON.stringify({ orderId: 'A-11', amount: 300 }, null, 2) }),
      N('p', 'channelPublish', 'Send to channel', 380, 200, { channel: 'sample-orders', message: '{{input}}', required: false }),
      N('l', 'log', 'Log delivery', 700, 200, { level: 'info', message: 'Delivered to {{input.delivered}} listening Sutras' }),
    ],
    edges: [E('s', 'p'), E('p', 'l')],
  });
  const chListen = want('channels') && save({
    name: 'Sample: Channel listener',
    description: 'Starts for each message sent to "sample-orders" while deployed, counts it, and logs it.',
    nodes: [
      N('t', 'channelTrigger', 'On order', 60, 200, { channel: 'sample-orders', schema: '', testMessage: JSON.stringify({ orderId: 'A-11', amount: 300 }, null, 2) }),
      N('c', 'counter', 'Count orders', 380, 200, { name: 'sample-channel-orders', op: 'increment', by: 1 }),
      N('l', 'log', 'Log order', 700, 200, { level: 'info', message: 'Order {{trigger.orderId}} received; {{input.value}} so far' }),
    ],
    edges: [E('t', 'c'), E('c', 'l')],
  });

  // Counter, Wait and Sutra variables.
  const counter = want('counter') && save({
    name: 'Sample: Counter, Wait and Sutra variables',
    description: 'Set variables stores a batch name; Counter keeps a number per day across runs; Wait pauses; the log line uses the Sutra variable and the counter.',
    variables: [{ name: 'batch', type: 'string', value: 'morning' }],
    nodes: [
      N('s', 'start', 'Start', 60, 200, { payload: '{}' }),
      N('v', 'setVar', 'Name the batch', 360, 200, { vars: [{ k: 'batch', v: "=concat('batch-', format-dateTime('HHmm', current-dateTime(), 'Asia/Kolkata'))" }] }),
      N('c', 'counter', 'Orders today', 660, 200, { name: "=concat('sample-orders-', current-date())", op: 'increment', by: 1 }),
      N('w', 'wait', 'Short pause', 960, 200, { ms: 500, until: '' }),
      N('l', 'log', 'Log', 1260, 200, { level: 'info', message: '{{vars.batch}}: order number {{input.value}} today' }),
    ],
    edges: [E('s', 'v'), E('v', 'c'), E('c', 'w'), E('w', 'l')],
  });

  // Scripts: PowerShell with JSON output, a program with arguments, error branch with the captured output.
  const scripts = want('scripts') && save({
    name: 'Sample: Scripts',
    description: 'PowerShell lists the disks and hands JSON to the next step; Run program starts Node.js with one argument; a bash Shell script counts files and prints JSON; each error output logs the exit code and error output. Needs "Allow script activities" in Admin Console > Server > Runtime.',
    nodes: [
      N('s', 'start', 'Start', 60, 220, { payload: JSON.stringify({ minFreeGb: 10, note: 'checked by SutraFlow' }, null, 2) }),
      N('p', 'powershell', 'Disk report', 380, 140, { interpreter: 'Windows PowerShell', timeoutMs: 60000, failOnExit: true, workDir: '',
        env: [{ k: 'MIN_FREE_GB', v: '{{input.minFreeGb}}' }],
        script: "$min = [double]$env:MIN_FREE_GB\n$disks = Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Used -ne $null } | ForEach-Object {\n  $free = [math]::Round($_.Free / 1GB, 1)\n  [pscustomobject]@{ drive = $_.Name; freeGb = $free; low = ($free -lt $min) }\n}\n@{ disks = @($disks); low = @($disks | Where-Object low).Count } | ConvertTo-Json -Depth 3" }),
      N('l1', 'log', 'Log disks', 720, 80, { level: 'info', message: "=concat(count({input.json.disks}), ' disks, ', {input.json.low}, ' low on space')" }),
      N('r', 'runProgram', 'Node version', 720, 240, { program: 'node', args: ['-e', 'console.log(JSON.stringify({ node: process.version, note: process.argv[1] }))', '{{trigger.note}}'], stdin: '', timeoutMs: 30000, failOnExit: true, workDir: '', env: [] }),
      N('l2', 'log', 'Log node', 1060, 240, { level: 'info', message: 'Node {{input.json.node}} ({{input.json.note}})' }),
      N('sh', 'shellScript', 'Shell: count files', 1400, 240, { interpreter: 'bash', timeoutMs: 30000, failOnExit: true, workDir: '', env: [{ k: 'NOTE', v: '{{trigger.note}}' }],
        script: 'set -e\ncount=$(ls -1 "${TMPDIR:-/tmp}" 2>/dev/null | wc -l)\necho "{\\"tempFiles\\": $count, \\"note\\": \\"$NOTE\\"}"' }),
      N('l3', 'log', 'Log shell', 1740, 240, { level: 'info', message: '{{input.json.tempFiles}} files in the temp folder' }),
      N('e1', 'log', 'Log script error', 720, 400, { level: 'error', message: 'Exit {{input.error.details.exitCode}}: {{input.error.details.stderr}}' }),
    ],
    edges: [E('s', 'p'), E('p', 'l1'), E('l1', 'r'), E('r', 'l2'), E('l2', 'sh'), E('sh', 'l3'), E('p', 'e1', 'error'), E('r', 'e1', 'error'), E('sh', 'e1', 'error')],
  });

  // Timer: nightly archive of a folder.
  const timer = want('timer') && save({
    name: 'Sample: Timer nightly archive',
    description: `While deployed, runs every night at 02:00 (Asia/Kolkata): lists ${folder}/*.csv oldest first and moves each file to ${folder}/archive. A test run starts it at once with the payload.`,
    nodes: [
      N('t', 'timer', 'Every night 02:00', 60, 220, { mode: 'cron', cron: '0 0 2 * * *', every: 300, timezone: 'Asia/Kolkata', payload: JSON.stringify({ folder }, null, 2) }),
      N('d', 'fileList', 'Files to archive', 380, 220, { location: '{{input.folder}}/*.csv', pattern: '', recursive: false, sort: 'oldest first', max: 500, format: 'do not read' }),
      N('fe', 'forEach', 'Each file', 700, 160, { list: '{{input.files}}', max: 500 }),
      N('m', 'fileMove', 'Move to archive', 1020, 100, { folder: '{{trigger.folder}}', action: 'move', from: '{{input.name}}', to: "=concat('archive/', format-dateTime('YYYY-MM-DD', current-dateTime(), 'Asia/Kolkata'), '-', {input.name})", overwrite: true }),
      N('l', 'log', 'Log archived', 1020, 260, { level: 'info', message: '{{input.count}} files archived' }),
      N('n', 'log', 'Nothing to archive', 700, 380, { level: 'info', message: 'Nothing to archive in {{trigger.folder}}' }),
    ],
    edges: [E('t', 'd'), E('d', 'fe'), E('fe', 'm', 'item'), E('fe', 'l', 'done'), E('d', 'n', 'empty')],
  });

  // File trigger: a CSV drop folder.
  const inbox = 'C:/sutra/inbox';
  const fileTrig = want('filetrigger') && save({
    name: 'Sample: File trigger CSV drop folder',
    description: `While deployed, starts when a CSV file arrives in ${inbox}: sorts its rows by amount, writes a cleaned copy to ${folder}/clean, and moves the original to ${inbox}/processed. Test runs use the trigger's test event.`,
    nodes: [
      N('t', 'fileTrigger', 'CSV arrives', 60, 220, { folder: inbox, pattern: '*.csv', events: ['added'], recursive: false, pollSeconds: 10, stableSeconds: 2, format: 'CSV rows', encoding: 'utf-8', delimiter: ',', header: true, skipRows: 0, trimValues: true, decimal: '.', schema: '',
        testEvent: JSON.stringify({ event: 'added', name: 'orders.csv', path: `${inbox}/orders.csv`, folder: inbox, size: 120, rows: [{ id: 'A-1', amount: 300 }, { id: 'A-2', amount: 1200 }, { id: 'A-3', amount: 75 }], count: 3 }, null, 2) }),
      N('s', 'sort', 'Largest first', 380, 220, { list: '{{input.rows}}', field: 'amount', dir: 'descending' }),
      N('r', 'renderCsv', 'As CSV', 700, 220, { list: '{{input.items}}', delim: ',' }),
      N('w', 'fileWrite', 'Write clean copy', 1020, 220, { folder: `${folder}/clean`, path: '{{trigger.name}}', format: 'text', content: '{{input.text}}', encoding: 'utf-8', append: false, overwrite: true }),
      N('m', 'fileMove', 'Move original', 1340, 160, { folder: inbox, action: 'move', from: '{{trigger.name}}', to: "=concat('processed/', {trigger.name})", overwrite: true }),
      N('l', 'log', 'Log done', 1660, 160, { level: 'info', message: '{{trigger.name}}: {{trigger.count}} rows, cleaned copy at {{nodes.Write clean copy.path}}' }),
      N('x', 'log', 'Could not move', 1660, 320, { level: 'warn', message: 'Original not moved: {{input.error.message}}' }),
    ],
    edges: [E('t', 's', 'added'), E('s', 'r'), E('r', 'w'), E('w', 'm'), E('m', 'l'), E('m', 'x', 'error')],
  });

  // Parse JSON and CSV text, sort, No operation, Render CSV.
  const textFormats = want('textformats') && save({
    name: 'Sample: Parse JSON and CSV text',
    description: 'A message carries JSON text and CSV text. Parse JSON and Parse CSV turn them into data; Sort list orders the rows; No operation marks a step still to design; Render CSV writes them with a semicolon separator.',
    nodes: [
      N('s', 'start', 'Message', 60, 220, { payload: JSON.stringify({ json: '{"customer": "Asha Traders", "currency": "INR"}', csv: 'sku,qty,price\nTEA-250,4,120\nPOT-02,1,900\nCUP-12,2,90' }, null, 2) }),
      N('j', 'parseJson', 'Parse JSON', 380, 220, { schema: '', text: '{{input.json}}' }),
      N('c', 'parseCsv', 'Parse CSV', 700, 220, { text: '{{trigger.csv}}', delim: ',' }),
      N('o', 'sort', 'By price', 1020, 220, { list: '{{input.rows}}', field: 'price', dir: 'descending' }),
      N('n', 'noop', 'Check stock here later', 1340, 220),
      N('r', 'renderCsv', 'As CSV with ;', 1660, 220, { list: '{{input.items}}', delim: ';' }),
      N('l', 'log', 'Log', 1980, 220, { level: 'info', message: 'For {{nodes.Parse JSON.customer}} ({{nodes.Parse JSON.currency}}):\n{{input.text}}' }),
    ],
    edges: [E('s', 'j'), E('j', 'c'), E('c', 'o'), E('o', 'n'), E('n', 'r'), E('r', 'l')],
  });

  // SQL update (and a stored procedure, which needs a server database).
  const dbConn2 = !want('dbmore') ? null : listResources('database', projectId).find(r => r.name === 'Sample SQLite')
    || saveResource({ kind: 'database', name: 'Sample SQLite', project_id: projectId, config: { driver: 'sqlite', file: 'samples.sqlite' } });
  const dbUpd = dbConn2 && save({
    name: 'Sample: SQL update',
    description: 'Adds to an order amount in the "Sample SQLite" database with bound parameters. "Fail when no row is affected" sends an unknown order id to the error output. Run "Sample: Database (SQLite)" first to create the table.',
    nodes: [
      N('s', 'start', 'Change', 60, 220, { payload: JSON.stringify({ id: 'A-1', add: 50 }, null, 2) }),
      N('u', 'dbUpdate', 'Add to amount', 380, 220, { connection: dbConn2.id, sql: 'UPDATE sample_orders SET amount = amount + :add WHERE id = :id', params: [{ k: 'add', v: '{{input.add}}' }, { k: 'id', v: '{{input.id}}' }], expect: true }),
      N('q', 'dbQuery', 'Read it back', 700, 160, { connection: dbConn2.id, sql: 'SELECT id, amount FROM sample_orders WHERE id = :id', params: [{ k: 'id', v: '{{trigger.id}}' }], maxRows: 10 }),
      N('l', 'log', 'Log new amount', 1020, 160, { level: 'info', message: 'Order {{input.first.id}} is now {{input.first.amount}}' }),
      N('x', 'log', 'Log no such order', 700, 340, { level: 'warn', message: 'Not updated: {{input.error.message}}' }),
    ],
    edges: [E('s', 'u'), E('u', 'q'), E('q', 'l'), E('u', 'x', 'error')],
  });
  const dbProc = dbConn2 && save({
    name: 'Sample: Stored procedure',
    description: 'Calls a stored procedure with named parameters. Pick a PostgreSQL, MySQL, SQL Server or Oracle connection that has a procedure process_order(p_order_id, p_status); SQLite has no procedures.',
    nodes: [
      N('s', 'start', 'Order', 60, 220, { payload: JSON.stringify({ orderId: 'A-1', status: 'SHIPPED' }, null, 2) }),
      N('p', 'dbProcedure', 'process_order', 380, 220, { connection: '', procedure: 'process_order', params: [{ k: 'p_order_id', v: '{{input.orderId}}' }, { k: 'p_status', v: '{{input.status}}' }] }),
      N('l', 'log', 'Log result', 700, 160, { level: 'info', message: '{{input.rowCount}} rows; outputs {{input.outputs | json}}' }),
      N('x', 'log', 'Log failure', 700, 320, { level: 'error', message: 'Procedure failed: {{input.error.message}}' }),
    ],
    edges: [E('s', 'p'), E('p', 'l'), E('p', 'x', 'error')],
  });

  // Call a SOAP service (the SOAP starter, deployed).
  const soapCall = want('soapcall') && save({
    name: 'Sample: Call a SOAP service',
    description: 'Invoke SOAP service sends a GetOrder envelope to the deployed "Order SOAP service" starter (http://127.0.0.1:8080/soap/orders) and maps the reply. A SOAP fault goes to the fault output; a network error to the error output. With a WSDL, choose "wsdl" and pick the operation instead.',
    nodes: [
      N('s', 'start', 'Order id', 60, 220, { payload: JSON.stringify({ orderId: 'A-1001' }, null, 2) }),
      N('c', 'soapInvoke', 'GetOrder', 380, 220, { mode: 'raw envelope', connection: '', auth: '', wsdlSource: 'url', wsdlUrl: '', wsdlRef: '', service: '', port: '', operation: '', argsSource: 'template', args: '', argsSchema: '', responseSchema: '',
        endpoint: 'http://127.0.0.1:8080/soap/orders', soapVersion: '1.1', soapAction: 'urn:sutra:orders/GetOrder',
        bodyXml: '<ord:GetOrder xmlns:ord="urn:sutra:orders">\n  <ord:OrderId>{{input.orderId | xmlescape}}</ord:OrderId>\n</ord:GetOrder>', extraHeaders: '' }),
      N('m', 'mapper', 'Read reply', 700, 120, { start: 'empty', schema: '', mapping: { rules: { orderId: { expr: '{input.body.GetOrderResponse.OrderId}' }, status: { expr: '{input.body.GetOrderResponse.Status}' }, ms: { expr: '{input.ms}' } } } }),
      N('l', 'log', 'Log order', 1020, 120, { level: 'info', message: 'Order {{input.orderId}} is {{input.status}} ({{input.ms}} ms)' }),
      N('f', 'log', 'Log fault', 700, 280, { level: 'warn', message: 'SOAP fault {{input.fault.code}}: {{input.fault.message}}' }),
      N('x', 'log', 'Log call failure', 700, 420, { level: 'error', message: 'Call failed: {{input.error.message}}' }),
    ],
    edges: [E('s', 'c'), E('c', 'm'), E('m', 'l'), E('c', 'f', 'fault'), E('c', 'x', 'error')],
  });

  // Email trigger with AI extract.
  const aiConn = (want('emailin') || want('google') || want('aimore'))
    ? listResources('aiProvider', projectId).find(r => r.name === 'Local Ollama') || saveResource({ kind: 'aiProvider', name: 'Local Ollama', project_id: projectId, config: { engine: 'Ollama', model: '', baseUrl: '', maxTokens: 600, ollamaApi: 'chat' } })
    : null;
  const emailIn = want('emailin') && save({
    name: 'Sample: Email trigger orders by email',
    description: 'While deployed, starts for each new email in the inbox whose subject contains "Order", pulls out the order number, amount and request with AI extract, and logs them; the email is then marked read. Pick an Email (IMAP) connection first.',
    nodes: [
      N('t', 'emailTrigger', 'New order email', 60, 220, { connection: '', mailbox: 'INBOX', filterFrom: '', filterSubject: 'Order', pollSeconds: 60, after: 'mark read', moveTo: 'Processed', attachments: 'no',
        testEmail: JSON.stringify({ from: 'buyer@example.com', subject: 'Order A-2002', text: 'Hello, please send 12 boxes of Assam tea, order A-2002, total 3,600 rupees, by Friday. Thanks, Ravi', attachments: [] }, null, 2) }),
      N('x', 'aiExtract', 'Read the email', 380, 220, { provider: aiConn ? aiConn.id : '', text: 'Subject: {{input.subject}}\n{{input.text}}', fields: [{ k: 'orderId', v: 'the order number' }, { k: 'amount', v: 'total amount as a number' }, { k: 'request', v: 'what the customer asks for, in a few words' }], effort: 'low' }),
      N('l', 'log', 'Log order', 700, 160, { level: 'info', message: 'From {{trigger.from}}: order {{input.orderId}}, {{input.amount}}: {{input.request}}' }),
      N('e', 'log', 'Log failure', 700, 320, { level: 'error', message: 'Could not read the email: {{input.error.message}}' }),
    ],
    edges: [E('t', 'x'), E('x', 'l'), E('x', 'e', 'error')],
  });

  // Firebase: Firestore, Realtime Database, push notification.
  const firebase = want('firebase') && save({
    name: 'Sample: Firebase order to app',
    description: 'Saves the order as a Firestore document, sets its live status in the Realtime Database, and sends a push notification to the customer\'s device token. Pick a Firebase connection in all three.',
    nodes: [
      N('s', 'start', 'Order', 60, 220, { payload: JSON.stringify({ orderId: 'A-3003', customer: 'Asha', amount: 1450, deviceToken: 'paste-a-device-token' }, null, 2) }),
      N('f', 'firestore', 'Save order', 380, 220, { connection: '', op: 'set', collection: 'orders', docId: '{{input.orderId}}', data: '{"customer": "{{input.customer}}", "amount": {{input.amount}}, "status": "confirmed"}', merge: true, where: [], orderBy: '', limit: 100 }),
      N('r', 'firebaseRtdb', 'Live status', 700, 220, { connection: '', op: 'update', path: 'status/{{trigger.orderId}}', data: '{"state": "confirmed", "at": "{{now}}"}' }),
      N('p', 'firebaseNotify', 'Tell the customer', 1020, 220, { connection: '', target: 'token', to: '{{trigger.deviceToken}}', title: "=concat('Order ', {trigger.orderId}, ' confirmed')", body: 'Thank you, {{trigger.customer}}. We are packing it now.', image: '', data: [{ k: 'orderId', v: '{{trigger.orderId}}' }], link: '' }),
      N('l', 'log', 'Log sent', 1340, 160, { level: 'info', message: 'Order {{trigger.orderId}} saved and notified' }),
      N('x', 'log', 'Log failure', 1340, 320, { level: 'error', message: '{{input.error.step}}: {{input.error.message}}' }),
    ],
    edges: [E('s', 'f'), E('f', 'r'), E('r', 'p'), E('p', 'l'), E('f', 'x', 'error'), E('r', 'x', 'error'), E('p', 'x', 'error')],
  });

  // Google: Drive / Docs trigger, Drive export, AI summarize, Sheets append.
  const google = want('google') && save({
    name: 'Sample: Google Drive and Sheets',
    description: 'While deployed, starts when a Google Doc in the folder changes; exports its text; summarises it in one line; appends the name, time and summary to a Google Sheet. Pick the Google OAuth connection, the folder id and the spreadsheet id.',
    nodes: [
      N('t', 'googleDriveTrigger', 'Doc changed', 60, 220, { connection: '', folderId: 'paste-folder-id', mimeType: 'Google Docs', pollSeconds: 60, testEvent: JSON.stringify({ event: 'modified', id: '1AbC', name: 'Quarterly plan', mimeType: 'application/vnd.google-apps.document', modifiedTime: '2026-10-14T09:00:00Z' }, null, 2) }),
      N('d', 'googleDrive', 'Export text', 380, 220, { connection: '', op: 'export', folderId: '', q: '', fileId: '{{input.id}}', exportAs: 'text/plain', name: '', content: '', encoding: 'text', mimeType: '', convert: false }),
      N('a', 'aiSummarize', 'One-line summary', 700, 220, { provider: aiConn ? aiConn.id : '', text: '{{input.content}}', style: 'one line', length: 30, language: 'same as the text', focus: '', effort: 'low' }),
      N('g', 'googleSheets', 'Add to sheet', 1020, 220, { connection: '', op: 'append', spreadsheetId: 'paste-spreadsheet-id', range: 'Changes!A1:C', header: true, rows: '=list(object(\'Document\', {trigger.name}, \'Changed\', {trigger.modifiedTime}, \'Summary\', {input.summary}))', valueInput: 'USER_ENTERED' }),
      N('l', 'log', 'Log', 1340, 220, { level: 'info', message: '{{trigger.name}} summarised and added to the sheet' }),
    ],
    edges: [E('t', 'd', 'modified'), E('t', 'd', 'added'), E('d', 'a'), E('a', 'g'), E('g', 'l')],
  });

  // Dropbox, YouTube and any API of a connected account.
  const apps = want('apps') && save({
    name: 'Sample: Dropbox YouTube and any API',
    description: 'Searches YouTube, saves the results to Dropbox as a JSON file, and calls the Google userinfo API with Connected API call, which reaches any REST API of an OAuth account. Pick a Google connection (YouTube, API call) and a Dropbox connection.',
    nodes: [
      N('s', 'start', 'Topic', 60, 220, { payload: JSON.stringify({ q: 'Assam tea harvest', max: 5 }, null, 2) }),
      N('y', 'youtube', 'Search YouTube', 380, 220, { connection: '', op: 'search', q: '{{input.q}}', videoIds: '', max: 5 }),
      N('d', 'dropbox', 'Save to Dropbox', 700, 220, { connection: '', op: 'upload', path: "=concat('/reports/youtube-', current-date(), '.json')", content: '{{input | json}}', encoding: 'text' }),
      N('a', 'oauthRequest', 'Who am I', 1020, 220, { connection: '', method: 'GET', url: 'https://www.googleapis.com/oauth2/v3/userinfo', query: [], body: '' }),
      N('l', 'log', 'Log', 1340, 220, { level: 'info', message: 'Saved {{nodes.Search YouTube.items | length}} videos for {{input.body.email}}' }),
    ],
    edges: [E('s', 'y'), E('y', 'd'), E('d', 'a'), E('a', 'l')],
  });

  // AI: Ollama, translate, extract, router, prompt.
  const aiMore = aiConn && want('aimore') && save({
    name: 'Sample: AI translate extract route and reply',
    description: 'With the "Local Ollama" connection: the Ollama activity lists the installed models; AI translate turns a Spanish message into English; AI extract pulls the order number and problem; AI router sends it to billing, delivery or technical; AI prompt drafts the reply. Small models (such as phi4-mini) handle common languages; a larger one (such as qwen3) does better with others.',
    nodes: [
      N('s', 'start', 'Message', 60, 260, { payload: JSON.stringify({ text: 'Hola, mi pedido A-4004 todavía no ha llegado. Lo pagué hace diez días. ¿Cuándo llegará?' }, null, 2) }),
      N('o', 'ollama', 'Installed models', 380, 260, { provider: aiConn.id, op: 'list models', model: '', to: '', system: '', prompt: '', messages: '', input: '', images: '', format: '', options: [], keepAlive: '', think: false }),
      N('t', 'aiTranslate', 'To English', 700, 260, { provider: aiConn.id, text: '{{trigger.text}}', to: 'English', from: 'detect', tone: 'as written', glossary: '', effort: 'low' }),
      N('x', 'aiExtract', 'Order and problem', 1020, 260, { provider: aiConn.id, text: '{{input.text}}', fields: [{ k: 'orderId', v: 'the order number' }, { k: 'problem', v: 'the problem in a few words' }], effort: 'low' }),
      N('r', 'aiRouter', 'Which team', 1340, 260, { provider: aiConn.id, text: '{{nodes.To English.text}}', routes: [{ k: 'billing', v: 'payments, invoices, refunds' }, { k: 'delivery', v: 'late, missing or damaged deliveries' }, { k: 'technical', v: 'the website or app does not work' }], mode: 'best match', effort: 'low' }),
      N('p', 'aiPrompt', 'Draft reply', 1680, 200, { provider: aiConn.id, system: 'You write short, kind customer service replies in English. Two or three sentences.', prompt: "=concat('Customer message: ', {nodes.To English.text}, ' Order: ', {nodes.Order and problem.orderId}, '. Team: ', {input.routes}, '. Write the reply.')", effort: 'low' }),
      N('l', 'log', 'Log reply', 2000, 200, { level: 'info', message: 'Models: {{nodes.Installed models.models | length}}. {{input.text}}' }),
      N('n', 'log', 'No team', 1680, 380, { level: 'warn', message: 'No team matched: {{input.reason}}' }),
    ],
    edges: [E('s', 'o'), E('o', 't'), E('t', 'x'), E('x', 'r'), E('r', 'p', 'billing'), E('r', 'p', 'delivery'), E('r', 'p', 'technical'), E('r', 'n', 'otherwise'), E('p', 'l')],
  });

  // Release pipeline: build, check, deploy to test, approval, deploy to production.
  const release = want('release') && save({
    name: 'Sample: Release pipeline',
    description: 'Releases a project as a package: Build package, Check package, Deploy package to a test copy on this server, Human approval, Deploy package to production (choose "remote server" with its address and admin token for a real production engine). Any problem goes to the Error handler.',
    nodes: [
      N('s', 'start', 'Release request', 60, 240, { payload: JSON.stringify({ project: 'Default project', version: '1.0.0' }, null, 2) }),
      N('b', 'releasePackage', 'Build package', 380, 240, { target: 'this server', project: '{{input.project}}', version: '{{input.version}}', note: 'Released by a Sutra', sutras: [], saveTo: '' }),
      N('c', 'releaseCheck', 'Check package', 700, 240, { packageFrom: 'previous step', package: '{{input.package}}', target: 'this server', project: "=concat({trigger.project}, ' (test)')" }),
      N('t', 'releaseDeploy', 'Deploy to test', 1020, 160, { packageFrom: 'previous step', package: '{{input.package}}', target: 'this server', project: "=concat({trigger.project}, ' (test)')", keepOthers: false, opsFile: '' }),
      N('a', 'approval', 'Approve production', 1340, 160, { message: 'Deploy {{trigger.project}} {{trigger.version}} to production? Test deploy: {{input.sutras | length}} Sutras.', assignee: 'release-managers' }),
      N('p', 'releaseDeploy', 'Deploy to production', 1660, 100, { packageFrom: 'previous step', package: '{{nodes.Build package.package}}', target: 'this server', project: "=concat({trigger.project}, ' (production)')", keepOthers: false, opsFile: '' }),
      N('l', 'log', 'Log released', 1980, 100, { level: 'info', message: '{{trigger.project}} {{trigger.version}} released: {{input.sutras | length}} Sutras' }),
      N('r', 'log', 'Log rejected', 1660, 260, { level: 'warn', message: 'Production release rejected: {{input.approval.comment}}' }),
      N('x', 'log', 'Log check problems', 1020, 360, { level: 'error', message: 'Not released: {{input.errors}}' }),
      N('h', 'catch', 'Error handler', 380, 480),
      N('e', 'log', 'Log release failure', 700, 480, { level: 'error', message: 'Release failed at {{input.error.step}}: {{input.error.message}}' }),
    ],
    edges: [E('s', 'b'), E('b', 'c'), E('c', 't', 'ok'), E('c', 'x', 'problems'), E('t', 'a'), E('a', 'p', 'approved'), E('a', 'r', 'rejected'), E('p', 'l'), E('h', 'e')],
  });

  // Local AI with Ollama (offline).
  const ollamaConn = !want('localai') ? null : listResources('aiProvider', projectId).find(r => r.name === 'Local Ollama')
    || saveResource({ kind: 'aiProvider', name: 'Local Ollama', project_id: projectId, config: { engine: 'Ollama', model: '', baseUrl: '', maxTokens: 600, ollamaApi: 'chat' } });
  const localAi = ollamaConn && save({
    name: 'Sample: Local AI with Ollama',
    description: 'Uses the "Local Ollama" connection (the first installed model; pick another with List models). AI classify sends the email down a branch, then AI summarize and AI sentiment run on it. Works without internet.',
    nodes: [
      N('s', 'start', 'Customer email', 60, 220, { payload: JSON.stringify({ from: 'meera@example.com', text: 'Hello, my order A-1001 arrived with two broken cups and the tea was missing. I paid 1,450 rupees. Please send a refund or replace them this week. Very disappointed.' }, null, 2) }),
      N('c', 'aiClassify', 'What is it about', 380, 220, { provider: ollamaConn.id, text: '{{input.text}}', labels: 'refund, delivery, question', guidance: 'refund: asks for money back or replacement', effort: 'low' }),
      N('m', 'aiSummarize', 'Summary', 720, 140, { provider: ollamaConn.id, text: '{{trigger.text}}', style: 'one line', length: 25, language: 'same as the text', focus: 'what the customer wants', effort: 'low' }),
      N('t', 'aiSentiment', 'Feeling', 1060, 140, { provider: ollamaConn.id, text: '{{trigger.text}}', aspects: 'delivery, product', effort: 'low' }),
      N('l1', 'log', 'Log unhappy', 1400, 60, { level: 'warn', message: 'Unhappy customer ({{input.score}}): {{nodes.Summary.summary}}' }),
      N('l2', 'log', 'Log other feeling', 1400, 240, { level: 'info', message: '{{input.sentiment}}: {{nodes.Summary.summary}}' }),
      N('l3', 'log', 'Not a refund', 720, 360, { level: 'info', message: 'Sent to the {{input.label}} team: {{input.reason}}' }),
    ],
    edges: [E('s', 'c'), E('c', 'm', 'refund'), E('m', 't'), E('t', 'l1', 'negative'), E('t', 'l2', 'neutral'), E('t', 'l2', 'positive'),
      E('c', 'l3', 'delivery'), E('c', 'l3', 'question'), E('c', 'l3', 'other')],
  });

  // Email a report (needs an SMTP connection).
  const email = want('email') && save({
    name: 'Sample: Email a report',
    description: 'Builds an HTML report and sends it. Add an Email (SMTP) connection under Resources and pick it in Send email before testing; a failure goes to the error output and is logged.',
    nodes: [
      N('s', 'start', 'Report data', 60, 200, { payload: JSON.stringify({ to: 'ops@example.com', orders: sales }, null, 2) }),
      N('h', 'htmlTemplate', 'Report', 380, 200, { html: '<h2>Daily orders</h2>\n<ul>{{#each input.orders}}<li>{{this.orderId}} {{this.customer}}: {{this.amount}} ({{this.status}})</li>{{/each}}</ul>' }),
      N('m', 'emailSend', 'Send email', 700, 200, { connection: '', from: '', to: '{{trigger.to}}', cc: '', bcc: '', replyTo: '', subject: "=concat('Daily orders ', current-date())", text: '', html: '{{input.html}}', attachments: '' }),
      N('ok', 'log', 'Log sent', 1020, 120, { level: 'info', message: 'Report sent to {{input.accepted}}' }),
      N('bad', 'log', 'Log failure', 1020, 300, { level: 'error', message: 'Report not sent: {{input.error.message}}' }),
    ],
    edges: [E('s', 'h'), E('h', 'm'), E('m', 'ok'), E('m', 'bad', 'error')],
  });

  // Queue in and out (needs a broker connection).
  const queue = want('queue') && save({
    name: 'Sample: Queue in and out',
    description: 'Message subscriber takes orders from the queue "orders.in" (acknowledge: explicit); Map data reshapes them; Publish message sends them to "orders.out" as persistent messages; Confirm message acknowledges. Pick an ActiveMQ, RabbitMQ or Kafka connection in both, then deploy.',
    nodes: [
      N('t', 'busSubscribe', 'Orders in', 60, 200, { broker: 'amqp1', amqpConn: '', rabbitConn: '', kafkaConn: '', destinationType: 'queue', destination: 'orders.in', selector: '', durableName: '', groupId: 'sutraflow', fromBeginning: false, declare: true, messageType: 'JSON', ackMode: 'explicit', onFailure: 'requeue', maxRedeliveries: 5, concurrency: 1, testMessage: JSON.stringify({ orderId: 'A-12', qty: 2 }, null, 2) }),
      N('m', 'mapper', 'Reshape', 380, 200, { start: 'empty', schema: '', mapping: { rules: { id: { expr: '{input.body.orderId}' }, quantity: { expr: 'number({input.body.qty})' }, receivedAt: { expr: 'current-dateTime()' } } } }),
      N('p', 'busPublish', 'Orders out', 700, 200, { broker: 'amqp1', amqpConn: '', rabbitConn: '', kafkaConn: '', destinationType: 'queue', destination: 'orders.out', exchange: '', messageType: 'JSON', body: '{{input}}', deliveryMode: 'persistent', priority: 4, timeToLive: 0, messageId: '', correlationId: '{{trigger.headers.messageId}}', replyTo: '', jmsType: 'Order', key: '', acks: 'all', properties: [{ k: 'source', v: 'sutraflow' }] }),
      N('c', 'busConfirm', 'Confirm', 1020, 200, { action: 'confirm' }),
    ],
    edges: [E('t', 'm'), E('m', 'p'), E('p', 'c')],
  });

  // Public SOAP service from its WSDL.
  const soapPublic = want('soappublic') && save({
    name: 'Sample: Call a public SOAP service',
    description: 'Invoke SOAP service loads the WSDL of the free calculator service at dneonline.com, calls Add, then Multiply with the sum. A SOAP fault (for example a number too large) goes to the fault output; no internet goes to the error output. "Load operations" in the step lists what a WSDL offers.',
    nodes: [
      N('s', 'start', 'Numbers', 60, 220, { payload: JSON.stringify({ a: 12, b: 30, times: 3 }, null, 2) }),
      N('a', 'soapInvoke', 'Add', 380, 220, { mode: 'wsdl', connection: '', auth: '', wsdlSource: 'url', wsdlUrl: 'http://www.dneonline.com/calculator.asmx?WSDL', service: 'Calculator', port: 'CalculatorSoap', operation: 'Add', argsSource: 'template', args: '{\n  "intA": {{input.a}},\n  "intB": {{input.b}}\n}', responseSchema: '', endpoint: '' }),
      N('m', 'soapInvoke', 'Multiply', 700, 160, { mode: 'wsdl', connection: '', auth: '', wsdlSource: 'url', wsdlUrl: 'http://www.dneonline.com/calculator.asmx?WSDL', service: 'Calculator', port: 'CalculatorSoap', operation: 'Multiply', argsSource: 'template', args: '{\n  "intA": {{input.body.AddResult}},\n  "intB": {{trigger.times}}\n}', responseSchema: '', endpoint: '' }),
      N('l', 'log', 'Log result', 1020, 160, { level: 'info', message: '({{trigger.a}} + {{trigger.b}}) x {{trigger.times}} = {{input.body.MultiplyResult}} ({{input.ms}} ms)' }),
      N('f', 'log', 'Log fault', 700, 320, { level: 'warn', message: 'SOAP fault {{input.fault.code}}: {{input.fault.message}}' }),
      N('x', 'log', 'Log call failure', 700, 460, { level: 'error', message: 'Service not reached: {{input.error.message}}' }),
    ],
    edges: [E('s', 'a'), E('a', 'm'), E('m', 'l'), E('a', 'f', 'fault'), E('m', 'f', 'fault'), E('a', 'x', 'error'), E('m', 'x', 'error')],
  });

  // Mock SOAP service (canned replies) and a caller.
  const weather = { Pune: { TempC: 31, Sky: 'Sunny', Humidity: 40 }, Shimla: { TempC: 12, Sky: 'Cloudy', Humidity: 70 }, Chennai: { TempC: 34, Sky: 'Humid', Humidity: 82 } };
  const soapMock = want('soapmock') && save({
    name: 'Sample: Mock SOAP weather service',
    description: `A stand-in for a SOAP service that does not exist yet. Deploy it: the WSDL is at ${gw}/samples/soap/weather?wsdl. GetWeather answers canned values for Pune, Shimla and Chennai; any other city gets a SOAP fault. ListCities returns the names.`,
    nodes: [
      N('t', 'soapService', 'Weather WS', 60, 220, { serviceName: 'WeatherService', namespace: 'urn:sutra:weather', path: '/samples/soap/weather', operations: 'GetWeather, ListCities', soapVersion: '1.1', policy: '', testRequest: JSON.stringify({ operation: 'GetWeather', body: { City: 'Pune' } }, null, 2) }),
      N('j', 'jsonata', 'Canned weather', 380, 140, { source: '{{input}}', expression: `(\n  $data := ${JSON.stringify(weather)};\n  $w := $lookup($data, body.City);\n  $w ? $merge([{ "City": body.City }, $w]) : { "City": body.City, "Unknown": true }\n)` }),
      N('i', 'if', 'Known city', 700, 140, { left: '{{input.Unknown}}', op: 'is empty', right: '' }),
      N('r', 'soapReply', 'Reply weather', 1020, 60, { kind: 'response', bodySource: 'template', body: '{{input}}' }),
      N('f', 'soapReply', 'Unknown city', 1020, 220, { kind: 'fault', faultCode: 'soap:Client', faultString: 'No weather for {{input.City}}' }),
      N('c', 'soapReply', 'Reply cities', 380, 340, { kind: 'response', bodySource: 'template', body: JSON.stringify({ City: Object.keys(weather) }) }),
    ],
    edges: [E('t', 'j', 'GetWeather'), E('j', 'i'), E('i', 'r', 'true'), E('i', 'f', 'false'), E('t', 'c', 'ListCities')],
  });
  const soapMockCall = soapMock && save({
    name: 'Sample: Call the mock SOAP service',
    description: `Calls GetWeather on the deployed "Sample: Mock SOAP weather service" (${gw}/samples/soap/weather) with a raw envelope, then reads the reply. Try the city Delhi to see the fault output. When the real service is ready, change only the endpoint.`,
    nodes: [
      N('s', 'start', 'City', 60, 220, { payload: JSON.stringify({ city: 'Pune' }, null, 2) }),
      N('c', 'soapInvoke', 'GetWeather', 380, 220, { mode: 'raw envelope', connection: '', auth: '', endpoint: `${gw}/samples/soap/weather`, soapVersion: '1.1', soapAction: 'urn:sutra:weather/GetWeather',
        bodyXml: '<w:GetWeather xmlns:w="urn:sutra:weather">\n  <w:City>{{input.city | xmlescape}}</w:City>\n</w:GetWeather>', extraHeaders: '' }),
      N('l', 'log', 'Log weather', 700, 140, { level: 'info', message: '{{input.body.GetWeatherResponse.City}}: {{input.body.GetWeatherResponse.TempC}} C, {{input.body.GetWeatherResponse.Sky}} ({{input.ms}} ms)' }),
      N('f', 'log', 'Log fault', 700, 300, { level: 'warn', message: 'SOAP fault {{input.fault.code}}: {{input.fault.message}}' }),
      N('x', 'log', 'Log not deployed', 700, 440, { level: 'error', message: 'Mock service not reached (deploy it first): {{input.error.message}}' }),
    ],
    edges: [E('s', 'c'), E('c', 'l'), E('c', 'f', 'fault'), E('c', 'x', 'error')],
  });

  // JSON microservices: two small services and one that composes them.
  const customers = { 'C-1': { id: 'C-1', name: 'Asha Traders', city: 'Pune', tier: 'gold' }, 'C-2': { id: 'C-2', name: 'Kandy Stores', city: 'Colombo', tier: 'silver' } };
  const stock = { 'TEA-01': { sku: 'TEA-01', title: 'Assam tea 500 g', price: 240, onHand: 120 }, 'CUP-02': { sku: 'CUP-02', title: 'Clay cups, set of 6', price: 450, onHand: 4 } };
  const lookupService = (id: string, title: string, path: string, data: any, key: string, y: number, test: string) => save({
    name: `Sample: Microservice ${title}`,
    description: `GET ${path}/:id answers one ${title.toLowerCase()} record as JSON, or 404. Deploy it; "Sample: Microservice Orders" calls it at ${gw}${path}/...`,
    nodes: [
      N('t', 'restService', `${title} API`, 60, y, { method: 'GET', path: `${path}/:id`, policy: '', maxBodyKb: 16, bodySchema: '', testRequest: JSON.stringify({ method: 'GET', params: { id: test }, query: {}, headers: {}, body: null }, null, 2) }),
      N('j', 'jsonata', `Find ${key}`, 380, y, { source: '{{input}}', expression: `(\n  $data := ${JSON.stringify(data)};\n  $lookup($data, params.id) ? $lookup($data, params.id) : { "missing": params.id }\n)` }),
      N('i', 'if', 'Found', 700, y, { left: '{{input.missing}}', op: 'is empty', right: '' }),
      N('ok', 'httpResponse', 'Reply 200', 1020, y - 80, { status: '200', contentType: 'application/json', bodySource: 'template', body: '{{input}}', headers: [] }),
      N('no', 'httpResponse', 'Reply 404', 1020, y + 80, { status: '404', contentType: 'application/json', bodySource: 'template', body: `{"error": "No ${key} {{input.missing}}"}`, headers: [] }),
    ],
    edges: [E('t', 'j'), E('j', 'i'), E('i', 'ok', 'true'), E('i', 'no', 'false')],
  });
  const msCustomers = want('microservices') && lookupService('customers', 'Customers', '/samples/ms/customers', customers, 'customer', 220, 'C-1');
  const msStock = msCustomers && lookupService('stock', 'Stock', '/samples/ms/stock', stock, 'item', 220, 'TEA-01');
  const msOrders = msCustomers && save({
    name: 'Sample: Microservice Orders',
    description: `POST /samples/ms/orders with {"customerId", "sku", "qty"}: calls the Customers and Stock services over HTTP (${gw}), checks the stock, and answers one JSON order. 404 from a service goes to the error output and becomes 404; too little stock is 409. Deploy all three, then: curl -X POST ${gw}/samples/ms/orders -H "Content-Type: application/json" -d "{\\"customerId\\":\\"C-1\\",\\"sku\\":\\"TEA-01\\",\\"qty\\":3}"`,
    nodes: [
      N('t', 'restService', 'Orders API', 60, 240, { method: 'POST', path: '/samples/ms/orders', policy: '', maxBodyKb: 16, bodySchema: '', testRequest: JSON.stringify({ method: 'POST', params: {}, query: {}, headers: { 'content-type': 'application/json' }, body: { customerId: 'C-1', sku: 'TEA-01', qty: 3 } }, null, 2) }),
      N('c', 'httpRequest', 'Get customer', 380, 240, { connection: '', auth: '', method: 'GET', url: `${gw}/samples/ms/customers/{{input.body.customerId | urlencode}}`, query: [], headers: [{ k: 'Accept', v: 'application/json' }], bodyType: 'none', parse: 'json', failOn: '4xx or 5xx' }),
      N('k', 'httpRequest', 'Get stock', 700, 240, { connection: '', auth: '', method: 'GET', url: `${gw}/samples/ms/stock/{{trigger.body.sku | urlencode}}`, query: [], headers: [{ k: 'Accept', v: 'application/json' }], bodyType: 'none', parse: 'json', failOn: '4xx or 5xx' }),
      N('j', 'jsonata', 'Combine', 1020, 240, { source: '{{input}}', expression: '(\n  $c := $nodes."Get customer".body;\n  $s := $nodes."Get stock".body;\n  $q := $number($trigger.body.qty);\n  {\n    "orderId": "O-" & $string($millis()),\n    "customer": { "id": $c.id, "name": $c.name, "tier": $c.tier },\n    "item": { "sku": $s.sku, "title": $s.title, "qty": $q, "price": $s.price },\n    "discount": $c.tier = "gold" ? 0.1 : 0,\n    "total": $round($q * $s.price * ($c.tier = "gold" ? 0.9 : 1), 2),\n    "inStock": $s.onHand >= $q\n  }\n)' }),
      N('i', 'if', 'In stock', 1340, 240, { left: '{{input.inStock}}', op: 'equals', right: 'true' }),
      N('ok', 'httpResponse', 'Reply 201', 1660, 160, { status: '201', contentType: 'application/json', bodySource: 'template', body: '{{input}}', headers: [] }),
      N('no', 'httpResponse', 'Reply 409', 1660, 320, { status: '409', contentType: 'application/json', bodySource: 'template', body: '{"error": "Only {{nodes.Get stock.body.onHand}} in stock", "order": {{input | json}}}', headers: [] }),
      N('nf', 'httpResponse', 'Reply 404 or 502', 700, 440, { status: "=if(contains({input.error.message}, 'returned 404'), '404', '502')", contentType: 'application/json', bodySource: 'template', body: '{"error": {{input.error.message | json}}}', headers: [] }),
    ],
    edges: [E('t', 'c'), E('c', 'k'), E('k', 'j'), E('j', 'i'), E('i', 'ok', 'true'), E('i', 'no', 'false'), E('c', 'nf', 'error'), E('k', 'nf', 'error')],
  });

  // SQL install script, then a stored procedure exposed as a microservice (MySQL).
  const mysql = !want('sqlinstall') ? null : conn('database', 'Sample MySQL', { driver: 'mysql', host: '127.0.0.1', port: 3306, database: '', user: 'root', passwordSecret: '' });
  const sqlInstall = mysql && save({
    name: 'Sample: SQL install script',
    description: 'SQL script runs an install script on the "Sample MySQL" connection (Laragon defaults: 127.0.0.1:3306, root, no password): creates the database sutraflow_samples, the tables customers and orders, seed rows, and the stored procedure customer_orders(customer, min_total). Safe to run again. Then deploy "Sample: Procedure as a microservice".',
    nodes: [
      N('s', 'start', 'Install', 60, 220, { payload: JSON.stringify({ seedCity: 'Pune' }, null, 2) }),
      N('x', 'dbScript', 'Install schema', 380, 220, { connection: mysql.id, onError: 'stop', params: [{ k: 'city', v: '{{input.seedCity}}' }], sql: [
        'CREATE DATABASE IF NOT EXISTS sutraflow_samples',
        'CREATE TABLE IF NOT EXISTS sutraflow_samples.customers (\n  id VARCHAR(20) PRIMARY KEY,\n  name VARCHAR(100) NOT NULL,\n  city VARCHAR(60)\n)',
        'CREATE TABLE IF NOT EXISTS sutraflow_samples.orders (\n  id VARCHAR(20) PRIMARY KEY,\n  customer_id VARCHAR(20) NOT NULL,\n  total DECIMAL(10,2) NOT NULL,\n  status VARCHAR(20) NOT NULL,\n  INDEX (customer_id)\n)',
        "INSERT IGNORE INTO sutraflow_samples.customers (id, name, city) VALUES\n  ('C-1', 'Asha Traders', :city),\n  ('C-2', 'Kandy Stores', 'Colombo')",
        "INSERT IGNORE INTO sutraflow_samples.orders (id, customer_id, total, status) VALUES\n  ('A-1', 'C-1', 1200.00, 'paid'),\n  ('A-2', 'C-1', 300.00, 'open'),\n  ('A-3', 'C-2', 2450.50, 'paid'),\n  ('A-4', 'C-1', 5400.00, 'paid')",
        'DROP PROCEDURE IF EXISTS sutraflow_samples.customer_orders',
        'CREATE PROCEDURE sutraflow_samples.customer_orders(IN p_customer VARCHAR(20), IN p_min DECIMAL(10,2))\nBEGIN\n  SELECT o.id, c.name AS customer, o.total, o.status\n  FROM sutraflow_samples.orders o JOIN sutraflow_samples.customers c ON c.id = o.customer_id\n  WHERE o.customer_id = p_customer AND o.total >= p_min\n  ORDER BY o.total DESC;\nEND',
      ].join('\n;\n') }),
      N('l', 'log', 'Log install', 700, 160, { level: 'info', message: '{{input.ran}} statements ran on {{input.connection}} in {{input.ms}} ms' }),
      N('e', 'log', 'Log failure', 700, 320, { level: 'error', message: 'Install stopped: {{input.error.message}}' }),
    ],
    edges: [E('s', 'x'), E('x', 'l'), E('x', 'e', 'error')],
  });
  const sqlService = mysql && save({
    name: 'Sample: Procedure as a microservice',
    description: `GET /samples/sql/customers/:id/orders?min=500 calls the stored procedure customer_orders (made by "Sample: SQL install script") and answers its rows as JSON. Deploy it, then open ${gw}/samples/sql/customers/C-1/orders?min=500`,
    nodes: [
      N('t', 'restService', 'Customer orders API', 60, 220, { method: 'GET', path: '/samples/sql/customers/:id/orders', policy: '', maxBodyKb: 16, bodySchema: '', testRequest: JSON.stringify({ method: 'GET', params: { id: 'C-1' }, query: { min: '500' }, headers: {}, body: null }, null, 2) }),
      N('p', 'dbProcedure', 'customer_orders', 380, 220, { connection: mysql.id, procedure: 'sutraflow_samples.customer_orders', params: [{ k: 'p_customer', v: '{{input.params.id}}' }, { k: 'p_min', v: "=coalesce({input.query.min}, '0')" }] }),
      N('ok', 'httpResponse', 'Reply 200', 700, 140, { status: '200', contentType: 'application/json', bodySource: 'template', body: '{"customer": "{{trigger.params.id}}", "count": {{input.rowCount}}, "orders": {{input.rows | json}}, "ms": {{input.ms}}}', headers: [] }),
      N('bad', 'httpResponse', 'Reply 500', 700, 320, { status: '500', contentType: 'application/json', bodySource: 'template', body: '{"error": {{input.error.message | json}}}', headers: [] }),
    ],
    edges: [E('t', 'p'), E('p', 'ok'), E('p', 'bad', 'error')],
  });

  // SFTP and FTP: every remote file step, and a trigger.
  const remote = (proto: 'SFTP' | 'FTP', c: { id: string }) => {
    const k = proto === 'SFTP' ? { protocol: 'SFTP', sftpConn: c.id } : { protocol: 'FTP', ftpConn: c.id };
    const tag = proto.toLowerCase();
    const steps = save({
      name: `Sample: ${proto} upload list read archive`,
      description: `Uses the "Sample ${proto}" connection (set its host, user and password first; servers far away may need longer time limits there). Writes outbox/orders.csv, appends a line, lists the CSV files with their rows, reads the file as lines, copies it to archive/, moves the original to a dated name and deletes the copy.`,
      nodes: [
        N('s', 'start', 'Orders', 60, 220, { payload: JSON.stringify({ rows: sales.slice(0, 3), more: 'A-9,Late Shop,IN,paid,75' }, null, 2) }),
        N('w', 'remoteWrite', 'Write CSV', 340, 220, { ...k, path: 'outbox/orders.csv', format: 'CSV from rows', rows: '{{input.rows}}', delimiter: ',', header: true, encoding: 'utf-8', lineEnding: 'LF', append: false, overwrite: true }),
        N('a', 'remoteWrite', 'Append a line', 620, 220, { ...k, path: 'outbox/orders.csv', format: 'text', content: '{{trigger.more}}', encoding: 'utf-8', append: true, newline: true }),
        N('l', 'remoteList', 'List CSV files', 900, 220, { ...k, folder: 'outbox', pattern: '*.csv', recursive: false, sort: 'newest first', max: 100, format: 'CSV rows', encoding: 'utf-8', delimiter: ',', header: true, skipRows: 0, trimValues: true, decimal: '.' }),
        N('r', 'remoteRead', 'Read as lines', 1180, 220, { ...k, path: 'outbox/orders.csv', format: 'lines', encoding: 'utf-8', skipRows: 1, maxMb: 50 }),
        N('c', 'remoteMove', 'Copy to archive', 1460, 220, { ...k, action: 'copy', from: 'outbox/orders.csv', to: 'archive/orders-copy.csv', overwrite: true }),
        N('m', 'remoteMove', 'Move to dated name', 1740, 220, { ...k, action: 'move', from: 'outbox/orders.csv', to: "=concat('archive/orders-', current-timestamp('YYYYMMDD-HHmmss'), '.csv')", overwrite: true }),
        N('d', 'remoteMove', 'Delete the copy', 2020, 220, { ...k, action: 'delete', from: 'archive/orders-copy.csv' }),
        N('g', 'log', 'Log done', 2300, 220, { level: 'info', message: '{{nodes.List CSV files.count}} CSV files listed, {{nodes.Read as lines.count}} order lines read on {{nodes.Read as lines.server}}' }),
        N('n', 'log', 'Log nothing listed', 900, 380, { level: 'warn', message: 'No CSV files in outbox/' }),
        N('x', 'log', 'Log failure', 620, 520, { level: 'error', message: '{{input.error.step}}: {{input.error.message}}' }),
      ],
      edges: [E('s', 'w'), E('w', 'a'), E('a', 'l'), E('l', 'r'), E('r', 'c'), E('c', 'm'), E('m', 'd'), E('d', 'g'), E('l', 'n', 'empty'),
        ...['w', 'a', 'l', 'r', 'c', 'm', 'd'].map(n => E(n, 'x', 'error'))],
    });
    const trig = save({
      name: `Sample: ${proto} file trigger`,
      description: `While deployed, checks inbox/ on the "Sample ${proto}" server every 60 seconds for new *.csv files that have stopped growing, reads each as CSV rows, logs the total, and ${proto === 'SFTP' ? 'moves the file to inbox/done/' : 'deletes the file'} after a successful run.`,
      nodes: [
        N('t', 'remoteTrigger', 'New CSV in inbox', 60, 220, { ...k, folder: 'inbox', pattern: '*.csv', pollSeconds: 60, after: proto === 'SFTP' ? 'move to a folder' : 'delete', moveTo: 'inbox/done', format: 'CSV rows', encoding: 'utf-8', delimiter: ',', header: true, skipRows: 0, trimValues: true, decimal: '.', maxMb: 50,
          testEvent: JSON.stringify({ name: 'orders.csv', path: '/inbox/orders.csv', relativePath: 'inbox/orders.csv', size: 120, server: `${tag}.example.com`, rows: [{ id: 'A-1', amount: 300 }, { id: 'A-2', amount: 1200 }], count: 2 }, null, 2) }),
        N('a', 'aggregate', 'Total', 380, 220, { list: '{{input.rows}}', field: 'amount', fn: 'sum', groupBy: '' }),
        N('l', 'log', 'Log file', 700, 220, { level: 'info', message: '{{trigger.name}} from {{trigger.server}}: {{trigger.count}} rows, total {{input.result}}' }),
      ],
      edges: [E('t', 'a'), E('a', 'l')],
    });
    return [steps, trig];
  };
  const sftpConn = !want('sftp') ? null : conn('sftp', 'Sample SFTP', { host: 'sftp.example.com', port: 22, user: 'sample', auth: 'password', baseFolder: '/', connectSec: 30, responseSec: 120, attempts: 3, retryWaitSec: 5, keepaliveSec: 15 });
  const sftp = sftpConn ? remote('SFTP', sftpConn) : [];
  const ftpConn = !want('ftp') ? null : conn('ftp', 'Sample FTP', { host: 'ftp.example.com', port: 21, user: 'sample', security: 'explicit TLS', verifyTls: true, baseFolder: '/', connectSec: 30, responseSec: 120, attempts: 3, retryWaitSec: 5 });
  const ftp = ftpConn ? remote('FTP', ftpConn) : [];

  // ---------- AI agents ----------
  const ai = (want('agentdesk') || want('agentrag') || want('agentqueue') || want('agentteam') || want('agentmcp'))
    ? conn('aiProvider', 'Local Ollama', { engine: 'Ollama', model: '', baseUrl: '', maxTokens: 800, ollamaApi: 'chat' }) : null;
  const memStore = ai && conn('aiMemory', 'Sample AI memory', { store: 'built-in', contextTokens: 6000, replyTokens: 800, keepTurns: 6, summarise: 'summarise older turns', keepDays: 90 });
  const kbConn = ai && conn('aiKnowledge', 'Sample knowledge base', { store: 'built-in', embedWith: 'built-in', chunkTokens: 250, overlapTokens: 40 });
  const tool = (sutra: string, toolName: string, description: string, inputs: { k: string; v: string }[], expression: string, test: unknown) => save({
    name: sutra,
    description: `An AI tool: AI agents of this project use it, and while deployed AI assistants can call ${toolName} over MCP. ${description}`,
    nodes: [
      N('t', 'mcpTool', toolName, 60, 220, { toolName, title: sutra.replace(/^Sample: AI tool /, ''), description, inputs, forAgents: true, changesData: false, testArguments: JSON.stringify(test, null, 2) }),
      N('j', 'jsonata', 'Look up', 380, 220, { source: '{{input}}', expression }),
      N('r', 'mcpReply', 'Reply to AI', 700, 220, { source: 'value', result: '{{input}}', isError: false }),
    ],
    edges: [E('t', 'j'), E('j', 'r')],
  });
  const ordersData = { 'A-1001': { status: 'SHIPPED', carrier: 'Blue Dart', deliveryDate: '2026-10-21', amount: 1450 }, 'A-1002': { status: 'PACKING', carrier: '', deliveryDate: '2026-10-24', amount: 980 }, 'A-1003': { status: 'DELIVERED', carrier: 'Delhivery', deliveryDate: '2026-10-15', amount: 2200 } };
  const toolOrder = ai && want('agentdesk') && tool('Sample: AI tool order status', 'order_status', 'Returns the status, carrier, delivery date and amount of an order by its number, such as A-1001.', [{ k: 'orderId', v: 'The order number, such as A-1001' }],
    `(\n  $o := $lookup(${JSON.stringify(ordersData)}, arguments.orderId);\n  $o ? $merge([{ "orderId": arguments.orderId }, $o]) : { "orderId": arguments.orderId, "error": "No such order" }\n)`, { orderId: 'A-1001' });
  const toolStock = toolOrder && tool('Sample: AI tool stock check', 'stock_check', 'Returns how many of a product are in stock and its price, by product name or code (TEA-01 Assam tea, CUP-02 clay cups).', [{ k: 'product', v: 'Product name or code' }],
    '(\n  $p := $lowercase(arguments.product);\n  $contains($p, "tea") ? { "sku": "TEA-01", "title": "Assam tea 500 g", "inStock": 120, "price": 240 } : $contains($p, "cup") ? { "sku": "CUP-02", "title": "Clay cups, set of 6", "inStock": 4, "price": 450 } : { "error": "Unknown product" }\n)', { product: 'tea' });
  const desk = toolOrder && save({
    name: 'Sample: Order desk agent',
    description: `Published as the agent "order-desk": chat at ${gw}/chat/order-desk (add ${gw}/chat/order-desk/widget.js to any web page for a chat button), OpenAI-compatible model order-desk at ${gw}/v1/chat/completions, MCP tool ask_order_desk at ${gw}/mcp, and A2A at ${gw}/a2a/order-desk. The AI guard hides personal data and stops hidden instructions; refund and cancellation requests go straight to the shop owner (Runs > Approvals) and the caller gets the answer as a job; everything else goes to the agent, which uses the order and stock tools, remembers each session, and may ask the owner itself. Deploy the two AI tool Sutras and this one.`,
    nodes: [
      N('t', 'agentChannel', 'Order desk', 60, 260, { agentName: 'order-desk', title: 'Order desk', description: 'Answers questions about orders, delivery and stock for Asha Traders, and passes refund requests to a person.', chat: true, chatPolicy: '', openai: true, openaiPolicy: '', mcp: true, mcpServer: '', a2a: true, a2aPolicy: '', waitSeconds: 50, testMessage: JSON.stringify({ message: 'When will order A-1001 arrive, and is Assam tea in stock?', sessionId: 'test-1' }, null, 2) }),
      N('g', 'aiGuard', 'Check the message', 340, 260, { text: '{{input.message}}', checks: ['hide personal data', 'hidden instructions', 'blocked topics', 'length'], topics: 'medical advice\nlegal advice\nweapons', maxChars: 4000 }),
      N('i', 'if', 'Refund or cancel', 640, 260, { left: '{{input.text}}', op: 'matches regex', right: '[Rr]efund|[Cc]ancel|money back' }),
      N('q', 'askPerson', 'Ask about the refund', 980, 420, { question: 'Order desk ({{trigger.sessionId}}) refund or cancellation: {{input.text}}', assignee: 'shop-owner' }),
      N('a', 'aiAgent', 'Order desk agent', 940, 200, { provider: ai.id, instructions: 'You are the order desk of Asha Traders, a tea and crockery shop in Pune. Answer questions about orders, delivery and stock in one to three short sentences. Use the tools for facts; never guess an order status. Never make up phone numbers, emails, addresses or policies. Refunds, cancellations and complaints are decided by the shop owner: for those, always ask (the ask step) with the order number and what the customer wants.', task: '{{input.text}}', memory: memStore!.id, session: '{{trigger.sessionId}}', tools: 'chosen tools', toolNames: 'order_status, stock_check', canAsk: true, answerFormat: 'text', maxSteps: 6, maxTokens: 40000, maxSeconds: 300, saveSteps: true, effort: 'low' }),
      N('r', 'agentReply', 'Reply', 1280, 120, { answer: '{{input.answer}}', status: 'answer', sessionId: '{{trigger.sessionId}}' }),
      N('p', 'askPerson', 'Ask the shop owner', 1280, 280, { question: 'Order desk ({{trigger.sessionId}}): {{input.question}}', assignee: 'shop-owner' }),
      N('pa', 'agentReply', 'Reply with the answer', 1600, 300, { answer: '{{input.answer}}', status: 'answer', sessionId: '{{trigger.sessionId}}' }),
      N('pd', 'agentReply', 'Reply declined', 1600, 460, { answer: 'Sorry, we cannot do that. The shop owner will contact you.', status: 'needs a person', sessionId: '{{trigger.sessionId}}' }),
      N('l', 'agentReply', 'Reply limit', 1280, 600, { answer: 'This needs more work than I can do now. A person will follow up.', status: 'needs a person', sessionId: '{{trigger.sessionId}}' }),
      N('b', 'agentReply', 'Reply blocked', 640, 460, { answer: 'I can only help with orders, delivery and stock.', status: 'answer', sessionId: '{{trigger.sessionId}}' }),
    ],
    edges: [E('t', 'g'), E('g', 'i', 'pass'), E('i', 'q', 'true'), E('i', 'a', 'false'), E('q', 'pa', 'answered'), E('q', 'pd', 'declined'), E('g', 'b', 'blocked'), E('a', 'r', 'done'), E('a', 'p', 'needs a person'), E('p', 'pa', 'answered'), E('p', 'pd', 'declined'), E('a', 'l', 'limit reached')],
  });

  const ragWeb = ai && want('agentrag') && save({
    name: 'Sample: Knowledge feed from web pages',
    description: 'Reads each web page of the list (HTML or PDF), takes its text and adds it to the "Sample knowledge base"; adding a page again replaces it. Run it whenever the pages change, or put a Timer in front of it.',
    nodes: [
      N('s', 'start', 'Pages', 60, 220, { payload: JSON.stringify({ pages: ['https://en.wikipedia.org/wiki/Assam_tea', 'https://en.wikipedia.org/wiki/Darjeeling_tea'] }, null, 2) }),
      N('f', 'forEach', 'Each page', 360, 220, { list: '{{input.pages}}', max: 50 }),
      N('d', 'docText', 'Read the page', 660, 160, { from: 'web address', url: '{{input}}', type: 'auto', maxMb: 10 }),
      N('k', 'knowledgeAdd', 'Add to knowledge', 960, 160, { knowledge: kbConn!.id, source: '{{input.url}}', text: '{{input.text}}', meta: [{ k: 'kind', v: 'web' }, { k: 'title', v: '{{input.title}}' }] }),
      N('l', 'log', 'Log added', 1260, 160, { level: 'info', message: '{{input.source}}: {{input.chunks}} passages' }),
      N('x', 'log', 'Log page failed', 960, 340, { level: 'warn', message: 'Page not added: {{input.error.message}}' }),
    ],
    edges: [E('s', 'f'), E('f', 'd', 'item'), E('d', 'k'), E('k', 'l'), E('d', 'x', 'error')],
  });
  const ragSp = ragWeb && save({
    name: 'Sample: Knowledge feed from SharePoint',
    description: 'While deployed, watches a SharePoint document library (Policies site, folder Customer) and keeps the knowledge base in step: a new or changed file is read as text and added (replacing the old version), a removed file is removed. Set the Microsoft connection, the site address and the folder first; "Start with the files already there" fills the knowledge base on the first check.',
    nodes: [
      N('t', 'msFilesTrigger', 'Policy library', 60, 240, { connection: '', location: 'SharePoint site', site: 'https://contoso.sharepoint.com/sites/Policies', library: '', folder: 'Customer', pattern: '*.docx', recursive: true, pollSeconds: 300, existing: true }),
      N('r', 'msFiles', 'Read as text', 380, 160, { connection: '', location: 'SharePoint site', site: 'https://contoso.sharepoint.com/sites/Policies', library: '', op: 'read', path: '{{input.path}}', readAs: 'document text' }),
      N('k', 'knowledgeAdd', 'Add to knowledge', 700, 160, { knowledge: kbConn!.id, source: '{{trigger.path}}', text: '{{input.text}}', meta: [{ k: 'kind', v: 'policy' }, { k: 'url', v: '{{trigger.webUrl}}' }] }),
      N('x', 'knowledgeRemove', 'Remove from knowledge', 380, 360, { knowledge: kbConn!.id, action: 'remove a source', source: '{{input.path}}' }),
    ],
    edges: [E('t', 'r', 'added'), E('t', 'r', 'modified'), E('r', 'k'), E('t', 'x', 'removed')],
  });
  const ragAsk = ragWeb && save({
    name: 'Sample: Policy assistant',
    description: `Published as "policy-assistant" (chat at ${gw}/chat/policy-assistant): answers only from the knowledge base, with the sources it used, and says so when the answer is not there. Run a knowledge feed first.`,
    nodes: [
      N('t', 'agentChannel', 'Policy assistant', 60, 220, { agentName: 'policy-assistant', title: 'Policy assistant', description: 'Answers questions about our policies from the policy documents, with sources.', chat: true, openai: true, mcp: false, a2a: false, waitSeconds: 50, testMessage: JSON.stringify({ message: 'How many days do I have to return an item?', sessionId: 'test-1' }, null, 2) }),
      N('k', 'knowledgeAsk', 'Ask the policies', 380, 220, { provider: ai.id, knowledge: kbConn!.id, question: '{{input.message}}', top: 5, instructions: 'Answer briefly in the language of the question.', effort: 'low' }),
      N('r', 'agentReply', 'Reply', 700, 140, { answer: '{{input.answer}}', status: 'answer', sessionId: '{{trigger.sessionId}}' }),
      N('n', 'agentReply', 'Reply not found', 700, 300, { answer: 'I could not find that in our policies. Please ask the shop directly.', status: 'answer', sessionId: '{{trigger.sessionId}}' }),
    ],
    edges: [E('t', 'k'), E('k', 'r'), E('k', 'n', 'not found')],
  });

  const queueAgent = ai && want('agentqueue') && save({
    name: 'Sample: Agent fed by a queue',
    description: 'Message subscriber takes questions from the queue "agent.questions" ({"sessionId", "message", "replyTo"}); the agent answers each (one at a time per session, in arrival order); Publish message sends the answer to the queue named in replyTo; Confirm message acknowledges the question only after the answer is sent, so nothing is lost. Pick a RabbitMQ or ActiveMQ connection in both, then deploy.',
    nodes: [
      N('t', 'busSubscribe', 'Questions', 60, 220, { broker: 'amqp1', amqpConn: '', rabbitConn: '', kafkaConn: '', destinationType: 'queue', destination: 'agent.questions', messageType: 'JSON', ackMode: 'explicit', onFailure: 'requeue', maxRedeliveries: 5, concurrency: 4, declare: true, testMessage: JSON.stringify({ sessionId: 'cust-42', message: 'Is Assam tea in stock?', replyTo: 'agent.answers' }, null, 2) }),
      N('a', 'aiAgent', 'Agent', 380, 220, { provider: ai.id, instructions: 'You answer customer questions for Asha Traders in one or two sentences.', task: '{{input.body.message}}', memory: memStore!.id, session: '{{input.body.sessionId}}', tools: 'all AI tools of this project', canAsk: false, maxSteps: 6, effort: 'low' }),
      N('p', 'busPublish', 'Answer', 700, 220, { broker: 'amqp1', amqpConn: '', rabbitConn: '', kafkaConn: '', destinationType: 'queue', destination: "=coalesce({trigger.body.replyTo}, 'agent.answers')", messageType: 'JSON', body: '{"sessionId": "{{trigger.body.sessionId}}", "answer": {{input.answer | json}}}', deliveryMode: 'persistent', correlationId: '{{trigger.headers.messageId}}' }),
      N('c', 'busConfirm', 'Confirm', 1020, 220, { action: 'confirm' }),
    ],
    edges: [E('t', 'a'), E('a', 'p', 'done'), E('a', 'p', 'limit reached'), E('p', 'c')],
  });

  const team = ai && want('agentteam') && save({
    name: 'Sample: Supervisor agent',
    description: `Published as "help" (chat at ${gw}/chat/help): AI classify decides whether a question is about orders or policies, and Hand off to agent passes it, with the same session, to the order desk or the policy assistant; their answer is sent back. Add the order desk and knowledge base samples and deploy them first.`,
    nodes: [
      N('t', 'agentChannel', 'Help', 60, 240, { agentName: 'help', title: 'Help', description: 'One address for every customer question.', chat: true, openai: true, mcp: true, a2a: true, waitSeconds: 55, testMessage: JSON.stringify({ message: 'Where is order A-1002?', sessionId: 'test-1' }, null, 2) }),
      N('c', 'aiClassify', 'Orders or policies', 360, 240, { provider: ai.id, text: '{{input.message}}', labels: 'orders, policies', guidance: 'orders: order status, delivery, stock, prices. policies: returns, refunds rules, privacy, shipping rules.', effort: 'low' }),
      N('o', 'agentHandoff', 'To order desk', 680, 160, { process: desk ? desk.id : '', use: 'deployed (draft while testing)', message: '{{trigger.message}}', sessionId: '{{trigger.sessionId}}', note: '' }),
      N('p', 'agentHandoff', 'To policy assistant', 680, 320, { process: ragAsk ? ragAsk.id : '', use: 'deployed (draft while testing)', message: '{{trigger.message}}', sessionId: '{{trigger.sessionId}}', note: '' }),
      N('r', 'agentReply', 'Reply', 1000, 240, { answer: '{{input.answer}}', status: 'answer', sessionId: '{{trigger.sessionId}}' }),
    ],
    edges: [E('t', 'c'), E('c', 'o', 'orders'), E('c', 'p', 'policies'), E('c', 'o', 'other'), E('o', 'r'), E('p', 'r')],
  });

  const fsConn = ai && want('agentmcp') && conn('mcpClient', 'Sample MCP file system', { transport: 'command', command: `npx -y @modelcontextprotocol/server-filesystem ${folder}`, timeoutSec: 120, allowTools: 'list_directory, read_text_file, search_files, get_file_info' });
  const mcpAgent = fsConn && save({
    name: 'Sample: Agent with outside MCP tools',
    description: `Starts the MCP file system server (npx) on ${folder}, lists its tools with Call MCP tool, then lets an agent use the read-only ones (the connection allows only list, read, search and info) to answer a question about the files. Run "Sample: CSV import and totals" first so there is a file to find.`,
    nodes: [
      N('s', 'start', 'Question', 60, 220, { payload: JSON.stringify({ message: 'Which CSV files are in the samples folder, and what columns does sales.csv have?' }, null, 2) }),
      N('l', 'mcpCall', 'List the tools', 360, 220, { mcp: fsConn.id, action: 'list tools' }),
      N('a', 'aiAgent', 'File agent', 660, 220, { provider: ai.id, instructions: `You answer questions about the files in ${folder}. Use the tools; give paths in full.`, task: '{{trigger.message}}', memory: '', tools: 'none', mcp: fsConn.id, canAsk: false, maxSteps: 6, effort: 'low' }),
      N('g', 'log', 'Log answer', 960, 220, { level: 'info', message: '{{input.answer}} ({{input.toolCalls}} tool calls)' }),
    ],
    edges: [E('s', 'l'), E('l', 'a'), E('a', 'g', 'done')],
  });


  // ---------- AI document assistant: RAG over a local folder, as an API, an MCP tool and a chat agent ----------
  const docsWanted = want('agentdocs');
  const aiDocs = docsWanted ? (ai || conn('aiProvider', 'Local Ollama', { engine: 'Ollama', model: '', baseUrl: '', maxTokens: 800, ollamaApi: 'chat' })) : null;
  const kbDocs = aiDocs && conn('aiKnowledge', 'Sample document knowledge base', { store: 'built-in', embedWith: 'built-in', chunkTokens: 200, overlapTokens: 40 });
  if (aiDocs) {
    // The documents (PDF, Word, PowerPoint, Markdown) go in the project's files folder, ${files}/documents,
    // named by the project variable DOCS_FOLDER: the same on every server, and carried by release zips.
    const p = getProject(projectId);
    if (p) {
      writeSampleDocuments(path.join(projectFilesDir(p.name), 'documents'));
      if (!(p.config.variables || []).some((v: any) => v.name === 'DOCS_FOLDER')) {
        saveProject({ id: p.id, name: p.name, description: p.description, config: { ...p.config, variables: [...(p.config.variables || []), { name: 'DOCS_FOLDER', type: 'string', value: '${files}/documents', description: 'Folder of documents the knowledge base is fed from (PDF, Word, PowerPoint, Excel, OpenDocument, HTML, text, Markdown). ${files} is the project files folder; use any folder of this server instead.' }] } });
      }
    }
  }
  const D = (n: FlowNode, description: string): FlowNode => ({ ...n, description });
  const docOne = aiDocs && save({
    name: 'Sample: Add one document to knowledge',
    description: 'Called once per file by "Sample: Document feed from a folder": reads the file, takes its text and adds it to the knowledge base under its path in the folder. A file whose text has not changed since the last feed is skipped, so no vectors are made again. Files of other types are left alone; a file that cannot be read is logged and the feed goes on.',
    nodes: [
      D(N('s', 'start', 'File', 60, 240, { payload: JSON.stringify({ name: 'returns-policy.pdf', relativePath: 'returns-policy.pdf', extension: 'pdf', size: 3201, modifiedAt: '2026-10-19T09:00:00.000Z' }, null, 2) }), 'One file from the folder listing: name, path in the folder, extension, size and time changed. The test data is the sample returns policy.'),
      D(N('i', 'if', 'Document type', 340, 240, { left: '=lower-case({trigger.extension})', op: 'matches regex', right: '^(pdf|docx|pptx|xlsx|odt|odp|ods|html|htm|txt|md|csv)$' }), 'Only file types Read document text understands go on; anything else (pictures, zips) is skipped.'),
      D(N('r', 'fileRead', 'Read the file', 640, 160, { folder: '{{gv.DOCS_FOLDER}}', path: '{{trigger.relativePath}}', format: 'base64 (binary)', maxMb: 25 }), 'Reads the file from the documents folder (project variable DOCS_FOLDER) as base64, because documents are binary.'),
      D(N('d', 'docText', 'Take the text', 940, 160, { from: 'earlier step', content: '{{input.content}}', encoding: 'base64', name: '{{trigger.name}}', type: 'auto', maxMb: 25 }), 'Takes the text out of the document: PDF pages, Word paragraphs, PowerPoint slides, Excel sheets, HTML or plain text. The extension tells the type.'),
      D(N('k', 'knowledgeAdd', 'Add to knowledge', 1240, 160, { knowledge: kbDocs!.id, source: '{{trigger.relativePath}}', text: '{{input.text}}', meta: [{ k: 'type', v: '{{trigger.extension}}' }, { k: 'title', v: '{{input.title}}' }], unchanged: 'skip' }), 'Splits the text into passages, makes their vectors and stores them under the file\'s path, with its type and title as details. Same text as before: skipped.'),
      D(N('ok', 'return', 'Return added', 1540, 160, { source: 'value', value: '{{input}}' }), 'Gives the feed what was done: source, passages, and whether it was skipped as unchanged.'),
      D(N('o', 'log', 'Log other file', 640, 360, { level: 'info', message: 'Not a document type, left out: {{trigger.relativePath}}' }), 'Notes files that are not documents, for the run history.'),
      D(N('x', 'log', 'Log not added', 1240, 360, { level: 'warn', message: 'Not added: {{trigger.relativePath}}: {{input.error.message}}' }), 'A damaged, empty or protected file is logged as a warning; the feed carries on with the next file.'),
      D(N('no', 'return', 'Return left out', 1540, 360, { source: 'value', value: '{{trigger}}' }), 'Returns the file as it came, so the feed counts it as left out.'),
    ],
    edges: [E('s', 'i'), E('i', 'r', 'true'), E('i', 'o', 'false'), E('r', 'd'), E('d', 'k'), E('k', 'ok'), E('r', 'x', 'error'), E('d', 'x', 'error'), E('k', 'x', 'error'), E('o', 'no'), E('x', 'no')],
  });
  const docFeed = docOne && save({
    name: 'Sample: Document feed from a folder',
    description: 'Every 15 minutes, lists the documents folder (project variable DOCS_FOLDER, with sub-folders) and calls "Sample: Add one document to knowledge" for each file, so new and changed files reach the knowledge base; then removes from it the files that were deleted from the folder. Test it once to fill the knowledge base; deploy it (and the called Sutra) to keep it up to date.',
    nodes: [
      D(N('t', 'timer', 'Every 15 minutes', 60, 240, { mode: 'cron', cron: '0 */15 * * * *', every: 900, timezone: 'Asia/Kolkata', payload: '{}' }), 'Starts the feed every 15 minutes while deployed. Choose a longer time for large folders; Test runs it at once.'),
      D(N('l', 'fileList', 'List documents', 340, 240, { location: '{{gv.DOCS_FOLDER}}', pattern: '*', recursive: true, sort: 'name', max: 2000, format: 'do not read' }), 'Lists every file in the documents folder and its sub-folders, without reading them: name, path in the folder, extension, size, time changed.'),
      D(N('f', 'forEach', 'Each file', 640, 240, { list: '{{input.files}}', max: 2000 }), 'Sends every file of the listing down the item branch, then the whole list down the done branch.'),
      D(N('c', 'callProcess', 'Add the document', 940, 140, { process: docOne.id, use: 'deployed (draft while testing)', wait: true, source: 'value', input: '{{input}}', resultSchema: '' }), 'Calls "Add one document to knowledge" with the file, and waits for it. Keeping the work for one file in its own Sutra lets every step there refer to the file as {trigger}.'),
      D(N('k', 'knowledgeRemove', 'Remove deleted files', 940, 340, { knowledge: kbDocs!.id, action: 'keep only these sources', keep: '{{input.items}}', under: '' }), 'Keeps only the sources that are still files in the folder: documents deleted from the folder leave the knowledge base too.'),
      D(N('g', 'log', 'Log the feed', 1240, 340, { level: 'info', message: "=concat(count({nodes.List documents.files}), ' files checked; ', {input.removed}, ' deleted files removed from the knowledge base')" }), 'Writes a summary line to the run history and the project log.'),
      D(N('e', 'log', 'Folder is empty', 640, 440, { level: 'warn', message: 'No files in {{gv.DOCS_FOLDER}}' }), 'Warns when the folder is empty or missing, for example when DOCS_FOLDER points to the wrong place on this server.'),
    ],
    edges: [E('t', 'l'), E('l', 'f'), E('f', 'c', 'item'), E('f', 'k', 'done'), E('k', 'g'), E('l', 'e', 'empty')],
  });
  const docApi = docOne && save({
    name: 'Sample: Document questions API',
    description: `A REST API over the documents: POST ${gw}/samples/docs/ask with {"question": "..."} answers from the knowledge base with the documents it used, or 404 when the documents do not say. Run the document feed first.`,
    nodes: [
      D(N('t', 'restService', 'Ask API', 60, 240, { method: 'POST', path: '/samples/docs/ask', policy: '', maxBodyKb: 16, bodySchema: '', testRequest: JSON.stringify({ method: 'POST', params: {}, query: {}, headers: {}, body: { question: 'How many days do I have to return an item?' } }, null, 2) }), 'Receives the question as JSON. Give it an API security policy before exposing it outside your network.'),
      D(N('a', 'knowledgeAsk', 'Answer from documents', 360, 240, { provider: aiDocs!.id, knowledge: kbDocs!.id, question: '{{input.body.question}}', top: 4, instructions: 'Answer in two or three sentences, only from the passages, in the language of the question. Name the document you used.', effort: 'low' }), 'Searches the knowledge base for the four closest passages and lets the AI answer only from them, with their sources. Goes to "not found" when nothing matches.'),
      D(N('ok', 'httpResponse', 'Reply 200', 680, 160, { status: '200', contentType: 'application/json', bodySource: 'template', body: '{"answer": {{input.answer | json}}, "sources": {{input.sources | json}}}', headers: [] }), 'Sends the answer and the documents it came from.'),
      D(N('nf', 'httpResponse', 'Reply 404', 680, 320, { status: '404', contentType: 'application/json', bodySource: 'template', body: '{"answer": "The documents do not say.", "sources": []}', headers: [] }), 'The documents hold nothing about the question: says so instead of guessing.'),
      D(N('er', 'httpResponse', 'Reply 502', 680, 460, { status: '502', contentType: 'application/json', bodySource: 'template', body: '{"error": {{input.error.message | json}}}', headers: [] }), 'The AI model could not be reached (is Ollama running, with a model chosen in the Local Ollama connection?).'),
    ],
    edges: [E('t', 'a'), E('a', 'ok'), E('a', 'nf', 'not found'), E('a', 'er', 'error')],
  });
  const docTool = docOne && save({
    name: 'Sample: AI tool search documents',
    description: `An AI tool: while deployed, AI assistants such as Claude Desktop call search_documents over MCP at ${gw}/mcp and get the passages of the documents closest to their question, with sources; agents of this project can use it too. No AI model is needed on this server: the assistant writes the answer.`,
    nodes: [
      D(N('t', 'mcpTool', 'search_documents', 60, 240, { toolName: 'search_documents', title: 'Search documents', description: 'Searches the Asha Traders policy and product documents (returns, shipping, catalogue, FAQ) and returns the passages closest to the question, with the document each comes from.', inputs: [{ k: 'question', v: 'What to look for, in plain words' }], forAgents: true, changesData: false, testArguments: JSON.stringify({ question: 'Which tea is best for milk tea?' }, null, 2) }), 'Makes this Sutra the MCP tool search_documents with one input, question.'),
      D(N('k', 'knowledgeSearch', 'Search documents', 360, 240, { knowledge: kbDocs!.id, question: '{{input.arguments.question}}', top: 5 }), 'Finds the five passages closest to the question by meaning and shared words.'),
      D(N('r', 'mcpReply', 'Reply with passages', 680, 160, { source: 'value', result: '{{input.hits}}', isError: false }), 'Returns the passages with their sources and scores to the AI assistant.'),
      D(N('n', 'mcpReply', 'Reply nothing found', 680, 320, { source: 'value', result: 'Nothing in the documents matches that question.', isError: false }), 'Tells the assistant plainly that the documents hold nothing about it.'),
    ],
    edges: [E('t', 'k'), E('k', 'r'), E('k', 'n', 'empty')],
  });
  const docAgent = docOne && save({
    name: 'Sample: Document assistant',
    description: `Published as the agent "docs-assistant": chat at ${gw}/chat/docs-assistant, OpenAI-compatible model docs-assistant at ${gw}/v1/chat/completions, and the MCP tool ask_docs_assistant at ${gw}/mcp. The agent searches the documents itself (search_knowledge), remembers each conversation, and answers with the document names.`,
    nodes: [
      D(N('t', 'agentChannel', 'Document assistant', 60, 240, { agentName: 'docs-assistant', title: 'Document assistant', description: 'Answers questions about Asha Traders returns, shipping, products and payments from the shop documents, with sources.', chat: true, openai: true, mcp: true, mcpServer: '', a2a: false, waitSeconds: 50, testMessage: JSON.stringify({ message: 'How long does delivery to Mumbai take, and is shipping free?', sessionId: 'test-1' }, null, 2) }), 'Publishes the agent as a chat page, an OpenAI-compatible model and an MCP tool, all at the gateway.'),
      D(N('a', 'aiAgent', 'Document agent', 380, 240, { provider: aiDocs!.id, instructions: 'You answer questions about Asha Traders (a tea and crockery shop in Pune) from its documents. Always search the knowledge base first; answer in two to four sentences from what you find, and name the documents you used. If the documents do not say, say so; never guess prices, times or rules.', task: '{{input.message}}', memory: memStore ? memStore.id : '', session: '{{trigger.sessionId}}', tools: 'none', knowledge: kbDocs!.id, autoKnowledge: 3, canAsk: false, answerFormat: 'text', maxSteps: 5, maxTokens: 30000, maxSeconds: 300, saveSteps: true, effort: 'low' }), 'The agent: gets the three closest passages before it starts, may search again with search_knowledge, and remembers the conversation by session.'),
      D(N('r', 'agentReply', 'Reply', 700, 160, { answer: '{{input.answer}}', status: 'answer', sessionId: '{{trigger.sessionId}}' }), 'Sends the answer back on the channel the question came from.'),
      D(N('l', 'agentReply', 'Reply limit', 700, 340, { answer: 'I could not finish that. Please ask the order desk.', status: 'needs a person', sessionId: '{{trigger.sessionId}}' }), 'The agent used up its steps or time: a polite answer instead of silence.'),
    ],
    edges: [E('t', 'a'), E('a', 'r', 'done'), E('a', 'l', 'limit reached'), E('a', 'l', 'needs a person')],
  });


  // ---------- data platforms, Python and social media ----------
  /** Adds a project variable once (kept when the project has it already). */
  const ensureVar = (name: string, value: string, description: string) => {
    const p = getProject(projectId);
    if (p && !(p.config.variables || []).some((v: any) => v.name === name)) saveProject({ id: p.id, name: p.name, description: p.description, config: { ...p.config, variables: [...(p.config.variables || []), { name, type: 'string', value, description }] } });
  };
  const adfC = want('adf') ? conn('azureDataFactory', 'Sample Azure Data Factory', { auth: 'service principal (client secret)', tenantId: '', clientId: '', clientSecretSecret: 'ADF_CLIENT_SECRET', subscriptionId: '', resourceGroup: '', factoryName: '', pollSeconds: 15, cloud: 'Azure (global)' }) : null;
  const adfRunS = adfC && save({
    name: 'Sample: ADF run pipeline and wait',
    description: 'Runs the Data Factory pipeline CopySalesToLake for a date and waits for it. When it fails, it logs the failing activity and reruns the pipeline once from the failed activity (the steps that succeeded are not repeated). Fill in the Sample Azure Data Factory connection (tenant, app, secret ADF_CLIENT_SECRET, subscription, resource group, factory) and use your pipeline name.',
    nodes: [
      D(N('s', 'start', 'Run date', 60, 240, { payload: JSON.stringify({ runDate: '2026-10-18' }, null, 2) }), 'The date to load; a timer or another Sutra can start this one with its own date.'),
      D(N('r', 'adfRun', 'Copy sales to the lake', 360, 240, { connection: adfC.id, pipeline: 'CopySalesToLake', parameters: [{ k: 'runDate', v: '{{input.runDate}}' }], parametersJson: '', mode: 'new run', wait: true, waitMinutes: 120, cancelOnLimit: true, withActivities: true }), 'Starts the pipeline with the date as its runDate parameter and waits up to two hours; a run still going then is cancelled.'),
      D(N('ok', 'log', 'Log success', 700, 140, { level: 'info', message: "=concat('Pipeline ', {input.pipeline}, ' succeeded in ', round({input.durationMs} div 1000), ' s: ', {input.monitorUrl})" }), 'Records the run and its duration, with the link to the run in Data Factory Studio.'),
      D(N('f', 'log', 'Log the failure', 700, 340, { level: 'error', message: "=concat('Pipeline ', {input.pipeline}, ' ', {input.status}, ': ', {input.message})" }), 'Records why it failed; an alert rule on error logs or failed runs can notify the data team.'),
      D(N('rr', 'adfRun', 'Rerun from the failure', 1000, 340, { connection: adfC.id, pipeline: '{{input.pipeline}}', mode: 'rerun from the failed activity', referenceRunId: "{{nodes.Copy sales to the lake.runId}}", wait: true, waitMinutes: 120, cancelOnLimit: true, withActivities: true }), 'Tries once more from the activity that failed (for example after a locked table or a short outage), reusing what already succeeded.'),
      D(N('g', 'log', 'Log the rerun', 1300, 340, { level: 'warn', message: "=concat('Rerun of ', {input.pipeline}, ': ', {input.status})" }), 'Records how the rerun ended.'),
    ],
    edges: [E('s', 'r'), E('r', 'ok'), E('r', 'f', 'failed'), E('f', 'rr'), E('rr', 'g'), E('rr', 'g', 'failed')],
  });
  const adfAlert = adfC && save({
    name: 'Sample: ADF alert on failed runs',
    description: 'While deployed, watches the data factory for pipeline runs that end, whoever started them (schedules included). A failed run is logged and put to a person (Runs > Approvals) with its error; on Rerun it is run again from the failed activity.',
    nodes: [
      D(N('t', 'adfRunTrigger', 'Pipeline run ended', 60, 240, { connection: adfC.id, pipelines: '', pollSeconds: 60 }), 'Checks the factory every minute for runs that ended: succeeded, failed or cancelled. Empty pipeline list = all pipelines.'),
      D(N('f', 'adfMonitor', 'What failed', 360, 300, { connection: adfC.id, op: 'activity runs', runId: '{{trigger.runId}}' }), 'Reads the activity runs of the failed run, to tell which activity failed and why.'),
      D(N('a', 'askPerson', 'Rerun it?', 660, 300, { question: "=concat('Pipeline ', {trigger.pipeline}, ' failed: ', {trigger.message}, '. Rerun from the failed activity?')", assignee: 'data-team' }), 'Asks the data team in Approvals; nothing is rerun without a person.'),
      D(N('r', 'adfRun', 'Rerun from the failure', 960, 240, { connection: adfC.id, pipeline: '{{trigger.pipeline}}', mode: 'rerun from the failed activity', referenceRunId: '{{trigger.runId}}', wait: false }), 'Starts the rerun and goes on; this trigger reports how it ends.'),
      D(N('l', 'log', 'Log declined', 960, 400, { level: 'warn', message: 'Not rerun: {{trigger.pipeline}} {{trigger.runId}}' }), 'Records that the team chose not to rerun.'),
      D(N('ok', 'log', 'Log success', 360, 140, { level: 'info', message: '{{trigger.pipeline}} succeeded ({{trigger.durationMs}} ms)' }), 'A record of every successful run, for the project log.'),
    ],
    edges: [E('t', 'ok', 'succeeded'), E('t', 'f', 'failed'), E('t', 'f', 'cancelled'), E('f', 'a'), E('a', 'r', 'answered'), E('a', 'l', 'declined')],
  });
  const dbxC = want('databricks') ? conn('databricks', 'Sample Databricks', { host: 'https://adb-1234567890123456.7.azuredatabricks.net', auth: 'personal access token', tokenSecret: 'DATABRICKS_TOKEN', clusterId: '', warehouseId: '', pollSeconds: 10 }) : null;
  const dbxNb = dbxC && save({
    name: 'Sample: Databricks notebook with parameters',
    description: 'Runs a notebook with a date parameter on the default cluster, waits for it, and logs the value the notebook returns with dbutils.notebook.exit(json.dumps({...})). In the notebook: run_date = dbutils.widgets.get("run_date"). Fill in the Sample Databricks connection (address, token secret DATABRICKS_TOKEN, cluster id).',
    nodes: [
      D(N('s', 'start', 'Run date', 60, 240, { payload: JSON.stringify({ date: '2026-10-18' }, null, 2) }), 'The date to process.'),
      D(N('r', 'databricksRun', 'Daily totals notebook', 360, 240, { connection: dbxC.id, what: 'notebook', notebookPath: '/Workspace/Shared/sales/daily_totals', notebookParams: [{ k: 'run_date', v: '{{input.date}}' }], compute: 'existing cluster', clusterId: '', wait: true, waitMinutes: 60, cancelOnLimit: true }), 'Runs the notebook as a one-time run with run_date, and waits up to an hour.'),
      D(N('ok', 'log', 'Log the result', 680, 160, { level: 'info', message: "=concat('Notebook finished: ', string({input.result}), ' ', {input.runPageUrl})" }), 'The notebook\'s exit value (JSON becomes fields) and the link to the run.'),
      D(N('f', 'log', 'Log the error', 680, 340, { level: 'error', message: '{{input.error}} {{input.runPageUrl}}' }), 'The error of the failing cell and the link to the run, for whoever looks next.'),
    ],
    edges: [E('s', 'r'), E('r', 'ok'), E('r', 'f', 'failed')],
  });
  const dbxSql = dbxC && save({
    name: 'Sample: Databricks SQL and code block',
    description: 'Queries the samples.nyctaxi.trips table on a SQL warehouse with a named parameter, then runs a Python block on the cluster with the count as a parameter. Set the default warehouse and cluster on the Sample Databricks connection.',
    nodes: [
      D(N('s', 'start', 'Zip code', 60, 240, { payload: JSON.stringify({ zip: '10001' }, null, 2) }), 'The pickup zip code to look at.'),
      D(N('q', 'databricksSql', 'Trips for the zip', 360, 240, { connection: dbxC.id, warehouseId: '', statement: 'SELECT pickup_zip, count(*) AS trips, round(avg(fare_amount), 2) AS avg_fare\nFROM samples.nyctaxi.trips\nWHERE pickup_zip = :zip\nGROUP BY pickup_zip', params: [{ k: 'zip', v: '{{input.zip}}' }], catalog: '', schema: '', maxRows: 1000, waitMinutes: 10 }), 'Counts trips with SQL on the warehouse; the zip code is a parameter, never pasted into the SQL.'),
      D(N('c', 'databricksCommand', 'Classify in Python', 680, 240, { connection: dbxC.id, clusterId: '', language: 'python', code: 'trips = int(sutra_params["trips"])\nprint("busy" if trips > 1000 else "quiet")', params: [{ k: 'trips', v: '{{input.rows[0].trips}}' }], startCluster: true, waitMinutes: 20 }), 'Runs a Python cell on the cluster (starting it when stopped), with the count as sutra_params["trips"].'),
      D(N('l', 'log', 'Log it', 980, 240, { level: 'info', message: "=concat('Zip ', {trigger.zip}, ' is ', {input.text})" }), 'Records the outcome.'),
      D(N('e', 'log', 'No trips', 680, 400, { level: 'warn', message: 'No trips for {{trigger.zip}}' }), 'The query returned no rows.'),
    ],
    edges: [E('s', 'q'), E('q', 'c'), E('q', 'e', 'empty'), E('c', 'l')],
  });
  if (want('python')) {
    const p = getProject(projectId);
    if (p) {
      const dir = path.join(projectFilesDir(p.name), 'scripts');
      fs.mkdirSync(dir, { recursive: true });
      const f = path.join(dir, 'sales_report.py');
      if (!fs.existsSync(f)) fs.writeFileSync(f, '"""Sales report: reads the amounts given as parameters and prints a summary as JSON."""\nimport json\nimport os\nimport statistics\nimport sys\n\nparams = json.load(open(os.environ["SUTRA_PARAMS_FILE"]))\namounts = [float(a) for a in params.get("amounts", [])]\nif not amounts:\n    print("No amounts given", file=sys.stderr)\n    sys.exit(2)\nprint(json.dumps({\n    "region": params.get("region", ""),\n    "count": len(amounts),\n    "total": round(sum(amounts), 2),\n    "average": round(statistics.mean(amounts), 2),\n    "median": round(statistics.median(amounts), 2),\n    "mode": sys.argv[1] if len(sys.argv) > 1 else "full",\n}))\n', 'utf8');
    }
    ensureVar('SCRIPTS_FOLDER', '${files}/scripts', 'Folder of the Python scripts the Sutras run. ${files} is the project files folder.');
  }
  const pyInline = want('python') && save({
    name: 'Sample: Python script with parameters',
    description: 'Runs Python written in the step: reads its parameters (SUTRA_PARAMS_FILE) and the previous step\'s output (SUTRA_INPUT_FILE), and prints JSON that the next step maps as result. Needs Python 3 on the server and scripts allowed in Admin Console > Server > Runtime; the designer warns when either is missing.',
    nodes: [
      D(N('s', 'start', 'Order', 60, 240, { payload: JSON.stringify({ orderId: 'A-1001', lines: [{ sku: 'TEA-01', amount: 240 }, { sku: 'CUP-02', amount: 450 }] }, null, 2) }), 'An order with its lines, as a REST call or a file would bring it.'),
      D(N('p', 'python', 'Total with tax', 360, 240, { source: 'code', code: 'import json, os\n\nparams = json.load(open(os.environ["SUTRA_PARAMS_FILE"]))\norder = json.load(open(os.environ["SUTRA_INPUT_FILE"]))\n\nnet = sum(float(l["amount"]) for l in order["lines"])\ntax = round(net * float(params["taxRate"]), 2)\nprint(json.dumps({"orderId": params["orderId"], "net": net, "tax": tax, "total": round(net + tax, 2)}))', args: [], params: [{ k: 'orderId', v: '{{input.orderId}}' }, { k: 'taxRate', v: '0.18' }], python: 'detected', pythonPath: '', venv: '', packages: '', workDir: '', timeoutMs: 60000, failOnExit: true }), 'Adds up the lines and the tax in Python; the order id and tax rate are parameters, the order comes as the input file.'),
      D(N('l', 'log', 'Log the total', 660, 160, { level: 'info', message: "=concat('Order ', {input.result.orderId}, ': total ', {input.result.total})" }), 'Uses the printed JSON (result) like any other step\'s output.'),
      D(N('x', 'log', 'Log the error', 660, 340, { level: 'error', message: '{{input.error.message}}' }), 'A Python error (with the last lines of the traceback) or a missing Python ends up here.'),
    ],
    edges: [E('s', 'p'), E('p', 'l'), E('p', 'x', 'error')],
  });
  const pyFile = want('python') && save({
    name: 'Sample: Python script file',
    description: 'Runs the script sales_report.py from the project\'s scripts folder (project variable SCRIPTS_FOLDER) with an argument and parameters, the way a data team keeps scripts in files under version control. The script comes with the sample.',
    nodes: [
      D(N('s', 'start', 'Sales', 60, 240, { payload: JSON.stringify({ region: 'West', amounts: [1200, 980, 2200, 450] }, null, 2) }), 'The amounts to summarise.'),
      D(N('p', 'python', 'Sales report', 360, 240, { source: 'file', file: '{{gv.SCRIPTS_FOLDER}}/sales_report.py', args: ['quick'], params: [{ k: 'region', v: '{{input.region}}' }, { k: 'amounts', v: '{{input.amounts}}' }], python: 'detected', pythonPath: '', venv: '', packages: 'statistics', workDir: '', timeoutMs: 60000, failOnExit: true }), 'Runs the script with the argument quick (sys.argv[1]); lists and objects arrive as JSON in the parameters file.'),
      D(N('l', 'log', 'Log the report', 660, 240, { level: 'info', message: "=concat({input.result.region}, ': ', {input.result.count}, ' sales, total ', {input.result.total}, ', median ', {input.result.median})" }), 'Records the summary.'),
    ],
    edges: [E('s', 'p'), E('p', 'l')],
  });
  const ytC = want('youtube') ? conn('oauthApp', 'Sample Google (Drive and YouTube)', { provider: 'google', clientId: '', clientSecretSecret: '', scopes: 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly https://www.googleapis.com/auth/spreadsheets', refreshTokenSecret: '' }) : null;
  if (ytC) ensureVar('DOWNLOADS', '${files}/downloads', 'Folder where files from Google Drive are saved before upload. ${files} is the project files folder.');
  const ytPublish = ytC && save({
    name: 'Sample: Publish Drive videos to YouTube',
    description: 'While deployed, watches the Google Drive folder "Videos to publish": each new video is saved to a server file (streamed, so large videos are fine), uploaded to YouTube as private with its file name as the title, and the server copy is removed. Set the folder id, connect the Sample Google connection with the Drive and YouTube scopes, and choose the privacy you want.',
    nodes: [
      D(N('t', 'googleDriveTrigger', 'New video in Drive', 60, 240, { connection: ytC.id, folderId: '', mimeType: 'any', pollSeconds: 120, testEvent: JSON.stringify({ event: 'added', id: '1AbCvideo', name: 'Tea tasting - Assam vs Darjeeling.mp4', mimeType: 'video/mp4', modifiedTime: '2026-10-19T09:00:00Z' }, null, 2) }), 'Checks the Drive folder every two minutes; a file added there starts the Sutra.'),
      D(N('d', 'googleDrive', 'Save to a server file', 360, 240, { connection: ytC.id, op: 'download', fileId: '{{trigger.id}}', saveTo: 'server file', savePath: "=concat({gv.DOWNLOADS}, '/', {trigger.id}, '-', {trigger.name})" }), 'Google Drive first: streams the video to the downloads folder (project variable DOWNLOADS) instead of holding it in memory.'),
      D(N('y', 'youtube', 'Upload to YouTube', 660, 240, { connection: ytC.id, op: 'upload video', from: 'server file', filePath: '{{input.path}}', title: '{{trigger.name}}', description: 'Uploaded by SutraFlow from Google Drive.', tags: 'tea, Asha Traders', categoryId: '26', privacy: 'private', publishAt: '', madeForKids: false, addToPlaylist: '', notify: false }), 'Then YouTube: uploads the saved file with a resumable upload, as private, so someone can check it before publishing.'),
      D(N('m', 'fileMove', 'Remove the server copy', 960, 240, { folder: '{{gv.DOWNLOADS}}', action: 'delete', from: "=concat({trigger.id}, '-', {trigger.name})" }), 'Deletes the downloaded copy; the video stays in Drive and on YouTube.'),
      D(N('l', 'log', 'Log the video', 1260, 240, { level: 'info', message: "=concat('Uploaded ', {trigger.name}, ': ', {nodes.Upload to YouTube.url})" }), 'Records the YouTube address of the new video.'),
      D(N('x', 'log', 'Log the failure', 960, 420, { level: 'error', message: 'Not published: {{trigger.name}}: {{input.error.message}}' }), 'A download or upload that failed, with the reason (for example a missing scope or the daily upload quota).'),
    ],
    edges: [E('t', 'd', 'added'), E('d', 'y'), E('y', 'm'), E('m', 'l'), E('d', 'x', 'error'), E('y', 'x', 'error')],
  });
  const ytReport = ytC && save({
    name: 'Sample: YouTube weekly analytics to Google Sheets',
    description: 'Every Monday at 08:00, reads the channel\'s views, watch time, likes and new subscribers for each day of the last week from YouTube Analytics and appends them to a Google Sheet. Set the spreadsheet id.',
    nodes: [
      D(N('t', 'timer', 'Every Monday 08:00', 60, 240, { mode: 'cron', cron: '0 0 8 * * MON', every: 300, timezone: 'Asia/Kolkata', payload: '{}' }), 'Starts the report once a week.'),
      D(N('a', 'youtube', 'Last week by day', 360, 240, { connection: ytC.id, op: 'analytics report', startDate: "=format-date('YYYY-MM-DD', add-to-date(current-date(), 0, 0, -7))", endDate: "=format-date('YYYY-MM-DD', add-to-date(current-date(), 0, 0, -1))", metrics: 'views,estimatedMinutesWatched,likes,subscribersGained', dimensions: 'day', filters: '' }), 'One row per day with the four metrics, from YouTube Analytics.'),
      D(N('g', 'googleSheets', 'Append to the sheet', 660, 240, { connection: ytC.id, op: 'append', spreadsheetId: '', range: 'Weekly!A1:E', header: true, rows: '{{input.rows}}', valueInput: 'USER_ENTERED' }), 'Adds the rows under the header day, views, estimatedMinutesWatched, likes, subscribersGained.'),
    ],
    edges: [E('t', 'a'), E('a', 'g')],
  });
  const twC = want('twitch') ? conn('oauthApp', 'Sample Twitch', { provider: 'twitch', clientId: '', clientSecretSecret: 'TWITCH_CLIENT_SECRET', scopes: 'user:read:email user:write:chat moderator:read:followers', refreshTokenSecret: '' }) : null;
  const twLive = twC && save({
    name: 'Sample: Twitch going live announcement',
    description: 'While deployed, notices when the channel goes live: welcomes viewers in the chat and logs the stream; when the stream ends, logs the latest broadcast and the follower count. Connect the Sample Twitch connection (an application at dev.twitch.tv with the redirect address shown on the connection).',
    nodes: [
      D(N('t', 'twitchLiveTrigger', 'Channel goes live', 60, 240, { connection: twC.id, logins: '', pollSeconds: 60 }), 'Checks the connected channel every minute; going live and going offline are separate outputs.'),
      D(N('c', 'twitch', 'Welcome in chat', 360, 140, { connection: twC.id, op: 'chat message', logins: '', message: "=concat('We are live: ', {trigger.title}, '! Ask your tea questions in the chat.')" }), 'Posts a welcome message in the channel\'s chat as the connected account.'),
      D(N('l', 'log', 'Log the stream', 660, 140, { level: 'info', message: "=concat('Live: ', {trigger.title}, ' (', {trigger.game}, ')')" }), 'Records the stream title and category.'),
      D(N('f', 'twitch', 'Followers', 360, 340, { connection: twC.id, op: 'followers', logins: '', max: 1 }), 'After the stream: how many followers the channel has now.'),
      D(N('g', 'log', 'Log after the stream', 660, 340, { level: 'info', message: "=concat('Stream ended; followers: ', {input.total})" }), 'Records the follower count after each stream, for a simple growth record.'),
    ],
    edges: [E('t', 'c', 'live'), E('c', 'l'), E('t', 'f', 'offline'), E('f', 'g')],
  });


  const dcC = want('discord') ? conn('discord', 'Sample Discord', { mode: 'bot', webhookSecret: '', botTokenSecret: 'DISCORD_BOT_TOKEN', channelId: '', apiBase: 'https://discord.com/api/v10' }) : null;
  const dcBot = dcC && save({
    name: 'Sample: Discord order status bot',
    description: 'While deployed, answers !status <order number> in a Discord channel with the order\'s status, and posts a notice with an embed. Make a bot at discord.com/developers, keep its token as the secret DISCORD_BOT_TOKEN, invite it to your server, turn on Message Content Intent, and set the channel id on the Sample Discord connection.',
    nodes: [
      D(N('t', 'discordTrigger', 'Message in the channel', 60, 240, { connection: dcC.id, channelId: '', prefix: '!', pollSeconds: 10 }), 'Checks the channel every 10 seconds; messages starting with ! are commands, such as !status A-1001.'),
      D(N('i', 'if', 'Is it status', 360, 160, { left: '{{input.command}}', op: 'equals', right: 'status' }), 'Only the status command is answered here; add a Switch for more commands.'),
      D(N('j', 'jsonata', 'Look up the order', 660, 100, { source: '{{input}}', expression: '(\n  $orders := { "A-1001": "shipped with Blue Dart", "A-1002": "being packed", "A-1003": "delivered" };\n  $s := $lookup($orders, $trim(args));\n  { "orderId": $trim(args), "status": $s ? $s : "not found" }\n)' }), 'Stands in for your order system: replace it with a REST call or SQL query.'),
      D(N('d', 'discord', 'Answer in the channel', 960, 100, { connection: dcC.id, op: 'send message', channelId: '{{trigger.channelId}}', content: '', embedTitle: 'Order {{input.orderId}}', embedText: 'Status: {{input.status}}', embedUrl: '', embedColor: '#2f6fd8', files: '' }), 'Answers in the same channel with an embed; mentions are switched off so nobody is pinged.'),
      D(N('h', 'discord', 'Explain the commands', 660, 300, { connection: dcC.id, op: 'send message', channelId: '{{trigger.channelId}}', content: 'Try `!status A-1001`.', embedTitle: '', embedText: '', embedUrl: '', embedColor: '', files: '' }), 'Any other command gets a short help line.'),
    ],
    edges: [E('t', 'i', 'command'), E('i', 'j', 'true'), E('i', 'h', 'false'), E('j', 'd')],
  });
  const tgC = want('telegram') ? conn('telegram', 'Sample Telegram bot', { botTokenSecret: 'TELEGRAM_BOT_TOKEN', chatId: '', apiBase: 'https://api.telegram.org' }) : null;
  const tgBot = tgC && save({
    name: 'Sample: Telegram order status bot',
    description: 'While deployed, answers /status <order number> sent to your Telegram bot, replying to the message in the same chat; other messages get a help line. Create the bot with @BotFather and keep its token as the secret TELEGRAM_BOT_TOKEN. No public address is needed.',
    nodes: [
      D(N('t', 'telegramTrigger', 'Message to the bot', 60, 240, { connection: tgC.id, onlyChats: '' }), 'Receives every message sent to the bot (long polling); /commands go to the command output.'),
      D(N('i', 'if', 'Is it status', 360, 160, { left: '{{input.command}}', op: 'equals', right: 'status' }), 'Only /status is answered here; add a Switch for more commands.'),
      D(N('j', 'jsonata', 'Look up the order', 660, 100, { source: '{{input}}', expression: '(\n  $orders := { "A-1001": "shipped with Blue Dart", "A-1002": "being packed", "A-1003": "delivered" };\n  $s := $lookup($orders, $trim(args));\n  { "orderId": $trim(args), "status": $s ? $s : "not found" }\n)' }), 'Stands in for your order system: replace it with a REST call or SQL query.'),
      D(N('r', 'telegram', 'Reply with the status', 960, 100, { connection: tgC.id, op: 'send message', chatId: '{{trigger.chatId}}', text: '<b>Order {{input.orderId}}</b>: {{input.status}}', format: 'HTML', replyTo: '{{trigger.messageId}}', preview: false, silent: false }), 'Replies to the message in the same chat, with the order number in bold.'),
      D(N('h', 'telegram', 'Help', 660, 340, { connection: tgC.id, op: 'send message', chatId: '{{trigger.chatId}}', text: 'Send /status followed by your order number, for example /status A-1001.', format: 'plain', replyTo: '', preview: false, silent: false }), 'Anything else gets a short help line.'),
    ],
    edges: [E('t', 'i', 'command'), E('t', 'h', 'message'), E('i', 'j', 'true'), E('i', 'h', 'false'), E('j', 'r')],
  });
  const tgNotify = tgC && save({
    name: 'Sample: Telegram team alerts',
    description: 'A Sutra other Sutras call (Call Sutra) to alert a team in its Telegram chat: a title in bold, the text and a link. Set the default chat id on the Sample Telegram bot; for Discord, add a Discord step the same way.',
    nodes: [
      D(N('s', 'start', 'Alert', 60, 240, { payload: JSON.stringify({ title: 'Nightly load failed', text: 'CopySalesToLake failed at Load mart: Violation of PRIMARY KEY constraint', link: 'https://adf.azure.com/' }, null, 2) }), 'The alert: a title, a text and an optional link. Call Sutra passes them.'),
      D(N('t', 'telegram', 'To Telegram', 360, 160, { connection: tgC.id, op: 'send message', chatId: '', text: '<b>{{input.title}}</b>\n{{input.text}}\n{{input.link}}', format: 'HTML', replyTo: '', preview: false, silent: false }), 'Posts the alert to the team chat (the default chat of the connection).'),
      D(N('r', 'return', 'Done', 660, 240, { source: 'value', value: '{"sent": true}' }), 'Tells the calling Sutra the alert went out.'),
    ],
    edges: [E('s', 't'), E('t', 'r')],
  });

  linkConnections(projectId, made, conn);
  for (const m of made) setFlowFolder(m.id, folderOf(m.sample));
  // Connections made for the samples go to a Samples folder of Resources.
  for (const r of listResources(undefined, projectId)) if (!resourcesBefore.has(r.id) && !r.folder) setItemFolder('resources', r.id, 'Samples');

  return [forEach, loops, tax, invoice, tryCatch, csvSkill, fbSkill, rest, csv, filesFolder, database, xml, transform, routing, conditions, chSend, chListen, counter, scripts, release, localAi, email, queue, timer, fileTrig, textFormats, dbUpd, dbProc, soapCall, emailIn, firebase, google, apps, aiMore,
    soapPublic, soapMock, soapMockCall, msCustomers, msStock, msOrders, sqlInstall, sqlService, ...sftp, ...ftp,
    toolOrder, toolStock, desk, ragWeb, ragSp, ragAsk, queueAgent, team, mcpAgent, docOne, docFeed, docApi, docTool, docAgent, adfRunS, adfAlert, dbxNb, dbxSql, pyInline, pyFile, ytPublish, ytReport, twLive, dcBot, tgBot, tgNotify]
    .filter((f): f is NonNullable<typeof f> & { id: string; name: string } => !!f)
    .map(f => ({ id: f.id, name: f.name, folder: folderOf(made.find(m => m.id === f.id)?.sample || '') }));
}

/** Where each sample's Sutras go: Samples/<topic>. */
const FOLDERS: Record<string, string[]> = {
  'Data and mapping': ['foreach', 'loops', 'xml', 'transform', 'textformats'],
  'Flow control': ['subsutra', 'trycatch', 'routing', 'conditions', 'counter', 'channels'],
  'REST and microservices': ['rest', 'microservices'],
  'SOAP': ['soapcall', 'soappublic', 'soapmock'],
  'Files': ['csv', 'folder', 'filetrigger', 'timer'],
  'SFTP and FTP': ['sftp', 'ftp'],
  'SQL': ['database', 'dbmore', 'sqlinstall'],
  'AI': ['localai', 'aimore'],
  'Email': ['email', 'emailin'],
  'Apps': ['firebase', 'google', 'apps', 'skills'],
  'Queues': ['queue'],
  'Operations': ['scripts', 'release'],
  'AI agents': ['agentdesk', 'agentrag', 'agentqueue', 'agentteam', 'agentmcp', 'agentdocs'],
  'Azure and Databricks': ['adf', 'databricks'],
  'Python': ['python'],
  'Social media': ['youtube', 'twitch', 'discord', 'telegram'],
};
const folderOf = (sample: string) => { const t = Object.entries(FOLDERS).find(([, ids]) => ids.includes(sample)); return t ? `Samples/${t[0]}` : 'Samples'; };
for (const s of SAMPLES) s.folder = folderOf(s.id);

/** Sample Sutras by folder, to file the ones added before folders existed. A test keeps this list in step with addSamples(). */
export const SAMPLE_SUTRAS: Record<string, string[]> = {
  'Samples/Data and mapping': ['For-Each mapping', 'Loop on an activity', 'XML in and out', 'JSONata, JavaScript and HTML', 'Parse JSON and CSV text'],
  'Samples/Flow control': ['Calculate tax (called Sutra)', 'Invoice with a sub-Sutra', 'Try and catch with logs', 'Router, Switch and Merge', 'Connection conditions', 'Channel sender', 'Channel listener', 'Counter, Wait and Sutra variables'],
  'Samples/Apps': ['Skill: Write CSV file', 'Skill: Post to Facebook page', 'Firebase order to app', 'Google Drive and Sheets', 'Dropbox YouTube and any API'],
  'Samples/REST and microservices': ['REST API with validation', 'Microservice Customers', 'Microservice Stock', 'Microservice Orders'],
  'Samples/Files': ['CSV import and totals', 'Folder of files', 'Timer nightly archive', 'File trigger CSV drop folder'],
  'Samples/SQL': ['Database (SQLite)', 'SQL update', 'Stored procedure', 'SQL install script', 'Procedure as a microservice'],
  'Samples/Operations': ['Scripts', 'Release pipeline'],
  'Samples/AI': ['Local AI with Ollama', 'AI translate extract route and reply'],
  'Samples/Email': ['Email a report', 'Email trigger orders by email'],
  'Samples/Queues': ['Queue in and out'],
  'Samples/SOAP': ['Call a SOAP service', 'Call a public SOAP service', 'Mock SOAP weather service', 'Call the mock SOAP service'],
  'Samples/SFTP and FTP': ['SFTP upload list read archive', 'SFTP file trigger', 'FTP upload list read archive', 'FTP file trigger'],
  'Samples/AI agents': ['AI tool order status', 'AI tool stock check', 'Order desk agent', 'Knowledge feed from web pages', 'Knowledge feed from SharePoint', 'Policy assistant', 'Agent fed by a queue', 'Supervisor agent', 'Agent with outside MCP tools', 'Add one document to knowledge', 'Document feed from a folder', 'Document questions API', 'AI tool search documents', 'Document assistant'],
  'Samples/Azure and Databricks': ['ADF run pipeline and wait', 'ADF alert on failed runs', 'Databricks notebook with parameters', 'Databricks SQL and code block'],
  'Samples/Python': ['Python script with parameters', 'Python script file'],
  'Samples/Social media': ['Publish Drive videos to YouTube', 'YouTube weekly analytics to Google Sheets', 'Twitch going live announcement', 'Discord order status bot', 'Telegram order status bot', 'Telegram team alerts'],
};
/** Letters and digits only, without "Sample:" and a " 2" suffix, so renamed punctuation still matches. */
const sampleKey = (name: string) => name.replace(/^Sample:\s*/i, '').replace(/\s+\d+$/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const SAMPLE_FOLDER = new Map(Object.entries(SAMPLE_SUTRAS).flatMap(([f, names]) => names.map(n => [sampleKey(n), f] as const)));

/**
 * Moves sample Sutras still at the top level into their Samples/<topic> folder, and "Sample ..."
 * connections into Resources/Samples. Only items at the top are touched; returns how many moved.
 */
export function fileSamples(projectId: string) {
  let n = 0;
  for (const f of listFlows(projectId)) {
    if (f.folder || !(/^(Sample|Skill):/i.test(f.name))) continue;
    const folder = SAMPLE_FOLDER.get(sampleKey(f.name));
    if (folder) { setFlowFolder(f.id, folder); n++; }
  }
  for (const r of listResources(undefined, projectId)) if (!r.folder && /^Sample /.test(r.name)) { setItemFolder('resources', r.id, 'Samples'); n++; }
  return n;
}

/** Once per data folder: files the samples of every project added before folders existed. */
export function fileSamplesOnce() {
  if (getSetting('folders.samplesFiled', false)) return;
  for (const p of q.all<{ id: string }>('select id from projects')) fileSamples(p.id);
  setSetting('folders.samplesFiled', true);
}

/** Connections a sample step needs but did not set: made once per project as "Sample ..." placeholders to fill in. */
const SAMPLE_CONNECTIONS: Record<string, (type: string) => { name: string; config: Record<string, any> } | null> = {
  smtp: () => ({ name: 'Sample SMTP', config: { host: 'smtp.example.com', port: 587 } }),
  imap: () => ({ name: 'Sample IMAP', config: { host: 'imap.example.com', port: 993 } }),
  database: () => ({ name: 'Sample MySQL', config: { driver: 'mysql', host: '127.0.0.1', port: 3306, database: '', user: 'root', passwordSecret: '' } }),
  kafka: () => ({ name: 'Sample Kafka', config: { brokers: ['localhost:9092'] } }),
  rabbitmq: () => ({ name: 'Sample RabbitMQ', config: {} }),
  amqp1: () => ({ name: 'Sample ActiveMQ', config: {} }),
  firebase: () => ({ name: 'Sample Firebase', config: {} }),
  sftp: () => ({ name: 'Sample SFTP', config: { host: 'sftp.example.com', port: 22, user: 'sample' } }),
  ftp: () => ({ name: 'Sample FTP', config: { host: 'ftp.example.com', port: 21, user: 'sample' } }),
  aiProvider: () => ({ name: 'Local Ollama', config: { engine: 'Ollama', model: '', baseUrl: '', maxTokens: 600, ollamaApi: 'chat' } }),
  aiMemory: () => ({ name: 'Sample AI memory', config: { store: 'built-in' } }),
  aiKnowledge: () => ({ name: 'Sample knowledge base', config: { store: 'built-in', embedWith: 'built-in' } }),
  oauthApp: type => /^ms/i.test(type) ? { name: 'Sample Microsoft', config: { provider: 'microsoft', scopes: 'Files.Read.All Sites.Read.All offline_access' } }
    : /^facebook/i.test(type) ? { name: 'Sample Facebook', config: { provider: 'facebook', scopes: 'pages_manage_posts pages_read_engagement' } }
    : /^dropbox/i.test(type) ? { name: 'Sample Dropbox', config: { provider: 'dropbox', scopes: 'files.content.write files.content.read' } }
    : { name: 'Sample Google', config: { provider: 'google' } },
};

/** Shown in the Inspector: same rule as the field list (showIf, showIfAny), with defaults for unset fields. */
function shown(f: Field, cfg: Record<string, any>, fields: Field[]) {
  const val = (k: string) => (k in cfg ? cfg[k] : fields.find(x => x.k === k)?.def);
  const holds = (c: { k: string; in: any[] }) => c.in.includes(val(c.k));
  if (f.showIf && !holds(f.showIf)) return false;
  if (f.showIfAny && !f.showIfAny.some(holds)) return false;
  return true;
}

/** Sets every empty, visible connection field of the sample steps to a sample connection in the project. */
function linkConnections(projectId: string, made: { id: string }[], conn: (kind: string, name: string, cfg: Record<string, any>) => { id: string }) {
  const kinds = new Set(RESOURCE_KINDS.map(k => k.kind));
  for (const m of made) {
    const f = getFlow(m.id);
    if (!f) continue;
    let changed = false;
    for (const n of f.doc.nodes) {
      const act = allActivities.find(a => a.type === n.type);
      for (const fld of act?.fields || []) {
        if (fld.type !== 'resource' || !fld.resourceKind || !kinds.has(fld.resourceKind) || n.config[fld.k]) continue;
        const make = SAMPLE_CONNECTIONS[fld.resourceKind];
        if (!make || !shown(fld, n.config, act!.fields)) continue;
        const c = make(n.type);
        if (!c) continue;
        n.config[fld.k] = conn(fld.resourceKind, c.name, c.config).id;
        changed = true;
      }
    }
    if (changed) saveFlow(m.id, f.doc, projectId);
  }
}
