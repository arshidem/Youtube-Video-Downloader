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

class SaveCookiesRequest(BaseModel):
    cookie_text: str

class DownloadRequest(BaseModel):
    url: str
    resolution: Optional[str] = "best"
    format: Optional[str] = "mp4"
    start_time: Optional[float] = None
    end_time: Optional[float] = None
    custom_filename: Optional[str] = None
    lossless: Optional[bool] = False
    audio_fade: Optional[bool] = False
    subtitle_lang: Optional[str] = None
    embed_sub: Optional[bool] = False

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

def cleanup_old_downloads(max_age_hours: int = 4):
    """Clean up downloaded files older than max_age_hours to save disk space on public servers."""
    try:
        now = time.time()
        cutoff = now - (max_age_hours * 3600)
        for p in DOWNLOADS_DIR.iterdir():
            if p.is_file():
                try:
                    if p.stat().st_mtime < cutoff:
                        p.unlink(missing_ok=True)
                except Exception:
                    pass
    except Exception:
        pass

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

    # Proxy support for cloud/datacenter IP bypassing
    proxy = os.getenv("YTDLP_PROXY") or os.getenv("HTTPS_PROXY") or os.getenv("HTTP_PROXY")
    if proxy:
        opts["proxy"] = proxy.strip()

    # Optional YouTube authentication. Prefer raw cookie text, local file, or browser export.
    cookie_file = os.getenv("YTDLP_COOKIES", "").strip()
    cookie_text = os.getenv("YTDLP_COOKIES_TEXT", "").strip()
    
    # If raw cookie text is provided in environment variables (ideal for cloud dashboards like Render/Railway)
    if cookie_text:
        env_cookie_path = BASE_DIR / ".env_cookies.txt"
        try:
            env_cookie_path.write_text(cookie_text, encoding="utf-8")
            cookie_file = str(env_cookie_path.resolve())
        except Exception as e:
            print(f"Warning saving YTDLP_COOKIES_TEXT: {e}")

    if not cookie_file:
        local_cookie = BASE_DIR / "cookies.txt"
        if local_cookie.is_file():
            cookie_file = str(local_cookie.resolve())

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

@app.get("/api/cookies-status")
async def get_cookies_status():
    cookie_file = BASE_DIR / "cookies.txt"
    has_cookies = cookie_file.exists() or bool(os.getenv("YTDLP_COOKIES")) or bool(os.getenv("YTDLP_COOKIES_TEXT"))
    return {"has_cookies": has_cookies}

