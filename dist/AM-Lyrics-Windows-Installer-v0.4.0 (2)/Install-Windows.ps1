#Requires -Version 5.1
[CmdletBinding()]
param(
    [ValidateSet('auto','zh','en')][string]$Language = 'auto',
    [string]$TitleDestination,
    [string]$ScriptDestinationRoot = "$env:APPDATA\Blackmagic Design\DaVinci Resolve\Support\Fusion\Scripts",
    [string]$BackupRoot = 'D:\CodexBackup'
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($PSScriptRoot)

& (Join-Path $root 'tools\install.ps1') -Language $Language -Destination $TitleDestination -BackupRoot $BackupRoot

$utility = [IO.Path]::GetFullPath((Join-Path $ScriptDestinationRoot 'Utility'))
$scriptTarget = Join-Path $utility 'AMLL 歌词助手.py'
$appTarget = Join-Path $utility 'AMLL-Lyrics-App'
$source = Join-Path $root 'workflow-plugin'
$oldWorkflowTargets = @(
    (Join-Path $env:PROGRAMDATA 'Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins\com.edgehh.amll.lyrics'),
    (Join-Path $env:APPDATA 'Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins\com.edgehh.amll.lyrics')
)
$oldTargets = @($oldWorkflowTargets + $scriptTarget + $appTarget) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

function Backup-And-Remove([string]$path) {
    $full = [IO.Path]::GetFullPath($path)
    $backup = Join-Path $BackupRoot ('amll-old-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8))
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    $name = Split-Path -Leaf $full
    Copy-Item -LiteralPath $full -Destination (Join-Path $backup $name) -Recurse -Force
    Remove-Item -LiteralPath $full -Recurse -Force
    Write-Host "旧安装已备份并删除：$full"
}

foreach ($path in $oldTargets) { Backup-And-Remove $path }
New-Item -ItemType Directory -Path $utility -Force | Out-Null
New-Item -ItemType Directory -Path $appTarget -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $source 'script-host.py') -Destination $scriptTarget -Force
foreach ($name in @('main.js','preload.js','manifest.xml','package.json','package-lock.json','README.md','THIRD_PARTY_NOTICES.md','lib','ui','adapters','node_modules','docs')) {
    Copy-Item -LiteralPath (Join-Path $source $name) -Destination $appTarget -Recurse -Force
}

$electronCandidates = @(
    "$env:PROGRAMFILES\Blackmagic Design\DaVinci Resolve\Electron\electron.exe",
    "$env:PROGRAMFILES\Blackmagic Design\DaVinci Resolve Studio\Electron\electron.exe",
    "$env:ProgramFiles(x86)\Blackmagic Design\DaVinci Resolve\Electron\electron.exe",
    "$env:ProgramFiles(x86)\Blackmagic Design\DaVinci Resolve Studio\Electron\electron.exe",
    'C:\Davinci Resolve\Electron\electron.exe', 'D:\Davinci Resolve\Electron\electron.exe', 'E:\Davinci Resolve\Electron\electron.exe',
    'C:\DaVinci Resolve\Electron\electron.exe', 'D:\DaVinci Resolve\Electron\electron.exe', 'E:\DaVinci Resolve\Electron\electron.exe'
) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) }
if ($electronCandidates.Count -gt 0) {
    $electronCandidates[0] | Set-Content -LiteralPath (Join-Path $utility 'resolve-electron.path') -Encoding UTF8
}
Write-Host "AMLL 歌词助手已安装到：$scriptTarget"
Write-Host '请完全重启 DaVinci Resolve，然后从 工作区 → 脚本 → Utility → AMLL 歌词助手 打开。'
