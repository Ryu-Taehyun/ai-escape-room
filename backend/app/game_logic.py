"""게임 규칙 (서버가 권한을 가진다: 타이머, 정답 판정, 단서, 미니게임/열쇠, 잠금 해제).

방 진행 흐름 (모험형)
  1) 방 안의 단서 오브젝트를 조사 → 팀 인벤토리에 단서 추가
  2) 단서를 조합해 단말기(제단) 퍼즐 풀기             → puzzle_solved
  3) 미니게임이 있는 방: 미니게임 통과 → 열쇠 획득
     문에서 열쇠 사용                                 → key_used
  4) 조건을 모두 만족하면 방 클리어 → 다음 방 문 열림 / 최종 방이면 탈출
"""
import re
import secrets
from datetime import datetime, timezone
from typing import Optional

from . import minigames
from . import repository as repo
from .config import settings
from .database import now_iso
from .seed_variants import VARIANTS


class GameError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


# ---------- 방 선택 ----------
def select_rooms(theme_rooms: list[dict], count: int) -> list[dict]:
    """테마의 5개 방 중 count 개를 고른다.
    입구(첫 방)와 최종 방(마지막 방)은 항상 포함하고, 중간 방은 순서대로 채운다.
      2개 → [입구, 최종]
      4개 → [입구, 중간1, 중간2, 최종]   (기본값)
    """
    if not settings.MIN_ROOMS <= count <= settings.MAX_ROOMS:
        raise GameError(f"방 개수는 {settings.MIN_ROOMS}~{settings.MAX_ROOMS}개여야 합니다.")
    if len(theme_rooms) < count:
        raise GameError("테마에 방이 부족합니다. 관리자에게 문의하세요.")
    first, *middle, last = theme_rooms
    return [first, *middle[: count - 2], last]


def has_puzzle(room: dict) -> bool:
    return bool(room["answer"].strip())


def has_minigame(room: dict) -> bool:
    return bool(room.get("minigame"))


# ---------- 난이도 ----------
def hint_penalty(difficulty: str, time_limit_min: int = 30) -> int:
    """힌트 1회당 줄어드는 시간(초) — 제한 시간에 비례하는 규칙.

    보통 난이도: 제한 시간 30분마다 1분  → 30분 게임 −1분, 60분 −2분, 90분 −3분, 120분 −4분
                (5분 단위 시간도 같은 비율: 45분 −1분 30초, 75분 −2분 30초)
    난이도 배율: 쉬움 ×0.5 / 보통 ×1 / 어려움 ×1.5
    HINT_PENALTY_SEC = '30분당' 감점(초), 기본 60. 0 이면 감점 없음.
    """
    per_30 = settings.HINT_PENALTY_SEC * settings.HINT_PENALTY_RATE.get(difficulty, 1.0)
    return int(round(per_30 * time_limit_min / 30))


def shift_minigame(minigame: Optional[dict], difficulty: str) -> Optional[dict]:
    """미니게임 난이도(1~5)를 게임 난이도에 맞게 조정: 쉬움 -1, 어려움 +1"""
    if not minigame:
        return minigame
    delta = {"easy": -1, "hard": 1}.get(difficulty, 0)
    return {**minigame, "difficulty": max(1, min(5, int(minigame.get("difficulty", 2)) + delta))}


def difficulty_room(theme_key: str, room: dict, difficulty: str) -> Optional[dict]:
    """이 난이도에서 기본 방 대신 쓸 방 내용 (보통이면 None = 기본 방 그대로).
    - 수정하지 않은 기본 방(seed): seed_variants.py 에 준비된 쉬움/어려움 문제
    - 관리자가 고쳤거나 새로 만든 방: 같은 문제에 힌트 수와 미니게임 난이도만 조정
    """
    if difficulty not in ("easy", "hard"):
        return None
    variants = VARIANTS.get(theme_key, [])
    if room.get("source") == "seed" and room["order_idx"] < len(variants):
        override = dict(variants[room["order_idx"]].get(difficulty, {}))
        if "minigame" not in override and room.get("minigame"):
            override["minigame"] = shift_minigame(room["minigame"], difficulty)
    else:
        override = {"minigame": shift_minigame(room.get("minigame"), difficulty)}
        if difficulty == "hard":
            override["hints"] = room["hints"][:1]
    override["_variant"] = difficulty  # AI 가 만든 방과 구분하는 표시
    return override


