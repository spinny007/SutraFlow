/**
 * Circuit breaker per HTTP connection: after N failures in a row (errors or 5xx), calls fail at once
 * for a while instead of waiting on a service that is down; then one trial call decides.
 */
interface State { failures: number; openUntil: number; trial: boolean }
const states = new Map<string, State>();

export interface BreakerConn { id: string; name?: string; config: Record<string, any> }

export async function guarded<T>(conn: BreakerConn | undefined, call: () => Promise<T>, failed: (r: T) => boolean = () => false): Promise<T> {
  const limit = Number(conn?.config.breakerFailures) || 0;
  if (!conn || limit <= 0) return call();
  const st = states.get(conn.id) || { failures: 0, openUntil: 0, trial: false };
  states.set(conn.id, st);
  const t = Date.now();
  if (st.openUntil > t || (st.openUntil && st.trial)) {
    throw new Error(`Circuit open for ${conn.name || 'this connection'}: ${st.failures} failures in a row. Calls resume ${st.openUntil > t ? `in ${Math.ceil((st.openUntil - t) / 1000)} s` : 'after the trial call'}.`);
  }
  if (st.openUntil) st.trial = true; // half-open: this call is the trial
  const done = (ok: boolean) => {
    st.trial = false;
    if (ok) { st.failures = 0; st.openUntil = 0; return; }
    st.failures++;
    if (st.failures >= limit) st.openUntil = Date.now() + Math.max(1, Number(conn.config.breakerOpenSeconds) || 30) * 1000;
  };
  try {
    const r = await call();
    done(!failed(r));
    return r;
  } catch (e) {
    done(false);
    throw e;
  }
}

export function breakerStatus(id: string) {
  const st = states.get(id);
  return st ? { failures: st.failures, open: st.openUntil > Date.now(), openUntil: st.openUntil ? new Date(st.openUntil).toISOString() : null } : null;
}
