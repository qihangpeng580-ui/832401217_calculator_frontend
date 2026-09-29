/**
 * 端到端点击回归测试（零依赖，只用到 Node 内置能力 + Chrome 的调试协议）
 *
 * 运行：node tools/e2e-click.mjs
 *
 * 为什么要有这个文件：
 *   截图工具是直接调用模块接口设置状态，绕过了"鼠标点击 → 事件委托 → 按键处理"这条真实链路。
 *   所以界面截图可以完全正常，而用户点按钮却毫无反应（真实踩过：
 *   键盘错位导致某个键被点到缝里，点了没反应）。
 *   这个测试逐个**真实点击**每个按键，并核对表达式行的文本。
 *
 * 判定：全部通过 exit 0；任何一项不符 exit 1。
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, existsSync, cpSync, rmSync } from 'node:fs';
import { join, resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const workDir = join(tmpdir(), 'dsh_e2e');
const profileDir = join(tmpdir(), 'dsh_e2e_prof');
const SITE_PORT = 8188;
const CDP_PORT = 9401;

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p));

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
  await send('Page.enable');
  await evaluate(`window.__errs = []; window.addEventListener('error', e => window.__errs.push(String(e.message))); 'ok'`);

  // 等页面就绪
  for (let i = 0; i < 60; i++) {
    if (await evaluate('document.getElementById("keys") && document.getElementById("keys").tabIndex === -1')) break;
    await sleep(100);
  }

  /**
   * 读出当前表达式。
   *  - shown：界面上显示的样子（* 显示为 ×、/ 显示为 ÷、- 显示为 −）
   *  - raw  ：内部缓冲区的原始文本（ASCII 的 * / -），也就是将来要发给后端的那个字符串
   */
  const state = async () => JSON.parse(await evaluate(`JSON.stringify({
    shown: document.getElementById('expression').textContent.replace(/\\u200b/g,''),
    raw: window.__debugExpression,
    message: document.getElementById('message').textContent,
    messageIsError: document.getElementById('message').classList.contains('is-error'),
    result: document.getElementById('result').textContent,
    resultIsPlaceholder: document.getElementById('result').classList.contains('is-placeholder'),
  })`));

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

  /** 依次点击一串按键 */
  const clickAll = async (keys) => { for (const k of keys) await clickKey(k); };

  const clear = async () => { await clickKey('AC'); };

  // ---- 用例 ----
  // 1. 每个按键都能点，且数字/运算符/括号/小数点都能进入表达式
  //    断言用 raw（内部原始文本），因为界面会把 * / - 显示成 × ÷ −
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

  // ★ 表里分离：内部必须是 ASCII 的 * / -，界面才显示 × ÷ −
  //   这条决定了表达式能不能直接发给后端（后端按 ASCII 解析）
  await clear();
  await clickAll(['5', '*', '8']);
  check('内部用 ASCII 的 *', (await state()).raw.includes('*'), true);
  check('界面显示 ×', (await state()).shown.includes('×'), true);
  await clear();
  await clickAll(['1', '0', '/', '2']);
  check('内部用 ASCII 的 /', (await state()).raw.includes('/'), true);
  check('界面显示 ÷', (await state()).shown.includes('÷'), true);

  // 2. ± 键
  await clear();
  await clickAll(['5', 'NEG']);
  check('± 取负（内部）', (await state()).raw, '(-5)');
  await clickKey('NEG');
  check('± 再按一次还原', (await state()).raw, '5');

  // 3. 退格与清空
  await clear();
  await clickAll(['1', '2', '3', 'BACK']);
  check('退格', (await state()).raw, '12');
  await clickKey('AC');
  check('AC 清空', (await state()).raw, '');

  // 4. 非法输入被拦并给出提示
  await clear();
  await clickKey('+');
  const afterPlus = await state();
  check('开头按 + 不写入', afterPlus.raw, '');
  check('开头按 + 提示为错误', afterPlus.messageIsError, true);

  await clear();
  await clickAll(['1', '.', '2', '.']);
  check('第二个小数点不写入', (await state()).raw, '1.2');

  // 5. 等号：前端不得产生任何计算结果
  await clear();
  await clickAll(['1', '2', '+', '8', '=']);
  const afterEq = await state();
  check('按 = 后表达式仍在', afterEq.raw, '12+8');
  check('按 = 后结果仍为占位（前端不算）', afterEq.resultIsPlaceholder, true);
  check('按 = 后结果文字', afterEq.result, '后端未接通');

  // 6. 全部 21 个按键逐个点一遍，确认没有"点了没反应"的键。
  //    空表达式下 + - * / ) 本来就该被拒（这是输入规则），所以这些键单独处理：
  //    有内容的表达式里点它们必须改变文本。
  const allKeys = JSON.parse(await evaluate(`JSON.stringify([...document.querySelectorAll('[data-key]')].map(b => b.dataset.key))`));
  check('按键总数', allKeys.length, 21);

  /** 空表达式下允许被拒绝的键（按输入规则） */
  const REJECTED_WHEN_EMPTY = new Set(['+', '*', '/', ')', '.', 'NEG', 'BACK', 'AC', '=']);

  await clear();
  for (const k of allKeys) {
    if (REJECTED_WHEN_EMPTY.has(k)) continue;
    // 先在表达式里放一个数字，再点这个键，它就应该生效
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

  // 7. 页面无脚本错误
  check('页面脚本错误数', await evaluate('JSON.stringify(window.__errs)'), '[]');

  ws.close();
} finally {
  chrome.kill();
  server.close();
  await sleep(300);
  rmSync(workDir, { recursive: true, force: true });
  rmSync(profileDir, { recursive: true, force: true });
}

const total = passed + failures.length;
if (failures.length === 0) {
  console.log(`端到端点击测试全部通过：${passed}/${total}`);
  process.exit(0);
}
console.error(`端到端点击测试失败 ${failures.length} 项（共 ${total}）：`);
for (const f of failures) {
  console.error(`  ✗ ${f.name}`);
  console.error(`      期望：${JSON.stringify(f.expected)}`);
  console.error(`      实际：${JSON.stringify(f.actual)}`);
}
process.exit(1);
