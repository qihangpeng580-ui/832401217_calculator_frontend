# Visual Calculator · Front-end Design Notes

> This document records **why things are designed this way**, not what the code does (the code
> speaks for itself). It is mainly meant for the "design rationale" post on the assignment blog and
> for questions at the defence.

---

## 1. Understanding the Requirements: What the Front-end Should Actually Do

The TA's assignment post draws the front-end / back-end responsibilities very clearly. Translated
into the front-end, the real requirements are:

| The front-end **should** do | The front-end **should not** do |
|---|---|
| Present the interface, handle button interaction, accept expression input | Parse expressions |
| Send the expression to the back-end | Compute precedence, parentheses, unary plus / minus |
| Display the result the back-end returns | Detect division by zero |
| Display the errors the back-end returns | Invent its own results or error messages |
| Display the history and issue delete requests | Store the history in LocalStorage |

**How this is judged at acceptance** (the assignment post's own words): stop the back-end service,
and "the front-end can still accept input and interact normally, but it cannot independently obtain
a new valid calculation result".

That requirement determines the whole architecture: **the front-end cannot even do an addition**.
So you will not find a single arithmetic expression anywhere in `src/js/`, and the `=` key only
shows a message, never a result, until the back-end is reachable.

## 2. Module Breakdown and Responsibility Boundaries

### 2.1 Overall Structure

```
                              ┌──────────────────────────┐
                              │  boot.js                 │
                              │  startup (must be last)  │
                              └────────────┬─────────────┘
                                           │ calls
                                           ▼
   ┌─────────────────────────────────────────────────────────────────────────────────────────┐
   │  app.js   main controller: wires the modules, decides what to do                        │
   │  · checks whether the back-end is online                                                │
   │  · on = : call the back-end → show the result → refresh history                         │
   │  · delete / search / clear history                                                      │
   │  No arithmetic anywhere in this file                                                    │
   └──────────┬──────────────────────┬──────────────────────┬──────────────────────┬─────────┘
              │                      │                      │                      │
              ▼                      ▼                      ▼                      ▼
   ┌────────────────────┐ ┌────────────────────┐ ┌────────────────────┐ ┌────────────────────┐
   │api.js              │ │ui.js               │ │history.js          │ │calc-buttons.js     │
   │API client          │ │render layer        │ │history list        │ │event-driven core   │
   │· the only place    │ │· the only module   │ │· rendering +       │ │· event delegation  │
   │  that talks to     │ │  that touches the  │ │  delete delegation │ │· dispatch by       │
   │  the back-end      │ │  DOM               │ │                    │ │  data-key          │
   │· timeout / error   │ │                    │ │                    │ │· submit on =       │
   │  normalization     │ │                    │ │                    │ │                    │
   └──────────┬─────────┘ └────────────────────┘ └──────────┬─────────┘ └──────────┬─────────┘
              │                                             │                      │
              │                                             │                      ▼
              │                                             │           ┌────────────────────┐
              │                                             │           │input-model.js      │
              │                                             │           │expression buffer   │
              │                                             │           │(pure functions)    │
              │                                             │           │· six input checks  │
              │                                             │           │· no DOM access     │
              │                                             │           │· computes nothing  │
              │                                             │           └──────────▲─────────┘
              │                                             │                      │ reuses the same entry point
              │                                             │           ┌──────────┴─────────┐
              │                                             │           │keyboard.js         │
              │                                             │           │physical keyboard   │
              │                                             │           │· no input rules    │
              │                                             │           └────────────────────┘
              ▼
   ┌──────────────────────────────────────┐                       ┌────────────────────────────┐
   │  config.js                           │                       │  HTTP → back-end service   │
   │  back-end URL / timeout / page size  │                       │  (separate repo, Python)   │
   └──────────────────────────────────────┘                       └────────────────────────────┘
```

### 2.2 Four Boundary Rules

1. **Only `ui.js` and `history.js` may touch the DOM.** The other modules work out "what should be
   displayed right now"; they do not decide how it is displayed. The benefit: when the interface is
   inconsistent, there are only two places to look.
2. **Only `input-model.js` decides whether input is valid.** No other module is allowed to judge for
   itself "whether this character may be entered". The benefit: the rules exist in exactly one place.
3. **Only `api.js` knows that a network exists.** The other modules never see `fetch`, HTTP status
   codes, or timeouts. All they see is "the data arrived successfully" or "an exception carrying an
   error code was thrown". The benefit: if the transport changes later (WebSocket, or a same-origin
   API), only this one file needs editing.
4. **The mouse and the keyboard share a single entry point.** `keyboard.js` only translates
   "key → meaning", and then hands the result to `handleKey` in `calc-buttons.js`. The benefit: the
   inconsistency of "clicking is blocked, yet the keyboard can still type" becomes impossible.

### 2.3 A Deliberate Design Choice: Breaking the Circular Dependency with Callback Injection

`calc-buttons.js` needs to call the back-end when `=` is pressed, but the back-end request lives in
`app.js`. If it did `import app from './app.js'` at the top of the file, we would end up with the
circular dependency `app → calc-buttons → app`.

