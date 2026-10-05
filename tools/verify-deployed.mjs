/**
 * Verify that the **deployed public page** really is interactive (real mouse clicks).
 *
 * Run:
 *   node tools/verify-deployed.mjs
 *   node tools/verify-deployed.mjs https://example.com/
 *
 * ----------------------------------------------------------------
 * Why this must be done
 * ----------------------------------------------------------------
 *
 * "The files can be downloaded" and "the page works" are two different things. This went wrong once:
 * every automated test ran over local HTTP, 49 assertions + 37 clicks all green,
 * yet when a user double-clicked to open file:// the browser **refused to load the ES modules**,
 * so clicking anywhere on the page did nothing -- while the page looked perfectly normal.
 *
 * So after deployment a **real browser** must open the **real public URL**,
 * actually click a few keys, and confirm the interaction code really runs.
 *
 * This script checks three things:
 *   1. whether the interaction code has started (the item that went wrong back then)
 *   2. whether clicking a button really changes the expression
 *   3. whether pressing = **produces no result** (a hard requirement of the assignment: the result must come from the back-end)
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

/** Minimal CDP client */
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
}

async function waitFor(ws, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${ws}/json/version`);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chromePath) {
  console.error('Chrome or Edge not found, cannot verify');
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
  console.log('verifying the deployed public page (real browser + real mouse clicks)');
  console.log('='.repeat(62));
  console.log(`URL: ${URL_TO_TEST}`);
  console.log();

  if (!(await waitFor(PORT))) throw new Error('the browser debugging port did not come up');

  const target = await (
    await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(URL_TO_TEST)}`, { method: 'PUT' })
  ).json();
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);

  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    // Wait for the page to finish loading
    let loaded = false;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      try {
        loaded = await cdp.evaluate('document.readyState === "complete" && !!document.getElementById("keys")');
        if (loaded) break;
      } catch {
        // still loading
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    check('the page finished loading', loaded, true);

    console.log('\n[1] basic page information');
    checkTruthy('the page title is non-empty', await cdp.evaluate('document.title'));
    check('the URL is correct', (await cdp.evaluate('location.href')).replace(/\/$/, ''), URL_TO_TEST.replace(/\/$/, ''));

    console.log('\n[2] whether the interaction code started (the item that went wrong back then)');
    // Without event delegation attached, the tabIndex of the keys container is not -1
    check('the keys container can take focus (tabIndex=-1)', await cdp.evaluate('document.getElementById("keys").tabIndex'), -1);
    checkTruthy('bundle.js is loaded (it exposes __calc)', await cdp.evaluate('typeof window.__calc'));
    check('the expression is empty on first load', await cdp.evaluate('(document.getElementById("expression").textContent || "").replace(/\\u200b/g, "")'), '');

    console.log('\n[3] real mouse clicks on 1 + 2');
    for (const key of ['1', '+', '2']) {
      const box = await cdp.evaluate(`(() => {
        const el = document.querySelector('[data-key="${key}"]');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()`);
      checkTruthy(`key ${key} found`, box);
      if (!box) continue;
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
      await new Promise((r) => setTimeout(r, 80));
    }

    check(
      'the expression shows 1+2 after clicking 1+2',
      await cdp.evaluate('(document.getElementById("expression").textContent || "").replace(/\\u200b/g, "")'),
      '1+2',
    );

    console.log('\n[4] = must not produce a result (the result must be computed by the back end)');
    await cdp.evaluate('document.querySelector(\'[data-key="="]\').click()');

    // Poll until the result line leaves the "computing …" state instead of sleeping for a fixed duration.
    //   A fixed sleep (150ms in the earlier version) reads the "computing …" state on any network jitter,
    //   making this assertion fail intermittently -- even though the interface is fine. So wait for a terminal state:
    //   back-end reachable -> "3"; back-end unreachable -> the front-end's 8-second timeout must elapse first, then it shows "—". Hence the 12-second cap.
    let resultText = '';
    for (let i = 0; i < 120; i += 1) {
      resultText = await cdp.evaluate('document.getElementById("result").textContent');
      if (resultText !== 'Calculating …') break;
      await new Promise((r) => setTimeout(r, 100));
    }

    // What is asserted here is "the front-end did not compute anything itself", not some fixed text.
    //   The two correct behaviors depend on whether a usable back-end is available in production:
    //     · back-end unreachable -> the result line keeps the "—" placeholder and the message bar reports that the back-end service cannot be reached
    //     · back-end reachable   -> the result line shows **the back-end's** 1+2=3
    //   So the condition is "the result is either the placeholder or the value the back-end should give (3)".
    //   (This was originally hard-coded to the "back-end not connected" wording, which only existed in the front-end-only stage and became invalid after integration.)
    const looksLikePlaceholder = resultText === '—';
    const looksLikeBackendResult = resultText === '3';
    check(
      'the result line is either the placeholder or the 3 computed by the back end (never invented by the front end)',
      looksLikePlaceholder || looksLikeBackendResult,
      true,
    );

    if (looksLikePlaceholder) {
      // When the back-end is unreachable, the message bar must state the reason instead of silently showing nothing
      const messageText = await cdp.evaluate('document.getElementById("message").textContent');
      check('the message bar states that the back-end service is unreachable', messageText.includes('Cannot reach the back-end service. Make sure it is running.'), true);
      check(
        'the message bar is red',
        await cdp.evaluate('document.getElementById("message").classList.contains("is-error")'),
        true,
      );
      check(
        'the back-end status shows as not connected',
        await cdp.evaluate('document.getElementById("backend-text").textContent.includes("not connected")'),
        true,
      );
    } else {
      check('the result line shows the 3 computed by the back end', resultText, '3');
    }

    console.log('\n[5] no script errors');
    check('the page has no JavaScript errors', await cdp.evaluate('window.__deployErrors ? window.__deployErrors.length : 0'), 0);

    console.log('\n[6] image assets loaded successfully');
    checkTruthy(
      'the Nailong image is loaded',
      await cdp.evaluate(
        'Array.from(document.images).every(img => img.complete && img.naturalWidth > 0)',
      ),
    );
    check('the number of images', await cdp.evaluate('document.images.length'), 2);
  } finally {
    await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => {});
    cdp.ws.close();
  }
} catch (error) {
  failures.push(`execution error: ${error.message}`);
  console.log(`\nexecution error: ${error.message}`);
} finally {
  chrome.kill();
  await new Promise((r) => setTimeout(r, 300));
  rmSync(profileDir, { recursive: true, force: true });
}

const total = passed + failures.length;
console.log('\n' + '='.repeat(62));
if (failures.length === 0) {
  console.log(`all public-page checks passed: ${passed}/${total}`);
  console.log('='.repeat(62));
  process.exit(0);
} else {
  console.log(`verification failed ${failures.length} checks (of ${total}):`);
  for (const item of failures) console.log('  ✗ ' + item);
  console.log('='.repeat(62));
  process.exit(1);
}
