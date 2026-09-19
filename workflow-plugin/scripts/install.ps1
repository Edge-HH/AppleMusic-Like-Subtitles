#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$ResolveDeveloperRoot = "$env:PROGRAMDATA\Blackmagic Design\DaVinci Resolve\Support\Developer",
    [string]$DestinationRoot = "$env:PROGRAMDATA\Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins"
)
$ErrorActionPreference = 'Stop'
$source = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$destination = [IO.Path]::GetFullPath((Join-Path $DestinationRoot 'com.edgehh.amll.lyrics'))
$native = Join-Path $ResolveDeveloperRoot 'Workflow Integrations\Examples\SamplePlugin\WorkflowIntegration.node'
if (-not (Test-Path -LiteralPath $native -PathType Leaf)) { throw "找不到达芬奇原生桥接文件：$native，请安装 Studio 并确认开发包位置。" }
if (-not (Test-Path -LiteralPath (Join-Path $source 'node_modules\@xmldom\xmldom\package.json'))) { throw '缺少依赖，请先在 workflow-plugin 目录执行 npm ci。' }
if ($destination -eq $source -or $destination.StartsWith($source + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw '安装目录不能位于源代码目录内部。' }
# 更新已有安装前先备份；不删除任何目录，也不复制项目的其他会话产物。
if (Test-Path -LiteralPath $destination) {
    $backup = Join-Path 'D:\CodexBackup' ('amll-workflow-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    Copy-Item -LiteralPath $destination -Destination $backup -Recurse
    Write-Host "旧安装已备份到 $backup"
}
New-Item -ItemType Directory -Path $destination -Force | Out-Null
foreach ($name in @('main.js', 'preload.js', 'manifest.xml', 'package.json', 'package-lock.json', 'README.md', 'THIRD_PARTY_NOTICES.md', 'lib', 'ui', 'adapters', 'node_modules', 'docs')) {
    Copy-Item -LiteralPath (Join-Path $source $name) -Destination $destination -Recurse -Force
}
Copy-Item -LiteralPath $native -Destination (Join-Path $destination 'WorkflowIntegration.node') -Force
Write-Host "已安装：$destination"
Write-Host '请重启 DaVinci Resolve Studio，从 工作区 → 工作流程集成 → AMLL 歌词助手 打开。'
Write-Host '插件可把所选歌词范围直接写入顶部新轨道或合并为 Fusion 片段；请同时安装单一 AM Lyrics 标题预设。'
