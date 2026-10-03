# ============================================================
#  Block Gunner 2D - offline APK build (ASCII only, no network)
#
#  Manual toolchain (no Gradle / no AGP):
#    aapt2 compile/link  -> resources + assets + R.java
#    javac (JDK 8)       -> .class   (bootclasspath = android.jar)
#    d8 (Java 11+)       -> classes.dex
#    aapt add            -> classes.dex into the APK
#    zipalign            -> 4-byte alignment
#    apksigner           -> debug-signed APK
#
#  IMPORTANT: the Android native tools (aapt2/aapt/zipalign) cannot open
#  directories whose path contains non-ASCII characters, so the whole build
#  runs in an ASCII staging folder under %TEMP%; only the final APK is copied
#  back to <project>\dist\.
#
#  Output: dist/BlockGunner2D.apk  and  dist/<Chinese name>.apk
#  Called by the build .bat in the android folder
# ============================================================
$ErrorActionPreference = 'Stop'

$ToolsDir     = $PSScriptRoot
$AndroidDir   = (Resolve-Path (Join-Path $ToolsDir '..')).Path
$ProjectRoot  = (Resolve-Path (Join-Path $AndroidDir '..')).Path
$AppDir       = Join-Path $AndroidDir 'app\src\main'
$JavaSrcDir   = Join-Path $AppDir 'java'
$ResDir       = Join-Path $AppDir 'res'
$ManifestPath = Join-Path $AppDir 'AndroidManifest.xml'
$AssetsDir    = Join-Path $AppDir 'assets'
$DistDir      = Join-Path $ProjectRoot 'dist'
$ProjectKeystore = Join-Path $ToolsDir 'debug.keystore'

function Step([string]$msg) { Write-Host ('[build] ' + $msg) }
function Ok([string]$msg)   { Write-Host ('[build] OK  ' + $msg) -ForegroundColor Green }
function Fail([string]$msg) { Write-Host ('[build] ERROR: ' + $msg) -ForegroundColor Red; exit 1 }

function Invoke-Capture([string]$exe, [string[]]$arguments) {
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        return ((& $exe @arguments 2>&1) | Out-String)
    } finally {
        $ErrorActionPreference = $old
    }
}

function Invoke-Step([string]$exe, [string[]]$arguments, [string]$label) {
    Step $label
    & $exe @arguments
    if ($LASTEXITCODE -ne 0) {
        Fail ($label + ' failed (exit ' + $LASTEXITCODE + ')')
    }
}

function Read-ZipUInt16([byte[]]$bytes, [int]$offset) {
    return ([int]$bytes[$offset]) + (([int]$bytes[$offset + 1]) -shl 8)
}

function Read-ZipUInt32([byte[]]$bytes, [int]$offset) {
    return ([long]$bytes[$offset]) + (([long]$bytes[$offset + 1]) -shl 8) +
           (([long]$bytes[$offset + 2]) -shl 16) + (([long]$bytes[$offset + 3]) -shl 24)
}

