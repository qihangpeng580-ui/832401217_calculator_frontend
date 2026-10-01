/**
 * 打包脚本：把 src/js 下的 ES 模块合并成一个「传统脚本」
 * （tools/build-bundle.mjs）
 *
 * 运行：
 *   node tools/build-bundle.mjs
 *   node tools/build-bundle.mjs --js-dir <目录>    打包另一个目录里的源码
 *   node tools/build-bundle.mjs --out <文件>       指定产物路径
 *
 * 产物默认：src/js/bundle.js（生成物，不要手工编辑）
 *
 * ★ --js-dir 是给谁用的：
 *   截图工具（capture-screens.mjs）会把 src/ 复制到临时目录，
 *   把那里的后端地址改成临时后端的端口，然后**在那个副本里重新打包** ——
 *   这样既不会污染仓库，截出来的图又是真的连着后端跑的。
 *   没有这个参数的话，副本就得伪造出 "根目录/src/js" 的结构，
 *   很别扭而且容易出错（试过，路径算错过两次）。
 *
 * ★ 为什么需要打包：
 *   浏览器在 file:// 页面里**不执行 ES 模块** ——
 *   双击打开 index.html 时 `import` 会被拒绝，交互代码全都不运行，
 *   页面看起来正常、点按钮却毫无反应（真实踩过）。
 *   打包成传统脚本后，双击即可使用。
 *   （联网部署到 GitHub Pages 时同样用它，保证本地和线上的行为一致。）
 *
 * 做法：每个源文件包一层 IIFE，避免同名变量冲突
 *      （曾经 ui.js 与 calc-buttons.js 都有 keysEl，拼在一起直接报重复声明）；
 *      模块之间通过"打包作用域的变量 + 函数参数"传递依赖：
 *
 *        const model = (function (参数) { 源码; return { 导出 }; })(上游导出);
 *        const ui    = (function (参数) { 源码; return { 导出 }; })(上游导出);
 *
 *      ★ 关键点（踩过三次）：
 *        ① IIFE 的**实参**必须是"上游模块的导出"，而不是"本模块自己导出的名字"。
 *           一开始把本模块导出的名字也塞进实参，产物里就出现了
 *           `})(createState, applyKey, ...)` 这种引用不存在变量的写法，
 *           整个 bundle 抛 ReferenceError: createState is not defined。
 *        ② **顺序即依赖**。每个源文件里的顶层语句在 IIFE 执行时立刻运行，
 *           所以如果一个模块在顶层引用了另一个模块的函数，那个函数必须
 *           已经在 needs 里、并且被上游导出过。boot.js 放在最后就是这个道理。
 *        ③ **模块内部不能用命名空间写法**。依赖是以函数参数传进去的，
 *           所以源码里只能写 `render(...)`，不能写 `ui.render(...)` ——
 *           后者在 IIFE 里解析不到 ui 这个名字（踩过，整包不执行）。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

/** 解析命令行参数 */
function parseArgs(argv) {
  const options = { jsDir: null, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--js-dir' && argv[i + 1]) {
      options.jsDir = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--out' && argv[i + 1]) {
      options.out = argv[i + 1];
      i += 1;
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));

const jsDir = options.jsDir
  ? (isAbsolute(options.jsDir) ? options.jsDir : resolve(process.cwd(), options.jsDir))
  : join(repoRoot, 'src', 'js');

const outFile = options.out
  ? (isAbsolute(options.out) ? options.out : resolve(process.cwd(), options.out))
  : join(jsDir, 'bundle.js');

/**
 * 模块定义，顺序 = 依赖顺序（后者可用前者的导出）。
 *
 * file    源文件名
 * binding 本模块在打包作用域里的变量名（null 表示不需要导出）
 * exports 本模块对外暴露的名字（会成为打包作用域里的变量，供后续模块引用）
 * needs   本模块要用到的、上游已导出的名字（作为 IIFE 参数传入）
 */
