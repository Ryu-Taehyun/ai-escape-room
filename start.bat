@echo off
chcp 65001 >nul
setlocal EnableExtensions
title AI Escape Room 실행기
cd /d "%~dp0"

set "BACK=%~dp0backend"
set "FRONT=%~dp0frontend"
set "URL=http://localhost:5173"

echo.
echo  ==============================================
echo     AI Escape Room - 백엔드 + 프론트엔드 실행
echo  ==============================================
echo.

rem ---------- 1. 파이썬 / Node 확인 ----------
set "PY=py -3"
call :check_py
if not errorlevel 1 goto :py_ok
set "PY=python"
call :check_py
if not errorlevel 1 goto :py_ok
echo  [오류] Python 3.10 이상이 필요합니다.
echo         https://www.python.org/downloads/ 에서 설치할 때 "Add python.exe to PATH" 를 체크하세요.
goto :fail
:py_ok

where npm >nul 2>nul
if not errorlevel 1 goto :node_ok
echo  [오류] Node.js 가 필요합니다. https://nodejs.org/ 에서 LTS 버전을 설치하세요.
goto :fail
:node_ok

rem ---------- 2. 백엔드 준비 ----------
set "VPY=%BACK%\.venv\Scripts\python.exe"
if exist "%VPY%" goto :venv_ok
echo  [1/4] 파이썬 가상환경 만드는 중...
%PY% -m venv "%BACK%\.venv"
if errorlevel 1 goto :fail
:venv_ok

rem requirements.txt 가 바뀌었을 때만 다시 설치
fc /b "%BACK%\requirements.txt" "%BACK%\.venv\req.stamp" >nul 2>nul
if not errorlevel 1 goto :pip_ok
echo  [2/4] 백엔드 패키지 설치 중... 처음 한 번은 조금 걸려요
"%VPY%" -m pip install --disable-pip-version-check -q -r "%BACK%\requirements.txt"
if errorlevel 1 goto :fail
copy /y "%BACK%\requirements.txt" "%BACK%\.venv\req.stamp" >nul
:pip_ok

if exist "%BACK%\.env" goto :env_ok
copy "%BACK%\.env.example" "%BACK%\.env" >nul
echo  backend\.env 를 새로 만들었어요. 관리자 비밀번호 ADMIN_PASSWORD 를 꼭 바꾸세요.
:env_ok

rem ---------- 3. 프론트엔드 준비 ----------
rem package-lock.json 이 바뀌었을 때만 다시 설치
if not exist "%FRONT%\node_modules" goto :npm_install
fc /b "%FRONT%\package-lock.json" "%FRONT%\node_modules\.lock.stamp" >nul 2>nul
if not errorlevel 1 goto :npm_ok
:npm_install
echo  [3/4] 프론트엔드 패키지 설치 중... 처음 한 번은 1~2분 걸려요
pushd "%FRONT%"
call npm install --no-audit --no-fund
set "NPM_ERR=%errorlevel%"
popd
if not "%NPM_ERR%"=="0" goto :fail
copy /y "%FRONT%\package-lock.json" "%FRONT%\node_modules\.lock.stamp" >nul
:npm_ok

rem ---------- 4. 서버 실행 (각각 새 창) ----------
echo  [4/4] 서버를 켜는 중...
netstat -ano | findstr /r /c:":8000 .*LISTENING" >nul
if errorlevel 1 (
  start "AI Escape Room - backend :8000" /d "%BACK%" cmd /k .venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
) else (
  echo  - 8000 포트가 이미 사용 중이라 백엔드는 이미 켜져 있다고 보고 넘어갑니다.
)
netstat -ano | findstr /r /c:":5173 .*LISTENING" >nul
if errorlevel 1 (
  start "AI Escape Room - frontend :5173" /d "%FRONT%" cmd /k npm run dev -- --strictPort
) else (
  echo  - 5173 포트가 이미 사용 중이라 프론트엔드는 이미 켜져 있다고 보고 넘어갑니다.
)

rem ---------- 5. 준비되면 브라우저 열기 ----------
where curl >nul 2>nul
if errorlevel 1 goto :no_curl
echo  서버가 준비되길 기다리는 중...
call :wait_for http://127.0.0.1:8000/api/health
call :wait_for %URL%
goto :open
:no_curl
timeout /t 8 /nobreak >nul

:open
start "" "%URL%"
echo.
echo  게임 주소: %URL%
echo  서버를 끄려면 stop.bat 을 실행하거나, 백엔드/프론트엔드 창을 닫으세요.
echo  이 창은 닫아도 됩니다.
echo.
timeout /t 10 >nul
exit /b 0


rem ================= 함수 =================
:check_py
%PY% -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul
exit /b %errorlevel%

:wait_for
set /a TRIES=0
:wait_loop
curl -s -o nul "%~1" >nul 2>nul
if not errorlevel 1 exit /b 0
set /a TRIES+=1
if %TRIES% geq 60 (
  echo  - %~1 이 60초 안에 응답하지 않았어요. 서버 창의 오류를 확인하세요.
  exit /b 1
)
timeout /t 1 /nobreak >nul
goto :wait_loop

:fail
echo.
echo  실행에 실패했어요. 위의 메시지를 확인하세요.
pause
exit /b 1
