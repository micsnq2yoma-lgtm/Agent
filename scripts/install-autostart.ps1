# Agentself autostart (Windows): start Paperclip + console at logon, hidden, no admin needed.
# Installs a small VBScript launcher into the current user's Startup folder.
#   Install:   powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1
#   Remove:    powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -Remove
param([switch]$Remove)

$repo = Split-Path -Parent $PSScriptRoot
$startup = [Environment]::GetFolderPath("Startup")
$launcher = Join-Path $startup "Agentself.vbs"

if ($Remove) {
  if (Test-Path $launcher) { Remove-Item $launcher -Confirm:$false; Write-Output "Removed $launcher" } else { Write-Output "Not installed" }
  exit 0
}

$node = (Get-Command node -ErrorAction Stop).Source
$script = Join-Path $repo "scripts\start.mjs"
$vbs = @"
' Agentself autostart: runs node scripts\start.mjs hidden (logs in %USERPROFILE%\.agentself\logs)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "$repo"
sh.Run """$node"" ""$script""", 0, False
"@
Set-Content -Path $launcher -Value $vbs -Encoding ASCII
Write-Output "Installed $launcher"
Write-Output "Agentself will start at next logon. Start it now with: node `"$script`""
