@echo off
setlocal EnableExtensions
title Block Gunner 2D - Sync web assets
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\sync-assets.ps1"
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
  echo [ERROR] asset sync failed with exit code %RC%.
  if not defined BG_NO_PAUSE pause
) else (
  echo [OK] Web assets copied into android\app\src\main\assets\www
)
exit /b %RC%