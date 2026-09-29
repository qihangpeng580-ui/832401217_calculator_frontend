# 代码规范说明（前端）

> **规范出处**（作业要求：规范须源自主流官方标准或大厂/社区推荐标准，并在文档开头写明来源）：
>
> - **Google JavaScript Style Guide** — https://google.github.io/styleguide/jsguide.html
> - **Airbnb JavaScript Style Guide** — https://github.com/airbnb/javascript
> - 命名部分参考 **BEM**（Block / Element / Modifier）方法论用于 CSS 类名
>   — https://getbem.com/naming/
>
> 本文件说明本仓库实际采用了其中哪些条款、哪些做了取舍，以及为什么。
> 只写"我们确实遵守的"，不抄一份用不上的清单。

---

## 1. 文件与编码

| 项 | 规定 |
|---|---|
| 编码 | 一律 UTF-8（无 BOM） |
| 缩进 | 2 个空格，不用 Tab（Google Style 规定） |
| 换行 | LF；文件末尾保留一个空行 |
| 行宽 | 建议 100 字符以内（Google 规定 80，本仓库放宽到 100 以容纳中文注释） |
| 文件命名 | 小写字母 + 连字符，如 `input-model.js`、`calc-buttons.js` |

## 2. 命名

| 类型 | 规定 | 示例 |
|---|---|---|
| 变量 / 函数 | 小驼峰 | `applyKey`、`trailingNumber` |
| 常量（模块级不变值） | 全大写 + 下划线 | `MAX_LENGTH`、`SERVER_ERROR_TEXT` |
| 布尔值 | 用 `is` / `has` / `should` 开头 | `isDigit`、`isNumberSegment` |
| CSS 类名 | BEM：块、块__元素、块--修饰符 | `.screen__expression`、`.key--op` |
| JS 状态类 | `is-` 前缀，表示"由脚本切换的状态" | `.is-empty`、`.is-pressed`、`.is-armed` |
| DOM 中的元素引用变量 | 以 `El` 结尾 | `expressionEl`、`messageEl` |
| 自定义数据属性 | `data-` + 短横线小写 | `data-key`、`data-shot` |

**关于 CSS 类名的分工**：`key--op` 是**静态修饰符**（写死在 HTML 里），
`is-pressed` 是**动态状态**（由 JavaScript 增删）。两者不混用 —— 这是 BEM 的常见约定，
也让"哪些类会被脚本改动"一眼可辨。

## 3. 语言特性

- 使用 **ES Module**（`import` / `export`），不使用全局变量在模块间传递数据。
- 声明只用 `const`，需要重新赋值时才用 `let`；**禁用 `var`**（Airbnb 规定）。
- 比较一律用 `===` / `!==`；仅在与 `null` 比较时允许 `== null`。
- 字符串拼接优先用模板字符串；但**拼 HTML 属性选择器时用单引号拼接**，避免嵌套反引号降低可读性。
- 函数保持"做一件事"：本仓库所有函数都在 30 行以内。
- 纯函数优先：`input-model.js` 里的函数一律**不修改传入对象**，而是返回新对象。
  这样出问题时可以用"同样的输入必然得到同样的输出"来定位。

## 4. 安全与健壮性（本项目特别约定）

这些是本作业的硬性要求，写进规范以便复查：

1. **禁止 `eval` / `exec` / `new Function` / `setTimeout(字符串)`**。
   用户输入只当字符串处理，绝不当代码执行。作业明确禁止任意代码执行。
2. **禁止 `innerHTML` / `outerHTML` / `document.write`**。
   一律用 `textContent` 与 `createElement` 构造内容。
   表达式里出现 `<` `>` 时不会被当成标签，天然免疫 XSS。
3. **输入白名单**：表达式只允许 `0-9 . + - * / ( )` 这些字符；
   其余一律拒绝并给出提示（见 `input-model.js` 的 `applyKey`）。
4. **所有输入走同一个入口**：鼠标与键盘都必须调用 `applyKey`，
   不允许任何一处"绕过校验直接改表达式"。
5. **长度上限**：表达式最多 60 字符，防止无意义超长输入。

## 5. 注释

- 采用 JSDoc 风格：`/** 说明 */`，有参数与返回值时写 `@param` / `@returns`。
- **注释解释"为什么"，不解释"是什么"**。例：
  ```js
  // ❌ 差：把焦点移回键盘容器
  // ✅ 好：点完按钮浏览器会把焦点留在按钮上，之后按回车会重复触发该按钮；
  //        把焦点移到容器可避免这种重复触发
  ```
- 每个模块文件开头写一段说明：这个文件解决什么问题、边界在哪里。

## 6. 提交信息（Git Commit Message）

采用 Conventional Commits 的简化形式：

```
<type>: <中文简述>
```

| type | 含义 |
|---|---|
| `feat` | 新功能 |
| `fix` | 修 bug |
| `style` | 只改样式/格式，不改逻辑 |
| `docs` | 只改文档 |
| `test` | 只改测试 |
| `refactor` | 重构，行为不变 |

示例：`feat: 实现按钮点击的颜色变化反馈`、`fix: 修正连续运算符被重复追加的问题`

## 7. 本仓库的取舍说明

| 条款 | 取舍 | 原因 |
|---|---|---|
| Google 的 80 字符行宽 | 放宽到 100 | 中文注释在 80 字符内很难说清一件事 |
| Airbnb 要求用 TypeScript | 不用 | 本作业未要求，且引入编译步骤会削弱"打开即运行"的优点 |
| 完整的 ESLint 配置 | 未引入 | 已用 `src/test/` 的断言脚本覆盖输入规则；引入 ESLint 需要 npm，而本机 npm 被执行策略禁用 |
| 单元测试框架（Jest 等） | 未引入 | 用 Node 内置断言写零依赖自测脚本，效果等价且不需要安装 |

## 8. 自检清单（提交前逐条确认）

- [ ] `node src/test/test-input-model.js` 全部通过
- [ ] 全仓搜索 `eval` / `exec` / `new Function` / `innerHTML` 零命中
- [ ] 全仓搜索 `document.write` 零命中
- [ ] 每个模块文件开头都有职责说明
- [ ] CSS 类名符合 BEM，动态状态类用 `is-` 前缀
- [ ] 没有 `var`，没有 `==`（除 `== null`）
- [ ] 文件均为 UTF-8 无 BOM，缩进为 2 空格
