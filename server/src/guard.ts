import { q } from './db.js';
import { can, PERMISSIONS, type Caller } from './access.js';
import { audit } from './audit.js';

/**
 * Permission of every admin API route, and the project it applies to. The server refuses to start
 * when a route has no rule, so a new route can never be left open by mistake.
 *
 *  perm null       any signed-in caller (lists are filtered to the caller's projects by the handler)
 *  on              where the project comes from:
 *    project       :id is a project        flow / run / resource / schema / task: :id of that kind
 *    bodyProject   body.projectId          queryProject: ?projectId (absent = any project)
 *    package       the package's project, by name (a new project needs the grant on all projects)
 *    all           needs the grant on all projects
 *  quiet           reads with POST (previews, checks): not written to the audit log
 */
type On = 'project' | 'flow' | 'run' | 'resource' | 'schema' | 'task' | 'bodyProject' | 'queryProject' | 'package' | 'all';
interface Rule { perm: string | null; on?: On; quiet?: boolean }

const R = (perm: string | null, on?: On, quiet?: boolean): Rule => ({ perm, on, quiet });

export const RULES: Record<string, Rule> = {
  'GET /api/meta': R(null),
  'GET /api/access/me': R(null),
  'POST /api/auth/password': R(null),

  'GET /api/projects': R(null),
  'POST /api/projects': R('design', 'all'),
  'GET /api/projects/:id': R('view', 'project'),
  'PUT /api/projects/:id': R('design', 'project'),
  'DELETE /api/projects/:id': R('design', 'project'),
  'GET /api/projects/:id/ops': R('deploy', 'project'),
  'PUT /api/projects/:id/ops': R('deploy', 'project'),
  'GET /api/projects/:id/ops/file': R('deploy', 'project'),
  'POST /api/projects/:id/ops/file': R('deploy', 'project'),
  'GET /api/projects/:id/runtime-variables': R('view', 'project'),
  'DELETE /api/projects/:id/runtime-variables': R('operate', 'project'),
  'GET /api/engine-variables': R(null),
  'PUT /api/engine-variables': R('server'),
  'GET /api/samples': R(null),
  'POST /api/projects/:id/samples': R('design', 'project'),
  'GET /api/projects/:id/log': R('view', 'project'),

  'GET /api/projects/:id/package': R('view', 'project'),
  'POST /api/packages/check': R('deploy', 'package', true),
  'POST /api/packages/deploy': R('deploy', 'package'),
  'POST /api/packages/test': R('deploy', undefined, true),
  'GET /api/projects/:id/packages': R('view', 'project'),
  'POST /api/projects/:id/rollback': R('deploy', 'project'),
  'POST /api/projects/import': R('design', 'all'),
  'POST /api/projects/:id/copy': R('design', 'all'),

  'GET /api/engine/status': R(null),
  'POST /api/engine/drain': R('engines'),
  'POST /api/engine/housekeeping': R('engines'),
  'GET /api/releases/policy': R(null),
  'PUT /api/releases/policy': R('server'),
  'GET /api/scripts/policy': R(null),
  'PUT /api/scripts/policy': R('server'),
  'GET /api/engine-variables/policy': R(null),
  'PUT /api/engine-variables/policy': R('server'),

  'GET /api/oauth/:id': R('view', 'resource'),
  'GET /api/oauth/:id/start': R('connections', 'resource'),
  'DELETE /api/oauth/:id': R('connections', 'resource'),

  'GET /api/schemas': R('view', 'queryProject'),
  'GET /api/schemas/:id': R('view', 'schema'),
  'POST /api/schemas': R('design', 'bodyProject'),
  'PUT /api/schemas/:id': R('design', 'schema'),
  'DELETE /api/schemas/:id': R('design', 'schema'),
  'GET /api/schemas/:id/tree': R('view', 'schema'),
  'POST /api/design/schemas': R('design', undefined, true),
  'POST /api/expr/eval': R('design', undefined, true),

  'GET /api/flows': R('view', 'queryProject'),
  'POST /api/flows': R('design', 'bodyProject'),
  'GET /api/flows/:id': R('view', 'flow'),
  'PUT /api/flows/:id': R('design', 'flow'),
  'PUT /api/flows/:id/folder': R('design', 'flow'),
  'GET /api/projects/:id/folders': R('view', 'project'),
  'POST /api/projects/:id/folders': R('design', 'project'),
  'POST /api/projects/:id/folders/move': R('design', 'project'),
  'DELETE /api/projects/:id/folders': R('design', 'project'),
  'DELETE /api/flows/:id': R('design', 'flow'),
  'POST /api/flows/validate': R('design', undefined, true),
  'GET /api/flows/:id/versions': R('view', 'flow'),
  'POST /api/flows/:id/deploy': R('deploy', 'flow'),
  'DELETE /api/flows/:id/deploy': R('deploy', 'flow'),
  'POST /api/flows/:id/test': R('design', 'flow'),
  'GET /api/flows/:id/sample': R('view', 'flow'),
  'POST /api/flows/:id/run': R('operate', 'flow'),

  'GET /api/runs': R(null),
  'GET /api/runs/:id': R('view', 'run'),
  'POST /api/runs/:id/resubmit': R('operate', 'run'),
  'POST /api/runs/:id/cancel': R('operate', 'run'),
  'POST /api/runs/:id/debug': R('design', 'run'),
  'GET /api/approvals': R(null),
  'POST /api/approvals/:id': R('approve', 'task'),
  'GET /api/events': R(null),

  'GET /api/resources': R('view', 'queryProject'),
  'POST /api/resources/test': R('connections', 'bodyProject', true),
  'POST /api/resources/models': R('connections', 'bodyProject', true),
  'POST /api/resources/ollama/:action': R('server'),
  'POST /api/resources': R('connections', 'bodyProject'),
  'PUT /api/resources/:id': R('connections', 'resource'),
  'DELETE /api/resources/:id': R('connections', 'resource'),
  'GET /api/secrets': R('view'),
  'PUT /api/secrets/:name': R('secrets'),
  'DELETE /api/secrets/:name': R('secrets'),
  'POST /api/soap/describe': R('design', undefined, true),

  'GET /api/server': R('view'),
  'PUT /api/server/gateway': R('server'),
  'PUT /api/server/tls': R('server'),
  'POST /api/server/tls/self-signed': R('server'),
  'POST /api/server/tls/upload': R('server'),
  'POST /api/server/tls/acme': R('server'),

  'GET /api/access/permissions': R(null),
  'GET /api/access/roles': R('users'),
  'POST /api/access/roles': R('users'),
  'PUT /api/access/roles/:id': R('users'),
  'DELETE /api/access/roles/:id': R('users'),
  'GET /api/access/users': R('users'),
  'POST /api/access/users': R('users'),
  'GET /api/access/users/:name': R('users'),
  'PUT /api/access/users/:name': R('users'),
  'DELETE /api/access/users/:name': R('users'),
  'POST /api/access/users/:name/password': R('users'),
  'POST /api/access/users/:name/unlock': R('users'),
  'POST /api/access/users/:name/sign-out': R('users'),
  'GET /api/access/users/:name/tokens': R('users'),
  'POST /api/access/users/:name/tokens': R('users'),
  'DELETE /api/access/users/:name/tokens/:id': R('users'),
  'GET /api/console/overview': R(null),
  'GET /api/console/apps': R(null),
  'PUT /api/console/sutras/:id/enabled': R('operate', 'flow'),
  'POST /api/console/engines/:id/drain': R('engines'),
  'POST /api/console/sutras/:id/restart': R('operate', 'flow'),
  'GET /api/console/tuning': R(null),
  'PUT /api/console/tuning/engine': R('engines'),
  'PUT /api/console/tuning/engines/:id': R('engines'),
  'GET /api/console/sutras/:id/tuning': R('view', 'flow'),
  'PUT /api/console/sutras/:id/tuning': R('operate', 'flow'),
  'GET /api/gateway/apps': R('gateway'),
  'POST /api/gateway/apps': R('gateway'),
  'PUT /api/gateway/apps/:id': R('gateway'),
  'DELETE /api/gateway/apps/:id': R('gateway'),
  'GET /api/gateway/apps/:id/keys': R('gateway'),
  'POST /api/gateway/apps/:id/keys': R('gateway'),
  'DELETE /api/gateway/apps/:id/keys/:keyId': R('gateway'),
  'GET /api/gateway/plans': R('gateway'),
  'POST /api/gateway/plans': R('gateway'),
  'PUT /api/gateway/plans/:id': R('gateway'),
  'DELETE /api/gateway/plans/:id': R('gateway'),
  'GET /api/gateway/firewall': R('gateway'),
  'PUT /api/gateway/firewall': R('gateway'),
  'GET /api/gateway/options': R('gateway'),
  'PUT /api/gateway/options': R('gateway'),
  'GET /api/gateway/stats': R('gateway'),
  'GET /api/gateway/requests': R('gateway'),
  'GET /api/gateway/apis': R('gateway'),
  'GET /api/gateway/openapi': R('gateway'),
  'GET /api/alerts': R('view'),
  'GET /api/alerts/summary': R(null),
  'POST /api/alerts/check': R('alerts'),
  'POST /api/alerts/:id/acknowledge': R('alerts'),
  'POST /api/alerts/:id/resolve': R('alerts'),
  'GET /api/alerts/kinds': R(null),
  'GET /api/alerts/rules': R('view'),
  'POST /api/alerts/rules': R('alerts'),
  'PUT /api/alerts/rules/:id': R('alerts'),
  'DELETE /api/alerts/rules/:id': R('alerts'),
  'POST /api/alerts/rules/:id/check': R('alerts', undefined, true),
  'GET /api/alerts/channels': R('alerts'),
  'POST /api/alerts/channels': R('alerts'),
  'PUT /api/alerts/channels/:id': R('alerts'),
  'DELETE /api/alerts/channels/:id': R('alerts'),
  'POST /api/alerts/channels/:id/test': R('alerts'),
  'GET /api/audit': R('audit'),
  'GET /api/audit/export': R('audit'),
};

