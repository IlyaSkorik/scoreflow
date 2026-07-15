# Links engine static assets into Flutter Web's public tree so the iframe
# and fetch() resolve to /assets/www/... (single /assets/ prefix).
#
# Run once after clone (or when assets/www changes):
#   powershell -File tools/link_web_assets.ps1
#
# Requires no elevation: uses a directory junction on Windows.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root 'assets\www'
$link = Join-Path $root 'web\assets\www'

if (-not (Test-Path $target)) {
    throw "Engine assets not found: $target"
}

New-Item -ItemType Directory -Force -Path (Split-Path $link) | Out-Null

if (Test-Path $link) {
    $item = Get-Item $link
    if ($item.Target -eq $target) {
        Write-Host "Already linked: $link -> $target"
        exit 0
    }
    Remove-Item $link -Recurse -Force
}

New-Item -ItemType Junction -Path $link -Target $target | Out-Null
Write-Host "Linked $link -> $target"
