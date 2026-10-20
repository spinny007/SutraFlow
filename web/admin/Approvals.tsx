/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { useCallback } from 'react';
import { PageHead, Err, Empty, useLoad, useEvery, ago, when } from './shared';

interface Approval { id: number; flowName: string; startedAt: string; step: string; kind: string; message: string; people: string[]; roles: string[]; approvers: string[]; dueAt: string | null; approvedSoFar: number; need: number }

/**
 * Approvals are decided in the Approval Center (/approvals), the page for business people. Here the
 * operators see what waits and for whom, and open the Approval Center to act.
 */
export function Approvals() {
  const { data, error, reload } = useLoad<Approval[]>('/api/approvals');
  useEvery(useCallback(() => { reload(); }, [reload]), 15000);
  return (
    <>
      <PageHead title="Approvals" sub="Running Sutras waiting for a person. Approvers decide in the Approval Center, a page of its own for business people (it also works on a phone).">
        <a className="btn primary small" href="/approvals" target="_blank" rel="noopener">Open the Approval Center</a>
      </PageHead>
      <Err text={error} />
      {data && !data.length && <Empty title="Nothing is waiting">Approval steps and questions of running Sutras appear here and in the Approval Center.</Empty>}
      {!!data?.length && (
        <div className="c-tablewrap"><table className="t c-table">
          <thead><tr><th>Waiting</th><th>For</th><th>Progress</th><th>Due</th></tr></thead>
          <tbody>{data.map(a => (
            <tr key={a.id}>
              <td><strong>{a.message || a.step}</strong><div className="muted xs">{a.flowName} · {a.kind} · <span title={when(a.startedAt)}>{ago(a.startedAt)}</span></div></td>
              <td className="xs">{[...a.roles.map(r => `role ${r}`), ...a.approvers].join(', ') || 'anyone with Approve on the project'}</td>
              <td className="nowrap xs">{a.approvedSoFar} of {a.need}</td>
              <td className="nowrap xs">{a.dueAt ? when(a.dueAt) : ''}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}
