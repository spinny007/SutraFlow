import { q } from '../db.js';

/**
 * Restricted mode: a personal copy cloned from a repository runs no code from it until its owner
 * trusts the repository. Blocked: PowerShell, shell scripts, programs, custom JavaScript, release
 * steps, and MCP steps (Call MCP tool, AI agent) whose MCP connection starts a command on this server.
 * Reading, editing and every other activity work as usual.
 */
const RISKY = new Set(['powershell', 'shellScript', 'runProgram', 'python', 'databricksCommand', 'jsCode', 'releasePackage', 'releaseCheck', 'releaseDeploy', 'releaseRollback']);
const cache = new Map<string, boolean>();

export function isRestricted(projectId: string | null | undefined) {
  if (!projectId) return false;
  if (!cache.has(projectId)) cache.set(projectId, !!q.get<any>('select restricted from projects where id = ?', projectId)?.restricted);
  return cache.get(projectId)!;
}
export const forgetRestricted = (projectId: string) => cache.delete(projectId);

/** Why a step may not run in a restricted project, or null. */
export function restrictedReason(projectId: string | null | undefined, node: { type: string; name: string; config?: Record<string, any> }) {
  if (!isRestricted(projectId)) return null;
  let risky = RISKY.has(node.type);
  if (!risky && (node.type === 'mcpCall' || node.type === 'aiAgent') && node.config?.mcp) {
    risky = q.get<any>('select config from resources where id = ?', node.config.mcp)?.config?.includes('"transport":"command"') ?? false;
  }
  return risky ? `${node.name}: this copy is in restricted mode, so it does not run code or commands from the repository. Trust the repository in the Git tab to run it.` : null;
}
