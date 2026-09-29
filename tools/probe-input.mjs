/**
 * Probe: load bundle.js with a fake DOM, run an input sequence directly, and print the expression after each step.
 *
 * Use: when an end-to-end test fails, quickly decide whether the problem is "the input model" or "the interface/test".
 *
 * Run: node tools/probe-input.mjs 3 * NEG 2
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const bundlePath = resolve(here, '..', 'src', 'js', 'bundle.js');
const code = readFileSync(bundlePath, 'utf8');

/** Minimal DOM stub -- just enough to fool the module's top-level getElementById */
function makeEl() {
  return {
    textContent: '',
    dataset: {},
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    addEventListener() {},
    append() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    focus() {},
    tabIndex: 0,
    style: {},
  };
}

const documentStub = {
  getElementById: () => makeEl(),
  createElement: () => makeEl(),
  createTextNode: () => ({}),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  readyState: 'complete',
  body: makeEl(),
  images: [],
};

const windowStub = {
  addEventListener() {},
  setTimeout,
  clearTimeout,
  confirm: () => true,
  __calc: null,
};

const ctx = {
  document: documentStub,
  window: windowStub,
  console,
  setTimeout,
  clearTimeout,
  fetch: () => Promise.reject(new Error('no back end in the probe environment')),
  AbortController,
  URLSearchParams,
  Object, Error, JSON, Number, String, Array, Math, Boolean, Date, RegExp,
  Element: class {},
  HTMLElement: class {},
  HTMLInputElement: class {},
};

vm.createContext(ctx);
ctx.globalThis = ctx;

try {
  vm.runInContext(code, ctx);
} catch (error) {
  console.log('failed to load the bundle: ' + error.message);
  process.exit(1);
}

const calc = ctx.window.__calc;
if (!calc) {
  console.log('__calc is not exposed — the bundle probably did not execute');
  process.exit(1);
}

const keys = process.argv.slice(2);
if (keys.length === 0) {
  console.log('Usage: node tools/probe-input.mjs 3 * NEG 2');
  process.exit(0);
}

let state = calc.createState();
console.log('Key'.padEnd(6) + 'Expression'.padEnd(16) + 'Message');
console.log('-'.repeat(50));

for (const key of keys) {
  state = calc.applyKey(state, key);
  console.log(key.padEnd(6) + JSON.stringify(state.text).padEnd(16) + (state.message || ''));
}
