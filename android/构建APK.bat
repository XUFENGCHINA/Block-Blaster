@echo off
setlocal EnableExtensions
title Block Gunner 2D - Build APK
cd /d "%~dp0.."

rem ============================================================
rem  Offline APK build for Block Gunner 2D (no Gradle / no AGP).
rem  Environment overrides are optional: the PowerShell script
rem  detects JDK 8 + Java 11+ + Android SDK automatically.
rem ============================================================

if not defined JAVA_HOME if exist "D:\Program Files\Zulu\zulu-8\bin\javac.exe" set "JAVA_HOME=D:\Program Files\Zulu\zulu-8"
if not defined JAVA_HOME if exist "%ProgramFiles%\Zulu\zulu-8\bin\javac.exe" set "JAVA_HOME=%ProgramFiles%\Zulu\zulu-8"
if not defined JAVA_HOME if exist "%ProgramFiles%\Java\jdk1.8.0\bin\javac.exe" set "JAVA_HOME=%ProgramFiles%\Java\jdk1.8.0"
if defined JAVA_HOME set "PATH=%JAVA_HOME%\bin;%PATH%"

if not defined ANDROID_HOME if defined ANDROID_SDK_ROOT set "ANDROID_HOME=%ANDROID_SDK_ROOT%"
if not defined ANDROID_HOME if exist "%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
if not defined ANDROID_HOME if exist "C:\Users\XUFEN\AppData\Local\Android\Sdk\platform-tools\adb.exe" set "ANDROID_HOME=C:\Users\XUFEN\AppData\Local\Android\Sdk"
if not defined ANDROID_HOME if exist "C:\Android\Sdk\platform-tools\adb.exe" set "ANDROID_HOME=C:\Android\Sdk"
if defined ANDROID_HOME set "ANDROID_SDK_ROOT=%ANDROID_HOME%"

echo Building Block Gunner 2D APK...
echo   JAVA_HOME    = %JAVA_HOME%
echo   ANDROID_HOME = %ANDROID_HOME%
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\build-apk.ps1"
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
  echo.
  echo [ERROR] APK build failed with exit code %RC%.
  if not defined BG_NO_PAUSE pause
) else (
  echo.
  echo [OK] APK is in the "dist" folder. Install with:
  echo      adb install -r "dist\BlockGunner2D.apk"
)
exit /b %RC%