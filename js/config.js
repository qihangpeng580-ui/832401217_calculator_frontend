/**
 * Config layer — every piece of "outside world" information the front-end needs lives here.
 *
 * Why a separate file:
 *   the back-end address differs between development, deployment and demonstration.
 *   Scattered across the code, it would mean searching every file before a release.
 *   Kept in one place, one line is enough.
 *
 * Change this before deploying ↑
 */

/**
 * Back-end service address (no trailing slash).
 *
 * Values:
 *   · Local development: 'http://127.0.0.1:8000'   ← front-end and back-end both on this machine
 *   · After deployment:  the back-end's public address, e.g. 'https://xxx.example.com'
 *
 * Special case:
 *   when front-end and back-end are deployed **same-origin** (same domain and port) this can be
 *   the empty string '', so requests go to /api/... instead of cross-origin — and CORS is a
 *   non-issue.
 */
export const API_BASE_URL = 'http://127.0.0.1:8000';

/**
 * Timeout for a single request (milliseconds).
 *
 * Why a timeout is required:
 *   when the back-end is down, the browser's fetch hangs and never returns by default,
 *   so after the user presses = the UI stays on "calculating" forever and looks frozen.
 *   Only with a timeout can we show a clear "cannot reach the back-end" message.
 */
export const REQUEST_TIMEOUT_MS = 8000;

/**
 * How many history records to fetch at a time.
 */
export const HISTORY_PAGE_SIZE = 20;

/**
 * Maximum length of each expression shown in the history list (longer ones are truncated with
 * an ellipsis).
 * Keeps a single very long expression from breaking the list layout.
 */
export const HISTORY_EXPRESSION_MAX_LENGTH = 28;
