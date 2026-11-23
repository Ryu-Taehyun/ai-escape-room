"""보안 보완 테스트: 관리자 로그인 잠금, 동시 요청, 방 코드 대입, 생성 폭주, WebSocket 제한, 보안 헤더."""
import threading

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import ratelimit, repository as repo
from app.config import Settings
from app.main import app
from app.ratelimit import LoginGuard, login_guard
from app.routers import admin as admin_router


@pytest.fixture(autouse=True)
def _no_delay(monkeypatch):
    monkeypatch.setattr(admin_router, "FAIL_DELAY_SEC", 0)


class Clock:
    def __init__(self):
        self.t = 1_000_000.0

    def __call__(self):
        return self.t


def test_lockout_grows_each_time(monkeypatch):
    clock = Clock()
    monkeypatch.setattr(ratelimit.time, "time", clock)
    g = LoginGuard()
    locks = []
    for _ in range(4):
        for _ in range(5):
            assert g.begin("1.1.1.1") == 0
            info = g.failure("1.1.1.1")
        locks.append(info["locked_sec"])
        assert g.begin("1.1.1.1") > 0  # 잠금 중
        clock.t += info["locked_sec"] + 1
    assert locks == [60, 120, 240, 480]  # 잠길 때마다 2배
    # 하루 조용하면 잠금 단계 초기화
    clock.t += 86400 + 1
    for _ in range(5):
        g.begin("1.1.1.1")
        info = g.failure("1.1.1.1")
    assert info["locked_sec"] == 60


def test_lockout_is_capped(monkeypatch):
    clock = Clock()
    monkeypatch.setattr(ratelimit.time, "time", clock)
    g = LoginGuard()
    for _ in range(10):
        for _ in range(5):
            g.begin("ip")
            info = g.failure("ip")
        clock.t += info["locked_sec"] + 1
    assert info["locked_sec"] == 1800  # 최대 30분


