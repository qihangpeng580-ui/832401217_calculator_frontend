/**
 * Screenshot script (direct Chromium DevTools Protocol connection, zero dependencies)
 *
 * Usage: node tools/capture-screens.mjs
 *
 * ----------------------------------------------------------------
 * Difference from the previous version: it talks to a real back-end
 * ----------------------------------------------------------------
 *
 * The previous version took screenshots without a back end: pressing = only showed
 * "back-end not connected", the history area was an empty placeholder, and error
 * messages were staged with demo data.
 *
 * The back-end is finished now, so this version:
 *   1. starts a real Python back-end itself (temporary database)
 *   2. the page really calls the back-end, and the result shows the value the back-end computed
 *   3. the history list holds real records from the back-end database
 *   4. the division-by-zero message comes from a real back-end error response (DIVISION_BY_ZERO)
 *
 * Every piece of content in the screenshots can therefore be reproduced in real use --
 * nothing is staged just to look good.
 *
 * ----------------------------------------------------------------
 * Why not `chrome --headless --screenshot`
 * ----------------------------------------------------------------
 * That approach does not wait for page scripts to finish; every image came
 * out with an empty expression. With CDP the pacing is explicit: wait until the page
 * has rendered the target content, then capture.
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
const outDir = join(repoRoot, 'docs', 'screenshots');
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
 * Convert an "internal ASCII expression" into its "UI display form".
 *
 * Why this function exists:
 *   The UI separates internal storage from display -- internally it stores ASCII * / -,
 *   and rendering replaces them with × ÷ − (the minus is U+2212, not the ASCII hyphen).
 *   The two minus characters are nearly indistinguishable in a monospace font, but the
 *   character codes differ and the assertion is bound to fail.
 *
 *   The first time, shot 03 expected "9-4" but displayed "9−4";
 *   the second time, shot 09 expected "3×(-2)" but displayed "3×(−2)".
 *   Rather than checking each one by hand, convert in one place:
 *   write expected values in ASCII only, and the script converts them to display form.
 *
 * @param {string} text
 * @returns {string}
 */
function toDisplayText(text) {
  return String(text).replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '−');
}

/**
 * Definitions for the 13 screenshots.
 *
 * keys      keys to click, in order (NEG means the ± key)
 * submit    whether to press = to trigger a back-end calculation
 * prefill   whether to solve a few expressions first to fill in history
 * armed     which operator key should stay highlighted at the end
 * pressed   which key should show the "active" state
 * expect    expression expected on the interface. **Write it in ASCII** (e.g. "3*(-2)");
 *           the script converts it with toDisplayText before comparing.
 * expectResult expected result-line content (optional)
 */
const SHOTS = [
  { n: '01', label: 'Initial screen', name: 'initial_interface', keys: [], expect: '' },
  { n: '02', label: 'Addition', name: 'addition', keys: ['1', '2', '+', '8'], submit: true, expect: '12+8', expectResult: '20' },
  { n: '03', label: 'Subtraction', name: 'subtraction', keys: ['9', '-', '4'], submit: true, expect: '9-4', expectResult: '5' },
  { n: '04', label: 'Multiplication', name: 'multiplication', keys: ['5', '*', '8'], submit: true, expect: '5*8', expectResult: '40' },
  { n: '05', label: 'Division', name: 'division', keys: ['1', '0', '/', '2'], submit: true, expect: '10/2', expectResult: '5' },
  { n: '06', label: 'Decimal arithmetic', name: 'decimal', keys: ['3', '.', '5', '+', '1', '.', '2', '5'], submit: true, expect: '3.5+1.25', expectResult: '4.75' },
  { n: '07', label: 'Compound expression', name: 'compound_expression', keys: ['1', '+', '2', '*', '3'], submit: true, expect: '1+2*3', expectResult: '7' },
  { n: '08', label: 'Parentheses', name: 'parentheses', keys: ['(', '1', '+', '2', ')', '*', '3'], submit: true, expect: '(1+2)*3', expectResult: '9' },
  { n: '09', label: 'Unary sign', name: 'unary_sign', keys: ['3', '*', '2', 'NEG'], submit: true, expect: '3*(-2)', expectResult: '-6' },
  // Shot 10 demonstrates the two visual feedback states, "active" and "latched".
  // The expected value is "12+8+", not "12+8":
  //   armed is implemented by **actually clicking that operator key again** (rather than
  //   setting state directly), so the expression gains a trailing +, which is exactly the
  //   "currently latched operator". That also matches what this shot is meant to show:
  //   the trailing + stays highlighted.
  { n: '10', label: 'Key press and highlight', name: 'key_pressed_highlight', keys: ['1', '2', '+', '8'], armed: '+', pressed: '+', expect: '12+8+' },
  { n: '11', label: 'Invalid-expression message', name: 'invalid_expression', keys: ['1', '+', '2', '*'], submit: true, expect: '1+2*' },
  { n: '12', label: 'Division-by-zero message', name: 'division_by_zero', keys: ['1', '0', '/', '0'], submit: true, expect: '10/0' },
  // Shot 13: history already containing records (real data from the back-end database)
  { n: '13', label: 'History', name: 'history', keys: [], prefill: true, expect: '' },
];

