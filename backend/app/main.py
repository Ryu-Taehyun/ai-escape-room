"""FastAPI 진입점.  실행: uvicorn app.main:app --reload --port 8000"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import BASE_DIR, settings
from .database import init_db
from .deps import client_ip
from .ratelimit import lookup_miss_limiter
from .game_logic import GameError
from .routers import admin, game, ws


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings.check_startup()  # 운영 환경 + 기본 비밀번호면 여기서 시작 거부
    init_db()
    if settings.admin_password_is_default:
        logging.getLogger("uvicorn.error").warning("⚠ 기본 관리자 비밀번호를 사용 중입니다. backend/.env 의 ADMIN_PASSWORD 를 바꾸세요.")
    elif settings.admin_password_is_weak:
        logging.getLogger("uvicorn.error").warning("⚠ 관리자 비밀번호가 약합니다 (12자 이상, 문자 종류 2가지 이상 권장).")
    yield


# 운영 환경에서는 API 문서(/docs, /redoc, /openapi.json)를 숨긴다 (관리자 API 목록 노출 방지)
_docs = {} if not settings.is_production else {"docs_url": None, "redoc_url": None, "openapi_url": None}
app = FastAPI(title="AI Escape Room API", version="0.1.0", lifespan=lifespan, **_docs)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=False,  # 쿠키를 쓰지 않는다 (관리자 인증은 X-Admin-Token 헤더)
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["Content-Type", "X-Admin-Token"],
)

# 보안 헤더: 모든 응답에 붙이고, 화면(HTML)에는 CSP 도 붙인다
_CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; "
    "connect-src 'self' ws: wss:; worker-src 'self' blob:; object-src 'none'; "
    "base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    h = response.headers
    h.setdefault("X-Content-Type-Options", "nosniff")
    h.setdefault("X-Frame-Options", "DENY")
    h.setdefault("Referrer-Policy", "no-referrer")
    h.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    h.setdefault("Cross-Origin-Opener-Policy", "same-origin")
    if request.url.path.startswith("/api/admin"):
        h.setdefault("Cache-Control", "no-store")  # 관리자 응답(정답 포함)은 캐시하지 않는다
    if "text/html" in h.get("content-type", ""):
        h.setdefault("Content-Security-Policy", _CSP)
    return response


@app.exception_handler(GameError)
async def game_error_handler(request: Request, e: GameError) -> JSONResponse:
    """게임 규칙 위반(잠긴 방, 종료된 게임 등) → HTTPException 과 같은 {"detail": ...} 형식으로 응답"""
    if e.status_code == 404 and request.url.path.startswith("/api/sessions/"):
        lookup_miss_limiter.record(client_ip(request))  # 없는 방 코드 조회 기록 (무작위 대입 방지)
    return JSONResponse(status_code=e.status_code, content={"detail": e.message})


app.include_router(game.router)
app.include_router(admin.router)
app.include_router(ws.router)


@app.get("/api/health")
def health():
    return {"status": "ok", "ai_provider": settings.AI_PROVIDER}


# 배포용: frontend 를 빌드(npm run build)해 두면 이 서버 하나로 게임까지 제공한다 (http://<서버>:8000)
FRONT_DIST = BASE_DIR.parent / "frontend" / "dist"
if FRONT_DIST.is_dir():
    app.mount("/", StaticFiles(directory=FRONT_DIST, html=True), name="frontend")
