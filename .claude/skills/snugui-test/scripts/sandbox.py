"""A throwaway ComfyUI for testing SnugUI: 127.0.0.1 only, CPU only, SnugUI the only custom node, and every folder ComfyUI writes
(user, output, input, models, temp) under <scratch>/snugui-sandbox, so the owner's snapshot, outputs and parts library are never
touched. Run it with the ComfyUI venv's Python:

    sandbox.py start <scratch> [--port 8189]    start it and wait until /snugui answers
    sandbox.py status <scratch>
    sandbox.py snapshot <scratch> <fixture>     POST fixtures/<fixture>.json as the snapshot (before opening the page)
    sandbox.py stop <scratch>                   stop the instance started from this scratch folder, by its PID
"""
import argparse
import json
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import psutil

SKILL = Path(__file__).resolve().parent.parent
PACKAGE = SKILL.parent.parent.parent
COMFY = PACKAGE.parent.parent
OWNER_PORT = 8000


def base_dir(scratch):
    return Path(scratch).resolve() / "snugui-sandbox"


def load_state(base):
    try:
        return json.loads((base / "sandbox.json").read_text())
    except FileNotFoundError:
        return None


# the sandbox's process, only if it is still the ComfyUI this scratch folder started (a PID can be reused)
def sandbox_process(base, state):
    try:
        proc = psutil.Process(state["pid"])
        cmd = proc.cmdline()
    except psutil.Error:
        return None
    return proc if "main.py" in cmd and str(base / "user") in cmd and str(state["port"]) in cmd else None


def url(state, path):
    return f"http://127.0.0.1:{state['port']}{path}"


def start(scratch, port):
    if port == OWNER_PORT:
        sys.exit(f"port {OWNER_PORT} is the owner's ComfyUI: never use it")
    base = base_dir(scratch)
    state = load_state(base)
    if state and sandbox_process(base, state):
        sys.exit(f"already running: PID {state['pid']}, {url(state, '/snugui')}")
    with socket.socket() as s:
        if s.connect_ex(("127.0.0.1", port)) == 0:
            sys.exit(f"port {port} is in use by another process")
    dirs = {name: base / name for name in ("user", "output", "input", "models", "temp")}
    for d in dirs.values():
        d.mkdir(parents=True, exist_ok=True)
    log = open(base / "comfy.log", "w", encoding="utf-8")
    proc = subprocess.Popen([sys.executable, "main.py", "--port", str(port), "--listen", "127.0.0.1", "--cpu",
                             "--disable-all-custom-nodes", "--whitelist-custom-nodes", PACKAGE.name,
                             "--user-directory", str(dirs["user"]), "--output-directory", str(dirs["output"]),
                             "--input-directory", str(dirs["input"]), "--models-directory", str(dirs["models"]),
                             "--temp-directory", str(dirs["temp"])],
                            cwd=COMFY, stdout=log, stderr=subprocess.STDOUT, creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)
    state = {"pid": proc.pid, "port": port}
    (base / "sandbox.json").write_text(json.dumps(state))
    deadline = time.time() + 180
    while time.time() < deadline:
        if proc.poll() is not None:
            sys.exit(f"ComfyUI exited ({proc.returncode}); log: {base / 'comfy.log'}\n" + (base / "comfy.log").read_text(encoding="utf-8")[-3000:])
        try:
            urllib.request.urlopen(url(state, "/snugui/parts"), timeout=2).read()
            break
        except OSError:
            time.sleep(1)
    else:
        sys.exit(f"no answer after 180 s; log: {base / 'comfy.log'}")
    parts = dirs["models"] / "snugui" / "parts"
    if not parts.is_dir():
        sys.exit(f"the parts library is not in the sandbox ({parts} missing): stop it and check before testing the Library")
    print(f"PID {proc.pid}  {url(state, '/snugui')}\nparts library: {parts}\nlog: {base / 'comfy.log'}")


def status(scratch):
    base = base_dir(scratch)
    state = load_state(base)
    if not state or not sandbox_process(base, state):
        print("not running")
        return
    print(f"PID {state['pid']}  {url(state, '/snugui')}\nparts library: {base / 'models' / 'snugui' / 'parts'}\nlog: {base / 'comfy.log'}")


def snapshot(scratch, fixture):
    state = load_state(base_dir(scratch))
    if not state:
        sys.exit("not running")
    body = (SKILL / "fixtures" / f"{fixture}.json").read_bytes()
    req = urllib.request.Request(url(state, "/snugui/snapshot"), body, {"Content-Type": "application/json"})
    print(urllib.request.urlopen(req).read().decode())


def stop(scratch):
    base = base_dir(scratch)
    state = load_state(base)
    proc = state and sandbox_process(base, state)
    if not proc:
        print("not running")
    else:
        for p in proc.children(recursive=True) + [proc]:
            p.kill()
        psutil.wait_procs([proc], timeout=10)
        print(f"stopped PID {state['pid']}")
    (base / "sandbox.json").unlink(missing_ok=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["start", "status", "snapshot", "stop"])
    ap.add_argument("scratch")
    ap.add_argument("fixture", nargs="?")
    ap.add_argument("--port", type=int, default=8189)
    a = ap.parse_args()
    if a.command == "start":
        start(a.scratch, a.port)
    elif a.command == "snapshot":
        snapshot(a.scratch, a.fixture or ap.error("snapshot needs a fixture name"))
    else:
        {"status": status, "stop": stop}[a.command](a.scratch)
