// 협동 WebSocket 클라이언트 (자동 재연결 + 타입별 핸들러)
// 메시지 프로토콜은 backend/app/ws_manager.py 상단 주석 참고

type Handler = (msg: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any

function wsBase(): string {
  const env = import.meta.env.VITE_WS_URL;
  if (env) return env;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}`;
}

export class GameSocket {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private closed = false;
  private retry = 0;
  private pingTimer: number | undefined;

  constructor(private sessionId: string, private name: string) {}

  connect() {
    this.closed = false;
    const url = `${wsBase()}/ws/${this.sessionId}?name=${encodeURIComponent(this.name)}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.retry = 0;
      this.emit('_open', {});
      this.pingTimer = window.setInterval(() => this.send({ type: 'ping' }), 20000);
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        this.emit(msg.type, msg);
      } catch {
        /* ignore */
      }
    };
    ws.onclose = (ev) => {
      window.clearInterval(this.pingTimer);
      this.emit('_close', { code: ev.code });
      if (this.closed || ev.code === 4404) return;
      const delay = Math.min(1000 * 2 ** this.retry++, 10000);
      window.setTimeout(() => !this.closed && this.connect(), delay);
    };
  }

  on(type: string, handler: Handler): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
    return () => this.handlers.get(type)?.delete(handler);
  }

  private emit(type: string, msg: unknown) {
    this.handlers.get(type)?.forEach((h) => h(msg));
  }

  send(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close() {
    this.closed = true;
    window.clearInterval(this.pingTimer);
    this.ws?.close();
  }
}
