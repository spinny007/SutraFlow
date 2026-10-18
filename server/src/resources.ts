import crypto from 'node:crypto';
import { q, now } from './db.js';
import { applyResourceOverrides, effectiveVariables, engineVariableValues } from './projects.js';
import { resolveResourceConfig } from './settings.js';
import { CONNECTOR_KINDS } from './connectors/kinds.js';
import { AI_ENGINES } from './ai/engines.js';
import type { Field, ResourceKind } from './engine/types.js';

/**
 * Shared resources: reusable connection and
 * security settings that steps and exposed services point to. Secret values are
 * never stored here, only the name of a vault secret.
 */
const F = (k: string, label: string, type: Field['type'], def?: any, extra: Partial<Field> = {}): Field => ({ k, label, type, def, ...extra });
const when = (k: string, ...vals: any[]) => ({ showIf: { k, in: vals } });
/** Username/password: for Basic and UsernameToken, or SAML when it also sends a UsernameToken. */
const userFields = { showIfAny: [{ k: 'type', in: ['basic', 'wssUsernameToken'] }, { k: 'samlWithUsername', in: [true] }] };

export const RESOURCE_KINDS: ResourceKind[] = [
  {
    kind: 'httpConnection',
    name: 'HTTP connection',
    desc: 'Base URL, timeouts and TLS for calling an API or SOAP endpoint: trusted CA, client certificate (mutual TLS) and proxy.',
    fields: [
      F('baseUrl', 'Base URL', 'text', '', { placeholder: 'https://api.example.com', help: 'Steps may use a path such as /orders; it is joined to this URL.' }),
      F('timeoutMs', 'Timeout (ms)', 'number', 30000),
      F('headers', 'Default headers', 'kv', []),
      F('verifyTls', 'Verify server certificate', 'bool', true, { help: 'Turn off only for test servers with self-signed certificates.' }),
      F('caPem', 'Trusted CA certificates (PEM)', 'code', '', { help: 'Extra CAs to trust, for private PKI.' }),
      F('clientCertPem', 'Client certificate (PEM)', 'code', '', { group: 'Mutual TLS' }),
      F('clientKeySecret', 'Client private key', 'secret', '', { group: 'Mutual TLS', help: 'Vault secret holding the PEM private key.' }),
      F('clientKeyPassSecret', 'Private key passphrase', 'secret', '', { group: 'Mutual TLS' }),
      F('proxyUrl', 'Proxy URL', 'text', '', { placeholder: 'http://proxy.local:3128' }),
      F('breakerFailures', 'Open the circuit after (failures in a row)', 'number', 0, { group: 'Circuit breaker', help: '0 = off. After this many errors or 5xx replies in a row, calls fail at once instead of waiting.' }),
      F('breakerOpenSeconds', 'Keep it open for (seconds)', 'number', 30, { group: 'Circuit breaker', help: 'Then one trial call: success closes the circuit, failure opens it again.' }),
    ],
  },
  {
    kind: 'outboundAuth',
    name: 'Outbound security',
    desc: 'How a call proves who it is: Basic, Bearer, API key, OAuth 2.0 client credentials, or WS-Security (UsernameToken, SAML token, X.509 signature) for SOAP.',
    fields: [
      F('type', 'Method', 'select', 'basic', {
        options: ['none', 'basic', 'bearer', 'apiKey', 'oauth2ClientCredentials', 'wssUsernameToken', 'wssSaml', 'wssX509', 'customHeaders'],
      }),
      F('username', 'Username', 'text', '', { tpl: true, ...userFields }),
      F('passwordSecret', 'Password', 'secret', '', userFields),
      F('passwordType', 'Password type', 'select', 'PasswordDigest', { options: ['PasswordDigest', 'PasswordText'], showIfAny: [{ k: 'type', in: ['wssUsernameToken'] }, { k: 'samlWithUsername', in: [true] }] }),
      F('tokenSecret', 'Token', 'secret', '', when('type', 'bearer')),
      F('apiKeyName', 'Key name', 'text', 'X-API-Key', when('type', 'apiKey')),
      F('apiKeyIn', 'Send key in', 'select', 'header', { options: ['header', 'query'], ...when('type', 'apiKey') }),
      F('apiKeySecret', 'Key', 'secret', '', when('type', 'apiKey')),
      F('tokenUrl', 'Token URL', 'text', '', when('type', 'oauth2ClientCredentials')),
      F('clientId', 'Client ID', 'text', '', when('type', 'oauth2ClientCredentials')),
      F('clientSecretSecret', 'Client secret', 'secret', '', when('type', 'oauth2ClientCredentials')),
      F('scope', 'Scope', 'text', '', when('type', 'oauth2ClientCredentials')),
      F('audience', 'Audience', 'text', '', when('type', 'oauth2ClientCredentials')),
      F('clientAuth', 'Send client credentials as', 'select', 'basic header', { options: ['basic header', 'form body'], ...when('type', 'oauth2ClientCredentials') }),
      F('samlSource', 'SAML assertion from', 'select', 'secret', { options: ['secret', 'expression'], ...when('type', 'wssSaml') }),
      F('samlSecret', 'SAML assertion', 'secret', '', { help: 'Vault secret holding the full <saml:Assertion> XML.', ...when('samlSource', 'secret') }),
      F('samlExpression', 'SAML assertion expression', 'text', '{{nodes.Get SAML token.body}}', { tpl: true, help: 'Reference to an earlier step that fetched the assertion from your IdP/STS.', ...when('samlSource', 'expression') }),
      F('samlWithUsername', 'Also send UsernameToken', 'bool', false, when('type', 'wssSaml')),
      F('certPem', 'Signing certificate (PEM)', 'code', '', when('type', 'wssX509')),
      F('keySecret', 'Signing private key', 'secret', '', when('type', 'wssX509')),
      F('keyPassSecret', 'Key passphrase', 'secret', '', when('type', 'wssX509')),
      F('signatureAlgorithm', 'Signature algorithm', 'select', 'rsa-sha256', { options: ['rsa-sha256', 'rsa-sha1'], ...when('type', 'wssX509') }),
      F('timestamp', 'Add Timestamp (seconds valid, 0 = none)', 'number', 300, when('type', 'wssUsernameToken', 'wssSaml', 'wssX509')),
      F('headers', 'Headers', 'kv', [], { tpl: true, help: 'Values may use {{secret.NAME}}.', ...when('type', 'customHeaders') }),
    ],
  },
  {
    kind: 'inboundPolicy',
    name: 'API security policy',
    desc: 'Protects a REST or SOAP service this server exposes: who may call it, from where, how often, and over which transport.',
    fields: [
      F('auth', 'Caller authentication', 'select', 'apiKey', { options: ['none', 'basic', 'apiKey', 'apps', 'jwt', 'wssUsernameToken', 'mtls'], help: 'apps: gateway apps from the Admin Console (Gateway > Apps), with keys, scopes and plans.' }),
      F('appScopes', 'Required scopes', 'text', '', { help: 'Space separated, such as orders:read. The app must hold every one.', ...when('auth', 'apps') }),
      F('basicAccounts', 'Accounts', 'select', 'listed users', { options: ['listed users', 'system accounts'], help: 'System accounts: those with a password and the Call services permission on this project (Admin Console).', ...when('auth', 'basic') }),
      F('users', 'Users', 'kv', [], { help: 'Username = name of the vault secret holding that user\'s password. Not used with system accounts.', ...when('auth', 'basic', 'wssUsernameToken') }),
      F('apiKeyHeader', 'Key header', 'text', 'X-API-Key', when('auth', 'apiKey', 'apps')),
      F('apiKeySecrets', 'Accepted keys', 'list', [], { help: 'Names of vault secrets; each holds one accepted key.', ...when('auth', 'apiKey') }),
      F('jwtMode', 'Token signature', 'select', 'jwks', { options: ['jwks', 'publicKey', 'sharedSecret'], ...when('auth', 'jwt') }),
      F('jwksUrl', 'JWKS URL', 'text', '', { placeholder: 'https://idp.example.com/.well-known/jwks.json', ...when('jwtMode', 'jwks') }),
      F('jwtPublicKeyPem', 'Public key (PEM)', 'code', '', when('jwtMode', 'publicKey')),
      F('jwtSecret', 'Shared secret (HS256)', 'secret', '', when('jwtMode', 'sharedSecret')),
      F('jwtIssuer', 'Issuer', 'text', '', when('auth', 'jwt')),
      F('jwtAudience', 'Audience', 'text', '', when('auth', 'jwt')),
      F('jwtScopes', 'Required scopes', 'text', '', { help: 'Space separated.', ...when('auth', 'jwt') }),
      F('mtlsAllowedSubjects', 'Allowed certificate subjects (CN)', 'list', [], { help: 'Empty = any certificate signed by the client CA in Server settings.', ...when('auth', 'mtls') }),
      F('requireHttps', 'Require HTTPS', 'bool', true),
      F('ipAllow', 'Allowed IP addresses', 'list', [], { help: 'Exact IPs or IPv4 CIDR such as 10.0.0.0/8. Empty = any.' }),
      F('rateLimitPerMinute', 'Rate limit (requests per minute per caller, 0 = off)', 'number', 120),
      F('corsOrigins', 'CORS origins', 'list', [], { help: 'Browser origins allowed to call this API. Empty = none.' }),
    ],
  },
  {
    kind: 'aiProvider',
    name: 'AI provider',
    desc: 'The AI engine used by AI activities: the Claude, Gemini, OpenAI or Hugging Face API; a local server (Ollama, LM Studio, Hugging Face TGI, or any OpenAI-compatible server such as llama.cpp or vLLM), which works offline; or the Claude Code, Gemini or Codex command-line tool installed on this server.',
    fields: [
      F('engine', 'Engine', 'select', 'Claude API', { options: [...AI_ENGINES] }),
      F('apiKeySecret', 'API key', 'secret', '', { help: 'Vault secret holding the key or token. Needed for the Claude, Gemini, OpenAI and Hugging Face APIs; optional for local servers.', ...when('engine', 'Claude API', 'Gemini API', 'OpenAI API', 'Hugging Face', 'LM Studio', 'Hugging Face TGI (local)', 'OpenAI-compatible server') }),
      F('model', 'Model', 'text', '', { help: 'Use List models to pick one. Empty: claude-opus-5-5 (Claude API), gemini-3-pro-preview (Gemini API), gpt-5 (OpenAI API); local servers use their first model; the CLI tools use their own default. Hugging Face needs a model id such as Qwen/Qwen3-8B.' }),
      F('maxTokens', 'Max output tokens', 'number', 16000, { showIf: { k: 'engine', in: ['Claude API', 'Gemini API', 'OpenAI API', 'Ollama', 'LM Studio', 'Hugging Face', 'Hugging Face TGI (local)', 'OpenAI-compatible server'] } }),
      F('baseUrl', 'API base URL', 'text', '', { help: 'Empty = the usual address: Ollama http://127.0.0.1:11434 (a full endpoint such as http://localhost:11434/api/generate also works), LM Studio http://127.0.0.1:1234/v1, Hugging Face https://router.huggingface.co/v1, TGI http://127.0.0.1:8090/v1 (SutraFlow uses 8080), OpenAI-compatible (llama.cpp, vLLM, LocalAI, Jan) http://127.0.0.1:8000/v1. Set it for another machine, port or a proxy.', showIf: { k: 'engine', in: ['Claude API', 'Gemini API', 'OpenAI API', 'Ollama', 'LM Studio', 'Hugging Face', 'Hugging Face TGI (local)', 'OpenAI-compatible server'] } }),
      F('ollamaApi', 'Ollama API', 'select', 'chat', { options: ['chat', 'generate'], help: 'chat: /api/chat with instructions and prompt as messages. generate: /api/generate with prompt and system. An address ending in /api/generate always uses generate.', ...when('engine', 'Ollama') }),
      F('command', 'Command', 'text', '', { help: 'Empty = claude, gemini or codex from the server PATH; or the full path to the tool.', ...when('engine', 'Claude CLI', 'Gemini CLI', 'OpenAI Codex CLI') }),
      F('args', 'Arguments', 'text', '', { help: 'Empty = -p --output-format json (Claude), --output-format json (Gemini), exec - (Codex). The prompt is sent on standard input.', ...when('engine', 'Claude CLI', 'Gemini CLI', 'OpenAI Codex CLI') }),
      F('workDir', 'Working folder', 'text', '', { help: 'Empty = an empty temporary folder. The tool runs as the SutraFlow server user: keep its own tool permissions off.', ...when('engine', 'Claude CLI', 'Gemini CLI', 'OpenAI Codex CLI') }),
    ],
  },
  {
    kind: 'mcpServer',
    name: 'MCP server (AI skills)',
    desc: 'An address on the gateway where AI assistants find a set of skills: every deployed Sutra whose MCP skill trigger names this server is one of its tools.',
    fields: [
      F('path', 'Address on the gateway', 'text', '/mcp/skills', { help: 'For example /mcp/orders. Assistants connect to https://<server>:8443 followed by this address.' }),
      F('title', 'Title', 'text', 'Order skills'),
      F('instructions', 'Instructions for the AI', 'textarea', 'Tools for looking up and changing orders. Ask for the order number when it is not given.', { help: 'Told to the assistant when it connects: what this set of skills is for and how to use it.' }),
      F('policy', 'API security policy', 'resource', '', { resourceKind: 'inboundPolicy', help: 'Who may use these skills. A tool can set its own policy instead.' }),
    ],
  },
  ...CONNECTOR_KINDS,
];

