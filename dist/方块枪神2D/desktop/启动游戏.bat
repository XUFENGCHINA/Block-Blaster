@echo off
setlocal EnableExtensions
title Block Gunner 2D - Desktop

rem ============================================================
rem  Block Gunner 2D - desktop launcher (no Electron, no npm)
rem  run-desktop.js does the real work:
rem    1) start "node server\server.js --port=8080" in the background
rem       (auto retries 8081..8099 when a port is occupied)
rem    2) poll http://127.0.0.1:PORT/healthz until ready
rem    3) open Edge / Chrome in --app mode (no address bar),
rem       fall back to the system default browser
rem  Run "????.bat" to stop the server.
rem  Options:  --no-browser   only start the server
rem            --dry-run      print the browser command
rem ============================================================
cd /d "%~dp0.."

set "NODE_EXE="
for %%I in (node.exe) do if not defined NODE_EXE if exist "%%~$PATH:I" set "NODE_EXE=%%~$PATH:I"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE_EXE if exist "C:\Users\XUFEN\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" set "NODE_EXE=C:\Users\XUFEN\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"

if not defined NODE_EXE (
  echo [ERROR] Node.js not found.
  echo         Install Node.js 18+ or add node.exe to PATH: https://nodejs.org/
  echo.
  if not defined BG_NO_PAUSE pause
  exit /b 1
)

echo Starting Block Gunner 2D desktop client...
echo   Server : http://127.0.0.1:8080/  (auto tries 8081-8099 if 8080 is busy)
echo   Window : Microsoft Edge app mode -^> Chrome app mode -^> default browser
echo.

"%NODE_EXE%" "%~dp0run-desktop.js" %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
  echo.
  echo [ERROR] Launcher failed with code %RC%.
  echo         Server logs: %~dp0logs\
  if not defined BG_NO_PAUSE pause
)
exit /b %RC%