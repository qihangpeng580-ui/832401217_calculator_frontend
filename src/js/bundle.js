/**
 * Generated file — do not edit by hand.
 * Produced by tools/build-bundle.mjs from the ES modules under src/js/.
 * To change behaviour, edit the source files and run: node tools/build-bundle.mjs
 *
 * Why it exists: a browser does not execute ES modules on a file:// page,
 * so opening index.html by double-click would be completely inert. Bundling
 * everything into a classic script makes the double-click work.
 */
(function () {
  'use strict';

  /* ===== source file: src/js/config.js (generated, do not edit by hand) ===== */
  const config = (function () {
/**
 * Config layer — every piece of "outside world" information the front-end needs lives here.
 *
 * Why a separate file:
 *   the back-end address differs between development, deployment and demonstration.
 *   Scattered across the code, it would mean searching every file before a release.
 *   Kept in one place, one line is enough.
 *
 * Change this before deploying ↑
 */

/**
 * Back-end service address (no trailing slash).
 *
 * Values:
 *   · Local development: 'http://127.0.0.1:8000'   ← front-end and back-end both on this machine
 *   · After deployment:  the back-end's public address, e.g. 'https://xxx.example.com'
 *
 * Special case:
 *   when front-end and back-end are deployed **same-origin** (same domain and port) this can be
 *   the empty string '', so requests go to /api/... instead of cross-origin — and CORS is a
 *   non-issue.
 */
const API_BASE_URL = 'http://127.0.0.1:8000';

/**
 * Timeout for a single request (milliseconds).
 *
 * Why a timeout is required:
 *   when the back-end is down, the browser's fetch hangs and never returns by default,
 *   so after the user presses = the UI stays on "calculating" forever and looks frozen.
 *   Only with a timeout can we show a clear "cannot reach the back-end" message.
 */
const REQUEST_TIMEOUT_MS = 8000;

/**
 * How many history records to fetch at a time.
 */
const HISTORY_PAGE_SIZE = 20;

/**
 * Maximum length of each expression shown in the history list (longer ones are truncated with
 * an ellipsis).
 * Keeps a single very long expression from breaking the list layout.
 */
const HISTORY_EXPRESSION_MAX_LENGTH = 28;

  return { API_BASE_URL, REQUEST_TIMEOUT_MS, HISTORY_PAGE_SIZE, HISTORY_EXPRESSION_MAX_LENGTH };
  })();

  /* destructure config's exports into the bundling scope so later modules can reference them by name */
  const { API_BASE_URL, REQUEST_TIMEOUT_MS, HISTORY_PAGE_SIZE, HISTORY_EXPRESSION_MAX_LENGTH } = config;

  /* ===== source file: src/js/api.js (generated, do not edit by hand) ===== */
  const api = (function (API_BASE_URL, REQUEST_TIMEOUT_MS) {
/**
 * API client — the only place in the front-end that talks to the back-end.
 *
 * Design principles:
 *   1. **The front-end never computes**. Every function in this file just sends, receives and
 *      translates; there is not a single arithmetic operation here. Results and errors are
 *      decided by the back-end.
 *   2. **All network details stay inside this file**. Other modules do not know that fetch or
 *      HTTP status codes exist; they only see "data received successfully" or "an exception
 *      with an error code was thrown". Switching to XMLHttpRequest or WebSocket later would
 *      only require changes here.
 *   3. **All errors are normalized into ApiError**. Callers only need to inspect error.code and
 *      do not care whether the network failed, the request timed out, or the back-end returned
 *      a business error.
 */

/**
 * Unified API exception.
 *
 * code values:
 *   · business error code returned by the back-end, e.g. 'INVALID_EXPRESSION', 'DIVISION_BY_ZERO'
 *   · front-end generated 'NETWORK_ERROR' (cannot connect), 'TIMEOUT' (timed out),
 *     'BAD_RESPONSE' (malformed response)
 */
class ApiError extends Error {
  /**
   * @param {string} code error code
   * @param {string} message user-facing description
   * @param {number} [status] HTTP status code (for business errors)
   */
  constructor(code, message, status) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Send one request and return the data part of the response body.
 *
 * @param {string} path API path, e.g. '/api/calculate'
 * @param {{method?: string, body?: object}} [options]
 * @returns {Promise<any>} data returned by the back-end
 * @throws {ApiError} any failure
 */
async function request(path, options = {}) {
  const method = options.method || 'GET';
  const url = API_BASE_URL + path;

  // Timeout implemented with AbortController.
  // Why not fetch's built-in signal timeout option: it is not widely supported yet,
  // while AbortController is the standard approach with better compatibility.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const init = {
    method,
    signal: controller.signal,
    headers: { Accept: 'application/json' },
  };

  if (options.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }

  let response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    // fetch only throws when the network layer fails (cannot connect, timeout, blocked by CORS,
    // DNS failure)
    if (error && error.name === 'AbortError') {
      throw new ApiError(
        'TIMEOUT',
        `Request timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds. ` +
          'Check the back-end service.',
      );
    }
    throw new ApiError(
      'NETWORK_ERROR',
      'Cannot reach the back-end service. Make sure it is running.',
    );
  } finally {
    clearTimeout(timer);
  }

  // 204 No Content (successful deletion) has no response body, so return right away
  if (response.status === 204) {
    return null;
  }

  // Parse the response body. Even for an error status the back-end returns JSON explaining
  // the reason, so read the body first and decide how to handle it afterwards.
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(
      'BAD_RESPONSE',
      `The back-end response is not valid JSON (HTTP ${response.status})`,
      response.status,
    );
  }

  if (response.ok && payload && payload.success === true) {
    return payload.data;
  }

  // Reaching this point means it is an error. Prefer the error code and message from the back-end —
  // the back-end's judgement is authoritative (the front-end does not validate expressions itself).
  const code = (payload && payload.errorCode) || 'UNKNOWN_ERROR';
  const message = (payload && payload.message) || `Request failed (HTTP ${response.status})`;
  throw new ApiError(code, message, response.status);
}

/**
 * Submit an expression to the back-end for evaluation.
 *
 * This is the only place in the whole front-end that asks for a result.
 * The front-end never computes one itself.
 *
 * @param {string} expression expression in ASCII form (* / - instead of × ÷ −)
 * @returns {Promise<{expression: string, result: string, resultNumber: number}>}
 * @throws {ApiError}
 */
async function calculate(expression) {
  return request('/api/calculate', {
    method: 'POST',
    body: { expression },
  });
}

/**
 * Fetch the history records.
 *
 * @param {{limit?: number, keyword?: string}} [options]
 * @returns {Promise<{items: Array, total: number, limit: number, keyword: string}>}
 * @throws {ApiError}
 */
async function fetchHistory(options = {}) {
  const params = new URLSearchParams();
  if (options.limit) {
    params.set('limit', String(options.limit));
  }
  if (options.keyword) {
    params.set('keyword', options.keyword);
  }

  const query = params.toString();
  return request('/api/history' + (query ? '?' + query : ''));
}

/**
 * Delete one history record.
 *
 * @param {number} id
 * @returns {Promise<void>}
 * @throws {ApiError} code is 'RECORD_NOT_FOUND' when the record does not exist
 */
async function deleteHistory(id) {
  await request('/api/history/' + encodeURIComponent(String(id)), { method: 'DELETE' });
}

/**
 * Clear the whole history.
 *
 * @returns {Promise<{deleted: number}>}
 * @throws {ApiError}
 */
async function clearHistory() {
  return request('/api/history', { method: 'DELETE' });
}

/**
 * Health check — used to tell whether the back-end is online.
 *
 * Why not reuse another endpoint:
 *   this one touches no database and does no computation, so it always answers instantly,
 *   which makes it suitable for quickly telling "is the back-end there" right after the page opens.
 *
 * @returns {Promise<boolean>} whether the back-end is available
 */
async function checkHealth() {
  try {
    await request('/api/health');
    return true;
  } catch {
    // A failed health check is not an "error", just a state, so no exception is thrown.
    // The caller uses it to switch the status pill to "back-end not connected".
    return false;
  }
}

/**
 * The back-end URL currently in use (read-only; lets automated tests assert that the config is
 * read correctly).
 *
 * Why export it: the tests need to confirm which address the front-end actually sends requests to.
 * The most common deployment failure is a wrong address, and it is completely invisible in the UI.
 */
const API_BASE_URL_FOR_TEST = API_BASE_URL;

  return { ApiError, calculate, fetchHistory, deleteHistory, clearHistory, checkHealth, API_BASE_URL_FOR_TEST };
  })(API_BASE_URL, REQUEST_TIMEOUT_MS);

  /* destructure api's exports into the bundling scope so later modules can reference them by name */
  const { ApiError, calculate, fetchHistory, deleteHistory, clearHistory, checkHealth, API_BASE_URL_FOR_TEST } = api;

  /* ===== source file: src/js/input-model.js (generated, do not edit by hand) ===== */
  const model = (function () {
/**
 * Expression buffer — the calculator's input model.
 *
 * Responsibility boundary (important):
 *   This module only does **string-level input validation and assembly**;
 *   it does not parse, evaluate, or produce any calculation result.
 *   The assignment explicitly requires the final result to come from the back-end,
 *   so not even a single `+` operation is allowed here, let alone eval/Function.
 *
 * Cursor model: an expression is a piece of text plus an insertion position cursor
 * (0..text.length).
 *   To keep the implementation simple, this version always appends input at the end and
 *   deletes from the end on backspace, so cursor always equals text.length — the field is kept
 *   so that adding "insert in the middle" later will not require rewriting callers.
 *
 * @typedef {object} BufferState
 * @property {string} text           Expression text; uses * / and - internally, mapped to × ÷ −
 *                                   in the UI
 * @property {number} cursor         Insertion position
 * @property {string} message        Message shown to the user (empty string when normal)
 * @property {string} messageType    'hint' | 'error'
 */

/** Whitelist of characters allowed inside an expression */
const ALLOWED_CHARS = '0123456789.+-*/()';

/** Arithmetic operators */
const OPERATORS = '+-*/';

/** Maximum expression length, to prevent meaningless oversized input */
const MAX_LENGTH = 60;

/** The four operators, used for the "swap key" behavior of operator keys */
const OPERATOR_SET = ['+', '-', '*', '/'];

/**
 * Create a new empty buffer state.
 * @returns {BufferState}
 */
function createState() {
  return { text: '', cursor: 0, message: '', messageType: 'hint' };
}

/**
 * Return a copy of the state carrying a message (pure function, does not mutate the original).
 * @param {BufferState} state
 * @param {string} message
 * @param {string} [messageType]
 * @returns {BufferState}
 */
function withMessage(state, message, messageType = 'hint') {
  return { ...state, message, messageType };
}

/**
 * Build an "input rejected" state: the text is unchanged, only a message is attached.
 * Every validation failure goes through here, so "reject input" has exactly one implementation.
 * @param {BufferState} state
 * @param {string} message
 * @returns {BufferState}
 */
function reject(state, message) {
  return withMessage(state, message, 'error');
}

/** @param {string} ch */
function isDigit(ch) {
  return ch >= '0' && ch <= '9';
}

/** @param {string} ch */
function isOperator(ch) {
  return OPERATORS.includes(ch);
}

/** @param {BufferState} state */
function lastChar(state) {
  return state.text.slice(-1);
}

/**
 * Take the trailing run of digits/decimal point, e.g. '12+3.5' → '3.5' (empty string if none).
 * @param {string} text
 * @returns {string}
 */
function trailingNumber(text) {
  const match = text.match(/[0-9.]+$/);
  return match ? match[0] : '';
}

/**
 * Check whether a segment is a valid number: at least one digit and at most one decimal point.
 * @param {string} segment
 * @returns {boolean}
 */
function isNumberSegment(segment) {
  return /^\d+(\.\d+)?$/.test(segment) || /^\d+\.$/.test(segment);
}

/**
 * Check whether parentheses are balanced (left count >= right count means "still valid so far").
 * @param {string} text
 * @returns {{depth: number, balanced: boolean}}
 */
function parenInfo(text) {
  let depth = 0;
  let balanced = true;
  for (const ch of text) {
    if (ch === '(') {
      depth += 1;
    } else if (ch === ')') {
      depth -= 1;
      if (depth < 0) {
        balanced = false;
        depth = 0;
      }
    }
  }
  return { depth, balanced };
}

/**
 * Used by "=": decide whether the current expression "can be submitted to the back-end".
 * Only covers what the front-end can judge responsibly: non-empty, balanced parentheses,
 * and not ending with an operator or a decimal point.
 * @param {string} text
 * @returns {{ok: true} | {ok: false, message: string}}
 */
function canSubmit(text) {
  if (text === '') {
    return { ok: false, message: 'Enter an expression' };
  }
  const { depth } = parenInfo(text);
  if (depth !== 0) {
    return { ok: false, message: 'Unbalanced parentheses: ' + depth + ' left unclosed' };
  }
  const last = text.slice(-1);
  if (isOperator(last)) {
    return { ok: false, message: 'Incomplete expression: it ends with an operator' };
  }
  if (last === '.') {
    return { ok: false, message: 'Incomplete expression: no digits after the decimal point' };
  }
  if (last === '(') {
    return { ok: false, message: 'Incomplete expression: nothing after the left parenthesis' };
  }
  return { ok: true };
}

/**
 * Digit key: append one digit.
 * @param {BufferState} state
 * @param {string} digit
 * @returns {BufferState}
 */
function inputDigit(state, digit) {
  if (state.text.length >= MAX_LENGTH) {
    return reject(state, 'Expression is limited to ' + MAX_LENGTH + ' characters');
  }
  // A number must not start with 0 (except '0' itself); e.g. pressing 5 right after 0 gives
  // "05", which is a typo
  if (lastChar(state) === '0' && trailingNumber(state.text) === '0' && digit !== '.') {
    return reject(state, 'A number cannot start with 0');
  }
  return withMessage(
    { ...state, text: state.text + digit, cursor: state.text.length + 1 },
    'Press = to calculate on the back end',
  );
}

/**
 * Decimal point: at most one per number.
 * @param {BufferState} state
 * @returns {BufferState}
 */
function inputDot(state) {
  if (state.text.length >= MAX_LENGTH) {
    return reject(state, 'Expression is limited to ' + MAX_LENGTH + ' characters');
  }
  if (trailingNumber(state.text).includes('.')) {
    return reject(state, 'A number can have only one decimal point');
  }
  if (lastChar(state) === ')') {
    return reject(state, 'A decimal point cannot follow a right parenthesis');
  }
  const prefix = trailingNumber(state.text) === '' ? '0' : '';
  return withMessage(
    { ...state, text: state.text + prefix + '.', cursor: state.text.length + prefix.length + 1 },
    'Typing a decimal number',
  );
}

/**
 * Arithmetic operator: a run of consecutive operators may contain only one minus sign
 * (to express a negative number).
 * @param {BufferState} state
 * @param {string} operator
 * @returns {BufferState}
 */
function inputOperator(state, operator) {
  const last = lastChar(state);

  if (state.text === '') {
    if (operator === '-') {
      return withMessage({ ...state, text: '-', cursor: 1 }, 'Typing a negative number');
    }
    return reject(state, 'An expression cannot start with ' + operator);
  }

  // Consecutive operators: replace the operator just entered instead of appending another one.
  // This is typical behavior in real calculators, and it also settles the "consecutive
  // operators" legality problem.
  if (isOperator(last)) {
    if (operator === '-' && last !== '-') {
      return withMessage(
        { ...state, text: state.text + '-' },
        'The minus here means a negative number, as in 3*-2',
      );
    }
    const swapped = state.text.slice(0, -1) + operator;
    return withMessage({ ...state, text: swapped }, 'Changed to ' + operator);
  }

  if (last === '(') {
    if (operator === '-') {
      return withMessage(
        { ...state, text: state.text + '-' },
        'Negative number inside the parentheses',
      );
    }
    return reject(state, 'An operator cannot follow a left parenthesis');
  }

  if (last === '.') {
    return reject(state, 'Enter a digit after the decimal point');
  }

  return withMessage(
    { ...state, text: state.text + operator, cursor: state.text.length + 1 },
    'Keep typing digits or use parentheses',
  );
}

/**
 * Left parenthesis: when it follows a digit or a right parenthesis, an implicit multiplication
 * sign is inserted.
 * @param {BufferState} state
 * @returns {BufferState}
 */
function inputLeftParen(state) {
  if (state.text.length >= MAX_LENGTH) {
    return reject(state, 'Expression is limited to ' + MAX_LENGTH + ' characters');
  }
  const last = lastChar(state);
  const needsMultiply = isDigit(last) || last === ')' || last === '.';
  const addition = needsMultiply ? '*(' : '(';
  return withMessage(
    { ...state, text: state.text + addition, cursor: state.text.length + addition.length },
    needsMultiply
      ? 'Inserted a multiplication sign between the number and the parenthesis'
      : 'A sub-expression can go inside the parentheses',
  );
}

/**
 * Right parenthesis: an unclosed left parenthesis must exist, and it must not directly follow
 * an operator or a left parenthesis.
 * @param {BufferState} state
 * @returns {BufferState}
 */
function inputRightParen(state) {
  const { depth } = parenInfo(state.text);
  if (depth === 0) {
    return reject(state, 'No matching left parenthesis');
  }
  const last = lastChar(state);
  if (isOperator(last) || last === '(') {
    return reject(state, 'Missing a number before the right parenthesis');
  }
  return withMessage(
    { ...state, text: state.text + ')', cursor: state.text.length + 1 },
    depth === 1 ? 'Parenthesis closed' : 'Left parentheses still open: ' + (depth - 1),
  );
}

/**
 * Negation is always written in the parenthesized form (-number) rather than inserting a bare '-'.
 * Reason: although '5+-3' is accepted by most parsers, its meaning depends on parser leniency;
 *      '5+(-3)' is unambiguous for any back-end parser.
 * @param {BufferState} state
 * @returns {BufferState}
 */
function toggleSign(state) {
  const text = state.text;

  // Case 1: the tail is (-number) — the inverse operation, dropping both the parentheses and
  // the minus sign
  const wrapped = text.match(/\(-(\d+(?:\.\d+)?)\)$/);
  if (wrapped) {
    const next = text.slice(0, wrapped.index) + wrapped[1];
    return withMessage(
      { ...state, text: next, cursor: next.length },
      'Minus sign removed',
    );
  }

  // Case 2: the tail is a plain number — wrap it in parentheses and add a minus sign
  const tail = trailingNumber(text);
  if (tail === '' || !isNumberSegment(tail)) {
    return reject(state, 'Enter a complete number before pressing ±');
  }

  const before = text.slice(0, text.length - tail.length);
  const next = before + '(-' + tail + ')';
  if (next.length > MAX_LENGTH) {
    return reject(state, 'Expression is limited to ' + MAX_LENGTH + ' characters');
  }
  return withMessage(
    { ...state, text: next, cursor: next.length },
    'Negated (wrapped in parentheses to avoid ambiguity)',
  );
}

/**
 * Backspace: delete one character from the end.
 * @param {BufferState} state
 * @returns {BufferState}
 */
function backspace(state) {
  if (state.text === '') {
    return withMessage(state, 'Already empty');
  }
  // For a tail like ...(-5), deleting the whole parenthesized group in one backspace is more
  // intuitive
  const trimmed = state.text.replace(/\(-\d+(\.\d+)?\)$/, (match) => match.slice(2, -1));
  const next = trimmed === state.text ? state.text.slice(0, -1) : trimmed;
  return withMessage({ ...state, text: next, cursor: next.length }, '');
}

/**
 * Clear.
 * @returns {BufferState}
 */
function clear() {
  return withMessage(createState(), 'Cleared');
}

/**
 * Single entry point: apply one "key semantic" to the buffer state (pure function, does not
 * mutate the original).
 *
 * Every kind of input goes through this one function because mouse clicks and the physical keyboard
 * must follow the same rule set; as long as both call applyKey, a key can never be legal on
 * one path and illegal on the other.
 *
 * @param {BufferState} state
 * @param {string} key  digit, '.', '+ - * /', '(' ')', 'AC', 'BACK', 'NEG'
 * @returns {BufferState}
 */
function applyKey(state, key) {
  if (typeof key !== 'string' || key === '') {
    return state;
  }

  if (key === 'AC') {
    return clear();
  }
  if (key === 'BACK') {
    return backspace(state);
  }
  if (key === 'NEG') {
    return toggleSign(state);
  }
  if (key === ')') {
    return inputRightParen(state);
  }
  if (key === '(') {
    return inputLeftParen(state);
  }
  if (key === '.') {
    return inputDot(state);
  }
  if (key.length === 1 && isDigit(key)) {
    return inputDigit(state, key);
  }
  if (key.length === 1 && OPERATOR_SET.includes(key)) {
    return inputOperator(state, key);
  }
  return reject(state, 'Unsupported key: ' + key);
}

  return { ALLOWED_CHARS, OPERATORS, MAX_LENGTH, createState, trailingNumber, isNumberSegment, parenInfo, canSubmit, applyKey };
  })();

  /* destructure model's exports into the bundling scope so later modules can reference them by name */
  const { ALLOWED_CHARS, OPERATORS, MAX_LENGTH, createState, trailingNumber, isNumberSegment, parenInfo, canSubmit, applyKey } = model;

  /* ===== source file: src/js/ui.js (generated, do not edit by hand) ===== */
  const ui = (function () {
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
function toDisplayText(text) {
  return text.replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '−');
}

/** @type {number} Flash timer, kept so repeated calls do not start several timers */
let flashTimer = 0;

/**
 * Render the whole display.
 * @param {{text: string, cursor: number, message: string, messageType: string}} state
 * @param {{value: string, isPlaceholder: boolean}} display result line content
 */
function render(state, display) {
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
function flashKey(key) {
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
function setArmedOperator(operator) {
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
function showServerError(errorCode) {
  const text = SERVER_ERROR_TEXT[errorCode] || 'Calculation failed: ' + errorCode;
  renderMessage(text, 'error');
  resultEl.textContent = '—';
  resultEl.classList.add('is-placeholder');
}

/**
 * Update the back-end connection status text in the bottom right corner.
 * @param {string} text
 */
function setBackendStatus(text) {
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
function setBackendDot(state) {
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
function showMessage(message) {
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

  return { toDisplayText, render, flashKey, setArmedOperator, setBackendStatus, setBackendDot, showMessage, showServerError };
  })();

  /* destructure ui's exports into the bundling scope so later modules can reference them by name */
  const { toDisplayText, render, flashKey, setArmedOperator, setBackendStatus, setBackendDot, showMessage, showServerError } = ui;

  /* ===== source file: src/js/history.js (generated, do not edit by hand) ===== */
  const history = (function (HISTORY_EXPRESSION_MAX_LENGTH) {
/**
 * History rendering layer — draws the history list returned by the back-end into the card on
 * the right.
 *
 * Like ui.js, this module is "dumb": it only displays the data handed to it and never issues
 * requests itself. Requesting is app.js's job.
 *
 * Why split it this way:
 *   putting fetch in here too would mean "a render function secretly makes network requests",
 *   tests could not run without a back-end, and the question of "when to refresh" would be
 *   scattered everywhere. Split apart, app.js decides refresh timing in one place.
 *
 * The delete button uses event delegation — the same idea as the keypad:
 *   the whole list carries **exactly one** click listener.
 *   The reason is the same: list items are created dynamically and pagination may be added later,
 *   so binding a listener per item is both wasteful and easy to get wrong.
 */

/** @type {HTMLElement} */ const listEl = document.getElementById('history-list');
/** @type {HTMLElement} */ const statusEl = document.getElementById('history-status');
/** @type {HTMLElement} */ const countEl = document.getElementById('history-count');

/**
 * Delete callback, injected by app.js.
 * @type {(id: number) => void}
 */
let onDelete = () => {};

/**
 * Set the delete callback.
 * @param {(id: number) => void} handler
 */
function setDeleteHandler(handler) {
  onDelete = handler;
}

/**
 * Convert the UI symbols back to ASCII, used to display operators in the history.
 * In the history we show the ASCII form exactly as the user typed it (the form sent to the
 * back-end), but for readability * / - are rendered as × ÷ − to match the calculator display.
 * @param {string} text
 * @returns {string}
 */
function toDisplay(text) {
  return String(text)
    .replace(/\*/g, '×')
    .replace(/\//g, '÷')
    .replace(/-/g, '−');
}

/**
 * Trim an ISO timestamp down to "MM-DD HH:MM".
 *
 * Why not just use new Date().toLocaleString():
 *   that follows the system locale, so different machines display it differently and the
 *   screenshots would not match the blog post. Trimming by hand keeps it consistent everywhere.
 * @param {string} iso
 * @returns {string}
 */
function formatTime(iso) {
  const text = String(iso || '');
  // Format looks like 2026-09-29T15:20:11
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) {
    return text;
  }
  return `${match[2]}-${match[3]} ${match[4]}:${match[5]}`;
}

/**
 * Truncate an over-long expression so it cannot break the list layout.
 * @param {string} text
 * @returns {string}
 */
function truncate(text) {
  const value = String(text);
  if (value.length <= HISTORY_EXPRESSION_MAX_LENGTH) {
    return value;
  }
  return value.slice(0, HISTORY_EXPRESSION_MAX_LENGTH - 1) + '…';
}

/**
 * Set the status text (empty list, loading and errors all go through here).
 * @param {string} text
 * @param {'info'|'error'} [type]
 */
function setStatus(text, type = 'info') {
  statusEl.textContent = text;
  statusEl.classList.toggle('is-error', type === 'error');
}

/**
 * Render the history list.
 *
 * @param {Array<{id: number, expression: string, result: string, createdAt: string}>} items
 * @param {number} total total count reported by the back-end (may exceed the number currently
 *   displayed)
 */
function renderList(items, total) {
  listEl.textContent = '';

  // Item count at the top
  if (total > items.length) {
    countEl.textContent = `Showing ${items.length} of ${total}`;
  } else {
    countEl.textContent = total > 0 ? `Total: ${total}` : '';
  }

  if (items.length === 0) {
    return;
  }

  // Insert everything at once with a DocumentFragment: avoids triggering a page reflow for
  // every item.
  // The difference is invisible on a short list, but it is a good habit and this comment
  // explains why.
  const fragment = document.createDocumentFragment();

  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'history__item';
    li.dataset.id = String(item.id);

    const main = document.createElement('div');
    main.className = 'history__main';

    const expression = document.createElement('p');
    expression.className = 'history__expression';
    // textContent everywhere, never innerHTML — the expression is user input and
    //   may contain characters like < >; textContent is naturally immune to XSS.
    expression.textContent = truncate(toDisplay(item.expression));
    expression.title = item.expression; // Show the full expression on hover

    const result = document.createElement('p');
    result.className = 'history__result';
    result.textContent = '= ' + toDisplay(item.result);

    main.append(expression, result);

    const meta = document.createElement('div');
    meta.className = 'history__meta';

    const time = document.createElement('time');
    time.className = 'history__time';
    time.dateTime = item.createdAt;
    time.textContent = formatTime(item.createdAt);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'history__delete';
    remove.dataset.deleteId = String(item.id);
    remove.title = 'Delete this record';
    remove.textContent = 'Delete';
    remove.setAttribute('aria-label', `Delete record ${item.expression}`);

    meta.append(time, remove);
    li.append(main, meta);
    fragment.append(li);
  }

  listEl.append(fragment);
}

/**
 * Clear the list (used on error to wipe stale content instead of showing outdated data).
 */
function clearList() {
  listEl.textContent = '';
  countEl.textContent = '';
}

// ---------------------------------------------------------------- Event delegation
//
// The whole list carries a single listener.
// List items are created dynamically by renderList, so the listener must sit on the
// **parent** element — which is exactly the typical use case for event delegation.
listEl.addEventListener('click', (event) => {
  const button = event.target instanceof Element ? event.target.closest('[data-delete-id]') : null;
  if (!(button instanceof HTMLElement) || !listEl.contains(button)) {
    return;
  }

  const id = Number(button.dataset.deleteId);
  if (!Number.isFinite(id)) {
    return;
  }

  // Visual feedback while deleting: disable the button so a double click cannot fire twice
  button.disabled = true;
  button.textContent = '…';

  onDelete(id);
});

  return { setDeleteHandler, setStatus, renderList, clearList };
  })(HISTORY_EXPRESSION_MAX_LENGTH);

  /* destructure history's exports into the bundling scope so later modules can reference them by name */
  const { setDeleteHandler, setStatus, renderList, clearList } = history;

  /* ===== source file: src/js/calc-buttons.js (generated, do not edit by hand) ===== */
  const buttons = (function (createState, applyKey, canSubmit, render, setArmedOperator, flashKey) {
/**
 * Event-driven core — button interaction and event delegation.
 *
 * This file answers the question the class explicitly asked about: **how events drive the UI**.
 *
 * Approach: the whole keypad (#keys) registers **one** single click listener.
 *   - not one onclick per each of the 21 keypad buttons;
 *   - and no global document.onclick either.
 *
 * Why event delegation instead of "bind a handler to every button":
 *   1. One entry point. Every key ends up in the same handleKey, so a rule cannot be missed on
 *      one button.
 *   2. Adding a key needs no code change. To add √ or x² later, just add a button with data-key
 *      in the HTML.
 *   3. It survives dynamic rendering. If keys later come from back-end config or are generated
 *      by JS, the listener still works — because it listens on the parent element and events
 *      "bubble" up from the children.
 *   4. Less memory. 21 listeners become 1.
 *   The cost: the handler must use closest() to work out "what was actually clicked".
 */


/**
 * Why individual functions are imported here instead of `import * as ui`:
 *   the bundler (tools/build-bundle.mjs) wraps each module in an IIFE and passes dependencies
 *   as **function parameters** (of the form `function (render, flashKey) {...}`).
 *   A module can therefore only use those names; writing render(...) would fail to resolve the
 *   name ui.
 *   Get this wrong at bundle time and the whole bundle throws a ReferenceError and the page does
 *   nothing at all.
 */

/** The front-end's own state: the expression buffer */
let state = createState();

/**
 * Current content of the result line.
 *
 * Why it lives here instead of being a hard-coded constant:
 *   after integration the result line shows "the result returned by the back-end" or
 *   "calculation failed", so it changes. app.js updates it through setResult.
 *
 * What isPlaceholder does: when true the text is small and grey, visually distinguishing it from a
 * real result (the user can tell at a glance that this is a hint, not an answer).
 */
let display = { value: '—', isPlaceholder: true };

/**
 * The "submit calculation" callback, injected by app.js.
 *
 * Why injection rather than importing app.js directly here:
 *   if calc-buttons imported app while app needed to call calc-buttons' entry point, that would
 *   create a circular dependency. With injection the dependency is one-way: app → calc-buttons.
 *   There is a second benefit: a test can pass in a fake submit function and does not need a
 *   real back-end.
 *
 * @type {(expression: string) => void}
 */
let onSubmit = () => {};

/**
 * Set the submit callback.
 * @param {(expression: string) => void} handler
 */
function setSubmitHandler(handler) {
  onSubmit = handler;
}

/**
 * Update the result line.
 * @param {string} value text to display
 * @param {boolean} [isPlaceholder] whether this is a placeholder hint (rather than a real result)
 */
function setResult(value, isPlaceholder = false) {
  display = { value, isPlaceholder };
  render(state, display);
}

/**
 * Read the current expression (ASCII form).
 * @returns {string}
 */
function getExpression() {
  return state.text;
}

/**
 * The single key handling entry point.
 * Mouse clicks, the physical keyboard, and any future input source must call it.
 *
 * @param {string} key key semantic, see applyKey in input-model.js
 * @param {{flash?: boolean}} [options] when flash=true the key flashes (used by the physical
 *   keyboard)
 */
function handleKey(key, options = {}) {
  state = applyKey(state, key);

  // Keep the highlight only when the expression really ends with an operator; clear all
  // highlighting when input was rejected
  const armed = isOperatorKey(key) ? lastOperator(state.text) : null;

  render(state, display);
  setArmedOperator(armed);
  if (options.flash === true) {
    flashKey(key);
  }
}

/**
 * Whether this is an arithmetic operator key.
 * @param {string} key
 * @returns {boolean}
 */
function isOperatorKey(key) {
  return '+-*/'.includes(key) && key.length === 1;
}

/**
 * Take the operator at the end of the expression (null when the last character is not an operator).
 * @param {string} text
 * @returns {string|null}
 */
function lastOperator(text) {
  const last = text.slice(-1);
  return '+-*/'.includes(last) ? last : null;
}

/**
 * Handling for "=": run the input validation the front-end is responsible for first, then hand
 * off to the back-end.
 *
 * There is **no, and never will be any calculation** here. The assignment's hard requirement is
 *   "the final result must be produced by the back-end and returned to the front-end", so this
 *   step does exactly two things:
     1. block errors the front-end **can be certain about** (empty expression, unclosed
        parentheses, trailing operator) —
        such errors are not worth wasting a network request on;
     2. hand the expression to onSubmit (injected by app.js), which calls the back-end API.
 *
 * Why the front-end only blocks what it "can be certain about":
 *   syntax and semantics are the back-end's call. If the front-end judged them as well and the two
 *   rule sets ever diverged, we would get contradictions like "the front-end says invalid,
 *   the back-end says valid".
 */
function evaluate() {
  const check = canSubmit(state.text);

  if (!check.ok) {
    // An error the front-end can be certain about: show a hint only, send no request
    state = { ...state, message: check.message, messageType: 'error' };
    render(state, display);
    setArmedOperator(null);
    return;
  }

  // Hand it to the back-end. Note that display is **not** touched here —
  // app.js updates the result line through setResult once the back-end responds.
  onSubmit(state.text);
  setArmedOperator(null);
}

/**
 * Update the message bar text (called by app.js while a request is in flight and after it fails).
 * @param {string} message
 * @param {'hint'|'error'} [messageType]
 */
function setMessage(message, messageType = 'hint') {
  state = { ...state, message, messageType };
  render(state, display);
}

/**
 * Dispatch the action by data-key. This is the "dispatch center" of event delegation.
 * @param {string} key
 */
function dispatch(key) {
  if (key === '=') {
    evaluate();
    return;
  }
  handleKey(key);
}

// ---------------------------------------------------------------- Event delegation
const keysEl = document.getElementById('keys');

keysEl.addEventListener('click', (event) => {
  // Walk up from the real click target to the nearest button carrying data-key.
  // That way a click on a text node inside the button still resolves to the button.
  const button = event.target instanceof Element ? event.target.closest('[data-key]') : null;
  if (!(button instanceof HTMLElement) || !keysEl.contains(button)) {
    return;
  }
  dispatch(button.dataset.key);

  // After a mouse click the browser leaves focus on the button, so pressing Enter would
  // retrigger it.
  // Move focus back to the keypad container to avoid the odd "Enter repeats the last key" behavior.
  keysEl.focus({ preventScroll: true });
});

// The keypad container must be focusable for the focus() call above to mean anything
keysEl.tabIndex = -1;

/**
 * Read-only debug view: exposes the **raw text** of the internal buffer to the automated tests.
 *
 * Why it is needed: the UI displays * / - as × ÷ − (a separation of model and view), so a test that
 * only reads the UI text cannot tell whether the internals actually hold ASCII or the UI symbols —
 * and that is what determines whether the expression can be sent to the back-end as is.
 * The tests cover this.
 *
 * Only a getter is provided, with no write path, so it cannot become a backdoor that
 * "bypasses input validation and edits the expression directly".
 */
Object.defineProperty(window, '__debugExpression', {
  get: () => state.text,
  configurable: true,
});

// First render
render(state, display);

  return { setSubmitHandler, setResult, setMessage, getExpression, handleKey };
  })(createState, applyKey, canSubmit, render, setArmedOperator, flashKey);

  /* destructure buttons's exports into the bundling scope so later modules can reference them by name */
  const { setSubmitHandler, setResult, setMessage, getExpression, handleKey } = buttons;

  /* ===== source file: src/js/app.js (generated, do not edit by hand) ===== */
  const app = (function (calculate, fetchHistory, deleteHistory, clearHistory, checkHealth, API_BASE_URL_FOR_TEST, render, setBackendStatus, setBackendDot, showServerError, setDeleteHandler, setStatus, renderList, clearList, setSubmitHandler, setResult, setMessage, getExpression, HISTORY_PAGE_SIZE) {
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

  return { boot };
  })(calculate, fetchHistory, deleteHistory, clearHistory, checkHealth, API_BASE_URL_FOR_TEST, render, setBackendStatus, setBackendDot, showServerError, setDeleteHandler, setStatus, renderList, clearList, setSubmitHandler, setResult, setMessage, getExpression, HISTORY_PAGE_SIZE);

  /* destructure app's exports into the bundling scope so later modules can reference them by name */
  const { boot } = app;

  /* ===== source file: src/js/keyboard.js (generated, do not edit by hand) ===== */
  (function (handleKey) {
/**
 * Physical keyboard input — translates keyboard events into "key semantics" and hands them to
 * the same entry point.
 *
 * Key design: this module has **no input rules of its own**.
 *   It does only two things: 1. map a KeyboardEvent to a data-key semantic;
 *                 2. prevent the browser's default behavior (e.g. / opening quick find).
 *   All actual validity checks happen in input-model.js.
 *
 * The benefit: anything the mouse can input, the keyboard can input, and vice versa.
 *   There is only one set of rules, so "clicks are forbidden but the keyboard still gets
 *   through" cannot happen.
 */

/**
 * Mapping from physical keys to key semantics.
 * Keys that type a character directly (digits, operators, parentheses, decimal point) use KEY_MAP;
 * control keys with special names use SPECIAL_MAP.
 * @type {Record<string, string>}
 */
const KEY_MAP = {
  '0': '0', '1': '1', '2': '2', '3': '3', '4': '4',
  '5': '5', '6': '6', '7': '7', '8': '8', '9': '9',
  '.': '.',
  '+': '+', '-': '-', '*': '*', '/': '/',
  '(': '(', ')': ')',
  // Full-width symbols common under Chinese IMEs are accepted too, so a key that looks right
  // actually works
  '×': '*', '÷': '/', '（': '(', '）': ')', '。': '.',
};

/**
 * @type {Record<string, string>}
 */
const SPECIAL_MAP = {
  Enter: '=',
  '=': '=',
  Escape: 'AC',
  Delete: 'AC',
  Backspace: 'BACK',
  n: 'NEG',
  N: 'NEG',
};

/**
 * Keys whose default behavior must be prevented (otherwise they trigger the browser's own
 * shortcuts)
 */
const PREVENT_DEFAULT = new Set(['/', "'", '`', 'Backspace', 'Enter']);

/**
 * Decide whether focus currently sits in an editable element — if so, keyboard events belong to it.
 * This page has no text input yet, but the check is kept so that adding a "history search box"
 * later will not turn typing into calculator keypresses.
 * @returns {boolean}
 */
function isEditingText() {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) {
    return false;
  }
  const tag = active.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || active.isContentEditable;
}

/**
 * Keyboard event handling: translate → dispatch → prevent default.
 * @param {KeyboardEvent} event
 */
function onKeyDown(event) {
  if (event.ctrlKey || event.metaKey || event.altKey || isEditingText()) {
    return;
  }

  const key = SPECIAL_MAP[event.key] || KEY_MAP[event.key];
  if (key === undefined) {
    return;
  }

  if (PREVENT_DEFAULT.has(event.key)) {
    event.preventDefault();
  }

  // flash=true: the physical keyboard has no :active pseudo-class, so the script supplies the
  // "pressed" feedback
  handleKey(key, { flash: true });
}

window.addEventListener('keydown', onKeyDown);

  })(handleKey);

  /* ===== source file: src/js/boot.js (generated, do not edit by hand) ===== */
  (function (boot) {
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

  })(boot);


  /* read-only interface for the automated tests and the screenshot tool
     (see tools/e2e-click.mjs, tools/verify-deployed.mjs) */
  window.__calc = {
    createState: model.createState,
    applyKey: model.applyKey,
    render: ui.render,
    setArmedOperator: ui.setArmedOperator,
    flashKey: ui.flashKey,
    showServerError: ui.showServerError,
    /* whether the interactive code has started — this is the first e2e assertion */
    isBooted: () => document.getElementById('keys') !== null && document.getElementById('keys').tabIndex === -1,
    /* current expression (ASCII source, so tests can check display/data separation) */
    getExpression: buttons.getExpression,
    /* back-end address (so tests can assert the config was read correctly) */
    getApiBaseUrl: () => api.API_BASE_URL_FOR_TEST,
  };

})();
