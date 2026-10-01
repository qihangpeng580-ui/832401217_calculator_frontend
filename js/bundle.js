/**
 * ⚠ 生成物 —— 请勿手工编辑。
 * 由 tools/build-bundle.mjs 从 src/js/ 下的四个 ES 模块合并而来。
 * 改逻辑请改源文件，然后运行：node tools/build-bundle.mjs
 *
 * 存在的理由：浏览器在 file:// 页面里不执行 ES 模块，
 * 双击打开 index.html 会完全没有交互；打包成传统脚本后双击即可使用。
 */
(function () {
  'use strict';

  /* ===== 源文件：src/js/input-model.js（生成物，请勿手工编辑） ===== */
  const model = (function () {
/**
 * 表达式缓冲区 —— 计算器的"输入模型"。
 *
 * 职责边界（很重要）：
 *   本模块只做**字符串层面的输入校验与拼装**，不解析、不求值、不产生任何计算结果。
 *   因为作业明确要求"最终计算结果必须由后端产生"，
 *   所以这里连一个 `+` 号运算都不允许出现，更不允许出现 eval/Function。
 *
 * 光标模型：表达式是一段文本 + 一个插入位置 cursor（0..text.length）。
 *   为简化实现，本版本所有输入都追加在末尾、退格从末尾删除，
 *   因此 cursor 恒等于 text.length —— 保留该字段是为了让后续做"中间插字"时不必重写调用方。
 *
 * @typedef {object} BufferState
 * @property {string} text           表达式文本，内部用 * / 与 -，界面再映射成 × ÷ −
 * @property {number} cursor         插入位置
 * @property {string} message        给用户看的提示（正常时为空串）
 * @property {string} messageType    'hint' | 'error'
 */

/** 允许出现在表达式内部的字符白名单 */
const ALLOWED_CHARS = '0123456789.+-*/()';

/** 四则运算符 */
const OPERATORS = '+-*/';

/** 表达式长度上限，防止无意义超长输入 */
const MAX_LENGTH = 60;

/** 四种运算符，用于运算符键的"换键"行为 */
const OPERATOR_SET = ['+', '-', '*', '/'];

/**
 * 新建一个空缓冲区状态。
 * @returns {BufferState}
 */
function createState() {
  return { text: '', cursor: 0, message: '', messageType: 'hint' };
}

/**
 * 生成一个带提示的状态副本（纯函数，不改原对象）。
 * @param {BufferState} state
 * @param {string} message
 * @param {string} [messageType]
 * @returns {BufferState}
 */
function withMessage(state, message, messageType = 'hint') {
  return { ...state, message, messageType };
}

/**
 * 生成一个"输入被拒绝"的状态：文本不变，只给提示。
 * 所有校验失败都走这里，保证"拒绝输入"的行为只有一种实现。
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
 * 取末尾这一段连续数字/小数点，例如 '12+3.5' → '3.5'（没有则返回空串）。
 * @param {string} text
 * @returns {string}
 */
function trailingNumber(text) {
  const match = text.match(/[0-9.]+$/);
  return match ? match[0] : '';
}

/**
 * 判断一个片段是不是合法数字：至少一位数字，且最多一个小数点。
 * @param {string} segment
 * @returns {boolean}
 */
function isNumberSegment(segment) {
  return /^\d+(\.\d+)?$/.test(segment) || /^\d+\.$/.test(segment);
}

/**
 * 统计括号是否配对（左括号数 >= 右括号数即"目前还算合法"）。
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
 * 供"="使用：判断当前表达式是否"可以提交给后端"。
 * 只做前端能负责任地判断的部分：非空、括号配对、不以运算符或小数点结尾。
 * @param {string} text
 * @returns {{ok: true} | {ok: false, message: string}}
 */
function canSubmit(text) {
  if (text === '') {
    return { ok: false, message: '请输入表达式' };
  }
  const { depth } = parenInfo(text);
  if (depth !== 0) {
    return { ok: false, message: '括号不匹配：还有 ' + depth + ' 个左括号没有闭合' };
  }
  const last = text.slice(-1);
  if (isOperator(last)) {
    return { ok: false, message: '表达式不完整：结尾是运算符' };
  }
  if (last === '.') {
    return { ok: false, message: '表达式不完整：小数点后缺少数字' };
  }
  if (last === '(') {
    return { ok: false, message: '表达式不完整：左括号后缺少内容' };
  }
  return { ok: true };
}

/**
 * 数字键：追加一位数字。
 * @param {BufferState} state
 * @param {string} digit
 * @returns {BufferState}
 */
function inputDigit(state, digit) {
  if (state.text.length >= MAX_LENGTH) {
    return reject(state, '表达式最多 ' + MAX_LENGTH + ' 个字符');
  }
  // 一位数字不能以 0 开头（'0' 本身除外），例如 0 后面直接按 5 得到 "05" 属于书写错误
  if (lastChar(state) === '0' && trailingNumber(state.text) === '0' && digit !== '.') {
    return reject(state, '数字不能以 0 开头');
  }
  return withMessage(
    { ...state, text: state.text + digit, cursor: state.text.length + 1 },
    '按 = 让后端计算',
  );
}

/**
 * 小数点：同一个数字里最多一个。
 * @param {BufferState} state
 * @returns {BufferState}
 */
function inputDot(state) {
  if (state.text.length >= MAX_LENGTH) {
    return reject(state, '表达式最多 ' + MAX_LENGTH + ' 个字符');
  }
  if (trailingNumber(state.text).includes('.')) {
    return reject(state, '同一个数字里只能有一个小数点');
  }
  if (lastChar(state) === ')') {
    return reject(state, '右括号后不能直接跟小数点');
  }
  const prefix = trailingNumber(state.text) === '' ? '0' : '';
  return withMessage(
    { ...state, text: state.text + prefix + '.', cursor: state.text.length + prefix.length + 1 },
    '正在输入小数',
  );
}

/**
 * 四则运算符：连续运算符只允许一个负号（用于表示负数）。
 * @param {BufferState} state
 * @param {string} operator
 * @returns {BufferState}
 */
function inputOperator(state, operator) {
  const last = lastChar(state);

  if (state.text === '') {
    if (operator === '-') {
      return withMessage({ ...state, text: '-', cursor: 1 }, '正在输入负数');
    }
    return reject(state, '表达式不能以 ' + operator + ' 开头');
  }

  // 连续运算符：把刚输入的运算符"换掉"，而不是追加。
  // 这是真实计算器的常见行为，也顺手解决了"连续运算符"的合法性问题。
  if (isOperator(last)) {
    if (operator === '-' && last !== '-') {
      return withMessage(
        { ...state, text: state.text + '-' },
        '这里的负号表示负数，如 3*-2',
      );
    }
    const swapped = state.text.slice(0, -1) + operator;
    return withMessage({ ...state, text: swapped }, '已改为 ' + operator);
  }

  if (last === '(') {
    if (operator === '-') {
      return withMessage({ ...state, text: state.text + '-' }, '括号里的负数');
    }
    return reject(state, '左括号后不能直接跟运算符');
  }

  if (last === '.') {
    return reject(state, '小数点后需要先输入数字');
  }

  return withMessage(
    { ...state, text: state.text + operator, cursor: state.text.length + 1 },
    '继续输入数字或用括号',
  );
}

/**
 * 左括号：数字或右括号后面补左括号时自动补一个乘号（隐式乘法）。
 * @param {BufferState} state
 * @returns {BufferState}
 */
function inputLeftParen(state) {
  if (state.text.length >= MAX_LENGTH) {
    return reject(state, '表达式最多 ' + MAX_LENGTH + ' 个字符');
  }
  const last = lastChar(state);
  const needsMultiply = isDigit(last) || last === ')' || last === '.';
  const addition = needsMultiply ? '*(' : '(';
  return withMessage(
    { ...state, text: state.text + addition, cursor: state.text.length + addition.length },
    needsMultiply ? '已在数字与括号之间补上乘号' : '括号里可以写子表达式',
  );
}

/**
 * 右括号：必须先有未闭合的左括号，且不能紧跟运算符或左括号。
 * @param {BufferState} state
 * @returns {BufferState}
 */
function inputRightParen(state) {
  const { depth } = parenInfo(state.text);
  if (depth === 0) {
    return reject(state, '没有可以配对的左括号');
  }
  const last = lastChar(state);
  if (isOperator(last) || last === '(') {
    return reject(state, '右括号前缺少数字');
  }
  return withMessage(
    { ...state, text: state.text + ')', cursor: state.text.length + 1 },
    depth === 1 ? '括号已闭合' : '还剩 ' + (depth - 1) + ' 个左括号',
  );
}

/**
 * 取负时统一写成 (-数字) 这种带括号的形式，而不是直接插一个 '-'。
 * 原因：'5+-3' 这种写法虽然多数解析器能接受，但语义上依赖解析器的宽容度；
 *      写成 '5+(-3)' 则对任何后端解析器都是无歧义的。
 * @param {BufferState} state
 * @returns {BufferState}
 */
function toggleSign(state) {
  const text = state.text;

  // 情况一：末尾是 (-数字) —— 反操作，整体去掉括号与负号
  const wrapped = text.match(/\(-(\d+(?:\.\d+)?)\)$/);
  if (wrapped) {
    const next = text.slice(0, wrapped.index) + wrapped[1];
    return withMessage(
      { ...state, text: next, cursor: next.length },
      '已去掉负号',
    );
  }

  // 情况二：末尾是普通数字 —— 加上括号与负号
  const tail = trailingNumber(text);
  if (tail === '' || !isNumberSegment(tail)) {
    return reject(state, '请先输入一个完整的数字再按 ± ');
  }

  const before = text.slice(0, text.length - tail.length);
  const next = before + '(-' + tail + ')';
  if (next.length > MAX_LENGTH) {
    return reject(state, '表达式最多 ' + MAX_LENGTH + ' 个字符');
  }
  return withMessage(
    { ...state, text: next, cursor: next.length },
    '已取负（用括号包住，避免歧义）',
  );
}

/**
 * 退格：删除末尾一个字符。
 * @param {BufferState} state
 * @returns {BufferState}
 */
function backspace(state) {
  if (state.text === '') {
    return withMessage(state, '已经是空的');
  }
  // 形如 ...(-5) 时，一次退格删掉整个括号组更符合直觉
  const trimmed = state.text.replace(/\(-\d+(\.\d+)?\)$/, (match) => match.slice(2, -1));
  const next = trimmed === state.text ? state.text.slice(0, -1) : trimmed;
  return withMessage({ ...state, text: next, cursor: next.length }, '');
}

/**
 * 清空。
 * @returns {BufferState}
 */
function clear() {
  return withMessage(createState(), '已清空');
}

/**
 * 单一入口：把一个"按键语义"应用到缓冲区状态上（纯函数，不改原对象）。
 *
 * 之所以所有输入都走这一个函数，是因为鼠标点击和物理键盘必须走同一套规则；
 * 只要它们都调用 applyKey，就不可能出现在一边合法、在另一边非法的情况。
 *
 * @param {BufferState} state
 * @param {string} key  数字、'.'、'+ - * /'、'(' ')'、'AC'、'BACK'、'NEG'
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
  return reject(state, '不支持的按键：' + key);
}

  return { ALLOWED_CHARS, OPERATORS, MAX_LENGTH, createState, trailingNumber, isNumberSegment, parenInfo, canSubmit, applyKey };
  })();

  /* 把 model 的导出摊到打包作用域，供后续模块按名字引用 */
  const { ALLOWED_CHARS, OPERATORS, MAX_LENGTH, createState, trailingNumber, isNumberSegment, parenInfo, canSubmit, applyKey } = model;

  /* ===== 源文件：src/js/ui.js（生成物，请勿手工编辑） ===== */
  const ui = (function () {
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
function toDisplayText(text) {
  return text.replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '−');
}

/** @type {number} 闪烁定时器，避免重复启动多个计时器 */
let flashTimer = 0;

/**
 * 渲染整个显示屏。
 * @param {{text: string, cursor: number, message: string, messageType: string}} state
 * @param {{value: string, isPlaceholder: boolean}} display 结果行内容
 */
function render(state, display) {
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
 * 高亮"当前正在生效的运算符"，没有则全部取消高亮。
 * 这是 CSS 伪类做不到的：鼠标移开之后仍然要保持可见。
 * @param {string|null} operator
 */
function setArmedOperator(operator) {
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
function showServerError(errorCode) {
  const text = SERVER_ERROR_TEXT[errorCode] || '计算失败：' + errorCode;
  renderMessage(text, 'error');
  resultEl.textContent = '—';
  resultEl.classList.add('is-placeholder');
}

/**
 * 更新右下角的后端连接状态。
 * @param {string} text
 */
function setBackendStatus(text) {
  backendTextEl.textContent = text;
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
function showMessage(message) {
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

  return { toDisplayText, render, flashKey, setArmedOperator, setBackendStatus, showMessage, showServerError };
  })();

  /* 把 ui 的导出摊到打包作用域，供后续模块按名字引用 */
  const { toDisplayText, render, flashKey, setArmedOperator, setBackendStatus, showMessage, showServerError } = ui;

  /* ===== 源文件：src/js/calc-buttons.js（生成物，请勿手工编辑） ===== */
  const buttons = (function (createState, applyKey, canSubmit, render, setArmedOperator, flashKey) {
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
function handleKey(key, options = {}) {
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
    // 文案要短：显示屏里的提示条一行约能放下 20 个汉字，
    // 太长会折成三行把显示屏撑挤（截图里踩过）。
    message: '后端未接通，本阶段不产生结果',
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
ui.render(state, display);

  return { handleKey };
  })(createState, applyKey, canSubmit, render, setArmedOperator, flashKey);

  /* 把 buttons 的导出摊到打包作用域，供后续模块按名字引用 */
  const { handleKey } = buttons;

  /* ===== 源文件：src/js/keyboard.js（生成物，请勿手工编辑） ===== */
  (function (handleKey) {
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

  })(handleKey);


  /* 自动化测试与截图工具用的只读接口（见 tools/e2e-click.mjs、tools/shot-seed.js） */
  window.__calc = {
    createState,
    applyKey,
    render,
    setArmedOperator,
    flashKey,
    showServerError,
    isBooted: () => document.getElementById('keys') !== null && document.getElementById('keys').tabIndex === -1,
    getExpression: () => state,
  };

})();
