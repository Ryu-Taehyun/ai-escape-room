"""AI 서비스 (구성원 1 담당 영역).

- AI_PROVIDER=mock   : API 키 없이 동작. 규칙 기반으로 방/힌트를 생성 (현재 기본값)
- AI_PROVIDER=claude : AI_API_KEY 가 있으면 Claude Messages API 호출, 실패 시 mock 으로 대체
- AI_PROVIDER=gemini : AI_API_KEY 에 Google AI Studio 키(무료 등급 가능)를 넣으면 Gemini API 호출, 실패 시 mock

새 LLM 을 붙이려면 AIProvider 를 상속해 complete() 만 구현하면 된다.
"""
import asyncio
import json
import logging
import random
import re
from pathlib import Path

import httpx

from .config import settings
from .schemas import RoomDraft

log = logging.getLogger("ai")
PROMPT_DIR = Path(__file__).parent / "prompts"
ORDER_LABELS = ["첫 번째 방 (입구, 쉬움)", "두 번째 방", "세 번째 방", "네 번째 방", "마지막 방 (최종 탈출, 어려움)"]


def load_prompt(name: str) -> str:
    return (PROMPT_DIR / f"{name}.txt").read_text(encoding="utf-8")


# =====================================================================
# Providers
# =====================================================================
class AIProvider:
    name = "base"

    async def complete(self, system: str, user: str, max_tokens: int = 800) -> str:
        raise NotImplementedError


class ClaudeProvider(AIProvider):
    name = "claude"
    URL = "https://api.anthropic.com/v1/messages"

    async def complete(self, system: str, user: str, max_tokens: int = 800) -> str:
        headers = {
            "x-api-key": settings.AI_API_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        body = {
            "model": settings.AI_MODEL,
            "max_tokens": max_tokens,
            "system": system,
            "messages": [{"role": "user", "content": user}],
        }
        async with httpx.AsyncClient(timeout=settings.AI_TIMEOUT_SEC) as client:
            res = await client.post(self.URL, headers=headers, json=body)
            res.raise_for_status()
            data = res.json()
        return "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")


class GeminiProvider(AIProvider):
    name = "gemini"
    URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

    async def complete(self, system: str, user: str, max_tokens: int = 800) -> str:
        headers = {"x-goog-api-key": settings.AI_API_KEY, "content-type": "application/json"}
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            # 최신 Gemini 는 '생각' 토큰도 출력 한도에 포함되므로 여유를 크게 둔다
            "generationConfig": {"maxOutputTokens": max_tokens + 4096, "temperature": 0.9},
        }
        async with httpx.AsyncClient(timeout=settings.AI_TIMEOUT_SEC) as client:
            res = await client.post(self.URL.format(model=settings.AI_MODEL), headers=headers, json=body)
            res.raise_for_status()
            data = res.json()
        parts = ((data.get("candidates") or [{}])[0].get("content") or {}).get("parts", [])
        return "".join(p.get("text", "") for p in parts if not p.get("thought"))


_PROVIDERS: dict[str, type[AIProvider]] = {"claude": ClaudeProvider, "gemini": GeminiProvider}


def get_provider() -> AIProvider | None:
    """실제 LLM provider. 키가 없으면 None → mock 사용."""
    cls = _PROVIDERS.get(settings.AI_PROVIDER)
    if cls and settings.ai_enabled:
        return cls()
    return None


def _extract_json(text: str) -> dict:
    match = re.search(r"\{.*\}", text, re.S)
    if not match:
        raise ValueError("JSON not found in AI response")
    return json.loads(match.group(0))


# =====================================================================
# Mock (규칙 기반 생성기) - API 키 없이 동작
# =====================================================================
_WORDS = ["DOOR", "KEY", "EXIT", "LOCK", "OPEN", "GATE", "LIGHT", "SAFE"]
_RIDDLES = [
    ("많이 가질수록 앞이 보이지 않게 되는 것은?", "어둠|암흑", ["빛의 반대입니다.", "밤이 되면 찾아옵니다."]),
    ("부르면 사라지는 것은?", "침묵|정적", ["소리와 관련 있습니다.", "말하는 순간 깨집니다."]),
    ("열쇠는 많지만 문은 하나도 열 수 없는 것은?", "피아노", ["악기입니다.", "흑백 건반이 있습니다."]),
    ("항상 오고 있지만 결코 도착하지 않는 것은?", "내일", ["시간과 관련 있습니다.", "오늘이 지나면 ..."]),
]
_MOOD = {
    "horror": ["깜빡이는 형광등 아래", "식은 공기가 감도는", "누군가 방금 떠난 듯한"],
    "egypt": ["모래 먼지가 흩날리는", "횃불이 일렁이는", "금빛 상형문자가 빛나는"],
}


