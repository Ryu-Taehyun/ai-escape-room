"""라우터 공통 의존성."""
from fastapi import Request

from .config import settings


def session_sid(session_id: str) -> str:
    """경로의 방 코드(session_id)를 대문자로 정규화 → 핸들러는 `sid: str = Depends(session_sid)`"""
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
