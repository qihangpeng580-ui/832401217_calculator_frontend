/**
 * 截图用的"场景设置"脚本（只在截图流程里使用，不参与页面正常运行）。
 *
 * ------------------------------------------------------------------
 * 这一版是怎么工作的（和上一版的关键区别）
 * ------------------------------------------------------------------
 *
 * 上一版直接调用输入模型的接口把状态"摆"出来，绕过了完整的交互链路。
 * 那一版能生成好看的图，但证明不了"按钮点下去真的有用"——
 * 而且后来正是这种"绕过真实链路"的测试漏掉了 file:// 那个致命 bug。
 *
 * 这一版改成：
 *   1. **真的去点按钮**（button.click()，走完整的点击 → 事件委托 → handleKey 链路）
 *   2. 按 = 时走真实的 fetch → 真后端 → 真结果
 *   3. 历史列表也是真的从后端拉的
 *
 * 所以截出来的图，和用户自己打开页面点出来的**完全一致**。
 *
 * 为什么是**传统脚本**而不是 ES 模块：
 *   页面本身只加载传统脚本 bundle.js。实测在这个页面里再挂一个
 *   <script type="module"> 会因为模块加载限制而失败。
 *
 * 场景由 <body data-shot="..."> 声明。
 */

(function () {
  /** 等到某个条件成立，或超时 */
  function waitFor(test, timeoutMs) {
    return new Promise(function (resolve) {
      var deadline = Date.now() + (timeoutMs || 6000);
      (function tick() {
        var ok = false;
        try {
          ok = test();
        } catch (error) {
          ok = false;
        }
        if (ok || Date.now() > deadline) {
          resolve(ok);
          return;
        }
        setTimeout(tick, 50);
      })();
    });
  }

  /** 真的点击一个按键（走完整的交互链路，不是直接设状态） */
  function clickKey(key) {
    var button = document.querySelector('[data-key="' + key + '"]');
    if (!button) {
      throw new Error('找不到按键：' + key);
    }
    button.click();
  }

  /** 依次点击一串按键 */
  function pressKeys(keys) {
    for (var i = 0; i < keys.length; i += 1) {
      clickKey(keys[i]);
    }
  }

  /** 界面上的表达式文本（剥掉光标用的零宽空格） */
  function shownExpression() {
    var el = document.getElementById('expression');
    return el ? (el.textContent || '').replace(/\u200b/g, '') : '';
  }

  /** 结果行文本 */
  function shownResult() {
    var el = document.getElementById('result');
    return el ? (el.textContent || '') : '';
  }

  /** 历史列表里的条数 */
  function historyCount() {
    return document.querySelectorAll('#history-list li').length;
  }

  async function applyShot() {
    // 执行痕迹：截图脚本失败时会把 body 的 data-seed 打出来，
    // 用来区分"脚本没跑"和"跑了但状态不对"。
    document.body.dataset.seed = 'start';

    var calc = window.__calc;
    if (!calc) {
      document.body.dataset.seed = 'no-bridge'; // bundle 没执行
      window.__shotReady = true;
      return;
    }
    document.body.dataset.seed = 'bridge-ok';

    var config = document.body.dataset.shot;
    if (!config) {
      window.__shotReady = true;
      return;
    }

    var params = new URLSearchParams(config);

    // keys 是按键序列，用逗号分隔；NEG 代表 ± 键
    var rawKeys = params.get('keys') || '';
    var keys = rawKeys ? rawKeys.split(',') : [];

    // 先等一下：页面启动时会去检查后端、拉历史，等它稳定下来再操作
    await waitFor(function () {
      var text = document.getElementById('backend-text');
      return text && text.textContent.indexOf('已连接') >= 0;
    }, 8000);

    document.body.dataset.seed = 'backend-checked';

    try {
      // ① 真的点按钮输入表达式
      if (keys.length > 0) {
        pressKeys(keys);
      }

      // ② 按 = 触发真实的 fetch → 真后端计算
      if (params.get('submit') === '1') {
        clickKey('=');

        // 等到结果行不再显示"计算中…"/"—"，说明后端已经回话了
        await waitFor(function () {
          var text = shownResult();
          return text !== '计算中 …' && text !== '—' && text !== '后端未接通';
        }, 8000);

        // 历史列表也要等它刷新完（submit 成功后会重新拉列表）
        await waitFor(function () {
          return historyCount() > 0;
        }, 8000);
      }

      // ③ 清空之后再输入（用于"历史已有内容"的场景）
      if (params.get('prefill') === '1') {
        var samples = ['12+8', '3.5+1.25', '(1+2)*3'];
        for (var i = 0; i < samples.length; i += 1) {
          clickKey('AC');
          pressKeys(samples[i].split(''));
          clickKey('=');
          await waitFor(function () {
            var text = shownResult();
            return text !== '计算中 …' && text !== '—';
          }, 8000);
        }
        clickKey('AC');
      }

      // ④ 运算符键保持高亮（这个必须放在最后：任何一次按键都会清掉高亮）
      var armed = params.get('armed');
      if (armed) {
        clickKey(armed);
      }

      // ⑤ 模拟"手指按下未松开"的瞬间
      var pressed = params.get('pressed');
      if (pressed) {
        calc.flashKey(pressed);
      }

      document.body.dataset.seed = 'rendered:' + shownExpression();
    } catch (error) {
      document.body.dataset.seed = 'error:' + error.message;
    }

    // 通知截图脚本：状态已设好，可以拍照了
    window.__shotReady = true;
  }

  if (document.readyState === 'complete') {
    applyShot();
  } else {
    window.addEventListener('load', applyShot, { once: true });
  }
})();
