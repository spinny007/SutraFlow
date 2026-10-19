/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { testEnv, node, edge } from './helpers.js';

/**
 * Azure Data Factory and Databricks against stand-in services that answer like Azure: sign-in with a
 * service principal, running and waiting for pipelines (succeeded, failed with the failing activity,
 * rerun from failure, cancelled at the wait limit), the run-finished trigger's query, Databricks
 * notebooks and jobs with exit values, code blocks on a cluster that is started first, SQL with
 * parameters, and Test connection for both.
 */
testEnv(20200);
const { boot } = await import('../server/src/index.js');
const { engine } = await import('../server/src/engine/engine.js');
const { q } = await import('../server/src/db.js');
const projects = await import('../server/src/projects.js');
const { saveResource } = await import('../server/src/resources.js');
const { setSecret } = await import('../server/src/secrets.js');
const { testResource } = await import('../server/src/resourceTest.js');
const { validateDoc } = await import('../server/src/flows.js');

let srv: Awaited<ReturnType<typeof boot>>;
let fake: http.Server;
let base = '';
let pid = '';
const seen: { method: string; url: string; body: any; auth: string }[] = [];
const runs = new Map<string, { pipeline: string; polls: number; outcome: string; params: any; query: Record<string, string> }>();
let dbxCluster = 'TERMINATED';
const dbxRuns = new Map<number, { polls: number; ok: boolean }>();

