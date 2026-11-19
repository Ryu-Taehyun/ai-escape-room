"""QA 자동 테스트 (구성원 4).  실행: cd backend && pytest -q"""
import os
import tempfile

os.environ["DATABASE_PATH"] = os.path.join(tempfile.mkdtemp(), "test.db")
os.environ["AI_PROVIDER"] = "mock"
os.environ["ADMIN_PASSWORD"] = "test-pw"

from fastapi.testclient import TestClient  # noqa: E402

from app.game_logic import check_answer, select_rooms  # noqa: E402
from app.main import app  # noqa: E402


def test_select_rooms_keeps_entrance_and_final():
    rooms = [{"id": i} for i in range(5)]
    assert [r["id"] for r in select_rooms(rooms, 2)] == [0, 4]
    assert [r["id"] for r in select_rooms(rooms, 4)] == [0, 1, 2, 4]
    assert [r["id"] for r in select_rooms(rooms, 5)] == [0, 1, 2, 3, 4]


def test_check_answer_normalizes():
    assert check_answer(" Help ", "HELP")
    assert check_answer("인간", "사람|인간")
    assert not check_answer("dog", "사람|인간")


def test_full_game_flow_with_clues_and_minigame():
    with TestClient(app) as c:
        cfg = c.get("/api/config").json()
        assert cfg["default_rooms"] == 4 and cfg["min_time_min"] == 30 and cfg["max_time_min"] == 120

        assert c.post("/api/sessions", json={"theme_key": "horror", "room_count": 6, "time_limit_min": 60}).status_code == 422
        assert c.post("/api/sessions", json={"theme_key": "horror", "room_count": 4, "time_limit_min": 20}).status_code == 422

        # 2개 방: 서버실(퍼즐) → 최종 통제실(퍼즐 + 미니게임 timing)
        state = c.post("/api/sessions", json={"theme_key": "horror", "room_count": 2, "time_limit_min": 30}).json()
        sid = state["id"]
        assert [r["status"] for r in state["rooms"]] == ["unlocked", "locked"]
        assert state["rooms"][1]["question"] == ""  # 잠긴 방 문제 비공개
        assert all(cl["text"] == "" for cl in state["rooms"][0]["clues"])  # 조사 전 단서 내용 비공개

        # 단서 조사 → 팀 인벤토리
        res = c.post(f"/api/sessions/{sid}/rooms/0/clues/memo/inspect", json={"player_name": "A"}).json()
        assert res["new"] and "빨강" in res["clue"]["text"]
        assert c.post(f"/api/sessions/{sid}/rooms/0/clues/memo/inspect", json={"player_name": "B"}).json()["new"] is False
        assert any(i["kind"] == "clue" and i["ref_id"] == "memo" for i in res["state"]["inventory"])
        assert c.post(f"/api/sessions/{sid}/rooms/1/clues/manual/inspect", json={}).status_code == 400  # 잠긴 방

        # 1번 방 퍼즐
        assert c.post(f"/api/sessions/{sid}/rooms/0/answer", json={"answer": "0000"}).json()["correct"] is False
        res = c.post(f"/api/sessions/{sid}/rooms/0/answer", json={"answer": "3142", "player_name": "A"}).json()
        assert res["correct"] and res["state"]["rooms"][1]["status"] == "unlocked"

        # 최종 방: 암호만 풀면 아직 클리어 아님 (열쇠 필요)
        res = c.post(f"/api/sessions/{sid}/rooms/1/answer", json={"answer": "58"}).json()
        assert res["correct"] and res["state"]["status"] == "playing" and "마스터 키" in res["message"]
        # 열쇠 없이 사용 불가
        assert c.post(f"/api/sessions/{sid}/rooms/1/use-key", json={}).status_code == 400

        # 미니게임 실패 → 재시도 → 성공
        ch = c.post(f"/api/sessions/{sid}/rooms/1/minigame/start").json()
        assert ch["type"] == "timing"
        fail = c.post(f"/api/sessions/{sid}/rooms/1/minigame/finish",
                      json={"challenge_id": ch["challenge_id"], "result": {"hits": 0}}).json()
        assert fail["success"] is False
        ch = c.post(f"/api/sessions/{sid}/rooms/1/minigame/start").json()
        import time; time.sleep(1.05)
        ok = c.post(f"/api/sessions/{sid}/rooms/1/minigame/finish",
                    json={"challenge_id": ch["challenge_id"], "result": {"hits": 3}, "player_name": "B"}).json()
        assert ok["success"] and ok["state"]["rooms"][1]["minigame"]["key_obtained"]
        # 같은 challenge 재사용 불가
        assert c.post(f"/api/sessions/{sid}/rooms/1/minigame/finish",
                      json={"challenge_id": ch["challenge_id"], "result": {"hits": 3}}).json()["success"] is False

        # 힌트
        hint = c.post(f"/api/sessions/{sid}/rooms/1/hint", json={"level": 0}).json()
        assert hint["hint"] and hint["source"] == "mock"

        # 문에서 열쇠 사용 → 탈출
        res = c.post(f"/api/sessions/{sid}/rooms/1/use-key", json={"player_name": "B"}).json()
        assert res["state"]["status"] == "escaped"


