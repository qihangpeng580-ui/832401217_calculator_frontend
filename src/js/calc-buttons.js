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
import * as ui from './ui.js';

/** 前端自己的状态：表达式缓冲区 */
let state = createState();

/** 结果行的当前内容。后端接通前永远是占位提示 */
const display = { value: '后端未接通', isPlaceholder: true };

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

  ui.render(state, display);
  ui.setArmedOperator(armed);
  if (options.flash === true) {
    ui.flashKey(key);
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
 * "=" 的处理：先做前端能负责的输入校验，再把表达式交给后端。
 *
 * 注意这里**没有做任何计算**。作业要求结果必须由后端产生，
 * 前后端联调阶段将在此处调用 POST /api/calculate，
 * 然后把后端返回的 result 交给 ui.render 显示。
 */
function evaluate() {
  const check = canSubmit(state.text);
  if (!check.ok) {
    state = { ...state, message: check.message, messageType: 'error' };
    ui.render(state, display);
    return;
  }
  state = {
    ...state,
    message: '表达式已就绪，但后端尚未接通 —— 本阶段前端不产生计算结果',
    messageType: 'hint',
  };
  ui.render(state, display);
  ui.setArmedOperator(null);
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

// 首屏渲染
ui.render(state, display);
