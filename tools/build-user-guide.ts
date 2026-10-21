/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
/**
 * Builds docs/sutraflow-user-guide.html: one self-contained page (screenshots embedded).
 * The chapters live in tools/guide/chapters.ts and the activity advice in tools/guide/activities.ts;
 * every settings table, port list, connection type, function and pipe is read from the server code.
 *
 *   npm run guide            (screenshots: node tools/capture-guide-shots.mjs with the server running)
 */
import fs from 'node:fs';
import { profilesTable, benchmarksSection } from './guide/benchmarks.js';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allActivities, PALETTES } from '../server/src/palettes/index.js';
import { RESOURCE_KINDS } from '../server/src/resources.js';
import { functionCatalog } from '../server/src/expr.js';
import { PIPES } from '../server/src/template.js';
import { version } from '../server/src/config.js';
import type { Activity, Field } from '../server/src/engine/types.js';
import { CHAPTERS } from './guide/chapters.js';
import { ACTIVITY_TEXT } from './guide/activities.js';
import { SAMPLES } from '../server/src/samples.js';
import { LOGO_URI } from './guide/logo.js';
import { TABLE_TEXT, TABLE_GROUPS, TABLE_NOTES, schemaTables } from './guide/tables.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMG = path.join(root, 'docs', 'guide-images');
const OUT = path.join(root, 'docs', 'sutraflow-user-guide.html');

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const byType = new Map(allActivities.map(a => [a.type, a]));
const actId = (t: string) => `act-${t}`;
const missing: string[] = [];

function link(type: string) {
  const a = byType.get(type);
  if (!a) { missing.push(type); return esc(type); }
  return `<a href="#${actId(type)}">${esc(a.name)}</a>`;
}

/**
 * The help text of a command line tool as a table, read from the tool itself so the guide always
 * matches it. Lines "  name  usage  description" start a command; deeper lines continue its usage
 * (when they start with [, -- or () or its description; lines ending in ":" are group headings.
 */
