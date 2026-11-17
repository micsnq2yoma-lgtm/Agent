' AgenTeam one-click launcher (Windows): runs scripts\launch.mjs without a console window and
' shows a message box if AgenTeam does not come up. The desktop shortcut points here.
' Keep this file ASCII: Windows Script Host reads BOM-less VBS using the system code page.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = fso.GetParentFolderName(here)
code = sh.Run("cmd /d /c node """ & here & "\launch.mjs""", 0, True)
If code <> 0 Then
  MsgBox "AgenTeam could not start. Check logs: " & sh.ExpandEnvironmentStrings("%USERPROFILE%") & "\.agenteam\logs" & vbCrLf & "First installation: run node scripts\install.mjs", 48, "AgenTeam"
End If
