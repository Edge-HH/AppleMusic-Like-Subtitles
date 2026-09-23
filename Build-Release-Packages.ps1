#Requires -Version 5.1
[CmdletBinding()]
param([string]$OutputDirectory,[switch]$SkipBuild)
$ErrorActionPreference='Stop';$scriptRoot=if($scriptRoot){$scriptRoot}else{Split-Path -Parent $MyInvocation.MyCommand.Definition};if(-not $OutputDirectory){$OutputDirectory=Join-Path $scriptRoot 'dist'};$output=[IO.Path]::GetFullPath($OutputDirectory)
if(-not $SkipBuild){& (Join-Path $scriptRoot 'Build-Title-Preset.ps1') -OutputDirectory $output;& (Join-Path $scriptRoot 'Build-Plugin-Package.ps1') -OutputDirectory $output}
$version=[string](Get-Content (Join-Path $scriptRoot 'workflow-plugin\package.json') -Raw|ConvertFrom-Json).version
Add-Type -AssemblyName System.IO.Compression;Add-Type -AssemblyName System.IO.Compression.FileSystem
function New-DeterministicZip([string]$Path,[hashtable]$Entries){$stream=[IO.File]::Open($Path,[IO.FileMode]::Create);try{$zip=[IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Create,$false);try{foreach($name in ($Entries.Keys|Sort-Object)){$entry=$zip.CreateEntry($name,[IO.Compression.CompressionLevel]::Optimal);$entry.LastWriteTime=[DateTimeOffset]::new(2026,1,1,0,0,0,[TimeSpan]::Zero);$src=[IO.File]::OpenRead($Entries[$name]);try{$dst=$entry.Open();try{$src.CopyTo($dst)}finally{$dst.Dispose()}}finally{$src.Dispose()}}}finally{$zip.Dispose()}}finally{$stream.Dispose()}}
function Write-Hash([string]$Path){$hash=(Get-FileHash $Path -Algorithm SHA256).Hash.ToLowerInvariant();"$hash  $([IO.Path]::GetFileName($Path))"|Set-Content "$Path.sha256" -Encoding ASCII}
New-Item -ItemType Directory -Path $output -Force|Out-Null
foreach($item in @(@{Code='ZH';Locale='zh'},@{Code='EN';Locale='en'})){$zipPath=Join-Path $output "AppleMusic-Style-Title-$($item.Code)-v$version.zip";$entries=@{'AppleMusic样式标题.setting'=Join-Path $output "$($item.Locale)\AppleMusic样式标题.setting";"AppleMusic-Style-Title-$($item.Code).drfx"=Join-Path $output "AppleMusic-Style-Title-$($item.Code).drfx"};New-DeterministicZip $zipPath $entries;Write-Hash $zipPath}
$temp=Join-Path ([IO.Path]::GetTempPath()) ('applemusic-style-title-release-'+[guid]::NewGuid().ToString('N'));New-Item -ItemType Directory -Path $temp|Out-Null
try{
  foreach($name in @('Install-Windows.cmd','Install-Windows.ps1','Open-Lyrics.cmd','README.md','docs')){Copy-Item -LiteralPath (Join-Path $scriptRoot $name) -Destination (Join-Path $temp $name) -Recurse}
  New-Item -ItemType Directory -Path (Join-Path $temp 'tools'),(Join-Path $temp 'dist\zh'),(Join-Path $temp 'dist\en') -Force|Out-Null
  Copy-Item (Join-Path $scriptRoot 'tools\install.ps1') (Join-Path $temp 'tools\install.ps1')
  Copy-Item (Join-Path $output 'zh\AppleMusic样式标题.setting') (Join-Path $temp 'dist\zh\AppleMusic样式标题.setting')
  Copy-Item (Join-Path $output 'en\AppleMusic样式标题.setting') (Join-Path $temp 'dist\en\AppleMusic样式标题.setting')
  $pluginSource=Join-Path $scriptRoot 'workflow-plugin';$pluginTarget=Join-Path $temp 'workflow-plugin';New-Item -ItemType Directory -Path $pluginTarget|Out-Null
  foreach($name in @('launcher.lua','launch.ps1','scripts','script-host.py','main.js','preload.js','manifest.xml','package.json','package-lock.json','README.md','THIRD_PARTY_NOTICES.md','lib','ui','adapters','node_modules','docs')){Copy-Item -LiteralPath (Join-Path $pluginSource $name) -Destination $pluginTarget -Recurse -Force}
  $entries=@{};Get-ChildItem $temp -Recurse -File|ForEach-Object{$entries[$_.FullName.Substring($temp.Length+1).Replace('\','/')]=$_.FullName}
  $installer=Join-Path $output "AppleMusic-Style-Title-Windows-Installer-v$version.zip";New-DeterministicZip $installer $entries;Write-Hash $installer
}finally{if($temp.StartsWith([IO.Path]::GetTempPath(),[StringComparison]::OrdinalIgnoreCase)){Remove-Item -LiteralPath $temp -Recurse -Force}}
Write-Host "Release packages built for v$version"
