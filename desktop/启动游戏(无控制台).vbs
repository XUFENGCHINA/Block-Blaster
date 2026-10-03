' ============================================================
'  Block Gunner 2D - start the desktop client hidden (no console)
'  Pure ASCII on purpose: the Chinese .bat filename is built from
'  Unicode code points (U+542F U+52A8 U+6E38 U+620F) via ChrW(),
'  so this file can be saved as ASCII / ANSI without breaking.
' ============================================================
Option Explicit
Dim fso, sh, env, base, bat, extra, i
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")

base = fso.GetParentFolderName(WScript.ScriptFullName)
bat  = base & "\" & ChrW(&H542F) & ChrW(&H52A8) & ChrW(&H6E38) & ChrW(&H620F) & ".bat"

extra = ""
For i = 0 To WScript.Arguments.Count - 1
  extra = extra & " " & """" & WScript.Arguments(i) & """"
Next

' never leave a hidden console waiting at "pause" on error
Set env = sh.Environment("Process")
env("BG_NO_PAUSE") = "1"

sh.CurrentDirectory = base
' 0 = hidden window, False = do not wait for it to finish
sh.Run """" & bat & """" & extra, 0, False