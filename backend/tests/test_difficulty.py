"""난이도(쉬움/보통/어려움)별 출제: 기본 방 변형 문제, 힌트 감점, AI 생성 문제."""
import asyncio
import itertools
import json

import pytest
from fastapi.testclient import TestClient

from app import ai_service, game_logic, repository as repo
from app.config import settings
from app.main import app
from app.seed_data import THEMES
from app.seed_variants import VARIANTS

# 문제의 정답 (보통은 seed_data.py, 쉬움/어려움은 seed_variants.py) - 바뀌면 이 표도 함께 확인
EXPECTED = {
    "horror": [("4444", "31337", "6667"), ("lee", "lee", "park"), ("62", "62", "36"), ("", "", "724"), ("186", "186", "214")],
    "study": [("4324", "4324", "2443"), ("1103", "1103", "0311"), ("서랍속", "서랍속", "서랍속"), ("2347", "2347", "2340"), ("1974", "1974", "1998")],
    "egypt": [("1035", "1035", "2407"), ("사람", "사람", "구멍"), ("6", "12", "13"), ("은", "동", "금"), ("30", "30", "43")],
}


@pytest.mark.parametrize("theme_key", ["study", "horror", "egypt"])
def test_variant_data_is_playable(theme_key):
    base_rooms = next(t for t in THEMES if t["key"] == theme_key)["rooms"]
    assert len(VARIANTS[theme_key]) == len(base_rooms)
    for idx, (base, variants) in enumerate(zip(base_rooms, VARIANTS[theme_key])):
        for diff in ("easy", "hard"):
            room = {**base, **variants[diff]}
            where = f"{theme_key} 방{idx + 1} {diff}"
            ids = [c["id"] for c in room["clues"]]
            assert len(ids) == len(set(ids)), f"{where}: 단서 id 중복"
            for c in room["clues"]:
                x, z = c["pos"]
                assert abs(x) <= 4.3 and abs(z) <= 4.3, f"{where}: {c['id']} 방 밖"
                assert not (abs(z) < 1.2 and abs(x) > 4), f"{where}: {c['id']} 문 앞"
            for a, b in itertools.combinations(room["clues"], 2):
                d = ((a["pos"][0] - b["pos"][0]) ** 2 + (a["pos"][1] - b["pos"][1]) ** 2) ** 0.5
                assert d >= 1.5, f"{where}: {a['id']}·{b['id']} 너무 가까움"
            assert room["answer"].strip() or room.get("minigame"), f"{where}: 풀 것이 없음"
            assert room["hints"], f"{where}: 힌트 없음"
        assert len(variants["easy"].get("hints", base["hints"])) >= len(variants["hard"].get("hints", base["hints"]))


@pytest.mark.parametrize("theme_key", ["study", "horror", "egypt"])
def test_each_difficulty_gets_its_own_problems(theme_key):
    with TestClient(app) as c:
        states = {
            d: c.post("/api/sessions", json={"theme_key": theme_key, "room_count": 5, "time_limit_min": 30, "difficulty": d}).json()
            for d in ("easy", "normal", "hard")
        }
        for d, s in states.items():
            assert s["difficulty"] == d and not any(r["ai_generated"] for r in s["rooms"])
        # 첫 방(열려 있음)의 문제·단서 구성이 난이도마다 다르다 (같은 방이 같으면 정답이 다른지로 확인)
        for slot in range(5):
            answers = [EXPECTED[theme_key][slot][i] for i in range(3)]
            for i, d in enumerate(("easy", "normal", "hard")):
                row = repo.list_session_rooms(states[d]["id"])[slot]
                assert game_logic.check_answer(answers[i], repo.get_session_room(row)["answer"]) or not answers[i]
        e, n, h = (states[d]["rooms"][0] for d in ("easy", "normal", "hard"))
        assert len(e["clues"]) <= len(n["clues"]) <= len(h["clues"])
        # 열려 있는 첫 방은 실제 정답 판정까지
        hard_ans = EXPECTED[theme_key][0][2]
        assert c.post(f"/api/sessions/{states['hard']['id']}/rooms/0/answer", json={"answer": hard_ans}).json()["correct"]
        assert not c.post(f"/api/sessions/{states['easy']['id']}/rooms/0/answer", json={"answer": hard_ans}).json()["correct"] or hard_ans == EXPECTED[theme_key][0][0]


def test_minigame_and_hint_penalty_follow_difficulty():
    with TestClient(app) as c:
        games = {
            d: c.post("/api/sessions", json={"theme_key": "egypt", "room_count": 5, "time_limit_min": 30, "difficulty": d}).json()
            for d in ("easy", "normal", "hard")
        }
        mg = {d: repo.get_session_room(repo.list_session_rooms(g["id"])[4])["minigame"]["difficulty"] for d, g in games.items()}
        assert mg["easy"] < mg["normal"] < mg["hard"]
        base = settings.HINT_PENALTY_SEC
        for d, rate in settings.HINT_PENALTY_RATE.items():
            g = games[d]
            assert g["hint_penalty_sec"] == round(base * rate)
            before = g["remaining_seconds"]
            res = c.post(f"/api/sessions/{g['id']}/rooms/0/hint", json={"level": 0}).json()
            assert res["penalty_sec"] == round(base * rate)
            after = c.get(f"/api/sessions/{g['id']}").json()["remaining_seconds"]
            assert before - after >= res["penalty_sec"] - 2
        assert c.post("/api/sessions", json={"theme_key": "egypt", "difficulty": "nightmare"}).status_code == 422


