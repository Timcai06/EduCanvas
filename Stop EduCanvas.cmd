@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-educanvas.ps1" %*
if errorlevel 1 (
  echo.
  echo EduCanvas stop failed. Press any key to close.
  pause >nul
)
