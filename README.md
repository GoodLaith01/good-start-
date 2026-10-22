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

## On iPhone

Open the website in Safari, tap **Share**, then **Add to Home Screen**. Social
Hub gets its own icon and opens full screen like an app (the site shows a tip
about this the first time). It shows the same public previews as the
website; tap **Open** on a panel to jump into the real TikTok, Instagram or X
app.

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
- **First start:** a welcome screen connects your accounts. **Connect** opens
  that site's own login page, and the app shows **Connected** as soon as
  you're in. The three dots at the top right show which accounts are connected
  and open the same screen later, where you can also **sign out** of one site.
  The app never sees or stores your password.
- **All 3 / TikTok / Instagram / X** at the top switch between all three and
  one at a time. New messages and alerts show as a red count on each tab and
  on the taskbar icon. Desktop notifications from the sites can be turned on
  or off in the accounts screen.
- Each site has **back, forward, reload, home** and **sound on/off** buttons.
  The **⋯** button has zoom, copy link, open in your browser and sign out.
  Right-click works like in a browser. Only TikTok has sound at first so three
  videos don't play over each other.
- If a site can't load (no internet, site down), its column says why and
  tries again by itself. It reconnects right away when your internet comes
  back.
- **Settings** (the sliders button): choose which sites show in the All view
  and in what order, keep the app running in the tray when you close the
  window (alerts keep coming, sound turns off), open it when you sign in to
  your computer, and reopen each site where you left off. Drag the space
  between two columns to make one wider; double-click it to even them out.
- **Keyboard:** Ctrl+1–4 switch views, Ctrl+Tab next view, Alt+←/→ back and
  forward, Ctrl+R reload, Ctrl+M sound, Ctrl+Shift+M mute everything,
  Ctrl+Shift+L day/night, Ctrl+, settings. Ctrl+/ shows them all.
- Log in with your username/email/phone and password. Google blocks
  "Continue with Google" inside desktop apps (it says "This browser or app may
  not be secure"), so the app stops before that page and shows other ways to
  sign in. No password yet? Use **Forgot password** with your Gmail address on
  the site's login page to make one.

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