before(async () => {
  srv = await boot({ listenAdmin: false });
  pid = projects.saveProject({ name: 'Data platform', config: { variables: [] } }).id;
  setSecret('ADF_SP_SECRET', 'sp-secret-value');
  setSecret('DBX_TOKEN', 'dapi-test-token');
  fake = http.createServer((req, res) => {
    let b = ''; req.on('data', d => (b += d)); req.on('end', () => {
      const u = new URL(req.url!, 'http://x');
      const body = b && /json/.test(String(req.headers['content-type'])) ? JSON.parse(b) : b;
      seen.push({ method: req.method!, url: req.url!, body, auth: String(req.headers.authorization || '') });
      const send = (status: number, o: unknown) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
      const p = u.pathname;
      // Entra ID token endpoint
      if (/\/oauth2\/v2\.0\/token$/.test(p)) {
        const f = new URLSearchParams(b);
        if (f.get('client_secret') !== 'sp-secret-value') return send(401, { error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret provided.' });
        return send(200, { access_token: `aad:${f.get('scope')}`, expires_in: 3600 });
      }
      // Data Factory
      const fx = '/subscriptions/sub-1/resourceGroups/rg-data/providers/Microsoft.DataFactory/factories/adf-sales';
      if (p.startsWith(fx)) {
        if (req.headers.authorization !== 'Bearer aad:' + base + '/.default') return send(401, { error: { message: 'bad token' } });
        const rest = p.slice(fx.length);
        if (rest === '') return send(200, { name: 'adf-sales', location: 'centralindia' });
        if (rest === '/pipelines') return send(200, { value: [{ name: 'CopySalesToLake', properties: { parameters: { runDate: { type: 'String' } } } }, { name: 'BuildMart', properties: {} }] });
        let m = /^\/pipelines\/([^/]+)\/createRun$/.exec(rest);
        if (m) {
          const id = `run-${runs.size + 1}`;
          const pl = decodeURIComponent(m[1]);
          if (pl === 'Missing') return send(404, { error: { message: 'Pipeline Missing not found' } });
          runs.set(id, { pipeline: pl, polls: 0, outcome: pl === 'BuildMart' ? 'Failed' : pl === 'Forever' ? 'InProgress' : 'Succeeded', params: body, query: Object.fromEntries(u.searchParams) });
          return send(200, { runId: id });
        }
        m = /^\/pipelineruns\/([^/]+)$/.exec(rest);
        if (m) {
          const r = runs.get(m[1])!;
          r.polls++;
          const status = r.polls < 2 ? 'InProgress' : r.outcome;
          return send(200, { runId: m[1], pipelineName: r.pipeline, status, message: status === 'Failed' ? 'Operation on target Load mart failed' : '', parameters: r.params, runStart: '2026-10-19T01:00:00Z', ...(status !== 'InProgress' ? { runEnd: '2026-10-19T01:02:00Z', durationInMs: 120000 } : {}) });
        }
        m = /^\/pipelineruns\/([^/]+)\/queryActivityruns$/.exec(rest);
        if (m) return send(200, { value: [{ activityName: 'Copy sales', activityType: 'Copy', status: 'Succeeded', durationInMs: 50000, output: { rowsCopied: 1200 } }, ...(runs.get(m[1])?.outcome === 'Failed' ? [{ activityName: 'Load mart', activityType: 'SqlServerStoredProcedure', status: 'Failed', error: { message: 'Violation of PRIMARY KEY constraint', errorCode: '2402' } }] : [])] });
        m = /^\/pipelineruns\/([^/]+)\/cancel$/.exec(rest);
        if (m) { const r = runs.get(m[1]); if (r) r.outcome = 'Cancelled'; return send(200, {}); }
        if (rest === '/queryPipelineRuns') return send(200, { value: [...runs.entries()].map(([id, r]) => ({ runId: id, pipelineName: r.pipeline, status: r.outcome, runStart: '2026-10-19T01:00:00Z' })) });
        if (/^\/triggers\/[^/]+\/(start|stop)$/.test(rest)) return send(200, {});
        return send(404, { error: { message: `no route ${rest}` } });
      }
      // Databricks (personal access token)
      if (p.startsWith('/api/')) {
        if (req.headers.authorization !== 'Bearer dapi-test-token') return send(403, { error_code: 'PERMISSION_DENIED', message: 'Invalid access token.' });
        if (p === '/api/2.0/preview/scim/v2/Me') return send(200, { userName: 'etl@example.com' });
        if (p === '/api/2.0/clusters/get') { const st = dbxCluster; if (dbxCluster === 'PENDING') dbxCluster = 'RUNNING'; return send(200, { cluster_id: u.searchParams.get('cluster_id'), cluster_name: 'etl-small', state: st }); }
        if (p === '/api/2.0/clusters/start') { dbxCluster = 'PENDING'; return send(200, {}); }
        if (p === '/api/2.0/sql/warehouses/wh-1') return send(200, { name: 'Starter warehouse', state: 'RUNNING' });
        if (p === '/api/2.1/jobs/runs/submit' || p === '/api/2.1/jobs/run-now') { const id = 900 + dbxRuns.size; dbxRuns.set(id, { polls: 0, ok: !String(body?.tasks?.[0]?.notebook_task?.notebook_path || '').includes('broken') }); return send(200, { run_id: id }); }
        if (p === '/api/2.1/jobs/runs/get') {
          const id = Number(u.searchParams.get('run_id')); const r = dbxRuns.get(id)!; r.polls++;
          const done = r.polls >= 2;
          return send(200, { run_id: id, run_page_url: `${base}/#job/run/${id}`, start_time: 1000, end_time: done ? 61000 : undefined, state: done ? { life_cycle_state: 'TERMINATED', result_state: r.ok ? 'SUCCESS' : 'FAILED', state_message: r.ok ? '' : 'Workload failed' } : { life_cycle_state: 'RUNNING' }, tasks: [{ task_key: 'notebook', run_id: id * 10, state: done ? { result_state: r.ok ? 'SUCCESS' : 'FAILED' } : { life_cycle_state: 'RUNNING' } }] });
        }
        if (p === '/api/2.1/jobs/runs/get-output') { const ok = dbxRuns.get(Number(u.searchParams.get('run_id')) / 10)?.ok; return send(200, ok ? { notebook_output: { result: '{"rows": 1200, "status": "ok"}' } } : { error: 'ZeroDivisionError: division by zero', error_trace: 'Traceback ...' }); }
        if (p === '/api/1.2/contexts/create') return send(200, { id: 'ctx-1' });
        if (p === '/api/1.2/commands/execute') return send(200, { id: 'cmd-1' });
        if (p === '/api/1.2/commands/status') {
          const code = String(seen.filter(s => s.url.startsWith('/api/1.2/commands/execute')).pop()?.body?.command || '');
          if (code.includes('raise')) return send(200, { status: 'Finished', results: { resultType: 'error', cause: 'ValueError: bad input', summary: '<span>ValueError: bad input</span>' } });
          if (code.startsWith('SELECT')) return send(200, { status: 'Finished', results: { resultType: 'table', schema: [{ name: 'zip' }, { name: 'trips' }], data: [['10001', 42]] } });
          return send(200, { status: 'Finished', results: { resultType: 'text', data: code.includes('sutra_params') ? '7' : '' } });
        }
        if (p === '/api/1.2/contexts/destroy') return send(200, {});
        if (p === '/api/2.0/sql/statements' && req.method === 'POST') return send(200, { statement_id: 'st-1', status: { state: 'PENDING' } });
        if (p === '/api/2.0/sql/statements/st-1') return send(200, { statement_id: 'st-1', status: { state: 'SUCCEEDED' }, manifest: { schema: { columns: [{ name: 'pickup_zip' }, { name: 'trips' }] } }, result: { data_array: [['10001', '42']], next_chunk_internal_link: '/api/2.0/sql/statements/st-1/result/chunks/1' } });
        if (p === '/api/2.0/sql/statements/st-1/result/chunks/1') return send(200, { data_array: [['10002', '7']] });
        return send(404, { message: `no route ${p}` });
      }
      send(404, {});
    });
  });
  await new Promise<void>(r => fake.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(fake.address() as any).port}`;
});
after(async () => { fake.close(); await srv.stop(); });

const adfConn = (over: Record<string, any> = {}) => saveResource({ kind: 'azureDataFactory', name: `ADF ${Math.random()}`, project_id: pid, config: { auth: 'service principal (client secret)', tenantId: 'contoso.onmicrosoft.com', clientId: 'app-1', clientSecretSecret: 'ADF_SP_SECRET', subscriptionId: 'sub-1', resourceGroup: 'rg-data', factoryName: 'adf-sales', pollSeconds: 1, cloud: 'custom', loginUrl: base, managementUrl: base, ...over } });
const dbxConn = () => saveResource({ kind: 'databricks', name: `DBX ${Math.random()}`, project_id: pid, config: { host: base, auth: 'personal access token', tokenSecret: 'DBX_TOKEN', clusterId: 'cl-1', warehouseId: 'wh-1', pollSeconds: 1 } });
const run = async (n: ReturnType<typeof node>) => {
  const s = node('start', 'Start', { payload: JSON.stringify({ date: '2026-10-18', zip: '10001' }) });
  const id = engine.startRun({ doc: { name: 'T', nodes: [s, n], edges: [edge(s, n)] }, projectId: pid, source: 'test' });
  await engine.waitFor(id, 60000);
  const r: any = q.get('select status, error, state from runs where id = ?', id);
  const st = JSON.parse(r.state);
  return { status: r.status, error: r.error, out: st.outputs[n.name], logs: (st.logs || []).map((l: any) => l.msg).join('\n') };
};

test('Test connection signs in to Azure and reads the factory and its pipelines; a wrong secret says why', async () => {
  const r = adfConn();
  const ok = await testResource({ id: r.id, kind: r.kind, project_id: pid, config: r.config });
  assert.equal(ok.ok, true, ok.message);
  assert.match(ok.message, /adf-sales \(centralindia\): 2 pipelines: CopySalesToLake, BuildMart/);
  setSecret('WRONG', 'nope');
  const bad = await testResource({ kind: 'azureDataFactory', project_id: pid, config: { ...r.config, clientSecretSecret: 'WRONG' } });
  assert.equal(bad.ok, false);
  assert.match(bad.message, /Invalid client secret/);
});

test('Run ADF pipeline: starts it with parameters, waits, and returns the activity runs', async () => {
  const c = adfConn();
  const r = await run(node('adfRun', 'Copy sales', { connection: c.id, pipeline: 'CopySalesToLake', parameters: [{ k: 'runDate', v: '{{input.date}}' }], parametersJson: '{"tables": ["orders", "lines"]}', wait: true, waitMinutes: 2, withActivities: true }));
  assert.equal(r.status, 'done', r.error);
  assert.equal(r.out.status, 'Succeeded');
  assert.deepEqual(runs.get(r.out.runId)!.params, { runDate: '2026-10-18', tables: ['orders', 'lines'] });
  assert.equal(r.out.activities[0].output.rowsCopied, 1200);
  assert.match(r.out.monitorUrl, /^https:\/\/adf\.azure\.com\/en\/monitoring\/pipelineruns\/run-/);
  assert.match(r.logs, /CopySalesToLake run run-\d+: InProgress[\s\S]*Succeeded/);
});

test('a failed pipeline goes to failed with the failing activity; a rerun starts from the failure', async () => {
  const c = adfConn();
  const s = node('start', 'Start');
  const a = node('adfRun', 'Build mart', { connection: c.id, pipeline: 'BuildMart', wait: true, waitMinutes: 2 });
  const f = node('log', 'Failed', { message: '{{input.failedActivities}}' });
  const id = engine.startRun({ doc: { name: 'T', nodes: [s, a, f], edges: [edge(s, a), edge(a, f, 'failed')] }, projectId: pid, source: 'test' });
  await engine.waitFor(id, 60000);
  const st = JSON.parse((q.get<any>('select state from runs where id = ?', id)).state);
  assert.equal(st.outputs['Build mart'].status, 'Failed');
  assert.deepEqual(st.outputs['Build mart'].failedActivities, [{ activity: 'Load mart', error: 'Violation of PRIMARY KEY constraint' }]);
  assert.ok(st.outputs.Failed, 'the failed branch ran');
  const rerun = await run(node('adfRun', 'Rerun', { connection: c.id, pipeline: 'CopySalesToLake', mode: 'rerun from the failed activity', referenceRunId: st.outputs['Build mart'].runId, wait: false }));
  assert.equal(rerun.status, 'done', rerun.error);
  assert.deepEqual(runs.get(rerun.out.runId)!.query, { 'api-version': '2018-06-01', referencePipelineRunId: st.outputs['Build mart'].runId, isRecovery: 'true', startFromFailure: 'true' });
});

test('a run still going at the wait limit is cancelled and the step says where to look', async () => {
  const c = adfConn();
  const r = await run(node('adfRun', 'Long', { connection: c.id, pipeline: 'Forever', wait: true, waitMinutes: 0.03, cancelOnLimit: true }));
  assert.equal(r.status, 'failed');
  assert.match(r.error, /still InProgress after .* minutes; it was cancelled\. Monitor it: https:\/\/adf\.azure\.com/);
  assert.equal([...runs.values()].find(x => x.pipeline === 'Forever')!.outcome, 'Cancelled');
});

test('ADF pipeline run: recent runs, list pipelines, start a trigger; a missing pipeline name warns in the designer', async () => {
  const c = adfConn();
  const recent = await run(node('adfMonitor', 'Recent', { connection: c.id, op: 'recent runs', pipeline: 'BuildMart', status: 'Failed', hours: 24 }));
  assert.equal(recent.status, 'done', recent.error);
  const q1 = seen.filter(s => s.url.includes('/queryPipelineRuns')).pop()!.body;
  assert.deepEqual(q1.filters, [{ operand: 'PipelineName', operator: 'Equals', values: ['BuildMart'] }, { operand: 'Status', operator: 'Equals', values: ['Failed'] }]);
  const pl = await run(node('adfMonitor', 'Pipelines', { connection: c.id, op: 'list pipelines' }));
  assert.deepEqual(pl.out.pipelines[0], { name: 'CopySalesToLake', parameters: { runDate: 'String' }, folder: '' });
  const tr = await run(node('adfMonitor', 'Trigger', { connection: c.id, op: 'start trigger', trigger: 'Nightly' }));
  assert.equal(tr.out.status, 'Started');
  const s = node('start', 'Start'), a = node('adfRun', 'Run it', { pipeline: '' });
  const v = validateDoc({ name: 'X', nodes: [s, a], edges: [edge(s, a)] }, pid);
  assert.ok(v.warnings.includes('Run it: Choose the data factory connection'));
  assert.ok(v.warnings.includes('Run it: Give the pipeline name'));
});

test('Databricks: Test connection, a notebook with parameters and its exit value, and a failing one', async () => {
  const c = dbxConn();
  const t = await testResource({ id: c.id, kind: c.kind, project_id: pid, config: c.config });
  assert.equal(t.ok, true, t.message);
  assert.match(t.message, /as etl@example\.com; cluster etl-small is TERMINATED; SQL warehouse Starter warehouse is RUNNING/);
  const ok = await run(node('databricksRun', 'Daily totals', { connection: c.id, what: 'notebook', notebookPath: '/Workspace/Shared/sales/daily_totals', notebookParams: [{ k: 'run_date', v: '{{input.date}}' }], compute: 'existing cluster', wait: true, waitMinutes: 2 }));
  assert.equal(ok.status, 'done', ok.error);
  assert.equal(ok.out.state, 'SUCCESS');
  assert.deepEqual(ok.out.result, { rows: 1200, status: 'ok' });
  const sub = seen.filter(s => s.url === '/api/2.1/jobs/runs/submit').pop()!.body;
  assert.deepEqual(sub.tasks[0], { task_key: 'notebook', notebook_task: { notebook_path: '/Workspace/Shared/sales/daily_totals', base_parameters: { run_date: '2026-10-18' }, source: 'WORKSPACE' }, existing_cluster_id: 'cl-1' });
  const s = node('start', 'Start'), b = node('databricksRun', 'Broken', { connection: c.id, notebookPath: '/Workspace/broken', wait: true, waitMinutes: 2 }), l = node('log', 'Why', { message: '{{input.error}}' });
  const id = engine.startRun({ doc: { name: 'T', nodes: [s, b, l], edges: [edge(s, b), edge(b, l, 'failed')] }, projectId: pid, source: 'test' });
  await engine.waitFor(id, 60000);
  const st = JSON.parse((q.get<any>('select state from runs where id = ?', id)).state);
  assert.equal(st.outputs.Broken.error, 'ZeroDivisionError: division by zero');
  const job = await run(node('databricksRun', 'Job', { connection: c.id, what: 'job', jobId: '123', jobParams: [{ k: 'env', v: 'prod' }], wait: false }));
  assert.equal(job.status, 'done', job.error);
  assert.deepEqual(seen.filter(s => s.url === '/api/2.1/jobs/run-now').pop()!.body, { job_id: 123, job_parameters: { env: 'prod' } });
});

test('Databricks code block starts the stopped cluster, passes parameters as data, and reports a Python error', async () => {
  const c = dbxConn();
  dbxCluster = 'TERMINATED';
  const r = await run(node('databricksCommand', 'Count', { connection: c.id, language: 'python', code: 'print(len(sutra_params["zip"]))', params: [{ k: 'zip', v: '{{input.zip}}"); import os; os.system("x' }], startCluster: true, waitMinutes: 2 }));
  assert.equal(r.status, 'done', r.error);
  assert.equal(r.out.text, '7');
  const cmd = seen.filter(s => s.url === '/api/1.2/commands/execute').pop()!.body.command as string;
  assert.ok(!cmd.includes('os.system'), 'the parameter value is not in the code');
  assert.match(cmd, /sutra_params = _sutra_json\.loads\(_sutra_b64\.b64decode\("[A-Za-z0-9+/=]+"\)/);
  assert.ok(seen.some(s => s.url === '/api/2.0/clusters/start'));
  const t = await run(node('databricksCommand', 'Table', { connection: c.id, language: 'sql', code: 'SELECT zip, count(*) trips FROM t GROUP BY zip' }));
  assert.deepEqual(t.out.rows, [{ zip: '10001', trips: 42 }]);
  const bad = await run(node('databricksCommand', 'Bad', { connection: c.id, language: 'python', code: 'raise ValueError("bad input")' }));
  assert.equal(bad.status, 'failed');
  assert.match(bad.error, /The code failed: ValueError: bad input/);
});

test('Databricks SQL sends named parameters, waits, and reads every chunk', async () => {
  const c = dbxConn();
  const r = await run(node('databricksSql', 'Trips', { connection: c.id, statement: 'SELECT pickup_zip, count(*) AS trips FROM samples.nyctaxi.trips WHERE pickup_zip = :zip GROUP BY 1', params: [{ k: 'zip', v: '{{input.zip}}' }], maxRows: 100 }));
  assert.equal(r.status, 'done', r.error);
  assert.deepEqual(r.out.rows, [{ pickup_zip: '10001', trips: '42' }, { pickup_zip: '10002', trips: '7' }]);
  const sent = seen.filter(s => s.url === '/api/2.0/sql/statements' && s.method === 'POST').pop()!.body;
  assert.deepEqual(sent.parameters, [{ name: 'zip', value: '10001', type: 'STRING' }]);
  assert.equal(sent.warehouse_id, 'wh-1');
});
