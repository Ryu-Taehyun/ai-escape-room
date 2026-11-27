export type SfxName =
  | 'step' | 'clue' | 'type' | 'open' | 'success' | 'fail' | 'key'
  | 'locked' | 'door' | 'scare' | 'rumble' | 'spark' | 'breath' | 'mark' | 'thunder';

export declare class GameAudio {
  constructor(kind?: 'vault' | 'study' | 'horror' | 'egypt' | 'neutral');
  readonly kind: string;
  muted: boolean;
  start(): void;
  setMuted(muted: boolean): void;
  setTension(level: number): void;
  setVolumes(v: { master?: number; ambience?: number; sfx?: number }): void;
  onCaption: ((text: string) => void) | null;
  sfx(name: SfxName, opts?: { pan?: number; soft?: boolean; heavy?: boolean }): void;
  dispose(): void;
}
