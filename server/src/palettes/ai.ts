import type { Activity, ExecCtx } from '../engine/types.js';
import { requireResource } from '../resources.js';
import { aiCall } from '../ai/providers.js';
import { F, listOf } from './common.js';

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

/** The details every AI activity returns, shown in the Output tab before a run. */
const AI = { ai: { provider: '', engine: '', model: '', inputTokens: 0, outputTokens: 0, totalTokens: 0, ms: 0 } };

function jsonFrom(text: string) {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
  try { return JSON.parse((m ? m[1] : text).trim()); } catch { throw new Error('The AI did not reply with valid JSON. Run again or simplify the instructions.'); }
}

const provider = F('provider', 'AI provider', 'resource', '', { resourceKind: 'aiProvider', help: 'The AI engine and model: Claude, Gemini, OpenAI, Ollama or a CLI. Set up under Resources.' });
const effort = F('effort', 'Effort', 'select', 'medium', { options: ['low', 'medium', 'high'] });

export const aiActivities: Activity[] = [
  {
    type: 'aiPrompt', palette: 'ai', name: 'AI prompt', glyph: '✦', ports: ['out'],
    desc: 'Sends instructions and mapped data to the AI provider and returns the text reply.',
    fields: [provider, F('system', 'Instructions', 'textarea', 'You are a concise assistant for an integration Sutra.'), F('prompt', 'Prompt', 'textarea', '{{input}}', { tpl: true }), effort],
    outputHint: { text: '', ...AI },
    execute: async c => ({ out: await ask(c, c.raw('system') || '', String(asPrompt(c.v('prompt'))), c.raw('effort')) }),
  },
  {
    type: 'aiClassify', palette: 'ai', name: 'AI classify', glyph: '◈',
    ports: cfg => [...listOf(cfg.labels), 'other'],
    desc: 'The AI picks one label for the text. Each label is an output branch.',
    fields: [provider, F('text', 'Text', 'textarea', '{{input}}', { tpl: true }), F('labels', 'Labels (comma separated)', 'text', 'refund, complaint, question', { ports: true }), F('guidance', 'Guidance', 'textarea', ''), effort],
    outputHint: { label: '', confidence: 0, reason: '', ...AI },
    execute: async c => {
      const labels = listOf(c.raw('labels'));
      if (!labels.length) throw new Error('Add at least one label');
      const r = await ask(c, 'You classify text for an integration Sutra. Reply with JSON only.',
        `Labels: ${labels.join(', ')}${c.raw('guidance') ? `\nGuidance: ${c.raw('guidance')}` : ''}\nReply with JSON: {"label": "<one label or other>", "confidence": <0-1>, "reason": "<one sentence>"}\n\nText:\n${asPrompt(c.v('text'))}`, c.raw('effort'));
      const j = jsonFrom(r.text);
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
      const r = await ask(c, 'You route messages in an integration Sutra. Reply with JSON only.',
        `Routes:\n${rows.map(x => `- ${x.name}: ${x.desc}`).join('\n')}\n${all ? 'Choose every route that fits.' : 'Choose the one route that fits best.'} Choose none when nothing fits.\nReply with JSON: {"routes": ["<route name>"], "reason": "<one sentence>"}\n\nText:\n${asPrompt(c.v('text'))}`, c.raw('effort'));
      const j = jsonFrom(r.text);
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
      const r = await ask(c, 'You extract data for an integration Sutra. Reply with JSON only. Use null for missing values; numbers as JSON numbers.',
        `Fields:\n${fl.map(f => `- ${f.k}: ${f.v}`).join('\n')}\nReply with one JSON object with exactly those keys.\n\nText:\n${asPrompt(c.v('text'))}`, c.raw('effort'));
      const j = jsonFrom(r.text);
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
      const r = await ask(c, 'You summarise text for an integration Sutra. Reply with JSON only.',
        `Summarise the text as ${c.raw('style') || 'paragraph'}, about ${Number(c.raw('length')) || 120} words${lang && lang !== 'same as the text' ? `, in ${lang}` : ', in the language of the text'}.${c.raw('focus') ? ` Focus on: ${c.raw('focus')}.` : ''}\nReply with JSON: {"summary": "<the summary as text>", "points": ["<each point>"]}\n\nText:\n${asPrompt(c.v('text'))}`, c.raw('effort'));
      const j = jsonFrom(r.text);
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
      const r = await ask(c, 'You translate text for an integration Sutra. Keep names, numbers, codes, line breaks and markup unchanged. Reply with JSON only.',
        `Translate into ${to}${from !== 'detect' ? ` from ${from}` : ''}.${tone}${c.raw('glossary') ? ` Do not translate: ${c.raw('glossary')}.` : ''}\nReply with JSON: {"text": "<translation>", "from": "<source language name>"}\n\nText:\n${asPrompt(c.v('text'))}`, c.raw('effort'));
      const j = jsonFrom(r.text);
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
      const r = await ask(c, 'You rate sentiment for an integration Sutra. Reply with JSON only.',
        `Rate the sentiment of the text.${aspects.length ? ` Also rate each of: ${aspects.join(', ')} (positive, neutral, negative or not mentioned).` : ''}\nReply with JSON: {"sentiment": "positive|neutral|negative", "score": <-1 to 1>, "emotions": ["<emotion>"], ${aspects.length ? '"aspects": {"<aspect>": "<rating>"}, ' : ''}"reason": "<one sentence>"}\n\nText:\n${asPrompt(c.v('text'))}`, c.raw('effort'));
      const j = jsonFrom(r.text);
      const s = String(j.sentiment || '').toLowerCase();
      const sentiment = ['positive', 'neutral', 'negative'].includes(s) ? s : 'neutral';
      const score = Math.max(-1, Math.min(1, Number(j.score) || 0));
      return { port: sentiment, out: { sentiment, score, emotions: Array.isArray(j.emotions) ? j.emotions.map(String) : [], aspects: j.aspects && typeof j.aspects === 'object' ? j.aspects : {}, reason: String(j.reason || ''), input: c.input, ai: r.ai } };
    },
  },
];

const asPrompt = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2));
