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

/**
 * Machine sizing: the profile of the machine an engine runs on and the settings recommended for it.
 * The numbers come from the load tests in docs/benchmarks (tools/loadtest.mjs); the user guide
 * chapter "Sizing and performance" explains them. Engine defaults follow the recommendation unless an
 * environment variable sets them, and the Admin Console can apply it with one click.
 *
 * No imports from the rest of the server: config.ts reads the defaults from here.
 */
export interface Profile {
  /** Short name of the profile. */
  name: string;
  /** The machine size it is meant for. */
  machine: string;
  /** Steps at once per engine (I/O waits mostly: more than cores). */
  workers: number;
  /** Steps at once for Sutras that run in memory. */
  memoryWorkers: number;
  /** Queue check of an idle engine, ms. */
  pollMs: number;
  /** Settings refresh, ms. */
  settingsRefreshMs: number;
  /** Engines (processes) worth running on this machine, with PostgreSQL (SQLite: one). */
  engines: number;
  /** Suggested --max-old-space-size of each engine, MB. */
  nodeMemoryMb: number;
  /** Largest file to read whole (Read file maximum size); bigger CSV and line files are streamed. */
  readWholeMb: number;
  /** Rows per batch when streaming. */
  batchRows: number;
  /** The database that fits. */
  database: string;
}

export const PROFILES: Profile[] = [
  { name: 'Small', machine: '1 vCPU, 1 GB', workers: 4, memoryWorkers: 4, pollMs: 500, settingsRefreshMs: 2000, engines: 1, nodeMemoryMb: 384, readWholeMb: 10, batchRows: 500, database: 'SQLite' },
  { name: 'Small plus', machine: '2 vCPU, 2 to 4 GB', workers: 8, memoryWorkers: 8, pollMs: 250, settingsRefreshMs: 1000, engines: 1, nodeMemoryMb: 1024, readWholeMb: 25, batchRows: 1000, database: 'SQLite; PostgreSQL on another machine for a cluster' },
  { name: 'Medium', machine: '4 vCPU, 8 GB', workers: 16, memoryWorkers: 16, pollMs: 250, settingsRefreshMs: 1000, engines: 2, nodeMemoryMb: 2048, readWholeMb: 50, batchRows: 2000, database: 'SQLite for one engine at moderate load; PostgreSQL for a busy server or several engines' },
  { name: 'Large', machine: '8 vCPU, 16 GB', workers: 32, memoryWorkers: 32, pollMs: 200, settingsRefreshMs: 1000, engines: 4, nodeMemoryMb: 3072, readWholeMb: 100, batchRows: 5000, database: 'PostgreSQL for a busy server or several engines; SQLite for a moderate load' },
  { name: 'Very large', machine: '16 vCPU or more, 32 GB or more', workers: 32, memoryWorkers: 32, pollMs: 200, settingsRefreshMs: 1000, engines: 8, nodeMemoryMb: 4096, readWholeMb: 200, batchRows: 5000, database: 'PostgreSQL on its own machine, for several engines' },
];

/** Cores this process may use (a container or affinity limit counts). */
export function cores() {
  return Math.max(1, typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length);
}

/** The profile for a machine: the smaller of what its cores and its memory allow. */
export function profileFor(cpus = cores(), memGb = os.totalmem() / 1073741824): Profile {
  const byCpu = cpus <= 1 ? 0 : cpus <= 2 ? 1 : cpus <= 4 ? 2 : cpus <= 8 ? 3 : 4;
  const byMem = memGb < 1.8 ? 0 : memGb < 6 ? 1 : memGb < 12 ? 2 : memGb < 28 ? 3 : 4;
  return PROFILES[Math.min(byCpu, byMem)];
}

/** What the Admin Console shows: this machine and its recommendation. */
export function machineInfo() {
  const memGb = os.totalmem() / 1073741824;
  const heapMb = Math.round((process as any).constrainedMemory?.() ? Number((process as any).constrainedMemory()) / 1048576 : 0);
  return {
    cpus: cores(), cpuModel: os.cpus()[0]?.model?.trim() || 'unknown', memoryGb: Math.round(memGb * 10) / 10, freeGb: Math.round((os.freemem() / 1073741824) * 10) / 10,
    platform: `${os.type()} ${os.release()}`, node: process.version, containerLimitMb: heapMb || null,
    recommended: profileFor(cores(), memGb), profiles: PROFILES,
  };
}
