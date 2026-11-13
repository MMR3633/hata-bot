import json
import shutil
import subprocess
from pathlib import Path

import pytest

from hub import duel_engine as de


@pytest.mark.skipif(not shutil.which("node"), reason="нужен node")
def test_js_engine_matches_python():
    out = subprocess.run(["node", str(Path(__file__).with_name("parity.mjs"))],
                         capture_output=True, text=True, check=True).stdout
    for seed, js in json.loads(out).items():
        r = de.Rng(int(seed))
        assert [r.next_u32() for _ in range(3)] == js["u32"], seed
        assert de.Game(int(seed)).piece_stream(60) == js["pieces"], seed
