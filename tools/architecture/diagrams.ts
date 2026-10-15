/**
 * Diagrams of the architecture page, drawn as inline SVG so the page needs no library and no
 * network. Colours come from the page's theme tokens (light and dark).
 */
type P = [number, number];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A box with a bold title and smaller lines under it. k: '' | 'acc' (highlighted) | 'ext' (outside SutraFlow). */
function box(x: number, y: number, w: number, h: number, title: string, lines: string[] = [], k = '') {
  const lh = 16, n = 1 + lines.length;
  const y0 = y + h / 2 - ((n - 1) * lh) / 2 + 4.5;
  const cx = x + w / 2;
  return `<g class="bx ${k}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10"/>`
    + `<text class="t" x="${cx}" y="${y0}">${esc(title)}</text>`
    + lines.map((l, i) => `<text class="s" x="${cx}" y="${y0 + (i + 1) * lh}">${esc(l)}</text>`).join('') + '</g>';
}

/** An arrow along points; the label sits at `at` (default: middle of the longest segment). */
function arrow(pts: P[], label = '', k = '', at?: P) {
  let lab = '';
  if (label) {
    let p = at;
    if (!p) {
      let best = 0;
      for (let i = 1; i < pts.length; i++) {
        const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        if (d > best) { best = d; p = [(pts[i][0] + pts[i - 1][0]) / 2, (pts[i][1] + pts[i - 1][1]) / 2 - 6]; }
      }
    }
    lab = `<text class="al" x="${p![0]}" y="${p![1]}">${esc(label)}</text>`;
  }
  return `<polyline class="ar ${k}" points="${pts.map(p => p.join(',')).join(' ')}" marker-end="url(#ah)"/>${lab}`;
}

function group(x: number, y: number, w: number, h: number, label: string) {
  return `<g class="grp"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16"/><text x="${x + 16}" y="${y + 22}">${esc(label)}</text></g>`;
}

function note(x: number, y: number, lines: string[]) {
  return lines.map((l, i) => `<text class="nt" x="${x}" y="${y + i * 17}">${esc(l)}</text>`).join('');
}

function figure(id: string, w: number, h: number, caption: string, inner: string) {
  return `<figure class="dg" id="dg-${id}"><div class="dgs"><svg viewBox="0 0 ${w} ${h}" style="min-width:${Math.min(w, 760)}px" role="img" aria-label="${esc(caption)}">${inner}</svg></div><figcaption>${caption}</figcaption></figure>`;
}

