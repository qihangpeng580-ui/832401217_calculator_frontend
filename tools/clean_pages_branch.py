"""清空 gh-pages 分支上的残留文件，并触发一次干净的 Pages 重建。

------------------------------------------------------------------
为什么要这个脚本
------------------------------------------------------------------

gh-pages 分支是从 main 派生出来的（因为 Contents API 要求目标分支必须已存在），
所以它一开始**带着 main 的全部内容** —— src/、tools/、docs/、README.md 等等。

发布脚本只往上**添加**了站点文件（index.html、css/、js/、assets/），
旧的源码目录原封不动留在那里。结果：

    gh-pages 分支根目录 = 站点文件 + 一堆用不上的源码

后果有两个：
    1. 不够干净 —— 助教如果翻 gh-pages 分支会看到一堆重复内容；
    2. 可能干扰构建 —— 分支上同时存在 src/ 和根目录的 index.html，
       会让人分不清哪个才是站点。

本脚本把 gh-pages 上**除站点文件以外的东西全部删掉**，
然后做一个空提交触发 Pages 重新构建。

用法：
    py -3.12 tools/clean_pages_branch.py --dry-run    先看会删什么
    py -3.12 tools/clean_pages_branch.py              真的删
"""

from __future__ import annotations

import argparse
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import quote

PROJECT_ROOT = Path(__file__).resolve().parent.parent
OWNER = "qihangpeng580-ui"
REPO = "832401217_calculator_frontend"
BRANCH = "gh-pages"
API = "https://api.github.com"

# 站点需要的文件/目录 —— 这些必须保留
KEEP = {"index.html", "css", "js", "assets", "test", ".nojekyll"}

# 站点文件的实际来源（来自 src/），用来兜底判断"这个名字是不是站点文件"
SITE_TOP_LEVEL = {"index.html", "css", "js", "assets"}


def find_token() -> str:
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
    """调用 GitHub API，带重试。"""
    url = API + path
    data = json.dumps(body).encode("utf-8") if body is not None else None

    for attempt in range(retries):
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Authorization", f"token {token}")
        req.add_header("Accept", "application/vnd.github+json")
        req.add_header("User-Agent", "dsh-clean-script")
        if data is not None:
            req.add_header("Content-Type", "application/json")

        try:
            with urllib.request.urlopen(req, timeout=90) as resp:
                raw = resp.read().decode("utf-8")
                return resp.status, (json.loads(raw) if raw else {})
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace")
            if exc.code == 404:
                return 404, {"message": "not found"}
            if exc.code == 409:  # 空仓库或引用冲突
                return 409, {"message": "conflict", "raw": raw}
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


def list_branch_root(token: str) -> list[dict]:
    """列出 gh-pages 分支根目录的内容。"""
    status, data = api_request("GET", f"/repos/{OWNER}/{REPO}/contents/?ref={BRANCH}", token)
    if status != 200 or not isinstance(data, list):
        raise SystemExit(f"取不到 {BRANCH} 分支内容：HTTP {status}")
    return data


def delete_entry(token: str, entry: dict) -> bool:
    """删除一个文件或目录（目录需要递归删）。"""
    name = entry["name"]
    path = entry["path"]

    if entry["type"] == "dir":
        # 递归取出目录里的所有文件再逐个删
        status, children = api_request(
            "GET", f"/repos/{OWNER}/{REPO}/contents/{quote(path, safe='/')}?ref={BRANCH}", token
        )
        if status != 200 or not isinstance(children, list):
            print(f"  FAIL {path}（读不到目录内容）")
            return False
        ok = True
        for child in children:
            if not delete_entry(token, child):
                ok = False
        return ok

    status, _ = api_request(
        "DELETE",
        f"/repos/{OWNER}/{REPO}/contents/{quote(path, safe='/')}",
        token,
        {"message": f"chore: 清理 gh-pages 上残留的源码文件（{path}）", "sha": entry["sha"], "branch": BRANCH},
    )
    if status == 200:
        print(f"  已删除 {path}")
        return True
    print(f"  FAIL {path}: HTTP {status}")
    return False


def trigger_rebuild(token: str) -> None:
    """在 gh-pages 上做一个空提交，触发 Pages 重新构建。

    为什么需要它：
        改了分支内容后 Pages 不一定立刻重建；而且如果上一次构建是
        在文件没传完时跑的（状态 errored），需要一个新提交把它顶掉。
    """
    status, data = api_request("GET", f"/repos/{OWNER}/{REPO}/git/ref/heads/{BRANCH}", token)
    if status != 200:
        print(f"取不到分支引用：HTTP {status}")
        return
    head_sha = data["object"]["sha"]

    # 取该提交的 tree
    status, commit = api_request("GET", f"/repos/{OWNER}/{REPO}/git/commits/{head_sha}", token)
    if status != 200:
        print("取不到提交信息")
        return
    tree_sha = commit["tree"]["sha"]

    # 建一个指向同一 tree 的新提交（内容不变，只是让分支前进一步）
    status, new_commit = api_request(
        "POST",
        f"/repos/{OWNER}/{REPO}/git/commits",
        token,
        {"message": "chore: 触发 GitHub Pages 重新构建", "tree": tree_sha, "parents": [head_sha]},
    )
    if status != 201:
        print(f"创建提交失败：HTTP {status} {new_commit.get('message', '')}")
        return
    new_sha = new_commit["sha"]

    status, _ = api_request(
        "PATCH",
        f"/repos/{OWNER}/{REPO}/git/refs/heads/{BRANCH}",
        token,
        {"sha": new_sha, "force": True},
    )
    if status == 200:
        print(f"已触发重建（新提交 {new_sha[:7]}）")
    else:
        print(f"更新分支引用失败：HTTP {status}")


def main() -> int:
    parser = argparse.ArgumentParser(description="清理 gh-pages 分支上的残留文件")
    parser.add_argument("--dry-run", action="store_true", help="只列出会删什么")
    args = parser.parse_args()

    token = find_token()
    entries = list_branch_root(token)

    print("=" * 62)
    print(f"{OWNER}/{REPO}  分支 {BRANCH}  根目录内容")
    print("=" * 62)

    to_delete: list[dict] = []
    to_keep: list[dict] = []

    for entry in entries:
        name = entry["name"]
        # 保留站点文件；其余（源码目录、文档等）删掉
        if name in KEEP:
            to_keep.append(entry)
        else:
            to_delete.append(entry)

    print("\n保留：")
    for entry in to_keep:
        print(f"  {entry['type']:<5} {entry['name']}")

    print("\n删除：")
    for entry in to_delete:
        print(f"  {entry['type']:<5} {entry['name']}")

    if args.dry_run:
        print("\n（dry-run，没有真正删除）")
        return 0

    if not to_delete:
        print("\n没有需要删除的内容")
    else:
        print("\n开始删除 ...")
        for entry in to_delete:
            delete_entry(token, entry)

    print("\n触发 GitHub Pages 重新构建 ...")
    trigger_rebuild(token)

    print()
    print("访问地址（等 1-2 分钟生效）：")
    print(f"  https://{OWNER}.github.io/{REPO}/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
