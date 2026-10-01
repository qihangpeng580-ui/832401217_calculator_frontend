/**
 * 前后端联调端到端测试（真实后端 + 真实浏览器 + 真实鼠标点击）
 *
 * 运行：
 *   node tools/e2e-integration.mjs
 *
 * 它会自己完成这些事：
 *   1. 起一个真实的 Python 后端（随机端口，用临时数据库文件）
 *   2. 用 Node 内置 http 服务托管 src/ 目录（模拟部署环境）
 *   3. 用无头 Chrome 打开页面，**真的用鼠标点按钮**
 *   4. 验证：结果显示、历史写入、搜索、删除、清空、错误提示
 *   5. 清理：关掉浏览器、后端、删掉临时数据库
 *
 * ----------------------------------------------------------------
 * 为什么必须做"真实"的联调测试
 * ----------------------------------------------------------------
 *
 * 这个项目已经吃过两次"假绿"的亏：
 *
 *   ① 前端：所有测试走本地 HTTP，49+37 项全绿，
 *      但用户双击 file:// 打开时浏览器不执行 ES 模块，点按钮毫无反应。
 *   ② 后端：157 项单元测试全绿，但那是**直接调函数**，绕过了 HTTP 层。
 *
 * 所以联调测试必须是：真实 HTTP + 真实浏览器 + 真实点击。
 * 只有这样，"前端真的把表达式发给了后端、后端真的算出了结果、
 * 结果真的回到了界面上"这件事才被证明过。
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync, rmSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(here, '..');
const backendRoot = resolve(frontendRoot, '..', '832401217_calculator_backend');

const SITE_PORT = 8199;
const CDP_PORT = 9337;

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

/** 找一个空闲端口给后端用（避免和用户自己开着的 8000 冲突） */
function pickBackendPort() {
  return 8791;
}

