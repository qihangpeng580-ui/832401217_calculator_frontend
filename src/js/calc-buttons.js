/**
 * ★ 事件驱动核心 —— 按钮交互与事件委托。
 *
 * 本文件回答课堂上点名要理解的那个问题：**事件是怎么驱动界面的**。
 *
 * 做法：整个键盘区（#keys）只注册 **一个** click 监听器。
 *   - 不给 27 个按钮各写一个 onclick；
 *   - 也不写 document.onclick 那种全局监听。
 *
 * 为什么用事件委托，而不是"每个按钮各绑一个处理函数"：
 *   1. 一个入口。所有按键最终都调用同一个 handleKey，规则不可能在某个按钮上漏掉。
 *   2. 加键不用改代码。以后要加 √ 或 x²，只要在 HTML 里补一个带 data-key 的按钮即可。
 *   3. 动态渲染也不失效。若以后按键由后端配置或由 JS 生成，监听器依然有效 ——
 *      因为监听的是父元素，事件会从子元素"冒泡"上来。
 *   4. 内存更省。27 个监听器变 1 个。
 *   代价：需要在处理函数里用 closest() 判断"到底点到了谁"。
 */

import { applyKey, createState, canSubmit } from './input-model.js';
import {
  render,
  setArmedOperator,
  flashKey,
  showServerError,
} from './ui.js';

/**
 * ★ 为什么这里 import 的是一个个函数，而不是 `import * as ui`：
 *   打包器（tools/build-bundle.mjs）把每个模块包成 IIFE，
 *   依赖是以**函数参数**的形式传进去的（形如 `function (render, flashKey) {...}`）。
 *   所以模块内部只能用这些名字，写成 render(...) 会解析不到 ui 这个名字。
 *   这一点在打包时踩过一次：整包抛 ReferenceError，页面完全没反应。
 */

/** 前端自己的状态：表达式缓冲区 */
let state = createState();

/**
 * 结果行的当前内容。
 *
 * 为什么放在这里而不是写死一个常量：
 *   联调之后结果行要显示"后端返回的结果"或"计算失败"，
 *   也就是会变。由 app.js 通过 setResult 更新。
 *
 * isPlaceholder 的作用：为 true 时用灰色小字，
 * 与"真实结果"在视觉上区分开（用户一眼能看出这是提示不是答案）。
 */
let display = { value: '—', isPlaceholder: true };

/**
 * "提交计算"的回调，由 app.js 注入。
 *
 * ★ 为什么要用注入而不是在这里直接 import app.js：
 *   如果在 calc-buttons 里 import app，而 app 又需要调用 calc-buttons 的入口，
 *   就形成了循环依赖。用注入的方式，依赖是单向的：app → calc-buttons。
 *   好处还有一个：做测试时可以塞一个假的提交函数进来，不需要真的后端。
 *
 * @type {(expression: string) => void}
 */
let onSubmit = () => {};

/**
 * 设置提交回调。
 * @param {(expression: string) => void} handler
 */
export function setSubmitHandler(handler) {
  onSubmit = handler;
}

/**
 * 更新结果行。
 * @param {string} value 要显示的文字
 * @param {boolean} [isPlaceholder] 是否是占位提示（而非真实结果）
 */
export function setResult(value, isPlaceholder = false) {
  display = { value, isPlaceholder };
  render(state, display);
}

/**
 * 读取当前表达式（ASCII 形式）。
 * @returns {string}
 */
export function getExpression() {
  return state.text;
}

/**
 * 唯一的按键处理入口。
 * 鼠标点击、物理键盘、以及以后的任何输入源，都必须调用它。
 *
 * @param {string} key 按键语义，见 input-model.js 的 applyKey
 * @param {{flash?: boolean}} [options] flash=true 时让按键闪一下（供物理键盘使用）
 */
