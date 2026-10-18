# Trupx install for Windows (PowerShell).
#
#   iwr trupx.vercel.app/install.ps1 -useb | iex
#   # or with auto-login:
#   $env:TRUPX_TOKEN='fly_...'; iwr trupx.vercel.app/install.ps1 -useb | iex

$ErrorActionPreference = 'Stop'

$Server      = 'https://trupx.vercel.app'
$InstallDir  = Join-Path $env:USERPROFILE '.trupx\bin'
$ExePath     = Join-Path $InstallDir 'trupx.exe'
$DownloadUrl = "$Server/trupx-windows-x64.exe"

Write-Host ""
Write-Host "  Installing trupx -> $ExePath"
Write-Host ""

New-Item -ItemType Directory -Force $InstallDir | Out-Null

try {
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $ExePath -UseBasicParsing
} catch {
    Write-Host ""
    Write-Host "  Download failed from $DownloadUrl"
    Write-Host "  (This usually means a prebuilt binary isn't published yet.)"
    Write-Host "  Build from source instead:"
    Write-Host "    git clone https://github.com/kevilevi07/trupx.git"
    Write-Host "    cd trupx; .\build.bat"
    Write-Host ""
    exit 1
}

# Add to the current user's PATH if not already there.
$UserPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
if ($UserPath -notlike "*$InstallDir*") {
    [Environment]::SetEnvironmentVariable('PATH', "$UserPath;$InstallDir", 'User')
    Write-Host "  Added $InstallDir to user PATH (open a new terminal to use ``trupx``)."
}

$env:PATH = "$env:PATH;$InstallDir"

if ($env:TRUPX_TOKEN) {
    & $ExePath --server $Server login --token $env:TRUPX_TOKEN
    Write-Host ""
    Write-Host "  Logged in. Try:"
    Write-Host "    trupx start myapp"
} else {
    Write-Host ""
    Write-Host "  Installed. Log in with:"
    Write-Host "    trupx --server $Server login --token <YOUR_TOKEN>"
    Write-Host "  Then start a tunnel:"
    Write-Host "    trupx start myapp"
}
Write-Host ""
