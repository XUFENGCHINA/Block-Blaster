#Requires -Version 5.1
<#
  Block Gunner 2D - automated verification for dist\<name>.exe   (ASCII source)

  What it does:
    1. checks the EXE exists and has a PE header (MZ)
    2. runs the headless self-test:  <exe> --selftest --port=18080
       (starts node -> GET /healthz 200 -> stop -> port released -> exit code 0)
    3. starts the GUI with --autostart --no-browser:
         - main window is created with the expected title
         - node is listening (netstat / Get-NetTCPConnection) and /healthz returns 200
         - clicks the "stop" button (BM_CLICK) -> node exits, port is released
         - clicks the "start" button -> server listens again
         - closes the window (WM_CLOSE) -> node is cleaned up, port released
    4. prints RESULT: PASS/FAIL and exits 0/1

  Usage (from anywhere):
    powershell -NoProfile -ExecutionPolicy Bypass -File packaging\exe\verify-exe.ps1
    powershell ... -File packaging\exe\verify-exe.ps1 -Port 8090 -SkipSelfTest

  Only ASCII bytes are used here; Chinese strings (window / button names) are
  built from Unicode code points so the script survives any code page.
#>
param(
    [string]$Exe = '',
    [int]$Port = 8080,
    [int]$SelfTestPort = 18080,
    [switch]$SkipSelfTest
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$script:Checks = 0
$script:Failed = 0

function Check {
    param([string]$Name, [bool]$Ok, [string]$Detail = '')
    $script:Checks++
    if (-not $Ok) { $script:Failed++ }
    $tag = 'FAIL'
    if ($Ok) { $tag = 'PASS' }
    $line = '[' + $script:Checks + '] ' + $tag + '  ' + $Name
    if ($Detail) { $line = $line + '  -> ' + $Detail }
    Write-Host $line
}

function WaitUntil {
    param([scriptblock]$Condition, [int]$TimeoutMs = 10000, [string]$Name = 'condition')
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($sw.ElapsedMilliseconds -lt $TimeoutMs) {
        if (& $Condition) { return $true }
        Start-Sleep -Milliseconds 200
    }
    return $false
}

function Test-PortListening {
    param([int]$P)
    $c = Get-NetTCPConnection -State Listen -LocalPort $P -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($c) { return $true }
    $lines = netstat -ano | Select-String -Pattern (':' + $P + '\s')
    foreach ($l in $lines) { if ($l.Line -match 'LISTENING') { return $true } }
    return $false
}

function Get-ListenerPid {
    param([int]$P)
    $c = Get-NetTCPConnection -State Listen -LocalPort $P -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($c) { return [int]$c.OwningProcess }
    $m = netstat -ano | Select-String -Pattern (':' + $P + '\s+.*LISTENING\s+(\d+)') | Select-Object -First 1
    if ($m) { return [int]$m.Matches[0].Groups[1].Value }
    return 0
}

function Test-Health {
    param([int]$P)
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri ('http://127.0.0.1:' + $P + '/healthz') -TimeoutSec 2
        if ($r.StatusCode -eq 200) { return $true }
    } catch { }
    return $false
}

