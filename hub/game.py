import random
import time

from . import db, game_seed

KINDS = {"q": "Вопрос", "a": "Действие"}
SECTORS = 8
MAX_TEXT = 600


def seed(con):
    con.execute("UPDATE game_cards SET kind = 'q' WHERE kind NOT IN (%s)" % ",".join(f"'{k}'" for k in KINDS))
    if con.execute("SELECT 1 FROM game_meta WHERE k = 'seeded'").fetchone():
        return
    now = time.time()
    con.executemany("INSERT INTO game_cards (kind, text, created) VALUES (?, ?, ?)",
                    [(k, t, now) for k, t in game_seed.cards()])
    con.execute("INSERT INTO game_meta (k, v) VALUES ('seeded', '1')")


def clean(kind, text):
    text = " ".join(str(text or "").split())[:MAX_TEXT]
    if kind not in KINDS or not text:
        raise ValueError
    return kind, text


def list_cards(con):
    used = {r["card_id"] for r in con.execute("SELECT card_id FROM game_used")}
    return [{"id": r["id"], "kind": r["kind"], "text": r["text"], "used": r["id"] in used}
            for r in con.execute("SELECT id, kind, text FROM game_cards ORDER BY kind, id")]


def add_cards(con, kind, texts):
    now = time.time()
    ids = []
    for text in texts:
        try:
            k, t = clean(kind, text)
        except ValueError:
            continue
        ids.append(con.execute("INSERT INTO game_cards (kind, text, created) VALUES (?, ?, ?)", (k, t, now)).lastrowid)
    return ids


def edit_card(con, cid, kind, text):
    k, t = clean(kind, text)
    return con.execute("UPDATE game_cards SET kind = ?, text = ? WHERE id = ?", (k, t, cid)).rowcount > 0


def delete_card(con, cid):
    con.execute("DELETE FROM game_used WHERE card_id = ?", (cid,))
    return con.execute("DELETE FROM game_cards WHERE id = ?", (cid,)).rowcount > 0


def left(con):
    out = {k: 0 for k in KINDS}
    for r in con.execute("SELECT kind, COUNT(*) n FROM game_cards WHERE id NOT IN (SELECT card_id FROM game_used) "
                         "GROUP BY kind"):
        out[r["kind"]] = r["n"]
    total = {k: 0 for k in KINDS}
    for r in con.execute("SELECT kind, COUNT(*) n FROM game_cards GROUP BY kind"):
        total[r["kind"]] = r["n"]
    return out, total


def draw(con, kind, rng=random):
    rows = con.execute("SELECT id, kind, text FROM game_cards WHERE kind = ? AND id NOT IN "
                       "(SELECT card_id FROM game_used)", (kind,)).fetchall()
    if not rows:
        return None
    r = rng.choice(rows)
    con.execute("INSERT OR IGNORE INTO game_used (card_id, at) VALUES (?, ?)", (r["id"], time.time()))
    return {"id": r["id"], "kind": r["kind"], "text": r["text"]}


def reset(con, kinds=None):
    if kinds:
        con.execute(f"DELETE FROM game_used WHERE card_id IN (SELECT id FROM game_cards WHERE kind IN "
                    f"({','.join('?' * len(kinds))}))", list(kinds))
    else:
        con.execute("DELETE FROM game_used")


def wheel(kinds):
    kinds = [k for k in KINDS if k in kinds] or ["q"]
    return [kinds[i % len(kinds)] for i in range(SECTORS)]


class Table:
    """Общий стол: колесо, монетка, кости, чей ход."""

    def __init__(self, db_path, rng=None):
        self.db_path = db_path
        self.rng = rng or random.SystemRandom()
        self.kinds = ["q", "a"]
        self.turn = None
        self.card = None
        self.spin = None
        self.coin = None
        self.dice = None

    def view(self):
        with db.connect(self.db_path) as con:
            lft, total = left(con)
        return {"kinds": self.kinds, "wheel": wheel(self.kinds), "turn": self.turn, "card": self.card,
                "spin": self.spin, "coin": self.coin, "dice": self.dice, "left": lft, "total": total}

    def set_kinds(self, kinds):
        kinds = [k for k in KINDS if k in (kinds or [])]
        if kinds:
            self.kinds = kinds

    def do_spin(self, uid, players):
        sectors = wheel(self.kinds)
        with db.connect(self.db_path) as con:
            lft, _ = left(con)
            options = [i for i, k in enumerate(sectors) if lft.get(k)]
            if not options:
                return None
            idx = self.rng.choice(options)
            card = draw(con, sectors[idx], self.rng)
        self.card = {**card, "for": self.turn, "by": uid, "at": time.time()}
        self.spin = {"n": (self.spin or {}).get("n", 0) + 1, "sector": idx, "offset": round(self.rng.uniform(.18, .82), 3),
                     "turns": self.rng.randint(5, 7), "at": time.time()}
        return self.spin

    def do_other(self, uid):
        if not self.card:
            return None
        with db.connect(self.db_path) as con:
            card = draw(con, self.card["kind"], self.rng)
        if not card:
            return None
        self.card = {**card, "for": self.turn, "by": uid, "at": time.time()}
        return self.card

    def do_coin(self, players):
        side = self.rng.choice(["heads", "tails"])
        winner = None
        if len(players) == 2:
            winner = players[0] if side == "heads" else players[1]
            self.turn = winner
        self.coin = {"n": (self.coin or {}).get("n", 0) + 1, "side": side, "heads": players[0] if players else None,
                     "tails": players[1] if len(players) > 1 else None, "winner": winner, "at": time.time()}
        return self.coin

    def do_dice(self, players):
        rolls = {str(p): [self.rng.randint(1, 6), self.rng.randint(1, 6)] for p in players}
        sums = {p: sum(v) for p, v in rolls.items()}
        winner = None
        if len(sums) == 2 and len(set(sums.values())) == 2:
            winner = int(max(sums, key=sums.get))
            self.turn = winner
        self.dice = {"n": (self.dice or {}).get("n", 0) + 1, "rolls": rolls, "winner": winner, "at": time.time()}
        return self.dice

    def pass_turn(self, players):
        if len(players) == 2:
            self.turn = players[1] if self.turn == players[0] else players[0]
        self.card = None
        return self.turn
