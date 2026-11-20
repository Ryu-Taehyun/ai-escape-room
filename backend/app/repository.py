"""DB 접근 계층. SQL 은 이 파일에만 둔다."""
import json
from typing import Optional

from .database import get_conn, now_iso


# ---------- Themes ----------
def _theme_row(row) -> dict:
    return {
        "id": row["id"],
        "key": row["key"],
        "name": row["name"],
        "description": row["description"],
        "style": json.loads(row["style_json"] or "{}"),
    }


def list_themes() -> list[dict]:
    with get_conn() as c:
        return [_theme_row(r) for r in c.execute("SELECT * FROM themes ORDER BY id")]


def get_theme(theme_id: int) -> Optional[dict]:
    with get_conn() as c:
        row = c.execute("SELECT * FROM themes WHERE id = ?", (theme_id,)).fetchone()
        return _theme_row(row) if row else None


def get_theme_by_key(key: str) -> Optional[dict]:
    with get_conn() as c:
        row = c.execute("SELECT * FROM themes WHERE key = ?", (key,)).fetchone()
        return _theme_row(row) if row else None


def update_theme(theme_id: int, fields: dict) -> None:
    if "style" in fields:
        fields["style_json"] = json.dumps(fields.pop("style"))
    if not fields:
        return
    fields["updated_at"] = now_iso()
    cols = ", ".join(f"{k} = ?" for k in fields)
    with get_conn() as c:
        c.execute(f"UPDATE themes SET {cols} WHERE id = ?", (*fields.values(), theme_id))


# ---------- Rooms ----------
def _room_row(row) -> dict:
    return {
        "id": row["id"],
        "theme_id": row["theme_id"],
        "order_idx": row["order_idx"],
        "name": row["name"],
        "description": row["description"],
        "puzzle_type": row["puzzle_type"],
        "question": row["question"],
        "answer": row["answer"],
        "hints": json.loads(row["hints_json"] or "[]"),
        "clues": json.loads(row["clues_json"] or "[]"),
        "minigame": json.loads(row["minigame_json"] or "null"),
        "source": row["source"],
        "updated_at": row["updated_at"],
    }


def list_rooms(theme_id: int) -> list[dict]:
    with get_conn() as c:
        rows = c.execute("SELECT * FROM rooms WHERE theme_id = ? ORDER BY order_idx", (theme_id,))
        return [_room_row(r) for r in rows]


def get_room(room_id: int) -> Optional[dict]:
    with get_conn() as c:
        row = c.execute("SELECT * FROM rooms WHERE id = ?", (room_id,)).fetchone()
        return _room_row(row) if row else None


def create_theme_with_rooms(key: str, name: str, description: str, style: dict, rooms: list[tuple[dict, str]]) -> int:
    """테마와 방들을 한 트랜잭션으로 저장 (중간에 실패하면 테마도 남지 않는다). rooms: [(방 내용, source)]"""
    with get_conn() as c:
        cur = c.execute(
            "INSERT INTO themes (key, name, description, style_json, updated_at) VALUES (?, ?, ?, ?, ?)",
            (key, name, description, json.dumps(style, ensure_ascii=False), now_iso()),
        )
        theme_id = cur.lastrowid
        for order_idx, (data, source) in enumerate(rooms):
            _insert_room(c, theme_id, order_idx, data, source)
        return theme_id


def insert_room(theme_id: int, order_idx: int, data: dict, source: str) -> int:
    with get_conn() as c:
        return _insert_room(c, theme_id, order_idx, data, source)


