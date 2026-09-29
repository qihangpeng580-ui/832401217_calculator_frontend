/**
 * Main controller (app) — wires the modules together and decides "what happens when".
 *
 * This is the only file that knows "how the whole application runs". It is responsible for:
 *
 *   1. checking whether the back-end is online at startup (and showing the status in the bottom
 *      right of the display)
 *   2. on =: call the back-end to calculate → show the result → refresh the history
 *   3. deleting a history record → refresh the list
 *   4. searching and clearing the history
 *   5. injecting the "submit" callback into calc-buttons (to avoid a circular dependency)
 *
 * It is not responsible for:
 *   · whether an expression is valid (input-model owns that)
 *   · how the UI is drawn (ui / history own that)
 *   · how requests are sent (api owns that)
 *
 * There is not a single arithmetic operation in this file. The result always comes from the
 * back-end's result field.
 */

import {
  calculate,
  fetchHistory,
  deleteHistory,
  clearHistory,
  checkHealth,
} from './api.js';
import {
  setBackendStatus,
  setBackendDot,
  showServerError,
} from './ui.js';
import {
  setDeleteHandler,
  setStatus,
  renderList,
  clearList,
} from './history.js';
import { HISTORY_PAGE_SIZE } from './config.js';
import { setSubmitHandler, setResult, setMessage, getExpression } from './calc-buttons.js';

/**
 * Why everything is imported "by name" instead of with `import * as xxx`:
 *   the bundler wraps each module in an IIFE and passes dependencies as function parameters
 *   (of the form `function (calculate, renderList, ...) {...}`).
 *   A module can therefore only use those names; writing calculate(...) would fail to resolve
 *   the name api.
 *   Get this wrong and the whole bundle throws a ReferenceError and the page does nothing at all.
 */

/**
 * Whether the back-end offline warning has already been shown (avoids refreshing the same
 * message on every =)
 */
let warnedOffline = false;

/** Whether a request is in flight (stops repeated = presses from firing several requests) */
let submitting = false;

/** Current search keyword */
let keyword = '';

// ================================================================ Back-end status

/**
 * Check whether the back-end is online and update the status shown in the bottom right corner.
 * @returns {Promise<boolean>}
 */
async function refreshBackendStatus() {
  const online = await checkHealth();

  if (online) {
    setBackendStatus('Back end connected — result computed by the back end');
    setBackendDot('online');
  } else {
    setBackendStatus('Back end not connected — cannot calculate');
    setBackendDot('offline');
  }

  return online;
}

// ================================================================ Calculation flow

/**
 * Submit an expression to the back-end for evaluation.
 *
 * This is the most critical part of the whole front-end: it embodies the assignment's requirement
 * that "the result is produced by the back-end".
 *   The front-end sends the expression **as is** (ASCII form), the back-end computes it and sends
 *   result back, and the front-end only displays it. The front-end never knows what 12+8 equals
 *   unless the back-end tells it.
 *
 * @param {string} expression
 */
async function submit(expression) {
  if (submitting) {
    return; // The previous request has not come back yet; ignore this click
  }

  submitting = true;
  setMessage('Calculating on the back end …', 'hint');
  setResult('Calculating …', true);

  try {
    const data = await calculate(expression);

    // Show the result returned by the back-end.
    // Note that data.result is a **string** (the back-end computes with Decimal, and a string keeps
    // the precision), so it can be displayed directly — the front-end does no numeric conversion.
    setResult(data.result, false);
    setMessage(`${data.expression} = ${data.result}`, 'hint');

    // The back-end already wrote this record to the database while calculating,
    // so re-fetching the list is all it takes to see it here.
    await loadHistory();

    warnedOffline = false;
  } catch (error) {
    handleApiError(error);
  } finally {
    submitting = false;
  }
}

// ================================================================ Error handling

/**
 * Translate an API exception into a message on screen.
 *
 * Division of labour:
 *   · business errors returned by the back-end (INVALID_EXPRESSION / DIVISION_BY_ZERO, etc.)
 *     → use showServerError, which holds a table mapping error codes to user-facing text.
 *       The table is used instead of the message the back-end sends directly so the wording stays
 *       centralized and a back-end wording change does not alter the front-end UI.
 *   · network errors (cannot connect, timeout)
 *     → these are "problems the front-end knows about itself", so show them directly and refresh
 *       the back-end status display.
 *
 * @param {unknown} error
 */
