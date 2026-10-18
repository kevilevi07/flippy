# Trupx install for Windows (PowerShell).
#
#   iwr trupx.vercel.app/install.ps1 -useb | iex
#   # or with auto-login:
#   $env:TRUPX_TOKEN='fly_...'; iwr trupx.vercel.app/install.ps1 -useb | iex
#
# Works in Constrained Language Mode (uses `setx`, no .NET method calls).

$ErrorActionPreference = 'Stop'

$Server      = 'https://trupx.vercel.app'
$InstallDir  = Join-Path $env:USERPROFILE '.trupx\bin'
$ExePath     = Join-Path $InstallDir 'trupx.exe'
$DownloadUrl = "$Server/trupx-windows-x64.exe"

Write-Host ""
Write-Host "  Installing trupx -> $ExePath"
Write-Host ""

# Create install dir (New-Item is a cmdlet, allowed in CLM).
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
}

# Download binary.
try {
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $ExePath -UseBasicParsing
} catch {
    Write-Host ""
    Write-Host "  Download failed from $DownloadUrl"
    Write-Host "  (A prebuilt binary may not be published yet.)"
    Write-Host "  Build from source instead:"
    Write-Host "    git clone https://github.com/kevilevi07/flippy.git"
    Write-Host "    cd flippy; .\build.bat"
    Write-Host ""
    exit 1
}

# Persist to the user's PATH so every NEW terminal picks it up.
# `setx` writes to HKCU\Environment; it's the standard CLM-safe method.
$UserPath = ''
try {
    $UserPath = Get-ItemProperty -Path 'HKCU:\Environment' -Name PATH -ErrorAction Stop |
                Select-Object -ExpandProperty PATH
} catch {
    $UserPath = ''
}
if ($UserPath -notlike "*$InstallDir*") {
    $NewPath = if ($UserPath) { "$UserPath;$InstallDir" } else { $InstallDir }
    & setx PATH "$NewPath" | Out-Null
    Write-Host "  Added $InstallDir to your user PATH."
    Write-Host "  Open a NEW terminal to use ``trupx`` from anywhere."
} else {
    Write-Host "  Install dir already on PATH."
}

# Make `trupx` work in THIS session right away too.
$env:PATH = "$env:PATH;$InstallDir"

# Auto-login if a token was supplied.
if ($env:TRUPX_TOKEN) {
    Write-Host ""
    Write-Host "  Logging in..."
    & $ExePath --server $Server login --token $env:TRUPX_TOKEN
    Write-Host ""
    Write-Host "  Try:"
    Write-Host "    trupx start myapp"
} else {
    Write-Host ""
    Write-Host "  Installed. Log in with:"
    Write-Host "    trupx --server $Server login --token <YOUR_TOKEN>"
    Write-Host "  Then start a tunnel:"
    Write-Host "    trupx start myapp"
}
Write-Host ""
