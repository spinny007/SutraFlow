import { listFlows, saveFlow } from './flows.js';
import { listResources, saveResource } from './resources.js';
import type { FlowNode } from './engine/types.js';

/**
 * Sample Sutras added to a project from "New Sutra": For-Each mapping, loops on an activity,
 * a Sutra that calls another (sub-Sutra with Return), try / catch with logs, and two MCP skills
 * (Write CSV file, Post to Facebook page) on a sample MCP server.
 */
const N = (id: string, type: string, name: string, x: number, y: number, config: Record<string, any> = {}, settings?: FlowNode['settings']): FlowNode =>
  ({ id, type, name, x, y, config, ...(settings ? { settings } : {}) });
let e = 0;
const E = (from: string, to: string, port = 'out') => ({ id: `e${++e}`, from, port, to });

/** The samples offered in "New Sutra"; needs = what must be set up before the sample can run. */
export const SAMPLES: { id: string; name: string; desc: string; palettes: string; needs?: string }[] = [
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
  { id: 'scripts', name: 'Scripts: PowerShell and Run program', palettes: 'Scripts', desc: 'A PowerShell disk report that hands JSON to the next step, and a program run with arguments; failures carry the exit code and error output.', needs: 'scripts allowed by an administrator in Server & APIs' },
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
  { id: 'release', name: 'Release pipeline', palettes: 'Release, Flow control, Email', desc: 'A Sutra that releases a project: builds a package, checks it, deploys it to a test copy, waits for approval, deploys to production, and logs each step; any problem goes to one handler.', needs: 'release activities allowed in Server & APIs; for remote engines, their admin tokens in the vault' },
  { id: 'localai', name: 'Local AI with Ollama', palettes: 'AI', desc: 'Classifies, summarises and rates a customer email with a local Ollama model, offline.', needs: 'Ollama running on this machine with at least one model' },
  { id: 'email', name: 'Email a report', palettes: 'Email, Custom code', desc: 'Builds an HTML report and emails it; a failure is logged.', needs: 'an Email (SMTP) connection' },
  { id: 'queue', name: 'Queue in and out', palettes: 'Service Bus', desc: 'Takes orders from a queue, reshapes them, publishes them on, and confirms each message.', needs: 'a Kafka, RabbitMQ or ActiveMQ connection' },
  { id: 'skills', name: 'MCP skills: Write CSV file, Post to Facebook page', palettes: 'Triggers, AI, Files, Apps', desc: 'Two Sutras that AI assistants call as tools, on a sample MCP server.', needs: 'a security policy on the MCP server; a Facebook connection for posting' },
];

export function addSamples(projectId: string, ids?: string[]) {
  const want = (id: string) => !ids?.length || ids.includes(id);
  const taken = new Set(listFlows(projectId).map(f => f.name.toLowerCase()));
  const name = (base: string) => { let n = base; for (let i = 2; taken.has(n.toLowerCase()); i++) n = `${base} ${i}`; taken.add(n.toLowerCase()); return n; };
  const save = (doc: any) => saveFlow(undefined, { ...doc, name: name(doc.name) }, projectId);

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
    description: 'PowerShell lists the disks and hands JSON to the next step; Run program starts Node.js with one argument; a bash Shell script counts files and prints JSON; each error output logs the exit code and error output. Needs "Allow script activities" in Server & APIs.',
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

  return [forEach, loops, tax, invoice, tryCatch, csvSkill, fbSkill, rest, csv, filesFolder, database, xml, transform, routing, conditions, chSend, chListen, counter, scripts, release, localAi, email, queue, timer, fileTrig, textFormats, dbUpd, dbProc, soapCall, emailIn, firebase, google, apps, aiMore]
    .filter((f): f is NonNullable<typeof f> & { id: string; name: string } => !!f)
    .map(f => ({ id: f.id, name: f.name }));
}
