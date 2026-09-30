"""Publish the front end to GitHub Pages.

Usage:
    py -3.12 tools/deploy_pages.py                Publish
    py -3.12 tools/deploy_pages.py --dry-run      Only show what would be published

------------------------------------------------------------------
Why this script is needed (you cannot push src/ directly)
------------------------------------------------------------------

GitHub Pages can only serve files from the **repository root** or the **/docs directory**,
while our front end lives under src/ and index.html uses relative paths:

    <link rel="stylesheet" href="css/style.css">
    <script src="js/bundle.js"></script>
    <img src="assets/nailong.png">

So the **contents** of src/ (not the src directory itself) must go to the site root,
becoming:

    index.html          <- from src/index.html
    css/style.css       <- the relative paths line up exactly
    js/bundle.js
    assets/nailong.png

That way the relative paths need no changes at all, and the source needs no compromises for deployment.

------------------------------------------------------------------
Where it is deployed
------------------------------------------------------------------

Published to the `gh-pages` branch. This keeps main in a clean "source" state,
while the gh-pages branch holds the "build artifacts".

The URL looks like:
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

# Files that must not be published
SKIP_NAMES = {".DS_Store", "Thumbs.db"}
SKIP_SUFFIXES = {".md", ".pyc"}


def find_token() -> str:
    """Find the GitHub token (same strategy as push_via_api.py)."""
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
    """Call the GitHub API with retries (for occasional network interruptions)."""
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
            # A 404 is a normal result when checking whether a branch exists, so do not retry
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

    raise RuntimeError("request failed")


def collect_site_files() -> list[tuple[str, bytes]]:
    """Collect the files to publish and return [(deploy path, content)].

    Deploy path rule: files under src/ with the src/ prefix stripped.
    """
    files: list[tuple[str, bytes]] = []

    for path in sorted(SRC_DIR.rglob("*")):
        if not path.is_file():
            continue
        if path.name in SKIP_NAMES or path.suffix in SKIP_SUFFIXES:
            continue

        # Strip the src/ prefix -- this is the key step that keeps the relative paths valid
        deploy_path = path.relative_to(SRC_DIR).as_posix()
        files.append((deploy_path, path.read_bytes()))

    # .nojekyll: tells GitHub Pages not to process these files with Jekyll.
    # Without it, files whose names start with an underscore are ignored by Jekyll.
    files.append((".nojekyll", b""))

    return files


def ensure_branch(token: str) -> None:
    """Ensure the gh-pages branch exists; if not, derive one from main.

    A problem encountered before:
      At first we assumed "writing a file to a branch that does not exist makes the Contents API create it" --
      in fact it returns 404 (not 422, which is easy to misread as "the file does not exist").
      GitHub's Contents API requires the target branch to **already exist**.

      So the correct approach is: first use the refs API to derive a new branch from main's latest commit,
      then write files into it.
    """
    status, _ = api_request("GET", f"/repos/{OWNER}/{REPO}/branches/{BRANCH}", token)
    if status == 200:
        print(f"branch {BRANCH} already exists")
        return

    # Fetch the latest commit sha of main
    status, data = api_request("GET", f"/repos/{OWNER}/{REPO}/git/ref/heads/main", token)
    if status != 200:
        raise SystemExit(f"cannot fetch the main branch commit: HTTP {status} {data.get('message', '')}")

    main_sha = data["object"]["sha"]

    # Create the gh-pages branch from that commit
    status, data = api_request(
        "POST",
        f"/repos/{OWNER}/{REPO}/git/refs",
        token,
        {"ref": f"refs/heads/{BRANCH}", "sha": main_sha},
    )

    if status == 201:
        print(f"created branch {BRANCH} from main ({main_sha[:7]})")
    else:
        raise SystemExit(f"failed to create the branch: HTTP {status} {data.get('message', '')}")


def get_remote_state(token: str, deploy_path: str) -> tuple[str | None, bytes | None]:
    """Fetch the remote file state (used to skip unchanged files)."""
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
    parser = argparse.ArgumentParser(description="Publish the front end to GitHub Pages")
    parser.add_argument("--dry-run", action="store_true", help="Only list the files that would be published")
    args = parser.parse_args()

    files = collect_site_files()

    print("=" * 62)
    print("Publishing the front end to GitHub Pages")
    print("=" * 62)
    print(f"Source directory: {SRC_DIR}")
    print(f"Target:  {OWNER}/{REPO}  branch {BRANCH}")
    print(f"Files: {len(files)}")
    print()

    for deploy_path, content in files:
        print(f"  {deploy_path:<34} {len(content):>8} bytes")

    if args.dry_run:
        print("\n(dry run, nothing was actually published)")
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
            print(f"  --   {deploy_path} (unchanged, skipped)")
            continue

        body: dict = {
            "message": f"deploy: publish the front end to GitHub Pages ({deploy_path})",
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
    print(f"Published {published}, skipped {unchanged}, failed {len(failed)}")
    print()
    print("URL (allow 1-2 minutes after the first publish):")
    print(f"  https://{OWNER}.github.io/{REPO}/")

    if failed:
        print("\nFailures:")
        for item in failed:
            print("  " + item)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
