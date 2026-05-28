@echo off
setlocal

cd /d "%~dp0"
set "VENV_DIR=.venv"

if exist "%VENV_DIR%\Scripts\python.exe" goto run_app

echo Setting up AI Paper Reader...

where py >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    py -3.11 -m venv "%VENV_DIR%"
    if ERRORLEVEL 1 py -3 -m venv "%VENV_DIR%"
) else (
    python -m venv "%VENV_DIR%"
)

if not exist "%VENV_DIR%\Scripts\python.exe" (
    echo.
    echo Could not create the Python virtual environment.
    echo Install Python 3.11 or newer, then run this file again.
    pause
    exit /b 1
)

"%VENV_DIR%\Scripts\python.exe" -m pip install --upgrade pip
"%VENV_DIR%\Scripts\python.exe" -m pip install -r requirements.txt

:run_app
echo Starting AI Paper Reader...
echo Your default browser should open automatically.
"%VENV_DIR%\Scripts\python.exe" app.py
pause
