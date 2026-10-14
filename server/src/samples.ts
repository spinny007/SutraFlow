import { listFlows, saveFlow } from './flows.js';
import type { FlowNode } from './engine/types.js';

/**
 * Sample Sutras added to a project from "New Sutra": For-Each mapping, loops on an activity,
 * a Sutra that calls another (sub-Sutra with Return), and try / catch with logs.
 */
const N = (id: string, type: string, name: string, x: number, y: number, config: Record<string, any> = {}, settings?: FlowNode['settings']): FlowNode =>
  ({ id, type, name, x, y, config, ...(settings ? { settings } : {}) });
let e = 0;
const E = (from: string, to: string, port = 'out') => ({ id: `e${++e}`, from, port, to });

export function addSamples(projectId: string) {
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
  const forEach = save({
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
  const loops = save({
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
  const tax = save({
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
  const invoice = save({
    name: 'Sample: Invoice with a sub-Sutra',
    description: 'Calls "Sample: Calculate tax (called Sutra)" with Call Sutra, waits for its result and logs it. A failure inside the called Sutra arrives on the error output.',
    nodes: [
      N('s', 'start', 'Invoice', 60, 200, { payload: JSON.stringify({ orderId: 'A-1001', amount: 2500, country: 'IN' }, null, 2) }),
      N('c', 'callProcess', 'Calculate tax', 400, 200, { process: tax.id, use: 'deployed (draft while testing)', wait: true, source: 'value', input: '{{input}}', resultSchema: '' }),
      N('l', 'log', 'Log totals', 740, 140, { level: 'info', message: "=concat('Order ', {trigger.orderId}, ': tax ', {input.tax}, ', total ', {input.total})" }),
      N('x', 'log', 'Log tax failure', 740, 320, { level: 'error', message: 'Tax could not be worked out: {{input.error.message}}' }),
    ],
    edges: [E('s', 'c'), E('c', 'l'), E('c', 'x', 'error')],
  });

  // 5. Try / catch: an error output handled where it happens, and the Error handler for the rest.
  const tryCatch = save({
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

  return [forEach, loops, tax, invoice, tryCatch].map(f => ({ id: f.id, name: f.name }));
}
