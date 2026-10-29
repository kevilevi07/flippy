# Trupx install for Windows (PowerShell). Verbose logging to %TEMP%\trupx-install.log.
#
#   iwr trupx.vercel.app/install.ps1 -useb | iex

$ErrorActionPreference = 'Continue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$Server      = 'https://trupx.vercel.app'
$InstallDir  = Join-Path $env:USERPROFILE '.trupx\bin'
$ExePath     = Join-Path $InstallDir 'trupx.exe'
$DownloadUrl = "$Server/trupx-windows-x64.exe"
$LogFile     = Join-Path $env:TEMP 'trupx-install.log'

function L($msg) {
    try {
        Add-Content -Path $LogFile -Value ("[$([DateTime]::Now.ToString('HH:mm:ss'))] $msg") -ErrorAction SilentlyContinue
    } catch { }
}

try { Clear-Content $LogFile -ErrorAction SilentlyContinue } catch { }
L "install started; InstallDir=$InstallDir"

if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
}

# Stop any running trupx so we can overwrite.
try {
    Get-Process -Name trupx -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
} catch { }

if (Test-Path $ExePath) {
    try {
        Rename-Item -Path $ExePath -NewName "trupx.exe.old-$(Get-Random)" -Force -ErrorAction Stop
    } catch {
        Write-Host "install failed: existing trupx.exe is locked. Close it and retry."
        exit 1
    }
}

# ---- Download ----
$Downloaded = $false
for ($i = 1; $i -le 3; $i++) {
    try {
        Invoke-WebRequest -Uri $DownloadUrl -OutFile $ExePath -UseBasicParsing
        $Downloaded = $true
        L "downloaded binary attempt $i"
        break
    } catch {
        L "download attempt $i failed: $($_.Exception.Message)"
        if ($i -lt 3) { Start-Sleep -Seconds 1 }
    }
}
if (-not $Downloaded) {
    Write-Host "install failed: could not download trupx. See $LogFile"
    exit 1
}

# ---- Strategy 1: User PATH via registry (handles long values) ----
# NOTE: we deliberately do NOT call `setx`. On systems where the user PATH
# is > 1024 bytes, setx silently truncates. Set-ItemProperty handles any
# length. We also provide a cmd AutoRun fallback below that doesn't rely on
# PATH persistence at all.
$UserPath = ''
try {
    $UserPath = (Get-ItemProperty 'HKCU:\Environment' -Name PATH -ErrorAction Stop).PATH
} catch { }
if ($UserPath -notlike "*$InstallDir*") {
    $NewPath = if ($UserPath) { "$UserPath;$InstallDir" } else { $InstallDir }
    try {
        Set-ItemProperty -Path 'HKCU:\Environment' -Name PATH -Value $NewPath -Force
        L "appended InstallDir to user PATH (length $($NewPath.Length))"
    } catch { L "Set-ItemProperty PATH failed: $($_.Exception.Message)" }
} else {
    L "InstallDir already on user PATH"
}

# ---- Strategy 1b: cmd AutoRun — guarantees cmd sees .trupx\bin ----
# HKCU\Software\Microsoft\Command Processor\AutoRun runs on EVERY cmd start.
# We prepend .trupx\bin to PATH there. No broadcast / Explorer refresh needed.
try {
    $cpKey = 'HKCU:\Software\Microsoft\Command Processor'
    if (-not (Test-Path $cpKey)) { New-Item -Path $cpKey -Force | Out-Null }
    $existing = ''
    try { $existing = (Get-ItemProperty $cpKey -Name AutoRun -ErrorAction Stop).AutoRun } catch { }
    $trupxLine = "set PATH=%USERPROFILE%\.trupx\bin;%PATH%"
    if ($existing -notlike "*trupx*") {
        $new = if ($existing) { "$existing & $trupxLine" } else { $trupxLine }
        Set-ItemProperty -Path $cpKey -Name AutoRun -Value $new -Force
        L "wrote cmd AutoRun"
    } else {
        L "cmd AutoRun already has trupx entry"
    }
} catch { L "cmd AutoRun failed: $($_.Exception.Message)" }

# ---- Strategy 2: Copy exe to WindowsApps (always on PATH on Win 10+) ----
$WinAppsDir = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps'
$WinAppsExe = $null
if (Test-Path $WinAppsDir) {
    $WinAppsExe = Join-Path $WinAppsDir 'trupx.exe'
    # Clear any existing copy first.
    if (Test-Path $WinAppsExe) {
        try { Rename-Item -Path $WinAppsExe -NewName "trupx.exe.old-$(Get-Random)" -Force -ErrorAction SilentlyContinue } catch { }
    }
    try {
        Copy-Item -Path $ExePath -Destination $WinAppsExe -Force -ErrorAction Stop
        L "copied exe to WindowsApps\trupx.exe"
    } catch {
        L "copy exe to WindowsApps failed: $($_.Exception.Message)"
        # Fallback: shim.
        $Shim = Join-Path $WinAppsDir 'trupx.cmd'
        try {
            $ShimBody = "@echo off`r`n`"$ExePath`" %*`r`n"
            Set-Content -Path $Shim -Value $ShimBody -Encoding ASCII -Force
            L "wrote shim fallback to WindowsApps\trupx.cmd"
        } catch { L "shim fallback failed: $($_.Exception.Message)" }
    }
} else {
    L "WindowsApps dir not present on this system"
}

# ---- Strategy 3: PowerShell $PROFILE alias (always works in PS) ----
try {
    $ProfileDir = Split-Path $PROFILE -Parent
    if (-not (Test-Path $ProfileDir)) { New-Item -ItemType Directory -Force $ProfileDir | Out-Null }
    if (-not (Test-Path $PROFILE)) { Set-Content -Path $PROFILE -Value "" -Force }
    $currentProfile = Get-Content $PROFILE -Raw -ErrorAction SilentlyContinue
    if ($currentProfile -notlike "*# trupx-alias*") {
        $aliasLine = "`n# trupx-alias`nif (Test-Path '$ExePath') { Set-Alias -Scope Global -Name trupx -Value '$ExePath' -ErrorAction SilentlyContinue }`n"
        Add-Content -Path $PROFILE -Value $aliasLine
        L "appended Set-Alias to PS profile at $PROFILE"
    }
} catch { L "profile alias failed: $($_.Exception.Message)" }

# ---- Session: make trupx callable in THIS window too ----
$env:PATH = "$env:PATH;$InstallDir;$WinAppsDir"
try { Set-Alias -Scope Global -Name trupx -Value $ExePath -ErrorAction SilentlyContinue } catch { }

# ---- Save server URL to CLI config ----
try { & $ExePath --server $Server login --token "noop" 2>&1 | Out-Null } catch { }

# ---- Auto-start the tunnel ----
try { Start-Process -FilePath $ExePath -WindowStyle Hidden } catch { }
L "spawned tunnel daemon"

# ---- Done ----
# NOTE: do NOT kill the host terminal here. Force-stopping $PID makes PowerShell
# exit with code 0xffffffff, which looks like the install crashed.
Write-Host ""
Write-Host "trupx installed." -ForegroundColor Green
Write-Host "Location : $ExePath"
Write-Host "A tunnel is starting in the background — view it at $Server/dashboard"
Write-Host "Open a NEW terminal, then: trupx status | trupx stop | trupx uninstall"
Write-Host ""
exit 0
