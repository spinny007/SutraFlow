import { useEffect, useState, useSyncExternalStore } from 'react';
import { api } from '../src/api';
import { useToast } from '../src/ui';

/**
 * Every action taken in the console goes through act(): it is recorded with its output for the
 * Console panel, and with the same action as a sutra command and as an HTTP call, for Windows
 * PowerShell and Linux shells, so it can be run outside the console too.
 */

export interface Action {
  /** Words for the log: "Stop Order lookup API". */
  label: string;
  method: 'POST' | 'PUT' | 'DELETE';
  url: string;
  body?: Record<string, unknown>;
  /** The same action as sutra command arguments; absent when there is no command for it. */
  cli?: string[];
}
export interface Entry extends Action { id: number; at: Date; ms: number; status: 'ok' | 'failed'; code: number; output: unknown }

let entries: Entry[] = [];
let seq = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach(f => f());
export const useEntries = () => useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f); }, () => entries);
export const clearEntries = () => { entries = []; emit(); };

/** Runs an action through the admin API and records it. Throws on failure, like api(). */
export async function act<T = any>(a: Action): Promise<T> {
  const t0 = performance.now();
  const id = ++seq;
  try {
    const out = await api<T>(a.method, a.url, a.body ?? (a.method === 'DELETE' ? undefined : {}));
    entries = [{ ...a, body: safeBody(a.body), id, at: new Date(), ms: Math.round(performance.now() - t0), status: 'ok' as const, code: 200, output: hideTokens(out) }, ...entries].slice(0, 200);
    emit();
    return out;
  } catch (e: any) {
    entries = [{ ...a, body: safeBody(a.body), id, at: new Date(), ms: Math.round(performance.now() - t0), status: 'failed' as const, code: e.status || 0, output: { error: e.message } }, ...entries].slice(0, 200);
    emit();
    throw e;
  }
}

// ---------- the same action as a command ----------

const SAFE = /^[\w@%+=:,./-]+$/;
const qBash = (s: string) => (SAFE.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
const qPs = (s: string) => (SAFE.test(s) && !s.startsWith('@') ? s : `'${s.replace(/'/g, "''")}'`);

/** A new API token is shown once where it was made, never kept in the log. */
function hideTokens(out: unknown) {
  return out && typeof out === 'object' && typeof (out as any).token === 'string' ? { ...(out as any), token: 'sut_... (shown once where it was created)' } : out;
}

/** Passwords never appear in a command; the person types their own. */
function safeBody(body?: Record<string, unknown>) {
  if (!body) return undefined;
  const b: Record<string, unknown> = { ...body };
  if ('password' in b) b.password = '<new password>';
  return b;
}

export function commands(a: Action) {
  const body = safeBody(a.body);
  const json = body && Object.keys(body).length ? JSON.stringify(body) : '';
  const verb = a.method[0] + a.method.slice(1).toLowerCase();
  return {
    powershell: {
      setup: `$env:SUTRA_SERVER = '${location.origin}'\n$env:SUTRA_ADMIN_TOKEN = '<API token of a system account>'`,
      cli: a.cli ? `sutra ${a.cli.map(qPs).join(' ')}` : '',
      api: `Invoke-RestMethod -Method ${verb} -Uri "$env:SUTRA_SERVER${a.url}" -Headers @{ Authorization = "Bearer $env:SUTRA_ADMIN_TOKEN" }${json ? ` -ContentType 'application/json' -Body '${json.replace(/'/g, "''")}'` : ''}`,
    },
    bash: {
      setup: `export SUTRA_SERVER='${location.origin}'\nexport SUTRA_ADMIN_TOKEN='<API token of a system account>'`,
      cli: a.cli ? `sutra ${a.cli.map(qBash).join(' ')}` : '',
      api: `curl -sS -X ${a.method} "$SUTRA_SERVER${a.url}" -H "Authorization: Bearer $SUTRA_ADMIN_TOKEN"${json ? ` -H 'Content-Type: application/json' -d '${json.replace(/'/g, `'\\''`)}'` : ''}`,
    },
  };
}

