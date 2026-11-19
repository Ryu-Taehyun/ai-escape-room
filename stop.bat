@echo off
chcp 65001 >nul
setlocal EnableExtensions
rem start.bat 으로 띄운 백엔드/프론트엔드 서버를 모두 종료

rem 1) start.bat 이 만든 창 (창 제목으로 찾기)
taskkill /t /f /fi "WINDOWTITLE eq AI Escape Room - backend*" >nul 2>nul
taskkill /t /f /fi "WINDOWTITLE eq AI Escape Room - frontend*" >nul 2>nul

rem 2) Windows Terminal 등으로 창 제목을 못 찾은 경우: 8000/5173 포트를 쓰는 프로세스 종료
rem    uvicorn --reload 는 프로세스가 2개라 두 번 확인한다
for /l %%i in (1,1,2) do (
  for %%p in (8000 5173) do (
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr /r /c:":%%p .*LISTENING"') do (
      taskkill /t /f /pid %%a >nul 2>nul
    )
  )
)

echo  AI Escape Room 서버를 종료했어요.
timeout /t 3 >nul