export function handleKey(key, options = {}) {
  state = applyKey(state, key);

  // 只有当表达式真的以运算符结尾时才保持高亮；输入被拒绝时取消全部高亮
  const armed = isOperatorKey(key) ? lastOperator(state.text) : null;

  render(state, display);
  setArmedOperator(armed);
  if (options.flash === true) {
    flashKey(key);
  }
}

/**
 * 是否是四则运算符键。
 * @param {string} key
 * @returns {boolean}
 */
function isOperatorKey(key) {
  return '+-*/'.includes(key) && key.length === 1;
}

/**
 * 取表达式末尾的运算符（末尾不是运算符时返回 null）。
 * @param {string} text
 * @returns {string|null}
 */
function lastOperator(text) {
  const last = text.slice(-1);
  return '+-*/'.includes(last) ? last : null;
}

/**
 * 按 "=" 的处理：先做前端能负责的输入校验，通过了就交给后端。
 *
 * ★ 这里**没有、也永远不会有任何计算**。作业的硬性要求是
 *   "最终计算结果必须由后端产生并返回给前端"，所以这一步只做两件事：
     ① 拦住前端**能确定**的错误（空表达式、括号没闭合、结尾是运算符）——
        这类错误没必要浪费一次网络请求；
     ② 把表达式交给 onSubmit（app.js 注入），由它去调用后端接口。
 *
 * 为什么前端只拦"能确定的"：
 *   语法和语义层的判断权在后端。前端如果也去判断，两边规则一旦不一致，
 *   就会出现"前端说非法、后端说合法"的矛盾。
 */
function evaluate() {
  const check = canSubmit(state.text);

  if (!check.ok) {
    // 前端能确定的错误：只提示，不发请求
    state = { ...state, message: check.message, messageType: 'error' };
    render(state, display);
    setArmedOperator(null);
    return;
  }

  // 交给后端。注意这里**没有**动 display ——
  // 结果行会由 app.js 在拿到后端响应后通过 setResult 更新。
  onSubmit(state.text);
  setArmedOperator(null);
}

/**
 * 更新提示条文字（供 app.js 在请求过程中/失败后调用）。
 * @param {string} message
 * @param {'hint'|'error'} [messageType]
 */
export function setMessage(message, messageType = 'hint') {
  state = { ...state, message, messageType };
  render(state, display);
}

/**
 * 按 data-key 分发动作。这是事件委托的"分发中心"。
 * @param {string} key
 */
function dispatch(key) {
  if (key === '=') {
    evaluate();
    return;
  }
  handleKey(key);
}

// ---------------------------------------------------------------- 事件委托
const keysEl = document.getElementById('keys');

keysEl.addEventListener('click', (event) => {
  // 从真实点击目标向上找最近的、带 data-key 的按钮。
  // 这样即使点到按钮内部的文字节点，也能正确定位到按钮。
  const button = event.target instanceof Element ? event.target.closest('[data-key]') : null;
  if (!(button instanceof HTMLElement) || !keysEl.contains(button)) {
    return;
  }
  dispatch(button.dataset.key);

  // 鼠标点击后浏览器会把焦点留在按钮上，之后按回车会重复触发该按钮。
  // 这里主动把焦点移回键盘区容器，避免出现"按回车重复上次按键"的怪现象。
  keysEl.focus({ preventScroll: true });
});

// 键盘区容器需要可获得焦点，上面的 focus() 才有意义
keysEl.tabIndex = -1;

/**
 * 只读调试视图：把内部缓冲区的**原始文本**暴露给自动化测试。
 *
 * 为什么需要它：界面把 * / - 显示成 × ÷ −（表里分离），
 * 所以测试如果只读界面文本，就分辨不出"内部到底存的是 ASCII 还是界面符号" ——
 * 而这决定了表达式能不能直接发给后端。测试里踩过这个坑。
 *
 * 这里只提供 getter，没有任何写入入口，
 * 因此不会变成"绕过输入校验直接改表达式"的后门。
 */
Object.defineProperty(window, '__debugExpression', {
  get: () => state.text,
  configurable: true,
});

// 首屏渲染
render(state, display);
