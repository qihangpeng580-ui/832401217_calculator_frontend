/**
 * 截图用的"场景设置"脚本（只在截图流程里使用，不参与页面正常运行）。
 *
 * 为什么是**传统脚本**而不是 ES 模块：
 *   页面本身只加载传统脚本 bundle.js。实测在这个页面里再挂一个
 *   <script type="module"> 会因为模块加载限制而失败（页面报 ERR:error、状态设不上）。
 *   所以这里改用传统脚本，通过 bundle 暴露的只读接口 window.__calc 来设置状态。
 *
 * 为什么用 load 事件包起来：等待 bundle.js 执行完（它定义了 window.__calc）。
 *
 * 场景由 <body data-shot="..."> 声明。
 */

(function () {
  /** 按 data-shot 声明设置页面状态 */
  function applyShot() {
    // 执行痕迹：截图脚本在失败时会把 body 的 data-seed 打出来，
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
    if (config) {
      var params = new URLSearchParams(config);

      // 按表达式逐字符调用输入模型 —— 与用户按键时完全相同的规则与代码路径
      var state = calc.createState();
      var expr = params.get('expr') || '';
      for (var i = 0; i < expr.length; i += 1) {
        state = calc.applyKey(state, expr[i]);
      }
      calc.render(state, { value: '后端未接通', isPlaceholder: true });
      document.body.dataset.seed = 'rendered:' + document.getElementById('expression').textContent;

      // 后端错误（演示用）
      var code = params.get('error');
      if (code) {
        calc.showServerError(code);
        calc.setBackendStatus('后端错误响应（演示数据）');
      }

      // 运算符键保持高亮
      var armed = params.get('armed');
      if (armed) {
        calc.setArmedOperator(armed);
      }

      // 模拟"手指按下未松开"的瞬间
      var pressed = params.get('pressed');
      if (pressed) {
        calc.flashKey(pressed);
      }
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
