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

import { handleKey } from './calc-buttons.js';

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
