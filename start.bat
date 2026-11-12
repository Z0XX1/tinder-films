@echo off
setlocal
cd /d "%~dp0"

if exist ".venv\Scripts\python.exe" goto install
where py >nul 2>nul
if errorlevel 1 goto use_python
py -3 -m venv .venv
if errorlevel 1 goto failed
goto install

:use_python
python -m venv .venv
if errorlevel 1 goto failed

:install
".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -r requirements.txt
if errorlevel 1 goto failed
".venv\Scripts\python.exe" setup_env.py
if errorlevel 1 goto failed
echo.
echo Open http://127.0.0.1:5000 in your browser.
echo Stop the server with Ctrl+C. Keep this window open during the demo.
".venv\Scripts\python.exe" app.py
if errorlevel 1 goto failed
exit /b 0

:failed
echo.
echo Startup failed. Check the message above.
echo Install Python 3.10+ from https://www.python.org/downloads/ if needed.
pause
exit /b 1
