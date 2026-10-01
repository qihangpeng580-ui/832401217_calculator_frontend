/**
 * 一次性诊断：在不同窗口宽度下量出真实布局尺寸，找出"卡片变窄"的临界点。
 * 运行：node tools/measure-layout.mjs
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, existsSync, cpSync, rmSync } from 'node:fs';
import { join, resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const workDir = join(tmpdir(), 'dsh_measure');
const profileDir = join(tmpdir(), 'dsh_measure_prof');
const SITE_PORT = 8166;
const CDP_PORT = 9388;

if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
if (existsSync(profileDir)) rmSync(profileDir, { recursive: true, force: true });
cpSync(join(repoRoot, 'src'), workDir, { recursive: true });

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  const rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '');
  const file = join(workDir, rel);
  if (!file.startsWith(workDir) || !existsSync(file)) { res.writeHead(404).end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((ok) => server.listen(SITE_PORT, '127.0.0.1', ok));

const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ['--headless=new', '--disable-gpu', `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profileDir}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).ok) break; } catch { /* retry */ }
    await sleep(200);
  }
  const url = `http://127.0.0.1:${SITE_PORT}/index.html`;
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
  const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.result?.value;

  await send('Runtime.enable');
  const probe = `JSON.stringify({
    viewport: window.innerWidth,
    appWidth: Math.round(document.querySelector('.app').getBoundingClientRect().width),
    calcWidth: Math.round(document.querySelector('.calc').getBoundingClientRect().width),
    keyWidth: Math.round(document.querySelector('.key').getBoundingClientRect().width),
    historyWidth: Math.round(document.querySelector('.history').getBoundingClientRect().width),
    appLeft: Math.round(document.querySelector('.app').getBoundingClientRect().left),
    appRight: Math.round(document.querySelector('.app').getBoundingClientRect().right),
    bodyScrollW: document.body.scrollWidth,
  })`;

  for (const w of [600, 700, 760, 780, 800, 900, 1000, 1035, 1100, 1200, 1400]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(120);
    const v = JSON.parse(await evaluate(probe));
    const centreOffset = Math.round((v.viewport - (v.appRight - v.appLeft)) / 2) - v.appLeft;
    console.log(`视口 ${String(v.viewport).padStart(4)} | app ${String(v.appWidth).padStart(3)} (左${String(v.appLeft).padStart(4)} 右${String(v.appRight).padStart(4)} 居中偏差 ${String(centreOffset).padStart(3)}) | calc ${String(v.calcWidth).padStart(3)} | 键 ${String(v.keyWidth).padStart(2)} | 历史 ${String(v.historyWidth).padStart(3)} | 横向滚动 ${v.bodyScrollW > v.viewport ? '有!' : '无'}`);
  }
  ws.close();
} finally {
  chrome.kill();
  server.close();
  await sleep(300);
  rmSync(workDir, { recursive: true, force: true });
  rmSync(profileDir, { recursive: true, force: true });
}
