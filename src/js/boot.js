/**
 * Boot script — the last piece of the puzzle.
 *
 * Why the startup logic gets its own file instead of sitting at the end of app.js:
 *   because bundle.js concatenates all modules **into one scope, in order**.
 *   If app.js called boot() directly at the end of the file, the bundle would run it while
 *   "the keyboard module is not defined yet" — and the page would throw immediately.
 *   (The bundler is very sensitive to the dependency order inside the bundle.)
 *
 *   A separate boot.js placed as the **last** file, with DOMContentLoaded as a fallback,
 *   guarantees that startup only happens after "all modules are defined".
 *
 * Order:
 *   · first attach the read-only debug interface to window.__calc (the automated tests need it)
 *   · then call app.boot() to actually start
 */

import { boot } from './app.js';

/**
 * The actual startup action.
 */
function start() {
  try {
    boot();
  } catch (error) {
    // A startup failure must leave a trace — otherwise the page looks fine but clicks do nothing,
    // exactly like the old file:// trap, and it is extremely hard to diagnose.
    console.error('[calculator] Startup failed:', error);
    const messageEl = document.getElementById('message');
    if (messageEl) {
      messageEl.textContent = 'The page failed to start. Press F12 to check the console.';
      messageEl.classList.add('is-error');
    }
  }
}

if (document.readyState === 'loading') {
  // The document is still loading: wait for the DOM (rarely taken when the script sits at the
  // end of body)
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  // The document is ready: start right away
  start();
}