# ---------- 세션 ----------
def _new_session_id() -> str:
    while True:
        sid = secrets.token_hex(3).upper()  # 6자리 참가 코드 (협동 참여용)
        if not repo.get_session(sid):
            return sid


def plan_session(theme_key: str, room_count: int, time_limit_min: int) -> tuple[dict, list[dict]]:
    """설정 검증 + 이번 게임에 배치할 테마 방 선택. (theme, rooms) 반환"""
    if not settings.MIN_TIME_MIN <= time_limit_min <= settings.MAX_TIME_MIN:
        raise GameError(f"게임 시간은 {settings.MIN_TIME_MIN}~{settings.MAX_TIME_MIN}분이어야 합니다.")
    theme = repo.get_theme_by_key(theme_key)
    if not theme:
        raise GameError("존재하지 않는 테마입니다.", 404)
    return theme, select_rooms(repo.list_rooms(theme["id"]), room_count)


def create_session(
    theme_key: str, room_count: int, time_limit_min: int, start_now: bool = True,
    room_overrides: Optional[dict[int, dict]] = None, ai_note: Optional[str] = None, difficulty: str = "normal",
) -> str:
    """start_now=False 면 대기실(waiting) 상태로 만들고, 모두 준비하면 start_session 으로 시작한다.
    room_overrides: {slot: 방 내용} - AI 가 이 게임용으로 새로 만든 방 (이미 난이도 반영)
    AI 방이 없는 칸은 테마의 기본 방을 쓰되, 난이도에 맞는 문제로 바꾼다."""
    if difficulty not in settings.DIFFICULTIES:
        raise GameError("난이도는 easy / normal / hard 중 하나여야 합니다.")
    theme, rooms = plan_session(theme_key, room_count, time_limit_min)
    overrides = dict(room_overrides or {})
    for slot, room in enumerate(rooms):
        if slot not in overrides:
            variant = difficulty_room(theme["key"], room, difficulty)
            if variant:
                overrides[slot] = variant
    sid = _new_session_id()
    repo.create_session(
        sid, theme["id"], [r["id"] for r in rooms], time_limit_min, "playing" if start_now else "waiting",
        overrides, ai_note, difficulty,
    )
    return sid


def start_session(session_id: str) -> bool:
    """대기실 → 게임 시작 (타이머는 이 순간부터). 이미 시작했으면 False"""
    session = _require_session(session_id)
    if session["status"] != "waiting":
        return False
    repo.update_session(session_id, {"status": "playing", "started_at": now_iso()})
    return True


def remaining_seconds(session: dict) -> int:
    if session["status"] == "waiting":
        return session["time_limit_min"] * 60 + session["extra_seconds"]
    started = datetime.fromisoformat(session["started_at"])
    # 종료된 세션은 종료 시점 기준으로 고정
    end = datetime.fromisoformat(session["ended_at"]) if session.get("ended_at") else datetime.now(timezone.utc)
    elapsed = (end - started).total_seconds()
    total = session["time_limit_min"] * 60 + session["extra_seconds"]
    return max(0, int(total - elapsed))


def _require_session(session_id: str) -> dict:
    session = repo.get_session(session_id)
    if not session:
        raise GameError("세션을 찾을 수 없습니다.", 404)
    # 시간 초과 처리 (조회 시점에 판정)
    if session["status"] == "playing" and remaining_seconds(session) <= 0:
        repo.update_session(session_id, {"status": "failed", "ended_at": now_iso()})
        session = repo.get_session(session_id)
    return session


def _require_playing(session_id: str) -> dict:
    session = _require_session(session_id)
    if session["status"] != "playing":
        raise GameError("이미 종료된 게임입니다.")
    return session


