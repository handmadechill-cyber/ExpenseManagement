@echo off
cd /d "%~dp0"
echo Starting Expense Management server...
start "Expense Management Server" /min node server.js
timeout /t 2 /nobreak >nul
start "" "http://localhost:3000"