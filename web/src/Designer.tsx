/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { GitPanel } from './Git';
import { missingInNode, missingText } from './vars';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Handle, Position, useReactFlow, useUpdateNodeInternals,
  type Connection, type Edge, type EdgeChange, type Node, type NodeChange, type NodeProps,
} from '@xyflow/react';
import { del, get, post, put } from './api';
import { famOf, Modal, useCatalog, useToast } from './ui';
import { ACTIVE, portsOf, type ActivityMeta, type FlowDoc, type FlowNode, type FlowSummary, type Meta, type NodeDesign, type Project, type Resource, type RunDetail } from './types';
import { TEMPLATES } from './templates';
import { Inspector, type InspectorTab } from './Inspector';
import { ExplorerEditor, ProjectExplorer, type ExplorerSel } from './Project';
import { ChoiceList, sampleChoices } from './NewProject';
import { ConfirmDelete } from './ConfirmDelete';

const ACT_MIME = 'application/x-sutra-activity';
const uid = () => Math.random().toString(36).slice(2, 9);

type NodeData = { n: FlowNode; status?: string; count?: number; bp?: boolean; designErrors?: string[]; designWarnings?: string[] };
type ANode = Node<NodeData, 'activity'>;

const MetaCtx = createContext<Meta | null>(null);
/** Project and connections, for the missing-variable mark on each activity. */
const VarsCtx = createContext<{ project: Project | null | undefined; resources: Resource[] }>({ project: null, resources: [] });

/** Input port sits beside the title; output ports are listed below the type line so labels never overlap text. */
const IN_Y = 28, PORT_Y0 = 70, PORT_GAP = 24;

const ActivityNode = memo(function ActivityNode({ data, selected }: NodeProps<ANode>) {
  const meta = useContext(MetaCtx)!;
  const vars = useContext(VarsCtx);
  const miss = missingInNode(data.n, vars.project, vars.resources);
  const a = meta.activities.find(x => x.type === data.n.type);
  const ports = portsOf(a, data.n.config);
  const fam = a ? famOf(meta, a.palette) : 'fam-general';
  const height = ports.length ? PORT_Y0 + 18 + (ports.length - 1) * PORT_GAP : 62;
  return (
    <div className={`anode ${fam}${selected ? ' selected' : ''}${data.status ? ' st-' + data.status : ''}${data.n.settings?.disabled ? ' disabled' : ''}`} style={{ height }} title={data.n.description || undefined}>
      {data.bp && <span className="bp" title="Breakpoint" />}
      <div className="head"><span className="glyph">{a?.glyph ?? '?'}</span><span className="nm">{data.n.name}</span>{data.n.description && <span className="dmark" aria-label="Has a description">≡</span>}{data.designErrors?.length ? <span className="verror" title={data.designErrors.join('\n')} aria-label="Activity errors">●</span> : null}{data.designWarnings?.length ? <span className="vwarn" title={data.designWarnings.join('\n')} aria-label="Activity warnings">⚠</span> : null}{miss.length > 0 && <span className="vwarn" title={missingText(miss)} aria-label="Missing project variables">⚠</span>}<span className="dot" /></div>
      <div className="ty">{a?.name ?? data.n.type}{data.count && data.count > 1 ? ` ×${data.count}` : ''}{data.n.settings?.loop ? <span className="loopmark" title={data.n.settings.loop === 'for each item' ? 'Runs once per item' : 'Repeats while a condition holds'}> ↻</span> : null}</div>
      {ports.length > 0 && <span className="ports-sep" />}
      {a && !a.trigger && !a.noInput && <Handle type="target" position={Position.Left} id="in" style={{ top: IN_Y }} />}
      {ports.map((p, i) => (
        <div key={p}>
          <Handle type="source" position={Position.Right} id={p} className={p === 'error' ? 'err' : ''} style={{ top: PORT_Y0 + i * PORT_GAP }} />
          {(ports.length > 1 || p !== 'out') && <span className={`plabel${p === 'error' ? ' err' : ''}`} style={{ top: PORT_Y0 + i * PORT_GAP }}>{p}</span>}
        </div>
      ))}
    </div>
  );
});
const nodeTypes = { activity: ActivityNode };

