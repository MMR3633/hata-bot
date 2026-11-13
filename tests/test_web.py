import asyncio

import pytest

from hub import web as hweb
from hub.search import parse_link
from tests.test_auth import ALLOWED, TOKEN, init_data

RASUL, LERA = 111111111, 222222222
AGENT = "agent-secret"


@pytest.fixture
async def client(aiohttp_client, tmp_path):
    cfg = hweb.Cfg(token=TOKEN, allowed=set(ALLOWED), db_path=tmp_path / "h.db", agent_token=AGENT, duel_seconds=2)
    return await aiohttp_client(hweb.make_app(cfg))


async def login(client, uid, name):
    r = await client.post("/api/login", json={"init_data": init_data(uid=uid, name=name)})
    assert r.status == 200
    return (await r.json())["token"]


async def recv_until(ws, kind, limit=20):
    for _ in range(limit):
        msg = await asyncio.wait_for(ws.receive_json(), 5)
        if msg["t"] == kind:
            return msg
    raise AssertionError(kind)


async def test_login_and_guard(client):
    assert (await client.post("/api/login", json={"init_data": init_data(uid=42)})).status == 403
    assert (await client.get("/api/me")).status == 401
    tok = await login(client, RASUL, "Расул")
    r = await client.get("/api/me", headers={"Authorization": f"Bearer {tok}"})
    assert (await r.json())["names"][str(RASUL)] == "Расул"


async def test_ws_requires_token(client):
    r = await client.get("/ws")
    assert r.status == 401


async def test_duel_between_two(client):
    t1, t2 = await login(client, RASUL, "Расул"), await login(client, LERA, "Лера")
    a = await client.ws_connect(f"/ws?t={t1}")
    b = await client.ws_connect(f"/ws?t={t2}")
    await recv_until(a, "state")
    await recv_until(b, "state")
    await a.send_json({"t": "duel_ready"})
    await b.send_json({"t": "duel_ready"})
    sa, sb = await recv_until(a, "duel_start"), await recv_until(b, "duel_start")
    assert sa["duel"]["seed"] == sb["duel"]["seed"]
    assert sa["duel"]["games"][str(RASUL)]["tray"] == sa["duel"]["games"][str(LERA)]["tray"]
    await a.send_json({"t": "duel_move", "slot": 0, "row": 0, "col": 0, "id": 1})
    ack = await recv_until(a, "duel_ack")
    assert ack["ok"] and ack["game"]["score"] > 0
    opp = await recv_until(b, "duel_opp")
    assert opp["uid"] == RASUL and opp["game"]["score"] == ack["game"]["score"]
    await a.send_json({"t": "duel_move", "slot": 0, "row": 0, "col": 0})
    assert not (await recv_until(a, "duel_ack"))["ok"]
    end = await recv_until(b, "duel_end", limit=40)
    assert end["winner"] == RASUL
    st = await (await client.get("/api/stats", headers={"Authorization": f"Bearer {t2}"})).json()
    assert st["wins"] == {str(RASUL): 1} and st["duels"] == 1
    await a.close()
    await b.close()


async def test_watch_sync_and_chat(client):
    t1, t2 = await login(client, RASUL, "Расул"), await login(client, LERA, "Лера")
    a = await client.ws_connect(f"/ws?t={t1}")
    b = await client.ws_connect(f"/ws?t={t2}")
    await recv_until(a, "state")
    await recv_until(b, "state")
    await a.send_json({"t": "watch_set", "src": "yt", "id": "dQw4w9WgXcQ", "title": "клип"})
    w = await recv_until(b, "watch")
    assert w["watch"]["id"] == "dQw4w9WgXcQ" and w["watch"]["playing"]
    assert (await recv_until(a, "watch"))["watch"]["by"] == RASUL
    await b.send_json({"t": "watch_ctl", "playing": False, "pos": 42.5})
    w = await recv_until(a, "watch")
    assert w["watch"]["playing"] is False and w["watch"]["pos"] == 42.5
    await a.send_json({"t": "watch_set", "src": "evil", "id": "x"})
    await a.send_json({"t": "chat", "text": "привет"})
    c = await recv_until(b, "chat")
    assert c["text"] == "привет" and c["uid"] == RASUL
    await b.send_json({"t": "react", "emoji": "🔥"})
    assert (await recv_until(a, "react"))["emoji"] == "🔥"
    await a.close()
    await b.close()


async def test_agent_queue(client):
    tok = await login(client, RASUL, "Расул")
    h = {"Authorization": f"Bearer {tok}"}
    st = await (await client.get("/api/mc/status", headers=h)).json()
    assert st["laptop"] == "sleeping"
    assert (await client.get("/api/agent/poll?wait=0")).status == 401
    assert (await client.post("/api/mc/cmd", json={"cmd": "rm -rf"}, headers=h)).status == 400
    poll = asyncio.create_task(client.get("/api/agent/poll?wait=5", headers={"Authorization": f"Bearer {AGENT}"}))
    await asyncio.sleep(0.3)
    r = await client.post("/api/mc/cmd", json={"cmd": "create_world", "args": {"name": "дом", "seed": "1"}}, headers=h)
    cid = (await r.json())["id"]
    got = await (await asyncio.wait_for(poll, 5)).json()
    assert got["cmds"] == [{"id": cid, "cmd": "create_world", "args": {"name": "дом", "seed": "1"}}]
    r = await client.post("/api/agent/status", headers={"Authorization": f"Bearer {AGENT}"},
                          json={"status": {"server": "running", "players": ["MMRool"]},
                                "results": [{"id": cid, "result": {"ok": True}}]})
    assert r.status == 200
    st = await (await client.get("/api/mc/status", headers=h)).json()
    assert st["laptop"] == "awake" and st["status"]["players"] == ["MMRool"]
    assert st["recent"][0]["result"] == {"ok": True}


async def test_pc_login(client, tmp_path):
    from hub import auth, db
    with db.connect(tmp_path / "h.db") as con:
        code = auth.new_pc_code(con, LERA)
    r = await client.post("/api/login", json={"pc": code})
    assert r.status == 200 and (await r.json())["uid"] == LERA
    assert (await client.post("/api/login", json={"pc": code})).status == 403


@pytest.mark.parametrize("url,expected", [
    ("https://youtu.be/dQw4w9WgXcQ?t=3", ("yt", "dQw4w9WgXcQ")),
    ("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=x", ("yt", "dQw4w9WgXcQ")),
    ("youtube.com/shorts/dQw4w9WgXcQ", ("yt", "dQw4w9WgXcQ")),
    ("https://m.youtube.com/watch?v=dQw4w9WgXcQ", ("yt", "dQw4w9WgXcQ")),
    ("https://rutube.ru/video/c6cc4d620b1d4338901770a44b3e82f4/", ("rutube", "c6cc4d620b1d4338901770a44b3e82f4")),
    ("https://vk.com/video-22822305_456239018", ("vk", "-22822305_456239018")),
    ("https://vkvideo.ru/video-22822305_456239018", ("vk", "-22822305_456239018")),
    ("https://vk.com/videos-1?z=video-1_2%2Fpl", ("vk", "-1_2")),
    ("котики смешные", None),
    ("https://example.com/watch?v=dQw4w9WgXcQ", None),
])
def test_parse_link(url, expected):
    assert parse_link(url) == expected
