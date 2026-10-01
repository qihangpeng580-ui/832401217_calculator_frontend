/**
 * ⚠ 生成物 —— 请勿手工编辑。
 * 由 tools/build-bundle.mjs 从 src/js/ 下的 ES 模块合并而来。
 * 改逻辑请改源文件，然后运行：node tools/build-bundle.mjs
 *
 * 存在的理由：浏览器在 file:// 页面里不执行 ES 模块，
 * 双击打开 index.html 会完全没有交互；打包成传统脚本后双击即可使用。
 */
(function () {
  'use strict';

  /* ===== 源文件：src/js/config.js（生成物，请勿手工编辑） ===== */
  const config = (function () {
/**
 * 配置层 —— 前端需要知道的"外部世界"信息都放在这里。
 *
 * 为什么单独一个文件：
 *   后端地址在开发、部署、演示三种场景下是不同的。
 *   如果把它散落在代码各处，上线时要翻遍所有文件找。
 *   集中一处，改一行就够。
 *
 * ⚠️ 部署前必须改这里 ↑
 */

/**
 * 后端服务的地址（末尾不要带斜杠）。
 *
 * 取值说明：
 *   · 本地开发： 'http://127.0.0.1:8000'   ← 前端和后端都在本机
 *   · 部署之后： 改成后端的公网地址，例如 'https://xxx.example.com'
 *
 * 特殊情况：
 *   前端和后端**同源**部署时（同一个域名端口）可以留空字符串 ''，
 *   这样请求会打到 /api/... 而不是跨域 —— 也就不存在 CORS 问题。
 */
const API_BASE_URL = 'http://127.0.0.1:8000';

/**
 * 单个请求的超时时间（毫秒）。
 *
 * 为什么必须设超时：
 *   后端挂掉时，浏览器的 fetch 默认会一直挂着不返回，
 *   用户按了 = 之后界面永远停在"计算中"，看起来像死机。
 *   设了超时才能给出"连不上后端"的明确提示。
 */
const REQUEST_TIMEOUT_MS = 8000;

/**
 * 历史记录一次拉多少条。
 */
const HISTORY_PAGE_SIZE = 20;

/**
 * 历史记录里每条显示的表达式最大长度（超出截断加省略号）。
 * 防止一条超长表达式把列表撑破。
 */
const HISTORY_EXPRESSION_MAX_LENGTH = 28;

  return { API_BASE_URL, REQUEST_TIMEOUT_MS, HISTORY_PAGE_SIZE, HISTORY_EXPRESSION_MAX_LENGTH };
  })();

  /* 把 config 的导出摊到打包作用域，供后续模块按名字引用 */
  const { API_BASE_URL, REQUEST_TIMEOUT_MS, HISTORY_PAGE_SIZE, HISTORY_EXPRESSION_MAX_LENGTH } = config;

  /* ===== 源文件：src/js/api.js（生成物，请勿手工编辑） ===== */
  const api = (function (API_BASE_URL, REQUEST_TIMEOUT_MS) {
/**
 * API 客户端 —— 前端唯一与后端通信的地方。
 *
 * 设计原则：
 *   1. **前端不做计算**。这个文件的每个函数都只是"发出去、收回来、翻译一下"，
 *      一行算术都没有。结果和错误都由后端决定。
 *   2. **所有网络细节关在这个文件里**。其余模块不知道有 fetch、不知道有 HTTP 状态码，
 *      只看到"成功拿到数据"或"抛出一个带错误码的异常"。
 *      以后要换成 XMLHttpRequest 或 WebSocket，只有这里要改。
 *   3. **错误一律归一化成 ApiError**。调用方只需判断 error.code，
 *      不用管是网络错了、超时了、还是后端返回了业务错误。
 */

/**
 * 统一的接口异常。
 *
 * code 取值：
 *   · 后端返回的业务错误码，如 'INVALID_EXPRESSION'、'DIVISION_BY_ZERO'
 *   · 前端自己产生的 'NETWORK_ERROR'（连不上）、'TIMEOUT'（超时）、'BAD_RESPONSE'（响应格式不对）
 */
class ApiError extends Error {
  /**
   * @param {string} code 错误码
   * @param {string} message 给用户看的中文说明
   * @param {number} [status] HTTP 状态码（如果是业务错误）
   */
  constructor(code, message, status) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

/**
 * 发一个请求，返回响应体里的 data 部分。
 *
 * @param {string} path 接口路径，如 '/api/calculate'
 * @param {{method?: string, body?: object}} [options]
 * @returns {Promise<any>} 后端返回的 data
 * @throws {ApiError} 任何失败情况
 */
async function request(path, options = {}) {
  const method = options.method || 'GET';
  const url = API_BASE_URL + path;

  // 用 AbortController 实现超时。
  // 为什么不用 fetch 自带的 signal 超时参数：那个还不支持得很广泛，
  // AbortController 是标准做法，兼容性更好。
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const init = {
    method,
    signal: controller.signal,
    headers: { Accept: 'application/json' },
  };

  if (options.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }

  let response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    // fetch 只在网络层失败时抛异常（连不上、超时、被 CORS 拦、域名解析不了）
    if (error && error.name === 'AbortError') {
      throw new ApiError('TIMEOUT', `请求超过 ${REQUEST_TIMEOUT_MS / 1000} 秒没有响应，请检查后端服务`);
    }
    throw new ApiError('NETWORK_ERROR', '无法连接后端服务，请确认后端已启动');
  } finally {
    clearTimeout(timer);
  }

  // 204 No Content（删除成功）没有响应体，直接返回
  if (response.status === 204) {
    return null;
  }

  // 解析响应体。即使状态码是错误，后端也会返回 JSON 说明原因，
  // 所以要先把 body 读出来，再决定怎么处理。
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(
      'BAD_RESPONSE',
      `后端返回的内容不是合法 JSON（HTTP ${response.status}）`,
      response.status,
    );
  }

  if (response.ok && payload && payload.success === true) {
    return payload.data;
  }

  // 走到这里说明是错误。优先用后端给的错误码和说明 ——
  // 因为后端的判断才是权威的（前端自己不判断表达式对不对）。
  const code = (payload && payload.errorCode) || 'UNKNOWN_ERROR';
  const message = (payload && payload.message) || `请求失败（HTTP ${response.status}）`;
  throw new ApiError(code, message, response.status);
}

/**
 * 提交表达式给后端计算。
 *
 * ★ 这是整个前端唯一"要求结果"的地方。前端自己永远不算。
 *
 * @param {string} expression 表达式，ASCII 形式（* / - 而不是 × ÷ −）
 * @returns {Promise<{expression: string, result: string, resultNumber: number}>}
 * @throws {ApiError}
 */
async function calculate(expression) {
  return request('/api/calculate', {
    method: 'POST',
    body: { expression },
  });
}

/**
 * 拉取历史记录。
 *
 * @param {{limit?: number, keyword?: string}} [options]
 * @returns {Promise<{items: Array, total: number, limit: number, keyword: string}>}
 * @throws {ApiError}
 */
async function fetchHistory(options = {}) {
  const params = new URLSearchParams();
  if (options.limit) {
    params.set('limit', String(options.limit));
  }
  if (options.keyword) {
    params.set('keyword', options.keyword);
  }

  const query = params.toString();
  return request('/api/history' + (query ? '?' + query : ''));
}

/**
 * 删除一条历史记录。
 *
 * @param {number} id
 * @returns {Promise<void>}
 * @throws {ApiError} 记录不存在时 code 为 'RECORD_NOT_FOUND'
 */
async function deleteHistory(id) {
  await request('/api/history/' + encodeURIComponent(String(id)), { method: 'DELETE' });
}

/**
 * 清空全部历史。
 *
 * @returns {Promise<{deleted: number}>}
 * @throws {ApiError}
 */
async function clearHistory() {
  return request('/api/history', { method: 'DELETE' });
}

/**
 * 健康检查 —— 用来判断后端是否在线。
 *
 * 为什么不复用其它接口：
 *   这个接口不查数据库、不做计算，永远秒回，
 *   适合在页面刚打开时快速判断"后端在不在"。
 *
 * @returns {Promise<boolean>} 后端是否可用
 */
async function checkHealth() {
  try {
    await request('/api/health');
    return true;
  } catch {
    // 健康检查失败不是"错误"，只是一种状态，所以不抛异常。
    // 上层据此把状态丸改成"后端未连接"。
    return false;
  }
}

/**
 * 当前使用的后端地址（只读，供自动化测试断言配置被正确读取）。
 *
 * 为什么导出它：测试需要确认"前端到底在往哪个地址发请求"。
 * 部署时最常见的故障就是地址写错，而界面上完全看不出来。
 */
const API_BASE_URL_FOR_TEST = API_BASE_URL;

  return { ApiError, calculate, fetchHistory, deleteHistory, clearHistory, checkHealth, API_BASE_URL_FOR_TEST };
  })(API_BASE_URL, REQUEST_TIMEOUT_MS);

  /* 把 api 的导出摊到打包作用域，供后续模块按名字引用 */
  const { ApiError, calculate, fetchHistory, deleteHistory, clearHistory, checkHealth, API_BASE_URL_FOR_TEST } = api;

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
 * 更新右下角的后端连接状态文字。
 * @param {string} text
 */
function setBackendStatus(text) {
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
function setBackendDot(state) {
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

  return { toDisplayText, render, flashKey, setArmedOperator, setBackendStatus, setBackendDot, showMessage, showServerError };
  })();

  /* 把 ui 的导出摊到打包作用域，供后续模块按名字引用 */
  const { toDisplayText, render, flashKey, setArmedOperator, setBackendStatus, setBackendDot, showMessage, showServerError } = ui;

  /* ===== 源文件：src/js/history.js（生成物，请勿手工编辑） ===== */
  const history = (function (HISTORY_EXPRESSION_MAX_LENGTH) {
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
function setDeleteHandler(handler) {
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
function setStatus(text, type = 'info') {
  statusEl.textContent = text;
  statusEl.classList.toggle('is-error', type === 'error');
}

/**
 * 渲染历史列表。
 *
 * @param {Array<{id: number, expression: string, result: string, createdAt: string}>} items
 * @param {number} total 后端报告的总条数（可能大于当前显示的条数）
 */
function renderList(items, total) {
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
function clearList() {
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

  return { setDeleteHandler, setStatus, renderList, clearList };
  })(HISTORY_EXPRESSION_MAX_LENGTH);

  /* 把 history 的导出摊到打包作用域，供后续模块按名字引用 */
  const { setDeleteHandler, setStatus, renderList, clearList } = history;

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
function setSubmitHandler(handler) {
  onSubmit = handler;
}

/**
 * 更新结果行。
 * @param {string} value 要显示的文字
 * @param {boolean} [isPlaceholder] 是否是占位提示（而非真实结果）
 */
function setResult(value, isPlaceholder = false) {
  display = { value, isPlaceholder };
  render(state, display);
}

/**
 * 读取当前表达式（ASCII 形式）。
 * @returns {string}
 */
function getExpression() {
  return state.text;
}

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
function setMessage(message, messageType = 'hint') {
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

  return { setSubmitHandler, setResult, setMessage, getExpression, handleKey };
  })(createState, applyKey, canSubmit, render, setArmedOperator, flashKey);

  /* 把 buttons 的导出摊到打包作用域，供后续模块按名字引用 */
  const { setSubmitHandler, setResult, setMessage, getExpression, handleKey } = buttons;

  /* ===== 源文件：src/js/app.js（生成物，请勿手工编辑） ===== */
  const app = (function (calculate, fetchHistory, deleteHistory, clearHistory, checkHealth, API_BASE_URL_FOR_TEST, render, setBackendStatus, setBackendDot, showServerError, setDeleteHandler, setStatus, renderList, clearList, setSubmitHandler, setResult, setMessage, getExpression, HISTORY_PAGE_SIZE) {
/**
 * 主控模块（app）—— 把各个模块装配起来，并决定"什么时候做什么"。
 *
 * 这是唯一知道"整个应用怎么运转"的文件。它负责：
 *
 *   1. 启动时检查后端是否在线（并把状态显示在显示屏右下角）
 *   2. 按 = 时：调用后端计算 → 显示结果 → 刷新历史
 *   3. 删除历史记录 → 刷新列表
 *   4. 搜索历史、清空历史
 *   5. 把"提交"的回调注入给 calc-buttons（避免循环依赖）
 *
 * 它不负责：
 *   · 表达式是否合法（input-model 管）
 *   · 怎么画界面（ui / history 管）
 *   · 怎么发请求（api 管）
 *
 * ★ 全文没有一处算术。结果始终来自后端的 result 字段。
 */





/**
 * ★ 为什么全部是"按名字 import"而不是 `import * as xxx`：
 *   打包器把每个模块包成 IIFE，依赖以函数参数形式传入
 *   （形如 `function (calculate, renderList, ...) {...}`）。
 *   所以模块内部只能用这些名字；写成 calculate(...) 会解析不到 api。
 *   这一点踩过一次：整包抛 ReferenceError，页面完全没反应。
 */

/** 是否已经警告过后端离线（避免每次按 = 都重复刷新同一句提示） */
let warnedOffline = false;

/** 是否正在请求中（防止用户连点 = 发出多个请求） */
let submitting = false;

/** 当前的搜索关键字 */
let keyword = '';

// ================================================================ 后端状态

/**
 * 检查后端是否在线，并更新右下角的状态显示。
 * @returns {Promise<boolean>}
 */
async function refreshBackendStatus() {
  const online = await checkHealth();

  if (online) {
    setBackendStatus('后端已连接 · 结果由后端计算');
    setBackendDot('online');
  } else {
    setBackendStatus('后端未连接 · 无法计算');
    setBackendDot('offline');
  }

  return online;
}

// ================================================================ 计算流程

/**
 * 提交表达式给后端计算。
 *
 * ★ 这是整个前端最关键的一段：它体现了作业要求的"结果由后端产生"。
 *   前端把表达式**原样**发出去（ASCII 形式），后端算完把 result 发回来，
 *   前端只负责显示。前端从头到尾不知道 12+8 等于几，除非后端告诉它。
 *
 * @param {string} expression
 */
async function submit(expression) {
  if (submitting) {
    return; // 上一次还没回来，忽略这次点击
  }

  submitting = true;
  setMessage('正在由后端计算 …', 'hint');
  setResult('计算中 …', true);

  try {
    const data = await calculate(expression);

    // 显示后端返回的结果。
    // 注意 data.result 是**字符串**（后端用 Decimal 算，字符串能保住精度），
    // 直接显示即可，前端不做任何数值转换。
    setResult(data.result, false);
    setMessage(`${data.expression} = ${data.result}`, 'hint');

    // 后端在计算的同时已经把这条记录写进了数据库，
    // 所以这里只需要重新拉一次列表就能看到它。
    await loadHistory();

    warnedOffline = false;
  } catch (error) {
    handleApiError(error);
  } finally {
    submitting = false;
  }
}

// ================================================================ 错误处理

/**
 * 把接口异常翻译成界面上的提示。
 *
 * 分工：
 *   · 后端返回的业务错误（INVALID_EXPRESSION / DIVISION_BY_ZERO 等）
 *     → 用 showServerError，它有一张错误码到中文的翻译表。
 *       用这张表而不是直接用后端传来的 message，是为了让文案集中可控，
 *       而且后端改文案时前端不会跟着变样。
 *   · 网络类错误（连不上、超时）
 *     → 这是"前端自己知道的问题"，直接提示，并刷新后端状态显示。
 *
 * @param {unknown} error
 */
function handleApiError(error) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'UNKNOWN_ERROR';
  const message = error instanceof Error ? error.message : '发生未知错误';

  if (code === 'NETWORK_ERROR' || code === 'TIMEOUT') {
    setResult('—', true);
    setMessage(message, 'error');
    setBackendStatus('后端未连接 · 无法计算');
    setBackendDot('offline');

    if (!warnedOffline) {
      // 只在第一次离线时提醒去启动后端，避免反复刷同一句
      setStatus('计算记录来自后端数据库。后端未连接时无法读取。', 'error');
      warnedOffline = true;
    }
    return;
  }

  // 业务错误：后端说了算，前端只负责翻译成中文并标红
  showServerError(code);
  setMessage(code === 'DIVISION_BY_ZERO' ? '除数不能为 0' : message, 'error');
}

// ================================================================ 历史记录

/**
 * 拉取并渲染历史列表。
 */
async function loadHistory() {
  try {
    const data = await fetchHistory({ limit: HISTORY_PAGE_SIZE, keyword });

    renderList(data.items, data.total);

    if (data.items.length === 0) {
      setStatus(
        keyword ? `没有找到包含「${keyword}」的记录` : '还没有计算记录。算一道题就会出现在这里。',
      );
    } else if (data.total > data.items.length) {
      setStatus(`只显示最近 ${data.items.length} 条，共 ${data.total} 条。`);
    } else {
      setStatus('');
    }
  } catch (error) {
    clearList();
    const message = error instanceof Error ? error.message : '读取历史失败';
    setStatus('读取历史失败：' + message, 'error');
  }
}

/**
 * 删除一条历史记录。
 * @param {number} id
 */
async function removeRecord(id) {
  try {
    await deleteHistory(id);
    await loadHistory();
  } catch (error) {
    const message = error instanceof Error ? error.message : '删除失败';
    setStatus('删除失败：' + message, 'error');
    // 失败时也要刷新，把按钮上那个 "…" 恢复成"删除"
    await loadHistory();
  }
}

/**
 * 清空全部历史。
 */
async function clearAll() {
  if (window.confirm('确定要清空全部历史记录吗？此操作不可撤销。') !== true) {
    return;
  }

  try {
    const data = await clearHistory();
    await loadHistory();
    setStatus(`已清空 ${data.deleted} 条记录。`);
  } catch (error) {
    const message = error instanceof Error ? error.message : '清空失败';
    setStatus('清空失败：' + message, 'error');
  }
}

// ================================================================ 事件绑定

/**
 * 绑定历史区里的搜索框与清空按钮。
 *
 * 搜索用防抖：每敲一个字都发请求会很浪费，而且返回顺序可能错乱。
 * 等用户停手 300 毫秒再发。
 */
function bindHistoryControls() {
  const input = document.getElementById('history-keyword');
  const clearButton = document.getElementById('history-clear');

  if (input instanceof HTMLInputElement) {
    let debounceTimer = 0;
    input.addEventListener('input', () => {
      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        keyword = input.value.trim();
        loadHistory();
      }, 300);
    });
  }

  if (clearButton instanceof HTMLElement) {
    clearButton.addEventListener('click', clearAll);
  }
}

// ================================================================ 兼容接口（自动化测试用）

/**
 * 只读调试接口 —— 供自动化测试观察内部状态。
 *
 * 为什么需要：测试要能判断"结果行显示的是后端返回的值还是前端自己算的"。
 * 这里只提供读取，没有写入入口，因此不构成绕过校验的后门。
 */
function exposeDebugApi() {
  Object.defineProperty(window, '__app', {
    configurable: true,
    value: {
      getExpression,
      /** 重新检查后端状态（测试里用来等待后端就绪） */
      refreshBackendStatus,
      /** 手动触发一次历史刷新 */
      reloadHistory: loadHistory,
      /** 后端地址，便于测试断言配置是否被正确读取 */
      apiBaseUrl: API_BASE_URL_FOR_TEST,
    },
  });
}

// ================================================================ 启动

/**
 * 启动应用。
 *
 * 顺序有讲究：
 *   1. 先注入提交回调 —— 否则用户在状态检查完成前按 = 会没有任何反应
 *   2. 绑定历史区的控件
 *   3. 再去做网络请求（检查后端、拉历史）
 *      这两件事是并行的，不互相等待 —— 后端慢的时候界面依然可用。
 */
function boot() {
  setSubmitHandler(submit);
  setDeleteHandler(removeRecord);
  bindHistoryControls();
  exposeDebugApi();

  // 两个网络请求并行发出，不 await 其中任何一个再发另一个，省一个来回的时间
  refreshBackendStatus();
  loadHistory();
}

  return { boot };
  })(calculate, fetchHistory, deleteHistory, clearHistory, checkHealth, API_BASE_URL_FOR_TEST, render, setBackendStatus, setBackendDot, showServerError, setDeleteHandler, setStatus, renderList, clearList, setSubmitHandler, setResult, setMessage, getExpression, HISTORY_PAGE_SIZE);

  /* 把 app 的导出摊到打包作用域，供后续模块按名字引用 */
  const { boot } = app;

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

  /* ===== 源文件：src/js/boot.js（生成物，请勿手工编辑） ===== */
  (function (boot) {
/**
 * 启动脚本 —— 整个应用的最后一块拼图。
 *
 * 为什么启动逻辑要单独一个文件，而不是写在 app.js 的末尾：
 *   因为 bundle.js 是把所有模块**按顺序拼在一个作用域里**的。
 *   如果 app.js 在文件末尾直接调用 boot()，那么拼包时它会在
 *   "键盘模块还没定义"的时候就执行 —— 页面直接报错。
 *   （这个坑在打包器上真实踩过：bundle 的依赖顺序很敏感。）
 *
 *   单独一个 boot.js 放在**最后一个**文件，并且用 DOMContentLoaded 兜底，
 *   就保证了"所有模块都已定义"之后才启动。
 *
 * 顺序说明：
 *   · 先给 window.__calc 挂上只读调试接口（自动化测试要用）
 *   · 再调 app.boot() 真正启动
 */

/**
 * 真正的启动动作。
 */
function start() {
  try {
    boot();
  } catch (error) {
    // 启动失败必须留下痕迹 —— 否则页面看起来正常但点了没反应，
    // 和当年 file:// 那个坑的表现一模一样，极难排查。
    console.error('[计算器] 启动失败：', error);
    const messageEl = document.getElementById('message');
    if (messageEl) {
      messageEl.textContent = '页面启动失败，请按 F12 查看控制台错误';
      messageEl.classList.add('is-error');
    }
  }
}

if (document.readyState === 'loading') {
  // 文档还在加载：等 DOM 就绪再启动（脚本放在 body 末尾时通常不会走这里）
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  // 文档已就绪：直接启动
  start();
}

  })(boot);


  /* 自动化测试与截图工具用的只读接口（见 tools/e2e-click.mjs、tools/verify-deployed.mjs） */
  window.__calc = {
    createState: model.createState,
    applyKey: model.applyKey,
    render: ui.render,
    setArmedOperator: ui.setArmedOperator,
    flashKey: ui.flashKey,
    showServerError: ui.showServerError,
    /* 交互代码是否已启动 —— e2e 测试的第一条断言就是它 */
    isBooted: () => document.getElementById('keys') !== null && document.getElementById('keys').tabIndex === -1,
    /* 当前表达式（ASCII 原文，供测试判断表里分离是否正确） */
    getExpression: buttons.getExpression,
    /* 后端地址（供测试断言配置被正确读取） */
    getApiBaseUrl: () => api.API_BASE_URL_FOR_TEST,
  };

})();
