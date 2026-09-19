[CmdletBinding(SupportsShouldProcess=$true)]
param(
    [ValidateSet('auto','zh','en')][string]$Language='auto',
    [string]$Destination,
    [string]$BackupRoot='D:\CodexBackup'
)
$ErrorActionPreference='Stop'
if($Language -eq 'auto'){$Language=if((Get-UICulture).Name -like 'zh-*'){'zh'}else{'en'}}
if(-not $Destination){if(-not $env:APPDATA){throw 'APPDATA 不可用。'};$Destination=Join-Path $env:APPDATA 'Blackmagic Design\DaVinci Resolve\Support\Fusion\Templates\Edit\Titles\AM Lyrics'}
$source=Join-Path (Split-Path $PSScriptRoot -Parent) "dist\$Language\AM Lyrics.setting"
if(-not(Test-Path -LiteralPath $source -PathType Leaf)){throw "缺少 $source，请先运行 Build-Title-Preset.ps1。"}
$target=[IO.Path]::GetFullPath($Destination);$names=@('AM Lyrics.setting','AM Lyrics 32.setting','AM Lyrics 64.setting')
$existing=@($names|Where-Object{Test-Path -LiteralPath (Join-Path $target $_)})
if(-not $PSCmdlet.ShouldProcess($target,"安装 $Language 语言 AM Lyrics 标题")){return}
if($existing.Count){$backup=Join-Path $BackupRoot ('AM-Lyrics-'+(Get-Date -Format 'yyyyMMdd-HHmmss-fff')+'-'+[guid]::NewGuid().ToString('N').Substring(0,8));New-Item -ItemType Directory -Path $backup -Force|Out-Null;foreach($name in $existing){Copy-Item -LiteralPath (Join-Path $target $name) -Destination (Join-Path $backup $name);if((Get-FileHash (Join-Path $target $name)).Hash -ne (Get-FileHash (Join-Path $backup $name)).Hash){throw "备份校验失败：$name"}};Write-Host "旧标题已备份到：$backup"}
New-Item -ItemType Directory -Path $target -Force|Out-Null
foreach($name in $existing){Remove-Item -LiteralPath (Join-Path $target $name) -Force}
Copy-Item -LiteralPath $source -Destination (Join-Path $target 'AM Lyrics.setting') -Force
if((Get-FileHash $source).Hash -ne (Get-FileHash (Join-Path $target 'AM Lyrics.setting')).Hash){throw '安装后校验失败。'}
Write-Host "已安装单一 $Language 标题模板：$target"
