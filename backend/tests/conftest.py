"""모든 테스트 공통 환경: app 을 불러오기 전에 설정해야 하므로 conftest 에 둔다."""
import os
import tempfile

os.environ["DATABASE_PATH"] = os.path.join(tempfile.mkdtemp(), "test.db")
os.environ["AI_PROVIDER"] = "mock"
os.environ["AI_MODEL"] = ""
os.environ["ADMIN_PASSWORD"] = "test-pw"
