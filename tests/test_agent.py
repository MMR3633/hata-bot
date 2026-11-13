import json
import uuid
import zipfile

import pytest

from agent.mc import Server, WorldError, offline_uuid

VANILLA_DIM = {"ultrawarm": False, "natural": True, "min_y": -64, "height": 384, "logical_height": 384,
               "has_skylight": True, "effects": "minecraft:overworld"}


@pytest.fixture
def srv(tmp_path):
    sdir = tmp_path / "server"
    (sdir / "cache").mkdir(parents=True)
    with zipfile.ZipFile(sdir / "cache" / "mojang_1.21.4.jar", "w") as z:
        z.writestr("data/minecraft/dimension_type/overworld.json", json.dumps(VANILLA_DIM))
        z.writestr("version.json", json.dumps({"name": "1.21.4", "pack_version": {"resource": 46, "data": 61}}))
    s = Server(tmp_path, java="java", rcon_password="pw", whitelist=["MMRool", "Lera"], address="26.1.2.3")
    s.ensure_base()
    return s


def test_offline_uuid_matches_java():
    # UUID.nameUUIDFromBytes("OfflinePlayer:Notch") в Java
    assert offline_uuid("Notch") == uuid.UUID("b50ad385-829d-3141-a216-7e7d7539ba7f")


def test_base_files(srv):
    props = srv.props()
    assert props["online-mode"] == "false" and props["white-list"] == "true"
    assert props["enforce-whitelist"] == "true" and props["enable-rcon"] == "true"
    assert props["rcon.password"] == "pw"
    assert (srv.server_dir / "eula.txt").read_text().strip().endswith("eula=true")
    wl = json.loads((srv.server_dir / "whitelist.json").read_text())
    assert {w["name"] for w in wl} == {"MMRool", "Lera"}
    assert wl[0]["uuid"] == str(offline_uuid(wl[0]["name"]))


def test_create_world_prepares_datapack_and_props(srv):
    w = srv.create_world("Дом у реки", "123", "flat")
    assert w["name"] == "Дом у реки"
    props = srv.props()
    assert props["level-name"] == f"worlds/{w['dir']}" and props["level-seed"] == "123"
    assert props["level-type"] == "minecraft:flat"
    dp = srv.world_path(w["dir"]) / "datapacks" / "hata_height"
    dim = json.loads((dp / "data/minecraft/dimension_type/overworld.json").read_text())
    assert dim["min_y"] == -64 and dim["height"] == 512 and dim["logical_height"] == 512
    assert dim["has_skylight"] is True
    meta = json.loads((dp / "pack.mcmeta").read_text())
    assert meta["pack"]["pack_format"] == 61
    assert srv.current() == "Дом у реки"
    assert srv.meta(w["dir"])["border_pending"] is True


def test_duplicate_and_bad_names(srv):
    srv.create_world("дом", "", "normal")
    with pytest.raises(WorldError):
        srv.create_world("Дом", "", "normal")
    for bad in ["", "../x", "a" * 33, "мир/2"]:
        with pytest.raises(WorldError):
            srv.create_world(bad, "", "normal")
    with pytest.raises(WorldError):
        srv.create_world("ок", "", "hacker")


def test_switch_and_delete(srv):
    a = srv.create_world("первый", "", "normal")
    b = srv.create_world("второй", "", "normal")
    assert srv.current() == "второй"
    with pytest.raises(WorldError):
        srv.delete_world("второй")
    srv.switch_world("первый")
    assert srv.props()["level-name"] == f"worlds/{a['dir']}"
    srv.delete_world("второй")
    assert not srv.world_path(b["dir"]).exists()
    assert [w["name"] for w in srv.worlds()] == ["первый"]
    with pytest.raises(WorldError):
        srv.switch_world("нет такого")


def test_backup_rotation_keeps_five(srv):
    w = srv.create_world("дом", "", "normal")
    (srv.world_path(w["dir"]) / "level.dat").write_bytes(b"x" * 100)
    nether = srv.worlds_dir / (w["dir"] + "_nether")
    nether.mkdir()
    (nether / "n.dat").write_bytes(b"n")
    paths = [srv.backup("дом", stamp=f"2026111{i}-000000") for i in range(7)]
    left = sorted(p.name for p in srv.backup_dir(w["dir"]).iterdir())
    assert len(left) == 5 and left[0].startswith("20261112")
    with zipfile.ZipFile(paths[-1]) as z:
        names = z.namelist()
    assert f"{w['dir']}/level.dat" in names and f"{w['dir']}_nether/n.dat" in names
    assert srv.worlds()[0]["backups"] == 5


def test_status_when_stopped(srv):
    srv.create_world("дом", "", "normal")
    st = srv.status()
    assert st["server"] == "stopped" and st["world"] == "дом" and st["address"] == "26.1.2.3"
    assert st["worlds"][0]["name"] == "дом"


def test_parse_tps():
    from agent.mc import parse_tps
    assert parse_tps("§6TPS from last 1m, 5m, 15m: §a20.0, §a19.98, §a*20.0") == "20.0"
    assert parse_tps("garbage") is None
