"""간단한 메모리 기반 시도 횟수 제한 (단일 서버용).

- 관리자 로그인 (LoginGuard): IP 마다 10분에 5번 틀리면 잠금, 잠길 때마다 잠금 시간이 2배 (1분 → 2 → 4 … 최대 30분).
  서버 전체 실패가 10분에 30번을 넘으면 '경계 모드' — 이미 틀린 적 있는 IP 는 한 번만 더 틀려도 잠긴다
  (여러 IP 로 나눠 시도하는 공격 대비. 한 번도 틀리지 않은 관리자 IP 는 그대로 로그인 가능).
- 정답 제출: 같은 방에서 30초에 6번 틀리면 잠시 차단 (짧은 숫자 정답 무차별 대입 방지)
- 방 코드 찾기: 없는 방 코드를 1분에 20번 조회하면 잠시 차단 (방 코드 무작위 대입 방지)
- 게임 생성 / 힌트 / 미니게임 시작: 과도한 요청으로 DB·메모리가 차는 것 방지
- WebSocket: 접속자마다 move / chat / mark / ping 메시지 빈도 제한

모든 판정은 '먼저 시도로 기록한 뒤 검사' 한다 (동시에 여러 요청을 보내 한도를 넘는 것 방지).
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

    def clear(self) -> None:
        with self._lock:
            self._hits.clear()


class LoginGuard:
    """관리자 로그인 시도 제한 (IP 별 점점 길어지는 잠금 + 서버 전체 경계 모드).

    사용법: begin(ip) → 허용이면 비밀번호 확인 → success(ip) 또는 failure(ip).
    begin() 은 시도를 '일단 실패'로 먼저 기록하므로, 동시에 여러 요청을 보내도 한도를 넘을 수 없다.
    """

    def __init__(self, max_fails: int = 5, window_sec: float = 600, base_lock_sec: float = 60,
                 max_lock_sec: float = 1800, strike_reset_sec: float = 86400,
                 global_fails: int = 30, global_window_sec: float = 600, max_tracked: int = 10000):
        self.max_fails = max_fails
        self.window = window_sec
        self.base_lock = base_lock_sec
        self.max_lock = max_lock_sec
        self.strike_reset = strike_reset_sec
        self.global_fails = global_fails
        self.global_window = global_window_sec
        self.max_tracked = max_tracked
        self._ips: dict[str, dict] = {}
        self._global: deque[float] = deque()
        self._lock = threading.Lock()

    def _state(self, ip: str, now: float) -> dict:
        st = self._ips.get(ip)
        if st is None:
            if len(self._ips) >= self.max_tracked:  # 메모리 보호: 가장 오래 조용했던 IP 부터 정리
                oldest = min(self._ips, key=lambda k: self._ips[k]["seen"])
                self._ips.pop(oldest, None)
            st = {"fails": deque(), "lock_until": 0.0, "strikes": 0, "seen": now, "last_fail": 0.0}
            self._ips[ip] = st
        while st["fails"] and now - st["fails"][0] > self.window:
            st["fails"].popleft()
        if st["strikes"] and now - st["last_fail"] > self.strike_reset:
            st["strikes"] = 0  # 하루 동안 조용하면 잠금 단계 초기화
        st["seen"] = now
        return st

    def _alert(self, now: float) -> bool:
        while self._global and now - self._global[0] > self.global_window:
            self._global.popleft()
        return len(self._global) >= self.global_fails

    def _limit(self, st: dict, now: float) -> int:
        # 경계 모드에서는 이미 틀린 적 있는 IP 에 한 번의 기회만
        return 1 if self._alert(now) and st["strikes"] + len(st["fails"]) > 0 else self.max_fails

    def _lockout(self, st: dict, now: float) -> int:
        st["strikes"] += 1
        sec = min(self.base_lock * 2 ** (st["strikes"] - 1), self.max_lock)
        st["lock_until"] = now + sec
        st["fails"].clear()
        return int(sec)

    def begin(self, ip: str) -> int:
        """0 이면 시도 허용 (이미 '실패 1회'로 기록됨). 양수면 잠금 중 — 남은 초."""
        now = time.time()
        with self._lock:
            st = self._state(ip, now)
            if st["lock_until"] > now:
                return max(1, int(st["lock_until"] - now) + 1)
            if len(st["fails"]) >= self._limit(st, now):
                return self._lockout(st, now)
            st["fails"].append(now)
            return 0

    def success(self, ip: str) -> None:
        with self._lock:
            self._ips.pop(ip, None)

    def failure(self, ip: str) -> dict:
        """실패 확정. {'locked_sec': 잠겼으면 초, 'strikes': 잠금 단계, 'alert': 경계 모드 여부}"""
        now = time.time()
        with self._lock:
            st = self._state(ip, now)
            st["last_fail"] = now
            self._global.append(now)
            alert = self._alert(now)
            locked = self._lockout(st, now) if len(st["fails"]) >= self._limit(st, now) else 0
            return {"locked_sec": locked, "strikes": st["strikes"], "alert": alert, "fails": len(st["fails"])}

    def remaining(self, ip: str) -> int:
        """잠기기 전까지 남은 시도 횟수 (안내용)"""
        now = time.time()
        with self._lock:
            st = self._state(ip, now)
            return max(0, self._limit(st, now) - len(st["fails"]))

    def clear(self) -> None:
        with self._lock:
            self._ips.clear()
            self._global.clear()


login_guard = LoginGuard()
answer_limiter = RateLimiter(limit=6, window_sec=30)
lookup_miss_limiter = RateLimiter(limit=20, window_sec=60)     # 없는 방 코드 조회 (IP 별)
session_create_limiter = RateLimiter(limit=20, window_sec=600)  # 게임 만들기 (IP 별)
hint_limiter = RateLimiter(limit=12, window_sec=60)            # 힌트 (방 별)
minigame_limiter = RateLimiter(limit=20, window_sec=60)        # 미니게임 문제 받기 (방 별)
# WebSocket (접속자별). 클라이언트는 move 를 80ms 마다(초당 약 12번) 보낸다
ws_move_limiter = RateLimiter(limit=30, window_sec=1)
ws_chat_limiter = RateLimiter(limit=5, window_sec=5)
ws_mark_limiter = RateLimiter(limit=4, window_sec=2)
ws_misc_limiter = RateLimiter(limit=10, window_sec=5)   # ready / restart
ws_ping_limiter = RateLimiter(limit=10, window_sec=10)


def reset_all() -> None:
    """모든 제한 기록 초기화 (테스트용)"""
    for v in list(globals().values()):
        if isinstance(v, (RateLimiter, LoginGuard)):
            v.clear()
