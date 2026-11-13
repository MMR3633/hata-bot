"""Дописывает ключи в .env, не печатая значения. Аргументы: KEY=VALUE или KEY=@random."""
import secrets
import sys
from pathlib import Path

ENV = Path(__file__).resolve().parent.parent / ".env"
lines = ENV.read_text(encoding="utf-8").splitlines() if ENV.exists() else []
for arg in sys.argv[1:]:
    key, val = arg.split("=", 1)
    if val == "@random":
        if any(l.startswith(key + "=") for l in lines):
            print(key, "уже есть")
            continue
        val = secrets.token_urlsafe(32)
    lines = [l for l in lines if not l.startswith(key + "=")] + [f"{key}={val}"]
    print(key, "записан")
ENV.write_text("\n".join(lines) + "\n", encoding="utf-8")
print("ключи:", [l.split("=", 1)[0] for l in lines if "=" in l])
