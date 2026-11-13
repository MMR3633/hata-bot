import json
import re
from urllib.parse import parse_qs, urlparse

import aiohttp

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/130.0 Safari/537.36", "Accept-Language": "ru-RU,ru;q=0.9"}
YT_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")


def parse_link(url):
    """Ссылка → (src, id) или None. VK id имеет вид -123_456."""
    url = (url or "").strip()
    if not url:
        return None
    if "://" not in url:
        url = "https://" + url
    u = urlparse(url)
    host = u.netloc.lower().removeprefix("www.").removeprefix("m.")
    path = u.path
    if host == "youtu.be":
        vid = path.strip("/").split("/")[0]
        return ("yt", vid) if YT_ID.match(vid) else None
    if host.endswith("youtube.com"):
        vid = parse_qs(u.query).get("v", [""])[0]
        if not vid:
            m = re.match(r"^/(?:shorts|embed|live)/([^/?#]+)", path)
            vid = m.group(1) if m else ""
        return ("yt", vid) if YT_ID.match(vid) else None
    if host.endswith("rutube.ru"):
        m = re.search(r"/(?:video|play/embed|shorts)/(?:private/)?([0-9a-f]{32})", path)
        return ("rutube", m.group(1)) if m else None
    if host in ("vk.com", "vk.ru", "vkvideo.ru"):
        m = re.search(r"video(-?\d+_\d+)", path + "?" + u.query)
        if not m:
            z = parse_qs(u.query).get("z", [""])[0]
            m = re.search(r"video(-?\d+_\d+)", z)
        return ("vk", m.group(1)) if m else None
    return None


def _yt_items_from_html(html):
    m = re.search(r"var ytInitialData = (\{.*?\});</script>", html, re.S)
    if not m:
        return []
    data = json.loads(m.group(1))
    out = []

    def walk(node):
        if isinstance(node, dict):
            v = node.get("videoRenderer")
            if v and v.get("videoId"):
                title = "".join(r.get("text", "") for r in v.get("title", {}).get("runs", []))
                out.append({"src": "yt", "id": v["videoId"], "title": title,
                            "author": "".join(r.get("text", "") for r in v.get("ownerText", {}).get("runs", [])),
                            "duration": v.get("lengthText", {}).get("simpleText", ""),
                            "thumb": f"https://i.ytimg.com/vi/{v['videoId']}/mqdefault.jpg"})
                return
            for x in node.values():
                walk(x)
        elif isinstance(node, list):
            for x in node:
                walk(x)

    walk(data)
    return out


async def search_youtube(session, query, api_key=""):
    if api_key:
        async with session.get("https://www.googleapis.com/youtube/v3/search",
                               params={"part": "snippet", "type": "video", "maxResults": "20", "q": query,
                                       "key": api_key}) as r:
            data = await r.json()
        return [{"src": "yt", "id": i["id"]["videoId"], "title": i["snippet"]["title"],
                 "author": i["snippet"]["channelTitle"], "duration": "",
                 "thumb": i["snippet"]["thumbnails"]["medium"]["url"]} for i in data.get("items", [])]
    async with session.get("https://www.youtube.com/results", params={"search_query": query, "hl": "ru"},
                           headers=UA) as r:
        return _yt_items_from_html(await r.text())[:20]


def _fmt_seconds(s):
    s = int(s or 0)
    return f"{s // 3600}:{s // 60 % 60:02d}:{s % 60:02d}" if s >= 3600 else f"{s // 60}:{s % 60:02d}"


async def search_rutube(session, query):
    async with session.get("https://rutube.ru/api/search/video/", params={"query": query, "format": "json"},
                           headers=UA) as r:
        data = await r.json(content_type=None)
    return [{"src": "rutube", "id": i["id"], "title": i.get("title", ""),
             "author": (i.get("author") or {}).get("name", ""), "duration": _fmt_seconds(i.get("duration")),
             "thumb": i.get("thumbnail_url", "")} for i in data.get("results", [])[:20]]


async def search(query, src, api_key="", session=None):
    own = session is None
    session = session or aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15), trust_env=True)
    try:
        if src == "rutube":
            return await search_rutube(session, query)
        return await search_youtube(session, query, api_key)
    finally:
        if own:
            await session.close()
