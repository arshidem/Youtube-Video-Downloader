import os
import sys
import uuid
import time
import shutil
import asyncio
import threading
from typing import Optional, Dict, Any, List
from pathlib import Path

# Ensure imageio-ffmpeg binary is in PATH and named ffmpeg.exe
try:
    import imageio_ffmpeg
    ffmpeg_exe_src = imageio_ffmpeg.get_ffmpeg_exe()
    ffmpeg_dir = os.path.dirname(ffmpeg_exe_src)
    ffmpeg_exe_dst = os.path.join(ffmpeg_dir, "ffmpeg.exe")
    if not os.path.exists(ffmpeg_exe_dst):
        try:
            shutil.copy2(ffmpeg_exe_src, ffmpeg_exe_dst)
        except Exception as e:
            print(f"Warning copying ffmpeg: {e}")
    os.environ["PATH"] = ffmpeg_dir + os.pathsep + os.environ.get("PATH", "")
except Exception as e:
    print(f"Warning configuring ffmpeg: {e}")

import yt_dlp
from fastapi import FastAPI, HTTPException, Request, BackgroundTasks, Response
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

BASE_DIR = Path(__file__).resolve().parent
DOWNLOADS_DIR = BASE_DIR / "downloads"
DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)
STATIC_DIR = BASE_DIR / "static"
TEMPLATES_DIR = BASE_DIR / "templates"

app = FastAPI(title="YouTube Video & Clip Downloader")

if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

templates = Jinja2Templates(directory=str(TEMPLATES_DIR))

# Download task state store
# key: download_id, value: dict
downloads_store: Dict[str, Dict[str, Any]] = {}

class ParseRequest(BaseModel):
    url: str

class DownloadRequest(BaseModel):
    url: str
    resolution: Optional[str] = "best"
    format: Optional[str] = "mp4"
    start_time: Optional[float] = None
    end_time: Optional[float] = None
    custom_filename: Optional[str] = None

def format_seconds(seconds: Optional[float]) -> str:
    if seconds is None:
        return "00:00"
    seconds = int(seconds)
    hours = seconds // 3600
    minutes = (seconds % 3600) // 60
    secs = seconds % 60
    if hours > 0:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"

def format_size(bytes_num: Optional[int]) -> str:
    if not bytes_num:
        return "Unknown size"
    for unit in ['B', 'KB', 'MB', 'GB']:
        if bytes_num < 1024.0:
            return f"{bytes_num:.1f} {unit}"
        bytes_num /= 1024.0
    return f"{bytes_num:.1f} TB"

def get_base_ydl_opts() -> dict:
    opts = {
        "quiet": True,
        "no_warnings": True,
        "js_runtimes": {"node": {}},
        "remote_components": ["ejs:github"],
        "windowsfilenames": True,
        "geo_bypass": True,
        "http_chunk_size": 10485760,  # 10MB chunking prevents CDN 403 drops
        "http_headers": {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
            "Accept": "*/*",
            "Accept-Language": "en-US,en;q=0.9",
        }
    }
    if 'ffmpeg_dir' in globals() and os.path.exists(ffmpeg_dir):
        opts["ffmpeg_location"] = ffmpeg_dir

    # Optional YouTube authentication. Prefer a local cookie export when supplied;
    # otherwise yt-dlp can read cookies from a locally installed browser.
    cookie_file = os.getenv("YTDLP_COOKIES", "").strip()
    browser = os.getenv("YTDLP_COOKIES_FROM_BROWSER", "").strip().lower()
    if cookie_file:
        cookie_path = Path(cookie_file).expanduser()
        if cookie_path.is_file():
            opts["cookiefile"] = str(cookie_path.resolve())
        else:
            print(f"Warning: YTDLP_COOKIES file not found: {cookie_path}")
    elif browser:
        supported_browsers = {
            "brave", "chrome", "chromium", "edge", "firefox",
            "opera", "safari", "vivaldi", "whale"
        }
        if browser in supported_browsers:
            opts["cookiesfrombrowser"] = (browser, None, None, None)
        else:
            print(
                "Warning: Unsupported YTDLP_COOKIES_FROM_BROWSER value. "
                "Use chrome, edge, firefox, brave, chromium, opera, safari, "
                "vivaldi, or whale."
            )
    return opts

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return Response(status_code=204)

@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse(request=request, name="index.html")

