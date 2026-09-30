"""Set the back-end URL the front end connects to, rebuild the bundle, and (optionally) deploy to GitHub Pages.

Usage:
    # Same-origin deployment (recommended): the page and the API are served by the same service
    py -3.12 tools/set_backend_url.py --same-origin

    # Front end and back end deployed separately: specify the back-end URL
    py -3.12 tools/set_backend_url.py http://1.2.3.4:8000

    # Local development
    py -3.12 tools/set_backend_url.py http://127.0.0.1:8000

    # Also deploy to GitHub Pages
    py -3.12 tools/set_backend_url.py --same-origin --deploy

------------------------------------------------------------------
Why a script is needed instead of editing by hand
------------------------------------------------------------------

Changing the back-end URL touches **two or three places**, and skipping one leaves you with "changed but not in effect":

    1. src/js/config.js          -- the configuration source file
    2. src/js/bundle.js          -- must be rebuilt!
                                    the page loads this file, and the configuration is inlined at bundle time
    3. the artifact on gh-pages  -- if the front end is also published on GitHub Pages

    Doing only step 1 is the most common mistake: the source file is clearly changed, yet the page still
    talks to the old URL, and nothing in the interface gives it away (it only shows "cannot connect to the back-end service").
    This is easy to overlook, so it was made into a script.

------------------------------------------------------------------
About "same-origin deployment"
------------------------------------------------------------------

    If the back end also hosts the front-end pages via run.py --frontend-dir,
    then the page and the API live under **the same host and port**, and API_BASE_URL should be set to
    the **empty string** -- requests then go to /api/... (the host serving the current page).

    Benefits:
      - Instructors/TAs need only one link, and opening it shows the calculator
      - No cross-origin issues (no CORS needed)
      - It does not depend on GitHub Pages being reachable
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
    """Keep standard output from crashing because of encoding problems.

    Both the front end and the back end ran into this:
      The Windows console defaults to GBK, so printing characters like '✓' raises
      UnicodeEncodeError: 'gbk' codec can't encode character. The exception happens inside print,
      so it looks like "the script is buggy", when really the terminal encoding is wrong.

      Fix: set the errors mode of stdout/stderr to "replace" -- characters that cannot be encoded
      become '?', and no exception is ever raised.
    """
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            try:
                reconfigure(encoding="utf-8", errors="replace")
            except Exception:  # noqa: BLE001 - if it cannot be changed, functionality is unaffected
                pass


def run(cmd: list[str], label: str) -> None:
    """Run a command and exit on failure."""
    import os

    result = subprocess.run(
        cmd,
        cwd=PROJECT_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env={**os.environ, "PYTHONIOENCODING": "utf-8"},
    )
    output = ((result.stdout or "") + (result.stderr or "")).strip()
    if result.returncode != 0:
        print(f"✗ {label} failed:")
        print(output)
        sys.exit(1)
    print(f"✓ {label}")
    for line in output.splitlines():
        print(f"    {line}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Set the back-end URL the front end connects to",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  py -3.12 tools/set_backend_url.py --same-origin\n"
            "      Same-origin deployment: the page and the API share one address (recommended)\n"
            "  py -3.12 tools/set_backend_url.py http://1.2.3.4:8000\n"
            "      Front end on GitHub Pages, back end at the given address\n"
            "  py -3.12 tools/set_backend_url.py http://127.0.0.1:8000\n"
            "      Local development\n"
        ),
    )
    parser.add_argument("url", nargs="?", help="Back-end URL, e.g. http://1.2.3.4:8000 (no trailing slash)")
    parser.add_argument(
        "--same-origin",
        action="store_true",
        help="Set an empty string so requests go to the same-origin /api/... (for deployments where the back end also serves the front-end pages)",
    )
    parser.add_argument("--deploy", action="store_true", help="Also deploy to GitHub Pages")
    return parser


def main() -> int:
    make_console_robust()
    parser = build_parser()
    args = parser.parse_args()

    # ---- Decide the URL to write ----
    if args.same_origin:
        url = ""
    elif args.url is not None:
        url = args.url.strip().rstrip("/")
    else:
        parser.error("give a back-end URL, or use --same-origin")

    if url != "":
        if not re.match(r"^https?://", url):
            print("✗ the address must start with http:// or https://")
            return 1
        if "127.0.0.1" in url or "localhost" in url:
            print("Warning: this is a local address. On the public internet nobody can reach 127.0.0.1.")

    # ---- 1. Update config.js ----
    text = CONFIG_FILE.read_text(encoding="utf-8")
    pattern = re.compile(r"export const API_BASE_URL = '[^']*';")

    match = pattern.search(text)
    if not match:
        print("✗ could not find `export const API_BASE_URL = '...';` in config.js")
        print("  check that the file's shape has not changed.")
        return 1

    old_line = match.group(0)
    updated = pattern.sub(f"export const API_BASE_URL = '{url}';", text)
    CONFIG_FILE.write_bytes(updated.encode("utf-8"))

    print("✓ config.js updated")
    print(f"    old: {old_line}")
    print(f"    new: export const API_BASE_URL = '{url}';")
    if url == "":
        print("    (empty string = same origin: requests go to /api/... on the current page's host, so there is no cross-origin issue)")

    # ---- 2. Rebuild the bundle ----
    # Do not skip this: the page loads bundle.js, and the configuration is inlined in it
    run(["node", "tools/build-bundle.mjs"], "rebuild bundle.js")

    # ---- 3. Optional deploy ----
    if args.deploy:
        run([sys.executable, "tools/deploy_pages.py"], "deploy to GitHub Pages")
    else:
        print("(not deployed. Add --deploy to publish the page to GitHub Pages)")

    # ---- Wrap up ----
    print()
    print("=" * 62)
    print("Done")
    print("=" * 62)
    if url == "":
        print("  Deployment: same origin (the back end also serves the front-end pages)")
        print("  Instructor/TA access: http://<server address>/     ← this opens the calculator")
    else:
        print(f"  The front end will connect to: {url}")
        print(f"  Health check:  {url}/api/health")
        print("  GitHub Pages: https://qihangpeng580-ui.github.io/832401217_calculator_frontend/")
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
