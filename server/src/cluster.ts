import os from 'node:os';
import { q, getSetting, setSetting, now } from './db.js';
import { config, version } from './config.js';
import { engine } from './engine/engine.js';

/**
 * Several engines on one database (PostgreSQL, or SQLite on one host).
 *
 *  Heartbeat  every engine writes one each SUTRA_HEARTBEAT_MS; an engine silent for three beats is dead.
 *  Leader     one engine holds the "leader" lease and runs what must happen once: timers, folder,
 *             mailbox, queue and Drive listeners, recovery of dead engines' steps, housekeeping.
 *             The lease lasts three beats; when the leader stops renewing it, another engine takes it.
 *  Recovery   the leader puts steps that a dead engine was running back in the queue.
 *  Deploys    a deploy, connection or project change bumps a generation number; every engine
 *             compares it on each beat and reloads its routes (and the leader its listeners).
 *  Drain      the Admin Console marks an engine; that engine drains and stops on its next beat.
 */
export interface ClusterHooks { becameLeader(): void; lostLeader(): void; deploymentsChanged(): void; housekeeping?(): void; drainRequested?(): void }

export const cluster = { leader: false, started: false, draining: false, gen: -1 };
let timer: NodeJS.Timeout | null = null;
let hooks: ClusterHooks | null = null;
let beats = 0;

const deadAfter = () => config.heartbeatMs * 3;
const FORGET_MS = 10 * 60 * 1000;

export function startCluster(h: ClusterHooks) {
  hooks = h;
  cluster.started = true;
  cluster.draining = false;
  cluster.gen = getSetting<number>('deployGen', 0);
  q.run(`insert into engines(id, host, pid, mode, version, started_at, heartbeat_at, workers, active, draining) values(?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
    on conflict(id) do update set host = excluded.host, pid = excluded.pid, mode = excluded.mode, version = excluded.version, started_at = excluded.started_at, heartbeat_at = excluded.heartbeat_at, workers = excluded.workers, active = 0, draining = 0, drain_requested = 0`,
    config.engineId, os.hostname(), process.pid, config.mode, version, now(), Date.now(), engine.concurrency);
  beat();
  timer = setInterval(beat, config.heartbeatMs);
  timer.unref?.();
}

/** One heartbeat: liveness, the leader lease, recovery, deploys, cancelled steps. */
export function beat() {
  if (!hooks) return;
  const t = Date.now();
  q.run('update engines set heartbeat_at = ?, active = ?, draining = ? where id = ?', t, engine.running, cluster.draining ? 1 : 0, config.engineId);
  const wasLeader = cluster.leader;
  cluster.leader = !cluster.draining && tryLead(t);
  if (cluster.leader && !wasLeader) hooks.becameLeader();
  if (!cluster.leader && wasLeader) hooks.lostLeader();
  if (cluster.leader) {
    recoverOrphans(t);
    // Sutra tuning: run time limits, and queued runs whose turn came on another engine.
    engine.enforceRunTimeouts(t);
    engine.promoteQueued();
    // Engines that stopped without saying goodbye (killed, crashed) are forgotten after ten minutes.
    q.run('delete from engines where heartbeat_at < ? and id != ?', t - Math.max(deadAfter() * 2, FORGET_MS), config.engineId);
    if (beats++ % 12 === 0) hooks.housekeeping?.();
  }
  const gen = getSetting<number>('deployGen', 0);
  if (gen !== cluster.gen) { cluster.gen = gen; hooks.deploymentsChanged(); }
  engine.abortCancelledHere();
  // The Admin Console asked this engine to drain and stop.
  if (!cluster.draining && Number(q.get<any>('select drain_requested from engines where id = ?', config.engineId)?.drain_requested)) hooks.drainRequested?.();
}

function tryLead(t: number) {
  q.run(`insert into leases(name, holder, expires_at) values('leader', ?, ?) on conflict(name) do nothing`, config.engineId, t + deadAfter());
  const r = q.run(`update leases set holder = ?, expires_at = ? where name = 'leader' and (holder = ? or expires_at < ?)`, config.engineId, t + deadAfter(), config.engineId, t);
  return Number(r.changes) > 0;
}

/** Steps owned by engines that stopped beating go back to the queue. */
export function recoverOrphans(t = Date.now()) {
  const r = q.run(`update tasks set status = 'pending', owner = null
    where status = 'running' and owner is not null and owner not in (select id from engines where heartbeat_at >= ?)`, t - deadAfter());
  return Number(r.changes);
}

/** Tells every engine (on its next beat) that deployments, connections or projects changed. */
export function bumpDeployGen() {
  const g = getSetting<number>('deployGen', 0) + 1;
  setSetting('deployGen', g);
  cluster.gen = g; // this engine already applied it
}

/** Marks this engine as draining (status shows it) and gives up leadership at once. */
export function leaveLeadership() {
  cluster.draining = true;
  q.run('update engines set draining = 1 where id = ?', config.engineId);
  if (cluster.leader) {
    q.run(`delete from leases where name = 'leader' and holder = ?`, config.engineId);
    cluster.leader = false;
    hooks?.lostLeader();
  }
}

export function stopCluster() {
  if (timer) clearInterval(timer);
  timer = null;
  if (cluster.started) {
    q.run(`delete from leases where name = 'leader' and holder = ?`, config.engineId);
    q.run('delete from engines where id = ?', config.engineId);
  }
  cluster.leader = false;
  cluster.started = false;
  cluster.draining = false;
  hooks = null;
}

/** Engines, leader, queue: for /api/engine/status and the command-line tool. */
export function clusterStatus() {
  const t = Date.now();
  const lease = q.get<{ holder: string; expires_at: number }>(`select holder, expires_at from leases where name = 'leader'`);
  const engines = q.all<any>('select * from engines order by started_at').map(e => ({
    id: e.id, host: e.host, pid: Number(e.pid), mode: e.mode, version: e.version, startedAt: e.started_at,
    alive: Number(e.heartbeat_at) >= t - deadAfter(), heartbeatAgeMs: t - Number(e.heartbeat_at), workers: Number(e.workers), running: Number(e.active), draining: !!Number(e.draining),
    leader: !!lease && lease.holder === e.id && Number(lease.expires_at) >= t,
  }));
  const counts = Object.fromEntries(q.all<{ status: string; n: number }>(`select status, count(*) as n from tasks where status in ('pending', 'running', 'waiting', 'paused') group by status`).map(r => [r.status, Number(r.n)]));
  return { self: config.engineId, leader: lease && Number(lease.expires_at) >= t ? lease.holder : null, engines, tasks: { pending: counts.pending || 0, running: counts.running || 0, waiting: counts.waiting || 0, paused: counts.paused || 0 } };
}