function CopyBlock({ label, text }: { label: string; text: string }) {
  const toast = useToast();
  const copy = async () => { try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Select the text and copy it', true); } };
  return (
    <div className="c-cmd">
      <div className="c-cmdhead"><span className="muted xs">{label}</span><button type="button" className="btn small" onClick={copy}>Copy</button></div>
      <pre className="c-code" tabIndex={0}>{text}</pre>
    </div>
  );
}

let lastShell: 'powershell' | 'bash' = (() => { try { return (localStorage.getItem('sutra.shell') as any) || (navigator.userAgent.includes('Windows') ? 'powershell' : 'bash'); } catch { return 'bash'; } })();

/** The action as commands for Windows PowerShell and Linux shells. */
export function CommandBox({ action }: { action: Action }) {
  const [shell, setShell] = useState(lastShell);
  useEffect(() => { lastShell = shell; try { localStorage.setItem('sutra.shell', shell); } catch { /* ignore */ } }, [shell]);
  const c = commands(action)[shell];
  return (
    <div className="c-cmdbox">
      <div className="c-tabs small" role="tablist" aria-label="Shell">
        <button type="button" role="tab" aria-selected={shell === 'powershell'} className={shell === 'powershell' ? 'act' : ''} onClick={() => setShell('powershell')}>Windows PowerShell</button>
        <button type="button" role="tab" aria-selected={shell === 'bash'} className={shell === 'bash' ? 'act' : ''} onClick={() => setShell('bash')}>Linux and macOS</button>
      </div>
      <CopyBlock label="Once per shell: where the server is and the token to use" text={c.setup} />
      {c.cli && <CopyBlock label="sutra command (installed with SutraFlow; npx sutra in its folder)" text={c.cli} />}
      <CopyBlock label="Or the HTTP API" text={c.api} />
    </div>
  );
}

/** The Console panel: what was done in this browser tab, its output, and its commands. */
export function ConsolePanel({ onClose }: { onClose(): void }) {
  const list = useEntries();
  const [open, setOpen] = useState<number | null>(list[0]?.id ?? null);
  useEffect(() => { if (list[0]) setOpen(list[0].id); }, [list[0]?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="c-console" aria-label="Console">
      <div className="c-consolehead">
        <strong>Console</strong>
        <span className="muted xs">Actions taken in this tab, their output, and the same action as a command.</span>
        <span className="c-actions" style={{ marginLeft: 'auto' }}>
          {!!list.length && <button className="btn small" onClick={clearEntries}>Clear</button>}
          <button className="btn small" onClick={onClose}>Hide</button>
        </span>
      </div>
      <div className="c-consolebody">
        {!list.length && <p className="muted c-consoleempty">Nothing yet. Stop, start or restart a Sutra, resubmit a run, or change a setting: each action appears here with its output and commands.</p>}
        {list.map(e => (
          <article key={e.id} className={`c-entry ${e.status}`}>
            <button className="c-entryhead" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>
              <span className="mono xs muted">{e.at.toLocaleTimeString()}</span>
              <span className={`c-state ${e.status === 'ok' ? 'ok' : 'err'}`}>{e.status === 'ok' ? 'done' : `failed${e.code ? ' ' + e.code : ''}`}</span>
              <strong>{e.label}</strong>
              <span className="mono xs muted c-entryurl">{e.method} {e.url}</span>
              <span className="mono xs muted">{e.ms} ms</span>
            </button>
            {open === e.id && (
              <div className="c-entrybody">
                <div className="c-cmd"><div className="c-cmdhead"><span className="muted xs">Output</span></div><pre className="c-code">{JSON.stringify(e.output, null, 2)?.slice(0, 20000) ?? 'null'}</pre></div>
                <CommandBox action={e} />
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
