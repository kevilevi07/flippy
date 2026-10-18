# Trupx install for Windows (PowerShell).
#
#   iwr trupx.vercel.app/install.ps1 -useb | iex
#   # or with auto-login:
#   $env:TRUPX_TOKEN='...'; iwr trupx.vercel.app/install.ps1 -useb | iex
#
# Works in Constrained Language Mode.

$ErrorActionPreference = 'Stop'
# Prefer TLS 1.2 for older PowerShell versions that still default to TLS 1.0.
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
        Write-Host "  Cannot replace $ExePath — it's locked by a running process."
        Write-Host "  Close any program using trupx and re-run the installer."
        Write-Host ""
        exit 1
    }
}

# Download with up to 3 retries so a transient blip doesn't bail out.
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
    Write-Host "  URL: $DownloadUrl"
    Write-Host ""
    exit 1
}

if (-not (Test-Path $ExePath)) {
    Write-Host ""
    Write-Host "  Download finished but the file wasn't written. Check your permissions."
    Write-Host ""
    exit 1
}

# Persist to the user's PATH so every NEW terminal picks it up.
$UserPath = ''
try {
    $UserPath = Get-ItemProperty -Path 'HKCU:\Environment' -Name PATH -ErrorAction Stop |
                Select-Object -ExpandProperty PATH
} catch {
    $UserPath = ''
}
if ($UserPath -notlike "*$InstallDir*") {
    $NewPath = if ($UserPath) { "$UserPath;$InstallDir" } else { $InstallDir }
    try {
        Set-ItemProperty -Path 'HKCU:\Environment' -Name PATH -Value $NewPath -Force
    } catch {
        & setx PATH "$NewPath" | Out-Null
    }
    Write-Host "  Added $InstallDir to your user PATH."
}

# Also write a tiny .cmd shim to WindowsApps — always on PATH on Windows 10+.
$WinAppsDir = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps'
if (Test-Path $WinAppsDir) {
    $Shim = Join-Path $WinAppsDir 'trupx.cmd'
    $ShimBody = "@echo off`r`n`"$ExePath`" %*`r`n"
    try {
        Set-Content -Path $Shim -Value $ShimBody -Encoding ASCII -Force
    } catch { }
}

# Make `trupx` work in THIS session right away too.
$env:PATH = "$env:PATH;$InstallDir"

if ($env:TRUPX_TOKEN) {
    Write-Host ""
    Write-Host "  Logging in..."
    & $ExePath --server $Server login --token $env:TRUPX_TOKEN
    Write-Host ""
    Write-Host "  Ready. Try:"
    Write-Host "    trupx start myapp"
} else {
    Write-Host ""
    Write-Host "  Installed. Log in with:"
    Write-Host "    trupx --server $Server login --token <YOUR_TOKEN>"
    Write-Host "  Then start a tunnel:"
    Write-Host "    trupx start myapp"
}
Write-Host ""
