"""미니게임: 서버가 문제(challenge)를 만들고, 클라이언트 결과를 서버가 검증한다.

type
- sequence : 기억력. 서버가 정한 순서를 보여주고 그대로 입력 → 입력 순서가 일치해야 성공
- wires    : 전선 연결. 왼쪽 색 순서와 섞인 오른쪽 색을 같은 색끼리 연결 → 모든 쌍이 맞아야 성공
- timing   : 타이밍. 움직이는 바늘을 목표 구간에서 멈추기 → 필요한 성공 횟수 이상

difficulty 1~5 로 길이/개수/구간 폭이 바뀐다.
challenge 는 서버 메모리에 5분간 보관 (서버 재시작 시 다시 시작하면 됨).
"""
import random
import secrets
import time
from dataclasses import dataclass, field

CHALLENGE_TTL = 300
MINIGAME_TYPES = ("sequence", "wires", "timing")

SYMBOLS = {
    "server": ["🔴", "🟢", "🔵", "🟡"],
    "pillar": ["☀️", "🌙", "🐍", "🦅"],
    "none": ["▲", "●", "■", "◆"],
}
WIRE_COLORS = ["#e53935", "#1e88e5", "#43a047", "#fdd835", "#8e24aa", "#fb8c00"]


@dataclass
class Challenge:
    id: str
    session_id: str
    slot: int
    type: str
    params: dict          # 클라이언트에 보내는 값
    expected: dict        # 서버만 아는 검증 값
    created: float = field(default_factory=time.time)


_challenges: dict[str, Challenge] = {}


def _cleanup() -> None:
    now = time.time()
    for cid in [c for c, ch in _challenges.items() if now - ch.created > CHALLENGE_TTL]:
        _challenges.pop(cid, None)


def create_challenge(session_id: str, slot: int, minigame: dict, decor: str) -> Challenge:
    _cleanup()
    kind = minigame.get("type", "sequence")
    diff = max(1, min(5, int(minigame.get("difficulty", 2))))
    rng = random.Random()

    if kind == "sequence":
        symbols = SYMBOLS.get(decor, SYMBOLS["none"])
        seq = [rng.randrange(len(symbols)) for _ in range(3 + diff)]
        # sequence 는 클라이언트가 보여줘야 하므로 params 에 포함 (기억력 게임이라 문제 없음)
        params = {"symbols": symbols, "sequence": seq, "show_ms": max(350, 750 - diff * 80)}
        expected = {"sequence": seq}
    elif kind == "wires":
        n = min(len(WIRE_COLORS), 3 + (diff + 1) // 2)
        colors = rng.sample(WIRE_COLORS, n)
        right = list(range(n))
        while right == list(range(n)):
            rng.shuffle(right)
        params = {"left": colors, "right": [colors[i] for i in right], "time_limit_sec": 40 - diff * 4}
        expected = {"right": right, "time_limit_sec": params["time_limit_sec"]}
    elif kind == "timing":
        rounds, required = 3, (2 if diff <= 3 else 3)
        zone = max(0.08, 0.26 - diff * 0.035)  # 0~1 중 목표 구간 폭
        params = {"rounds": rounds, "required": required, "zone_width": round(zone, 3),
                  "speed": round(0.7 + diff * 0.2, 2)}
        expected = {"required": params["required"], "rounds": rounds}
    else:
        raise ValueError(f"unknown minigame type: {kind}")

    ch = Challenge(secrets.token_hex(8), session_id, slot, kind, params, expected)
    _challenges[ch.id] = ch
    return ch


def verify(challenge_id: str, session_id: str, slot: int, result: dict) -> tuple[bool, str]:
    """(성공 여부, 메시지). 검증한 challenge 는 1회용으로 폐기."""
    ch = _challenges.pop(challenge_id, None)
    if not ch or ch.session_id != session_id or ch.slot != slot:
        return False, "만료되었거나 잘못된 미니게임입니다. 다시 시작하세요."
    elapsed = time.time() - ch.created

    if ch.type == "sequence":
        ok = result.get("input") == ch.expected["sequence"]
        return ok, "순서를 정확히 기억했습니다!" if ok else "순서가 틀렸습니다."

    if ch.type == "wires":
        if elapsed > ch.expected["time_limit_sec"] + 5:
            return False, "시간 초과!"
        pairs = result.get("pairs") or []
        right = ch.expected["right"]
        try:
            mapping = {int(l): int(r) for l, r in pairs}
        except (TypeError, ValueError):
            return False, "잘못된 결과입니다."
        ok = len(mapping) == len(right) and all(0 <= r < len(right) and right[r] == l for l, r in mapping.items())
        return ok, "전원이 복구되었습니다!" if ok else "연결이 잘못되었습니다."

    if ch.type == "timing":
        hits = int(result.get("hits", 0))
        ok = ch.expected["required"] <= hits <= ch.expected["rounds"] and elapsed >= 1.0
        return ok, f"{hits}회 성공!" if ok else f"{hits}회 성공 — {ch.expected['required']}회 이상 필요합니다."

    return False, "알 수 없는 미니게임"
