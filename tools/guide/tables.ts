/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * SutraFlow's own tables, for the user guide (Where SutraFlow keeps its data) and the architecture
 * page: what each holds, grouped by what it is for, which hold encrypted values, and which grow. The
 * columns are read from server/src/db.ts (the schema and the columns later versions add), so both
 * pages always match the code; a table without a description stops both builds.
 */
export const TABLE_TEXT: Record<string, string> = {
  flows: 'Sutra drafts: the document being edited and its latest version number.',
  flow_versions: 'Published, unchangeable versions of each Sutra.',
  deployments: 'Which version of each Sutra is deployed, and whether it is enabled.',
  runs: 'One row per run: the Sutra document it started with, status, trigger input, state (outputs, variables, branch tokens, logs) and times.',
  tasks: 'One row per step execution: status, attempt, not-before time, owner engine and claim number (counted up at each claim, for fencing), input, output, port, wait details, error and duration. The work queue.',
  resources: 'Connections, security profiles, API policies, AI providers and MCP servers (secret names only).',
  secrets: 'The vault: encrypted values with their IV and tag.',
  settings: 'Server settings and policies, gateway and TLS settings, Engine properties, the deploy generation.',
  projects: 'Projects with their variables, logging and deployment config.',
  schemas: 'Shared schemas and WSDLs of each project.',
  counters: 'Counter activity values per project.',
  mem_rows: 'The database copy of memory tables kept with a failsafe: key, row, expiry, and the version of the change that wrote it (a removed row keeps its key with no row).',
  mem_meta: 'Per memory table: the latest change version and when it was last loaded from its source, so engines pick up each other\'s changes.',
  package_deployments: 'Package history per project: version, checksum, who deployed it, the report and the package itself (for rollback).',
  engines: 'Engines of the cluster: host, process, mode, version, heartbeat, workers, active steps, draining.',
  leases: 'Cluster-wide locks with an expiry: the leader lease and the deploy-folder lock.',
  file_listener_state: 'One row per deployed file trigger after its first folder baseline, shared by leaders so a takeover does not baseline the folder again.',
  file_listener_files: 'The last durably handled size and modification time of each path for a file trigger, shared across leader changes.',
  bus_messages: 'Durable queue/topic delivery identities and their reserved run: Kafka offset or RabbitMQ/AMQP message id, used to avoid starting a second run after redelivery or leader takeover.',
  alert_channels: 'Where alerts go: email (an SMTP connection and addresses), webhook (address and signing secret name), or a Sutra.',
  alert_rules: 'What to watch: kind, settings, severity, channels, on or off, tell when resolved, reminder minutes.',
  alerts: 'Alerts: rule, severity, state (firing, acknowledged, resolved), message and details, times, who acknowledged, what was sent where.',
  gw_plans: 'Gateway plans: requests per minute, hour and day, and a monthly quota.',
  gw_apps: 'Gateway apps: name, contact, scopes, plan, disabled.',
  gw_keys: 'API keys of gateway apps: hash, name, expiry and last use. Key values are never stored.',
  gw_usage: 'Requests per app in the current minute, hour, day and month windows, shared by every engine.',
  git_accounts: 'Git accounts of each person: provider, host, login, encrypted token, author name and email.',
  git_workspaces: 'Projects connected to Git: the working copy folder, remote, branch, team or personal, owner, trusted.',
  git_ids: 'Per workspace, repository ids of Sutras, connections and schemas against the ids of its project here.',
  ai_sessions: 'One row per conversation of an AI memory store: running summary, last turn number, counts, and which run holds it.',
  ai_memory: 'Turns of AI conversations kept in the built-in memory store (role, text or sealed text, tokens).',
  ai_session_queue: 'Runs waiting for a conversation, in arrival order; the first one holds it.',
  ai_agent_state: 'Progress of an AI agent step in a run (tool steps, tokens, the tool it waits for), removed when the step finishes.',
  ai_knowledge: 'Passages of built-in knowledge bases with their source, details and vector.',
  folders: 'Explorer folders of a project kept while nothing is in them, per area (sutras, resources, schemas, wsdl); each item keeps its own folder in a folder column.',
  gw_requests: 'The gateway request log: time, engine, method, path, service, app, caller, status, time taken, sizes, address, run and error.',
  users: 'People and system accounts: password hash, name, email, disabled, must change password, failed sign-ins, lock, sessions valid after, last sign-in.',
  roles: 'Built-in and custom roles with their permissions.',
  grants: 'Which role each account holds, for all projects (empty project) or one project.',
  api_tokens: 'API tokens of system accounts: hash, name, expiry and last use. Token values are never stored.',
  audit: 'Audit log: time, actor, address, action, target, project, status, outcome and safe details.',
  approval_votes: 'Each approver\'s decision on an approval: the step\'s task, the username, approved or not, the comment, when, and whether an administrator decided on behalf of the approvers.',
  run_outputs: 'The output of each step of a run, one row per step name (a later pass of a loop replaces it), read by the steps after it. Kept apart from the run state so a step writes only its own output.',
  replay_guard: 'Signatures of HMAC-signed requests seen recently, so a replay to any engine is refused; each row expires after twice the allowed age.',
  acme_challenges: 'Short-lived HTTP-01 tokens and public key authorisations for a Let\'s Encrypt order, shared so any gateway engine can answer the challenge.',
  sso_states: 'One-time SAML browser or API-client sign-in requests: random state, request id, callback and return path, shared by every engine and paired with a signed client cookie; removed when used or expired.',
  ws_connections: 'Open WebSocket connections of every engine: id, engine, service path, Sutra, caller. Lets a step on one engine reach a connection held by another.',
  ws_outbox: 'Messages for WebSocket connections held by another engine, waiting a fraction of a second for that engine to deliver them.',
};

