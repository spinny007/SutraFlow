/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import type { Activity, ExecCtx } from '../engine/types.js';
import { requireResource } from '../resources.js';
import { aiCall, ollamaCall, OLLAMA_OPS, engineOf } from '../ai/providers.js';
import { F, listOf, when } from './common.js';

const routeNames = (rows: any) => (Array.isArray(rows) ? rows : []).map((r: any) => String(r?.k ?? '').trim()).filter(Boolean);

/**
 * AI activities. The AI provider connection chooses the engine (Claude, Gemini or OpenAI APIs,
 * Ollama, or the Claude, Gemini and Codex command-line tools); see ai/providers.ts.
 * Every activity also returns "ai": provider, engine, model, tokens and time.
 */
async function ask(c: ExecCtx, system: string, prompt: string, effort: string) {
  const r = requireResource(c.raw('provider'), 'aiProvider', 'AI provider');
  return aiCall(r, c.secret, { system, prompt, effort, signal: c.signal });
}

/**
 * For activities that need a JSON answer: asks the engine for JSON, reads the object even when the
 * model wraps it in text or code fences, and asks once more, more strictly, when it still is not JSON.
 * Small local models (Ollama, LM Studio) need this more often than large ones.
 */
async function askJson(c: ExecCtx, system: string, prompt: string, effort: string) {
  const r = requireResource(c.raw('provider'), 'aiProvider', 'AI provider');
  const first = await aiCall(r, c.secret, { system, prompt, effort, signal: c.signal, json: true });
  const j = jsonFrom(first.text);
  if (j !== undefined) return { ...first, json: j };
  c.log('warn', 'The AI reply was not valid JSON; asking again');
  const again = await aiCall(r, c.secret, { system: `${system} Your reply must be one JSON object and nothing else: no explanation, no code fences.`, prompt, effort, signal: c.signal, json: true });
  const j2 = jsonFrom(again.text);
  if (j2 === undefined) throw new Error(`The AI did not reply with valid JSON (model ${again.ai.model}). Try a larger model or simpler instructions. It replied: ${again.text.slice(0, 200)}`);
  return { ...again, ai: { ...again.ai, inputTokens: sum(first.ai.inputTokens, again.ai.inputTokens), outputTokens: sum(first.ai.outputTokens, again.ai.outputTokens), totalTokens: sum(first.ai.totalTokens, again.ai.totalTokens), ms: first.ai.ms + again.ai.ms }, json: j2 };
}
const sum = (a: number | null, b: number | null) => (a == null || b == null ? null : a + b);

/** The details every AI activity returns, shown in the Output tab before a run. */
const AI = { ai: { provider: '', engine: '', model: '', inputTokens: 0, outputTokens: 0, totalTokens: 0, ms: 0 } };

/** The JSON object in a reply: the whole text, a fenced block, or the first balanced {...}; undefined when none. */
function jsonFrom(text: string): any {
  const tryParse = (t: string) => { try { const v = JSON.parse(t.trim()); return v && typeof v === 'object' ? v : undefined; } catch { return undefined; } };
  const whole = tryParse(text);
  if (whole) return whole;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fenced) { const v = tryParse(fenced[1]); if (v) return v; }
  for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) { const v = tryParse(text.slice(start, i + 1)); if (v) return v; break; }
    }
  }
  return undefined;
}

const provider = F('provider', 'AI provider', 'resource', '', { resourceKind: 'aiProvider', help: 'The AI engine and model: Claude, Gemini, OpenAI, Ollama or a CLI. Set up under Resources.' });
const effort = F('effort', 'Effort', 'select', 'medium', { options: ['low', 'medium', 'high'] });


