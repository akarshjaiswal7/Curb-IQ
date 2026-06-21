@echo off
setlocal
title CurbIQ Dashboard Launcher
cd /d "%~dp0"

echo.
echo  ====================================================
echo    CurbIQ - Illegal Parking Intelligence Dashboard
echo  ====================================================
echo.

:: ── defaults ────────────────────────────────────────────────────────────────
set PORT=8000
set HOST=127.0.0.1
set REBUILD=0
set OPEN=1
set REINSTALL=0
set VENV=.venv
set PY=%VENV%\Scripts\python.exe

:: ── argument parsing ─────────────────────────────────────────────────────────
:parse
if "%~1"==""            goto step_venv
if "%~1"=="--rebuild"   ( set REBUILD=1   & shift & goto parse )
if "%~1"=="--reinstall" ( set REINSTALL=1 & shift & goto parse )
if "%~1"=="--no-open"   ( set OPEN=0      & shift & goto parse )
if "%~1"=="--port"      ( set PORT=%~2    & shift & shift & goto parse )
if "%~1"=="--host"      ( set HOST=%~2    & shift & shift & goto parse )
if "%~1"=="-h"     goto usage
if "%~1"=="--help" goto usage
echo [curbiq] Unknown argument: %~1
:usage
echo.
echo  Usage: run.bat [--rebuild] [--reinstall] [--no-open] [--port N] [--host H]
echo.
pause
exit /b 0

:: ────────────────────────────────────────────────────────────────────────────
:: STEP 1 - Python virtual environment
:: ────────────────────────────────────────────────────────────────────────────
:step_venv
echo [1/4] Checking Python environment...

if exist "%PY%" (
    echo       Found: %PY%
    goto step_deps
)

echo       .venv not found - creating virtual environment...
where python >nul 2>nul
if errorlevel 1 (
    echo.
    echo  ERROR: Python was not found on PATH.
    echo  Please install Python 3.10+ from https://python.org
    echo  Make sure to check "Add Python to PATH" during install.
    echo.
    pause
    exit /b 1
)

python -m venv "%VENV%"
if errorlevel 1 (
    echo.
    echo  ERROR: Failed to create virtual environment.
    echo.
    pause
    exit /b 1
)
echo       Virtual environment created.

:: ────────────────────────────────────────────────────────────────────────────
:: STEP 2 - Dependencies
:: ────────────────────────────────────────────────────────────────────────────
:step_deps
echo.
echo [2/4] Checking dependencies...

if "%REINSTALL%"=="1" goto do_install

"%PY%" -c "import fastapi, uvicorn, lightgbm, h3, pandas, scipy, sklearn" >nul 2>nul
if not errorlevel 1 (
    echo       All dependencies found. Skipping install.
    goto step_dataset
)

:do_install
echo       Installing packages (first run may take several minutes)...
echo.
echo       Step 2a - Upgrading pip...
"%PY%" -m pip install --upgrade pip
if errorlevel 1 ( echo  ERROR: pip upgrade failed. & pause & exit /b 1 )

echo.
echo       Step 2b - Installing project packages...
"%PY%" -m pip install --no-cache-dir --progress-bar on -r requirements.txt
if errorlevel 1 (
    echo.
    echo  ERROR: pip install failed. Check errors above.
    pause
    exit /b 1
)
echo.
echo       All dependencies installed successfully!

:: ────────────────────────────────────────────────────────────────────────────
:: STEP 3 - Raw dataset (download if missing)
:: ────────────────────────────────────────────────────────────────────────────
:step_dataset
echo.
echo [3/4] Checking data...

if exist "data\raw\police_violations.csv.gz" goto step_artifacts
if exist "data\raw\police_violations.csv"    goto step_artifacts

echo       Raw dataset not found - downloading (~105 MB)...
if not exist "data\raw" mkdir "data\raw"
set DATASET_URL=https://uc.hackerearth.com/he-public-ap-south-1/jan%%20to%%20may%%20police%%20violation_anonymized791b166.csv
curl -fSL "%DATASET_URL%" -o "data\raw\police_violations.csv"
if errorlevel 1 (
    echo.
    echo  ERROR: Download failed.
    echo  Manually place the CSV at: data\raw\police_violations.csv
    pause
    exit /b 1
)
echo       Compressing dataset...
"%PY%" -c "import gzip,shutil; shutil.copyfileobj(open('data/raw/police_violations.csv','rb'),gzip.open('data/raw/police_violations.csv.gz','wb'))"
if not errorlevel 1 del "data\raw\police_violations.csv"
echo       Dataset ready.

:: ────────────────────────────────────────────────────────────────────────────
:: STEP 4 - Analytics artifacts
:: ────────────────────────────────────────────────────────────────────────────
:step_artifacts
set PYTHONPATH=%~dp0

if "%REBUILD%"=="1" (
    echo       Rebuilding analytics artifacts (--rebuild flag set)...
    "%PY%" build_all.py --rebuild-etl
    if errorlevel 1 ( echo  ERROR: build_all.py failed. & pause & exit /b 1 )
    goto step_serve
)

if not exist "data\artifacts\manifest.json" (
    echo       Building analytics artifacts - first run only...
    "%PY%" build_all.py
    if errorlevel 1 ( echo  ERROR: build_all.py failed. & pause & exit /b 1 )
    echo       Artifacts built.
) else (
    echo       Artifacts OK. Use --rebuild flag to regenerate.
)

:: ────────────────────────────────────────────────────────────────────────────
:: STEP 5 - Launch server + open browser
:: ────────────────────────────────────────────────────────────────────────────
:step_serve
echo.
echo  ====================================================
echo    Dashboard: http://%HOST%:%PORT%
echo    Opening in your browser in 3 seconds...
echo    Press Ctrl+C to stop the server.
echo  ====================================================
echo.

if "%OPEN%"=="0" goto start_server

:: Use Python's webbrowser module — uses the OS default browser handler,
:: works with Opera GX, Chrome, Edge, Firefox, or anything set as default.
start "" "%PY%" -c "import time,webbrowser; time.sleep(3); webbrowser.open('http://%HOST%:%PORT%')"

:start_server
"%PY%" -m uvicorn curbiq.api.main:app --host %HOST% --port %PORT%

echo.
echo  Server has stopped.
pause