@app.post("/api/parse")
async def parse_video(req: ParseRequest):
    url = req.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="Please enter a valid YouTube URL.")

    opts = get_base_ydl_opts()
    opts["extract_flat"] = False

    try:
        def fetch_info():
            with yt_dlp.YoutubeDL(opts) as ydl:
                return ydl.extract_info(url, download=False)

        info = await asyncio.to_thread(fetch_info)
    except Exception as e:
        error_msg = str(e)
        if "is not a valid URL" in error_msg:
            raise HTTPException(status_code=400, detail="Invalid YouTube URL. Please check the link.")
        if "Sign in to confirm" in error_msg or "not a bot" in error_msg.lower():
            raise HTTPException(
                status_code=403,
                detail=(
                    "YouTube requires account verification for this request. "
                    "On the computer running this app, sign in to YouTube in Chrome/Edge/Firefox, "
                    "close the browser, then set YTDLP_COOKIES_FROM_BROWSER=chrome "
                    "(or edge/firefox) and restart the app. Alternatively, export a Netscape "
                    "cookies.txt file and set YTDLP_COOKIES to its full path. "
                    "Keep cookies private and never commit the file."
                )
            )
        raise HTTPException(status_code=400, detail=f"Failed to fetch video details: {error_msg}")

    # Extract available video resolutions
    formats = info.get("formats", [])
    resolutions_set = set()
    has_audio = False
    
    # Track video resolutions
    res_details = []
    seen_heights = set()

    for f in formats:
        h = f.get("height")
        vcodec = f.get("vcodec", "none")
        acodec = f.get("acodec", "none")
        if acodec != "none":
            has_audio = True
        if h and isinstance(h, int) and h >= 144 and vcodec != "none" and h not in seen_heights:
            seen_heights.add(h)
            fps = f.get("fps") or 30
            fps_str = f" {fps}fps" if fps and fps > 30 else ""
            res_details.append({
                "height": h,
                "label": f"{h}p{fps_str}",
                "fps": fps,
                "ext": f.get("ext", "mp4")
            })

    # Sort descending by height
    res_details.sort(key=lambda x: x["height"], reverse=True)

    duration = info.get("duration", 0)
    video_id = info.get("id", "")

    return {
        "success": True,
        "id": video_id,
        "title": info.get("title", "Untitled Video"),
        "channel": info.get("uploader") or info.get("channel", "Unknown Channel"),
        "channel_url": info.get("uploader_url") or info.get("channel_url", ""),
        "duration": duration,
        "duration_formatted": format_seconds(duration),
        "thumbnail": info.get("thumbnail") or f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
        "description": (info.get("description") or "")[:200] + ("..." if len(info.get("description") or "") > 200 else ""),
        "view_count": info.get("view_count", 0),
        "resolutions": res_details,
        "webpage_url": info.get("webpage_url", url)
    }

def run_download_job(download_id: str, req_data: dict):
    task = downloads_store[download_id]
    url = req_data["url"]
    resolution = req_data.get("resolution", "best")
    fmt = req_data.get("format", "mp4").lower()
    start_time = req_data.get("start_time")
    end_time = req_data.get("end_time")
    custom_name = req_data.get("custom_filename")

    def progress_hook(d):
        if task.get("cancelled"):
            raise yt_dlp.utils.DownloadCancelled("Download cancelled by user")
        status = d.get("status")
        if status == "downloading":
            downloaded = d.get("downloaded_bytes", 0)
            total = d.get("total_bytes") or d.get("total_bytes_estimate", 0)
            percent = (downloaded / total * 100) if total else 0
            speed = d.get("speed", 0)
            eta = d.get("eta", 0)
            
            task["status"] = "downloading"
            task["progress"] = round(percent, 1)
            task["speed_str"] = f"{speed / (1024*1024):.2f} MB/s" if speed else "Calculating..."
            task["eta_str"] = f"{eta}s" if eta else "Calculating..."
            task["downloaded_bytes_str"] = format_size(downloaded)
            task["total_bytes_str"] = format_size(total) if total else "Unknown"
        elif status == "finished":
            task["status"] = "processing"
            task["progress"] = 99.0
            task["status_msg"] = "Processing / Trimming / Encoding with FFmpeg..."

    opts = get_base_ydl_opts()
    opts["progress_hooks"] = [progress_hook]

    # Time range slicing
    is_sliced = False
    slice_label = ""
    if (start_time is not None and start_time > 0) or (end_time is not None and end_time > 0):
        is_sliced = True
        s = float(start_time) if start_time else 0.0
        e = float(end_time) if end_time else float("inf")
        opts["download_ranges"] = yt_dlp.utils.download_range_func(None, [(s, e)])
        opts["force_keyframes_at_cuts"] = True
        slice_label = f"_{format_seconds(s).replace(':', 'm')}s_to_{format_seconds(e).replace(':', 'm')}s"

    # Format & Resolution settings
    if fmt == "mp3" or resolution == "audio_only":
        opts["format"] = "bestaudio/best"
        opts["postprocessors"] = [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": "192",
        }]
        final_ext = "mp3"
    else:
        if resolution and resolution != "best":
            try:
                h = int(resolution)
                opts["format"] = f"bestvideo[height<={h}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<={h}]+bestaudio/best[height<={h}]/best"
            except ValueError:
                opts["format"] = "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best"
        else:
            opts["format"] = "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best"
        
        if fmt in ["mp4", "mkv", "webm"]:
            opts["merge_output_format"] = fmt
            final_ext = fmt
        else:
            opts["merge_output_format"] = "mp4"
            final_ext = "mp4"

    # Template for output
    safe_download_id = download_id[:8]
    if custom_name and custom_name.strip():
        sanitized = "".join(c for c in custom_name if c.isalnum() or c in " ._-").strip()
        opts["outtmpl"] = str(DOWNLOADS_DIR / f"{sanitized}_{safe_download_id}.%(ext)s")
    else:
        opts["outtmpl"] = str(DOWNLOADS_DIR / f"%(title).80s{slice_label}_{safe_download_id}.%(ext)s")

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
            task["title"] = info.get("title", "Video")

        # Locate the downloaded file
        # Search for files with our safe_download_id
        matched_files = list(DOWNLOADS_DIR.glob(f"*{safe_download_id}*"))
        if matched_files:
            downloaded_file = matched_files[0]
            task["status"] = "completed"
            task["progress"] = 100.0
            task["filename"] = downloaded_file.name
            task["filepath"] = str(downloaded_file)
            task["filesize"] = downloaded_file.stat().st_size
            task["filesize_str"] = format_size(downloaded_file.stat().st_size)
            task["completed_at"] = time.time()
        else:
            task["status"] = "completed"
            task["progress"] = 100.0
            task["filename"] = f"video_{safe_download_id}.{final_ext}"
            task["filesize_str"] = "Completed"
    except yt_dlp.utils.DownloadCancelled:
        task["status"] = "cancelled"
        task["status_msg"] = "Download cancelled by user"
        task["progress"] = 0.0
        # Clean up any partial files
        for p in DOWNLOADS_DIR.glob(f"*{safe_download_id}*"):
            try:
                p.unlink(missing_ok=True)
            except Exception:
                pass
    except Exception as e:
        task["status"] = "error"
        task["error_message"] = str(e)
        print(f"Download Error: {e}")

