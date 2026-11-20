#!/usr/bin/env bash
# =====================================================================
#  AI Escape Room - Mac / Linux 실행기 (Windows 는 start.bat)
#    ./start.sh            설치 확인 → 서버 2개를 백그라운드로 실행 → 브라우저 열기
#    NO_BROWSER=1 ./start.sh   브라우저 열지 않음 (CI 환경에서도 자동으로 열지 않음)
#  서버 출력: logs/backend.log, logs/frontend.log   ·   끄기: ./stop.sh
# =====================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACK="$ROOT/backend"
FRONT="$ROOT/frontend"
LOGS="$ROOT/logs"
URL="http://localhost:5173"

say()  { printf ' %s\n' "$*"; }
fail() { printf '\n [오류] %s\n' "$*" >&2; exit 1; }

echo
say "=============================================="
say "   AI Escape Room - 백엔드 + 프론트엔드 실행"
say "=============================================="
echo

# ---------- 1. 파이썬 / Node 확인 ----------
PY=""
for cand in python3 python; do
  if command -v "$cand" >/dev/null 2>&1 &&
     "$cand" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
    PY="$cand"; break
  fi
done
[ -n "$PY" ] || fail "Python 3.10 이상이 필요합니다. (Mac: brew install python / Ubuntu: sudo apt install python3 python3-venv)"
command -v npm >/dev/null 2>&1 || fail "Node.js 가 필요합니다. https://nodejs.org/ 에서 LTS 버전을 설치하세요."

# ---------- 2. 백엔드 준비 ----------
VPY="$BACK/.venv/bin/python"
if [ ! -x "$VPY" ]; then
  say "[1/4] 파이썬 가상환경 만드는 중..."
  "$PY" -m venv "$BACK/.venv" || fail "가상환경을 만들 수 없습니다. (Ubuntu 라면: sudo apt install python3-venv)"
fi
# requirements.txt 가 바뀌었을 때만 다시 설치
if ! cmp -s "$BACK/requirements.txt" "$BACK/.venv/req.stamp"; then
  say "[2/4] 백엔드 패키지 설치 중... 처음 한 번은 조금 걸려요"
  "$VPY" -m pip install --disable-pip-version-check -q -r "$BACK/requirements.txt"
  cp "$BACK/requirements.txt" "$BACK/.venv/req.stamp"
fi
if [ ! -f "$BACK/.env" ]; then
  cp "$BACK/.env.example" "$BACK/.env"
  say "backend/.env 를 새로 만들었어요. 관리자 비밀번호 ADMIN_PASSWORD 를 꼭 바꾸세요."
fi

# ---------- 3. 프론트엔드 준비 ----------
# package-lock.json 이 바뀌었을 때만 다시 설치
if [ ! -d "$FRONT/node_modules" ] || ! cmp -s "$FRONT/package-lock.json" "$FRONT/node_modules/.lock.stamp"; then
  say "[3/4] 프론트엔드 패키지 설치 중... 처음 한 번은 1~2분 걸려요"
  (cd "$FRONT" && npm install --no-audit --no-fund)
  cp "$FRONT/package-lock.json" "$FRONT/node_modules/.lock.stamp"
fi

# ---------- 4. 서버 실행 (백그라운드) ----------
listening() {  # 포트에 서버가 떠 있는가 (IPv4 / IPv6 모두 확인)
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null || (exec 3<>"/dev/tcp/::1/$1") 2>/dev/null
}

# set -m: 백그라운드 작업마다 자기 프로세스 그룹을 갖게 함 → stop.sh 가 하위 프로세스까지 한 번에 종료
set -m
launch() {  # launch 이름 포트 폴더 명령...
  local name="$1" port="$2" dir="$3"; shift 3
  if listening "$port"; then
    say "- $port 포트가 이미 사용 중이라 $name 은(는) 이미 켜져 있다고 보고 넘어갑니다."
    rm -f "$LOGS/$name.pid"
    return
  fi
  # 출력은 로그 파일로만: 터미널(또는 파이프)을 붙잡고 있으면 start.sh 를 부른 쪽이 끝나지 않는다
  # exec: 중간 셸 없이 서버가 이 프로세스(그룹의 대표)가 된다 → $! 가 곧 서버의 프로세스 그룹 번호
  (cd "$dir" && exec env PYTHONUTF8=1 PYTHONIOENCODING=utf-8 nohup "$@") >"$LOGS/$name.log" 2>&1 </dev/null &
  echo $! >"$LOGS/$name.pid"
}
mkdir -p "$LOGS"
say "[4/4] 서버를 백그라운드로 켜는 중..."
launch backend 8000 "$BACK" .venv/bin/python -m uvicorn app.main:app --reload --port 8000
launch frontend 5173 "$FRONT" npm run dev -- --strictPort
set +m

# ---------- 5. 준비될 때까지 기다리기 ----------
CRASH_PATTERN='Application startup failed|Error loading ASGI app|Traceback \(most recent call last\)|is already in use'
wait_for() {  # wait_for 주소 이름 - 최대 60초, 서버가 죽으면 바로 실패
  local url="$1" name="$2" pid=""
  [ -f "$LOGS/$name.pid" ] && pid="$(cat "$LOGS/$name.pid")"
  for _ in $(seq 1 60); do
    curl -s -o /dev/null "$url" && return 0
    # 프로세스가 죽었거나, --reload 감시 프로세스는 살아 있지만 로그에 시작 실패가 찍힌 경우
    if { [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; } ||
       grep -qE "$CRASH_PATTERN" "$LOGS/$name.log" 2>/dev/null; then
      printf '\n [오류] %s 서버가 시작하다가 종료됐어요. logs/%s.log 마지막 부분:\n' "$name" "$name" >&2
      echo " ----------------------------------------------" >&2
      tail -n 20 "$LOGS/$name.log" >&2 || true
      echo " ----------------------------------------------" >&2
      "$ROOT/stop.sh" quiet
      exit 1
    fi
    sleep 1
  done
  printf '\n [오류] %s 서버가 60초 안에 응답하지 않았어요. logs/%s.log 를 확인하세요.\n' "$name" "$name" >&2
  "$ROOT/stop.sh" quiet
  exit 1
}
if command -v curl >/dev/null 2>&1; then
  say "서버가 준비되길 기다리는 중..."
  wait_for "http://127.0.0.1:8000/api/health" backend
  wait_for "$URL" frontend
else
  sleep 8
fi

# ---------- 6. 브라우저 열기 ----------
if [ -z "${NO_BROWSER:-}" ] && [ -z "${CI:-}" ]; then
  if [ "$(uname)" = "Darwin" ]; then
    open "$URL"
  elif command -v xdg-open >/dev/null 2>&1 && { [ -n "${DISPLAY:-}" ] || [ -n "${WAYLAND_DISPLAY:-}" ]; }; then
    xdg-open "$URL" >/dev/null 2>&1 &
  fi
fi
echo
say "게임 주소: $URL"
say "서버는 백그라운드에서 돌아가요. 이 터미널은 닫아도 됩니다."
say "서버 로그: logs/backend.log, logs/frontend.log"
say "서버를 끄려면 ./stop.sh 를 실행하세요."
echo
