/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { asyncDatabase } from '../asyncdb.js';
import { engine } from '../engine/engine.js';
import type { FlowDoc, FlowNode } from '../engine/types.js';
import { deployedFlows } from '../flows.js';
import { effectiveResource } from '../resources.js';
import { authorize, PolicyError, type Caller } from '../security/inbound.js';

/**
 * Published agents: deployed Sutras that start with an Agent channel trigger, reachable at several
 * entry points at once. Every entry point turns a message into the same trigger input
 * ({ message, sessionId, channel, caller, history }) and the Agent reply back into its own format:
 *  - chat page /chat/<name>, chat API POST /chat/<name>/api, job results GET /chat/<name>/jobs/<id>,
 *    and an embeddable chat button /chat/<name>/widget.js;
 *  - OpenAI-compatible API: GET /v1/models, POST /v1/chat/completions (model = agent name, stream or not);
 *  - MCP: the tool ask_<name> on the chosen MCP server address;
 *  - A2A: agent card /a2a/<name>/.well-known/agent-card.json and JSON-RPC message/send, tasks/get at /a2a/<name>.
 * Work that takes longer than the agent's "answer within" returns a job id; the run goes on and its
 * answer is fetched later with the job id. Messages of one session are answered in arrival order
 * (the AI agent queues them per session).
 */
export interface AgentEntry { name: string; title: string; description: string; flowId: string; projectId: string; version: number; doc: FlowDoc; node: FlowNode; mcpEndpoint: string | null; waitMs: number }
let agents: AgentEntry[] = [];
const slug = (s: unknown) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
export const mcpToolName = (a: AgentEntry) => `ask_${a.name.replace(/-/g, '_')}`.slice(0, 64);

export function rebuildAgents(mcpPath: (p: unknown) => string) {
  agents = deployedFlows().flatMap(d => d.doc.nodes.filter(n => n.type === 'agentChannel' && slug(n.config.agentName)).map(n => {
    const srv = n.config.mcp && n.config.mcpServer ? effectiveResource(n.config.mcpServer) : undefined;
    return {
      name: slug(n.config.agentName), title: String(n.config.title || n.config.agentName), description: String(n.config.description || ''),
      flowId: d.flowId, projectId: d.projectId, version: d.version, doc: d.doc, node: n,
      mcpEndpoint: n.config.mcp ? (srv ? mcpPath(srv.config.path) : '/mcp') : null,
      waitMs: Math.min(600, Math.max(1, Number(n.config.waitSeconds) || 50)) * 1000,
    };
  }));
}
export const listAgents = () => agents.map(a => ({ name: a.name, title: a.title, flowId: a.flowId, projectId: a.projectId, version: a.version, flow: a.doc.name,
  chat: !!a.node.config.chat, openai: !!a.node.config.openai, mcp: a.mcpEndpoint, a2a: !!a.node.config.a2a, tool: a.mcpEndpoint ? mcpToolName(a) : null }));
export const agentMcpEndpoints = () => agents.filter(a => a.mcpEndpoint).map(a => a.mcpEndpoint!);

type Out = { status: 'answer' | 'needs a person' | 'error' | 'working'; answer: any; sessionId: string; job?: string; error?: string; waitingFor?: string };

