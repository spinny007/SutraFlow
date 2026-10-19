/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { spawn } from 'node:child_process';
import type { Resource } from '../resources.js';
import { httpCall } from '../security/outbound.js';
import { splitArgs } from './providers.js';
import { MCP_PROTOCOLS } from '../mcp.js';

/**
 * Calls tools on another MCP server: over HTTP (the streamable HTTP transport, JSON or event-stream
 * answers, with its session header) or by starting a local command that speaks MCP on its standard
 * input and output. Each use opens a session, does its work and closes it.
 */
type Secret = (name: string, what?: string) => string;
export interface McpToolInfo { name: string; title?: string; description?: string; inputSchema?: any }
interface Session { request(method: string, params?: any): Promise<any>; notify(method: string, params?: any): Promise<void>; close(): Promise<void> }

const CLIENT = { name: 'SutraFlow', version: '1.0.0' };

function httpSession(r: Resource, secret: Secret, signal?: AbortSignal): Session {
  const url = String(r.config.url || '').trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('Set the MCP server address, for example https://tools.example.com/mcp');
  const timeoutMs = (Number(r.config.timeoutSec) || 60) * 1000;
  let sessionId = '';
  let id = 0;
  const headers = (): Record<string, string> => {
    const h: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    if (sessionId) h['mcp-session-id'] = sessionId;
    if (r.config.tokenSecret) h.authorization = `Bearer ${secret(r.config.tokenSecret, 'MCP server token')}`;
    for (const row of Array.isArray(r.config.headers) ? r.config.headers : []) if (row?.k) h[String(row.k).toLowerCase()] = String(row.v ?? '');
    return h;
  };
  const send = async (msg: any) => {
    const res = await httpCall({ method: 'POST', url, headers: headers(), body: JSON.stringify(msg), timeoutMs, signal, parse: 'text' });
    const sid = res.headers?.['mcp-session-id'];
    if (sid) sessionId = Array.isArray(sid) ? sid[0] : String(sid);
    if (res.status === 401 || res.status === 403) throw new Error(`The MCP server refused the sign-in (${res.status}). Check the token of the MCP client connection.`);
    if (res.status >= 400) throw new Error(`MCP server error ${res.status}: ${String(res.body).slice(0, 300)}`);
    return { text: String(res.body ?? ''), type: String(res.headers?.['content-type'] || '') };
  };
  return {
    async request(method, params) {
      const myId = ++id;
      const { text, type } = await send({ jsonrpc: '2.0', id: myId, method, ...(params ? { params } : {}) });
      const msgs: any[] = /event-stream/.test(type)
        ? text.split(/\r?\n\r?\n/).map(ev => ev.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n')).filter(Boolean).map(d => { try { return JSON.parse(d); } catch { return null; } })
        : [JSON.parse(text || 'null')];
      const m = msgs.flat().find(x => x && x.id === myId);
      if (!m) throw new Error(`The MCP server did not answer ${method}`);
      if (m.error) throw new Error(`MCP ${method}: ${m.error.message || JSON.stringify(m.error)}`);
      return m.result;
    },
    async notify(method, params) { await send({ jsonrpc: '2.0', method, ...(params ? { params } : {}) }); },
    async close() {
      if (!sessionId) return;
      await httpCall({ method: 'DELETE', url, headers: headers(), timeoutMs: 5000, parse: 'text' }).catch(() => {});
    },
  };
}

function commandSession(r: Resource, signal?: AbortSignal): Session {
  const command = String(r.config.command || '').trim();
  if (!command) throw new Error('Set the command that starts the MCP server, for example npx -y @modelcontextprotocol/server-filesystem C:/data');
  const [cmd, ...args] = splitArgs(command).concat(splitArgs(String(r.config.args || '')));
  const timeoutMs = (Number(r.config.timeoutSec) || 60) * 1000;
  // On Windows, npx and other npm tools are .cmd files that only start through the shell: one quoted command line.
  const quote = (s: string) => { if (/["%^&|<>]/.test(s)) throw new Error(`Unsupported character in the MCP server command: ${s}`); return /\s/.test(s) ? `"${s}"` : s; };
  const child = process.platform === 'win32'
    ? spawn([cmd, ...args].map(quote).join(' '), { cwd: r.config.workDir || undefined, shell: true, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    : spawn(cmd, args, { cwd: r.config.workDir || undefined, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
  const waiting = new Map<number, { ok(v: any): void; fail(e: Error): void }>();
  let buf = '', err = '', id = 0, ended = false;
  child.stdout.on('data', d => {
    buf += d;
    for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      try { const m = JSON.parse(line); const w = waiting.get(m.id); if (w) { waiting.delete(m.id); m.error ? w.fail(new Error(m.error.message || JSON.stringify(m.error))) : w.ok(m.result); } } catch { /* log lines */ }
    }
  });
  child.stderr.on('data', d => { err = (err + d).slice(-2000); });
  const endAll = (e: Error) => { ended = true; for (const w of waiting.values()) w.fail(e); waiting.clear(); };
  child.on('error', e => endAll(new Error(`The MCP server command did not start: ${e.message}`)));
  child.on('exit', code => endAll(new Error(`The MCP server command ended (exit code ${code})${err ? `: ${err.trim().slice(-300)}` : ''}`)));
  signal?.addEventListener('abort', () => child.kill());
  const write = (m: any) => { if (ended) throw new Error('The MCP server command has ended'); child.stdin.write(JSON.stringify(m) + '\n'); };
  return {
    request: (method, params) => new Promise((ok, fail) => {
      const myId = ++id;
      const t = setTimeout(() => { waiting.delete(myId); fail(new Error(`The MCP server did not answer ${method} within ${timeoutMs / 1000} s`)); }, timeoutMs);
      waiting.set(myId, { ok: v => { clearTimeout(t); ok(v); }, fail: e => { clearTimeout(t); fail(e); } });
      try { write({ jsonrpc: '2.0', id: myId, method, ...(params ? { params } : {}) }); } catch (e) { clearTimeout(t); waiting.delete(myId); fail(e as Error); }
    }),
    notify: async (method, params) => write({ jsonrpc: '2.0', method, ...(params ? { params } : {}) }),
    close: async () => { child.stdin.end(); setTimeout(() => child.kill(), 2000).unref(); },
  };
}

/** Opens a session, says hello, runs fn and closes the session. */
export async function withMcp<T>(r: Resource, secret: Secret, fn: (s: Session, info: { server: string; instructions?: string }) => Promise<T>, signal?: AbortSignal): Promise<T> {
  const s = r.config.transport === 'command' ? commandSession(r, signal) : httpSession(r, secret, signal);
  try {
    const hello = await s.request('initialize', { protocolVersion: MCP_PROTOCOLS[0], capabilities: {}, clientInfo: CLIENT });
    await s.notify('notifications/initialized');
    return await fn(s, { server: hello?.serverInfo?.name || r.name, instructions: hello?.instructions });
  } finally { await s.close(); }
}

/** The tools of the server, all pages. */
export async function listMcpTools(r: Resource, secret: Secret, signal?: AbortSignal): Promise<McpToolInfo[]> {
  return withMcp(r, secret, async s => {
    const out: McpToolInfo[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const res = await s.request('tools/list', cursor ? { cursor } : {});
      out.push(...(res?.tools || []));
      cursor = res?.nextCursor;
      if (!cursor) break;
    }
    return out;
  }, signal);
}

/** Calls one tool; the result as data when the server gives structured content, else its text. */
export async function callMcpTool(r: Resource, secret: Secret, name: string, args: unknown, signal?: AbortSignal) {
  return withMcp(r, secret, async s => {
    const res = await s.request('tools/call', { name, arguments: args && typeof args === 'object' ? args : {} });
    const text = (res?.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
    let result: any = res?.structuredContent ?? text;
    if (result === text) { try { result = JSON.parse(text); } catch { /* plain text */ } }
    return { result, text, isError: !!res?.isError, content: res?.content || [] };
  }, signal);
}