if (-not ('Bg2dWin32' -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class Bg2dWin32
{
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr hWndParent, EnumProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    public static IntPtr FindChildByText(IntPtr parent, string text)
    {
        IntPtr found = IntPtr.Zero;
        EnumChildWindows(parent, delegate(IntPtr h, IntPtr l)
        {
            StringBuilder sb = new StringBuilder(512);
            GetWindowText(h, sb, sb.Capacity);
            if (sb.ToString() == text) { found = h; return false; }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    public static void ClickButton(IntPtr h) { SendMessage(h, 0x00F5, IntPtr.Zero, IntPtr.Zero); }
    public static void CloseWindow(IntPtr h) { PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero); }
}
"@
}

$appName = -join ([char]0x65B9, [char]0x5757, [char]0x67AA, [char]0x795E, [char]0x32, [char]0x44)
$winTitle = (-join ([char]0x65B9, [char]0x5757, [char]0x67AA, [char]0x795E)) + ' 2D'
$stopText = -join ([char]0x505C, [char]0x6B62, [char]0x670D, [char]0x52A1)
$startText = -join ([char]0x5F00, [char]0x59CB, [char]0x6E38, [char]0x620F)

if (-not $Exe) {
    $root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
    $Exe = Join-Path $root ('dist\' + $appName + '.exe')
}

Write-Host '=== Block Gunner 2D EXE verification ==='
Write-Host ('exe: ' + $Exe)

$launcher = $null
$nodePid = 0
$nodePid2 = 0

try {
    $exists = Test-Path -LiteralPath $Exe
    Check 'exe exists' $exists $Exe
    if (-not $exists) { throw 'exe not found' }

    $fi = Get-Item -LiteralPath $Exe
    $head = [System.IO.File]::ReadAllBytes($Exe)
    Check 'PE header is MZ' (($head[0] -eq 0x4D) -and ($head[1] -eq 0x5A)) ('size=' + $fi.Length + ' bytes')

    if (-not $SkipSelfTest) {
        $log = Join-Path $env:TEMP 'block-gunner-2d-selftest.txt'
        Remove-Item -LiteralPath $log -ErrorAction SilentlyContinue
        $st = Start-Process -FilePath $Exe -ArgumentList @('--selftest', ('--port=' + $SelfTestPort)) -Wait -PassThru
        Check 'selftest exit code is 0' ($st.ExitCode -eq 0) ('exit=' + $st.ExitCode)
        $logText = ''
        if (Test-Path -LiteralPath $log) { $logText = Get-Content -LiteralPath $log -Raw -Encoding UTF8 }
        Check 'selftest reports RESULT: PASS' ($logText -match 'RESULT: PASS')
        if ($logText) { Write-Host $logText }
    }

    $usePort = $Port
    while ((Test-PortListening $usePort) -and ($usePort -lt ($Port + 40))) { $usePort++ }
    Check 'found a free test port' ((Test-PortListening $usePort) -eq $false) ('port=' + $usePort)

    Write-Host ''
    Write-Host ('--- GUI lifecycle on port ' + $usePort + ' ---')
    $launcher = Start-Process -FilePath $Exe -ArgumentList @('--autostart', '--no-browser', ('--port=' + $usePort)) -PassThru
    Check 'launcher process started' ($null -ne $launcher) ('pid=' + $launcher.Id)

    $proc = $null
    $deadline = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $deadline) {
        $proc = Get-Process -Id $launcher.Id -ErrorAction SilentlyContinue
        if ($proc -and ($proc.MainWindowHandle -ne [IntPtr]::Zero)) { break }
        Start-Sleep -Milliseconds 200
    }
    $hwnd = [IntPtr]::Zero
    if ($proc -and ($proc.MainWindowHandle -ne [IntPtr]::Zero)) { $hwnd = $proc.MainWindowHandle }
    Check 'main window created' ($hwnd -ne [IntPtr]::Zero) ('hwnd=0x' + $hwnd.ToInt64().ToString('X'))
    if ($proc) {
        $proc.Refresh()
        Check 'window title is correct' ($proc.MainWindowTitle -eq $winTitle) ('title=' + $proc.MainWindowTitle)
    }

    $health1 = WaitUntil { Test-Health -P $usePort } 30000 'healthz'
    Check 'healthz returns 200 after autostart' $health1
    $body1 = ''
    try { $body1 = (Invoke-WebRequest -UseBasicParsing -Uri ('http://127.0.0.1:' + $usePort + '/healthz') -TimeoutSec 2).Content } catch { }
    Check 'healthz body contains ok:true' ($body1 -match '"ok":true') ($body1)

    $listen1 = Test-PortListening $usePort
    $nodePid = Get-ListenerPid $usePort
    $nodeProc = Get-Process -Id $nodePid -ErrorAction SilentlyContinue
    Check 'netstat shows port listening' $listen1 ('port=' + $usePort)
    Check 'listener is node.exe' ($null -ne $nodeProc -and $nodeProc.ProcessName -eq 'node') ('pid=' + $nodePid)

    if ($hwnd -ne [IntPtr]::Zero) {
        $btn = [Bg2dWin32]::FindChildByText($hwnd, $stopText)
        Check 'stop button found' ($btn -ne [IntPtr]::Zero)
        if ($btn -ne [IntPtr]::Zero) { [Bg2dWin32]::ClickButton($btn) }
        $stopped = WaitUntil { $null -eq (Get-Process -Id $nodePid -ErrorAction SilentlyContinue) } 10000 'node exit'
        Check 'clicking stop exits the node process' $stopped ('pid=' + $nodePid)
        $released = WaitUntil { -not (Test-PortListening $usePort) } 10000 'port release'
        Check 'clicking stop releases the port' $released ('port=' + $usePort)

        $btn2 = [Bg2dWin32]::FindChildByText($hwnd, $startText)
        Check 'start button found' ($btn2 -ne [IntPtr]::Zero)
        if ($btn2 -ne [IntPtr]::Zero) { [Bg2dWin32]::ClickButton($btn2) }
        $restart = WaitUntil { Test-PortListening $usePort } 30000 'server restart'
        Check 'clicking start starts the server again' $restart
        $nodePid2 = Get-ListenerPid $usePort
        $nodeProc2 = Get-Process -Id $nodePid2 -ErrorAction SilentlyContinue
        Check 'second node process is running' ($null -ne $nodeProc2 -and $nodeProc2.ProcessName -eq 'node') ('pid=' + $nodePid2)

        [Bg2dWin32]::CloseWindow($hwnd)
    }

    $exitOk = WaitUntil { $null -eq (Get-Process -Id $launcher.Id -ErrorAction SilentlyContinue) } 15000 'launcher exit'
    Check 'launcher exits when window is closed' $exitOk
    if ($nodePid2 -gt 0) {
        $clean = WaitUntil { $null -eq (Get-Process -Id $nodePid2 -ErrorAction SilentlyContinue) } 10000 'node cleanup'
        Check 'closing the window kills its own node process' $clean ('pid=' + $nodePid2)
        $portFree = WaitUntil { -not (Test-PortListening $usePort) } 10000 'port free'
        Check 'port released after window close' $portFree ('port=' + $usePort)
    }
}
finally {
    if ($launcher) {
        $p = Get-Process -Id $launcher.Id -ErrorAction SilentlyContinue
        if ($p) { Stop-Process -Id $launcher.Id -Force -ErrorAction SilentlyContinue }
    }
    foreach ($np in @($nodePid, $nodePid2)) {
        if ($np -gt 0) {
            $n = Get-Process -Id $np -ErrorAction SilentlyContinue
            if ($n) { Stop-Process -Id $np -Force -ErrorAction SilentlyContinue }
        }
    }
}

$result = 'FAIL'
if ($script:Failed -eq 0) { $result = 'PASS' }
Write-Host ''
Write-Host ('RESULT: ' + $result + '  (' + ($script:Checks - $script:Failed) + '/' + $script:Checks + ' checks passed)')
if ($script:Failed -eq 0) { exit 0 }
exit 1