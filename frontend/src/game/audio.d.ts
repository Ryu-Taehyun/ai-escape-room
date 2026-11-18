export type SfxName =
  | 'step' | 'clue' | 'type' | 'open' | 'success' | 'fail' | 'key'
  | 'locked' | 'door' | 'scare' | 'rumble' | 'spark';

export declare class GameAudio {
  constructor(kind?: 'horror' | 'egypt' | 'neutral');
  readonly kind: string;
  muted: boolean;
  start(): void;
  setMuted(muted: boolean): void;
  setTension(level: number): void;
  sfx(name: SfxName): void;
  dispose(): void;
}
