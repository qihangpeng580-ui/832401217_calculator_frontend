/**
 * 截图用的"场景设置"脚本（只在截图流程里使用，不参与页面正常运行）。
 *
 * 为什么不模拟键盘事件：
 *   Chrome 无头模式下的定时器与虚拟时间机制会让"按键回放"时序不可控，
 *   实测反复出现"截到空表达式"的问题。
 *   这里改成**立即执行**：直接调用页面自己的模块接口把状态设好，再渲染一次。
 *   走的仍然是真实的渲染代码路径（ui.render / ui.showServerError），
 *   只是省略了"一个键一个键敲"的过程。
 *
 * 场景由 <body data-shot="..."> 声明。
 */

import * as ui from './ui.js';
import { applyKey, createState } from './input-model.js';

// 执行痕迹：截图脚本在失败时会把 body 的 data-seed 打出来，
// 用来区分"脚本没跑"和"跑了但状态不对"。
document.body.dataset.seed = 'start';

const config = document.body.dataset.shot;
if (config) {
  const params = new URLSearchParams(config);

  // 按表达式逐字符调用输入模型 —— 与用户按键时完全相同的规则与代码路径
  let state = createState();
  for (const ch of params.get('expr') || '') {
    state = applyKey(state, ch);
  }
  document.body.dataset.seed = 'typed:' + state.text;
  ui.render(state, { value: '后端未接通', isPlaceholder: true });
  document.body.dataset.seed = 'rendered:' + document.getElementById('expression').textContent;

  // 后端错误（演示用）
  const code = params.get('error');
  if (code) {
    ui.showServerError(code);
    ui.setBackendStatus('后端错误响应（演示数据）');
  }

  // 运算符键保持高亮
  const armed = params.get('armed');
  if (armed) {
    ui.setArmedOperator(armed);
  }

  // 模拟"手指按下未松开"的瞬间
  const pressed = params.get('pressed');
  if (pressed) {
    ui.flashKey(pressed);
  }
}

// 通知截图脚本：状态已设好，可以拍照了。
// 截图脚本靠这个标志等页面，而不是靠固定延时 —— 这是本方案稳定的关键。
window.__shotReady = true;