function helpText(args: string[]) {
  const r = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
  if (r.status !== 0 || !r.stdout) { missing.push(`help of ${args.join(' ')}`); return ''; }
  return r.stdout;
}
function commandTable(text: string, tool: string) {
  const rows: { group?: string; cmd?: string; usage: string; desc: string; note?: string }[] = [];
  const notes: string[] = [];
  let cur: (typeof rows)[number] | null = null;
  for (const line of text.split(/\r?\n/).slice(1)) {
    if (!line.trim()) { cur = null; continue; }
    const indent = line.length - line.trimStart().length;
    const t = line.trim();
    if (indent <= 2 && /^(Remote|Exit code|Settings):?/.test(t)) { notes.push(t); cur = null; continue; }
    if (indent <= 2 && t.endsWith(':')) { rows.push({ group: t.slice(0, -1), usage: '', desc: '' }); cur = null; continue; }
    if (indent <= 2) {
      const m = /^(\S+)\s+(.*)$/.exec(t) || [t, t, ''];
      // A description starts with a capital letter; options and sub-commands do not.
      const parts = m[2].split(/\s{2,}/);
      const at = parts.findIndex(x => /^[A-Z]/.test(x));
      cur = { cmd: m[1], usage: parts.slice(0, at < 0 ? parts.length : at).join(' ').trim(), desc: at < 0 ? '' : parts.slice(at).join(' ').trim() };
      rows.push(cur);
      continue;
    }
    if (cur && !cur.desc && /^[[\-(|]/.test(t)) cur.usage += ` ${t}`;
    else if (cur) cur.desc += `${cur.desc ? ' ' : ''}${t}`;
    else if (notes.length) notes[notes.length - 1] += ` ${t}`;
  }
  const body = rows.map(r => (r.group
    ? `<tr><td colspan="2"><strong>${esc(r.group)}</strong></td></tr>`
    : `<tr><td><code>${esc(`${tool} ${r.cmd}${r.usage ? ` ${r.usage}` : ''}`)}</code></td><td>${esc(r.desc)}</td></tr>`)).join('');
  return `<table class="t cmds"><thead><tr><th>Command</th><th>What it does</th></tr></thead><tbody>${body}</tbody></table>${notes.map(n => `<p class="cmdnote">${esc(n)}</p>`).join('')}`;
}

/** SutraFlow's own tables by group: what each holds, its columns, and what is encrypted or grows. */
function tablesSection() {
  const all = schemaTables(root);
  const grouped = new Set(TABLE_GROUPS.flatMap(g => g[1]));
  for (const t of all) {
    if (!grouped.has(t.name)) missing.push(`table ${t.name} in a group of tools/guide/tables.ts`);
    if (!TABLE_TEXT[t.name]) missing.push(`description of table ${t.name}`);
  }
  return TABLE_GROUPS.map(([group, names]) => `<p class="h">${esc(group)}</p><table class="t"><thead><tr><th>Table</th><th>Holds</th><th>Columns</th></tr></thead><tbody>${names.map(n => {
    const t = all.find(x => x.name === n);
    if (!t) { missing.push(`table ${n} (listed, but not in the schema)`); return ''; }
    const note = TABLE_NOTES[n];
    const extra = [note?.encrypted ? `<span class="cond">Encrypted: ${esc(note.encrypted)}.</span>` : '', note?.grows ? `<span class="cond">Grows: ${esc(note.grows)}.</span>` : ''].filter(Boolean).join(' ');
    return `<tr><td><code>${esc(n)}</code></td><td>${esc(TABLE_TEXT[n] || '')}${extra ? ` ${extra}` : ''}</td><td class="cols">${t.cols.map(c => `<code>${esc(c)}</code>`).join(' ')}</td></tr>`;
  }).join('')}</tbody></table>`).join('');
}

/** Expands [[img:..]], [[note:..]], [[tip:..]] and [[type]] markers. */
function expand(html: string): string {
  return html
    .replace('[[commands:sutraflow]]', () => commandTable(helpText([path.join(root, 'bin', 'sutraflow.mjs'), 'help']), 'sutraflow'))
    .replace('[[commands:sutra]]', () => commandTable(helpText(['--import', 'tsx', path.join(root, 'server', 'src', 'cli.ts'), 'help']), 'sutra'))
    .replace('[[tables]]', () => tablesSection())
    .replace('[[profiles]]', () => profilesTable())
    .replace('[[benchmarks]]', () => benchmarksSection(root))
    .replace('[[samples]]', () => `<table class="t"><thead><tr><th>Sample</th><th>What it shows</th><th>Palettes</th></tr></thead><tbody>${SAMPLES.map(x => `<tr><td><strong>${esc(x.name)}</strong></td><td>${esc(x.desc)}${x.needs ? ` <span class="cond">Needs ${esc(x.needs)}.</span>` : ''}</td><td>${esc(x.palettes)}</td></tr>`).join('')}</tbody></table>`)
    .replace(/\[\[img:([\w-]+)\|([^\]]*)\]\]/g, (_m, name, cap) => {
      const f = path.join(IMG, `${name}.jpg`);
      if (!fs.existsSync(f)) { missing.push(`image ${name}`); return ''; }
      return `<figure class="shot"><img loading="lazy" alt="${esc(cap.replace(/<[^>]+>/g, ''))}" src="data:image/jpeg;base64,${fs.readFileSync(f).toString('base64')}"><figcaption>${cap}</figcaption></figure>`;
    })
    .replace(/\[\[(note|tip):([^|\]]*)\|((?:[^\]]|\](?!\]))*?)\]\]/g, (_m, kind, title, body) => `<div class="${kind}"><strong>${title}</strong><p>${expand(body)}</p></div>`)
    .replace(/\[\[(\w+)\]\]/g, (_m, t) => link(t));
}