/** Starts the agent's run and waits up to its "answer within" time; after that the answer is a job. */
function ask(a: AgentEntry, input: { message: string; sessionId: string; channel: string; caller: Caller; history?: any[] }): Promise<Out> {
  return new Promise(resolve => {
    let runId = '', settled = false;
    const done = (o: Out) => { if (!settled) { settled = true; clearInterval(watch); resolve(o); } };
    const timer = setTimeout(() => done({ status: 'working', answer: null, sessionId: input.sessionId, job: runId }), a.waitMs);
    // Waiting for a person takes minutes or days: answer "working" with the job at once.
    let checking = false;
    const watch = setInterval(() => {
      if (!runId || checking) return;
      checking = true;
      void asyncDatabase().get(`select 1 from tasks where run_id = ? and status = 'waiting' and wait like '%"approval"%'`, runId).then(waiting => {
        if (waiting) {
          clearTimeout(timer);
          done({ status: 'working', answer: 'A person will answer this; ask again with the job id.', sessionId: input.sessionId, job: runId, waitingFor: 'a person' });
        }
      }).catch(() => {}).finally(() => { checking = false; });
    }, 300);
    engine.startRun({
      doc: a.doc, flowId: a.flowId, projectId: a.projectId, version: a.version, triggerNodeId: a.node.id, source: 'agent',
      input: { ...input, history: input.history || [], agent: a.name, caller: { subject: input.caller.subject, method: input.caller.method } },
      onReply: (r: any) => { clearTimeout(timer); done(fromReply(r, input.sessionId)); },
    }).then(id => { runId = id; }, (e: any) => {
      clearTimeout(timer);
      done({ status: 'error', answer: null, sessionId: input.sessionId, error: e.message });
    });
  });
}
function fromReply(r: any, sessionId: string): Out {
  if (r?.failed) return { status: 'error', answer: null, sessionId, error: r.error || 'The agent failed' };
  const b = r?.body;
  if (b && typeof b === 'object' && 'answer' in b) return { status: b.status === 'needs a person' ? 'needs a person' : b.status === 'error' ? 'error' : 'answer', answer: b.answer, sessionId: b.sessionId || sessionId, ...(b.status === 'error' ? { error: typeof b.answer === 'string' ? b.answer : 'The agent reported an error' } : {}) };
  return { status: 'answer', answer: b, sessionId };
}

/** The answer of a job (a run of this agent) when it has one. */
async function job(a: AgentEntry, id: string): Promise<Out | null> {
  const db = asyncDatabase();
  const r = await db.get<any>('select status, error, state, flow_id from runs where id = ?', id);
  if (!r || r.flow_id !== a.flowId) return null;
  const st = JSON.parse(r.state || '{}');
  const input = await db.get<any>('select input from tasks where run_id = ? order by id limit 1', id);
  const sessionId = (() => { try { return JSON.parse(input?.input || '{}').sessionId || ''; } catch { return ''; } })();
  if (st.reply) return fromReply(st.reply, sessionId);
  if (r.status === 'failed' || r.status === 'cancelled') return { status: 'error', answer: null, sessionId, error: r.error || `The run was ${r.status}` };
  if (r.status === 'done') return { status: 'answer', answer: st.result ?? st.last ?? null, sessionId };
  return { status: 'working', answer: null, sessionId, job: id };
}

const text = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v));
const newSession = () => crypto.randomUUID();
const JOB_ASK = /^\s*(?:status|result|job)\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*$/i;

async function caller(req: FastifyRequest, secure: boolean, policyRef: unknown) {
  const ref = String(policyRef || '');
  const policy = ref ? effectiveResource(ref) : undefined;
  if (ref && !policy) throw new PolicyError(503, "The agent's security policy is missing; refusing to serve it unprotected");
  return authorize(policy, { headers: req.headers, ip: req.ip, secure, socket: req.raw.socket });
}
const body = (req: FastifyRequest) => { try { return JSON.parse(typeof req.body === 'string' ? req.body || '{}' : String(req.body ?? '{}')); } catch { throw new PolicyError(400, 'The body is not valid JSON'); } };
const fail = (reply: FastifyReply, e: any) => { if (e.headers) reply.headers(e.headers); return reply.code(e.status || 500).send({ error: e.message }); };
const note = (req: FastifyRequest, a: AgentEntry, kind: string, who?: Caller) => Object.assign((req as any).gw || {}, { kind, route: `Agent ${a.name}`, flowId: a.flowId, projectId: a.projectId, ...(who ? { caller: who.subject, appId: who.appId } : {}) });

