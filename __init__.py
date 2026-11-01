import json
import logging
import re
import shutil
import time
import uuid
from pathlib import Path

import folder_paths
from aiohttp import web
from server import PromptServer

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
WEB_DIRECTORY = "./web"
__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]

ROOT = Path(__file__).resolve().parent
APP_DIR = ROOT / "app"
SNAPSHOT_FILE = Path(folder_paths.get_user_directory()) / "snugui" / "snapshot.json"
NO_CACHE = {"Cache-Control": "no-cache, no-store, must-revalidate"}

# The JSON prompt's parts library: <models>/snugui/parts (Comfy Desktop's download_model_base when set), unless the user's
# extra_model_paths YAML has a snugui_parts entry, which comes first. Starter files missing from it are copied in at every start;
# existing files are never touched.
models_base = folder_paths.get_folder_paths("download_model_base")[0] if "download_model_base" in folder_paths.folder_names_and_paths else folder_paths.models_dir
folder_paths.add_model_folder_path("snugui_parts", str(Path(models_base) / "snugui" / "parts"))
PARTS_DIR = Path(folder_paths.get_folder_paths("snugui_parts")[0]).resolve()
PARTS_FILES = {"values": ".txt", "fragments": ".txt", "presets": ".json"}
PARTS_NAME = re.compile(r"[\w-]+(\.[\w-]+)*")
PROMPTS_DIR = PARTS_DIR / "prompts"
# saved prompts: <folder>/…/<name>.json or .txt under prompts/, each name words joined by single spaces or dots
PROMPT_FOLDER = re.compile(r"[\w-]+([ .][\w-]+)*(/[\w-]+([ .][\w-]+)*)*")
PROMPT_PATH = re.compile(PROMPT_FOLDER.pattern + r"\.(json|txt)")
STARTER_DIR = APP_DIR / "prompt" / "parts"
for src in STARTER_DIR.rglob("*"):
    dst = PARTS_DIR / src.relative_to(STARTER_DIR)
    if src.is_file() and not dst.exists():
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)

snapshot = None
if SNAPSHOT_FILE.is_file():
    try:
        snapshot = json.loads(SNAPSHOT_FILE.read_text(encoding="utf-8"))
    except ValueError:
        logging.warning("SnugUI: ignoring unreadable %s", SNAPSHOT_FILE)

routes = PromptServer.instance.routes


def serve(path: Path):
    headers = dict(NO_CACHE)
    if path.suffix in (".js", ".mjs"):
        headers["Content-Type"] = "text/javascript"
    return web.FileResponse(path, headers=headers)


@routes.get("/snugui")
async def app_index(request):
    return serve(APP_DIR / "index.html")


@routes.get("/snugui/static/{path:.*}")
async def app_static(request):
    path = (APP_DIR / request.match_info["path"]).resolve()
    if not path.is_relative_to(APP_DIR) or not path.is_file():
        return web.Response(status=404)
    return serve(path)


@routes.post("/snugui/snapshot")
async def post_snapshot(request):
    global snapshot
    body = await request.json()
    if not isinstance(body, dict):
        return web.json_response({"error": "snapshot must be an object"}, status=400)
    snapshot = {**body, "id": uuid.uuid4().hex, "created": int(time.time() * 1000)}
    SNAPSHOT_FILE.parent.mkdir(exist_ok=True)
    SNAPSHOT_FILE.write_text(json.dumps(snapshot), encoding="utf-8")
    PromptServer.instance.send_sync("snugui_snapshot", {"id": snapshot["id"]})
    return web.json_response({"id": snapshot["id"]})


@routes.get("/snugui/snapshot")
async def get_snapshot(request):
    if snapshot is None:
        return web.json_response({"error": "no snapshot"}, status=404, headers=NO_CACHE)
    return web.json_response(snapshot, headers=NO_CACHE)




