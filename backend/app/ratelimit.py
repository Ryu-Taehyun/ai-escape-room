"""간단한 메모리 기반 시도 횟수 제한 (단일 서버용).

- 관리자 로그인: 1분에 5번 틀리면 잠시 차단
- 정답 제출: 같은 방에서 30초에 6번 틀리면 잠시 차단 (짧은 숫자 정답 무차별 대입 방지)
"""
import time
from collections import defaultdict, deque


class RateLimiter:
    def __init__(self, limit: int, window_sec: float):
        self.limit = limit
        self.window = window_sec
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def _trim(self, key: str, now: float) -> deque[float]:
        q = self._hits[key]
        while q and now - q[0] > self.window:
            q.popleft()
        return q

    def retry_after(self, key: str) -> int:
        """차단 중이면 남은 초, 아니면 0"""
        now = time.time()
        q = self._trim(key, now)
        if len(q) < self.limit:
            return 0
        return max(1, int(self.window - (now - q[0])) + 1)

    def record(self, key: str) -> None:
        now = time.time()
        self._trim(key, now).append(now)

    def reset(self, key: str) -> None:
        self._hits.pop(key, None)


login_limiter = RateLimiter(limit=5, window_sec=60)
answer_limiter = RateLimiter(limit=6, window_sec=30)
