#!/usr/bin/env python3
"""Grab: a small, ad-free video downloader that runs on your own computer.

Paste a link from YouTube, TikTok, Instagram, X, Facebook, Reddit, Vimeo and
1,000+ other sites, pick a quality, download. The heavy lifting is done by
yt-dlp (https://github.com/yt-dlp/yt-dlp); this file is just a thin web UI.

    pip install -r requirements.txt
    python app.py            # then open http://127.0.0.1:8000
"""

import os
import re
import shutil
import tempfile
import webbrowser
from pathlib import Path
from urllib.parse import urlparse

import yt_dlp
from flask import Flask, jsonify, request, send_file

HERE = Path(__file__).parent
HAS_FFMPEG = shutil.which("ffmpeg") is not None

# With ffmpeg we can merge the best separate video + audio streams; without it we
# fall back to the best single file that already has both.
if HAS_FFMPEG:
    PRESETS = {
        "best": "bestvideo*+bestaudio/best",
        "1080": "bestvideo*[height<=1080]+bestaudio/best[height<=1080]/best",
        "720": "bestvideo*[height<=720]+bestaudio/best[height<=720]/best",
        "480": "bestvideo*[height<=480]+bestaudio/best[height<=480]/best",
        "audio": "bestaudio/best",
    }
else:
    PRESETS = {
        "best": "best",
        "1080": "best[height<=1080]/best",
        "720": "best[height<=720]/best",
        "480": "best[height<=480]/best",
        "audio": "bestaudio/best",
    }

ANSI = re.compile(r"\x1b\[[0-9;]*m")
app = Flask(__name__)


class BadRequest(Exception):
    pass


def clean_url(raw):
    url = (raw or "").strip()
    parts = urlparse(url)
    if parts.scheme not in ("http", "https") or not parts.netloc:
        raise BadRequest("Paste a full link that starts with http:// or https://")
    return url


def base_opts():
    return {"quiet": True, "no_warnings": True, "noprogress": True, "noplaylist": True, "playlist_items": "1"}


def error_message(err):
    msg = ANSI.sub("", str(err)).replace("ERROR: ", "").strip()
    if "Unsupported URL" in msg:
        return "That site or link type isn't supported."
    if "Private" in msg or "login" in msg.lower() or "sign in" in msg.lower():
        return "This video is private or needs a login, so it can't be downloaded."
    if "urlopen error" in msg or "Unable to download" in msg or "timed out" in msg:
        return "Couldn't reach that site. Check your internet connection and try again."
    return msg.splitlines()[0][:300] or "Couldn't read that link."


@app.errorhandler(BadRequest)
def bad_request(err):
    return jsonify(error=str(err)), 400


@app.get("/")
def index():
    return send_file(HERE / "index.html")


@app.post("/api/info")
def info():
    url = clean_url((request.get_json(silent=True) or {}).get("url"))
    try:
        with yt_dlp.YoutubeDL(base_opts()) as ydl:
            data = ydl.extract_info(url, download=False)
    except yt_dlp.utils.DownloadError as err:
        return jsonify(error=error_message(err)), 422
    if data.get("entries"):  # carousels and playlists: use the first item
        data = next((e for e in data["entries"] if e), data)
    heights = sorted({f["height"] for f in data.get("formats") or []
                      if f.get("height") and f.get("vcodec") not in (None, "none")}, reverse=True)
    top = heights[0] if heights else None
    presets = ["best"] + [p for p in ("1080", "720", "480") if top and top > int(p)] + ["audio"]
    return jsonify(
        title=data.get("title") or "Untitled",
        uploader=data.get("uploader") or data.get("channel") or "",
        site=data.get("extractor_key") or "",
        thumbnail=data.get("thumbnail"),
        duration=data.get("duration"),
        best_height=top,
        presets=presets,
        mp3=HAS_FFMPEG,
    )


@app.get("/api/download")
def download():
    url = clean_url(request.args.get("url"))
    preset = request.args.get("preset", "best")
    if preset not in PRESETS:
        raise BadRequest("Unknown quality option.")
    tmp = Path(tempfile.mkdtemp(prefix="grab-"))
    opts = base_opts() | {
        "format": PRESETS[preset],
        "outtmpl": str(tmp / "%(title).80B [%(id)s].%(ext)s"),
        "restrictfilenames": False,
        "windowsfilenames": True,
    }
    if HAS_FFMPEG and preset != "audio":
        opts["merge_output_format"] = "mp4"
    if HAS_FFMPEG and preset == "audio":
        opts["postprocessors"] = [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"}]
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([url])
    except yt_dlp.utils.DownloadError as err:
        shutil.rmtree(tmp, ignore_errors=True)
        return jsonify(error=error_message(err)), 422
    files = [p for p in tmp.iterdir() if p.is_file() and not p.name.endswith((".part", ".ytdl"))]
    if not files:
        shutil.rmtree(tmp, ignore_errors=True)
        return jsonify(error="The download finished but no file was produced."), 500
    path = max(files, key=lambda p: p.stat().st_size)
    resp = send_file(path, as_attachment=True, download_name=path.name)
    resp.call_on_close(lambda: shutil.rmtree(tmp, ignore_errors=True))
    return resp


if __name__ == "__main__":
    host = os.environ.get("GRAB_HOST", "127.0.0.1")
    port = int(os.environ.get("GRAB_PORT", "8000"))
    if not HAS_FFMPEG:
        print("Tip: install ffmpeg for the best quality and MP3 audio.")
    print(f"Grab is running at http://{host}:{port}")
    if os.environ.get("GRAB_NO_BROWSER") != "1":
        webbrowser.open(f"http://127.0.0.1:{port}")
    app.run(host=host, port=port, threaded=True)
