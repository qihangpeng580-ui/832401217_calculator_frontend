/**
 * 验证**已部署的公网页面**真的能交互（真实鼠标点击）。
 *
 * 运行：
 *   node tools/verify-deployed.mjs
 *   node tools/verify-deployed.mjs https://example.com/
 *
 * ----------------------------------------------------------------
 * 为什么必须做这件事
 * ----------------------------------------------------------------
 *
 * "文件能下载"和"页面能用"是两件事。这个项目吃过一次大亏：
 * 所有自动化测试都走本地 HTTP，49 项断言 + 37 项点击全绿，
 * 但用户双击 file:// 打开时，浏览器**拒绝加载 ES 模块**，
 * 于是整个页面点了没有任何反应 —— 而页面看起来完全正常。
 *
 * 所以部署之后，必须用**真实浏览器**打开**真实公网地址**，
 * 真的点几下，确认交互代码确实跑起来了。
 *
 * 这个脚本检查三件事：
 *   ① 交互代码是否启动（这是当年出问题的那一项）
 *   ② 点击按钮后表达式是否真的变化
 *   ③ 按 = 是否**不产生结果**（作业的硬性要求：结果必须由后端产生）
 */

import { spawn } from 'node:child_process';
import { existsSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const URL_TO_TEST = process.argv[2] || 'https://qihangpeng580-ui.github.io/832401217_calculator_frontend/';
const PORT = 9336;

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

let passed = 0;
const failures = [];

function check(name, actual, expected) {
  if (actual === expected) {
    passed += 1;
    console.log(`  OK   ${name}`);
  } else {
    failures.push(`${name}  期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
    console.log(`  FAIL ${name}  期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
  }
}

function checkTruthy(name, actual) {
  if (actual) {
    passed += 1;
    console.log(`  OK   ${name}  (${JSON.stringify(actual)})`);
  } else {
    failures.push(`${name}  期望非空，实际 ${JSON.stringify(actual)}`);
    console.log(`  FAIL ${name}  期望非空，实际 ${JSON.stringify(actual)}`);
  }
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

  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      throw new Error('页面脚本报错：' + (r.exceptionDetails.exception?.description || ''));
    }
    return r.result.value;
  }
}

async function waitFor(ws, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${ws}/json/version`);
      if (res.ok) return true;
    } catch {
      // 还没起来
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chromePath) {
  console.error('找不到 Chrome 或 Edge，无法验证');
  process.exit(2);
}

const profileDir = mkdtempSync(join(tmpdir(), 'dsh-verify-deployed-'));

const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profileDir}`,
    '--window-size=620,900',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

try {
  console.log('='.repeat(62));
  console.log('验证已部署的公网页面（真实浏览器 + 真实鼠标点击）');
  console.log('='.repeat(62));
  console.log(`地址：${URL_TO_TEST}`);
  console.log();

  if (!(await waitFor(PORT))) throw new Error('浏览器调试端口没起来');

  const target = await (
    await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(URL_TO_TEST)}`, { method: 'PUT' })
  ).json();
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);

  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    // 等页面加载完成
    let loaded = false;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      try {
        loaded = await cdp.evaluate('document.readyState === "complete" && !!document.getElementById("keys")');
        if (loaded) break;
      } catch {
        // 还在加载
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    check('页面加载完成', loaded, true);

    console.log('\n[1] 页面基本信息');
    checkTruthy('页面标题非空', await cdp.evaluate('document.title'));
    check('URL 正确', (await cdp.evaluate('location.href')).replace(/\/$/, ''), URL_TO_TEST.replace(/\/$/, ''));

    console.log('\n[2] ★ 交互代码是否启动（当年出问题的那一项）');
    // 事件委托没挂上时，keys 容器的 tabIndex 不会是 -1
    check('键盘区容器已获得焦点能力（tabIndex=-1）', await cdp.evaluate('document.getElementById("keys").tabIndex'), -1);
    checkTruthy('bundle.js 已加载（暴露了 __calc）', await cdp.evaluate('typeof window.__calc'));
    check('首屏表达式为空', await cdp.evaluate('(document.getElementById("expression").textContent || "").replace(/\\u200b/g, "")'), '');

    console.log('\n[3] 真实鼠标点击 1 + 2');
    for (const key of ['1', '+', '2']) {
      const box = await cdp.evaluate(`(() => {
        const el = document.querySelector('[data-key="${key}"]');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()`);
      checkTruthy(`找到按键 ${key}`, box);
      if (!box) continue;
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
      await new Promise((r) => setTimeout(r, 80));
    }

    check(
      '点击 1+2 后表达式显示为 1+2',
      await cdp.evaluate('(document.getElementById("expression").textContent || "").replace(/\\u200b/g, "")'),
      '1+2',
    );

    console.log('\n[4] ★ 按 = 不得产生结果（结果必须由后端算）');
    await cdp.evaluate('document.querySelector(\'[data-key="="]\').click()');
    await new Promise((r) => setTimeout(r, 150));
    const resultText = await cdp.evaluate('document.getElementById("result").textContent');
    check('结果行仍是占位提示（前端没有算）', resultText, '后端未接通');
    check(
      '提示条说明后端未接通',
      await cdp.evaluate('document.getElementById("message").textContent'),
      '后端未接通，本阶段不产生结果',
    );

    console.log('\n[5] 无脚本错误');
    check('页面没有 JavaScript 报错', await cdp.evaluate('window.__deployErrors ? window.__deployErrors.length : 0'), 0);

    console.log('\n[6] 表情/图片资源加载成功');
    checkTruthy(
      '奶龙图片已加载',
      await cdp.evaluate(
        'Array.from(document.images).every(img => img.complete && img.naturalWidth > 0)',
      ),
    );
    check('图片数量', await cdp.evaluate('document.images.length'), 2);
  } finally {
    await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => {});
    cdp.ws.close();
  }
} catch (error) {
  failures.push(`执行出错：${error.message}`);
  console.log(`\n执行出错：${error.message}`);
} finally {
  chrome.kill();
  await new Promise((r) => setTimeout(r, 300));
  rmSync(profileDir, { recursive: true, force: true });
}

const total = passed + failures.length;
console.log('\n' + '='.repeat(62));
if (failures.length === 0) {
  console.log(`公网页面验证全部通过：${passed}/${total}`);
  console.log('='.repeat(62));
  process.exit(0);
} else {
  console.log(`验证失败 ${failures.length} 项（共 ${total}）：`);
  for (const item of failures) console.log('  ✗ ' + item);
  console.log('='.repeat(62));
  process.exit(1);
}
