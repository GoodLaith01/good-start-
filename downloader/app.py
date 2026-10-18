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
import hmac

from flask import Flask, Response, jsonify, request, send_file

HERE = Path(__file__).parent
HAS_FFMPEG = shutil.which("ffmpeg") is not None

def format_for(preset):
    """yt-dlp format string for 'best', 'audio' or a height like 'h720'.
    With ffmpeg we merge the best separate video + audio streams; without it we
    fall back to the best single file that already has both."""
    if preset == "audio":
        return "bestaudio/best"
    if preset == "best":
        return "bestvideo*+bestaudio/best" if HAS_FFMPEG else "best"
    if re.fullmatch(r"h\d{3,4}", preset):
        h = preset[1:]
        if HAS_FFMPEG:
            return f"bestvideo*[height<={h}]+bestaudio/best[height<={h}]/best"
        return f"best[height<={h}]/best"
    raise BadRequest("Unknown quality option.")


def size_of(f):
    if not f:
        return 0
    return f.get("filesize") or f.get("filesize_approx") or 0


def quality_options(formats):
    """One option per available height (like SaveFrom's quality list), each with a size estimate."""
    video = [f for f in formats if f.get("height") and f.get("vcodec") not in (None, "none")]
    if not HAS_FFMPEG:
        video = [f for f in video if f.get("acodec") not in (None, "none")]
    audio = [f for f in formats if f.get("vcodec") in (None, "none") and f.get("acodec") not in (None, "none")]
    best_audio = max(audio, key=lambda f: f.get("abr") or 0, default=None)
    extra = size_of(best_audio) if HAS_FFMPEG else 0
    options = []
    for h in sorted({f["height"] for f in video}, reverse=True):
        if h < 144:
            continue
        top = max((f for f in video if f["height"] == h), key=lambda f: f.get("tbr") or 0)
        size = size_of(top)
        if size and top.get("acodec") in (None, "none"):
            size += extra
        options.append({"id": f"h{h}", "label": f"{h}p", "ext": "mp4", "size": size or None})
    if not options:  # the site gave no heights (e.g. a direct file link): offer its best video as-is
        best = max((f for f in formats if f.get("vcodec") != "none"), key=size_of, default=None)
        if best:
            options.append({"id": "best", "label": "Best", "ext": "mp4" if HAS_FFMPEG else best.get("ext", "mp4"),
                            "size": size_of(best) or None})
    options.append({"id": "audio", "label": "MP3" if HAS_FFMPEG else "Audio",
                    "ext": "mp3" if HAS_FFMPEG else (best_audio or {}).get("ext", "m4a"),
                    "size": size_of(best_audio) or None})
    return options


ANSI = re.compile(r"\x1b\[[0-9;]*m")
app = Flask(__name__)

# When hosted as a public website, set GRAB_PASSWORD so only you can use it.
PASSWORD = os.environ.get("GRAB_PASSWORD", "")


@app.before_request
def require_password():
    if not PASSWORD:
        return None
    auth = request.authorization
    if auth and hmac.compare_digest(auth.password or "", PASSWORD):
        return None
    return Response("Password required.", 401, {"WWW-Authenticate": 'Basic realm="Grab"'})


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
    options = quality_options(data.get("formats") or [])
    return jsonify(
        title=data.get("title") or "Untitled",
        uploader=data.get("uploader") or data.get("channel") or "",
        site=data.get("extractor_key") or "",
        thumbnail=data.get("thumbnail"),
        duration=data.get("duration"),
        options=options,
    )


@app.get("/api/download")
def download():
    url = clean_url(request.args.get("url"))
    preset = request.args.get("preset", "best")
    fmt = format_for(preset)
    tmp = Path(tempfile.mkdtemp(prefix="grab-"))
    opts = base_opts() | {
        "format": fmt,
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