@app.post("/api/save-cookies")
async def save_cookies(req: SaveCookiesRequest):
    text = req.cookie_text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Cookie content cannot be empty.")
    
    cookie_file = BASE_DIR / "cookies.txt"
    try:
        cookie_file.write_text(text, encoding="utf-8")
        return {"success": True, "message": "Cookies saved successfully! YouTube authenticated."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save cookies: {str(e)}")

@app.delete("/api/delete-cookies")
async def delete_cookies():
    cookie_file = BASE_DIR / "cookies.txt"
    if cookie_file.exists():
        try:
            cookie_file.unlink()
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    return {"success": True, "message": "Saved cookies removed."}

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
                detail="YouTube requires bot verification on this server. Click 'Fix with Cookies' or 'Cookies / Auth' in the top bar to paste your cookies.txt and unlock the server."
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

    # Extract Chapters
    chapters = []
    raw_chapters = info.get("chapters") or []
    for ch in raw_chapters:
        s_ch = ch.get("start_time", 0)
        e_ch = ch.get("end_time", duration)
        chapters.append({
            "title": ch.get("title", f"Chapter {len(chapters) + 1}"),
            "start_time": s_ch,
            "end_time": e_ch,
            "start_formatted": format_seconds(s_ch),
            "end_formatted": format_seconds(e_ch),
            "duration_formatted": format_seconds(e_ch - s_ch)
        })

    # Extract Subtitles
    subtitles = []
    manual_subs = info.get("subtitles") or {}
    auto_subs = info.get("automatic_captions") or {}
    seen_langs = set()
    for code in manual_subs.keys():
        seen_langs.add(code)
        subtitles.append({"code": code, "label": f"{code.upper()} (official)"})
    for code in auto_subs.keys():
        if code not in seen_langs and code in ["en", "es", "fr", "de", "pt", "it", "hi", "ja", "ko", "ru", "zh"]:
            subtitles.append({"code": code, "label": f"{code.upper()} (auto)"})

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
        "chapters": chapters,
        "subtitles": subtitles,
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
    lossless = req_data.get("lossless", False)
    audio_fade = req_data.get("audio_fade", False)
    subtitle_lang = req_data.get("subtitle_lang")
    embed_sub = req_data.get("embed_sub", False)

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
        opts["force_keyframes_at_cuts"] = not lossless
        slice_label = f"_{format_seconds(s).replace(':', 'm')}s_to_{format_seconds(e).replace(':', 'm')}s"

    # Subtitles settings
    if subtitle_lang:
        opts["writesubtitles"] = True
        opts["writeautomaticsub"] = True
        opts["subtitleslangs"] = [subtitle_lang]
        opts["subtitlesformat"] = "srt/vtt/best"
        if embed_sub and fmt in ["mp4", "mkv"]:
            opts.setdefault("postprocessors", []).append({"key": "FFmpegEmbedSubtitle"})

    # Lossless / fast cut settings
    if lossless and is_sliced and fmt in ["mp4", "mkv"]:
        opts.setdefault("postprocessor_args", {}).setdefault("ffmpeg", []).extend(["-c", "copy"])

    # Audio fade settings
    if audio_fade and is_sliced and fmt != "gif" and not lossless:
        s_val = float(start_time or 0.0)
        e_val = float(end_time or 0.0)
        dur = e_val - s_val
        if dur >= 2.0:
            fade_out_st = max(0.0, dur - 1.0)
            afade_filter = f"afade=t=in:ss=0:d=1,afade=t=out:st={fade_out_st:.2f}:d=1"
            opts.setdefault("postprocessor_args", {}).setdefault("ffmpeg", []).extend(["-af", afade_filter])

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
        elif fmt == "gif":
            opts["merge_output_format"] = "mp4"
            final_ext = "gif"
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
        matched_files = list(DOWNLOADS_DIR.glob(f"*{safe_download_id}*"))
        if matched_files:
            downloaded_file = matched_files[0]
            
            # If GIF format was requested, convert MP4 to palettegen GIF
            if fmt == "gif" and downloaded_file.suffix.lower() != ".gif":
                task["status_msg"] = "Generating optimized GIF with FFmpeg..."
                gif_path = downloaded_file.with_suffix(".gif")
                ffmpeg_bin = os.path.join(ffmpeg_dir, "ffmpeg.exe") if "ffmpeg_dir" in globals() else "ffmpeg"
                try:
                    import subprocess
                    cmd = [
                        ffmpeg_bin, "-y", "-i", str(downloaded_file),
                        "-vf", "fps=15,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse",
                        str(gif_path)
                    ]
                    subprocess.run(cmd, check=True, capture_output=True)
                    try:
                        downloaded_file.unlink(missing_ok=True)
                    except Exception:
                        pass
                    downloaded_file = gif_path
                except Exception as gif_err:
                    print(f"GIF conversion warning: {gif_err}")

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
    cleanup_old_downloads(max_age_hours=6)
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

@app.get("/api/stream/{filename}")
async def stream_file(filename: str):
    file_path = DOWNLOADS_DIR / filename
    try:
        file_path.resolve().relative_to(DOWNLOADS_DIR.resolve())
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid file path.")

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found.")

    ext = file_path.suffix.lower()
    media_type = "video/mp4"
    if ext == ".webm":
        media_type = "video/webm"
    elif ext == ".mkv":
        media_type = "video/x-matroska"
    elif ext == ".mp3":
        media_type = "audio/mpeg"
    elif ext == ".gif":
        media_type = "image/gif"

    return FileResponse(file_path, media_type=media_type)

@app.post("/api/open-folder")
async def open_downloads_folder():
    try:
        if sys.platform == "win32":
            os.startfile(str(DOWNLOADS_DIR))
            return {"success": True, "message": "Folder opened in Windows Explorer"}
        else:
            return {"success": False, "message": "Server running on Linux/Cloud. Files are saved directly to your device via the download button."}
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
