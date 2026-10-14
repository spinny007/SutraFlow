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

export interface LogEvent { level: Level; msg: string; flow?: string; run?: string; step?: string; data?: unknown }

export function projectLog(projectId: string | null | undefined, e: LogEvent) {
  if (!projectId) return;
  const s = sink(projectId);
  if (!s || LEVELS[e.level] < LEVELS[s.cfg.level]) return;
  const t = new Date().toISOString();
  let line: string;
  if (s.cfg.format === 'json') line = JSON.stringify({ t, level: e.level, flow: e.flow, run: e.run, step: e.step, msg: e.msg, data: e.data }) + '\n';
  else {
    const where = [e.flow, e.run?.slice(0, 8), e.step].filter(Boolean).join(' / ');
    line = `${t} ${e.level.toUpperCase().padEnd(5)} [${where}] ${e.msg}${e.data !== undefined ? ' ' + JSON.stringify(e.data) : ''}\n`;
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

export function tailLog(projectId: string, lines = 200) {
  const f = logFileFor(projectId);
  if (!f || !fs.existsSync(f)) return { file: f, lines: [] as string[] };
  const size = fs.statSync(f).size;
  const fd = fs.openSync(f, 'r');
  const len = Math.min(size, 256 * 1024);
  const buf = Buffer.alloc(len);
  fs.readSync(fd, buf, 0, len, size - len);
  fs.closeSync(fd);
  return { file: f, lines: buf.toString('utf8').split('\n').filter(Boolean).slice(-lines) };
}