def _insert_room(c, theme_id: int, order_idx: int, data: dict, source: str) -> int:
    cur = c.execute(
        """INSERT INTO rooms (theme_id, order_idx, name, description, puzzle_type, question, answer,
                              hints_json, clues_json, minigame_json, source, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            theme_id, order_idx, data["name"], data["description"], data["puzzle_type"],
            data["question"], data["answer"], json.dumps(data["hints"], ensure_ascii=False),
            json.dumps(data.get("clues", []), ensure_ascii=False),
            json.dumps(data.get("minigame"), ensure_ascii=False),
            source, now_iso(),
        ),
    )
    return cur.lastrowid


def update_room(room_id: int, fields: dict) -> None:
    if "hints" in fields:
        fields["hints_json"] = json.dumps(fields.pop("hints"), ensure_ascii=False)
    if "clues" in fields:
        fields["clues_json"] = json.dumps(fields.pop("clues"), ensure_ascii=False)
    if "minigame" in fields:
        fields["minigame_json"] = json.dumps(fields.pop("minigame"), ensure_ascii=False)
    if not fields:
        return
    fields["updated_at"] = now_iso()
    cols = ", ".join(f"{k} = ?" for k in fields)
    with get_conn() as c:
        c.execute(f"UPDATE rooms SET {cols} WHERE id = ?", (*fields.values(), room_id))


# ---------- Sessions ----------
def create_session(
    session_id: str, theme_id: int, room_ids: list[int], time_limit_min: int, status: str = "playing",
    room_overrides: Optional[dict[int, dict]] = None, ai_note: Optional[str] = None, difficulty: str = "normal",
) -> None:
    """room_overrides: {slot: AI 가 이 게임용으로 만든 방 내용} → session_rooms.room_json 에 저장"""
    room_overrides = room_overrides or {}
    with get_conn() as c:
        c.execute(
            """INSERT INTO game_sessions (id, theme_id, room_count, time_limit_min, started_at, status, ai_note, difficulty)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (session_id, theme_id, len(room_ids), time_limit_min, now_iso(), status, ai_note, difficulty),
        )
        for slot, room_id in enumerate(room_ids):
            override = room_overrides.get(slot)
            c.execute(
                "INSERT INTO session_rooms (session_id, slot, room_id, status, room_json) VALUES (?, ?, ?, ?, ?)",
                (
                    session_id, slot, room_id, "unlocked" if slot == 0 else "locked",
                    json.dumps(override, ensure_ascii=False) if override else None,
                ),
            )


def get_session_room(slot_row: dict) -> dict:
    """세션의 한 칸에 실제로 배치된 방. AI 가 이 게임용으로 만든 내용이 있으면 그것을 쓴다."""
    room = get_room(slot_row["room_id"])
    if slot_row.get("room_json"):
        room = {**room, **json.loads(slot_row["room_json"]), "source": "ai_session"}
    return room


def get_session(session_id: str) -> Optional[dict]:
    with get_conn() as c:
        row = c.execute("SELECT * FROM game_sessions WHERE id = ?", (session_id,)).fetchone()
        return dict(row) if row else None


def list_session_rooms(session_id: str) -> list[dict]:
    with get_conn() as c:
        rows = c.execute(
            "SELECT * FROM session_rooms WHERE session_id = ? ORDER BY slot", (session_id,)
        )
        return [dict(r) for r in rows]


def update_session(session_id: str, fields: dict) -> None:
    cols = ", ".join(f"{k} = ?" for k in fields)
    with get_conn() as c:
        c.execute(f"UPDATE game_sessions SET {cols} WHERE id = ?", (*fields.values(), session_id))


def set_session_room_flag(session_id: str, slot: int, flag: str) -> bool:
    """플래그를 켠다. 이번 호출이 켰으면 True, 이미 켜져 있었으면 False (동시 요청 중 한 번만 True)"""
    assert flag in ("puzzle_solved", "key_used")
    with get_conn() as c:
        cur = c.execute(
            f"UPDATE session_rooms SET {flag} = 1 WHERE session_id = ? AND slot = ? AND {flag} = 0",
            (session_id, slot),
        )
        return cur.rowcount > 0


def mark_room_cleared(session_id: str, slot: int, cleared_by: str) -> bool:
    """방을 클리어 처리. 이번 호출이 처리했으면 True (이미 클리어됐으면 False)"""
    with get_conn() as c:
        cur = c.execute(
            """UPDATE session_rooms SET status = 'cleared', cleared_by = ?, cleared_at = ?
               WHERE session_id = ? AND slot = ? AND status != 'cleared'""",
            (cleared_by, now_iso(), session_id, slot),
        )
        return cur.rowcount > 0


def unlock_room(session_id: str, slot: int) -> bool:
    """잠긴 방이면 연다. 열었으면 True"""
    with get_conn() as c:
        cur = c.execute(
            "UPDATE session_rooms SET status = 'unlocked' WHERE session_id = ? AND slot = ? AND status = 'locked'",
            (session_id, slot),
        )
        return cur.rowcount > 0


