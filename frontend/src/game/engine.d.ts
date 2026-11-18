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
  /** 스태미나 변화 (0~1, 탈진 여부) */
  onStamina?: (stamina: number, exhausted: boolean) => void;
  onInteract?: (target: InteractTarget) => void;
  onRoomChange?: (slot: number) => void;
  onMove?: (e: MoveEvent) => void;
  onLockChange?: (locked: boolean) => void;
  onFocusChange?: (target: InteractTarget | null) => void;
  /** 공포: 정전(blackout), 이집트: 지진(rumble) */
  onScare?: (kind: 'blackout' | 'rumble') => void;
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
  updateRemotePlayers(players: RemotePlayerInput[]): void;
  dispose(): void;
}