/** Routes reachable before sign-in. */
export const OPEN_ROUTES = new Set(['GET /api/auth/status', 'POST /api/auth/setup', 'POST /api/auth/login', 'POST /api/auth/logout', 'GET /api/oauth/callback']);

const SERVER_PERMS = new Set(PERMISSIONS.filter(p => p.scope === 'server').map(p => p.id));
const projectOf = (table: string, id: unknown) => q.get<any>(`select project_id from ${table} where id = ?`, String(id ?? ''))?.project_id as string | undefined;

/** The project a request applies to: an id, '' for all projects, or undefined for any project. */
export function requestProject(rule: Rule, req: any): string | undefined {
  const p = req.params || {}, b = req.body || {}, qs = req.query || {};
  switch (rule.on) {
    case 'project': return String(p.id);
    case 'flow': return projectOf('flows', p.id);
    case 'run': return projectOf('runs', p.id);
    case 'resource': return projectOf('resources', p.id);
    case 'schema': return projectOf('schemas', p.id);
    case 'task': return q.get<any>('select r.project_id from tasks t join runs r on r.id = t.run_id where t.id = ?', Number(p.id))?.project_id;
    case 'bodyProject': return b.projectId || b.project_id || undefined;
    case 'queryProject': return qs.projectId || undefined;
    case 'package': {
      let name = typeof b.project === 'string' && b.project.trim() ? b.project.trim() : '';
      if (!name) { try { const pk = typeof b.package === 'string' ? JSON.parse(b.package) : b.package; name = String(pk?.project?.name || ''); } catch { /* checked by the handler */ } }
      const found = name ? q.get<any>('select id from projects where lower(name) = lower(?)', name) : undefined;
      return found ? found.id : '';
    }
    case 'all': return '';
    default: return undefined;
  }
}

