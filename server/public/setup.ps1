# Trupx setup for Windows (PowerShell).
# Same as install.ps1, PLUS registers a Task Scheduler job so trupx
# auto-starts every time you log in / reboot.
#
#   iwr trupx.vercel.app/setup.ps1 -useb | iex

$ErrorActionPreference = 'Continue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$Server      = 'https://trupx.vercel.app'
$InstallDir  = Join-Path $env:USERPROFILE '.trupx\bin'
$ExePath     = Join-Path $InstallDir 'trupx.exe'
$DownloadUrl = "$Server/trupx-windows-x64.exe"
$LogFile     = Join-Path $env:TEMP 'trupx-install.log'
$TaskName    = 'trupx-tunnel'

function L($msg) {
    try {
        Add-Content -Path $LogFile -Value ("[$([DateTime]::Now.ToString('HH:mm:ss'))] $msg") -ErrorAction SilentlyContinue
    } catch { }
}

try { Clear-Content $LogFile -ErrorAction SilentlyContinue } catch { }
L "setup started; InstallDir=$InstallDir"

# ---- Install (same as install.ps1) ----

if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
}

try {
    Get-Process -Name trupx -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
} catch { }

try { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue } catch { }

if (Test-Path $ExePath) {
    try {
        Rename-Item -Path $ExePath -NewName "trupx.exe.old-$(Get-Random)" -Force -ErrorAction Stop
    } catch {
        Write-Host "setup failed: existing trupx.exe is locked. Reboot and retry."
        exit 1
    }
}

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
if (-not $Downloaded) { Write-Host "setup failed: download. See $LogFile"; exit 1 }

# ---- PATH ----
$UserPath = ''
try { $UserPath = (Get-ItemProperty 'HKCU:\Environment' -Name PATH -ErrorAction Stop).PATH } catch { }
if ($UserPath -notlike "*$InstallDir*") {
    $NewPath = if ($UserPath) { "$UserPath;$InstallDir" } else { $InstallDir }
    try { Set-ItemProperty -Path 'HKCU:\Environment' -Name PATH -Value $NewPath -Force } catch { }
    L "appended InstallDir to user PATH"
}

# ---- cmd AutoRun fallback ----
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
    }
} catch { L "cmd AutoRun failed: $($_.Exception.Message)" }

# ---- WindowsApps exe copy ----
$WinAppsDir = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps'
if (Test-Path $WinAppsDir) {
    $WinAppsExe = Join-Path $WinAppsDir 'trupx.exe'
    if (Test-Path $WinAppsExe) {
        try { Rename-Item -Path $WinAppsExe -NewName "trupx.exe.old-$(Get-Random)" -Force -ErrorAction SilentlyContinue } catch { }
    }
    try { Copy-Item -Path $ExePath -Destination $WinAppsExe -Force -ErrorAction Stop; L "copied exe to WindowsApps" }
    catch { L "WindowsApps copy failed: $($_.Exception.Message)" }
}

# ---- PowerShell $PROFILE alias ----
try {
    $ProfileDir = Split-Path $PROFILE -Parent
    if (-not (Test-Path $ProfileDir)) { New-Item -ItemType Directory -Force $ProfileDir | Out-Null }
    if (-not (Test-Path $PROFILE)) { Set-Content -Path $PROFILE -Value "" -Force }
    $currentProfile = Get-Content $PROFILE -Raw -ErrorAction SilentlyContinue
    if ($currentProfile -notlike "*# trupx-alias*") {
        $aliasLine = "`n# trupx-alias`nif (Test-Path '$ExePath') { Set-Alias -Scope Global -Name trupx -Value '$ExePath' -ErrorAction SilentlyContinue }`n"
        Add-Content -Path $PROFILE -Value $aliasLine
        L "appended Set-Alias to PS profile"
    }
} catch { L "profile alias failed: $($_.Exception.Message)" }

$env:PATH = "$env:PATH;$InstallDir"
try { Set-Alias -Scope Global -Name trupx -Value $ExePath -ErrorAction SilentlyContinue } catch { }
try { & $ExePath --server $Server login --token "noop" 2>&1 | Out-Null } catch { }

# ---- Register Scheduled Task (the setup.ps1 bit) ----
# Runs trupx at every logon under the current user, hidden window, no admin.
try {
    $action = New-ScheduledTaskAction -Execute $ExePath

    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

    $settings = New-ScheduledTaskSettingsSet `
        -StartWhenAvailable `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -Hidden `
        -ExecutionTimeLimit (New-TimeSpan -Days 0) `
        -RestartCount 3 `
        -RestartInterval (New-TimeSpan -Minutes 1)

    $principal = New-ScheduledTaskPrincipal `
        -UserId "$env:USERDOMAIN\$env:USERNAME" `
        -LogonType Interactive `
        -RunLevel Limited

    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Principal $principal `
        -Description 'Start trupx tunnel at login' `
        -Force | Out-Null

    L "registered scheduled task '$TaskName'"
    # Also run it right now so the user doesn't have to log out and back in.
    try { Start-ScheduledTask -TaskName $TaskName } catch { L "Start-ScheduledTask failed: $($_.Exception.Message)" }
} catch {
    L "scheduled task registration failed: $($_.Exception.Message)"
    # Fallback: start it directly so this install isn't useless.
    try { Start-Process -FilePath $ExePath -WindowStyle Hidden } catch { }
}

# ---- Done ----
# NOTE: do NOT kill the host terminal here. Force-stopping $PID makes PowerShell
# exit with code 0xffffffff, which looks like the install crashed.
Write-Host ""
Write-Host "trupx installed + auto-start registered (Task Scheduler: $TaskName)." -ForegroundColor Green
Write-Host "Location : $ExePath"
Write-Host "A tunnel is starting now and will also start at every login."
Write-Host "Dashboard: $Server/dashboard"
Write-Host "Open a NEW terminal, then: trupx status | trupx stop | trupx uninstall"
Write-Host ""
exit 0