/** Explorer symbols, in the same plain style as the activity symbols. */
const ICONS: Record<string, string> = {
  httpConnection: '⇄', outboundAuth: '⚿', inboundPolicy: '⛨', aiProvider: '✦', smtp: '✉', imap: '⇩', sftp: '⇅', ftp: '⇵',
  database: '⛁', kafka: '≋', rabbitmq: '⇶', amqp1: '⇉', firebase: '◭', oauthApp: '⚇', mcpServer: '✧',
};
for (const k of RESOURCE_KINDS) k.icon ||= ICONS[k.kind] || '⚙';

export interface Resource {
  id: string;
  kind: string;
  name: string;
  project_id?: string | null;
  config: Record<string, any>;
  updated_at?: string;
  /** Folder in the Project explorer ('' = the top). */
  folder?: string;
  /** Hash of the effective settings, for caches (changes when ops overrides change). */
  rev?: string;
}

const rowTo = (r: any): Resource => ({ ...r, config: JSON.parse(r.config) });

export function listResources(kind?: string, projectId?: string): Resource[] {
  const where: string[] = [], args: any[] = [];
  if (kind) { where.push('kind = ?'); args.push(kind); }
  if (projectId) { where.push('project_id = ?'); args.push(projectId); }
  return q.all(`select * from resources ${where.length ? 'where ' + where.join(' and ') : ''} order by kind, name`, ...args).map(rowTo);
}

