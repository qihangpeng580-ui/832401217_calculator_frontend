/**
 * Key background-texture comparison image (one-off tool, delete when done)
 *
 * Purpose: keys are only 52px tall. How large, how opaque, and where should the Nailong
 *          avatar sit as a background texture so it does not smear into one blob?
 *          Instead of guessing repeatedly, generate several variants at once and
 *          screenshot them side by side, then choose by looking at the result.
 *
 * Usage: node tools/compare-key-texture.mjs
 * Output: docs/key-texture-comparison.png
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { writeFileSync, readFileSync, existsSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { join, resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const srcDir = join(repoRoot, 'src');
const outFile = join(repoRoot, 'docs', 'key-texture-comparison.png');
const workDir = join(tmpdir(), 'dsh_tex_cmp');
const profileDir = join(tmpdir(), 'dsh_tex_cmp_prof');
const SITE_PORT = 8155;
const CDP_PORT = 9377;

/** Candidate variants: CSS variables control the avatar's size/opacity/position; two variants omit the avatar entirely */
const VARIANTS = [
  { name: 'A Head watermark only (20px, 0.45, bottom right)', css: 'width:20px;height:20px;right:4px;bottom:4px;opacity:.45;' },
  { name: 'B Avatar as a light watermark (26px, 0.55, centre-low)', css: 'width:26px;height:26px;right:13px;bottom:-2px;opacity:.55;' },
  { name: 'C No avatar, just a row of small paw prints', css: 'display:none;' },
  { name: 'D Completely clean, no texture', css: 'display:none;' },
];

if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
if (existsSync(profileDir)) rmSync(profileDir, { recursive: true, force: true });
cpSync(srcDir, workDir, { recursive: true });
mkdirSync(join(repoRoot, 'docs'), { recursive: true });

const baseHtml = readFileSync(join(srcDir, 'index.html'), 'utf8');

/** Build the comparison page: three key rows, one variant per row */
function buildHtml() {
  // NOTE: with $ in the string, str.replace(pat, str) is unsafe -- $' is interpreted as
  // "the content after the match" and scrambles the HTML. A function replacement avoids it.
  const rows = VARIANTS.map((v, i) => {
    const cell = (k) => {
      const cls = k === '+' ? 'key key--op' : k === 'AC' ? 'key key--fn' : 'key';
      return `<button type="button" class="${cls}" data-key="${k}">${k}</button>`;
    };
    return `
    <div class="cmp__row">
      <p class="cmp__label">${v.name}</p>
      <div class="keys" style="grid-template-columns:repeat(4,1fr);width:296px">
        ${cell('7')}${cell('8')}${cell('+')}${cell('AC')}
      </div>
    </div>`;
  }).join('\n');

  const override = `
  <style>
    .cmp { display: grid; gap: 14px; padding: 4px; }
    .cmp__row { background: #fff; border: 1px solid #e6ecf7; border-radius: 18px; padding: 14px; }
    .cmp__label { margin: 0 0 10px; font-size: 13px; font-weight: 700; color: #8b97b4; }
    /* The four variants each override the geometry of .key::before; the rest still comes from style.css */
    .cmp__row:nth-child(1) .key::before { width:20px;height:20px;right:4px;bottom:4px;opacity:.45; }
    .cmp__row:nth-child(2) .key::before { width:26px;height:26px;right:13px;bottom:-2px;opacity:.55; }
    .cmp__row:nth-child(3) .key::before { display:none; }
    .cmp__row:nth-child(4) .key::before { display:none; }
    /* Variant C: draw two small paw prints in CSS (no image dependency; tests whether pure vector is enough) */
    .cmp__row:nth-child(3) .key::after {
      content:''; position:absolute; right:7px; bottom:7px; width:4px; height:5px;
      border-radius:50%; background:#f6c445; opacity:.55;
      box-shadow: 6px 1px 0 -.5px #f6c445, 3px -5px 0 -1px #f6c445;
    }
  </style>`;

  const mainTag = '<main class="app">';
  return baseHtml
    .replace('</head>', () => override + '\n</head>')
    .replace(mainTag, () => `${mainTag}<div class="cmp">${rows}</div></main>`)
    .replace(/<script type="module" src="js\/[^"]+"><\/script>\s*/g, '');
}
writeFileSync(join(workDir, 'compare.html'), buildHtml(), 'utf8');

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  const rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '');
  const file = join(workDir, rel);
  if (!file.startsWith(workDir) || !existsSync(file)) { res.writeHead(404).end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((ok) => server.listen(SITE_PORT, '127.0.0.1', ok));

const chromePath = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p));

const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profileDir}`,
  '--window-size=420,700', '--no-first-run', 'about:blank'], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).ok) break; } catch { /* retry */ }
    await sleep(200);
  }
  const url = `http://127.0.0.1:${SITE_PORT}/compare.html`;
  const target = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok) => ws.addEventListener('open', ok, { once: true }));

  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    const p = pending.get(m.id);
    if (p) { pending.delete(m.id); p(m); }
  });
  const send = (method, params = {}) => new Promise((res) => {
    id += 1; pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 420, height: 700, deviceScaleFactor: 2, mobile: false });
  // Wait for images to finish loading
  for (let i = 0; i < 60; i++) {
    const r = await send('Runtime.evaluate', { expression: 'document.querySelectorAll(".key").length === 12 && [...document.images].every(i=>i.complete)', returnByValue: true });
    if (r.result?.result?.value === true) break;
    await sleep(100);
  }
  await sleep(300);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(outFile, Buffer.from(shot.result.data, 'base64'));
  console.log('Comparison image written: ' + outFile);
  ws.close();
} finally {
  chrome.kill();
  server.close();
  await sleep(300);
  rmSync(workDir, { recursive: true, force: true });
  rmSync(profileDir, { recursive: true, force: true });
}
