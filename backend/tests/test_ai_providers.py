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