function handleApiError(error) {
  const code = error && typeof error === 'object' && 'code' in error
    ? String(error.code)
    : 'UNKNOWN_ERROR';
  const message = error instanceof Error ? error.message : 'An unknown error occurred';

  if (code === 'NETWORK_ERROR' || code === 'TIMEOUT') {
    setResult('—', true);
    setMessage(message, 'error');
    setBackendStatus('Back end not connected — cannot calculate');
    setBackendDot('offline');

    if (!warnedOffline) {
      // Only warn about starting the back-end the first time it is offline, so the same line is
      // not repeated
      setStatus(
        'History records come from the back-end database. ' +
          'They cannot be read while the back end is unreachable.',
        'error',
      );
      warnedOffline = true;
    }
    return;
  }

  // Business error: the back-end has the final say; the front-end only maps it to text and marks
  // it red
  showServerError(code);
  setMessage(code === 'DIVISION_BY_ZERO' ? 'Division by zero is not allowed' : message, 'error');
}

// ================================================================ History

/**
 * Fetch and render the history list.
 */
async function loadHistory() {
  try {
    const data = await fetchHistory({ limit: HISTORY_PAGE_SIZE, keyword });

    renderList(data.items, data.total);

    if (data.items.length === 0) {
      setStatus(
        keyword
          ? `No records matching "${keyword}"`
          : 'No calculation records yet. Work out an expression and it will appear here.',
      );
    } else if (data.total > data.items.length) {
      setStatus(`Showing the latest ${data.items.length} of ${data.total}`);
    } else {
      setStatus('');
    }
  } catch (error) {
    clearList();
    const message = error instanceof Error ? error.message : 'Could not load the history';
    setStatus('Could not load the history: ' + message, 'error');
  }
}

/**
 * Delete one history record.
 * @param {number} id
 */
async function removeRecord(id) {
  try {
    await deleteHistory(id);
    await loadHistory();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Delete failed';
    setStatus('Delete failed: ' + message, 'error');
    // Refresh on failure too, to restore the delete label from the "…" on the button
    await loadHistory();
  }
}

/**
 * Clear the whole history.
 */
async function clearAll() {
  if (window.confirm('Clear all history? This cannot be undone.') !== true) {
    return;
  }

  try {
    const data = await clearHistory();
    await loadHistory();
    setStatus(`Cleared ${data.deleted} records`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Clear failed';
    setStatus('Clear failed: ' + message, 'error');
  }
}

// ================================================================ Event binding

/**
 * Bind the search box and the clear button in the history panel.
 *
 * The search is debounced: sending a request on every keystroke is wasteful and responses could
 * come back out of order. Wait 300 milliseconds after the user stops typing.
 */
function bindHistoryControls() {
  const input = document.getElementById('history-keyword');
  const clearButton = document.getElementById('history-clear');

  if (input instanceof HTMLInputElement) {
    let debounceTimer = 0;
    input.addEventListener('input', () => {
      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        keyword = input.value.trim();
        loadHistory();
      }, 300);
    });
  }

  if (clearButton instanceof HTMLElement) {
    clearButton.addEventListener('click', clearAll);
  }
}

// ================================================================ Compatibility interface (for
// automated tests)

/**
 * Read-only debug interface — lets the automated tests observe internal state.
 *
 * Why it is needed: the tests must be able to tell whether the result line shows a value
 * returned by the back-end or one the front-end computed itself. Only reads are exposed, with
 * no write path, so it is not a backdoor around validation.
 */
function exposeDebugApi() {
  Object.defineProperty(window, '__app', {
    configurable: true,
    value: {
      getExpression,
      /** Re-check the back-end status (used in tests to wait until the back-end is ready) */
      refreshBackendStatus,
      /** Manually trigger one history refresh */
      reloadHistory: loadHistory,
      /** Back-end URL, so tests can assert that the config is read correctly */
      apiBaseUrl: API_BASE_URL_FOR_TEST,
    },
  });
}

// ================================================================ Startup

/**
 * Start the application.
 *
 * The order matters:
 *   1. inject the submit callback first — otherwise pressing = before the status check finishes
 *      does nothing
 *   2. bind the controls in the history panel
 *   3. then make the network requests (check the back-end, fetch the history);
 *      those two run in parallel and do not wait for each other — the UI stays usable when the
 *      back-end is slow.
 */
function boot() {
  setSubmitHandler(submit);
  setDeleteHandler(removeRecord);
  bindHistoryControls();
  exposeDebugApi();

  // Both network requests are fired in parallel rather than awaiting one before the other,
  // saving a round trip
  refreshBackendStatus();
  loadHistory();
}
