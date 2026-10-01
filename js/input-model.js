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
export const ALLOWED_CHARS = '0123456789.+-*/()';

/** 四则运算符 */
export const OPERATORS = '+-*/';

/** 表达式长度上限，防止无意义超长输入 */
export const MAX_LENGTH = 60;

/** 四种运算符，用于运算符键的"换键"行为 */
const OPERATOR_SET = ['+', '-', '*', '/'];

/**
 * 新建一个空缓冲区状态。
 * @returns {BufferState}
 */
export function createState() {
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
export function trailingNumber(text) {
  const match = text.match(/[0-9.]+$/);
  return match ? match[0] : '';
}

/**
 * 判断一个片段是不是合法数字：至少一位数字，且最多一个小数点。
 * @param {string} segment
 * @returns {boolean}
 */
export function isNumberSegment(segment) {
  return /^\d+(\.\d+)?$/.test(segment) || /^\d+\.$/.test(segment);
}

/**
 * 统计括号是否配对（左括号数 >= 右括号数即"目前还算合法"）。
 * @param {string} text
 * @returns {{depth: number, balanced: boolean}}
 */
export function parenInfo(text) {
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
export function canSubmit(text) {
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
export function applyKey(state, key) {
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
