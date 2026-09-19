[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$Destination,
    [string]$BackupRoot = 'D:\CodexBackup'
)
$ErrorActionPreference = 'Stop'
if (-not $Destination) {
    if (-not $env:APPDATA) { throw 'APPDATA is unavailable. Use -Destination explicitly.' }
    $Destination = Join-Path $env:APPDATA 'Blackmagic Design\DaVinci Resolve\Support\Fusion\Templates\Edit\Titles\AM Lyrics'
}
$source = Join-Path (Split-Path $PSScriptRoot -Parent) 'dist'
$names = @('AM Lyrics 32.setting', 'AM Lyrics 64.setting')
foreach ($name in $names) {
    if (-not (Test-Path -LiteralPath (Join-Path $source $name) -PathType Leaf)) {
        throw "Missing $name. Restore dist or run python tools/build.py."
    }
}
$target = [IO.Path]::GetFullPath($Destination)
$existing = @($names | Where-Object { Test-Path -LiteralPath (Join-Path $target $_) })
if (-not $PSCmdlet.ShouldProcess($target, 'Install AM Lyrics titles; back up existing matching files first')) { return }
# Never remove directories, existing packages, or unrelated presets.
if ($existing.Count -gt 0) {
    $backup = Join-Path $BackupRoot ('AM-Lyrics-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8))
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    foreach ($name in $existing) {
        Copy-Item -LiteralPath (Join-Path $target $name) -Destination (Join-Path $backup $name)
        if ((Get-FileHash -LiteralPath (Join-Path $target $name)).Hash -ne
            (Get-FileHash -LiteralPath (Join-Path $backup $name)).Hash) {
            throw "Backup validation failed for $name. Nothing will be overwritten."
        }
    }
    Write-Host "Previous presets backed up to: $backup"
}
New-Item -ItemType Directory -Path $target -Force | Out-Null
foreach ($name in $names) {
    Copy-Item -LiteralPath (Join-Path $source $name) -Destination (Join-Path $target $name) -Force
    if ((Get-FileHash -LiteralPath (Join-Path $source $name)).Hash -ne
        (Get-FileHash -LiteralPath (Join-Path $target $name)).Hash) {
        throw "Installed file verification failed: $name"
    }
}
Write-Host "Installed to: $target"
Write-Host 'Restart Resolve, then search Effects > Titles for AM Lyrics.'
Write-Host 'Do not also install the DRFX package: choose one installation method.'
