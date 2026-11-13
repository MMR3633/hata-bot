import json
import time

COMMANDS = {"start", "stop", "create_world", "switch_world", "backup", "delete_world"}
STALE_AFTER = 45


def queue(con, cmd, args):
    if cmd not in COMMANDS:
        raise ValueError(cmd)
    cur = con.execute("INSERT INTO agent_cmds (cmd, args, created) VALUES (?, ?, ?)",
                      (cmd, json.dumps(args, ensure_ascii=False), time.time()))
    return cur.lastrowid


def take(con, now=None):
    now = now or time.time()
    rows = con.execute("SELECT id, cmd, args FROM agent_cmds WHERE taken IS NULL AND created > ? ORDER BY id",
                       (now - 600,)).fetchall()
    if rows:
        con.execute(f"UPDATE agent_cmds SET taken = ? WHERE id IN ({','.join('?' * len(rows))})",
                    (now, *[r["id"] for r in rows]))
    return [{"id": r["id"], "cmd": r["cmd"], "args": json.loads(r["args"])} for r in rows]


def save_status(con, status, results=(), now=None):
    now = now or time.time()
    con.execute("INSERT INTO agent_state (k, v, at) VALUES ('status', ?, ?) "
                "ON CONFLICT(k) DO UPDATE SET v = excluded.v, at = excluded.at",
                (json.dumps(status, ensure_ascii=False), now))
    for r in results:
        con.execute("UPDATE agent_cmds SET result = ? WHERE id = ?",
                    (json.dumps(r.get("result"), ensure_ascii=False), int(r["id"])))


def read_status(con, now=None):
    now = now or time.time()
    row = con.execute("SELECT v, at FROM agent_state WHERE k = 'status'").fetchone()
    recent = [{"id": r["id"], "cmd": r["cmd"], "args": json.loads(r["args"]), "created": r["created"],
               "taken": r["taken"], "result": json.loads(r["result"]) if r["result"] else None}
              for r in con.execute("SELECT * FROM agent_cmds ORDER BY id DESC LIMIT 8")]
    if row is None:
        return {"laptop": "sleeping", "seen": None, "status": None, "recent": recent}
    return {"laptop": "sleeping" if now - row["at"] > STALE_AFTER else "awake", "seen": row["at"],
            "status": json.loads(row["v"]), "recent": recent}
