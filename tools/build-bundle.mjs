/**
 * Bundling script: merges the ES modules under src/js into a single "classic script"
 * (tools/build-bundle.mjs)
 *
 * Usage:
 *   node tools/build-bundle.mjs
 *   node tools/build-bundle.mjs --js-dir <dir>     bundle source from another directory
 *   node tools/build-bundle.mjs --out <file>       set the output path
 *
 * Default output: src/js/bundle.js (build artifact, do not edit by hand)
 *
 * What --js-dir is for:
 *   The screenshot tool (capture-screens.mjs) copies src/ into a temp directory,
 *   rewrites the back-end address there to the temp back-end's port, and then
 *   **rebundles inside that copy** --
 *   so the repository stays clean while the captured screenshots really do run
 *   against a live back-end.
 *   Without this flag the copy would have to fake a "repo-root/src/js" layout,
 *   which is awkward and error-prone (tried it, got the path wrong twice).
 *
 * Why bundling is needed:
 *   Browsers **do not execute ES modules** on file:// pages --
 *   opening index.html by double-click makes `import` fail, so none of the
 *   interaction code runs: the page looks fine but the buttons do nothing.
 *   Bundled into a classic script, it works on double-click.
 *   (Also used for the online GitHub Pages deployment, keeping local and deployed
 *   behavior identical.)
 *
 * Approach: wrap each source file in an IIFE to avoid same-named variable clashes
 *      (ui.js and calc-buttons.js both had keysEl once, and concatenating them was
 *      an immediate duplicate declaration error);
 *      modules receive dependencies through "bundling-scope variables + function
 *      parameters":
 *
 *        const model = (function (params) { source; return { exports }; })(upstreamExports);
 *        const ui    = (function (params) { source; return { exports }; })(upstreamExports);
 *
 *      Key points:
 *        1. The IIFE **arguments** must be "the upstream module's exports", not
 *           "this module's own exported names".
 *           Passing this module's own exported names in as arguments produced
 *           `})(createState, applyKey, ...)` in the artifact, referencing
 *           variables that do not exist, and the whole bundle threw
 *           ReferenceError: createState is not defined.
 *        2. **Order is dependency**. Top-level statements in each source file run
 *           as soon as the IIFE executes, so if a module references another
 *           module's function at the top level, that function must already be in
 *           needs and exported by an upstream module. That is why boot.js is last.
 *        3. **No namespace style inside a module**. Dependencies arrive as function
 *           parameters, so the source may only call `render(...)`, never
 *           `ui.render(...)` -- the latter cannot resolve the name ui inside the
 *           IIFE (and the whole bundle fails to execute).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

/** Parse command-line arguments */
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
 * Module definitions; order = dependency order (later entries may use earlier exports).
 *
 * file    source file name
 * binding variable name of this module in the bundling scope (null means no export needed)
 * exports names this module exposes (become bundling-scope variables for later modules)
 * needs   names this module uses that an upstream module already exports (passed as IIFE arguments)
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
    // NOTE: pass only the **function names** actually used, not the ui namespace object.
    //   The module source calls render(...), not ui.render(...) --
    //   the name ui cannot be resolved inside the IIFE. Once this is wrong,
    //   ui is undefined inside the IIFE after bundling and the whole bundle throws.
    needs: ['createState', 'applyKey', 'canSubmit', 'render', 'setArmedOperator', 'flashKey'],
  },
  {
    file: 'app.js',
    binding: 'app',
    exports: ['boot'],
    // app.js calls setSubmitHandler / setDeleteHandler etc. at the top level (inside the boot function body),
    // so those names must be available when needed -- list them all; too many is safer than too few.
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
    binding: null, // side effects only (registers the keydown listener at the top level); no exports needed
    exports: [],
    needs: ['handleKey'],
  },
  {
    file: 'boot.js',
    binding: null, // runs last: it calls app.boot() at the top level
    exports: [],
    needs: ['boot'],
  },
];

