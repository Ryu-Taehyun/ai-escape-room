// 백엔드 schemas.py 와 1:1 대응

export type RoomStatus = 'locked' | 'unlocked' | 'cleared';
export type SessionStatus = 'playing' | 'escaped' | 'failed';
export type Vec3 = [number, number, number];

export interface ThemeStyle {
  wall: string;
  floor: string;
  light: string;
  fog: string;
  accent: string;
  ambient: number;
  decor: 'server' | 'pillar' | 'none';
}

export interface ThemeSummary {
  id: number;
  key: string;
  name: string;
  description: string;
  style: ThemeStyle;
  room_names: string[];
  rooms?: RoomBrief[];
}

/** 로비 미리보기용 방 요약 */
export interface RoomBrief {
  name: string;
  has_puzzle: boolean;
  clue_count: number;
  minigame: MinigameType | null;
}

export interface GameConfig {
  min_rooms: number;
  max_rooms: number;
  default_rooms: number;
  min_time_min: number;
  max_time_min: number;
  default_time_min: number;
  ai_provider: string;
}

export type ClueObject = 'note' | 'board' | 'book' | 'tablet' | 'statue' | 'jar' | 'box';
export type MinigameType = 'sequence' | 'wires' | 'timing';

export interface ClueState {
  id: string;
  label: string;
  object: ClueObject;
  pos: number[];
  found: boolean;
  found_by: string | null;
  text: string; // 발견 전에는 ''
}

export interface MinigameState {
  type: MinigameType;
  title: string;
  description: string;
  reward: string;
  key_obtained: boolean;
  key_used: boolean;
}

export interface InventoryItem {
  kind: 'clue' | 'key';
  slot: number;
  ref_id: string;
  name: string;
  text: string;
  obtained_by: string;
  used: boolean;
}

export interface SessionRoom {
  slot: number;
  room_id: number;
  name: string;
  description: string;
  puzzle_type: string;
  has_puzzle: boolean;
  question: string;
  puzzle_solved: boolean;
  status: RoomStatus;
  is_final: boolean;
  hint_count: number;
  cleared_by: string | null;
  clues: ClueState[];
  minigame: MinigameState | null;
}

export interface SessionState {
  id: string;
  theme: ThemeSummary;
  room_count: number;
  time_limit_min: number;
  remaining_seconds: number;
  status: SessionStatus;
  hints_used: number;
  rooms: SessionRoom[];
  inventory: InventoryItem[];
}

export interface AnswerResponse {
  correct: boolean;
  message: string;
  state: SessionState;
}

export interface ActionResponse {
  success: boolean;
  message: string;
  state: SessionState;
}

export interface Clue {
  id: string;
  label: string;
  object: ClueObject;
  pos: number[];
  text: string;
}

export interface InspectResponse {
  clue: Clue;
  new: boolean;
  state: SessionState;
}

export interface MinigameConfig {
  type: MinigameType;
  title: string;
  description: string;
  reward: string;
  difficulty: number;
}

/** 서버가 만든 미니게임 문제 */
export interface MinigameChallenge {
  challenge_id: string;
  type: MinigameType;
  title: string;
  description: string;
  reward: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: Record<string, any>;
}

export interface HintResponse {
  hint: string;
  level: number;
  total: number;
  source: string;
}

export interface RemotePlayer {
  id: string;
  name: string;
  position: Vec3;
  rotation: number;
  slot: number;
}

export interface ChatMessage {
  id: string;
  name: string;
  text: string;
  system: boolean;
}

// ---- admin ----
export interface RoomFull {
  id: number;
  theme_id: number;
  order_idx: number;
  name: string;
  description: string;
  puzzle_type: string;
  question: string;
  answer: string;
  hints: string[];
  clues: Clue[];
  minigame: MinigameConfig | null;
  source: string;
  updated_at: string;
}

export interface ThemeFull {
  id: number;
  key: string;
  name: string;
  description: string;
  style: ThemeStyle;
  rooms: RoomFull[];
}

export type RoomDraft = Pick<RoomFull, 'name' | 'description' | 'puzzle_type' | 'question' | 'answer' | 'hints' | 'clues' | 'minigame'>;

export interface EditLog {
  id: number;
  actor: string;
  target_type: string;
  target_id: string;
  payload: string;
  created_at: string;
}
