/**
 * Expression buffer — the calculator's input model.
 *
 * Responsibility boundary (important):
 *   This module only does **string-level input validation and assembly**;
 *   it does not parse, evaluate, or produce any calculation result.
 *   The assignment explicitly requires the final result to come from the back-end,
 *   so not even a single `+` operation is allowed here, let alone eval/Function.
 *
 * Cursor model: an expression is a piece of text plus an insertion position cursor
 * (0..text.length).
 *   To keep the implementation simple, this version always appends input at the end and
 *   deletes from the end on backspace, so cursor always equals text.length — the field is kept
 *   so that adding "insert in the middle" later will not require rewriting callers.
 *
 * @typedef {object} BufferState
 * @property {string} text           Expression text; uses * / and - internally, mapped to × ÷ −
 *                                   in the UI
 * @property {number} cursor         Insertion position
 * @property {string} message        Message shown to the user (empty string when normal)
 * @property {string} messageType    'hint' | 'error'
 */

/** Whitelist of characters allowed inside an expression */
export const ALLOWED_CHARS = '0123456789.+-*/()';

/** Arithmetic operators */
export const OPERATORS = '+-*/';

/** Maximum expression length, to prevent meaningless oversized input */
export const MAX_LENGTH = 60;

/** The four operators, used for the "swap key" behavior of operator keys */
const OPERATOR_SET = ['+', '-', '*', '/'];

/**
 * Create a new empty buffer state.
 * @returns {BufferState}
 */
export function createState() {
  return { text: '', cursor: 0, message: '', messageType: 'hint' };
}

/**
 * Return a copy of the state carrying a message (pure function, does not mutate the original).
 * @param {BufferState} state
 * @param {string} message
 * @param {string} [messageType]
 * @returns {BufferState}
 */
function withMessage(state, message, messageType = 'hint') {
  return { ...state, message, messageType };
}

/**
 * Build an "input rejected" state: the text is unchanged, only a message is attached.
 * Every validation failure goes through here, so "reject input" has exactly one implementation.
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
 * Take the trailing run of digits/decimal point, e.g. '12+3.5' → '3.5' (empty string if none).
 * @param {string} text
 * @returns {string}
 */
export function trailingNumber(text) {
  const match = text.match(/[0-9.]+$/);
  return match ? match[0] : '';
}

/**
 * Check whether a segment is a valid number: at least one digit and at most one decimal point.
 * @param {string} segment
 * @returns {boolean}
 */
export function isNumberSegment(segment) {
  return /^\d+(\.\d+)?$/.test(segment) || /^\d+\.$/.test(segment);
}

/**
 * Check whether parentheses are balanced (left count >= right count means "still valid so far").
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
 * Used by "=": decide whether the current expression "can be submitted to the back-end".
 * Only covers what the front-end can judge responsibly: non-empty, balanced parentheses,
 * and not ending with an operator or a decimal point.
 * @param {string} text
 * @returns {{ok: true} | {ok: false, message: string}}
 */
export function canSubmit(text) {
  if (text === '') {
    return { ok: false, message: 'Enter an expression' };
  }
  const { depth } = parenInfo(text);
  if (depth !== 0) {
    return { ok: false, message: 'Unbalanced parentheses: ' + depth + ' left unclosed' };
  }
  const last = text.slice(-1);
  if (isOperator(last)) {
    return { ok: false, message: 'Incomplete expression: it ends with an operator' };
  }
  if (last === '.') {
    return { ok: false, message: 'Incomplete expression: no digits after the decimal point' };
  }
  if (last === '(') {
    return { ok: false, message: 'Incomplete expression: nothing after the left parenthesis' };
  }
  return { ok: true };
}

/**
 * Digit key: append one digit.
 * @param {BufferState} state
 * @param {string} digit
 * @returns {BufferState}
 */
function inputDigit(state, digit) {
  if (state.text.length >= MAX_LENGTH) {
    return reject(state, 'Expression is limited to ' + MAX_LENGTH + ' characters');
  }
  // A number must not start with 0 (except '0' itself); e.g. pressing 5 right after 0 gives
  // "05", which is a typo
  if (lastChar(state) === '0' && trailingNumber(state.text) === '0' && digit !== '.') {
    return reject(state, 'A number cannot start with 0');
  }
  return withMessage(
    { ...state, text: state.text + digit, cursor: state.text.length + 1 },
    'Press = to calculate on the back end',
  );
}

/**
 * Decimal point: at most one per number.
 * @param {BufferState} state
 * @returns {BufferState}
 */
function inputDot(state) {
  if (state.text.length >= MAX_LENGTH) {
    return reject(state, 'Expression is limited to ' + MAX_LENGTH + ' characters');
  }
  if (trailingNumber(state.text).includes('.')) {
    return reject(state, 'A number can have only one decimal point');
  }
  if (lastChar(state) === ')') {
    return reject(state, 'A decimal point cannot follow a right parenthesis');
  }
  const prefix = trailingNumber(state.text) === '' ? '0' : '';
  return withMessage(
    { ...state, text: state.text + prefix + '.', cursor: state.text.length + prefix.length + 1 },
    'Typing a decimal number',
  );
}

/**
 * Arithmetic operator: a run of consecutive operators may contain only one minus sign
 * (to express a negative number).
 * @param {BufferState} state
 * @param {string} operator
 * @returns {BufferState}
 */
