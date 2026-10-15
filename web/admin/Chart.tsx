/** Stacked bars over time, drawn to one scale, coloured from the theme tokens. */
export interface Series { k: string; label: string; cls: 'ok' | 'warn' | 'err' | 'idle' }

export function StackChart({ data, series, bucketMs, label }: { data: Record<string, any>[]; series: Series[]; bucketMs: number; label: string }) {
  const W = 960, H = 180, L = 40, B = 24, T = 8;
  const total = (d: Record<string, any>) => series.reduce((a, s) => a + (Number(d[s.k]) || 0), 0);
  const max = Math.max(1, ...data.map(total));
  const nice = (() => { const p = 10 ** Math.floor(Math.log10(max)); const m = max / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; })();
  const y = (v: number) => T + (H - T - B) * (1 - v / nice);
  const bw = (W - L - 8) / Math.max(1, data.length);
  const every = Math.max(1, Math.ceil(data.length / 8));
  const tick = (iso: string) => { const d = new Date(iso); return bucketMs >= 86400e3 ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); };
  const sum = data.reduce((a, d) => a + total(d), 0);
  return (
    <div className="c-chartwrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="c-chart" role="img" aria-label={`${label}: ${sum} in total`}>
        {(Number.isInteger(nice / 2) ? [0, nice / 2, nice] : [0, nice]).map(t => <g key={t}><line x1={L} x2={W - 4} y1={y(t)} y2={y(t)} className="c-grid" /><text x={L - 6} y={y(t) + 4} className="c-axis" textAnchor="end">{t >= 1000 ? `${t / 1000}k` : t}</text></g>)}
        {data.map((d, i) => {
          const x = L + 2 + i * bw, w = Math.max(1, bw - 2);
          let acc = 0;
          return (
            <g key={d.at}>
              <title>{`${new Date(d.at).toLocaleString()}: ${series.map(s => `${Number(d[s.k]) || 0} ${s.label}`).join(', ')}`}</title>
              {series.map(s => {
                const v = Number(d[s.k]) || 0;
                if (!v) return null;
                const r = <rect key={s.k} x={x} width={w} y={y(acc + v)} height={y(acc) - y(acc + v)} className={`c-bar ${s.cls}`} />;
                acc += v;
                return r;
              })}
              {i % every === 0 && <text x={x + w / 2} y={H - 7} className="c-axis" textAnchor="middle">{tick(d.at)}</text>}
            </g>
          );
        })}
      </svg>
      <div className="c-legend">{series.map(s => <span key={s.k}><i className={s.cls} />{s.label}</span>)}</div>
    </div>
  );
}
