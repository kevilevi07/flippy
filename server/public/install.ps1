# Trupx install for Windows (PowerShell).
#
#   iwr trupx.vercel.app/install.ps1 -useb | iex
#
# Works in Constrained Language Mode.

$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$Server      = 'https://trupx.vercel.app'
$InstallDir  = Join-Path $env:USERPROFILE '.trupx\bin'
$ExePath     = Join-Path $InstallDir 'trupx.exe'
$DownloadUrl = "$Server/trupx-windows-x64.exe"

Write-Host ""
Write-Host "  Installing trupx -> $ExePath"
Write-Host ""

if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
}

# Stop any running trupx so we can overwrite the binary.
try {
    Get-Process -Name trupx -ErrorAction SilentlyContinue |
        Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
} catch { }

# If the exe is still locked, rename it aside so the download can proceed.
if (Test-Path $ExePath) {
    try {
        $Stale = "$ExePath.old-$(Get-Random)"
        Rename-Item -Path $ExePath -NewName (Split-Path $Stale -Leaf) -Force -ErrorAction Stop
    } catch {
        Write-Host ""
        Write-Host "  Cannot replace $ExePath — it's locked by another program."
        Write-Host "  Close any program using trupx and re-run."
        Write-Host ""
        exit 1
    }
}

# Download with up to 3 retries.
$Downloaded = $false
$LastErr    = $null
for ($i = 1; $i -le 3; $i++) {
    try {
        Invoke-WebRequest -Uri $DownloadUrl -OutFile $ExePath -UseBasicParsing
        $Downloaded = $true
        break
    } catch {
        $LastErr = $_.Exception.Message
        if ($i -lt 3) {
            Write-Host "  Attempt $i failed, retrying..."
            Start-Sleep -Seconds 1
        }
    }
}

if (-not $Downloaded) {
    Write-Host ""
    Write-Host "  Download failed: $LastErr"
    Write-Host ""
    exit 1
}

# Persist to the user's PATH so every NEW terminal picks it up.
$UserPath = ''
try {
    $UserPath = Get-ItemProperty -Path 'HKCU:\Environment' -Name PATH -ErrorAction Stop |
                Select-Object -ExpandProperty PATH
} catch { }
if ($UserPath -notlike "*$InstallDir*") {
    $NewPath = if ($UserPath) { "$UserPath;$InstallDir" } else { $InstallDir }
    try {
        Set-ItemProperty -Path 'HKCU:\Environment' -Name PATH -Value $NewPath -Force
    } catch {
        & setx PATH "$NewPath" | Out-Null
    }
}

# Also write a tiny .cmd shim to WindowsApps — always on PATH on Windows 10+.
$WinAppsDir = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps'
if (Test-Path $WinAppsDir) {
    $Shim = Join-Path $WinAppsDir 'trupx.cmd'
    $ShimBody = "@echo off`r`n`"$ExePath`" %*`r`n"
    try { Set-Content -Path $Shim -Value $ShimBody -Encoding ASCII -Force } catch { }
}

$env:PATH = "$env:PATH;$InstallDir"

# Save the server URL to the CLI's config so `trupx start` works with no flags.
try {
    & $ExePath --server $Server login --token "noop" 2>&1 | Out-Null
} catch { }

Write-Host ""
Write-Host "  Installed. Starting a tunnel..."
Write-Host ""

# Auto-start a tunnel. No subcommand → the daemon picks the system hostname.
# If that name is taken, server adds a random suffix.
Start-Process -FilePath $ExePath -WindowStyle Hidden

Start-Sleep -Seconds 2

# Peek at the daemon log to find the assigned public URL and print it.
$LogFile = Join-Path $env:TEMP 'trupx.log'
if (Test-Path $LogFile) {
    $tail = Get-Content $LogFile -Tail 20
    $readyLine = $tail | Where-Object { $_ -match 'tunnel READY: (\S+)' } | Select-Object -Last 1
    if ($readyLine -and ($readyLine -match 'tunnel READY: (\S+)')) {
        $publicUrl = $matches[1]
        Write-Host "  Public URL: $publicUrl"
        Write-Host ""
    } else {
        Write-Host "  Tunnel starting... open $Server for the admin dashboard to see the URL."
        Write-Host ""
    }
} else {
    Write-Host "  Tunnel starting... open $Server for the admin dashboard to see the URL."
    Write-Host ""
}

Write-Host "  Commands:"
Write-Host "    trupx            -> start a tunnel using the system hostname"
Write-Host "    trupx <name>     -> start a tunnel with that name"
Write-Host "    trupx status     -> show daemon + tunnel"
Write-Host "    trupx stop       -> stop the tunnel"
Write-Host ""
