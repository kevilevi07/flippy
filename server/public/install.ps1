# Trupx install for Windows (PowerShell). Mostly silent — only shows a one
# line summary. Logs every step to %TEMP%\trupx-install.log for diagnosis.
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
        $line = "[$([DateTime]::Now.ToString('HH:mm:ss'))] $msg"
        Add-Content -Path $LogFile -Value $line -ErrorAction SilentlyContinue
    } catch { }
}

try { Clear-Content $LogFile -ErrorAction SilentlyContinue } catch { }
L "install started; InstallDir=$InstallDir"

if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    L "created $InstallDir"
}

# Stop any running trupx so we can overwrite the binary.
try {
    Get-Process -Name trupx -ErrorAction SilentlyContinue |
        Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
    L "stopped running trupx (if any)"
} catch { L "stop-process error: $($_.Exception.Message)" }

# If the exe is locked, move it aside.
if (Test-Path $ExePath) {
    try {
        $Stale = "$ExePath.old-$(Get-Random)"
        Rename-Item -Path $ExePath -NewName (Split-Path $Stale -Leaf) -Force -ErrorAction Stop
        L "renamed existing exe aside"
    } catch {
        L "cannot rename existing exe: $($_.Exception.Message)"
        Write-Host "install failed: existing trupx.exe is locked. Close it and retry."
        exit 1
    }
}

# Download.
$Downloaded = $false
for ($i = 1; $i -le 3; $i++) {
    try {
        Invoke-WebRequest -Uri $DownloadUrl -OutFile $ExePath -UseBasicParsing
        $Downloaded = $true
        L "downloaded binary (attempt $i)"
        break
    } catch {
        L "download attempt $i failed: $($_.Exception.Message)"
        if ($i -lt 3) { Start-Sleep -Seconds 1 }
    }
}
if (-not $Downloaded) {
    Write-Host "install failed: could not download $DownloadUrl"
    Write-Host "see $LogFile for details"
    exit 1
}

# ---- PATH: update HKCU\Environment ----
$UserPath = ''
try {
    $UserPath = Get-ItemProperty -Path 'HKCU:\Environment' -Name PATH -ErrorAction Stop |
                Select-Object -ExpandProperty PATH
    L "current user PATH length: $($UserPath.Length)"
} catch {
    L "could not read HKCU\Environment\PATH: $($_.Exception.Message)"
}
if ($UserPath -notlike "*$InstallDir*") {
    $NewPath = if ($UserPath) { "$UserPath;$InstallDir" } else { $InstallDir }
    try {
        Set-ItemProperty -Path 'HKCU:\Environment' -Name PATH -Value $NewPath -Force
        L "wrote new user PATH via Set-ItemProperty"
    } catch { L "Set-ItemProperty failed: $($_.Exception.Message)" }
    $NowPath = $NewPath
} else {
    $NowPath = $UserPath
    L "InstallDir already on PATH"
}

# Always run setx so Windows broadcasts WM_SETTINGCHANGE. Without this,
# NEW cmd/explorer-launched terminals keep the OLD PATH until logoff.
# `setx` is a native binary — it works in Constrained Language Mode and
# always triggers the broadcast.
try {
    $setxOut = & setx PATH "$NowPath" 2>&1 | Out-String
    L "setx broadcast: $($setxOut.Trim())"
} catch { L "setx exception: $($_.Exception.Message)" }

# ---- WindowsApps shim ----
$WinAppsDir = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps'
if (Test-Path $WinAppsDir) {
    $Shim = Join-Path $WinAppsDir 'trupx.cmd'
    $ShimBody = "@echo off`r`n`"$ExePath`" %*`r`n"
    try {
        Set-Content -Path $Shim -Value $ShimBody -Encoding ASCII -Force
        L "wrote shim at $Shim"
    } catch {
        L "could not write shim: $($_.Exception.Message)"
    }
} else {
    L "WindowsApps dir not present"
}

$env:PATH = "$env:PATH;$InstallDir"

# Save the server URL to the CLI's config so `trupx` with no flags just works.
try {
    $out = & $ExePath --server $Server login --token "noop" 2>&1
    L "login output: $out"
} catch { L "login exception: $($_.Exception.Message)" }

# Verify trupx is now callable.
$found = $null
try { $found = Get-Command trupx -ErrorAction SilentlyContinue } catch { }
if (-not $found -and (Test-Path $Shim -ErrorAction SilentlyContinue)) {
    # Shim exists but Get-Command may not re-scan during the same PS run.
    $found = $Shim
}
L "resolution check: $found"

# Auto-start the tunnel silently.
try {
    Start-Process -FilePath $ExePath -WindowStyle Hidden
    L "spawned tunnel daemon"
} catch { L "daemon spawn exception: $($_.Exception.Message)" }

Write-Host "trupx installed. Open a NEW terminal and type: trupx"
Write-Host "(log: $LogFile)"
