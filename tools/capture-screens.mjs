/**
 * 截图脚本（Chromium DevTools Protocol 直连，零依赖）
 *
 * 运行：node tools/capture-screens.mjs
 *
 * 为什么不直接用 `chrome --headless --screenshot`：
 *   那个方式在截图时不等页面脚本执行完，实测 12 张图全是空表达式；
 *   加 --virtual-time-budget 也不稳定（模块脚本始终没跑）。
 *   换成 CDP 之后可以自己控制节奏：等页面渲染出目标内容再截图，一次就成。
 *
 * 流程：启动 Chrome（带远程调试端口）
 *      → 每张图：开新标签页打开 shot-XX.html → 轮询校验渲染结果 → Page.captureScreenshot
 *      → 写 PNG
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, cpSync } from 'node:fs';
import { join, resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const srcDir = join(repoRoot, 'src');
const outDir = join(repoRoot, 'docs', '演示');
const workDir = join(tmpdir(), 'dsh_calc_cdp');
const profileDir = join(tmpdir(), 'dsh_calc_cdp_profile');

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

/** 12 张截图的定义 */
const SHOTS = [
  { n: '01', name: '初始界面', expr: '' },
  { n: '02', name: '加法', expr: '12+8', armed: '+' },
  { n: '03', name: '减法', expr: '9-4', armed: '-' },
  { n: '04', name: '乘法', expr: '5*8', armed: '*' },
  { n: '05', name: '除法', expr: '10/2', armed: '/' },
  { n: '06', name: '小数计算', expr: '3.5+1.25', armed: '+' },
  { n: '07', name: '复合表达式', expr: '1+2*3', armed: '*' },
  { n: '08', name: '括号', expr: '(1+2)*3', armed: '*' },
  { n: '09', name: '一元正负号', expr: '3*-2' },
  { n: '10', name: '按键按下与高亮', expr: '12+8', armed: '+', pressed: '+' },
  { n: '11', name: '非法表达式提示', expr: '1+2*', error: 'INVALID_EXPRESSION' },
  { n: '12', name: '除零错误提示', expr: '10/0', error: 'DIVISION_BY_ZERO' },
];

// ---------------------------------------------------------------- 准备临时副本
if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
cpSync(srcDir, workDir, { recursive: true });
mkdirSync(outDir, { recursive: true });
if (existsSync(profileDir)) rmSync(profileDir, { recursive: true, force: true });

// 场景脚本放进临时副本的 tools/ 下（页面通过 tools/shot-seed.js 引用）
mkdirSync(join(workDir, 'tools'), { recursive: true });
cpSync(join(here, 'shot-seed.js'), join(workDir, 'tools', 'shot-seed.js'));

// 关掉光标闪烁：无限动画会让截图停在不确定的一帧
const cssPath = join(workDir, 'css', 'style.css');
writeFileSync(
  cssPath,
  readFileSync(cssPath, 'utf8').replace('animation: caret-blink 1.1s steps(1) infinite;', 'animation: none;'),
  'utf8',
);

const baseHtml = readFileSync(join(srcDir, 'index.html'), 'utf8');

/**
 * 为某一张截图生成 HTML。
 *
 * 两个要点：
 *  ① 每张图写**独立文件名**（shot-01.html、shot-02.html…）。
 *     一开始所有图共用一个 html，结果第 2 张开始浏览器直接用缓存，
 *     页面根本没重新加载，截到的还是上一张的状态。
 *  ② 页面本身加载的是传统脚本 js/bundle.js（见 tools/build-bundle.mjs），
 *     再追加场景脚本 tools/shot-seed.js（同样是传统脚本，通过 window.__calc 设置状态）。
 */
function htmlFor(shot) {
  const pairs = new URLSearchParams();
  if (shot.expr) pairs.set('expr', shot.expr);
  if (shot.armed) pairs.set('armed', shot.armed);
  if (shot.pressed) pairs.set('pressed', shot.pressed);
  if (shot.error) pairs.set('error', shot.error);

  const injected = `<script>
window.__shotErrors = [];
window.addEventListener('error', (e) => window.__shotErrors.push('ERR:' + (e.message || e.type)), true);
</script>
<script src="tools/shot-seed.js"></script>
</body>`;

  return baseHtml
    .replace('<body>', `<body data-shot="${pairs.toString().replace(/&/g, '&amp;')}">`)
    .replace('</body>', injected);
}

// ---------------------------------------------------------------- 本地静态服务
// 用本地 HTTP 服务托管临时副本（而不是 file://）：便于按需改写 data-shot 属性。
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const SITE_PORT = 8123;
const server = createServer((req, res) => {
  const rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '');
  const file = join(workDir, rel);
  if (!file.startsWith(workDir) || !existsSync(file)) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((ok) => server.listen(SITE_PORT, '127.0.0.1', ok));

// ---------------------------------------------------------------- 启动 Chrome
const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chromePath) throw new Error('找不到 Chrome 或 Edge');

