// ESC 일시정지 메뉴: 계속하기 / 설정 / 조작 안내 / 나가기
// "계속하기" 클릭은 사용자 입력이라 브라우저가 마우스 재고정을 허용한다.
import { useState } from 'react';
import type { Quality, Settings } from '../settings';
import type { ThemeCopy } from '../game/themeCopy';

interface Props {
  settings: Settings;
  copy: ThemeCopy;
  onChange: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  onReset: () => void;
  onResume: () => void;
  onAdmin: () => void;
  onExit: () => void;
}

const QUALITY: [Quality, string, string][] = [
  ['low', '낮음', '그림자·후처리 끔, 해상도 1배 — 노트북/저사양'],
  ['medium', '중간', '그림자 + 바라보는 물건 외곽선'],
  ['high', '높음', '+ 빛번짐, 공포 테마 색수차'],
];

const CONTROLS: [string, string][] = [
  ['W A S D', '이동'],
  ['Shift', '달리기 (스태미나)'],
  ['C', '웅크리기 (누르는 동안)'],
  ['마우스', '시점'],
  ['E / 클릭', '조사 · 상호작용'],
  ['Q', '핑 — 바라보는 곳을 팀원에게 표시'],
  ['F', '손전등 / 횃불'],
  ['R', '최근 단서 다시 보기'],
  ['I', '인벤토리'],
  ['M', '지도'],
  ['Enter', '팀 채팅'],
  ['ESC', '일시정지 메뉴'],
];

export default function PauseMenu({ settings, copy, onChange, onReset, onResume, onAdmin, onExit }: Props) {
  const [tab, setTab] = useState<'settings' | 'controls'>('settings');
  const slider = (key: 'sensitivity' | 'fov' | 'master' | 'ambience' | 'sfx', label: string, min: number, max: number, step: number, fmt: (v: number) => string) => (
    <label className="pm-slider" htmlFor={`pm-${key}`}>
      <span>{label}</span>
      <input id={`pm-${key}`} type="range" min={min} max={max} step={step} value={settings[key]} onChange={(e) => onChange(key, Number(e.target.value))} />
      <b>{fmt(settings[key])}</b>
    </label>
  );
  const toggle = (key: 'muted' | 'motion' | 'captions' | 'showFps', label: string, hint: string) => (
    <label className="pm-toggle" htmlFor={`pm-${key}`}>
      <input id={`pm-${key}`} type="checkbox" checked={settings[key]} onChange={(e) => onChange(key, e.target.checked)} />
      <span>
        {label}
        <small>{hint}</small>
      </span>
    </label>
  );
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  return (
    <div className="overlay pause-overlay">
      <div className="panel pause">
        <div className="pause-head">
          <h2>일시정지</h2>
          <small>{copy.timerLabel} 타이머는 계속 흐릅니다</small>
        </div>
        <button className="primary pause-resume" autoFocus onClick={onResume}>
          ▶ 계속하기 <small className="muted">· 이동 키·Space·Enter</small>
        </button>

        <div className="tabs">
          <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>
            설정
          </button>
          <button className={tab === 'controls' ? 'active' : ''} onClick={() => setTab('controls')}>
            조작 안내
          </button>
        </div>

        {tab === 'settings' ? (
          <div className="pm-grid">
            <section>
              <h3>조작</h3>
              {slider('sensitivity', '마우스 감도', 0.3, 2, 0.05, (v) => v.toFixed(2))}
              {slider('fov', '시야각', 60, 95, 1, (v) => `${v}°`)}
              {toggle('motion', '화면 흔들림', '끄면 걸음·충격 흔들림이 약 1/5로 줄어듭니다 (멀미 방지)')}
            </section>
            <section>
              <h3>소리</h3>
              {slider('master', '전체 볼륨', 0, 1, 0.05, pct)}
              {slider('ambience', '배경음', 0, 1, 0.05, pct)}
              {slider('sfx', '효과음', 0, 1, 0.05, pct)}
              {toggle('muted', '음소거', '')}
              {toggle('captions', '소리 자막', '발소리·속삭임·정전 같은 소리를 글로 표시')}
            </section>
            <section className="pm-wide">
              <h3>그래픽 품질</h3>
              <div className="pm-quality">
                {QUALITY.map(([q, name, hint]) => (
                  <button key={q} className={settings.quality === q ? 'on' : ''} onClick={() => onChange('quality', q)}>
                    <b>{name}</b>
                    <small>{hint}</small>
                  </button>
                ))}
              </div>
              {toggle('showFps', 'FPS 표시', '오른쪽 아래에 초당 프레임 수')}
            </section>
          </div>
        ) : (
          <div className="pm-controls">
            {CONTROLS.map(([k, v]) => (
              <div key={k}>
                <kbd>{k}</kbd>
                <span>{v}</span>
              </div>
            ))}
          </div>
        )}

        <div className="pause-foot">
          <button onClick={onReset}>설정 초기화</button>
          <button onClick={onAdmin}>🛠 관리자 모드</button>
          <button className="danger" onClick={onExit}>
            게임 나가기
          </button>
        </div>
      </div>
    </div>
  );
}