```js
// calc-buttons.js
let onSubmit = () => {};
export function setSubmitHandler(handler) { onSubmit = handler; }

function evaluate() {
  const check = canSubmit(state.text);
  if (!check.ok) { /* an error the front-end can be certain about: show a message only */ return; }
  onSubmit(state.text);   // ← what actually happens is injected by app.js
}
```

```js
// app.js
setSubmitHandler(submit);   // injected at startup
```

There are two benefits:
- the dependency direction becomes one-way, `app → calc-buttons`, with no cycle;
- in tests you can inject a **fake submit function**, so the click behaviour can be exercised
  without a real back-end.

> The other way round: to add a "scientific calculator" panel you only need to add rule branches in
> `input-model.js`, and the other files barely change. That is the payoff of drawing these boundaries.

## 3. Incremental Delivery: Three Runnable Versions

The course recently covered agile and extreme programming, two points of which directly shape the
development order: **"the basic functionality must be finished in the first version, and the
increments must take dependencies into account"** (new meeting minutes) and **"Keep It Simple"** (an XP
coding practice). On that basis the front-end was cut into three increments that **each open and run**:

| Increment | Contents | What you see when you open the page | Dependencies |
|---|---|---|---|
| **v0.1** | `index.html` + `style.css` | The complete interface; you can look but not click | None (it is the base for the other two) |
| **v0.2** | `input-model.js` + `ui.js` + `calc-buttons.js` | Clickable, with colour feedback and input validation | Depends on v0.1's structure and class names |
| **v0.3** | `keyboard.js` + the error message bar | Both mouse and keyboard work, and errors get user-facing messages | Depends on v0.2's processing entry point |

**Why it is cut this way**: v0.1 is the "interface skeleton", and it determines the CSS class names
that the v0.2 JavaScript uses to look up elements — so the interface had to stabilise first. That is
a real dependency, not a choice made for appearances. v0.3 comes last because it **reuses** the entry
point v0.2 built; doing the keyboard first would have forced two sets of rules that then had to be
merged.

At the end of each increment the page is **runnable**, ready to be screenshotted as evidence — which
is how "working software is the primary measure of progress" (one of the twelve agile principles)
lands in this project.

## 4. Key Design Decisions

### Decision 1: Event Delegation Instead of 27 onclick Handlers

The whole keypad carries a single `click` listener, using `event.target.closest('[data-key]')` to
locate the button that was clicked.

| Approach | Pros | Cons |
|---|---|---|
| 27 buttons each with a listener | Straightforward | Adding a key means editing JS; the rules are scattered across 27 places; more memory |
| **Event delegation (this approach)** | One entry point, no JS change when adding a key, works for dynamic elements too | One extra `closest()` check in the handler |

The deciding factor was not that the latter is "more advanced", but that it **centralises the rules**:
every key ultimately calls the same `handleKey`, so no button can quietly miss validation.

### Decision 2: Colour Changes via Both CSS Pseudo-classes and JS State Classes

The requirement the lecturer called out was "clicking a button triggers a colour change". Two
implementations are used deliberately here, and both are documented in the comments:

| Implementation | Code | Scenarios covered |
|---|---|---|
| CSS pseudo-classes | `.key:hover` / `.key:active` | Mouse hover and mouse press — **not a single line of JS** |
| JS state classes | `.is-pressed` / `.is-armed` | (1) Physical-keyboard presses also highlight (a keyboard has no `:active`). (2) An operator key stays highlighted after the mouse moves away |

Conclusion: **anything CSS can express is not written in JS; only what CSS cannot express uses a
state class.** This is "minimum necessary complexity" applied.

### Decision 3: Separating Display from Internals — the Interface Shows `×` `÷`, the Internals Store `*` `/`

The lecturer's slides state this convention explicitly ("the user interface may display × and ÷,
while the internal expression uses * and /"). Implementation:

- the internals always store the ASCII characters `*` `/` `-`;
- the mapping is applied once, **just before rendering** (`toDisplayText` in `ui.js`);
- the mapping is a one-to-one replacement, so the character count is unchanged and the cursor
  position is unaffected.

Benefits: the expression can be sent to the back-end as it is, with no "translation" pass before
submitting; and there is no risk of a display symbol leaking into the expression and making the
back-end's parsing fail.

### Decision 4: Writing the Sign as `(-number)` Instead of Inserting a `-`

Pressing `±` turns `5+3` into `5+(-3)`, not `5+-3`.

Many parsers accept the latter, but its validity depends on how tolerant those parsers are; written
the former way, **any** parser that follows conventional grammar handles it unambiguously. Pressing
`±` once more restores it to `5+3` as a whole.

This decision directly affects the back-end: its tokenizer can require that "an operator must be
followed by a number or a left parenthesis", instead of carving out a special case for `+-`.

### Decision 5: Consecutive Operators Are "Replaced", Not "Appended"

Typing `1+*` yields `1*` — the new operator **replaces** the one just entered.