# aapt2 on Windows stores asset entries as "assets/www\x.html"; Android needs "/".
# Patch the name bytes in-place in the zip local headers + central directory
# (same length, so no offsets/compression change).
function Repair-ApkEntryNames([string]$apkPath) {
    $bytes = [System.IO.File]::ReadAllBytes($apkPath)
    $eocd = -1
    $min = [Math]::Max(0, $bytes.Length - 65557)
    for ($i = $bytes.Length - 22; $i -ge $min; $i--) {
        if ($bytes[$i] -eq 0x50 -and $bytes[$i + 1] -eq 0x4B -and $bytes[$i + 2] -eq 0x05 -and $bytes[$i + 3] -eq 0x06) {
            $eocd = $i
            break
        }
    }
    if ($eocd -lt 0) { Fail 'zip: cannot find end-of-central-directory record' }
    $count = Read-ZipUInt16 $bytes ($eocd + 10)
    $cdOffset = [int](Read-ZipUInt32 $bytes ($eocd + 16))
    $changed = 0
    $pos = $cdOffset
    for ($n = 0; $n -lt $count; $n++) {
        if (!($bytes[$pos] -eq 0x50 -and $bytes[$pos + 1] -eq 0x4B -and $bytes[$pos + 2] -eq 0x01 -and $bytes[$pos + 3] -eq 0x02)) {
            Fail 'zip: bad central directory entry at ' + $pos
        }
        $nameLen = Read-ZipUInt16 $bytes ($pos + 28)
        $extraLen = Read-ZipUInt16 $bytes ($pos + 30)
        $commentLen = Read-ZipUInt16 $bytes ($pos + 32)
        $localOffset = [int](Read-ZipUInt32 $bytes ($pos + 42))
        $nameStart = $pos + 46
        for ($j = 0; $j -lt $nameLen; $j++) {
            if ($bytes[$nameStart + $j] -eq 0x5C) { $bytes[$nameStart + $j] = 0x2F; $changed++ }
        }
        if ($bytes[$localOffset] -eq 0x50 -and $bytes[$localOffset + 1] -eq 0x4B -and
            $bytes[$localOffset + 2] -eq 0x03 -and $bytes[$localOffset + 3] -eq 0x04) {
            $localNameLen = Read-ZipUInt16 $bytes ($localOffset + 26)
            $localNameStart = $localOffset + 30
            for ($j = 0; $j -lt $localNameLen; $j++) {
                if ($bytes[$localNameStart + $j] -eq 0x5C) { $bytes[$localNameStart + $j] = 0x2F; $changed++ }
            }
        }
        $pos = $nameStart + $nameLen + $extraLen + $commentLen
    }
    if ($changed -gt 0) {
        [System.IO.File]::WriteAllBytes($apkPath, $bytes)
    }
    return $changed
}

function Add-Candidates($list, $values) {
    foreach ($v in $values) {
        if ($v -and !$list.Contains($v)) { [void]$list.Add($v) }
    }
}

function Test-JdkHome([string]$jdkPath) {
    if ([string]::IsNullOrWhiteSpace($jdkPath)) { return $false }
    return (Test-Path (Join-Path $jdkPath 'bin\javac.exe'))
}

function Get-JavaMajor([string]$jdkPath) {
    $out = Invoke-Capture (Join-Path $jdkPath 'bin\java.exe') @('-version')
    if ($out -match 'version "1\.(\d+)') { return [int]$Matches[1] }
    if ($out -match 'version "(\d+)')    { return [int]$Matches[1] }
    return 0
}

function Test-AsciiPath([string]$path) {
    if ([string]::IsNullOrWhiteSpace($path)) { return $false }
    foreach ($ch in $path.ToCharArray()) {
        $code = [int]$ch
        if ($code -lt 32 -or $code -gt 126) { return $false }
    }
    return $true
}

# ------------------------------------------------------------
# 1) locate JDK 8 (javac with -bootclasspath) + Java 11+ (d8)
# ------------------------------------------------------------
$jdkCandidates = New-Object System.Collections.Generic.List[string]
Add-Candidates $jdkCandidates @($env:JAVA_HOME)
Add-Candidates $jdkCandidates @('D:\Program Files\Zulu\zulu-8', 'C:\Program Files\Zulu\zulu-8', 'C:\Program Files\Java\jdk1.8.0')
foreach ($pattern in @('D:\Program Files\Zulu\zulu-*', 'C:\Program Files\Zulu\zulu-*',
                       'C:\Program Files\Java\jdk1.8*', 'C:\Program Files\Java\jdk-8*',
                       'C:\Program Files\Eclipse Adoptium\jdk-8*', 'D:\Java\jdk1.8*')) {
    Get-Item $pattern -ErrorAction SilentlyContinue | ForEach-Object { Add-Candidates $jdkCandidates @($_.FullName) }
}

$CompileJavaHome = $null
foreach ($javaCandidate in $jdkCandidates) {
    if ((Test-JdkHome $javaCandidate) -and (Get-JavaMajor $javaCandidate) -eq 8) { $CompileJavaHome = $javaCandidate; break }
}
if (!$CompileJavaHome) {
    foreach ($javaCandidate in $jdkCandidates) {
        if ((Test-JdkHome $javaCandidate) -and (Get-JavaMajor $javaCandidate) -eq 11) { $CompileJavaHome = $javaCandidate; break }
    }
}
if (!$CompileJavaHome) { Fail 'JDK 8 not found. Install JDK 8 (or 11) or set JAVA_HOME to it.' }

