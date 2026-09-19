@echo off
chcp 65001 >nul
set "SCRIPT=%~dp0Install-Windows.ps1"
set "TITLE_DEST=%APPDATA%\Blackmagic Design\DaVinci Resolve\Support\Fusion\Templates\Edit\Titles\AM Lyrics"
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo 正在请求管理员权限以安装 DaVinci Resolve Workflow 插件...
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File ""%SCRIPT%"" -TitleDestination ""%TITLE_DEST%""'"
  exit /b
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" -TitleDestination "%TITLE_DEST%"
if errorlevel 1 (
  echo 安装失败，请查看上方错误。
  pause
  exit /b 1
)
echo 安装完成，请重启 DaVinci Resolve Studio。
pause
