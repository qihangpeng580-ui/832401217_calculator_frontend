/**
 * 截图脚本（Chromium DevTools Protocol 直连，零依赖）
 *
 * 运行：node tools/capture-screens.mjs
 *
 * ----------------------------------------------------------------
 * 这一版和上一版的区别：接上了真实后端
 * ----------------------------------------------------------------
 *
 * 上一版是"前端阶段"的截图：按 = 只会显示"后端未接通"，
 * 历史区是空占位，错误提示用演示数据摆出来。
 *
 * 现在后端已经完成，所以这一版：
 *   1. 自己起一个真实的 Python 后端（临时数据库）
 *   2. 页面真的调用后端，结果显示后端算出的值
 *   3. 历史列表是后端数据库里的真实记录
 *   4. 错误提示来自后端的真实错误响应（INVALID_EXPRESSION / DIVISION_BY_ZERO）
 *
 * 于是截图里的每一处内容都可以在真实使用中复现 ——
 * 不存在"为了好看而摆出来的效果"。
 *
 * ----------------------------------------------------------------
 * 为什么不用 `chrome --headless --screenshot`
 * ----------------------------------------------------------------
 * 那个方式在截图时不等页面脚本执行完，实测 12 张图全是空表达式。
 * 换成 CDP 之后可以自己控制节奏：等页面渲染出目标内容再截图。
 */

import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, cpSync, mkdtempSync } from 'node:fs';
import { join, resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const srcDir = join(repoRoot, 'src');
const outDir = join(repoRoot, 'docs', '演示');
const backendRoot = resolve(repoRoot, '..', '832401217_calculator_backend');

const workDir = mkdtempSync(join(tmpdir(), 'dsh-calc-shots-'));
const profileDir = join(workDir, 'chrome-profile');

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

const SITE_PORT = 8123;
const CDP_PORT = 9333;
const BACKEND_PORT = 8792;

/**
 * 把"内部 ASCII 表达式"转成"界面显示形式"。
 *
 * ★ 为什么需要这个函数（踩过两次的坑）：
 *   界面做了"表里分离"——内部存 ASCII 的 * / -，
 *   渲染时替换成 × ÷ −（减号是 U+2212，不是 ASCII 的连字符）。
 *   这两个减号在等宽字体下几乎看不出区别，但字符编码不同，断言必然失败。
 *
 *   第一次是 03 号图期望写成 "9-4"，实际显示 "9−4"；
 *   第二次是 09 号图期望写成 "3×(-2)"，实际显示 "3×(−2)"。
 *   与其逐个人工核对，不如在这里统一转换：
 *   写期望值时只用 ASCII，脚本自动转成显示形式。
 *
 * @param {string} text
 * @returns {string}
 */
function toDisplayText(text) {
  return String(text).replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '−');
}

/**
 * 12 张截图的定义。
 *
 * keys      按顺序点击的按键（NEG 表示 ± 键）
 * submit    是否按 = 触发后端计算
 * prefill   是否先算几道题把历史填起来
 * armed     最后让哪个运算符键保持高亮
 * pressed   让哪个键显示"按下"状态
 * expect    期望在界面上看到的表达式。**用 ASCII 写**（如 "3*(-2)"），
 *           脚本会用 toDisplayText 自动转成界面形式再比对。
 * expectResult 期望的结果行内容（可选）
 */
