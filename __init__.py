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


@routes.get("/snugui/parts")
async def get_parts(request):
    values = {f.stem: f.read_text(encoding="utf-8") for f in (PARTS_DIR / "values").glob("*.txt")}
    presets = {}
    for f in (PARTS_DIR / "presets").glob("*.json"):
        try:
            presets[f.stem] = json.loads(f.read_text(encoding="utf-8"))
        except ValueError:
            logging.warning("SnugUI: ignoring unreadable %s", f)
    return web.json_response({"values": values, "presets": presets}, headers=NO_CACHE)


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
