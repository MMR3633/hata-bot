import json
import urllib.request
from pathlib import Path

env = dict(l.split("=", 1) for l in (Path(__file__).resolve().parent.parent / ".env").read_text(encoding="utf-8").splitlines() if "=" in l)
opener = urllib.request.build_opener(urllib.request.ProxyHandler({"https": "http://127.0.0.1:10809"}))


def call(method):
    return json.load(opener.open(f"https://api.telegram.org/bot{env['BOT_TOKEN']}/{method}", timeout=20))["result"]


me = call("getMe")
print(me["id"], me["username"], me["first_name"])
print("commands:", [c["command"] for c in call("getMyCommands")])
print("menu:", call("getChatMenuButton"))
print("webhook:", call("getWebhookInfo").get("url") or "нет (polling)")
