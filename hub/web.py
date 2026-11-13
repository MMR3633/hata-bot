import asyncio
import hmac
import json
import time
from dataclasses import dataclass, field
from pathlib import Path

from aiohttp import WSMsgType, web

from . import agent_api, auth, db, search
from .rooms import Hub

WEBAPP = Path(__file__).resolve().parent.parent / "webapp"
POLL_SECONDS = 25


@dataclass
class Cfg:
    token: str
    allowed: set
    db_path: Path
    agent_token: str = ""
    yt_key: str = ""
    duel_seconds: int = 180
    names: dict = field(default_factory=dict)


def _uid(request):
    cfg = request.app["cfg"]
    tok = request.headers.get("Authorization", "").removeprefix("Bearer ").strip() or request.query.get("t", "")
    uid = auth.read_session(tok, cfg.token, cfg.allowed)
    if uid is None:
        raise web.HTTPUnauthorized(text="нет входа")
    return uid


def _is_agent(request):
    cfg = request.app["cfg"]
    got = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
    return bool(cfg.agent_token) and hmac.compare_digest(got, cfg.agent_token)


async def login(request):
    cfg = request.app["cfg"]
    body = await request.json()
    uid, name = None, ""
    if body.get("init_data"):
        user = auth.check_init_data(body["init_data"], cfg.token, cfg.allowed)
        if user:
            uid, name = user["id"], user["first_name"]
    elif body.get("pc"):
        with db.connect(cfg.db_path) as con:
            uid = auth.use_pc_code(con, str(body["pc"]))
    if uid is None:
        raise web.HTTPForbidden(text="закрыто")
    with db.connect(cfg.db_path) as con:
        if name:
            con.execute("INSERT INTO users (uid, name) VALUES (?, ?) ON CONFLICT(uid) DO UPDATE SET name = excluded.name",
                        (uid, name))
        row = con.execute("SELECT name FROM users WHERE uid = ?", (uid,)).fetchone()
    return web.json_response({"token": auth.make_session(uid, cfg.token), "uid": uid,
                              "name": row["name"] if row else str(uid)})


async def me(request):
    uid = _uid(request)
    with db.connect(request.app["cfg"].db_path) as con:
        names = {r["uid"]: r["name"] for r in con.execute("SELECT uid, name FROM users")}
    return web.json_response({"uid": uid, "names": {str(u): names.get(u, str(u)) for u in request.app["cfg"].allowed}})


async def stats(request):
    uid = _uid(request)
    with db.connect(request.app["cfg"].db_path) as con:
        rows = [dict(r) for r in con.execute("SELECT * FROM duel_results ORDER BY id DESC LIMIT 200")]
    wins, best, duels = {}, {}, 0
    for r in rows:
        for p, s in ((r["p1"], r["s1"]), (r["p2"], r["s2"])):
            if p:
                best[str(p)] = max(best.get(str(p), 0), s)
        if r["p2"]:
            duels += 1
            if r["winner"]:
                wins[str(r["winner"])] = wins.get(str(r["winner"]), 0) + 1
    return web.json_response({"me": uid, "wins": wins, "best": best, "duels": duels, "last": rows[:15]})


async def do_search(request):
    _uid(request)
    q = request.query.get("q", "").strip()[:200]
    if not q:
        return web.json_response({"items": []})
    link = search.parse_link(q)
    if link:
        return web.json_response({"items": [{"src": link[0], "id": link[1], "title": q, "author": "", "duration": "",
                                             "thumb": ""}], "link": True})
    try:
        items = await search.search(q, request.query.get("src", "yt"), request.app["cfg"].yt_key)
    except Exception as e:
        return web.json_response({"items": [], "error": type(e).__name__})
    return web.json_response({"items": items})


async def mc_cmd(request):
    _uid(request)
    body = await request.json()
    try:
        with db.connect(request.app["cfg"].db_path) as con:
            cid = agent_api.queue(con, str(body.get("cmd")), body.get("args") or {})
    except ValueError:
        raise web.HTTPBadRequest(text="нет такой команды")
    request.app["agent_wake"].set()
    return web.json_response({"id": cid})


async def mc_status(request):
    _uid(request)
    with db.connect(request.app["cfg"].db_path) as con:
        return web.json_response(agent_api.read_status(con))


async def agent_poll(request):
    if not _is_agent(request):
        raise web.HTTPUnauthorized()
    cfg, wake = request.app["cfg"], request.app["agent_wake"]
    deadline = time.time() + float(request.query.get("wait", POLL_SECONDS))
    while True:
        with db.connect(cfg.db_path) as con:
            cmds = agent_api.take(con)
        if cmds or time.time() >= deadline:
            return web.json_response({"cmds": cmds})
        wake.clear()
        try:
            await asyncio.wait_for(wake.wait(), timeout=max(0.1, deadline - time.time()))
        except asyncio.TimeoutError:
            pass


async def agent_status(request):
    if not _is_agent(request):
        raise web.HTTPUnauthorized()
    body = await request.json()
    with db.connect(request.app["cfg"].db_path) as con:
        agent_api.save_status(con, body.get("status") or {}, body.get("results") or [])
    return web.json_response({"ok": True})


async def ws_handler(request):
    uid = _uid(request)
    hub = request.app["hub"]
    ws = web.WebSocketResponse(heartbeat=25)
    await ws.prepare(request)
    with db.connect(request.app["cfg"].db_path) as con:
        row = con.execute("SELECT name FROM users WHERE uid = ?", (uid,)).fetchone()
    await hub.join(uid, row["name"] if row else str(uid), ws)
    try:
        async for msg in ws:
            if msg.type == WSMsgType.TEXT:
                try:
                    data = json.loads(msg.data)
                except ValueError:
                    continue
                if isinstance(data, dict):
                    await hub.handle(uid, data)
    finally:
        await hub.leave(uid, ws)
    return ws


async def index(request):
    return web.FileResponse(WEBAPP / "index.html", headers={"Cache-Control": "no-cache"})


async def shapes(request):
    return web.FileResponse(WEBAPP / "shapes.json")


async def health(request):
    return web.json_response({"ok": True, "online": request.app["hub"].online()})


@web.middleware
async def no_cache_static(request, handler):
    resp = await handler(request)
    if request.path.startswith(("/js/", "/css/", "/shapes.json")):
        resp.headers["Cache-Control"] = "no-cache"
    return resp


def make_app(cfg):
    db.init(cfg.db_path)
    app = web.Application(middlewares=[no_cache_static], client_max_size=64 * 1024)
    app["cfg"] = cfg
    app["hub"] = Hub(cfg.db_path, cfg.duel_seconds)
    app["agent_wake"] = asyncio.Event()
    app.router.add_get("/", index)
    app.router.add_get("/health", health)
    app.router.add_post("/api/login", login)
    app.router.add_get("/api/me", me)
    app.router.add_get("/api/stats", stats)
    app.router.add_get("/api/search", do_search)
    app.router.add_post("/api/mc/cmd", mc_cmd)
    app.router.add_get("/api/mc/status", mc_status)
    app.router.add_get("/api/agent/poll", agent_poll)
    app.router.add_post("/api/agent/status", agent_status)
    app.router.add_get("/ws", ws_handler)
    app.router.add_get("/shapes.json", shapes)
    app.router.add_static("/js/", WEBAPP / "js")
    app.router.add_static("/css/", WEBAPP / "css")
    return app