def _get_slot(session_id: str, slot: int) -> dict:
    for s in repo.list_session_rooms(session_id):
        if s["slot"] == slot:
            return s
    raise GameError("존재하지 않는 방입니다.", 404)


def _open_slot(session_id: str, slot: int) -> tuple[dict, dict]:
    """플레이어가 행동할 수 있는(잠기지 않은) 방. (slot_row, room) 반환"""
    target = _get_slot(session_id, slot)
    if target["status"] == "locked":
        raise GameError("아직 잠겨 있는 방입니다.")
    return target, repo.get_session_room(target)


def get_state(session_id: str) -> dict:
    session = _require_session(session_id)
    theme = repo.get_theme(session["theme_id"])
    theme_rooms = repo.list_rooms(theme["id"])
    slots = repo.list_session_rooms(session_id)
    items = repo.list_items(session_id)
    found = {(i["slot"], i["ref_id"]): i for i in items if i["kind"] == "clue"}
    keys = {i["slot"]: i for i in items if i["kind"] == "key"}

    rooms_public = []
    for s in slots:
        room = repo.get_session_room(s)
        locked = s["status"] == "locked"
        mg = room.get("minigame")
        key = keys.get(s["slot"])
        rooms_public.append(
            {
                "slot": s["slot"],
                "room_id": room["id"],
                "name": room["name"],
                "description": room["description"],
                "puzzle_type": room["puzzle_type"],
                "has_puzzle": has_puzzle(room),
                # 잠긴 방의 문제/단서 내용은 노출하지 않는다
                "question": room["question"] if not locked else "",
                "puzzle_solved": bool(s["puzzle_solved"]),
                "status": s["status"],
                "is_final": s["slot"] == len(slots) - 1,
                "ai_generated": bool(s.get("room_json")) and not room.get("_variant"),
                "hint_count": len(room["hints"]),
                "cleared_by": s["cleared_by"],
                "cleared_at": s["cleared_at"],
                "clues": [
                    {
                        "id": c["id"],
                        "label": c["label"],
                        "object": c.get("object", "note"),
                        "pos": c.get("pos", [0, 0]),
                        "found": (s["slot"], c["id"]) in found,
                        "found_by": found[(s["slot"], c["id"])]["obtained_by"] if (s["slot"], c["id"]) in found else None,
                        "text": c["text"] if (s["slot"], c["id"]) in found else "",
                    }
                    for c in room.get("clues", [])
                ],
                "minigame": (
                    {
                        "type": mg["type"],
                        "title": mg.get("title", "미니게임"),
                        "description": mg.get("description", ""),
                        "reward": mg.get("reward", "열쇠"),
                        "key_obtained": key is not None,
                        "key_used": bool(s["key_used"]),
                    }
                    if mg else None
                ),
            }
        )

    return {
        "id": session["id"],
        "theme": {**theme, "room_names": [r["name"] for r in theme_rooms]},
        "room_count": session["room_count"],
        "time_limit_min": session["time_limit_min"],
        "remaining_seconds": remaining_seconds(session),
        "status": session["status"],
        "started_at": session["started_at"],
        "ended_at": session["ended_at"],
        "hints_used": session["hints_used"],
        "ai_note": session.get("ai_note"),
        "difficulty": session.get("difficulty") or "normal",
        "hint_penalty_sec": hint_penalty(session.get("difficulty") or "normal", session["time_limit_min"]),
        "rooms": rooms_public,
        "inventory": [
            {"kind": i["kind"], "slot": i["slot"], "ref_id": i["ref_id"], "name": i["name"],
             "text": i["text"], "obtained_by": i["obtained_by"], "used": bool(i["used"])}
            for i in items
        ],
    }


