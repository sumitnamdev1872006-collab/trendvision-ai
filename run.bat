@echo off
setlocal

cd /d "%~dp0"

where py >nul 2>&1
if errorlevel 1 (
    echo Python Launcher was not found. Install Python 3.10 or newer, then try again.
    pause
    exit /b 1
)

if exist "C:\Program Files\nodejs\node.exe" set "PATH=C:\Program Files\nodejs;%PATH%"
where npm >nul 2>&1
if errorlevel 1 (
    echo npm was not found. Install Node.js 18 or newer, then try again.
    pause
    exit /b 1
)

if not exist "frontend\node_modules" (
    echo Installing frontend dependencies for the first run...
    call npm --prefix frontend install
    if errorlevel 1 (
        echo Frontend dependency installation failed.
        pause
        exit /b 1
    )
)

powershell -NoProfile -Command "if (Get-NetTCPConnection -State Listen -LocalPort 5000 -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if errorlevel 1 (
    start "TrendVision API" /D "%~dp0backend" cmd /k "py app.py"
) else (
    echo TrendVision API is already running.
)

powershell -NoProfile -Command "if (Get-NetTCPConnection -State Listen -LocalPort 5173 -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if errorlevel 1 (
    start "TrendVision Dashboard" /D "%~dp0frontend" cmd /k "npm run dev -- --host 127.0.0.1"
) else (
    echo TrendVision Dashboard is already running.
)

echo Starting TrendVision. The dashboard will open in your browser shortly.
powershell -NoProfile -Command "Start-Sleep -Seconds 5"
start "" "http://127.0.0.1:5173"
