import { coreActivities } from './core.js';
import { agentActivities } from './agent.js';
import { httpActivities } from './http.js';
import { soapActivities } from './soap.js';
import { aiActivities } from './ai.js';
import { processActivities } from './process.js';
import { mcpActivities } from './mcp.js';
import { scriptActivities } from './scripts.js';
import { releaseActivities } from './release.js';
import { fileActivities } from './file.js';
import { codeActivities } from './code.js';
import { transformActivities } from './transform.js';
import { emailActivities } from '../connectors/email.js';
import { dbActivities } from '../connectors/db.js';
import { busActivities } from '../connectors/bus.js';
import { firebaseActivities } from '../connectors/firebase.js';
import { saasActivities } from '../connectors/saas.js';
import { microsoftActivities } from '../connectors/microsoft.js';
import { remoteActivities } from '../connectors/remote.js';
import { azureActivities } from '../connectors/azure.js';
import { chatActivities } from '../connectors/chat.js';

/** Palette order in the studio. New palettes (connectors) register here. */
export const PALETTES = [
  { id: 'triggers', name: 'Triggers', color: 'auto' },
  { id: 'http', name: 'HTTP / REST', color: 'general' },
  { id: 'soap', name: 'SOAP / Web services', color: 'soap' },
  { id: 'data', name: 'Data & mapping', color: 'data' },
  { id: 'flow', name: 'Flow control', color: 'flow' },
  { id: 'files', name: 'Files', color: 'data' },
  { id: 'remote', name: 'SFTP / FTP', color: 'data' },
  { id: 'db', name: 'DB Ops', color: 'data' },
  { id: 'bus', name: 'Service Bus', color: 'flow' },
  { id: 'email', name: 'Email', color: 'general' },
  { id: 'firebase', name: 'Firebase', color: 'ai' },
  { id: 'apps', name: 'Apps and social (Google, YouTube, Twitch, Discord, Telegram, Dropbox, Facebook)', color: 'auto' },
  { id: 'azure', name: 'Azure Data Factory & Databricks', color: 'data' },
  { id: 'custom', name: 'Custom code', color: 'general' },
  { id: 'scripts', name: 'Scripts (PowerShell, shell, Python)', color: 'general' },
  { id: 'release', name: 'Release (packages)', color: 'flow' },
  { id: 'general', name: 'General', color: 'general' },
  { id: 'ai', name: 'AI', color: 'ai' },
];

export const allActivities = [
  ...coreActivities, ...processActivities, ...transformActivities, ...httpActivities, ...soapActivities, ...fileActivities, ...remoteActivities, ...dbActivities, ...busActivities,
  ...emailActivities, ...firebaseActivities, ...saasActivities, ...chatActivities, ...azureActivities, ...microsoftActivities, ...codeActivities, ...scriptActivities, ...releaseActivities, ...aiActivities, ...agentActivities, ...mcpActivities,
];

// Models often take 10 to 60 seconds to answer, and local models or long texts longer: AI steps allow
// 10 minutes by default (a step's Settings tab can still set its own limit).
for (const a of allActivities) if (a.palette === 'ai' && !a.timeoutMs) a.timeoutMs = 600000;