_CLUE_SPOTS = [[-3.0, 2.4], [3.0, 2.2], [-4.2, -2.6], [2.8, -2.2], [0.0, 2.8]]
_REWARDS = {"horror": ["보안 카드키", "비상 열쇠", "마스터 키"], "egypt": ["황금 열쇠", "스카라베 열쇠", "신전의 열쇠"]}
_MINIGAME_TITLES = {"sequence": "불빛 순서 기억", "wires": "끊어진 회로 연결", "timing": "정밀 타이밍 해제"}


def _caesar(word: str, shift: int) -> str:
    return "".join(chr((ord(c) - 65 + shift) % 26 + 65) for c in word)


def _clue(cid: str, label: str, obj: str, pos: list[float], text: str) -> dict:
    return {"id": cid, "label": label, "object": obj, "pos": pos, "text": text}


def _mock_puzzle(rng: random.Random) -> dict:
    """퍼즐 정보를 여러 단서로 나눈 모험형 퍼즐 생성."""
    spots = rng.sample(_CLUE_SPOTS, 3)
    kind = rng.choice(["cipher", "math", "riddle", "code"])
    if kind == "cipher":
        word, shift = rng.choice(_WORDS), rng.randint(1, 5)
        return {
            "puzzle_type": "cipher",
            "question": "단말기: '암호문을 해독한 영어 단어를 입력하라.' 방 안에서 암호문과 해독 규칙을 찾아라.",
            "answer": word,
            "hints": ["암호문과 규칙이 서로 다른 곳에 있습니다.", f"첫 글자는 '{word[0]}' 입니다."],
            "clues": [
                _clue("cipher", "낡은 쪽지", "note", spots[0], f"쪽지: '암호문 = {_caesar(word, shift)}'"),
                _clue("rule", "찢어진 책", "book", spots[1], f"책: '모든 글자를 알파벳 {shift}칸씩 뒤로 밀었다.'"),
            ],
        }
    if kind == "math":
        a, d = rng.randint(2, 9), rng.randint(3, 7)
        seq = [a + d * i for i in range(4)]
        return {
            "puzzle_type": "math",
            "question": "제단: '벽에 새겨진 수열의 다음 숫자를 새겨라.'",
            "answer": str(a + d * 4),
            "hints": ["수열은 두 곳에 나뉘어 새겨져 있습니다.", f"매번 {d}씩 커집니다."],
            "clues": [
                _clue("seq1", "벽의 숫자 (앞)", "board", spots[0], f"벽: '{seq[0]}, {seq[1]}, …'"),
                _clue("seq2", "석판의 숫자 (뒤)", "tablet", spots[1], f"석판: '… {seq[2]}, {seq[3]}, ?'"),
            ],
        }
    if kind == "riddle":
        q, a, h = rng.choice(_RIDDLES)
        return {
            "puzzle_type": "riddle",
            "question": "목소리가 울린다: '내 수수께끼에 답하라.' 수수께끼가 적힌 곳을 찾아라.",
            "answer": a,
            "hints": h,
            "clues": [
                _clue("riddle", "수수께끼 비문", "tablet", spots[0], f"비문: '{q}'"),
                _clue("hint", "누군가의 메모", "note", spots[1], f"메모: '{h[0]}'"),
            ],
        }
    digits = [rng.randint(1, 9) for _ in range(4)]
    colors = ["빨강", "파랑", "초록", "노랑"]
    return {
        "puzzle_type": "code",
        "question": "보안 장치: '색상 숫자를 정해진 순서대로 입력하시오. (4자리)'",
        "answer": "".join(map(str, digits)),
        "hints": ["숫자 단서 2개와 순서 단서 1개가 있습니다.", f"첫 자리는 {digits[0]} 입니다."],
        "clues": [
            _clue("c1", "메모 조각", "note", spots[0], f"메모: '{colors[0]} = {digits[0]}, {colors[2]} = {digits[2]}'"),
            _clue("c2", "상자 스티커", "box", spots[1], f"스티커: '{colors[1]} = {digits[1]}, {colors[3]} = {digits[3]}'"),
            _clue("order", "벽의 안내문", "board", spots[2], "안내문: '입력 순서 — 빨강 → 파랑 → 초록 → 노랑'"),
        ],
    }


