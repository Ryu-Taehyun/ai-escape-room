"""플레이어용 REST API.

- 경로의 방 코드는 `Depends(session_sid)` 로 대문자 정규화
- GameError 는 main.py 의 예외 처리기가 {"detail": ...} 응답으로 바꾼다 (핸들러마다 try/except 불필요)
- async 핸들러 안의 DB 작업(동기 sqlite3)은 asyncio.to_thread 로 스레드에서 실행 → 이벤트 루프를 막지 않음
  (동기 def 핸들러는 FastAPI 가 원래 스레드풀에서 실행한다)
"""
import asyncio

from fastapi import APIRouter, Depends, HTTPException

from .. import ai_service, game_logic, repository as repo
from ..config import settings
from ..deps import session_sid
from ..ratelimit import answer_limiter
from ..schemas import (
    ActionResponse, AnswerRequest, AnswerResponse, CreateSessionRequest, GameConfig, HintRequest,
    HintResponse, InspectResponse, MinigameFinishRequest, MinigameStartResponse, PlayerAction,
    SessionState, ThemeSummary,
)
from ..ws_manager import manager

router = APIRouter(prefix="/api", tags=["game"])


@router.get("/config", response_model=GameConfig)
def get_config():
    return GameConfig()


@router.get("/themes", response_model=list[ThemeSummary])
def list_themes():
    result = []
    for t in repo.list_themes():
        rooms = repo.list_rooms(t["id"])
        result.append({
            **t,
            "room_names": [r["name"] for r in rooms],
            "rooms": [
                {"name": r["name"], "has_puzzle": game_logic.has_puzzle(r), "clue_count": len(r.get("clues", [])),
                 "minigame": (r.get("minigame") or {}).get("type")}
                for r in rooms
            ],
        })
    return result


def _create_session_sync(body: CreateSessionRequest, overrides: dict[int, dict]) -> dict:
    sid = game_logic.create_session(body.theme_key, body.room_count, body.time_limit_min, body.start_now, overrides)
    if overrides:
        repo.add_log("ai", "session", sid, {"action": "random_rooms", "slots": sorted(overrides)})
    return game_logic.get_state(sid)


@router.post("/sessions", response_model=SessionState)
async def create_session(body: CreateSessionRequest):
    theme, rooms = await asyncio.to_thread(game_logic.plan_session, body.theme_key, body.room_count, body.time_limit_min)
    # API 키가 있으면 이번 게임의 방 문제를 AI 가 새로 만든다 (실패한 방은 테마의 기본 방)
    overrides = await ai_service.generate_session_rooms(theme, rooms) if settings.ai_random_rooms else {}
    return await asyncio.to_thread(_create_session_sync, body, overrides)


@router.get("/sessions/{session_id}", response_model=SessionState)
def get_session(sid: str = Depends(session_sid)):
    return game_logic.get_state(sid)


@router.post("/sessions/{session_id}/start", response_model=SessionState)
async def start_session(sid: str = Depends(session_sid)):
    """대기실에서 바로 시작 (준비 완료를 기다리지 않음)"""
    if await asyncio.to_thread(game_logic.start_session, sid):
        await manager.chat(sid, None, "게임이 시작되었습니다.")
        await manager.broadcast(sid, {"type": "state_changed", "reason": "start"})
    return await asyncio.to_thread(game_logic.get_state, sid)


async def _notify_clear(sid: str, slot: int, state: dict, by: str) -> None:
    room = state["rooms"][slot]
    await manager.broadcast(sid, {"type": "room_cleared", "slot": slot, "room_name": room["name"], "by": by})


def _with_state(sid: str, fn, *args):
    """게임 동작 실행 + 그 직후 상태를 한 번에 (스레드에서 실행)"""
    result = fn(sid, *args)
    return result, game_logic.get_state(sid)


