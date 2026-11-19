"""플레이어용 REST API."""
from fastapi import APIRouter, HTTPException

from .. import ai_service, game_logic, repository as repo
from ..game_logic import GameError
from ..schemas import (
    ActionResponse, AnswerRequest, AnswerResponse, CreateSessionRequest, GameConfig, HintRequest,
    HintResponse, InspectResponse, MinigameFinishRequest, MinigameStartResponse, PlayerAction,
    SessionState, ThemeSummary,
)
from ..ws_manager import manager

router = APIRouter(prefix="/api", tags=["game"])


def _raise(e: GameError):
    raise HTTPException(status_code=e.status_code, detail=e.message)


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


@router.post("/sessions", response_model=SessionState)
def create_session(body: CreateSessionRequest):
    try:
        sid = game_logic.create_session(body.theme_key, body.room_count, body.time_limit_min, body.start_now)
        return game_logic.get_state(sid)
    except GameError as e:
        _raise(e)


@router.get("/sessions/{session_id}", response_model=SessionState)
def get_session(session_id: str):
    try:
        return game_logic.get_state(session_id.upper())
    except GameError as e:
        _raise(e)


@router.post("/sessions/{session_id}/start", response_model=SessionState)
async def start_session(session_id: str):
    """대기실에서 바로 시작 (준비 완료를 기다리지 않음)"""
    sid = session_id.upper()
    try:
        if game_logic.start_session(sid):
            await manager.chat(sid, None, "게임이 시작되었습니다.")
            await manager.broadcast(sid, {"type": "state_changed", "reason": "start"})
        return game_logic.get_state(sid)
    except GameError as e:
        _raise(e)


async def _notify_clear(sid: str, slot: int, state: dict, by: str) -> None:
    room = state["rooms"][slot]
    await manager.broadcast(sid, {"type": "room_cleared", "slot": slot, "room_name": room["name"], "by": by})


@router.post("/sessions/{session_id}/rooms/{slot}/answer", response_model=AnswerResponse)
async def submit_answer(session_id: str, slot: int, body: AnswerRequest):
    sid = session_id.upper()
    try:
        correct, message, cleared = game_logic.submit_answer(sid, slot, body.answer, body.player_name)
        state = game_logic.get_state(sid)
    except GameError as e:
        _raise(e)

    if correct:
        if cleared:
            await _notify_clear(sid, slot, state, body.player_name)
        else:
            await manager.chat(sid, None, f"🔓 {body.player_name} 님이 {slot + 1}번 방 암호를 풀었습니다.")
        await manager.broadcast(sid, {"type": "state_changed", "reason": "answer"})
    return {"correct": correct, "message": message, "state": state}


# ---------- 모험: 단서 조사 ----------
@router.post("/sessions/{session_id}/rooms/{slot}/clues/{clue_id}/inspect", response_model=InspectResponse)
async def inspect_clue(session_id: str, slot: int, clue_id: str, body: PlayerAction):
    sid = session_id.upper()
    try:
        clue, new = game_logic.inspect_clue(sid, slot, clue_id, body.player_name)
        state = game_logic.get_state(sid)
    except GameError as e:
        _raise(e)
    if new:
        await manager.chat(sid, None, f"🔎 {body.player_name} 님이 단서 발견: {clue['label']}")
        await manager.broadcast(sid, {"type": "state_changed", "reason": "clue"})
    return {"clue": clue, "new": new, "state": state}


# ---------- 미니게임 → 열쇠 ----------
@router.post("/sessions/{session_id}/rooms/{slot}/minigame/start", response_model=MinigameStartResponse)
def start_minigame(session_id: str, slot: int):
    try:
        return game_logic.start_minigame(session_id.upper(), slot)
    except GameError as e:
        _raise(e)


@router.post("/sessions/{session_id}/rooms/{slot}/minigame/finish", response_model=ActionResponse)
async def finish_minigame(session_id: str, slot: int, body: MinigameFinishRequest):
    sid = session_id.upper()
    try:
        ok, message = game_logic.finish_minigame(sid, slot, body.challenge_id, body.result, body.player_name)
        state = game_logic.get_state(sid)
    except GameError as e:
        _raise(e)
    if ok:
        await manager.chat(sid, None, f"🔑 {body.player_name} 님이 미니게임을 통과해 열쇠를 얻었습니다!")
        await manager.broadcast(sid, {"type": "state_changed", "reason": "key"})
    return {"success": ok, "message": message, "state": state}


@router.post("/sessions/{session_id}/rooms/{slot}/use-key", response_model=ActionResponse)
async def use_key(session_id: str, slot: int, body: PlayerAction):
    sid = session_id.upper()
    try:
        message, cleared = game_logic.use_key(sid, slot, body.player_name)
        state = game_logic.get_state(sid)
    except GameError as e:
        _raise(e)
    if cleared:
        await _notify_clear(sid, slot, state, body.player_name)
    await manager.broadcast(sid, {"type": "state_changed", "reason": "use_key"})
    return {"success": True, "message": message, "state": state}


@router.post("/sessions/{session_id}/rooms/{slot}/hint", response_model=HintResponse)
async def request_hint(session_id: str, slot: int, body: HintRequest):
    sid = session_id.upper()
    try:
        room = game_logic.get_room_for_hint(sid, slot)
    except GameError as e:
        _raise(e)
    hint, source = await ai_service.generate_hint(room, body.level)
    await manager.broadcast(sid, {"type": "hint_used", "slot": slot, "level": body.level})
    return {"hint": hint, "level": body.level, "total": len(room["hints"]), "source": source}
