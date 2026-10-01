/**
 * 历史记录渲染层 —— 负责把后端返回的历史列表画到右侧卡片里。
 *
 * 和 ui.js 一样，本模块是"哑"的：它只负责显示传进来的数据，
 * 不自己发请求。发请求是 app.js 的事。
 *
 * 为什么这样分：
 *   如果把 fetch 也写在这里，就变成"渲染函数偷偷发网络请求"，
 *   测试时没法脱离后端，而且"什么时候刷新"这件事会散落各处。
 *   分开之后，刷新时机由 app.js 统一决定。
 *
 * ★ 删除按钮用事件委托实现 —— 和键盘区同样的思路：
 *   整个列表**只挂一个** click 监听器。
 *   理由也一样：列表项是动态生成的，而且以后可能加分页，
 *   给每一项各绑一个监听器既浪费又容易漏。
 */

import { HISTORY_EXPRESSION_MAX_LENGTH } from './config.js';

/** @type {HTMLElement} */ const listEl = document.getElementById('history-list');
/** @type {HTMLElement} */ const statusEl = document.getElementById('history-status');
/** @type {HTMLElement} */ const countEl = document.getElementById('history-count');

/**
 * 删除记录的回调，由 app.js 注入。
 * @type {(id: number) => void}
 */
let onDelete = () => {};

/**
 * 设置删除回调。
 * @param {(id: number) => void} handler
 */
export function setDeleteHandler(handler) {
  onDelete = handler;
}

/**
 * 把界面显示的符号转回 ASCII，用于在历史里展示运算符。
 * 历史里我们**原样显示**用户当初输入的 ASCII 形式（去后端时用的形式），
 * 但为了可读性把 * / - 换成 × ÷ −，与计算器显示屏保持一致。
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
 * 把 ISO 时间截成 "MM-DD HH:MM"。
 *
 * 为什么不直接用 new Date().toLocaleString()：
 *   那个会跟随系统区域设置，不同电脑显示不一样，
 *   截图和博客里的样子就不统一了。这里手工截取，保证各处一致。
 * @param {string} iso
 * @returns {string}
 */
function formatTime(iso) {
  const text = String(iso || '');
  // 格式形如 2026-09-29T15:20:11
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) {
    return text;
  }
  return `${match[2]}-${match[3]} ${match[4]}:${match[5]}`;
}

/**
 * 截断过长的表达式，避免把列表撑破。
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
 * 设置状态文字（空列表、加载中、出错都走这里）。
 * @param {string} text
 * @param {'info'|'error'} [type]
 */
export function setStatus(text, type = 'info') {
  statusEl.textContent = text;
  statusEl.classList.toggle('is-error', type === 'error');
}

/**
 * 渲染历史列表。
 *
 * @param {Array<{id: number, expression: string, result: string, createdAt: string}>} items
 * @param {number} total 后端报告的总条数（可能大于当前显示的条数）
 */
export function renderList(items, total) {
  listEl.textContent = '';

  // 顶部条数提示
  if (total > items.length) {
    countEl.textContent = `显示 ${items.length} / 共 ${total} 条`;
  } else {
    countEl.textContent = total > 0 ? `共 ${total} 条` : '';
  }

  if (items.length === 0) {
    return;
  }

  // 用 DocumentFragment 一次性插入：避免每加一条就触发一次页面重排。
  // 列表短的时候差别看不出来，但这是好习惯，而且注释能说明为什么这么写。
  const fragment = document.createDocumentFragment();

  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'history__item';
    li.dataset.id = String(item.id);

    const main = document.createElement('div');
    main.className = 'history__main';

    const expression = document.createElement('p');
    expression.className = 'history__expression';
    // ★ 全程用 textContent，不用 innerHTML —— 表达式是用户输入的内容，
    //   里面可能出现 < > 等字符，用 textContent 天然免疫 XSS。
    expression.textContent = truncate(toDisplay(item.expression));
    expression.title = item.expression; // 悬停显示完整表达式

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
    remove.title = '删除这条记录';
    remove.textContent = '删除';
    remove.setAttribute('aria-label', `删除记录 ${item.expression}`);

    meta.append(time, remove);
    li.append(main, meta);
    fragment.append(li);
  }

  listEl.append(fragment);
}

/**
 * 清空列表（用于出错时把旧内容抹掉，避免显示过期数据）。
 */
export function clearList() {
  listEl.textContent = '';
  countEl.textContent = '';
}

// ---------------------------------------------------------------- 事件委托
//
// 整个列表只挂一个监听器。
// 列表项由 renderList 动态创建，所以必须在**父元素**上监听 ——
// 这也正是事件委托的典型使用场景。
listEl.addEventListener('click', (event) => {
  const button = event.target instanceof Element ? event.target.closest('[data-delete-id]') : null;
  if (!(button instanceof HTMLElement) || !listEl.contains(button)) {
    return;
  }

  const id = Number(button.dataset.deleteId);
  if (!Number.isFinite(id)) {
    return;
  }

  // 删除中的视觉反馈：禁用按钮，防止用户连点两次
  button.disabled = true;
  button.textContent = '…';

  onDelete(id);
});
