/**
 * 渲染层 —— 唯一允许直接修改 DOM 的模块。
 *
 * 为什么要把 DOM 操作集中在一个文件里：
 *   界面元素一旦分散在多个模块里被各处修改，出现显示不一致时很难定位。
 *   这里对外只暴露 render / flashKey / setBackendStatus 三个函数，
 *   其余模块（按钮、键盘）只负责"把状态算出来"，不碰 DOM。
 *
 * 安全约定：本项目全程使用 textContent，不使用 innerHTML。
 *   即使表达式里出现 < > 等字符，也只会被当成普通文本显示，不会变成 HTML。
 */

/** @type {HTMLElement} */ const expressionEl = document.getElementById('expression');
/** @type {HTMLElement} */ const resultEl = document.getElementById('result');
/** @type {HTMLElement} */ const messageEl = document.getElementById('message');
/** @type {HTMLElement} */ const keysPanel = document.getElementById('keys');
/** @type {HTMLElement} */ const backendTextEl = document.getElementById('backend-text');

/** 表达式为空时的占位文字（存放在 data 属性里，由 CSS 渲染） */
const PLACEHOLDER = '输入表达式';

/**
 * 光标锚点：一个零宽空格。
 * 渲染时用它把文本切成两段，在中间插入光标元素 —— 这样就不需要 innerHTML。
 */
const CARET_ANCHOR = '\u200b';

/**
 * 把内部表达式映射成界面显示形式：* → ×，/ → ÷，- → −（减号）。
 * 只做显示替换，长度一一对应，因此不影响光标位置计算。
 * @param {string} text
 * @returns {string}
 */
export function toDisplayText(text) {
  return text.replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '−');
}

/** @type {number} 闪烁定时器，避免重复启动多个计时器 */
let flashTimer = 0;

/**
 * 渲染整个显示屏。
 * @param {{text: string, cursor: number, message: string, messageType: string}} state
 * @param {{value: string, isPlaceholder: boolean}} display 结果行内容
 */
export function render(state, display) {
  renderExpression(state);
  renderResult(display);
  renderMessage(state.message, state.messageType);
}

/**
 * 渲染表达式行与光标。用零宽空格作锚点切成两段，不用 innerHTML。
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
 * 渲染结果行。
 * @param {{value: string, isPlaceholder: boolean}} display
 */
function renderResult(display) {
  resultEl.textContent = display.value;
  resultEl.classList.toggle('is-placeholder', display.isPlaceholder === true);
}

/**
 * 渲染提示条。messageType 为 'error' 时变红。
 * @param {string} message
 * @param {string} messageType
 */
function renderMessage(message, messageType) {
  messageEl.textContent = message;
  messageEl.classList.toggle('is-error', messageType === 'error');
}

/**
 * 让某个按键闪一下"按下"效果。
 * 用途：物理键盘没有 :active 伪类，只能由脚本补上视觉反馈，
 *      让"键盘输入"和"鼠标点击"的观感一致。
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
 * 高亮"当前正在生效的运算符"，没有则全部取消高亮。
 * 这是 CSS 伪类做不到的：鼠标移开之后仍然要保持可见。
 * @param {string|null} operator
 */
export function setArmedOperator(operator) {
  const opKeys = keysPanel.querySelectorAll('.key--op, .key--eq');
  opKeys.forEach((button) => {
    button.classList.toggle('is-armed', button.dataset.key === operator);
  });
}

/**
 * 后端错误码 → 给用户看的中文说明。
 * 这张表放在前端，是为了把「后端返回的错误码」翻译成人话；
 * 判断对错的权力始终在后端，前端只负责显示。
 * @type {Record<string, string>}
 */
const SERVER_ERROR_TEXT = {
  INVALID_EXPRESSION: '表达式不合法，请检查括号与运算符',
  DIVISION_BY_ZERO: '除数不能为 0',
  EXPRESSION_TOO_LONG: '表达式过长，请拆开计算',
  RECORD_NOT_FOUND: '这条历史记录不存在或已被删除',
  BAD_REQUEST: '请求格式不正确',
  INTERNAL_ERROR: '服务器内部错误，请稍后再试',
};

/**
 * 显示后端返回的错误。
 *
 * 正常调用路径（前后端联调阶段）：
 *   const data = await response.json();
 *   if (!data.success) { showServerError(data.errorCode); }
 *
 * 现在后端还没接通，所以它暂时只被截图脚本调用，用来演示错误提示的样子。
 * 这样截图里的文案与将来真实联调时完全一致，等后端做好不用回头补图。
 *
 * @param {string} errorCode
 */
export function showServerError(errorCode) {
  const text = SERVER_ERROR_TEXT[errorCode] || '计算失败：' + errorCode;
  renderMessage(text, 'error');
  resultEl.textContent = '—';
  resultEl.classList.add('is-placeholder');
}

/**
 * 更新右下角的后端连接状态文字。
 * @param {string} text
 */
export function setBackendStatus(text) {
  backendTextEl.textContent = text;
}

/**
 * 更新后端状态指示点的颜色。
 *
 * 三个状态：
 *   'online'   绿点 —— 后端可用
 *   'offline'  红点 —— 连不上后端
 *   'unknown'  灰点 —— 还没检查过
 *
 * 为什么状态点要单独一个函数：
 *   文字和颜色是两件事 —— 文字可能因为别的原因变化，
 *   而颜色只反映连通性。分开之后互不干扰。
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

// 截图脚本的注入入口。之所以挂在 window 上而不是写进业务代码，
// 是为了让"演示用的假数据"与"真实业务逻辑"分开，联调时删掉这一行即可。
window.__demoServerError = (errorCode) => {
  showServerError(errorCode);
  setBackendStatus('后端错误响应（演示数据）');
};

/**
 * 由"="按钮调用：在结果行给出一个明确、诚实的提示。
 * 后端接通之前，前端不产生任何计算结果，所以这里只更新提示文字。
 * @param {string} message
 */
export function showMessage(message) {
  renderMessage(message, 'hint');
}

/**
 * 把 data-key 里的特殊字符转义，安全地拼进属性选择器。
 * @param {string} value
 * @returns {string}
 */
function cssEscape(value) {
  return String(value).replace(/["\\]/g, '\\$&');
}
