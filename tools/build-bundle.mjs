/**
 * 打包脚本：把 src/js 下的四个 ES 模块合并成一个「传统脚本」
 * （tools/build-bundle.mjs）
 *
 * 运行：node tools/build-bundle.mjs
 * 产物：src/js/bundle.js（生成物，不要手工编辑）
 *
 * ★ 为什么需要它：
 *   浏览器在 file:// 页面里**不执行 ES 模块** ——
 *   双击打开 index.html 时 `import` 会被拒绝，交互代码全都不运行，
 *   页面看起来正常、点按钮却毫无反应（真实踩过）。
 *   打包成传统脚本后，双击即可使用。
 *
 * 做法：每个源文件包一层 IIFE，避免同名变量冲突
 *      （曾经 ui.js 与 calc-buttons.js 都有 keysEl，拼在一起直接报重复声明）；
 *      模块之间通过"打包作用域的变量 + 函数参数"传递依赖：
 *
 *        const model = (function (参数) { 源码; return { 导出 }; })(上游导出);
 *        const ui    = (function (参数) { 源码; return { 导出 }; })(上游导出);
 *
 *      ★ 关键点（踩过）：IIFE 的**实参**必须是"上游模块的导出"，
 *        而不是"本模块自己导出的名字"。
 *        一开始把本模块的导出也塞进实参，产物里就出现了
 *        `})(createState, applyKey, ...)` 这种引用不存在变量的写法，
 *        整个 bundle 抛 ReferenceError: createState is not defined。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const jsDir = join(repoRoot, 'src', 'js');
const outFile = join(jsDir, 'bundle.js');

/**
 * 模块定义，顺序 = 依赖顺序（后者可用前者的导出）。
 * exports：本模块对外暴露的名字（会成为打包作用域里的变量）
 * needs  ：本模块要用到的、上游已导出的名字（作为 IIFE 参数传入）
 */
const MODULES = [
  {
    file: 'input-model.js',
    binding: 'model',
    exports: ['ALLOWED_CHARS', 'OPERATORS', 'MAX_LENGTH', 'createState', 'trailingNumber', 'isNumberSegment', 'parenInfo', 'canSubmit', 'applyKey'],
    needs: [],
  },
  {
    file: 'ui.js',
    binding: 'ui',
    exports: ['toDisplayText', 'render', 'flashKey', 'setArmedOperator', 'setBackendStatus', 'showMessage', 'showServerError'],
    needs: [],
  },
  {
    file: 'calc-buttons.js',
    binding: 'buttons',
    exports: ['handleKey'],
    needs: ['createState', 'applyKey', 'canSubmit', 'render', 'setArmedOperator', 'flashKey'],
  },
  {
    file: 'keyboard.js',
    binding: null, // 最后一个模块只执行，不需要导出
    exports: [],
    needs: ['handleKey'],
  },
];

/**
 * 去掉 import / export 语句。
 * 只处理**行首**的语句，避免误伤注释或字符串里的同名文字。
 *
 * export 的几种写法都要覆盖：const / let / var / function / class / async。
 * 一开始只写了 function，结果 export const 留在产物里，
 * 传统脚本里出现 export 关键字是语法错误，整个 bundle 不执行（踩过）。
 *
 * @param {string} code
 * @returns {string}
 */
function stripModuleSyntax(code) {
  return code
    .replace(/^\s*import\s[^;]*;\s*$/gm, '')
    .replace(/^export\s+(?=(?:const|let|var|function|class|async)\b)/gm, '');
}

/** @type {Set<string>} 打包作用域里已经存在的名字 */
const available = new Set();
/** @type {string[]} 已生成的模块定义代码 */
const pieces = [];

for (const mod of MODULES) {
  const source = stripModuleSyntax(readFileSync(join(jsDir, mod.file), 'utf8'));

  const missing = mod.needs.filter((name) => !available.has(name));
  if (missing.length > 0) {
    throw new Error(`${mod.file} 需要 ${missing.join(', ')}，但它们还没被任何上游模块导出`);
  }

  const params = mod.needs.join(', ');
  const args = mod.needs.join(', ');
  const header = `  /* ===== 源文件：src/js/${mod.file}（生成物，请勿手工编辑） ===== */`;
  const tail = mod.exports.length > 0 ? `\n  return { ${mod.exports.join(', ')} };` : '';

  const declaration = mod.binding === null
    ? `${header}\n  (function (${params}) {\n${source}\n  })(${args});`
    : `${header}\n  const ${mod.binding} = (function (${params}) {\n${source}${tail}\n  })(${args});`;

  pieces.push(declaration);

  // 本模块的导出在此之后才可用
  if (mod.binding !== null) {
    // 导出的是对象，但模块之间是按名字引用的，所以把名字登记为"可用"，
    // 并在打包作用域里把它们从对象上解构出来
    const names = mod.exports.join(', ');
    pieces.push(`  /* 把 ${mod.binding} 的导出摊到打包作用域，供后续模块按名字引用 */\n  const { ${names} } = ${mod.binding};`);
    mod.exports.forEach((name) => available.add(name));
  }
}

const banner = `/**
 * ⚠ 生成物 —— 请勿手工编辑。
 * 由 tools/build-bundle.mjs 从 src/js/ 下的四个 ES 模块合并而来。
 * 改逻辑请改源文件，然后运行：node tools/build-bundle.mjs
 *
 * 存在的理由：浏览器在 file:// 页面里不执行 ES 模块，
 * 双击打开 index.html 会完全没有交互；打包成传统脚本后双击即可使用。
 */
`;

// 额外暴露一个只读接口给自动化测试与截图工具使用。
// 只暴露"设置状态并渲染"这一层，不暴露任何写入表达式的能力，
// 因此不会变成绕过输入校验的后门。
const debugBridge = `
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
`;

const bundle = `${banner}(function () {\n  'use strict';\n\n${pieces.join('\n\n')}\n\n${debugBridge}\n})();\n`;

writeFileSync(outFile, bundle, 'utf8');
console.log(`已生成 ${outFile}（${(bundle.length / 1024).toFixed(1)} KB）`);
