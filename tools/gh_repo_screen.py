"""Создаёт публичный репозиторий MMR3633/hata-screen токеном из git credential manager (токен не печатается)."""
import json
import subprocess
import sys
import urllib.error
import urllib.request

out = subprocess.run(["git", "credential", "fill"], input="protocol=https\nhost=github.com\n\n",
                     capture_output=True, text=True, timeout=30).stdout
cred = dict(l.split("=", 1) for l in out.splitlines() if "=" in l)
if not cred.get("password"):
    sys.exit("нет сохранённого ключа GitHub")
print("user:", cred.get("username"))
opener = urllib.request.build_opener(urllib.request.ProxyHandler({"https": "http://127.0.0.1:10809"}))


def api(method, path, body=None):
    req = urllib.request.Request("https://api.github.com" + path, method=method,
                                 data=json.dumps(body).encode() if body else None,
                                 headers={"Authorization": f"token {cred['password']}",
                                          "Accept": "application/vnd.github+json", "User-Agent": "hata"})
    try:
        with opener.open(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


code, me = api("GET", "/user")
print("whoami:", code, me.get("login"))
code, repo = api("GET", "/repos/MMR3633/hata-screen")
if code == 404 and "--create" in sys.argv:
    code, repo = api("POST", "/user/repos", {"name": "hata-screen", "private": False,
                                              "description": "Хата: общий браузер"})
print("repo:", code, repo.get("html_url"))
