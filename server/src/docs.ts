/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { engine } from './engine/engine.js';
import type { Field, FlowDoc, FlowNode } from './engine/types.js';
import { variablesUsed } from './flows.js';

/**
 * Documentation made from Sutras: what starts each one, its steps in run order with the
 * descriptions the designer wrote, their settings (secrets by name only), where each step goes
 * next, error handling, connections and variables. Markdown for repositories and wikis, HTML to
 * read and print. Used by the designer (Documentation), `sutra doc` and release zips.
 */

export interface DocResource { id: string; name: string; kind: string; config?: Record<string, any> }
export interface DocSutra { id?: string; doc: FlowDoc; version?: number; deployed?: boolean; folder?: string }
export interface DocProject { name: string; description?: string; variables?: { name: string; type: string; value?: unknown; description?: string }[] }

interface StepInfo {
  n: FlowNode; activity: string; trigger: boolean; glyph: string;
  settings: [string, string][]; next: string[]; handled: boolean; uses: string[];
}
interface SutraInfo {
  name: string; description: string; version?: number; deployed?: boolean; folder?: string;
  starts: string[]; steps: StepInfo[]; undescribed: string[]; connections: DocResource[]; projectVariables: string[]; sutraVariables: NonNullable<FlowDoc['variables']>;
}

const holds = (c: { k: string; in: any[] }, values: Record<string, any>, all: Field[]): boolean => {
  const dep = all.find(x => x.k === c.k);
  if (dep && !visible(dep, values, all)) return false;
  return c.in.includes(values[c.k] ?? dep?.def);
};
function visible(f: Field, values: Record<string, any>, all: Field[]): boolean {
  if (f.showIf && !holds(f.showIf, values, all)) return false;
  if (f.showIfAny && !f.showIfAny.some(c => holds(c, values, all))) return false;
  return true;
}

/** A setting as words: connections by name, secrets by name, lists and tables on one line. */
function valueText(f: Field, v: unknown, res: Map<string, DocResource>, sutras: Map<string, string>): string {
  if (v === undefined || v === null || v === '') return '';
  if (f.type === 'resource') return res.get(String(v))?.name ? `${res.get(String(v))!.name}` : String(v);
  if (f.type === 'process') return sutras.get(String(v)) || String(v);
  if (f.type === 'secret') return `secret ${v}`;
  if (f.type === 'bool') return v ? 'yes' : 'no';
  if (f.type === 'kv' && Array.isArray(v)) return v.filter((r: any) => r?.k).map((r: any) => `${r.k} = ${typeof r.v === 'string' ? r.v : JSON.stringify(r.v)}`).join('; ');
  if (f.type === 'mapping') return 'mapped (see the Input tab)';
  if (Array.isArray(v)) return v.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v);
  return s.length > 400 ? `${s.slice(0, 400)}…` : s;
}

/** Steps in the order a run reaches them: from the triggers (or steps nothing leads to), breadth first. */
function runOrder(doc: FlowDoc) {
  const into = new Set(doc.edges.map(e => e.to));
  const starts = doc.nodes.filter(n => engine.activity(n.type)?.trigger || !into.has(n.id));
  const seen = new Set<string>(), order: FlowNode[] = [];
  const queue = [...starts];
  while (queue.length) {
    const n = queue.shift()!;
    if (seen.has(n.id)) continue;
    seen.add(n.id); order.push(n);
    for (const e of doc.edges.filter(x => x.from === n.id).sort((a, b) => (a.port === 'error' ? 1 : 0) - (b.port === 'error' ? 1 : 0))) {
      const t = doc.nodes.find(x => x.id === e.to);
      if (t && !seen.has(t.id)) queue.push(t);
    }
  }
  return [...order, ...doc.nodes.filter(n => !seen.has(n.id))];
}

