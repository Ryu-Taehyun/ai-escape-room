"""FastAPI 진입점.  실행: uvicorn app.main:app --reload --port 8000"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import BASE_DIR, settings
from .database import init_db
from .game_logic import GameError
from .routers import admin, game, ws


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings.check_startup()  # 운영 환경 + 기본 비밀번호면 여기서 시작 거부
    init_db()
    if settings.admin_password_is_default:
        logging.getLogger("uvicorn.error").warning("⚠ 기본 관리자 비밀번호를 사용 중입니다. backend/.env 의 ADMIN_PASSWORD 를 바꾸세요.")
    yield


app = FastAPI(title="AI Escape Room API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(GameError)
async def game_error_handler(_: Request, e: GameError) -> JSONResponse:
    """게임 규칙 위반(잠긴 방, 종료된 게임 등) → HTTPException 과 같은 {"detail": ...} 형식으로 응답"""
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
