/**
 * 端到端点击回归测试（零依赖，只用到 Node 内置能力 + Chrome 调试协议）
 *
 * 运行：node tools/e2e-click.mjs
 *
 * ★ 用 file:// 打开页面，而不是本地 HTTP 服务器 —— 这一点很关键。
 *   因为浏览器在 file:// 页面里**不执行 ES 模块**：
 *   双击打开 index.html 时模块会被跨域策略拒绝，所有交互都不生效，
 *   页面看起来正常但点按钮毫无反应。
 *   （真实踩过：用 http:// 做的测试全部通过，用户双击打开却什么都点不动。）
 *   所以本测试必须用与用户相同的方式打开页面。
 *
 * 判定：全部通过 exit 0；任何一项不符 exit 1。
 */

import { spawn } from 'node:child_process';
import { readFileSync, existsSync, cpSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const workDir = join(tmpdir(), 'dsh_e2e_file');
const profileDir = join(tmpdir(), 'dsh_e2e_file_prof');
const CDP_PORT = 9412;

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p));

if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
if (existsSync(profileDir)) rmSync(profileDir, { recursive: true, force: true });
cpSync(join(repoRoot, 'src'), workDir, { recursive: true });
mkdirSync(workDir, { recursive: true });

// 用 file:// 打开，与用户双击 index.html 完全相同
const pageUrl = 'file:///' + join(workDir, 'index.html').replace(/\\/g, '/');

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${profileDir}`, '--window-size=620,900', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
const failures = [];
const check = (name, actual, expected) => {
  if (actual === expected) { passed += 1; return; }
  failures.push({ name, actual, expected });
};

try {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).ok) break; } catch { /* retry */ }
    await sleep(200);
  }
  const target = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(pageUrl)}`, { method: 'PUT' })).json();
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
  await send('Page.enable');
  await evaluate(`window.__errs = []; window.addEventListener('error', e => window.__errs.push(String(e.message))); 'ok'`);

  // ★ 第一个断言就是"交互代码到底有没有跑起来"：
  //   只有 calc-buttons.js 执行了，事件委托才挂上，tabIndex 才等于 -1。
  let booted = false;
  for (let i = 0; i < 60; i++) {
    if (await evaluate('document.getElementById("keys") && document.getElementById("keys").tabIndex === -1')) { booted = true; break; }
    await sleep(100);
  }
  check('file:// 打开时交互代码已启动（按钮能点）', booted, true);

  // 把页面错误打出来（出错时最有用的一条线索）
  const pageErrs = await evaluate('JSON.stringify(window.__errs)');
  if (pageErrs !== '[]') {
    console.error('页面报错：' + pageErrs);
  }

  // 顺便确认调试视图已挂上，否则后面的断言会读到 undefined
  check('调试视图 window.__debugExpression 可用', await evaluate('typeof window.__debugExpression'), 'string');

  /**
   * 读出当前表达式。
   *  - shown：界面上显示的样子（* 显示为 ×、/ 显示为 ÷、- 显示为 −）
   *  - raw  ：内部缓冲区的原始文本（ASCII 的 * / -），也就是将来要发给后端的那个字符串
   */
  const state = async () => {
    const raw = await evaluate(`JSON.stringify({
      shown: document.getElementById('expression').textContent.replace(/\\u200b/g,''),
      raw: typeof window.__debugExpression === 'string' ? window.__debugExpression : '(未定义)',
      hasDebug: typeof window.__debugExpression,
      message: document.getElementById('message').textContent,
      messageIsError: document.getElementById('message').classList.contains('is-error'),
      result: document.getElementById('result').textContent,
      resultIsPlaceholder: document.getElementById('result').classList.contains('is-placeholder'),
      errs: window.__errs,
    })`);
    if (typeof raw !== 'string') {
      throw new Error('读取页面状态失败：' + JSON.stringify(raw));
    }
    return JSON.parse(raw);
  };

  /** 用真实鼠标点击某个按键（走完整的事件链路） */
  const clickKey = async (key) => {
    const box = JSON.parse(await evaluate(`(() => {
      const el = document.querySelector('[data-key="${key}"]');
      if (!el) return 'null';
      const r = el.getBoundingClientRect();
      return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
    })()`));
    if (!box) throw new Error('找不到按键：' + key);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await sleep(45);
  };

  const clickAll = async (keys) => { for (const k of keys) await clickKey(k); };
  const clear = async () => { await clickKey('AC'); };

  // ---- 用例 ----
  await clear();
  await clickAll(['1', '2', '+', '8']);
  check('点 1 2 + 8 后内部表达式', (await state()).raw, '12+8');

  await clear();
  await clickAll(['9', '-', '4']);
  check('减法内部表达式', (await state()).raw, '9-4');

  await clear();
  await clickAll(['5', '*', '8']);
  check('乘法内部表达式', (await state()).raw, '5*8');

  await clear();
  await clickAll(['1', '0', '/', '2']);
  check('除法内部表达式', (await state()).raw, '10/2');

  await clear();
  await clickAll(['3', '.', '5']);
  check('小数内部表达式', (await state()).raw, '3.5');

  await clear();
  await clickAll(['(', '1', '+', '2', ')', '*', '3']);
  check('括号内部表达式', (await state()).raw, '(1+2)*3');

  await clear();
  await clickAll(['3', '*', '-', '2']);
  check('一元负号内部表达式', (await state()).raw, '3*-2');

  // ★ 表里分离：内部必须是 ASCII 的 * / −，界面才显示 × ÷ −
  await clear();
  await clickAll(['5', '*', '8']);
  check('内部用 ASCII 的 *', (await state()).raw.includes('*'), true);
  check('界面显示 ×', (await state()).shown.includes('×'), true);
  await clear();
  await clickAll(['1', '0', '/', '2']);
  check('内部用 ASCII 的 /', (await state()).raw.includes('/'), true);
  check('界面显示 ÷', (await state()).shown.includes('÷'), true);

  // ± 键
  await clear();
  await clickAll(['5', 'NEG']);
  check('± 取负（内部）', (await state()).raw, '(-5)');
  await clickKey('NEG');
  check('± 再按一次还原', (await state()).raw, '5');

  // 退格与清空
  await clear();
  await clickAll(['1', '2', '3', 'BACK']);
  check('退格', (await state()).raw, '12');
  await clickKey('AC');
  check('AC 清空', (await state()).raw, '');

  // 非法输入被拦并给出提示
  await clear();
  await clickKey('+');
  const afterPlus = await state();
  check('开头按 + 不写入', afterPlus.raw, '');
  check('开头按 + 提示为错误', afterPlus.messageIsError, true);

  await clear();
  await clickAll(['1', '.', '2', '.']);
  check('第二个小数点不写入', (await state()).raw, '1.2');

  // 等号：前端不得产生任何计算结果
  await clear();
  await clickAll(['1', '2', '+', '8', '=']);
  const afterEq = await state();
  check('按 = 后表达式仍在', afterEq.raw, '12+8');
  check('按 = 后结果仍为占位（前端不算）', afterEq.resultIsPlaceholder, true);
  check('按 = 后结果文字', afterEq.result, '后端未接通');

  // 全部按键逐个点一遍
  const allKeys = JSON.parse(await evaluate(`JSON.stringify([...document.querySelectorAll('[data-key]')].map(b => b.dataset.key))`));
  check('按键总数', allKeys.length, 21);

  const REJECTED_WHEN_EMPTY = new Set(['+', '*', '/', ')', '.', 'NEG', 'BACK', 'AC', '=']);

  await clear();
  for (const k of allKeys) {
    if (REJECTED_WHEN_EMPTY.has(k)) continue;
    await clickKey('7');
    const before = (await state()).raw;
    await clickKey(k);
    const after = (await state()).raw;
    if (after === before) {
      failures.push({ name: `按键「${k}」点击后表达式没有变化`, actual: after, expected: `${before} 之后应追加内容` });
    } else {
      passed += 1;
    }
    await clear();
  }

  check('页面脚本错误数', await evaluate('JSON.stringify(window.__errs)'), '[]');

  ws.close();
} finally {
  chrome.kill();
  await sleep(300);
  rmSync(workDir, { recursive: true, force: true });
  rmSync(profileDir, { recursive: true, force: true });
}

const total = passed + failures.length;
if (failures.length === 0) {
  console.log(`端到端点击测试全部通过（file:// 方式打开）：${passed}/${total}`);
  process.exit(0);
}
console.error(`端到端点击测试失败 ${failures.length} 项（共 ${total}）：`);
for (const f of failures) {
  console.error(`  ✗ ${f.name}`);
  console.error(`      期望：${JSON.stringify(f.expected)}`);
  console.error(`      实际：${JSON.stringify(f.actual)}`);
}
process.exit(1);
