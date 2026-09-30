/**
 * "Scenario setup" script for screenshots (used only by the screenshot flow; it takes no part in normal page operation).
 *
 * ------------------------------------------------------------------
 * How this version works (the key difference from the previous version)
 * ------------------------------------------------------------------
 *
 * The previous version called the input model's API directly to "pose" the state, bypassing the full interaction chain.
 * That version produced nice-looking images, but it could not prove that "clicking a button really does something" --
 * and it was exactly this kind of "bypass the real chain" testing that later missed the fatal file:// bug.
 *
 * This version instead:
 *   1. **really clicks the buttons** (button.click(), going through the full click -> event delegation -> handleKey chain)
 *   2. pressing = goes through a real fetch -> real back-end -> real result
 *   3. the history list is really fetched from the back-end as well
 *
 * So the images it captures match **exactly** what a user gets by opening the page and clicking.
 *
 * Why a **classic script** rather than an ES module:
 *   the page itself only loads the classic script bundle.js. In practice, adding another
 *   <script type="module"> to this page fails because of module loading restrictions.
 *
 * The scenario is declared by <body data-shot="...">.
 */

(function () {
  /** Wait until a condition holds, or until the timeout expires */
  function waitFor(test, timeoutMs) {
    return new Promise(function (resolve) {
      var deadline = Date.now() + (timeoutMs || 6000);
      (function tick() {
        var ok = false;
        try {
          ok = test();
        } catch (error) {
          ok = false;
        }
        if (ok || Date.now() > deadline) {
          resolve(ok);
          return;
        }
        setTimeout(tick, 50);
      })();
    });
  }

  /** Really click a key (full interaction chain, not setting state directly) */
  function clickKey(key) {
    var button = document.querySelector('[data-key="' + key + '"]');
    if (!button) {
      throw new Error('key not found: ' + key);
    }
    button.click();
  }

  /** Click a sequence of keys in order */
  function pressKeys(keys) {
    for (var i = 0; i < keys.length; i += 1) {
      clickKey(keys[i]);
    }
  }

  /** The expression text shown in the interface (stripping the zero-width space used by the caret) */
  function shownExpression() {
    var el = document.getElementById('expression');
    return el ? (el.textContent || '').replace(/\u200b/g, '') : '';
  }

  /** Result line text */
  function shownResult() {
    var el = document.getElementById('result');
    return el ? (el.textContent || '') : '';
  }

  /** Number of entries in the history list */
  function historyCount() {
    return document.querySelectorAll('#history-list li').length;
  }

  async function applyShot() {
    // Execution trail: when the screenshot script fails it prints body's data-seed,
    // to tell "the script never ran" apart from "it ran but the state is wrong".
    document.body.dataset.seed = 'start';

    var calc = window.__calc;
    if (!calc) {
      document.body.dataset.seed = 'no-bridge'; // bundle did not execute
      window.__shotReady = true;
      return;
    }
    document.body.dataset.seed = 'bridge-ok';

    var config = document.body.dataset.shot;
    if (!config) {
      window.__shotReady = true;
      return;
    }

    var params = new URLSearchParams(config);

    // keys is the key sequence, comma-separated; NEG stands for the ± key
    var rawKeys = params.get('keys') || '';
    var keys = rawKeys ? rawKeys.split(',') : [];

    // Wait a moment first: on startup the page checks the back-end and fetches history, so let it settle before operating
    await waitFor(function () {
      var text = document.getElementById('backend-text');
      return text && text.textContent.indexOf('Back end connected — result computed by the back end') >= 0;
    }, 8000);

    document.body.dataset.seed = 'backend-checked';

    try {
      // 1. Really click buttons to enter the expression
      if (keys.length > 0) {
        pressKeys(keys);
      }

      // 2. Press = to trigger a real fetch -> real back-end calculation
      if (params.get('submit') === '1') {
        clickKey('=');

        // Wait until the result line no longer shows the computing placeholder or "—", meaning the back-end has answered
        await waitFor(function () {
          var text = shownResult();
          return text !== 'Calculating …' && text !== '—';
        }, 8000);

        // The history list also has to finish refreshing (a successful submit re-fetches the list)
        await waitFor(function () {
          return historyCount() > 0;
        }, 8000);
      }

      // 3. Clear and then enter again (for the "history already has content" scenario)
      if (params.get('prefill') === '1') {
        var samples = ['12+8', '3.5+1.25', '(1+2)*3'];
        for (var i = 0; i < samples.length; i += 1) {
          clickKey('AC');
          pressKeys(samples[i].split(''));
          clickKey('=');
          await waitFor(function () {
            var text = shownResult();
            return text !== 'Calculating …' && text !== '—';
          }, 8000);
        }
        clickKey('AC');
      }

      // 4. Keep an operator key latched (this must come last: any key press clears the highlight)
      var armed = params.get('armed');
      if (armed) {
        clickKey(armed);
      }

      // 5. Simulate the instant when "the finger is pressed but not yet released"
      var pressed = params.get('pressed');
      if (pressed) {
        calc.flashKey(pressed);
      }

      document.body.dataset.seed = 'rendered:' + shownExpression();
    } catch (error) {
      document.body.dataset.seed = 'error:' + error.message;
    }

    // Tell the screenshot script that the state is ready and it can take the picture
    window.__shotReady = true;
  }

  if (document.readyState === 'complete') {
    applyShot();
  } else {
    window.addEventListener('load', applyShot, { once: true });
  }
})();