@router.post("/sessions/{session_id}/rooms/{slot}/answer", response_model=AnswerResponse)
async def submit_answer(slot: int, body: AnswerRequest, sid: str = Depends(session_sid)):
    limit_key = f"{sid}:{slot}"
    wait = answer_limiter.retry_after(limit_key)
    if wait:
        raise HTTPException(status_code=429, detail=f"너무 많이 틀렸습니다. {wait}초 후 다시 시도하세요.")
    (correct, message, cleared), state = await asyncio.to_thread(
        _with_state, sid, game_logic.submit_answer, slot, body.answer, body.player_name
    )
    if not correct:
        answer_limiter.record(limit_key)
        return {"correct": False, "message": message, "state": state}

    answer_limiter.reset(limit_key)
    if cleared:
        await _notify_clear(sid, slot, state, body.player_name)
    else:
        await manager.chat(sid, None, f"🔓 {body.player_name} 님이 {slot + 1}번 방 암호를 풀었습니다.")
    await manager.broadcast(sid, {"type": "state_changed", "reason": "answer"})
    return {"correct": True, "message": message, "state": state}


# ---------- 모험: 단서 조사 ----------
@router.post("/sessions/{session_id}/rooms/{slot}/clues/{clue_id}/inspect", response_model=InspectResponse)
async def inspect_clue(slot: int, clue_id: str, body: PlayerAction, sid: str = Depends(session_sid)):
    (clue, new), state = await asyncio.to_thread(_with_state, sid, game_logic.inspect_clue, slot, clue_id, body.player_name)
    if new:
        await manager.chat(sid, None, f"🔎 {body.player_name} 님이 단서 발견: {clue['label']}")
        await manager.broadcast(sid, {"type": "state_changed", "reason": "clue"})
    return {"clue": clue, "new": new, "state": state}


# ---------- 미니게임 → 열쇠 ----------
@router.post("/sessions/{session_id}/rooms/{slot}/minigame/start", response_model=MinigameStartResponse)
def start_minigame(slot: int, sid: str = Depends(session_sid)):
    return game_logic.start_minigame(sid, slot)


@router.post("/sessions/{session_id}/rooms/{slot}/minigame/finish", response_model=ActionResponse)
async def finish_minigame(slot: int, body: MinigameFinishRequest, sid: str = Depends(session_sid)):
    (ok, message), state = await asyncio.to_thread(
        _with_state, sid, game_logic.finish_minigame, slot, body.challenge_id, body.result, body.player_name
    )
    if ok:
        await manager.chat(sid, None, f"🔑 {body.player_name} 님이 미니게임을 통과해 열쇠를 얻었습니다!")
        await manager.broadcast(sid, {"type": "state_changed", "reason": "key"})
    return {"success": ok, "message": message, "state": state}


@router.post("/sessions/{session_id}/rooms/{slot}/use-key", response_model=ActionResponse)
async def use_key(slot: int, body: PlayerAction, sid: str = Depends(session_sid)):
    (message, cleared), state = await asyncio.to_thread(_with_state, sid, game_logic.use_key, slot, body.player_name)
    if cleared:
        await _notify_clear(sid, slot, state, body.player_name)
    await manager.broadcast(sid, {"type": "state_changed", "reason": "use_key"})
    return {"success": True, "message": message, "state": state}


@router.post("/sessions/{session_id}/rooms/{slot}/hint", response_model=HintResponse)
async def request_hint(slot: int, body: HintRequest, sid: str = Depends(session_sid)):
    room = await asyncio.to_thread(game_logic.get_room_for_hint, sid, slot)
    hint, source = await ai_service.generate_hint(room, body.level)
    await manager.broadcast(sid, {"type": "hint_used", "slot": slot, "level": body.level})
    if settings.HINT_PENALTY_SEC > 0:
        await manager.chat(sid, None, f"💡 힌트 사용 — 제한 시간 {settings.HINT_PENALTY_SEC}초 감소")
        await manager.broadcast(sid, {"type": "state_changed", "reason": "hint"})
    return {"hint": hint, "level": body.level, "total": len(room["hints"]), "source": source, "penalty_sec": settings.HINT_PENALTY_SEC}
