/**
 * API client — the only place in the front-end that talks to the back-end.
 *
 * Design principles:
 *   1. **The front-end never computes**. Every function in this file just sends, receives and
 *      translates; there is not a single arithmetic operation here. Results and errors are
 *      decided by the back-end.
 *   2. **All network details stay inside this file**. Other modules do not know that fetch or
 *      HTTP status codes exist; they only see "data received successfully" or "an exception
 *      with an error code was thrown". Switching to XMLHttpRequest or WebSocket later would
 *      only require changes here.
 *   3. **All errors are normalized into ApiError**. Callers only need to inspect error.code and
 *      do not care whether the network failed, the request timed out, or the back-end returned
 *      a business error.
 */

import { API_BASE_URL, REQUEST_TIMEOUT_MS } from './config.js';

/**
 * Unified API exception.
 *
 * code values:
 *   · business error code returned by the back-end, e.g. 'INVALID_EXPRESSION', 'DIVISION_BY_ZERO'
 *   · front-end generated 'NETWORK_ERROR' (cannot connect), 'TIMEOUT' (timed out),
 *     'BAD_RESPONSE' (malformed response)
 */
export class ApiError extends Error {
  /**
   * @param {string} code error code
   * @param {string} message user-facing description
   * @param {number} [status] HTTP status code (for business errors)
   */
  constructor(code, message, status) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Send one request and return the data part of the response body.
 *
 * @param {string} path API path, e.g. '/api/calculate'
 * @param {{method?: string, body?: object}} [options]
 * @returns {Promise<any>} data returned by the back-end
 * @throws {ApiError} any failure
 */
async function request(path, options = {}) {
  const method = options.method || 'GET';
  const url = API_BASE_URL + path;

  // Timeout implemented with AbortController.
  // Why not fetch's built-in signal timeout option: it is not widely supported yet,
  // while AbortController is the standard approach with better compatibility.
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
    // fetch only throws when the network layer fails (cannot connect, timeout, blocked by CORS,
    // DNS failure)
    if (error && error.name === 'AbortError') {
      throw new ApiError(
        'TIMEOUT',
        `Request timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds. ` +
          'Check the back-end service.',
      );
    }
    throw new ApiError(
      'NETWORK_ERROR',
      'Cannot reach the back-end service. Make sure it is running.',
    );
  } finally {
    clearTimeout(timer);
  }

  // 204 No Content (successful deletion) has no response body, so return right away
  if (response.status === 204) {
    return null;
  }

  // Parse the response body. Even for an error status the back-end returns JSON explaining
  // the reason, so read the body first and decide how to handle it afterwards.
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(
      'BAD_RESPONSE',
      `The back-end response is not valid JSON (HTTP ${response.status})`,
      response.status,
    );
  }

  if (response.ok && payload && payload.success === true) {
    return payload.data;
  }

  // Reaching this point means it is an error. Prefer the error code and message from the back-end —
  // the back-end's judgement is authoritative (the front-end does not validate expressions itself).
  const code = (payload && payload.errorCode) || 'UNKNOWN_ERROR';
  const message = (payload && payload.message) || `Request failed (HTTP ${response.status})`;
  throw new ApiError(code, message, response.status);
}

/**
 * Submit an expression to the back-end for evaluation.
 *
 * This is the only place in the whole front-end that asks for a result.
 * The front-end never computes one itself.
 *
 * @param {string} expression expression in ASCII form (* / - instead of × ÷ −)
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
 * Fetch the history records.
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
 * Delete one history record.
 *
 * @param {number} id
 * @returns {Promise<void>}
 * @throws {ApiError} code is 'RECORD_NOT_FOUND' when the record does not exist
 */
export async function deleteHistory(id) {
  await request('/api/history/' + encodeURIComponent(String(id)), { method: 'DELETE' });
}

/**
 * Clear the whole history.
 *
 * @returns {Promise<{deleted: number}>}
 * @throws {ApiError}
 */
export async function clearHistory() {
  return request('/api/history', { method: 'DELETE' });
}

/**
 * Health check — used to tell whether the back-end is online.
 *
 * Why not reuse another endpoint:
 *   this one touches no database and does no computation, so it always answers instantly,
 *   which makes it suitable for quickly telling "is the back-end there" right after the page opens.
 *
 * @returns {Promise<boolean>} whether the back-end is available
 */
export async function checkHealth() {
  try {
    await request('/api/health');
    return true;
  } catch {
    // A failed health check is not an "error", just a state, so no exception is thrown.
    // The caller uses it to switch the status pill to "back-end not connected".
    return false;
  }
}

/**
 * The back-end URL currently in use (read-only; lets automated tests assert that the config is
 * read correctly).
 *
 * Why export it: the tests need to confirm which address the front-end actually sends requests to.
 * The most common deployment failure is a wrong address, and it is completely invisible in the UI.
 */
export const API_BASE_URL_FOR_TEST = API_BASE_URL;
