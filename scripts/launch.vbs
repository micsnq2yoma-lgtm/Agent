' AgenTeam one-click launcher (Windows): runs scripts\launch.mjs without a console window and
' shows a message box if AgenTeam does not come up. The desktop shortcut points here.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = fso.GetParentFolderName(here)
code = sh.Run("cmd /d /c node """ & here & "\launch.mjs""", 0, True)
If code <> 0 Then
  MsgBox "AgenTeam 没有起来。请看日志：" & sh.ExpandEnvironmentStrings("%USERPROFILE%") & "\.agenteam\logs" & vbCrLf & "（没装好的话先运行 node scripts\install.mjs）", 48, "AgenTeam"
End If