def test_parallel_attempts_cannot_exceed_limit():
    """동시에 50개 시도를 보내도 허용되는 것은 5개뿐 (검사와 기록이 한 번에 일어남)"""
    g = LoginGuard()
    allowed = []
    barrier = threading.Barrier(50)

    def attempt():
        barrier.wait()
        if g.begin("9.9.9.9") == 0:
            allowed.append(1)

    threads = [threading.Thread(target=attempt) for _ in range(50)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(allowed) == 5


def test_alert_mode_against_many_ips():
    """여러 IP 로 나눠 시도하면 경계 모드: 틀린 적 있는 IP 는 한 번만 더 틀려도 잠긴다.
    한 번도 틀리지 않은 (관리자) IP 는 정답으로 로그인 가능."""
    g = LoginGuard()
    for i in range(30):
        ip = f"10.0.0.{i}"
        g.begin(ip)
        g.failure(ip)
    # 이미 한 번 틀린 IP: 한 번 더 시도하면 잠김
    assert g.begin("10.0.0.1") > 0
    # 새 IP: 한 번은 시도 가능, 틀리면 바로 잠김
    assert g.begin("10.0.1.1") == 0
    assert g.failure("10.0.1.1")["locked_sec"] > 0
    # 관리자: 첫 시도는 허용 → 정답이면 success
    assert g.begin("192.168.0.10") == 0
    g.success("192.168.0.10")


def test_login_api_lock_audit_and_odd_passwords():
    with TestClient(app) as c:
        login_guard.clear()
        assert c.post("/api/admin/login", json={"password": "비밀번호한글"}).status_code == 401  # 500 이 아님
        assert c.post("/api/admin/login", json={"password": "x" * 300}).status_code == 422
        r = c.post("/api/admin/login", json={"password": "nope"})
        assert r.status_code == 401 and "남음" in r.json()["detail"]
        for _ in range(3):
            r = c.post("/api/admin/login", json={"password": "nope"})
        assert r.status_code == 429 and int(r.headers["Retry-After"]) >= 59
        # 잠긴 동안에는 맞는 비밀번호도 거부
        assert c.post("/api/admin/login", json={"password": "test-pw"}).status_code == 429
        login_guard.clear()
        token = c.post("/api/admin/login", json={"password": "test-pw"}).json()["token"]
        h = {"X-Admin-Token": token}
        assert len(c.get("/api/admin/logs?limit=-5", headers=h).json()) == 1  # 음수 → 전체가 아니라 1건
        logs = c.get("/api/admin/logs?limit=50", headers=h).json()
        events = [l["payload"] for l in logs if l["actor"] == "security"]
        assert any('"locked"' in p for p in events) and any('"success"' in p for p in events)
        assert c.get("/api/admin/themes", headers={"X-Admin-Token": "a" * 200}).status_code == 422


def test_admin_tokens_are_capped():
    with TestClient(app) as c:
        admin_router._tokens.clear()
        for _ in range(admin_router.MAX_TOKENS + 5):
            login_guard.clear()
            c.post("/api/admin/login", json={"password": "test-pw"})
        assert len(admin_router._tokens) == admin_router.MAX_TOKENS


def test_session_code_guessing_is_blocked():
    with TestClient(app) as c:
        codes = [c.get(f"/api/sessions/ZZ{i:04d}").status_code for i in range(22)]
        assert codes[:20] == [404] * 20 and codes[20] == 429
        # 차단 중에는 WebSocket 으로도 찾을 수 없다
        with pytest.raises(WebSocketDisconnect) as e:
            with c.websocket_connect("/ws/ZZ9999?name=x") as ws:
                ws.receive_json()
        assert e.value.code == 4429


def test_session_creation_flood_is_limited():
    with TestClient(app) as c:
        codes = [c.post("/api/sessions", json={"theme_key": "egypt", "room_count": 2}).status_code for _ in range(21)]
        assert codes[:20] == [200] * 20 and codes[20] == 429


def test_parallel_answers_cannot_exceed_limit():
    with TestClient(app) as c:
        sid = c.post("/api/sessions", json={"theme_key": "egypt", "room_count": 2}).json()["id"]
        results = []
        barrier = threading.Barrier(15)

        def guess(n):
            barrier.wait()
            results.append(c.post(f"/api/sessions/{sid}/rooms/0/answer", json={"answer": f"{n:04d}"}).status_code)

        threads = [threading.Thread(target=guess, args=(n,)) for n in range(15)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert results.count(200) <= 6


def test_websocket_origin_room_cap_and_big_messages():
    with TestClient(app) as c:
        sid = c.post("/api/sessions", json={"theme_key": "egypt", "room_count": 2}).json()["id"]
        with pytest.raises(WebSocketDisconnect) as e:
            with c.websocket_connect(f"/ws/{sid}?name=x", headers={"origin": "https://evil.example"}) as ws:
                ws.receive_json()
        assert e.value.code == 4403
        # 허용된 주소에서는 접속 가능
        with c.websocket_connect(f"/ws/{sid}?name=ok", headers={"origin": "http://localhost:5173"}) as ws:
            assert ws.receive_json()["type"] == "welcome"
            ws.send_text("x" * 10000)  # 너무 큰 메시지는 무시 (연결 유지)
            ws.send_json({"type": "ping"})
            while (m := ws.receive_json())["type"] != "pong":
                pass
        # 방 인원 상한 (8명)
        from contextlib import ExitStack
        with ExitStack() as stack:
            for i in range(8):
                ws = stack.enter_context(c.websocket_connect(f"/ws/{sid}?name=p{i}"))
                ws.receive_json()
            with pytest.raises(WebSocketDisconnect) as e:
                with c.websocket_connect(f"/ws/{sid}?name=ninth") as ws9:
                    ws9.receive_json()
            assert e.value.code == 4409


def test_security_headers_and_cors():
    with TestClient(app) as c:
        r = c.get("/api/health")
        assert r.headers["x-content-type-options"] == "nosniff"
        assert r.headers["x-frame-options"] == "DENY"
        assert r.headers["referrer-policy"] == "no-referrer"
        pre = c.options("/api/sessions", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"})
        assert pre.headers.get("access-control-allow-credentials") is None
        pre = c.options("/api/sessions", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
        assert "access-control-allow-origin" not in pre.headers
        login_guard.clear()
        tok = c.post("/api/admin/login", json={"password": "test-pw"}).json()["token"]
        assert c.get("/api/admin/themes", headers={"X-Admin-Token": tok}).headers["cache-control"] == "no-store"


def test_weak_password_rules(monkeypatch):
    s = Settings()
    for pw, weak in [("admin1234", True), ("short1A", True), ("aaaaaaaaaaaaaa", True), ("correct-horse-9", False), ("Tr0ub4dor&3xyz", False)]:
        s.ADMIN_PASSWORD = pw
        assert s.admin_password_is_weak == weak, pw
    s.APP_ENV = "production"
    s.ADMIN_PASSWORD = "short1A"
    with pytest.raises(RuntimeError):
        s.check_startup()
    s.ADMIN_PASSWORD = "correct-horse-9"
    s.check_startup()
