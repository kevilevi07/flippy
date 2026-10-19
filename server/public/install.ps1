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

# ---- Strategy 1: User PATH + setx broadcast ----
$UserPath = ''
try {
    $UserPath = (Get-ItemProperty 'HKCU:\Environment' -Name PATH -ErrorAction Stop).PATH
} catch { }
if ($UserPath -notlike "*$InstallDir*") {
    $NewPath = if ($UserPath) { "$UserPath;$InstallDir" } else { $InstallDir }
    try { Set-ItemProperty -Path 'HKCU:\Environment' -Name PATH -Value $NewPath -Force } catch { }
    $NowPath = $NewPath
    L "appended InstallDir to user PATH"
} else {
    $NowPath = $UserPath
}
# setx triggers WM_SETTINGCHANGE so Explorer-launched new terminals see it.
try {
    $null = & setx PATH "$NowPath" 2>&1
    L "setx broadcast done (exit=$LASTEXITCODE)"
} catch { L "setx exception: $($_.Exception.Message)" }

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

# ---- Verify in a fresh env ----
# Spawn a cmd with a FRESH environment pulled from the registry (same as
# what a brand-new Start-menu cmd would see). This is the real test — if
# `where trupx` finds something here, every new terminal will too.
$WhereFile = Join-Path $env:TEMP "trupx-where.txt"
if (Test-Path $WhereFile) { Remove-Item $WhereFile -Force }
try {
    $p = Start-Process cmd -ArgumentList "/c","where trupx > `"$WhereFile`" 2>&1" `
        -UseNewEnvironment -NoNewWindow -Wait -PassThru
    L "fresh-env where exit=$($p.ExitCode)"
} catch { L "fresh-env test exception: $($_.Exception.Message)" }
$freshCmdPath = ''
if (Test-Path $WhereFile) {
    $freshCmdPath = (Get-Content $WhereFile -Raw -ErrorAction SilentlyContinue).Trim()
}

# Readable summary printed in the console.
$binaryOk        = Test-Path $ExePath
$winAppsExeOk    = Test-Path (Join-Path $WinAppsDir 'trupx.exe')
$winAppsShimOk   = Test-Path (Join-Path $WinAppsDir 'trupx.cmd')
$userPathHasDir  = (Get-ItemProperty 'HKCU:\Environment' -Name PATH -ErrorAction SilentlyContinue).PATH -like "*$InstallDir*"
$winAppsOnPath   = $env:PATH -like "*WindowsApps*"

Write-Host ""
Write-Host "---- trupx install summary ----"
Write-Host ("  binary at $ExePath : {0}" -f $binaryOk)
Write-Host ("  WindowsApps\trupx.exe       : {0}" -f $winAppsExeOk)
Write-Host ("  WindowsApps\trupx.cmd       : {0}" -f $winAppsShimOk)
Write-Host ("  user PATH has .trupx\bin    : {0}" -f $userPathHasDir)
Write-Host ("  WindowsApps on session PATH : {0}" -f $winAppsOnPath)
Write-Host ("  fresh-env where trupx       : {0}" -f ($freshCmdPath -ne '' -and $freshCmdPath -notlike 'INFO:*'))
if ($freshCmdPath) { Write-Host ("    -> {0}" -f $freshCmdPath) }
Write-Host ""

if ($freshCmdPath -and $freshCmdPath -notlike 'INFO:*') {
    Write-Host "trupx is callable from new terminals. Opening one and running:"
    Write-Host "  trupx"
    Write-Host ""
} else {
    Write-Host "trupx is installed but NOT found by new terminals."
    Write-Host ""
    Write-Host "Use the full path for now:"
    Write-Host "  $ExePath"
    Write-Host ""
    Write-Host "Diagnostic info saved to: $LogFile"
    Write-Host ""
}

# Auto-start the tunnel regardless.
try { Start-Process -FilePath $ExePath -WindowStyle Hidden } catch { }
