"""SQLite 연결, 스키마, 시드.

테이블
- themes        : 방 컨셉(테마). 관리자/AI 가 수정
- rooms         : 테마별 5개 방 + 퍼즐. 관리자/AI 가 수정
- game_sessions : 플레이 세션 (방 개수, 제한 시간, 상태)
- session_rooms : 세션에 배치된 방과 진행 상태 (locked / unlocked / cleared)
                  + puzzle_solved / key_used (방 클리어 조건)
                  + room_json: AI 가 이 게임만을 위해 새로 만든 방 내용 (없으면 테마의 기본 방 사용)
- session_items : 팀이 공유하는 인벤토리 (찾은 단서, 미니게임으로 얻은 열쇠)
- edit_logs     : 관리자 / AI 편집 이력
"""
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone

from .config import settings
from .seed_data import THEMES

SCHEMA = """
CREATE TABLE IF NOT EXISTS themes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    key         TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    style_json  TEXT NOT NULL DEFAULT '{}',
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rooms (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    theme_id    INTEGER NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
    order_idx   INTEGER NOT NULL,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    puzzle_type TEXT NOT NULL DEFAULT 'riddle',
    question    TEXT NOT NULL,
    answer      TEXT NOT NULL,
    hints_json  TEXT NOT NULL DEFAULT '[]',
    clues_json  TEXT NOT NULL DEFAULT '[]',
    minigame_json TEXT NOT NULL DEFAULT 'null',
    source      TEXT NOT NULL DEFAULT 'seed',   -- seed | admin | ai
    updated_at  TEXT NOT NULL,
    UNIQUE(theme_id, order_idx)
);

CREATE TABLE IF NOT EXISTS game_sessions (
    id             TEXT PRIMARY KEY,
    theme_id       INTEGER NOT NULL REFERENCES themes(id),
    room_count     INTEGER NOT NULL,
    time_limit_min INTEGER NOT NULL,
    started_at     TEXT NOT NULL,
    ended_at       TEXT,
    status         TEXT NOT NULL DEFAULT 'playing',  -- waiting | playing | escaped | failed
    hints_used     INTEGER NOT NULL DEFAULT 0,
    extra_seconds  INTEGER NOT NULL DEFAULT 0          -- 관리자가 추가/차감한 시간
);

CREATE TABLE IF NOT EXISTS session_rooms (
    session_id  TEXT NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
    slot        INTEGER NOT NULL,
    room_id     INTEGER NOT NULL REFERENCES rooms(id),
    status      TEXT NOT NULL DEFAULT 'locked',   -- locked | unlocked | cleared
    cleared_at  TEXT,
    cleared_by  TEXT,
    puzzle_solved INTEGER NOT NULL DEFAULT 0,
    key_used    INTEGER NOT NULL DEFAULT 0,
    room_json   TEXT,
    PRIMARY KEY (session_id, slot)
);

CREATE TABLE IF NOT EXISTS session_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
    slot        INTEGER NOT NULL,
    kind        TEXT NOT NULL,          -- clue | key
    ref_id      TEXT NOT NULL,          -- clue id 또는 'key'
    name        TEXT NOT NULL,
    text        TEXT NOT NULL DEFAULT '',
    obtained_by TEXT NOT NULL DEFAULT '',
    used        INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    UNIQUE (session_id, slot, kind, ref_id)
);

CREATE TABLE IF NOT EXISTS edit_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    actor       TEXT NOT NULL,          -- admin | ai
    target_type TEXT NOT NULL,          -- theme | room | session
    target_id   TEXT NOT NULL,
    payload     TEXT NOT NULL,
    created_at  TEXT NOT NULL
);
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def get_conn():
    conn = sqlite3.connect(settings.DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with get_conn() as conn:
        _migrate_columns(conn)
        conn.executescript(SCHEMA)
        count = conn.execute("SELECT COUNT(*) FROM themes").fetchone()[0]
        if count == 0:
            _seed(conn)
        else:
            _refresh_seed_rooms(conn)
    # 순환 import 방지를 위해 여기서 불러온다
    from .repository import cleanup_sessions
    removed = cleanup_sessions(settings.SESSION_KEEP_HOURS)
    if removed:
        print(f"[db] 오래된 세션 {removed}개 정리")


def _columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}


def _migrate_columns(conn: sqlite3.Connection) -> None:
    """이전 버전 DB(단서/미니게임 없음)에 새 컬럼 추가."""
    room_cols = _columns(conn, "rooms")
    if room_cols:
        if "clues_json" not in room_cols:
            conn.execute("ALTER TABLE rooms ADD COLUMN clues_json TEXT NOT NULL DEFAULT '[]'")
        if "minigame_json" not in room_cols:
            conn.execute("ALTER TABLE rooms ADD COLUMN minigame_json TEXT NOT NULL DEFAULT 'null'")
    sr_cols = _columns(conn, "session_rooms")
    if sr_cols:
        if "puzzle_solved" not in sr_cols:
            conn.execute("ALTER TABLE session_rooms ADD COLUMN puzzle_solved INTEGER NOT NULL DEFAULT 0")
        if "key_used" not in sr_cols:
            conn.execute("ALTER TABLE session_rooms ADD COLUMN key_used INTEGER NOT NULL DEFAULT 0")
        if "room_json" not in sr_cols:
            conn.execute("ALTER TABLE session_rooms ADD COLUMN room_json TEXT")


def _room_values(room: dict) -> tuple:
    return (
        room["name"], room["description"], room["puzzle_type"], room["question"], room["answer"],
        json.dumps(room["hints"], ensure_ascii=False),
        json.dumps(room.get("clues", []), ensure_ascii=False),
        json.dumps(room.get("minigame"), ensure_ascii=False),
    )


def _refresh_seed_rooms(conn: sqlite3.Connection) -> None:
    """관리자/AI 가 수정하지 않은(source='seed') 기본 방은 최신 시드 내용으로 갱신."""
    for theme in THEMES:
        row = conn.execute("SELECT id FROM themes WHERE key = ?", (theme["key"],)).fetchone()
        if not row:
            continue
        for idx, room in enumerate(theme["rooms"]):
            conn.execute(
                """UPDATE rooms SET name = ?, description = ?, puzzle_type = ?, question = ?, answer = ?,
                          hints_json = ?, clues_json = ?, minigame_json = ?
                   WHERE theme_id = ? AND order_idx = ? AND source = 'seed'""",
                (*_room_values(room), row["id"], idx),
            )


def _seed(conn: sqlite3.Connection) -> None:
    ts = now_iso()
    for theme in THEMES:
        cur = conn.execute(
            "INSERT INTO themes (key, name, description, style_json, updated_at) VALUES (?, ?, ?, ?, ?)",
            (theme["key"], theme["name"], theme["description"], json.dumps(theme["style"]), ts),
        )
        theme_id = cur.lastrowid
        for idx, room in enumerate(theme["rooms"]):
            conn.execute(
                """INSERT INTO rooms (theme_id, order_idx, name, description, puzzle_type, question, answer,
                                      hints_json, clues_json, minigame_json, source, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'seed', ?)""",
                (theme_id, idx, *_room_values(room), ts),
            )
