"""관리자 API - 인게임 관리자 패널에서 호출.

인증: POST /api/admin/login 으로 토큰 발급 → 이후 요청 헤더 `X-Admin-Token`.
(토큰은 서버 메모리에 저장 - 서버 재시작 시 재로그인 필요)
GameError 는 main.py 의 예외 처리기가 처리하고, async 핸들러의 DB 작업은 스레드에서 실행한다.
"""
import asyncio
import secrets
import sqlite3
import time

from fastapi import APIRouter, Depends, Header, HTTPException, Request

from .. import ai_service, game_logic, repository as repo
from ..config import settings
from ..deps import client_ip, session_sid
from ..schemas import (
    AddTimeRequest, AdminLoginRequest, AdminLoginResponse, EditLog, GenerateRoomRequest,
    RoomDraft, RoomFull, RoomUpdate, ThemeCreate, ThemeFull, ThemeUpdate,
)
from ..ratelimit import login_limiter
from ..ws_manager import manager

router = APIRouter(prefix="/api/admin", tags=["admin"])
_tokens: dict[str, float] = {}  # token → 만료 시각


def require_admin(x_admin_token: str = Header(default="")) -> None:
    exp = _tokens.get(x_admin_token)
    if exp is None or exp < time.time():
        _tokens.pop(x_admin_token, None)
        raise HTTPException(status_code=401, detail="관리자 인증이 필요합니다. (로그인이 만료되었을 수 있습니다)")


@router.post("/login", response_model=AdminLoginResponse)
def login(body: AdminLoginRequest, request: Request):
    ip = client_ip(request)  # 프록시 뒤라면 TRUST_PROXY=true 로 실제 접속 IP 사용
    wait = login_limiter.retry_after(ip)
    if wait:
        raise HTTPException(status_code=429, detail=f"로그인 시도가 너무 많습니다. {wait}초 후 다시 시도하세요.")
    if not secrets.compare_digest(body.password, settings.ADMIN_PASSWORD):
        login_limiter.record(ip)
        raise HTTPException(status_code=401, detail="비밀번호가 틀렸습니다.")
    login_limiter.reset(ip)
    now = time.time()
    for t, exp in list(_tokens.items()):  # 만료된 토큰 정리
        if exp < now:
            _tokens.pop(t, None)
    token = secrets.token_urlsafe(24)
    _tokens[token] = now + settings.ADMIN_TOKEN_TTL_SEC
    warning = (
        "기본 관리자 비밀번호를 쓰고 있습니다. backend/.env 의 ADMIN_PASSWORD 를 바꾸세요."
        if settings.admin_password_is_default else None
    )
    return {"token": token, "expires_in": settings.ADMIN_TOKEN_TTL_SEC, "warning": warning}


@router.post("/logout", dependencies=[Depends(require_admin)])
def logout(x_admin_token: str = Header(default="")):
    _tokens.pop(x_admin_token, None)
    return {"ok": True}


# ---------- 테마 / 방 편집 ----------
@router.get("/themes", response_model=list[ThemeFull], dependencies=[Depends(require_admin)])
def list_themes_full():
    return [{**t, "rooms": repo.list_rooms(t["id"])} for t in repo.list_themes()]


def _theme_full(theme_id: int) -> dict:
    return {**repo.get_theme(theme_id), "rooms": repo.list_rooms(theme_id)}


@router.post("/themes", response_model=ThemeFull, dependencies=[Depends(require_admin)])
async def create_theme(body: ThemeCreate):
    """새 컨셉 생성 → AI 가 5개 방을 자동 생성 (이후 관리자가 개별 수정).
    방 5개를 동시에 생성한 뒤, 테마와 방을 한 트랜잭션으로 저장한다
    (중간에 실패해도 방이 모자란 테마가 남지 않는다)."""
    key = await asyncio.to_thread(game_logic.unique_theme_key, body.name)
    style = body.style.model_dump()
    theme = {"key": key, "name": body.name, "description": body.description, "style": style}
    results = await asyncio.gather(
        *(ai_service.generate_room(theme, idx, body.concept_prompt) for idx in range(settings.ROOMS_PER_THEME)),
        return_exceptions=True,
    )
    rooms: list[tuple[dict, str]] = []
    for idx, res in enumerate(results):
        if isinstance(res, BaseException):  # generate_room 은 실패 시 mock 으로 대체하지만, 만일을 대비
            rooms.append((ai_service.mock_generate_room(theme, idx, body.concept_prompt), "ai"))
        else:
            rooms.append((res[0], "ai"))
    try:
        theme_id = await asyncio.to_thread(repo.create_theme_with_rooms, key, body.name, body.description, style, rooms)
    except sqlite3.IntegrityError:
        raise HTTPException(409, "같은 이름의 테마가 방금 만들어졌습니다. 다시 시도하세요.")
    await asyncio.to_thread(
        repo.add_log, "ai", "theme", theme_id, {"action": "create", "name": body.name, "prompt": body.concept_prompt}
    )
    await manager.broadcast_all({"type": "content_updated", "target": "theme"})
    return await asyncio.to_thread(_theme_full, theme_id)


