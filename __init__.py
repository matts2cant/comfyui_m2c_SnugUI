import json
import time
import uuid
from pathlib import Path

import folder_paths
from aiohttp import web
from server import PromptServer

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

ROOT = Path(__file__).resolve().parent
XR_DIR = ROOT / "xr"
SNAPSHOT_FILE = Path(folder_paths.get_user_directory()) / "appmode_xr" / "snapshot.json"
NO_CACHE = {"Cache-Control": "no-cache, no-store, must-revalidate"}

snapshot = None
if SNAPSHOT_FILE.is_file():
    try:
        snapshot = json.loads(SNAPSHOT_FILE.read_text(encoding="utf-8"))
    except ValueError:
        print(f"[appmode-xr] ignoring unreadable {SNAPSHOT_FILE}")

routes = PromptServer.instance.routes


def serve(path: Path):
    headers = dict(NO_CACHE)
    if path.suffix in (".js", ".mjs"):
        headers["Content-Type"] = "text/javascript"
    return web.FileResponse(path, headers=headers)


@routes.get("/appmode-xr")
async def xr_index(request):
    return serve(XR_DIR / "index.html")


@routes.get("/appmode-xr/static/{path:.*}")
async def xr_static(request):
    path = (XR_DIR / request.match_info["path"]).resolve()
    if not path.is_relative_to(XR_DIR) or not path.is_file():
        return web.Response(status=404)
    return serve(path)


@routes.post("/appmode-xr/snapshot")
async def post_snapshot(request):
    global snapshot
    body = await request.json()
    if not isinstance(body, dict):
        return web.json_response({"error": "snapshot must be an object"}, status=400)
    snapshot = {**body, "id": uuid.uuid4().hex, "created": int(time.time() * 1000)}
    SNAPSHOT_FILE.parent.mkdir(exist_ok=True)
    SNAPSHOT_FILE.write_text(json.dumps(snapshot), encoding="utf-8")
    PromptServer.instance.send_sync("appmode_xr_snapshot", {"id": snapshot["id"]})
    return web.json_response({"id": snapshot["id"]})


@routes.get("/appmode-xr/snapshot")
async def get_snapshot(request):
    if snapshot is None:
        return web.json_response({"error": "no snapshot"}, status=404, headers=NO_CACHE)
    return web.json_response(snapshot, headers=NO_CACHE)
