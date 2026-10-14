import { createRequire } from 'node:module';
import type { Activity } from '../engine/types.js';
import { requireResource } from '../resources.js';
import { requireSecret } from '../secrets.js';
import { registerListener } from '../listeners.js';
import { F, when } from '../palettes/common.js';

const require = createRequire(import.meta.url);
const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

const transports = new Map<string, any>();

function transportFor(id: string, secret: (n: string, w?: string) => string) {
  const r = requireResource(id, 'smtp', 'SMTP connection');
  let t = transports.get(r.rev!);
  if (!t) {
    const c = r.config;
    t = nodemailer.createTransport({
      host: c.host, port: Number(c.port) || 587,
      secure: c.security === 'TLS', requireTLS: c.security === 'STARTTLS', ignoreTLS: c.security === 'none',
      auth: c.user ? { user: c.user, pass: secret(c.passwordSecret, 'SMTP password') } : undefined,
      tls: { rejectUnauthorized: c.verifyTls !== false },
    });
    transports.set(r.rev!, t);
  }
  return { t, from: r.config.from };
}

const addresses = (v: unknown) => (Array.isArray(v) ? v.join(', ') : String(v ?? '').trim()) || undefined;

export const emailActivities: Activity[] = [
  {
    type: 'emailSend', palette: 'email', name: 'Send email', glyph: '✉', ports: ['out'],
    desc: 'Sends an email over SMTP with text and/or HTML (for example from an HTML template step) and attachments.',
    fields: [
      F('connection', 'SMTP connection', 'resource', '', { resourceKind: 'smtp' }),
      F('from', 'From', 'text', '', { tpl: true, help: 'Empty = the connection\'s default.' }),
      F('to', 'To', 'text', '{{input.email}}', { tpl: true, help: 'Comma separated, or a list.' }),
      F('cc', 'Cc', 'text', '', { tpl: true }), F('bcc', 'Bcc', 'text', '', { tpl: true }),
      F('replyTo', 'Reply-To', 'text', '', { tpl: true }),
      F('subject', 'Subject', 'text', "=concat('Order ', {input.orderId}, ' confirmed')", { tpl: true }),
      F('text', 'Text body', 'textarea', 'Hello {{input.name}},\n\nThank you for your order.', { tpl: true }),
      F('html', 'HTML body', 'textarea', '', { tpl: true, help: 'For example {{nodes.Email body.html}} from an HTML template step.' }),
      F('attachments', 'Attachments', 'text', '', { tpl: true, help: 'A list of { filename, content (text or base64), encoding: "base64", contentType }.' }),
    ],
    outputHint: { messageId: '', accepted: [''], rejected: [], subject: '', sentAt: '' },
    execute: async c => {
      const { t, from } = transportFor(c.raw('connection'), c.secret);
      const att = c.v('attachments');
      const info = await t.sendMail({
        from: c.v('from') || from, to: addresses(c.v('to')), cc: addresses(c.v('cc')), bcc: addresses(c.v('bcc')), replyTo: addresses(c.v('replyTo')),
        subject: String(c.v('subject') ?? ''), text: c.v('text') || undefined, html: c.v('html') || undefined,
        attachments: Array.isArray(att) ? att.map((a: any) => ({ filename: a.filename, content: a.content, encoding: a.encoding, contentType: a.contentType })) : undefined,
      });
      if (!info.accepted?.length) throw new Error(`No recipient accepted the message: ${(info.rejected || []).join(', ')}`);
      return { out: { messageId: info.messageId, accepted: info.accepted, rejected: info.rejected, subject: String(c.v('subject') ?? ''), sentAt: new Date().toISOString() } };
    },
  },
  {
    type: 'emailTrigger', palette: 'email', name: 'Email trigger', glyph: '📥', trigger: true, ports: ['out'],
    desc: 'Starts the Sutra for each new email in an IMAP mailbox (polling while deployed). Marks it read or moves it after the Sutra succeeds.',
    fields: [
      F('connection', 'IMAP connection', 'resource', '', { resourceKind: 'imap' }),
      F('mailbox', 'Mailbox', 'text', 'INBOX'),
      F('filterFrom', 'Only from (contains)', 'text', ''),
      F('filterSubject', 'Only subject containing', 'text', ''),
      F('pollSeconds', 'Check every (seconds)', 'number', 60),
      F('after', 'After the Sutra succeeds', 'select', 'mark read', { options: ['mark read', 'move', 'leave'] }),
      F('moveTo', 'Move to mailbox', 'text', 'Processed', when('after', 'move')),
      F('attachments', 'Include attachments', 'select', 'base64', { options: ['no', 'base64'] }),
      F('testEmail', 'Test email (JSON)', 'code', '{\n  "from": "customer@example.com",\n  "subject": "Order A-1001",\n  "text": "Please ship order A-1001",\n  "attachments": []\n}'),
    ],
    outputHint: { uid: 0, messageId: '', from: '', to: '', subject: '', date: '', text: '', html: '', attachments: [{ filename: '', contentType: '', size: 0, content: '' }] },
    execute: c => ({ out: c.input ?? JSON.parse(c.raw('testEmail') || '{}') }),
  },
];

