/**
 * Internal channels: processes of one project signal each other in memory.
 * Channel triggers of deployed processes subscribe (see listeners.ts); Send to channel publishes.
 */
type Subscriber = (message: unknown) => string;

const subs = new Map<string, Set<Subscriber>>();
const key = (projectId: string | null | undefined, channel: string) => `${projectId || ''}::${channel.trim().toLowerCase()}`;

export function subscribeChannel(projectId: string | null | undefined, channel: string, fn: Subscriber) {
  const k = key(projectId, channel);
  let set = subs.get(k);
  if (!set) subs.set(k, (set = new Set()));
  set.add(fn);
  return () => { set!.delete(fn); if (!set!.size) subs.delete(k); };
}

/** Starts every subscribed process; returns their run ids. */
export function publishChannel(projectId: string | null | undefined, channel: string, message: unknown): string[] {
  const out: string[] = [];
  for (const fn of subs.get(key(projectId, channel)) || []) out.push(fn(structuredClone(message ?? null)));
  return out;
}
