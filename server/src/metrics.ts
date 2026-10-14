/**
 * Prometheus metrics, kept in memory per engine and served at GET /metrics (text format 0.0.4).
 * Counters and histograms are cumulative since the engine started; gauges are read when scraped.
 * In a cluster, scrape every engine: each reports its own share, labelled by engine.
 */
type Labels = Record<string, string>;
const key = (l: Labels) => JSON.stringify(Object.keys(l).sort().map(k => [k, l[k]]));
const fmt = (l: Labels) => { const e = Object.entries(l).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)); return e.length ? `{${e.map(([k, v]) => `${k}="${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`).join(',')}}` : ''; };

class Counter {
  readonly values = new Map<string, { labels: Labels; v: number }>();
  constructor(readonly name: string, readonly help: string) { all.push(this); }
  inc(labels: Labels = {}, by = 1) { const k = key(labels); const c = this.values.get(k); if (c) c.v += by; else this.values.set(k, { labels, v: by }); }
  get(labels: Labels = {}) { return this.values.get(key(labels))?.v ?? 0; }
  text() { return [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`, ...[...this.values.values()].map(c => `${this.name}${fmt(c.labels)} ${c.v}`)]; }
}

class Histogram {
  readonly values = new Map<string, { labels: Labels; buckets: number[]; sum: number; count: number }>();
  constructor(readonly name: string, readonly help: string, readonly bounds: number[]) { all.push(this); }
  observe(labels: Labels, v: number) {
    const k = key(labels);
    let h = this.values.get(k);
    if (!h) { h = { labels, buckets: this.bounds.map(() => 0), sum: 0, count: 0 }; this.values.set(k, h); }
    this.bounds.forEach((b, i) => { if (v <= b) h!.buckets[i]++; });
    h.sum += v; h.count++;
  }
  text() {
    const out = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const h of this.values.values()) {
      this.bounds.forEach((b, i) => out.push(`${this.name}_bucket${fmt({ ...h.labels, le: String(b) })} ${h.buckets[i]}`));
      out.push(`${this.name}_bucket${fmt({ ...h.labels, le: '+Inf' })} ${h.count}`, `${this.name}_sum${fmt(h.labels)} ${h.sum}`, `${this.name}_count${fmt(h.labels)} ${h.count}`);
    }
    return out;
  }
}

const all: (Counter | Histogram)[] = [];
const SECONDS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 300];

export const metrics = {
  runsStarted: new Counter('sutra_runs_started_total', 'Runs started, by Sutra and source (test, rest, soap, mcp, timer...).'),
  runsFinished: new Counter('sutra_runs_finished_total', 'Runs ended, by Sutra and status (done, failed, cancelled).'),
  runSeconds: new Histogram('sutra_run_duration_seconds', 'Time from start to end of runs, by Sutra and status.', SECONDS),
  steps: new Counter('sutra_steps_total', 'Steps finished, by activity type and outcome (done, error = handled by an error output, failed).'),
  stepSeconds: new Histogram('sutra_step_duration_seconds', 'Time steps took, by activity type.', SECONDS),
  retries: new Counter('sutra_step_retries_total', 'Steps run again after a failure, by activity type.'),
  gatewayRequests: new Counter('sutra_gateway_requests_total', 'Requests to deployed services, by kind (rest, soap, mcp) and HTTP status.'),
  gatewaySeconds: new Histogram('sutra_gateway_request_duration_seconds', 'Time to answer requests to deployed services, by kind.', SECONDS),
};

/** Values read at scrape time (queue depth, engines, listeners), added by the caller. */
export type Gauge = { name: string; help: string; values: { labels?: Labels; v: number }[] };

export function prometheusText(gauges: Gauge[]) {
  const lines: string[] = [];
  for (const g of gauges) {
    lines.push(`# HELP ${g.name} ${g.help}`, `# TYPE ${g.name} gauge`);
    for (const v of g.values) lines.push(`${g.name}${fmt(v.labels || {})} ${v.v}`);
  }
  for (const m of all) lines.push(...m.text());
  return lines.join('\n') + '\n';
}