const PORT = 9333;
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profileDir}`,
    '--window-size=620,830',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

/** 等 CDP 端口可用 */
async function waitForChrome(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return await res.json();
    } catch {
      // 还没起来
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Chrome 远程调试端口没有就绪');
}

/** 极简 CDP 客户端 */
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      const slot = this.pending.get(msg.id);
      if (!slot) return;
      this.pending.delete(msg.id);
      if (msg.error) slot.reject(new Error(msg.error.message));
      else slot.resolve(msg.result);
    });
  }

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((ok, bad) => {
      ws.addEventListener('open', ok, { once: true });
      ws.addEventListener('error', () => bad(new Error('WebSocket 连接失败')), { once: true });
    });
    return new Cdp(ws);
  }

  send(method, params = {}) {
    this.id += 1;
    const id = this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** 在页面里执行表达式并取回结果 */
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      throw new Error('页面脚本报错：' + (r.exceptionDetails.exception?.description || ''));
    }
    return r.result.value;
  }
}

/** 界面显示用的文本（与 ui.js 的 toDisplayText 一致：* → ×，/ → ÷，- → −） */
function displayText(expr) {
  return expr.replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '−');
}

/** 单张截图的等待上限 */
const READY_TIMEOUT_MS = 8000;

// ---------------------------------------------------------------- 主流程
try {
  const version = await waitForChrome();
  let made = 0;

  for (const shot of SHOTS) {
    const shotHtmlName = `shot-${shot.n}.html`;
    writeFileSync(join(workDir, shotHtmlName), htmlFor(shot), 'utf8');
    const url = `http://127.0.0.1:${SITE_PORT}/${shotHtmlName}`;
    const expected = displayText(shot.expr);

    // 每张图开一个**全新的标签页**并直接导航到目标地址。
    // 不能复用同一个 tab 反复 Page.navigate：file:// 页面之间的导航会让
    // 之前的执行上下文失效，第二张开始就再也读不到页面内容了。
    const target = await (
      await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
    ).json();
    const cdp = await Cdp.connect(target.webSocketDebuggerUrl);

    try {
      await cdp.send('Page.enable');
      await cdp.send('Runtime.enable');
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 620,
        height: 830,
        deviceScaleFactor: 1.5,
        mobile: false,
      });

      // 判定"可以拍了"的依据是**页面真的渲染出了目标内容**，而不是固定延时。
      // 这样才能保证截到的图一定是对的；不满足就直接报错，宁可失败也不出假图。
      const deadline = Date.now() + READY_TIMEOUT_MS;
      let ready = false;
      while (Date.now() < deadline) {
        try {
          ready = await cdp.evaluate(`(() => {
            const el = document.getElementById('expression');
            if (!el) return false;
            const shown = (el.textContent || '').replace(/\\u200b/g, '');
            const check = document.getElementById('message');
            const errOk = ${shot.error ? 'true' : 'false'} === (check ? check.classList.contains('is-error') : false);
            return shown === ${JSON.stringify(expected)} && errOk;
          })()`);
          if (ready) break;
        } catch {
          // 页面还在加载，继续重试
        }
        await new Promise((r) => setTimeout(r, 60));
      }
      if (!ready) {
        const dump = await cdp.evaluate(`JSON.stringify({
          url: location.href,
          bodyShot: document.body ? document.body.dataset.shot : '(无 body)',
          seedTrace: document.body ? document.body.dataset.seed : '(未设置 → 场景脚本没执行)',
          shownExpr: (document.getElementById('expression') || {}).textContent,
          hasBridge: typeof window.__calc,
          errs: window.__shotErrors || [],
        })`);
        throw new Error(
          `第 ${shot.n} 张「${shot.name}」未渲染出预期内容：期望 ${JSON.stringify(expected)}\n页面现场：${dump}`,
        );
      }
      // 再留一帧给绘制
      await new Promise((r) => setTimeout(r, 150));

      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const out = join(outDir, `${shot.n}_${shot.name}.png`);
      writeFileSync(out, Buffer.from(data, 'base64'));
      made += 1;
      console.log(`  ${String(made).padStart(2)}/12  ${shot.name.padEnd(12)} -> ${shot.n}_${shot.name}.png`);
    } finally {
      await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => {});
      cdp.ws.close();
    }
  }

  console.log(`\n完成：${made}/12 张（浏览器：${version.Browser}）`);
  console.log(`输出目录：${outDir}`);
} finally {
  chrome.kill();
  server.close();
  await new Promise((r) => setTimeout(r, 300));
  rmSync(workDir, { recursive: true, force: true });
  rmSync(profileDir, { recursive: true, force: true });
}
