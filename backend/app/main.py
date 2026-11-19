"""FastAPI 진입점.  실행: uvicorn app.main:app --reload --port 8000"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import BASE_DIR, settings
from .database import init_db
from .routers import admin, game, ws


@asynccontextmanager
async def lifespan(_: FastAPI):
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
