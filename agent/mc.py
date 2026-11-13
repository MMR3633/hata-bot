import hashlib
import json
import re
import shutil
import subprocess
import time
import uuid
import zipfile
from datetime import datetime
from pathlib import Path

from .rcon import Rcon, RconError

NAME_RE = re.compile(r"^[\w \-]{1,32}$")
LEVEL_TYPES = {"normal": "minecraft:normal", "flat": "minecraft:flat", "amplified": "minecraft:amplified"}
KEEP_BACKUPS = 5
WORLD_HEIGHT = 512
BORDER = 500


class WorldError(Exception):
    pass


def offline_uuid(name):
    """То же, что Java UUID.nameUUIDFromBytes("OfflinePlayer:" + name)."""
    b = bytearray(hashlib.md5(f"OfflinePlayer:{name}".encode()).digest())
    b[6] = (b[6] & 0x0F) | 0x30
    b[8] = (b[8] & 0x3F) | 0x80
    return uuid.UUID(bytes=bytes(b))


def parse_tps(text):
    m = re.search(r"TPS from last[^:]*:\s*(?:§.)*\*?([\d.]+)", text or "")
    return m.group(1) if m else None


def _esc(value):
    # server.properties читается как ISO-8859-1, всё прочее через \uXXXX
    return "".join(c if 32 <= ord(c) < 127 else f"\\u{ord(c):04x}" for c in str(value))


def _unesc(value):
    return re.sub(r"\\u([0-9a-fA-F]{4})", lambda m: chr(int(m.group(1), 16)), value)


