import type {
  Difficulty,
  ActionResponse, InspectResponse, MinigameChallenge,
  AnswerResponse, EditLog, GameConfig, HintResponse, RoomDraft, RoomFull,
  SessionState, ThemeFull, ThemeStyle, ThemeSummary,
} from '../types';

const BASE = import.meta.env.VITE_API_URL || '';

async function request<T>(path: string, init: RequestInit = {}, adminToken?: string): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (adminToken) headers['X-Admin-Token'] = adminToken;
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...headers, ...(init.headers as object) } });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });
const put = (body: unknown): RequestInit => ({ method: 'PUT', body: JSON.stringify(body) });

export const api = {
  config: () => request<GameConfig>('/api/config'),
  themes: () => request<ThemeSummary[]>('/api/themes'),
  createSession: (theme_key: string, room_count: number, time_limit_min: number, difficulty: Difficulty = 'normal', start_now = false) =>
    request<SessionState>('/api/sessions', post({ theme_key, room_count, time_limit_min, difficulty, start_now })),
  startSession: (sid: string) => request<SessionState>(`/api/sessions/${sid}/start`, post({})),
  getSession: (sid: string) => request<SessionState>(`/api/sessions/${sid}`),
  submitAnswer: (sid: string, slot: number, answer: string, player_name: string) =>
    request<AnswerResponse>(`/api/sessions/${sid}/rooms/${slot}/answer`, post({ answer, player_name })),
  unlockPhone: (sid: string, slot: number, answer: string, player_name: string) =>
    request<AnswerResponse>(`/api/sessions/${sid}/rooms/${slot}/phone/unlock`, post({ answer, player_name })),
  hint: (sid: string, slot: number, level: number, phone = false) =>
    request<HintResponse>(`/api/sessions/${sid}/rooms/${slot}/hint`, post({ level, phone })),
  inspectClue: (sid: string, slot: number, clueId: string, player_name: string) =>
    request<InspectResponse>(`/api/sessions/${sid}/rooms/${slot}/clues/${encodeURIComponent(clueId)}/inspect`, post({ player_name })),
  startMinigame: (sid: string, slot: number) =>
    request<MinigameChallenge>(`/api/sessions/${sid}/rooms/${slot}/minigame/start`, post({})),
  finishMinigame: (sid: string, slot: number, challenge_id: string, result: object, player_name: string) =>
    request<ActionResponse>(`/api/sessions/${sid}/rooms/${slot}/minigame/finish`, post({ challenge_id, result, player_name })),
  useKey: (sid: string, slot: number, player_name: string) =>
    request<ActionResponse>(`/api/sessions/${sid}/rooms/${slot}/use-key`, post({ player_name })),
};

export const adminApi = {
  login: (password: string) => request<{ token: string; expires_in: number; warning?: string | null }>('/api/admin/login', post({ password })),
  themes: (t: string) => request<ThemeFull[]>('/api/admin/themes', {}, t),
  createTheme: (t: string, body: { name: string; description: string; style: ThemeStyle; concept_prompt: string }) =>
    request<ThemeFull>('/api/admin/themes', post(body), t),
  updateTheme: (t: string, id: number, body: Partial<Pick<ThemeFull, 'name' | 'description' | 'style'>>) =>
    request<ThemeFull>(`/api/admin/themes/${id}`, put(body), t),
  updateRoom: (t: string, id: number, body: Partial<RoomDraft> & { source?: 'admin' | 'ai'; remove_minigame?: boolean }) =>
    request<RoomFull>(`/api/admin/rooms/${id}`, put(body), t),
  generateRoom: (t: string, theme_id: number, order_idx: number, prompt: string) =>
    request<RoomDraft>('/api/admin/ai/generate-room', post({ theme_id, order_idx, prompt }), t),
  addTime: (t: string, sid: string, delta_min: number) =>
    request(`/api/admin/sessions/${sid}/time`, post({ delta_min }), t),
  unlock: (t: string, sid: string, slot: number) =>
    request(`/api/admin/sessions/${sid}/rooms/${slot}/unlock`, post({}), t),
  reset: (t: string, sid: string) => request(`/api/admin/sessions/${sid}/reset`, post({}), t),
  logs: (t: string) => request<EditLog[]>('/api/admin/logs', {}, t),
};
