"""Syntax checks of the whole package, no browser or ComfyUI needed: every page module and web/snugui.js with Node (Comfy Desktop's
Electron run as Node: ELECTRON_RUN_AS_NODE=1, without which it starts the Desktop app), __init__.py, and every JSON file under app/.
Run it with the ComfyUI venv's Python: check.py <scratch>
"""
import json
import os
import py_compile
import shutil
import subprocess
import sys
from pathlib import Path

from sandbox import PACKAGE

ELECTRON = Path(os.environ["LOCALAPPDATA"]) / "Programs" / "@comfyorgcomfyui-electron" / "ComfyUI.exe"


def main(scratch):
    failed = []
    # node --check takes a .js file for CommonJS: copies named .mjs are checked as the ES modules they are
    copies = Path(scratch).resolve() / "snugui-sandbox" / "check"
    shutil.rmtree(copies, ignore_errors=True)
    for src in [*sorted((PACKAGE / "app" / "js").rglob("*.js")), PACKAGE / "web" / "snugui.js"]:
        rel = src.relative_to(PACKAGE)
        dst = copies / rel.with_suffix(".mjs")
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
        r = subprocess.run([str(ELECTRON), "--check", str(dst)], env={**os.environ, "ELECTRON_RUN_AS_NODE": "1"}, capture_output=True, text=True)
        if r.returncode:
            failed.append(f"{rel}\n{r.stderr.strip()}")
    try:
        py_compile.compile(str(PACKAGE / "__init__.py"), doraise=True, cfile=str(copies / "__init__.pyc"))
    except py_compile.PyCompileError as e:
        failed.append(str(e))
    for src in sorted((PACKAGE / "app").rglob("*.json")):
        try:
            json.loads(src.read_text(encoding="utf-8"))
        except ValueError as e:
            failed.append(f"{src.relative_to(PACKAGE)}: {e}")
    print("\n\n".join(failed) or "all OK")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main(sys.argv[1])