/** Checks the rule; returns an error message when the caller may not. */
export function check(rule: Rule, caller: Caller, req: any): string | null {
  if (!rule.perm) return null;
  const project = SERVER_PERMS.has(rule.perm) ? undefined : requestProject(rule, req);
  req.auditProject = project || '';
  if (can(caller, rule.perm, project)) return null;
  const perm = PERMISSIONS.find(p => p.id === rule.perm)!.name;
  if (SERVER_PERMS.has(rule.perm)) return `You need the ${perm} permission`;
  if (project === '') return `You need the ${perm} permission on all projects`;
  if (project) {
    const name = q.get<any>('select name from projects where id = ?', project)?.name || project;
    return `You need the ${perm} permission on project ${name}`;
  }
  return `You need the ${perm} permission`;
}

// Fields copied into the audit log. Passwords, secret values, tokens and package contents never are.
const SAFE = ['name', 'version', 'note', 'approved', 'comment', 'enabled', 'disabled', 'keepOthers', 'project', 'projectId', 'project_id', 'kind',
  'username', 'displayName', 'email', 'grants', 'perms', 'mode', 'allowed', 'sutrasMayChange', 'to', 'retentionDays', 'action', 'mustChange', 'expiresDays', 'domains', 'httpPort', 'httpsPort'];

export function auditRequest(req: any, status: number, rule: Rule | undefined, denied?: string) {
  const method = req.method.toUpperCase();
  if ((method === 'GET' || method === 'HEAD') && !denied) return;
  if (rule?.quiet && !denied) return;
  const b = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const details: Record<string, unknown> = {};
  for (const k of SAFE) if (b[k] !== undefined) details[k] = b[k];
  if (b.package) { try { const pk = typeof b.package === 'string' ? JSON.parse(b.package) : b.package; details.package = { name: pk?.name, version: pk?.version, checksum: pk?.checksum }; } catch { /* not a package */ } }
  if (denied) details.reason = denied;
  const pattern = req.routeOptions?.url || req.url.split('?')[0];
  const params = req.params && Object.keys(req.params).length ? Object.entries(req.params).map(([k, v]) => `${k}=${v}`).join(' ') : '';
  audit({
    actor: req.user?.u || 'anonymous', actorKind: req.user?.kind, ip: req.ip, action: `${method} ${pattern}`, method, path: req.url.split('?')[0],
    target: params, projectId: req.auditProject || '', status, outcome: denied ? 'denied' : status < 400 ? 'ok' : 'failed', details: Object.keys(details).length ? details : undefined,
  });
}