# ---------- 방 클리어 판정 ----------
def _try_clear(session_id: str, slot: int, player_name: str) -> Optional[str]:
    """조건을 모두 만족하면 방을 클리어하고 메시지 반환, 아니면 None.
    동시에 두 요청이 와도 클리어 처리(mark_room_cleared)는 DB 에서 한 번만 성공하므로
    다음 방 열기·탈출 처리도 한 번만 실행된다."""
    session = repo.get_session(session_id)
    target = _get_slot(session_id, slot)
    if target["status"] == "cleared":
        return None
    room = repo.get_session_room(target)
    if has_puzzle(room) and not target["puzzle_solved"]:
        return None
    if has_minigame(room) and not target["key_used"]:
        return None

    if not repo.mark_room_cleared(session_id, slot, player_name):
        return None  # 다른 요청이 먼저 클리어함
    if slot == session["room_count"] - 1:
        repo.update_session(session_id, {"status": "escaped", "ended_at": now_iso()})
        return "탈출 성공!"
    repo.unlock_room(session_id, slot + 1)
    return "방 클리어! 다음 방의 문이 열렸습니다."


# ---------- 정답 ----------
def normalize(text: str) -> str:
    return re.sub(r"\s+", "", text).lower()


def check_answer(user_answer: str, answer_spec: str) -> bool:
    """answer_spec 은 '|' 로 여러 정답 허용. 공백/대소문자 무시."""
    given = normalize(user_answer)
    return any(given == normalize(a) for a in answer_spec.split("|") if a.strip())


def submit_answer(session_id: str, slot: int, answer: str, player_name: str) -> tuple[bool, str, bool]:
    """(정답 여부, 메시지, 방 클리어 여부)"""
    _require_playing(session_id)
    target, room = _open_slot(session_id, slot)
    if not has_puzzle(room):
        raise GameError("이 방에는 풀어야 할 암호가 없습니다.")
    if target["status"] == "cleared" or target["puzzle_solved"]:
        return True, "이미 해제된 암호입니다.", False
    if not check_answer(answer, room["answer"]):
        return False, "틀렸습니다. 방 안의 단서를 더 조사해 보세요.", False

    if not repo.set_session_room_flag(session_id, slot, "puzzle_solved"):
        return True, "이미 해제된 암호입니다.", False  # 동시에 들어온 다른 정답이 먼저 처리됨
    cleared = _try_clear(session_id, slot, player_name)
    if cleared:
        return True, f"정답! {cleared}", True
    mg = room.get("minigame")
    if mg and not _get_slot(session_id, slot)["key_used"]:
        return True, f"정답! 하지만 문을 열려면 '{mg.get('reward', '열쇠')}'이(가) 필요합니다.", False
    return True, "정답! 문이 열렸습니다.", False  # 같은 순간 열쇠 사용 쪽에서 먼저 클리어한 경우


# ---------- 단서 ----------
def inspect_clue(session_id: str, slot: int, clue_id: str, player_name: str) -> tuple[dict, bool]:
    """(단서, 새로 발견했는지)"""
    session = _require_playing(session_id)
    target, room = _open_slot(session_id, slot)
    clue = next((c for c in room.get("clues", []) if c["id"] == clue_id), None)
    if not clue:
        raise GameError("존재하지 않는 단서입니다.", 404)
    if (clue.get("object") == "phone" and has_puzzle(room)
            and not target["puzzle_solved"] and target["status"] != "cleared"
            and repo.get_theme(session["theme_id"])["style"].get("decor") == "study"
            and not repo.get_item(session_id, slot, "clue", clue_id)):
        raise GameError("휴대폰이 잠겨 있습니다. 방 안의 단서로 비밀번호를 풀어 주세요.", 403)
    is_new = repo.add_item(session_id, slot, "clue", clue_id, clue["label"], clue["text"], player_name)
    return clue, is_new


# ---------- 미니게임 / 열쇠 ----------
def start_minigame(session_id: str, slot: int) -> dict:
    session = _require_playing(session_id)
    target, room = _open_slot(session_id, slot)
    if not has_minigame(room):
        raise GameError("이 방에는 미니게임이 없습니다.")
    if repo.get_item(session_id, slot, "key", "key"):
        raise GameError("이미 열쇠를 획득했습니다.")
    decor = repo.get_theme(session["theme_id"])["style"].get("decor", "none")
    ch = minigames.create_challenge(session_id, slot, room["minigame"], decor)
    return {"challenge_id": ch.id, "type": ch.type, "params": ch.params, **{k: room["minigame"].get(k, "") for k in ("title", "description", "reward")}}


