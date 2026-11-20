"""모든 테스트 공통 환경: app 을 불러오기 전에 설정해야 하므로 conftest 에 둔다."""
import os
import tempfile

os.environ["DATABASE_PATH"] = os.path.join(tempfile.mkdtemp(), "test.db")
os.environ["AI_PROVIDER"] = "mock"
os.environ["AI_MODEL"] = ""
os.environ["ADMIN_PASSWORD"] = "test-pw"

import pytest  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _init_db():
    """AI 사용량 기록 등 DB 를 쓰는 함수를 앱 없이 직접 부르는 테스트도 있으므로 먼저 테이블 생성"""
    from app.database import init_db

    init_db()
