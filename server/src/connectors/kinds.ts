import type { Field, ResourceKind } from '../engine/types.js';

const F = (k: string, label: string, type: Field['type'], def?: any, extra: Partial<Field> = {}): Field => ({ k, label, type, def, ...extra });
const when = (k: string, ...vals: any[]) => ({ showIf: { k, in: vals } });

/** Time limits of SFTP and FTP connections: servers far away or busy need more. */
const timing = (sftp: boolean): Field[] => [
  F('connectSec', 'Connect time limit (seconds)', 'number', 30, { help: 'Reaching the server and signing in.' }),
  F('responseSec', 'Response time limit (seconds)', 'number', 60, { help: 'Each operation: list, read, write, rename. A large file is one operation; allow for its transfer time.' }),
  F('attempts', 'Connection attempts', 'number', 3, { help: 'Tries to connect again after a network failure. A wrong password or host key is not retried.' }),
  F('retryWaitSec', 'Wait between attempts (seconds)', 'number', 5),
  ...(sftp ? [F('keepaliveSec', 'Keep-alive every (seconds)', 'number', 15, { help: 'Keeps slow sessions open through firewalls. 0 = off.' })] : []),
];

/** Connection kinds for the connector palettes (email, databases, service bus, Firebase, OAuth apps). */
export const CONNECTOR_KINDS: ResourceKind[] = [
  {
    kind: 'smtp', name: 'Email (SMTP)', desc: 'Outgoing mail server for Send email.',
    fields: [
      F('host', 'Host', 'text', 'smtp.gmail.com'), F('port', 'Port', 'number', 587),
      F('security', 'Security', 'select', 'STARTTLS', { options: ['STARTTLS', 'TLS', 'none'] }),
      F('user', 'Username', 'text', ''), F('passwordSecret', 'Password', 'secret', ''),
      F('from', 'Default From', 'text', 'Sutra <noreply@example.com>'),
      F('verifyTls', 'Verify server certificate', 'bool', true),
    ],
  },
  {
    kind: 'imap', name: 'Email (IMAP)', desc: 'Mailbox read by the Email trigger.',
    fields: [
      F('host', 'Host', 'text', 'imap.gmail.com'), F('port', 'Port', 'number', 993), F('tls', 'TLS', 'bool', true),
      F('user', 'Username', 'text', ''), F('passwordSecret', 'Password', 'secret', ''),
      F('verifyTls', 'Verify server certificate', 'bool', true),
    ],
  },
  {
    kind: 'database', name: 'Database (DB Ops)', desc: 'PostgreSQL, MySQL/MariaDB, SQL Server, Oracle or SQLite for the DB Ops palette.',
    fields: [
      F('driver', 'Database', 'select', 'postgres', { options: ['postgres', 'mysql', 'mssql', 'oracle', 'sqlite'] }),
      F('host', 'Host', 'text', 'localhost', when('driver', 'postgres', 'mysql', 'mssql', 'oracle')),
      F('port', 'Port', 'number', 5432, { help: 'Postgres 5432, MySQL 3306, SQL Server 1433, Oracle 1521.', ...when('driver', 'postgres', 'mysql', 'mssql', 'oracle') }),
      F('database', 'Database / service name', 'text', '', when('driver', 'postgres', 'mysql', 'mssql', 'oracle')),
      F('user', 'User', 'text', '', when('driver', 'postgres', 'mysql', 'mssql', 'oracle')),
      F('passwordSecret', 'Password', 'secret', '', when('driver', 'postgres', 'mysql', 'mssql', 'oracle')),
      F('file', 'Database file', 'text', 'data/app.sqlite', { help: 'Relative to the data folder.', ...when('driver', 'sqlite') }),
      F('ssl', 'Encrypt connection (TLS)', 'bool', false, when('driver', 'postgres', 'mysql', 'mssql')),
      F('verifyTls', 'Verify server certificate', 'bool', true, when('ssl', true)),
      F('poolMax', 'Connection pool size', 'number', 10, when('driver', 'postgres', 'mysql', 'mssql', 'oracle')),
    ],
  },
  {
    kind: 'kafka', name: 'Kafka', desc: 'Kafka cluster for Publish and Subscribe (Service Bus palette).',
    fields: [
      F('brokers', 'Brokers', 'list', ['localhost:9092']), F('clientId', 'Client ID', 'text', 'sutraflow'),
      F('ssl', 'TLS', 'bool', false),
      F('sasl', 'SASL', 'select', 'none', { options: ['none', 'plain', 'scram-sha-256', 'scram-sha-512'] }),
      F('user', 'Username', 'text', '', { showIf: { k: 'sasl', in: ['plain', 'scram-sha-256', 'scram-sha-512'] } }),
      F('passwordSecret', 'Password', 'secret', '', { showIf: { k: 'sasl', in: ['plain', 'scram-sha-256', 'scram-sha-512'] } }),
    ],
  },
  {
    kind: 'rabbitmq', name: 'RabbitMQ (AMQP 0-9-1)', desc: 'RabbitMQ broker for Publish and Subscribe.',
    fields: [
      F('url', 'URL', 'text', 'amqp://localhost:5672/', { help: 'amqps:// for TLS. The password comes from the secret below.' }),
      F('user', 'Username', 'text', 'guest'), F('passwordSecret', 'Password', 'secret', ''),
      F('vhost', 'Virtual host', 'text', '/'),
    ],
  },
  {
    kind: 'amqp1', name: 'ActiveMQ / AMQP 1.0', desc: 'Apache ActiveMQ (Classic or Artemis), Azure Service Bus and other AMQP 1.0 brokers.',
    fields: [
      F('host', 'Host', 'text', 'localhost'), F('port', 'Port', 'number', 5672), F('tls', 'TLS', 'bool', false),
      F('user', 'Username', 'text', 'admin'), F('passwordSecret', 'Password', 'secret', ''),
      F('containerId', 'Container ID', 'text', 'sutraflow'),
      F('queuePrefix', 'Queue address prefix', 'text', '', { help: 'ActiveMQ Classic: empty or queue://. Artemis: empty.' }),
      F('topicPrefix', 'Topic address prefix', 'text', 'topic://', { help: 'ActiveMQ Classic: topic://. Artemis: empty, with the address set to multicast.' }),
    ],
  },
  {
    kind: 'firebase', name: 'Firebase', desc: 'Firestore, Realtime Database and Cloud Messaging (push notifications) with a service account.',
    fields: [
      F('serviceAccountSecret', 'Service account key (JSON)', 'secret', '', { help: 'Vault secret holding the JSON key downloaded from Firebase > Project settings > Service accounts.' }),
      F('databaseUrl', 'Realtime Database URL', 'text', 'https://PROJECT-default-rtdb.firebaseio.com'),
      F('apiBase', 'API base (testing only)', 'text', '', { help: 'Leave empty. Lets tests point at an emulator.' }),
    ],
  },
  {
    kind: 'sftp', name: 'SFTP server', desc: 'A server reached over SSH file transfer, for the SFTP / FTP palette.',
    fields: [
      F('host', 'Host', 'text', 'sftp.example.com'), F('port', 'Port', 'number', 22),
      F('user', 'Username', 'text', ''),
      F('auth', 'Sign in with', 'select', 'password', { options: ['password', 'private key'] }),
      F('passwordSecret', 'Password', 'secret', '', when('auth', 'password')),
      F('keySecret', 'Private key', 'secret', '', { help: 'Vault secret holding the private key (OpenSSH or PEM).', ...when('auth', 'private key') }),
      F('passphraseSecret', 'Key passphrase', 'secret', '', when('auth', 'private key')),
      F('hostFingerprint', 'Host key fingerprint', 'text', '', { help: 'SHA256:... of the server key. Set it to refuse any other server; Test connection shows it.' }),
      F('baseFolder', 'Base folder', 'text', '/', { help: 'Activities work inside this folder only.' }),
      ...timing(true),
    ],
  },
  {
    kind: 'ftp', name: 'FTP server', desc: 'An FTP or FTPS server, for the SFTP / FTP palette.',
    fields: [
      F('host', 'Host', 'text', 'ftp.example.com'), F('port', 'Port', 'number', 21),
      F('user', 'Username', 'text', ''), F('passwordSecret', 'Password', 'secret', ''),
      F('security', 'Security', 'select', 'explicit TLS', { options: ['explicit TLS', 'implicit TLS', 'none'], help: 'none sends the password unencrypted: only inside a trusted network.' }),
      F('verifyTls', 'Verify server certificate', 'bool', true, when('security', 'explicit TLS', 'implicit TLS')),
      F('baseFolder', 'Base folder', 'text', '/', { help: 'Activities work inside this folder only.' }),
      ...timing(false),
    ],
  },
  {
    kind: 'oauthApp', name: 'OAuth connection (Google, YouTube, Twitch, Dropbox, Facebook)', desc: 'Connects an account with OAuth 2.0 (authorization code). Used by Google Sheets, Drive, Docs, YouTube, Twitch, Dropbox, Facebook and Connected API call. Sign in with Connect account (studio), sutra connect (any server), or a refresh token secret (servers set up by a pipeline).',
    fields: [
      F('provider', 'Service', 'select', 'google', { options: ['google', 'dropbox', 'facebook', 'microsoft', 'twitch', 'custom'] }),
      F('clientId', 'Client ID', 'text', ''), F('clientSecretSecret', 'Client secret', 'secret', ''),
      F('scopes', 'Scopes', 'text', 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive', { help: 'Space separated. Google: .../auth/spreadsheets, .../auth/drive, .../auth/youtube.readonly, .../auth/youtube.upload, .../auth/youtube.force-ssl, .../auth/yt-analytics.readonly. Twitch: user:read:email channel:manage:broadcast clips:edit user:write:chat moderator:read:followers. Dropbox: files.content.read files.content.write. Facebook: pages_manage_posts pages_read_engagement.' }),
      F('refreshTokenSecret', 'Refresh token (secret)', 'secret', '', { help: 'Optional, for servers without the studio: a refresh token of the account kept as a secret on that server (set by your pipeline with sutra secret set). Used instead of Connect account.' }),
      F('authUrl', 'Authorization URL', 'text', '', { ...when('provider', 'custom') }),
      F('tokenUrl', 'Token URL', 'text', '', { ...when('provider', 'custom') }),
      F('apiBase', 'API base URL', 'text', '', { help: 'Optional; for Connected API call with relative paths.' }),
    ],
  },
];
