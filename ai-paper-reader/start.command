#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

VENV_DIR=".venv"

if [ ! -x "$VENV_DIR/bin/python" ]; then
    echo "Setting up AI Paper Reader..."

    if command -v python3.11 >/dev/null 2>&1; then
        PYTHON_CMD="python3.11"
    elif command -v python3 >/dev/null 2>&1; then
        PYTHON_CMD="python3"
    elif command -v python >/dev/null 2>&1; then
        PYTHON_CMD="python"
    else
        echo "Python 3 is required. Install Python 3.11 or newer, then run this again."
        read -r -p "Press Return to close..."
        exit 1
    fi

    "$PYTHON_CMD" -m venv "$VENV_DIR"
    "$VENV_DIR/bin/python" -m pip install --upgrade pip
    "$VENV_DIR/bin/python" -m pip install -r requirements.txt
fi

echo "Starting AI Paper Reader..."
echo "Your default browser should open automatically."
"$VENV_DIR/bin/python" app.py