# a file's modification time as the page compares it (µs: exact in a JS number)
def stamp(path: Path):
    return path.stat().st_mtime_ns // 1000


# The whole library, with every file's mtime keyed "<kind>/<name>" ("prompts/<path>" for a saved prompt), which the page sends
# back with a whole-file write. The saved prompts by their path under prompts/, with every folder, empty ones too.
def library():
    lib = {"values": {}, "fragments": {}, "presets": {}, "prompts": {}, "folders": [], "mtimes": {}}

    def add(kind, name, f):
        try:
            text = f.read_text(encoding="utf-8")
            lib[kind][name] = json.loads(text) if kind == "presets" else text
            lib["mtimes"][f"{kind}/{name}"] = stamp(f)
        except ValueError:
            logging.warning("SnugUI: ignoring unreadable %s", f)

    for kind, ext in PARTS_FILES.items():
        for f in (PARTS_DIR / kind).glob("*" + ext):
            add(kind, f.stem, f)
    for f in sorted(PROMPTS_DIR.rglob("*")):
        name = f.relative_to(PROMPTS_DIR).as_posix()
        if f.is_dir() and PROMPT_FOLDER.fullmatch(name):
            lib["folders"].append(name)
        elif f.is_file() and PROMPT_PATH.fullmatch(name):
            add("prompts", name, f)
    return lib


@routes.get("/snugui/parts")
async def get_parts(request):
    return web.json_response(library(), headers=NO_CACHE)


def error(cls, text):
    return cls(text=json.dumps({"error": text}), content_type="application/json")


def conflict(text):
    return error(web.HTTPConflict, text)


# the file (or saved prompts folder) a library edit names, inside its kind's folder; None when invalid
def target(kind, name):
    if not isinstance(name, str):
        return None
    if kind in PARTS_FILES and PARTS_NAME.fullmatch(name):
        root, path = PARTS_DIR / kind, PARTS_DIR / kind / (name + PARTS_FILES[kind])
    elif kind == "prompts" and PROMPT_FOLDER.fullmatch(name):
        root, path = PROMPTS_DIR, PROMPTS_DIR / name
    else:
        return None
    path = path.resolve()
    return path if path.is_relative_to(root) and path != root else None


# a part or a group name as its line holds it
def is_line(v):
    return isinstance(v, str) and v == v.strip() and "\n" not in v and "\r" not in v


# a part (or a new group name): a line that does not read back as a group
def is_part(v):
    return is_line(v) and v != "" and not v.startswith("#")


# A line edit on a value or fragment file as it is on disk now. A group's lines run from its "# Group" line to the next one ("" = the
# lines before the first); a new part goes after its group's last one, a new group at the end. Refused (409) when the part or group
# it changes is not there any more.
def edit_lines(lines, op, group, text, to):
    def span(g):
        heads = [i for i, line in enumerate(lines) if line.strip().startswith("#")]
        if not g:
            return 0, heads[0] if heads else len(lines)
        for k, i in enumerate(heads):
            if lines[i].strip()[1:].strip() == g:
                return i + 1, heads[k + 1] if k + 1 < len(heads) else len(lines)
        return None

    def add(g, part):
        s = span(g)
        if s is None:
            lines.extend(["# " + g, part])
        else:
            lines.insert(max((j + 1 for j in range(*s) if lines[j].strip()), default=s[0]), part)

    if op == "add":
        return add(group, text)
    s = span(group)
    if op == "add-group":
        if s is None:
            lines.append("# " + group)
        return
    if s is None:
        raise conflict(f"group {group} is not there any more")
    if op == "rename-group":
        lines[s[0] - 1] = "# " + to
        return
    if op == "delete-group":
        del lines[s[0] - 1 if group else 0:s[1]]
        return
    j = next((j for j in range(*s) if lines[j].strip() == text), None)
    if j is None:
        raise conflict(f"{text} is not there any more")
    if op == "rename":
        lines[j] = to
    else:
        del lines[j]
        if op == "move":
            add(to, text)


