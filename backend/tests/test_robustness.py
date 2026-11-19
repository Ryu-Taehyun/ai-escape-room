"""코드 리뷰 반영 사항 테스트: WebSocket 입력 검증·빈도 제한, 동시 정답, 테마 생성 트랜잭션, 운영 설정."""
import threading

import pytest
from fastapi.testclient import TestClient

from app import ai_service, game_logic, repository as repo
from app.config import settings
from app.main import app


def _drain_until(ws, kind: str, limit: int = 20) -> dict:
    for _ in range(limit):
        msg = ws.receive_json()
        if msg.get("type") == kind:
            return msg
    raise AssertionError(f"{kind} 메시지를 받지 못함")


def test_game_error_handler_and_sid_normalization():
    with TestClient(app) as c:
        res = c.get("/api/sessions/zzzzzz")
        assert res.status_code == 404 and "세션" in res.json()["detail"]
        sid = c.post("/api/sessions", json={"theme_key": "egypt", "room_count": 2, "time_limit_min": 30}).json()["id"]
        assert c.get(f"/api/sessions/{sid.lower()}").json()["id"] == sid  # 소문자 코드도 같은 방
        # 잠긴 방 조작 → GameError → 400 + detail
        res = c.post(f"/api/sessions/{sid}/rooms/1/answer", json={"answer": "x"})
        assert res.status_code == 400 and "잠겨" in res.json()["detail"]


def test_websocket_ignores_bad_input_and_limits_chat():
    with TestClient(app) as c:
        sid = c.post("/api/sessions", json={"theme_key": "egypt", "room_count": 2, "time_limit_min": 30}).json()["id"]
        with c.websocket_connect(f"/ws/{sid}?name=QA") as ws:
            assert ws.receive_json()["type"] == "welcome"
            # 예전에는 아래 메시지들이 AttributeError / ValueError 로 소켓을 끊었다
            ws.send_text("[1, 2, 3]")
            ws.send_text('"move"')
            ws.send_json({"type": "move", "position": [0, 1.6, 0], "rotation": "abc", "slot": 0})
            ws.send_json({"type": "move", "position": [0, 1.6, 0], "rotation": 0, "slot": "x"})
            ws.send_text('{"type": "move", "position": [0, 1.6, 0], "rotation": NaN, "slot": 0}')
            ws.send_json({"type": "move", "position": [True, 1.6, 0], "rotation": 0, "slot": 0})
            ws.send_json({"type": "chat", "text": {"x": 1}})
            ws.send_json({"type": "restart", "session_id": 123})
            ws.send_json({"type": "ping"})
            assert _drain_until(ws, "pong")  # 아직 연결되어 있음

            # 채팅: 5초에 5번까지, 넘치면 본인에게만 안내
            for i in range(7):
                ws.send_json({"type": "chat", "text": f"msg{i}"})
            texts = []
            while len(texts) < 7:
                m = _drain_until(ws, "chat")
                texts.append((m["name"], m["text"]))
            sent = [t for n, t in texts if n == "QA"]
            notices = [t for n, t in texts if n == "SYSTEM" and "너무 빨리" in t]
            assert sent == [f"msg{i}" for i in range(5)] and len(notices) == 2


def test_concurrent_correct_answers_clear_once():
    sid = game_logic.create_session("egypt", 2, 30)
    slot_row = repo.list_session_rooms(sid)[0]
    answer = repo.get_session_room(slot_row)["answer"].split("|")[0]
    results, barrier = [], threading.Barrier(8)

    def submit(i):
        barrier.wait()
        results.append(game_logic.submit_answer(sid, 0, answer, f"P{i}"))

    threads = [threading.Thread(target=submit, args=(i,)) for i in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert all(r[0] for r in results)                                  # 모두 정답 처리
    assert sum(r[1].startswith("정답!") for r in results) == 1         # 처음 푼 한 명만 "정답!"
    assert sum(r[2] for r in results) <= 1                             # 방 클리어도 최대 한 번
    rooms = repo.list_session_rooms(sid)
    assert rooms[0]["puzzle_solved"] == 1


def test_create_theme_is_atomic_and_parallel(monkeypatch):
    with TestClient(app) as c:
        token = c.post("/api/admin/login", json={"password": "test-pw"}).json()["token"]
        h = {"X-Admin-Token": token}
        before = len(c.get("/api/themes").json())

        # 1) 방 하나 생성 중 예외 → mock 으로 대체되어 테마는 방 5개로 생성
        real = ai_service.generate_room

        async def flaky(theme, idx, prompt=""):
            if idx == 2:
                raise RuntimeError("AI 오류")
            return await real(theme, idx, prompt)

        monkeypatch.setattr(ai_service, "generate_room", flaky)
        res = c.post("/api/admin/themes", headers=h, json={"name": "실험실", "description": "d", "concept_prompt": "연구소"})
        assert res.status_code == 200 and len(res.json()["rooms"]) == settings.ROOMS_PER_THEME

        # 2) 저장 중 4번째 방에서 DB 오류 → 테마가 반쯤 남지 않음
        real_insert = repo._insert_room

        def broken(conn, theme_id, order_idx, data, source):
            if order_idx == 3:
                raise RuntimeError("디스크 오류")
            return real_insert(conn, theme_id, order_idx, data, source)

        monkeypatch.setattr(repo, "_insert_room", broken)
        with pytest.raises(RuntimeError):
            c.post("/api/admin/themes", headers=h, json={"name": "망가진 테마", "description": "d", "concept_prompt": ""})
        themes = c.get("/api/themes").json()
        assert len(themes) == before + 1 and not any(t["name"] == "망가진 테마" for t in themes)


def test_production_refuses_default_password(monkeypatch):
    monkeypatch.setattr(settings, "APP_ENV", "production")
    monkeypatch.setattr(settings, "ADMIN_PASSWORD", "change-me")
    with pytest.raises(RuntimeError, match="ADMIN_PASSWORD"):
        settings.check_startup()
    monkeypatch.setattr(settings, "ADMIN_PASSWORD", "a-strong-password")
    settings.check_startup()  # 바꾸면 통과
    monkeypatch.setattr(settings, "APP_ENV", "development")
    monkeypatch.setattr(settings, "ADMIN_PASSWORD", "change-me")
    settings.check_startup()  # 개발 환경은 경고만


def test_client_ip_behind_proxy(monkeypatch):
    from starlette.requests import Request

    from app.deps import client_ip

    def req(xff=None):
        headers = [(b"x-forwarded-for", xff.encode())] if xff else []
        return Request({"type": "http", "headers": headers, "client": ("10.0.0.1", 1234)})

    monkeypatch.setattr(settings, "TRUST_PROXY", False)
    assert client_ip(req("1.1.1.1")) == "10.0.0.1"         # 기본: 헤더 무시 (위조 방지)
    monkeypatch.setattr(settings, "TRUST_PROXY", True)
    assert client_ip(req("6.6.6.6, 203.0.113.7")) == "203.0.113.7"  # 프록시가 붙인 마지막 값
    assert client_ip(req()) == "10.0.0.1"
