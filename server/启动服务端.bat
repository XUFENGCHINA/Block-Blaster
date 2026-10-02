@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

set "NODE=node"
where node >nul 2>nul
if errorlevel 1 set "NODE=C:\Users\XUFEN\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"

if not exist "%~dp0server.js" (
  echo [ERROR] server.js not found in "%~dp0"
  pause
  exit /b 1
)

echo Starting Block Gunner 2D zero-dependency server...
echo.
"%NODE%" "%~dp0server.js" %*
set "EXITCODE=%ERRORLEVEL%"

if not "%EXITCODE%"=="0" (
  echo.
  echo [ERROR] Server exited with code %EXITCODE%.
  pause
)
endlocal