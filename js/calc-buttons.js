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

import { applyKey, createState, canSubmit } from './input-model.js';
import {
  render,
  setArmedOperator,
  flashKey,
  showServerError,
} from './ui.js';

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
export function setSubmitHandler(handler) {
  onSubmit = handler;
}

/**
 * Update the result line.
 * @param {string} value text to display
 * @param {boolean} [isPlaceholder] whether this is a placeholder hint (rather than a real result)
 */
export function setResult(value, isPlaceholder = false) {
  display = { value, isPlaceholder };
  render(state, display);
}

/**
 * Read the current expression (ASCII form).
 * @returns {string}
 */
export function getExpression() {
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
export function handleKey(key, options = {}) {
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
export function setMessage(message, messageType = 'hint') {
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