$jreCandidates = New-Object System.Collections.Generic.List[string]
Add-Candidates $jreCandidates @($env:JAVA_HOME)
Add-Candidates $jreCandidates @('D:\Program Files\Zulu\zulu-17', 'D:\Program Files\Zulu\zulu-11', 'D:\Program Files\Zulu\zulu-21',
                               'C:\Program Files\Zulu\zulu-17', 'C:\Program Files\Java\jdk-17', 'C:\Program Files\Java\jdk-11')
foreach ($pattern in @('D:\Program Files\Zulu\zulu-*', 'C:\Program Files\Zulu\zulu-*',
                       'C:\Program Files\Java\jdk-1*', 'C:\Program Files\Eclipse Adoptium\jdk-*')) {
    Get-Item $pattern -ErrorAction SilentlyContinue | ForEach-Object { Add-Candidates $jreCandidates @($_.FullName) }
}
$DexJavaHome = $null
foreach ($javaCandidate in $jreCandidates) {
    if ((Test-JdkHome $javaCandidate) -and (Get-JavaMajor $javaCandidate) -ge 11) { $DexJavaHome = $javaCandidate; break }
}
if (!$DexJavaHome) { Fail 'Java 11+ not found (d8/apksigner from build-tools 34+ need it). Set JAVA_HOME to JDK 11+ or install Zulu 17.' }

# ------------------------------------------------------------
# 2) locate Android SDK / platform / build-tools
# ------------------------------------------------------------
$sdkCandidates = New-Object System.Collections.Generic.List[string]
Add-Candidates $sdkCandidates @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT)
Add-Candidates $sdkCandidates @((Join-Path $env:LOCALAPPDATA 'Android\Sdk'), 'C:\Android\Sdk', 'D:\Android\Sdk',
                                'D:\Program Files\Android\Sdk', 'C:\Users\XUFEN\AppData\Local\Android\Sdk')
$Sdk = $null
foreach ($candidate in $sdkCandidates) {
    if ($candidate -and (Test-Path (Join-Path $candidate 'platforms')) -and (Test-Path (Join-Path $candidate 'build-tools'))) {
        $Sdk = (Resolve-Path $candidate).Path
        break
    }
}
if (!$Sdk) { Fail 'Android SDK not found. Set ANDROID_HOME (or ANDROID_SDK_ROOT) to your SDK folder.' }
if (!(Test-AsciiPath $Sdk)) { Write-Host '[build] WARN: SDK path contains non-ASCII characters; native tools may fail.' }

$platforms = @()
foreach ($dir in @(Get-ChildItem (Join-Path $Sdk 'platforms') -Directory -ErrorAction SilentlyContinue)) {
    if ($dir.Name -match '^android-([0-9.]+)$' -and (Test-Path (Join-Path $dir.FullName 'android.jar'))) {
        $ver = 0.0
        try { $ver = [double]$Matches[1] } catch { $ver = 0.0 }
        $stable = 0
        if ($dir.Name -match '^android-[0-9]+$') { $stable = 1 }
        $platforms += New-Object psobject -Property @{ Path = $dir.FullName; Name = $dir.Name; Ver = $ver; Stable = $stable }
    }
}
if ($platforms.Count -eq 0) { Fail ('no android.jar found under ' + (Join-Path $Sdk 'platforms')) }
$Platform = $platforms | Sort-Object -Property @{Expression={$_.Stable};Descending=$true}, @{Expression={$_.Ver};Descending=$true} | Select-Object -First 1
$AndroidJar = Join-Path $Platform.Path 'android.jar'

$buildToolsList = @()
foreach ($dir in @(Get-ChildItem (Join-Path $Sdk 'build-tools') -Directory -ErrorAction SilentlyContinue)) {
    $needed = @('aapt2.exe', 'aapt.exe', 'd8.bat', 'zipalign.exe', 'apksigner.bat')
    $complete = $true
    foreach ($n in $needed) {
        if (!(Test-Path (Join-Path $dir.FullName $n))) { $complete = $false }
    }
    if ($complete) {
        $ver = 0.0
        try { $ver = [double](($dir.Name -split '-')[0]) } catch { $ver = 0.0 }
        $buildToolsList += New-Object psobject -Property @{ Path = $dir.FullName; Name = $dir.Name; Ver = $ver }
    }
}
if ($buildToolsList.Count -eq 0) { Fail 'no complete build-tools found (need aapt2/aapt/d8/zipalign/apksigner).' }

