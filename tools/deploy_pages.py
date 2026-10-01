"""把前端发布到 GitHub Pages。

用法：
    py -3.12 tools/deploy_pages.py                发布
    py -3.12 tools/deploy_pages.py --dry-run      只看会发布什么

------------------------------------------------------------------
为什么需要这个脚本（不能直接把 src/ 推上去）
------------------------------------------------------------------

GitHub Pages 只能从**仓库根目录**或 **/docs 目录**提供文件，
而我们的前端在 src/ 下，且 index.html 里用的是相对路径：

    <link rel="stylesheet" href="css/style.css">
    <script src="js/bundle.js"></script>
    <img src="assets/nailong.png">

所以必须把 src/ 里的**内容**（不是 src 这个目录本身）放到站点根目录，
变成：

    index.html          ← 来自 src/index.html
    css/style.css       ← 相对路径正好对得上
    js/bundle.js
    assets/nailong.png

于是相对路径完全不用改，源码也不用为部署做任何妥协。

------------------------------------------------------------------
部署到哪里
------------------------------------------------------------------

发布到 `gh-pages` 分支。这样 main 分支保持"源码"的干净状态，
而 gh-pages 分支是"构建产物"。

访问地址形如：
    https://qihangpeng580-ui.github.io/832401217_calculator_frontend/
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import quote

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = PROJECT_ROOT / "src"

OWNER = "qihangpeng580-ui"
REPO = "832401217_calculator_frontend"
BRANCH = "gh-pages"
API = "https://api.github.com"

# 不要发布的文件
SKIP_NAMES = {".DS_Store", "Thumbs.db"}
SKIP_SUFFIXES = {".md", ".pyc"}


def find_token() -> str:
    """找 GitHub 令牌（与 push_via_api.py 同样的策略）。"""
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        return token.strip()

    cred_file = Path.home() / ".git-credentials"
    if cred_file.exists():
        for line in cred_file.read_text(encoding="utf-8", errors="replace").splitlines():
            if "github.com" not in line:
                continue
            _, _, rest = line.partition("://")
            userinfo, _, _ = rest.partition("@")
            _, _, secret = userinfo.partition(":")
            if secret:
                return secret.strip()

    raise SystemExit("找不到 GitHub 令牌")


def api_request(method: str, path: str, token: str, body: dict | None = None, retries: int = 4):
    """调用 GitHub API，带重试（网络偶发中断）。"""
    import time

    url = API + path
    data = json.dumps(body).encode("utf-8") if body is not None else None

    for attempt in range(retries):
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Authorization", f"token {token}")
        req.add_header("Accept", "application/vnd.github+json")
        req.add_header("User-Agent", "dsh-deploy-script")
        if data is not None:
            req.add_header("Content-Type", "application/json")

        try:
            with urllib.request.urlopen(req, timeout=90) as resp:
                raw = resp.read().decode("utf-8")
                return resp.status, (json.loads(raw) if raw else {})
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace")
            # 404 在“查询分支是否存在”时是正常结果，不要重试
            if exc.code == 404:
                return 404, {"message": "not found"}
            if exc.code >= 500 and attempt < retries - 1:
                time.sleep(1.5 * (attempt + 1))
                continue
            try:
                return exc.code, json.loads(raw)
            except json.JSONDecodeError:
                return exc.code, {"message": raw}
        except Exception:  # noqa: BLE001
            if attempt < retries - 1:
                time.sleep(1.5 * (attempt + 1))
                continue
            raise

    raise RuntimeError("请求失败")


def collect_site_files() -> list[tuple[str, bytes]]:
    """收集要发布的文件，返回 [(发布路径, 内容)]。

    发布路径的规则：src/ 下的文件，去掉 src/ 前缀。
    """
    files: list[tuple[str, bytes]] = []

    for path in sorted(SRC_DIR.rglob("*")):
        if not path.is_file():
            continue
        if path.name in SKIP_NAMES or path.suffix in SKIP_SUFFIXES:
            continue

        # 去掉 src/ 前缀 —— 这是能让相对路径不作废的关键一步
        deploy_path = path.relative_to(SRC_DIR).as_posix()
        files.append((deploy_path, path.read_bytes()))

    # .nojekyll：告诉 GitHub Pages 不要用 Jekyll 处理这些文件。
    # 不加的话，以下划线开头的文件会被 Jekyll 忽略。
    files.append((".nojekyll", b""))

    return files


def ensure_branch(token: str) -> None:
    """确保 gh-pages 分支存在；不存在就从 main 派生一个。

    ★ 踩过的坑：
      一开始以为"往不存在的分支写文件，Contents API 会自动建分支" ——
      实际会返回 404（不是 422，很容易误判成"文件不存在"）。
      GitHub 的 Contents API 要求目标分支**必须已经存在**。

      所以正确做法是：先用 refs API 从 main 的最新提交派生出一个新分支，
      再往里面写文件。
    """
    status, _ = api_request("GET", f"/repos/{OWNER}/{REPO}/branches/{BRANCH}", token)
    if status == 200:
        print(f"分支 {BRANCH} 已存在")
        return

    # 取 main 的最新提交 sha
    status, data = api_request("GET", f"/repos/{OWNER}/{REPO}/git/ref/heads/main", token)
    if status != 200:
        raise SystemExit(f"取不到 main 分支的提交：HTTP {status} {data.get('message', '')}")

    main_sha = data["object"]["sha"]

    # 从这个提交创建 gh-pages 分支
    status, data = api_request(
        "POST",
        f"/repos/{OWNER}/{REPO}/git/refs",
        token,
        {"ref": f"refs/heads/{BRANCH}", "sha": main_sha},
    )

    if status == 201:
        print(f"已从 main（{main_sha[:7]}）创建分支 {BRANCH}")
    else:
        raise SystemExit(f"创建分支失败：HTTP {status} {data.get('message', '')}")


def get_remote_state(token: str, deploy_path: str) -> tuple[str | None, bytes | None]:
    """取远端文件状态（用于跳过未变化的文件）。"""
    status, data = api_request(
        "GET",
        f"/repos/{OWNER}/{REPO}/contents/{quote(deploy_path, safe='/')}?ref={BRANCH}",
        token,
    )
    if status != 200:
        return None, None

    sha = data.get("sha")
    encoded = data.get("content")
    if not encoded:
        return sha, None
    try:
        return sha, base64.b64decode(encoded.replace("\n", ""))
    except Exception:  # noqa: BLE001
        return sha, None


def main() -> int:
    parser = argparse.ArgumentParser(description="发布前端到 GitHub Pages")
    parser.add_argument("--dry-run", action="store_true", help="只列出将要发布的文件")
    args = parser.parse_args()

    files = collect_site_files()

    print("=" * 62)
    print("发布前端到 GitHub Pages")
    print("=" * 62)
    print(f"源目录：{SRC_DIR}")
    print(f"目标：  {OWNER}/{REPO}  分支 {BRANCH}")
    print(f"文件数：{len(files)}")
    print()

    for deploy_path, content in files:
        print(f"  {deploy_path:<34} {len(content):>8} 字节")

    if args.dry_run:
        print("\n（dry-run，没有真正发布）")
        return 0

    token = find_token()
    ensure_branch(token)

    print()
    published = 0
    unchanged = 0
    failed: list[str] = []

    for deploy_path, content in files:
        remote_sha, remote_content = get_remote_state(token, deploy_path)

        if remote_sha and remote_content is not None and remote_content == content:
            unchanged += 1
            print(f"  --   {deploy_path}（未变化，跳过）")
            continue

        body: dict = {
            "message": f"deploy: 发布前端到 GitHub Pages（{deploy_path}）",
            "content": base64.b64encode(content).decode("ascii"),
            "branch": BRANCH,
        }
        if remote_sha:
            body["sha"] = remote_sha

        status, data = api_request(
            "PUT", f"/repos/{OWNER}/{REPO}/contents/{quote(deploy_path, safe='/')}", token, body
        )

        if status in (200, 201):
            published += 1
            print(f"  OK   {deploy_path}")
        else:
            failed.append(f"{deploy_path}: HTTP {status} {data.get('message', '')}")
            print(f"  FAIL {deploy_path}: HTTP {status} {data.get('message', '')[:70]}")

    print()
    print(f"新发布 {published} 个，跳过 {unchanged} 个，失败 {len(failed)} 个")
    print()
    print("访问地址（首次发布后需要等 1-2 分钟生效）：")
    print(f"  https://{OWNER}.github.io/{REPO}/")

    if failed:
        print("\n失败明细：")
        for item in failed:
            print("  " + item)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
