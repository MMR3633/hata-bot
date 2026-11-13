"""Агент Майнкрафта на ноуте: берёт команды у хаба Хаты и управляет сервером Paper.

Запуск: python -m agent.agent  (настройки в C:/Users/USER/HataMC/agent.env)
"""
import json
import logging
import os
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

from .mc import Server, WorldError
from .rcon import RconError

ROOT = Path(os.environ.get("HATA_MC_ROOT", "C:/Users/USER/HataMC"))
log = logging.getLogger("agent")


def load_env(path):
    env = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8-sig").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env


def radmin_ip():
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip.startswith("26."):
                return ip
    except OSError:
        pass
    return ""


class Agent:
    def __init__(self, env):
        self.hub = env["HUB_URL"].rstrip("/")
        self.token = env["AGENT_TOKEN"]
        self.address_override = env.get("MC_ADDRESS", "")
        self.server = Server(ROOT, java=env.get("JAVA", str(ROOT / "java" / "bin" / "java.exe")),
                             rcon_password=env["RCON_PASSWORD"],
                             whitelist=[n for n in env.get("MC_WHITELIST", "").split(",") if n],
                             address="", xmx=env.get("MC_XMX", "3G"), bind=env.get("MC_BIND", ""))
        self.server.ensure_base()
        if self.server.attach():
            log.info("сервер уже работал, подхватил по RCON")
        self.busy = None
        self.results = []
        self.lock = threading.Lock()
        opener_handlers = []
        if env.get("HUB_PROXY"):
            opener_handlers.append(urllib.request.ProxyHandler({"https": env["HUB_PROXY"], "http": env["HUB_PROXY"]}))
        else:
            opener_handlers.append(urllib.request.ProxyHandler({}))
        self.opener = urllib.request.build_opener(*opener_handlers)

    def request(self, method, path, body=None, timeout=40):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.hub + path, data=data, method=method, headers={
            "Authorization": f"Bearer {self.token}", "Content-Type": "application/json",
            "User-Agent": "hata-agent/1"})
        with self.opener.open(req, timeout=timeout) as r:
            return json.loads(r.read() or b"{}")

    def status(self):
        st = self.server.status()
        port = self.server.port
        ip = self.address_override or radmin_ip()
        st["address"] = f"{ip}:{port}" if ip and ":" not in ip else ip or f"(включи Radmin VPN):{port}"
        st["busy"] = self.busy
        return st

    def push_status(self):
        with self.lock:
            results, self.results = self.results, []
        try:
            self.request("POST", "/api/agent/status", {"status": self.status(), "results": results}, timeout=20)
        except (urllib.error.URLError, OSError, ValueError) as e:
            with self.lock:
                self.results = results + self.results
            log.warning("статус не ушёл: %s", e)

    def status_loop(self):
        while True:
            self.push_status()
            time.sleep(10)

    def execute(self, cmd, args):
        s = self.server
        if cmd == "start":
            s.start()
            return {"ok": True}
        if cmd == "stop":
            s.stop()
            return {"ok": True}
        if cmd == "create_world":
            was_running = s.is_running()
            if was_running:
                s.stop()
            w = s.create_world(args.get("name"), args.get("seed", ""), args.get("type", "normal"))
            s.start()
            return {"ok": True, "world": w["name"]}
        if cmd == "switch_world":
            was_running = s.is_running()
            if was_running:
                s.stop()
            w = s.switch_world(args.get("name"))
            if was_running:
                s.start()
            return {"ok": True, "world": w["name"]}
        if cmd == "delete_world":
            return {"ok": True, **s.delete_world(args.get("name"))}
        if cmd == "backup":
            name = args.get("name") or s.current()
            live = s.is_running() and name == s.current()
            if live:
                s.save_off()
            try:
                path = s.backup(name)
            finally:
                if live:
                    s.save_on()
            return {"ok": True, "file": path.name}
        return {"ok": False, "error": f"неизвестная команда {cmd}"}

    def run_cmd(self, c):
        self.busy = c["cmd"]
        self.push_status()
        try:
            result = self.execute(c["cmd"], c.get("args") or {})
        except (WorldError, RconError, OSError) as e:
            result = {"ok": False, "error": str(e)}
        log.info("команда %s %s → %s", c["cmd"], c.get("args"), result)
        self.busy = None
        with self.lock:
            self.results.append({"id": c["id"], "result": result})
        self.push_status()

    def run(self):
        threading.Thread(target=self.status_loop, daemon=True).start()
        log.info("агент на связи с %s, папка %s", self.hub, ROOT)
        while True:
            try:
                cmds = self.request("GET", "/api/agent/poll?wait=25")["cmds"]
            except (urllib.error.URLError, OSError, ValueError) as e:
                log.warning("опрос хаба: %s", e)
                time.sleep(5)
                continue
            for c in cmds:
                self.run_cmd(c)


def single_instance(port=47662):
    lock = socket.socket()
    try:
        lock.bind(("127.0.0.1", port))
    except OSError:
        sys.exit("агент уже запущен")
    return lock


def main():
    _lock = single_instance()
    ROOT.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                        handlers=[logging.FileHandler(ROOT / "agent.log", encoding="utf-8"),
                                  logging.StreamHandler(sys.stdout)])
    env = load_env(ROOT / "agent.env")
    env.update({k.removeprefix("HATA_"): v for k, v in os.environ.items() if k.startswith("HATA_") and k != "HATA_MC_ROOT"})
    missing = [k for k in ("HUB_URL", "AGENT_TOKEN", "RCON_PASSWORD") if not env.get(k)]
    if missing:
        sys.exit(f"в {ROOT / 'agent.env'} не хватает: {', '.join(missing)}")
    agent = Agent(env)
    try:
        agent.run()
    finally:
        agent.server.stop()


if __name__ == "__main__":
    main()
