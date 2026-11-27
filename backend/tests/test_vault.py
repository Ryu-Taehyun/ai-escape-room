"""'한밤의 금고' 테마: 데이터 규칙, 실제 플레이, 기존 DB 자동 추가."""
import itertools

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.seed_data import THEMES

VAULT = next(t for t in THEMES if t["key"] == "vault")
FIXED_SPOTS = {"단말기": (0.0, -3.7), "미니게임": (-1.6, -1.8)}  # engine.js 의 PUZZLE_POS, MINIGAME_POS
SAFE_OBJECTS = {"note", "board", "book", "tablet", "box"}         # statue·jar 는 공포 테마 모델(마네킹·병)


def test_vault_theme_shape():
    assert VAULT["style"]["decor"] == "vault"
    assert len(VAULT["rooms"]) == 5  # 처음 DB 에 들어갈 때 방 개수가 고정되므로 5개 필수
    assert VAULT["rooms"][-1]["minigame"], "마지막 방은 미니게임 → 열쇠 → 탈출문 흐름"


@pytest.mark.parametrize("idx", range(5))
def test_vault_room_follows_rules(idx):
    room = VAULT["rooms"][idx]
    where = f"금고 방{idx + 1}"
    ids = [c["id"] for c in room["clues"]]
    assert len(ids) == len(set(ids)), f"{where}: 단서 id 중복"
    for c in room["clues"]:
        x, z = c["pos"]
        assert abs(x) <= 4.3 and abs(z) <= 4.3, f"{where}: {c['id']} 방 밖"
        assert not (abs(z) < 1.2 and abs(x) > 4), f"{where}: {c['id']} 문 앞"
        assert c["object"] in SAFE_OBJECTS, f"{where}: {c['id']} 는 {c['object']} (공포 테마 모델)"
        for name, (fx, fz) in FIXED_SPOTS.items():
            assert ((x - fx) ** 2 + (z - fz) ** 2) ** 0.5 >= 1.2, f"{where}: {c['id']} {name}와 겹침"
    for a, b in itertools.combinations(room["clues"], 2):
        d = ((a["pos"][0] - b["pos"][0]) ** 2 + (a["pos"][1] - b["pos"][1]) ** 2) ** 0.5
        assert d >= 1.5, f"{where}: {a['id']}·{b['id']} 너무 가까움"
    assert room["answer"].strip() or room.get("minigame"), f"{where}: 풀 것이 없음"
    assert len(room["hints"]) == 3, f"{where}: 힌트는 3개 (쉬움 3 / 보통 2 / 어려움 1 로 잘림)"


@pytest.mark.parametrize("difficulty", ["easy", "normal", "hard"])
def test_vault_first_room_can_be_solved(difficulty):
    with TestClient(app) as c:
        s = c.post("/api/sessions", json={"theme_key": "vault", "room_count": 2, "time_limit_min": 30, "difficulty": difficulty}).json()
        assert not any(r["ai_generated"] for r in s["rooms"])
        answer = VAULT["rooms"][0]["answer"].split("|")[0]
        assert not c.post(f"/api/sessions/{s['id']}/rooms/0/answer", json={"answer": "9999"}).json()["correct"]
        assert c.post(f"/api/sessions/{s['id']}/rooms/0/answer", json={"answer": answer}).json()["correct"]


def test_old_db_gets_vault_theme(tmp_path, monkeypatch):
    """금고 테마가 없던 기존 DB 도 서버를 켜면 테마와 방 5개가 추가된다."""
    from app.config import settings
    from app.database import get_conn, init_db
    monkeypatch.setattr(settings, "DATABASE_PATH", str(tmp_path / "old.db"))
    init_db()
    with get_conn() as conn:
        tid = conn.execute("SELECT id FROM themes WHERE key = 'vault'").fetchone()["id"]
        conn.execute("DELETE FROM rooms WHERE theme_id = ?", (tid,))
        conn.execute("DELETE FROM themes WHERE id = ?", (tid,))
    init_db()
    with get_conn() as conn:
        n = conn.execute("SELECT COUNT(*) FROM rooms r JOIN themes t ON t.id = r.theme_id WHERE t.key = 'vault'").fetchone()[0]
    assert n == 5