def mock_generate_room(theme: dict, order_idx: int, prompt: str) -> dict:
    rng = random.Random()
    mood = rng.choice(_MOOD.get(theme.get("key", ""), ["낯선 기운이 흐르는"]))
    base = (prompt.strip() or theme["name"]).split("\n")[0][:12]
    suffix = "최종 탈출구" if order_idx == 4 else f"{order_idx + 1}구역"
    room = {
        "name": f"{base} {suffix}",
        "description": f"{mood} 방. {('관리자 메모: ' + prompt.strip()) if prompt.strip() else '곳곳에 단서가 숨겨져 있다.'}"[:200],
        **_mock_puzzle(rng),
        "minigame": None,
    }
    # 최종 방은 항상, 나머지는 50% 확률로 미니게임(열쇠) 추가
    if order_idx == 4 or rng.random() < 0.5:
        mtype = rng.choice(["sequence", "wires", "timing"])
        room["minigame"] = {
            "type": mtype,
            "title": _MINIGAME_TITLES[mtype],
            "description": "미니게임을 통과하면 문을 여는 열쇠를 얻는다.",
            "reward": rng.choice(_REWARDS.get(theme.get("key", ""), ["낡은 열쇠"])),
            "difficulty": min(5, 1 + order_idx // 2 + 1),
        }
    return room


def mock_hint(room: dict, level: int) -> str:
    hints = room["hints"]
    if level < len(hints):
        return hints[level]
    if not room["answer"].strip():
        mg = room.get("minigame") or {}
        return f"'{mg.get('title', '미니게임')}'을(를) 통과해 열쇠를 얻고 문에 사용하세요."
    first = room["answer"].split("|")[0]
    return f"정답은 {len(first)}글자이며 '{first[0]}'(으)로 시작합니다."


# =====================================================================
# Public API
# =====================================================================
async def generate_room(theme: dict, order_idx: int, prompt: str = "") -> tuple[dict, str]:
    """방 초안 생성. (draft, source) 반환. source = 'claude' | 'gemini' | 'mock'"""
    provider = get_provider()
    if provider:
        try:
            user = load_prompt("generate_room").format(
                theme_name=theme["name"],
                theme_description=theme["description"],
                order_label=ORDER_LABELS[order_idx],
                prompt=prompt or "(없음)",
            )
            data = _extract_json(await provider.complete(load_prompt("system"), user, max_tokens=1500))
            data.setdefault("clues", [])
            draft = RoomDraft(**data).model_dump()  # 형식 검증 (실패 시 mock 으로 대체)
            return draft, provider.name
        except Exception as e:  # noqa: BLE001 - AI 실패 시 게임은 계속되어야 함
            log.warning("AI generate_room failed, fallback to mock: %s", e)
    return mock_generate_room(theme, order_idx, prompt), "mock"


async def generate_hint(room: dict, level: int) -> tuple[str, str]:
    provider = get_provider()
    if provider:
        try:
            user = load_prompt("hint").format(
                room_name=room["name"],
                question=room["question"],
                answer=room["answer"] or "(암호 없음)",
                clues=" / ".join(f"{c['label']}: {c['text']}" for c in room.get("clues", [])) or "(없음)",
                minigame=json.dumps(room.get("minigame"), ensure_ascii=False),
                hints=" / ".join(room["hints"]),
                level=level,
            )
            text = (await provider.complete(load_prompt("system"), user, max_tokens=200)).strip()
            if text:
                return text, provider.name
        except Exception as e:  # noqa: BLE001
            log.warning("AI hint failed, fallback to mock: %s", e)
    return mock_hint(room, level), "mock"


# =====================================================================
# 게임마다 새 문제 (AI_RANDOM_ROOMS)
# =====================================================================
# 가구·단말기·문과 겹치지 않는 단서 자리 (mock 생성기와 같은 안전한 위치)
_SAFE_SPOTS = [[-3.0, 2.4], [3.0, 2.2], [-4.2, -2.6], [2.8, -2.2], [0.0, 2.8]]
_PUZZLE_KINDS = ["code", "cipher", "math", "riddle", "logic"]


def _sanitize_session_room(draft: dict, base: dict, is_final: bool) -> dict:
    """AI 초안을 실제 게임에 넣을 수 있게 정리. 쓸 수 없으면 ValueError → 그 방은 기본 방 사용."""
    room = RoomDraft(**draft).model_dump()
    if not room["answer"].strip() and not room.get("minigame"):
        raise ValueError("정답도 미니게임도 없는 방")
    if room["answer"].strip() and not room["clues"]:
        raise ValueError("단서 없는 퍼즐")
    # 단서: 최대 4개, id 중복 제거, 위치는 안전한 자리에 다시 배치 (AI 좌표는 가구와 겹칠 수 있음)
    spots = random.sample(_SAFE_SPOTS, k=len(_SAFE_SPOTS))
    clues, seen = [], set()
    for i, c in enumerate(room["clues"][:4]):
        cid = re.sub(r"[^a-z0-9_]", "", c["id"].lower()) or f"clue{i}"
        while cid in seen:
            cid += "x"
        seen.add(cid)
        clues.append({**c, "id": cid, "pos": spots[i]})
    room["clues"] = clues
    if not room["hints"]:
        room["hints"] = base["hints"][:1] or ["방 안의 단서를 다시 살펴보세요."]
    # 최종 방은 기본 방처럼 미니게임 → 열쇠 → 문 흐름을 유지
    if is_final and not room.get("minigame") and base.get("minigame"):
        room["minigame"] = base["minigame"]
    return room


async def _generate_one(provider: AIProvider, theme: dict, base: dict, slot: int, is_final: bool, kind: str) -> dict:
    request = (
        f"이번 게임만을 위한 새로운 방입니다. 기존 '{base['name']}' 과는 다른 소재와 퍼즐을 쓰세요. "
        f"퍼즐 유형은 '{kind}' 로 하세요. (변화용 번호 {random.randint(1000, 9999)})"
    )
    user = load_prompt("generate_room").format(
        theme_name=theme["name"],
        theme_description=theme["description"],
        order_label=ORDER_LABELS[-1] if is_final else ORDER_LABELS[min(base["order_idx"], len(ORDER_LABELS) - 2)],
        prompt=request,
    )
    text = await provider.complete(load_prompt("system"), user, max_tokens=1500)
    return _sanitize_session_room(_extract_json(text), base, is_final)


async def generate_session_rooms(theme: dict, rooms: list[dict]) -> dict[int, dict]:
    """게임 시작 시 각 방의 문제를 AI 로 새로 만든다 (동시에 요청).
    {slot: 방 내용} 반환. 실패한 방은 빠지며, 그 방은 테마의 기본 방으로 진행된다."""
    provider = get_provider()
    if not provider or not settings.AI_RANDOM_ROOMS:
        return {}
    kinds = random.sample(_PUZZLE_KINDS, k=len(_PUZZLE_KINDS))  # 방마다 다른 퍼즐 유형
    last = len(rooms) - 1
    tasks = {
        asyncio.create_task(_generate_one(provider, theme, base, slot, slot == last, kinds[slot % len(kinds)])): slot
        for slot, base in enumerate(rooms)
    }
    # 전체 대기 시간 상한: 늦은 방만 기본 방으로 두고, 먼저 끝난 방은 그대로 사용
    done, pending = await asyncio.wait(tasks, timeout=settings.AI_TIMEOUT_SEC)
    for t in pending:
        t.cancel()
        log.warning("AI session room %d timed out → 기본 방 사용", tasks[t])
    out: dict[int, dict] = {}
    for t in done:
        slot = tasks[t]
        if t.exception():
            log.warning("AI session room %d failed → 기본 방 사용: %s", slot, t.exception())
        else:
            out[slot] = t.result()
    log.info("AI session rooms: %d/%d 개 새로 생성 (%s)", len(out), len(rooms), provider.name)
    return out
