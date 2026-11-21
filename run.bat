@echo off
title YouTube Video & Clip Downloader
echo ========================================================
echo    YouTube Video & Duration Slicer Downloader
echo ========================================================
echo Starting local web server on http://127.0.0.1:5000 ...
echo.

start "" "http://127.0.0.1:5000"
python app.py

pause
