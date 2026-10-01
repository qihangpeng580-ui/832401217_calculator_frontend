"""把后端公网地址写进前端配置，重新打包，并发布到 GitHub Pages。

用法：
    py -3.12 tools/set_backend_url.py http://1.2.3.4:8000
    py -3.12 tools/set_backend_url.py http://1.2.3.4:8000 --no-deploy   只改不发布

------------------------------------------------------------------
为什么需要一个脚本而不是手动改
------------------------------------------------------------------

改后端地址这件事要动**三处**，少做一步就会出现"改了但没生效"：

    1. src/js/config.js          —— 配置源文件
    2. src/js/bundle.js          —— ★ 重新打包！页面加载的是它，
                                    而配置是在打包时被内联进去的
    3. gh-pages 分支上的产物     —— 重新发布

    只做第 1 步是最容易犯的错：源文件明明改了，页面却还在连旧地址，
    而且界面上完全看不出来（只会显示"无法连接后端服务"）。
    这个坑踩过，所以做成脚本。
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
CONFIG_FILE = PROJECT_ROOT / "src" / "js" / "config.js"


def make_console_robust() -> None:
    """让标准输出不要因为编码问题崩掉。

    ★ 这个坑在前后端都踩过：
      Windows 控制台默认编码是 GBK，打印 '✓' 这类字符会抛
      UnicodeEncodeError: 'gbk' codec can't encode character '\\u2713'。
      而这个异常发生在 print 里，看起来像是"脚本有 bug"，
      实际上只是终端编码不对。

      修法：把 stdout/stderr 的 errors 设成 "replace" —— 编不了的字符
      变成 '?'，绝不抛异常。同时尽量用 utf-8 输出。
    """
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            try:
                reconfigure(encoding="utf-8", errors="replace")
            except Exception:  # noqa: BLE001 - 改不了也不影响功能
                pass


def run(cmd: list[str], label: str) -> None:
    """跑一条命令，失败就退出。"""
    result = subprocess.run(
        cmd,
        cwd=PROJECT_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env={**__import__("os").environ, "PYTHONIOENCODING": "utf-8"},
    )
    output = ((result.stdout or "") + (result.stderr or "")).strip()
    if result.returncode != 0:
        print(f"✗ {label} 失败：")
        print(output)
        sys.exit(1)
    print(f"✓ {label}")
    for line in output.splitlines():
        print(f"    {line}")


def main() -> int:
    make_console_robust()

    parser = argparse.ArgumentParser(description="设置前端要连接的后端地址")
    parser.add_argument("url", help="后端地址，例如 http://1.2.3.4:8000（末尾不要带斜杠）")
    parser.add_argument("--no-deploy", action="store_true", help="只改配置和打包，不发布")
    args = parser.parse_args()

    url = args.url.strip().rstrip("/")

    # 做几个基本检查，免得把明显的错地址写进去
    if not re.match(r"^https?://", url):
        print("✗ 地址必须以 http:// 或 https:// 开头")
        return 1
    if "127.0.0.1" in url or "localhost" in url:
        print("⚠ 警告：地址是本机地址。部署到公网时，别人访问不到 127.0.0.1。")

    # ---- 1. 改 config.js ----
    text = CONFIG_FILE.read_text(encoding="utf-8")
    pattern = re.compile(r"export const API_BASE_URL = '[^']*';")

    if not pattern.search(text):
        print("✗ 在 config.js 里找不到 `export const API_BASE_URL = '...';`")
        print("  请确认文件没被改过写法。")
        return 1

    old_match = pattern.search(text)
    old_url = old_match.group(0) if old_match else "(未知)"
    updated = pattern.sub(f"export const API_BASE_URL = '{url}';", text)
    CONFIG_FILE.write_text(updated, encoding="utf-8")
    print(f"✓ 已更新 config.js")
    print(f"    原：{old_url}")
    print(f"    新：export const API_BASE_URL = '{url}';")

    # ---- 2. 重新打包 ----
    # ★ 这一步不能省：页面加载的是 bundle.js，配置在里面是内联的
    run(["node", "tools/build-bundle.mjs"], "重新打包 bundle.js")

    # ---- 3. 发布 ----
    if args.no_deploy:
        print("（--no-deploy：跳过发布）")
    else:
        run([sys.executable, "tools/deploy_pages.py"], "发布到 GitHub Pages")

    print()
    print("=" * 62)
    print("完成。")
    print("=" * 62)
    print(f"  前端地址：https://qihangpeng580-ui.github.io/832401217_calculator_frontend/")
    print(f"  后端地址：{url}")
    print(f"  健康检查：{url}/api/health")
    print()
    print("  建议马上验证一遍（等 1-2 分钟 Pages 生效后）：")
    print("    py -3.12 tools/verify_deployed.py    # 若存在")
    print("    或直接在浏览器里打开前端地址，按 F12 看 Network 面板")
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