/** The tables by what they are for, in the order the guide shows them. */
export const TABLE_GROUPS: [string, string[]][] = [
  ['Projects and Sutras', ['projects', 'flows', 'flow_versions', 'deployments', 'resources', 'schemas', 'folders', 'counters', 'mem_rows', 'mem_meta']],
  ['Runs and the work queue', ['runs', 'tasks', 'run_outputs', 'approval_votes']],
  ['Releases and the cluster', ['package_deployments', 'engines', 'leases', 'file_listener_state', 'file_listener_files', 'bus_messages']],
  ['People, access and audit', ['users', 'roles', 'grants', 'api_tokens', 'sso_states', 'audit']],
  ['Vault and server settings', ['secrets', 'settings']],
  ['API gateway', ['gw_apps', 'gw_keys', 'gw_plans', 'gw_usage', 'gw_requests', 'replay_guard', 'acme_challenges', 'ws_connections', 'ws_outbox']],
  ['Alerts', ['alert_rules', 'alert_channels', 'alerts']],
  ['AI', ['ai_sessions', 'ai_memory', 'ai_session_queue', 'ai_agent_state', 'ai_knowledge']],
  ['Git', ['git_accounts', 'git_workspaces', 'git_ids']],
];

/** Tables holding values encrypted with the master key, and those that grow with use (and what keeps them in check). */
export const TABLE_NOTES: Record<string, { encrypted?: string; grows?: string }> = {
  secrets: { encrypted: 'every value' },
  settings: { encrypted: 'the gateway TLS key, the OAuth tokens of connections, Git account tokens' },
  git_accounts: { encrypted: 'tokens' },
  ai_memory: { encrypted: 'sealed turns, when the memory store seals them', grows: 'turns older than the store\'s days to keep are deleted' },
  users: { encrypted: 'passwords are salted hashes, never reversible' },
  runs: { grows: 'one row per run; housekeeping deletes runs older than the retention days (Admin Console > Engines > Tuning)' },
  tasks: { grows: 'one row per step; deleted with their run' },
  run_outputs: { grows: 'one row per step name of a run; deleted with their run' },
  replay_guard: { grows: 'one row per signed request; housekeeping deletes expired rows' },
  acme_challenges: { grows: 'one row per active HTTP-01 proof; removed after validation, with expired rows removed before the next order' },
  sso_states: { grows: 'one row per SAML sign-in start; consumed by the callback and expired rows are deleted at the next sign-in' },
  audit: { grows: 'one row per change; the audit retention days apply (Admin Console > Audit log)' },
  gw_requests: { grows: 'one row per gateway request; kept for the retention days' },
  gw_usage: { grows: 'short windows, replaced as they pass' },
  alerts: { grows: 'one row per alert; resolved alerts follow the run retention' },
  flow_versions: { grows: 'one row per published version; kept for rollback' },
  package_deployments: { grows: 'one row per package deployment, with the package; kept for rollback' },
  file_listener_files: { grows: 'one row per path currently known by each file trigger; removed when the path is removed' },
  bus_messages: { grows: 'one row per protected broker delivery; failed deliveries are removed for retry and completed identities follow run retention' },
  ai_knowledge: { grows: 'one row per passage of built-in knowledge bases' },
};

/** Tables and their columns: the schema in db.ts, plus the columns later versions add (add('table', 'column', ...)). */
export function schemaTables(root: string) {
  const src = fs.readFileSync(path.join(root, 'server', 'src', 'db.ts'), 'utf8');
  const schema = /const SCHEMA = `([\s\S]*?)`;/.exec(src)?.[1] || '';
  const out: { name: string; cols: string[] }[] = [];
  for (const m of schema.matchAll(/create table if not exists (\w+)\(([\s\S]*?)\);/g)) {
    const cols = m[2].replace(/\s+/g, ' ').split(/,(?![^(]*\))/).map(c => c.trim()).filter(c => c && !/^primary key/.test(c)).map(c => c.split(' ')[0]);
    out.push({ name: m[1], cols });
  }
  for (const m of src.matchAll(/add\('(\w+)', '(\w+)'/g)) {
    const t = out.find(x => x.name === m[1]);
    if (t && !t.cols.includes(m[2])) t.cols.push(m[2]);
  }
  return out;
}
