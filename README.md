# YouTube Video & Clip Downloader

A full-featured YouTube video downloader and timeline trimmer built with **Python (FastAPI)**, **yt-dlp**, **FFmpeg**, and an interactive modern web UI.

## Features

- **Link Parsing**: Automatically parses YouTube video links (Standard URLs, Shorts, and youtu.be links), fetching title, author, duration, thumbnails, and stream formats.
- **Resolution Selector**: Choose from available resolutions (2160p 4K, 1440p 2K, 1080p Full HD, 720p HD, 480p, 360p, 240p, 144p) or extract Audio Only (MP3).
- **Timeline & Duration Trimmer**:
  - Download full videos or any middle slice (e.g. choose exactly 5 minutes from the middle or any arbitrary timestamp).
  - Interactive dual-range timeline scrubber.
  - Live YouTube player preview with real-time timestamp grabbing (`Set Start from Player`, `Set End from Player`).
  - Quick presets: **Full Video**, **Middle 5 Minutes**, **First 5 Mins**, **First 1 Min**, **+30s**, **-30s**.
- **Real-Time Download Progress**: Live animated progress bar showing percentage, download speed (MB/s), ETA, and downloaded file size.
- **Multiple Container Formats**: MP4, MKV, or MP3 (audio-only extraction).
- **Session Library**: View downloaded clips, open directly in Windows Explorer, or download through the browser.

## Getting Started

### Prerequisites

- Python 3.10+
- Node.js (for yt-dlp JavaScript challenge solver)

### Quick Start (Windows)

Simply double-click:
```cmd
run.bat
```

Or run manually in your terminal:
```bash
pip install -r requirements.txt
python app.py
```

Then navigate to `http://127.0.0.1:5000` in your web browser.

## Project Structure

```
├── app.py              # FastAPI server handling parsing, yt-dlp slicing & progress
├── requirements.txt    # Python dependencies
├── run.bat             # 1-click Windows launcher
├── downloads/          # Directory where downloaded videos & trimmed clips are saved
├── static/
│   ├── css/style.css   # Custom styles & dual-range slider controls
│   └── js/app.js       # Frontend logic, YouTube Player API, range updates & polling
└── templates/
    └── index.html      # Responsive modern dark UI
```
