# Visual Calculator · Front-end (Student ID 832401217)

The **front-end part** of a front-end / back-end separation calculator system. The interface,
button interactions, expression input, and front-end validation all live here;
**every calculation is ultimately performed by the back-end**, and this repository contains no
calculation-result logic of any kind.

> This is the front-end repository for the individual assignment "front-end / back-end separation
> calculator system" in the Software Engineering course.
> **Back-end repository**: [832401217_calculator_backend](https://github.com/qihangpeng580-ui/832401217_calculator_backend)
> **Live site**: https://qihangpeng580-ui.github.io/832401217_calculator_frontend/

---

## 1. Project Overview

A web calculator front-end that runs directly in the browser. It is responsible for:

- Presenting the user interface (display, keypad, history area)
- Handling button clicks and keyboard input events
- Expression input and **front-end input validation** (parenthesis matching, consecutive operators, decimal points, illegal characters, and so on)
- **Calling the back-end API to calculate**, and showing the result the back-end returns
- Translating the error codes returned by the back-end into user-facing messages
- **Displaying, searching, deleting, and clearing the calculation history** (all data comes from the back-end database)

**One hard design constraint**: the front-end does **not** parse and does **not** evaluate
expressions. The input field always holds nothing but a string of characters, and the only source of
arithmetic is the back-end API. So with the back-end stopped, the interface can still take input and
respond to clicks normally, but it can **never "quietly work out" a result** — this is the self-check
method the assignment asks for.

> Verified in practice: the last item in `tools/e2e-integration.mjs` is "stop the back-end and press `=`";
> it confirms that the result line shows no answer and only reports that it cannot connect.

## 2. Tech Stack

| Item | Choice | Notes |
|---|---|---|
| Language | Plain HTML + CSS + JavaScript (ES Module) | No framework, no build step |
| Runtime | Any modern browser (Chrome / Edge / Firefox) | Just double-click `src/index.html` |
| Dependencies | **Zero third-party dependencies** | No `npm install` needed |
| Bundling | A hand-written script merges everything into a classic script | The reason is in section 4 |
| Testing | Node.js built-in assertion script | Test-only; skip the tests and you don't even need Node |

**Why no framework**: the assignment requires that "the result must be produced by the back-end",
so the front-end's job is interaction and presentation. A plain implementation makes the teaching
points — event-driven design, module boundaries — much clearer, and lets the TA read through the
whole code base in one sitting.

## 3. Directory Structure

```
832401217_calculator_frontend/
├── src/
│   ├── index.html                 Page structure: display + keypad + history area
│   ├── css/style.css              Styles (three key states hover / active / status class + history list)
│   ├── assets/                    Mascot images used in the header
│   ├── js/
│   │   ├── config.js              Configuration: back-end URL, timeout, page size
│   │   ├── api.js                 API client: the only place that talks to the back-end
│   │   ├── input-model.js         Expression buffer: input validation and assembly (pure functions)
│   │   ├── ui.js                  Render layer: owns the display text, cursor and key-state classes
│   │   ├── history.js             History list rendering + event delegation for the delete button
│   │   ├── calc-buttons.js        Event-driven core: event delegation and key dispatch
│   │   ├── app.js                 Main controller: wires up the modules, decides what happens when
│   │   ├── keyboard.js            Physical keyboard → shares the same entry point as the mouse
│   │   ├── boot.js                Startup script (must be loaded last)
│   │   └── bundle.js              Build artifact: the modules above merged into a classic script
│   └── test/test-input-model.js   Self-test script for the input rules (49 assertions)
├── docs/screenshots/              13 demonstration screenshots + a screenshot list
├── tools/                         Screenshot, deployment, and test tools (not part of the page runtime)
├── README.md                      This file
└── codestyle.md                   Code standard notes
```

## 4. Running It

### 4.1 Interface only (no back-end needed)

```powershell
# Double-click src\index.html in your file manager
# or from the command line:
start "" "src\index.html"
```

The interface, button interactions, and input validation all work. But pressing `=` reports
"Cannot reach the back-end service. Make sure it is running." — because **the calculation must be
performed by the back-end**, which is exactly what the design requires.

### 4.2 Full functionality (the back-end has to be running too)

```powershell
# ① start the back-end first (in a separate terminal)
cd "..\832401217_calculator_backend"
py -3.12 run.py

# ② then open the front-end
start "" "src\index.html"
```

Once the back-end is up, the bottom-right corner of the display changes to
"**Back end connected — result computed by the back end**",
pressing `=` shows the result the back-end produced, and the history area on the right reads its
records from the database.

> **Why the page loads `js/bundle.js` instead of those ES modules:**
> inside a `file://` page the browser **does not execute `<script type="module">`** —
> when you open the file by double-clicking, the modules are refused, none of the interaction code
> runs, and the page looks normal while clicking buttons does nothing at all.
> So the build merges the modules into a single classic script, `bundle.js`, which works on a
> double-click.
>
> After changing any source under `src/js/`, regenerate the bundle:
> ```powershell
> node tools\build-bundle.mjs
> ```
> `bundle.js` is a build artifact — do not edit it by hand.

**Keyboard mapping**

| Key | Action |
|---|---|
| `0`–`9`, `.` | Enter digits and the decimal point |
| `+` `-` `*` `/` | The four arithmetic operators (also accepts `×` `÷`) |
| `(` `)` | Parentheses (also accepts the full-width `（` `）`) |
| `Enter` or `=` | Submit to the back-end for calculation |
| `Backspace` | Backspace |
| `Esc` or `Delete` | Clear |
| `n` | Toggle the sign (matches the on-screen `±`) |

## 5. Configuration (how it connects to the back-end)

### 5.1 Where the back-end URL is configured

**One file, one line: `src/js/config.js`.**

```js
export const API_BASE_URL = 'http://127.0.0.1:8000';
```

| Scenario | What to put there |
|---|---|
| Local development (both sides on the same machine) | `http://127.0.0.1:8000` |
| The back-end is deployed at another address | That public address, for example `https://calc-api.example.com` |
| Front-end and back-end deployed on the same origin | An empty string `''`; requests go to `/api/...` and there is no cross-origin problem |

> After editing `config.js` you **must rebundle** (`node tools/build-bundle.mjs`), because the
> `bundle.js` the page loads has this configuration inlined.
> This is easy to overlook: you change the source yet forget to bundle, and the page keeps talking
> to the old address.

### 5.2 API reference

| Method | Path | Where the front-end uses it |
|---|---|---|
| `POST` | `/api/calculate` | Submits the expression when `=` is pressed |
| `GET` | `/api/history` | Fetches the list when the page opens; includes `keyword` when searching |
| `DELETE` | `/api/history/{id}` | The "Delete" button on each record |
| `DELETE` | `/api/history` | The "Clear" button in the top-right corner |
| `GET` | `/api/health` | Checks whether the back-end is online when the page opens |

For the full request and response formats, and the error code table, see the **back-end
repository's README**.

### 5.3 How the front-end displays back-end errors

`ui.js` holds a table mapping error codes to user-facing text (`SERVER_ERROR_TEXT`):

| Error code | What the front-end displays |
|---|---|
| `INVALID_EXPRESSION` | Invalid expression. Check the parentheses and operators. |
| `DIVISION_BY_ZERO` | Division by zero is not allowed |
| `EXPRESSION_TOO_LONG` | Expression is too long. Split it up. |
| `RECORD_NOT_FOUND` | This history record does not exist or has already been deleted. |
| `BAD_REQUEST` | Malformed request |
| `INTERNAL_ERROR` | Internal server error. Try again later. |

**The back-end decides whether an expression is valid.** The front-end only turns the returned error
code into plain language and marks it in red.

### 5.4 Database initialization

The front-end does not touch the database. For how the database is created, see the
database initialization section of the back-end README
(the back-end creates the tables automatically when it starts).

## 6. Testing

### 1. Input rule self-test (fast, a few milliseconds)

```powershell
node src\test\test-input-model.js
```

49 assertions: basic input, leading-operator restrictions, consecutive operators, decimal point
rules, parenthesis matching, the sign key, backspace and clear, the length limit, pre-submit
validation, and the whitelist of illegal characters.

### 2. End-to-end click test (about 20 seconds, **no back-end needed**)

```powershell
node tools\e2e-click.mjs
```

37 assertions, clicking each button with a **real mouse click**. It focuses on:

- The expression produced by clicking add, subtract, multiply, divide, decimal point, parentheses, and unary minus in turn
- **Display and internals separated**: the internals must use the ASCII `*` `/`, while the interface displays `×` `÷`
- Pressing `+ * / )` on an empty expression must be rejected with an error message
- After pressing `=`, the **result is still a placeholder** — the front-end must not produce any calculation result (a hard assignment requirement)
- Clicking all 21 keys one by one, confirming that no key "does nothing when clicked"

### 3. Front-end / back-end integration test (about 30 seconds, **needs the back-end**)

```powershell
node tools\e2e-integration.mjs
```

This script **starts a real back-end itself** (with a temporary database), serves the page itself,
and really clicks buttons in a real browser: **30 assertions** in total, covering:

- With the back-end online, the interface shows "Back end connected"
- Clicking `12+8=` → the result line shows **20** (from the back-end)
- Compound expressions: operator precedence, parentheses, unary plus / minus, decimal numbers
- Division by zero → shows "Division by zero is not allowed" and turns red; **a failed calculation is not written to the history**
- History list rendering, record count, search, deleting a single record, clearing
- **The history is still there after reopening the page** (proof that it really persists in the database)
- **Stopping the back-end and pressing `=` → no result** (proof that the front-end does not compute it behind the scenes)

**Why this layer is essential**: the first two layers verify "input rules" and "interface
interaction" respectively, but neither proves that "the front-end really sent the expression to the
back-end, the back-end really computed a result, and the result really came back to the interface".
And the "all tests green, but real usage is broken" situation has happened twice on this project
(see `docs/design.md`): every test green, yet the feature is broken in the way it is actually
used. That is why the integration test has to use real HTTP + a real browser + real clicks.

### 4. Verification of the deployed page (about 15 seconds)

```powershell
node tools\verify-deployed.mjs
```

Runs the same real-click verification against the **deployed public address**, confirming that the
live copy works too.

## 7. Deployment

The front-end is a purely static page, so it can be hosted directly on GitHub Pages
(free, and online permanently).

```powershell
# publish to the gh-pages branch
py -3.12 tools\deploy_pages.py

# after the first publish, clean up the source files that came along
# when gh-pages was branched off main
py -3.12 tools\clean_pages_branch.py

# verify that the live page really works (real browser clicks)
node tools\verify-deployed.mjs
```

The publish script puts the **contents** of `src/` (not the `src` directory itself) at the site
root, so the relative paths in `index.html` (`css/style.css`, `js/bundle.js`, `assets/nailong.png`)
need no changes at all.

**Live site**: https://qihangpeng580-ui.github.io/832401217_calculator_frontend/

> Note: for the live page to reach the back-end, change `API_BASE_URL` in `src/js/config.js`
> to the back-end's public address, rebundle, and publish once more.

## 8. Demonstration Screenshots

See `docs/screenshots/README.md` (**13** screenshots, each with a one-line description).
The screenshots can be regenerated with `node tools/capture-screens.mjs` — that script starts the
back-end itself, really clicks the buttons, and validates the rendered result before taking each
shot, so the results are reproducible and the images match their descriptions.
