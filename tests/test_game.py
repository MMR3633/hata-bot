import random

from hub import db, game, game_seed
from tests.test_web import LERA, RASUL, client, login, recv_until  # noqa: F401


def test_seed_once_and_counts(tmp_path):
    path = tmp_path / "g.db"
    db.init(path)
    db.init(path)
    with db.connect(path) as con:
        cards = game.list_cards(con)
        assert len(cards) == len(game_seed.cards())
        lft, total = game.left(con)
        assert total == {"q": 47, "a": 4}
        for c in cards:
            game.delete_card(con, c["id"])
    db.init(path)
    with db.connect(path) as con:
        assert game.list_cards(con) == []


def test_no_repeats_until_reset(tmp_path):
    path = tmp_path / "g.db"
    db.init(path)
    rng = random.Random(1)
    with db.connect(path) as con:
        n = game.left(con)[1]["q"]
        seen = [game.draw(con, "q", rng)["id"] for _ in range(n)]
        assert len(set(seen)) == n
        assert game.draw(con, "q", rng) is None
        game.reset(con)
        assert game.draw(con, "q", rng) is not None


def test_table_spin_respects_kinds_and_empty(tmp_path):
    path = tmp_path / "g.db"
    db.init(path)
    t = game.Table(path, random.Random(3))
    t.set_kinds(["a"])
    total_a = t.view()["total"]["a"]
    kinds = set()
    for _ in range(total_a):
        assert t.do_spin(1, [1, 2]) is not None
        kinds.add(t.card["kind"])
        assert t.view()["wheel"][t.spin["sector"]] == t.card["kind"]
    assert kinds == {"a"}
    assert t.do_spin(1, [1, 2]) is None
    t.set_kinds(["nope"])
    assert t.kinds == ["a"]


def test_coin_and_dice_set_turn(tmp_path):
    path = tmp_path / "g.db"
    db.init(path)
    t = game.Table(path, random.Random(5))
    for _ in range(20):
        c = t.do_coin([1, 2])
        assert t.turn == (1 if c["side"] == "heads" else 2)
        d = t.do_dice([1, 2])
        s1, s2 = sum(d["rolls"]["1"]), sum(d["rolls"]["2"])
        assert all(1 <= x <= 6 for v in d["rolls"].values() for x in v)
        if s1 != s2:
            assert d["winner"] == (1 if s1 > s2 else 2) == t.turn
        else:
            assert d["winner"] is None
    t.turn = 1
    assert t.pass_turn([1, 2]) == 2 and t.card is None


async def test_game_over_ws_and_cards_api(client):
    t1, t2 = await login(client, RASUL, "Расул"), await login(client, LERA, "Лера")
    h1 = {"Authorization": f"Bearer {t1}"}
    assert (await client.get("/api/game/cards")).status == 401
    a = await client.ws_connect(f"/ws?t={t1}")
    b = await client.ws_connect(f"/ws?t={t2}")
    st = await recv_until(a, "state")
    assert st["game"]["kinds"] == ["q", "a"]
    await recv_until(b, "state")

    r = await client.post("/api/game/cards", json={"kind": "a", "texts": ["Обнимитесь", "  ", "Станцуйте"]}, headers=h1)
    ids = (await r.json())["ids"]
    assert len(ids) == 2
    seed_a = sum(1 for k, _ in game_seed.cards() if k == "a")
    assert (await recv_until(b, "game"))["game"]["total"]["a"] == seed_a + 2
    r = await client.post(f"/api/game/cards/{ids[0]}", json={"kind": "q", "text": "Новый текст"}, headers=h1)
    assert r.status == 200
    cards = (await (await client.get("/api/game/cards", headers=h1)).json())["cards"]
    assert any(c["id"] == ids[0] and c["kind"] == "q" and c["text"] == "Новый текст" for c in cards)
    assert (await client.post("/api/game/cards", json={"kind": "zz", "text": "x"}, headers=h1)).status == 400
    assert (await client.delete(f"/api/game/cards/{ids[1]}", headers=h1)).status == 200
    assert (await client.delete(f"/api/game/cards/{ids[1]}", headers=h1)).status == 404

    await a.send_json({"t": "game_coin"})
    ga, gb = await recv_until(a, "game", 40), await recv_until(b, "game", 40)
    while gb.get("event") != "coin":
        gb = await recv_until(b, "game", 40)
    assert gb["game"]["turn"] in (RASUL, LERA)

    await b.send_json({"t": "game_spin"})
    gb = await recv_until(b, "game", 40)
    while gb.get("event") != "spin":
        gb = await recv_until(b, "game", 40)
    ga = await recv_until(a, "game", 40)
    while ga.get("event") != "spin":
        ga = await recv_until(a, "game", 40)
    assert ga["game"]["card"]["text"] == gb["game"]["card"]["text"]
    assert ga["game"]["card"]["kind"] in ("q", "a")
    assert ga["game"]["wheel"][ga["game"]["spin"]["sector"]] == ga["game"]["card"]["kind"]
    assert ga["game"]["card"]["for"] == gb["game"]["turn"]
    await a.close()
    await b.close()


def test_old_spicy_kind_merges_into_questions(tmp_path):
    path = tmp_path / "g.db"
    db.init(path)
    with db.connect(path) as con:
        con.execute("INSERT INTO game_cards (kind, text, created) VALUES ('x', 'старый 18+', 0)")
    db.init(path)
    with db.connect(path) as con:
        assert {c["kind"] for c in game.list_cards(con)} == {"q", "a"}
        assert game.left(con)[1] == {"q": 48, "a": 4}


async def test_agent_adds_cards_without_duplicates(client):
    from tests.test_web import AGENT
    h = {"Authorization": f"Bearer {AGENT}"}
    assert (await client.post("/api/agent/game_cards", json={"kind": "a", "texts": ["Раз"]})).status == 401
    r = await client.post("/api/agent/game_cards", json={"kind": "a", "texts": ["Раз", "Два"]}, headers=h)
    assert len((await r.json())["ids"]) == 2
    r = await client.post("/api/agent/game_cards", json={"kind": "a", "texts": ["Раз", "Три"]}, headers=h)
    assert len((await r.json())["ids"]) == 1
