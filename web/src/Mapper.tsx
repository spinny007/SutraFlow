/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { get, post } from './api';
import { visible } from './Fields';
import { useCatalog } from './ui';
import type { ActivityMeta, Field, FlowDoc, FlowNode, MapRule, MappingValue, NodeDesign, RunDetail, SNode } from './types';

/**
 * Input mapping: Process Data (left) → Activity Input (right), with
 * lines between mapped fields, and a formula editor with function browser,
 * live preview and statements (For-Each, If, Choose) below.
 */

export const PATH_MIME = 'application/x-sutra-path';

// ---------- helpers ----------
const getAt = (v: any, parts: string[]) => {
  let cur = v;
  for (const p of parts) {
    if (cur == null) return undefined;
    if (Array.isArray(cur)) cur = cur[0];
    cur = cur?.[p];
  }
  return cur;
};

export function inferShape(v: any, name: string, depth = 0): SNode {
  if (depth > 8) return { name, type: 'any' };
  if (Array.isArray(v)) {
    const objs = v.filter(x => x && typeof x === 'object' && !Array.isArray(x)).slice(0, 10);
    const base = objs.length ? inferShape(Object.assign({}, ...objs), name, depth + 1) : v.length ? inferShape(v[0], name, depth + 1) : { name, type: 'any' as const };
    return { ...base, repeats: true };
  }
  if (v && typeof v === 'object') return { name, type: 'object', children: Object.entries(v).map(([k, x]) => inferShape(x, k, depth + 1)) };
  return { name, type: typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : v == null ? 'any' : 'string' };
}

/** Field references inside a formula or template. */
export function refsIn(src: unknown): string[] {
  if (typeof src !== 'string' || !src) return [];
  const out: string[] = [];
  if (src.startsWith('=') || !src.includes('{{')) {
    for (const m of src.matchAll(/\{([^{}]+)\}/g)) out.push(m[1].trim());
  } else {
    for (const m of src.matchAll(/\{\{\s*([^{}|]+?)\s*(\|[^{}]*)?\}\}/g)) out.push(m[1].trim());
  }
  return out;
}

