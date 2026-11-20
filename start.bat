@echo off
chcp 65001 >nul
setlocal EnableExtensions
title AI Escape Room 실행기
cd /d "%~dp0"

set "BACK=%~dp0backend"
set "FRONT=%~dp0frontend"
set "URL=http://localhost:5173"
set "LOGS=%~dp0logs"

echo.
echo  ==============================================
echo     AI Escape Room - 백엔드 + 프론트엔드 실행
echo  ==============================================
echo.

rem CI 환경(GitHub Actions 등) 또는 NO_BROWSER=1 이면 브라우저를 열지 않고, 끝에서 멈추지 않는다
set "HEADLESS="
if defined CI set "HEADLESS=1"
if defined NO_BROWSER set "HEADLESS=1"

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

rem ---------- 4. 서버 실행 (창 없이 백그라운드) ----------
rem 서버 출력은 logs\backend.log, logs\frontend.log 에 저장된다
echo  [4/4] 서버를 백그라운드로 켜는 중...
if not exist "%LOGS%" mkdir "%LOGS%"
rem 로그 파일의 한글이 깨지지 않도록 파이썬 출력을 UTF-8 로
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"

set "BPID="
netstat -ano | findstr /r /c:":8000 .*LISTENING" >nul
if errorlevel 1 goto :start_back
echo  - 8000 포트가 이미 사용 중이라 백엔드는 이미 켜져 있다고 보고 넘어갑니다.
goto :back_started
:start_back
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c .venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000 > ..\logs\backend.log 2>&1' -WorkingDirectory '%BACK%' -WindowStyle Hidden -PassThru; $p.Id" > "%LOGS%\backend.pid"
if errorlevel 1 goto :fail
set /p BPID=<"%LOGS%\backend.pid"
:back_started

set "FPID="
netstat -ano | findstr /r /c:":5173 .*LISTENING" >nul
if errorlevel 1 goto :start_front
echo  - 5173 포트가 이미 사용 중이라 프론트엔드는 이미 켜져 있다고 보고 넘어갑니다.
goto :front_started
:start_front
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c npm run dev -- --strictPort > ..\logs\frontend.log 2>&1' -WorkingDirectory '%FRONT%' -WindowStyle Hidden -PassThru; $p.Id" > "%LOGS%\frontend.pid"
if errorlevel 1 goto :fail
set /p FPID=<"%LOGS%\frontend.pid"
:front_started

rem ---------- 5. 준비되면 브라우저 열기 ----------
where curl >nul 2>nul
if errorlevel 1 goto :no_curl
echo  서버가 준비되길 기다리는 중...
call :wait_for http://127.0.0.1:8000/api/health "%BPID%" backend
if errorlevel 1 goto :fail
call :wait_for %URL% "%FPID%" frontend
if errorlevel 1 goto :fail
goto :open
:no_curl
call :sleep 8

:open
if not defined HEADLESS start "" "%URL%"
echo.
echo  게임 주소: %URL%
echo  서버는 창 없이 백그라운드에서 돌아가요. 이 창은 닫아도 됩니다.
echo  서버 로그: logs\backend.log, logs\frontend.log
echo  서버를 끄려면 stop.bat 을 실행하세요.
echo.
if not defined HEADLESS call :sleep 10
exit /b 0


rem ================= 함수 =================
:check_py
%PY% -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul
exit /b %errorlevel%

rem :wait_for 주소 프로세스번호 이름  - 응답할 때까지 최대 60초 대기, 서버가 죽으면 바로 실패
:wait_for
set /a TRIES=0
:wait_loop
curl -s -o nul "%~1" >nul 2>nul
if not errorlevel 1 exit /b 0
rem --reload 감시 프로세스는 살아 있어도 로그에 시작 실패가 찍히면 바로 실패로 본다
findstr /c:"Application startup failed" /c:"Error loading ASGI app" /c:"Traceback (most recent call last)" /c:"is already in use" "%LOGS%\%~3.log" >nul 2>nul
if not errorlevel 1 goto :wait_dead
if "%~2"=="" goto :wait_next
tasklist /fi "PID eq %~2" /nh 2>nul | findstr /c:" %~2 " >nul
if errorlevel 1 goto :wait_dead
:wait_next
set /a TRIES+=1
if %TRIES% geq 60 goto :wait_timeout
call :sleep 1
goto :wait_loop
:wait_dead
echo.
echo  [오류] %~3 서버가 시작하다가 종료됐어요. logs\%~3.log 마지막 부분:
echo  ----------------------------------------------
powershell -NoProfile -Command "Get-Content -Path '%LOGS%\%~3.log' -Tail 20 -Encoding UTF8"
echo  ----------------------------------------------
call "%~dp0stop.bat" quiet
exit /b 1
:wait_timeout
echo.
echo  [오류] %~3 서버가 60초 안에 응답하지 않았어요. logs\%~3.log 를 확인하세요.
call "%~dp0stop.bat" quiet
exit /b 1

:fail
echo.
echo  실행에 실패했어요. 위의 메시지를 확인하세요.
if not defined HEADLESS pause
exit /b 1

rem :sleep 초 - timeout 명령은 콘솔 입력이 없는 환경(CI)에서 바로 끝나므로 ping 으로 기다린다
:sleep
set /a _N=%~1+1
ping -n %_N% 127.0.0.1 >nul
exit /b 0
