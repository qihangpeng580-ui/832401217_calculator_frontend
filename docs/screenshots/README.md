# Screenshot List (13 Screenshots)

> The TA's assignment post asks the blog to provide "**more than 10 screenshots, or a GIF / video**,
> each with a one-line description". This list is the source of those descriptions, and it can be
> quoted in the blog directly.
>
> **How it is generated**: `node tools/capture-screens.mjs` — reproducible, not clicked by hand.
>
> **This version talks to a real back-end**: the script starts a real Python back-end by itself
> (with a temporary database), and the page really calls the back-end to calculate and really reads
> the history from the database.
> So the result in every image is **computed by the back-end**, and the history records **really do
> live in the database**.
>
> Before each screenshot is taken, the script verifies that the page really rendered the target
> expression **and** the target result; if the check fails it stops with an error, so an image can
> never contradict its description.

| # | File name | One-line description |
|---|---|---|
| 1 | `01_initial_interface.png` | The default state after opening the page: a bright two-column layout (sky blue → pale pink gradient + white cards), with the calculator on the left and the history area on the right. The display is still empty, and the bottom-right corner reads "Back end connected — result computed by the back end" |
| 2 | `02_addition.png` | Typing `12+8` key by key and pressing `=`. The expression line echoes every key in real time, the result line shows **20** (computed by the back-end), and the record appears in the history area on the right |
| 3 | `03_subtraction.png` | Subtraction `9−4` = **5**. The interface shows `−` while the internals keep the ASCII minus, so there is no ambiguity when it is sent to the back-end |
| 4 | `04_multiplication.png` | Multiplication `5×8` = **40**. The interface displays `×` while the internals record `*` — display and internals are separated |
| 5 | `05_division.png` | Division `10÷2` = **5**. Again the interface shows `÷` while the internals hold `/` |
| 6 | `06_decimal.png` | Decimal numbers `3.5+1.25` = **4.75**. The back-end calculates with `Decimal`, avoiding floating-point error (`0.1+0.2` gives exactly `0.3`) |
| 7 | `07_compound_expression.png` | `1+2×3` = **7** (not 9). Operator precedence is the job of the **back-end's** parsing; the front-end simply presents the user's input faithfully |
| 8 | `08_parentheses.png` | `(1+2)×3` = **9**. Parenthesis matching is guaranteed by the front-end's input rules, while the **arithmetic meaning** of the parentheses is parsed by the back-end |
| 9 | `09_unary_sign.png` | `3×(-2)` = **−6**. Pressing `±` wraps the trailing number as the form `(-2)`, avoiding a construction whose validity depends on how tolerant the parser is |
| 10 | `10_key_pressed_highlight.png` | **The colour change and shrink feedback on button click** (the requirement the lecturer called out). The `+` key is in its pressed / active state: brighter background + highlighted border + a slight shrink |
| 11 | `11_invalid_expression.png` | Typing `1+2*` and pressing `=`. The invalid expression is judged by the **back-end**, which returns `INVALID_EXPRESSION`; the front-end translates it into a user-facing message and turns it red; this failure **is not written to the history** |
| 12 | `12_division_by_zero.png` | `10÷0`. Division by zero is judged by the **back-end**, which returns `DIVISION_BY_ZERO`; the front-end shows "Division by zero is not allowed" and turns it red |
| 13 | `13_history.png` | The history list read from the **back-end database**: a "Total: N" count, a search box, and each row showing the expression / result / time with its own "Delete" button |

## How to Reproduce

```powershell
cd 832401217_calculator_frontend
node tools\capture-screens.mjs
```

The script does all of this automatically:

1. Starts a real Python back-end (a dedicated port + a temporary database, deleted when it is finished)
2. Copies `src/` to a temporary directory, changes the back-end URL there to the temporary back-end's port, and **rebundles**
3. Launches headless Chrome and opens a separate tab for each image
4. **Really clicks the keys with the mouse** (rather than setting the state directly), going through a real HTTP request when `=` is pressed
5. **Verifies** that both the expression and the result match, then takes the screenshot
6. Cleans up: closes the browser and the back-end, and deletes the temporary files

> Note on reproduction: the script only changes the back-end URL in the temporary copy and
> **never modifies `src/` in the repository**. When it finishes, `git status` should be clean.
