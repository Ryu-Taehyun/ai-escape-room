// engine.js 의 타입 선언 (React/TS 코드에서 사용)
import type { RoomStatus, ThemeStyle, Vec3 } from '../types';

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
  minigame: { title: string; key_obtained: boolean; key_used: boolean } | null;
}

export type InteractKind = 'puzzle' | 'clue' | 'minigame' | 'door';

export interface InteractTarget {
  kind: InteractKind;
  slot: number;
  id?: string;   // clue id
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
  onInteract?: (target: InteractTarget) => void;
  onRoomChange?: (slot: number) => void;
  onMove?: (e: MoveEvent) => void;
  onLockChange?: (locked: boolean) => void;
  onFocusChange?: (target: InteractTarget | null) => void;
}

export declare const ROOM_SIZE: number;
export declare const MINIGAME_POS: [number, number];
export declare const PUZZLE_POS: [number, number];

export declare class EscapeEngine {
  constructor(container: HTMLElement, options: EngineOptions);
  setRooms(rooms: EngineRoom[]): void;
  setInputEnabled(enabled: boolean): void;
  unlockPointer(): void;
  updateRemotePlayers(players: RemotePlayerInput[]): void;
  dispose(): void;
}
