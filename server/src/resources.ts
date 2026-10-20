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
import { q, now } from './db.js';
import { applyResourceOverrides, effectiveVariables, engineVariableValues, settingsCache, onSettingsForget } from './projects.js';
import { resolveResourceConfig } from './settings.js';
import { CONNECTOR_KINDS } from './connectors/kinds.js';
import { AZURE_KINDS } from './connectors/azure.js';
import { CHAT_KINDS } from './connectors/chat.js';
import { WS_KINDS } from './connectors/websocket.js';
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
        options: ['none', 'basic', 'bearer', 'apiKey', 'oauth2ClientCredentials', 'hmac', 'wssUsernameToken', 'wssSaml', 'wssX509', 'customHeaders'],
      }),
      F('hmacSecret', 'Signing secret', 'secret', '', { help: 'The secret shared with the receiver.', ...when('type', 'hmac') }),
      F('hmacHeader', 'Signature header', 'text', 'X-Signature', when('type', 'hmac')),
      F('hmacTimestampHeader', 'Timestamp header', 'text', 'X-Timestamp', { help: 'Unix seconds. Not used when only the body is signed.', ...when('type', 'hmac') }),
      F('hmacSigned', 'What is signed', 'select', 'timestamp and body', { options: ['timestamp and body', 'method, path, timestamp and body', 'body only'], help: 'timestamp and body: the timestamp, a dot, then the body. method, path, timestamp and body: each on its own line. body only: as some webhook senders do (replays are refused only within the allowed age).', ...when('type', 'hmac') }),
      F('hmacAlgorithm', 'Algorithm', 'select', 'sha256', { options: ['sha256', 'sha512', 'sha1'], ...when('type', 'hmac') }),
      F('hmacEncoding', 'Encoding', 'select', 'hex', { options: ['hex', 'base64'], ...when('type', 'hmac') }),
      F('hmacPrefix', 'Signature prefix', 'text', '', { help: 'Text before the signature, such as sha256=.', ...when('type', 'hmac') }),
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
      F('encryptCertPem', 'Encrypt the body for (certificate PEM)', 'code', '', { help: 'The receiving service\'s certificate. Empty = not encrypted. Signed messages are signed first, then encrypted.', ...when('type', 'wssUsernameToken', 'wssSaml', 'wssX509') }),
      F('encryptAlgorithm', 'Encryption algorithm', 'select', 'aes256-gcm', { options: ['aes256-gcm', 'aes128-gcm', 'aes256-cbc', 'aes128-cbc'], help: 'The content key is sent with RSA-OAEP. Use CBC only for services that do not support GCM.', ...when('type', 'wssUsernameToken', 'wssSaml', 'wssX509') }),
      F('headers', 'Headers', 'kv', [], { tpl: true, help: 'Values may use {{secret.NAME}}.', ...when('type', 'customHeaders') }),
    ],
  },
  {
    kind: 'inboundPolicy',
    name: 'API security policy',
    desc: 'Protects a REST or SOAP service this server exposes: who may call it, from where, how often, and over which transport.',
    fields: [
      F('auth', 'Caller authentication', 'select', 'apiKey', { options: ['none', 'basic', 'apiKey', 'apps', 'jwt', 'oauth2Introspection', 'hmac', 'wssUsernameToken', 'wssX509', 'wssSaml', 'mtls'], help: 'apps: gateway apps from the Admin Console (Gateway > Apps), with keys, scopes and plans. oauth2Introspection: opaque access tokens checked at the identity provider. hmac: requests signed with a shared secret (webhooks). wssX509: SOAP requests signed with a trusted certificate. wssSaml: SOAP requests carrying a signed SAML assertion.' }),
      F('hmacSecrets', 'Accepted secrets', 'list', [], { help: 'Names of vault secrets; each holds one accepted secret (two while one is replaced).', ...when('auth', 'hmac') }),
      F('hmacHeader', 'Signature header', 'text', 'X-Signature', when('auth', 'hmac')),
      F('hmacTimestampHeader', 'Timestamp header', 'text', 'X-Timestamp', { help: 'Unix seconds. Not used when only the body is signed.', ...when('auth', 'hmac') }),
      F('hmacSigned', 'What is signed', 'select', 'timestamp and body', { options: ['timestamp and body', 'method, path, timestamp and body', 'body only'], help: 'timestamp and body: the timestamp, a dot, then the body. method, path, timestamp and body: each on its own line. body only: as some webhook senders do (replays are refused only within the allowed age).', ...when('auth', 'hmac') }),
      F('hmacAlgorithm', 'Algorithm', 'select', 'sha256', { options: ['sha256', 'sha512', 'sha1'], ...when('auth', 'hmac') }),
      F('hmacEncoding', 'Encoding', 'select', 'hex', { options: ['hex', 'base64'], ...when('auth', 'hmac') }),
      F('hmacPrefix', 'Signature prefix', 'text', '', { help: 'Text before the signature, such as sha256=.', ...when('auth', 'hmac') }),
      F('hmacMaxAgeSec', 'Allowed age (seconds)', 'number', 300, { help: 'Older timestamps are refused, and a signature seen within this time is refused as a replay.', ...when('auth', 'hmac') }),
      F('introspectionUrl', 'Introspection URL', 'text', '', { placeholder: 'https://idp.example.com/oauth2/introspect', ...when('auth', 'oauth2Introspection') }),
      F('introspectionClientId', 'Client id', 'text', '', { help: 'This gateway\'s client at the identity provider.', ...when('auth', 'oauth2Introspection') }),
      F('introspectionSecret', 'Client secret', 'secret', '', when('auth', 'oauth2Introspection')),
      F('introspectionCacheSec', 'Keep answers for (seconds)', 'number', 60, { help: 'Never past the token\'s expiry. 0 = ask every time.', ...when('auth', 'oauth2Introspection') }),
      F('introspectionAudience', 'Audience', 'text', '', { help: 'Empty = not checked.', ...when('auth', 'oauth2Introspection') }),
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
      F('jwtScopes', 'Required scopes', 'text', '', { help: 'Space separated. A service can require more per operation.', ...when('auth', 'jwt', 'oauth2Introspection') }),
      F('mtlsAllowedSubjects', 'Allowed certificate subjects (CN)', 'list', [], { help: 'Empty = any certificate signed by the client CA in Server settings.', ...when('auth', 'mtls') }),
      F('trustedCertsPem', 'Trusted certificates (PEM)', 'code', '', { help: 'The callers\' signing certificates, or the certificates (CAs) that issue them. Several PEM blocks may follow each other.', ...when('auth', 'wssX509') }),
      F('x509AllowedSubjects', 'Allowed certificate subjects (CN)', 'list', [], { help: 'Empty = any trusted certificate.', ...when('auth', 'wssX509') }),
      F('samlIdpCertPem', 'Identity provider certificate (PEM)', 'code', '', { help: 'The certificate that signs the SAML assertions (several PEM blocks while it changes).', ...when('auth', 'wssSaml') }),
      F('samlIssuer', 'Issuer', 'text', '', { help: 'Empty = any issuer whose signature checks out.', ...when('auth', 'wssSaml') }),
      F('samlAudience', 'Audience', 'text', '', { help: 'This service\'s name in the assertion\'s AudienceRestriction. Empty = not checked.', ...when('auth', 'wssSaml') }),
      F('wssTimestamp', 'Timestamp', 'select', 'optional', { options: ['optional', 'required'], help: 'A Timestamp that is present is always checked; required refuses messages without one (with X.509, it must be signed).', ...when('auth', 'wssUsernameToken', 'wssX509', 'wssSaml') }),
      F('wssSkewSec', 'Allowed clock difference (seconds)', 'number', 300, when('auth', 'wssUsernameToken', 'wssX509', 'wssSaml')),
      F('decryptKeySecret', 'Private key for encrypted requests', 'secret', '', { group: 'XML encryption', help: 'Vault secret holding this service\'s PEM private key. SOAP requests encrypted for its certificate are decrypted before anything else.' }),
      F('decryptKeyPassSecret', 'Key passphrase', 'secret', '', { group: 'XML encryption' }),
      F('requireEncryption', 'Require an encrypted body', 'bool', false, { group: 'XML encryption' }),
      F('requireHttps', 'Require HTTPS', 'bool', true),
      F('ipAllow', 'Allowed IP addresses', 'list', [], { help: 'Exact IPs or IPv4 CIDR such as 10.0.0.0/8. Empty = any.' }),
      F('rateLimitPerMinute', 'Rate limit (requests per minute per caller, 0 = off)', 'number', 120),
      F('corsOrigins', 'CORS origins', 'list', [], { help: 'Browser origins allowed to call this API. Empty = none.' }),
      F('maxBodyKb', 'Max body size (KB)', 'number', 0, { group: 'Threat protection', help: '0 = the service\'s own limit (REST: its Max body size; SOAP: the gateway\'s 50 MB).' }),
      F('maxDepth', 'Max nesting depth', 'number', 64, { group: 'Threat protection', help: 'Objects, lists or XML elements inside each other. Checked before the message is parsed.' }),
      F('maxFields', 'Max fields per message', 'number', 50000, { group: 'Threat protection', help: 'Object keys, XML elements and attributes in the whole message.' }),
      F('maxItems', 'Max items per list', 'number', 50000, { group: 'Threat protection' }),
      F('maxStringKb', 'Max text value (KB)', 'number', 1024, { group: 'Threat protection', help: 'The longest single text value. XML with a DOCTYPE is always refused (no entity expansion).' }),
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
    kind: 'memoryTable',
    name: 'Memory table',
    desc: 'Small reference data kept by key in the memory of each engine, for lookups without a database round trip: codes and their meanings, rates, routing and reusable values. Loaded from a database query, filled by Sutras, or both; with a copy in the database so a restart or another engine has them too. Not for big tables or files: those stay in the database or are streamed.',
    fields: [
      F('key', 'Key field(s)', 'text', 'id', { help: 'The field that identifies a row, or several separated by commas (country,city).' }),
      F('source', 'Rows come from', 'select', 'filled by Sutras', { options: ['filled by Sutras', 'database query'] }),
      F('database', 'Database connection', 'resource', '', { resourceKind: 'database', ...when('source', 'database query') }),
      F('loadSql', 'Load query', 'code', 'SELECT id, name, country, credit_limit\nFROM customers\nWHERE active = 1', { ...when('source', 'database query'), help: 'Loads the table at the first use and on each refresh. A WHERE clause loads only part of a big table.' }),
      F('lookupSql', 'Lookup query for a missing row', 'code', '', { ...when('source', 'database query'), help: 'Optional: SELECT ... WHERE id = :key fetches a row that is not in memory and keeps it. :key, or the key field names for a key of several fields.' }),
      F('refreshMinutes', 'Refresh every (minutes)', 'number', 0, { ...when('source', 'database query'), help: '0 = load once; Memory reload loads again.' }),
      F('ttlSeconds', 'Rows expire after (seconds)', 'number', 0, { help: '0 = never.' }),
      F('maxRows', 'Most rows kept', 'number', 10000, { help: 'Beyond this, the least recently used rows are dropped (a lookup query fetches them again). At most 100,000.' }),
      F('maxMb', 'Most memory (MB)', 'number', 16, { help: 'The same for the size of the rows. A load query that returns more is refused: big data stays in the database. At most 256.' }),
      F('keep', 'Failsafe', 'select', 'copy in the database', { options: ['copy in the database', 'memory only'], help: 'Copy in the database: every change is also saved in the SutraFlow database, so an engine that restarts has the rows at once and every engine of a cluster sees the changes within a second. Memory only: fastest, but each engine has its own rows and loses them on a restart.' }),
    ],
  },
  {
    kind: 'aiMemory',
    name: 'AI memory store',
    desc: 'Where AI agents keep conversations between runs, per session (a chat, ticket or customer), and how much of it fits the model.',
    fields: [
      F('store', 'Keep conversations in', 'select', 'built-in', { options: ['built-in', 'database', 'folder'], help: 'built-in: the SutraFlow database. database: a table in one of your databases (SQLite, PostgreSQL, MySQL); several servers can share it. folder: one file per session.' }),
      F('database', 'Database connection', 'resource', '', { resourceKind: 'database', ...when('store', 'database') }),
      F('table', 'Table', 'text', 'sutra_ai_memory', { ...when('store', 'database'), help: 'Made when missing.' }),
      F('folder', 'Folder', 'text', '', { ...when('store', 'folder'), help: 'Empty = ai-memory in the data folder.' }),
      F('contextTokens', 'Context window (tokens)', 'number', 8000, { help: 'How much the agent may send to the model in one step: instructions, tools, memory, knowledge and the question. Keep it below the limit of the model.' }),
      F('replyTokens', 'Kept free for the answer (tokens)', 'number', 1000),
      F('keepTurns', 'Recent turns kept word for word', 'number', 6, { help: 'Older turns are folded into the running summary when the history no longer fits.' }),
      F('summarise', 'When the history no longer fits', 'select', 'summarise older turns', { options: ['summarise older turns', 'drop the oldest'] }),
      F('summaryProvider', 'AI provider for summaries', 'resource', '', { resourceKind: 'aiProvider', help: 'Empty = the provider of the agent. A small, fast model is enough.' }),
      F('keepDays', 'Days to keep', 'number', 90, { help: 'Clear memory with "older than the days to keep" deletes older turns. 0 = keep.' }),
      F('encrypt', 'Encrypt the text', 'bool', false, { help: 'With the master key of the server.' }),
    ],
  },
  {
    kind: 'aiKnowledge',
    name: 'Knowledge base (RAG)',
    desc: 'Documents split into passages with vectors, for agents and Search knowledge to find by meaning (retrieval-augmented generation).',
    fields: [
      F('store', 'Vector store', 'select', 'built-in', { options: ['built-in', 'folder', 'PostgreSQL (pgvector)', 'Qdrant', 'Chroma', 'Pinecone'], help: 'built-in and folder need nothing else: for small knowledge, up to tens of thousands of passages (each search reads them all). For big documents, many documents, or sharing with other tools, use a vector database such as PostgreSQL (pgvector).' }),
      F('folder', 'Folder', 'text', '', { ...when('store', 'folder'), help: 'Empty = knowledge in the data folder.' }),
      F('database', 'Database connection', 'resource', '', { resourceKind: 'database', ...when('store', 'PostgreSQL (pgvector)'), help: 'A PostgreSQL database with the vector extension (CREATE EXTENSION vector).' }),
      F('table', 'Table', 'text', 'sutra_knowledge', when('store', 'PostgreSQL (pgvector)')),
      F('url', 'Address', 'text', '', { ...when('store', 'Qdrant', 'Chroma', 'Pinecone'), help: 'Qdrant: http://127.0.0.1:6333. Chroma: http://127.0.0.1:8000. Pinecone: the index host, https://<index>-<project>.svc.<region>.pinecone.io' }),
      F('collection', 'Collection', 'text', 'sutra_knowledge', when('store', 'Qdrant', 'Chroma')),
      F('namespace', 'Namespace', 'text', '', when('store', 'Pinecone')),
      F('apiKeySecret', 'API key', 'secret', '', { ...when('store', 'Qdrant', 'Chroma', 'Pinecone'), help: 'Vault secret; needed for Pinecone and for cloud Qdrant or Chroma.' }),
      F('embedWith', 'Vectors from', 'select', 'built-in', { options: ['built-in', 'AI provider'], help: 'built-in: word vectors made here, offline, no model; finds shared words, not synonyms. AI provider: a vector model (Ollama nomic-embed-text, OpenAI text-embedding-3-small, Gemini) finds meaning.' }),
      F('provider', 'AI provider for vectors', 'resource', '', { resourceKind: 'aiProvider', ...when('embedWith', 'AI provider') }),
      F('embedModel', 'Vector model', 'text', '', { ...when('embedWith', 'AI provider'), help: 'For example nomic-embed-text (Ollama: ollama pull nomic-embed-text). After changing it, use Rebuild in Remove knowledge.' }),
      F('chunkTokens', 'Passage size (tokens)', 'number', 300),
      F('overlapTokens', 'Overlap (tokens)', 'number', 40, { help: 'Each passage repeats the end of the one before, so a sentence is not lost at a cut.' }),
    ],
  },
  {
    kind: 'mcpClient',
    name: 'MCP client (outside tools)',
    desc: 'Another MCP server whose tools AI agents and Call MCP tool may use: over HTTP, or a command started on this server.',
    fields: [
      F('transport', 'Connect by', 'select', 'HTTP', { options: ['HTTP', 'command'] }),
      F('url', 'Address', 'text', 'https://tools.example.com/mcp', when('transport', 'HTTP')),
      F('tokenSecret', 'Bearer token', 'secret', '', { ...when('transport', 'HTTP'), help: 'Vault secret, sent as Authorization: Bearer.' }),
      F('headers', 'Headers', 'kv', [], when('transport', 'HTTP')),
      F('command', 'Command', 'text', 'npx -y @modelcontextprotocol/server-filesystem C:/data', { ...when('transport', 'command'), help: 'Runs as the SutraFlow server user. Only commands you trust.' }),
      F('workDir', 'Working folder', 'text', '', when('transport', 'command')),
      F('timeoutSec', 'Time limit per call (seconds)', 'number', 60),
      F('allowTools', 'Allowed tools', 'text', '', { help: 'Comma separated. Empty = every tool of the server.' }),
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
  ...AZURE_KINDS,
  ...CHAT_KINDS,
  ...WS_KINDS,
];

/** Explorer symbols, in the same plain style as the activity symbols. */
const ICONS: Record<string, string> = {
  httpConnection: '⇄', outboundAuth: '⚿', inboundPolicy: '⛨', aiProvider: '✦', smtp: '✉', imap: '⇩', sftp: '⇅', ftp: '⇵',
  discord: '◙', telegram: '➤', azureDataFactory: '⛁', databricks: '◆', database: '⛁', kafka: '≋', rabbitmq: '⇶', amqp1: '⇉', firebase: '◭', oauthApp: '⚇', mcpServer: '✧', aiMemory: '❖', memoryTable: '⚡', aiKnowledge: '❏', mcpClient: '⧉',
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

/**
 * Connection details as steps use them, kept for the settings refresh time like project variables:
 * a step does not read and resolve its connection again each time. A change on this engine, a deploy
 * or a change of variables clears them at once.
 */
const resourceCache = new Map<string, { at: number; r: Resource | undefined }>();
onSettingsForget.push(() => resourceCache.clear());

/** As used at run time: ops overrides and ${env:X} applied. */
export function effectiveResource(id: string): Resource | undefined {
  const c = resourceCache.get(id);
  if (c && Date.now() - c.at < settingsCache.ms) return c.r;
  const r = resolveResource(id);
  if (settingsCache.ms > 0) resourceCache.set(id, { at: Date.now(), r });
  return r;
}
function resolveResource(id: string): Resource | undefined {
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

export const onResourceChange: Array<(id: string) => void> = [resourceCache.delete.bind(resourceCache)];

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
