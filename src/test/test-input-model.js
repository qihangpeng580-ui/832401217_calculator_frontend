/**
 * 表达式缓冲区自测脚本（零依赖）。
 *
 * 运行：node src/test/test-input-model.js
 *
 * 为什么要有这个文件：
 *   输入规则（连续运算符、小数点、括号配对…）是最容易改一处坏一处的地方。
 *   界面上的问题肉眼能看见，但"某条规则被悄悄破坏"不一定马上暴露。
 *   所以把规则写成断言，每次改完跑一遍，几秒钟就知道有没有踩坏东西。
 *   这也是极限编程里"编码前先写测试"的最小实践。
 */

import { applyKey, createState, canSubmit, parenInfo, trailingNumber } from '../js/input-model.js';

let passed = 0;
const failures = [];

/**
 * 断言两个值相等。
 * @param {string} name 用例名
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
 * 依次按下若干按键，返回结果状态。
 * @param {string[]} keys
 */
function press(keys) {
  return keys.reduce((state, key) => applyKey(state, key), createState());
}

/**
 * 依次按键后取表达式文本。
 * @param {string[]} keys
 * @returns {string}
 */
function textOf(keys) {
  return press(keys).text;
}

/**
 * 依次按键后取提示类型。
 * @param {string[]} keys
 * @returns {string}
 */
function typeOf(keys) {
  return press(keys).messageType;
}

// ---------------------------------------------------------------- 基本输入
is('单个数字', textOf(['7']), '7');
is('多位数', textOf(['1', '2', '3']), '123');
is('加法', textOf(['1', '2', '+', '8']), '12+8');
is('减法', textOf(['9', '-', '4']), '9-4');
is('乘法', textOf(['5', '*', '8']), '5*8');
is('除法', textOf(['1', '0', '/', '2']), '10/2');
is('小数点', textOf(['3', '.', '5']), '3.5');
is('小数相加', textOf(['0', '.', '1', '+', '0', '.', '2']), '0.1+0.2');

// ---------------------------------------------------------------- 开头限制
is('不能以 + 开头', textOf(['+']), '');
is('不能以 * 开头', textOf(['*']), '');
is('允许以 - 开头（负数）', textOf(['-', '5']), '-5');
is('开头按键给出错误提示', typeOf(['+']), 'error');

// ---------------------------------------------------------------- 连续运算符
is('连续运算符被替换而非追加', textOf(['1', '+', '*']), '1*');
is('加号后接减号表示负数', textOf(['3', '*', '-', '2']), '3*-2');
is('连续同类运算符只留一个', textOf(['1', '+', '+']), '1+');
is('替换运算符后提示为普通提示', typeOf(['1', '+', '*']), 'hint');

// ---------------------------------------------------------------- 小数点
is('同一数字第二个小数点被拒', textOf(['1', '.', '2', '.']), '1.2');
is('第二个小数点给出错误提示', typeOf(['1', '.', '2', '.']), 'error');
is('小数点自动补前导零', textOf(['.']), '0.');
is('右括号后不能跟小数点', textOf(['(', '1', ')', '.']), '(1)');
is('小数点后不能直接跟运算符', textOf(['1', '.', '+']), '1.');

// ---------------------------------------------------------------- 括号
is('括号配对', textOf(['(', '1', '+', '2', ')']), '(1+2)');
is('左括号后不能直接跟运算符', textOf(['(', '+']), '(');
is('右括号前必须有数字', textOf(['(', '1', '+', ')']), '(1+');
is('没有左括号时右括号被拒', textOf(['1', ')']), '1');
is('数字后接左括号自动补乘号', textOf(['2', '(']), '2*(');
is('右括号后接左括号自动补乘号', textOf(['(', '1', ')', '(']), '(1)*(');

// ---------------------------------------------------------------- 正负号
is('取负用括号包住', textOf(['5', '+', '3', 'NEG']), '5+(-3)');
is('再按一次取消负号', textOf(['5', '+', '3', 'NEG', 'NEG']), '5+3');
is('空表达式取负被拒', textOf(['NEG']), '');
is('空表达式取负给出错误提示', typeOf(['NEG']), 'error');

// ---------------------------------------------------------------- 退格与清空
is('退格删一个字符', textOf(['1', '2', '3', 'BACK']), '12');
is('退格删掉负号组', textOf(['5', 'NEG', 'BACK']), '5');
is('空表达式退格不报错', textOf(['BACK']), '');
is('AC 清空', textOf(['1', '+', '2', 'AC']), '');
is('AC 后状态为普通提示', typeOf(['1', 'AC']), 'hint');

// ---------------------------------------------------------------- 长度上限
is('超长输入被截断在 60 字符', textOf(new Array(80).fill('1')).length, 60);

// ---------------------------------------------------------------- 辅助函数
is('末尾数字提取', trailingNumber('12+3.5'), '3.5');
is('末尾不是数字时返回空串', trailingNumber('12+'), '');
is('括号统计：未闭合', parenInfo('((1+2)').depth, 1);
is('括号统计：已闭合', parenInfo('(1+2)').depth, 0);

// ---------------------------------------------------------------- 提交校验
is('空表达式不能提交', canSubmit('').ok, false);
is('括号未闭合不能提交', canSubmit('(1+2').ok, false);
is('以运算符结尾不能提交', canSubmit('1+').ok, false);
is('以小数点结尾不能提交', canSubmit('1.').ok, false);
is('完整表达式可以提交', canSubmit('(1+2)*3').ok, true);
is('负数表达式可以提交', canSubmit('3*-2').ok, true);

// ---------------------------------------------------------------- 白名单
is('不支持的按键被拒', textOf(['%']), '');
is('不支持的按键给出错误提示', typeOf(['%']), 'error');

// ---------------------------------------------------------------- 输出结果
const total = passed + failures.length;
if (failures.length === 0) {
  console.log('全部通过：' + passed + '/' + total);
  process.exit(0);
}

console.error('失败 ' + failures.length + ' 项（共 ' + total + '）：');
for (const item of failures) {
  console.error('  ✗ ' + item.name);
  console.error('      期望：' + JSON.stringify(item.expected));
  console.error('      实际：' + JSON.stringify(item.actual));
}
process.exit(1);
