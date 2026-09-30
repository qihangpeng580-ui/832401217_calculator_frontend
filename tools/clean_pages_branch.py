"""Remove leftover files on the gh-pages branch and trigger a clean Pages rebuild.

------------------------------------------------------------------
Why this script is needed
------------------------------------------------------------------

The gh-pages branch is derived from main (because the Contents API requires the target branch to already exist),
so it starts out **carrying all of main's contents** -- src/, tools/, docs/, README.md, and so on.

The deploy script only **adds** site files (index.html, css/, js/, assets/),
leaving the old source directories untouched. The result:

    gh-pages branch root = site files + a pile of unused source code

Two consequences:
    1. Not clean enough -- a TA browsing the gh-pages branch would see a pile of duplicated content;
    2. It can interfere with the build -- with both src/ and a root-level index.html on the branch,
       it is hard to tell which one is the site.

This script deletes **everything on gh-pages except the site files**,
then makes an empty commit to trigger a Pages rebuild.

Usage:
    py -3.12 tools/clean_pages_branch.py --dry-run    Preview what would be deleted
    py -3.12 tools/clean_pages_branch.py              Actually delete
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

# Files/directories the site needs -- these must be kept
KEEP = {"index.html", "css", "js", "assets", "test", ".nojekyll"}

# Actual source of the site files (from src/), used as a fallback to decide whether a name is a site file
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
    raise SystemExit("GitHub token not found")


def api_request(method: str, path: str, token: str, body: dict | None = None, retries: int = 4):
    """Call the GitHub API with retries."""
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
            if exc.code == 409:  # empty repository or ref conflict
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

    raise RuntimeError("request failed")


def list_branch_root(token: str) -> list[dict]:
    """List the contents of the gh-pages branch root."""
    status, data = api_request("GET", f"/repos/{OWNER}/{REPO}/contents/?ref={BRANCH}", token)
    if status != 200 or not isinstance(data, list):
        raise SystemExit(f"cannot fetch the contents of branch {BRANCH}: HTTP {status}")
    return data


def delete_entry(token: str, entry: dict) -> bool:
    """Delete a file or directory (directories must be deleted recursively)."""
    name = entry["name"]
    path = entry["path"]

    if entry["type"] == "dir":
        # Recursively fetch every file in the directory, then delete them one by one
        status, children = api_request(
            "GET", f"/repos/{OWNER}/{REPO}/contents/{quote(path, safe='/')}?ref={BRANCH}", token
        )
        if status != 200 or not isinstance(children, list):
            print(f"  FAIL {path} (cannot read the directory contents)")
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
        {"message": f"chore: clean up leftover source files on gh-pages ({path})", "sha": entry["sha"], "branch": BRANCH},
    )
    if status == 200:
        print(f"  deleted {path}")
        return True
    print(f"  FAIL {path}: HTTP {status}")
    return False


def trigger_rebuild(token: str) -> None:
    """Make an empty commit on gh-pages to trigger a Pages rebuild.

    Why it is needed:
        Pages does not necessarily rebuild immediately after the branch contents change; and if the last build
        ran before the files finished uploading (status errored), a new commit is needed to supersede it.
    """
    status, data = api_request("GET", f"/repos/{OWNER}/{REPO}/git/ref/heads/{BRANCH}", token)
    if status != 200:
        print(f"cannot fetch the branch ref: HTTP {status}")
        return
    head_sha = data["object"]["sha"]

    # Fetch the tree of that commit
    status, commit = api_request("GET", f"/repos/{OWNER}/{REPO}/git/commits/{head_sha}", token)
    if status != 200:
        print("cannot fetch the commit information")
        return
    tree_sha = commit["tree"]["sha"]

    # Create a new commit pointing at the same tree (contents unchanged, the branch just advances one step)
    status, new_commit = api_request(
        "POST",
        f"/repos/{OWNER}/{REPO}/git/commits",
        token,
        {"message": "chore: trigger a GitHub Pages rebuild", "tree": tree_sha, "parents": [head_sha]},
    )
    if status != 201:
        print(f"failed to create the commit: HTTP {status} {new_commit.get('message', '')}")
        return
    new_sha = new_commit["sha"]

    status, _ = api_request(
        "PATCH",
        f"/repos/{OWNER}/{REPO}/git/refs/heads/{BRANCH}",
        token,
        {"sha": new_sha, "force": True},
    )
    if status == 200:
        print(f"rebuild triggered (new commit {new_sha[:7]})")
    else:
        print(f"failed to update the branch ref: HTTP {status}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Remove leftover files from the gh-pages branch")
    parser.add_argument("--dry-run", action="store_true", help="Only list what would be deleted")
    args = parser.parse_args()

    token = find_token()
    entries = list_branch_root(token)

    print("=" * 62)
    print(f"{OWNER}/{REPO}  branch {BRANCH}  root contents")
    print("=" * 62)

    to_delete: list[dict] = []
    to_keep: list[dict] = []

    for entry in entries:
        name = entry["name"]
        # Keep site files; delete everything else (source directories, docs, and so on)
        if name in KEEP:
            to_keep.append(entry)
        else:
            to_delete.append(entry)

    print("\nKeep:")
    for entry in to_keep:
        print(f"  {entry['type']:<5} {entry['name']}")

    print("\nDelete:")
    for entry in to_delete:
        print(f"  {entry['type']:<5} {entry['name']}")

    if args.dry_run:
        print("\n(dry run, nothing was actually deleted)")
        return 0

    if not to_delete:
        print("\nnothing to delete")
    else:
        print("\nDeleting ...")
        for entry in to_delete:
            delete_entry(token, entry)

    print("\nTriggering a GitHub Pages rebuild ...")
    trigger_rebuild(token)

    print()
    print("URL (allow 1-2 minutes to take effect):")
    print(f"  https://{OWNER}.github.io/{REPO}/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