$BuildTools = $null
$env:JAVA_HOME = $DexJavaHome
foreach ($bt in @($buildToolsList | Sort-Object -Property @{Expression={$_.Ver};Descending=$true})) {
    $probe = Invoke-Capture (Join-Path $bt.Path 'd8.bat') @('--version')
    if ($LASTEXITCODE -eq 0) { $BuildTools = $bt; break }
    Write-Host ('[build] build-tools ' + $bt.Name + ' d8 cannot run with Java ' + (Get-JavaMajor $DexJavaHome) + ', trying an older one')
}
if (!$BuildTools) { Fail ('no usable build-tools: d8 needs Java 11+ but failed with ' + $DexJavaHome) }

$aapt2     = Join-Path $BuildTools.Path 'aapt2.exe'
$aapt      = Join-Path $BuildTools.Path 'aapt.exe'
$d8        = Join-Path $BuildTools.Path 'd8.bat'
$zipalign  = Join-Path $BuildTools.Path 'zipalign.exe'
$apksigner = Join-Path $BuildTools.Path 'apksigner.bat'
$adb       = Join-Path $Sdk 'platform-tools\adb.exe'

Step ('project   : ' + $ProjectRoot)
Step ('compile JDK: ' + $CompileJavaHome + '  (javac)')
Step ('dex JDK   : ' + $DexJavaHome + '  (d8/apksigner)')
Step ('SDK       : ' + $Sdk)
Step ('platform  : ' + $Platform.Name + '  (' + $AndroidJar + ')')
Step ('build-tool: ' + $BuildTools.Name)

$env:ANDROID_HOME = $Sdk
$env:ANDROID_SDK_ROOT = $Sdk
$env:PATH = (Join-Path $CompileJavaHome 'bin') + ';' + (Join-Path $DexJavaHome 'bin') + ';' +
            $BuildTools.Path + ';' + (Join-Path $Sdk 'platform-tools') + ';' + $env:PATH

# ------------------------------------------------------------
# 3) sync web assets, stage an ASCII-only working copy
# ------------------------------------------------------------
Step 'sync web assets from project root into APK assets'
& (Join-Path $ToolsDir 'sync-assets.ps1')

$StageBase = $null
foreach ($stageCandidate in @((Join-Path $env:TEMP 'blockgunner-apk-build'),
                              (Join-Path $env:LOCALAPPDATA 'blockgunner-apk-build'),
                              (Join-Path $env:windir 'Temp\blockgunner-apk-build'))) {
    if (Test-AsciiPath $stageCandidate) { $StageBase = $stageCandidate; break }
}
if (!$StageBase) { Fail 'no ASCII temporary folder available for aapt2 (set TEMP to an ASCII path).' }
if (Test-Path $StageBase) { Remove-Item -Recurse -Force $StageBase }
New-Item -ItemType Directory -Force $StageBase | Out-Null

$StageRes      = Join-Path $StageBase 'res'
$StageAssets   = Join-Path $StageBase 'assets'
$StageJava     = Join-Path $StageBase 'java'
$StageJvmSrc   = Join-Path $StageBase 'jvm-test-src'
$StageManifest = Join-Path $StageBase 'AndroidManifest.xml'
$BuildDir      = Join-Path $StageBase 'build'
Copy-Item $ResDir $StageRes -Recurse -Force
Copy-Item $AssetsDir $StageAssets -Recurse -Force
Copy-Item $JavaSrcDir $StageJava -Recurse -Force
Copy-Item (Join-Path $ToolsDir 'jvm-test') $StageJvmSrc -Recurse -Force
Copy-Item $ManifestPath $StageManifest -Force

Step ('staging   : ' + $StageBase + '  (aapt2/zipalign need an ASCII path)')
foreach ($d in @('gen', 'classes', 'dex', 'jvm-test')) {
    New-Item -ItemType Directory -Force (Join-Path $BuildDir $d) | Out-Null
}
$unsigned = Join-Path $BuildDir 'app-unsigned.apk'
$aligned  = Join-Path $BuildDir 'app-aligned.apk'
$signed   = Join-Path $BuildDir 'app-signed.apk'

