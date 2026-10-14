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

  return [forEach, loops, tax, invoice, tryCatch, csvSkill, fbSkill, rest, csv, filesFolder, database, xml, transform, routing, conditions, chSend, chListen, counter, localAi, email, queue]
    .filter((f): f is NonNullable<typeof f> & { id: string; name: string } => !!f)
    .map(f => ({ id: f.id, name: f.name }));
}
