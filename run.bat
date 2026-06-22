@echo off
setlocal EnableDelayedExpansion

cd /d "%~dp0"

set PORT=8000
set HOST=127.0.0.1
set REBUILD=0
set OPEN=1
set REINSTALL=0
set WITH_CV=0
set VENV=.venv
set PY=%VENV%\Scripts\python.exe
set DATASET_URL="https://uc.hackerearth.com/he-public-ap-south-1/jan%%20to%%20may%%20police%%20violation_anonymized791b166.csv"

:parse_args
if "%~1"=="" goto done_args
if "%~1"=="--rebuild" (set REBUILD=1 & shift & goto parse_args)
if "%~1"=="--reinstall" (set REINSTALL=1 & shift & goto parse_args)
if "%~1"=="--with-cv" (set WITH_CV=1 & shift & goto parse_args)
if "%~1"=="--no-open" (set OPEN=0 & shift & goto parse_args)
if "%~1"=="--port" (set PORT=%~2 & shift & shift & goto parse_args)
if "%~1"=="--host" (set HOST=%~2 & shift & shift & goto parse_args)
if "%~1"=="-h" goto usage
if "%~1"=="--help" goto usage
echo Unknown argument: %~1
goto usage

:usage
echo Usage: run.bat [--rebuild] [--reinstall] [--with-cv] [--no-open] [--port N] [--host H]
exit /b 0

:done_args

:: 1) virtualenv
if not exist "%PY%" (
    echo [curbiq] creating virtualenv at .venv ...
    python -m venv "%VENV%"
    if errorlevel 1 (
        echo [curbiq] ERROR: Failed to create virtualenv. Make sure python is on PATH.
        exit /b 1
    )
)

:: 2) dependencies
set NEEDS_INSTALL=0
if "%REINSTALL%"=="1" set NEEDS_INSTALL=1

if "%NEEDS_INSTALL%"=="0" (
    "%PY%" -c "import fastapi, uvicorn, lightgbm, h3, pandas, scipy, sklearn" >nul 2>&1
    if errorlevel 1 set NEEDS_INSTALL=1
)

if "%NEEDS_INSTALL%"=="1" (
    echo [curbiq] installing dependencies ^(first run can take a few minutes^) ...
    "%PY%" -m pip install -q --no-cache-dir --upgrade pip
    "%PY%" -m pip install -q --no-cache-dir -r requirements.txt
    if errorlevel 1 (
        echo [curbiq] ERROR: pip install failed
        exit /b 1
    )
)

:: 2b) optional live-CV extras
if "%WITH_CV%"=="1" (
    echo [curbiq] installing onnxruntime + fetching SSD-MobileNet model for live CV ...
    "%PY%" -m pip install -q --no-cache-dir onnxruntime
    if exist scripts\get_cv_model.sh (
        bash scripts/get_cv_model.sh
    ) else (
        echo [curbiq] WARNING: scripts\get_cv_model.sh not found or bash not available on Windows.
    )
)

:: 3) dataset
set RAW_GZ=data\raw\police_violations.csv.gz
set RAW_CSV=data\raw\police_violations.csv

if not exist "%RAW_GZ%" (
    if not exist "%RAW_CSV%" (
        echo [curbiq] raw dataset not found - downloading ^(~105 MB^) ...
        if not exist "data\raw" mkdir "data\raw"
        curl -fSL %DATASET_URL% -o "%RAW_CSV%"
        if errorlevel 1 (
            echo [curbiq] ERROR: dataset download failed. Put the CSV at %RAW_CSV% and re-run.
            exit /b 1
        )
        echo [curbiq] dataset saved -^> %RAW_CSV%
    )
)

:: 4) build artifacts
set PYTHONPATH=%cd%
set NEEDS_BUILD=0
if "%REBUILD%"=="1" set NEEDS_BUILD=1
if not exist "data\artifacts\manifest.json" set NEEDS_BUILD=1

if "%NEEDS_BUILD%"=="1" (
    echo [curbiq] building artifacts: ETL -^> hotspots/congestion/forecast/prioritize -^> JSON + model ...
    if "%REBUILD%"=="1" (
        "%PY%" build_all.py --rebuild-etl
    ) else (
        "%PY%" build_all.py
    )
) else (
    echo [curbiq] artifacts already built ^(use --rebuild to regenerate^)
)

:: 5) serve
set URL=http://%HOST%:%PORT%
echo [curbiq] dashboard -^> %URL%   ^(Ctrl-C to stop^)

if "%OPEN%"=="1" (
    :: Start the browser and uvicorn concurrently
    start "" "%URL%"
)

"%PY%" -m uvicorn curbiq.api.main:app --host %HOST% --port %PORT%

endlocal
