@echo off
cd /d "%~dp0"
set "PAGE=%~dp0index.html"
echo Mo So chi tieu (thuần HTML/JS, khong can Node.js)
start "" "%PAGE%"