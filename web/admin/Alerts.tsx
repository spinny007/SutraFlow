/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { useCallback, useState } from 'react';
import { useToast } from '../src/ui';
import { PageHead, State, Err, Empty, Confirm, useLoad, useEvery, ago, when, can, useMe } from './shared';
import { act, type Action } from './log';
import { Drawer } from './Apps';

/** Alerts: what is open, the rules that watch, and the channels they speak through. */

export interface AlertRow { id: string; ruleId: string; ruleName: string; severity: 'warning' | 'critical'; state: 'firing' | 'acknowledged' | 'resolved'; message: string; details: any; startedAt: string; lastSeenAt: string; resolvedAt: string | null; ackBy: string | null; ackAt: string | null; notified: { channel: string; event: string; at: string; ok: boolean; result?: string; error?: string }[] }
interface Kind { kind: string; name: string; help: string; params: { k: string; name: string; type: 'number' | 'sutra' | 'text'; def: unknown; unit?: string; help?: string }[] }
interface Rule { id: string; name: string; kind: string; params: Record<string, any>; severity: 'warning' | 'critical'; channels: string[]; enabled: boolean; notifyResolved: boolean; repeatMin: number }
interface Channel { id: string; name: string; kind: 'email' | 'webhook' | 'sutra'; config: Record<string, any>; enabled: boolean }

export const sevState = (a: { severity: string; state: string }) =>
  a.state === 'resolved' ? <State kind="idle">resolved</State> : a.state === 'acknowledged' ? <State kind="busy">acknowledged</State> : <State kind={a.severity === 'critical' ? 'err' : 'warn'}>{a.severity}</State>;