def test_ai_rooms_follow_difficulty(monkeypatch):
    prompts = []

    class FakeAI(ai_service.AIProvider):
        name = "gemini"

        async def complete(self, system, user, max_tokens=800):
            prompts.append(user)
            return json.dumps({
                "name": "AI 방", "description": "d", "puzzle_type": "math", "question": "q", "answer": "7",
                "hints": ["h1", "h2", "h3"],
                "clues": [{"id": "a", "label": "쪽지", "object": "note", "pos": [0, 0], "text": "7"},
                          {"id": "b", "label": "석판", "object": "tablet", "pos": [1, 1], "text": "?"}],
                "minigame": {"type": "timing", "title": "t", "description": "", "reward": "열쇠", "difficulty": 2},
            }, ensure_ascii=False)

    monkeypatch.setattr(ai_service, "get_provider", lambda: FakeAI())
    monkeypatch.setattr(settings, "AI_PROVIDER", "gemini")
    monkeypatch.setattr(settings, "AI_API_KEY", "k")
    monkeypatch.setattr(settings, "AI_DAILY_LIMIT", 0)
    monkeypatch.setattr(settings, "AI_GAMES_PER_IP_HOUR", 0)
    monkeypatch.setattr(ai_service, "_game_slots", asyncio.Semaphore(2))
    with TestClient(app) as c:
        hard = c.post("/api/sessions", json={"theme_key": "horror", "room_count": 2, "time_limit_min": 30, "difficulty": "hard"}).json()
        assert all("어려움" in p and "함정 단서" in p for p in prompts)
        assert all(r["ai_generated"] for r in hard["rooms"]) and hard["difficulty"] == "hard"
        room = repo.get_session_room(repo.list_session_rooms(hard["id"])[0])
        assert room["minigame"]["difficulty"] >= 4 and len(room["hints"]) == 1
        prompts.clear()
        easy = c.post("/api/sessions", json={"theme_key": "horror", "room_count": 2, "time_limit_min": 30, "difficulty": "easy"}).json()
        assert all("쉬움" in p for p in prompts)
        room = repo.get_session_room(repo.list_session_rooms(easy["id"])[0])
        assert room["minigame"]["difficulty"] <= 2 and len(room["hints"]) == 3


@pytest.mark.parametrize("minutes, normal, easy, hard", [
    (30, 60, 30, 90),      # 30분 → 1분
    (45, 90, 45, 135),     # 45분 → 1분 30초
    (60, 120, 60, 180),    # 60분 → 2분
    (90, 180, 90, 270),    # 90분 → 3분
    (120, 240, 120, 360),  # 120분 → 4분
])
def test_hint_penalty_scales_with_time_limit(minutes, normal, easy, hard):
    """힌트 1회 감점 = 제한 시간 30분마다 1분 (보통 기준) × 난이도 배율"""
    assert game_logic.hint_penalty("normal", minutes) == normal
    assert game_logic.hint_penalty("easy", minutes) == easy
    assert game_logic.hint_penalty("hard", minutes) == hard
    with TestClient(app) as c:
        s = c.post("/api/sessions", json={"theme_key": "study", "room_count": 2, "time_limit_min": minutes}).json()
        assert s["hint_penalty_sec"] == normal
        before = s["remaining_seconds"]
        res = c.post(f"/api/sessions/{s['id']}/rooms/0/hint", json={"level": 0}).json()
        assert res["penalty_sec"] == normal
        assert before - c.get(f"/api/sessions/{s['id']}").json()["remaining_seconds"] >= normal - 2


def test_horror_clues_and_steps_grow_with_difficulty():
    """공포(보안·네트워크): 난이도가 오를수록 방마다 찾아야 할 단서가 늘어난다 (쉬움 < 보통 < 어려움),
    어려움에는 퍼즐이 반드시 있고(4번 방은 보통에서 미니게임만), 계산형 방의 단서에는 정답이 그대로 적혀 있지 않다."""
    base = next(t for t in THEMES if t["key"] == "horror")["rooms"]
    for idx, room in enumerate(base):
        easy = {**room, **VARIANTS["horror"][idx]["easy"]}
        hard = {**room, **VARIANTS["horror"][idx]["hard"]}
        n = [len(easy["clues"]), len(room["clues"]), len(hard["clues"])]
        assert n[0] < n[1] < n[2], f"공포 방{idx + 1} 단서 수 {n}"
        assert len(hard["clues"]) >= 4 and hard["answer"]
        assert len(hard["hints"]) <= len(room["hints"]) <= len(easy["hints"]) or not room["answer"]
        if idx in (2, 4):  # 계산으로 답을 구하는 방(3·5번)은 단서에 정답이 그대로 있으면 안 된다 (1·2번은 후보 중 고르는 방식)
            for c in hard["clues"]:
                assert hard["answer"].lower() not in c["text"].lower(), f"공포 방{idx + 1} 어려움: 단서 {c['id']}에 정답이 그대로 있음"
