"""AI 비용 보호: 하루 한도, IP별 게임 수, 동시 생성 수. 넘으면 오류 없이 기본 방/기본 힌트로 진행."""
import asyncio
import json
import threading
import time

import pytest
from fastapi.testclient import TestClient

from app import ai_service, repository as repo
from app.config import settings
from app.main import app
from app.ratelimit import RateLimiter

ROOM_JSON = json.dumps({
    "name": "AI 방", "description": "d", "puzzle_type": "math", "question": "q", "answer": "42",
    "hints": ["h"], "clues": [{"id": "a", "label": "쪽지", "object": "note", "pos": [0, 0], "text": "4"},
                               {"id": "b", "label": "석판", "object": "tablet", "pos": [1, 1], "text": "2"}],
    "minigame": None,
}, ensure_ascii=False)


@pytest.fixture
def fake_ai(monkeypatch):
    """호출 횟수를 세는 가짜 AI + 테스트마다 새 제한기"""
    calls = {"n": 0, "delay": 0.0}

    class FakeAI(ai_service.AIProvider):
        name = "gemini"

        async def complete(self, system, user, max_tokens=800):
            calls["n"] += 1
            await asyncio.sleep(calls["delay"])
            return ROOM_JSON if "JSON" in user else "힌트 문장"

    monkeypatch.setattr(ai_service, "get_provider", lambda: FakeAI())
    monkeypatch.setattr(settings, "AI_PROVIDER", "gemini")
    monkeypatch.setattr(settings, "AI_API_KEY", "test-key")
    monkeypatch.setattr(settings, "AI_DAILY_LIMIT", 0)
    monkeypatch.setattr(settings, "AI_GAMES_PER_IP_HOUR", 0)
    monkeypatch.setattr(ai_service, "_game_slots", asyncio.Semaphore(2))
    return calls


def _new_game(c, rooms=2):
    return c.post("/api/sessions", json={"theme_key": "horror", "room_count": rooms, "time_limit_min": 30}).json()


def test_daily_limit_falls_back_to_theme_rooms(fake_ai, monkeypatch):
    monkeypatch.setattr(settings, "AI_DAILY_LIMIT", repo.ai_calls_today() + 4)  # 오늘 남은 호출 4번
    with TestClient(app) as c:
        assert c.get("/api/config").json()["ai_calls_left"] == 4
        g1 = _new_game(c, rooms=4)
        assert sum(r["ai_generated"] for r in g1["rooms"]) == 4 and g1["ai_note"] is None
        assert fake_ai["n"] == 4 and c.get("/api/config").json()["ai_calls_left"] == 0

        g2 = _new_game(c, rooms=2)                         # 한도 초과 → AI 호출 없이 기본 방
        assert not any(r["ai_generated"] for r in g2["rooms"])
        assert "한도" in g2["ai_note"] and fake_ai["n"] == 4
        assert c.get(f"/api/sessions/{g2['id']}").json()["ai_note"] == g2["ai_note"]  # 다시 조회해도 안내 유지

        # 힌트도 같은 한도를 쓴다 → 초과면 AI 를 부르지 않고 기본 힌트
        res = c.post(f"/api/sessions/{g2['id']}/rooms/0/hint", json={"level": 0}).json()
        assert res["source"] == "mock" and fake_ai["n"] == 4


def test_games_per_ip_limit(fake_ai, monkeypatch):
    monkeypatch.setattr(settings, "AI_GAMES_PER_IP_HOUR", 2)
    monkeypatch.setattr(ai_service, "_game_limiter", RateLimiter(limit=2, window_sec=3600))
    with TestClient(app) as c:
        assert all(_new_game(c)["ai_note"] is None for _ in range(2))
        third = _new_game(c)
        assert "1시간에 2번" in third["ai_note"] and not any(r["ai_generated"] for r in third["rooms"])
        assert fake_ai["n"] == 4                            # 세 번째 게임은 AI 호출 0번


def test_concurrent_generation_cap(fake_ai, monkeypatch):
    monkeypatch.setattr(ai_service, "_game_slots", asyncio.Semaphore(1))
    fake_ai["delay"] = 2.0                                  # 첫 게임이 방을 만드는 동안 두 번째 요청
    results = {}
    with TestClient(app) as c:
        def first():
            results["first"] = _new_game(c)

        t = threading.Thread(target=first)
        t.start()
        deadline = time.time() + 10
        while fake_ai["n"] == 0 and time.time() < deadline:  # 첫 게임이 AI 를 부르기 시작할 때까지 (느린 CI 대비)
            time.sleep(0.02)
        assert fake_ai["n"] > 0
        results["second"] = _new_game(c)
        t.join()
    assert results["first"]["ai_note"] is None and all(r["ai_generated"] for r in results["first"]["rooms"])
    assert "만드는 중" in results["second"]["ai_note"]
    assert not any(r["ai_generated"] for r in results["second"]["rooms"])


def test_reserve_is_atomic_under_threads(monkeypatch):
    start = repo.ai_calls_today()
    ok = []
    barrier = threading.Barrier(10)

    def go():
        barrier.wait()
        ok.append(repo.reserve_ai_calls(1, start + 3))

    threads = [threading.Thread(target=go) for _ in range(10)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sum(ok) == 3 and repo.ai_calls_today() == start + 3   # 10개가 동시에 와도 3개만 통과