const seg = (k: string) => (/^[^.[\]{}|"'\s][^.[\]{}|"']*$/.test(k) ? '.' + k : `["${k}"]`);
const TYPE_ICON: Record<string, string> = { string: 'abc', number: '1.2', integer: '123', boolean: 'y/n', date: 'dt', object: '{}', any: '*', null: '∅' };

// ---------- targets ----------
type Target =
  | { kind: 'field'; id: string; fieldKey: string; label: string; field: Field }
  | { kind: 'kv'; id: string; fieldKey: string; index: number; label: string; field: Field }
  | { kind: 'map'; id: string; fieldKey: string; path: string; snode: SNode };

interface Props {
  node: FlowNode;
  act: ActivityMeta;
  doc: FlowDoc;
  design: Record<string, NodeDesign>;
  run: RunDetail | null;
  outputs: Record<string, any>;
  updateNode(id: string, fn: (n: FlowNode) => FlowNode): void;
}

export function Mapper({ node, act, doc, design, run, outputs, updateNode }: Props) {
  const { meta, project } = useCatalog();
  const [sel, setSelRaw] = useState<string | null>(null);
  /** Process Data field clicked to show where it is used. */
  const [focusSrc, setFocusSrc] = useState<string | null>(null);
  const setSel = useCallback((id: string | null) => { setSelRaw(id); setFocusSrc(null); }, []);
  const [filter, setFilter] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<{ d: string; on: boolean }[]>([]);
  const d = design[node.id];
  const cfg = node.config;
  const setCfg = useCallback((k: string, v: any) => updateNode(node.id, n => ({ ...n, config: { ...n.config, [k]: v } })), [node.id, updateNode]);

  // Map data steps from before structured mapping kept "map" rows (dotted paths, {{ }} values): convert them once.
  useEffect(() => {
    const legacy = node.type === 'mapper' && Array.isArray(cfg.map) ? (cfg.map as { k: string; v: string }[]).filter(r => r?.k) : [];
    if (!legacy.length) return;
    const rules: Record<string, MapRule> = { ...((cfg.mapping as MappingValue | undefined)?.rules || {}) };
    const keep: typeof legacy = [];
    for (const r of legacy) {
      const v = String(r.v ?? '');
      const single = /^\s*\{\{\s*([^{}|]+?)\s*\}\}\s*$/.exec(v);
      const expr = v.startsWith('=') ? v.slice(1) : single ? `{${single[1]}}` : !v.includes('{{') ? `'${v.replace(/'/g, "''")}'` : null;
      if (expr === null) keep.push(r); else rules[r.k.replace(/\./g, '/')] = { expr };
    }
    updateNode(node.id, n => ({ ...n, config: { ...n.config, mapping: { ...(n.config.mapping || {}), rules }, map: keep.length ? keep : undefined } }));
  }, [node.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ----- left: process data roots -----
  const ancestors = useMemo(() => {
    const anc = new Set<string>();
    const stack = doc.edges.filter(e => e.to === node.id).map(e => e.from);
    while (stack.length) {
      const id = stack.pop()!;
      if (anc.has(id)) continue;
      anc.add(id);
      doc.edges.filter(e => e.to === id).forEach(e => stack.push(e.from));
    }
    return doc.nodes.filter(n => anc.has(n.id));
  }, [doc, node.id]);

  const ranHere = run?.tasks.filter(t => t.node_id === node.id).slice(-1)[0];
  const inputValue = ranHere ? ranHere.input : undefined;
  const runVars = run?.vars;
  const projectVars = project?.config.variables;
  const [engineVars, setEngineVars] = useState<{ name: string; value: string; description?: string }[]>([]);
  useEffect(() => { get('/api/engine-variables').then(setEngineVars).catch(() => {}); }, []);
  const gvShape = useMemo<SNode>(() => ({ name: 'gv', type: 'object', children: (projectVars || []).map(v => ({ name: v.name, type: v.type === 'number' ? 'number' : v.type === 'boolean' ? 'boolean' : 'string', doc: v.description })) }), [projectVars]);
  const gvValue = useMemo(() => Object.fromEntries((projectVars || []).map(v => [v.name, v.type === 'secret' ? '••••••' : v.value])), [projectVars]);
  const procShape = useMemo(() => inferShape({ id: '', name: '', sutraId: '', version: 0, project: '', startedAt: '', source: '', step: '', attempt: 0 }, 'sutra'), []);
  const varShape = useMemo<SNode>(() => ({ name: 'vars', type: 'object', children: [...(doc.variables || []).map(v => ({ name: v.name, type: (v.type === 'number' ? 'number' : v.type === 'boolean' ? 'boolean' : 'string') as SNode['type'] })), ...doc.nodes.filter(n => n.type === 'setVar').flatMap(n => ((n.config.vars as any[]) || []).filter(r => r?.k).map(r => ({ name: String(r.k), type: 'any' as const })))] }), [doc]);

  // For-Each context of the selected target (enables {item.x} and the $current root).
  const target = useTargets(act, node, d);
  const selected = target.find(t => t.id === sel);
  const forEachCtx = useMemo(() => {
    if (!selected || selected.kind !== 'map') return null;
    const m = (cfg[selected.fieldKey] || { rules: {} }) as MappingValue;
    const parts = selected.path.split('/');
    for (let i = parts.length; i > 0; i--) {
      const p = parts.slice(0, i).join('/');
      const fe = m.rules?.[p]?.forEach;
      if (fe) { const src = /^\s*\{([^{}]+)\}\s*$/.exec(fe)?.[1]?.trim(); return { path: p, source: src || null }; }
    }
    return null;
  }, [selected, cfg]);

  const roots = useMemo(() => {
    const r: { label: string; path: string; shape: SNode | null; value: any; state?: 'ran' | 'skipped' | 'none' }[] = [];
    r.push({ label: '$_projectVariables', path: 'gv', shape: gvShape, value: gvValue, state: 'none' });
    r.push({ label: '$_sutraContext', path: 'sutra', shape: procShape, value: undefined, state: 'none' });
    if (engineVars.length) r.push({ label: '$_sengineVariables (read only)', path: 'ev', shape: { name: 'ev', type: 'object', children: engineVars.map(v => ({ name: v.name, type: 'string' as const, doc: v.description })) }, value: Object.fromEntries(engineVars.map(v => [v.name, v.value])), state: 'none' });
    if (varShape.children!.length || (runVars && Object.keys(runVars).length)) r.push({ label: '$_sutraVariables', path: 'vars', shape: varShape.children!.length ? varShape : inferShape(runVars, 'vars'), value: runVars, state: run ? 'ran' : 'none' });
    if (d?.in || inputValue !== undefined) r.push({ label: 'input (previous step)', path: 'input', shape: d?.in ?? inferShape(inputValue, 'input'), value: inputValue, state: ranHere ? 'ran' : run ? 'skipped' : 'none' });
    for (const n of ancestors) {
      const ran = n.name in outputs;
      r.push({ label: n.name, path: `nodes${seg(n.name)}`, shape: design[n.id]?.out ?? (ran ? inferShape(outputs[n.name], n.name) : null), value: outputs[n.name], state: ran ? 'ran' : run ? 'skipped' : 'none' });
    }
    const lp = node.settings?.loop;
    if (lp) {
      const ref = /\{\{?\s*([^{}|]+?)\s*(?:\|[^}]*)?\}\}?/.exec(node.settings?.loopOver || '{{input.items}}')?.[1];
      const list = lp === 'for each item' && ref ? shapeAtPath(r, ref) : null;
      const children: SNode[] = lp === 'for each item'
        ? [{ name: 'index', type: 'integer' }, { name: 'count', type: 'integer' }, list ? { ...list, name: 'value', repeats: false } : { name: 'value', type: 'any' }]
        : [{ name: 'index', type: 'integer' }, d?.out ? { ...d.out, name: 'output' } : { name: 'output', type: 'any' }];
      r.unshift({ label: '$iteration (loop)', path: 'iteration', shape: { name: 'iteration', type: 'object', children }, value: undefined, state: 'none' });
    }
    if (forEachCtx?.source) {
      const shape = shapeAtPath(r, forEachCtx.source);
      r.unshift({ label: '$current (item)', path: 'item', shape: shape ? { ...shape, repeats: false } : null, value: valueAtPath(r, forEachCtx.source), state: 'none' });
      r.unshift({ label: '$index', path: 'index', shape: { name: 'index', type: 'integer' }, value: 1, state: 'none' });
    }
    return r;
  }, [ancestors, outputs, design, d, inputValue, run, ranHere, forEachCtx, gvShape, gvValue, procShape, varShape, runVars, engineVars, node.settings]);

  // ----- values on the right -----
  const getVal = (t: Target): string | MapRule | undefined => {
    if (t.kind === 'field') return cfg[t.fieldKey];
    if (t.kind === 'kv') return (cfg[t.fieldKey] || [])[t.index]?.v;
    return ((cfg[t.fieldKey] || { rules: {} }) as MappingValue).rules?.[t.path];
  };
  const setRule = (fieldKey: string, path: string, rule: MapRule | null) => {
    const m: MappingValue = structuredClone(cfg[fieldKey] || { rules: {} });
    m.rules ||= {};
    if (!rule || (!rule.expr && !rule.forEach && !rule.ifCond && !rule.choose?.length && !rule.otherwise)) delete m.rules[path];
    else m.rules[path] = rule;
    setCfg(fieldKey, m);
  };
  const setVal = (t: Target, v: any) => {
    if (t.kind === 'field') setCfg(t.fieldKey, v);
    else if (t.kind === 'kv') setCfg(t.fieldKey, (cfg[t.fieldKey] || []).map((r: any, i: number) => (i === t.index ? { ...r, v } : r)));
    else setRule(t.fieldKey, t.path, v);
  };

  // ----- relative refs inside For-Each -----
  const relativize = (t: Target, ref: string) => {
    if (t.kind !== 'map') return ref;
    const m = (cfg[t.fieldKey] || { rules: {} }) as MappingValue;
    const parts = t.path.split('/');
    for (let i = parts.length; i > 0; i--) {
      const fe = m.rules?.[parts.slice(0, i).join('/')]?.forEach;
      const src = fe && /^\s*\{([^{}]+)\}\s*$/.exec(fe)?.[1]?.trim();
      if (src && (ref === src || ref.startsWith(src + '.') || ref.startsWith(src + '['))) return 'item' + ref.slice(src.length);
    }
    return ref;
  };
  const absolutize = (t: Target, ref: string) => {
    if (t.kind !== 'map' || !/^item(\.|\[|$)/.test(ref)) return ref;
    const m = (cfg[t.fieldKey] || { rules: {} }) as MappingValue;
    const parts = t.path.split('/');
    for (let i = parts.length; i > 0; i--) {
      const fe = m.rules?.[parts.slice(0, i).join('/')]?.forEach;
      const src = fe && /^\s*\{([^{}]+)\}\s*$/.exec(fe)?.[1]?.trim();
      if (src) return src + ref.slice(4);
    }
    return ref;
  };

  // ----- drop handling -----
  const dropOn = (t: Target, payload: { path: string; repeats: boolean; children?: string[] }) => {
    if (t.kind === 'map') {
      const rule: MapRule = { ...((getVal(t) as MapRule) || {}) };
      if (t.snode.repeats && payload.repeats && !rule.forEach) {
        rule.forEach = `{${relativize(t, payload.path)}}`;
        setRule(t.fieldKey, t.path, rule);
        // Auto-map children with the same names (case-insensitive).
        const m: MappingValue = structuredClone(cfg[t.fieldKey] || { rules: {} });
        m.rules ||= {};
        m.rules[t.path] = rule;
        for (const ch of t.snode.children || []) {
          const hit = (payload.children || []).find(c => c.toLowerCase() === ch.name.replace(/^@_/, '').toLowerCase());
          const p = `${t.path}/${ch.name}`;
          if (hit && !m.rules[p]) m.rules[p] = { expr: `{item${seg(hit)}}` };
        }
        setCfg(t.fieldKey, m);
        return;
      }
      rule.expr = `{${relativize(t, payload.path)}}`;
      setRule(t.fieldKey, t.path, rule);
      return;
    }
    const cur = String(getVal(t) ?? '');
    if (!cur.trim() || /^=\s*\{[^{}]*\}\s*$/.test(cur) || /^\s*\{\{[^{}]*\}\}\s*$/.test(cur)) setVal(t, `={${payload.path}}`);
    else setVal(t, cur.startsWith('=') ? `${cur}, {${payload.path}}` : `${cur}{{${payload.path}}}`);
  };

  // ----- auto map by name from the previous step -----
  const autoMap = (fieldKey: string, tree: SNode) => {
    const src = roots.find(r => r.path === 'input')?.shape;
    if (!src) return 0;
    const m: MappingValue = structuredClone(cfg[fieldKey] || { rules: {} });
    m.rules ||= {};
    let n = 0;
    const walk = (t: SNode, s: SNode | undefined, tp: string, sp: string) => {
      for (const ch of t.children || []) {
        const hit = s?.children?.find(c => c.name.replace(/^@_/, '').toLowerCase() === ch.name.replace(/^@_/, '').toLowerCase());
        if (!hit) continue;
        const p = tp ? `${tp}/${ch.name}` : ch.name;
        if (m.rules[p]) continue;
        if (ch.repeats && hit.repeats) { m.rules[p] = { forEach: `{${sp}${seg(hit.name)}}` }; n++; walkItem(ch, hit, p); }
        else if (ch.children?.length && hit.children?.length) walk(ch, hit, p, sp + seg(hit.name));
        else if (!ch.children?.length) { m.rules[p] = { expr: `{${sp}${seg(hit.name)}}` }; n++; }
      }
    };
    const walkItem = (t: SNode, s: SNode, tp: string) => {
      for (const ch of t.children || []) {
        const hit = s.children?.find(c => c.name.toLowerCase() === ch.name.toLowerCase());
        if (hit && !ch.children?.length) { m.rules[`${tp}/${ch.name}`] = { expr: `{item${seg(hit.name)}}` }; n++; }
      }
    };
    // XSD trees wrap the root element; the input may or may not.
    walk(tree, src, '', 'input');
    if (!n && tree.children?.length === 1) walk(tree.children[0], src, tree.children[0].name, 'input');
    setCfg(fieldKey, m);
    return n;
  };

  // ----- lines + highlighting of linked fields -----
  const recompute = useCallback(() => {
    const b = box.current, L = leftRef.current, R = rightRef.current;
    if (!b || !L || !R) return;
    const bb = b.getBoundingClientRect(), lb = L.getBoundingClientRect(), rb = R.getBoundingClientRect();
    const find = (raw: string) => {
      let p = raw;
      let el: HTMLElement | null = null;
      while (p && !(el = L.querySelector<HTMLElement>(`[data-ref="${CSS.escape(p)}"]`))) {
        const cut = Math.max(p.lastIndexOf('.'), p.lastIndexOf('['));
        p = cut > 0 ? p.slice(0, cut) : '';
      }
      return el;
    };
    const under = (p: string, root: string) => p === root || p.startsWith(root + '.') || p.startsWith(root + '[');
    const out: { d: string; on: boolean }[] = [];
    const litSources = new Set<HTMLElement>();
    const litTargets = new Set<string>();
    for (const t of target) {
      const v = getVal(t);
      const srcs = (t.kind === 'map' && v && typeof v === 'object'
        ? [v.expr, v.forEach, v.ifCond, v.otherwise, ...(v.choose || []).flatMap(c => [c.when, c.expr])].flatMap(x => refsIn(x ? '=' + x : ''))
        : refsIn(v)).map(raw => absolutize(t, raw).replace(/\[\d+\]/g, ''));
      if (!srcs.length) continue;
      const linked = t.id === sel || (!!focusSrc && srcs.some(p => under(p, focusSrc) || under(focusSrc, p)));
      if (linked) litTargets.add(t.id);
      const rowEl = R.querySelector<HTMLElement>(`[data-target="${CSS.escape(t.id)}"]`);
      for (const p of srcs) {
        const el = find(p);
        if (!el) continue;
        if (linked) litSources.add(el);
        if (!rowEl) continue;
        const rr = rowEl.getBoundingClientRect();
        if (rr.bottom < rb.top || rr.top > rb.bottom) continue;
        const er = el.getBoundingClientRect();
        const y1 = Math.min(Math.max(er.top + er.height / 2, lb.top), lb.bottom) - bb.top;
        const y2 = rr.top + rr.height / 2 - bb.top;
        const x1 = lb.right - bb.left - 2, x2 = rb.left - bb.left + 2;
        const dx = (x2 - x1) / 2;
        out.push({ d: `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`, on: linked });
      }
    }
    // Mark the fields at both ends of the highlighted lines.
    L.querySelectorAll('.srow.linked').forEach(e => { if (!litSources.has(e as HTMLElement)) e.classList.remove('linked'); });
    litSources.forEach(e => e.classList.add('linked'));
    R.querySelectorAll<HTMLElement>('.trow').forEach(e => e.classList.toggle('linked', litTargets.has(e.dataset.target || '') && e.dataset.target !== sel));
    L.querySelectorAll<HTMLElement>('.srow').forEach(e => e.classList.toggle('focus', !!focusSrc && e.dataset.ref === focusSrc));
    setLines(prev => (prev.length === out.length && prev.every((l, i) => l.d === out[i].d && l.on === out[i].on) ? prev : out));
  }, [target, cfg, sel, focusSrc]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => { recompute(); });
  useEffect(() => {
    const ro = new ResizeObserver(() => recompute());
    if (box.current) ro.observe(box.current);
    window.addEventListener('resize', recompute);
    return () => { ro.disconnect(); window.removeEventListener('resize', recompute); };
  }, [recompute]);

  const scope = useMemo(() => buildScope(roots, run, outputs, inputValue), [roots, run, outputs, inputValue]);

  return (
    <div className="mapper">
      <div className="mapper-panes" ref={box}>
        <div className="mpane" ref={leftRef} onScroll={recompute}>
          <div className="mhead"><b>Sutra Data</b><input className="inp" placeholder="Filter" aria-label="Filter Sutra data" value={filter} onChange={e => setFilter(e.target.value)} /></div>
          {roots.map(r => <SourceNode key={r.path} label={r.label} path={r.path} shape={r.shape} value={r.value} state={r.state} depth={0} filter={filter.toLowerCase()} onToggle={recompute}
            onPick={p => { setSelRaw(null); setFocusSrc(f => (f === p ? null : p)); }} />)}
        </div>
        <svg className={`mlines${sel || focusSrc ? ' focused' : ''}`} aria-hidden="true">{lines.map((l, i) => <path key={i} d={l.d} className={l.on ? 'on' : ''} />)}</svg>
        <div className="mpane" ref={rightRef} onScroll={recompute}>
          <div className="mhead"><b>Activity Input</b><span className="muted" style={{ fontSize: 11 }}>drop fields here</span></div>
          <TargetTree act={act} node={node} design={d} sel={sel} setSel={setSel} getVal={getVal} dropOn={dropOn} setCfg={setCfg} autoMap={autoMap} onToggle={recompute} />
        </div>
      </div>
      {selected ? (
        <FormulaEditor key={selected.id} t={selected} value={getVal(selected)} setVal={v => setVal(selected, v)} scope={scope} functions={meta.functions} relativize={p => relativize(selected, p)} />
      ) : (
        <p className="muted" style={{ fontSize: 12.5, margin: '8px 2px' }}>Drag a field from Sutra Data onto an input, or select an input to write its formula. Lists dropped on a repeating target create a For-Each and map fields with matching names.</p>
      )}
      {d?.errors?.length ? <div className="errbox" style={{ marginTop: 8 }}>{d.errors.join('\n')}</div> : null}
      {d?.warnings?.length ? <div className="warnbox" style={{ marginTop: 8 }}>{d.warnings.join('\n')}</div> : null}
    </div>
  );
}

function shapeAtPath(roots: { path: string; shape: SNode | null }[], ref: string): SNode | null {
  const r = roots.filter(x => ref === x.path || ref.startsWith(x.path + '.') || ref.startsWith(x.path + '[')).sort((a, b) => b.path.length - a.path.length)[0];
  if (!r?.shape) return null;
  const rest = ref.slice(r.path.length).replace(/\[\d+\]/g, '').split(/\.|\["|"\]/).filter(Boolean);
  let cur: SNode | undefined = r.shape;
  for (const p of rest) cur = cur?.children?.find(c => c.name === p);
  return cur ?? null;
}
function valueAtPath(roots: { path: string; value: any }[], ref: string) {
  const r = roots.filter(x => ref === x.path || ref.startsWith(x.path + '.')).sort((a, b) => b.path.length - a.path.length)[0];
  if (!r) return undefined;
  const v = getAt(r.value, ref.slice(r.path.length).split('.').filter(Boolean));
  return Array.isArray(v) ? v[0] : v;
}

function buildScope(roots: { path: string; value: any }[], run: RunDetail | null, outputs: Record<string, any>, input: any) {
  const gv = roots.find(r => r.path === 'gv')?.value;
  const item = roots.find(r => r.path === 'item')?.value;
  return {
    input, nodes: outputs, vars: run?.vars || {}, gv, item, index: 1,
    sutra: run ? { id: run.id, name: run.flowName, version: run.version, startedAt: run.startedAt, source: run.source } : {},
    process: run ? { id: run.id, name: run.flowName, flow: run.flowName, version: run.version, startedAt: run.startedAt, source: run.source } : {},
    trigger: run ? outputs[run.doc.nodes.find(n => n.id === run.triggerNode)?.name || ''] : undefined,
  };
}

/** Browsable routing scope for a selected transition condition. */
export function ConditionDataBrowser({ from, doc, design, run, outputs, localVars, onPick }: {
  from: FlowNode; doc: FlowDoc; design: Record<string, NodeDesign>; run: RunDetail | null; outputs: Record<string, any>; localVars?: Record<string, any>; onPick(path: string): void;
}) {
  const { meta, project } = useCatalog();
  const [filter, setFilter] = useState('');
  const [engineVars, setEngineVars] = useState<{ name: string; value: string; description?: string }[]>([]);
  useEffect(() => { get('/api/engine-variables').then(setEngineVars).catch(() => {}); }, []);
  const roots = useMemo(() => {
    const ancestorIds = new Set<string>();
    const stack = doc.edges.filter(e => e.to === from.id).map(e => e.from);
    while (stack.length) {
      const id = stack.pop()!;
      if (ancestorIds.has(id)) continue;
      ancestorIds.add(id);
      doc.edges.filter(e => e.to === id).forEach(e => stack.push(e.from));
    }
    const projectVars = project?.config.variables || [];
    const vars: SNode = { name: 'vars', type: 'object', children: [
      ...(doc.variables || []).map(v => ({ name: v.name, type: (v.type === 'number' ? 'number' : v.type === 'boolean' ? 'boolean' : 'string') as SNode['type'] })),
      ...doc.nodes.filter(n => n.type === 'setVar').flatMap(n => ((n.config.vars as any[]) || []).filter(row => row?.k).map(row => ({ name: String(row.k), type: 'any' as const }))),
    ] };
    const trigger = (run?.triggerNode ? doc.nodes.find(n => n.id === run.triggerNode) : undefined)
      || doc.nodes.find(n => meta.activities.find(a => a.type === n.type)?.trigger);
    const inputValue = outputs[from.name];
    const list: { label: string; path: string; shape: SNode | null; value: any }[] = [
      { label: `Previous activity: ${from.name}`, path: 'input', shape: design[from.id]?.out ?? (inputValue !== undefined ? inferShape(inputValue, 'input') : null), value: inputValue },
      { label: 'Local variables', path: 'vars', shape: vars, value: run?.vars || localVars },
      { label: 'Project properties', path: 'gv', shape: { name: 'gv', type: 'object', children: projectVars.map(v => ({ name: v.name, type: v.type === 'number' ? 'number' : v.type === 'boolean' ? 'boolean' : 'string', doc: v.description })) }, value: Object.fromEntries(projectVars.map(v => [v.name, v.type === 'secret' ? '••••••' : v.value])) },
    ];
    if (engineVars.length) list.push({ label: 'Engine properties (read only)', path: 'ev', shape: { name: 'ev', type: 'object', children: engineVars.map(v => ({ name: v.name, type: 'string' as const, doc: v.description })) }, value: Object.fromEntries(engineVars.map(v => [v.name, v.value])) });
    if (trigger) list.push({ label: 'Trigger data', path: 'trigger', shape: design[trigger.id]?.out ?? (outputs[trigger.name] !== undefined ? inferShape(outputs[trigger.name], 'trigger') : null), value: outputs[trigger.name] });
    for (const n of doc.nodes.filter(n => ancestorIds.has(n.id))) list.push({ label: n.name, path: `nodes${seg(n.name)}`, shape: design[n.id]?.out ?? (outputs[n.name] !== undefined ? inferShape(outputs[n.name], n.name) : null), value: outputs[n.name] });
    list.push({ label: 'Current time', path: 'now', shape: { name: 'now', type: 'string' }, value: new Date().toISOString() });
    return list;
  }, [design, doc, engineVars, from, localVars, meta.activities, outputs, project?.config.variables, run?.vars]);
  return (
    <div className="condition-data">
      <div className="mhead"><b>Condition data</b><input className="inp" placeholder="Filter" aria-label="Filter condition data" value={filter} onChange={e => setFilter(e.target.value)} /></div>
      <div className="condition-tree">
        {roots.map(root => <SourceNode key={root.path} {...root} state="none" depth={0} filter={filter.toLowerCase()} onToggle={() => {}} onPick={onPick} />)}
      </div>
      <div className="hint">Click a field to insert its reference into Condition.</div>
    </div>
  );
}

// ---------- left tree ----------
function SourceNode({ label, path, shape, value, state, depth, filter, onToggle, onPick }: {
  label: string; path: string; shape: SNode | null; value: any; state?: 'ran' | 'skipped' | 'none'; depth: number; filter: string; onToggle(): void; onPick(path: string): void;
}) {
  // Activities and the current item start open; the $_ system roots start closed.
  const [open, setOpen] = useState(!!filter || (depth < 1 && !path.match(/^(gv|ev|process|vars|index)$/)));
  useEffect(() => { if (filter) setOpen(true); }, [filter]);
  const s = shape ?? (value !== undefined ? inferShape(value, label) : null);
  const kids = s?.children || [];
  const shown = Array.isArray(value) ? value[0] : value;
  const matches = (n: SNode): boolean => n.name.toLowerCase().includes(filter) || (n.children || []).some(matches);
  if (filter && depth > 0 && s && !matches(s)) return null;
  const drag = (e: DragEvent) => {
    e.stopPropagation();
    e.dataTransfer.setData(PATH_MIME, JSON.stringify({ path, repeats: !!s?.repeats, children: kids.map(k => k.name) }));
    e.dataTransfer.setData('text/plain', `{${path}}`);
    e.dataTransfer.effectAllowed = 'copy';
  };
  const leafValue = kids.length ? (Array.isArray(value) ? `${value.length} item${value.length === 1 ? '' : 's'}` : '') : shown === undefined ? '' : typeof shown === 'object' ? JSON.stringify(shown) : String(shown);
  return (
    <div className="snode">
      <div className={`srow${depth === 0 ? ' root' : ''}${state === 'skipped' ? ' skipped' : ''}`} data-ref={path} draggable onDragStart={drag} onClick={() => onPick(path)} title={`{${path}}${s?.doc ? '\n' + s.doc : ''}`}>
        {kids.length ? <button className="tw" aria-label={open ? 'Collapse' : 'Expand'} onClick={e => { e.stopPropagation(); setOpen(o => !o); requestAnimationFrame(onToggle); }}>{open ? '▾' : '▸'}</button> : <span className="tw" />}
        <span className={`ty t-${s?.type || 'any'}`}>{TYPE_ICON[s?.type || 'any']}</span>
        <span className="nm">{label}{s?.repeats ? <span className="rep" title="Repeating (list)">*</span> : null}{s?.required ? <span className="req">*</span> : null}</span>
        {state === 'skipped' && depth === 0 ? <span className="badge">not run</span> : leafValue ? <span className="val">{leafValue.length > 40 ? leafValue.slice(0, 40) + '…' : leafValue}</span> : null}
      </div>
      {open && kids.length > 0 && (
        <div className="skids">
          {kids.map(k => (
            <SourceNode key={k.name} label={k.name} path={path + seg(k.name)} shape={k} value={shown && typeof shown === 'object' ? shown[k.name] : undefined} depth={depth + 1} filter={filter} onToggle={onToggle} onPick={onPick} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- right tree ----------
function useTargets(act: ActivityMeta, node: FlowNode, d: NodeDesign | undefined): Target[] {
  return useMemo(() => {
    const out: Target[] = [];
    for (const f of act.fields) {
      if (!visible(f, node.config, act.fields)) continue;
      if (f.type === 'mapping') {
        const tree = d?.inputTrees?.[f.k];
        const walk = (n: SNode, p: string) => {
          for (const c of n.children || []) {
            const cp = p ? `${p}/${c.name}` : c.name;
            out.push({ kind: 'map', id: `m:${f.k}:${cp}`, fieldKey: f.k, path: cp, snode: c });
            walk(c, cp);
          }
        };
        if (tree) walk(tree, '');
      } else if (f.tpl && f.type === 'kv') {
        ((node.config[f.k] as any[]) || []).forEach((r, i) => out.push({ kind: 'kv', id: `kv:${f.k}:${i}`, fieldKey: f.k, index: i, label: r?.k || `(row ${i + 1})`, field: f }));
      } else if (f.tpl) out.push({ kind: 'field', id: `f:${f.k}`, fieldKey: f.k, label: f.label, field: f });
    }
    return out;
  }, [act, node.config, d]);
}

function summary(v: unknown): string {
  if (v == null || v === '') return '';
  if (typeof v === 'string') return v.replace(/\s+/g, ' ');
  const r = v as MapRule;
  return (r.expr || (r.choose?.length ? 'choose…' : '') || '').replace(/\s+/g, ' ');
}

function TargetTree({ act, node, design, sel, setSel, getVal, dropOn, setCfg, autoMap, onToggle }: {
  act: ActivityMeta; node: FlowNode; design?: NodeDesign; sel: string | null; setSel(id: string): void;
  getVal(t: Target): any; dropOn(t: Target, p: { path: string; repeats: boolean; children?: string[] }): void;
  setCfg(k: string, v: any): void; autoMap(fieldKey: string, tree: SNode): number; onToggle(): void;
}) {
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [newPath, setNewPath] = useState<Record<string, string>>({});
  const row = (t: Target, label: ReactNode, depth: number, extra?: ReactNode, sn?: SNode) => {
    const v = getVal(t);
    const r = t.kind === 'map' ? (v as MapRule | undefined) : undefined;
    const accept = (e: DragEvent) => { if (e.dataTransfer.types.includes(PATH_MIME)) { e.preventDefault(); e.currentTarget.classList.add('dropping'); } };
    return (
      <div key={t.id} data-target={t.id} className={`trow${sel === t.id ? ' sel' : ''}`} style={{ paddingLeft: 6 + depth * 14 }}
        onClick={() => setSel(t.id)} onDragOver={accept} onDragLeave={e => e.currentTarget.classList.remove('dropping')}
        onDrop={e => { e.currentTarget.classList.remove('dropping'); const raw = e.dataTransfer.getData(PATH_MIME); if (raw) { e.preventDefault(); dropOn(t, JSON.parse(raw)); setSel(t.id); } }}>
        {extra ?? <span className="tw" />}
        {sn && <span className={`ty t-${sn.type}`}>{TYPE_ICON[sn.type]}</span>}
        <span className="nm">{label}{sn?.repeats ? <span className="rep">*</span> : null}{sn?.required ? <span className="req" title="Required">*</span> : null}</span>
        {r?.forEach && <span className="stmt fe" title={`For-Each ${r.forEach}${r.where ? `
Where ${r.where}` : ''}${r.groupBy ? `
Group by ${r.groupBy}` : ''}`}>For-Each{r.where ? ' · where' : ''}{r.groupBy ? ' · group' : ''}{r.sortBy ? ' · sort' : ''}</span>}
        {r?.ifCond && <span className="stmt if" title={`If ${r.ifCond}`}>If</span>}
        {r?.choose?.length ? <span className="stmt ch">Choose</span> : null}
        <span className="fx">{summary(v)}</span>
      </div>
    );
  };
  const out: ReactNode[] = [];
  for (const f of act.fields) {
    if (!visible(f, node.config, act.fields)) continue;
    if (f.type === 'mapping') {
      const tree = design?.inputTrees?.[f.k];
      const m = (node.config[f.k] || { rules: {} }) as { rules: Record<string, MapRule>; fields?: string[] };
      const schemaKey = f.schemaField;
      out.push(
        <div key={`g:${f.k}`} className="tgroup">
          <span className="nm">{f.label}</span>
          <span className="muted" style={{ fontSize: 11 }}>{schemaKey && node.config[schemaKey] ? 'from schema' : 'fields added here'}</span>
          {tree && <button className="btn small" onClick={() => { const n = autoMap(f.k, tree); if (!n) alert('No fields with matching names in the previous step'); }}>Auto map</button>}
        </div>,
      );
      const walk = (n: SNode, p: string, depth: number) => {
        for (const c of n.children || []) {
          const cp = p ? `${p}/${c.name}` : c.name;
          const has = !!c.children?.length;
          const key = `${f.k}:${cp}`;
          out.push(row({ kind: 'map', id: `m:${f.k}:${cp}`, fieldKey: f.k, path: cp, snode: c }, c.name, depth,
            has ? <button className="tw" aria-label={closed[key] ? 'Expand' : 'Collapse'} onClick={e => { e.stopPropagation(); setClosed(s => ({ ...s, [key]: !s[key] })); requestAnimationFrame(onToggle); }}>{closed[key] ? '▸' : '▾'}</button> : undefined, c));
          if (has && !closed[key]) walk(c, cp, depth + 1);
        }
      };
      if (tree) walk(tree, '', 1);
      if (!(schemaKey && node.config[schemaKey])) {
        out.push(
          <div key={`add:${f.k}`} className="tadd">
            <input className="inp code" placeholder="customer/name or lines[]/sku" aria-label="New target field path" value={newPath[f.k] || ''} onChange={e => setNewPath(s => ({ ...s, [f.k]: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') (e.currentTarget.nextSibling as HTMLButtonElement)?.click(); }} />
            <button className="btn small" disabled={!newPath[f.k]?.trim()} onClick={() => {
              const p = newPath[f.k].trim().replace(/^\/+|\/+$/g, '').replace(/\./g, '/');
              setCfg(f.k, { ...m, rules: m.rules || {}, fields: [...new Set([...(m.fields || []), p])] });
              setNewPath(s => ({ ...s, [f.k]: '' }));
            }}>+ Field</button>
          </div>,
        );
      }
    } else if (f.tpl && f.type === 'kv') {
      const rows = (node.config[f.k] as any[]) || [];
      out.push(<div key={`g:${f.k}`} className="tgroup"><span className="nm">{f.label}</span><button className="btn small" onClick={() => setCfg(f.k, [...rows, { k: '', v: '' }])}>+ Row</button></div>);
      rows.forEach((r, i) => out.push(row({ kind: 'kv', id: `kv:${f.k}:${i}`, fieldKey: f.k, index: i, label: r?.k, field: f },
        <input className="kvkey" value={r?.k ?? ''} placeholder="name" aria-label={`${f.label} name ${i + 1}`} onClick={e => e.stopPropagation()}
          onChange={e => setCfg(f.k, rows.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))} />, 1,
        <button className="tw" aria-label="Remove row" onClick={e => { e.stopPropagation(); setCfg(f.k, rows.filter((_, j) => j !== i)); }}>✕</button>)));
    } else if (f.tpl) out.push(row({ kind: 'field', id: `f:${f.k}`, fieldKey: f.k, label: f.label, field: f }, f.label, 0));
  }
  if (!out.length) return <p className="muted" style={{ padding: 8 }}>This activity has no mappable inputs. Its settings are in the General tab.</p>;
  return <div>{out}</div>;
}

// ---------- formula editor ----------
function FormulaEditor({ t, value, setVal, scope, functions, relativize }: {
  t: Target; value: any; setVal(v: any): void; scope: Record<string, any>;
  functions: { name: string; group: string; sig: string; help: string; example?: string }[];
  relativize(p: string): string;
}) {
  const isMap = t.kind === 'map';
  const rule: MapRule = isMap ? (value || {}) : {};
  const [focusKey, setFocusKey] = useState<string>('expr');
  const refs = useRef<Record<string, HTMLTextAreaElement | HTMLInputElement | null>>({});
  const [group, setGroup] = useState('String');
  const [fnFilter, setFnFilter] = useState('');
  const [preview, setPreview] = useState<{ ok: boolean; value?: any; error?: string } | null>(null);
  const groups = [...new Set(functions.map(f => f.group))];
  const expr = isMap ? rule.expr ?? '' : String(value ?? '');

  const update = (k: keyof MapRule | 'raw', v: any) => {
    if (!isMap) { setVal(v); return; }
    setVal({ ...rule, [k]: v || undefined });
  };
  const insert = (text: string, key = focusKey) => {
    const focusKey = key;
    const el = refs.current[focusKey] || refs.current.expr;
    if (!el) return;
    const s = el.selectionStart ?? el.value.length, e = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, s) + text + el.value.slice(e);
    if (focusKey.startsWith('when') || focusKey.startsWith('val')) {
      const i = Number(focusKey.slice(4));
      const ch = [...(rule.choose || [])];
      ch[i] = { ...ch[i], [focusKey.startsWith('when') ? 'when' : 'expr']: next };
      update('choose', ch);
    } else update(focusKey as keyof MapRule, next);
    requestAnimationFrame(() => { el.focus(); const c = s + text.length - (text.endsWith('()') ? 1 : 0); try { el.setSelectionRange(c, c); } catch { /* ignore */ } });
  };

  // Live preview of the main formula against the last run's data.
  useEffect(() => {
    if (!expr.trim()) { setPreview(null); return; }
    const timer = setTimeout(() => {
      post('/api/expr/eval', isMap ? { expr, scope } : { expr, scope, mode: 'field' })
        .then(setPreview)
        .catch(e => setPreview({ ok: false, error: e.message }));
    }, 300);
    return () => clearTimeout(timer);
  }, [expr, isMap, scope]);

  const dropText = (key: string) => ({
    onFocus: () => setFocusKey(key),
    onDragOver: (e: DragEvent) => { if (e.dataTransfer.types.includes(PATH_MIME)) e.preventDefault(); },
    onDrop: (e: DragEvent) => {
      const raw = e.dataTransfer.getData(PATH_MIME);
      if (!raw) return;
      e.preventDefault();
      setFocusKey(key);
      const p = relativize(JSON.parse(raw).path);
      const tmpl = !isMap && !String(value ?? '').startsWith('=') && String(value ?? '').trim() !== '';
      insert(tmpl ? `{{${p}}}` : `{${p}}`, key);
    },
  });
  const ta = (key: string, val: string, placeholder: string, rows = 2) => (
    <textarea ref={el => { refs.current[key] = el; }} className="inp code" rows={rows} spellCheck={false} value={val} placeholder={placeholder}
      onChange={e => update(key as keyof MapRule, e.target.value)} {...dropText(key)} />
  );
  const fns = functions.filter(f => (fnFilter ? (f.name + f.help).toLowerCase().includes(fnFilter.toLowerCase()) : f.group === group));
  const label = t.kind === 'map' ? t.path.split('/').join(' / ') : t.kind === 'kv' ? `${t.field.label}: ${t.label}` : t.label;

  return (
    <div className="feditor">
      <div className="fe-main">
        <div className="sub">{label}{isMap && t.snode.repeats ? ' (repeating)' : ''}</div>
        {isMap ? (
          <>
            {t.snode.repeats && (
              <div className="fld fe-box">
                <label>For-Each (one element per item of)</label>{ta('forEach', rule.forEach ?? '', '{nodes.Read file.rows}', 1)}
                <div className="hint">Inside, map children from <code>{'{item.x}'}</code>; <code>{'{index}'}</code> or <code>position()</code> is the position, <code>last()</code> the count.</div>
                {rule.forEach && <>
                  <label style={{ marginTop: 6 }}>Where (keep rows where true)</label>{ta('where', rule.where ?? '', "upper-case(Country) = 'INDIA'", 1)}
                  <label style={{ marginTop: 6 }}>Group by (one element per distinct value)</label>{ta('groupBy', rule.groupBy ?? '', 'City', 1)}
                  {rule.groupBy && <div className="hint">In each group: <code>{'{group.key}'}</code>, <code>{'{group.items}'}</code>, <code>{'{group.count}'}</code>, e.g. <code>{"sum({group.items}, 'Amount')"}</code>.</div>}
                  <label style={{ marginTop: 6 }}>Sort by</label>
                  <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>{ta('sortBy', rule.sortBy ?? '', 'Amount', 1)}
                    <label className="check" style={{ whiteSpace: 'nowrap' }}><input type="checkbox" checked={!!rule.sortDesc} onChange={e => setVal({ ...rule, sortDesc: e.target.checked || undefined })} /> descending</label></div>
                  <div className="hint">Where, Group by and Sort by use the row's column names directly (no braces needed).</div>
                </>}
              </div>
            )}
            <div className="fld"><label>{t.snode.children?.length ? 'Copy whole value from (optional)' : 'Formula'}</label>{ta('expr', rule.expr ?? '', "concat('Name : ', {input.name})", 3)}</div>
            {!t.snode.children?.length && (
              <div className="fld">
                <label>Choose (first true condition wins)</label>
                {(rule.choose || []).map((c, i) => (
                  <div className="kv" key={i} style={{ gridTemplateColumns: '1fr 1fr auto' }}>
                    <input ref={el => { refs.current['when' + i] = el; }} className="inp code" placeholder="When: count({input.Mobile}) > 0" value={c.when}
                      onChange={e => { const ch = [...rule.choose!]; ch[i] = { ...c, when: e.target.value }; update('choose', ch); }} {...dropText('when' + i)} />
                    <input ref={el => { refs.current['val' + i] = el; }} className="inp code" placeholder="Value: 'Mobile'" value={c.expr}
                      onChange={e => { const ch = [...rule.choose!]; ch[i] = { ...c, expr: e.target.value }; update('choose', ch); }} {...dropText('val' + i)} />
                    <button className="x" aria-label="Remove branch" onClick={() => update('choose', rule.choose!.filter((_, j) => j !== i))}>✕</button>
                  </div>
                ))}
                <button className="btn small" onClick={() => update('choose', [...(rule.choose || []), { when: '', expr: '' }])}>+ When</button>
                {(rule.choose?.length ?? 0) > 0 && <div style={{ marginTop: 6 }}>{ta('otherwise', rule.otherwise ?? '', "Otherwise: 'Other'", 1)}</div>}
              </div>
            )}
            <div className="fld"><label>If (include only when true)</label>{ta('ifCond', rule.ifCond ?? '', 'exists({input.middleName})', 1)}</div>
            <button className="btn small danger" onClick={() => setVal(null)}>Clear mapping</button>
          </>
        ) : (
          <div className="fld">
            <textarea ref={el => { refs.current.expr = el; }} className="inp code" rows={t.kind === 'field' && (t.field.type === 'code' || t.field.type === 'textarea') ? 6 : 3} spellCheck={false}
              value={String(value ?? '')} onChange={e => setVal(e.target.value)} {...dropText('expr')} />
            <div className="hint">Start with <code>=</code> for a formula, e.g. <code>{"=concat('Order ', {input.id})"}</code>; plain text may contain <code>{'{{input.x}}'}</code> templates.</div>
          </div>
        )}
        {preview && (preview.ok
          ? <div className="okbox mono" style={{ whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto' }}>= {typeof preview.value === 'object' ? JSON.stringify(preview.value, null, 1) : String(preview.value)}</div>
          : <div className="errbox mono">{preview.error}</div>)}
      </div>
      <div className="fe-fns">
        <input className="inp" placeholder="Search functions" aria-label="Search functions" value={fnFilter} onChange={e => setFnFilter(e.target.value)} />
        {!fnFilter && <div className="fgroups">{groups.map(g => <button key={g} className={g === group ? 'act' : ''} onClick={() => setGroup(g)}>{g}</button>)}</div>}
        <ul className="flist">
          {fns.map(f => (
            <li key={f.name}><button title={`${f.sig}\n${f.help}${f.example ? '\n' + f.example : ''}`} onMouseDown={e => e.preventDefault()} onClick={() => insert(`${f.name}()`)}>
              <code>{f.name}</code><span className="muted">{f.help}</span>
            </button></li>
          ))}
        </ul>
      </div>
    </div>
  );
}
