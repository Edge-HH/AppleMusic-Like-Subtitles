#Requires -Version 5.1
[CmdletBinding()]
param(
    [ValidateSet('auto','zh','en')][string]$Language = 'auto',
    [string]$TitleDestination,
    [string]$ScriptDestinationRoot = "$env:APPDATA\Blackmagic Design\DaVinci Resolve\Support\Fusion\Scripts",
    [string]$BackupRoot = 'D:\CodexBackup'
)
$ErrorActionPreference = 'Stop'
foreach ($name in @('dist\zh\AM Lyrics.setting','dist\en\AM Lyrics.setting','workflow-plugin\scripts\install.ps1')) {
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $name) -PathType Leaf)) { throw "安装包不完整：$name；尚未修改已有安装。" }
}
# One implementation is shared by the full installer and the standalone plugin package.
& (Join-Path $PSScriptRoot 'workflow-plugin\scripts\install.ps1') -DestinationRoot $ScriptDestinationRoot -BackupRoot $BackupRoot
& (Join-Path $PSScriptRoot 'tools\install.ps1') -Language $Language -Destination $TitleDestination -BackupRoot $BackupRoot
Write-Host '安装完成，请完全重启 DaVinci Resolve；旧时间线中的标题不会自动替换，请重新拖入 AM Lyrics。'
