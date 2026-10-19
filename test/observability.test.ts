import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { testEnv, captureServer, node, edge } from './helpers.js';

const env = testEnv(19510);
// A stand-in OpenTelemetry collector, a metrics token and JSON logs, all set before the server loads.
const collector = await captureServer(() => ({ status: 200, body: '{}' }));
process.env.OTEL_EXPORTER_OTLP_ENDPOINT = collector.url;
process.env.OTEL_SERVICE_NAME = 'sutra-test';
process.env.SUTRA_METRICS_TOKEN = 'metrics-token-123';
process.env.SUTRA_LOG_FORMAT = 'json';
process.env.SUTRA_ADMIN_TOKEN = 'obs-admin-token-0123456789';
const ADMIN = { authorization: 'Bearer obs-admin-token-0123456789' };

const { boot } = await import('../server/src/index.js');
const { engine } = await import('../server/src/engine/engine.js');
const { q } = await import('../server/src/db.js');
const projects = await import('../server/src/projects.js');
const flows = await import('../server/src/flows.js');
const { flushTracing, traceIdFor, runSpanId } = await import('../server/src/tracing.js');
const { housekeeping } = await import('../server/src/housekeeping.js');
const { saveResource } = await import('../server/src/resources.js');

let srv: Awaited<ReturnType<typeof boot>>;
let pid = '';
before(async () => {
  srv = await boot({ listenAdmin: false });
  pid = projects.saveProject({ name: 'Obs', config: { variables: [] } }).id;
});
after(async () => { await srv.stop(); await collector.close(); });

async function run(name: string, nodes: any[], edges: any[], input?: any) {
  const id = engine.startRun({ doc: { name, nodes, edges }, projectId: pid, input, source: 'test' });
  await engine.waitFor(id, 20000);
  return { id, ...(q.get('select status, error from runs where id = ?', id) as any) };
}
const metricsText = async (token = 'metrics-token-123') => srv.admin.inject({ method: 'GET', url: '/metrics', headers: token ? { authorization: `Bearer ${token}` } : {} });
const value = (text: string, line: RegExp) => Number(text.split('\n').find(l => line.test(l))?.split(' ').pop());

