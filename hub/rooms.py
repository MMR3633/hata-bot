import asyncio
import random
import time

from . import db
from .duel_engine import Game

DUEL_SECONDS = 180
CHAT_KEEP = 50
REACTIONS = {"😂", "🔥", "😮", "👍", "❤️", "💀", "🤡", "👏"}
SOURCES = {"yt", "rutube", "vk"}


class Duel:
    def __init__(self, players, seed, seconds):
        self.players = list(players)
        self.seed = seed
        self.games = {uid: Game(seed) for uid in players}
        self.started = time.time()
        self.ends_at = self.started + seconds
        self.over = False
        self.timer = None

    def view(self, uid):
        return {"players": self.players, "seed": self.seed, "ends_at": self.ends_at, "over": self.over,
                "games": {str(u): g.public() for u, g in self.games.items()}}


class Hub:
    """Одна общая комната на двоих: присутствие, дуэль, кино, чат."""

    def __init__(self, db_path, duel_seconds=DUEL_SECONDS):
        self.db_path = db_path
        self.duel_seconds = duel_seconds
        self.sockets = {}
        self.names = {}
        self.ready = set()
        self.duel = None
        self.watch = {"src": None, "id": None, "title": "", "playing": False, "pos": 0.0, "at": time.time(), "by": None}
        self.chat = []

    def online(self):
        return sorted(u for u, s in self.sockets.items() if s)

    async def send(self, uid, msg):
        for ws in list(self.sockets.get(uid, ())):
            try:
                await ws.send_json(msg)
            except (ConnectionError, RuntimeError):
                self.sockets[uid].discard(ws)

    async def broadcast(self, msg, skip=None):
        for uid in list(self.sockets):
            if uid != skip:
                await self.send(uid, msg)

    async def join(self, uid, name, ws):
        self.names[uid] = name
        self.sockets.setdefault(uid, set()).add(ws)
        await ws.send_json({"t": "state", "now": time.time(), "me": uid, "names": self.names_view(),
                            "online": self.online(), "ready": sorted(self.ready), "watch": self.watch,
                            "chat": self.chat, "duel": self.duel.view(uid) if self.duel else None})
        await self.broadcast({"t": "presence", "online": self.online(), "names": self.names_view()})

    async def leave(self, uid, ws):
        self.sockets.get(uid, set()).discard(ws)
        if not self.sockets.get(uid):
            self.ready.discard(uid)
            await self.broadcast({"t": "presence", "online": self.online(), "names": self.names_view(),
                                  "ready": sorted(self.ready)})

    def names_view(self):
        return {str(u): n for u, n in self.names.items()}

    async def handle(self, uid, msg):
        kind = msg.get("t")
        handler = getattr(self, f"on_{kind}", None) if isinstance(kind, str) and kind.isidentifier() else None
        if handler:
            await handler(uid, msg)

    # ---------- дуэль ----------

    async def on_duel_ready(self, uid, msg):
        if self.duel and not self.duel.over:
            return
        if msg.get("on", True):
            self.ready.add(uid)
        else:
            self.ready.discard(uid)
        await self.broadcast({"t": "ready", "ready": sorted(self.ready)})
        if len(self.ready) >= 2:
            await self.start_duel(sorted(self.ready))

    async def on_duel_solo(self, uid, msg):
        if self.duel and not self.duel.over:
            return
        await self.start_duel([uid])

    async def start_duel(self, players):
        self.ready.clear()
        self.duel = Duel(players, random.getrandbits(32), self.duel_seconds)
        self.duel.timer = asyncio.create_task(self._duel_timer(self.duel))
        await self.broadcast({"t": "duel_start", "now": time.time(), "duel": self.duel.view(None)})

    async def _duel_timer(self, duel):
        await asyncio.sleep(max(0.0, duel.ends_at - time.time()))
        await self.finish_duel(duel)

    async def on_duel_move(self, uid, msg):
        duel = self.duel
        if not duel or duel.over or uid not in duel.games or time.time() > duel.ends_at:
            await self.send(uid, {"t": "duel_ack", "ok": False})
            return
        game = duel.games[uid]
        try:
            res = game.move(int(msg["slot"]), int(msg["row"]), int(msg["col"]))
        except (KeyError, TypeError, ValueError):
            res = {"ok": False}
        await self.send(uid, {"t": "duel_ack", "ok": res["ok"], "res": res, "game": game.public(), "id": msg.get("id")})
        if res["ok"]:
            await self.broadcast({"t": "duel_opp", "uid": uid, "game": game.public()}, skip=uid)
            if all(g.finished for g in duel.games.values()):
                await self.finish_duel(duel)

    async def finish_duel(self, duel):
        if duel.over:
            return
        duel.over = True
        if duel.timer and duel.timer is not asyncio.current_task():
            duel.timer.cancel()
        scores = {u: g.score for u, g in duel.games.items()}
        winner = None
        if len(scores) == 2:
            (p1, s1), (p2, s2) = scores.items()
            winner = p1 if s1 > s2 else p2 if s2 > s1 else None
        else:
            (p1, s1), (p2, s2) = next(iter(scores.items())), (0, 0)
        with db.connect(self.db_path) as con:
            con.execute("INSERT INTO duel_results (finished, seed, p1, s1, p2, s2, winner) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        (time.time(), duel.seed, p1, s1, p2, s2, winner))
        await self.broadcast({"t": "duel_end", "scores": {str(u): s for u, s in scores.items()}, "winner": winner,
                              "solo": len(scores) == 1})

    # ---------- кино ----------

    def watch_now(self):
        w = dict(self.watch)
        if w["playing"]:
            w["pos"] = w["pos"] + (time.time() - w["at"])
            w["at"] = time.time()
        return w

    async def on_watch_set(self, uid, msg):
        src, vid = msg.get("src"), str(msg.get("id") or "")[:64]
        if src not in SOURCES or not vid:
            return
        self.watch = {"src": src, "id": vid, "title": str(msg.get("title") or "")[:200], "playing": True,
                      "pos": 0.0, "at": time.time(), "by": uid}
        await self.broadcast({"t": "watch", "now": time.time(), "watch": self.watch})

    async def on_watch_ctl(self, uid, msg):
        if not self.watch["id"]:
            return
        try:
            pos = max(0.0, float(msg.get("pos", self.watch_now()["pos"])))
        except (TypeError, ValueError):
            return
        self.watch.update(playing=bool(msg.get("playing")), pos=pos, at=time.time(), by=uid)
        await self.broadcast({"t": "watch", "now": time.time(), "watch": self.watch}, skip=uid)

    async def on_chat(self, uid, msg):
        text = str(msg.get("text") or "").strip()[:500]
        if not text:
            return
        item = {"uid": uid, "text": text, "at": time.time()}
        self.chat = (self.chat + [item])[-CHAT_KEEP:]
        await self.broadcast({"t": "chat", **item})

    async def on_react(self, uid, msg):
        if msg.get("emoji") in REACTIONS:
            await self.broadcast({"t": "react", "uid": uid, "emoji": msg["emoji"]})

    async def on_ping(self, uid, msg):
        await self.send(uid, {"t": "pong", "now": time.time(), "id": msg.get("id")})
