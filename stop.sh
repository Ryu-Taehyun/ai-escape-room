#!/usr/bin/env bash
# start.sh 가 백그라운드로 띄운 백엔드/프론트엔드 서버를 종료 (Windows 는 stop.bat)
#   ./stop.sh        (start.sh 가 실패했을 때는 ./stop.sh quiet 로 조용히 호출)
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOGS="$ROOT/logs"

# 1) start.sh 가 저장한 프로세스 그룹 종료 (uvicorn 재시작 감시 프로세스, npm 아래 vite 까지 함께)
for name in backend frontend; do
  pidfile="$LOGS/$name.pid"
  [ -f "$pidfile" ] || continue
  pid="$(cat "$pidfile")"
  kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    kill -0 -- "-$pid" 2>/dev/null || kill -0 "$pid" 2>/dev/null || break
    sleep 0.5
  done
  kill -KILL -- "-$pid" 2>/dev/null || true
  rm -f "$pidfile"
done

# 2) 혹시 남은 서버: 8000 / 5173 포트를 쓰는 프로세스 종료
for port in 8000 5173; do
  if command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null || true)"
    [ -n "$pids" ] && kill $pids 2>/dev/null
  elif command -v fuser >/dev/null 2>&1; then
    fuser -k "$port/tcp" >/dev/null 2>&1
  fi
done

[ "${1:-}" = "quiet" ] || echo " AI Escape Room 서버를 종료했어요."
exit 0