@app.post("/api/download")
async def start_download(req: DownloadRequest, background_tasks: BackgroundTasks):
    download_id = str(uuid.uuid4())
    downloads_store[download_id] = {
        "id": download_id,
        "url": req.url,
        "status": "queued",
        "progress": 0.0,
        "speed_str": "Starting...",
        "eta_str": "Starting...",
        "downloaded_bytes_str": "0 MB",
        "total_bytes_str": "Calculating...",
        "filename": None,
        "filepath": None,
        "filesize_str": None,
        "error_message": None,
        "title": "Starting download...",
        "is_sliced": bool(req.start_time or req.end_time),
        "start_time": req.start_time,
        "end_time": req.end_time,
        "resolution": req.resolution,
        "format": req.format,
        "created_at": time.time()
    }

    req_data = req.dict()
    # Run download thread
    thread = threading.Thread(target=run_download_job, args=(download_id, req_data), daemon=True)
    thread.start()

    return {"download_id": download_id}

@app.get("/api/status/{download_id}")
async def get_download_status(download_id: str):
    task = downloads_store.get(download_id)
    if not task:
        raise HTTPException(status_code=404, detail="Download task not found.")
    return task

@app.post("/api/cancel/{download_id}")
async def cancel_download(download_id: str):
    task = downloads_store.get(download_id)
    if not task:
        raise HTTPException(status_code=404, detail="Download task not found.")
    task["cancelled"] = True
    task["status"] = "cancelled"
    task["status_msg"] = "Download cancelled by user"
    return {"success": True, "message": "Download cancelled"}

@app.get("/api/download-file/{download_id}")
async def get_download_file(download_id: str):
    task = downloads_store.get(download_id)
    if not task or task.get("status") != "completed":
        raise HTTPException(status_code=404, detail="File is not ready yet or task was not found.")
    
    filepath = task.get("filepath")
    if not filepath or not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Downloaded file not found on disk.")

    return FileResponse(
        path=filepath,
        filename=task.get("filename", os.path.basename(filepath)),
        media_type="application/octet-stream"
    )

@app.get("/api/downloads")
async def list_downloads():
    files = []
    for f in DOWNLOADS_DIR.iterdir():
        if f.is_file() and not f.name.endswith(".part"):
            stat = f.stat()
            files.append({
                "filename": f.name,
                "size_str": format_size(stat.st_size),
                "modified": stat.st_mtime,
                "ext": f.suffix.replace(".", "").upper(),
                "path": str(f)
            })
    files.sort(key=lambda x: x["modified"], reverse=True)
    return {"downloads": files}

@app.post("/api/open-folder")
async def open_downloads_folder():
    try:
        if sys.platform == "win32":
            os.startfile(str(DOWNLOADS_DIR))
            return {"success": True, "message": "Folder opened in Windows Explorer"}
        else:
            return {"success": False, "message": "Not running on Windows"}
    except Exception as e:
        return {"success": False, "message": str(e)}

@app.delete("/api/delete-file/{filename}")
async def delete_file(filename: str):
    file_path = DOWNLOADS_DIR / filename
    # Security check: ensure path is within DOWNLOADS_DIR
    try:
        file_path.resolve().relative_to(DOWNLOADS_DIR.resolve())
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid file path.")

    if file_path.exists():
        try:
            file_path.unlink()
            return {"success": True}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    raise HTTPException(status_code=404, detail="File not found.")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="127.0.0.1", port=5000, reload=True)
