# good-start-

**Social Hub** — watch your TikTok, Instagram and X accounts in one place.

- **All** shows the three accounts side by side (stacked on phones).
- **TikTok / Instagram / X** tabs show just one account, full width.
- Each panel's **Open ↗** button goes to the real profile.
- **Side by side** opens the real TikTok (For You), Instagram (Reels) and X
  (Home) in three windows filling the screen, so you can watch all three at
  once, logged in to your own accounts. Log in once in each window and the
  browser remembers it. If only one window opens, allow pop-ups for the site.
  (On a computer only: phones can't show three apps at once.)
- **▶ Watch** plays any single TikTok video, Instagram post or reel, or X post
  inside the site: paste its link and it plays right away. Recently watched
  links are kept for quick replay (in that browser only).

## Desktop app (Windows)

The website can only show public previews, because TikTok, Instagram and X
don't allow logging in inside another web page. The **Social Hub app** can:
it shows the real TikTok, Instagram and X side by side in one window, each
logged in to your own account, so you get your feeds and the people you
follow. You log in once in each and it stays logged in.

- **Download:** the **Get the app** button on the website, or
  [Social-Hub-Setup.exe](https://github.com/GoodLaith01/good-start-/releases/latest/download/Social-Hub-Setup.exe).
  Windows may say "Windows protected your PC" because the app isn't signed:
  click **More info → Run anyway**.
- **All 3 / TikTok / Instagram / X** at the top switch between all three and
  one at a time.
- Each site has **back, reload, home, smaller/bigger** and **sound on/off**
  buttons. Only TikTok has sound at first so three videos don't play over each
  other.
- Log in with your username/email and password. "Continue with Google"
  usually doesn't work inside apps like this.

The app's code is in `desktop/`. GitHub builds the installer automatically
(`.github/workflows/desktop.yml`) whenever `desktop/` changes. To run it from
the code: `cd desktop && npm install && npm start`.

## Use it

Open `index.html` in a browser, click **Accounts**, and enter your usernames
(`@name`, `name`, or a profile link all work). They're saved in your browser.

To pre-fill the usernames for anyone who opens the page, set them in
`DEFAULT_ACCOUNTS` at the top of `app.js`.

To put it online for free, enable GitHub Pages for this repository
(Settings → Pages → deploy from branch, root folder).

## Background

There are two moving backgrounds, and the sun/moon button in the top bar
switches between them:

- **Day:** a calm jungle with sunbeams, swaying vines and leaves, fireflies
  and butterflies.
- **Night:** a starry sky with a full moon, a distant island and a calm sea
  with moonlight shimmering on the water.

The site starts in day mode from 6am to 6pm and in night mode otherwise, and
remembers your choice once you press the button. Both are drawn in code (no
image files), and the motion switches off for people who turn on "reduce
motion" on their device.

To use a picture instead (for example one made in Canva), save it as
`assets/background.jpg` and in `styles.css` set
`--bg-image: url("assets/background.jpg");`.

## Limits

TikTok, Instagram and X don't allow their full sites to be shown inside
another page, and never let you log in there, so the panels on the page use
each platform's official public embed (use **Side by side** for your logged-in
feeds):

- **TikTok**: creator embed with your recent videos.
- **Instagram**: profile embed; the account must be public.
- **X**: timeline embed; X may only show it when you're signed in to X in the
  same browser.
- **Watch**: TikTok short links (`vm.tiktok.com/…`) can't be read by the page;
  open them first and copy the full link with `/video/` in it. Private posts
  can't be shown.

Liking, commenting and posting still happen on the platform itself — use the
**Open ↗** buttons for that.
