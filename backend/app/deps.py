"""라우터 공통 의존성."""
from fastapi import HTTPException, Request

from .config import settings
from .ratelimit import lookup_miss_limiter


def session_sid(session_id: str, request: Request) -> str:
    """경로의 방 코드(session_id)를 대문자로 정규화 → 핸들러는 `sid: str = Depends(session_sid)`.
    없는 방 코드를 너무 많이 조회한 IP 는 잠시 막는다 (6자리 방 코드 무작위 대입 방지 — main.py 가 404 를 기록)."""
    wait = lookup_miss_limiter.retry_after(client_ip(request))
    if wait:
        raise HTTPException(status_code=429, detail=f"없는 방 코드를 너무 많이 입력했습니다. {wait}초 후 다시 시도하세요.",
                            headers={"Retry-After": str(wait)})
    if len(session_id) > 12:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다.")
    return session_id.upper()


def client_ip(request: Request) -> str:
    """요청한 클라이언트 IP.
    TRUST_PROXY=true (nginx 등 프록시 뒤에서 실행) 이면 X-Forwarded-For 의 마지막 값,
    즉 우리 프록시가 직접 본 주소를 쓴다 (앞쪽 값은 클라이언트가 위조할 수 있음)."""
    if settings.TRUST_PROXY:
        forwarded = request.headers.get("x-forwarded-for", "")
        last = forwarded.split(",")[-1].strip()
        if last:
            return last
    return request.client.host if request.client else "unknown"