def test_minigame_verification():
    from app import minigames
    ch = minigames.create_challenge("S", 0, {"type": "sequence", "difficulty": 2}, "server")
    assert minigames.verify(ch.id, "S", 0, {"input": ch.params["sequence"]})[0]
    ch = minigames.create_challenge("S", 0, {"type": "sequence", "difficulty": 2}, "server")
    assert not minigames.verify(ch.id, "S", 0, {"input": [9, 9]})[0]

    ch = minigames.create_challenge("S", 0, {"type": "wires", "difficulty": 2}, "server")
    left, right = ch.params["left"], ch.params["right"]
    pairs = [[i, right.index(color)] for i, color in enumerate(left)]
    assert minigames.verify(ch.id, "S", 0, {"pairs": pairs})[0]
    ch = minigames.create_challenge("S", 0, {"type": "wires", "difficulty": 2}, "server")
    assert not minigames.verify(ch.id, "S", 0, {"pairs": [[i, i] for i in range(len(left))]})[0]
    # 다른 세션의 challenge 는 거부
    ch = minigames.create_challenge("S", 0, {"type": "wires", "difficulty": 2}, "server")
    assert not minigames.verify(ch.id, "OTHER", 0, {"pairs": pairs})[0]


def test_minigame_only_room():
    """폐쇄된 지하 통로(퍼즐 없음, 미니게임만) — 5개 방 세션의 4번째 방"""
    with TestClient(app) as c:
        token = c.post("/api/admin/login", json={"password": "test-pw"}).json()["token"]
        sid = c.post("/api/sessions", json={"theme_key": "horror", "room_count": 5}).json()["id"]
        c.post(f"/api/admin/sessions/{sid}/rooms/3/unlock", headers={"X-Admin-Token": token})
        room = c.get(f"/api/sessions/{sid}").json()["rooms"][3]
        assert room["has_puzzle"] is False and room["minigame"]["type"] == "sequence"
        assert c.post(f"/api/sessions/{sid}/rooms/3/answer", json={"answer": "x"}).status_code == 400
        ch = c.post(f"/api/sessions/{sid}/rooms/3/minigame/start").json()
        c.post(f"/api/sessions/{sid}/rooms/3/minigame/finish",
               json={"challenge_id": ch["challenge_id"], "result": {"input": ch["params"]["sequence"]}})
        res = c.post(f"/api/sessions/{sid}/rooms/3/use-key", json={"player_name": "A"}).json()
        assert res["state"]["rooms"][3]["status"] == "cleared"
        assert res["state"]["rooms"][4]["status"] == "unlocked"


def test_websocket_coop():
    with TestClient(app) as c:
        sid = c.post("/api/sessions", json={"theme_key": "egypt"}).json()["id"]
        with c.websocket_connect(f"/ws/{sid}?name=A") as a:
            assert a.receive_json()["type"] == "welcome"
            a.receive_json()  # 입장 chat
            with c.websocket_connect(f"/ws/{sid}?name=B") as b:
                welcome = b.receive_json()
                assert len(welcome["players"]) == 2
                assert a.receive_json()["type"] == "player_joined"
                b.send_json({"type": "move", "position": [1, 1.6, 2], "rotation": 0.5, "slot": 0})
                msgs = [a.receive_json() for _ in range(2)]  # 입장 chat + move
                assert any(m["type"] == "player_moved" and m["position"] == [1, 1.6, 2] for m in msgs)