/** Serves the agent entry points; returns null when the path is not one of them. */
export async function handleAgents(req: FastifyRequest, reply: FastifyReply, secure: boolean, path: string): Promise<FastifyReply | null> {
  const method = req.method.toUpperCase();
  // ---------- chat ----------
  let m = /^\/chat\/([a-z0-9-]+)(\/api|\/jobs\/([0-9a-f-]{36})|\/widget\.js)?\/?$/.exec(path);
  if (m) {
    const a = agents.find(x => x.name === m![1] && x.node.config.chat);
    if (!a) return reply.code(404).send({ error: 'No published agent with a chat at this address' });
    note(req, a, 'agent');
    if (!m[2] && method === 'GET') return reply.type('text/html; charset=utf-8').send(chatPage(a));
    if (m[2] === '/widget.js' && method === 'GET') return reply.type('text/javascript; charset=utf-8').send(widget(a, `${secure ? 'https' : 'http'}://${req.headers.host || 'localhost'}`));
    try {
      const who = await caller(req, secure, a.node.config.chatPolicy);
      note(req, a, 'agent', who);
      if (m[3] && method === 'GET') { const j = await job(a, m[3]); return j ? reply.send(j) : reply.code(404).send({ error: 'No such job' }); }
      if (m[2] !== '/api' || method !== 'POST') return reply.code(405).send({ error: 'Use POST /chat/<name>/api with {"message", "sessionId"}' });
      const b = body(req);
      const message = text(b.message).trim();
      if (!message) return reply.code(400).send({ error: 'The message is empty' });
      const out = await ask(a, { message, sessionId: String(b.sessionId || '') || newSession(), channel: 'chat', caller: who });
      if (out.job) reply.header('x-sutra-run', out.job);
      return reply.code(out.status === 'error' ? 502 : out.status === 'working' ? 202 : 200).send(out);
    } catch (e) { return fail(reply, e); }
  }

  // ---------- OpenAI-compatible ----------
  if (path === '/v1/models' && method === 'GET') {
    const list: any[] = [];
    for (const a of agents.filter(x => x.node.config.openai)) { try { await caller(req, secure, a.node.config.openaiPolicy); list.push({ id: a.name, object: 'model', created: 0, owned_by: 'sutraflow', description: a.description }); } catch { /* not for this caller */ } }
    return reply.send({ object: 'list', data: list });
  }
  if (path === '/v1/chat/completions') {
    if (method !== 'POST') return reply.code(405).send({ error: { message: 'Use POST', type: 'invalid_request_error' } });
    let b: any;
    try { b = body(req); } catch (e: any) { return reply.code(400).send({ error: { message: e.message, type: 'invalid_request_error' } }); }
    const a = agents.find(x => x.name === slug(b.model) && x.node.config.openai);
    if (!a) return reply.code(404).send({ error: { message: `No published agent named "${b.model}". GET /v1/models lists them.`, type: 'invalid_request_error', code: 'model_not_found' } });
    note(req, a, 'agent');
    let who: Caller;
    try { who = await caller(req, secure, a.node.config.openaiPolicy); note(req, a, 'agent', who); } catch (e: any) { if (e.headers) reply.headers(e.headers); return reply.code(e.status || 401).send({ error: { message: e.message, type: 'authentication_error' } }); }
    const msgs: any[] = Array.isArray(b.messages) ? b.messages : [];
    const content = (x: any) => (typeof x?.content === 'string' ? x.content : Array.isArray(x?.content) ? x.content.map((p: any) => p?.text || '').join('') : '');
    const lastUser = [...msgs].reverse().find(x => x.role === 'user');
    const message = content(lastUser).trim();
    if (!message) return reply.code(400).send({ error: { message: 'No user message', type: 'invalid_request_error' } });
    // Session: given by the caller, or the same for every request of one conversation (its first message).
    const given = String(req.headers['x-session-id'] || b.session_id || b.metadata?.session_id || b.user || '');
    const first = content(msgs.find(x => x.role === 'user'));
    const sessionId = given || `oa-${crypto.createHash('sha256').update(`${who.subject}|${a.name}|${first}`).digest('hex').slice(0, 24)}`;
    const jobAsk = JOB_ASK.exec(message);
    const out = jobAsk ? await job(a, jobAsk[1]) || { status: 'error' as const, answer: null, sessionId, error: 'No such job' } : await ask(a, { message, sessionId, channel: 'openai', caller: who, history: msgs.slice(0, msgs.lastIndexOf(lastUser)).map(x => ({ role: x.role, content: content(x) })) });
    if (out.status === 'error') return reply.code(502).send({ error: { message: out.error || 'The agent failed', type: 'server_error' } });
    const answer = out.status === 'working' ? `I am still working on this. Send "status ${out.job}" to get the answer.` : out.status === 'needs a person' ? `${text(out.answer)}\n\n(A person will follow up.)` : text(out.answer);
    const id = `chatcmpl-${crypto.randomUUID()}`, created = Math.floor(Date.now() / 1000);
    reply.header('x-session-id', out.sessionId);
    if (b.stream) {
      reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-session-id': out.sessionId });
      const chunk = (delta: any, finish: string | null) => reply.raw.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: a.name, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
      chunk({ role: 'assistant', content: '' }, null);
      for (let i = 0; i < answer.length; i += 48) chunk({ content: answer.slice(i, i + 48) }, null);
      chunk({}, 'stop');
      reply.raw.end('data: [DONE]\n\n');
      return reply;
    }
    return reply.send({ id, object: 'chat.completion', created, model: a.name, session_id: out.sessionId, choices: [{ index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } });
  }

  // ---------- A2A ----------
  m = /^\/a2a\/([a-z0-9-]+)(\/\.well-known\/(?:agent-card|agent)\.json)?\/?$/.exec(path);
  if (m) {
    const a = agents.find(x => x.name === m![1] && x.node.config.a2a);
    if (!a) return reply.code(404).send({ error: 'No published A2A agent at this address' });
    note(req, a, 'agent');
    const url = `${secure ? 'https' : 'http'}://${req.headers.host || 'localhost'}/a2a/${a.name}`;
    if (m[2] && method === 'GET') return reply.send({
      protocolVersion: '0.3.0', name: a.title, description: a.description, url, preferredTransport: 'JSONRPC', version: String(a.version),
      capabilities: { streaming: false, pushNotifications: false }, defaultInputModes: ['text/plain'], defaultOutputModes: ['text/plain', 'application/json'],
      skills: [{ id: a.name, name: a.title, description: a.description, tags: ['sutraflow'] }],
      ...(a.node.config.a2aPolicy ? { securitySchemes: { gateway: { type: 'http', scheme: 'bearer' } }, security: [{ gateway: [] }] } : {}),
    });
    if (method !== 'POST') return reply.code(405).send({ error: 'Use POST with JSON-RPC 2.0' });
    let rpc: any;
    try { rpc = body(req); } catch { return reply.send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
    const rid = rpc?.id ?? null;
    let who: Caller;
    try { who = await caller(req, secure, a.node.config.a2aPolicy); note(req, a, 'agent', who); } catch (e: any) { if (e.headers) reply.headers(e.headers); return reply.code(e.status || 401).send({ jsonrpc: '2.0', id: rid, error: { code: -32001, message: e.message } }); }
    const msgOut = (o: Out) => ({ kind: 'message', role: 'agent', messageId: crypto.randomUUID(), contextId: o.sessionId, parts: typeof o.answer === 'string' || o.answer == null ? [{ kind: 'text', text: text(o.answer) }] : [{ kind: 'data', data: o.answer }] });
    const task = (id: string, o: Out) => ({ kind: 'task', id, contextId: o.sessionId, status: { state: o.status === 'working' ? 'working' : o.status === 'error' ? 'failed' : o.status === 'needs a person' ? 'input-required' : 'completed', ...(o.status !== 'working' ? { message: o.status === 'error' ? { kind: 'message', role: 'agent', messageId: crypto.randomUUID(), parts: [{ kind: 'text', text: o.error || 'failed' }] } : msgOut(o) } : {}) } });
    if (rpc?.method === 'message/send') {
      const parts = rpc.params?.message?.parts || [];
      const message = parts.map((p: any) => p?.text ?? (p?.data ? JSON.stringify(p.data) : '')).join('\n').trim();
      if (!message) return reply.send({ jsonrpc: '2.0', id: rid, error: { code: -32602, message: 'The message has no text' } });
      const sessionId = String(rpc.params?.message?.contextId || '') || newSession();
      const out = await ask(a, { message, sessionId, channel: 'a2a', caller: who });
      if (out.status === 'error') return reply.send({ jsonrpc: '2.0', id: rid, error: { code: -32603, message: out.error || 'The agent failed' } });
      return reply.send({ jsonrpc: '2.0', id: rid, result: out.status === 'answer' ? msgOut(out) : task(out.job || crypto.randomUUID(), out) });
    }
    if (rpc?.method === 'tasks/get') {
      const j = await job(a, String(rpc.params?.id || ''));
      return reply.send(j ? { jsonrpc: '2.0', id: rid, result: task(String(rpc.params.id), j) } : { jsonrpc: '2.0', id: rid, error: { code: -32001, message: 'Task not found' } });
    }
    return reply.send({ jsonrpc: '2.0', id: rid, error: { code: -32601, message: `Method not found: ${rpc?.method}` } });
  }
  return null;
}

// ---------- MCP: each agent with the MCP entry point is the tool ask_<name> ----------

export function agentMcpTools(endpoint: string) {
  return agents.filter(a => a.mcpEndpoint === endpoint).map(a => ({
    agent: a,
    def: {
      name: mcpToolName(a), title: a.title,
      description: `${a.description || a.title} Ask in plain words. Pass the same session to continue a conversation. If the answer says it is still working, call again with the job id.`,
      inputSchema: { type: 'object', properties: { message: { type: 'string', description: 'What to ask the agent' }, session: { type: 'string', description: 'Optional: the session id from an earlier answer, to continue that conversation' }, job: { type: 'string', description: 'Optional: a job id from an earlier answer, to get its result' } }, required: ['message'] },
      annotations: { title: a.title, readOnlyHint: false, openWorldHint: true },
    },
  }));
}
export async function callAgentTool(a: AgentEntry, args: any, who: Caller) {
  const out = args?.job ? await job(a, String(args.job)) || { status: 'error' as const, answer: null, sessionId: '', error: 'No such job' } : await ask(a, { message: text(args?.message).trim(), sessionId: String(args?.session || '') || newSession(), channel: 'mcp', caller: who });
  const say = out.status === 'working' ? `Still working on it. Call ${mcpToolName(a)} again with job "${out.job}" for the answer.` : out.status === 'error' ? `The agent failed: ${out.error}` : out.status === 'needs a person' ? `${text(out.answer)}\n(A person will follow up.)` : text(out.answer);
  return { content: [{ type: 'text', text: say }], structuredContent: { answer: out.answer, status: out.status, session: out.sessionId, ...(out.job ? { job: out.job } : {}) }, ...(out.status === 'error' ? { isError: true } : {}) };
}

// ---------- the chat page and the chat button ----------

const esc = (s: string) => s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]!);
function chatPage(a: AgentEntry) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(a.title)}</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--ink:#16202a;--muted:#5d6b78;--me:#0d6e5f;--line:#dde3e8}
@media (prefers-color-scheme:dark){:root{--bg:#121619;--card:#1b2126;--ink:#e6edf2;--muted:#93a1ad;--me:#2fb39a;--line:#2a333b}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;display:flex;flex-direction:column;height:100vh}
header{padding:14px 16px;border-bottom:1px solid var(--line);background:var(--card)}header b{display:block}header span{color:var(--muted);font-size:13px}
#log{flex:1;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:10px;max-width:760px;width:100%;margin:0 auto}
.m{padding:9px 12px;border-radius:12px;max-width:85%;white-space:pre-wrap;word-wrap:break-word}.u{align-self:flex-end;background:var(--me);color:#fff}.b{align-self:flex-start;background:var(--card);border:1px solid var(--line)}
.w{color:var(--muted);font-style:italic}form{display:flex;gap:8px;padding:12px 16px;border-top:1px solid var(--line);background:var(--card);max-width:760px;width:100%;margin:0 auto}
textarea{flex:1;resize:none;border:1px solid var(--line);border-radius:10px;padding:9px 11px;font:inherit;background:var(--bg);color:var(--ink)}button{border:0;border-radius:10px;padding:0 16px;background:var(--me);color:#fff;font:inherit;cursor:pointer}button:disabled{opacity:.5}
</style></head><body>
<header><b>${esc(a.title)}</b><span>${esc(a.description)}</span></header>
<div id="log" role="log" aria-live="polite"></div>
<form id="f"><textarea id="t" rows="2" placeholder="Type a message" aria-label="Message"></textarea><button id="s">Send</button></form>
<script>
const key='sutra-chat-${a.name}';let session='';try{session=localStorage.getItem(key)||''}catch(e){}
const log=document.getElementById('log'),t=document.getElementById('t'),s=document.getElementById('s');
const add=(c,x)=>{const d=document.createElement('div');d.className='m '+c;d.textContent=x;log.appendChild(d);log.scrollTop=log.scrollHeight;return d};
const show=(d,o)=>{d.className='m b';d.textContent=o.status==='error'?'Sorry, something went wrong: '+(o.error||''):typeof o.answer==='string'?o.answer:JSON.stringify(o.answer,null,2);if(o.status==='needs a person')d.textContent+='\\n(A person will follow up.)'};
async function poll(d,job){for(let i=0;i<120;i++){await new Promise(r=>setTimeout(r,3000));const r=await fetch(location.pathname.replace(/\\/$/,'')+'/jobs/'+job);const o=await r.json();if(o.status!=='working'){show(d,o);return}}d.textContent='Still working. Reload the page later.'}
document.getElementById('f').onsubmit=async e=>{e.preventDefault();const m=t.value.trim();if(!m)return;t.value='';add('u',m);const d=add('b w','Thinking...');s.disabled=true;
try{const r=await fetch(location.pathname.replace(/\\/$/,'')+'/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:m,sessionId:session})});const o=await r.json();
if(o.sessionId){session=o.sessionId;try{localStorage.setItem(key,session)}catch(e){}}if(o.status==='working'){d.textContent='Working on it...';poll(d,o.job)}else show(d,o)}catch(err){d.className='m b';d.textContent='Could not reach the agent.'}finally{s.disabled=false;t.focus()}};
t.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();document.getElementById('f').requestSubmit()}});
</script></body></html>`;
}
function widget(a: AgentEntry, origin: string) {
  return `(function(){if(window.__sutraChat_${a.name.replace(/-/g, '_')})return;window.__sutraChat_${a.name.replace(/-/g, '_')}=1;
var b=document.createElement('button');b.textContent=${JSON.stringify(a.title)};b.setAttribute('aria-label','Open chat: '+${JSON.stringify(a.title)});
b.style.cssText='position:fixed;right:20px;bottom:20px;z-index:99999;border:0;border-radius:24px;padding:12px 18px;background:#0d6e5f;color:#fff;font:15px system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.25);cursor:pointer';
var f=null;b.onclick=function(){if(f){f.style.display=f.style.display==='none'?'block':'none';return}f=document.createElement('iframe');f.src=${JSON.stringify(`${origin}/chat/${a.name}`)};f.title=${JSON.stringify(a.title)};
f.style.cssText='position:fixed;right:20px;bottom:76px;z-index:99999;width:min(380px,calc(100vw - 40px));height:min(560px,calc(100vh - 110px));border:1px solid #dde3e8;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.25);background:#fff';document.body.appendChild(f)};
document.body.appendChild(b)})();`;
}