const MODULES = [
  {
    file: 'config.js',
    binding: 'config',
    exports: ['API_BASE_URL', 'REQUEST_TIMEOUT_MS', 'HISTORY_PAGE_SIZE', 'HISTORY_EXPRESSION_MAX_LENGTH'],
    needs: [],
  },
  {
    file: 'api.js',
    binding: 'api',
    exports: ['ApiError', 'calculate', 'fetchHistory', 'deleteHistory', 'clearHistory', 'checkHealth', 'API_BASE_URL_FOR_TEST'],
    needs: ['API_BASE_URL', 'REQUEST_TIMEOUT_MS'],
  },
  {
    file: 'input-model.js',
    binding: 'model',
    exports: ['ALLOWED_CHARS', 'OPERATORS', 'MAX_LENGTH', 'createState', 'trailingNumber', 'isNumberSegment', 'parenInfo', 'canSubmit', 'applyKey'],
    needs: [],
  },
  {
    file: 'ui.js',
    binding: 'ui',
    exports: ['toDisplayText', 'render', 'flashKey', 'setArmedOperator', 'setBackendStatus', 'setBackendDot', 'showMessage', 'showServerError'],
    needs: [],
  },
  {
    file: 'history.js',
    binding: 'history',
    exports: ['setDeleteHandler', 'setStatus', 'renderList', 'clearList'],
    needs: ['HISTORY_EXPRESSION_MAX_LENGTH'],
  },
  {
    file: 'calc-buttons.js',
    binding: 'buttons',
    exports: ['setSubmitHandler', 'setResult', 'setMessage', 'getExpression', 'handleKey'],
    // ★ 注意：只传用到的**函数名**，不传 ui 这个命名空间对象。
    //   因为模块源码里写的是 render(...) 而不是 ui.render(...) ——
    //   IIFE 里解析不到 ui 这个名字。这一点踩过一次：
    //   源码用了 ui.render()，打包后 ui 在 IIFE 内部是未定义的，整包报错。
    needs: ['createState', 'applyKey', 'canSubmit', 'render', 'setArmedOperator', 'flashKey'],
  },
  {
    file: 'app.js',
    binding: 'app',
    exports: ['boot'],
    // app.js 顶层会调用 setSubmitHandler / setDeleteHandler 等（在 boot 函数体内），
    // 所以这些名字必须在需要时可用 —— 全部列出来，宁可多不可少。
    needs: [
      'calculate', 'fetchHistory', 'deleteHistory', 'clearHistory', 'checkHealth', 'API_BASE_URL_FOR_TEST',
      'render', 'setBackendStatus', 'setBackendDot', 'showServerError',
      'setDeleteHandler', 'setStatus', 'renderList', 'clearList',
      'setSubmitHandler', 'setResult', 'setMessage', 'getExpression',
      'HISTORY_PAGE_SIZE',
    ],
  },
  {
    file: 'keyboard.js',
    binding: null, // 只执行（在顶层注册 keydown 监听器），不需要导出
    exports: [],
    needs: ['handleKey'],
  },
  {
    file: 'boot.js',
    binding: null, // 最后执行：顶层就会调用 app.boot()
    exports: [],
    needs: ['boot'],
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
 * 由 tools/build-bundle.mjs 从 src/js/ 下的 ES 模块合并而来。
 * 改逻辑请改源文件，然后运行：node tools/build-bundle.mjs
 *
 * 存在的理由：浏览器在 file:// 页面里不执行 ES 模块，
 * 双击打开 index.html 会完全没有交互；打包成传统脚本后双击即可使用。
 */
`;

// 额外暴露一个只读接口给自动化测试与截图工具使用。
// 只暴露"读状态"和"设置显示"这一层，不暴露任何写入表达式的能力，
// 因此不会变成绕过输入校验的后门。
const debugBridge = `
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
`;

const bundle = `${banner}(function () {\n  'use strict';\n\n${pieces.join('\n\n')}\n\n${debugBridge}\n})();\n`;

writeFileSync(outFile, bundle, 'utf8');
console.log(`已生成 ${outFile}（${(bundle.length / 1024).toFixed(1)} KB，${MODULES.length} 个模块）`);
