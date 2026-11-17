"""관리자 API - 인게임 관리자 패널에서 호출.

인증: POST /api/admin/login 으로 토큰 발급 → 이후 요청 헤더 `X-Admin-Token`.
(토큰은 서버 메모리에 저장 - 서버 재시작 시 재로그인 필요)
"""
import secrets

from fastapi import APIRouter, Depends, Header, HTTPException

from .. import ai_service, game_logic, repository as repo
from ..config import settings
from ..game_logic import GameError
from ..schemas import (
    AddTimeRequest, AdminLoginRequest, AdminLoginResponse, EditLog, GenerateRoomRequest,
    RoomDraft, RoomFull, RoomUpdate, ThemeCreate, ThemeFull, ThemeUpdate,
)
from ..ws_manager import manager

router = APIRouter(prefix="/api/admin", tags=["admin"])
_tokens: set[str] = set()


def require_admin(x_admin_token: str = Header(default="")) -> None:
    if x_admin_token not in _tokens:
        raise HTTPException(status_code=401, detail="관리자 인증이 필요합니다.")


@router.post("/login", response_model=AdminLoginResponse)
def login(body: AdminLoginRequest):
    if not secrets.compare_digest(body.password, settings.ADMIN_PASSWORD):
        raise HTTPException(status_code=401, detail="비밀번호가 틀렸습니다.")
    token = secrets.token_urlsafe(24)
    _tokens.add(token)
    return {"token": token}


# ---------- 테마 / 방 편집 ----------
@router.get("/themes", response_model=list[ThemeFull], dependencies=[Depends(require_admin)])
def list_themes_full():
    return [{**t, "rooms": repo.list_rooms(t["id"])} for t in repo.list_themes()]


@router.post("/themes", response_model=ThemeFull, dependencies=[Depends(require_admin)])
async def create_theme(body: ThemeCreate):
    """새 컨셉 생성 → AI 가 5개 방을 자동 생성 (이후 관리자가 개별 수정)."""
    key = game_logic.unique_theme_key(body.name)
    theme_id = repo.create_theme(key, body.name, body.description, body.style.model_dump())
    theme = repo.get_theme(theme_id)
    for idx in range(settings.ROOMS_PER_THEME):
        draft, source = await ai_service.generate_room(theme, idx, body.concept_prompt)
        repo.insert_room(theme_id, idx, draft, "ai")
    repo.add_log("ai", "theme", theme_id, {"action": "create", "name": body.name, "prompt": body.concept_prompt})
    await manager.broadcast_all({"type": "content_updated", "target": "theme"})
    return {**repo.get_theme(theme_id), "rooms": repo.list_rooms(theme_id)}


@router.put("/themes/{theme_id}", response_model=ThemeFull, dependencies=[Depends(require_admin)])
async def update_theme(theme_id: int, body: ThemeUpdate):
    if not repo.get_theme(theme_id):
        raise HTTPException(404, "테마가 없습니다.")
    fields = body.model_dump(exclude_none=True)
    repo.update_theme(theme_id, dict(fields))
    repo.add_log("admin", "theme", theme_id, fields)
    await manager.broadcast_all({"type": "content_updated", "target": "theme"})
    return {**repo.get_theme(theme_id), "rooms": repo.list_rooms(theme_id)}


@router.put("/rooms/{room_id}", response_model=RoomFull, dependencies=[Depends(require_admin)])
async def update_room(room_id: int, body: RoomUpdate):
    if not repo.get_room(room_id):
        raise HTTPException(404, "방이 없습니다.")
    fields = body.model_dump(exclude_none=True)
    if fields.pop("remove_minigame", False):
        fields["minigame"] = None
    actor = fields.get("source", "admin")
    repo.update_room(room_id, dict(fields))
    repo.add_log(actor, "room", room_id, fields)
    await manager.broadcast_all({"type": "content_updated", "target": "room"})
    return repo.get_room(room_id)


# ---------- AI 편집 ----------
@router.post("/ai/generate-room", response_model=RoomDraft, dependencies=[Depends(require_admin)])
async def generate_room(body: GenerateRoomRequest):
    """AI 방 초안 생성 (저장하지 않음). 관리자가 확인 후 PUT /rooms/{id} (source=ai) 로 적용."""
    theme = repo.get_theme(body.theme_id)
    if not theme:
        raise HTTPException(404, "테마가 없습니다.")
    draft, source = await ai_service.generate_room(theme, body.order_idx, body.prompt)
    repo.add_log("ai", "room_draft", f"{body.theme_id}:{body.order_idx}", {"prompt": body.prompt, "source": source, "name": draft["name"]})
    return draft


# ---------- 세션 관리 ----------
def _wrap(fn, *args):
    try:
        fn(*args)
    except GameError as e:
        raise HTTPException(e.status_code, e.message)


@router.post("/sessions/{session_id}/time", dependencies=[Depends(require_admin)])
async def add_time(session_id: str, body: AddTimeRequest):
    sid = session_id.upper()
    _wrap(game_logic.admin_add_time, sid, body.delta_min)
    await manager.chat(sid, None, f"관리자가 시간을 {body.delta_min:+d}분 조정했습니다.")
    await manager.broadcast(sid, {"type": "state_changed", "reason": "admin_time"})
    return {"ok": True}


@router.post("/sessions/{session_id}/rooms/{slot}/unlock", dependencies=[Depends(require_admin)])
async def force_unlock(session_id: str, slot: int):
    sid = session_id.upper()
    _wrap(game_logic.admin_force_unlock, sid, slot)
    await manager.chat(sid, None, f"관리자가 {slot + 1}번 방을 강제로 열었습니다.")
    await manager.broadcast(sid, {"type": "state_changed", "reason": "admin_unlock"})
    return {"ok": True}


@router.post("/sessions/{session_id}/reset", dependencies=[Depends(require_admin)])
async def reset_session(session_id: str):
    sid = session_id.upper()
    _wrap(game_logic.admin_reset, sid)
    await manager.chat(sid, None, "관리자가 게임을 초기화했습니다.")
    await manager.broadcast(sid, {"type": "state_changed", "reason": "admin_reset"})
    return {"ok": True}


@router.get("/logs", response_model=list[EditLog], dependencies=[Depends(require_admin)])
def logs(limit: int = 50):
    return repo.list_logs(min(limit, 200))