function values(f: Field): string {
  switch (f.type) {
    case 'select': return (f.options || []).map(o => `<code>${esc(o)}</code>`).join(', ');
    case 'bool': return 'On or off';
    case 'number': return 'A number' + (f.tpl ? '' : '; may be a formula or variable');
    case 'resource': return `A <em>${esc(RESOURCE_KINDS.find(k => k.kind === f.resourceKind)?.name || f.resourceKind)}</em> from Resources`;
    case 'secret': return 'The name of a vault secret';
    case 'schema': return `A shared schema${f.schemaKinds ? ` (${f.schemaKinds.join(', ')})` : ''}`;
    case 'mapping': return 'Mapped in the Input tab';
    case 'kv': return 'Rows of name and value';
    case 'code': return 'Code or JSON';
    case 'list': return 'A list';
    default: return f.tpl ? 'Text; <code>{{ }}</code> references or an <code>=</code> formula' : 'Text; <code>{{gv.X}}</code>, <code>{{ev.X}}</code> or an <code>=</code> formula';
  }
}

function def(f: Field): string {
  const d = f.def;
  if (d === undefined || d === '' || (Array.isArray(d) && !d.length)) return '&mdash;';
  if (f.type === 'bool') return d ? 'On' : 'Off';
  if (f.type === 'mapping') return '&mdash;';
  if (Array.isArray(d)) return d.map(r => `<code>${esc(r.k)}</code>`).join(', ');
  const s = typeof d === 'object' ? JSON.stringify(d) : String(d);
  return `<code>${esc(s.length > 70 ? s.slice(0, 70) + '…' : s)}</code>`;
}

function condition(f: Field, all: Field[]): string {
  const c = f.showIf ? [f.showIf] : f.showIfAny || [];
  if (!c.length) return '';
  return ` <span class="cond">when ${c.map(x => `${esc(all.find(a => a.k === x.k)?.label || x.k)} is ${[...new Set(x.in.filter(v => v !== '' && v !== undefined).map(v => (v === true ? 'on' : v === false ? 'off' : esc(String(v)))))].join(' or ')}`).join('; or ')}</span>`;
}

function settingsTable(title: string, fields: Field[], all: Field[]) {
  if (!fields.length) return '';
  return `<p class="tabname"><em>${title}</em></p><table class="t s"><thead><tr><th>Setting</th><th>What it does</th><th>Values</th><th>Default</th></tr></thead><tbody>${fields.map(f =>
    `<tr><td><strong>${esc(f.label)}</strong>${condition(f, all)}</td><td>${f.help ? esc(f.help) : ''}</td><td>${values(f)}</td><td>${def(f)}</td></tr>`).join('')}</tbody></table>`;
}

function portsOf(a: Activity) {
  const p = typeof a.ports === 'function' ? a.ports(Object.fromEntries(a.fields.map(f => [f.k, f.def]))) : a.ports;
  const list = p.map(x => `<code>${esc(x)}</code>`);
  if (!a.trigger && !a.noErrorPort) list.push('<code class="err">error</code>');
  return { list, dynamic: typeof a.ports === 'function' };
}

