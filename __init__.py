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
PARTS_FILES = {"values": ".txt", "presets": ".json"}
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


# the whole library: the saved prompts by their path under prompts/ (with every folder, empty ones too) and their mtimes, keyed
# "prompts/<path>"
def library():
    values, fragments = ({f.stem: f.read_text(encoding="utf-8") for f in (PARTS_DIR / kind).glob("*.txt")} for kind in ("values", "fragments"))
    presets, prompts, folders, mtimes = {}, {}, [], {}
    for f in (PARTS_DIR / "presets").glob("*.json"):
        try:
            presets[f.stem] = json.loads(f.read_text(encoding="utf-8"))
        except ValueError:
            logging.warning("SnugUI: ignoring unreadable %s", f)
    for f in sorted(PROMPTS_DIR.rglob("*")):
        name = f.relative_to(PROMPTS_DIR).as_posix()
        if f.is_dir():
            if PROMPT_FOLDER.fullmatch(name):
                folders.append(name)
        elif PROMPT_PATH.fullmatch(name):
            try:
                prompts[name] = f.read_text(encoding="utf-8")
                mtimes["prompts/" + name] = stamp(f)
            except ValueError:
                logging.warning("SnugUI: ignoring unreadable %s", f)
    return {"values": values, "fragments": fragments, "presets": presets, "prompts": prompts, "folders": folders, "mtimes": mtimes}


@routes.get("/snugui/parts")
async def get_parts(request):
    return web.json_response(library(), headers=NO_CACHE)


# One library edit, { kind, name, op, … }, answered with the whole library. write { text, mtime? } replaces a saved prompt only when
# mtime is its current one, and creates one only without mtime (409 otherwise: changed on disk, or already there).
@routes.post("/snugui/parts/edit")
async def edit_parts(request):
    body = await request.json()
    kind, name, op = body.get("kind"), body.get("name"), body.get("op")
    path = (PROMPTS_DIR / name).resolve() if kind == "prompts" and isinstance(name, str) and PROMPT_PATH.fullmatch(name) else None
    if not path or not path.is_relative_to(PROMPTS_DIR) or op != "write" or not isinstance(body.get("text"), str):
        return web.json_response({"error": f"invalid library edit {kind} {name} {op}"}, status=400)
    mtime = body.get("mtime")
    if mtime is None and path.exists():
        return web.json_response({"error": f"{name} already exists"}, status=409)
    if mtime is not None and (not path.is_file() or stamp(path) != mtime):
        return web.json_response({"error": f"{name} changed on disk"}, status=409)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body["text"], encoding="utf-8")
    return web.json_response(library(), headers=NO_CACHE)


# one library file: values/<field key>.txt (the body is its text) or presets/<type>.json (the body is its JSON object)
@routes.post("/snugui/parts/{kind}/{name}")
async def post_parts(request):
    kind, name = request.match_info["kind"], request.match_info["name"]
    if kind not in PARTS_FILES or not PARTS_NAME.fullmatch(name):
        return web.json_response({"error": f"invalid parts file name {kind}/{name}"}, status=400)
    path = (PARTS_DIR / kind / (name + PARTS_FILES[kind])).resolve()
    if not path.is_relative_to(PARTS_DIR):
        return web.json_response({"error": f"invalid parts file name {kind}/{name}"}, status=400)
    if kind == "values":
        text = await request.text()
    else:
        body = await request.json()
        if not isinstance(body, dict):
            return web.json_response({"error": "presets must be an object"}, status=400)
        text = json.dumps(body, indent=2, ensure_ascii=False) + "\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return web.json_response({})
