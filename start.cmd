@echo off
cd /d "%~dp0"
if not exist "data\tmp" mkdir "data\tmp"
set "TEMP=%~dp0data\tmp"
set "TMP=%~dp0data\tmp"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22 or newer, then run this file again.
  pause
  exit /b 1
)
node server.mjs
pause
