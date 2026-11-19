"""WebSocket 협동 기능 - 세션(방 코드)별 접속자 관리와 브로드캐스트.

서버 → 클라이언트 메시지 (type)
  welcome         {player_id, players}
  player_joined   {player}
  player_left     {player_id}
  player_moved    {player_id, position, rotation, slot}
  chat            {player_id, name, text, ts}
  state_changed   {reason}            # 클라이언트는 GET /api/sessions/{id} 로 재조회
  room_cleared    {slot, room_name, by}
  hint_used       {slot, by}
  content_updated {target}            # 관리자/AI 편집 → 모든 세션 재조회
  pong

클라이언트 → 서버
  move {position:[x,y,z], rotation, slot} | chat {text} | ping
  ready {ready}            # 대기실 준비 완료 (모두 준비하면 자동 시작)
  mark {position:[x,y,z]}  # 핑: 바라보는 곳 표시 → 서버가 mark 로 모두에게 전달

서버 → 클라이언트 (추가)
  lobby   {players}        # 대기실 준비 상태
  mark    {player_id, name, position}
"""
import asyncio
import secrets
import time
from dataclasses import dataclass, field

from fastapi import WebSocket


@dataclass
class Player:
    id: str
    name: str
    ws: WebSocket
    position: list[float] = field(default_factory=lambda: [0.0, 1.6, 3.0])
    rotation: float = 0.0
    slot: int = 0
    ready: bool = False

    def public(self) -> dict:
        return {"id": self.id, "name": self.name, "position": self.position, "rotation": self.rotation, "slot": self.slot, "ready": self.ready}


class ConnectionManager:
    def __init__(self) -> None:
        self.sessions: dict[str, dict[str, Player]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, session_id: str, ws: WebSocket, name: str) -> Player:
        await ws.accept()
        player = Player(id=secrets.token_hex(4), name=name[:20] or "Player", ws=ws)
        async with self._lock:
            self.sessions.setdefault(session_id, {})[player.id] = player
        return player

    async def disconnect(self, session_id: str, player_id: str) -> None:
        async with self._lock:
            players = self.sessions.get(session_id, {})
            players.pop(player_id, None)
            if not players:
                self.sessions.pop(session_id, None)

    def players(self, session_id: str) -> list[dict]:
        return [p.public() for p in self.sessions.get(session_id, {}).values()]

    def get(self, session_id: str, player_id: str) -> Player | None:
        return self.sessions.get(session_id, {}).get(player_id)

    async def broadcast(self, session_id: str, message: dict, exclude: str | None = None) -> None:
        dead: list[str] = []
        for pid, p in list(self.sessions.get(session_id, {}).items()):
            if pid == exclude:
                continue
            try:
                await p.ws.send_json(message)
            except Exception:  # noqa: BLE001 - 끊긴 소켓 정리
                dead.append(pid)
        for pid in dead:
            await self.disconnect(session_id, pid)

    async def broadcast_all(self, message: dict) -> None:
        for sid in list(self.sessions.keys()):
            await self.broadcast(sid, message)

    async def chat(self, session_id: str, player: Player | None, text: str) -> None:
        await self.broadcast(
            session_id,
            {
                "type": "chat",
                "player_id": player.id if player else "system",
                "name": player.name if player else "SYSTEM",
                "text": text[:300],
                "ts": time.time(),
            },
        )


manager = ConnectionManager()
