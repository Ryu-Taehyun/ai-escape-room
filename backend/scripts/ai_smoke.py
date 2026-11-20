"""실제 AI 연결 확인 (API 키가 있을 때만 의미 있음).

    cd backend
    python -m scripts.ai_smoke          # backend/.env 의 AI_PROVIDER / AI_API_KEY 사용

AI 로 방 2개를 새로 만들고 힌트 1개를 받아, 게임에 그대로 쓸 수 있는지 검사한다.
AI 호출 3번을 쓴다 (하루 한도 AI_DAILY_LIMIT 에 포함). 성공하면 종료 코드 0.
"""
import asyncio
import os
import sys
import tempfile

# 실제 게임 DB 를 건드리지 않도록 임시 DB 사용
os.environ.setdefault("DATABASE_PATH", os.path.join(tempfile.mkdtemp(), "smoke.db"))

from app import ai_service, game_logic, repository as repo  # noqa: E402
from app.config import settings  # noqa: E402
from app.database import init_db  # noqa: E402


async def main() -> int:
    if not settings.ai_enabled:
        print("AI 가 꺼져 있습니다. backend/.env 에 AI_PROVIDER=gemini(또는 claude)와 AI_API_KEY 를 넣으세요.")
        return 2
    init_db()
    print(f"provider={settings.AI_PROVIDER} model={settings.AI_MODEL} timeout={settings.AI_TIMEOUT_SEC}s")

    theme = repo.get_theme_by_key("horror")
    rooms = game_logic.select_rooms(repo.list_rooms(theme["id"]), 2)
    overrides, note = await ai_service.generate_session_rooms(theme, rooms, "smoke-test")
    if note:
        print(f"✘ 방 생성 건너뜀: {note}")
        return 1
    for slot, room in sorted(overrides.items()):
        print(f"✔ 방 {slot + 1}: {room['name']} | 유형 {room['puzzle_type']} | 단서 {len(room['clues'])}개 | 정답 길이 {len(room['answer'])}")
    for slot in range(len(rooms)):
        if slot not in overrides:
            print(f"✘ 방 {slot + 1}: AI 생성 실패 → 기본 방으로 대체됨 (서버 로그의 경고 확인)")

    hint, source = await ai_service.generate_hint(overrides.get(0) or rooms[0], 0)
    print(f"{'✔' if source != 'mock' else '✘'} 힌트 ({source}): {hint}")

    ok = len(overrides) == len(rooms) and source != "mock"
    print("\n실제 AI 연결 정상" if ok else "\n일부 실패 - 위 메시지와 키/모델 이름/무료 한도를 확인하세요")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
