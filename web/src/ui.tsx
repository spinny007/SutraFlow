import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { get, post } from './api';
import type { Meta, Project, Resource, SchemaInfo } from './types';

// ---------- toasts ----------
type Toast = { id: number; text: string; err?: boolean };
const ToastCtx = createContext<(text: string, err?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((text: string, err = false) => {
    const id = Math.random();
    setList(l => [...l, { id, text, err }]);
    setTimeout(() => setList(l => l.filter(t => t.id !== id)), err ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {list.map(t => <div key={t.id} className={`toast${t.err ? ' err' : ''}`}>{t.text}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------- catalog: current project, its resources, schemas; secrets ----------
interface Catalog {
  meta: Meta;
  projects: Project[];
  projectId: string;
  project: Project | undefined;
  setProjectId(id: string): void;
  resources: Resource[];
  schemas: SchemaInfo[];
  secrets: { name: string; updated_at: string }[];
  reload(): Promise<void>;
}
const CatalogCtx = createContext<Catalog | null>(null);
export const useCatalog = () => useContext(CatalogCtx)!;

export function CatalogHost({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setPid] = useState<string>(() => { try { return localStorage.getItem('sutra.project') || ''; } catch { return ''; } });
  const [resources, setResources] = useState<Resource[]>([]);
  const [schemas, setSchemas] = useState<SchemaInfo[]>([]);
  const [secrets, setSecrets] = useState<Catalog['secrets']>([]);
  const [error, setError] = useState('');
  const setProjectId = useCallback((id: string) => {
    setPid(id);
    try { localStorage.setItem('sutra.project', id); } catch { /* ignore */ }
  }, []);
  const reload = useCallback(async () => {
    let ps = await get<Project[]>('/api/projects');
    if (!ps.length) {
      // StrictMode runs this twice on first start; the second create may find the name taken.
      await post('/api/projects', { name: 'My project' }).catch(() => {});
      ps = await get<Project[]>('/api/projects');
    }
    setProjects(ps);
    const pid = ps.some(p => p.id === projectId) ? projectId : ps[0].id;
    if (pid !== projectId) setProjectId(pid);
    const [r, sc, s] = await Promise.all([
      get<Resource[]>(`/api/resources?projectId=${encodeURIComponent(pid)}`),
      get<SchemaInfo[]>(`/api/schemas?projectId=${encodeURIComponent(pid)}`),
      get('/api/secrets'),
    ]);
    setResources(r); setSchemas(sc); setSecrets(s);
  }, [projectId, setProjectId]);
  useEffect(() => { get<Meta>('/api/meta').then(setMeta).catch(e => setError(e.message)); }, []);
  useEffect(() => { reload().catch(e => setError(e.message)); }, [reload]);
  if (error) return <div className="auth"><div className="errbox">{error}</div></div>;
  if (!meta || !projects.length) return <div className="auth muted">Loading the studio</div>;
  return (
    <CatalogCtx.Provider value={{ meta, projects, projectId, project: projects.find(p => p.id === projectId), setProjectId, resources, schemas, secrets, reload }}>
      {children}
    </CatalogCtx.Provider>
  );
}

export const famOf = (meta: Meta, palette: string) => `fam-${meta.palettes.find(p => p.id === palette)?.color || 'general'}`;

// ---------- small components ----------
export function Modal({ title, children, onClose, actions }: { title: string; children: ReactNode; onClose(): void; actions?: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
        <div className="acts">{actions ?? <button className="btn" onClick={onClose}>Close</button>}</div>
      </div>
    </div>
  );
}

export function Json({ value }: { value: unknown }) {
  let s = JSON.stringify(value === undefined ? null : value, null, 2) ?? 'null';
  if (s.length > 40000) s = s.slice(0, 40000) + '\n…';
  return <pre className="json">{s}</pre>;
}

export const fmtTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : '');
export const since = (a?: string | null, b?: string | null) => {
  if (!a) return '';
  const ms = (b ? Date.parse(b) : Date.now()) - Date.parse(a);
  return ms < 1000 ? `${ms} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 60000)} min`;
};
