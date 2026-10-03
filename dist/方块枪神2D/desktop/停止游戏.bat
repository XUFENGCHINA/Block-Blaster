@echo off
setlocal EnableExtensions
title Block Gunner 2D - Stop
cd /d "%~dp0.."

set "NODE_EXE="
for %%I in (node.exe) do if not defined NODE_EXE if exist "%%~$PATH:I" set "NODE_EXE=%%~$PATH:I"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE_EXE if exist "C:\Users\XUFEN\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" set "NODE_EXE=C:\Users\XUFEN\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"

if not defined NODE_EXE (
  echo [ERROR] Node.js not found. Cannot stop the server automatically.
  echo         End the "node.exe" process in Task Manager instead.
  echo.
  if not defined BG_NO_PAUSE pause
  exit /b 1
)

echo Stopping Block Gunner 2D server...
"%NODE_EXE%" "%~dp0stop-desktop.js" %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" if not defined BG_NO_PAUSE pause
exit /b %RC%