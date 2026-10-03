# ============================================================
#  Block Gunner 2D - copy the web game from the project root
#  into the APK assets (android/app/src/main/assets/www).
#  ASCII only. Called by the sync-assets .bat and by build-apk.ps1.
# ============================================================
$ErrorActionPreference = 'Stop'

$ToolsDir   = $PSScriptRoot
$AndroidDir = (Resolve-Path (Join-Path $ToolsDir '..')).Path
$ProjectRoot = (Resolve-Path (Join-Path $AndroidDir '..')).Path
$AssetsRoot = Join-Path $AndroidDir 'app\src\main\assets'
$Www        = $AssetsRoot

function Fail([string]$msg) {
    Write-Host ('[sync] ERROR: ' + $msg) -ForegroundColor Red
    exit 1
}

$requiredFiles = @('index.html', 'style.css', 'sw.js', 'manifest.webmanifest')
$requiredDirs  = @('js', 'icons')

foreach ($f in $requiredFiles) {
    if (!(Test-Path (Join-Path $ProjectRoot $f))) { Fail ('missing file: ' + (Join-Path $ProjectRoot $f)) }
}
foreach ($d in $requiredDirs) {
    if (!(Test-Path (Join-Path $ProjectRoot $d))) { Fail ('missing directory: ' + (Join-Path $ProjectRoot $d)) }
}

if (Test-Path $Www) { Remove-Item -Recurse -Force $Www }
New-Item -ItemType Directory -Force $Www | Out-Null

foreach ($f in $requiredFiles) {
    Copy-Item (Join-Path $ProjectRoot $f) (Join-Path $Www $f) -Force
}
foreach ($d in $requiredDirs) {
    Copy-Item (Join-Path $ProjectRoot $d) (Join-Path $Www $d) -Recurse -Force
}

$files = @(Get-ChildItem $Www -Recurse -File)
$bytes = ($files | Measure-Object -Property Length -Sum).Sum
Write-Host ('[sync] assets ready: ' + $files.Count + ' files, ' + [Math]::Round($bytes / 1KB, 1) + ' KB')
Write-Host ('[sync] target: ' + $Www)
foreach ($f in $files) {
    Write-Host ('[sync]   ' + $f.FullName.Substring($Www.Length + 1) + '  (' + $f.Length + ' bytes)')
}