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

## Share from TikTok, Instagram, YouTube… straight to your phone's gallery

Once Grab is online (next section), set up your phone once:

**Android**
1. Open your Grab website in Chrome and tap ⋮ → **Install app** (or **Add to Home screen**).
2. In any app, tap **Share → Grab**. Grab opens, reads the link and downloads the best quality by itself.
3. Tap **Save to Photos / Gallery**. The video also appears in your Downloads, which the Gallery shows.

**iPhone** (iOS doesn't let websites join the Share menu, so a Shortcut does it)
1. Open **Shortcuts → + → Add Action → Open URLs**.
2. Set the URL to `https://YOUR-GRAB-SITE/?url=` followed by the **Shortcut Input** variable.
3. Tap ⓘ (Details) and turn on **Show in Share Sheet**. Name it **Grab**.
4. In any app, tap **Share → Grab**. When the video is ready, tap **Save to Photos / Gallery → Save Video**.

The same steps are shown inside Grab under "phone setup", in English and Arabic.

## Put it online as your own website (free)

The `Dockerfile` makes Grab a website that any Docker host can run. Example with
[Render](https://render.com) (free plan):

1. Sign up at render.com with your GitHub account.
2. **New → Web Service**, then pick the `good-start-` repository.
3. Set **Branch** to `claude/game-recognition-f0udzd` and **Root Directory** to `downloader`. Render detects the Dockerfile.
4. Under **Environment**, add `GRAB_PASSWORD` with a password of your choice. Your browser asks for it the first time you open the site; any username works.
5. Click **Create Web Service**. After a few minutes you get your own address, like `https://grab-xxxx.onrender.com`.

Notes:
- Free plans sleep when idle, so the first visit after a break takes about 30–60 seconds to wake up.
- YouTube often blocks downloads from cloud servers ("confirm you're not a bot"). TikTok, Instagram, X, Facebook and most other sites usually work from a server. YouTube works reliably when Grab runs on your own computer.
- Keep the password set. An open downloader on the internet gets found and abused, and that uses up your free plan.