/** Shared arrowhead, placed once at the top of the page. */
export const ARROW_DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="ahp"/></marker></defs></svg>`;

const row = (x0: number, y: number, w: number, h: number, gap: number, items: [string, string[], string?][]) =>
  items.map(([t, l, k], i) => box(x0 + i * (w + gap), y, w, h, t, l, k || '')).join('')
  + items.slice(1).map((_x, i) => arrow([[x0 + i * (w + gap) + w, y + h / 2], [x0 + (i + 1) * (w + gap) - 2, y + h / 2]])).join('');

export const DIAGRAMS = {
  runtime: figure('runtime', 980, 540, 'One SutraFlow server: who talks to it, what runs inside, and what it talks to.',
    group(240, 20, 500, 500, 'One SutraFlow server (Node.js 24)')
    + box(20, 50, 180, 64, 'Browser', ['studio, user guide'], 'ext')
    + box(20, 150, 180, 64, 'sutra CLI, CI', ['packages, Bearer token'], 'ext')
    + box(20, 290, 180, 64, 'API callers', ['REST, SOAP'], 'ext')
    + box(20, 400, 180, 64, 'AI assistants', ['MCP tools'], 'ext')
    + box(264, 50, 200, 64, 'Admin API :4800', ['studio, runs, resources'])
    + box(264, 150, 200, 64, 'Packages', ['check, deploy, rollback'])
    + box(264, 290, 200, 64, 'Gateway :8080 / :8443', ['REST, SOAP, TLS, policies'])
    + box(264, 400, 200, 64, 'MCP endpoint', ['/mcp, Sutras as skills'])
    + box(510, 50, 210, 110, 'Engine', ['worker slots claim tasks', 'checkpoint after each step', 'activities from palettes'], 'acc')
    + box(510, 190, 210, 64, 'Timers and listeners', ['leader engine only'])
    + box(510, 284, 210, 64, 'Cluster beat', ['heartbeat, lease, recovery'])
    + box(510, 378, 210, 50, 'Housekeeping', ['old runs deleted'])
    + box(510, 450, 210, 50, 'Metrics, traces, logs')
    + box(780, 40, 180, 100, 'Outside systems', ['HTTP, SOAP, databases,', 'bus, email, apps, AI'], 'ext')
    + box(780, 180, 180, 130, 'Storage', ['SQLite or PostgreSQL', 'Sutras, runs, tasks,', 'vault, engines, leases'], 'acc')
    + box(780, 440, 180, 70, 'Monitoring', ['Prometheus, OTLP, logs'], 'ext')
    + arrow([[200, 82], [262, 82]]) + arrow([[200, 182], [262, 182]]) + arrow([[200, 322], [262, 322]]) + arrow([[200, 432], [262, 432]])
    + arrow([[364, 114], [364, 148]]) + arrow([[364, 400], [364, 356]], 'same listener', '', [420, 382])
    + arrow([[464, 70], [508, 70]]) + arrow([[464, 322], [487, 322], [487, 125], [508, 125]], 'start run', '', [440, 280])
    + arrow([[615, 190], [615, 162]])
    + arrow([[720, 80], [778, 80]]) + arrow([[720, 140], [750, 140], [750, 210], [778, 210]]) + arrow([[720, 316], [750, 316], [750, 280], [778, 280]])
    + arrow([[720, 475], [778, 475]])),

  lifecycle: figure('lifecycle', 1010, 300, 'A run from trigger to finish. Every step is a task row; the checkpoint stores its output and the next tasks together.',
    row(20, 40, 140, 74, 26, [
      ['Trigger', ['request, timer, file,', 'queue, MCP, channel'], 'ext'],
      ['Start run', ['run row and', 'first task']],
      ['Claim task', ['pending to running', 'owner = this engine'], 'acc'],
      ['Run activity', ['settings, mapping,', 'loop, time limit']],
      ['Checkpoint', ['output and next tasks', 'in one transaction'], 'acc'],
      ['Run finishes', ['done, failed', 'or cancelled']],
    ])
    + arrow([[754, 114], [754, 140], [422, 140], [422, 116]], 'next steps', '', [600, 134])
    + arrow([[588, 114], [588, 170], [256, 170], [256, 198]], 'waits', '', [300, 164])
    + arrow([[422, 170], [422, 198]]) + arrow([[588, 170], [588, 198]]) + arrow([[588, 170], [754, 170], [754, 198]], 'reply step', '', [690, 164])
    + box(186, 200, 140, 80, 'Waiting', ['approval, timer, sub-', 'Sutra, remote reply'])
    + box(352, 200, 140, 80, 'Retry', ['back to pending,', 'not before a delay'])
    + box(518, 200, 140, 80, 'Error output', ['or the Sutra\'s', 'Error handler'])
    + box(684, 200, 140, 80, 'Reply', ['to the REST, SOAP', 'or MCP caller'], 'ext')),

  states: figure('states', 900, 300, 'Task states. Only rows change: a waiting task costs nothing, and a restart picks up where the rows say.',
    box(30, 120, 130, 50, 'pending') + box(250, 120, 130, 50, 'running', [], 'acc')
    + box(520, 30, 130, 50, 'done') + box(520, 120, 130, 50, 'waiting') + box(520, 210, 130, 50, 'failed')
    + box(250, 230, 130, 50, 'paused', ['debug run']) + box(740, 120, 130, 50, 'cancelled')
    + arrow([[160, 145], [248, 145]], 'claimed', '', [204, 138])
    + arrow([[380, 135], [450, 135], [450, 55], [518, 55]], 'finished', '', [480, 48])
    + arrow([[380, 145], [518, 145]], 'waits', '', [478, 158])
    + arrow([[380, 155], [430, 155], [430, 235], [518, 235]], 'no retries left', '', [470, 228])
    + arrow([[560, 120], [560, 98], [95, 98], [95, 118]], 'resumed (approval, timer, reply)', '', [300, 92])
    + arrow([[280, 170], [280, 200], [95, 200], [95, 172]], 'retry later', '', [190, 214])
    + arrow([[340, 170], [340, 228]])
    + arrow([[650, 145], [738, 145]], 'cancel', '', [694, 138])),

  branches: figure('branches', 900, 260, 'Connections with conditions. A branch that is not taken sends a skip token, so the merge step still fires once.',
    box(30, 100, 150, 60, 'Get order', ['output: amount'])
    + box(400, 20, 150, 50, 'Approval') + box(400, 110, 150, 50, 'Ship') + box(400, 200, 150, 50, 'Log order')
    + box(700, 100, 170, 70, 'Send reply', ['merge: waits for', 'every incoming line'], 'acc')
    + arrow([[180, 130], [290, 130], [290, 45], [398, 45]], 'Order > 1000 (when)', '', [345, 38])
    + arrow([[290, 135], [398, 135]], 'otherwise', '', [345, 128])
    + arrow([[290, 130], [290, 225], [398, 225]], 'always', '', [345, 218])
    + arrow([[550, 45], [620, 45], [620, 125], [698, 125]])
    + arrow([[550, 140], [698, 140]], 'skip token', 'dash', [624, 156])),

  storage: figure('storage', 940, 260, 'One storage layer, two backends. PostgreSQL drivers are asynchronous, so a worker thread holds the connection while the caller waits.',
    box(20, 95, 170, 70, 'Engine, API,', ['packages, cluster'])
    + box(240, 95, 170, 70, 'q and tx', ['db.ts'], 'acc')
    + box(470, 20, 200, 64, 'SQLite backend', ['node:sqlite, WAL file'])
    + box(470, 150, 200, 80, 'Caller waits', ['Atomics.wait on a', 'SharedArrayBuffer'])
    + box(720, 150, 200, 80, 'pgworker.ts', ['worker thread', 'pg or PGlite'])
    + box(720, 20, 200, 64, 'PostgreSQL', ['advisory lock per write'], 'ext')
    + arrow([[190, 130], [238, 130]])
    + arrow([[410, 115], [440, 115], [440, 52], [468, 52]], 'default', '', [440, 104])
    + arrow([[410, 145], [440, 145], [440, 190], [468, 190]], 'SUTRA_DB=postgres://', '', [365, 184])
    + arrow([[670, 180], [718, 180]], 'statement', '', [694, 173])
    + arrow([[718, 205], [672, 205]], 'answer', 'dash', [694, 220])
    + arrow([[820, 150], [820, 86]])),

  cluster: figure('cluster', 940, 410, 'A cluster. Every engine serves requests and runs steps; one engine leads for work that must happen once.',
    box(330, 20, 280, 50, 'Load balancer', ['health check: /ready'], 'ext')
    + box(80, 130, 200, 100, 'engine-1', ['gateway, workers'])
    + box(370, 130, 200, 100, 'engine-2 (leader)', ['timers, listeners,', 'recovery, housekeeping'], 'acc')
    + box(660, 130, 200, 100, 'engine-3', ['gateway, workers'])
    + box(40, 310, 200, 64, 'Studio', ['SUTRA_WORKERS=0'])
    + box(370, 300, 200, 86, 'PostgreSQL', ['tasks, engines, leases,', 'deploy generation'], 'acc')
    + arrow([[470, 70], [470, 100], [180, 100], [180, 128]]) + arrow([[470, 70], [470, 128]]) + arrow([[470, 100], [760, 100], [760, 128]])
    + arrow([[180, 230], [180, 270], [420, 270], [420, 298]]) + arrow([[470, 230], [470, 298]]) + arrow([[760, 230], [760, 270], [520, 270], [520, 298]])
    + arrow([[240, 342], [368, 342]])
    + note(610, 320, ['Each step runs once: claimed by one', 'atomic update with an owner.', 'Dead engine (3 missed beats): the', 'leader puts its steps back to pending.'])),

  release: figure('release', 1090, 290, 'A release. One package travels unchanged from test to production; each environment brings its own deployment config.',
    row(20, 40, 150, 76, 30, [
      ['Build', ['studio, CLI, or a', 'Release Sutra']],
      ['Package file', ['Sutras, connections,', 'schemas, sha256'], 'acc'],
      ['Check', ['activities, secrets,', 'paths, skill names']],
      ['Deploy to test', ['+ test deployment', 'config']],
      ['Approval', ['person or', 'pipeline gate'], 'ext'],
      ['Deploy to prod', ['+ prod deployment', 'config'], 'acc'],
    ])
    + box(150, 190, 250, 64, 'sutra deploy --server', ['remote engine, admin token'])
    + box(440, 190, 250, 64, 'Deploy folder at start', ['SUTRA_DEPLOY_DIR, containers'])
    + box(730, 190, 250, 64, 'Roll back', ['the previous package, kept in history'])
    + arrow([[275, 116], [275, 188]]) + arrow([[275, 150], [565, 150], [565, 188]])
    + arrow([[995, 116], [995, 160], [855, 160], [855, 188]], 'if needed', '', [925, 153])),

  gateway: figure('gateway', 1060, 178, 'A request to a deployed service. The caller waits until the Sutra\'s reply step answers, on any engine; every request is written to the request log.',
    row(20, 30, 128, 80, 20, [
      ['Caller', ['REST, SOAP', 'or MCP'], 'ext'],
      ['TLS', ['certificate,', 'client certificates']],
      ['Firewall', ['deny wins,', 'allow list']],
      ['Route match', ['method and path,', 'SOAP action, /mcp']],
      ['API policy', ['app key or token,', 'scopes, plan limit'], 'acc'],
      ['Start run', ['deployed version,', 'traceparent kept']],
      ['Reply step', ['or a timeout', 'and a 504']],
    ])
    + arrow([[972, 110], [972, 160], [84, 160], [84, 112]], 'response, 403, 401, 429, or a SOAP fault', '', [528, 154])),

  stop: figure('stop', 1010, 130, 'A graceful stop (SIGTERM, docker stop, or POST /api/engine/drain).',
    row(20, 30, 140, 74, 26, [
      ['Stop signal', ['SIGTERM or', 'drain API'], 'ext'],
      ['Not ready', ['/ready answers 503']],
      ['Leave leadership', ['timers, listeners', 'stop here']],
      ['Drain steps', ['up to', 'SUTRA_DRAIN_MS'], 'acc'],
      ['Hand back', ['unfinished steps', 'to pending']],
      ['Close', ['gateway, pools,', 'flush traces']],
    ])),
};
