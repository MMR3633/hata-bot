import pytest

from hub import duel_engine as de


def test_mulberry32_known_values():
    r = de.Rng(1)
    assert [r.next_u32() for _ in range(3)] == [2693262067, 11749833, 2265367787]


def test_same_seed_same_trays():
    a, b = de.Game(777), de.Game(777)
    assert a.tray == b.tray
    assert de.Game(778).piece_stream(30) != a.piece_stream(30)
    assert a.piece_stream(30) == b.piece_stream(30)


def test_all_shapes_have_cells():
    assert len(de.SHAPES) > 20
    for s in de.SHAPES:
        assert s["cells"] and all(0 <= r < 5 and 0 <= c < 5 for r, c in s["cells"])


def game_with(tray):
    g = de.Game(1)
    g.tray = list(tray)
    return g


def single():
    return next(i for i, s in enumerate(de.SHAPES) if len(s["cells"]) == 1)


def line(n, vertical=False):
    for i, s in enumerate(de.SHAPES):
        rs = {r for r, _ in s["cells"]}
        cs = {c for _, c in s["cells"]}
        if len(s["cells"]) == n and (len(cs) == 1 if vertical else len(rs) == 1):
            return i
    raise LookupError


def test_place_scores_cells():
    g = game_with([line(3), single(), single()])
    res = g.move(0, 2, 1)
    assert res["ok"] and res["points"] == 3 and g.score == 3
    assert g.tray[0] is None
    assert [g.board[2 * 8 + c] != 0 for c in range(8)] == [False, True, True, True, False, False, False, False]


@pytest.mark.parametrize("row,col", [(-1, 0), (0, 6), (8, 0), (0, -1)])
def test_out_of_board_rejected(row, col):
    g = game_with([line(3), single(), single()])
    assert not g.move(0, row, col)["ok"]
    assert g.score == 0


def test_overlap_and_empty_slot_rejected():
    g = game_with([single(), single(), line(3)])
    assert g.move(0, 0, 0)["ok"]
    assert not g.move(1, 0, 0)["ok"]
    assert not g.move(0, 1, 1)["ok"]


def test_full_row_clears_and_scores_ten():
    g = game_with([line(5), line(3), single()])
    g.move(0, 4, 0)
    res = g.move(1, 4, 5)
    assert res["lines"] == 1 and res["points"] == 3 + 10
    assert all(g.board[4 * 8 + c] == 0 for c in range(8))


def test_two_lines_at_once_score_forty():
    g = de.Game(1)
    for c in range(8):
        if c != 3:
            g.board[0 * 8 + c] = 1
    for r in range(8):
        if r != 0:
            g.board[r * 8 + 3] = 1
    g.board[1 * 8 + 0] = 1
    g.tray = [single(), single(), single()]
    res = g.move(0, 0, 3)
    assert res["lines"] == 2 and res["points"] == 1 + 40


def test_streak_multiplies_and_resets_after_three_misses():
    g = de.Game(1)
    pts = []
    for row in range(3):
        for c in range(7):
            g.board[row * 8 + c] = 1
        g.tray = [single(), single(), single()]
        pts.append(g.move(0, row, 7)["points"])
    assert pts == [11, 16, 21]
    for i in range(3):
        g.tray = [single(), single(), single()]
        g.move(0, 7, i)
    assert g.streak == 0


def test_tray_refills_after_three_moves():
    g = de.Game(5)
    stream = g.piece_stream(6)
    g.tray = stream[:3]
    g.next_piece = 3
    g.board = [0] * 64
    for i in range(3):
        g.board = [0] * 64
        assert g.move(i, 0, 0)["ok"]
    assert g.tray == stream[3:6]


def test_finished_when_nothing_fits():
    g = de.Game(1)
    g.board = [1] * 64
    g.board[0] = 0
    g.tray = [line(3), line(3), single()]
    g.board[0] = 0
    assert not g.check_finished()
    g.tray = [line(3), line(3), None]
    assert g.check_finished()
    assert g.finished