def reset_session_rooms(session_id: str) -> None:
    with get_conn() as c:
        c.execute(
            """UPDATE session_rooms SET status = CASE WHEN slot = 0 THEN 'unlocked' ELSE 'locked' END,
                      cleared_at = NULL, cleared_by = NULL, puzzle_solved = 0, key_used = 0
               WHERE session_id = ?""",
            (session_id,),
        )
        c.execute("DELETE FROM session_items WHERE session_id = ?", (session_id,))


# ---------- Inventory (팀 공유) ----------
def add_item(session_id: str, slot: int, kind: str, ref_id: str, name: str, text: str, by: str) -> bool:
    """새로 추가되면 True, 이미 있으면 False."""
    with get_conn() as c:
        cur = c.execute(
            """INSERT OR IGNORE INTO session_items
                   (session_id, slot, kind, ref_id, name, text, obtained_by, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (session_id, slot, kind, ref_id, name, text, by, now_iso()),
        )
        return cur.rowcount > 0


def list_items(session_id: str) -> list[dict]:
    with get_conn() as c:
        rows = c.execute("SELECT * FROM session_items WHERE session_id = ? ORDER BY id", (session_id,))
        return [dict(r) for r in rows]


def get_item(session_id: str, slot: int, kind: str, ref_id: str) -> Optional[dict]:
    with get_conn() as c:
        row = c.execute(
            "SELECT * FROM session_items WHERE session_id = ? AND slot = ? AND kind = ? AND ref_id = ?",
            (session_id, slot, kind, ref_id),
        ).fetchone()
        return dict(row) if row else None


def mark_item_used(item_id: int) -> bool:
    """아이템 사용 처리. 이번 호출이 사용했으면 True"""
    with get_conn() as c:
        cur = c.execute("UPDATE session_items SET used = 1 WHERE id = ? AND used = 0", (item_id,))
        return cur.rowcount > 0


# ---------- AI 사용량 (하루 한도) ----------
def _today() -> str:
    from datetime import date
    return date.today().isoformat()


def reserve_ai_calls(n: int, daily_limit: int) -> bool:
    """오늘 AI 호출 n 번을 예약. 한도 안이면 기록하고 True (여러 요청이 동시에 와도 한도를 넘지 않음)"""
    day = _today()
    with get_conn() as c:
        c.execute("INSERT INTO ai_usage (day, calls) VALUES (?, 0) ON CONFLICT(day) DO NOTHING", (day,))
        if daily_limit <= 0:
            c.execute("UPDATE ai_usage SET calls = calls + ? WHERE day = ?", (n, day))
            return True
        cur = c.execute(
            "UPDATE ai_usage SET calls = calls + ? WHERE day = ? AND calls + ? <= ?", (n, day, n, daily_limit)
        )
        return cur.rowcount > 0


def ai_calls_today() -> int:
    with get_conn() as c:
        row = c.execute("SELECT calls FROM ai_usage WHERE day = ?", (_today(),)).fetchone()
        return row["calls"] if row else 0


def increment_hints(session_id: str) -> None:
    with get_conn() as c:
        c.execute("UPDATE game_sessions SET hints_used = hints_used + 1 WHERE id = ?", (session_id,))


def cleanup_sessions(keep_hours: int) -> int:
    """오래된 세션 삭제 (진행 기록·인벤토리는 ON DELETE CASCADE 로 함께 삭제). 삭제 수 반환"""
    from datetime import datetime, timedelta, timezone
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=keep_hours)).isoformat()
    with get_conn() as c:
        cur = c.execute("DELETE FROM game_sessions WHERE started_at < ?", (cutoff,))
        return cur.rowcount


# ---------- Logs ----------
def add_log(actor: str, target_type: str, target_id, payload: dict) -> None:
    with get_conn() as c:
        c.execute(
            "INSERT INTO edit_logs (actor, target_type, target_id, payload, created_at) VALUES (?, ?, ?, ?, ?)",
            (actor, target_type, str(target_id), json.dumps(payload, ensure_ascii=False), now_iso()),
        )


def list_logs(limit: int = 50) -> list[dict]:
    with get_conn() as c:
        rows = c.execute("SELECT * FROM edit_logs ORDER BY id DESC LIMIT ?", (limit,))
        return [dict(r) for r in rows]
