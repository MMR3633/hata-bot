"""Собирает отдельный репозиторий общего браузера (deploy_screen/) из кода Хаты.

В нём нет хаба и нет опроса Telegram: bothost берёт ветку по умолчанию и мог бы запустить вторую копию бота.
"""
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "deploy_screen"
FILES = ["screen/__init__.py", "screen/app.py", "hub/__init__.py", "hub/auth.py", "hub/settings.py"]

DOCKERFILE = """FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PLAYWRIGHT_BROWSERS_PATH=/ms-playwright PORT=8080
WORKDIR /app
COPY requirements.txt .
RUN apt-get update && apt-get install -y --no-install-recommends libatomic1 && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir -r requirements.txt && playwright install --with-deps chromium && rm -rf /var/lib/apt/lists/*
COPY hub ./hub
COPY screen ./screen
COPY main.py .
EXPOSE 8080
CMD ["python", "main.py"]
"""

MAIN = '''"""Общий браузер Хаты. Только браузер: Telegram здесь не опрашивается."""
import subprocess
import sys


def ensure_browser():
    # если площадка проигнорировала Dockerfile, ставим Chromium сами при первом запуске
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            p.chromium.launch().close()
    except Exception as e:
        print("Chromium не запускается, ставлю:", type(e).__name__, flush=True)
        subprocess.run([sys.executable, "-m", "playwright", "install", "--with-deps", "chromium"], check=False)


if __name__ == "__main__":
    ensure_browser()
    from screen.app import main
    main()
'''

for rel in FILES:
    dst = OUT / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(ROOT / rel, dst)
(OUT / "Dockerfile").write_text(DOCKERFILE, encoding="utf-8", newline="\n")
(OUT / "main.py").write_text(MAIN, encoding="utf-8", newline="\n")
(OUT / "requirements.txt").write_text("aiohttp\nplaywright==1.65.1\n", encoding="utf-8", newline="\n")
(OUT / ".gitignore").write_text("__pycache__/\n.env\n", encoding="utf-8", newline="\n")
print("собрано:", sorted(str(p.relative_to(OUT)) for p in OUT.rglob("*") if p.is_file() and ".git" not in p.parts))
