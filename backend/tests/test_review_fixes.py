"""코드 리뷰 반영: 관리자 비밀번호 기본값 제거, AI 시간 초과 작업 정리, notice 오류 기록."""
import asyncio
import logging
import os
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import ai_service, ws_manager
from app.config import Settings, settings
from app.main import app


def test_no_default_admin_password_in_code(tmp_path):
    """ADMIN_PASSWORD 를 주지 않으면 비어 있다 (코드에 기본 비밀번호 없음). 별도 프로세스에서 확인"""
    env = {k: v for k, v in os.environ.items() if k != "ADMIN_PASSWORD"}
    env["DATABASE_PATH"] = str(tmp_path / "x.db")
    # backend/.env 가 있으면 그 값을 읽으므로, .env 가 없는 임시 폴더를 BASE_DIR 처럼 쓰지 않고 load_dotenv 를 막는다
    code = "import dotenv; dotenv.load_dotenv = lambda *a, **k: None; from app.config import settings as s; print(repr(s.ADMIN_PASSWORD), s.admin_login_enabled)"
    out = subprocess.run([sys.executable, "-c", code], cwd=Path(__file__).resolve().parents[1], env=env, capture_output=True, text=True, check=True)
    assert out.stdout.strip() == "'' False"


def test_empty_password_disables_admin_login(monkeypatch):
    monkeypatch.setattr(settings, "ADMIN_PASSWORD", "")
    with TestClient(app) as c:
        r = c.post("/api/admin/login", json={"password": ""})
        assert r.status_code == 503 and "ADMIN_PASSWORD" in r.json()["detail"]


def test_production_requires_admin_password():
    s = Settings()
    s.APP_ENV = "production"
    s.ADMIN_PASSWORD = ""
    with pytest.raises(RuntimeError, match="반드시 입력"):
        s.check_startup()


def test_timed_out_ai_rooms_are_cancelled_and_awaited(monkeypatch):
    finished = {"cancelled": 0}

    class SlowAI(ai_service.AIProvider):
        name = "gemini"

        async def complete(self, system, user, max_tokens=800):
            try:
                await asyncio.sleep(30)
            except asyncio.CancelledError:
                finished["cancelled"] += 1
                raise
            return "{}"

    monkeypatch.setattr(settings, "AI_TIMEOUT_SEC", 0.2)
    rooms = [{"name": f"r{i}", "description": "", "puzzle_type": "code", "question": "q", "answer": "1",
              "hints": ["h"], "clues": [], "minigame": None} for i in range(3)]

    async def run():
        out = await ai_service._generate_rooms(SlowAI(), {"key": "egypt", "name": "t", "description": ""}, rooms)
        # _generate_rooms 가 돌아왔을 때 취소된 작업이 이미 모두 정리되어 있어야 한다
        leftover = [t for t in asyncio.all_tasks() if t is not asyncio.current_task()]
        return out, leftover

    out, leftover = asyncio.run(run())
    assert out == {} and finished["cancelled"] >= 1 and leftover == []  # 남은 작업 없음 = 취소한 작업을 끝까지 기다림


def test_notice_failure_is_logged(caplog):
    class BrokenWS:
        async def send_json(self, _):
            raise RuntimeError("socket closed")

    player = ws_manager.Player(id="p1", name="x", ws=BrokenWS())
    with caplog.at_level(logging.DEBUG, logger=ws_manager.log.name):
        asyncio.run(ws_manager.manager.notice(player, "hi"))
    assert any("notice 전송 실패" in r.message for r in caplog.records)