function inputOperator(state, operator) {
  const last = lastChar(state);

  if (state.text === '') {
    if (operator === '-') {
      return withMessage({ ...state, text: '-', cursor: 1 }, 'Typing a negative number');
    }
    return reject(state, 'An expression cannot start with ' + operator);
  }

  // Consecutive operators: replace the operator just entered instead of appending another one.
  // This is typical behavior in real calculators, and it also settles the "consecutive
  // operators" legality problem.
  if (isOperator(last)) {
    if (operator === '-' && last !== '-') {
      return withMessage(
        { ...state, text: state.text + '-' },
        'The minus here means a negative number, as in 3*-2',
      );
    }
    const swapped = state.text.slice(0, -1) + operator;
    return withMessage({ ...state, text: swapped }, 'Changed to ' + operator);
  }

  if (last === '(') {
    if (operator === '-') {
      return withMessage(
        { ...state, text: state.text + '-' },
        'Negative number inside the parentheses',
      );
    }
    return reject(state, 'An operator cannot follow a left parenthesis');
  }

  if (last === '.') {
    return reject(state, 'Enter a digit after the decimal point');
  }

  return withMessage(
    { ...state, text: state.text + operator, cursor: state.text.length + 1 },
    'Keep typing digits or use parentheses',
  );
}

/**
 * Left parenthesis: when it follows a digit or a right parenthesis, an implicit multiplication
 * sign is inserted.
 * @param {BufferState} state
 * @returns {BufferState}
 */
function inputLeftParen(state) {
  if (state.text.length >= MAX_LENGTH) {
    return reject(state, 'Expression is limited to ' + MAX_LENGTH + ' characters');
  }
  const last = lastChar(state);
  const needsMultiply = isDigit(last) || last === ')' || last === '.';
  const addition = needsMultiply ? '*(' : '(';
  return withMessage(
    { ...state, text: state.text + addition, cursor: state.text.length + addition.length },
    needsMultiply
      ? 'Inserted a multiplication sign between the number and the parenthesis'
      : 'A sub-expression can go inside the parentheses',
  );
}

/**
 * Right parenthesis: an unclosed left parenthesis must exist, and it must not directly follow
 * an operator or a left parenthesis.
 * @param {BufferState} state
 * @returns {BufferState}
 */
function inputRightParen(state) {
  const { depth } = parenInfo(state.text);
  if (depth === 0) {
    return reject(state, 'No matching left parenthesis');
  }
  const last = lastChar(state);
  if (isOperator(last) || last === '(') {
    return reject(state, 'Missing a number before the right parenthesis');
  }
  return withMessage(
    { ...state, text: state.text + ')', cursor: state.text.length + 1 },
    depth === 1 ? 'Parenthesis closed' : 'Left parentheses still open: ' + (depth - 1),
  );
}

/**
 * Negation is always written in the parenthesized form (-number) rather than inserting a bare '-'.
 * Reason: although '5+-3' is accepted by most parsers, its meaning depends on parser leniency;
 *      '5+(-3)' is unambiguous for any back-end parser.
 * @param {BufferState} state
 * @returns {BufferState}
 */
function toggleSign(state) {
  const text = state.text;

  // Case 1: the tail is (-number) — the inverse operation, dropping both the parentheses and
  // the minus sign
  const wrapped = text.match(/\(-(\d+(?:\.\d+)?)\)$/);
  if (wrapped) {
    const next = text.slice(0, wrapped.index) + wrapped[1];
    return withMessage(
      { ...state, text: next, cursor: next.length },
      'Minus sign removed',
    );
  }

  // Case 2: the tail is a plain number — wrap it in parentheses and add a minus sign
  const tail = trailingNumber(text);
  if (tail === '' || !isNumberSegment(tail)) {
    return reject(state, 'Enter a complete number before pressing ±');
  }

  const before = text.slice(0, text.length - tail.length);
  const next = before + '(-' + tail + ')';
  if (next.length > MAX_LENGTH) {
    return reject(state, 'Expression is limited to ' + MAX_LENGTH + ' characters');
  }
  return withMessage(
    { ...state, text: next, cursor: next.length },
    'Negated (wrapped in parentheses to avoid ambiguity)',
  );
}

/**
 * Backspace: delete one character from the end.
 * @param {BufferState} state
 * @returns {BufferState}
 */
function backspace(state) {
  if (state.text === '') {
    return withMessage(state, 'Already empty');
  }
  // For a tail like ...(-5), deleting the whole parenthesized group in one backspace is more
  // intuitive
  const trimmed = state.text.replace(/\(-\d+(\.\d+)?\)$/, (match) => match.slice(2, -1));
  const next = trimmed === state.text ? state.text.slice(0, -1) : trimmed;
  return withMessage({ ...state, text: next, cursor: next.length }, '');
}

/**
 * Clear.
 * @returns {BufferState}
 */
function clear() {
  return withMessage(createState(), 'Cleared');
}

/**
 * Single entry point: apply one "key semantic" to the buffer state (pure function, does not
 * mutate the original).
 *
 * Every kind of input goes through this one function because mouse clicks and the physical keyboard
 * must follow the same rule set; as long as both call applyKey, a key can never be legal on
 * one path and illegal on the other.
 *
 * @param {BufferState} state
 * @param {string} key  digit, '.', '+ - * /', '(' ')', 'AC', 'BACK', 'NEG'
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
  return reject(state, 'Unsupported key: ' + key);
}
