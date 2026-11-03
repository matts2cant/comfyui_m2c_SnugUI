"""Headless Edge over CDP on the sandbox started by sandbox.py: a fresh profile under <scratch>/snugui-sandbox, the LoRA Manager
API mocked (generic fake LoRAs, generated thumbnails, so the owner's library can never show), the page's errors collected, and
page-side helpers (window.__t) to find panels and widgets and turn their positions into page coordinates.

    import asyncio, sys
    sys.path.insert(0, r"<this folder>")
    from browser import Browser

    async def main():
        async with Browser(r"<scratch>") as b:
            page = await b.open("phone")             # desktop | phone | landscape | vr (the VR-like view)
            await page.tap(*await page.js("__t.tab('pencil')"))
            print(await page.shot("prompt"))         # the PNG's path, under <scratch>/snugui-sandbox/shots
            assert not page.errors, page.errors

    asyncio.run(main())
"""
import asyncio
import base64
import io
import json
import math
import shutil
import subprocess
import urllib.parse
from pathlib import Path

import aiohttp
import psutil
from PIL import Image, ImageDraw

from sandbox import base_dir, load_state

EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
CDP_PORT = 9333

# width, height (CSS px), mobile (touch), device scale, query
VIEWS = {
    "desktop": (1600, 1000, False, 1, ""),
    "phone": (390, 844, True, 2, ""),
    "landscape": (844, 390, True, 2, ""),
    "vr": (1600, 1000, False, 1, "?view=vr"),
}

NAMES = ["Watercolor Wash", "Paper Cutout", "Neon Glow", "Pixel Art", "Fennec Mascot", "Ink Sketch", "Soft Pastel", "Clay Render",
         "Golden Hour", "Retro Poster", "Low Poly", "Stained Glass", "Oil Painting", "Chalk Board", "Origami", "Isometric Room",
         "Foggy Forest", "Comic Halftone", "Glass Marbles", "Cozy Knit", "Desert Dunes", "Paper Lantern", "Snow Globe", "Moss Garden",
         "Brass Gears", "Velvet Night", "Candy Colors", "Sunlit Window", "Blueprint", "Mosaic Tiles"]
BASES = ["SDXL 1.0", "Flux.1 D", "SD 1.5", "Illustrious", ""]


# a LoRA Manager list item; every 4th one has its optional fields empty, every 5th no preview
def lora_item(i):
    name = NAMES[i % len(NAMES)]
    full = i % 4 != 3
    return {
        "file_name": name.lower().replace(" ", "_") + ("_v2" if i % 3 == 0 else ""),
        "model_name": name if full or i % 8 != 7 else "",
        "folder": ["styles", "styles/paint", "", "characters/mascots"][i % 4],
        "base_model": BASES[i % len(BASES)] if full else "",
        "usage_tips": json.dumps({"strength": 0.8, "clipStrength": 0.6} if i % 2 else {"strength": 0.7}) if full else "",
        "civitai": {"trainedWords": [name.lower().split()[0] + "_style", "soft light"] + (["paper texture", "gentle colors", "film grain"] if i % 6 == 0 else [])} if full else {},
        "tags": ["style", "illustration", "colorful", "demo", "generic"][: 2 + i % 4] if full else [],
        "file_size": 18874368 + i * 7340032 if full else 0,
        "notes": ("A generic test LoRA. " * (1 + i % 5)).strip() if full and i % 2 == 0 else "",
        "preview_url": f"/loras_static/images/mock/{i}.png" if i % 5 != 4 else "",
    }


LORAS = [lora_item(i) for i in range(30)]


def thumbnail(i):
    img = Image.new("RGB", (256, 256), tuple(int(127 + 100 * math.sin(i * 0.9 + k * 2.1)) for k in range(3)))
    ImageDraw.Draw(img).ellipse([64, 64, 192, 192], fill=(240, 240, 240))
    b = io.BytesIO()
    img.save(b, "PNG")
    return b.getvalue()


def lora_list(url):
    q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(url).query))
    size, page = int(q.get("page_size", 20)), int(q.get("page", 1))
    return {"items": LORAS[(page - 1) * size: page * size], "total": len(LORAS), "page": page, "page_size": size,
            "total_pages": max(1, math.ceil(len(LORAS) / size))}


