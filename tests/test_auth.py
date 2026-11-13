import hashlib
import hmac
import json
import time
from urllib.parse import parse_qsl, urlencode

from hub import auth, db

TOKEN = "123456:TEST-token-for-hmac-checks-only-xxxxxx"
ALLOWED = {111111111, 222222222}


def sign(fields, token=TOKEN):
    check = "\n".join(f"{k}={v}" for k, v in sorted(fields.items()))
    secret = hmac.new(b"WebAppData", token.encode(), hashlib.sha256).digest()
    return urlencode({**fields, "hash": hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()})


def init_data(uid=111111111, age=10, name="Расул"):
    return sign({"auth_date": str(int(time.time()) - age), "query_id": "AAA",
                 "user": json.dumps({"id": uid, "first_name": name}, ensure_ascii=False)})


def test_valid_init_data_returns_user():
    user = auth.check_init_data(init_data(), TOKEN, ALLOWED)
    assert user == {"id": 111111111, "first_name": "Расул"}


def test_stranger_rejected():
    assert auth.check_init_data(init_data(uid=42), TOKEN, ALLOWED) is None


def test_expired_rejected():
    assert auth.check_init_data(init_data(age=90000), TOKEN, ALLOWED) is None


def test_forged_hash_rejected():
    fields = dict(parse_qsl(init_data()))
    fields["user"] = json.dumps({"id": 111111111, "first_name": "X"})
    assert auth.check_init_data(urlencode(fields), TOKEN, ALLOWED) is None
    assert auth.check_init_data(sign({"auth_date": str(int(time.time())), "user": '{"id": 111111111}'}, token="1:other"),
                                TOKEN, ALLOWED) is None


def test_garbage_rejected():
    assert auth.check_init_data("", TOKEN, ALLOWED) is None
    assert auth.check_init_data("hash=abc", TOKEN, ALLOWED) is None


def test_session_round_trip():
    tok = auth.make_session(111111111, TOKEN)
    assert auth.read_session(tok, TOKEN, ALLOWED) == 111111111
    assert auth.read_session(tok + "x", TOKEN, ALLOWED) is None
    assert auth.read_session(tok, "1:other", ALLOWED) is None
    old = auth.make_session(111111111, TOKEN, now=time.time() - 8 * 86400)
    assert auth.read_session(old, TOKEN, ALLOWED) is None


def test_session_of_removed_user_rejected():
    tok = auth.make_session(222222222, TOKEN)
    assert auth.read_session(tok, TOKEN, {111111111}) is None


def test_pc_code_single_use_and_expiry(tmp_path):
    path = tmp_path / "h.db"
    db.init(path)
    with db.connect(path) as con:
        code = auth.new_pc_code(con, 111111111)
        assert len(code) >= 16
        assert auth.use_pc_code(con, code) == 111111111
        assert auth.use_pc_code(con, code) is None
        old = auth.new_pc_code(con, 111111111, now=time.time() - 601)
        assert auth.use_pc_code(con, old) is None