def test_admin_edit_and_ai():
    with TestClient(app) as c:
        assert c.post("/api/admin/login", json={"password": "wrong"}).status_code == 401
        token = c.post("/api/admin/login", json={"password": "test-pw"}).json()["token"]
        h = {"X-Admin-Token": token}
        assert c.get("/api/admin/themes").status_code == 401
        themes = c.get("/api/admin/themes", headers=h).json()
        room = themes[0]["rooms"][0]
        updated = c.put(f"/api/admin/rooms/{room['id']}", headers=h, json={"answer": "1234"}).json()
        assert updated["answer"] == "1234" and updated["source"] == "admin"

        draft = c.post("/api/admin/ai/generate-room", headers=h,
                       json={"theme_id": themes[1]["id"], "order_idx": 2, "prompt": "거울"}).json()
        assert draft["question"] and draft["answer"] and len(draft["clues"]) >= 2

        new_theme = c.post("/api/admin/themes", headers=h,
                           json={"name": "Space Station", "concept_prompt": "우주정거장"}).json()
        assert len(new_theme["rooms"]) == 5
        assert all(r["clues"] for r in new_theme["rooms"]) and new_theme["rooms"][4]["minigame"]

        # 관리자: 단서/미니게임 편집 및 제거
        rid = themes[0]["rooms"][1]["id"]
        upd = c.put(f"/api/admin/rooms/{rid}", headers=h, json={
            "clues": [{"id": "x", "label": "새 단서", "object": "statue", "pos": [1, 2], "text": "비밀"}],
            "minigame": {"type": "wires", "title": "T", "reward": "R", "difficulty": 3}}).json()
        assert upd["clues"][0]["label"] == "새 단서" and upd["minigame"]["difficulty"] == 3
        upd = c.put(f"/api/admin/rooms/{rid}", headers=h, json={"remove_minigame": True}).json()
        assert upd["minigame"] is None

        sid = c.post("/api/sessions", json={"theme_key": "egypt", "room_count": 3}).json()["id"]
        assert c.post(f"/api/admin/sessions/{sid}/rooms/2/unlock", headers=h).status_code == 200
        assert c.get(f"/api/sessions/{sid}").json()["rooms"][2]["status"] == "unlocked"
        assert c.post(f"/api/admin/sessions/{sid}/time", headers=h, json={"delta_min": 10}).status_code == 200
        assert c.get(f"/api/sessions/{sid}").json()["remaining_seconds"] > 60 * 60
        c.post(f"/api/sessions/{sid}/rooms/0/clues/legend/inspect", json={})
        assert c.post(f"/api/admin/sessions/{sid}/reset", headers=h).status_code == 200
        assert c.get(f"/api/sessions/{sid}").json()["inventory"] == []


def test_migrates_old_database(tmp_path):
    """이전 버전(단서/미니게임 없는) DB 가 자동으로 업그레이드되는지"""
    import sqlite3
    from app import database
    from app.config import settings
    old = tmp_path / "old.db"
    conn = sqlite3.connect(old)
    conn.executescript("""
        CREATE TABLE themes (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '', style_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL);
        CREATE TABLE rooms (id INTEGER PRIMARY KEY AUTOINCREMENT, theme_id INTEGER NOT NULL, order_idx INTEGER NOT NULL,
            name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', puzzle_type TEXT NOT NULL DEFAULT 'riddle',
            question TEXT NOT NULL, answer TEXT NOT NULL, hints_json TEXT NOT NULL DEFAULT '[]',
            source TEXT NOT NULL DEFAULT 'seed', updated_at TEXT NOT NULL, UNIQUE(theme_id, order_idx));
        CREATE TABLE session_rooms (session_id TEXT NOT NULL, slot INTEGER NOT NULL, room_id INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'locked', cleared_at TEXT, cleared_by TEXT, PRIMARY KEY (session_id, slot));
        INSERT INTO themes VALUES (1, 'horror', 'old', '', '{}', 'x');
        INSERT INTO rooms (theme_id, order_idx, name, question, answer, updated_at) VALUES (1, 0, 'old room', 'q', 'a', 'x');
    """)
    conn.commit()
    conn.close()
    prev = settings.DATABASE_PATH
    settings.DATABASE_PATH = str(old)
    try:
        database.init_db()
        from app import repository as repo
        room = repo.list_rooms(1)[0]
        assert room["name"] == "정체불명의 서버실" and len(room["clues"]) == 3
    finally:
        settings.DATABASE_PATH = prev


def test_waiting_room_ready_and_mark():
    """대기실: 시작 전에는 진행 불가, 접속자 전원이 준비하면 자동 시작 + 핑 전달"""
    with TestClient(app) as c:
        state = c.post("/api/sessions", json={"theme_key": "horror", "room_count": 2, "start_now": False}).json()
        sid = state["id"]
        assert state["status"] == "waiting" and state["remaining_seconds"] == 60 * 60
        assert c.post(f"/api/sessions/{sid}/rooms/0/answer", json={"answer": "3142"}).status_code == 400
        with c.websocket_connect(f"/ws/{sid}?name=A") as a, c.websocket_connect(f"/ws/{sid}?name=B") as b:
            a.send_json({"type": "ready", "ready": True})
            assert c.get(f"/api/sessions/{sid}").json()["status"] == "waiting"  # B 가 아직
            b.send_json({"type": "ready", "ready": True})
            b.send_json({"type": "mark", "position": [1, 1, 1]})
            got = []
            for _ in range(12):
                m = a.receive_json()
                got.append(m["type"])
                if m["type"] == "mark":
                    break
            assert "lobby" in got and "state_changed" in got and "mark" in got
        st = c.get(f"/api/sessions/{sid}").json()
        assert st["status"] == "playing" and st["started_at"]
        # 혼자 바로 시작
        sid2 = c.post("/api/sessions", json={"theme_key": "egypt", "start_now": False}).json()["id"]
        assert c.post(f"/api/sessions/{sid2}/start").json()["status"] == "playing"
