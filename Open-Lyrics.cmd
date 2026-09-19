@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0workflow-plugin\launch.ps1"
if errorlevel 1 pause
endlocal
