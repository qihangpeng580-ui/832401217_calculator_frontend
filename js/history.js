/**
 * History rendering layer — draws the history list returned by the back-end into the card on
 * the right.
 *
 * Like ui.js, this module is "dumb": it only displays the data handed to it and never issues
 * requests itself. Requesting is app.js's job.
 *
 * Why split it this way:
 *   putting fetch in here too would mean "a render function secretly makes network requests",
 *   tests could not run without a back-end, and the question of "when to refresh" would be
 *   scattered everywhere. Split apart, app.js decides refresh timing in one place.
 *
 * The delete button uses event delegation — the same idea as the keypad:
 *   the whole list carries **exactly one** click listener.
 *   The reason is the same: list items are created dynamically and pagination may be added later,
 *   so binding a listener per item is both wasteful and easy to get wrong.
 */

import { HISTORY_EXPRESSION_MAX_LENGTH } from './config.js';

/** @type {HTMLElement} */ const listEl = document.getElementById('history-list');
/** @type {HTMLElement} */ const statusEl = document.getElementById('history-status');
/** @type {HTMLElement} */ const countEl = document.getElementById('history-count');

/**
 * Delete callback, injected by app.js.
 * @type {(id: number) => void}
 */
let onDelete = () => {};

/**
 * Set the delete callback.
 * @param {(id: number) => void} handler
 */
export function setDeleteHandler(handler) {
  onDelete = handler;
}

/**
 * Convert the UI symbols back to ASCII, used to display operators in the history.
 * In the history we show the ASCII form exactly as the user typed it (the form sent to the
 * back-end), but for readability * / - are rendered as × ÷ − to match the calculator display.
 * @param {string} text
 * @returns {string}
 */
function toDisplay(text) {
  return String(text)
    .replace(/\*/g, '×')
    .replace(/\//g, '÷')
    .replace(/-/g, '−');
}

/**
 * Trim an ISO timestamp down to "MM-DD HH:MM".
 *
 * Why not just use new Date().toLocaleString():
 *   that follows the system locale, so different machines display it differently and the
 *   screenshots would not match the blog post. Trimming by hand keeps it consistent everywhere.
 * @param {string} iso
 * @returns {string}
 */
function formatTime(iso) {
  const text = String(iso || '');
  // Format looks like 2026-09-29T15:20:11
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) {
    return text;
  }
  return `${match[2]}-${match[3]} ${match[4]}:${match[5]}`;
}

/**
 * Truncate an over-long expression so it cannot break the list layout.
 * @param {string} text
 * @returns {string}
 */
function truncate(text) {
  const value = String(text);
  if (value.length <= HISTORY_EXPRESSION_MAX_LENGTH) {
    return value;
  }
  return value.slice(0, HISTORY_EXPRESSION_MAX_LENGTH - 1) + '…';
}

/**
 * Set the status text (empty list, loading and errors all go through here).
 * @param {string} text
 * @param {'info'|'error'} [type]
 */
export function setStatus(text, type = 'info') {
  statusEl.textContent = text;
  statusEl.classList.toggle('is-error', type === 'error');
}

/**
 * Render the history list.
 *
 * @param {Array<{id: number, expression: string, result: string, createdAt: string}>} items
 * @param {number} total total count reported by the back-end (may exceed the number currently
 *   displayed)
 */
export function renderList(items, total) {
  listEl.textContent = '';

  // Item count at the top
  if (total > items.length) {
    countEl.textContent = `Showing ${items.length} of ${total}`;
  } else {
    countEl.textContent = total > 0 ? `Total: ${total}` : '';
  }

  if (items.length === 0) {
    return;
  }

  // Insert everything at once with a DocumentFragment: avoids triggering a page reflow for
  // every item.
  // The difference is invisible on a short list, but it is a good habit and this comment
  // explains why.
  const fragment = document.createDocumentFragment();

  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'history__item';
    li.dataset.id = String(item.id);

    const main = document.createElement('div');
    main.className = 'history__main';

    const expression = document.createElement('p');
    expression.className = 'history__expression';
    // textContent everywhere, never innerHTML — the expression is user input and
    //   may contain characters like < >; textContent is naturally immune to XSS.
    expression.textContent = truncate(toDisplay(item.expression));
    expression.title = item.expression; // Show the full expression on hover

    const result = document.createElement('p');
    result.className = 'history__result';
    result.textContent = '= ' + toDisplay(item.result);

    main.append(expression, result);

    const meta = document.createElement('div');
    meta.className = 'history__meta';

    const time = document.createElement('time');
    time.className = 'history__time';
    time.dateTime = item.createdAt;
    time.textContent = formatTime(item.createdAt);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'history__delete';
    remove.dataset.deleteId = String(item.id);
    remove.title = 'Delete this record';
    remove.textContent = 'Delete';
    remove.setAttribute('aria-label', `Delete record ${item.expression}`);

    meta.append(time, remove);
    li.append(main, meta);
    fragment.append(li);
  }

  listEl.append(fragment);
}

/**
 * Clear the list (used on error to wipe stale content instead of showing outdated data).
 */
export function clearList() {
  listEl.textContent = '';
  countEl.textContent = '';
}

// ---------------------------------------------------------------- Event delegation
//
// The whole list carries a single listener.
// List items are created dynamically by renderList, so the listener must sit on the
// **parent** element — which is exactly the typical use case for event delegation.
listEl.addEventListener('click', (event) => {
  const button = event.target instanceof Element ? event.target.closest('[data-delete-id]') : null;
  if (!(button instanceof HTMLElement) || !listEl.contains(button)) {
    return;
  }

  const id = Number(button.dataset.deleteId);
  if (!Number.isFinite(id)) {
    return;
  }

  // Visual feedback while deleting: disable the button so a double click cannot fire twice
  button.disabled = true;
  button.textContent = '…';

  onDelete(id);
});