function describe(s: DocSutra, resources: DocResource[], allSutras: Map<string, string>): SutraInfo {
  const doc = s.doc;
  const res = new Map(resources.map(r => [r.id, r]));
  const used = new Set<string>();
  const byId = new Map(doc.nodes.map(n => [n.id, n]));
  const steps = runOrder(doc).map(n => {
    const a = engine.activity(n.type);
    const fields = (a?.fields || []).filter(f => visible(f, n.config || {}, a!.fields));
    const settings: [string, string][] = [];
    for (const f of fields) {
      const t = valueText(f, n.config?.[f.k] ?? undefined, res, allSutras);
      if (!t) continue;
      if (f.type === 'resource' && res.has(String(n.config[f.k]))) used.add(String(n.config[f.k]));
      settings.push([f.label, t]);
    }
    const st = n.settings || {};
    if (st.retries) settings.push(['Retries', `${st.retries}${st.retryDelayMs ? `, ${st.retryDelayMs} ms apart` : ''}`]);
    if (st.timeoutMs) settings.push(['Time limit', `${st.timeoutMs} ms`]);
    if (st.loop) settings.push(['Loop', st.loop === 'for each item' ? `once per item of ${st.loopOver || ''}` : `while ${st.loopWhile || ''}`]);
    if (st.disabled) settings.push(['Disabled', 'yes: skipped when the Sutra runs']);
    const out = doc.edges.filter(e => e.from === n.id);
    const next = out.map(e => {
      const to = byId.get(e.to)?.name || e.to;
      const cond = e.when === 'when' && e.condition ? ` when ${e.condition}` : e.when === 'otherwise' ? ' otherwise' : '';
      const port = e.port && e.port !== 'out' ? `${e.port}: ` : '';
      return `${port}${to}${cond}${e.label ? ` (${e.label})` : ''}`;
    });
    const usesNames = [...new Set(fields.filter(f => f.type === 'resource' && n.config?.[f.k] && res.has(String(n.config[f.k]))).map(f => res.get(String(n.config[f.k]))!.name))];
    return { n, activity: a?.name || n.type, trigger: !!a?.trigger, glyph: a?.glyph || '', settings, next, handled: out.some(e => e.port === 'error'), uses: usesNames };
  });
  const starts = steps.filter(x => x.trigger).map(x => `${x.activity}: ${x.n.name}${x.settings.length ? ` (${x.settings.slice(0, 3).map(([k, v]) => `${k} ${v}`).join(', ')})` : ''}`);
  return {
    name: doc.name, description: doc.description || '', version: s.version, deployed: s.deployed, folder: s.folder,
    starts: starts.length ? starts : ['Started by hand, by Call Sutra from another Sutra, or by the Run API'],
    steps, undescribed: steps.filter(x => !x.n.description).map(x => x.n.name),
    connections: resources.filter(r => used.has(r.id)),
    projectVariables: variablesUsed(doc), sutraVariables: doc.variables || [],
  };
}

// ---------- Markdown ----------
const md = (s: string) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

function sutraMarkdown(i: SutraInfo, level = 1) {
  const h = '#'.repeat(level);
  const L: string[] = [];
  L.push(`${h} ${i.name}`, '');
  if (i.description) L.push(i.description, '');
  const status = [i.folder ? `Folder ${i.folder}` : '', i.version ? `version ${i.version}` : '', i.deployed === undefined ? '' : i.deployed ? 'deployed' : 'not deployed'].filter(Boolean).join(', ');
  if (status) L.push(`*${status}*`, '');
  L.push(`${h}# How it starts`, '', ...i.starts.map(s => `- ${s}`), '');
  L.push(`${h}# Steps`, '', '| # | Step | Activity | What it does |', '|---|---|---|---|');
  i.steps.forEach((s, k) => L.push(`| ${k + 1} | ${md(s.n.name)} | ${md(s.activity)} | ${md(s.n.description || '')} |`));
  L.push('');
  i.steps.forEach((s, k) => {
    L.push(`${h}## ${k + 1}. ${s.n.name} (${s.activity})`, '');
    if (s.n.description) L.push(s.n.description, '');
    if (s.settings.length) { L.push('| Setting | Value |', '|---|---|', ...s.settings.map(([a, b]) => `| ${md(a)} | ${md(b)} |`), ''); }
    L.push(s.next.length ? `Next: ${s.next.join('; ')}.` : 'Next: the run ends here.');
    if (s.handled) L.push('Errors: handled by the error branch.');
    L.push('');
  });
  if (i.connections.length) L.push(`${h}# Connections`, '', ...i.connections.map(r => `- ${r.name} (${r.kind})`), '');
  if (i.projectVariables.length || i.sutraVariables.length) {
    L.push(`${h}# Variables`, '');
    if (i.projectVariables.length) L.push(`Project variables used: ${i.projectVariables.join(', ')}.`, '');
    if (i.sutraVariables.length) L.push('| Sutra variable | Type | Initial value |', '|---|---|---|', ...i.sutraVariables.map(v => `| ${md(v.name)} | ${md(v.type || "")} | ${md(String(v.value ?? ''))} |`), '');
  }
  if (i.undescribed.length) L.push(`> Steps without a description: ${i.undescribed.join(', ')}. Add one in each step's General tab.`, '');
  return L.join('\n');
}