# window.__t: panel(name) (prompt, library, gallery, right = LoRA, lights, left = Input, config, toolbar, tabs = the phone's tab
# bar...), widgets(panel) (nested ones too), find(predicate) over every panel, at(panel, x, y) (panel px -> page px: the canvas in
# a DOM window, or the panel's mesh projected by the camera in the VR-like view; null when not shown), center(widget),
# tab(icon) (a toolbar / tab bar button: pencil, library-big, images, layers, sun, sliders-horizontal, settings), ui, store
HELPERS = r"""
(async () => {
const ui = await import("/snugui/static/js/ui.js");
const { store } = await import("/snugui/static/js/state.js");
const panels = () => [...ui.Panel.all];
const panel = (name) => panels().find((p) => p.name === name);
const walk = function* (ws) { for (const w of ws) { yield w; if (w.children) yield* walk(w.children); } };
const widgets = (p) => [...walk(p.widgets)];
const find = (pred) => panels().flatMap(widgets).find(pred);
const shown = (o) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
const at = (p, x, y) => {
	const c = p.canvas;
	if (c.isConnected && c.getClientRects().length) {
		const r = c.getBoundingClientRect();
		return [r.left + x * r.width / p.width, r.top + y * r.height / p.height];
	}
	if (!p.mesh.parent || !shown(p.mesh)) return null;
	const v = p.mesh.localToWorld(p.mesh.position.clone().set((x / p.width - 0.5) * p.widthM, (0.5 - y / p.height) * p.heightM, 0));
	v.project(window.__snugui.camera);
	return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight];
};
const center = (w) => { const o = w.abs(); return at(w.panel, o.x + w.w / 2, o.y + w.h / 2); };
const tab = (icon) => center(find((w) => w.icon === icon && w.round));
window.__t = { ui, store, panel, widgets, find, at, center, tab };
return true;
})()
"""


