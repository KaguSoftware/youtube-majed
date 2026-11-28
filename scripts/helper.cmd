@echo off
rem The Studio helper on Windows: runs scripts\helper.ps1 past the default execution policy. Usage: helper setup^|start^|stop^|restart^|status^|logs^|update
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0helper.ps1" %*
