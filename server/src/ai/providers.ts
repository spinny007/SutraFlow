import Anthropic from '@anthropic-ai/sdk';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Resource } from '../resources.js';
import { httpCall } from '../security/outbound.js';

/**
 * AI engines behind the "AI provider" connection: the Claude, Gemini and OpenAI APIs, a local
 * Ollama server, and the Claude Code, Gemini and Codex command-line tools installed on this server.
 * Every call returns the text plus the same details: provider, model, tokens and time.
 */
export const AI_ENGINES = ['Claude API', 'Claude CLI', 'Gemini API', 'Gemini CLI', 'OpenAI API', 'OpenAI Codex CLI', 'Ollama'] as const;
export type AiEngine = (typeof AI_ENGINES)[number];

const DEFAULTS: Record<AiEngine, { model: string; base?: string; command?: string; args?: string }> = {
  'Claude API': { model: 'claude-opus-5-5', base: 'https://api.anthropic.com' },
  'Claude CLI': { model: '', command: 'claude', args: '-p --output-format json' },
  'Gemini API': { model: 'gemini-3-pro-preview', base: 'https://generativelanguage.googleapis.com' },
  'Gemini CLI': { model: '', command: 'gemini', args: '--output-format json' },
  'OpenAI API': { model: 'gpt-5', base: 'https://api.openai.com/v1' },
  'OpenAI Codex CLI': { model: '', command: 'codex', args: 'exec -' },
  Ollama: { model: 'llama3.3', base: 'http://127.0.0.1:11434' },
};
export const engineOf = (r: Resource): AiEngine => (AI_ENGINES.includes(r.config.engine) ? r.config.engine : 'Claude API');
export const isCli = (e: AiEngine) => e.endsWith('CLI');
export const defaultsFor = (e: AiEngine) => DEFAULTS[e];

export interface AiRequest { system: string; prompt: string; effort?: string; signal?: AbortSignal }
export interface AiResult {
  text: string;
  /** The details every AI activity returns. */
  ai: { provider: string; engine: AiEngine; model: string; inputTokens: number | null; outputTokens: number | null; totalTokens: number | null; ms: number; costUsd?: number };
}

type Secret = (name: string, what?: string) => string;

export async function aiCall(r: Resource, secret: Secret, q: AiRequest): Promise<AiResult> {
  const engine = engineOf(r);
  const d = DEFAULTS[engine];
  const model = String(r.config.model || d.model || '').trim();
  const maxTokens = Number(r.config.maxTokens) || 16000;
  const base = String(r.config.baseUrl || d.base || '').replace(/\/+$/, '');
  const t0 = Date.now();
  const done = (text: string, m: string, inT: number | null | undefined, outT: number | null | undefined, extra: Partial<AiResult['ai']> = {}): AiResult => ({
    text,
    ai: { provider: r.name, engine, model: m || model || '(CLI default)', inputTokens: inT ?? null, outputTokens: outT ?? null, totalTokens: inT != null && outT != null ? inT + outT : null, ms: Date.now() - t0, ...extra },
  });
  const key = (what: string) => secret(r.config.apiKeySecret, `${what} API key`);
  const http = async (url: string, headers: Record<string, string>, body: unknown) => {
    const res = await httpCall({ method: 'POST', url, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), timeoutMs: 600000, signal: q.signal, parse: 'json' });
    if (res.status >= 400) {
      const msg = res.body?.error?.message || res.body?.error || (typeof res.body === 'string' ? res.body : JSON.stringify(res.body));
      throw new Error(`${engine} error ${res.status}: ${String(msg).slice(0, 300)}`);
    }
    return res.body;
  };

  switch (engine) {
    case 'Claude API': {
      const client = anthropicClient(r, key('Anthropic'), base);
      const params: any = {
        model, max_tokens: maxTokens, system: q.system, messages: [{ role: 'user', content: q.prompt }],
        output_config: { effort: q.effort || 'medium' }, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      };
      let res: any;
      try {
        res = await client.beta.messages.create(params, { signal: q.signal });
      } catch (e) {
        if (e instanceof Anthropic.AuthenticationError) throw new Error('Claude rejected the API key. Check the AI provider connection.');
        if (e instanceof Anthropic.RateLimitError) throw new Error('Claude rate limit reached. Add retries to this step or slow the Sutra down.');
        if (e instanceof Anthropic.APIError) throw new Error(`Claude API error ${e.status}: ${e.message}`);
        throw e;
      }
      if (res.stop_reason === 'refusal') throw new Error(`Claude declined this request${res.stop_details?.explanation ? `: ${res.stop_details.explanation}` : ''}`);
      const text = (res.content as any[]).filter(b => b.type === 'text').map(b => b.text).join('');
      return done(text, res.model, res.usage?.input_tokens, res.usage?.output_tokens);
    }
    case 'OpenAI API': {
      const body = await http(`${base}/chat/completions`, { authorization: `Bearer ${key('OpenAI')}` }, {
        model, max_completion_tokens: maxTokens,
        messages: [...(q.system ? [{ role: 'system', content: q.system }] : []), { role: 'user', content: q.prompt }],
      });
      const text = body?.choices?.[0]?.message?.content ?? '';
      return done(typeof text === 'string' ? text : JSON.stringify(text), body?.model, body?.usage?.prompt_tokens, body?.usage?.completion_tokens);
    }
    case 'Gemini API': {
      const body = await http(`${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`, { 'x-goog-api-key': key('Gemini') }, {
        ...(q.system ? { systemInstruction: { parts: [{ text: q.system }] } } : {}),
        contents: [{ role: 'user', parts: [{ text: q.prompt }] }],
        generationConfig: { maxOutputTokens: maxTokens },
      });
      const cand = body?.candidates?.[0];
      if (!cand && body?.promptFeedback?.blockReason) throw new Error(`Gemini blocked the request: ${body.promptFeedback.blockReason}`);
      const text = (cand?.content?.parts || []).map((p: any) => p.text || '').join('');
      const u = body?.usageMetadata || {};
      return done(text, body?.modelVersion || model, u.promptTokenCount, u.candidatesTokenCount ?? (u.totalTokenCount != null && u.promptTokenCount != null ? u.totalTokenCount - u.promptTokenCount : undefined));
    }
    case 'Ollama': {
      const body = await http(`${base}/api/chat`, {}, {
        model, stream: false, options: { num_predict: maxTokens },
        messages: [...(q.system ? [{ role: 'system', content: q.system }] : []), { role: 'user', content: q.prompt }],
      });
      return done(body?.message?.content ?? '', body?.model, body?.prompt_eval_count, body?.eval_count);
    }
    default:
      return cliCall(r, engine, model, q, done);
  }
}

