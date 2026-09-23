#Requires -Version 5.1
[CmdletBinding()]
param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
try {
    $hostFile = Join-Path $PSScriptRoot 'script-host.py'
    if (-not (Test-Path -LiteralPath $hostFile -PathType Leaf)) { throw '插件文件不完整，请重新安装。' }
    $python = $null
    $hint = Join-Path $PSScriptRoot 'python.path'
    if (Test-Path -LiteralPath $hint) {
        $candidate = (Get-Content -LiteralPath $hint -Raw).Trim()
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { $python = $candidate }
    }
    if (-not $python) {
        foreach ($name in @('py','python')) {
            $command = Get-Command $name -ErrorAction SilentlyContinue
            if (-not $command) { continue }
            $arguments = @('-c', 'import sys,struct; assert sys.version_info >= (3,8) and struct.calcsize(''P'')==8; print(sys.executable)')
            if ($name -eq 'py') { $arguments = @('-3') + $arguments }
            try { $candidate = & $command.Source @arguments 2>$null } catch { continue }
            if ($LASTEXITCODE -eq 0 -and $candidate -and (Test-Path -LiteralPath ([string]$candidate).Trim())) { $python = ([string]$candidate).Trim(); break }
        }
    }
    if (-not $python) { throw '未找到 64 位 Python 3.8 或更新版本，请安装 Python 后重新安装歌词助手。' }
    if ($CheckOnly) { Write-Output $python; Write-Output $hostFile; return }
    # The Python host shows startup errors and records them instead of silently closing.
    Start-Process -FilePath $python -ArgumentList @('"' + $hostFile + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden | Out-Null
} catch {
    if ($CheckOnly) { throw }
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'AppleMusic样式标题启动失败', 'OK', 'Error') | Out-Null
    exit 1
}
