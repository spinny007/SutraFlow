import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { get } from '../src/api';
import { Modal } from '../src/ui';

/** Who is signed in and what they may do (from /api/access/me). */
export interface Me {
  username: string; kind: string; displayName: string;
  permissions: { all: string[]; projects: Record<string, string[]> };
}
export interface Status { version: string; mode: 'studio' | 'engine' }

export const MeCtx = createContext<{ me: Me; status: Status } | null>(null);
export const useMe = () => useContext(MeCtx)!;

/** Permission check for the UI; the server checks again on every call. project undefined = any project. */
export function can(me: Me, perm: string, project?: string) {
  if (me.permissions.all.includes(perm)) return true;
  if (project === undefined) return Object.values(me.permissions.projects).some(p => p.includes(perm));
  return !!me.permissions.projects[project]?.includes(perm);
}

/** Loads data and reloads on demand; error is shown by the page. */
export function useLoad<T>(url: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const reload = useCallback(async () => {
    if (!url) return;
    setLoading(true);
    try { setData(await get<T>(url)); setError(''); } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, [url]);
  useEffect(() => { reload(); }, [reload, ...deps]);
  return { data, error, loading, reload, setData };
}

/** Refreshes every few seconds while the page is visible. */
export function useEvery(fn: () => void, ms: number) {
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') fn(); }, ms);
    return () => clearInterval(t);
  }, [fn, ms]);
}

export function PageHead({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="c-pagehead">
      <div><h1>{title}</h1>{sub && <p className="muted">{sub}</p>}</div>
      <div className="c-actions">{children}</div>
    </div>
  );
}

export const State = ({ kind, children }: { kind: 'ok' | 'err' | 'warn' | 'idle' | 'busy'; children: ReactNode }) =>
  <span className={`c-state ${kind}`}>{children}</span>;

export function runState(s: string) {
  const k = s === 'done' ? 'ok' : s === 'failed' ? 'err' : s === 'running' || s === 'waiting' ? 'busy' : s === 'paused' ? 'warn' : 'idle';
  return <State kind={k}>{s}</State>;
}

export const Err = ({ text }: { text: string }) => (text ? <div className="errbox" role="alert">{text}</div> : null);

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="c-empty"><strong>{title}</strong>{children && <p className="muted">{children}</p>}</div>;
}

/** A confirmation step inside the page (the browser's confirm dialog is not used). */
export function Confirm({ title, text, action, danger, onYes, onClose }: { title: string; text: ReactNode; action: string; danger?: boolean; onYes(): Promise<void> | void; onClose(): void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <Modal title={title} onClose={onClose} actions={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className={`btn ${danger ? 'c-danger' : 'primary'}`} disabled={busy} onClick={async () => { setBusy(true); setErr(''); try { await onYes(); onClose(); } catch (e: any) { setErr(e.message); setBusy(false); } }}>{action}</button>
    </>}>
      <Err text={err} />
      <div className="c-confirm">{text}</div>
    </Modal>
  );
}

export const ago = (iso?: string | null) => {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.round(s)} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};
export const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : '');

/** A strong random password for "Generate". */
export function newPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_!';
  const b = crypto.getRandomValues(new Uint8Array(18));
  return 'Sf-' + [...b].map(x => chars[x % chars.length]).join('') + '7';
}
