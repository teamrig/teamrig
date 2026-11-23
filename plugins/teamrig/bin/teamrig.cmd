@echo off
rem The teamrig CLI for cmd and PowerShell. cmd ends %* at a line break, so the shim also hands the CLI its whole
rem command line, read with delayed expansion, which keeps the line breaks; the CLI rebuilds the arguments from it.
rem cmd looks for a bare node in the current folder before the PATH; the set below, ended by setlocal, skips that folder.
setlocal EnableDelayedExpansion
set "TEAMRIG_CMD_LINE=!CMDCMDLINE!"
setlocal DisableDelayedExpansion
set "NoDefaultCurrentDirectoryInExePath=1"
node "%~dp0..\dist\cli\main.js" %*
