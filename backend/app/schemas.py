"""요청/응답 Pydantic 모델."""
from typing import Literal, Optional

from pydantic import BaseModel, Field

from .config import settings

RoomStatus = Literal["locked", "unlocked", "cleared"]
SessionStatus = Literal["waiting", "playing", "escaped", "failed"]


class ThemeStyle(BaseModel):
    wall: str = "#444444"
    floor: str = "#222222"
    light: str = "#ffffff"
    fog: str = "#000000"
    accent: str = "#00ffff"
    ambient: float = 0.25
    decor: Literal["server", "pillar", "none"] = "none"


# ---------- 단서 / 미니게임 (방 콘텐츠) ----------
ClueObject = Literal["note", "board", "book", "tablet", "statue", "jar", "box"]
MinigameType = Literal["sequence", "wires", "timing"]


class Clue(BaseModel):
    id: str = Field(..., min_length=1, max_length=30)
    label: str = Field(..., max_length=40)
    object: ClueObject = "note"
    pos: list[float] = Field(default_factory=lambda: [0.0, 2.0], min_length=2, max_length=2)
    text: str = Field(..., max_length=500)


class MinigameConfig(BaseModel):
    type: MinigameType
    title: str = Field("미니게임", max_length=40)
    description: str = Field("", max_length=200)
    reward: str = Field("열쇠", max_length=40)
    difficulty: int = Field(2, ge=1, le=5)


# ---------- 공개(플레이어용) ----------
class RoomBrief(BaseModel):
    """로비 미리보기용 방 요약 (정답·단서 내용 없음)"""
    name: str
    has_puzzle: bool
    clue_count: int
    minigame: Optional[str] = None   # 미니게임 type


class ThemeSummary(BaseModel):
    id: int
    key: str
    name: str
    description: str
    style: ThemeStyle
    room_names: list[str]
    rooms: list[RoomBrief] = []


class GameConfig(BaseModel):
    min_rooms: int = settings.MIN_ROOMS
    max_rooms: int = settings.MAX_ROOMS
    default_rooms: int = settings.DEFAULT_ROOMS
    min_time_min: int = settings.MIN_TIME_MIN
    max_time_min: int = settings.MAX_TIME_MIN
    default_time_min: int = settings.DEFAULT_TIME_MIN
    hint_penalty_sec: int = settings.HINT_PENALTY_SEC
    ai_provider: str = settings.AI_PROVIDER
    ai_random_rooms: bool = settings.ai_random_rooms   # 게임마다 AI 가 문제를 새로 만드는가
    ai_wait_sec: int = int(settings.AI_TIMEOUT_SEC)     # 방 생성 최대 대기 시간 (로비 안내용)
    ai_calls_left: Optional[int] = None                 # 오늘 남은 AI 호출 수 (제한 없음/AI 없음이면 None)


class CreateSessionRequest(BaseModel):
    theme_key: str
    room_count: int = Field(settings.DEFAULT_ROOMS, ge=settings.MIN_ROOMS, le=settings.MAX_ROOMS)
    time_limit_min: int = Field(settings.DEFAULT_TIME_MIN, ge=settings.MIN_TIME_MIN, le=settings.MAX_TIME_MIN)
    start_now: bool = Field(True, description="False 면 대기실에서 모두 준비 완료 후 시작")
    difficulty: Literal["easy", "normal", "hard"] = "normal"


class ClueState(BaseModel):
    id: str
    label: str
    object: str
    pos: list[float]
    found: bool
    found_by: Optional[str] = None
    text: str = ""            # 발견 전에는 빈 문자열


class MinigameState(BaseModel):
    type: str
    title: str
    description: str
    reward: str
    key_obtained: bool
    key_used: bool


class InventoryItem(BaseModel):
    kind: Literal["clue", "key"]
    slot: int
    ref_id: str
    name: str
    text: str
    obtained_by: str
    used: bool


class SessionRoomPublic(BaseModel):
    slot: int
    room_id: int
    name: str
    description: str
    puzzle_type: str
    has_puzzle: bool
    question: str
    puzzle_solved: bool
    status: RoomStatus
    is_final: bool
    ai_generated: bool = False   # AI 가 이 게임용으로 새로 만든 방
    hint_count: int
    cleared_by: Optional[str] = None
    cleared_at: Optional[str] = None
    clues: list[ClueState]
    minigame: Optional[MinigameState] = None


