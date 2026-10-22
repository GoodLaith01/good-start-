# good-start-

**Social Hub** — watch your TikTok, Instagram and X accounts in one place.

- **All** shows the three accounts side by side (stacked on phones).
- **TikTok / Instagram / X** tabs show just one account, full width.
- Each panel's **Open ↗** button goes to the real profile; **Open all ↗** opens all three.
- **▶ Watch** plays any single TikTok video, Instagram post or reel, or X post
  inside the site: paste its link and it plays right away. Recently watched
  links are kept for quick replay (in that browser only).

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
another page, so each panel uses the platform's official profile embed:

- **TikTok**: creator embed with your recent videos.
- **Instagram**: profile embed; the account must be public.
- **X**: timeline embed; X may only show it when you're signed in to X in the
  same browser.
- **Watch**: TikTok short links (`vm.tiktok.com/…`) can't be read by the page;
  open them first and copy the full link with `/video/` in it. Private posts
  can't be shown.

Liking, commenting and posting still happen on the platform itself — use the
**Open ↗** buttons for that.
