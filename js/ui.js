/**
 * Render layer — the only module allowed to modify the DOM directly.
 *
 * Why DOM operations belong in a single file:
 *   once UI elements are modified from several modules, a display inconsistency is hard to pin
 *   down.
 *   This module exposes only render / flashKey / setBackendStatus to the outside;
 *   the other modules (buttons, keyboard) only work out the state and never touch the DOM.
 *
 * Safety convention: this project uses textContent everywhere and never innerHTML.
 *   Even if an expression contains characters like < >, they are shown as plain text and never
 *   become HTML.
 */

/** @type {HTMLElement} */ const expressionEl = document.getElementById('expression');
/** @type {HTMLElement} */ const resultEl = document.getElementById('result');
/** @type {HTMLElement} */ const messageEl = document.getElementById('message');
/** @type {HTMLElement} */ const keysPanel = document.getElementById('keys');
/** @type {HTMLElement} */ const backendTextEl = document.getElementById('backend-text');

/** Placeholder text for an empty expression (stored in a data attribute and rendered by CSS) */
const PLACEHOLDER = 'Enter an expression';

/**
 * Caret anchor: a zero-width space.
 * Rendering splits the text into two parts around it and inserts the caret element in between —
 * so innerHTML is never needed.
 */
const CARET_ANCHOR = '\u200b';

/**
 * Map the internal expression to its UI form: * → ×, / → ÷, - → − (minus sign).
 * The replacement is display-only and length-preserving, so it does not affect the caret
 * position math.
 * @param {string} text
 * @returns {string}
 */
export function toDisplayText(text) {
  return text.replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '−');
}

/** @type {number} Flash timer, kept so repeated calls do not start several timers */
let flashTimer = 0;

/**
 * Render the whole display.
 * @param {{text: string, cursor: number, message: string, messageType: string}} state
 * @param {{value: string, isPlaceholder: boolean}} display result line content
 */
export function render(state, display) {
  renderExpression(state);
  renderResult(display);
  renderMessage(state.message, state.messageType);
}

/**
 * Render the expression line and the caret. A zero-width space anchors the split, so no innerHTML.
 * @param {{text: string, cursor: number}} state
 */
function renderExpression(state) {
  const shown = toDisplayText(state.text);
  expressionEl.textContent = '';
  expressionEl.classList.toggle('is-empty', shown === '');
  expressionEl.dataset.placeholder = PLACEHOLDER;

  if (shown === '') {
    return;
  }

  const at = Math.max(0, Math.min(state.cursor, shown.length));
  const head = document.createTextNode(shown.slice(0, at));
  const caret = document.createElement('span');
  caret.className = 'screen__caret';
  caret.setAttribute('aria-hidden', 'true');
  caret.textContent = CARET_ANCHOR;
  const tail = document.createTextNode(shown.slice(at));

  expressionEl.append(head, caret, tail);
}

/**
 * Render the result line.
 * @param {{value: string, isPlaceholder: boolean}} display
 */
function renderResult(display) {
  resultEl.textContent = display.value;
  resultEl.classList.toggle('is-placeholder', display.isPlaceholder === true);
}

/**
 * Render the message bar. It turns red when messageType is 'error'.
 * @param {string} message
 * @param {string} messageType
 */
function renderMessage(message, messageType) {
  messageEl.textContent = message;
  messageEl.classList.toggle('is-error', messageType === 'error');
}

/**
 * Make a key flash its "pressed" effect.
 * Purpose: the physical keyboard has no :active pseudo-class, so the script supplies the visual
 *       feedback and "keyboard input" looks the same as "mouse click".
 * @param {string} key
 */
export function flashKey(key) {
  const button = keysPanel.querySelector('[data-key="' + cssEscape(key) + '"]');
  if (!(button instanceof HTMLElement)) {
    return;
  }
  button.classList.add('is-pressed');
  window.clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => {
    button.classList.remove('is-pressed');
  }, 110);
}

/**
 * Highlight the operator currently in effect, or clear all highlighting when there is none.
 * This is something CSS pseudo-classes cannot do: it must stay visible after the mouse moves away.
 * @param {string|null} operator
 */
export function setArmedOperator(operator) {
  const opKeys = keysPanel.querySelectorAll('.key--op, .key--eq');
  opKeys.forEach((button) => {
    button.classList.toggle('is-armed', button.dataset.key === operator);
  });
}

/**
 * Back-end error code → user-facing description.
 * The table lives in the front-end to turn the error code returned by the back-end into plain
 * language; deciding what is valid is always the back-end's job, the front-end only displays it.
 * @type {Record<string, string>}
 */
const SERVER_ERROR_TEXT = {
  INVALID_EXPRESSION: 'Invalid expression. Check the parentheses and operators.',
  DIVISION_BY_ZERO: 'Division by zero is not allowed',
  EXPRESSION_TOO_LONG: 'Expression is too long. Split it up.',
  RECORD_NOT_FOUND: 'This history record does not exist or has already been deleted.',
  BAD_REQUEST: 'Malformed request',
  INTERNAL_ERROR: 'Internal server error. Try again later.',
};

/**
 * Show an error returned by the back-end.
 *
 * Call path: app.js's handleApiError() receives the business error code from the back-end and
 * calls this, which turns the code into text using the table below and resets the result line
 * to the placeholder.
 *   · Why use this table instead of the message the back-end sends directly:
 *     the wording stays centralized, so the front-end does not change appearance whenever the
 *     back-end edits a message.
 *
 * @param {string} errorCode
 */
export function showServerError(errorCode) {
  const text = SERVER_ERROR_TEXT[errorCode] || 'Calculation failed: ' + errorCode;
  renderMessage(text, 'error');
  resultEl.textContent = '—';
  resultEl.classList.add('is-placeholder');
}

/**
 * Update the back-end connection status text in the bottom right corner.
 * @param {string} text
 */
export function setBackendStatus(text) {
  backendTextEl.textContent = text;
}

/**
 * Update the color of the back-end status dot.
 *
 * Three states:
 *   'online'   green dot — back-end available
 *   'offline'  red dot   — cannot reach the back-end
 *   'unknown'  grey dot  — not checked yet
 *
 * Why the dot needs its own function:
 *   text and color are two separate things — the text may change for other reasons,
 *   while the color only reflects connectivity. Kept apart, they do not interfere.
 *
 * @param {'online'|'offline'|'unknown'} state
 */
export function setBackendDot(state) {
  const panel = backendTextEl.closest('.screen__backend');
  if (!(panel instanceof HTMLElement)) {
    return;
  }
  panel.classList.toggle('is-online', state === 'online');
  panel.classList.toggle('is-offline', state === 'offline');
}

// Injection point for the screenshot scripts. It hangs off window rather than living in the
// business code so that "fake data for the demo" stays separate from "real business logic";
// delete this line during integration.
window.__demoServerError = (errorCode) => {
  showServerError(errorCode);
  setBackendStatus('Back-end error response (demo data)');
};

/**
 * Called by the "=" button: give an explicit, honest message on the result line.
 * Until the back-end is connected the front-end produces no calculation result, so this only
 * updates the text.
 * @param {string} message
 */
export function showMessage(message) {
  renderMessage(message, 'hint');
}

/**
 * Escape the special characters in data-key so they can be safely embedded into an attribute
 * selector.
 * @param {string} value
 * @returns {string}
 */
function cssEscape(value) {
  return String(value).replace(/["\\]/g, '\\$&');
}