# presets/<type>.json: set { key, value } adds or replaces one, rename { key, to }, delete { key }
def edit_presets(presets, op, key, to, value):
    if op == "set":
        presets[key] = value
        return presets
    if key not in presets:
        raise conflict(f"{key} is not there any more")
    if op == "delete":
        del presets[key]
        return presets
    if to in presets:
        raise conflict(f"{to} already exists")
    return {to if k == key else k: v for k, v in presets.items()}


LINE_OPS = {"add", "add-group", "rename", "delete", "move", "rename-group", "delete-group"}
OPS = {
    "values": {"write", "rename-file", "delete-file", *LINE_OPS},
    "fragments": {"write", "rename-file", "delete-file", *LINE_OPS},
    "presets": {"set", "rename", "delete"},
    "prompts": {"write", "rename-file", "delete-file", "mkdir"},
}


# One library edit { kind, name, op, … } on the file as it is on disk, answered with the whole library (GET's). Line and preset
# edits are applied by the server to the current file; a whole-file write carries the file's mtime as the page read it and is
# refused (409) when the file changed since; without an mtime it only creates a file. A refused edit answers 409 { error }.
@routes.post("/snugui/parts/edit")
async def edit_parts(request):
    body = await request.json()
    kind, name, op, mtime = body.get("kind"), body.get("name"), body.get("op"), body.get("mtime")
    path = target(kind, name)
    if path is None or op not in OPS.get(kind, ()):
        raise error(web.HTTPBadRequest, f"invalid library edit {kind} {name} {op}")
    bad = error(web.HTTPBadRequest, f"invalid {op} of {kind} {name}")
    if mtime is not None and (not path.is_file() or stamp(path) != mtime):
        raise conflict(f"{name} changed on disk")
    if op == "write":
        if not isinstance(body.get("text"), str) or kind == "prompts" and not PROMPT_PATH.fullmatch(name):
            raise bad
        if mtime is None and path.exists():
            raise conflict(f"{name} already exists")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body["text"], encoding="utf-8")
    elif op == "rename-file":
        to = body.get("to")
        dest = target(kind, to)
        if dest is None or dest.is_relative_to(path) or kind == "prompts" and path.is_file() and not PROMPT_PATH.fullmatch(to):
            raise bad
        if not path.exists():
            raise conflict(f"{name} is not there any more")
        if dest.exists():
            raise conflict(f"{to} already exists")
        dest.parent.mkdir(parents=True, exist_ok=True)
        path.rename(dest)
    elif op == "delete-file":
        if not path.exists():
            raise conflict(f"{name} is not there any more")
        if path.is_file():
            path.unlink()
        elif any(path.iterdir()) and not body.get("recursive"):
            raise conflict(f"{name} is not empty")
        else:
            shutil.rmtree(path)
    elif op == "mkdir":
        if path.exists():
            raise conflict(f"{name} already exists")
        path.mkdir(parents=True)
    elif kind == "presets":
        key, to, value = body.get("key"), body.get("to"), body.get("value")
        if not (key and isinstance(key, str)) or op == "set" and not isinstance(value, dict) or op == "rename" and not (to and isinstance(to, str)):
            raise bad
        presets = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}
        presets = edit_presets(presets, op, key, to, value)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(presets, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    else:
        group, text, to = body.get("group", ""), body.get("text"), body.get("to")
        if not is_line(group) or op in ("add", "rename", "delete", "move") and not is_part(text) or op == "rename" and not is_part(to) \
                or op == "move" and not is_line(to) or op == "rename-group" and not (group and is_part(to)):
            raise bad
        lines = path.read_text(encoding="utf-8").splitlines() if path.is_file() else []
        edit_lines(lines, op, group, text, to)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("".join(line + "\n" for line in lines), encoding="utf-8")
    return web.json_response(library(), headers=NO_CACHE)
