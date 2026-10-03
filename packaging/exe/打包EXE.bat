@echo off
rem ===========================================================================
rem  Block Gunner 2D - one-click Windows EXE packaging (offline, csc only)
rem
rem  This .bat is intentionally plain ASCII without BOM; the Chinese app name
rem  "????2D" is generated at runtime from PowerShell character codes, so the
rem  file itself never depends on the console code page / file encoding.
rem
rem  Output:
rem    dist\<name>.exe        <- WinForms launcher (double-click this)
rem    dist\<name>\           <- index.html, style.css, js\, icons\, sw.js,
rem                              manifest.webmanifest, server\, desktop\
rem    packaging\exe\app.ico  <- generated from icons\icon-512.png by Pillow
rem ===========================================================================
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul 2>nul

set "HERE=%~dp0"
pushd "%HERE%..\.."
if errorlevel 1 (
  echo [ERROR] cannot enter the project root
  exit /b 1
)
set "ROOT=%CD%"
echo [INFO] project root: %ROOT%

set "CSC=C:\WINDOWS\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" set "CSC=C:\WINDOWS\Microsoft.NET\Framework\v4.0.30319\csc.exe"
if not exist "%CSC%" (
  echo [ERROR] csc.exe not found - Windows .NET Framework 4 is required.
  goto :fail
)

rem --- build the Chinese app name without non-ASCII bytes in this file ------
set "APP="
for /f "usebackq delims=" %%A in (`powershell -NoProfile -Command "[Console]::Out.WriteLine((-join ([char]0x65B9,[char]0x5757,[char]0x67AA,[char]0x795E,[char]0x32,[char]0x44)))"`) do set "APP=%%A"
if not defined APP (
  echo [ERROR] could not build the app name via PowerShell
  goto :fail
)
echo [INFO] app name: %APP%

rem --- python + Pillow (optional: only refreshes app.ico) -------------------
set "PY="
if exist "C:\Users\XUFEN\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe" set "PY=C:\Users\XUFEN\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe"
if not defined PY (
  for /f "delims=" %%P in ('where python 2^>nul') do if not defined PY set "PY=%%P"
)
if defined PY (
  if exist "icons\icon-512.png" (
    "%PY%" "packaging\exe\make_icon.py" "icons\icon-512.png" "packaging\exe\app.ico"
  )
) else (
  echo [WARN] Python not found - keeping existing packaging\exe\app.ico if present
)

set "ICONARG="
if exist "packaging\exe\app.ico" set "ICONARG=/win32icon:packaging\exe\app.ico"
set "MANARG="
if exist "packaging\exe\app.manifest" set "MANARG=/win32manifest:packaging\exe\app.manifest"

rem --- compile the launcher -------------------------------------------------
set "OUT=dist\%APP%.exe"
if not exist "dist" md "dist"
echo [INFO] compiling packaging\exe\Launcher.cs  -^>  %OUT%
"%CSC%" /nologo /target:winexe /platform:anycpu /optimize+ /codepage:65001 /out:"%OUT%" %ICONARG% %MANARG% /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll "packaging\exe\Launcher.cs"
if errorlevel 1 (
  echo [ERROR] csc compile failed
  goto :fail
)

rem --- copy the game files next to the EXE ----------------------------------
set "GAMEDIR=dist\%APP%"
if not exist "%GAMEDIR%" md "%GAMEDIR%"
echo [INFO] copying game files  -^>  %GAMEDIR%\
for %%D in (js server desktop icons) do (
  if exist "%%D" xcopy /E /I /Y "%%D" "%GAMEDIR%\%%D\" >nul
)
for %%F in (index.html style.css manifest.webmanifest sw.js) do (
  if exist "%%F" copy /Y "%%F" "%GAMEDIR%\" >nul
)
if not exist "%GAMEDIR%\index.html" (
  echo [ERROR] copy failed: index.html is missing
  goto :fail
)
if not exist "%GAMEDIR%\server\server.js" (
  echo [ERROR] copy failed: server\server.js is missing
  goto :fail
)

rem --- self test: start node, GET /healthz, stop, check cleanup -------------
echo [INFO] running selftest ...
set "STLOG=%TEMP%\block-gunner-2d-selftest.txt"
if exist "%STLOG%" del /q "%STLOG%" >nul 2>nul
"%OUT%" --selftest --port=18080
set "RC=%ERRORLEVEL%"
if "%RC%"=="0" (
  echo [OK] selftest PASS - log: %STLOG%
) else (
  echo [WARN] selftest exit code %RC% - see %STLOG% ^(Node.js missing? The EXE still works for single player.^)
)

for %%S in ("%OUT%") do echo [OK] EXE: %%~fS  ^(%%~zS bytes^)
for /f "usebackq delims=" %%M in (`powershell -NoProfile -Command "[Console]::Out.WriteLine((-join ([char]0x53CC,[char]0x51FB))+' dist\'+(-join ([char]0x65B9,[char]0x5757,[char]0x67AA,[char]0x795E,[char]0x32,[char]0x44))+'.exe '+(-join ([char]0x5373,[char]0x53EF)))"`) do echo %%M
popd
endlocal
exit /b 0

:fail
popd
endlocal
exit /b 1