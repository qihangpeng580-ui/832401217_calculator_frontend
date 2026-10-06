# Code Standards (Front-end)

> **Where these standards come from**:
>
> - **Google JavaScript Style Guide** — https://google.github.io/styleguide/jsguide.html
> - **Airbnb JavaScript Style Guide** — https://github.com/airbnb/javascript
> - The naming section follows the **BEM** (Block / Element / Modifier) methodology for CSS class names
>   — https://getbem.com/naming/
>
> This document explains which of their rules this repository actually adopts, where it deviates,
> and why. It only lists what we genuinely follow, rather than copying a checklist of things we
> never use.

---

## 1. Files and Encoding

| Item | Rule |
|---|---|
| Encoding | Always UTF-8 (no BOM) |
| Indentation | 2 spaces, never tabs (as Google Style requires) |
| Line endings | LF; a single trailing newline at the end of the file |
| Line width | Code body within 80 characters; comment lines up to 100. Google says 80, and the extra room lets a comment finish on one line |
| File naming | Lowercase letters plus hyphens, e.g. `input-model.js`, `calc-buttons.js` |

## 2. Naming

| Kind | Rule | Example |
|---|---|---|
| Variables / functions | lowerCamelCase | `applyKey`, `trailingNumber` |
| Constants (module-level immutable values) | ALL_CAPS with underscores | `MAX_LENGTH`, `SERVER_ERROR_TEXT` |
| Booleans | Prefixed with `is` / `has` / `should` | `isDigit`, `isNumberSegment` |
| CSS class names | BEM: block, block__element, block--modifier | `.screen__expression`, `.key--op` |
| JS state classes | `is-` prefix, marking "a state toggled by script" | `.is-empty`, `.is-pressed`, `.is-armed` |
| Variables holding DOM element references | End with `El` | `expressionEl`, `messageEl` |
| Custom data attributes | `data-` plus lowercase-with-hyphens | `data-key`, `data-shot` |

**On the division of labour between CSS class names**: `key--op` is a **static modifier** (hard-coded
in the HTML), whereas `is-pressed` is a **dynamic state** (added and removed by JavaScript). The two
are never mixed — a common BEM convention, and one that makes it obvious at a glance which classes
the script will modify.

## 3. Language Features

- Use **ES Modules** (`import` / `export`); never pass data between modules through globals.
- Declare with `const` only, and reach for `let` only when reassignment is needed; **`var` is banned** (Airbnb).
- Always compare with `===` / `!==`; `== null` is allowed only when comparing against `null`.
- Prefer template literals for string concatenation; but **build HTML attribute selectors with
  single-quoted concatenation**, so that nested backticks don't hurt readability.
- Keep functions doing "one thing": every function in this repository is under 30 lines.
- Prefer pure functions: the functions in `input-model.js` never **modify the object passed in**;
  they return a new object. That way, when something goes wrong, you can track it down with
  "the same input must always produce the same output".

## 4. Safety and Robustness (rules specific to this project)

These are hard requirements of this assignment, written into the standard so that they can be
reviewed:

1. **No `eval` / `exec` / `new Function` / `setTimeout(string)`**.
   User input is only ever handled as a string, never executed as code. The assignment explicitly
   forbids arbitrary code execution.
2. **No `innerHTML` / `outerHTML` / `document.write`**.
   Build content with `textContent` and `createElement` only.
   A `<` `>` inside an expression is never treated as a tag, which makes the page immune to XSS by construction.
3. **Input whitelist**: an expression may only contain the characters `0-9 . + - * / ( )`;
   anything else is rejected with a message (see `applyKey` in `input-model.js`).
4. **All input goes through a single entry point**: both the mouse and the keyboard must call
   `applyKey`; no path is allowed to "skip validation and change the expression directly".
5. **Length limit**: an expression is at most 60 characters, to prevent meaningless over-long input.

## 5. Comments

- Use the JSDoc style: `/** description */`, with `@param` / `@returns` when there are parameters
  and return values.
- **Comments explain "why", not "what"**. For example:
  ```js
  // Bad: move focus back to the keypad container
  // Good: after a button is clicked the browser leaves focus on that button, so pressing
  //       Enter afterwards triggers that button again; moving focus to the container
  //       avoids the repeated trigger
  ```
- Every module file opens with a short note: what problem the file solves, and where its boundaries lie.

## 6. Commit Messages

A simplified form of Conventional Commits:

```
<type>: <short description>
```

| type | Meaning |
|---|---|
| `feat` | New feature |
| `fix` | Bug fix |
| `style` | Style / formatting only, no logic change |
| `docs` | Documentation only |
| `test` | Tests only |
| `refactor` | Refactoring, behaviour unchanged |

Examples: `feat: add colour-change feedback when a button is clicked`, `fix: stop consecutive operators from being appended twice`

## 7. Trade-offs in This Repository

| Rule | Trade-off | Reason |
|---|---|---|
| Google's 80-character line width | Code body kept at 80, comment lines allowed up to 100 | An explanatory comment needs more room than the code it annotates; letting it run to 100 keeps the sentence on one line instead of wrapping it |
| Airbnb's requirement to use TypeScript | Not used | This assignment does not require it, and adding a compile step would undercut the "open it and it runs" advantage |
| A full ESLint configuration | Not adopted | The assertion script in `src/test/` already covers the input rules; ESLint would need npm, and npm is disabled by the execution policy on this machine |
| A unit test framework (Jest, etc.) | Not adopted | A zero-dependency self-test script built on Node's built-in assertions is just as effective and needs no installation |

## 8. Self-check List (confirm every item before submitting)

- [ ] `node src/test/test-input-model.js` passes completely
- [ ] Searching the whole repository for `eval` / `exec` / `new Function` / `innerHTML` returns zero hits
- [ ] Searching the whole repository for `document.write` returns zero hits
- [ ] Every module file opens with a statement of its responsibility
- [ ] CSS class names follow BEM, and dynamic state classes use the `is-` prefix
- [ ] No `var`, no `==` (except `== null`)
- [ ] All files are UTF-8 without BOM and indented with 2 spaces
