@echo off
setlocal
cd /d "%~dp0"

echo [trupx] stopping any running instance...
taskkill /F /IM trupx.exe >nul 2>&1
if exist "%TEMP%\trupx.pid" del /Q "%TEMP%\trupx.pid" >nul 2>&1

echo [trupx] checking for cargo...
where cargo >nul 2>&1
if errorlevel 1 (
    if exist "%USERPROFILE%\.cargo\bin\cargo.exe" (
        set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
    ) else (
        echo.
        echo ERROR: cargo not found. Install Rust from https://rustup.rs/
        echo then open a new terminal and run build.bat again.
        echo.
        exit /b 1
    )
)

echo [trupx] building release...
pushd terminal
cargo build --release
if errorlevel 1 (
    popd
    echo.
    echo BUILD FAILED.
    exit /b 1
)
popd

if not exist dist mkdir dist
copy /Y terminal\target\release\trupx.exe dist\trupx.exe >nul

echo.
echo [trupx] build complete.
for %%A in (dist\trupx.exe) do echo        output: %%~fA  (%%~zA bytes^)
echo.
echo Run:
echo     dist\trupx.exe
echo     dist\trupx.exe --tunnel
echo.

endlocal
