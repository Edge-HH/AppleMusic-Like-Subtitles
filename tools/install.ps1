[CmdletBinding(SupportsShouldProcess=$true)]
param(
    [ValidateSet('auto','zh','en')][string]$Language='auto',
    [string]$Destination,
    [string]$BackupRoot='D:\CodexBackup'
)
$ErrorActionPreference='Stop'

# 不依赖 Get-FileHash，避免从 cmd 启动时 PowerShell 模块自动加载失败。
function Get-Sha256([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $algorithm.Dispose()
        $stream.Dispose()
    }
}
if($Language -eq 'auto'){$Language=if((Get-UICulture).Name -like 'zh-*'){'zh'}else{'en'}}
if(-not $Destination){if(-not $env:APPDATA){throw 'APPDATA 不可用。'};$Destination=Join-Path $env:APPDATA 'Blackmagic Design\DaVinci Resolve\Support\Fusion\Templates\Edit\Titles\AppleMusic样式标题'}
$source=Join-Path (Split-Path $PSScriptRoot -Parent) "dist\$Language\AppleMusic样式标题.setting"
if(-not(Test-Path -LiteralPath $source -PathType Leaf)){throw "缺少 $source，请先运行 Build-Title-Preset.ps1。"}
$target=[IO.Path]::GetFullPath($Destination)
# 一并清理旧产品名 AM Lyrics 的标题文件。
$names=@('AppleMusic样式标题.setting','AM Lyrics.setting','AM Lyrics 32.setting','AM Lyrics 64.setting')
$existing=@($names|Where-Object{Test-Path -LiteralPath (Join-Path $target $_)})
if(-not $PSCmdlet.ShouldProcess($target,"安装 $Language 语言 AppleMusic样式标题 标题")){return}
if($existing.Count){$backup=Join-Path $BackupRoot ('AppleMusic-Style-Title-'+(Get-Date -Format 'yyyyMMdd-HHmmss-fff')+'-'+[guid]::NewGuid().ToString('N').Substring(0,8));New-Item -ItemType Directory -Path $backup -Force|Out-Null;foreach($name in $existing){Copy-Item -LiteralPath (Join-Path $target $name) -Destination (Join-Path $backup $name);if((Get-Sha256 (Join-Path $target $name)) -ne (Get-Sha256 (Join-Path $backup $name))){throw "备份校验失败：$name"}};Write-Host "旧标题已备份到：$backup"}
New-Item -ItemType Directory -Path $target -Force|Out-Null
foreach($name in $existing){Remove-Item -LiteralPath (Join-Path $target $name) -Force}
Copy-Item -LiteralPath $source -Destination (Join-Path $target 'AppleMusic样式标题.setting') -Force
if((Get-Sha256 $source) -ne (Get-Sha256 (Join-Path $target 'AppleMusic样式标题.setting'))){throw '安装后校验失败。'}
Write-Host "已安装单一 $Language 标题模板：$target"
