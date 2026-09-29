/**
 * Expression buffer self-test script (zero dependencies).
 *
 * Run: node src/test/test-input-model.js
 *
 * Why this file exists:
 *   the input rules (consecutive operators, decimal point, parenthesis matching, ...) are the place
 *   where one change most easily breaks something else. UI problems are visible to the eye, but
 *   "a rule was quietly broken" does not necessarily surface right away.
 *   So the rules are written as assertions: run them after every change and a few seconds tell you
 *   whether anything got broken.
 *   This is also the smallest practice of "write the test before the code" from Extreme
 *   Programming.
 */

import { applyKey, createState, canSubmit, parenInfo, trailingNumber } from '../js/input-model.js';

let passed = 0;
const failures = [];

/**
 * Assert that two values are equal.
 * @param {string} name test case name
 * @param {unknown} actual
 * @param {unknown} expected
 */
function is(name, actual, expected) {
  if (actual === expected) {
    passed += 1;
    return;
  }
  failures.push({ name, actual, expected });
}

/**
 * Press a sequence of keys and return the resulting state.
 * @param {string[]} keys
 */
function press(keys) {
  return keys.reduce((state, key) => applyKey(state, key), createState());
}

/**
 * Press a sequence of keys and return the expression text.
 * @param {string[]} keys
 * @returns {string}
 */
function textOf(keys) {
  return press(keys).text;
}

/**
 * Press a sequence of keys and return the message type.
 * @param {string[]} keys
 * @returns {string}
 */
function typeOf(keys) {
  return press(keys).messageType;
}

// ---------------------------------------------------------------- Basic input
is('single digit', textOf(['7']), '7');
is('multi-digit number', textOf(['1', '2', '3']), '123');
is('addition', textOf(['1', '2', '+', '8']), '12+8');
is('subtraction', textOf(['9', '-', '4']), '9-4');
is('multiplication', textOf(['5', '*', '8']), '5*8');
is('division', textOf(['1', '0', '/', '2']), '10/2');
is('decimal point', textOf(['3', '.', '5']), '3.5');
is('adding decimals', textOf(['0', '.', '1', '+', '0', '.', '2']), '0.1+0.2');

// ---------------------------------------------------------------- Leading input restrictions
is('cannot start with +', textOf(['+']), '');
is('cannot start with *', textOf(['*']), '');
is('may start with - (negative number)', textOf(['-', '5']), '-5');
is('a leading operator key reports an error', typeOf(['+']), 'error');

// ---------------------------------------------------------------- Consecutive operators
is('a consecutive operator is replaced, not appended', textOf(['1', '+', '*']), '1*');
is('a minus after a plus means a negative number', textOf(['3', '*', '-', '2']), '3*-2');
is('only one of consecutive same-type operators is kept', textOf(['1', '+', '+']), '1+');
is('replacing an operator yields a hint', typeOf(['1', '+', '*']), 'hint');

// ---------------------------------------------------------------- Decimal point
is('a second decimal point in the same number is rejected', textOf(['1', '.', '2', '.']), '1.2');
is('the second decimal point reports an error', typeOf(['1', '.', '2', '.']), 'error');
is('a leading zero is added before the decimal point', textOf(['.']), '0.');
is('a decimal point cannot follow a right parenthesis', textOf(['(', '1', ')', '.']), '(1)');
is('an operator cannot directly follow a decimal point', textOf(['1', '.', '+']), '1.');

// ---------------------------------------------------------------- Parentheses
is('parentheses match', textOf(['(', '1', '+', '2', ')']), '(1+2)');
is('an operator cannot directly follow a left parenthesis', textOf(['(', '+']), '(');
is('a number is required before the right parenthesis', textOf(['(', '1', '+', ')']), '(1+');
is('a right parenthesis with no left one is rejected', textOf(['1', ')']), '1');
is(
  'a left parenthesis after a number gets an implicit multiplication sign',
  textOf(['2', '(']),
  '2*(',
);
is(
  'a left parenthesis after a right one gets an implicit multiplication sign',
  textOf(['(', '1', ')', '(']),
  '(1)*(',
);

// ---------------------------------------------------------------- Sign
is('negation is wrapped in parentheses', textOf(['5', '+', '3', 'NEG']), '5+(-3)');
is('pressing again removes the minus sign', textOf(['5', '+', '3', 'NEG', 'NEG']), '5+3');
is('negating an empty expression is rejected', textOf(['NEG']), '');
is('negating an empty expression reports an error', typeOf(['NEG']), 'error');

// ---------------------------------------------------------------- Backspace and clear
is('backspace deletes one character', textOf(['1', '2', '3', 'BACK']), '12');
is('backspace deletes the whole sign group', textOf(['5', 'NEG', 'BACK']), '5');
is('backspace on an empty expression reports nothing', textOf(['BACK']), '');
is('AC clears the expression', textOf(['1', '+', '2', 'AC']), '');
is('the state after AC is a hint', typeOf(['1', 'AC']), 'hint');

// ---------------------------------------------------------------- Length limit
is('over-long input is truncated at 60 characters', textOf(new Array(80).fill('1')).length, 60);

// ---------------------------------------------------------------- Helper functions
is('trailing number extraction', trailingNumber('12+3.5'), '3.5');
is('an empty string is returned when the tail is not a number', trailingNumber('12+'), '');
is('parenthesis count: unclosed', parenInfo('((1+2)').depth, 1);
is('parenthesis count: closed', parenInfo('(1+2)').depth, 0);

// ---------------------------------------------------------------- Submission validation
is('an empty expression cannot be submitted', canSubmit('').ok, false);
is('unclosed parentheses cannot be submitted', canSubmit('(1+2').ok, false);
is('an expression ending with an operator cannot be submitted', canSubmit('1+').ok, false);
is('an expression ending with a decimal point cannot be submitted', canSubmit('1.').ok, false);
is('a complete expression can be submitted', canSubmit('(1+2)*3').ok, true);
is('a negative expression can be submitted', canSubmit('3*-2').ok, true);

// ---------------------------------------------------------------- Whitelist
is('an unsupported key is rejected', textOf(['%']), '');
is('an unsupported key reports an error', typeOf(['%']), 'error');

// ---------------------------------------------------------------- Output
const total = passed + failures.length;
if (failures.length === 0) {
  console.log('All passed: ' + passed + '/' + total);
  process.exit(0);
}

console.error('Failed ' + failures.length + ' of ' + total + ': ');
for (const item of failures) {
  console.error('  ✗ ' + item.name);
  console.error('      expected: ' + JSON.stringify(item.expected));
  console.error('      actual:   ' + JSON.stringify(item.actual));
}
process.exit(1);