const OLLAMA_OUT: Record<string, any> = {
  generate: { text: '', response: '', model: '', done: true, ...AI },
  chat: { text: '', message: { role: 'assistant', content: '' }, model: '', done: true, ...AI },
  embed: { model: '', embeddings: [[0]], ...AI },
  'list models': { models: [{ name: '', model: '', size: 0, modified_at: '', details: { family: '', parameter_size: '', quantization_level: '' } }] },
  'running models': { models: [{ name: '', model: '', size: 0, size_vram: 0, expires_at: '' }] },
  'show model': { modelfile: '', parameters: '', template: '', details: { family: '', parameter_size: '', quantization_level: '' }, capabilities: [''] },
  'pull model': { status: '' },
  'copy model': { copied: true, source: '', destination: '' },
  'delete model': { deleted: true, model: '' },
  version: { version: '' },
};

/** The Ollama API, endpoint by endpoint, through an AI provider connection whose engine is Ollama. */
const ollamaActivity: Activity = {
  type: 'ollama', palette: 'ai', name: 'Ollama', glyph: '◉', ports: ['out'],
  desc: 'Calls an Ollama endpoint: generate, chat, embed (vectors for search), list or show models, running models, pull, copy or delete a model, version. Works offline against a local Ollama.',
  fields: [
    F('provider', 'AI provider (Ollama)', 'resource', '', { resourceKind: 'aiProvider', help: 'An AI provider connection with engine Ollama; its address and model are used.' }),
    F('op', 'Endpoint', 'select', 'generate', { options: [...OLLAMA_OPS] }),
    F('model', 'Model', 'text', '', { help: 'Empty = the connection\'s model.', ...when('op', 'generate', 'chat', 'embed', 'show model', 'pull model', 'copy model', 'delete model') }),
    F('to', 'New name', 'text', '', when('op', 'copy model')),
    F('system', 'System', 'textarea', '', { tpl: true, ...when('op', 'generate', 'chat') }),
    F('prompt', 'Prompt', 'textarea', '{{input}}', { tpl: true, ...when('op', 'generate', 'chat') }),
    F('messages', 'Messages (optional)', 'text', '', { tpl: true, help: 'A list of { role, content } for a whole conversation; replaces System and Prompt.', ...when('op', 'chat') }),
    F('input', 'Text to embed', 'text', '{{input.text}}', { tpl: true, help: 'One text or a list of texts.', ...when('op', 'embed') }),
    F('images', 'Images (base64)', 'text', '', { tpl: true, help: 'For vision models: a list of base64 images, e.g. {{nodes.Read file.base64}}.', ...when('op', 'generate', 'chat') }),
    F('format', 'Reply format', 'text', '', { help: 'Empty, json, or a JSON schema the reply must follow.', ...when('op', 'generate', 'chat') }),
    F('options', 'Options', 'kv', [], { help: 'Model options such as temperature 0.2, num_ctx 8192, num_predict 512, seed 42.', ...when('op', 'generate', 'chat', 'embed') }),
    F('keepAlive', 'Keep loaded for', 'text', '', { help: 'e.g. 5m or 1h; 0 unloads at once.', ...when('op', 'generate', 'chat', 'embed') }),
    F('think', 'Thinking (models that support it)', 'bool', false, when('op', 'generate', 'chat')),
  ],
  outputSchema: (cfg, h) => h.infer(OLLAMA_OUT[cfg.op || 'generate'] || {}),
  execute: async c => {
    const r = requireResource(c.raw('provider'), 'aiProvider', 'AI provider');
    if (engineOf(r) !== 'Ollama') throw new Error(`${r.name} uses ${engineOf(r)}; choose an AI provider whose engine is Ollama`);
    const op = c.raw('op') || 'generate';
    const options: Record<string, any> = {};
    for (const row of (c.raw('options') as any[]) || []) if (row?.k) { const v = c.resolve(row.v); const n = Number(v); options[row.k] = typeof v === 'string' && v.trim() !== '' && Number.isFinite(n) ? n : v === 'true' ? true : v === 'false' ? false : v; }
    const list = (v: any) => (Array.isArray(v) ? v : v ? [v] : []);
    const t0 = Date.now();
    const out: any = await ollamaCall(r, op, {
      model: c.raw('model'), to: c.raw('to'), system: c.v('system') || undefined, prompt: asPrompt(c.v('prompt') ?? ''),
      messages: c.raw('messages') ? c.v('messages') : undefined, input: c.v('input'), images: list(c.v('images')).map(String),
      format: c.raw('format') || undefined, options, keepAlive: c.raw('keepAlive') || undefined, think: !!c.raw('think'),
    }, c.signal);
    if (op === 'generate' || op === 'chat' || op === 'embed') {
      const inT = out.prompt_eval_count ?? null, outT = out.eval_count ?? null;
      out.ai = { provider: r.name, engine: 'Ollama', model: out.model || c.raw('model') || r.config.model, inputTokens: inT, outputTokens: outT, totalTokens: inT != null && outT != null ? inT + outT : inT, ms: out.total_duration ? Math.round(out.total_duration / 1e6) : Date.now() - t0 };
      if (op !== 'embed') out.text = out.response ?? out.message?.content ?? '';
    }
    return { out };
  },
};

