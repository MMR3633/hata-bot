import asyncio
import re
import sys
from pathlib import Path

from telethon import TelegramClient

ENV = Path(__file__).resolve().parent.parent / ".env"
NAME = "Хата"
USERNAMES = ["hata_duo_bot", "hata_vdvoem_bot", "hata_na_dvoih_bot", "mmrool_hata_bot", "hata2026_bot"]


async def ask(c, bf, text, wait=4):
    sent = await c.send_message(bf, text)
    for _ in range(15):
        await asyncio.sleep(wait / 2)
        msgs = await c.get_messages(bf, limit=3)
        fresh = [m for m in msgs if m.id > sent.id and not m.out]
        if fresh:
            return fresh[0].message or ""
    return ""


async def main():
    c = TelegramClient("C:/Users/USER/ClaudeLaptopTG/laptop", 2040, "b18441a1ff607e10a989891a5462e627",
                       proxy=("http", "127.0.0.1", 10809), receive_updates=False)
    await c.connect()
    bf = await c.get_entity("BotFather")
    print("newbot:", (await ask(c, bf, "/newbot"))[:80])
    print("name:", (await ask(c, bf, NAME))[:80])
    for u in USERNAMES:
        reply = await ask(c, bf, u)
        m = re.search(r"\d{8,12}:[A-Za-z0-9_-]{30,}", reply)
        if m:
            lines = [l for l in (ENV.read_text(encoding="utf-8").splitlines() if ENV.exists() else [])
                     if not l.startswith(("BOT_TOKEN=", "BOT_USERNAME="))]
            lines += [f"BOT_TOKEN={m.group(0)}", f"BOT_USERNAME={u}"]
            ENV.write_text("\n".join(lines) + "\n", encoding="utf-8")
            print("OK", u, "token saved to .env")
            break
        print("taken?", u, reply[:80])
    else:
        sys.exit("no username accepted")
    await c.disconnect()


asyncio.run(main())
