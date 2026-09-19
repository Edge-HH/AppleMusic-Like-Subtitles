@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\install.ps1"
if errorlevel 1 (
  echo Installation failed. See the message above.
  pause
  exit /b 1
)
pause
