#Requires -Version 5.1
[CmdletBinding()]
param(
    [ValidateSet('auto','zh','en')][string]$Language='auto',
    [string]$TitleDestination,
    [string]$ResolveDeveloperRoot="$env:PROGRAMDATA\Blackmagic Design\DaVinci Resolve\Support\Developer",
    [string]$PluginDestinationRoot="$env:PROGRAMDATA\Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins",
    [string]$BackupRoot='D:\CodexBackup'
)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath($PSScriptRoot)
& (Join-Path $root 'tools\install.ps1') -Language $Language -Destination $TitleDestination -BackupRoot $BackupRoot
$source=Join-Path $root 'workflow-plugin';$destination=Join-Path $PluginDestinationRoot 'com.edgehh.amll.lyrics'
$native=Join-Path $ResolveDeveloperRoot 'Workflow Integrations\Examples\SamplePlugin\WorkflowIntegration.node'
if(-not(Test-Path -LiteralPath $native -PathType Leaf)){throw "找不到 Resolve 原生桥接文件：$native"}
if(-not(Test-Path -LiteralPath (Join-Path $source 'node_modules\@xmldom\xmldom\package.json'))){throw '插件缺少生产依赖，请使用 Release 安装包或先运行 Build-Plugin-Package.ps1。'}
if(Test-Path -LiteralPath $destination){$backup=Join-Path $BackupRoot ('amll-workflow-'+(Get-Date -Format 'yyyyMMdd-HHmmss-fff')+'-'+[guid]::NewGuid().ToString('N').Substring(0,8));New-Item -ItemType Directory -Path $backup -Force|Out-Null;Copy-Item -LiteralPath $destination -Destination $backup -Recurse;Write-Host "旧插件已备份到：$backup"}
New-Item -ItemType Directory -Path $destination -Force|Out-Null
foreach($name in @('main.js','preload.js','manifest.xml','package.json','package-lock.json','README.md','THIRD_PARTY_NOTICES.md','lib','ui','adapters','node_modules','docs')){Copy-Item -LiteralPath (Join-Path $source $name) -Destination $destination -Recurse -Force}
Copy-Item -LiteralPath $native -Destination (Join-Path $destination 'WorkflowIntegration.node') -Force
Write-Host 'AM Lyrics 标题和歌词助手已安装。请重启 DaVinci Resolve Studio。'
