import sqlite3
from contextlib import contextmanager
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    uid INTEGER PRIMARY KEY,
    name TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS pc_codes (
    code TEXT PRIMARY KEY,
    uid INTEGER NOT NULL,
    created REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS duel_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    finished REAL NOT NULL,
    seed INTEGER NOT NULL,
    p1 INTEGER NOT NULL, s1 INTEGER NOT NULL,
    p2 INTEGER NOT NULL, s2 INTEGER NOT NULL,
    winner INTEGER
);
CREATE TABLE IF NOT EXISTS agent_cmds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cmd TEXT NOT NULL,
    args TEXT NOT NULL DEFAULT '{}',
    created REAL NOT NULL,
    taken REAL,
    result TEXT
);
CREATE TABLE IF NOT EXISTS agent_state (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL,
    at REAL NOT NULL
);
"""


@contextmanager
def connect(path):
    con = sqlite3.connect(path, timeout=10)
    con.row_factory = sqlite3.Row
    try:
        yield con
        con.commit()
    finally:
        con.close()


def init(path):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with connect(path) as con:
        con.executescript(SCHEMA)
