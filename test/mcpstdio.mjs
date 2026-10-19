/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// A tiny MCP server over standard input and output, for the MCP client tests: one tool, add.
import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin });
const send = m => process.stdout.write(JSON.stringify(m) + '\n');
rl.on('line', line => {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  if (m.id === undefined) return;
  if (m.method === 'initialize') return send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'calc', version: '1' } } });
  if (m.method === 'tools/list') return send({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'add', description: 'Adds two numbers', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] } }] } });
  if (m.method === 'tools/call') {
    const { a, b } = m.params.arguments || {};
    if (typeof a !== 'number' || typeof b !== 'number') return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'a and b must be numbers' }], isError: true } });
    return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: String(a + b) }], structuredContent: { sum: a + b } } });
  }
  send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found' } });
});