class Server:
    def __init__(self, root, java, rcon_password, whitelist, address, xmx="3G", rcon_port=25575, port=25565,
                 bind=""):
        self.root = Path(root)
        self.server_dir = self.root / "server"
        self.worlds_dir = self.server_dir / "worlds"
        self.backups_dir = self.root / "backups"
        self.java, self.rcon_password, self.whitelist = java, rcon_password, list(whitelist)
        self.address, self.xmx, self.rcon_port, self.port, self.bind = address, xmx, rcon_port, port, bind
        self.proc = None
        self.state = "stopped"

    # ---------- файлы ----------

    def props(self):
        path = self.server_dir / "server.properties"
        out = {}
        if path.exists():
            for line in path.read_text(encoding="latin-1").splitlines():
                if "=" in line and not line.startswith("#"):
                    k, v = line.split("=", 1)
                    out[k.strip()] = _unesc(v.strip())
        return out

    def write_props(self, **updates):
        props = self.props()
        props.update({k.replace("_", "-"): str(v) for k, v in updates.items()})
        text = "#Hata\n" + "".join(f"{k}={_esc(v)}\n" for k, v in sorted(props.items()))
        (self.server_dir / "server.properties").write_text(text, encoding="latin-1")

    def ensure_base(self):
        self.server_dir.mkdir(parents=True, exist_ok=True)
        self.worlds_dir.mkdir(exist_ok=True)
        self.backups_dir.mkdir(parents=True, exist_ok=True)
        (self.server_dir / "eula.txt").write_text("# https://aka.ms/MinecraftEULA\neula=true\n", encoding="ascii")
        self.write_props(**{
            "online-mode": "false", "white-list": "true", "enforce-whitelist": "true",
            "enable-rcon": "true", "rcon.port": self.rcon_port, "rcon.password": self.rcon_password,
            "server-port": self.port, "server-ip": self.bind, "motd": "Hata", "max-players": 4,
            "spawn-protection": 0, "view-distance": 10, "simulation-distance": 8, "difficulty": "normal",
            "enable-command-block": "true", "allow-flight": "true",
        })
        wl = [{"uuid": str(offline_uuid(n)), "name": n} for n in self.whitelist]
        (self.server_dir / "whitelist.json").write_text(json.dumps(wl, indent=2), encoding="utf-8")
        ops = [{"uuid": str(offline_uuid(n)), "name": n, "level": 4, "bypassesPlayerLimit": True} for n in self.whitelist]
        (self.server_dir / "ops.json").write_text(json.dumps(ops, indent=2), encoding="utf-8")

    def world_path(self, d):
        return self.worlds_dir / d

    def backup_dir(self, d):
        return self.backups_dir / d

    def meta(self, d):
        p = self.world_path(d) / "hata.json"
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None

    def _save_meta(self, d, meta):
        (self.world_path(d) / "hata.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    def _all(self):
        out = []
        if self.worlds_dir.exists():
            for p in sorted(self.worlds_dir.iterdir()):
                m = self.meta(p.name) if p.is_dir() else None
                if m:
                    out.append((p.name, m))
        return out

    def _find(self, name):
        for d, m in self._all():
            if m["name"].casefold() == str(name).casefold():
                return d, m
        raise WorldError(f"нет мира «{name}»")

    def current(self):
        level = self.props().get("level-name", "")
        d = level.removeprefix("worlds/")
        m = self.meta(d) if d and level.startswith("worlds/") else None
        return m["name"] if m else None

    def _current_dir(self):
        level = self.props().get("level-name", "")
        return level.removeprefix("worlds/") if level.startswith("worlds/") else None

    def worlds(self):
        out = []
        for d, m in self._all():
            size = sum(f.stat().st_size for f in self.world_path(d).rglob("*") if f.is_file())
            bdir = self.backup_dir(d)
            out.append({"name": m["name"], "dir": d, "type": m.get("type"), "seed": m.get("seed", ""),
                        "size_mb": round(size / 1048576, 1),
                        "backups": len(list(bdir.glob("*.zip"))) if bdir.exists() else 0})
        return out

    def _vanilla(self):
        candidates = sorted(self.server_dir.glob("versions/*/*.jar")) + sorted(self.server_dir.glob("cache/*.jar"))
        for jar in candidates:
            try:
                with zipfile.ZipFile(jar) as z:
                    if "data/minecraft/dimension_type/overworld.json" in z.namelist():
                        dim = json.loads(z.read("data/minecraft/dimension_type/overworld.json"))
                        ver = json.loads(z.read("version.json"))
                        return dim, ver
            except (zipfile.BadZipFile, KeyError, OSError):
                continue
        raise WorldError("не нашёл ванильный jar: запусти сервер один раз, чтобы Paper его скачал")

    def _write_height_pack(self, d):
        dim, ver = self._vanilla()
        dim = dict(dim, min_y=-64, height=WORLD_HEIGHT, logical_height=WORLD_HEIGHT)
        pv = ver.get("pack_version", {})
        major = pv.get("data") if isinstance(pv.get("data"), int) else pv.get("data_major")
        minor = pv.get("data_minor", 0)
        pack = {"description": "Хата: высота мира 512", "pack_format": major}
        if "data_major" in pv:
            pack["min_format"] = [major, minor]
            pack["max_format"] = [major, minor]
        base = self.world_path(d) / "datapacks" / "hata_height"
        target = base / "data" / "minecraft" / "dimension_type" / "overworld.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(dim, indent=2), encoding="utf-8")
        (base / "pack.mcmeta").write_text(json.dumps({"pack": pack}, ensure_ascii=False, indent=2), encoding="utf-8")

    # ---------- команды ----------

    def create_world(self, name, seed, kind):
        name = str(name or "").strip()
        if not NAME_RE.match(name) or name in (".", ".."):
            raise WorldError("название: буквы, цифры, пробел, _ и -, до 32 символов")
        if kind not in LEVEL_TYPES:
            raise WorldError("тип мира: normal, flat или amplified")
        if any(m["name"].casefold() == name.casefold() for _, m in self._all()):
            raise WorldError(f"мир «{name}» уже есть")
        n = 1
        while (self.worlds_dir / f"w{n}").exists():
            n += 1
        d = f"w{n}"
        self.world_path(d).mkdir(parents=True)
        try:
            self._write_height_pack(d)
        except WorldError:
            shutil.rmtree(self.world_path(d))
            raise
        seed = str(seed or "").strip()[:40]
        self._save_meta(d, {"name": name, "type": kind, "seed": seed, "created": time.time(), "border_pending": True})
        self.write_props(**{"level-name": f"worlds/{d}", "level-seed": seed, "level-type": LEVEL_TYPES[kind]})
        return {"name": name, "dir": d}

    def switch_world(self, name):
        d, m = self._find(name)
        self.write_props(**{"level-name": f"worlds/{d}", "level-seed": m.get("seed", ""),
                            "level-type": LEVEL_TYPES[m.get("type", "normal")]})
        return {"name": m["name"], "dir": d}

    def delete_world(self, name):
        d, m = self._find(name)
        if d == self._current_dir():
            raise WorldError("текущий мир удалить нельзя, сначала переключись на другой")
        for suffix in ("", "_nether", "_the_end"):
            p = self.worlds_dir / (d + suffix)
            if p.exists():
                shutil.rmtree(p)
        return {"name": m["name"]}

    def backup(self, name, stamp=None):
        d, m = self._find(name)
        bdir = self.backup_dir(d)
        bdir.mkdir(parents=True, exist_ok=True)
        stamp = stamp or datetime.now().strftime("%Y%m%d-%H%M%S")
        path = bdir / f"{stamp}.zip"
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
            for suffix in ("", "_nether", "_the_end"):
                src = self.worlds_dir / (d + suffix)
                if not src.exists():
                    continue
                for f in src.rglob("*"):
                    if f.is_file() and f.name != "session.lock":
                        z.write(f, f.relative_to(self.worlds_dir).as_posix())
        for old in sorted(bdir.glob("*.zip"))[:-KEEP_BACKUPS]:
            old.unlink()
        return path

    # ---------- процесс ----------

    def jar(self):
        jars = sorted(self.server_dir.glob("paper-*.jar"))
        if not jars:
            raise WorldError("нет paper-*.jar в папке сервера")
        return jars[-1]

    def _rcon_alive(self):
        try:
            with self.rcon() as r:
                r.cmd("list")
            return True
        except (OSError, RconError):
            return False

    def attach(self):
        """Агент перезапустился, а Java осталась жить: подхватываем её по RCON."""
        self.attached = self._rcon_alive()
        if self.attached:
            self.state = "running"
        return self.attached

    def is_running(self):
        if self.proc is not None:
            return self.proc.poll() is None
        return getattr(self, "attached", False) and self._rcon_alive()

    def start(self):
        if self.is_running():
            return
        if not self._current_dir():
            raise WorldError("сначала создай мир")
        log = open(self.root / "server.log", "ab")
        self.proc = subprocess.Popen(
            [self.java, f"-Xms1G", f"-Xmx{self.xmx}", "-XX:+UseG1GC", "-jar", self.jar().name, "--nogui"],
            cwd=self.server_dir, stdin=subprocess.PIPE, stdout=log, stderr=subprocess.STDOUT,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        self.state = "starting"
        for _ in range(240):
            if not self.is_running():
                self.state = "crashed"
                raise WorldError("сервер упал при запуске, смотри server.log")
            try:
                with self.rcon() as r:
                    r.cmd("list")
                break
            except (OSError, RconError):
                time.sleep(1)
        else:
            raise WorldError("сервер не поднялся за 4 минуты")
        self.state = "running"
        self._apply_pending_border()

    def _apply_pending_border(self):
        d = self._current_dir()
        m = self.meta(d)
        if m and m.get("border_pending"):
            with self.rcon() as r:
                r.cmd("setworldspawn 0 80 0")
                r.cmd("worldborder center 0.5 0.5")
                r.cmd(f"worldborder set {BORDER}")
            m["border_pending"] = False
            self._save_meta(d, m)

    def stop(self):
        if not self.is_running():
            self.state = "stopped"
            return
        self.state = "stopping"
        try:
            with self.rcon() as r:
                r.cmd("stop")
        except (OSError, RconError):
            if self.proc:
                self.proc.terminate()
        if self.proc:
            try:
                self.proc.wait(90)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait(10)
        else:
            for _ in range(90):
                if not self._rcon_alive():
                    break
                time.sleep(1)
            time.sleep(3)
        self.proc, self.attached = None, False
        self.state = "stopped"

    def rcon(self):
        return Rcon("127.0.0.1", self.rcon_port, self.rcon_password)

    def save_off(self):
        with self.rcon() as r:
            r.cmd("save-off")
            r.cmd("save-all flush")

    def save_on(self):
        with self.rcon() as r:
            r.cmd("save-on")

    def status(self):
        if self.state in ("running", "starting") and not self.is_running():
            self.state = "crashed"
        players, tps = [], None
        if self.state == "running":
            try:
                with self.rcon() as r:
                    text = r.cmd("list")
                    tps = parse_tps(r.cmd("tps"))
                if ":" in text:
                    players = [p.strip() for p in text.split(":", 1)[1].split(",") if p.strip()]
            except (OSError, RconError):
                pass
        try:
            version = self.jar().stem.removeprefix("paper-")
        except WorldError:
            version = None
        return {"server": self.state, "world": self.current(), "worlds": self.worlds(), "players": players,
                "tps": tps, "address": self.address, "version": version}
