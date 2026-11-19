"""WebSocket 엔드포인트: ws://<host>/ws/{session_id}?name=닉네임

클라이언트가 보낸 값은 믿지 않는다:
- JSON 객체가 아닌 메시지, 숫자가 아니거나 NaN/무한대인 값은 무시 (소켓을 끊지 않음)
- 접속자마다 move / chat / mark / ready·restart 빈도 제한 (넘친 move 는 조용히 버리고, chat 은 본인에게만 안내)
- DB 조회는 스레드에서 실행해 이벤트 루프를 막지 않는다
"""
import asyncio
import math

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .. import game_logic, repository as repo
from ..config import settings
from ..ratelimit import ws_chat_limiter, ws_mark_limiter, ws_misc_limiter, ws_move_limiter
from ..ws_manager import manager

router = APIRouter()
_LIMITERS = (ws_move_limiter, ws_chat_limiter, ws_mark_limiter, ws_misc_limiter)


def _num(value) -> float | None:
    """유한한 숫자면 float, 아니면 None (bool·문자열·NaN·무한대 거부)"""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    value = float(value)
    return value if math.isfinite(value) else None


def _vec3(value) -> list[float] | None:
    if not isinstance(value, list) or len(value) != 3:
        return None
    nums = [_num(v) for v in value]
    return None if any(n is None for n in nums) else nums  # type: ignore[return-value]


def _slot(value) -> int | None:
    """방 번호: 0 ~ MAX_ROOMS-1 범위의 정수만"""
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value if 0 <= value < settings.MAX_ROOMS else None


async def _lobby_update(sid: str) -> None:
    """대기실 준비 상태를 알리고, 접속자 전원이 준비하면 게임을 시작한다."""
    players = manager.players(sid)
    await manager.broadcast(sid, {"type": "lobby", "players": players})
    session = await asyncio.to_thread(repo.get_session, sid)
    if session and session["status"] == "waiting" and players and all(p["ready"] for p in players):
        if await asyncio.to_thread(game_logic.start_session, sid):
            await manager.chat(sid, None, "모두 준비 완료! 게임을 시작합니다.")
            await manager.broadcast(sid, {"type": "state_changed", "reason": "start"})


@router.websocket("/ws/{session_id}")
async def game_socket(websocket: WebSocket, session_id: str, name: str = "Player"):
    sid = session_id.upper()
    if not await asyncio.to_thread(repo.get_session, sid):
        await websocket.close(code=4404)
        return

    player = await manager.connect(sid, websocket, name)
    key = f"{sid}:{player.id}"
    try:
        await websocket.send_json({"type": "welcome", "player_id": player.id, "name": player.name, "players": manager.players(sid)})
        await manager.broadcast(sid, {"type": "player_joined", "player": player.public()}, exclude=player.id)
        await manager.chat(sid, None, f"{player.name} 님이 입장했습니다.")

        while True:
            try:
                data = await websocket.receive_json()
            except ValueError:
                continue  # 잘못된 JSON 무시
            if not isinstance(data, dict):
                continue  # 배열·숫자 등 객체가 아닌 메시지 무시
            kind = data.get("type")

            if kind == "move":
                if not ws_move_limiter.hit(key):
                    continue  # 너무 잦은 위치 전송은 버린다
                pos = _vec3(data.get("position"))
                rotation = _num(data.get("rotation", 0))
                slot = _slot(data.get("slot", 0))
                if pos is None or rotation is None or slot is None:
                    continue
                player.position, player.rotation, player.slot = pos, rotation, slot
                await manager.broadcast(
                    sid,
                    {"type": "player_moved", "player_id": player.id, "position": pos,
                     "rotation": rotation, "slot": slot},
                    exclude=player.id,
                )
            elif kind == "chat":
                text = data.get("text")
                if not isinstance(text, str) or not text.strip():
                    continue
                if not ws_chat_limiter.hit(key):
                    await manager.notice(player, "채팅을 너무 빨리 보내고 있어요. 잠시 후 다시 보내세요.")
                    continue
                await manager.chat(sid, player, text.strip())
            elif kind == "ready":
                if not ws_misc_limiter.hit(key):
                    continue
                player.ready = bool(data.get("ready", True))
                await _lobby_update(sid)
            elif kind == "mark":
                pos = _vec3(data.get("position"))
                if pos is not None and ws_mark_limiter.hit(key):
                    await manager.broadcast(sid, {"type": "mark", "player_id": player.id, "name": player.name, "position": pos})
            elif kind == "restart":
                new_sid = data.get("session_id")
                if not isinstance(new_sid, str) or not ws_misc_limiter.hit(key):
                    continue
                new_sid = new_sid.upper()[:12]
                new = await asyncio.to_thread(repo.get_session, new_sid)
                if new and new["status"] == "waiting" and new_sid != sid:
                    await manager.broadcast(sid, {"type": "restart", "session_id": new_sid, "by": player.name}, exclude=player.id)
            elif kind == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    finally:
        for limiter in _LIMITERS:
            limiter.reset(key)
        await manager.disconnect(sid, player.id)
        await manager.broadcast(sid, {"type": "player_left", "player_id": player.id})
        await manager.chat(sid, None, f"{player.name} 님이 나갔습니다.")
        await _lobby_update(sid)
