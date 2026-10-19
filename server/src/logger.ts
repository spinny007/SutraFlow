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
import { config } from './config.js';
import { effectiveLogging, getProject, onProjectChange, type LoggingConfig } from './projects.js';

/**
 * Per-project log files. The location, level, format and rotation come from the
 * project's logging settings, overridable in the deployment (ops) config.
 * Rotation: when the file passes maxSizeMb it is renamed .1, .2 ... up to maxFiles.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

interface Sink { cfg: LoggingConfig; file: string; size: number }
const sinks = new Map<string, Sink | null>();
onProjectChange.push(id => sinks.delete(id));

export function logFileFor(projectId: string) {
  const s = sink(projectId);
  return s?.file ?? null;
}

function sink(projectId: string): Sink | null {
  if (sinks.has(projectId)) return sinks.get(projectId)!;
  let s: Sink | null = null;
  try {
    const cfg = effectiveLogging(projectId);
    const p = getProject(projectId);
    if (cfg.enabled && p) {
      const name = cfg.file
        .replace(/\{project\}/g, p.name.replace(/[^\w.-]+/g, '-'))
        .replace(/\{date\}/g, new Date().toISOString().slice(0, 10));
      const file = path.isAbsolute(name) ? name : path.join(config.dataDir, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      s = { cfg, file, size: fs.existsSync(file) ? fs.statSync(file).size : 0 };
    }
  } catch {
    s = null;
  }
  sinks.set(projectId, s);
  return s;
}

function rotate(s: Sink) {
  for (let i = s.cfg.maxFiles - 1; i >= 1; i--) {
    const from = i === 1 ? s.file : `${s.file}.${i - 1}`;
    if (fs.existsSync(from)) fs.renameSync(from, `${s.file}.${i}`);
  }
  s.size = 0;
}

export interface LogEvent { level: Level; msg: string; flow?: string; run?: string; step?: string; data?: unknown; /** deployed v3, editor test, editor debug, draft */ origin?: string }

/** Where a run comes from, for log lines: a deployed version, or the designer's own test and debug runs. */
export const runOrigin = (source?: string | null, version?: number | null) =>
  source === 'test' ? 'editor test' : source === 'debug' ? 'editor debug' : Number(version) > 0 ? `deployed v${version}` : 'draft';

export function projectLog(projectId: string | null | undefined, e: LogEvent) {
  // Containers: one JSON object per line on standard output for the log collector.
  if (config.logFormat === 'json') {
    try { process.stdout.write(JSON.stringify({ time: new Date().toISOString(), level: e.level, environment: config.environment, engine: config.engineId, origin: e.origin, project: projectId || undefined, sutra: e.flow, run: e.run, step: e.step, msg: e.msg }) + '\n'); } catch { /* never stop a run */ }
  }
  if (!projectId) return;
  const s = sink(projectId);
  if (!s || LEVELS[e.level] < LEVELS[s.cfg.level]) return;
  const t = new Date().toISOString();
  let line: string;
  if (s.cfg.format === 'json') line = JSON.stringify({ t, level: e.level, environment: config.environment, engine: config.engineId, origin: e.origin, flow: e.flow, run: e.run, step: e.step, msg: e.msg, data: e.data }) + '\n';
  else {
    const where = [e.flow, e.run?.slice(0, 8), e.step].filter(Boolean).join(' / ');
    // {production | test | development, the kind of run}: which server, and a deployed Sutra or a designer test.
    const tag = `{${config.environment}${e.origin ? `, ${e.origin}` : ''}}`;
    line = `${t} ${e.level.toUpperCase().padEnd(5)} ${tag} [${where}] ${e.msg}${e.data !== undefined ? ' ' + JSON.stringify(e.data) : ''}\n`;
  }
  try {
    if (s.size + line.length > s.cfg.maxSizeMb * 1024 * 1024 && s.cfg.maxFiles > 1) rotate(s);
    fs.appendFileSync(s.file, line);
    s.size += Buffer.byteLength(line);
  } catch {
    // A logging failure must never stop a flow.
  }
}

export const wantsStepData = (projectId: string | null | undefined) => !!projectId && !!sink(projectId)?.cfg.stepData;

/** Size of the log file and its rotated copies. */
export function logSize(projectId: string) {
  const f = logFileFor(projectId);
  if (!f) return { file: null, bytes: 0, files: 0 };
  let bytes = 0, files = 0;
  for (const p of [f, ...Array.from({ length: 20 }, (_x, i) => `${f}.${i + 1}`)]) if (fs.existsSync(p)) { bytes += fs.statSync(p).size; files++; }
  return { file: f, bytes, files };
}

/** Empties the project log and deletes its rotated copies; returns how much was removed. */
export function clearLog(projectId: string) {
  const s = sink(projectId);
  const before = logSize(projectId);
  if (!s) return { ...before, cleared: 0 };
  for (let i = 1; i <= 20; i++) fs.rmSync(`${s.file}.${i}`, { force: true });
  if (fs.existsSync(s.file)) fs.writeFileSync(s.file, '');
  s.size = 0;
  return { ...before, cleared: before.bytes };
}

export function tailLog(projectId: string, lines = 200, filter: { level?: string; q?: string; origin?: string } = {}) {
  const f = logFileFor(projectId);
  if (!f || !fs.existsSync(f)) return { lines: [] as string[], ...logSize(projectId) };
  const size = fs.statSync(f).size;
  const fd = fs.openSync(f, 'r');
  const len = Math.min(size, 256 * 1024);
  const buf = Buffer.alloc(len);
  fs.readSync(fd, buf, 0, len, size - len);
  fs.closeSync(fd);
  let all = buf.toString('utf8').split('\n').filter(Boolean);
  // Level and words: matched in text lines (" INFO ", " ERROR ") and JSON lines ("level":"error").
  const min = filter.level && filter.level in LEVELS ? LEVELS[filter.level as Level] : 0;
  if (min) all = all.filter(l => { const m = /"level":"(\w+)"|\s(DEBUG|INFO|WARN|ERROR)\s/.exec(l); const lv = (m?.[1] || m?.[2] || 'info').toLowerCase() as Level; return (LEVELS[lv] ?? 20) >= min; });
  if (filter.q) { const t = filter.q.toLowerCase(); all = all.filter(l => l.toLowerCase().includes(t)); }
  // Runs from: deployed Sutras, or the designer's test and debug runs.
  if (filter.origin === 'deployed') all = all.filter(l => /, deployed v\d+\}|"origin":"deployed v/.test(l));
  if (filter.origin === 'editor') all = all.filter(l => /, editor (test|debug)\}|"origin":"editor /.test(l));
  return { lines: all.slice(-lines), ...logSize(projectId) };
}
