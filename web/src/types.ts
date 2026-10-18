export interface Field {
  k: string;
  label: string;
  type: 'text' | 'textarea' | 'code' | 'number' | 'select' | 'bool' | 'kv' | 'resource' | 'secret' | 'list' | 'schema' | 'mapping' | 'process';
  def?: any;
  options?: string[];
  resourceKind?: string;
  tpl?: boolean;
  help?: string;
  showIf?: { k: string; in: any[] };
  /** Show when any of these conditions holds. */
  showIfAny?: { k: string; in: any[] }[];
  ports?: boolean;
  group?: string;
  placeholder?: string;
  schemaField?: string;
  schemaKinds?: string[];
}

export interface ActivityMeta {
  /** Default step time limit (ms). */
  timeoutMs?: number;
  type: string;
  palette: string;
  name: string;
  glyph: string;
  desc: string;
  trigger: boolean;
  join: boolean;
  noErrorPort: boolean;
  noInput?: boolean;
  fields: Field[];
  outputHint: any;
  ports: string[] | { field: string; extra: string[]; fallback: string[] };
}

export interface Meta {
  palettes: { id: string; name: string; color: string }[];
  activities: ActivityMeta[];
  resourceKinds: { kind: string; name: string; desc: string; icon?: string; fields: Field[] }[];
  pipes: { name: string; help: string }[];
  functions: { name: string; group: string; sig: string; help: string; example?: string }[];
  version: string;
}

export interface FlowNode {
  id: string;
  type: string;
  name: string;
  x: number;
  y: number;
  config: Record<string, any>;
  settings?: { retries?: number; retryDelayMs?: number; timeoutMs?: number; disabled?: boolean; loop?: '' | 'for each item' | 'repeat while'; loopOver?: string; loopWhile?: string; loopDelayMs?: number; loopMax?: number };
}
export interface FlowEdge { id: string; from: string; port: string; to: string; label?: string; when?: 'always' | 'when' | 'otherwise'; condition?: string }
export interface ProcessVariable { name: string; type: string; value: any; description?: string }
export interface FlowDoc { name: string; description?: string; variables?: ProcessVariable[]; nodes: FlowNode[]; edges: FlowEdge[] }

export interface FlowSummary {
  id: string;
  name: string;
  /** Folder in the project, such as "Samples/SQL"; '' = the top. */
  folder?: string;
  version: number;
  updated_at: string;
  deployed: { version: number; enabled: boolean; deployed_at: string } | null;
}

export interface Resource { id: string; kind: string; name: string; project_id?: string; config: Record<string, any>; updated_at?: string }

export interface SNode {
  name: string;
  type: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'date' | 'any' | 'null';
  repeats?: boolean;
  required?: boolean;
  children?: SNode[];
  doc?: string;
  enum?: string[];
  attr?: boolean;
}
export interface NodeDesign { in: SNode | null; out: SNode | null; ports?: Record<string, SNode>; inputTrees: Record<string, SNode>; warnings: string[] }

export interface MapRule { expr?: string; forEach?: string; where?: string; groupBy?: string; sortBy?: string; sortDesc?: boolean; ifCond?: string; choose?: { when: string; expr: string }[]; otherwise?: string }
export interface MappingValue { rules: Record<string, MapRule>; fields?: string[] }

export interface SchemaInfo { id: string; project_id: string; name: string; kind: 'json' | 'xsd' | 'wsdl'; root: string | null; updated_at: string; roots: string[] }
export interface ProjectVariable { name: string; type: 'string' | 'number' | 'boolean' | 'secret'; value: string; description?: string }
export interface LoggingConfig { enabled: boolean; file: string; level: string; format: string; maxSizeMb: number; maxFiles: number; stepData: boolean }
export interface Project { id: string; name: string; description: string; config: { variables: ProjectVariable[]; logging: LoggingConfig }; flows?: number }

export interface RunTask {
  id: number;
  node_id: string;
  status: string;
  attempt: number;
  port: string | null;
  input: any;
  output: any;
  error: string | null;
  ms: number | null;
  wait: any;
  started_at: string | null;
  finished_at: string | null;
}

export interface RunDetail {
  id: string;
  flowId: string;
  flowName: string;
  version: number;
  status: string;
  source: string;
  triggerNode: string;
  error: string | null;
  steps: number;
  startedAt: string;
  finishedAt: string | null;
  doc: FlowDoc;
  outputs: Record<string, any>;
  vars: Record<string, any>;
  logs: { t: string; level: string; msg: string; step?: string }[];
  reply: any;
  tasks: RunTask[];
  projectId?: string;
  debug?: { stepping: boolean; breakpoints: string[] } | null;
}

/** A comma list, a list of strings, or kv rows ([{k, v}] → their names). */
export const listOf = (s: unknown): string[] =>
  Array.isArray(s)
    ? s.map(x => String(x && typeof x === 'object' ? (x as any).k ?? '' : x).trim()).filter(Boolean)
    : String(s ?? '').split(/[,\n]/).map(x => x.trim()).filter(Boolean);

/** Run statuses that are still in progress. */
export const ACTIVE = ['running', 'waiting', 'paused'];

export function portsOf(meta: ActivityMeta | undefined, cfg: Record<string, any>): string[] {
  if (!meta) return [];
  let ps: string[];
  if (Array.isArray(meta.ports)) ps = meta.ports;
  else {
    const list = listOf(cfg[meta.ports.field]);
    ps = list.length ? [...list, ...meta.ports.extra] : meta.ports.fallback;
  }
  return meta.noErrorPort || meta.trigger ? ps : [...ps, 'error'];
}
