# Grab: a free, ad-free video downloader

Paste a link from YouTube, TikTok, Instagram, X (Twitter), Facebook, Reddit, Vimeo or
[1,000+ other sites](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md),
pick a quality and download. It runs on your own computer, so there are no ads, no
tracking and no limits.

## Start it

1. Install [Python 3.10+](https://www.python.org/downloads/). On Windows, tick "Add Python to PATH".
2. Recommended: install [ffmpeg](https://ffmpeg.org/download.html). It gives the best quality (merged HD video and audio) and MP3 audio. Without ffmpeg, Grab still works but uses lower-quality single-file downloads.
3. Start Grab:
   - **Windows:** double-click `start.bat`.
   - **Mac / Linux:** run `./start.sh`.

Your browser opens at http://127.0.0.1:8000. Paste a link, press **Get video**, and pick from
the list of every quality the video has (1080p, 720p, 480p…, each with its file size) or **MP3**.

## Features

| SaveFrom feature | In Grab |
|---|---|
| One box, auto-detects the site | Yes, 1,000+ sites |
| List of every quality with sizes | Yes |
| Helper button / "ss" link trick | The **Grab it** bookmark button: drag it to your bookmarks bar, then click it on any video page. Links like `http://127.0.0.1:8000/?url=VIDEO_LINK` also start right away. |
| Arabic page | Arabic / English switch (right-to-left in Arabic) |
| MP3 audio | Yes (needs ffmpeg) |
| Ads, pop-ups, limits | None |

## How it works

Sites like SaveFrom do three things: read the page you link to, find where the platform
stores the actual video file, and hand you that file. Grab does the same three steps on
your own machine using [yt-dlp](https://github.com/yt-dlp/yt-dlp), the open-source tool
that most downloaders rely on:

- `app.py` is a small Flask server with `/api/info` (title, thumbnail, available
  qualities) and `/api/download` (fetches the file, merges video and audio with ffmpeg,
  sends it to your browser, then deletes its temporary copy).
- `index.html` is the page you use.

## When a site stops working

Platforms change their sites often. If downloads from one site start failing, update
yt-dlp. The start scripts already do this every time you launch Grab, or you can run
`pip install -U yt-dlp` yourself.

## Please note

Private videos and videos that need a login can't be downloaded. Only download videos
you have the right to save, such as your own uploads, content with a free licence, or
personal offline viewing where the platform's terms allow it.
