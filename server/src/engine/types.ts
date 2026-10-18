export interface FlowNode {
  id: string;
  type: string;
  name: string;
  x: number;
  y: number;
  config: Record<string, any>;
  /** Per-step runtime policy. */
  settings?: StepSettings;
}
export interface StepSettings {
  retries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  disabled?: boolean;
  /** Loop the activity: once per item of a list (results collected), or again while a condition holds. */
  loop?: '' | 'for each item' | 'repeat while';
  loopOver?: string;
  loopWhile?: string;
  loopDelayMs?: number;
  loopMax?: number;
}
export interface FlowEdge {
  id: string;
  from: string;
  port: string;
  to: string;
  /** Name shown on the connection, e.g. "Order > 1000". */
  label?: string;
  /** always (default); when: only if condition is true; otherwise: when no "when" connection of the same output was taken. */
  when?: 'always' | 'when' | 'otherwise';
  /** Formula on the previous activity's output ({input.x}), for when = 'when'. */
  condition?: string;
}
export interface ProcessVariable { name: string; type?: string; value?: any; description?: string }
export interface FlowDoc {
  name: string;
  description?: string;
  /** Process (local) variables: initial values of {vars.x} in every run. */
  variables?: ProcessVariable[];
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export type FieldType =
  | 'text' | 'textarea' | 'code' | 'number' | 'select' | 'bool' | 'kv' | 'resource' | 'secret' | 'list'
  /** A shared schema of the project ("schemaId" or "schemaId::RootElement"). */
  | 'schema'
  /** Structured mapping to a target tree (see mapping.ts); its tree comes from the schema field named in schemaField. */
  | 'mapping'
  /** Another process of the same project (its flow id). */
  | 'process';

export interface Field {
  k: string;
  label: string;
  type: FieldType;
  def?: any;
  options?: string[];
  /** For type resource: which resource kind to pick from. */
  resourceKind?: string;
  /** Value may contain {{ }} references. */
  tpl?: boolean;
  help?: string;
  /** Show only when another field has one of these values. */
  showIf?: { k: string; in: any[] };
  /** Show when any of these conditions holds. */
  showIfAny?: { k: string; in: any[] }[];
  /** Changing this field changes the step's output ports. */
  ports?: boolean;
  group?: string;
  placeholder?: string;
  required?: boolean;
  /** For type mapping: the sibling schema field that defines the target tree. */
  schemaField?: string;
  /** For type schema: which kinds can be picked. */
  schemaKinds?: string[];
}

export interface Emit {
  port: string;
  out: any;
}
export interface StepResult {
  port?: string;
  out?: any;
  emits?: Emit[];
  /** Value stored as this step's output when it differs from what is emitted. */
  store?: any;
  /** Pause until a person decides (port approved/rejected). */
  wait?: { kind: 'approval'; message: string; assignee?: string };
  /** Durable timer: run this step again (phase "resume") after this epoch ms. */
  deferUntil?: number;
  /** Stops the whole run: other branches are cancelled and the run ends with this status. */
  stop?: { status: 'done' | 'failed'; message?: string };
  /** The process's result, returned to a calling process (Return activity). */
  result?: any;
  /** Call another process; the engine starts it and, when wait is set, resumes this step with its result. */
  call?: { doc: FlowDoc; flowId?: string; version?: number; projectId?: string | null; input: any; wait: boolean; name: string };
}

export interface ExecCtx {
  node: FlowNode;
  runId: string;
  input: any;
  /** Raw config value. */
  raw(k: string): any;
  /** Config value with {{ }} references resolved. */
  v(k: string): any;
  /** Resolve any template string against the run context. */
  resolve(t: unknown): any;
  resolveDeep(t: unknown): any;
  scope: Record<string, any>;
  phase?: string | null;
  attempt: number;
  signal: AbortSignal;
  log(level: 'info' | 'warn' | 'error', msg: string): void;
  /** Reveal a secret and mask it in run history. */
  secret(name: string, what?: string): string;
  /** Send the reply for request/response triggers (REST, SOAP). */
  reply(r: ReplyPayload): void;
  setVar(name: string, value: any): void;
  /** Evaluates a mapping field against its target schema. */
  mapping(k: string): any;
  /** Tree of a schema field (or null when none is chosen). */
  schemaTree(k: string): import('../schemas.js').SNode | null;
  projectId: string | null;
}

export interface ReplyPayload {
  status: number;
  headers?: Record<string, string>;
  body: any;
  contentType?: string;
  /** SOAP: wrap body in an envelope, or send a fault. */
  soap?: { operation?: string; fault?: { code: string; message: string; detail?: any }; ns?: string; version?: '1.1' | '1.2' };
}

export interface Activity {
  type: string;
  palette: string;
  name: string;
  glyph: string;
  desc: string;
  trigger?: boolean;
  /** Output ports; a function when they depend on config. */
  ports: string[] | ((cfg: Record<string, any>) => string[]);
  fields: Field[];
  /** Merge waits for every incoming connection. */
  join?: boolean;
  /** Hide the shared error port. */
  noErrorPort?: boolean;
  /** Has no input connection: started by the engine itself (error handler). */
  noInput?: boolean;
  /** Default step time limit for this activity (Settings tab), when longer work is normal. */
  timeoutMs?: number;
  /** What the output looks like, shown in the mapper before the first run. */
  outputHint?: any;
  /** Design-time shape of the output; inputSchema is the shape of what this step receives. */
  outputSchema?(cfg: Record<string, any>, h: SchemaHelpers): import('../schemas.js').SNode | null | undefined;
  /** Output is the input unchanged (If, Switch, Log, Wait...): its shape is the incoming shape. */
  passThrough?: boolean;
  execute(ctx: ExecCtx): Promise<StepResult | void> | StepResult | void;
}

export interface SchemaHelpers {
  schema(ref: string | undefined): import('../schemas.js').SNode | null;
  infer(value: any, name?: string): import('../schemas.js').SNode;
  input: import('../schemas.js').SNode | null;
  mappingTree(cfg: Record<string, any>, field: string, schemaField: string): import('../schemas.js').SNode;
}

export interface ResourceKind {
  kind: string;
  name: string;
  /** Small symbol shown next to connections of this kind in the explorer. */
  icon?: string;
  desc: string;
  fields: Field[];
}
