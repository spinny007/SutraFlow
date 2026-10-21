/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.9.0
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { q } from '../db.js';
import type { FlowDoc, ReplyPayload } from './types.js';

export interface RunState {
  outputs: Record<string, any>;
  vars: Record<string, any>;
  live: Record<string, true>;
  skips: Record<string, string[]>;
  skipped: Record<string, true>;
  joins: Record<string, Record<string, { live: boolean; from: string; out: any }>>;
  logs: { t: string; level: string; msg: string; step?: string }[];
  failed?: boolean;
  last?: any;
  reply?: ReplyPayload;
  result?: any;
  depth?: number;
  caught?: boolean;
  trace?: { traceId: string; parentSpanId: string };
}

export type LoadedRun = {
  row: any;
  doc: FlowDoc;
  state: RunState;
  outs?: Record<string, any>;
  fresh?: Record<string, any>;
};

export const OPEN_RUN_STATUSES = `('running', 'waiting', 'paused', 'queued')`;
export const OUTPUT_UPSERT_SQL = 'insert into run_outputs(run_id, name, out) values(?, ?, ?) on conflict(run_id, name) do update set out = excluded.out';

/** Converts output rows, or PostgreSQL's json_object_agg result, into values keyed by step name. */
export function outputsFrom(rows: { name: string; out: string | null }[] | Record<string, string | null> | null | undefined): Record<string, any> {
  const pairs = Array.isArray(rows) ? rows.map(r => [r.name, r.out] as const) : Object.entries(rows || {});
  return Object.fromEntries(pairs.map(([k, v]) => [k, v == null ? undefined : JSON.parse(v)]));
}

/** Full state for API and history views, including outputs stored separately since 1.8.0. */
export function runState(runId: string): RunState | undefined {
  const r = q.get<{ state: string }>('select state from runs where id = ?', runId);
  if (!r) return undefined;
  const state = JSON.parse(r.state) as RunState;
  state.outputs = {
    ...(state.outputs || {}),
    ...outputsFrom(q.all<{ name: string; out: string | null }>('select name, out from run_outputs where run_id = ?', runId)),
  };
  return state;
}

export function initialVariables(doc: FlowDoc) {
  const out: Record<string, any> = {};
  for (const variable of doc.variables || []) {
    if (!variable?.name) continue;
    const raw = variable.value;
    out[variable.name] = variable.type === 'number' ? Number(raw)
      : variable.type === 'boolean' ? ['true', '1', 'yes'].includes(String(raw).toLowerCase())
        : variable.type === 'json' ? (typeof raw === 'string' && raw.trim() ? JSON.parse(raw) : raw ?? null)
          : raw ?? '';
  }
  return out;
}

export const asObject = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : { value };

/** Keeps streamed output summaries bounded by dropping list values. */
export function compactOutput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([, v]) => !Array.isArray(v)));
}
