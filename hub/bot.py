from aiogram import F, Router
from aiogram.filters import Command, CommandStart
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, Message, WebAppInfo

from . import agent_api, auth, db, settings

router = Router()
router.message.filter(F.from_user.id.in_(settings.ALLOWED_IDS))


def app_button(text="🏠 Открыть Хату", path=""):
    return InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(
        text=text, web_app=WebAppInfo(url=f"{settings.PUBLIC_URL}/{path}"))]])


@router.message(CommandStart())
async def start(message: Message):
    await message.answer(
        "🏠 <b>Хата</b> — закрытая база на двоих.\n\n"
        "⛏ Майн на ноуте · 🧩 Блок-дуэль на время · 🎬 Кино вместе\n\n"
        "/pc — ссылка для входа с компьютера\n/mc — статус Майнкрафта",
        reply_markup=app_button())


@router.message(Command("pc"))
async def pc(message: Message):
    with db.connect(settings.DB_PATH) as con:
        code = auth.new_pc_code(con, message.from_user.id)
    await message.answer(f"Ссылка для компьютера, одноразовая, живёт 10 минут:\n{settings.PUBLIC_URL}/?pc={code}",
                         disable_web_page_preview=True)


@router.message(Command("mc"))
async def mc(message: Message):
    with db.connect(settings.DB_PATH) as con:
        st = agent_api.read_status(con)
    if st["laptop"] == "sleeping":
        text = "💤 Ноут спит: агент не на связи. Майнкрафт сейчас недоступен."
    else:
        s = st["status"] or {}
        players = ", ".join(s.get("players") or []) or "никого"
        text = (f"⛏ Сервер: <b>{s.get('server', '?')}</b>\nМир: {s.get('world') or '—'}\n"
                f"Онлайн: {players}\nАдрес: <code>{s.get('address') or '—'}</code>")
    await message.answer(text, reply_markup=app_button("⛏ Управление", "#mc"))
