/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
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
 *  Alerts     the leader checks the alert rules every six beats (30 seconds by default).
 */
export interface ClusterHooks { becameLeader(): void; lostLeader(): void; deploymentsChanged(): void; gatewayChanged?(): void; tlsChanged?(): void; housekeeping?(): void; drainRequested?(): void; alerts?(): void }

export const cluster = { leader: false, started: false, draining: false, gen: -1, gatewayGen: -1, tlsGen: -1 };
let timer: NodeJS.Timeout | null = null;
let hooks: ClusterHooks | null = null;
let beats = 0;
let heartbeatError = false;

const deadAfter = () => config.heartbeatMs * 3;
const FORGET_MS = 10 * 60 * 1000;

export function startCluster(h: ClusterHooks) {
  hooks = h;
  cluster.started = true;
  cluster.draining = false;
  cluster.gen = getSetting<number>('deployGen', 0);
  cluster.gatewayGen = getSetting<number>('gatewayGen', 0);
  cluster.tlsGen = getSetting<number>('tlsGen', 0);
  q.run(`insert into engines(id, host, pid, mode, version, started_at, heartbeat_at, workers, active, draining, can_lead) values(?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)
    on conflict(id) do update set host = excluded.host, pid = excluded.pid, mode = excluded.mode, version = excluded.version, started_at = excluded.started_at, heartbeat_at = excluded.heartbeat_at, workers = excluded.workers, active = 0, draining = 0, drain_requested = 0, can_lead = excluded.can_lead`,
    config.engineId, os.hostname(), process.pid, config.mode, version, now(), Date.now(), engine.concurrency, config.canLead ? 1 : 0);
  beat();
  timer = setInterval(beatSafely, config.heartbeatMs);
  timer.unref?.();
}

/** A database interruption must make this engine temporarily stand down, never terminate it. */
export function beatSafely() {
  try {
    beat();
    if (heartbeatError) console.log('Cluster heartbeat recovered');
    heartbeatError = false;
  } catch (e: any) {
    // Keep the last-known local leadership state while the database answer is unknown. Stopping
    // and rebuilding a folder listener here would baseline files that arrived during the outage and
    // lose their events. A disconnected listener cannot durably start a run; after reconnection the
    // database lease remains authoritative and beat() calls lostLeader if another engine took it.
    // Log once per interruption rather than once per heartbeat while PostgreSQL is unavailable.
    if (!heartbeatError) console.error('Cluster heartbeat failed; retrying:', e?.message || e);
    heartbeatError = true;
  }
}

/** One heartbeat: liveness, the leader lease, recovery, deploys, cancelled steps. */
export function beat() {
  if (!hooks) return;
  const t = Date.now();
  q.run('update engines set heartbeat_at = ?, active = ?, draining = ? where id = ?', t, engine.running, cluster.draining ? 1 : 0, config.engineId);
  const wasLeader = cluster.leader;
  // SUTRA_CAN_LEAD=0: this engine never takes the lease (and lets go of it at once if it held it).
  cluster.leader = !cluster.draining && config.canLead && tryLead(t);
  if (!config.canLead && wasLeader) q.run(`delete from leases where name = 'leader' and holder = ?`, config.engineId);
  if (cluster.leader && !wasLeader) hooks.becameLeader();
  if (!cluster.leader && wasLeader) hooks.lostLeader();
  if (cluster.leader) {
    recoverOrphans(t);
    // Sutra tuning: run time limits, and queued runs whose turn came on another engine.
    engine.enforceRunTimeouts(t).catch(e => console.error('Run time limits:', e?.message || e));
    engine.promoteQueued().catch(e => console.error('Starting queued runs:', e?.message || e));
    // Engines that stopped without saying goodbye (killed, crashed) are forgotten after ten minutes.
    q.run('delete from engines where heartbeat_at < ? and id != ?', t - Math.max(deadAfter() * 2, FORGET_MS), config.engineId);
    if (beats % 6 === 0) hooks.alerts?.();
    if (beats++ % 12 === 0) hooks.housekeeping?.();
  }
  const gen = getSetting<number>('deployGen', 0);
  if (gen !== cluster.gen) { cluster.gen = gen; hooks.deploymentsChanged(); }
  const gatewayGen = getSetting<number>('gatewayGen', 0);
  if (gatewayGen !== cluster.gatewayGen) { cluster.gatewayGen = gatewayGen; hooks.gatewayChanged?.(); }
  const tlsGen = getSetting<number>('tlsGen', 0);
  if (tlsGen !== cluster.tlsGen) { cluster.tlsGen = tlsGen; hooks.tlsChanged?.(); }
  engine.abortCancelledHere().catch(() => {});
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

/** Tells every other engine to restart its gateway listeners after listener settings change. */
export function bumpGatewayGen() {
  const g = getSetting<number>('gatewayGen', 0) + 1;
  setSetting('gatewayGen', g);
  cluster.gatewayGen = g;
}

/** Tells every other engine to reload the shared TLS certificate and options without dropping connections. */
export function bumpTlsGen() {
  const g = getSetting<number>('tlsGen', 0) + 1;
  setSetting('tlsGen', g);
  cluster.tlsGen = g;
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
/**
 * Display names of engines, set in the Admin Console. The engine id (SUTRA_ENGINE_ID, by default the
 * host name and process) stays the engine's identity: running steps record it as their owner and the
 * leader recovers by it, so it is not renamed; the display name is what people see.
 */
export const engineNames = () => getSetting<Record<string, string>>('engineNames', {});
export function setEngineName(id: string, name: string) {
  const all = engineNames();
  const n = String(name || '').trim().slice(0, 60);
  if (n) all[id] = n; else delete all[id];
  setSetting('engineNames', all);
  return n;
}

export function clusterStatus() {
  const t = Date.now();
  const names = engineNames();
  const lease = q.get<{ holder: string; expires_at: number }>(`select holder, expires_at from leases where name = 'leader'`);
  const engines = q.all<any>('select * from engines order by started_at').map(e => ({
    id: e.id, name: names[e.id] || '', host: e.host, pid: Number(e.pid), mode: e.mode, version: e.version, startedAt: e.started_at,
    alive: Number(e.heartbeat_at) >= t - deadAfter(), heartbeatAgeMs: t - Number(e.heartbeat_at), workers: Number(e.workers), running: Number(e.active), draining: !!Number(e.draining), canLead: e.can_lead === undefined || e.can_lead === null ? true : !!Number(e.can_lead),
    leader: !!lease && lease.holder === e.id && Number(lease.expires_at) >= t,
  }));
  const counts = Object.fromEntries(q.all<{ status: string; n: number }>(`select status, count(*) as n from tasks where status in ('pending', 'running', 'waiting', 'paused') group by status`).map(r => [r.status, Number(r.n)]));
  return { self: config.engineId, leader: lease && Number(lease.expires_at) >= t ? lease.holder : null, engines, tasks: { pending: counts.pending || 0, running: counts.running || 0, waiting: counts.waiting || 0, paused: counts.paused || 0 } };
}