const SHOTS = [
  { n: '01', name: '初始界面', keys: [], expect: '' },
  { n: '02', name: '加法', keys: ['1', '2', '+', '8'], submit: true, expect: '12+8', expectResult: '20' },
  { n: '03', name: '减法', keys: ['9', '-', '4'], submit: true, expect: '9-4', expectResult: '5' },
  { n: '04', name: '乘法', keys: ['5', '*', '8'], submit: true, expect: '5*8', expectResult: '40' },
  { n: '05', name: '除法', keys: ['1', '0', '/', '2'], submit: true, expect: '10/2', expectResult: '5' },
  { n: '06', name: '小数计算', keys: ['3', '.', '5', '+', '1', '.', '2', '5'], submit: true, expect: '3.5+1.25', expectResult: '4.75' },
  { n: '07', name: '复合表达式', keys: ['1', '+', '2', '*', '3'], submit: true, expect: '1+2*3', expectResult: '7' },
  { n: '08', name: '括号', keys: ['(', '1', '+', '2', ')', '*', '3'], submit: true, expect: '(1+2)*3', expectResult: '9' },
  { n: '09', name: '一元正负号', keys: ['3', '*', '2', 'NEG'], submit: true, expect: '3*(-2)', expectResult: '-6' },
  // 第 10 张演示"按下/生效"两种视觉反馈。
  // ★ 期望值是 "12+8+" 而不是 "12+8"：
  //   armed 的实现是**再真的点一次那个运算符键**（而不是直接设状态），
  //   所以表达式末尾会多一个 +，而它正好就是"当前生效的运算符"。
  //   这也更贴合这张图要说明的事：末尾的 + 保持高亮。
  { n: '10', name: '按键按下与高亮', keys: ['1', '2', '+', '8'], armed: '+', pressed: '+', expect: '12+8+' },
  { n: '11', name: '非法表达式提示', keys: ['1', '+', '2', '*'], submit: true, expect: '1+2*' },
  { n: '12', name: '除零错误提示', keys: ['1', '0', '/', '0'], submit: true, expect: '10/0' },
  // 第 13 张：历史记录已有内容的样子（后端数据库里的真实数据）
  { n: '13', name: '历史记录', keys: [], prefill: true, expect: '' },
];

// ---------------------------------------------------------------- 准备目录
mkdirSync(outDir, { recursive: true });

// 把 src 复制一份到临时目录（避免改动仓库里的源文件）
const siteDir = join(workDir, 'site');
cpSync(srcDir, siteDir, { recursive: true });

// 场景脚本放进临时副本的 tools/ 下（页面通过 tools/shot-seed.js 引用）
mkdirSync(join(siteDir, 'tools'), { recursive: true });
cpSync(join(here, 'shot-seed.js'), join(siteDir, 'tools', 'shot-seed.js'));

// 关掉光标闪烁：无限动画会让截图停在不确定的一帧
const cssPath = join(siteDir, 'css', 'style.css');
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
 *  ② 页面加载的是传统脚本 js/bundle.js，场景脚本 tools/shot-seed.js
 *     同样用传统脚本，通过 window.__calc 与真实点击来设置状态。
 */
