// Captures the screenshots used by the user guide from a running SutraFlow studio.
// Uses headless Microsoft Edge (or Chrome) through the DevTools protocol, with its own
// temporary profile. Sign-in: SUTRA_GUIDE_USER / SUTRA_GUIDE_PASS, or data/dev-admin.txt.
//
//   node tools/capture-guide-shots.mjs [http://127.0.0.1:4800]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.argv[2] || 'http://127.0.0.1:4800';
const OUT = path.join(root, 'docs', 'guide-images');
fs.mkdirSync(OUT, { recursive: true });

function credentials() {
  if (process.env.SUTRA_GUIDE_USER && process.env.SUTRA_GUIDE_PASS) return { username: process.env.SUTRA_GUIDE_USER, password: process.env.SUTRA_GUIDE_PASS };
  const f = path.join(root, 'data', 'dev-admin.txt');
  const t = fs.readFileSync(f, 'utf8');
  return { username: /username:\s*(\S+)/.exec(t)[1], password: /password:\s*(\S+)/.exec(t)[1] };
}

const browsers = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];
const exe = browsers.find(b => fs.existsSync(b));
if (!exe) throw new Error('No Edge or Chrome found');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const login = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-sutra': '1' }, body: JSON.stringify(credentials()) });
  if (login.status !== 200) throw new Error(`Sign-in failed: ${login.status}`);
  const session = /sutra_session=([^;]+)/.exec(login.headers.get('set-cookie'))[1];

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-shots-'));
  const port = 9300 + Math.floor(Math.random() * 500);
  const proc = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-extensions', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  try {
    let target;
    for (let i = 0; i < 50 && !target; i++) {
      await sleep(200);
      try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch { /* starting */ }
    }
    if (!target) throw new Error('Browser did not start');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0;
    const waiting = new Map();
    ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } };
    const cdp = (method, params = {}) => new Promise((res, rej) => {
      const n = ++id;
      waiting.set(n, m => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
      ws.send(JSON.stringify({ id: n, method, params }));
    });
    const js = async (expr) => {
      const r = await cdp('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    };
    const shot = async (name) => {
      await sleep(500);
      const r = await cdp('Page.captureScreenshot', { format: 'jpeg', quality: 84 });
      fs.writeFileSync(path.join(OUT, `${name}.jpg`), Buffer.from(r.data, 'base64'));
      console.log('saved', name);
    };
    const go = async (hash) => { await cdp('Page.navigate', { url: `${BASE}/${hash}` }); await sleep(2200); };

    await cdp('Page.enable');
    await cdp('Network.enable');
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 880, deviceScaleFactor: 1, mobile: false });
    const host = new URL(BASE).hostname;
    await cdp('Network.setCookie', { name: 'sutra_session', value: session, domain: host, path: '/', httpOnly: true });
    await go('#designer');

    // Helpers available inside the page.
    const H = `
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const setSel = (el, v) => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('change', { bubbles: true })); };
      const setText = (el, v) => { const p = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(p, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
      const btn = t => [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(t));
      const node = t => [...document.querySelectorAll('.react-flow__node')].find(n => n.querySelector('.nm')?.textContent === t);
      const tab = t => [...document.querySelectorAll('.side .tabs button')].find(b => b.textContent === t);
      const openFlow = async name => { for (let i = 0; i < 50 && !document.querySelector('.flowbar select'); i++) await wait(200); const s = document.querySelector('.flowbar select'); const o = [...s.options].find(o => o.textContent === name); if (o) { setSel(s, o.value); await wait(1500); } return !!o; };
    `;
    await js(`localStorage.setItem('sutra.theme', 'light'); localStorage.setItem('sutra.left', 'palette'); localStorage.setItem('sutra.project', 'default');`);
    await go('#designer');

    // 1. Designer with palettes.
    await js(`${H} await openFlow('Order lookup API'); document.querySelector('.react-flow__pane')?.click(); await wait(300);`);
    await shot('designer');

    // 2. Project explorer.
    await js(`${H} [...document.querySelectorAll('.ltabs button')].find(b => b.textContent === 'Project').click(); await wait(400);
      const s = [...document.querySelectorAll('.xitem')].find(b => b.textContent.includes('OrderXml')); s?.click(); await wait(1200);`);
    await shot('project-explorer');
    await js(`${H} [...document.querySelectorAll('.ltabs button')].find(b => b.textContent === 'Palettes').click(); document.querySelector('.react-flow__pane')?.click(); await wait(300);`);

    // 3. Mapper with formula editor (after a test run so values show).
    await js(`${H} await openFlow('Order SOAP service'); btn('▶ Test')?.click(); await wait(2500);
      node('Build order').querySelector('.anode').click(); await wait(400); tab('Input').click(); await wait(1200);
      [...document.querySelectorAll('.trow')].find(r => r.textContent.includes('Caller'))?.click(); await wait(1200);`);
    await shot('mapper');

    // 4. Linked-field highlight.
    await js(`${H} [...document.querySelectorAll('.srow')].find(r => r.dataset.ref === 'input.operation')?.click(); await wait(600);`);
    await shot('mapper-highlight');

    // 5. Output tab: fields and values.
    await js(`${H} tab('Output').click(); await wait(600);`);
    await shot('output-tab');

    // 6. Debugger paused at an activity.
    await js(`${H} document.querySelector('.react-flow__pane')?.click(); await wait(200); btn('🐞 Debug')?.click(); await wait(1500); btn('⤼ Step')?.click(); await wait(1500);
      node('Build order').querySelector('.anode').click(); await wait(400); tab('Output').click(); await wait(600);`);
    await shot('debugger');
    await js(`${H} btn('■ Stop')?.click(); await wait(800);`);

    // 7. General tab with variable picker (Write file).
    await js(`${H} if (await openFlow('Untitled flow')) { node('Write file')?.querySelector('.anode').click(); await wait(400); tab('General').click(); await wait(500); }`);
    await shot('general-tab');

    // 8. Runs.
    await go('#runs');
    await js(`${H} document.querySelector('table.t tr.click')?.click(); await wait(1200);`);
    await shot('runs');

    // 9. Resources.
    await go('#resources');
    await js(`${H} [...document.querySelectorAll('.list li button')].find(b => b.textContent.includes('API security policy'))?.click(); await wait(500);
      [...document.querySelectorAll('.list li button')].find(b => b.textContent.includes('Partner API keys'))?.click(); await wait(600);`);
    await shot('resources');

    // 10. Server & APIs.
    await go('#server');
    await shot('server');

    // 11. New connection: + menu of kinds, then an HTTP connection tested (not saved).
    await go('#designer');
    await js(`${H} [...document.querySelectorAll('.ltabs button')].find(b => b.textContent === 'Project').click(); await wait(400);
      document.querySelector('[aria-label="New resource"]').click(); await wait(400);`);
    await shot('resource-menu');
    await js(`${H} [...document.querySelectorAll('.kitem')].find(b => b.textContent.includes('HTTP connection')).click(); await wait(500);
      setText(document.getElementById('rname'), 'Orders API');
      const f = [...document.querySelectorAll('.fld')].find(x => x.querySelector('label')?.textContent.startsWith('Base URL'));
      setText(f.querySelector('input'), location.origin); await wait(200);
      btn('Test connection').click(); await wait(1800);
      const box = document.querySelector('.okbox, .errbox'); const side = document.querySelector('.side .tabbody'); if (box && side) side.scrollTop = box.offsetTop - 330;`);
    await shot('resource-new');

    // 12. Samples: For-Each mapping and try / catch.
    await go('#designer');
    await js(`${H} [...document.querySelectorAll('.ltabs button')].find(b => b.textContent === 'Palettes')?.click(); await wait(300);
      await openFlow('Sample: For-Each mapping'); btn('▶ Test')?.click(); await wait(2500);
      node('Build invoice').querySelector('.anode').click(); await wait(400); tab('Input').click(); await wait(1200);
      [...document.querySelectorAll('.trow')].find(r => r.textContent.trim().startsWith('lines'))?.click(); await wait(1000);`);
    await shot('sample-foreach');
    await js(`${H} await openFlow('Sample: Try and catch with logs'); btn('▶ Test')?.click(); await wait(2500);
      node('Error handler').querySelector('.anode').click(); await wait(400); tab('Output').click(); await wait(600);`);
    await shot('sample-trycatch');

    ws.close();
  } finally {
    proc.kill();
    await sleep(500);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* still in use */ }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
