#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'dist')
)

$ErrorActionPreference = 'Stop'
$buildScript = Join-Path $PSScriptRoot 'tools/build.py'
$output = [IO.Path]::GetFullPath($OutputDirectory)

if (-not (Test-Path -LiteralPath $buildScript -PathType Leaf)) {
    throw "找不到标题预设构建器：$buildScript"
}

# Windows 优先使用 Python Launcher，其他环境回退到 python，便于本地和 CI 共用。
$launcher = Get-Command py -ErrorAction SilentlyContinue
if ($launcher) {
    & $launcher.Source -3 $buildScript --output $output
} else {
    $python = Get-Command python -ErrorAction SilentlyContinue
    if (-not $python) {
        throw '找不到 Python 3。请安装 Python 3，并确保 py 或 python 已加入 PATH。'
    }
    & $python.Source $buildScript --output $output
}

if ($LASTEXITCODE -ne 0) {
    throw "标题预设构建失败，退出码：$LASTEXITCODE"
}

$expectedFiles = @(
    'AM Lyrics 32.setting',
    'AM Lyrics 64.setting',
    'AM-Lyrics.drfx'
)
foreach ($name in $expectedFiles) {
    $path = Join-Path $output $name
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "构建完成后缺少预期文件：$path"
    }
}

Write-Host "标题预设已生成到：$output"
$expectedFiles | ForEach-Object { Write-Host "  - $_" }
