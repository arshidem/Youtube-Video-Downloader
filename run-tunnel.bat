@echo off
title YouTube Downloader & Trimmer (Cloudflare Tunnel)
echo Starting YouTube Downloader and Cloudflare Tunnel...

:: Start Python FastAPI server if not running
start "YT-Trim Backend" /min cmd /c "python app.py"

:: Wait 2 seconds for server to boot
timeout /t 2 /nobreak >nul

:: Start Cloudflare Tunnel
echo.
echo =======================================================
echo Cloudflare Tunnel Starting...
echo Keep this window open while you or your friends use it.
echo =======================================================
echo.
"%USERPROFILE%\cloudflared.exe" tunnel --url http://127.0.0.1:5000
pause