// ---------- HTML ----------
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const anchor = (s: string) => 's-' + s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function sutraHtml(i: SutraInfo, level = 1) {
  const h = (n: number) => `h${Math.min(6, level + n)}`;
  const status = [i.folder ? `Folder ${i.folder}` : '', i.version ? `version ${i.version}` : '', i.deployed === undefined ? '' : i.deployed ? 'deployed' : 'not deployed'].filter(Boolean).join(' · ');
  return `<section class="sutra" id="${anchor(i.name)}">
<${h(0)}>${esc(i.name)}</${h(0)}>
${status ? `<p class="meta">${esc(status)}</p>` : ''}${i.description ? `<p class="lead">${esc(i.description)}</p>` : ''}
<${h(1)}>How it starts</${h(1)}><ul>${i.starts.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
<${h(1)}>Steps</${h(1)}>
<table><thead><tr><th>#</th><th>Step</th><th>Activity</th><th>What it does</th></tr></thead><tbody>
${i.steps.map((s, k) => `<tr><td>${k + 1}</td><td><a href="#${anchor(i.name)}-${k + 1}">${esc(s.n.name)}</a></td><td>${esc(s.glyph)} ${esc(s.activity)}</td><td>${s.n.description ? esc(s.n.description) : '<span class="none">no description</span>'}</td></tr>`).join('\n')}
</tbody></table>
${i.steps.map((s, k) => `<div class="step" id="${anchor(i.name)}-${k + 1}"><${h(2)}>${k + 1}. ${esc(s.n.name)} <small>${esc(s.activity)}</small></${h(2)}>
${s.n.description ? `<p>${esc(s.n.description)}</p>` : ''}${s.settings.length ? `<table class="kv">${s.settings.map(([a, b]) => `<tr><th>${esc(a)}</th><td>${esc(b)}</td></tr>`).join('')}</table>` : ''}
<p class="next"><b>Next:</b> ${s.next.length ? esc(s.next.join('; ')) : 'the run ends here'}.${s.handled ? ' <b>Errors:</b> handled by the error branch.' : ''}</p></div>`).join('\n')}
${i.connections.length ? `<${h(1)}>Connections</${h(1)}><ul>${i.connections.map(r => `<li>${esc(r.name)} <span class="meta">${esc(r.kind)}</span></li>`).join('')}</ul>` : ''}
${i.projectVariables.length ? `<${h(1)}>Project variables used</${h(1)}><p>${i.projectVariables.map(v => `<code>${esc(v)}</code>`).join(', ')}</p>` : ''}
${i.sutraVariables.length ? `<${h(1)}>Sutra variables</${h(1)}><table><thead><tr><th>Name</th><th>Type</th><th>Initial value</th></tr></thead><tbody>${i.sutraVariables.map(v => `<tr><td><code>${esc(v.name)}</code></td><td>${esc(v.type || "")}</td><td>${esc(String(v.value ?? ''))}</td></tr>`).join('')}</tbody></table>` : ''}
${i.undescribed.length ? `<p class="warn">Steps without a description: ${esc(i.undescribed.join(', '))}. Add one in each step's General tab.</p>` : ''}
</section>`;
}

const STYLE = `:root{--ink:#1d2330;--muted:#5f6b7a;--line:#d9dee6;--paper:#f6f7f9;--accent:#3b6fd8;--warn:#a5600b}
@media (prefers-color-scheme: dark){:root{--ink:#e6e9ef;--muted:#9aa5b4;--line:#333a46;--paper:#1b1f27;--accent:#7aa2ff;--warn:#e0a34a}body{background:#12151b}}
body{font:15px/1.55 system-ui,Segoe UI,sans-serif;color:var(--ink);max-width:980px;margin:0 auto;padding:24px 16px}
h1{font-size:26px}h2{font-size:21px;margin-top:34px;border-top:1px solid var(--line);padding-top:18px}h3{font-size:17px}h4{font-size:15px}
small,.meta,.none{color:var(--muted);font-weight:400}.lead{font-size:16px}
table{border-collapse:collapse;width:100%;margin:8px 0 14px;font-size:14px}th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
table.kv th{width:30%;color:var(--muted);font-weight:500}td{overflow-wrap:anywhere}
.step{background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:4px 14px 6px;margin:10px 0}
.warn{color:var(--warn)}code{font-family:ui-monospace,Consolas,monospace;font-size:13px}a{color:var(--accent)}
nav ul{columns:2}@media (max-width:640px){nav ul{columns:1}}@media print{.step{break-inside:avoid}}`;

const page = (title: string, body: string, made: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${STYLE}</style></head>
<body>${body}<p class="meta">Made by SutraFlow ${esc(made)} from the Sutras and the descriptions of their steps.</p></body></html>`;

/** Documentation of one Sutra. */
export function sutraDocumentation(s: DocSutra, o: { resources: DocResource[]; sutras?: { id: string; name: string }[]; made?: string }) {
  const info = describe(s, o.resources, new Map((o.sutras || []).map(x => [x.id, x.name])));
  return { markdown: sutraMarkdown(info), html: page(info.name, sutraHtml(info), o.made || ''), undescribed: info.undescribed };
}

/** Documentation of a whole project: variables, connections, then every Sutra. */
export function projectDocumentation(p: DocProject, sutras: DocSutra[], o: { resources: DocResource[]; made?: string; version?: string }) {
  const names = new Map(sutras.map(s => [s.id || '', s.doc.name]));
  const infos = [...sutras].sort((a, b) => `${a.folder || ''}/${a.doc.name}`.localeCompare(`${b.folder || ''}/${b.doc.name}`)).map(s => describe(s, o.resources, names));
  const conns = o.resources;
  const vars = p.variables || [];
  const title = `${p.name}${o.version ? ` ${o.version}` : ''}`;
  const markdown = [
    `# ${title}`, '', p.description || '', '',
    '## Sutras', '', '| Sutra | Folder | Starts by | Steps |', '|---|---|---|---|',
    ...infos.map(i => `| ${md(i.name)} | ${md(i.folder || '')} | ${md(i.starts.join('; '))} | ${i.steps.length} |`), '',
    ...(vars.length ? ['## Project variables', '', '| Name | Type | Value | Description |', '|---|---|---|---|', ...vars.map(v => `| ${md(v.name)} | ${md(v.type)} | ${md(v.type === 'secret' ? `secret ${v.value}` : String(v.value ?? ''))} | ${md(v.description || '')} |`), ''] : []),
    ...(conns.length ? ['## Connections', '', '| Name | Kind |', '|---|---|', ...conns.map(r => `| ${md(r.name)} | ${md(r.kind)} |`), ''] : []),
    ...infos.map(i => sutraMarkdown(i, 2)),
  ].join('\n');
  const body = `<h1>${esc(title)}</h1>${p.description ? `<p class="lead">${esc(p.description)}</p>` : ''}
<nav><h2>Sutras</h2><table><thead><tr><th>Sutra</th><th>Folder</th><th>Starts by</th><th>Steps</th></tr></thead><tbody>${infos.map(i => `<tr><td><a href="#${anchor(i.name)}">${esc(i.name)}</a></td><td>${esc(i.folder || '')}</td><td>${esc(i.starts.join('; '))}</td><td>${i.steps.length}</td></tr>`).join('')}</tbody></table></nav>
${vars.length ? `<h2>Project variables</h2><table><thead><tr><th>Name</th><th>Type</th><th>Value</th><th>Description</th></tr></thead><tbody>${vars.map(v => `<tr><td><code>${esc(v.name)}</code></td><td>${esc(v.type)}</td><td>${esc(v.type === 'secret' ? `secret ${v.value}` : String(v.value ?? ''))}</td><td>${esc(v.description || '')}</td></tr>`).join('')}</tbody></table>` : ''}
${conns.length ? `<h2>Connections</h2><table><thead><tr><th>Name</th><th>Kind</th></tr></thead><tbody>${conns.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.kind)}</td></tr>`).join('')}</tbody></table>` : ''}
${infos.map(i => sutraHtml(i, 2)).join('\n')}`;
  return { markdown, html: page(title, body, o.made || ''), undescribed: infos.reduce((a, i) => a + i.undescribed.length, 0) };
}

/** Documentation of a package (release zips carry it): no server data needed beyond the activities. */
export function packageDocumentation(p: { name: string; version: string; note?: string; project: { name: string; description?: string; variables?: any[] }; resources: DocResource[]; sutras: { id: string; doc: FlowDoc; version: number; deployed: boolean; folder?: string }[] }, made = '') {
  const sutras = p.sutras.map(s => ({ id: s.id, doc: s.doc, version: s.version, deployed: s.deployed, folder: s.folder }));
  return projectDocumentation({ name: p.project.name, description: [p.project.description, p.note].filter(Boolean).join(' '), variables: p.project.variables }, sutras, { resources: p.resources, made, version: p.version });
}
