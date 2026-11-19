// 플레이어 설정 (일시정지 메뉴) — 브라우저에만 저장
import { useCallback, useEffect, useState } from 'react';

export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  sensitivity: number; // 마우스 감도 0.3 ~ 2
  fov: number; // 시야각 60 ~ 95
  master: number; // 전체 볼륨 0 ~ 1
  ambience: number; // 배경음 0 ~ 1
  sfx: number; // 효과음 0 ~ 1
  muted: boolean;
  motion: boolean; // 화면 흔들림
  quality: Quality;
  captions: boolean; // 소리 자막
  showFps: boolean;
}

const KEY = 'escape-settings-v1';

function defaults(): Settings {
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const weak = typeof navigator !== 'undefined' && (navigator.hardwareConcurrency ?? 8) <= 4;
  return {
    sensitivity: 1,
    fov: 72,
    master: 0.9,
    ambience: 1,
    sfx: 1,
    muted: false,
    motion: !reduce,
    quality: weak ? 'low' : 'medium',
    captions: false,
    showFps: false,
  };
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaults(), ...JSON.parse(raw) };
  } catch {
    /* 저장 불가 환경 */
  }
  return defaults();
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      /* 저장 불가 환경 */
    }
  }, [settings]);
  const update = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => setSettings((s) => ({ ...s, [key]: value })), []);
  const reset = useCallback(() => setSettings(defaults()), []);
  return { settings, update, reset };
}
