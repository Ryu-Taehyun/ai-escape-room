// engine.js 의 타입 선언 (React/TS 코드에서 사용)
import type { MinigameType, RoomStatus, ThemeStyle, Vec3 } from '../types';
import type { GameAudio } from './audio';

export interface EngineClue {
  id: string;
  label: string;
  object: string;
  pos: number[];
  found: boolean;
}

export interface EngineRoom {
  slot: number;
  name: string;
  status: RoomStatus;
  is_final: boolean;
  has_puzzle: boolean;
  puzzle_solved: boolean;
  clues: EngineClue[];
  minigame: { type: MinigameType; title: string; key_obtained: boolean; key_used: boolean } | null;
}

export type InteractKind = 'puzzle' | 'clue' | 'minigame' | 'door';

export interface InteractTarget {
  kind: InteractKind;
  slot: number;
  id?: string; // clue id
  label: string;
}

export interface MoveEvent {
  position: Vec3;
  rotation: number;
  slot: number;
}

export interface RemotePlayerInput {
  id: string;
  name: string;
  position: Vec3;
  rotation: number;
}

export interface EngineOptions {
  rooms: EngineRoom[];
  style: ThemeStyle;
  startPosition?: Vec3;
  audio?: GameAudio | null;
  /** 화면 흔들림 강도 0~1 (기본 1, 멀미 방지 시 낮춤) */
  motion?: number;
  quality?: 'low' | 'medium' | 'high';
  /** 자동 해상도 (FPS 가 떨어지면 렌더 해상도를 낮춤, 기본 true) */
  dynamicRes?: boolean;
  /** 자동 해상도가 바뀌었을 때 (최대 대비 비율 0.5~1) */
  onResolution?: (ratio: number) => void;
  sensitivity?: number;
  fov?: number;
  onMark?: (position: Vec3) => void;
  onCaption?: (text: string) => void;
  onFps?: (fps: number) => void;
  /** 스태미나 변화 (0~1, 탈진 여부) */
  onStamina?: (stamina: number, exhausted: boolean) => void;
  onInteract?: (target: InteractTarget) => void;
  onRoomChange?: (slot: number) => void;
  onMove?: (e: MoveEvent) => void;
  onLockChange?: (locked: boolean) => void;
  onFocusChange?: (target: InteractTarget | null) => void;
  /** 공포·붉은 서재: 정전(blackout), 붉은 서재: 액자 귀신(ghost), 이집트: 지진(rumble) */
  onScare?: (kind: 'blackout' | 'rumble' | 'ghost') => void;
}

export declare const ROOM_SIZE: number;
export declare const MINIGAME_POS: [number, number];
export declare const PUZZLE_POS: [number, number];

export declare class EscapeEngine {
  constructor(container: HTMLElement, options: EngineOptions);
  setRooms(rooms: EngineRoom[]): void;
  setInputEnabled(enabled: boolean): void;
  unlockPointer(): void;
  /** 포인터 락 재요청 (사용자 입력 직후에만 성공) */
  lock(): Promise<boolean>;
  /** 화면 흔들림 강도 0~1 */
  setMotion(v: number): void;
  setSensitivity(v: number): void;
  releaseKeys(): void;
  setFov(v: number): void;
  /** 남은 시간 경고 단계 0(없음) / 1(5분 이하) / 2(1분 이하) → 화면 맥동 */
  setLowTime(level: number): void;
  setDynamicRes(on: boolean): void;
  addMark(position: Vec3, name: string, color?: string): void;
  updateRemotePlayers(players: RemotePlayerInput[]): void;
  dispose(): void;
}