/** As stored (for editing). */
export function getResource(id: string): Resource | undefined {
  const r: any = q.get('select * from resources where id = ?', id);
  return r ? rowTo(r) : undefined;
}

/** As used at run time: ops overrides and ${env:X} applied. */
export function effectiveResource(id: string): Resource | undefined {
  const r = getResource(id);
  if (!r) return undefined;
  // Ops overrides, ${env:X}, then {{gv.X}} / = formulas with the project's and engine's variables.
  const config = resolveResourceConfig(applyResourceOverrides(r), { gv: effectiveVariables(r.project_id).values, ev: engineVariableValues() });
  return { ...r, config, rev: crypto.createHash('sha1').update(r.id + JSON.stringify(config)).digest('hex').slice(0, 16) };
}

export function requireResource(id: string, kind: string, what: string): Resource {
  if (!id) throw new Error(`${what} is not selected`);
  const r = effectiveResource(id);
  if (!r) throw new Error(`${what}: the resource no longer exists`);
  if (r.kind !== kind) throw new Error(`${what}: expected a ${kind} resource, got ${r.kind}`);
  return r;
}

export function saveResource(r: Partial<Resource> & { kind: string; name: string }) {
  const k = RESOURCE_KINDS.find(x => x.kind === r.kind);
  if (!k) throw new Error(`Unknown resource kind ${r.kind}`);
  const config: Record<string, any> = {};
  for (const f of k.fields) config[f.k] = r.config?.[f.k] ?? f.def ?? '';
  const id = r.id || crypto.randomUUID();
  const prev = r.id ? getResource(r.id) : undefined;
  const projectId = r.project_id ?? prev?.project_id ?? null;
  const name = r.name.trim() || k.name;
  if (q.get('select 1 from resources where project_id is not distinct from ? and lower(name) = lower(?) and id != ?', projectId, name, id)) {
    throw new Error(`This project already has a resource named "${name}"`);
  }
  q.run(
    `insert into resources(id, kind, name, project_id, config, updated_at) values(?, ?, ?, ?, ?, ?)
     on conflict(id) do update set name = excluded.name, config = excluded.config, updated_at = excluded.updated_at`,
    id, r.kind, name, projectId, JSON.stringify(config), now(),
  );
  onResourceChange.forEach(fn => fn(id));
  return getResource(id)!;
}

export function deleteResource(id: string) {
  q.run('delete from resources where id = ?', id);
  onResourceChange.forEach(fn => fn(id));
}

export const onResourceChange: Array<(id: string) => void> = [];

/** kv fields are stored as [{k, v}] rows. */
export function kvToObject(rows: unknown, map: (v: string) => string = v => v): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(rows)) {
    for (const r of rows) if (r && r.k) out[String(r.k)] = map(String(r.v ?? ''));
  } else if (rows && typeof rows === 'object') {
    for (const [k, v] of Object.entries(rows)) out[k] = map(String(v));
  }
  return out;
}
