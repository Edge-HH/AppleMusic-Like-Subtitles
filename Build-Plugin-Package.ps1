#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$OutputDirectory,
    [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'
$scriptRoot = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $scriptRoot 'dist' }
$pluginRoot = [IO.Path]::GetFullPath((Join-Path $scriptRoot 'workflow-plugin'))
$output = [IO.Path]::GetFullPath($OutputDirectory)
$packageJsonPath = Join-Path $pluginRoot 'package.json'
$manifestPath = Join-Path $pluginRoot 'manifest.xml'

if (-not (Test-Path -LiteralPath $packageJsonPath -PathType Leaf)) {
    throw "找不到插件 package.json：$packageJsonPath"
}
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "找不到插件 manifest.xml：$manifestPath"
}

$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npm) {
    throw '找不到 npm。请安装 Node.js 18 或更高版本，并确保 npm 已加入 PATH。'
}

$packageJson = Get-Content -LiteralPath $packageJsonPath -Raw | ConvertFrom-Json
$version = [string]$packageJson.version
if ([string]::IsNullOrWhiteSpace($version)) {
    throw 'package.json 缺少 version。'
}

[xml]$manifest = Get-Content -LiteralPath $manifestPath -Raw
$manifestVersion = [string]$manifest.BlackmagicDesign.Plugin.Version
if ($manifestVersion -ne $version) {
    throw "版本不一致：package.json=$version，manifest.xml=$manifestVersion"
}

Push-Location $pluginRoot
try {
    # 使用 package-lock.json 生成可复现的生产依赖，不执行第三方生命周期脚本。
    & $npm.Source ci --omit=dev --ignore-scripts
    if ($LASTEXITCODE -ne 0) {
        throw "npm ci 失败，退出码：$LASTEXITCODE"
    }

    if (-not $SkipTests) {
        & $npm.Source test
        if ($LASTEXITCODE -ne 0) {
            throw "插件测试失败，退出码：$LASTEXITCODE"
        }
        & $npm.Source run check
        if ($LASTEXITCODE -ne 0) {
            throw "插件语法检查失败，退出码：$LASTEXITCODE"
        }
    }
} finally {
    Pop-Location
}

New-Item -ItemType Directory -Path $output -Force | Out-Null
$archivePath = Join-Path $output "AMLL-Resolve-Script-v$version.zip"
$checksumPath = "$archivePath.sha256"

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$includePaths = @(
    'launcher.lua',
    'launch.ps1',
    'script-host.py',
    'main.js',
    'preload.js',
    'manifest.xml',
    'package.json',
    'package-lock.json',
    'README.md',
    'THIRD_PARTY_NOTICES.md',
    'lib',
    'ui',
    'adapters',
    'docs',
    'scripts/install.ps1',
    'node_modules/@xmldom',
    'node_modules/.package-lock.json'
)

$files = foreach ($relativePath in $includePaths) {
    $source = Join-Path $pluginRoot $relativePath
    if (-not (Test-Path -LiteralPath $source)) {
        throw "插件包缺少必需内容：$source"
    }
    $item = Get-Item -LiteralPath $source
    if ($item.PSIsContainer) {
        Get-ChildItem -LiteralPath $source -Recurse -File
    } else {
        $item
    }
}
$files = $files | Sort-Object FullName -Unique

# 直接按固定顺序和固定时间戳写 ZIP，避免不同机器生成无意义的二进制差异。
$fileStream = [IO.File]::Open($archivePath, [IO.FileMode]::Create, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
try {
    $archive = [IO.Compression.ZipArchive]::new($fileStream, [IO.Compression.ZipArchiveMode]::Create, $false)
    try {
        foreach ($file in $files) {
            $relative = $file.FullName.Substring($pluginRoot.Length).TrimStart([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
            $entryName = 'AMLL-Resolve-Script/' + ($relative -replace '\\', '/')
            $entry = $archive.CreateEntry($entryName, [IO.Compression.CompressionLevel]::Optimal)
            $entry.LastWriteTime = [DateTimeOffset]::new(2026, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
            $sourceStream = [IO.File]::OpenRead($file.FullName)
            try {
                $entryStream = $entry.Open()
                try {
                    $sourceStream.CopyTo($entryStream)
                } finally {
                    $entryStream.Dispose()
                }
            } finally {
                $sourceStream.Dispose()
            }
        }
    } finally {
        $archive.Dispose()
    }
} finally {
    $fileStream.Dispose()
}

$hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $([IO.Path]::GetFileName($archivePath))" | Set-Content -LiteralPath $checksumPath -Encoding ASCII

Write-Host "插件包已生成：$archivePath"
Write-Host "SHA-256 校验文件：$checksumPath"