def finish_minigame(session_id: str, slot: int, challenge_id: str, result: dict, player_name: str) -> tuple[bool, str]:
    _require_playing(session_id)
    _, room = _open_slot(session_id, slot)
    if not has_minigame(room):
        raise GameError("이 방에는 미니게임이 없습니다.")
    ok, msg = minigames.verify(challenge_id, session_id, slot, result)
    if ok:
        reward = room["minigame"].get("reward", "열쇠")
        repo.add_item(session_id, slot, "key", "key", reward, f"{room['name']}의 문을 여는 열쇠", player_name)
        msg = f"{msg} 🔑 '{reward}' 획득! 문으로 가서 사용하세요."
    return ok, msg


def use_key(session_id: str, slot: int, player_name: str) -> tuple[str, bool]:
    """(메시지, 방 클리어 여부)"""
    _require_playing(session_id)
    target, room = _open_slot(session_id, slot)
    if not has_minigame(room):
        raise GameError("이 문은 열쇠가 필요 없습니다. 암호를 풀면 열립니다.")
    if target["key_used"]:
        return "이미 열쇠를 사용했습니다.", False
    key = repo.get_item(session_id, slot, "key", "key")
    if not key:
        raise GameError("열쇠가 없습니다. 이 방의 미니게임을 먼저 통과하세요.")
    if not repo.mark_item_used(key["id"]) or not repo.set_session_room_flag(session_id, slot, "key_used"):
        return "이미 열쇠를 사용했습니다.", False
    cleared = _try_clear(session_id, slot, player_name)
    if cleared:
        return f"🔑 '{key['name']}' 사용! {cleared}", True
    return f"🔑 '{key['name']}' 사용! 이제 단말기의 암호만 풀면 됩니다.", False


def get_room_for_hint(session_id: str, slot: int) -> tuple[dict, int]:
    """(방, 이번 힌트로 줄어든 시간(초))"""
    session = _require_playing(session_id)
    _, room = _open_slot(session_id, slot)
    repo.increment_hints(session_id)
    penalty = hint_penalty(session.get("difficulty") or "normal", session["time_limit_min"])
    if penalty > 0:  # 힌트 1회당 제한 시간 감점 (제한 시간 30분마다 1분 × 난이도 배율)
        repo.update_session(session_id, {"extra_seconds": session["extra_seconds"] - penalty})
    return room, penalty


# ---------- 관리자 세션 조작 ----------
def admin_add_time(session_id: str, delta_min: int) -> None:
    session = _require_session(session_id)
    fields = {"extra_seconds": session["extra_seconds"] + delta_min * 60}
    # 시간 초과로 실패했던 세션에 시간을 추가하면 재개
    if session["status"] == "failed" and delta_min > 0:
        fields.update(status="playing", ended_at=None)
    repo.update_session(session_id, fields)
    repo.add_log("admin", "session", session_id, {"action": "add_time", "delta_min": delta_min})


def admin_force_unlock(session_id: str, slot: int) -> None:
    _require_session(session_id)
    _get_slot(session_id, slot)  # 없는 방이면 404
    repo.unlock_room(session_id, slot)
    repo.add_log("admin", "session", session_id, {"action": "unlock", "slot": slot})


def admin_reset(session_id: str) -> None:
    session = _require_session(session_id)
    repo.reset_session_rooms(session_id)
    repo.update_session(
        session_id,
        {"status": "playing", "ended_at": None, "started_at": now_iso(), "extra_seconds": 0, "hints_used": 0},
    )
    repo.add_log("admin", "session", session_id, {"action": "reset", "theme_id": session["theme_id"]})


def unique_theme_key(name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "theme"
    key = base
    n = 1
    while repo.get_theme_by_key(key):
        n += 1
        key = f"{base}-{n}"
    return key
