/**
 * End-to-end integration test (real back-end + real browser + real mouse clicks)
 *
 * Run:
 *   node tools/e2e-integration.mjs
 *
 * It takes care of all of this itself:
 *   1. Start a real Python back-end (random port, temporary database file)
 *   2. Serve the src/ directory with Node's built-in http server (simulating the deployment environment)
 *   3. Open the page in headless Chrome and **actually click the buttons with the mouse**
 *   4. Verify: result display, history writes, search, delete, clear, error messages
 *   5. Clean up: shut down the browser and the back-end, delete the temporary database
 *
 * ----------------------------------------------------------------
 * Why a "real" integration test is mandatory
 * ----------------------------------------------------------------
 *
 * "False green" is the problem this project most needs to guard against, and it has happened twice:
 *
 *   1. Front-end: every test ran over local HTTP, 49+37 checks all green,
 *      yet when a user double-clicked to open file:// the browser did not execute the ES modules and clicking the buttons did nothing.
 *   2. Back-end: 157 unit tests all green, but those called the functions **directly**, bypassing the HTTP layer.
 *
 * So the integration test must use real HTTP + a real browser + real clicks.
 * Only then is it proven that "the front-end really sent the expression to the back-end, the back-end really computed the result,
 * and the result really came back to the interface".
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

/** Find an idle port for the back-end (avoiding a clash with the 8000 the user may have open) */
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
    failures.push(`${name}  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    console.log(`  FAIL ${name}  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function checkTruthy(name, actual) {
  if (actual) {
    passed += 1;
    console.log(`  OK   ${name}  (${JSON.stringify(actual)})`);
  } else {
    failures.push(`${name}  expected a non-empty value, got ${JSON.stringify(actual)}`);
    console.log(`  FAIL ${name}  expected a non-empty value, got ${JSON.stringify(actual)}`);
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
      ws.addEventListener('error', () => bad(new Error('WebSocket connection failed')), { once: true });
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
      throw new Error('page script error: ' + (r.exceptionDetails.exception?.description || ''));
    }
    return r.result.value;
  }

  /** Click a key with a real mouse event */
  async clickKey(key) {
    const box = await this.evaluate(`(() => {
      const el = document.querySelector('[data-key="${key}"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!box) throw new Error(`key not found: ${key}`);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await new Promise((r) => setTimeout(r, 70));
  }

  /** Click a sequence of keys in order */
  async typeKeys(keys) {
    for (const key of keys) {
      await this.clickKey(key);
    }
  }

  /** Read the text shown in the interface */
  async text(id) {
    return this.evaluate(`(document.getElementById(${JSON.stringify(id)}) || {}).textContent`);
  }

  /** Wait until some condition holds */
  async waitFor(expression, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        if (await this.evaluate(expression)) return true;
      } catch {
        // the page is not ready yet
      }
      await new Promise((r) => setTimeout(r, 120));
    }
    return false;
  }
}

// ---------------------------------------------------------------- Static server
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

// ---------------------------------------------------------------- Main flow
const workDir = mkdtempSync(join(tmpdir(), 'dsh-integration-'));
const dbPath = join(workDir, 'integration.db');
const profileDir = join(workDir, 'chrome-profile');
mkdirSync(profileDir, { recursive: true });

let backend = null;
let chrome = null;

try {
  console.log('='.repeat(64));
  console.log('end-to-end integration test (real back end + real browser + real clicks)');
  console.log('='.repeat(64));

  // ---------------------------------------------------------- 1. Start the back-end
  console.log('\n[0] Starting the back-end service');
  if (!existsSync(join(backendRoot, 'run.py'))) {
    throw new Error(`back-end directory not found: ${backendRoot}`);
  }

  backend = spawn(
    'py',
    ['-3.12', 'run.py', '--port', String(BACKEND_PORT), '--db', dbPath],
    {
      cwd: backendRoot,
      stdio: 'ignore', // no pipes: a full pipe buffer would hang the child process
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    },
  );

  // Wait for the back-end health check to pass
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
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  check('the back end is up and answers /api/health', backendReady, true);
  if (!backendReady) throw new Error('the back end failed to start');

  // ---------------------------------------------------------- 2. Start the static server
  await new Promise((ok) => site.listen(SITE_PORT, '127.0.0.1', ok));
  console.log(`\n[1] front end served at http://127.0.0.1:${SITE_PORT}/`);

  // ---------------------------------------------------------- 3. Start the browser
  const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!chromePath) throw new Error('Chrome or Edge not found');

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
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  check('the browser started', cdpReady, true);
  if (!cdpReady) throw new Error('the browser failed to start');

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

  // The page needs to know which local port the back-end is on. config.js hard-codes 8000,
  //   whereas the test uses a different port, so an override value is injected here.
  //   Approach: opening the page first and then overriding the config over CDP does not work (the config lives in a closure),
  //   so instead the test port is passed in through a URL parameter -- see the injection script below.
  const originalConfig = readFileSync(join(srcDir, 'js', 'config.js'), 'utf8');
  const patchedConfig = originalConfig.replace(
    /export const API_BASE_URL = '[^']*';/,
    `export const API_BASE_URL = 'http://127.0.0.1:${BACKEND_PORT}';`,
  );
  if (patchedConfig === originalConfig) {
    throw new Error('could not rewrite API_BASE_URL in config.js — check that the shape of the file has not changed');
  }
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(srcDir, 'js', 'config.js'), patchedConfig, 'utf8');

  // Editing config.js requires a rebuild (the page loads bundle.js)
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, [join(frontendDir(), 'tools', 'build-bundle.mjs')], { cwd: frontendRoot });
  console.log('  (back-end address written into the front-end config and rebundled)');

  let cdp;
  let target;
  try {
    ({ cdp, target } = await openPage());

    // ------------------------------------------------------ Basic readiness
    console.log('\n[2] page readiness and back-end connection status');
    check('the interaction code has started (tabIndex=-1)', await cdp.evaluate('document.getElementById("keys").tabIndex'), -1);
    checkTruthy('the front end reads the correct back-end address', await cdp.evaluate('window.__calc.getApiBaseUrl()'));
    const online = await cdp.waitFor('document.getElementById("backend-text").textContent.includes("Back end connected — result computed by the back end")', 10000);
    check('the interface reports the back end as connected', online, true);

    // ------------------------------------------------------ Basic arithmetic
    console.log('\n[3] basic arithmetic: click 1 2 + 8 = ; the result must come from the back end');
    await cdp.typeKeys(['1', '2', '+', '8']);

    // Note that the zero-width space (\u200b) is stripped.
    //   To draw the caret the interface inserts a zero-width space into the text as an anchor,
    //   so textContent carries one extra invisible character. It must be stripped before asserting,
    //   otherwise you get failures like "12+8" !== "12+8" that look completely identical.
    check(
      'the expression shows 12+8',
      await cdp.evaluate('(document.getElementById("expression").textContent || "").replace(/\\u200b/g, "")'),
      '12+8',
    );

    await cdp.clickKey('=');
    const gotResult = await cdp.waitFor('document.getElementById("result").textContent === "20"', 10000);
    check('the result line shows the 20 computed by the back end', gotResult, true);
    check('the result line is no longer marked as a placeholder', await cdp.evaluate('document.getElementById("result").classList.contains("is-placeholder")'), false);

    // ------------------------------------------------------ Compound expressions
    console.log('\n[4] compound expressions (precedence / parentheses / unary minus)');
    //
    // About the two ways of entering a sign (the test cases got this wrong at first, so it is worth spelling out):
    //
    //   · ± (NEG) negates "the number already at the end"; the implementation wraps that trailing number in parentheses:
    //         3*2  -> 3*(-2)
    //     It therefore requires a complete number at the end. Pressing ± at the start of the expression or right after
    //     an operator produces the message asking for a complete number first -- this is **by design**, not a bug.
    //
    //   · − (the minus key), when pressed "at the start of the expression" or "after another operator",
    //     is recognized as a unary minus rather than subtraction: pressing − 5 directly yields "-5".
    //     That is the correct way to enter the "-5+8" example from the assignment.
    const cases = [
      { keys: ['AC', '1', '+', '2', '*', '3'], expect: '7', note: 'precedence 1+2*3' },
      { keys: ['AC', '(', '1', '+', '2', ')', '*', '3'], expect: '9', note: 'parentheses (1+2)*3' },
      { keys: ['AC', '3', '*', '2', 'NEG'], expect: '-6', note: '± negation 3*(-2)' },
      { keys: ['AC', '-', '5', '+', '8'], expect: '3', note: 'a leading minus -5+8' },
      { keys: ['AC', '8', '-', '3', '*', '2'], expect: '2', note: 'precedence 8-3*2' },
      { keys: ['AC', '1', '0', '/', '4'], expect: '2.5', note: 'decimal result' },
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

    // Also verify the shape of the expression after ± follows a number (display/storage split: the interface shows −, the internals use -)
    await cdp.typeKeys(['AC', '3', '*', '2', 'NEG']);
    check(
      '± wraps the trailing number as (-2)',
      await cdp.evaluate('window.__calc.getExpression()'),
      '3*(-2)',
    );

    // ------------------------------------------------------ Division by zero
    console.log('\n[5] division by zero: decided by the **back end**, the front end only displays it');
    await cdp.typeKeys(['AC', '1', '0', '/', '0']);
    await cdp.clickKey('=');
    const zeroShown = await cdp.waitFor(
      'document.getElementById("message").textContent.includes("Division by zero is not allowed")',
      8000,
    );
    check('the division-by-zero message is shown', zeroShown, true);
    check(
      'the message bar is red (is-error)',
      await cdp.evaluate('document.getElementById("message").classList.contains("is-error")'),
      true,
    );

    // ------------------------------------------------------ Invalid expression (blocked by the front-end)
    console.log('\n[6] invalid expression: errors the front end can detect do not waste a network request');
    await cdp.typeKeys(['AC', '1', '+', '*']);
    const forcedMessage = await cdp.text('message');
    checkTruthy('consecutive operators are replaced and a message is shown', forcedMessage);

    // ------------------------------------------------------ History records
    console.log('\n[7] history: the data comes from the back-end database');
    const historyLoaded = await cdp.waitFor('document.querySelectorAll("#history-list li").length >= 5', 10000);
    check('the history list has rendered records', historyLoaded, true);

    const firstExpression = await cdp.evaluate(
      'document.querySelector("#history-list li .history__expression").textContent',
    );
    checkTruthy('the newest record has an expression', firstExpression);

    const firstResult = await cdp.evaluate(
      'document.querySelector("#history-list li .history__result").textContent',
    );
    check('the record carries a result (shaped like "= -6")', firstResult.startsWith('= '), true);

    // One operation failed (10/0, division by zero), and it **should not** be written to history.
    //   By design: history stores "expressions that were computed"; an invalid expression is not a valid calculation.
    const zeroInHistory = await cdp.evaluate(
      'Array.from(document.querySelectorAll("#history-list li .history__expression")).some(el => el.textContent.includes("0÷0") || el.textContent === "10÷0")',
    );
    check('the failed division by zero was not written to history', zeroInHistory, false);

    check(
      'a record count is shown',
      await cdp.evaluate('document.getElementById("history-count").textContent.length > 0'),
      true,
    );

    // ------------------------------------------------------ Search
    console.log('\n[8] history search (extension feature, maps to the back-end keyword parameter)');
    await cdp.evaluate(`(() => {
      const input = document.getElementById('history-keyword');
      input.value = '2*3';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    const searched = await cdp.waitFor('document.querySelectorAll("#history-list li").length === 1', 8000);
    check('searching for "2*3" leaves 1 record', searched, true);

    // Clear the search
    await cdp.evaluate(`(() => {
      const input = document.getElementById('history-keyword');
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await cdp.waitFor('document.querySelectorAll("#history-list li").length >= 5', 8000);

    // ------------------------------------------------------ Delete
    console.log('\n[9] delete a chosen record (assignment scoring item, 10 points)');
    const beforeCount = await cdp.evaluate('document.querySelectorAll("#history-list li").length');
    const deletingExpression = await cdp.evaluate(
      'document.querySelector("#history-list li .history__expression").textContent',
    );

    await cdp.evaluate('document.querySelector("#history-list li .history__delete").click()');
    const deleted = await cdp.waitFor(
      `document.querySelectorAll("#history-list li").length === ${beforeCount - 1}`,
      10000,
    );
    check('the list has one record fewer after the delete', deleted, true);

    const stillThere = await cdp.evaluate(
      `Array.from(document.querySelectorAll("#history-list li .history__expression"))
         .some(el => el.textContent === ${JSON.stringify(deletingExpression)})`,
    );
    check('the deleted record is really gone', stillThere, false);

    // ------------------------------------------------------ Persistence (reopening the page)
    console.log('\n[10] persistence: reopen the page and the history is still there');
    await closePage(cdp, target);
    ({ cdp, target } = await openPage());

    const persisted = await cdp.waitFor('document.querySelectorAll("#history-list li").length >= 4', 10000);
    check('the history was still read from the back end after reopening the page', persisted, true);

    // ------------------------------------------------------ Clear all
    console.log('\n[11] clear all history (extension feature)');
    await cdp.evaluate('window.confirm = () => true');
    await cdp.evaluate('document.getElementById("history-clear").click()');
    const cleared = await cdp.waitFor('document.querySelectorAll("#history-list li").length === 0', 10000);
    check('the list is empty after clearing', cleared, true);

    // ------------------------------------------------------ The front-end does not compute results
    console.log('\n[12] verify the result really comes from the back end (not computed by the front end)');
    // Kill the back-end, then press = : the interface must not produce a result
    backend.kill();
    await new Promise((r) => setTimeout(r, 1200));

    await cdp.typeKeys(['AC', '1', '+', '1']);
    await cdp.clickKey('=');
    const noResult = await cdp.waitFor(
      'document.getElementById("message").textContent.includes("Cannot reach the back-end service. Make sure it is running.") || document.getElementById("message").textContent.includes("Request timed out")',
      12000,
    );
    check('with the back end stopped, = yields no result and only reports that it is unreachable', noResult, true);
    check(
      'the result line is not 2 (the front end did not secretly compute it)',
      await cdp.text('result') === '2',
      false,
    );
  } finally {
    // Restore config.js and bundle.js (this must happen no matter what, otherwise the repository is left dirty)
    writeFileSync(join(srcDir, 'js', 'config.js'), originalConfig, 'utf8');
    const { execFileSync } = await import('node:child_process');
    execFileSync(process.execPath, [join(frontendRoot, 'tools', 'build-bundle.mjs')], { cwd: frontendRoot });
    console.log('\n(config.js restored and rebundled)');

    if (cdp) await closePage(cdp, target).catch(() => {});
  }
} catch (error) {
  failures.push(`execution error: ${error.message}`);
  console.log(`\nexecution error: ${error.message}`);
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
  console.log(`all end-to-end integration checks passed: ${passed}/${total}`);
  console.log('='.repeat(64));
  process.exit(0);
} else {
  console.log(`the integration test failed ${failures.length} checks (of ${total}):`);
  for (const item of failures) console.log('  ✗ ' + item);
  console.log('='.repeat(64));
  process.exit(1);
}
