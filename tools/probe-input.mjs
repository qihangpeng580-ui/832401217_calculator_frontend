/**
 * 探针：用假 DOM 加载 bundle.js，直接跑输入序列，打印每一步的表达式。
 *
 * 用途：当端到端测试失败时，快速判断是"输入模型的问题"还是"界面/测试的问题"。
 *
 * 运行：node tools/probe-input.mjs 3 * NEG 2
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const bundlePath = resolve(here, '..', 'src', 'js', 'bundle.js');
const code = readFileSync(bundlePath, 'utf8');

/** 最小 DOM 桩 —— 只要能骗过模块顶层的 getElementById 即可 */
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
  fetch: () => Promise.reject(new Error('探针环境没有后端')),
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
  console.log('bundle 加载失败：' + error.message);
  process.exit(1);
}

const calc = ctx.window.__calc;
if (!calc) {
  console.log('__calc 未暴露 —— bundle 可能没有正常执行');
  process.exit(1);
}

const keys = process.argv.slice(2);
if (keys.length === 0) {
  console.log('用法：node tools/probe-input.mjs 3 * NEG 2');
  process.exit(0);
}

let state = calc.createState();
console.log('按键'.padEnd(6) + '表达式'.padEnd(16) + '提示');
console.log('-'.repeat(50));

for (const key of keys) {
  state = calc.applyKey(state, key);
  console.log(key.padEnd(6) + JSON.stringify(state.text).padEnd(16) + (state.message || ''));
}
