#!/usr/bin/env sh
# Mac / Linux: double-click or run ./start.sh
cd "$(dirname "$0")"
[ -d .venv ] || python3 -m venv .venv
. .venv/bin/activate
pip install -q -U -r requirements.txt
python app.py