# ------------------------------------------------------------
# 4) JVM smoke test for the loopback HTTP server
# ------------------------------------------------------------
$LocalServerSrc = Join-Path $StageJava 'com\blockgunner2d\app\LocalHttpServer.java'
$JvmTestSrc     = Join-Path $StageJvmSrc 'LocalHttpServerTest.java'
Invoke-Step (Join-Path $CompileJavaHome 'bin\javac.exe') @('-encoding', 'UTF-8', '-source', '1.8', '-target', '1.8',
    '-bootclasspath', $AndroidJar, '-d', (Join-Path $BuildDir 'jvm-test'), $LocalServerSrc, $JvmTestSrc) 'compile loopback HTTP server test'
Invoke-Step (Join-Path $CompileJavaHome 'bin\java.exe') @('-cp', (Join-Path $BuildDir 'jvm-test'),
    'com.blockgunner2d.app.LocalHttpServerTest') 'run loopback HTTP server test (JVM)'

# ------------------------------------------------------------
# 5) resources + assets + R.java
# ------------------------------------------------------------
Invoke-Step $aapt2 @('compile', '--dir', $StageRes, '-o', (Join-Path $BuildDir 'compiled_res.zip')) 'aapt2 compile resources'
Invoke-Step $aapt2 @('link', '-o', $unsigned, '-I', $AndroidJar, '--manifest', $StageManifest,
    '-R', (Join-Path $BuildDir 'compiled_res.zip'), '-A', $StageAssets, '--java', (Join-Path $BuildDir 'gen'),
    '--min-sdk-version', '21', '--target-sdk-version', '33', '--version-code', '1', '--version-name', '0.1.0',
    '--auto-add-overlay') 'aapt2 link (resources + assets + R.java)'

# ------------------------------------------------------------
# 6) compile + dex + package
# ------------------------------------------------------------
$sources = @()
$sources += @(Get-ChildItem (Join-Path $BuildDir 'gen') -Recurse -Filter '*.java' | ForEach-Object { $_.FullName })
$sources += @(Get-ChildItem $StageJava -Recurse -Filter '*.java' | ForEach-Object { $_.FullName })
$javacArgs = @('-encoding', 'UTF-8', '-source', '1.8', '-target', '1.8', '-bootclasspath', $AndroidJar,
    '-d', (Join-Path $BuildDir 'classes')) + $sources
Invoke-Step (Join-Path $CompileJavaHome 'bin\javac.exe') $javacArgs 'compile Java sources against android.jar'

$classFiles = @(Get-ChildItem (Join-Path $BuildDir 'classes') -Recurse -Filter '*.class' | ForEach-Object { $_.FullName })
if ($classFiles.Count -eq 0) { Fail 'javac produced no .class files' }
$env:JAVA_HOME = $DexJavaHome
$d8Args = @('--min-api', '21', '--lib', $AndroidJar, '--output', (Join-Path $BuildDir 'dex')) + $classFiles
Invoke-Step $d8 $d8Args 'dex classes (d8, min-api 21)'

Push-Location (Join-Path $BuildDir 'dex')
try {
    Invoke-Step $aapt @('add', '-v', $unsigned, 'classes.dex') 'add classes.dex into APK'
} finally {
    Pop-Location
}

Step 'normalize APK entry separators (aapt2 on Windows writes backslashes)'
Repair-ApkEntryNames $unsigned

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($unsigned)
try {
    $arsc = $zip.Entries | Where-Object { $_.FullName -eq 'resources.arsc' }
    $dexEntry = $zip.Entries | Where-Object { $_.FullName -eq 'classes.dex' }
    $indexEntry = $zip.Entries | Where-Object { $_.FullName -eq 'assets/index.html' }
    if ($arsc -eq $null) { Fail 'resources.arsc missing in APK' }
    if ($dexEntry -eq $null) { Fail 'classes.dex missing in APK' }
    if ($indexEntry -eq $null) { Fail 'assets/index.html missing in APK' }
    if ($arsc.CompressedLength -ne $arsc.Length) { Fail 'resources.arsc must stay uncompressed (stored) in the APK' }
    Step ('APK entries: resources.arsc stored=' + ($arsc.CompressedLength -eq $arsc.Length) +
          ', classes.dex=' + $dexEntry.Length + ' bytes, assets/index.html=' + $indexEntry.Length + ' bytes')
} finally {
    $zip.Dispose()
}