/**
 * Strip import / export statements.
 * Only statements at the **start of a line** are handled, so identical text inside
 * comments or string literals is left alone.
 *
 * Every export form must be covered: const / let / var / function / class / async.
 * Initially only function was handled, so export const survived into the artifact;
 * an export keyword in a classic script is a syntax error and the whole bundle never runs.
 *
 * @param {string} code
 * @returns {string}
 */
function stripModuleSyntax(code) {
  return code
    .replace(/^\s*import\s[^;]*;\s*$/gm, '')
    .replace(/^export\s+(?=(?:const|let|var|function|class|async)\b)/gm, '');
}

/** @type {Set<string>} names already present in the bundling scope */
const available = new Set();
/** @type {string[]} generated module definition code */
const pieces = [];

for (const mod of MODULES) {
  const source = stripModuleSyntax(readFileSync(join(jsDir, mod.file), 'utf8'));

  const missing = mod.needs.filter((name) => !available.has(name));
  if (missing.length > 0) {
    throw new Error(`${mod.file} needs ${missing.join(', ')}, but no upstream module exports them yet`);
  }

  const params = mod.needs.join(', ');
  const args = mod.needs.join(', ');
  const header = `  /* ===== source file: src/js/${mod.file} (generated, do not edit by hand) ===== */`;
  const tail = mod.exports.length > 0 ? `\n  return { ${mod.exports.join(', ')} };` : '';

  const declaration = mod.binding === null
    ? `${header}\n  (function (${params}) {\n${source}\n  })(${args});`
    : `${header}\n  const ${mod.binding} = (function (${params}) {\n${source}${tail}\n  })(${args});`;

  pieces.push(declaration);

  // this module's exports only become available after this point
  if (mod.binding !== null) {
    // The export is an object, but modules reference each other by name, so register the
    // names as "available" and destructure them off the object into the bundling scope
    const names = mod.exports.join(', ');
    pieces.push(`  /* destructure ${mod.binding}'s exports into the bundling scope so later modules can reference them by name */\n  const { ${names} } = ${mod.binding};`);
    mod.exports.forEach((name) => available.add(name));
  }
}

const banner = `/**
 * Generated file — do not edit by hand.
 * Produced by tools/build-bundle.mjs from the ES modules under src/js/.
 * To change behaviour, edit the source files and run: node tools/build-bundle.mjs
 *
 * Why it exists: a browser does not execute ES modules on a file:// page,
 * so opening index.html by double-click would be completely inert. Bundling
 * everything into a classic script makes the double-click work.
 */
`;

// Also expose a read-only interface for the automated tests and the screenshot tool.
// Only "read state" and "set display" are exposed, never anything that writes the
// expression, so it does not become a back door around input validation.
const debugBridge = `
  /* read-only interface for the automated tests and the screenshot tool
     (see tools/e2e-click.mjs, tools/verify-deployed.mjs) */
  window.__calc = {
    createState: model.createState,
    applyKey: model.applyKey,
    render: ui.render,
    setArmedOperator: ui.setArmedOperator,
    flashKey: ui.flashKey,
    showServerError: ui.showServerError,
    /* whether the interactive code has started — this is the first e2e assertion */
    isBooted: () => document.getElementById('keys') !== null && document.getElementById('keys').tabIndex === -1,
    /* current expression (ASCII source, so tests can check display/data separation) */
    getExpression: buttons.getExpression,
    /* back-end address (so tests can assert the config was read correctly) */
    getApiBaseUrl: () => api.API_BASE_URL_FOR_TEST,
  };
`;

const bundle = `${banner}(function () {\n  'use strict';\n\n${pieces.join('\n\n')}\n\n${debugBridge}\n})();\n`;

writeFileSync(outFile, bundle, 'utf8');
console.log(`Generated ${outFile} (${(bundle.length / 1024).toFixed(1)} KB, ${MODULES.length} modules)`);
