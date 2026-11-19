"""Gemini provider: 실제 키 없이 가짜 응답으로 요청 형식과 응답 파싱을 검사."""
import asyncio
import json

import httpx

from app import ai_service
from app.config import settings


def test_gemini_provider(monkeypatch):
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["key"] = request.headers.get("x-goog-api-key")
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [
            {"text": "생각 중...", "thought": True},
            {"text": "벽의 숫자를 다시 보세요."},
        ]}}]})

    real_client = httpx.AsyncClient
    monkeypatch.setattr(ai_service.httpx, "AsyncClient", lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw))
    monkeypatch.setattr(settings, "AI_PROVIDER", "gemini")
    monkeypatch.setattr(settings, "AI_API_KEY", "test-key")
    monkeypatch.setattr(settings, "AI_MODEL", "gemini-2.5-flash")

    room = {"name": "방", "question": "Q", "answer": "12", "clues": [], "minigame": None, "hints": ["h"]}
    text, source = asyncio.run(ai_service.generate_hint(room, 1))

    assert source == "gemini" and text == "벽의 숫자를 다시 보세요."
    assert seen["url"].endswith("/models/gemini-2.5-flash:generateContent")
    assert seen["key"] == "test-key"
    assert seen["body"]["systemInstruction"]["parts"][0]["text"]
    assert seen["body"]["contents"][0]["role"] == "user"


def test_gemini_failure_falls_back_to_mock(monkeypatch):
    real_client = httpx.AsyncClient
    transport = httpx.MockTransport(lambda r: httpx.Response(429, json={"error": {"message": "quota"}}))
    monkeypatch.setattr(ai_service.httpx, "AsyncClient", lambda **kw: real_client(transport=transport, **kw))
    monkeypatch.setattr(settings, "AI_PROVIDER", "gemini")
    monkeypatch.setattr(settings, "AI_API_KEY", "test-key")
    room = {"name": "방", "question": "Q", "answer": "12", "clues": [], "minigame": None, "hints": ["h"]}
    _, source = asyncio.run(ai_service.generate_hint(room, 1))
    assert source == "mock"


def test_random_rooms_each_game(monkeypatch):
    """API 키가 있으면 게임마다 AI 가 방 문제를 새로 만들고, 실패한 방은 기본 방으로 진행."""
    from fastapi.testclient import TestClient

    from app.main import app

    calls = {"n": 0}

    class FakeAI(ai_service.AIProvider):
        name = "gemini"

        async def complete(self, system, user, max_tokens=800):
            calls["n"] += 1
            n = calls["n"]
            if "마지막 방" in user:
                raise RuntimeError("quota exceeded")      # 최종 방은 실패 → 기본 방
            if n == 2:
                return "죄송합니다, JSON 이 아닙니다"       # 형식 오류 → 기본 방
            return "```json\n" + json.dumps({
                "name": f"AI 방 {n}", "description": "새로 만든 방", "puzzle_type": "math",
                "question": "단서를 모아 숫자를 입력하라", "answer": f"{n}{n}{n}",
                "hints": ["벽을 보세요"],
                "clues": [
                    {"id": "A", "label": "쪽지", "object": "note", "pos": [99, 99], "text": f"앞자리 {n}"},
                    {"id": "A", "label": "석판", "object": "tablet", "pos": [0, 0], "text": f"뒷자리 {n}{n}"},
                ],
                "minigame": None,
            }, ensure_ascii=False) + "\n```"

    monkeypatch.setattr(ai_service, "get_provider", lambda: FakeAI())
    monkeypatch.setattr(settings, "AI_PROVIDER", "gemini")
    monkeypatch.setattr(settings, "AI_API_KEY", "test-key")

    with TestClient(app) as c:
        s = c.post("/api/sessions", json={"theme_key": "horror", "room_count": 4, "time_limit_min": 30}).json()
        rooms = s["rooms"]
        ai_rooms = [r for r in rooms if r["ai_generated"]]
        assert len(ai_rooms) == 2                      # 4개 중 형식 오류 1개, 최종 방 실패 1개
        assert not rooms[-1]["ai_generated"] and rooms[-1]["is_final"]
        first = rooms[0]
        assert first["ai_generated"] and first["name"].startswith("AI 방")
        # 단서 id 중복 제거 + 위치는 안전한 자리로 재배치
        ids = [cl["id"] for cl in first["clues"]]
        assert len(set(ids)) == len(ids) == 2
        assert all(abs(x) <= 4.3 and abs(z) <= 4.3 for x, z in (cl["pos"] for cl in first["clues"]))
        # 정답 판정은 AI 가 만든 정답 기준
        n = first["name"].split()[-1]
        sid = s["id"]
        assert not c.post(f"/api/sessions/{sid}/rooms/0/answer", json={"answer": "1035"}).json()["correct"]
        assert c.post(f"/api/sessions/{sid}/rooms/0/answer", json={"answer": n * 3}).json()["correct"]

        # 다음 게임은 또 새로 생성 (테마의 기본 방은 그대로)
        s2 = c.post("/api/sessions", json={"theme_key": "horror", "room_count": 2, "time_limit_min": 30}).json()
        assert s2["rooms"][0]["name"] != first["name"]
        themes = {t["key"]: t for t in c.get("/api/themes").json()}
        assert not any(name.startswith("AI 방") for name in themes["horror"]["room_names"])
        assert c.get("/api/config").json()["ai_random_rooms"] in (True, False)


def test_no_key_keeps_theme_rooms():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        s = c.post("/api/sessions", json={"theme_key": "horror", "room_count": 2, "time_limit_min": 30}).json()
        assert not any(r["ai_generated"] for r in s["rooms"])
