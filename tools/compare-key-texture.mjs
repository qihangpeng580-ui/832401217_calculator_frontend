/**
 * 按键底纹方案对比图（一次性工具，用完可删）
 *
 * 目的：按键只有 52px 高。奶龙头像做成底纹时"多大、多浓、放哪"才不会糊成一团？
 *      与其反复猜，不如一次生成几种方案并排截图，直接看效果选。
 *
 * 运行：node tools/compare-key-texture.mjs
 * 输出：docs/按键底纹对比.png
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
const outFile = join(repoRoot, 'docs', '按键底纹对比.png');
const workDir = join(tmpdir(), 'dsh_tex_cmp');
const profileDir = join(tmpdir(), 'dsh_tex_cmp_prof');
const SITE_PORT = 8155;
const CDP_PORT = 9377;

/** 候选方案：靠 CSS 变量控制头像的尺寸/浓度/位置，另有两个"不放头像"的方案 */
const VARIANTS = [
  { name: 'A 只留头部水印（20px, 0.45, 右下角）', css: 'width:20px;height:20px;right:4px;bottom:4px;opacity:.45;' },
  { name: 'B 头像做浅水印（26px, 0.55, 正中偏下）', css: 'width:26px;height:26px;right:13px;bottom:-2px;opacity:.55;' },
  { name: 'C 不放头像，只放一行小脚印', css: 'display:none;' },
  { name: 'D 完全干净，不放任何底纹', css: 'display:none;' },
];

if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
if (existsSync(profileDir)) rmSync(profileDir, { recursive: true, force: true });
cpSync(srcDir, workDir, { recursive: true });
mkdirSync(join(repoRoot, 'docs'), { recursive: true });

const baseHtml = readFileSync(join(srcDir, 'index.html'), 'utf8');

/** 生成对比页：三行按键，每行一种方案 */
function buildHtml() {
  // 注意：字符串里含 $ 时不能用 str.replace(pat, str) —— $' 会被当成"匹配后的内容"，
  // 结果把 HTML 打乱（踩过）。这里改用函数式替换，杜绝转义问题。
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
    /* 四种方案分别覆盖 .key::before 的几何参数，其余仍用 style.css 里的样式 */
    .cmp__row:nth-child(1) .key::before { width:20px;height:20px;right:4px;bottom:4px;opacity:.45; }
    .cmp__row:nth-child(2) .key::before { width:26px;height:26px;right:13px;bottom:-2px;opacity:.55; }
    .cmp__row:nth-child(3) .key::before { display:none; }
    .cmp__row:nth-child(4) .key::before { display:none; }
    /* 方案 C：用 CSS 画两个小脚印（不依赖图片，看看纯矢量够不够） */
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
  // 等图片加载完
  for (let i = 0; i < 60; i++) {
    const r = await send('Runtime.evaluate', { expression: 'document.querySelectorAll(".key").length === 12 && [...document.images].every(i=>i.complete)', returnByValue: true });
    if (r.result?.result?.value === true) break;
    await sleep(100);
  }
  await sleep(300);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(outFile, Buffer.from(shot.result.data, 'base64'));
  console.log('对比图已生成：' + outFile);
  ws.close();
} finally {
  chrome.kill();
  server.close();
  await sleep(300);
  rmSync(workDir, { recursive: true, force: true });
  rmSync(profileDir, { recursive: true, force: true });
}