class SessionState(BaseModel):
    id: str
    theme: ThemeSummary
    room_count: int
    time_limit_min: int
    remaining_seconds: int
    status: SessionStatus
    started_at: Optional[str] = None
    ended_at: Optional[str] = None
    hints_used: int
    ai_note: Optional[str] = None   # AI 방 생성을 건너뛴 이유 (한도 초과 등) → 화면 안내
    difficulty: str = "normal"      # easy | normal | hard
    hint_penalty_sec: int = 0       # 이 게임의 힌트 1회 감점(초)
    rooms: list[SessionRoomPublic]
    inventory: list[InventoryItem]


class AnswerRequest(BaseModel):
    answer: str = Field(..., max_length=200)
    player_name: str = Field("Player", max_length=30)


class AnswerResponse(BaseModel):
    correct: bool
    message: str
    state: SessionState


class PlayerAction(BaseModel):
    player_name: str = Field("Player", max_length=30)


class InspectResponse(BaseModel):
    clue: Clue
    new: bool
    state: SessionState


class MinigameStartResponse(BaseModel):
    challenge_id: str
    type: str
    title: str
    description: str
    reward: str
    params: dict


class MinigameFinishRequest(BaseModel):
    challenge_id: str
    result: dict
    player_name: str = Field("Player", max_length=30)


class ActionResponse(BaseModel):
    success: bool
    message: str
    state: SessionState


class HintRequest(BaseModel):
    level: int = Field(0, ge=0, le=10)


class HintResponse(BaseModel):
    hint: str
    level: int
    total: int
    source: str
    penalty_sec: int = 0


# ---------- 관리자 ----------
class AdminLoginRequest(BaseModel):
    password: str


class AdminLoginResponse(BaseModel):
    token: str
    expires_in: int
    warning: Optional[str] = None


class RoomFull(BaseModel):
    id: int
    theme_id: int
    order_idx: int
    name: str
    description: str
    puzzle_type: str
    question: str
    answer: str
    hints: list[str]
    clues: list[Clue] = []
    minigame: Optional[MinigameConfig] = None
    source: str
    updated_at: str


class ThemeFull(BaseModel):
    id: int
    key: str
    name: str
    description: str
    style: ThemeStyle
    rooms: list[RoomFull]


class ThemeUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=60)
    description: Optional[str] = Field(None, max_length=500)
    style: Optional[ThemeStyle] = None


class ThemeCreate(BaseModel):
    name: str = Field(..., max_length=60)
    description: str = Field("", max_length=500)
    style: ThemeStyle = ThemeStyle()
    concept_prompt: str = Field("", max_length=500, description="AI 가 5개 방을 생성할 때 사용할 컨셉 설명")


class RoomUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=60)
    description: Optional[str] = Field(None, max_length=500)
    puzzle_type: Optional[str] = Field(None, max_length=30)
    question: Optional[str] = Field(None, max_length=1000)
    answer: Optional[str] = Field(None, max_length=200)
    hints: Optional[list[str]] = None
    clues: Optional[list[Clue]] = None
    minigame: Optional[MinigameConfig] = None
    remove_minigame: bool = False   # True 면 미니게임 제거
    source: Literal["admin", "ai"] = "admin"


class RoomDraft(BaseModel):
    """AI 가 만든 방 초안 (저장 전 미리보기)."""
    name: str
    description: str
    puzzle_type: str
    question: str
    answer: str
    hints: list[str]
    clues: list[Clue] = []
    minigame: Optional[MinigameConfig] = None


class GenerateRoomRequest(BaseModel):
    theme_id: int
    order_idx: int = Field(..., ge=0, le=4)
    prompt: str = Field("", max_length=500)


class AddTimeRequest(BaseModel):
    delta_min: int = Field(..., ge=-60, le=60)


class EditLog(BaseModel):
    id: int
    actor: str
    target_type: str
    target_id: str
    payload: str
    created_at: str