const anthropicClients = new Map<string, Anthropic>();
function anthropicClient(r: Resource, apiKey: string, base: string) {
  const k = `${r.id}:${r.rev}:${base}`;
  let c = anthropicClients.get(k);
  if (!c) { c = new Anthropic({ apiKey, baseURL: base || undefined, maxRetries: 2 }); anthropicClients.set(k, c); }
  return c;
}

/**
 * Runs a command-line AI tool. The prompt goes in on standard input, never on the command line,
 * so text from messages cannot become command arguments. The tool runs in an empty folder.
 */
async function cliCall(r: Resource, engine: AiEngine, model: string, q: AiRequest, done: (text: string, m: string, i?: number | null, o?: number | null, x?: Partial<AiResult['ai']>) => AiResult): Promise<AiResult> {
  const d = DEFAULTS[engine];
  const command = String(r.config.command || d.command).trim();
  const args = splitArgs(String(r.config.args ?? '') || d.args || '');
  if (model) {
    if (!/^[\w.:/@-]+$/.test(model)) throw new Error('The model name may contain only letters, digits and . : / @ - _');
    args.push(engine === 'Claude CLI' ? '--model' : '-m', model);
  }
  const cwd = String(r.config.workDir || '').trim() || cliFolder();
  const input = (q.system ? `${q.system}\n\n` : '') + q.prompt;
  const win = process.platform === 'win32';
  // On Windows, npm-installed tools are .cmd files that only start through the shell; quote every part.
  const quote = (s: string) => { if (/["%^&|<>]/.test(s)) throw new Error(`Unsupported character in the CLI command or arguments: ${s}`); return /[\s]/.test(s) ? `"${s}"` : s; };
  const child = win
    ? spawn([command, ...args].map(quote).join(' '), { cwd, shell: true, windowsHide: true, env: process.env })
    : spawn(command, args, { cwd, shell: false, env: process.env });
  const out: Buffer[] = [], err: Buffer[] = [];
  child.stdout.on('data', b => out.push(b));
  child.stderr.on('data', b => err.push(b));
  const onAbort = () => child.kill();
  q.signal?.addEventListener('abort', onAbort, { once: true });
  child.stdin.on('error', () => { /* the tool may exit before reading everything */ });
  child.stdin.end(input);
  const code: number = await new Promise((res, rej) => {
    child.on('error', e => rej(new Error((e as any).code === 'ENOENT' ? `"${command}" was not found on this server. Install ${engine} or set its full path in the AI provider connection.` : e.message)));
    child.on('close', c => res(c ?? 0));
  });
  q.signal?.removeEventListener('abort', onAbort);
  const stdout = Buffer.concat(out).toString('utf8').trim();
  const stderr = Buffer.concat(err).toString('utf8').trim();
  if (code !== 0) throw new Error(`${engine} exited with code ${code}: ${(stderr || stdout).slice(0, 400) || 'no output'}${/not recognized|not found/i.test(stderr) ? ` ("${command}" may not be installed)` : ''}`);
  let j: any;
  try { j = JSON.parse(stdout); } catch { j = undefined; }
  if (j && typeof j === 'object') {
    if (j.is_error) throw new Error(`${engine}: ${String(j.result || j.error || 'error').slice(0, 400)}`);
    // Claude Code: { result, usage: { input_tokens, output_tokens }, modelUsage: { "<model>": {...} }, total_cost_usd }
    if ('result' in j) {
      const m = Object.keys(j.modelUsage || {})[0] || model;
      return done(String(j.result ?? ''), m, j.usage?.input_tokens, j.usage?.output_tokens, j.total_cost_usd != null ? { costUsd: j.total_cost_usd } : {});
    }
    // Gemini CLI: { response, stats: { models: { "<model>": { tokens: { prompt, candidates, total } } } } }
    if ('response' in j) {
      const [m, s] = Object.entries<any>(j.stats?.models || {})[0] || [model, null];
      return done(String(j.response ?? ''), m, s?.tokens?.prompt, s?.tokens?.candidates);
    }
  }
  return done(stdout, model);
}

let folder = '';
function cliFolder() {
  if (!folder || !fs.existsSync(folder)) folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-ai-'));
  return folder;
}

/** Splits arguments on spaces; "double quotes" keep spaces together. */
export function splitArgs(s: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.push(m[1] ?? m[2]);
  return out;
}
