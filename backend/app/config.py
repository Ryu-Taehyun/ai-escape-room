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
    _DEFAULT_MODELS = {"claude": "claude-sonnet-5-5", "gemini": "gemini-2.5-flash"}
    # 비워 두거나 다른 회사 모델 이름이 남아 있으면 (예: gemini 인데 claude-...) provider 기본 모델 사용
    AI_MODEL: str = os.getenv("AI_MODEL", "").strip()
    if not AI_MODEL or (AI_PROVIDER == "gemini" and AI_MODEL.startswith("claude")) or (
        AI_PROVIDER == "claude" and AI_MODEL.startswith("gemini")
    ):
        AI_MODEL = _DEFAULT_MODELS.get(AI_PROVIDER, "claude-sonnet-5-5")
    AI_TIMEOUT_SEC: float = float(os.getenv("AI_TIMEOUT_SEC", "30"))
    # API 키가 있으면 게임을 시작할 때마다 AI 가 모든 방의 문제를 새로 만든다 (false 면 테마의 기본 방 사용)
    AI_RANDOM_ROOMS: bool = os.getenv("AI_RANDOM_ROOMS", "true").strip().lower() not in ("0", "false", "no", "off")

    # nginx 등 리버스 프록시 뒤에서 실행할 때만 true → 관리자 로그인 제한에 X-Forwarded-For 사용
    TRUST_PROXY: bool = os.getenv("TRUST_PROXY", "false").strip().lower() in ("1", "true", "yes", "on")

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
    HINT_PENALTY_SEC: int = int(os.getenv("HINT_PENALTY_SEC", "60"))  # 힌트 1회당 줄어드는 시간 (0 = 감점 없음)
    ADMIN_TOKEN_TTL_SEC: int = int(os.getenv("ADMIN_TOKEN_TTL_SEC", str(2 * 60 * 60)))  # 관리자 로그인 유지 시간
    SESSION_KEEP_HOURS: int = int(os.getenv("SESSION_KEEP_HOURS", "24"))  # 이보다 오래된 세션은 서버 시작 시 삭제

    @property
    def ai_enabled(self) -> bool:
        """실제 LLM 을 쓸 수 있는가 (mock 이 아니고 키가 있음)"""
        return self.AI_PROVIDER in ("claude", "gemini") and bool(self.AI_API_KEY)

    @property
    def ai_random_rooms(self) -> bool:
        return self.ai_enabled and self.AI_RANDOM_ROOMS

    @property
    def admin_password_is_default(self) -> bool:
        return self.ADMIN_PASSWORD in ("admin1234", "change-me", "")

    @property
    def is_production(self) -> bool:
        return self.APP_ENV.strip().lower() in ("production", "prod")

    def check_startup(self) -> None:
        """서버 시작 전 설정 점검. 운영 환경에서 기본 관리자 비밀번호면 시작을 거부한다."""
        if self.is_production and self.admin_password_is_default:
            raise RuntimeError(
                "APP_ENV=production 에서는 기본 관리자 비밀번호로 서버를 시작할 수 없습니다. "
                "backend/.env 의 ADMIN_PASSWORD 를 바꾸세요."
            )


settings = Settings()
