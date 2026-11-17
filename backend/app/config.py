"""환경 변수 로딩 및 게임 규칙 상수."""
import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def _db_path() -> str:
    raw = os.getenv("DATABASE_PATH", "escape_room.db")
    p = Path(raw)
    return str(p if p.is_absolute() else BASE_DIR / p)


class Settings:
    APP_ENV: str = os.getenv("APP_ENV", "development")
    DATABASE_PATH: str = _db_path()
    ADMIN_PASSWORD: str = os.getenv("ADMIN_PASSWORD", "admin1234")

    AI_PROVIDER: str = os.getenv("AI_PROVIDER", "mock").lower()
    AI_API_KEY: str = os.getenv("AI_API_KEY", "")
    AI_MODEL: str = os.getenv("AI_MODEL", "claude-sonnet-5-5")
    AI_TIMEOUT_SEC: float = float(os.getenv("AI_TIMEOUT_SEC", "30"))

    CORS_ORIGINS: list[str] = [
        o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()
    ]

    # ---- 게임 규칙 ----
    MIN_ROOMS: int = 2
    MAX_ROOMS: int = 5
    DEFAULT_ROOMS: int = 4
    MIN_TIME_MIN: int = 30
    MAX_TIME_MIN: int = 120
    DEFAULT_TIME_MIN: int = 60
    ROOMS_PER_THEME: int = 5  # 테마마다 5개 방을 보유, 세션은 그 중 2~5개를 사용


settings = Settings()