test('metrics: runs, steps by outcome, retries and durations; gauges read when scraped; valid text format', async () => {
  const s = node('start', 'Start'), l = node('log', 'Note', { message: 'hi' });
  await run('Metric ok', [s, l], [edge(s, l)]);
  const t = node('throw', 'Boom', { message: 'nope' }, { retries: 1, retryDelayMs: 10 });
  await run('Metric fail', [s, t], [edge(s, t)]);
  const t2 = node('throw', 'Handled', { message: 'x' }), h = node('log', 'Caught', { message: 'ok' });
  await run('Metric handled', [s, t2, h], [edge(s, t2), edge(t2, h, 'error')]);

  assert.equal((await metricsText('')).statusCode, 401, 'the metrics token is required when set');
  const r = await metricsText();
  assert.equal(r.statusCode, 200);
  assert.match(String(r.headers['content-type']), /text\/plain; version=0\.0\.4/);
  const text = r.body;
  assert.equal(value(text, /^sutra_runs_finished_total\{status="done",sutra="Metric ok"\}/), 1);
  assert.equal(value(text, /^sutra_runs_finished_total\{status="failed",sutra="Metric fail"\}/), 1);
  assert.equal(value(text, /^sutra_steps_total\{activity="throw",outcome="failed"\}/), 1);
  assert.equal(value(text, /^sutra_steps_total\{activity="throw",outcome="error"\}/), 1);
  assert.equal(value(text, /^sutra_step_retries_total\{activity="throw"\}/), 1);
  assert.ok(value(text, /^sutra_runs_started_total\{source="test",sutra="Metric ok"\}/) >= 1);
  assert.ok(value(text, /^sutra_step_duration_seconds_count\{activity="log"\}/) >= 2);
  assert.match(text, /sutra_run_duration_seconds_bucket\{le="\+Inf",status="done",sutra="Metric ok"\} 1/);
  assert.equal(value(text, /^sutra_engine_leader /), 1);
  const { version } = await import('../server/src/config.js');
  assert.ok(new RegExp('sutra_info\{engine="[^"]+",mode="studio",version="([^"]+)"\} 1').exec(text)?.[1] === version, 'sutra_info carries the product version');
  assert.match(text, /^sutra_tasks\{status="pending"\} \d+/m);
  for (const line of text.split('\n').filter(Boolean)) {
    assert.match(line, /^(# (HELP|TYPE) [a-z_]+ .+|[a-z_]+(\{[a-z_]+="[^"\n]*"(,[a-z_]+="[^"\n]*")*\})? -?[\d.e+]+)$/, `bad metrics line: ${line}`);
  }
});

test('gateway: requests counted; every answer carries the run trace; a caller\'s traceparent is continued', async () => {
  const t = node('restService', 'API', { method: 'GET', path: '/obs/ping', policy: '', maxBodyKb: 16, testRequest: '{}' });
  const r = node('httpResponse', 'Reply', { status: '200', contentType: 'application/json', bodySource: 'template', body: '{"ok": true}', headers: [] });
  const f = flows.saveFlow(undefined, { name: 'Obs API', nodes: [t, r], edges: [edge(t, r)] }, pid);
  flows.deploy(f.id);
  let res = await fetch(`${env.http}/obs/ping`);
  assert.equal(res.status, 200);
  const run1 = res.headers.get('x-sutra-run')!;
  assert.equal(res.headers.get('traceparent'), `00-${traceIdFor(run1)}-${runSpanId(run1)}-01`);
  const incoming = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
  res = await fetch(`${env.http}/obs/ping`, { headers: { traceparent: incoming } });
  const run2 = res.headers.get('x-sutra-run')!;
  assert.equal(res.headers.get('traceparent'), `00-4bf92f3577b34da6a3ce929d0e0e4736-${runSpanId(run2)}-01`, 'same trace as the caller');
  const text = (await metricsText()).body;
  assert.ok(value(text, /^sutra_gateway_requests_total\{kind="rest",status="200"\}/) >= 2);
  assert.ok(value(text, /^sutra_gateway_request_duration_seconds_count\{kind="rest"\}/) >= 2);
  (globalThis as any).__obsRuns = { run2 };
});

test('traces: a run is a trace with a root span and one span per step, sent to the collector over OTLP', async () => {
  const s = node('start', 'Start'), l = node('log', 'Step one', { message: 'a' }), b = node('throw', 'Step two', { message: 'broken here' });
  const failed = await run('Traced', [s, l, b], [edge(s, l), edge(l, b)]);
  await flushTracing();
  const spans = collector.seen.filter(x => x.url === '/v1/traces').flatMap(x => {
    const body = JSON.parse(x.body);
    assert.equal(body.resourceSpans[0].resource.attributes.find((a: any) => a.key === 'service.name').value.stringValue, 'sutra-test');
    return body.resourceSpans[0].scopeSpans[0].spans;
  });
  const trace = traceIdFor(failed.id);
  const mine = spans.filter((sp: any) => sp.traceId === trace);
  const root = mine.find((sp: any) => sp.name === 'Sutra Traced');
  assert.ok(root, 'root span');
  assert.equal(root.spanId, runSpanId(failed.id));
  assert.equal(root.status.code, 2, 'failed run: error status');
  const steps = mine.filter((sp: any) => sp.parentSpanId === root.spanId).map((sp: any) => sp.name).sort();
  assert.deepEqual(steps, ['Start', 'Step one', 'Step two']);
  const two = mine.find((sp: any) => sp.name === 'Step two');
  assert.equal(two.status.message, 'broken here');
  assert.ok(two.attributes.some((a: any) => a.key === 'sutra.activity' && a.value.stringValue === 'throw'));
  // The run started with a caller's traceparent hangs under the caller's span.
  const { run2 } = (globalThis as any).__obsRuns;
  const cont = spans.find((sp: any) => sp.spanId === runSpanId(run2));
  assert.equal(cont.traceId, '4bf92f3577b34da6a3ce929d0e0e4736');
  assert.equal(cont.parentSpanId, '00f067aa0ba902b7');
  assert.equal(cont.kind, 2, 'server span for API runs');
  const text = (await metricsText()).body;
  assert.ok(value(text, /^sutra_traces_exported_total /) >= mine.length);
});

test('JSON log lines on standard output', async () => {
  const lines: string[] = [];
  const write = process.stdout.write.bind(process.stdout);
  (process.stdout as any).write = (chunk: any, ...rest: any[]) => { lines.push(String(chunk)); return write(chunk, ...rest); };
  try {
    const s = node('start', 'Start'), l = node('log', 'Say', { message: 'hello from a Sutra', level: 'warn' });
    await run('Logged', [s, l], [edge(s, l)]);
  } finally { (process.stdout as any).write = write; }
  const json = lines.flatMap(l => l.split('\n')).filter(l => l.startsWith('{')).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });
  const said = json.find(j => j.msg === 'hello from a Sutra');
  assert.ok(said, 'the step log line');
  assert.equal(said.level, 'warn');
  assert.equal(said.sutra, 'Logged');
  assert.equal(said.step, 'Say');
  assert.ok(said.run && said.engine && said.time);
  assert.ok(json.some(j => /Run finished/.test(j.msg)));
});

