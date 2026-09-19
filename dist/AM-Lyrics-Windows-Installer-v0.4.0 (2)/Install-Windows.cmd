@echo off
chcp 65001 >nul
set "SCRIPT=%~dp0Install-Windows.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
if errorlevel 1 (
  echo 安装失败，请查看上方错误。
  pause
  exit /b 1
)
echo 安装完成，请完全重启 DaVinci Resolve。
pause