// ---------- IMAP polling listener ----------
registerListener('emailTrigger', async c => {
  const cfg = c.node.config;
  const r = requireResource(cfg.connection, 'imap', 'IMAP connection');
  const every = Math.max(15, Number(cfg.pollSeconds) || 60) * 1000;
  const inFlight = new Set<number>();
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    const client = new ImapFlow({
      host: r.config.host, port: Number(r.config.port) || 993, secure: r.config.tls !== false,
      auth: { user: r.config.user, pass: requireSecret(r.config.passwordSecret, 'IMAP password') },
      tls: { rejectUnauthorized: r.config.verifyTls !== false }, logger: false,
    });
    try {
      await client.connect();
      const lock = await client.getMailboxLock(cfg.mailbox || 'INBOX');
      try {
        const query: any = { seen: false };
        if (cfg.filterFrom) query.from = cfg.filterFrom;
        if (cfg.filterSubject) query.subject = cfg.filterSubject;
        const uids = ((await client.search(query, { uid: true })) || []) as number[];
        for (const uid of uids.slice(0, 50)) {
          if (inFlight.has(uid)) continue;
          const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
          if (!msg?.source) continue;
          const m = await simpleParser(msg.source);
          inFlight.add(uid);
          const input = {
            uid, messageId: m.messageId, from: m.from?.text, to: m.to?.text, cc: m.cc?.text, subject: m.subject, date: m.date?.toISOString(),
            text: m.text, html: m.html || '',
            attachments: cfg.attachments === 'no' ? [] : (m.attachments || []).map((a: any) => ({ filename: a.filename, contentType: a.contentType, size: a.size, content: a.content.toString('base64') })),
          };
          c.fire(input, status => {
            // Acknowledge only after success, in a fresh connection.
            (async () => {
              if (status !== 'done' || cfg.after === 'leave') return;
              const ack = new ImapFlow({ host: r.config.host, port: Number(r.config.port) || 993, secure: r.config.tls !== false, auth: { user: r.config.user, pass: requireSecret(r.config.passwordSecret) }, tls: { rejectUnauthorized: r.config.verifyTls !== false }, logger: false });
              await ack.connect();
              const l = await ack.getMailboxLock(cfg.mailbox || 'INBOX');
              try {
                if (cfg.after === 'move') await ack.messageMove(String(uid), cfg.moveTo || 'Processed', { uid: true });
                else await ack.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
              } finally { l.release(); await ack.logout(); }
            })().catch(e => c.status('error', `Could not acknowledge message ${uid}: ${e.message}`)).finally(() => inFlight.delete(uid));
          });
        }
      } finally { lock.release(); }
      await client.logout();
      c.status('ok', `Checked ${cfg.mailbox || 'INBOX'}`);
    } catch (e: any) {
      c.status('error', e.message);
      try { await client.logout(); } catch { /* ignore */ }
    }
  };
  tick();
  const t = setInterval(tick, every);
  return () => { stopped = true; clearInterval(t); };
});

/** Test connection: SMTP login check, or IMAP login and logout. */
export async function testMail(r: { kind: string; config: Record<string, any> }, secret: (n: string, w?: string) => string): Promise<string> {
  const c = r.config;
  if (r.kind === 'smtp') {
    const t = nodemailer.createTransport({
      host: c.host, port: Number(c.port) || 587, secure: c.security === 'TLS', requireTLS: c.security === 'STARTTLS', ignoreTLS: c.security === 'none',
      auth: c.user ? { user: c.user, pass: secret(c.passwordSecret, 'SMTP password') } : undefined, tls: { rejectUnauthorized: c.verifyTls !== false },
      connectionTimeout: 15000,
    });
    try { await t.verify(); } finally { t.close(); }
    return `SMTP server ${c.host} accepted the connection${c.user ? ' and the login' : ''}`;
  }
  const client = new ImapFlow({ host: c.host, port: Number(c.port) || 993, secure: c.tls !== false, auth: { user: c.user, pass: secret(c.passwordSecret, 'IMAP password') }, tls: { rejectUnauthorized: c.verifyTls !== false }, logger: false });
  await client.connect();
  const boxes = await client.list().catch(() => []);
  await client.logout().catch(() => {});
  return `Signed in to ${c.host}: ${boxes.length} mailboxes`;
}