export function AlertsPage() {
  const { me } = useMe();
  const toast = useToast();
  const [tab, setTab] = useState<'open' | 'all'>('open');
  const { data, error, reload } = useLoad<AlertRow[]>(`/api/alerts?state=${tab === 'open' ? 'open' : ''}&limit=200`, [tab]);
  useEvery(useCallback(() => { reload(); }, [reload]), 10000);
  const [openId, setOpenId] = useState<string | null>(null);
  const [ask, setAsk] = useState<{ title: string; text: string; cmd: Action; action: string } | null>(null);
  const manage = can(me, 'alerts');
  const checkNow = async () => { try { const r = await act<any>({ label: 'Check every alert rule now', method: 'POST', url: '/api/alerts/check', cli: ['alerts', 'check'] }); toast(`${r.opened} opened, ${r.resolved} resolved`); reload(); } catch (e: any) { toast(e.message, true); } };
  return (
    <>
      <PageHead title="Alerts" sub="Open alerts first. The cluster leader checks the rules every 30 seconds; an alert resolves by itself when its condition clears.">
        <div className="c-seg" role="group" aria-label="Show">
          <button className={tab === 'open' ? 'act' : ''} aria-pressed={tab === 'open'} onClick={() => setTab('open')}>Open</button>
          <button className={tab === 'all' ? 'act' : ''} aria-pressed={tab === 'all'} onClick={() => setTab('all')}>History</button>
        </div>
        {manage && <button className="btn small" onClick={checkNow}>Check now</button>}
      </PageHead>
      <Err text={error} />
      {data && !data.length && <Empty title={tab === 'open' ? 'Nothing is open' : 'No alerts yet'}>{tab === 'open' ? 'Alerts appear here when a rule\'s condition holds.' : 'Add rules under Alert rules; their alerts are kept here.'}</Empty>}
      {!!data?.length && (
        <div className="c-alertlist">
          {data.map(a => (
            <article key={a.id} className={`c-alert ${a.state === 'resolved' ? 'resolved' : a.severity}`}>
              <div className="c-alerthead">
                {sevState(a)}
                <strong>{a.ruleName}</strong>
                <span className="muted xs" title={when(a.startedAt)}>opened {ago(a.startedAt)}{a.state === 'resolved' && a.resolvedAt ? `, resolved ${ago(a.resolvedAt)}` : `, seen ${ago(a.lastSeenAt)}`}</span>
                <span className="c-actions" style={{ marginLeft: 'auto' }}>
                  <button className="btn small" aria-expanded={openId === a.id} onClick={() => setOpenId(openId === a.id ? null : a.id)}>{openId === a.id ? 'Less' : 'Details'}</button>
                  {manage && a.state === 'firing' && <button className="btn small" onClick={() => setAsk({ title: `Acknowledge ${a.ruleName}`, text: 'You are on it: reminders stop. The alert still resolves by itself when the condition clears.', action: 'Acknowledge', cmd: { label: `Acknowledge ${a.ruleName}`, method: 'POST', url: `/api/alerts/${a.id}/acknowledge`, cli: ['alerts', 'ack', a.id] } })}>Acknowledge</button>}
                  {manage && a.state !== 'resolved' && <button className="btn small" onClick={() => setAsk({ title: `Resolve ${a.ruleName}`, text: 'Closes the alert now. If the condition still holds, the next check opens a new one.', action: 'Resolve', cmd: { label: `Resolve ${a.ruleName}`, method: 'POST', url: `/api/alerts/${a.id}/resolve`, cli: ['alerts', 'resolve', a.id] } })}>Resolve</button>}
                </span>
              </div>
              <p className="c-alertmsg">{a.message}</p>
              {a.ackBy && <p className="muted xs">Acknowledged by {a.ackBy}{a.ackAt ? ` ${ago(a.ackAt)}` : ''}</p>}
              {openId === a.id && (
                <div className="c-alertmore">
                  {a.details && <pre className="c-code">{JSON.stringify(a.details, null, 2)}</pre>}
                  <h3>Sent</h3>
                  {a.notified.length ? (
                    <div className="c-tablewrap"><table className="t c-table">
                      <thead><tr><th>When</th><th>Channel</th><th>Event</th><th>Result</th></tr></thead>
                      <tbody>{a.notified.map((n, i) => <tr key={i}><td className="nowrap">{when(n.at)}</td><td>{n.channel}</td><td>{n.event}</td><td>{n.ok ? <span className="c-ok">{n.result}</span> : <span className="c-err">{n.error}</span>}</td></tr>)}</tbody>
                    </table></div>
                  ) : <p className="muted xs">The rule has no channels; the alert shows here only.</p>}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {ask && <Confirm title={ask.title} text={ask.text} action={ask.action} cmd={ask.cmd}
        onYes={async () => { await act(ask.cmd); toast('Done'); reload(); }} onClose={() => setAsk(null)} />}
    </>
  );
}

// ---------- rules ----------

export function RulesPage() {
  const toast = useToast();
  const rules = useLoad<Rule[]>('/api/alerts/rules');
  const kinds = useLoad<Kind[]>('/api/alerts/kinds');
  const channels = useLoad<Channel[]>('/api/alerts/channels');
  const [edit, setEdit] = useState<Rule | 'new' | null>(null);
  const kindName = (k: string) => kinds.data?.find(x => x.kind === k)?.name || k;
  const chName = (id: string) => channels.data?.find(c => c.id === id)?.name || id;
  const describe = (r: Rule) => {
    const k = kinds.data?.find(x => x.kind === r.kind);
    return (k?.params || []).filter(p => r.params[p.k] !== '' && r.params[p.k] !== undefined && p.type !== 'sutra').map(p => `${p.name.toLowerCase()} ${r.params[p.k]}${p.unit ? ' ' + p.unit : ''}`).join(', ');
  };
  return (
    <>
      <PageHead title="Alert rules" sub="What to watch, how serious it is, and where to tell. Changes apply at the next check.">
        <button className="btn primary small" onClick={() => setEdit('new')}>New rule</button>
      </PageHead>
      <Err text={rules.error} />
      {rules.data && !rules.data.length && <Empty title="No rules yet">Start with Failed runs for your important Sutras, Engines, and Certificate expiry.</Empty>}
      {!!rules.data?.length && (
        <div className="c-tablewrap"><table className="t c-table">
          <thead><tr><th>Rule</th><th>Watches</th><th>Severity</th><th>Channels</th><th>State</th></tr></thead>
          <tbody>{rules.data.map(r => (
            <tr key={r.id} className="click" tabIndex={0} onClick={() => setEdit(r)} onKeyDown={e => { if (e.key === 'Enter') setEdit(r); }}>
              <td><strong>{r.name}</strong></td>
              <td>{kindName(r.kind)}<div className="muted xs">{describe(r)}</div></td>
              <td><State kind={r.severity === 'critical' ? 'err' : 'warn'}>{r.severity}</State></td>
              <td>{r.channels.length ? r.channels.map(c => <span key={c} className="c-grant">{chName(c)}</span>) : <span className="muted">none</span>}</td>
              <td>{r.enabled ? <State kind="ok">on</State> : <State kind="idle">off</State>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {edit && kinds.data && <RuleDrawer rule={edit === 'new' ? null : edit} kinds={kinds.data} channels={channels.data || []} onClose={() => setEdit(null)} onSaved={m => { toast(m); rules.reload(); setEdit(null); }} />}
    </>
  );
}

function RuleDrawer({ rule, kinds, channels, onClose, onSaved }: { rule: Rule | null; kinds: Kind[]; channels: Channel[]; onClose(): void; onSaved(m: string): void }) {
  const [form, setForm] = useState<Rule>(rule || { id: '', name: '', kind: 'runFailures', params: {}, severity: 'warning', channels: [], enabled: true, notifyResolved: true, repeatMin: 0 });
  const apps = useLoad<{ name: string; sutras: { id: string; name: string }[] }[]>('/api/console/apps');
  const [err, setErr] = useState('');
  const [finding, setFinding] = useState<{ firing: boolean; message: string } | null>(null);
  const [del, setDel] = useState(false);
  const kind = kinds.find(k => k.kind === form.kind)!;
  const val = (k: string, def: unknown) => (form.params[k] ?? def) as any;
  const setP = (k: string, v: unknown) => setForm({ ...form, params: { ...form.params, [k]: v } });
  const body = { ...form, params: Object.fromEntries(kind.params.map(p => [p.k, val(p.k, p.def)])) };
  const save = async () => {
    try { await act(rule ? { label: `Change rule ${form.name}`, method: 'PUT', url: `/api/alerts/rules/${rule.id}`, body } : { label: `Add rule ${form.name}`, method: 'POST', url: '/api/alerts/rules', body }); onSaved(rule ? 'Rule saved' : 'Rule added'); }
    catch (e: any) { setErr(e.message); }
  };
  const checkNow = async () => { try { setFinding(await act({ label: `Check rule ${rule!.name}`, method: 'POST', url: `/api/alerts/rules/${rule!.id}/check` })); } catch (e: any) { setErr(e.message); } };
  return (
    <Drawer title={rule ? rule.name : 'New rule'} onClose={onClose}>
      <Err text={err} />
      <div className="c-form">
        <div className="fld"><label htmlFor="ar-n">Name</label><input id="ar-n" type="text" value={form.name} placeholder="Payments failing" onChange={e => setForm({ ...form, name: e.target.value })} /></div>
        <div className="fld"><label htmlFor="ar-k">Watch</label>
          <select id="ar-k" value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value, params: {} })}>{kinds.map(k => <option key={k.kind} value={k.kind}>{k.name}</option>)}</select>
          <div className="hint">{kind.help}</div></div>
        <div className="c-tuninggrid">
          {kind.params.map(p => (
            <div key={p.k} className="fld">
              <label htmlFor={`ar-${p.k}`}>{p.name}{p.unit && <span className="muted xs"> ({p.unit})</span>}</label>
              {p.type === 'sutra'
                ? <select id={`ar-${p.k}`} value={val(p.k, '')} onChange={e => setP(p.k, e.target.value)}><option value="">Any deployed Sutra</option>{(apps.data || []).flatMap(a => a.sutras.map(s => <option key={s.id} value={s.id}>{a.name}: {s.name}</option>))}</select>
                : <input id={`ar-${p.k}`} type={p.type === 'number' ? 'number' : 'text'} min={0} value={val(p.k, p.def)} onChange={e => setP(p.k, p.type === 'number' ? Number(e.target.value) : e.target.value)} />}
              {p.help && <div className="hint">{p.help}</div>}
            </div>
          ))}
        </div>
        <div className="fld"><span className="lbl">Severity</span>
          <div className="c-seg" role="group" aria-label="Severity">{(['warning', 'critical'] as const).map(s => <button key={s} type="button" className={form.severity === s ? 'act' : ''} aria-pressed={form.severity === s} onClick={() => setForm({ ...form, severity: s })}>{s}</button>)}</div></div>
        <fieldset className="c-perms"><legend>Tell</legend>
          {!channels.length && <p className="muted xs">No channels yet: add them under Channels. Without one, alerts show in the console only.</p>}
          {channels.map(c => <label key={c.id} className="c-check"><input type="checkbox" checked={form.channels.includes(c.id)} onChange={e => setForm({ ...form, channels: e.target.checked ? [...form.channels, c.id] : form.channels.filter(x => x !== c.id) })} /> <span><strong>{c.name}</strong> <span className="muted xs">{c.kind}</span></span></label>)}
        </fieldset>
        <label className="c-check"><input type="checkbox" checked={form.notifyResolved} onChange={e => setForm({ ...form, notifyResolved: e.target.checked })} /> Also tell when it resolves</label>
        <div className="fld"><label htmlFor="ar-rep">Remind every <span className="muted xs">(min, 0 = never; not once acknowledged)</span></label><input id="ar-rep" type="number" min={0} value={form.repeatMin} onChange={e => setForm({ ...form, repeatMin: Number(e.target.value) })} /></div>
        <label className="c-check"><input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} /> On</label>
        <div className="c-actions">
          <button className="btn primary" disabled={!form.name.trim()} onClick={save}>{rule ? 'Save' : 'Add rule'}</button>
          {rule && <button className="btn" onClick={checkNow}>Check now</button>}
          {rule && <button className="btn c-danger-soft" onClick={() => setDel(true)}>Delete rule</button>}
        </div>
        {finding && <div className={finding.firing ? 'errbox' : 'c-shown'} role="status">{finding.firing ? 'Would alert: ' : 'Fine now: '}{finding.message}</div>}
      </div>
      {del && rule && <Confirm title={`Delete ${rule.name}`} text="The rule is deleted and its open alert is resolved." action="Delete" danger cmd={{ label: `Delete rule ${rule.name}`, method: 'DELETE', url: `/api/alerts/rules/${rule.id}` }}
        onYes={async () => { await act({ label: `Delete rule ${rule.name}`, method: 'DELETE', url: `/api/alerts/rules/${rule.id}` }); onSaved('Rule deleted'); }} onClose={() => setDel(false)} />}
    </Drawer>
  );
}

// ---------- channels ----------

export function ChannelsPage() {
  const toast = useToast();
  const list = useLoad<Channel[]>('/api/alerts/channels');
  const [edit, setEdit] = useState<Channel | 'new' | null>(null);
  const where = (c: Channel) => (c.kind === 'email' ? c.config.to : c.kind === 'webhook' ? c.config.url : 'starts a Sutra');
  return (
    <>
      <PageHead title="Alert channels" sub="Where alerts go: email through an SMTP connection, a webhook (JSON with a text field that chat tools show), or a deployed Sutra that receives the alert.">
        <button className="btn primary small" onClick={() => setEdit('new')}>New channel</button>
      </PageHead>
      <Err text={list.error} />
      {list.data && !list.data.length && <Empty title="No channels yet">Add an email list or a webhook, then choose it in your rules.</Empty>}
      {!!list.data?.length && (
        <div className="c-tablewrap"><table className="t c-table">
          <thead><tr><th>Channel</th><th>Kind</th><th>To</th><th>State</th></tr></thead>
          <tbody>{list.data.map(c => (
            <tr key={c.id} className="click" tabIndex={0} onClick={() => setEdit(c)} onKeyDown={e => { if (e.key === 'Enter') setEdit(c); }}>
              <td><strong>{c.name}</strong></td><td>{c.kind}</td><td className="mono xs c-wrap">{where(c)}</td><td>{c.enabled ? <State kind="ok">on</State> : <State kind="idle">off</State>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {edit && <ChannelDrawer ch={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={m => { toast(m); list.reload(); setEdit(null); }} />}
    </>
  );
}

function ChannelDrawer({ ch, onClose, onSaved }: { ch: Channel | null; onClose(): void; onSaved(m: string): void }) {
  const toast = useToast();
  const [form, setForm] = useState<Channel>(ch || { id: '', name: '', kind: 'email', config: {}, enabled: true });
  const smtp = useLoad<{ id: string; name: string }[]>('/api/resources?kind=smtp');
  const secrets = useLoad<{ name: string }[]>('/api/secrets');
  const apps = useLoad<{ name: string; sutras: { id: string; name: string }[] }[]>('/api/console/apps');
  const [err, setErr] = useState('');
  const [del, setDel] = useState(false);
  const c = form.config;
  const setC = (k: string, v: string) => setForm({ ...form, config: { ...c, [k]: v } });
  const save = async () => {
    try { await act(ch ? { label: `Change channel ${form.name}`, method: 'PUT', url: `/api/alerts/channels/${ch.id}`, body: { ...form } } : { label: `Add channel ${form.name}`, method: 'POST', url: '/api/alerts/channels', body: { ...form } }); onSaved(ch ? 'Channel saved' : 'Channel added'); }
    catch (e: any) { setErr(e.message); }
  };
  const test = async () => { try { const r = await act<any>({ label: `Test channel ${ch!.name}`, method: 'POST', url: `/api/alerts/channels/${ch!.id}/test`, cli: ['alerts', 'test', ch!.name] }); toast(`Sent: ${r.result}`); } catch (e: any) { toast(e.message, true); } };
  return (
    <Drawer title={ch ? ch.name : 'New channel'} onClose={onClose}>
      <Err text={err} />
      <div className="c-form">
        <div className="fld"><label htmlFor="ac-n">Name</label><input id="ac-n" type="text" value={form.name} placeholder="Operations team" onChange={e => setForm({ ...form, name: e.target.value })} /></div>
        <div className="fld"><span className="lbl">Kind</span>
          <div className="c-seg" role="group" aria-label="Kind">{(['email', 'webhook', 'sutra'] as const).map(k => <button key={k} type="button" className={form.kind === k ? 'act' : ''} aria-pressed={form.kind === k} onClick={() => setForm({ ...form, kind: k, config: {} })}>{k === 'sutra' ? 'Sutra' : k}</button>)}</div></div>
        {form.kind === 'email' && <>
          <div className="fld"><label htmlFor="ac-con">SMTP connection</label>
            <select id="ac-con" value={c.connection || ''} onChange={e => setC('connection', e.target.value)}><option value="">Choose</option>{(smtp.data || []).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
            <div className="hint">Any project's Email (SMTP) connection.</div></div>
          <div className="fld"><label htmlFor="ac-to">To</label><input id="ac-to" type="text" value={c.to || ''} placeholder="ops@example.com, oncall@example.com" onChange={e => setC('to', e.target.value)} /></div>
        </>}
        {form.kind === 'webhook' && <>
          <div className="fld"><label htmlFor="ac-url">Address</label><input id="ac-url" type="text" className="mono" value={c.url || ''} placeholder="https://hooks.example.com/..." onChange={e => setC('url', e.target.value)} /><div className="hint">Receives a JSON POST with event, text and alert. Chat tools that read a text field (Slack, Teams, Mattermost) show the message.</div></div>
          <div className="fld"><label htmlFor="ac-sec">Signing secret</label>
            <select id="ac-sec" value={c.secret || ''} onChange={e => setC('secret', e.target.value)}><option value="">Do not sign</option>{(secrets.data || []).map(s => <option key={s.name} value={s.name}>{s.name}</option>)}</select>
            <div className="hint">Adds X-Sutra-Signature: sha256=HMAC of the body, so the receiver can check it came from here.</div></div>
        </>}
        {form.kind === 'sutra' && <div className="fld"><label htmlFor="ac-flow">Sutra</label>
          <select id="ac-flow" value={c.flowId || ''} onChange={e => setC('flowId', e.target.value)}><option value="">Choose a deployed Sutra</option>{(apps.data || []).flatMap(a => a.sutras.map(s => <option key={s.id} value={s.id}>{a.name}: {s.name}</option>))}</select>
          <div className="hint">It starts with the alert as its input ({'{{input.alert.rule}}'}, {'{{input.alert.message}}'}, {'{{input.text}}'}): open a ticket, call someone, post anywhere.</div></div>}
        <label className="c-check"><input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} /> On</label>
        <div className="c-actions">
          <button className="btn primary" disabled={!form.name.trim()} onClick={save}>{ch ? 'Save' : 'Add channel'}</button>
          {ch && <button className="btn" onClick={test}>Send a test</button>}
          {ch && <button className="btn c-danger-soft" onClick={() => setDel(true)}>Delete channel</button>}
        </div>
      </div>
      {del && ch && <Confirm title={`Delete ${ch.name}`} text="Rules must stop using it first." action="Delete" danger cmd={{ label: `Delete channel ${ch.name}`, method: 'DELETE', url: `/api/alerts/channels/${ch.id}` }}
        onYes={async () => { await act({ label: `Delete channel ${ch.name}`, method: 'DELETE', url: `/api/alerts/channels/${ch.id}` }); onSaved('Channel deleted'); }} onClose={() => setDel(false)} />}
    </Drawer>
  );
}
