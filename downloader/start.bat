@echo off
rem Windows: double-click this file
cd /d "%~dp0"
if not exist .venv python -m venv .venv
call .venv\Scripts\activate.bat
pip install -q -U -r requirements.txt
python app.py
pause
