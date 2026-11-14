import asyncio

import pytest
from aiohttp import web

pytest.importorskip("playwright")
from screen.app import make_app  # noqa: E402
from hub import auth  # noqa: E402

TOKEN = "1:screen-test"
PAGE = """<!doctype html><meta name=viewport content="width=device-width">
<title>старт</title><body style="margin:0">
<a id=go href="/clicked" style="display:block;width:100%;height:400px;background:#f80">жми</a>
<input id=q style="width:100%;height:60px"></body>"""


@pytest.fixture
async def site(aiohttp_server):
    app = web.Application()
    app.router.add_get("/", lambda r: web.Response(text=PAGE, content_type="text/html"))
    app.router.add_get("/clicked", lambda r: web.Response(text="<title>нажато</title>ok", content_type="text/html"))
    return await aiohttp_server(app)


async def next_of(ws, kind, binary=False, limit=60):
    for _ in range(limit):
        msg = await asyncio.wait_for(ws.receive(), 20)
        if binary and msg.type.name == "BINARY":
            return msg.data
        if not binary and msg.type.name == "TEXT":
            data = msg.json()
            if data["t"] == kind and (kind != "nav" or "about:blank" not in data["url"]):
                return data
    raise AssertionError(kind)


async def test_shared_browser(aiohttp_client, site):
    try:
        client = await aiohttp_client(make_app(TOKEN, {1, 2}))
    except Exception as e:
        pytest.skip(f"нет браузера: {e}")
    assert (await client.get("/ws")).status == 401
    a = await client.ws_connect(f"/ws?t={auth.make_session(1, TOKEN)}")
    b = await client.ws_connect(f"/ws?t={auth.make_session(2, TOKEN)}")
    await a.send_json({"t": "goto", "url": str(site.make_url("/"))})
    nav = await next_of(b, "nav")
    while nav["title"] != "старт":
        nav = await next_of(b, "nav")
    frame = await next_of(b, None, binary=True)
    assert frame[:2] == b"\xff\xd8"
    await b.send_json({"t": "tap", "x": 0.5, "y": 0.1})
    nav = await next_of(a, "nav")
    while "clicked" not in nav["url"]:
        nav = await next_of(a, "nav")
    await a.send_json({"t": "back"})
    nav = await next_of(b, "nav")
    while nav["url"].endswith("clicked"):
        nav = await next_of(b, "nav")
    assert nav["url"].endswith("/")
    await a.close()
    await b.close()
