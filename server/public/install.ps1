#Requires -Version 5.1
# flippy Windows installer — downloads a prebuilt binary from GitHub Releases.
# Usage:  irm https://flippy.vercel.app/install.ps1 | iex

$ErrorActionPreference = 'Stop'
$BaseUrl = 'https://flippy.vercel.app'
$Asset = 'flippy-windows-x64.exe'
$InstallDir = Join-Path $env:USERPROFILE '.flippy\bin'
$ExePath = Join-Path $InstallDir 'flippy.exe'

Write-Host "flippy installer" -ForegroundColor Cyan
Write-Host "  install dir : $InstallDir"
Write-Host "  download    : $BaseUrl/bin/$Asset"

if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
}

Write-Host "`nDownloading..."
try {
    Invoke-WebRequest -Uri "$BaseUrl/bin/$Asset" -OutFile $ExePath -UseBasicParsing
} catch {
    Write-Error "Download failed: $_"
    return
}
$size = (Get-Item $ExePath).Length
Write-Host ("  saved {0}  ({1:N0} bytes)" -f $ExePath, $size)

# Add to user PATH (CLM-safe).
$regPath = 'HKCU:\Environment'
$existing = ''
try {
    $existing = (Get-ItemProperty -LiteralPath $regPath -Name Path -ErrorAction Stop).Path
} catch { $existing = '' }
if (-not $existing) { $existing = '' }

$parts = @()
foreach ($p in ($existing -split ';')) {
    if ($p -and ($p.Trim() -ne '')) { $parts += $p }
}
$needAdd = $true
foreach ($p in $parts) {
    if ($p.TrimEnd('\') -ieq $InstallDir.TrimEnd('\')) { $needAdd = $false; break }
}
if ($needAdd) {
    $parts += $InstallDir
    $new = ($parts -join ';')
    & reg add 'HKCU\Environment' /v Path /t REG_EXPAND_SZ /d $new /f | Out-Null
    Write-Host "`nAdded to user PATH:" -ForegroundColor Green
    Write-Host "  $InstallDir"
} else {
    Write-Host "`nPATH already contains $InstallDir"
}
if ($env:Path -notlike "*$InstallDir*") { $env:Path = "$env:Path;$InstallDir" }

try { & $ExePath --version | Out-Null } catch { }

Write-Host "`nInstalled." -ForegroundColor Green

Write-Host ""
# Allow pre-seeding the token via $env:FLIPPY_TOKEN for a one-liner install.
$tok = ''
if ($env:FLIPPY_TOKEN) {
    $tok = $env:FLIPPY_TOKEN.Trim()
    Write-Host "Using token from `$env:FLIPPY_TOKEN."
} else {
    Write-Host "Get your token at $BaseUrl/dashboard  (sign up if you don't have one)."
    $tok = Read-Host "Paste your flippy token (or press Enter to skip)"
    $tok = $tok.Trim()
}
if ($tok) {
    try { & $ExePath --server $BaseUrl login --token $tok } catch { Write-Warning "login failed: $_" }
} else {
    Write-Host "Skipped. Log in later with:  flippy --server $BaseUrl login"
}

Write-Host ""
Write-Host "Open a NEW terminal, then run:"
Write-Host "  flippy http <port> --name <app-name>"
