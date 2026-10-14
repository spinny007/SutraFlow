import { deployedFlows } from './flows.js';
import { engine } from './engine/engine.js';
import { resolveSettings } from './settings.js';
import { effectiveVariables, engineVariableValues } from './projects.js';

/**
 * Internal channels: Send to channel starts every deployed Sutra of the same project whose Channel
 * trigger listens on that channel. It reads the deployments from the database, so it works the same
 * on one engine or many (no in-memory subscription is needed).
 */
const norm = (c: unknown) => String(c ?? '').trim().toLowerCase();

export function publishChannel(projectId: string | null | undefined, channel: string, message: unknown): string[] {
  const out: string[] = [];
  const want = norm(channel);
  for (const d of deployedFlows()) {
    if ((d.projectId || '') !== (projectId || '')) continue;
    for (const n of d.doc.nodes) {
      if (n.type !== 'channelTrigger') continue;
      const act = engine.activity(n.type);
      const cfg = act ? resolveSettings(act.fields, n.config, { gv: effectiveVariables(d.projectId).values, ev: engineVariableValues() }) : n.config;
      if (norm(cfg.channel) !== want) continue;
      out.push(engine.startRun({ doc: d.doc, flowId: d.flowId, projectId: d.projectId, version: d.version, triggerNodeId: n.id, input: structuredClone(message ?? null), source: 'channelTrigger' }));
    }
  }
  return out;
}
