#Requires -Version 5.1
[CmdletBinding()]
param([string]$OutputDirectory = (Join-Path $PSScriptRoot 'dist'))
$ErrorActionPreference='Stop'
$buildScript=Join-Path $PSScriptRoot 'tools/build.py';$output=[IO.Path]::GetFullPath($OutputDirectory)
if(-not(Test-Path -LiteralPath $buildScript -PathType Leaf)){throw "找不到标题预设构建器：$buildScript"}
$launcher=Get-Command py -ErrorAction SilentlyContinue
if($launcher){& $launcher.Source -3 $buildScript --output $output}else{$python=Get-Command python -ErrorAction SilentlyContinue;if(-not $python){throw '找不到 Python 3。'};& $python.Source $buildScript --output $output}
if($LASTEXITCODE -ne 0){throw "标题预设构建失败，退出码：$LASTEXITCODE"}
$expected=@('zh\AM Lyrics.setting','en\AM Lyrics.setting','AM-Lyrics-ZH.drfx','AM-Lyrics-EN.drfx')
foreach($name in $expected){if(-not(Test-Path -LiteralPath (Join-Path $output $name) -PathType Leaf)){throw "构建后缺少：$name"}}
Write-Host "标题预设已生成到：$output";$expected|ForEach-Object{Write-Host "  - $_"}
