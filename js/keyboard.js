/**
 * 物理键盘输入 —— 把键盘事件翻译成"按键语义"，再交给同一个处理入口。
 *
 * 关键设计：本模块**没有任何自己的输入规则**。
 *   它只做两件事：① 把 KeyboardEvent 映射成 data-key 语义；
 *                 ② 阻止浏览器默认行为（比如按 / 触发快速查找）。
 *   真正的合法性判断全部发生在 input-model.js 里。
 *
 * 这样做的好处：鼠标能输入的，键盘一定能输入；反过来也一样。
 *   规则只有一份，不会出现"点击禁止、键盘却能输入"的不一致。
 */

import { handleKey } from './calc-buttons.js';

/**
 * 物理按键 → 按键语义 的映射表。
 * 直接写字符的键（数字、运算符、括号、小数点）用 KEY_MAP；
 * 名字特殊的控制键用 SPECIAL_MAP。
 * @type {Record<string, string>}
 */
const KEY_MAP = {
  '0': '0', '1': '1', '2': '2', '3': '3', '4': '4',
  '5': '5', '6': '6', '7': '7', '8': '8', '9': '9',
  '.': '.',
  '+': '+', '-': '-', '*': '*', '/': '/',
  '(': '(', ')': ')',
  // 中文输入法下常见的全角符号，一并接受，避免"看着一样却按不出来"
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

/** 需要阻止默认行为的按键（否则会触发浏览器自身的快捷键） */
const PREVENT_DEFAULT = new Set(['/', "'", '`', 'Backspace', 'Enter']);

/**
 * 判断当前焦点是否在可编辑元素里 —— 如果在，键盘事件应该留给那个元素。
 * 本页面目前没有输入框，但保留这个判断，
 * 以后加了"历史搜索框"就不会出现"打字变成按计算器"的问题。
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
 * 键盘事件处理：翻译 → 分发 → 阻止默认行为。
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

  // flash=true：物理键盘没有 :active 伪类，由脚本补上"按下了"的视觉反馈
  handleKey(key, { flash: true });
}

window.addEventListener('keydown', onKeyDown);
