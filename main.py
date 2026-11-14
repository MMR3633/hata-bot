import asyncio
import logging

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.client.session.aiohttp import AiohttpSession
from aiogram.enums import ParseMode
from aiogram.types import BotCommand, MenuButtonWebApp, WebAppInfo
from aiohttp import web

from hub import settings
from hub.bot import router
from hub.web import Cfg, make_app

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("hata")


async def setup_bot(bot):
    for attempt in range(10):
        try:
            await bot.set_my_commands([BotCommand(command="start", description="Открыть Хату"),
                                       BotCommand(command="pc", description="Вход с компьютера"),
                                       BotCommand(command="mc", description="Статус Майнкрафта")])
            if settings.PUBLIC_URL:
                await bot.set_chat_menu_button(menu_button=MenuButtonWebApp(
                    text="Хата", web_app=WebAppInfo(url=settings.PUBLIC_URL + "/")))
            return
        except Exception as e:
            log.warning("настройка бота, попытка %s: %s", attempt + 1, e)
            await asyncio.sleep(5)


async def main():
    cfg = Cfg(token=settings.BOT_TOKEN, allowed=settings.ALLOWED_IDS, db_path=settings.DB_PATH,
              agent_token=settings.AGENT_TOKEN, yt_key=settings.YT_API_KEY, screen_url=settings.SCREEN_URL)
    runner = web.AppRunner(make_app(cfg))
    await runner.setup()
    # bothost иногда переводит веб на 3000 после перезапуска, поэтому слушаем все порты сразу
    ports = sorted({settings.PORT, 8080, 3000})
    for port in ports:
        await web.TCPSite(runner, "0.0.0.0", port).start()
    log.info("веб слушает %s, доступ: %s", ports, sorted(settings.ALLOWED_IDS))
    session = AiohttpSession(proxy=settings.PROXY) if settings.PROXY else None
    bot = Bot(settings.BOT_TOKEN, session=session, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    dp = Dispatcher()
    dp.include_router(router)
    asyncio.create_task(setup_bot(bot))
    await dp.start_polling(bot, allowed_updates=["message"])


if __name__ == "__main__":
    asyncio.run(main())
