#Requires -Version 5.1
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$DestinationRoot = "$env:APPDATA\Blackmagic Design\DaVinci Resolve\Support\Fusion\Scripts",
    [string]$BackupRoot = 'D:\CodexBackup'
)
$ErrorActionPreference = 'Stop'
$source = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$scriptsRoot = [IO.Path]::GetFullPath($DestinationRoot)
$utility = [IO.Path]::GetFullPath((Join-Path $scriptsRoot 'Utility'))
# Application code is outside the scanned Scripts tree. Only the Lua launcher is a menu entry.
$appTarget = [IO.Path]::GetFullPath((Join-Path $scriptsRoot '..\AppleMusic-Style-Title-App'))
$entry = Join-Path $utility 'AppleMusic样式标题.lua'
$required = @('launcher.lua','launch.ps1','script-host.py','main.js','preload.js','manifest.xml','package.json','package-lock.json','README.md','THIRD_PARTY_NOTICES.md','lib','ui','adapters','node_modules','docs')
foreach ($name in $required) {
    if (-not (Test-Path -LiteralPath (Join-Path $source $name))) { throw "插件源文件不完整：$name；尚未修改旧安装。" }
}
$oldTargets = @(
    $entry, (Join-Path $utility 'AppleMusic样式标题.py'), (Join-Path $utility 'AppleMusic-Style-Title-App'), $appTarget
) | ForEach-Object { [IO.Path]::GetFullPath($_) }
$defaultRoot = [IO.Path]::GetFullPath("$env:APPDATA\Blackmagic Design\DaVinci Resolve\Support\Fusion\Scripts")
if ($scriptsRoot -eq $defaultRoot) {
    $oldTargets += @(
        (Join-Path $env:PROGRAMDATA 'Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins\com.edgehh.amll.lyrics'),
        (Join-Path $env:APPDATA 'Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins\com.edgehh.amll.lyrics')
    ) | ForEach-Object { [IO.Path]::GetFullPath($_) }
}
function Backup-And-Remove([string]$Path) {
    $full = [IO.Path]::GetFullPath($Path)
    # Deletion is restricted to the explicit leaf targets, never the user's Scripts folder.
    if ($full -notin $oldTargets -or $full -eq $scriptsRoot -or $full -eq $utility -or $full -eq [IO.Path]::GetPathRoot($full)) { throw "拒绝删除非安装目标：$full" }
    if (-not (Test-Path -LiteralPath $full)) { return }
    $backup = Join-Path $BackupRoot ('amll-install-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    Copy-Item -LiteralPath $full -Destination (Join-Path $backup (Split-Path -Leaf $full)) -Recurse -Force
    if (-not (Test-Path -LiteralPath (Join-Path $backup (Split-Path -Leaf $full)))) { throw '备份失败，拒绝删除。' }
    Remove-Item -LiteralPath $full -Recurse -Force
    Write-Host "旧安装备份：$backup"
}
if (-not $PSCmdlet.ShouldProcess($scriptsRoot, '备份旧安装并安装 AMLL Lua 菜单入口和应用')) { return }
foreach ($path in $oldTargets) { Backup-And-Remove $path }
New-Item -ItemType Directory -Path $utility,$appTarget -Force | Out-Null
foreach ($name in $required | Where-Object { $_ -ne 'launcher.lua' }) {
    Copy-Item -LiteralPath (Join-Path $source $name) -Destination $appTarget -Recurse -Force
}
Copy-Item -LiteralPath (Join-Path $source 'launcher.lua') -Destination $entry -Force
$utf8 = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $utility 'amll-app.path'), $appTarget, $utf8)
# Retain a known Resolve runtime path; the host also supports standard and alternate install drives.
$hint = Join-Path $utility 'resolve-electron.path'
if (Test-Path -LiteralPath $hint) { Copy-Item -LiteralPath $hint -Destination $appTarget -Force }
try {
    $runtimeInfo = @(& (Join-Path $appTarget 'launch.ps1') -CheckOnly)
    if ($runtimeInfo.Count -ge 2) { [IO.File]::WriteAllText((Join-Path $appTarget 'python.path'), [string]$runtimeInfo[0], $utf8) }
} catch { Write-Warning '菜单入口已安装，但未找到可用的 64 位 Python；启动时会显示诊断信息。' }
Write-Host "菜单入口已安装：$entry"
Write-Host "备用打开方式：powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$appTarget\launch.ps1`""
Write-Host '完全退出并重开 Resolve 后，在 工作区 → 脚本 → Utility → AppleMusic样式标题 打开。'
Write-Host '需要 64 位 Python 3.8+；外部 Resolve API 若被版本或偏好设置限制，会显示原因，不再静默退出。'
