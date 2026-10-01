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

import {
  calculate,
  fetchHistory,
  deleteHistory,
  clearHistory,
  checkHealth,
} from './api.js';
import {
  setBackendStatus,
  setBackendDot,
  showServerError,
} from './ui.js';
import {
  setDeleteHandler,
  setStatus,
  renderList,
  clearList,
} from './history.js';
import { HISTORY_PAGE_SIZE } from './config.js';
import { setSubmitHandler, setResult, setMessage, getExpression } from './calc-buttons.js';

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
