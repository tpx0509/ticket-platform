# Set the current user's desktop wallpaper on Windows.
# Uses registry values + rundll32 refresh only (no Add-Type, no P/Invoke),
# so it works in environments where runtime code compilation is blocked.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File set_wallpaper.ps1 -Path "C:\path\to\wallpaper.png"
param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    # 10 = Fill, 6 = Fit, 2 = Stretch, 0 = Center, 22 = Span
    [ValidateSet('0', '2', '6', '10', '22')]
    [string]$Style = '10'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Path)) {
    Write-Error "wallpaper not found: $Path"
    exit 2
}

$full = (Resolve-Path -LiteralPath $Path).ProviderPath

Set-ItemProperty -Path 'HKCU:\Control Panel\Desktop' -Name Wallpaper      -Value $full
Set-ItemProperty -Path 'HKCU:\Control Panel\Desktop' -Name WallpaperStyle -Value $Style
Set-ItemProperty -Path 'HKCU:\Control Panel\Desktop' -Name TileWallpaper  -Value '0'

# Refresh the desktop without logging out.
& rundll32.exe user32.dll,UpdatePerUserSystemParameters 1, True

$check = (Get-ItemProperty -Path 'HKCU:\Control Panel\Desktop' -Name Wallpaper).Wallpaper
if ($check -ne $full) {
    Write-Error "wallpaper registry not applied (got: $check)"
    exit 3
}

Write-Output "OK $full"
exit 0
