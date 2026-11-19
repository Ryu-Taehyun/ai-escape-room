"""간단한 메모리 기반 시도 횟수 제한 (단일 서버용).

- 관리자 로그인: 1분에 5번 틀리면 잠시 차단
- 정답 제출: 같은 방에서 30초에 6번 틀리면 잠시 차단 (짧은 숫자 정답 무차별 대입 방지)
- WebSocket: 접속자마다 move / chat / mark 메시지 빈도 제한
"""
import threading
import time
from collections import defaultdict, deque


class RateLimiter:
    def __init__(self, limit: int, window_sec: float):
        self.limit = limit
        self.window = window_sec
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()  # 동기 엔드포인트는 스레드풀에서 동시에 실행된다

    def _trim(self, key: str, now: float) -> deque[float]:
        q = self._hits[key]
        while q and now - q[0] > self.window:
            q.popleft()
        return q

    def retry_after(self, key: str) -> int:
        """차단 중이면 남은 초, 아니면 0"""
        now = time.time()
        with self._lock:
            q = self._trim(key, now)
            if len(q) < self.limit:
                if not q:
                    self._hits.pop(key, None)  # 빈 기록은 지워 메모리가 쌓이지 않게
                return 0
            return max(1, int(self.window - (now - q[0])) + 1)

    def record(self, key: str) -> None:
        now = time.time()
        with self._lock:
            self._trim(key, now).append(now)

    def hit(self, key: str) -> bool:
        """한도 안이면 기록하고 True, 넘었으면 False (기록 안 함)"""
        now = time.time()
        with self._lock:
            q = self._trim(key, now)
            if len(q) >= self.limit:
                return False
            q.append(now)
            return True

    def reset(self, key: str) -> None:
        with self._lock:
            self._hits.pop(key, None)


login_limiter = RateLimiter(limit=5, window_sec=60)
answer_limiter = RateLimiter(limit=6, window_sec=30)
# WebSocket (접속자별). 클라이언트는 move 를 80ms 마다(초당 약 12번) 보낸다
ws_move_limiter = RateLimiter(limit=30, window_sec=1)
ws_chat_limiter = RateLimiter(limit=5, window_sec=5)
ws_mark_limiter = RateLimiter(limit=4, window_sec=2)
ws_misc_limiter = RateLimiter(limit=10, window_sec=5)   # ready / restart