test('retention: finished runs older than the limit are deleted with their steps; waiting and recent runs stay', async () => {
  const s = node('start', 'Start'), l = node('log', 'L', { message: 'x' });
  const old1 = await run('Old', [s, l], [edge(s, l)]);
  const recent = await run('Recent', [s, l], [edge(s, l)]);
  const ap = node('approval', 'Wait for me', { message: 'ok?' });
  const waiting = engine.startRun({ doc: { name: 'Waiting', nodes: [s, ap], edges: [edge(s, ap)] }, projectId: pid });
  await engine.waitFor(waiting, 10000, true);
  const long = new Date(Date.now() - 40 * 86400000).toISOString();
  q.run('update runs set started_at = ?, finished_at = ? where id = ?', long, long, old1.id);
  q.run('update runs set started_at = ? where id = ?', long, waiting);
  assert.equal(housekeeping({ retentionDays: 0 }).deletedRuns, 0, '0 keeps everything');
  const r = await srv.admin.inject({ method: 'POST', url: '/api/engine/housekeeping', headers: ADMIN, payload: { retentionDays: 30 } });
  assert.equal(r.statusCode, 200, r.body);
  assert.ok(r.json().deletedRuns >= 1);
  assert.equal(q.get('select 1 as x from runs where id = ?', old1.id), undefined, 'old run deleted');
  assert.equal(q.get('select 1 as x from tasks where run_id = ?', old1.id), undefined, 'its steps deleted');
  assert.ok(q.get('select 1 as x from runs where id = ?', recent.id), 'recent run kept');
  assert.ok(q.get('select 1 as x from runs where id = ?', waiting), 'waiting run kept');
  engine.cancel(waiting);
});

test('run again from the failed step: the failed HTTP call is repeated once the service is back', async () => {
  let up = false;
  const { captureServer: cap } = await import('./helpers.js');
  const svc = await cap(() => (up ? { status: 200, body: '{"ok":true}' } : { status: 503, body: '{"down":true}' }));
  try {
    const conn = saveResource({ kind: 'httpConnection', name: 'Flaky service', project_id: pid, config: { baseUrl: svc.url } });
    const s = node('start', 'Start'), before = node('log', 'Before', { message: 'kept' });
    const h = node('httpRequest', 'Call service', { connection: conn.id, method: 'GET', url: '/x', bodyType: 'none', failOn: '4xx or 5xx' });
    const after = node('log', 'After', { message: 'status {{input.status}}' });
    const failed = await run('Resubmit me', [s, before, h, after], [edge(s, before), edge(before, h), edge(h, after)]);
    assert.equal(failed.status, 'failed');
    assert.match(failed.error, /503/);
    up = true;
    assert.equal((await srv.admin.inject({ method: 'POST', url: `/api/runs/${failed.id}/resubmit`, headers: { 'x-sutra': '1' } })).statusCode, 401, 'sign-in required');
    const res = await srv.admin.inject({ method: 'POST', url: `/api/runs/${failed.id}/resubmit`, headers: ADMIN });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().resubmitted, 1);
    await engine.waitFor(failed.id, 20000);
    const row = q.get<any>('select status, error, state from runs where id = ?', failed.id);
    assert.equal(row.status, 'done');
    assert.equal(row.error, null);
    const st = JSON.parse(row.state);
    assert.equal(st.outputs['Call service'].status, 200);
    assert.ok(st.outputs.Before, 'earlier results kept');
    assert.ok(st.logs.some((l: any) => /Run again from Call service by token/.test(l.msg)));
    assert.equal(svc.seen.length, 2, 'the service was called once per attempt, the earlier steps were not repeated');
    const again = await srv.admin.inject({ method: 'POST', url: `/api/runs/${failed.id}/resubmit`, headers: ADMIN });
    assert.equal(again.statusCode, 400);
    assert.match(again.json().error, /Only failed runs/);
    const e = node('end', 'Stop', { stop: 'Sutra: error', result: '', message: 'on purpose' });
    const stopped = await run('Stopped', [s, e], [edge(s, e)]);
    assert.throws(() => engine.resubmit(stopped.id), /stopped on purpose/);
  } finally { await svc.close(); }
});