function htmlFor(shot) {
  const pairs = new URLSearchParams();
  if (shot.keys && shot.keys.length > 0) pairs.set('keys', shot.keys.join(','));
  if (shot.submit) pairs.set('submit', '1');
  if (shot.prefill) pairs.set('prefill', '1');
  if (shot.armed) pairs.set('armed', shot.armed);
  if (shot.pressed) pairs.set('pressed', shot.pressed);

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

// ---------------------------------------------------------------- 静态服务
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const server = createServer((req, res) => {
  const rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '');
  const file = join(siteDir, rel);
  if (!file.startsWith(siteDir) || !existsSync(file)) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((ok) => server.listen(SITE_PORT, '127.0.0.1', ok));

// ---------------------------------------------------------------- 启动后端
const dbPath = join(workDir, 'shots.db');
let backend = null;

async function startBackend() {
  if (!existsSync(join(backendRoot, 'run.py'))) {
    console.log('（没找到后端目录，本次截图将不连后端）');
    return false;
  }

  backend = spawn('py', ['-3.12', 'run.py', '--port', String(BACKEND_PORT), '--db', dbPath], {
    cwd: backendRoot,
    stdio: 'ignore',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });

  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${BACKEND_PORT}/api/health`);
      if (res.ok) return true;
    } catch {
      // 还没起来
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

// ---------------------------------------------------------------- 让前端指向本次后端
//
// ★ 这里有个很容易踩的坑：
//   页面加载的是 **bundle.js**，而后端地址是在**打包时**被内联进 bundle 的
//   （build-bundle.mjs 把 config.js 的源码复制进产物，`export` 只是被去掉）。
//   所以只改 config.js 是没用的 —— 必须**重新打包**。
//   第一次跑就栽在这里：页面里显示的提示是"无法连接后端服务"，
//   因为 bundle 里还写着默认的 8000 端口。
const originalConfig = readFileSync(join(siteDir, 'js', 'config.js'), 'utf8');
const patchedConfig = originalConfig.replace(
  /export const API_BASE_URL = '[^']*';/,
  `export const API_BASE_URL = 'http://127.0.0.1:${BACKEND_PORT}';`,
);
if (patchedConfig === originalConfig) {
  throw new Error('没能改写 config.js 里的 API_BASE_URL —— 请检查该文件的写法是否变了');
}
writeFileSync(join(siteDir, 'js', 'config.js'), patchedConfig, 'utf8');

// 用打包器把临时副本重新打一遍。
//
// 用 --js-dir 直接指向副本的 js 目录，产物也写回那里。
// （一开始想让副本伪造出 "根/src/js" 的目录结构来迁就打包器的固定路径，
//   结果路径算错两次，还起了个多余的 src 目录。加个参数干净得多。）
function rebuildBundle() {
  const result = spawnSync(
    process.execPath,
    [join(here, 'build-bundle.mjs'), '--js-dir', join(siteDir, 'js')],
    { cwd: siteDir, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error('重新打包失败：' + (result.stderr || result.stdout || ''));
  }
}

rebuildBundle();

// ---------------------------------------------------------------- CDP 客户端
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

  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      throw new Error('页面脚本报错：' + (r.exceptionDetails.exception?.description || ''));
    }
    return r.result.value;
  }
}

// ---------------------------------------------------------------- 主流程
const READY_TIMEOUT_MS = 25000;
let chrome = null;
let made = 0;

try {
  console.log('='.repeat(62));
  console.log('生成演示截图（真实后端 + 真实点击）');
  console.log('='.repeat(62));

  const backendUp = await startBackend();
  console.log(`后端：${backendUp ? `已启动（端口 ${BACKEND_PORT}，临时数据库）` : '未启动'}`);

  const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!chromePath) throw new Error('找不到 Chrome 或 Edge');

  chrome = spawn(
    chromePath,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profileDir}`,
      '--window-size=1180,900',
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  const cdpDeadline = Date.now() + 25000;
  let version = { Browser: '未知' };
  while (Date.now() < cdpDeadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      if (res.ok) {
        version = await res.json();
        break;
      }
    } catch {
      // 还没起来
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  console.log(`浏览器：${version.Browser}`);
  console.log();

  for (const shot of SHOTS) {
    const shotHtmlName = `shot-${shot.n}.html`;
    writeFileSync(join(siteDir, shotHtmlName), htmlFor(shot), 'utf8');
    const url = `http://127.0.0.1:${SITE_PORT}/${shotHtmlName}`;

    // 每张图开一个**全新的标签页**：复用同一个 tab 反复导航会让
    // 之前的执行上下文失效，第二张开始就读不到页面内容了。
    const target = await (
      await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
    ).json();
    const cdp = await Cdp.connect(target.webSocketDebuggerUrl);

    try {
      await cdp.send('Page.enable');
      await cdp.send('Runtime.enable');
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1180,
        height: 900,
        deviceScaleFactor: 1.5,
        mobile: false,
      });

      // 判定"可以拍了"的依据是**页面真的到位了**，而不是固定延时。
      //
      // ★ 这里踩过一个坑：
      //   一开始写成"只要 __shotReady 为真就跳出循环"，然后**在循环外**
      //   再检查表达式和结果对不对。结果是：__shotReady 在场景脚本跑完时就设上了，
      //   而那时按 = 的请求还没回来（结果行还是 "—"），于是每一张都判失败。
      //   正确做法是把**全部条件**都并进循环的判定里，让它继续轮询直到都满足。
      const deadline = Date.now() + READY_TIMEOUT_MS;
      let ready = false;
      let lastDump = '';
      let lastReason = '超时';

      while (Date.now() < deadline) {
        let probe = null;
        try {
          probe = await cdp.evaluate(`(() => {
            const el = document.getElementById('expression');
            if (!el) return { ready: false, reason: '页面里没有表达式元素' };
            const shown = (el.textContent || '').replace(/\\u200b/g, '');
            const resultText = (document.getElementById('result') || {}).textContent || '';
            const messageText = (document.getElementById('message') || {}).textContent || '';
            return {
              ready: window.__shotReady === true,
              seed: document.body ? document.body.dataset.seed : '',
              shown,
              resultText,
              messageText,
              historyCount: document.querySelectorAll('#history-list li').length,
            };
          })()`);
        } catch {
          await new Promise((r) => setTimeout(r, 80));
          continue; // 页面还在加载
        }

        lastDump = JSON.stringify(probe);

        // 全部条件一起判断，任何一条不满足就继续等
        if (probe.ready !== true) {
          lastReason = '场景脚本还没跑完（__shotReady 未置位）';
        } else if (probe.shown !== toDisplayText(shot.expect)) {
          lastReason = `表达式不符：期望 ${JSON.stringify(toDisplayText(shot.expect))}，实际 ${JSON.stringify(probe.shown)}`;
        } else if (shot.expectResult !== undefined && probe.resultText !== shot.expectResult) {
          lastReason = `结果不符：期望 ${JSON.stringify(shot.expectResult)}，实际 ${JSON.stringify(probe.resultText)}`;
        } else if (typeof shot.expectMessage === 'string' && !probe.messageText.includes(shot.expectMessage)) {
          lastReason = `提示不符：期望包含 ${JSON.stringify(shot.expectMessage)}，实际 ${JSON.stringify(probe.messageText)}`;
        } else if (shot.expectError === true && !probe.messageText) {
          lastReason = '期望有错误提示，但提示条是空的';
        } else if (shot.prefill === true && probe.historyCount < 3) {
          lastReason = `历史记录不足：期望至少 3 条，实际 ${probe.historyCount}`;
        } else {
          ready = true;
          break;
        }

        await new Promise((r) => setTimeout(r, 80));
      }

      if (!ready) {
        const errors = await cdp.evaluate('JSON.stringify(window.__shotErrors || [])').catch(() => '[]');
        throw new Error(
          `第 ${shot.n} 张「${shot.name}」未渲染出预期内容\n  原因：${lastReason}\n  现场：${lastDump}\n  页面错误：${errors}`,
        );
      }

      // 再留一帧给绘制
      await new Promise((r) => setTimeout(r, 220));

      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const out = join(outDir, `${shot.n}_${shot.name}.png`);
      writeFileSync(out, Buffer.from(data, 'base64'));
      made += 1;
      console.log(`  ${String(made).padStart(2)}/${SHOTS.length}  ${shot.name.padEnd(14)} -> ${shot.n}_${shot.name}.png`);
    } finally {
      await fetch(`http://127.0.0.1:${CDP_PORT}/json/close/${target.id}`).catch(() => {});
      cdp.ws.close();
    }
  }

  console.log();
  console.log(`完成：${made}/${SHOTS.length} 张`);
  console.log(`输出目录：${outDir}`);
} finally {
  if (chrome) chrome.kill();
  if (backend && !backend.killed) backend.kill();
  server.close();
  await new Promise((r) => setTimeout(r, 400));
  rmSync(workDir, { recursive: true, force: true });
}