// ---------------------------------------------------------------- prepare directories
mkdirSync(outDir, { recursive: true });

// Copy src into a temp directory (avoids modifying the repository's source files)
const siteDir = join(workDir, 'site');
cpSync(srcDir, siteDir, { recursive: true });

// Put the scenario script under the temp copy's tools/ (the page references tools/shot-seed.js)
mkdirSync(join(siteDir, 'tools'), { recursive: true });
cpSync(join(here, 'shot-seed.js'), join(siteDir, 'tools', 'shot-seed.js'));

// Disable caret blinking: an infinite animation makes the screenshot land on an unpredictable frame
const cssPath = join(siteDir, 'css', 'style.css');
writeFileSync(
  cssPath,
  readFileSync(cssPath, 'utf8').replace('animation: caret-blink 1.1s steps(1) infinite;', 'animation: none;'),
  'utf8',
);

const baseHtml = readFileSync(join(srcDir, 'index.html'), 'utf8');

/**
 * Generate the HTML for one screenshot.
 *
 * Two key points:
 *  1. Each shot gets its **own file name** (shot-01.html, shot-02.html, ...).
 *     Initially all shots shared one html, so from the second shot on the browser
 *     went straight to its cache, the page never reloaded, and the capture still
 *     held the previous shot's state.
 *  2. The page loads the classic script js/bundle.js, and the scenario script
 *     tools/shot-seed.js is a classic script too, setting state through
 *     window.__calc and real clicks.
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

// ---------------------------------------------------------------- static server
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

// ---------------------------------------------------------------- start the back-end
const dbPath = join(workDir, 'shots.db');
let backend = null;

async function startBackend() {
  if (!existsSync(join(backendRoot, 'run.py'))) {
    console.log('(no back-end directory found, so these screenshots will not use a back end)');
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
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

// ---------------------------------------------------------------- point the front-end at this back-end
//
// Easy pitfall here:
//   The page loads **bundle.js**, and the back-end address is inlined into the bundle
//   **at bundling time** (build-bundle.mjs copies config.js's source into the artifact;
//   only `export` is stripped).
//   So editing config.js alone does nothing -- a **rebundle** is required.
//   The first run tripped on exactly this: the page showed "cannot connect to the
//   back-end service" because the bundle still had the default port 8000 in it.
const originalConfig = readFileSync(join(siteDir, 'js', 'config.js'), 'utf8');
const patchedConfig = originalConfig.replace(
  /export const API_BASE_URL = '[^']*';/,
  `export const API_BASE_URL = 'http://127.0.0.1:${BACKEND_PORT}';`,
);
if (patchedConfig === originalConfig) {
  throw new Error('could not rewrite API_BASE_URL in config.js — check that the shape of the file has not changed');
}
writeFileSync(join(siteDir, 'js', 'config.js'), patchedConfig, 'utf8');

// Rebundle the temp copy with the bundler.
//
// --js-dir points straight at the copy's js directory, and the artifact is written back there.
// (The first attempt had the copy fake a "root/src/js" directory layout to match the
//   bundler's fixed path, which got the path wrong twice and created a stray src directory.
//   A dedicated flag is much cleaner.)
function rebuildBundle() {
  const result = spawnSync(
    process.execPath,
    [join(here, 'build-bundle.mjs'), '--js-dir', join(siteDir, 'js')],
    { cwd: siteDir, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error('rebundling failed: ' + (result.stderr || result.stdout || ''));
  }
}

rebuildBundle();

// ---------------------------------------------------------------- CDP client
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

// ---------------------------------------------------------------- main flow
const READY_TIMEOUT_MS = 25000;
let chrome = null;
let made = 0;

try {
  console.log('='.repeat(62));
  console.log('Capturing demo screenshots (real back end + real clicks)');
  console.log('='.repeat(62));

  const backendUp = await startBackend();
  console.log(`Back end: ${backendUp ? `running (port ${BACKEND_PORT}, temporary database)` : 'not running'}`);

  const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!chromePath) throw new Error('Chrome or Edge not found');

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
  let version = { Browser: 'unknown' };
  while (Date.now() < cdpDeadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      if (res.ok) {
        version = await res.json();
        break;
      }
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  console.log(`Browser: ${version.Browser}`);
  console.log();

  for (const shot of SHOTS) {
    const shotHtmlName = `shot-${shot.n}.html`;
    writeFileSync(join(siteDir, shotHtmlName), htmlFor(shot), 'utf8');
    const url = `http://127.0.0.1:${SITE_PORT}/${shotHtmlName}`;

    // Open a **brand-new tab** for each shot: reusing one tab and navigating it
    // repeatedly invalidates the earlier execution context, so from the second
    // shot onward the page content cannot be read.
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

      // "Ready to capture" is decided by **whether the page is really ready**, not by a fixed delay.
      //
      // Easy mistake here:
      //   The first version broke out of the loop "as soon as __shotReady was true" and
      //   checked the expression and result afterwards, **outside the loop**. But __shotReady
      //   is set when the scenario script finishes, and the request fired by = had not
      //   returned yet (the result line was still "—"), so every shot failed.
      //   The fix: fold **all conditions** into the loop condition and keep polling until all hold.
      const deadline = Date.now() + READY_TIMEOUT_MS;
      let ready = false;
      let lastDump = '';
      let lastReason = 'timed out';

      while (Date.now() < deadline) {
        let probe = null;
        try {
          probe = await cdp.evaluate(`(() => {
            const el = document.getElementById('expression');
            if (!el) return { ready: false, reason: 'no expression element on the page' };
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
          continue; // page is still loading
        }

        lastDump = JSON.stringify(probe);

        // Check all conditions together; keep waiting while any one fails
        if (probe.ready !== true) {
          lastReason = 'the scenario script has not finished (__shotReady not set)';
        } else if (probe.shown !== toDisplayText(shot.expect)) {
          lastReason = `expression mismatch: expected ${JSON.stringify(toDisplayText(shot.expect))}, got ${JSON.stringify(probe.shown)}`;
        } else if (shot.expectResult !== undefined && probe.resultText !== shot.expectResult) {
          lastReason = `result mismatch: expected ${JSON.stringify(shot.expectResult)}, got ${JSON.stringify(probe.resultText)}`;
        } else if (typeof shot.expectMessage === 'string' && !probe.messageText.includes(shot.expectMessage)) {
          lastReason = `message mismatch: expected it to contain ${JSON.stringify(shot.expectMessage)}, got ${JSON.stringify(probe.messageText)}`;
        } else if (shot.expectError === true && !probe.messageText) {
          lastReason = 'an error message was expected, but the message bar is empty';
        } else if (shot.prefill === true && probe.historyCount < 3) {
          lastReason = `history too short: expected at least 3 records, got ${probe.historyCount}`;
        } else {
          ready = true;
          break;
        }

        await new Promise((r) => setTimeout(r, 80));
      }

      if (!ready) {
        const errors = await cdp.evaluate('JSON.stringify(window.__shotErrors || [])').catch(() => '[]');
        throw new Error(
          `shot ${shot.n} "${shot.label}" did not render the expected content\n  reason: ${lastReason}\n  state: ${lastDump}\n  page errors: ${errors}`,
        );
      }

      // Leave one more frame for painting
      await new Promise((r) => setTimeout(r, 220));

      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const out = join(outDir, `${shot.n}_${shot.name}.png`);
      writeFileSync(out, Buffer.from(data, 'base64'));
      made += 1;
      console.log(`  ${String(made).padStart(2)}/${SHOTS.length}  ${shot.label.padEnd(14)} -> ${shot.n}_${shot.name}.png`);
    } finally {
      await fetch(`http://127.0.0.1:${CDP_PORT}/json/close/${target.id}`).catch(() => {});
      cdp.ws.close();
    }
  }

  console.log();
  console.log(`Done: ${made}/${SHOTS.length} images`);
  console.log(`Output directory: ${outDir}`);
} finally {
  if (chrome) chrome.kill();
  if (backend && !backend.killed) backend.kill();
  server.close();
  await new Promise((r) => setTimeout(r, 400));
  rmSync(workDir, { recursive: true, force: true });
}
