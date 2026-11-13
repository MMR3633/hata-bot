"""Создаёт C:/Users/USER/HataMC/agent.env из .env хаба, не печатая секретов."""
import secrets
import sys
from pathlib import Path

hub_env = dict(l.split("=", 1) for l in (Path(__file__).resolve().parent.parent / ".env")
               .read_text(encoding="utf-8").splitlines() if "=" in l)
target = Path("C:/Users/USER/HataMC/agent.env")
old = dict(l.split("=", 1) for l in target.read_text(encoding="utf-8").splitlines() if "=" in l) if target.exists() else {}
env = {
    "HUB_URL": hub_env.get("PUBLIC_URL", "https://hata.bothost.tech"),
    "AGENT_TOKEN": hub_env["AGENT_TOKEN"],
    "RCON_PASSWORD": old.get("RCON_PASSWORD") or secrets.token_urlsafe(24),
    "MC_WHITELIST": old.get("MC_WHITELIST", ""),
    "MC_XMX": old.get("MC_XMX", "3G"),
}
for arg in sys.argv[1:]:
    k, v = arg.split("=", 1)
    env[k] = v
target.write_text("".join(f"{k}={v}\n" for k, v in env.items()), encoding="utf-8")
print("agent.env:", {k: (v if k in ("HUB_URL", "MC_WHITELIST", "MC_XMX", "MC_ADDRESS", "HUB_URL") else "***") for k, v in env.items()})
