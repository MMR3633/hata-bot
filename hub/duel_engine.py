import json
from pathlib import Path

_DATA = json.loads((Path(__file__).resolve().parent.parent / "webapp" / "shapes.json").read_text(encoding="utf-8"))
SIZE = _DATA["size"]
SHAPES = [
    {"cells": [(r, c) for r, row in enumerate(s["rows"]) for c, ch in enumerate(row) if ch == "#"],
     "w": s["w"], "color": s["c"]}
    for s in _DATA["shapes"]
]
TOTAL_WEIGHT = sum(s["w"] for s in SHAPES)
U32 = 0xFFFFFFFF


def _imul(a, b):
    return (a * b) & U32


class Rng:
    """mulberry32, побитово совпадает с webapp/js/shapes.js"""

    def __init__(self, seed):
        self.a = seed & U32

    def next_u32(self):
        self.a = (self.a + 0x6D2B79F5) & U32
        a = self.a
        t = _imul(a ^ (a >> 15), 1 | a)
        t = ((t + _imul(t ^ (t >> 7), 61 | t)) & U32) ^ t
        return (t ^ (t >> 14)) & U32

    def next(self):
        return self.next_u32() / 4294967296


def pick(rng):
    x = rng.next() * TOTAL_WEIGHT
    for i, s in enumerate(SHAPES):
        x -= s["w"]
        if x < 0:
            return i
    return len(SHAPES) - 1


class Game:
    def __init__(self, seed):
        self.seed = seed
        self._rng = Rng(seed)
        self._stream = []
        self.board = [0] * (SIZE * SIZE)
        self.score = 0
        self.streak = 0
        self.miss = 0
        self.moves = 0
        self.finished = False
        self.next_piece = 0
        self.tray = []
        self._refill()

    def piece_stream(self, n):
        while len(self._stream) < n:
            self._stream.append(pick(self._rng))
        return self._stream[:n]

    def _refill(self):
        self.tray = self.piece_stream(self.next_piece + 3)[self.next_piece:]
        self.next_piece += 3

    def fits(self, shape, row, col):
        for r, c in SHAPES[shape]["cells"]:
            rr, cc = row + r, col + c
            if not (0 <= rr < SIZE and 0 <= cc < SIZE) or self.board[rr * SIZE + cc]:
                return False
        return True

    def can_place_anywhere(self, shape):
        return any(self.fits(shape, r, c) for r in range(SIZE) for c in range(SIZE))

    def check_finished(self):
        if not any(s is not None and self.can_place_anywhere(s) for s in self.tray):
            self.finished = True
        return self.finished

    def move(self, slot, row, col):
        if self.finished or not (0 <= slot < len(self.tray)) or self.tray[slot] is None:
            return {"ok": False}
        shape = self.tray[slot]
        if not self.fits(shape, row, col):
            return {"ok": False}
        for r, c in SHAPES[shape]["cells"]:
            self.board[(row + r) * SIZE + col + c] = SHAPES[shape]["color"]
        rows = [r for r in range(SIZE) if all(self.board[r * SIZE + c] for c in range(SIZE))]
        cols = [c for c in range(SIZE) if all(self.board[r * SIZE + c] for r in range(SIZE))]
        for r in rows:
            for c in range(SIZE):
                self.board[r * SIZE + c] = 0
        for c in cols:
            for r in range(SIZE):
                self.board[r * SIZE + c] = 0
        lines = len(rows) + len(cols)
        points = len(SHAPES[shape]["cells"])
        if lines:
            self.streak += 1
            self.miss = 0
            points += round(10 * lines * lines * (1 + 0.5 * (self.streak - 1)))
        else:
            self.miss += 1
            if self.miss >= 3:
                self.streak = 0
        self.score += points
        self.moves += 1
        self.tray[slot] = None
        if all(s is None for s in self.tray):
            self._refill()
        self.check_finished()
        return {"ok": True, "points": points, "lines": lines, "rows": rows, "cols": cols,
                "score": self.score, "streak": self.streak, "finished": self.finished}

    def public(self):
        return {"board": self.board, "tray": self.tray, "score": self.score, "streak": self.streak,
                "finished": self.finished, "moves": self.moves}