This is common behaviour in real calculators, and it handily dissolves a thorny problem: without
replacement you would have to decide whether "two consecutive operators" is legal, and once it is,
expression validation has to handle edge cases such as `1++2` and `1+/2`. With replacement, invalid
combinations are never produced at input time.

The exception: a **minus sign** as in `3*-2` is allowed — the rule being "when the previous operator
is not a minus, a further minus is treated as a sign". That lets unary plus / minus and binary
subtraction be told apart already at the input stage.

### Decision 6: A Purely Functional Buffer

`applyKey(state, key)` does not modify the `state` passed in; it returns a new object. The return
value carries `message` and `messageType`, which the interface layer renders directly from it.

Payoffs:
- the rules can be tested outside a browser — `src/test/test-input-model.js` runs this function
  directly, and 49 assertions finish in a few milliseconds with no page to launch;
- "input rejected" has exactly one implementation (the `reject` function), so no branch can change
  the text without also giving a message.

## 5. Dividing Up Exception Handling

| Kind of error | Decided by | Front-end behaviour |
|---|---|---|
| Illegal characters, consecutive operators, multiple decimal points | **Front-end** (blocked at input time) | The message bar turns red, the input is not written |
| Unmatched parentheses, ending with an operator / decimal point | **Front-end** (validated before submit, `canSubmit`) | The message bar turns red, no request is sent |
| Division by zero | **Back-end** | The returned `DIVISION_BY_ZERO` is rendered as "Division by zero is not allowed" |
| Invalid expression syntax (the cases the front-end did not block) | **Back-end** | The `INVALID_EXPRESSION` message from the back-end is shown |
| Network down / back-end not started | Front-end (the `fetch` fails) | Reports "Cannot reach the back-end service. Make sure it is running." |
| Internal server error | Back-end | Shows the generic `INTERNAL_ERROR` message |

**The principle**: the front-end only blocks the errors it **can be certain about** (character level,
structure level), and **leaves syntax and semantics to the back-end**. The front-end does not try to
guess "whether the back-end will complain"; if it did, any mismatch between the two sets of rules
would produce the contradiction "the front-end says illegal, the back-end says valid".

`SERVER_ERROR_TEXT` in `ui.js` is this division of labour made concrete: error code → user-facing message.

## 6. Self-test Design

`src/test/test-input-model.js` uses Node's built-in assertions, has zero dependencies, and covers 49 cases:

| Group | Count | Coverage |
|---|---|---|
| Basic input | 8 | Digits, multi-digit numbers, the four operations, decimal numbers |
| Leading restrictions | 4 | Cannot start with `+ * /`; `-` is allowed |
| Consecutive operators | 4 | Replacement behaviour, the sign, same-type operators |
| Decimal point | 5 | Repeated decimal points, leading zeros, following a right parenthesis |
| Parentheses | 6 | Matching, illegal positions, implicit multiplication |
| Sign key | 4 | Wrapping in parentheses, toggling back, rejection on an empty expression |
| Backspace and clear | 5 | Single-character backspace, backspacing a whole sign group, AC |
| Length limit | 1 | Over-long input truncated at 60 |
| Helper functions | 4 | Trailing-number extraction, parenthesis counting |
| Submit validation | 6 | The various non-submittable situations |
| Whitelist | 2 | Unsupported keys rejected |

**Why it has to exist**: the input rules are the place most prone to "fix one thing, break another",
and their problems do not necessarily show up in the interface straight away (a valid input being
silently rejected, for instance). Turning these rules into assertions means that one run after a
change tells you within seconds whether you broke something.

## 7. Four Things the Front-end **Deliberately Does Not Do**

The previous sections covered "how". This one covers "**what we deliberately do not do**". The items
below are not "not done yet" — by the division of responsibilities they should never be done by the
front-end in the first place:

| The front-end does not do | Who does it | Why |
|---|---|---|
| Parse expressions, compute precedence / parentheses / unary plus / minus | The back-end's `parser.py` (recursive descent) | A hard assignment requirement: **the final result must be produced by the back-end**. If the front-end computed it itself, the back-end's 50 marks would be meaningless |
| Detect division by zero, or judge whether an expression is invalid | The back-end | The front-end only **translates the returned error codes into user-facing text**; it draws no conclusions of its own — otherwise "the back-end computes the result but still has to please the front-end" |
| Store the history in the browser (LocalStorage / sessionStorage) | The back-end, SQLite | The history must persist in the **back-end database**. Stored in a browser it disappears on another device, and it would not satisfy the "history persistence" marking item either |
| Execute code dynamically with `eval` / `exec` / `new Function` | — | **Banned throughout** the front-end and the back-end, and guarded by a static check in the tests (a hit fails them) |

> **This boundary is the single most important design decision in this project** — every later
> implementation choice follows from it. In one sentence: the front-end is only responsible for
> "tidying up what the user typed, sending it out, and displaying exactly what the back-end says".

**How to verify it on the spot**: open the page, press `F12` → Network, type `1+2*3` and press `=`;
you will see a `POST /api/calculate` (the response headers even carry `X-Calculated-By: backend`).
Now stop the back-end and press `=` again: the interface still responds to clicks, but it will
**never produce another result**.
