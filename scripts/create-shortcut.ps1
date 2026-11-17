# AgenTeam desktop shortcut (Windows): a one-click launcher with the project icon.
# Double-click it: AgenTeam starts if it is not running (hidden, no console), then opens in the browser.
#   Create:   powershell -ExecutionPolicy Bypass -File scripts\create-shortcut.ps1
#   Remove:   powershell -ExecutionPolicy Bypass -File scripts\create-shortcut.ps1 -Remove
# Also puts one in the Start menu. Needs Node on PATH (the same one install.mjs uses).
param([switch]$Remove)

$repo = Split-Path -Parent $PSScriptRoot
$vbs = Join-Path $repo "scripts\launch.vbs"
$icon = Join-Path $repo "docs\brand\agenteam.ico"
$places = @(
  (Join-Path ([Environment]::GetFolderPath("Desktop")) "AgenTeam.lnk"),
  (Join-Path ([Environment]::GetFolderPath("Programs")) "AgenTeam.lnk")
)

if ($Remove) {
  foreach ($p in $places) { if (Test-Path $p) { Remove-Item $p -Confirm:$false; Write-Output "Removed $p" } }
  exit 0
}

if (-not (Test-Path $vbs)) { throw "Not found: $vbs" }
$sh = New-Object -ComObject WScript.Shell
foreach ($p in $places) {
  $lnk = $sh.CreateShortcut($p)
  $lnk.TargetPath = Join-Path $env:WINDIR "System32\wscript.exe"
  $lnk.Arguments = "`"$vbs`""
  $lnk.WorkingDirectory = $repo
  $lnk.Description = "AgenTeam: start (if needed) and open"
  if (Test-Path $icon) { $lnk.IconLocation = "$icon,0" }
  $lnk.Save()
  Write-Output "Created $p"
}
