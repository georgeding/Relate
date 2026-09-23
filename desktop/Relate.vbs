' Starts Relate without a console window (the installer's shortcuts point here).
Set sh = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
args = ""
For Each a In WScript.Arguments
  args = args & " " & a
Next
sh.Run """" & dir & "\node\node.exe"" """ & dir & "\app\desktop\launcher.mjs""" & args, 0, False