class Page:
    def __init__(self, browser, target, session, view):
        self.browser, self.target, self.session, self.view = browser, target, session, view
        self.errors = []  # uncaught exceptions and console.error messages, as text
        self.lora_requests = 0

    def cmd(self, method, params=None):
        return self.browser.send(method, params, self.session)

    def event(self, m):
        p = m.get("params", {})
        if m["method"] == "Fetch.requestPaused":
            asyncio.create_task(self.fulfill(p))
        elif m["method"] == "Runtime.exceptionThrown":
            d = p["exceptionDetails"]
            self.errors.append(d.get("exception", {}).get("description") or d.get("text"))
        elif m["method"] == "Runtime.consoleAPICalled" and p["type"] == "error":
            self.errors.append(" ".join(str(a.get("value", a.get("description", ""))) for a in p["args"]))

    async def fulfill(self, p):
        url = p["request"]["url"]
        if "/api/lm/loras/list" in url:
            self.lora_requests += 1
            body, ctype, status = json.dumps(lora_list(url)).encode(), "application/json", 200
        elif "/loras_static/images/mock/" in url:
            body, ctype, status = thumbnail(int(url.rsplit("/", 1)[1].split(".")[0])), "image/png", 200
        elif "/loras_static/" in url:
            body, ctype, status = thumbnail(99), "image/png", 200
        else:
            body, ctype, status = b"not mocked", "text/plain", 404
        await self.cmd("Fetch.fulfillRequest", {"requestId": p["requestId"], "responseCode": status,
                                                "responseHeaders": [{"name": "Content-Type", "value": ctype}],
                                                "body": base64.b64encode(body).decode()})

    async def js(self, expr):
        r = await self.cmd("Runtime.evaluate", {"expression": expr, "awaitPromise": True, "returnByValue": True})
        if "exceptionDetails" in r:
            raise RuntimeError(json.dumps(r["exceptionDetails"])[:800])
        return r["result"].get("value")

    async def wait(self, expr, timeout=15):
        for _ in range(int(timeout * 4)):
            if await self.js(expr):
                return
            await asyncio.sleep(0.25)
        raise TimeoutError(expr)

    async def goto(self, path="/snugui"):
        await self.cmd("Page.navigate", {"url": self.browser.base + path + VIEWS[self.view][4]})
        await asyncio.sleep(1)
        await self.wait("!!window.__snugui")
        await self.js(HELPERS)
        await asyncio.sleep(1)

    async def shot(self, name):
        r = await self.cmd("Page.captureScreenshot", {"format": "png"})
        path = self.browser.dir / "shots" / f"{name}.png"
        path.parent.mkdir(exist_ok=True)
        path.write_bytes(base64.b64decode(r["data"]))
        return str(path)

    async def mouse(self, type, x, y, button="none", buttons=0):
        await self.cmd("Input.dispatchMouseEvent", {"type": type, "x": x, "y": y, "button": button, "buttons": buttons,
                                                    "clickCount": 1 if button != "none" else 0, "pointerType": "mouse"})

    async def hover(self, x, y):
        await self.mouse("mouseMoved", x, y)
        await asyncio.sleep(0.25)

    async def click(self, x, y):
        await self.mouse("mouseMoved", x, y)
        await self.mouse("mousePressed", x, y, "left", 1)
        await self.mouse("mouseReleased", x, y, "left")
        await asyncio.sleep(0.3)

    async def tap(self, x, y):
        await self.cmd("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
        await asyncio.sleep(0.08)
        await self.cmd("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        await asyncio.sleep(0.4)

    async def drag(self, x0, y0, x1, y1, steps=10, touch=False):
        for i in range(steps + 1):
            x, y = x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps
            if touch:
                await self.cmd("Input.dispatchTouchEvent", {"type": "touchStart" if i == 0 else "touchMove", "touchPoints": [{"x": x, "y": y}]})
            elif i == 0:
                await self.mouse("mouseMoved", x, y)
                await self.mouse("mousePressed", x, y, "left", 1)
            else:
                await self.mouse("mouseMoved", x, y, "left", 1)
            await asyncio.sleep(0.03)
        if touch:
            await self.cmd("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        else:
            await self.mouse("mouseReleased", x1, y1, "left")
        await asyncio.sleep(0.3)

    async def wheel(self, x, y, dy):
        await self.cmd("Input.dispatchMouseEvent", {"type": "mouseWheel", "x": x, "y": y, "deltaX": 0, "deltaY": dy})
        await asyncio.sleep(0.2)

    async def type(self, text):
        await self.cmd("Input.insertText", {"text": text})
        await asyncio.sleep(0.2)

    # key: "Enter", "Escape", "Backspace", "Tab", "ArrowLeft"...; modifiers: 1 Alt, 2 Ctrl, 4 Meta, 8 Shift
    async def key(self, key, modifiers=0):
        code = {"Enter": 13, "Escape": 27, "Backspace": 8, "Tab": 9, "Delete": 46, "ArrowLeft": 37, "ArrowUp": 38, "ArrowRight": 39,
                "ArrowDown": 40}.get(key, ord(key.upper()[0]))
        for type in ("rawKeyDown", "keyUp"):
            await self.cmd("Input.dispatchKeyEvent", {"type": type, "key": key, "windowsVirtualKeyCode": code, "modifiers": modifiers,
                                                      **({"text": "\r"} if key == "Enter" and type == "rawKeyDown" else {})})
        await asyncio.sleep(0.2)


class Browser:
    def __init__(self, scratch):
        state = load_state(base_dir(scratch))
        if not state:
            raise RuntimeError("the sandbox is not running: sandbox.py start <scratch>")
        self.base = f"http://127.0.0.1:{state['port']}"
        self.dir = base_dir(scratch)
        self.id = 0
        self.pending = {}
        self.pages = {}

    async def __aenter__(self):
        profile = self.dir / "edge-profile"
        shutil.rmtree(profile, ignore_errors=True)
        self.proc = subprocess.Popen([EDGE, "--headless=new", f"--remote-debugging-port={CDP_PORT}", f"--user-data-dir={profile}",
                                      "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
                                      "--disable-component-update", "--enable-unsafe-swiftshader", "about:blank"])
        self.http = aiohttp.ClientSession()
        for _ in range(60):
            try:
                async with self.http.get(f"http://127.0.0.1:{CDP_PORT}/json/version") as r:
                    ws = (await r.json())["webSocketDebuggerUrl"]
                break
            except aiohttp.ClientError:
                await asyncio.sleep(0.5)
        else:
            raise RuntimeError("Edge did not start")
        self.ws = await self.http.ws_connect(ws, max_msg_size=0)
        self.reader = asyncio.create_task(self.read())
        return self

    async def __aexit__(self, *exc):
        self.reader.cancel()
        await self.ws.close()
        await self.http.close()
        proc = psutil.Process(self.proc.pid)
        for p in proc.children(recursive=True) + [proc]:
            try:
                p.kill()
            except psutil.NoSuchProcess:
                pass

    async def read(self):
        async for msg in self.ws:
            m = json.loads(msg.data)
            if m.get("id") in self.pending:
                self.pending.pop(m["id"]).set_result(m)
            elif m.get("sessionId") in self.pages:
                self.pages[m["sessionId"]].event(m)

    async def send(self, method, params=None, session=None):
        self.id += 1
        msg = {"id": self.id, "method": method, "params": params or {}}
        if session:
            msg["sessionId"] = session
        fut = asyncio.get_running_loop().create_future()
        self.pending[self.id] = fut
        await self.ws.send_str(json.dumps(msg))
        r = await asyncio.wait_for(fut, 30)
        if "error" in r:
            raise RuntimeError(f"{method}: {r['error']}")
        return r.get("result", {})

    # a new tab with the view's size, the LoRA Manager mock and error collection, loaded at path (None: stays blank)
    async def open(self, view="desktop", path="/snugui"):
        width, height, mobile, scale, _ = VIEWS[view]
        target = (await self.send("Target.createTarget", {"url": "about:blank"}))["targetId"]
        session = (await self.send("Target.attachToTarget", {"targetId": target, "flatten": True}))["sessionId"]
        page = self.pages[session] = Page(self, target, session, view)
        await page.cmd("Fetch.enable", {"patterns": [{"urlPattern": "*/api/lm/*"}, {"urlPattern": "*/loras_static/*"}]})
        await page.cmd("Page.enable")
        await page.cmd("Runtime.enable")
        await page.cmd("Emulation.setDeviceMetricsOverride", {"width": width, "height": height, "deviceScaleFactor": scale, "mobile": mobile})
        if mobile:
            await page.cmd("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
        await self.send("Browser.setDownloadBehavior", {"behavior": "allow", "downloadPath": str(self.dir / "downloads")})
        if path:
            await page.goto(path)
        return page
