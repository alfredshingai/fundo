@echo off
rem Fundo launcher - starts the server (if not already running) and opens the app
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-server.ps1"
start "" http://localhost:3000
timeout /t 2 >nul
