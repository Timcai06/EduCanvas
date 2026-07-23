@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-educanvas.ps1"
if errorlevel 1 (
  echo.
  echo EduCanvas failed to start. Press any key to close.
  pause >nul
)