def _update_theme_sync(theme_id: int, fields: dict) -> dict:
    if not repo.get_theme(theme_id):
        raise HTTPException(404, "테마가 없습니다.")
    repo.update_theme(theme_id, dict(fields))
    repo.add_log("admin", "theme", theme_id, fields)
    return _theme_full(theme_id)


@router.put("/themes/{theme_id}", response_model=ThemeFull, dependencies=[Depends(require_admin)])
async def update_theme(theme_id: int, body: ThemeUpdate):
    result = await asyncio.to_thread(_update_theme_sync, theme_id, body.model_dump(exclude_none=True))
    await manager.broadcast_all({"type": "content_updated", "target": "theme"})
    return result


def _update_room_sync(room_id: int, fields: dict) -> dict:
    if not repo.get_room(room_id):
        raise HTTPException(404, "방이 없습니다.")
    if fields.pop("remove_minigame", False):
        fields["minigame"] = None
    actor = fields.get("source", "admin")
    repo.update_room(room_id, dict(fields))
    repo.add_log(actor, "room", room_id, fields)
    return repo.get_room(room_id)


@router.put("/rooms/{room_id}", response_model=RoomFull, dependencies=[Depends(require_admin)])
async def update_room(room_id: int, body: RoomUpdate):
    result = await asyncio.to_thread(_update_room_sync, room_id, body.model_dump(exclude_none=True))
    await manager.broadcast_all({"type": "content_updated", "target": "room"})
    return result


# ---------- AI 편집 ----------
@router.post("/ai/generate-room", response_model=RoomDraft, dependencies=[Depends(require_admin)])
async def generate_room(body: GenerateRoomRequest):
    """AI 방 초안 생성 (저장하지 않음). 관리자가 확인 후 PUT /rooms/{id} (source=ai) 로 적용."""
    theme = await asyncio.to_thread(repo.get_theme, body.theme_id)
    if not theme:
        raise HTTPException(404, "테마가 없습니다.")
    draft, source = await ai_service.generate_room(theme, body.order_idx, body.prompt)
    await asyncio.to_thread(
        repo.add_log, "ai", "room_draft", f"{body.theme_id}:{body.order_idx}",
        {"prompt": body.prompt, "source": source, "name": draft["name"]},
    )
    return draft


# ---------- 세션 관리 ----------
@router.post("/sessions/{session_id}/time", dependencies=[Depends(require_admin)])
async def add_time(body: AddTimeRequest, sid: str = Depends(session_sid)):
    await asyncio.to_thread(game_logic.admin_add_time, sid, body.delta_min)
    await manager.chat(sid, None, f"관리자가 시간을 {body.delta_min:+d}분 조정했습니다.")
    await manager.broadcast(sid, {"type": "state_changed", "reason": "admin_time"})
    return {"ok": True}


@router.post("/sessions/{session_id}/rooms/{slot}/unlock", dependencies=[Depends(require_admin)])
async def force_unlock(slot: int, sid: str = Depends(session_sid)):
    await asyncio.to_thread(game_logic.admin_force_unlock, sid, slot)
    await manager.chat(sid, None, f"관리자가 {slot + 1}번 방을 강제로 열었습니다.")
    await manager.broadcast(sid, {"type": "state_changed", "reason": "admin_unlock"})
    return {"ok": True}


@router.post("/sessions/{session_id}/reset", dependencies=[Depends(require_admin)])
async def reset_session(sid: str = Depends(session_sid)):
    await asyncio.to_thread(game_logic.admin_reset, sid)
    await manager.chat(sid, None, "관리자가 게임을 초기화했습니다.")
    await manager.broadcast(sid, {"type": "state_changed", "reason": "admin_reset"})
    return {"ok": True}


@router.get("/logs", response_model=list[EditLog], dependencies=[Depends(require_admin)])
def logs(limit: int = 50):
    return repo.list_logs(min(limit, 200))