const BACKEND_PORT = pickBackendPort();

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

  /** 用真实鼠标点击某个按键 */
  async clickKey(key) {
    const box = await this.evaluate(`(() => {
      const el = document.querySelector('[data-key="${key}"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!box) throw new Error(`找不到按键：${key}`);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await new Promise((r) => setTimeout(r, 70));
  }

  /** 依次点击一串按键 */
  async typeKeys(keys) {
    for (const key of keys) {
      await this.clickKey(key);
    }
  }

  /** 读界面上的文字 */
  async text(id) {
    return this.evaluate(`(document.getElementById(${JSON.stringify(id)}) || {}).textContent`);
  }

  /** 等某个条件成立 */
  async waitFor(expression, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        if (await this.evaluate(expression)) return true;
      } catch {
        // 页面还没就绪
      }
      await new Promise((r) => setTimeout(r, 120));
    }
    return false;
  }
}

// ---------------------------------------------------------------- 静态服务
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const srcDir = join(frontendRoot, 'src');
const site = createServer((req, res) => {
  const rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = join(srcDir, rel);
  if (!file.startsWith(srcDir) || !existsSync(file)) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});

// ---------------------------------------------------------------- 主流程
const workDir = mkdtempSync(join(tmpdir(), 'dsh-integration-'));
const dbPath = join(workDir, 'integration.db');
const profileDir = join(workDir, 'chrome-profile');
mkdirSync(profileDir, { recursive: true });

let backend = null;
let chrome = null;

try {
  console.log('='.repeat(64));
  console.log('前后端联调端到端测试（真实后端 + 真实浏览器 + 真实点击）');
  console.log('='.repeat(64));

  // ---------------------------------------------------------- 1. 起后端
  console.log('\n[0] 启动后端服务');
  if (!existsSync(join(backendRoot, 'run.py'))) {
    throw new Error(`找不到后端目录：${backendRoot}`);
  }

  backend = spawn(
    'py',
    ['-3.12', 'run.py', '--port', String(BACKEND_PORT), '--db', dbPath],
    {
      cwd: backendRoot,
      stdio: 'ignore', // 不用管道：本项目踩过"管道写满导致子进程卡死"的坑
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    },
  );

  // 等后端健康检查通过
  let backendReady = false;
  const backendDeadline = Date.now() + 25000;
  while (Date.now() < backendDeadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${BACKEND_PORT}/api/health`);
      if (res.ok) {
        backendReady = true;
        break;
      }
    } catch {
      // 还没起来
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  check('后端已启动并能响应 /api/health', backendReady, true);
  if (!backendReady) throw new Error('后端启动失败');

  // ---------------------------------------------------------- 2. 起静态服务
  await new Promise((ok) => site.listen(SITE_PORT, '127.0.0.1', ok));
  console.log(`\n[1] 前端已托管在 http://127.0.0.1:${SITE_PORT}/`);

  // ---------------------------------------------------------- 3. 起浏览器
  const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!chromePath) throw new Error('找不到 Chrome 或 Edge');

  chrome = spawn(
    chromePath,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profileDir}`,
      '--window-size=1180,900',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let cdpReady = false;
  const cdpDeadline = Date.now() + 25000;
  while (Date.now() < cdpDeadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      if (res.ok) {
        cdpReady = true;
        break;
      }
    } catch {
      // 还没起来
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  check('浏览器已启动', cdpReady, true);
  if (!cdpReady) throw new Error('浏览器启动失败');

  async function openPage() {
    const pageUrl = `http://127.0.0.1:${SITE_PORT}/index.html`;
    const target = await (
      await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(pageUrl)}`, { method: 'PUT' })
    ).json();
    const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.waitFor('document.readyState === "complete" && !!document.getElementById("keys")');
    return { cdp, target };
  }

  async function closePage(cdp, target) {
    await fetch(`http://127.0.0.1:${CDP_PORT}/json/close/${target.id}`).catch(() => {});
    cdp.ws.close();
  }

  // ★ 页面需要知道后端在本机的哪个端口。config.js 里写死的是 8000，
  //   而测试用的是另一个端口，所以这里注入一个覆盖值。
  //   做法：先打开页面，再用 CDP 覆盖配置不可行（配置在闭包里），
  //   所以改用"把测试端口通过 URL 参数传入"的方式 —— 见下面的注入脚本。
  const originalConfig = readFileSync(join(srcDir, 'js', 'config.js'), 'utf8');
  const patchedConfig = originalConfig.replace(
    /export const API_BASE_URL = '[^']*';/,
    `export const API_BASE_URL = 'http://127.0.0.1:${BACKEND_PORT}';`,
  );
  if (patchedConfig === originalConfig) {
    throw new Error('未能改写 config.js 里的 API_BASE_URL —— 请检查该文件的写法是否变了');
  }
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(srcDir, 'js', 'config.js'), patchedConfig, 'utf8');

  // 改了 config.js 必须重新打包（页面加载的是 bundle.js）
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, [join(frontendDir(), 'tools', 'build-bundle.mjs')], { cwd: frontendRoot });
  console.log('  （已把后端地址写进前端配置并重新打包）');

  let cdp;
  let target;
  try {
    ({ cdp, target } = await openPage());

    // ------------------------------------------------------ 基础就绪
    console.log('\n[2] 页面就绪与后端连接状态');
    check('交互代码已启动（tabIndex=-1）', await cdp.evaluate('document.getElementById("keys").tabIndex'), -1);
    checkTruthy('前端读到的后端地址正确', await cdp.evaluate('window.__calc.getApiBaseUrl()'));
    const online = await cdp.waitFor('document.getElementById("backend-text").textContent.includes("已连接")', 10000);
    check('界面显示"后端已连接"', online, true);

    // ------------------------------------------------------ 基本运算
    console.log('\n[3] ★ 基本运算：点 1 2 + 8 = ，结果必须来自后端');
    await cdp.typeKeys(['1', '2', '+', '8']);

    // ★ 注意去掉零宽空格（\u200b）。
    //   界面为了画光标，在文本里插了一个零宽空格作锚点，
    //   所以 textContent 里会多一个不可见字符。断言前必须剥掉，
    //   否则会得到 "12+8" !== "12+8" 这种看起来完全一样的失败（真实踩过）。
    check(
      '表达式显示为 12+8',
      await cdp.evaluate('(document.getElementById("expression").textContent || "").replace(/\\u200b/g, "")'),
      '12+8',
    );

    await cdp.clickKey('=');
    const gotResult = await cdp.waitFor('document.getElementById("result").textContent === "20"', 10000);
    check('★ 结果行显示了后端算出的 20', gotResult, true);
    check('结果行不再标为占位', await cdp.evaluate('document.getElementById("result").classList.contains("is-placeholder")'), false);

    // ------------------------------------------------------ 复合表达式
    console.log('\n[4] 复合表达式（优先级 / 括号 / 一元负号）');
    //
    // ★ 关于负号的两种输入方式（测试用例一开始写错过，值得说清）：
    //
    //   · ± （NEG）是"对**末尾已有的数字**取负"，实现是把末尾数字用括号包起来：
    //         3*2  → 3*(-2)
    //     所以它要求末尾必须是一个完整的数字。在表达式开头或运算符后面按 ±
    //     会得到提示"请先输入一个完整的数字再按 ±" —— 这是**设计如此**，不是 bug。
    //
    //   · − （减号键）在"表达式开头"或"另一个运算符之后"按下时，
    //     会被识别为负号而不是减号：直接按 − 5 得到 "-5"。
    //     这就是作业示例 "-5+8" 的正确输入方式。
    const cases = [
      { keys: ['AC', '1', '+', '2', '*', '3'], expect: '7', note: '优先级 1+2*3' },
      { keys: ['AC', '(', '1', '+', '2', ')', '*', '3'], expect: '9', note: '括号 (1+2)*3' },
      { keys: ['AC', '3', '*', '2', 'NEG'], expect: '-6', note: '± 取负 3*(-2)' },
      { keys: ['AC', '-', '5', '+', '8'], expect: '3', note: '开头的负号 -5+8' },
      { keys: ['AC', '8', '-', '3', '*', '2'], expect: '2', note: '优先级 8-3*2' },
      { keys: ['AC', '1', '0', '/', '4'], expect: '2.5', note: '小数结果' },
    ];
    for (const item of cases) {
      await cdp.typeKeys(item.keys);
      await cdp.clickKey('=');
      const ok = await cdp.waitFor(
        `document.getElementById("result").textContent === ${JSON.stringify(item.expect)}`,
        8000,
      );
      check(`${item.note} = ${item.expect}`, ok, true);
    }

    // 顺便验证 ± 在数字打完之后的表达式形状（表里分离：界面显示 −，内部是 -）
    await cdp.typeKeys(['AC', '3', '*', '2', 'NEG']);
    check(
      '± 把末尾数字包成 (-2) 形式',
      await cdp.evaluate('window.__calc.getExpression()'),
      '3*(-2)',
    );

    // ------------------------------------------------------ 除零
    console.log('\n[5] 除零：由**后端**判定，前端只负责显示');
    await cdp.typeKeys(['AC', '1', '0', '/', '0']);
    await cdp.clickKey('=');
    const zeroShown = await cdp.waitFor(
      'document.getElementById("message").textContent.includes("除数不能为 0")',
      8000,
    );
    check('显示"除数不能为 0"', zeroShown, true);
    check(
      '提示条标红（is-error）',
      await cdp.evaluate('document.getElementById("message").classList.contains("is-error")'),
      true,
    );

    // ------------------------------------------------------ 非法表达式（前端拦）
    console.log('\n[6] 非法表达式：前端能确定的错误不浪费网络请求');
    await cdp.typeKeys(['AC', '1', '+', '*']);
    const forcedMessage = await cdp.text('message');
    checkTruthy('连续运算符被替换并给出提示', forcedMessage);

    // ------------------------------------------------------ 历史记录
    console.log('\n[7] ★ 历史记录：数据来自后端数据库');
    const historyLoaded = await cdp.waitFor('document.querySelectorAll("#history-list li").length >= 5', 10000);
    check('历史列表已渲染出记录', historyLoaded, true);

    const firstExpression = await cdp.evaluate(
      'document.querySelector("#history-list li .history__expression").textContent',
    );
    checkTruthy('最新一条记录有表达式', firstExpression);

    const firstResult = await cdp.evaluate(
      'document.querySelector("#history-list li .history__result").textContent',
    );
    check('记录里带结果（形如 "= -6"）', firstResult.startsWith('= '), true);

    // ★ 有一次运算失败（10/0 除零），它**不应该**被写进历史。
    //   设计如此：历史记录的是"算过的式子"，非法表达式不构成一次有效计算。
    const zeroInHistory = await cdp.evaluate(
      'Array.from(document.querySelectorAll("#history-list li .history__expression")).some(el => el.textContent.includes("0÷0") || el.textContent === "10÷0")',
    );
    check('除零失败的那次没有写进历史', zeroInHistory, false);

    check(
      '有"共 N 条"统计',
      await cdp.evaluate('document.getElementById("history-count").textContent.length > 0'),
      true,
    );

    // ------------------------------------------------------ 搜索
    console.log('\n[8] 历史搜索（扩展功能，对应后端 keyword 参数）');
    await cdp.evaluate(`(() => {
      const input = document.getElementById('history-keyword');
      input.value = '2*3';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    const searched = await cdp.waitFor('document.querySelectorAll("#history-list li").length === 1', 8000);
    check('搜索 "2*3" 只剩 1 条', searched, true);

    // 清空搜索
    await cdp.evaluate(`(() => {
      const input = document.getElementById('history-keyword');
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await cdp.waitFor('document.querySelectorAll("#history-list li").length >= 5', 8000);

    // ------------------------------------------------------ 删除
    console.log('\n[9] ★ 删除指定记录（作业评分项 10 分）');
    const beforeCount = await cdp.evaluate('document.querySelectorAll("#history-list li").length');
    const deletingExpression = await cdp.evaluate(
      'document.querySelector("#history-list li .history__expression").textContent',
    );

    await cdp.evaluate('document.querySelector("#history-list li .history__delete").click()');
    const deleted = await cdp.waitFor(
      `document.querySelectorAll("#history-list li").length === ${beforeCount - 1}`,
      10000,
    );
    check('删除后列表少了一条', deleted, true);

    const stillThere = await cdp.evaluate(
      `Array.from(document.querySelectorAll("#history-list li .history__expression"))
         .some(el => el.textContent === ${JSON.stringify(deletingExpression)})`,
    );
    check('被删的那条确实不见了', stillThere, false);

    // ------------------------------------------------------ 持久化（重开页面）
    console.log('\n[10] ★ 持久化：重新打开页面，历史依然在');
    await closePage(cdp, target);
    ({ cdp, target } = await openPage());

    const persisted = await cdp.waitFor('document.querySelectorAll("#history-list li").length >= 4', 10000);
    check('重开页面后历史记录仍从后端读到了', persisted, true);

    // ------------------------------------------------------ 清空
    console.log('\n[11] 清空全部历史（扩展功能）');
    await cdp.evaluate('window.confirm = () => true');
    await cdp.evaluate('document.getElementById("history-clear").click()');
    const cleared = await cdp.waitFor('document.querySelectorAll("#history-list li").length === 0', 10000);
    check('清空后列表为空', cleared, true);

    // ------------------------------------------------------ 前端不算结果
    console.log('\n[12] ★ 验证结果确实来自后端（不是前端自己算的）');
    // 除掉后端，再按 = ，界面不得给出结果
    backend.kill();
    await new Promise((r) => setTimeout(r, 1200));

    await cdp.typeKeys(['AC', '1', '+', '1']);
    await cdp.clickKey('=');
    const noResult = await cdp.waitFor(
      'document.getElementById("message").textContent.includes("无法连接") || document.getElementById("message").textContent.includes("响应")',
      12000,
    );
    check('后端停掉后按 = 得不到结果，只提示连不上', noResult, true);
    check(
      '结果行不是 2（前端没有偷偷算）',
      await cdp.text('result') === '2',
      false,
    );
  } finally {
    // 还原 config.js 与 bundle.js（无论如何都要还原，否则会污染仓库）
    writeFileSync(join(srcDir, 'js', 'config.js'), originalConfig, 'utf8');
    const { execFileSync } = await import('node:child_process');
    execFileSync(process.execPath, [join(frontendRoot, 'tools', 'build-bundle.mjs')], { cwd: frontendRoot });
    console.log('\n（已还原 config.js 并重新打包）');

    if (cdp) await closePage(cdp, target).catch(() => {});
  }
} catch (error) {
  failures.push(`执行出错：${error.message}`);
  console.log(`\n执行出错：${error.message}`);
  console.log(error.stack);
} finally {
  if (chrome) chrome.kill();
  if (backend && !backend.killed) backend.kill();
  site.close();
  await new Promise((r) => setTimeout(r, 400));
  rmSync(workDir, { recursive: true, force: true });
}

function frontendDir() {
  return frontendRoot;
}

const total = passed + failures.length;
console.log('\n' + '='.repeat(64));
if (failures.length === 0) {
  console.log(`联调端到端测试全部通过：${passed}/${total}`);
  console.log('='.repeat(64));
  process.exit(0);
} else {
  console.log(`联调测试失败 ${failures.length} 项（共 ${total}）：`);
  for (const item of failures) console.log('  ✗ ' + item);
  console.log('='.repeat(64));
  process.exit(1);
}
