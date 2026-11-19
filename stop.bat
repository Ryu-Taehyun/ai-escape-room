@echo off
chcp 65001 >nul
setlocal EnableExtensions
rem start.bat 이 백그라운드로 띄운 백엔드/프론트엔드 서버를 종료
rem 사용: stop.bat        (start.bat 이 실패했을 때는 stop.bat quiet 로 조용히 호출)
set "LOGS=%~dp0logs"

rem 1) start.bat 이 저장한 프로세스 번호로 종료 (/t: 그 아래 python, node 까지 함께)
for %%n in (backend frontend) do (
  if exist "%LOGS%\%%n.pid" (
    for /f "usebackq delims=" %%a in ("%LOGS%\%%n.pid") do taskkill /t /f /pid %%a >nul 2>nul
    del "%LOGS%\%%n.pid" >nul 2>nul
  )
)

rem 2) 혹시 남은 서버: 8000/5173 포트를 쓰는 프로세스 종료 (uvicorn --reload 는 프로세스가 2개라 두 번 확인)
for /l %%i in (1,1,2) do (
  for %%p in (8000 5173) do (
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr /r /c:":%%p .*LISTENING"') do (
      taskkill /t /f /pid %%a >nul 2>nul
    )
  )
)

if /i "%~1"=="quiet" exit /b 0
echo  AI Escape Room 서버를 종료했어요.
timeout /t 3 >nul