export const aiActivities: Activity[] = [
  {
    type: 'aiPrompt', palette: 'ai', name: 'AI prompt', glyph: '✦', ports: ['out'],
    desc: 'Sends instructions and mapped data to the AI provider and returns the text reply.',
    fields: [provider, F('system', 'Instructions', 'textarea', 'You are a concise assistant for an integration Sutra.', { vars: true }), F('prompt', 'Prompt', 'textarea', '{{input}}', { tpl: true }), effort],
    outputHint: { text: '', ...AI },
    execute: async c => ({ out: await ask(c, c.raw('system') || '', String(asPrompt(c.v('prompt'))), c.raw('effort')) }),
  },
  {
    type: 'aiClassify', palette: 'ai', name: 'AI classify', glyph: '◈',
    ports: cfg => [...listOf(cfg.labels), 'other'],
    desc: 'The AI picks one label for the text. Each label is an output branch.',
    fields: [provider, F('text', 'Text', 'textarea', '{{input}}', { tpl: true }), F('labels', 'Labels (comma separated)', 'text', 'refund, complaint, question', { ports: true }), F('guidance', 'Guidance', 'textarea', '', { vars: true }), effort],
    outputHint: { label: '', confidence: 0, reason: '', ...AI },
    execute: async c => {
      const labels = listOf(c.raw('labels'));
      if (!labels.length) throw new Error('Add at least one label');
      const r = await askJson(c, 'You classify text for an integration Sutra. Reply with JSON only.',
        `Labels: ${labels.join(', ')}${c.raw('guidance') ? `\nGuidance: ${c.raw('guidance')}` : ''}\nReply with JSON: {"label": "<one label or other>", "confidence": <0-1>, "reason": "<one sentence>"}\n\nText:\n${asPrompt(c.v('text'))}`, c.raw('effort'));
      const j = r.json;
      const label = labels.find(l => l.toLowerCase() === String(j.label || '').toLowerCase()) || 'other';
      return { port: label, out: { label, confidence: Number(j.confidence) || 0, reason: String(j.reason || ''), input: c.input, ai: r.ai } };
    },
  },
  {
    type: 'aiRouter', palette: 'ai', name: 'AI router', glyph: '⑂',
    ports: cfg => [...routeNames(cfg.routes), 'otherwise'],
    desc: 'The AI reads the text and sends it down the route whose description fits best (or every route that fits). Nothing fits: otherwise.',
    fields: [
      provider,
      F('text', 'Text', 'textarea', '{{input}}', { tpl: true }),
      F('routes', 'Routes', 'kv', [{ k: 'billing', v: 'questions about invoices, payments or refunds' }, { k: 'technical', v: 'errors, outages or how to use the product' }], { ports: true, help: 'Route name and a plain description of what belongs there.' }),
      F('mode', 'Take', 'select', 'best match', { options: ['best match', 'all matches'] }),
      effort,
    ],
    outputHint: { routes: [''], reason: '', ...AI },
    execute: async c => {
      const rows = ((c.raw('routes') as any[]) || []).filter(r => r?.k).map(r => ({ name: String(r.k).trim(), desc: String(r.v || '') }));
      if (!rows.length) throw new Error('Add at least one route');
      const all = c.raw('mode') === 'all matches';
      const r = await askJson(c, 'You route messages in an integration Sutra. Reply with JSON only.',
        `Routes:\n${rows.map(x => `- ${x.name}: ${x.desc}`).join('\n')}\n${all ? 'Choose every route that fits.' : 'Choose the one route that fits best.'} Choose none when nothing fits.\nReply with JSON: {"routes": ["<route name>"], "reason": "<one sentence>"}\n\nText:\n${asPrompt(c.v('text'))}`, c.raw('effort'));
      const j = r.json;
      let hits = (Array.isArray(j.routes) ? j.routes : [j.route]).map((x: any) => rows.find(rw => rw.name.toLowerCase() === String(x ?? '').toLowerCase())?.name).filter(Boolean) as string[];
      hits = [...new Set(hits)];
      if (!all) hits = hits.slice(0, 1);
      const out = { routes: hits, reason: String(j.reason || ''), input: c.input, ai: r.ai };
      if (!hits.length) return { port: 'otherwise', out };
      return { emits: hits.map(port => ({ port, out })), store: out };
    },
  },
  {
    type: 'aiExtract', palette: 'ai', name: 'AI extract', glyph: '⌗', ports: ['out'],
    desc: 'Pulls structured fields out of free text (emails, documents). One field per row: name and description.',
    fields: [provider, F('text', 'Source text', 'textarea', '{{input}}', { tpl: true }), F('fields', 'Fields', 'kv', [{ k: 'orderId', v: 'the order number' }, { k: 'amount', v: 'amount as a number' }]), effort],
    outputSchema: (cfg, h) => h.infer({ ...Object.fromEntries(((cfg.fields as any[]) || []).filter(r => r?.k).map(r => [r.k, ''])), ...AI }),
    execute: async c => {
      const fl = ((c.raw('fields') as any[]) || []).filter(r => r?.k);
      if (!fl.length) throw new Error('List at least one field');
      const r = await askJson(c, 'You extract data for an integration Sutra. Reply with JSON only. Use null for missing values; numbers as JSON numbers.',
        `Fields:\n${fl.map(f => `- ${f.k}: ${f.v}`).join('\n')}\nReply with one JSON object with exactly those keys.\n\nText:\n${asPrompt(c.v('text'))}`, c.raw('effort'));
      const j = r.json;
      return { out: { ...Object.fromEntries(fl.map(f => [f.k, j?.[f.k] ?? null])), ai: r.ai } };
    },
  },
  {
    type: 'aiSummarize', palette: 'ai', name: 'AI summarize', glyph: '≡', ports: ['out'],
    desc: 'Shortens long text (emails, documents, tickets, logs) into a summary of the chosen length and style.',
    fields: [
      provider,
      F('text', 'Text', 'textarea', '{{input}}', { tpl: true }),
      F('style', 'Style', 'select', 'paragraph', { options: ['paragraph', 'bullet points', 'one line', 'key points and actions'] }),
      F('length', 'Length (words, about)', 'number', 120),
      F('language', 'Language', 'text', 'same as the text', { help: 'For example English, Hindi, French.' }),
      F('focus', 'Focus on', 'text', '', { help: 'Optional, for example "customer requests and dates".' }),
      effort,
    ],
    outputHint: { summary: '', points: [''], words: 0, ...AI },
    execute: async c => {
      const lang = String(c.raw('language') || '').trim();
      const r = await askJson(c, 'You summarise text for an integration Sutra. Reply with JSON only.',
        `Summarise the text as ${c.raw('style') || 'paragraph'}, about ${Number(c.raw('length')) || 120} words${lang && lang !== 'same as the text' ? `, in ${lang}` : ', in the language of the text'}.${c.raw('focus') ? ` Focus on: ${c.raw('focus')}.` : ''}\nReply with JSON: {"summary": "<the summary as text>", "points": ["<each point>"]}\n\nText:\n${asPrompt(c.v('text'))}`, c.raw('effort'));
      const j = r.json;
      const summary = String(j.summary ?? '');
      return { out: { summary, points: Array.isArray(j.points) ? j.points.map(String) : [], words: summary.split(/\s+/).filter(Boolean).length, ai: r.ai } };
    },
  },
  {
    type: 'aiTranslate', palette: 'ai', name: 'AI translate', glyph: '文', ports: ['out'],
    desc: 'Translates text into the chosen language, keeping names, numbers and formatting; reports the language it came from.',
    fields: [
      provider,
      F('text', 'Text', 'textarea', '{{input}}', { tpl: true }),
      F('to', 'Translate into', 'text', 'English', { tpl: true, help: 'A language name or code, for example Hindi, de, pt-BR, or {{input.lang}}.' }),
      F('from', 'From', 'text', 'detect', { help: 'detect, or the source language.' }),
      F('tone', 'Tone', 'select', 'as written', { options: ['as written', 'formal', 'informal'] }),
      F('glossary', 'Keep these terms', 'text', '', { help: 'Comma separated words that must not be translated, such as product names.' }),
      effort,
    ],
    outputHint: { text: '', from: '', to: '', ...AI },
    execute: async c => {
      const to = String(c.v('to') || 'English');
      const from = String(c.raw('from') || 'detect');
      const tone = c.raw('tone') && c.raw('tone') !== 'as written' ? ` Use a ${c.raw('tone')} tone.` : '';
      const r = await askJson(c, 'You translate text for an integration Sutra. Keep names, numbers, codes, line breaks and markup unchanged. Reply with JSON only.',
        `Translate into ${to}${from !== 'detect' ? ` from ${from}` : ''}.${tone}${c.raw('glossary') ? ` Do not translate: ${c.raw('glossary')}.` : ''}\nReply with JSON: {"text": "<translation>", "from": "<source language name>"}\n\nText:\n${asPrompt(c.v('text'))}`, c.raw('effort'));
      const j = r.json;
      return { out: { text: String(j.text ?? ''), from: String(j.from || from), to, ai: r.ai } };
    },
  },
  {
    type: 'aiSentiment', palette: 'ai', name: 'AI sentiment', glyph: '☺', ports: ['positive', 'neutral', 'negative'],
    desc: 'Rates the feeling of a text (reviews, emails, chats): positive, neutral or negative, each its own output, with a score and the emotions found.',
    fields: [
      provider,
      F('text', 'Text', 'textarea', '{{input}}', { tpl: true }),
      F('aspects', 'Also rate', 'text', '', { help: 'Optional, comma separated, for example delivery, price, support.' }),
      effort,
    ],
    outputHint: { sentiment: 'neutral', score: 0, emotions: [''], aspects: {}, reason: '', ...AI },
    execute: async c => {
      const aspects = listOf(c.raw('aspects'));
      const r = await askJson(c, 'You rate sentiment for an integration Sutra. Reply with JSON only.',
        `Rate the sentiment of the text.${aspects.length ? ` Also rate each of: ${aspects.join(', ')} (positive, neutral, negative or not mentioned).` : ''}\nReply with JSON: {"sentiment": "positive|neutral|negative", "score": <-1 to 1>, "emotions": ["<emotion>"], ${aspects.length ? '"aspects": {"<aspect>": "<rating>"}, ' : ''}"reason": "<one sentence>"}\n\nText:\n${asPrompt(c.v('text'))}`, c.raw('effort'));
      const j = r.json;
      const s = String(j.sentiment || '').toLowerCase();
      const sentiment = ['positive', 'neutral', 'negative'].includes(s) ? s : 'neutral';
      const score = Math.max(-1, Math.min(1, Number(j.score) || 0));
      return { port: sentiment, out: { sentiment, score, emotions: Array.isArray(j.emotions) ? j.emotions.map(String) : [], aspects: j.aspects && typeof j.aspects === 'object' ? j.aspects : {}, reason: String(j.reason || ''), input: c.input, ai: r.ai } };
    },
  },
  ollamaActivity,
];

const asPrompt = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2));
