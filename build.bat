@echo off
setlocal
cd /d "%~dp0"

echo [flippy] stopping any running instance...
taskkill /F /IM flippy.exe >nul 2>&1
if exist "%TEMP%\flippy.pid" del /Q "%TEMP%\flippy.pid" >nul 2>&1

echo [flippy] checking for cargo...
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

echo [flippy] building release...
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
copy /Y terminal\target\release\flippy.exe dist\flippy.exe >nul

echo.
echo [flippy] build complete.
for %%A in (dist\flippy.exe) do echo        output: %%~fA  (%%~zA bytes^)
echo.
echo Run:
echo     dist\flippy.exe
echo     dist\flippy.exe --tunnel
echo.

endlocal
