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

import { API_BASE_URL, REQUEST_TIMEOUT_MS } from './config.js';

/**
 * 统一的接口异常。
 *
 * code 取值：
 *   · 后端返回的业务错误码，如 'INVALID_EXPRESSION'、'DIVISION_BY_ZERO'
 *   · 前端自己产生的 'NETWORK_ERROR'（连不上）、'TIMEOUT'（超时）、'BAD_RESPONSE'（响应格式不对）
 */
export class ApiError extends Error {
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
export async function calculate(expression) {
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
export async function fetchHistory(options = {}) {
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
export async function deleteHistory(id) {
  await request('/api/history/' + encodeURIComponent(String(id)), { method: 'DELETE' });
}

/**
 * 清空全部历史。
 *
 * @returns {Promise<{deleted: number}>}
 * @throws {ApiError}
 */
export async function clearHistory() {
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
export async function checkHealth() {
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
export const API_BASE_URL_FOR_TEST = API_BASE_URL;
