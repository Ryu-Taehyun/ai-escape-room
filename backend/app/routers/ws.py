"""WebSocket 엔드포인트: ws://<host>/ws/{session_id}?name=닉네임"""
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .. import game_logic, repository as repo
from ..ws_manager import manager

router = APIRouter()


def _vec3(value) -> list[float] | None:
    if isinstance(value, list) and len(value) == 3 and all(isinstance(v, (int, float)) for v in value):
        return [float(v) for v in value]
    return None


async def _lobby_update(sid: str) -> None:
    """대기실 준비 상태를 알리고, 접속자 전원이 준비하면 게임을 시작한다."""
    players = manager.players(sid)
    await manager.broadcast(sid, {"type": "lobby", "players": players})
    session = repo.get_session(sid)
    if session and session["status"] == "waiting" and players and all(p["ready"] for p in players):
        if game_logic.start_session(sid):
            await manager.chat(sid, None, "모두 준비 완료! 게임을 시작합니다.")
            await manager.broadcast(sid, {"type": "state_changed", "reason": "start"})


@router.websocket("/ws/{session_id}")
async def game_socket(websocket: WebSocket, session_id: str, name: str = "Player"):
    sid = session_id.upper()
    if not repo.get_session(sid):
        await websocket.close(code=4404)
        return

    player = await manager.connect(sid, websocket, name)
    try:
        await websocket.send_json({"type": "welcome", "player_id": player.id, "name": player.name, "players": manager.players(sid)})
        await manager.broadcast(sid, {"type": "player_joined", "player": player.public()}, exclude=player.id)
        await manager.chat(sid, None, f"{player.name} 님이 입장했습니다.")

        while True:
            try:
                data = await websocket.receive_json()
            except ValueError:
                continue  # 잘못된 JSON 무시
            kind = data.get("type")

            if kind == "move":
                pos = _vec3(data.get("position"))
                if pos is None:
                    continue
                player.position = pos
                player.rotation = float(data.get("rotation", 0))
                player.slot = int(data.get("slot", 0))
                await manager.broadcast(
                    sid,
                    {"type": "player_moved", "player_id": player.id, "position": pos,
                     "rotation": player.rotation, "slot": player.slot},
                    exclude=player.id,
                )
            elif kind == "chat":
                text = str(data.get("text", "")).strip()
                if text:
                    await manager.chat(sid, player, text)
            elif kind == "ready":
                player.ready = bool(data.get("ready", True))
                await _lobby_update(sid)
            elif kind == "mark":
                pos = _vec3(data.get("position"))
                if pos is not None:
                    await manager.broadcast(sid, {"type": "mark", "player_id": player.id, "name": player.name, "position": pos})
            elif kind == "restart":
                new_sid = str(data.get("session_id", "")).upper()
                new = repo.get_session(new_sid)
                if new and new["status"] == "waiting" and new_sid != sid:
                    await manager.broadcast(sid, {"type": "restart", "session_id": new_sid, "by": player.name}, exclude=player.id)
            elif kind == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(sid, player.id)
        await manager.broadcast(sid, {"type": "player_left", "player_id": player.id})
        await manager.chat(sid, None, f"{player.name} 님이 나갔습니다.")
        await _lobby_update(sid)
