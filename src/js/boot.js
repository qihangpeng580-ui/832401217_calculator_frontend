/**
 * 启动脚本 —— 整个应用的最后一块拼图。
 *
 * 为什么启动逻辑要单独一个文件，而不是写在 app.js 的末尾：
 *   因为 bundle.js 是把所有模块**按顺序拼在一个作用域里**的。
 *   如果 app.js 在文件末尾直接调用 boot()，那么拼包时它会在
 *   "键盘模块还没定义"的时候就执行 —— 页面直接报错。
 *   （这个坑在打包器上真实踩过：bundle 的依赖顺序很敏感。）
 *
 *   单独一个 boot.js 放在**最后一个**文件，并且用 DOMContentLoaded 兜底，
 *   就保证了"所有模块都已定义"之后才启动。
 *
 * 顺序说明：
 *   · 先给 window.__calc 挂上只读调试接口（自动化测试要用）
 *   · 再调 app.boot() 真正启动
 */

import { boot } from './app.js';

/**
 * 真正的启动动作。
 */
function start() {
  try {
    boot();
  } catch (error) {
    // 启动失败必须留下痕迹 —— 否则页面看起来正常但点了没反应，
    // 和当年 file:// 那个坑的表现一模一样，极难排查。
    console.error('[计算器] 启动失败：', error);
    const messageEl = document.getElementById('message');
    if (messageEl) {
      messageEl.textContent = '页面启动失败，请按 F12 查看控制台错误';
      messageEl.classList.add('is-error');
    }
  }
}

if (document.readyState === 'loading') {
  // 文档还在加载：等 DOM 就绪再启动（脚本放在 body 末尾时通常不会走这里）
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  // 文档已就绪：直接启动
  start();
}