function Palette({ meta, onAdd }: { meta: Meta; onAdd(type: string): void }) {
  const [q, setQ] = useState('');
  const ql = q.trim().toLowerCase();
  return (
    <div aria-label="Palettes">
      <input className="search" placeholder="Search activities" aria-label="Search activities" value={q} onChange={e => setQ(e.target.value)} />
      {meta.palettes.map(p => {
        const items = meta.activities.filter(a => a.palette === p.id && (!ql || (a.name + ' ' + a.desc).toLowerCase().includes(ql)));
        if (!items.length) return null;
        return (
          <div className={`pal-sec fam-${p.color}`} key={p.id}>
            <h3><i />{p.name}</h3>
            {items.map(a => (
              <button key={a.type} className={`pitem fam-${p.color}`} title={a.desc} draggable
                onDragStart={e => { e.dataTransfer.setData(ACT_MIME, a.type); e.dataTransfer.effectAllowed = 'move'; }}
                onClick={() => onAdd(a.type)}>
                <span className="glyph">{a.glyph}</span><span>{a.name}</span>
                {a.trigger && <span className="starter-mark" title="Starts a Sutra" aria-label="Starts a Sutra">▶</span>}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** Rewrites {{nodes.Old name...}} references after a rename. */
function renameRefs(v: any, oldName: string, newName: string): any {
  const re = new RegExp('nodes\\.' + oldName.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '(?=[.}\\s\\[|])', 'g');
  const walk = (x: any): any => typeof x === 'string' ? x.replace(re, 'nodes.' + newName)
    : Array.isArray(x) ? x.map(walk) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, y]) => [k, walk(y)])) : x;
  return walk(v);
}

export function uniqueName(doc: FlowDoc, base: string, except?: string) {
  const clean = base.replace(/[.[\]{}|]/g, '').trim() || 'Step';
  let name = clean, i = 2;
  while (doc.nodes.some(n => n.name === name && n.id !== except)) name = `${clean} ${i++}`;
  return name;
}

function DesignerInner() {
  const { meta, projectId, project, resources } = useCatalog();
  const toast = useToast();
  const rf = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const [flows, setFlows] = useState<FlowSummary[]>([]);
  const [flowId, setFlowId] = useState<string | null>(() => { try { return localStorage.getItem('sutra.flow'); } catch { return null; } });
  const [doc, setDoc] = useState<FlowDoc | null>(null);
  const [sel, setSel] = useState<{ kind: 'node' | 'edge'; id: string } | null>(null);
  const [run, setRun] = useState<RunDetail | null>(null);
  const [sample, setSample] = useState<{ outputs: Record<string, any>; vars?: Record<string, any> }>({ outputs: {} });
  const [dialog, setDialog] = useState<null | 'new' | 'deploy' | 'delete'>(null);
  const [newName, setNewName] = useState('');
  const [leftTab, setLeftTab] = useState<'project' | 'palette' | 'git'>(() => { try { return (localStorage.getItem('sutra.left') as any) || 'palette'; } catch { return 'palette'; } });
  const [explorerSel, setExplorerSel] = useState<ExplorerSel | null>(null);
  const [tab, setTab] = useState<InspectorTab>('general');
  const [design, setDesign] = useState<Record<string, NodeDesign>>({});
  const [breakpoints, setBreakpoints] = useState<string[]>([]);
  const [saving, setSaving] = useState<'saved' | 'saving' | 'dirty'>('saved');
  const saveTimer = useRef<number>(0);
  const actOf = useCallback((type: string) => meta.activities.find(a => a.type === type), [meta]);

  const refreshFlows = useCallback(() => get<FlowSummary[]>(`/api/flows?projectId=${encodeURIComponent(projectId)}`).then(setFlows), [projectId]);
  useEffect(() => { refreshFlows().catch(e => toast(e.message, true)); }, [refreshFlows, toast]);
  useEffect(() => {
    if (!flows.length) { setFlowId(null); return; }
    if (!flowId || !flows.some(f => f.id === flowId)) setFlowId(flows[0].id);
  }, [flows, flowId]);
  useEffect(() => { try { localStorage.setItem('sutra.left', leftTab); } catch { /* ignore */ } }, [leftTab]);

  // Breakpoints are kept per process in this browser.
  useEffect(() => {
    if (!flowId) return;
    try { setBreakpoints(JSON.parse(localStorage.getItem(`sutra.bp.${flowId}`) || '[]')); } catch { setBreakpoints([]); }
  }, [flowId]);
  const toggleBreakpoint = useCallback((id: string) => setBreakpoints(b => {
    const next = b.includes(id) ? b.filter(x => x !== id) : [...b, id];
    try { localStorage.setItem(`sutra.bp.${flowId}`, JSON.stringify(next)); } catch { /* ignore */ }
    if (run?.debug && ACTIVE.includes(run.status)) post(`/api/runs/${run.id}/debug`, { action: 'breakpoints', breakpoints: next }).catch(() => {});
    return next;
  }), [flowId, run]);

  // Load the selected flow.
  useEffect(() => {
    if (!flowId) { setDoc(null); return; }
    try { localStorage.setItem('sutra.flow', flowId); } catch { /* ignore */ }
    let off = false;
    get(`/api/flows/${flowId}`).then(f => {
      if (off) return;
      setDoc(f.doc); setSel(null); setRun(null); setSaving('saved');
      hist.current = { past: [], future: [], at: 0 }; setHistTick(t => t + 1);
      requestAnimationFrame(() => rf.fitView({ padding: 0.2, maxZoom: 1.1 }));
    }).catch(e => toast(e.message, true));
    get(`/api/flows/${flowId}/sample`).then(s => !off && setSample(s)).catch(() => {});
    return () => { off = true; };
  }, [flowId, rf, toast]);

  const saveNow = useCallback(async (d: FlowDoc) => {
    if (!flowId) return;
    window.clearTimeout(saveTimer.current);
    setSaving('saving');
    try {
      await put(`/api/flows/${flowId}`, d);
      setSaving('saved');
      setFlows(fs => fs.map(f => (f.id === flowId ? { ...f, name: d.name } : f)));
    } catch (e: any) { setSaving('dirty'); toast(`Save failed: ${e.message}`, true); }
  }, [flowId, toast]);

  // The latest doc lives in a ref too, so edits compose without side effects inside state updaters.
  const docRef = useRef<FlowDoc | null>(null);
  docRef.current = doc;
  // Undo / redo: every edit keeps the previous version; typing within a moment counts as one edit.
  const hist = useRef<{ past: FlowDoc[]; future: FlowDoc[]; at: number }>({ past: [], future: [], at: 0 });
  const [, setHistTick] = useState(0);
  const apply = useCallback((next: FlowDoc) => {
    docRef.current = next;
    setDoc(next);
    setSaving('dirty');
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => saveNow(next), 700);
  }, [saveNow]);
  const update = useCallback((fn: (d: FlowDoc) => FlowDoc) => {
    const d = docRef.current;
    if (!d) return;
    const next = fn(d);
    if (next === d) return;
    const h = hist.current;
    const structural = next.nodes.length !== d.nodes.length || next.edges.length !== d.edges.length;
    if (structural || Date.now() - h.at > 800 || !h.past.length) {
      h.past.push(d);
      if (h.past.length > 100) h.past.shift();
    }
    h.at = structural ? 0 : Date.now();
    h.future = [];
    setHistTick(t => t + 1);
    apply(next);
  }, [apply]);
  // A restored activity's connection points must be measured again before its lines can be drawn.
  const remeasure = (d: FlowDoc) => requestAnimationFrame(() => requestAnimationFrame(() => updateNodeInternals(d.nodes.map(n => n.id))));
  const undo = useCallback(() => {
    const h = hist.current, d = docRef.current;
    const prev = h.past.pop();
    if (!prev || !d) return;
    h.future.push(d); h.at = 0;
    setHistTick(t => t + 1);
    apply(prev);
    remeasure(prev);
  }, [apply]);
  const redo = useCallback(() => {
    const h = hist.current, d = docRef.current;
    const next = h.future.pop();
    if (!next || !d) return;
    h.past.push(d); h.at = 0;
    setHistTick(t => t + 1);
    apply(next);
    remeasure(next);
  }, [apply]);

  // ---------- design-time shapes (mapper trees, output fields) ----------
  useEffect(() => {
    if (!doc) return;
    const t = window.setTimeout(() => {
      post('/api/design/schemas', { doc }).then(setDesign).catch(() => {});
    }, 350);
    return () => window.clearTimeout(t);
  }, [doc]);

  // ---------- run status on the canvas ----------
  const statusByNode = useMemo(() => {
    const m: Record<string, { status: string; count: number }> = {};
    for (const t of run?.tasks || []) m[t.node_id] = { status: t.status === 'error' ? 'failed' : t.status, count: (m[t.node_id]?.count || 0) + 1 };
    return m;
  }, [run]);

  useEffect(() => {
    if (!run || !ACTIVE.includes(run.status)) return;
    const t = window.setTimeout(() => {
      get<RunDetail>(`/api/runs/${run.id}`).then(r => {
        setRun(r);
        if (!ACTIVE.includes(r.status)) {
          setSample({ outputs: r.outputs, vars: r.vars });
          toast(r.status === 'done' ? `Test run finished in ${r.steps} steps` : `Test run ${r.status}${r.error ? `: ${r.error}` : ''}`, r.status !== 'done');
        }
      }).catch(() => {});
    }, run.status === 'waiting' ? 1500 : run.status === 'paused' ? 700 : 350);
    return () => window.clearTimeout(t);
  }, [run, toast]);

  // ---------- React Flow wiring ----------
  const nodes: ANode[] = useMemo(() => (doc?.nodes || []).map(n => ({
    id: n.id, type: 'activity', position: { x: n.x, y: n.y }, selected: sel?.kind === 'node' && sel.id === n.id,
    data: { n, status: statusByNode[n.id]?.status, count: statusByNode[n.id]?.count, bp: breakpoints.includes(n.id), designErrors: design[n.id]?.errors, designWarnings: design[n.id]?.warnings },
  })), [doc, sel, statusByNode, breakpoints, design]);
  const edges: Edge[] = useMemo(() => (doc?.edges || []).map(e => ({
    id: e.id, source: e.from, target: e.to, sourceHandle: e.port, targetHandle: 'in',
    selected: sel?.kind === 'edge' && sel.id === e.id,
    className: [e.port === 'error' ? 'error-edge' : '', e.when === 'when' ? 'cond-edge' : e.when === 'otherwise' ? 'else-edge' : ''].filter(Boolean).join(' ') || undefined,
    animated: statusByNode[e.from]?.status === 'done' && !!statusByNode[e.to],
    label: e.label || (e.when === 'when' ? (e.condition || '').replace(/^=/, '').slice(0, 40) : e.when === 'otherwise' ? 'otherwise' : undefined),
    labelBgPadding: [6, 3] as [number, number], labelBgBorderRadius: 6,
    labelStyle: { fill: 'var(--ink)', fontSize: 11.5, fontWeight: 600 }, labelBgStyle: { fill: 'var(--card)', stroke: 'var(--line)' },
  })), [doc, sel, statusByNode]);

  const onNodesChange = useCallback((changes: NodeChange<ANode>[]) => {
    const moves = changes.filter(c => c.type === 'position' && c.position) as any[];
    const removes = new Set(changes.filter(c => c.type === 'remove').map(c => (c as any).id));
    if (moves.length || removes.size) {
      const names = (docRef.current?.nodes || []).filter(n => removes.has(n.id)).map(n => n.name);
      update(d => ({
        ...d,
        nodes: d.nodes.filter(n => !removes.has(n.id)).map(n => { const m = moves.find(x => x.id === n.id); return m ? { ...n, x: Math.round(m.position.x), y: Math.round(m.position.y) } : n; }),
        edges: d.edges.filter(e => !removes.has(e.from) && !removes.has(e.to)),
      }));
      if (removes.size) {
        setSel(null);
        if (names.length) toast(`Deleted ${names.join(', ')}. Undo with Ctrl+Z or the ↶ button.`);
      }
    }
    const selected = changes.find(c => c.type === 'select' && (c as any).selected) as any;
    if (selected) { setSel({ kind: 'node', id: selected.id }); setExplorerSel(null); }
  }, [update, toast]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const removes = new Set(changes.filter(c => c.type === 'remove').map(c => (c as any).id));
    if (removes.size) { update(d => ({ ...d, edges: d.edges.filter(e => !removes.has(e.id)) })); setSel(null); }
    const selected = changes.find(c => c.type === 'select' && (c as any).selected) as any;
    if (selected) setSel({ kind: 'edge', id: selected.id });
  }, [update]);

  const isValidConnection = useCallback((c: Connection | Edge) => {
    if (!doc || c.source === c.target) return false;
    const t = doc.nodes.find(n => n.id === c.target);
    return !!t && !actOf(t.type)?.trigger && !actOf(t.type)?.noInput;
  }, [doc, actOf]);

  const onConnect = useCallback((c: Connection) => {
    if (!c.source || !c.target) return;
    update(d => d.edges.some(e => e.from === c.source && e.port === (c.sourceHandle || 'out') && e.to === c.target) ? d
      : { ...d, edges: [...d.edges, { id: uid(), from: c.source!, port: c.sourceHandle || 'out', to: c.target! }] });
  }, [update]);

  const addNode = useCallback((type: string, pos?: { x: number; y: number }) => {
    const a = actOf(type);
    if (!a || !doc) return;
    const config: Record<string, any> = {};
    a.fields.forEach(f => (config[f.k] = structuredClone(f.def ?? '')));
    const center = pos || (() => {
      const box = document.querySelector('.canvas')!.getBoundingClientRect();
      const p = rf.screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2.5 });
      const off = (doc.nodes.length % 5) * 18;
      return { x: p.x - 100 + off, y: p.y - 30 + off };
    })();
    const n: FlowNode = { id: uid(), type, name: uniqueName(doc, a.name), x: Math.round(center.x), y: Math.round(center.y), config };
    update(d => ({ ...d, nodes: [...d.nodes, n] }));
    setSel({ kind: 'node', id: n.id });
  }, [actOf, doc, rf, update]);

  const onDrop = (e: DragEvent) => {
    const type = e.dataTransfer.getData(ACT_MIME);
    if (!type) return;
    e.preventDefault();
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    addNode(type, { x: p.x - 100, y: p.y - 24 });
  };

  // ---------- node edits from the inspector ----------
  const updateNode = useCallback((id: string, fn: (n: FlowNode) => FlowNode) => update(d => ({ ...d, nodes: d.nodes.map(n => (n.id === id ? fn(n) : n)) })), [update]);
  const renameNode = useCallback((id: string, raw: string) => update(d => {
    const n = d.nodes.find(x => x.id === id)!;
    const name = uniqueName(d, raw, id);
    if (name === n.name) return d;
    return { ...d, nodes: d.nodes.map(x => (x.id === id ? { ...x, name } : { ...x, config: renameRefs(x.config, n.name, name) })) };
  }), [update]);
  const removeSel = useCallback(() => {
    if (!sel) return;
    const gone = sel.kind === 'node' ? docRef.current?.nodes.find(n => n.id === sel.id)?.name : undefined;
    update(d => sel.kind === 'node'
      ? { ...d, nodes: d.nodes.filter(n => n.id !== sel.id), edges: d.edges.filter(e => e.from !== sel.id && e.to !== sel.id) }
      : { ...d, edges: d.edges.filter(e => e.id !== sel.id) });
    if (gone) toast(`Deleted ${gone}. Undo with Ctrl+Z or the ↶ button.`);
    setSel(null);
  }, [sel, update, toast]);
  const duplicate = useCallback((id: string) => {
    if (!doc) return;
    const n = doc.nodes.find(x => x.id === id)!;
    const copy = { ...structuredClone(n), id: uid(), name: uniqueName(doc, n.name), x: n.x + 30, y: n.y + 90 };
    update(d => ({ ...d, nodes: [...d.nodes, copy] }));
    setSel({ kind: 'node', id: copy.id });
  }, [doc, update]);

  // ---------- actions ----------
  const testRun = async (triggerNodeId?: string, debug = false) => {
    if (!doc || !flowId) return;
    await saveNow(doc);
    try {
      const sTrig = sel?.kind === 'node' && actOf(doc.nodes.find(n => n.id === sel.id)?.type || '')?.trigger ? sel.id : undefined;
      const r = await post(`/api/flows/${flowId}/test`, { doc, triggerNodeId: triggerNodeId || sTrig, debug: debug ? { stepping: true, breakpoints } : undefined });
      if (r.warnings?.length) toast(r.warnings.join('\n'));
      setRun(await get(`/api/runs/${r.runId}`));
    } catch (e: any) { toast(e.message, true); }
  };
  const debugAct = (action: 'step' | 'continue' | 'pause') => run && post(`/api/runs/${run.id}/debug`, { action }).then(() => get<RunDetail>(`/api/runs/${run.id}`)).then(setRun).catch(e => toast(e.message, true));
  const createFlow = async (tplId: string) => {
    const t = TEMPLATES.find(x => x.id === tplId)!;
    const d = structuredClone(t.doc);
    // The name typed in the dialog, or the template's name made unique.
    const typed = newName.trim();
    if (typed && flows.some(f => f.name.toLowerCase() === typed.toLowerCase())) throw new Error(`A Sutra named ${typed} exists in this project`);
    let name = typed || d.name, i = 2;
    if (!typed) while (flows.some(f => f.name.toLowerCase() === name.toLowerCase())) name = `${d.name} ${i++}`;
    // A new Sutra goes in the folder of the one open now.
    const f = await post('/api/flows', { doc: { ...d, name }, projectId, folder: flows.find(x => x.id === flowId)?.folder || '' });
    await refreshFlows();
    setFlowId(f.id);
    setDialog(null);
    setNewName('');
  };
  const addSamples = async (ids: string[]) => {
    const added = await post<{ id: string; name: string }[]>(`/api/projects/${encodeURIComponent(projectId)}/samples`, { ids });
    await refreshFlows();
    if (added[0]) setFlowId(added[0].id);
    setDialog(null);
    toast(`Added ${added.length} sample Sutras: ${added.map(a => a.name).join(', ')}`);
  };
  const removeFlow = () => { if (flowId && doc) setDialog('delete'); };
  const deleteFlowNow = async () => {
    if (!flowId) return;
    await del(`/api/flows/${flowId}`);
    setFlowId(null);
    setDialog(null);
    await refreshFlows();
    toast('Sutra deleted');
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); testRun(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (doc) saveNow(doc); }
      // Undo / redo, except while typing in a field (the field undoes its own text).
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (!typing && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      if (!typing && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  const current = flows.find(f => f.id === flowId);
  const selNode = sel?.kind === 'node' ? doc?.nodes.find(n => n.id === sel.id) : undefined;

  return (
    <MetaCtx.Provider value={meta}><VarsCtx.Provider value={{ project, resources }}>
      <main className={`work${tab === 'input' && selNode && !explorerSel ? ' wide' : ''}`}>
        <aside className="pal">
          <div className="ltabs" role="tablist">
            <button role="tab" aria-selected={leftTab === 'project'} className={leftTab === 'project' ? 'act' : ''} onClick={() => setLeftTab('project')}>Project</button>
            <button role="tab" aria-selected={leftTab === 'palette'} className={leftTab === 'palette' ? 'act' : ''} onClick={() => setLeftTab('palette')}>Palettes</button>
            <button role="tab" aria-selected={leftTab === 'git'} className={leftTab === 'git' ? 'act' : ''} onClick={() => setLeftTab('git')} title="Source control">Git</button>
          </div>
          {leftTab === 'git' ? <GitPanel onChanged={refreshFlows} /> : leftTab === 'project'
            ? <ProjectExplorer flows={flows} flowId={flowId} openFlow={id => setFlowId(id)} newFlow={() => setDialog('new')} sel={explorerSel} setSel={setExplorerSel} onFlowsChanged={refreshFlows} />
            : <Palette meta={meta} onAdd={t => addNode(t)} />}
        </aside>
        <section className="canvas" onDragOver={e => { if (e.dataTransfer.types.includes(ACT_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }} onDrop={onDrop}>
          <div className="flowbar">
            <select className="name" aria-label="Sutra" value={flowId || ''} onChange={e => setFlowId(e.target.value)}>
              {!flows.length && <option value="">No Sutras yet</option>}
              {flows.filter(f => !f.folder).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              {[...new Set(flows.map(f => f.folder || '').filter(Boolean))].sort().map(d => (
                <optgroup key={d} label={d}>{flows.filter(f => f.folder === d).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</optgroup>
              ))}
            </select>
            <button className="btn" onClick={() => setDialog('new')}>+ New Sutra</button>
            {doc && <>
              <button className="btn go" onClick={() => testRun()} title="Ctrl+Enter">▶ Test</button>
              <button className="btn" onClick={() => testRun(undefined, true)} title="Run one activity at a time; stops at breakpoints">🐞 Debug</button>
              {run?.debug && ACTIVE.includes(run.status) && <>
                <button className="btn" onClick={() => debugAct('step')} title="Run the next activity">⤼ Step</button>
                <button className="btn" onClick={() => debugAct('continue')} title="Run until the next breakpoint">▶ Continue</button>
                <button className="btn" onClick={() => debugAct('pause')} title="Pause before the next activity">⏸ Pause</button>
              </>}
              {run && ACTIVE.includes(run.status) && <button className="btn danger" onClick={() => post(`/api/runs/${run.id}/cancel`).then(() => get(`/api/runs/${run.id}`)).then(setRun)}>■ Stop</button>}
              <button className="btn" onClick={undo} disabled={!hist.current.past.length} title="Undo (Ctrl+Z)" aria-label="Undo">↶</button>
              <button className="btn" onClick={redo} disabled={!hist.current.future.length} title="Redo (Ctrl+Y)" aria-label="Redo">↷</button>
              <button className="btn primary" onClick={() => setDialog('deploy')}>Deploy</button>
              <span className={`pill${saving === 'saved' ? '' : ' warn'}`}>{saving === 'saved' ? 'Saved' : saving === 'saving' ? 'Saving' : 'Unsaved'}</span>
              {current?.deployed ? <span className="pill ok">Deployed v{current.deployed.version}</span> : <span className="pill">Draft only</span>}
              {run && <span className={`pill${run.status === 'done' ? ' ok' : run.status === 'failed' ? ' err' : ' warn'}`}>{run.debug ? 'Debug' : 'Test run'}: {run.status === 'paused' ? `paused before ${doc.nodes.find(n => n.id === run.tasks.find(t => t.status === 'paused')?.node_id)?.name ?? 'next activity'}` : run.status}</span>}
            </>}
          </div>
          {doc ? (
            <ReactFlow<ANode, Edge>
              nodes={nodes} edges={edges} nodeTypes={nodeTypes}
              onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} isValidConnection={isValidConnection}
              onPaneClick={() => { setSel(null); setExplorerSel(null); }} deleteKeyCode={['Delete']} fitView minZoom={0.2} maxZoom={1.8}
              proOptions={{ hideAttribution: true }} defaultEdgeOptions={{ type: 'smoothstep' }}
            >
              <Background gap={22} size={1.3} color="var(--grid)" />
              <Controls showInteractive={false} position="bottom-right" />
              <MiniMap pannable zoomable position="bottom-left" style={{ width: 150, height: 96 }} />
            </ReactFlow>
          ) : (
            <div className="empty"><p>Create a Sutra to start. Templates include a REST API, a SOAP service and an approval Sutra.</p></div>
          )}
          {doc && doc.nodes.length === 0 && <div className="empty"><p>Drag an activity from the palette, starting with a trigger.</p></div>}
        </section>
        {explorerSel ? <ExplorerEditor sel={explorerSel} setSel={setExplorerSel} /> : doc && flowId ? (
          <Inspector
            key={flowId}
            flowId={flowId} doc={doc} sel={sel} selNode={selNode} run={run} sample={sample}
            design={design} tab={tab} setTab={setTab} breakpoints={breakpoints} toggleBreakpoint={toggleBreakpoint}
            setDoc={update} updateNode={updateNode} renameNode={renameNode} removeSel={removeSel} duplicate={duplicate}
            onDecided={() => run && get(`/api/runs/${run.id}`).then(setRun)} onTest={id => testRun(id)} onDelete={removeFlow}
          />
        ) : <aside className="side"><div className="tabbody muted">Select or create a Sutra.</div></aside>}
      </main>
      {dialog === 'new' && (
        <Modal title="New Sutra" onClose={() => setDialog(null)}>
          <div className="fld"><label htmlFor="nfname">Name</label>
            <input id="nfname" type="text" autoFocus value={newName} onChange={e => setNewName(e.target.value)} placeholder="Empty = the template's name" maxLength={120} />
            <div className="hint">Rename later from the ⋯ menu (or right-click) of the Sutra in the explorer.</div></div>
          <p className="muted">Start blank or from a template. Everything stays editable.</p>
          <ul className="list">
            {TEMPLATES.map(t => (
              <li key={t.id}><button onClick={() => createFlow(t.id).catch(e => toast(e.message, true))}><b>{t.name}</b><span className="muted" style={{ fontSize: 12 }}>{t.desc}</span></button></li>
            ))}
          </ul>
          <SamplePicker onAdd={ids => addSamples(ids).catch(e => toast(e.message, true))} />
        </Modal>
      )}
      {dialog === 'delete' && doc && flowId && (
        <ConfirmDelete title={`Delete ${doc.name}`} usageOf={{ projectId, id: flowId }} onClose={() => setDialog(null)} onConfirm={deleteFlowNow}
          blocked={current?.deployed ? `${doc.name} is deployed (version ${current.deployed.version}): undeploy it first, so deleting never stops a running service.` : undefined}
          what={<p>The Sutra <b>{doc.name}</b> and its saved versions are deleted. Run history is kept.</p>} />
      )}
      {dialog === 'deploy' && doc && flowId && (
        <DeployDialog flowId={flowId} doc={doc} deployed={current?.deployed?.version} onClose={() => setDialog(null)}
          onDone={async () => { await refreshFlows(); setDialog(null); }} save={() => saveNow(doc)} />
      )}
    </VarsCtx.Provider></MetaCtx.Provider>
  );
}

function DeployDialog({ flowId, doc, deployed, onClose, onDone, save }: { flowId: string; doc: FlowDoc; deployed?: number; onClose(): void; onDone(): void; save(): Promise<void> }) {
  const toast = useToast();
  const { projectId } = useCatalog();
  const [check, setCheck] = useState<{ errors: string[]; warnings: string[] } | null>(null);
  const [note, setNote] = useState('');
  const [versions, setVersions] = useState<{ version: number; note: string; created_at: string }[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    post(`/api/flows/validate?projectId=${encodeURIComponent(projectId)}`, doc).then(setCheck).catch(e => toast(e.message, true));
    get(`/api/flows/${flowId}/versions`).then(setVersions).catch(() => {});
  }, [flowId, doc, toast]);
  const go = async (version?: number) => {
    setBusy(true);
    try {
      await save();
      const r = await post(`/api/flows/${flowId}/deploy`, { note, version });
      toast(`Deployed version ${r.version}`);
      onDone();
    } catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Deploy "${doc.name}"`} onClose={onClose} actions={<>
      {deployed && <button className="btn danger" onClick={() => del(`/api/flows/${flowId}/deploy`).then(onDone)}>Undeploy</button>}
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy || !check || check.errors.length > 0} onClick={() => go()}>Publish and deploy</button>
    </>}>
      <p className="muted" style={{ marginTop: 0 }}>Publishing saves the canvas as a new read-only version. Timers, REST/SOAP services and the Run API then use it; runs already in progress finish on the version they started with.</p>
      {check?.errors.length ? <div className="errbox">{check.errors.join('\n')}</div> : null}
      {check?.warnings.length ? <div className="warnbox">{check.warnings.join('\n')}</div> : null}
      {check && !check.errors.length && !check.warnings.length && <div className="okbox">No problems found.</div>}
      <div className="fld"><label htmlFor="vn">Version note</label><input id="vn" type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="What changed" /></div>
      {versions.length > 0 && (
        <>
          <p className="sub">Earlier versions</p>
          <table className="t"><tbody>{versions.slice(0, 8).map(v => (
            <tr key={v.version}><td>v{v.version}{v.version === deployed ? ' (deployed)' : ''}</td><td className="muted">{v.note}</td><td>{v.version !== deployed && <button className="btn small" disabled={busy} onClick={() => go(v.version)}>Roll back to this</button>}</td></tr>
          ))}</tbody></table>
        </>
      )}
    </Modal>
  );
}

export function Designer() {
  return <ReactFlowProvider><DesignerInner /></ReactFlowProvider>;
}

export type { ActivityMeta };

/** Working examples to add to the project, by scenario and palette. */
function SamplePicker({ onAdd }: { onAdd(ids: string[]): void }) {
  const [list, setList] = useState<{ id: string; name: string; desc: string; palettes: string; needs?: string }[]>([]);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  useEffect(() => { get<typeof list>('/api/samples').then(setList).catch(() => {}); }, []);
  if (!list.length) return null;
  return (
    <div className="samples">
      <p className="muted" style={{ marginTop: 14 }}>Or learn from working examples: {list.length} sample Sutras across the palettes. Choose the ones you want.</p>
      <div className="row"><button className="btn" onClick={() => setOpen(o => !o)} aria-expanded={open}>{open ? 'Hide samples' : 'Choose samples'}</button>
        <button className="btn primary" disabled={!pick.size} onClick={() => onAdd([...pick])}>Add {pick.size || ''} sample{pick.size === 1 ? '' : 's'}</button></div>
      {open && <ChoiceList label="samples" items={sampleChoices(list)} chosen={pick} onChange={setPick} />}
    </div>
  );
}