const ul = (items: string[] | undefined, ordered = false) => items?.length ? `<${ordered ? 'ol' : 'ul'}>${items.map(i => `<li>${expand(i)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>` : '';

function activityEntry(a: Activity) {
  const t = ACTIVITY_TEXT[a.type];
  if (!t) missing.push(`text for ${a.type}`);
  const pal = PALETTES.find(p => p.id === a.palette)?.name || a.palette;
  const ports = portsOf(a);
  const general = a.fields.filter(f => !f.tpl && f.type !== 'mapping');
  const input = a.fields.filter(f => f.tpl || f.type === 'mapping');
  return `
<h4 id="${actId(a.type)}"><span class="glyph">${esc(a.glyph)}</span>${esc(a.name)}</h4>
<p class="meta">Palettes &rarr; <em>${esc(pal)}</em> &middot; activity type <code>${esc(a.type)}</code>${a.trigger ? ' &middot; trigger' : ''}</p>
<p>${esc(a.desc)}</p>
${t ? `<div class="scope"><div class="in"><strong>In scope</strong>${ul(t.scope)}</div><div class="out"><strong>Out of scope</strong>${ul(t.outScope)}</div></div>
<p class="h">When to use it</p>${ul(t.use)}
${t.other?.length ? `<p class="h">When to choose another activity</p><ul>${t.other.map(([w, ty]) => `<li>${expand(w)} &rarr; use ${link(ty)}.</li>`).join('')}</ul>` : ''}
<p class="h">Procedure</p>${ul(t.steps, true)}
${t.output?.length ? `<p class="h">Output</p>${ul(t.output)}` : ''}
${t.guide?.length ? `<div class="tip"><strong>Guidelines</strong>${ul(t.guide)}</div>` : ''}` : ''}
<p class="h">Outputs (ports)</p><p>${ports.list.join(' ')}${ports.dynamic ? ' <span class="cond">The outputs follow your settings; shown here with the defaults.</span>' : ''}</p>
${general.length || input.length ? `<p class="h">Settings reference</p>${settingsTable('General tab', general, a.fields)}${settingsTable('Input tab', input, a.fields)}` : ''}
<p class="foot">Also has the <a href="#ch-tabs">Settings tab</a> every activity shares: retries, timeout, skip and breakpoint.</p>`;
}

function connectionEntry(k: (typeof RESOURCE_KINDS)[number]) {
  return `<h4 id="res-${k.kind}">${esc(k.name)} connection</h4><p class="meta">Project &rarr; Resources &middot; kind <code>${esc(k.kind)}</code></p><p>${esc(k.desc)}</p>${settingsTable('Settings', k.fields, k.fields)}`;
}

function functionsChapter() {
  const fns = functionCatalog();
  const groups = [...new Set(fns.map(f => f.group))];
  return groups.map(g => `<h4 id="fn-${g.replace(/\W+/g, '-').toLowerCase()}">${esc(g)}</h4><table class="t s fn"><thead><tr><th>Function</th><th>What it does</th><th>Example</th></tr></thead><tbody>${fns.filter(f => f.group === g).map(f =>
    `<tr><td><code>${esc(f.sig)}</code></td><td>${esc(f.help)}</td><td>${f.example ? `<code>${esc(f.example)}</code>` : ''}</td></tr>`).join('')}</tbody></table>`).join('');
}

function pipesChapter() {
  return `<p>Pipes change a value inside <code>{{ }}</code>: <code>{{input.name | upper}}</code>, <code>{{input.total | number:2}}</code>, <code>{{input.note | default:"none"}}</code>. Several pipes run left to right.</p><table class="t s"><thead><tr><th>Pipe</th><th>What it does</th></tr></thead><tbody>${Object.entries(PIPES).map(([n, p]) => `<tr><td><code>${esc(n)}</code></td><td>${esc(p.help)}</td></tr>`).join('')}</tbody></table>`;
}


function build() {
  const pals = PALETTES.map(p => ({ ...p, acts: allActivities.filter(a => a.palette === p.id) })).filter(p => p.acts.length);
  const refChapters = [
    { id: 'activities', title: 'Activity reference', html: pals.map(p => `<h3 class="pal" id="pal-${p.id}">${esc(p.name)}</h3>${p.acts.map(activityEntry).join('')}`).join('') },
    { id: 'connections', title: 'Connection and security reference', html: `<p>Shared resources are created under Project &rarr; Resources. Settings that hold a secret take the <em>name</em> of a vault secret. Any text setting may use <code>{{gv.X}}</code> and <code>{{ev.X}}</code>, and the deployment config can override every setting per environment.</p>${RESOURCE_KINDS.map(connectionEntry).join('')}` },
    { id: 'functions', title: 'Function reference', html: `<p>${functionCatalog().length} functions for formulas and mappings, grouped as in the mapper's function library. Names ignore case.</p>${functionsChapter()}` },
    { id: 'pipes', title: 'Template pipes', html: pipesChapter() },
  ];
  const all = [...CHAPTERS, ...refChapters];
  const toc = all.map((c, i) => `<li><a href="#ch-${c.id}">${esc(c.title)}</a>${c.id === 'activities' ? `<ol class="sub">${pals.map(p => `<li><a href="#pal-${p.id}">${esc(p.name)}</a> <span class="n">${p.acts.length}</span></li>`).join('')}</ol>` : ''}</li>`).join('');
  const body = all.map((c, i) => `<h3 id="ch-${c.id}" class="ch">${i + 1}. ${esc(c.title)}</h3>\n${expand(c.html)}`).join('\n');

  const html = `<!doctype html>
<!-- SutraFlow ${version} | Copyright (c) 2026-27 Surya Partap Singh | Developer: Surya Partap Singh | Website: MixAgile.com | License: GNU AGPL v3.0 only (SPDX-License-Identifier: AGPL-3.0-only) -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SutraFlow User Guide</title>
<link rel="icon" href="${LOGO_URI}">
<!-- Generated by tools/build-user-guide.ts (npm run guide). Do not edit by hand. -->
<style>
:root{--ink:#1c1c1e;--muted:#6e6e73;--bg:#f2f2f7;--card:#fff;--line:rgba(60,60,67,.12);--accent:#0E7A62;--accent2:#007aff;--soft:#e8f5f1;--code:rgba(118,118,128,.12)}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--ink:#f2f2f7;--muted:#a1a1a6;--bg:#111214;--card:#1c1c1e;--line:rgba(235,235,245,.14);--soft:#12302a;--code:rgba(118,118,128,.28)}}
:root[data-theme=dark]{--ink:#f2f2f7;--muted:#a1a1a6;--bg:#111214;--card:#1c1c1e;--line:rgba(235,235,245,.14);--soft:#12302a;--code:rgba(118,118,128,.28)}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Roboto,Arial,sans-serif;color:var(--ink);line-height:1.6;-webkit-font-smoothing:antialiased;background:var(--bg)}
body::before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;background:url("${LOGO_URI}") no-repeat 70% 55%/min(78vw,900px);opacity:.07}
body::after{content:"";position:fixed;inset:0;z-index:-2;pointer-events:none;background:radial-gradient(520px 380px at 6% 2%,rgba(14,122,98,.08),transparent 70%),radial-gradient(460px 360px at 96% 10%,rgba(176,67,95,.06),transparent 70%),radial-gradient(560px 420px at 78% 62%,rgba(62,106,134,.07),transparent 70%),radial-gradient(480px 380px at 14% 88%,rgba(200,138,0,.06),transparent 70%)}
a{color:var(--accent2);text-decoration:none}a:hover{text-decoration:underline}
code{font-family:ui-monospace,'SF Mono',Consolas,monospace;font-size:.88em;background:var(--code);padding:1px 5px;border-radius:5px}
code.err{color:#d70015}
pre{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 16px;overflow:auto;font-size:.88em;line-height:1.5}
.wrap{max-width:1320px;margin:0 auto;padding:28px 24px 60px}
header.top{display:flex;align-items:center;gap:16px;margin-bottom:6px}
header.top img{width:58px;height:58px}
h1{margin:0;font-size:2.4em;font-weight:800;line-height:1.1;letter-spacing:-.02em}
.sub1{color:var(--muted);margin:0 0 18px}
.layout{display:flex;gap:26px;align-items:flex-start}
nav.toc{flex:0 0 270px;position:sticky;top:16px;max-height:calc(100vh - 32px);overflow:auto;border:1px solid var(--line);border-radius:16px;padding:14px 16px;background:color-mix(in srgb,var(--card) 85%,transparent);backdrop-filter:saturate(180%) blur(20px);box-shadow:0 8px 30px rgba(0,0,0,.06);font-size:.92em}
nav.toc ol{margin:0 0 6px 18px;padding:0}nav.toc li{margin:2px 0}nav.toc ol.sub{font-size:.92em;margin-left:14px}nav.toc .n{color:var(--muted);font-size:.85em}
#gsearch{margin:-14px -16px 12px;padding:12px 16px;background:var(--card);border-bottom:1px solid var(--line);border-radius:16px 16px 0 0}
#gsearch.dock{position:fixed;left:50%;bottom:18px;top:auto;transform:translateX(-50%);width:min(560px,calc(100vw - 32px));margin:0;border:1px solid var(--line);border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.18);z-index:20}
#gsearch input{width:100%;padding:9px 12px;border:0;border-radius:10px;font:inherit;background:var(--code);color:var(--ink);outline-color:var(--accent)}
#gres{max-height:46vh;overflow:auto}#gres a{display:block;padding:5px 8px;border-radius:8px}#gres a:hover{background:var(--code);text-decoration:none}#gres small{color:var(--muted)}
main{flex:1;min-width:0}
h3.ch{margin:56px 0 14px;padding:18px 22px;font-size:1.75em;font-weight:700;line-height:1.2;letter-spacing:-.01em;background:linear-gradient(135deg,var(--card) 0%,var(--soft) 100%);border:1px solid var(--line);border-radius:16px;box-shadow:0 2px 10px rgba(0,0,0,.05);scroll-margin-top:12px}
h3.ch:first-child{margin-top:0}
h3.pal{margin:40px 0 6px;font-size:1.3em;color:var(--accent);scroll-margin-top:12px}
h4{margin:40px 0 8px;padding:14px 18px;font-size:1.4em;font-weight:700;line-height:1.25;background:var(--card);border:1px solid var(--line);border-left:5px solid var(--accent);border-radius:14px;box-shadow:0 1px 4px rgba(0,0,0,.05);scroll-margin-top:12px;display:flex;align-items:center;gap:12px}
h4 .glyph{display:inline-grid;place-items:center;width:34px;height:34px;border-radius:9px;background:var(--soft);color:var(--accent);font-size:.8em}
.meta{color:var(--muted);font-size:.9em;margin:0 0 12px}
p.h{margin:18px 0 4px;font-weight:700}
ul,ol{padding-left:22px}li{margin:3px 0}
.scope{display:flex;flex-wrap:wrap;gap:12px;margin:12px 0}.scope>div{flex:1 1 260px;border-radius:12px;padding:12px 16px}
.scope .in{border:1px solid rgba(52,199,89,.3);background:rgba(52,199,89,.09)}.scope .out{border:1px solid rgba(255,149,0,.3);background:rgba(255,149,0,.09)}
.scope ul{margin:6px 0 0}
.note{border-left:4px solid var(--accent2);background:rgba(0,122,255,.08);border-radius:12px;padding:12px 16px;margin:18px 0}
.tip{border-left:4px solid #ffcc00;background:rgba(255,204,0,.12);border-radius:12px;padding:10px 16px;margin:14px 0}
.note p,.tip p{margin:6px 0 0}.tip ul{margin:6px 0 4px}
table.t{width:100%;border-collapse:separate;border-spacing:0;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.05);margin:6px 0 14px;font-size:.95em}
table.t th{text-align:left;border-bottom:1px solid var(--line);padding:10px 12px;font-size:.76em;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);background:color-mix(in srgb,var(--card) 92%,var(--ink))}
table.t td{border-bottom:1px solid var(--line);padding:9px 12px;vertical-align:top}table.cmds td:first-child{width:52%}table.cmds code{white-space:pre-wrap;word-break:break-word}.cmdnote{color:var(--muted);font-size:.9em;margin:4px 2px 12px}table.t tr:last-child td{border-bottom:0}
table.s td:first-child{width:24%}table.fn td:first-child{width:34%}
.cond{display:block;color:var(--muted);font-size:.82em;font-weight:400}
.tabname{margin:12px 0 2px}
.tw{overflow-x:auto;margin:6px 0 14px;border-radius:12px}.tw table.t{margin:0}
.foot{color:var(--muted);font-size:.9em}
figure.shot{margin:18px 0;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:10px;box-shadow:0 6px 24px rgba(0,0,0,.08)}
figure.shot img{width:100%;height:auto;border-radius:8px;display:block}
figcaption{color:var(--muted);font-size:.88em;padding:8px 4px 0}
#gtop{position:fixed;right:22px;bottom:22px;z-index:21;border:0;border-radius:999px;padding:10px 16px;font:600 .9em inherit;background:var(--accent);color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.2);cursor:pointer;opacity:0;pointer-events:none;transition:opacity .2s}
#gtop.on{opacity:1;pointer-events:auto}
footer{margin-top:60px;color:var(--muted);font-size:.88em;text-align:center}
mark{background:rgba(255,204,0,.45);color:inherit;border-radius:3px}
@media (max-width:900px){.layout{display:block}nav.toc{position:static;max-height:none;margin-bottom:20px}.wrap{padding:18px 16px 60px}h1{font-size:1.8em}table.t{min-width:640px}}
</style>
</head>
<body>
<div class="wrap">
<header class="top"><img src="${LOGO_URI}" alt=""><div><h1>SutraFlow User Guide</h1></div></header>
<p class="sub1">Version ${esc(version)} &middot; ${allActivities.length} activities in ${pals.length} palettes &middot; ${RESOURCE_KINDS.length} connection types &middot; ${functionCatalog().length} functions</p>
<div class="layout">
<nav class="toc">
  <div id="gsearch"><input id="gq" type="search" placeholder="Search activities, settings, chapters" aria-label="Search the guide" autocomplete="off"><div id="gres"></div></div>
  <strong style="display:block;margin-bottom:8px">Contents</strong>
  <ol>${toc}</ol>
</nav>
<main>
${body}
<footer>&copy; 2026 SutraFlow &middot; generated from SutraFlow ${esc(version)}</footer>
</main>
</div>
</div>
<button id="gtop" type="button" aria-label="Back to the top">&uarr; Top</button>
<script>
(function(){
  var idx=[].slice.call(document.querySelectorAll('main h3[id],main h4[id]')).map(function(h){
    var t='',n=h.nextElementSibling;for(var i=0;n&&i<30&&!/^H[34]$/.test(n.tagName);i++,n=n.nextElementSibling)t+=' '+n.textContent;
    var kind=h.tagName==='H3'?'Chapter':(h.id.indexOf('act-')===0?'Activity':h.id.indexOf('res-')===0?'Connection':'Functions');
    return {id:h.id,title:h.textContent.trim(),kind:kind,text:(h.textContent+' '+t).toLowerCase()};
  });
  var q=document.getElementById('gq'),r=document.getElementById('gres'),box=document.getElementById('gsearch'),top=document.getElementById('gtop');
  function show(){
    var v=q.value.trim().toLowerCase();if(!v){r.innerHTML='';return;}
    var words=v.split(/\\s+/),hits=idx.filter(function(e){return words.every(function(w){return e.text.indexOf(w)>=0;});});
    hits.sort(function(a,b){return (b.title.toLowerCase().indexOf(v)>=0)-(a.title.toLowerCase().indexOf(v)>=0);});
    r.innerHTML=hits.length?hits.slice(0,30).map(function(e){return '<a href="#'+e.id+'">'+e.title.replace(/[&<]/g,function(c){return c==='&'?'&amp;':'&lt;';})+' <small>'+e.kind+'</small></a>';}).join(''):'<small>Nothing found.</small>';
  }
  q.addEventListener('input',show);
  r.addEventListener('click',function(e){if(e.target.closest('a')){q.value='';show();}});
  var nav=box.parentNode;
  function onScroll(){var y=window.scrollY>320;top.classList.toggle('on',y);var d=y&&window.innerWidth>900;if(d!==box.classList.contains('dock')){var f=document.activeElement===q;box.classList.toggle('dock',d);if(d)document.body.appendChild(box);else nav.insertBefore(box,nav.firstChild);if(f)q.focus();}}
  window.addEventListener('scroll',onScroll,{passive:true});
  top.addEventListener('click',function(){window.scrollTo({top:0});});
  document.addEventListener('keydown',function(e){if(e.key==='/'&&document.activeElement!==q){e.preventDefault();q.focus();}});
})();
</script>
</body>
</html>
`;
  fs.writeFileSync(OUT, html.replace(/<table class="t/g, '<div class="tw"><table class="t').replace(/<\/table>/g, '</table></div>'));
  const kb = Math.round(fs.statSync(OUT).size / 1024);
  console.log(`Wrote ${path.relative(root, OUT)} (${kb} KB): ${all.length} chapters, ${allActivities.length} activities.`);
  if (missing.length) { console.error('Missing:', [...new Set(missing)].join(', ')); process.exitCode = 1; }
}

build();
