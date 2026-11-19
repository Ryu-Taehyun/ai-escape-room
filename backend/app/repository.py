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


def create_theme(key: str, name: str, description: str, style: dict) -> int:
    with get_conn() as c:
        cur = c.execute(
            "INSERT INTO themes (key, name, description, style_json, updated_at) VALUES (?, ?, ?, ?, ?)",
            (key, name, description, json.dumps(style), now_iso()),
        )
        return cur.lastrowid


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


def insert_room(theme_id: int, order_idx: int, data: dict, source: str) -> int:
    with get_conn() as c:
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
    room_overrides: Optional[dict[int, dict]] = None,
) -> None:
    """room_overrides: {slot: AI 가 이 게임용으로 만든 방 내용} → session_rooms.room_json 에 저장"""
    room_overrides = room_overrides or {}
    with get_conn() as c:
        c.execute(
            """INSERT INTO game_sessions (id, theme_id, room_count, time_limit_min, started_at, status)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (session_id, theme_id, len(room_ids), time_limit_min, now_iso(), status),
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


def set_session_room_status(session_id: str, slot: int, status: str, cleared_by: Optional[str] = None) -> None:
    with get_conn() as c:
        c.execute(
            """UPDATE session_rooms SET status = ?, cleared_by = ?,
                      cleared_at = CASE WHEN ? = 'cleared' THEN ? ELSE NULL END
               WHERE session_id = ? AND slot = ?""",
            (status, cleared_by, status, now_iso(), session_id, slot),
        )


def set_session_room_flag(session_id: str, slot: int, flag: str) -> None:
    assert flag in ("puzzle_solved", "key_used")
    with get_conn() as c:
        c.execute(f"UPDATE session_rooms SET {flag} = 1 WHERE session_id = ? AND slot = ?", (session_id, slot))


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


def mark_item_used(item_id: int) -> None:
    with get_conn() as c:
        c.execute("UPDATE session_items SET used = 1 WHERE id = ?", (item_id,))


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
