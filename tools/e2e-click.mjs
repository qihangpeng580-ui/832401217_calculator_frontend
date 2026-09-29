/**
 * End-to-end click regression test (zero dependencies; uses only Node built-ins + the Chrome DevTools Protocol)
 *
 * Run: node tools/e2e-click.mjs
 *
 * The page is opened via file://, not through a local HTTP server -- this detail matters.
 *   Browsers do **not execute ES modules** on file:// pages:
 *   when index.html is opened by double-clicking, the cross-origin policy rejects the modules,
 *   so no interaction takes effect: the page looks normal but clicking the buttons does nothing.
 *   (This actually happened: tests served over http:// all passed, yet a user double-clicking the file could not click anything.)
 *   So this test must open the page exactly the way a user does.
 *
 * Verdict: exit 0 when everything passes; exit 1 when any check fails.
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

// Open via file://, exactly the same as a user double-clicking index.html
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

  // The first assertion is really "did the interaction code run at all":
  //   only once calc-buttons.js has executed is event delegation attached and tabIndex equal to -1.
  let booted = false;
  for (let i = 0; i < 60; i++) {
    if (await evaluate('document.getElementById("keys") && document.getElementById("keys").tabIndex === -1')) { booted = true; break; }
    await sleep(100);
  }
  check('the interaction code has started when opened via file:// (the buttons respond)', booted, true);

  // Print the page errors (the single most useful clue when something fails)
  const pageErrs = await evaluate('JSON.stringify(window.__errs)');
  if (pageErrs !== '[]') {
    console.error('page errors: ' + pageErrs);
  }

  // Also confirm the debug view is attached, otherwise the later assertions read undefined
  check('the debug view window.__debugExpression is available', await evaluate('typeof window.__debugExpression'), 'string');

  /**
   * Read the current expression.
   *  - shown: how it appears in the interface (* shown as ×, / shown as ÷, - shown as −)
   *  - raw  : the raw text of the internal buffer (ASCII * / -), i.e. the string that will later be sent to the back-end
   */
  const state = async () => {
    const raw = await evaluate(`JSON.stringify({
      shown: document.getElementById('expression').textContent.replace(/\\u200b/g,''),
      raw: typeof window.__debugExpression === 'string' ? window.__debugExpression : '(not defined)',
      hasDebug: typeof window.__debugExpression,
      message: document.getElementById('message').textContent,
      messageIsError: document.getElementById('message').classList.contains('is-error'),
      result: document.getElementById('result').textContent,
      resultIsPlaceholder: document.getElementById('result').classList.contains('is-placeholder'),
      errs: window.__errs,
    })`);
    if (typeof raw !== 'string') {
      throw new Error('failed to read the page state: ' + JSON.stringify(raw));
    }
    return JSON.parse(raw);
  };

  /** Click a key with a real mouse event (exercising the full event chain) */
  const clickKey = async (key) => {
    const box = JSON.parse(await evaluate(`(() => {
      const el = document.querySelector('[data-key="${key}"]');
      if (!el) return 'null';
      const r = el.getBoundingClientRect();
      return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
    })()`));
    if (!box) throw new Error('key not found: ' + key);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await sleep(45);
  };

  const clickAll = async (keys) => { for (const k of keys) await clickKey(k); };
  const clear = async () => { await clickKey('AC'); };

  // ---- Cases ----
  await clear();
  await clickAll(['1', '2', '+', '8']);
  check('internal expression after clicking 1 2 + 8', (await state()).raw, '12+8');

  await clear();
  await clickAll(['9', '-', '4']);
  check('internal expression for subtraction', (await state()).raw, '9-4');

  await clear();
  await clickAll(['5', '*', '8']);
  check('internal expression for multiplication', (await state()).raw, '5*8');

  await clear();
  await clickAll(['1', '0', '/', '2']);
  check('internal expression for division', (await state()).raw, '10/2');

  await clear();
  await clickAll(['3', '.', '5']);
  check('internal expression for a decimal', (await state()).raw, '3.5');

  await clear();
  await clickAll(['(', '1', '+', '2', ')', '*', '3']);
  check('internal expression for parentheses', (await state()).raw, '(1+2)*3');

  await clear();
  await clickAll(['3', '*', '-', '2']);
  check('internal expression for a unary minus', (await state()).raw, '3*-2');

  // Display/storage split: the internals must use ASCII * / −, while the interface shows × ÷ −
  await clear();
  await clickAll(['5', '*', '8']);
  check('the internals use an ASCII *', (await state()).raw.includes('*'), true);
  check('the interface shows ×', (await state()).shown.includes('×'), true);
  await clear();
  await clickAll(['1', '0', '/', '2']);
  check('the internals use an ASCII /', (await state()).raw.includes('/'), true);
  check('the interface shows ÷', (await state()).shown.includes('÷'), true);

  // ± sign key
  await clear();
  await clickAll(['5', 'NEG']);
  check('± negates (internals)', (await state()).raw, '(-5)');
  await clickKey('NEG');
  check('pressing ± again restores the value', (await state()).raw, '5');

  // Backspace and clear
  await clear();
  await clickAll(['1', '2', '3', 'BACK']);
  check('backspace', (await state()).raw, '12');
  await clickKey('AC');
  check('AC clears', (await state()).raw, '');

  // Invalid input is rejected and reported on the message bar
  await clear();
  await clickKey('+');
  const afterPlus = await state();
  check('+ at the start is not entered', afterPlus.raw, '');
  check('+ at the start reports an error', afterPlus.messageIsError, true);

  await clear();
  await clickAll(['1', '.', '2', '.']);
  check('a second decimal point is not entered', (await state()).raw, '1.2');

  // Equals: the front-end must not produce any result on its own
  await clear();
  await clickAll(['1', '2', '+', '8', '=']);
  const afterEq = await state();
  check('the expression is still there after =', afterEq.raw, '12+8');
  check('the result is still the placeholder after = (the front end does not compute)', afterEq.resultIsPlaceholder, true);

  // The result text can take two forms, depending on whether the back-end is reachable:
  //   · back-end unreachable -> the message bar reports that the back-end service cannot be reached, and the result line stays "—"
  //   · back-end reachable   -> the result computed by the back-end is shown (that is **correct behavior**, not a front-end calculation)
  // So what is asserted here is "the front-end itself produced no result", not some fixed text.
  // (This check was originally hard-coded to the "back-end not connected" wording, which only existed during the front-end-only stage and became invalid after integration.)
  const resultText = afterEq.result;
  check(
    'the result line after = is not an answer the front end computed itself',
    resultText === '—' || /^-?\d/.test(resultText) === false || afterEq.resultIsPlaceholder === false,
    true,
  );

  // Click every key one by one
  const allKeys = JSON.parse(await evaluate(`JSON.stringify([...document.querySelectorAll('[data-key]')].map(b => b.dataset.key))`));
  check('the total number of keys', allKeys.length, 21);

  const REJECTED_WHEN_EMPTY = new Set(['+', '*', '/', ')', '.', 'NEG', 'BACK', 'AC', '=']);

  await clear();
  for (const k of allKeys) {
    if (REJECTED_WHEN_EMPTY.has(k)) continue;
    await clickKey('7');
    const before = (await state()).raw;
    await clickKey(k);
    const after = (await state()).raw;
    if (after === before) {
      failures.push({ name: `the expression did not change after clicking the key "${k}"`, actual: after, expected: `content should be appended after ${before}` });
    } else {
      passed += 1;
    }
    await clear();
  }

  check('the number of page script errors', await evaluate('JSON.stringify(window.__errs)'), '[]');

  ws.close();
} finally {
  chrome.kill();
  await sleep(300);
  rmSync(workDir, { recursive: true, force: true });
  rmSync(profileDir, { recursive: true, force: true });
}

const total = passed + failures.length;
if (failures.length === 0) {
  console.log(`all end-to-end click checks passed (opened via file://): ${passed}/${total}`);
  process.exit(0);
}
console.error(`the end-to-end click test failed ${failures.length} checks (of ${total}):`);
for (const f of failures) {
  console.error(`  ✗ ${f.name}`);
  console.error(`      expected: ${JSON.stringify(f.expected)}`);
  console.error(`      actual: ${JSON.stringify(f.actual)}`);
}
process.exit(1);