Invoke-Step $zipalign @('-f', '-p', '4', $unsigned, $aligned) 'zipalign (-p 4)'

# ------------------------------------------------------------
# 7) sign + verify
# ------------------------------------------------------------
$env:JAVA_HOME = $DexJavaHome
$Keystore = Join-Path $StageBase 'debug.keystore'
if (Test-Path $ProjectKeystore) { Copy-Item $ProjectKeystore $Keystore -Force }
if (!(Test-Path $Keystore)) {
    Invoke-Step (Join-Path $CompileJavaHome 'bin\keytool.exe') @('-genkeypair', '-keystore', $Keystore,
        '-storepass', 'android', '-keypass', 'android', '-alias', 'androiddebugkey', '-keyalg', 'RSA',
        '-keysize', '2048', '-validity', '10000',
        '-dname', 'CN=Block Gunner 2D, OU=Debug, O=BlockGunner2D, L=NA, ST=NA, C=CN') 'generate debug keystore'
    Copy-Item $Keystore $ProjectKeystore -Force
}
Invoke-Step $apksigner @('sign', '--ks', $Keystore, '--ks-pass', 'pass:android', '--key-pass', 'pass:android',
    '--ks-key-alias', 'androiddebugkey', '--v1-signing-enabled', 'true', '--v2-signing-enabled', 'true',
    '--out', $signed, $aligned) 'sign APK (apksigner, debug key)'
Invoke-Step $apksigner @('verify', '--verbose', $signed) 'verify APK signature'

# ------------------------------------------------------------
# 8) assert package / activity / contents, copy to dist/
# ------------------------------------------------------------
$aapt2Out = Invoke-Capture $aapt2 @('dump', 'badging', $signed)
$listOut  = Invoke-Capture $aapt  @('list', $signed)

if ($aapt2Out -notmatch "package: name='com\.blockgunner2d\.app'") {
    Fail ('badging package check failed: ' + $aapt2Out)
}
if ($aapt2Out -notmatch "launchable-activity: name='com\.blockgunner2d\.app\.MainActivity'") {
    Fail ('badging launchable-activity check failed: ' + $aapt2Out)
}
if ($listOut -notmatch 'classes\.dex') { Fail 'classes.dex not listed in APK' }
if ($listOut -notmatch 'assets/index\.html') { Fail 'assets/index.html not listed in APK' }
if ($listOut -notmatch 'assets/js/game\.js') { Fail 'assets/js/game.js not listed in APK' }
if ($listOut -notmatch 'assets/icons/icon-512\.png') { Fail 'assets/icons/icon-512.png not listed in APK' }

$pkgLine = ($aapt2Out -split "`r?`n" | Where-Object { $_ -match '^package:' } | Select-Object -First 1)
$actLine = ($aapt2Out -split "`r?`n" | Where-Object { $_ -match '^launchable-activity:' } | Select-Object -First 1)

New-Item -ItemType Directory -Force $DistDir | Out-Null
$cnName = (-join ([char]0x65B9, [char]0x5757, [char]0x67AA, [char]0x795E, [char]0x32, [char]0x44)) + '.apk'
$primary = Join-Path $DistDir $cnName
$alias   = Join-Path $DistDir 'BlockGunner2D.apk'
Copy-Item $signed $primary -Force
Copy-Item $signed $alias -Force

$sizeMb = [Math]::Round((Get-Item $primary).Length / 1MB, 2)
Write-Host ''
Ok ('APK built: ' + $primary + '  (' + $sizeMb + ' MB)')
Write-Host ('[build] alias   : ' + $alias + '  (same file, ASCII name)')
Write-Host ('[build] ' + $pkgLine)
Write-Host ('[build] ' + $actLine)
Write-Host ('[build] install : "' + $adb + '" install -r "' + $primary + '"')
Write-Host '[build] note    : debug-signed APK; on the phone allow "install unknown apps" first.'
exit 0