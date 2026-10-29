// Social Hub desktop app: the real TikTok, Instagram and X side by side in one
// window, each logged in to your own account.
//
// A website can't do this (the sites refuse to run logged in inside another
// page), but an app can show each site in its own browser view. Every view
// keeps its own saved login, so you sign in once and stay signed in. You sign
// in on each site's own login page, so the app never sees your password.

const {
  app, BrowserWindow, WebContentsView, ipcMain, shell, session, Menu, dialog,
  nativeImage, screen, clipboard, Tray, Notification, nativeTheme, net,
} = require("electron");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { ElectronBlocker } = require("@ghostery/adblocker-electron");

const SITES = {
  tiktok: {
    name: "TikTok",
    home: "https://www.tiktok.com/foryou",
    login: "https://www.tiktok.com/login",
    hosts: ["tiktok.com"],
    // The cookie a site sets only while you're signed in.
    account: { url: "https://www.tiktok.com", cookie: "sessionid" },
  },
  instagram: {
    name: "Instagram",
    home: "https://www.instagram.com/",
    login: "https://www.instagram.com/accounts/login/",
    hosts: ["instagram.com"],
    account: { url: "https://www.instagram.com", cookie: "sessionid" },
  },
  x: {
    name: "X",
    home: "https://x.com/home",
    login: "https://x.com/i/flow/login",
    hosts: ["x.com", "twitter.com"],
    account: { url: "https://x.com", cookie: "auth_token" },
  },
  youtube: {
    name: "YouTube",
    home: "https://www.youtube.com/",
    login: "https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F",
    hosts: ["youtube.com", "youtu.be"],
    account: { url: "https://www.youtube.com", cookie: "LOGIN_INFO" },
  },
};
const KEYS = Object.keys(SITES);

// Layout sizes in pixels, shared with the window's toolbar (ui/ui.js).
// `rail` is the glass column of buttons down the left side.
const SIZES = { toolbar: 60, rail: 64, head: 44, headGap: 8, gap: 12, radius: 18 };

// Window colors per theme, so the title bar and first paint match the page.
const THEME_COLORS = {
  day: { bg: "#6f6a66", bar: "#2a2420", symbol: "#fff8ef" },
  night: { bg: "#0d1430", bar: "#0b1022", symbol: "#eef2ff" },
};

// Sign-in pages a site may open in a pop-up (e.g. "Log in with Apple").
const LOGIN_HOSTS = [
  "tiktok.com", "instagram.com", "x.com", "twitter.com",
  "facebook.com", "appleid.apple.com", "login.live.com",
];

// Google refuses sign-in inside any app that isn't a full browser and shows
// "This browser or app may not be secure". Instead of letting you hit that
// wall, the app stops at Google's page and shows other ways to sign in.
function isGoogleSignIn(url) {
  try {
    const { hostname, pathname } = new URL(url);
    return hostname === "accounts.google.com" && !pathname.startsWith("/gsi/");
  } catch {
    return false;
  }
}

// YouTube's own sign-in is a Google sign-in, so YouTube is allowed to try it.
// If Google turns it down, its page address says "rejected".
function isGoogleRejection(url) {
  return isGoogleSignIn(url) && /\/rejected/.test(url);
}
const FIREFOX_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0";

// Where each site keeps the posts and videos you saved.
const SAVED = {
  tiktok: { label: "Favorites", url: "https://www.tiktok.com/profile" },
  instagram: { label: "Saved", url: null }, // needs your username, found when asked
  x: { label: "Bookmarks", url: "https://x.com/i/bookmarks" },
  youtube: { label: "Library", url: "https://www.youtube.com/feed/you" },
};

// Pages that are a feed of full-height videos, where the up/down buttons show.
function isVideoFeed(key, url) {
  try {
    const { pathname } = new URL(url);
    if (key === "tiktok") return pathname === "/" || /^\/(foryou|following|explore|friends)/.test(pathname) || /\/video\//.test(pathname);
    if (key === "instagram") return /^\/reels?\//.test(pathname);
    return false;
  } catch {
    return false;
  }
}

// Runs in the site's page: moves the feed to the next (dir 1) or previous
// (dir -1) video. Scrolling by hand sometimes stops between videos in a
// narrow column; this always lands on the next one.
const STEP_VIDEO = (dir) => `(() => {
  const vh = innerHeight;
  const centre = (v) => { const r = v.getBoundingClientRect(); return r.top + r.height / 2; };
  const vids = [...document.querySelectorAll("video")]
    .filter((v) => { const r = v.getBoundingClientRect(); return r.height > 80 && r.width > 80; })
    .sort((a, b) => centre(a) - centre(b));
  if (!vids.length) { window.scrollBy({ top: ${dir} * vh * 0.9, behavior: "smooth" }); return; }
  const cur = vids.reduce((best, v) => Math.abs(centre(v) - vh / 2) < Math.abs(centre(best) - vh / 2) ? v : best);
  const next = vids[vids.indexOf(cur) + ${dir}];
  if (next) { next.scrollIntoView({ block: "center", behavior: "smooth" }); return; }
  let el = cur.parentElement;
  while (el && el !== document.documentElement) {
    const s = getComputedStyle(el);
    if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 4) break;
    el = el.parentElement;
  }
  const box = el && el !== document.documentElement ? el : document.scrollingElement;
  box.scrollBy({ top: ${dir} * cur.getBoundingClientRect().height, behavior: "smooth" });
})()`;

// Runs in the site's page: plays the main video full screen.
const VIDEO_FULLSCREEN = `(() => {
  const vids = [...document.querySelectorAll("video")].filter((v) => v.getBoundingClientRect().height > 80);
  if (!vids.length) return false;
  const area = (v) => v.clientWidth * v.clientHeight;
  const video = vids.find((v) => !v.paused) || vids.sort((a, b) => area(b) - area(a))[0];
  (video.closest("#movie_player, .html5-video-player") || video).requestFullscreen();
  return true;
})()`;

// After a page fails to load, try again after these many seconds.
const RETRY_DELAYS = [3, 8, 20, 45, 60];

// The sites block or limit unknown browsers, so present the app as the plain
// Chrome it's built on.
const PLATFORM_UA = {
  win32: "Windows NT 10.0; Win64; x64",
  darwin: "Macintosh; Intel Mac OS X 10_15_7",
  linux: "X11; Linux x86_64",
}[process.platform] || "Windows NT 10.0; Win64; x64";
const USER_AGENT = `Mozilla/5.0 (${PLATFORM_UA}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
app.userAgentFallback = USER_AGENT;

// Windows uses this to group the app on the taskbar and show its notifications.
if (process.platform === "win32") app.setAppUserModelId("io.github.goodlaith01.socialhub");

// ---------- Saved settings ----------

const settingsFile = () => path.join(app.getPath("userData"), "settings.json");

const state = {
  mode: "all", // "all" or one site key
  theme: "day",
  muted: { tiktok: false, instagram: true, x: true, youtube: false },
  zoom: { tiktok: 1, instagram: 1, x: 1, youtube: 1 },
  notifications: true,
  welcomed: false,
  muteAll: false,
  order: [...KEYS], // column order in the All view
  // Left out of the All view. YouTube has its own tab for watching videos big.
  hidden: { tiktok: false, instagram: false, x: false, youtube: true },
  widths: { tiktok: 1, instagram: 1, x: 1, youtube: 1 }, // relative column widths
  background: true, // closing the window keeps the app in the tray
  startup: false, // open (in the tray) when you sign in to Windows
  restore: true, // reopen each site where you left off
  lastUrl: {},
  trayHinted: false,
  bounds: null,
};

function loadSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsFile(), "utf8"));
    if (saved.mode === "all" || KEYS.includes(saved.mode)) state.mode = saved.mode;
    if (saved.theme === "day" || saved.theme === "night") state.theme = saved.theme;
    for (const key of KEYS) {
      if (typeof saved.muted?.[key] === "boolean") state.muted[key] = saved.muted[key];
      if (typeof saved.zoom?.[key] === "number") state.zoom[key] = clampZoom(saved.zoom[key]);
    }
    for (const name of ["notifications", "welcomed", "muteAll", "background", "startup", "restore", "trayHinted"]) {
      if (typeof saved[name] === "boolean") state[name] = saved[name];
    }
    // Keep your saved order; sites added in a newer version go at the end.
    if (Array.isArray(saved.order)) {
      const known = saved.order.filter((k, i) => KEYS.includes(k) && saved.order.indexOf(k) === i);
      state.order = [...known, ...KEYS.filter((k) => !known.includes(k))];
    }
    for (const key of KEYS) {
      if (typeof saved.hidden?.[key] === "boolean") state.hidden[key] = saved.hidden[key];
      if (typeof saved.widths?.[key] === "number") state.widths[key] = clampWidth(saved.widths[key]);
      if (typeof saved.lastUrl?.[key] === "string" && hostMatches(saved.lastUrl[key], SITES[key].hosts)) {
        state.lastUrl[key] = saved.lastUrl[key];
      }
    }
    if (KEYS.every((k) => state.hidden[k])) state.hidden[KEYS[0]] = false;
    if (saved.bounds && onScreen(saved.bounds)) state.bounds = saved.bounds;
  } catch {}
}

function writeSettings() {
  try {
    fs.writeFileSync(settingsFile(), JSON.stringify(state, null, 2));
  } catch {}
}

let saveTimer;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeSettings, 300);
}

function clampWidth(w) {
  return Math.min(3, Math.max(0.4, w));
}

function clampZoom(z) {
  return Math.min(1.5, Math.max(0.5, Math.round(z * 10) / 10));
}

// A saved window position is only reused if it's still on a connected screen.
function onScreen(b) {
  if (![b.x, b.y, b.width, b.height].every(Number.isFinite)) return false;
  return screen.getAllDisplays().some(({ workArea: a }) =>
    b.x < a.x + a.width - 80 && b.x + b.width > a.x + 80 && b.y >= a.y - 10 && b.y < a.y + a.height - 80);
}

// ---------- Live status of each site ----------

const live = {};
for (const key of KEYS) {
  live[key] = {
    painted: false, // the site has shown its page at least once
    failedThisLoad: false,
    error: null, // { kind, code } while the page can't be shown
    retryAt: 0,
    retries: 0,
    retryTimer: null,
    connected: false,
    unread: 0,
  };
}

let win;
const views = {};
let fullscreenKey = null; // a site playing a video full screen
let madeFullScreen = false; // the app went full screen for that video
let overlay = null; // "accounts", "shortcuts", "settings" or "google" while a panel covers the window
let googleKey = null; // the site whose "Continue with Google" was stopped
let activeKey = null; // the site you last clicked or typed in
let laidOut = ""; // window size the sites were last placed for
let online = true;

function allKeys() {
  return state.order.filter((key) => !state.hidden[key]);
}

function shownKeys() {
  return state.mode === "all" ? allKeys() : [state.mode];
}

function currentKey() {
  if (state.mode !== "all") return state.mode;
  return activeKey || KEYS[0];
}

// ---------- Window and site views ----------

function createWindow() {
  const colors = THEME_COLORS[state.theme];
  const isMac = process.platform === "darwin";
  win = new BrowserWindow({
    width: state.bounds?.width || 1600,
    height: state.bounds?.height || 950,
    x: state.bounds?.x,
    y: state.bounds?.y,
    minWidth: 760,
    minHeight: 520,
    title: "Social Hub",
    show: false,
    backgroundColor: colors.bg,
    icon: path.join(__dirname, "build", "icon.png"),
    // The toolbar is the title bar: the window buttons sit inside it.
    titleBarStyle: "hidden",
    ...(isMac
      ? { trafficLightPosition: { x: 18, y: 20 } }
      : { titleBarOverlay: { color: colors.bar, symbolColor: colors.symbol, height: SIZES.toolbar } }),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (state.bounds?.maximized) win.maximize();
  // Opened at sign-in: start quietly in the tray.
  const startHidden = process.argv.includes("--hidden") && state.background;
  win.once("ready-to-show", () => !startHidden && win.show());
  win.loadFile(path.join(__dirname, "ui", "index.html"));

  // The toolbar page never navigates or opens windows itself.
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("before-input-event", (e, input) => {
    if (handleShortcut(input, null)) e.preventDefault();
  });

  if (!state.welcomed) overlay = "accounts";
  for (const key of KEYS) createSiteView(key);

  for (const event of ["resize", "resized", "maximize", "unmaximize", "restore", "enter-full-screen", "leave-full-screen"]) {
    win.on(event, layout);
  }
  win.on("close", (e) => {
    state.bounds = { ...win.getNormalBounds(), maximized: win.isMaximized() };
    if (state.background && tray && !quitting) {
      // Keep running in the tray so alerts keep coming.
      e.preventDefault();
      if (win.isFullScreen()) win.setFullScreen(false);
      win.hide();
      if (!state.trayHinted && Notification.isSupported()) {
        state.trayHinted = true;
        new Notification({
          title: "Social Hub is still running",
          body: "You'll still get alerts. Open it from the tray icon, or right-click it to quit.",
          icon: path.join(__dirname, "build", "icon.png"),
        }).show();
      }
    }
    clearTimeout(saveTimer);
    writeSettings();
  });
  win.on("hide", layout);
  win.on("show", layout);
  win.webContents.on("did-finish-load", layout);
}

function hostMatches(url, hosts) {
  try {
    const host = new URL(url).hostname;
    return hosts.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

function siteForUrl(url) {
  return KEYS.find((key) => hostMatches(url, SITES[key].hosts));
}

function createSiteView(key) {
  const site = SITES[key];
  const partition = `persist:${key}`;
  const ses = session.fromPartition(partition);
  ses.setUserAgent(USER_AGENT);

  // Only what watching needs: full-screen video, copying links and (if you
  // allow it) the site's own desktop notifications.
  const allowed = new Set(["fullscreen", "clipboard-sanitized-write"]);
  const permits = (permission) => allowed.has(permission) || (permission === "notifications" && state.notifications);
  ses.setPermissionRequestHandler((_wc, permission, done) => done(permits(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => permits(permission));

  // Google is pickier than YouTube about which browsers may sign in, so
  // YouTube's sign-in pages are asked for as Firefox. If Google still says
  // no, the app explains and YouTube keeps working without signing in.
  let ready = Promise.resolve();
  if (key === "youtube") {
    // Wait briefly for the ad blocker so the first page already has no ads.
    ready = Promise.race([startAdBlocker(ses), new Promise((done) => setTimeout(done, 4000))]);
    ses.webRequest.onBeforeSendHeaders({ urls: ["https://accounts.google.com/*"] }, (details, done) => {
      done({ requestHeaders: { ...details.requestHeaders, "User-Agent": FIREFOX_UA } });
    });
  }

  // Watch the site's sign-in cookie so the app knows when you're connected.
  let cookieTimer;
  ses.cookies.on("changed", (_e, cookie) => {
    if (cookie.name !== site.account.cookie) return;
    clearTimeout(cookieTimer);
    cookieTimer = setTimeout(() => checkAccount(key), 400);
  });
  checkAccount(key);

  const view = new WebContentsView({
    webPreferences: { partition, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  view.setBackgroundColor(THEME_COLORS[state.theme].bg);
  view.setBorderRadius(SIZES.radius);
  view.setVisible(false);
  views[key] = view;
  win.contentView.addChildView(view);

  const wc = view.webContents;
  wc.setZoomFactor(state.zoom[key]);

  // Sign-in pop-ups stay in the app (sharing this site's login). A link to one
  // of the other sites opens in that site's column; anything else goes to your
  // normal browser.
  wc.setWindowOpenHandler(({ url }) => {
    if (isGoogleSignIn(url) && key !== "youtube") {
      showGoogleHelp(key);
      return { action: "deny" };
    }
    const target = siteForUrl(url);
    if (target && target !== key && !hostMatches(url, SITES[key].hosts)) {
      openIn(target, url);
      return { action: "deny" };
    }
    if (hostMatches(url, LOGIN_HOSTS)) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 520,
          height: 720,
          parent: win,
          autoHideMenuBar: true,
          backgroundColor: "#ffffff",
          webPreferences: { partition, contextIsolation: true, nodeIntegration: false, sandbox: true },
        },
      };
    }
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  // A video played full screen covers the whole screen, not just the window.
  wc.on("enter-html-full-screen", () => {
    fullscreenKey = key;
    wc.focus();
    if (!win.isFullScreen()) {
      madeFullScreen = true;
      win.setFullScreen(true);
    }
    layout();
  });
  wc.on("leave-html-full-screen", () => {
    fullscreenKey = null;
    if (madeFullScreen) {
      madeFullScreen = false;
      win.setFullScreen(false);
    }
    layout();
  });

  wc.on("did-start-loading", () => {
    live[key].failedThisLoad = false;
    sendState();
  });
  wc.on("did-fail-load", (_e, code, _desc, _url, isMainFrame) => {
    // -3 means the load was replaced by another one, which is normal.
    if (!isMainFrame || code === -3) return;
    live[key].failedThisLoad = true;
    showError(key, code === -106 || !online ? "offline" : "unreachable", code);
  });
  wc.on("dom-ready", () => {
    if (live[key].failedThisLoad) return;
    clearError(key);
    live[key].painted = true;
    layout();
  });
  wc.on("render-process-gone", (_e, details) => {
    if (details.reason === "clean-exit") return;
    showError(key, "crashed", details.exitCode);
  });
  wc.on("unresponsive", () => showError(key, "frozen", 0));
  wc.on("responsive", () => {
    if (live[key].error?.kind === "frozen") clearError(key);
    layout();
  });

  for (const event of ["did-stop-loading", "did-navigate", "did-navigate-in-page"]) {
    wc.on(event, sendState);
  }
  // Sites put new messages and alerts in the page title, e.g. "(3) Home / X".
  wc.on("page-title-updated", (_e, title) => {
    const match = /^\((\d+)\+?\)/.exec(title);
    const unread = match ? Number(match[1]) : 0;
    if (unread !== live[key].unread) {
      live[key].unread = unread;
      sendState();
      updateTray();
    }
  });
  // The site you click or type in becomes the one shortcuts act on.
  wc.on("input-event", (_e, input) => {
    if (input.type === "mouseDown" || input.type === "keyDown") setActive(key);
  });
  wc.on("before-input-event", (e, input) => {
    if (handleShortcut(input, key)) e.preventDefault();
  });
  // Keep zoom per site even when the page changes it.
  wc.on("did-finish-load", () => wc.setZoomFactor(state.zoom[key]));
  wc.on("context-menu", (_e, params) => showContextMenu(key, params));

  // Remember the page you're on, so the app can reopen it next time.
  const remember = (url) => {
    if (!hostMatches(url, site.hosts) || /\/(login|accounts\/login|i\/flow)/.test(url)) return;
    state.lastUrl[key] = url;
    saveSettings();
  };
  wc.on("did-navigate", (_e, url) => remember(url));
  wc.on("did-navigate-in-page", (_e, url, isMainFrame) => isMainFrame && remember(url));

  ready.then(() => wc.loadURL((state.restore && state.lastUrl[key]) || site.home));
}

async function checkAccount(key) {
  const { url, cookie } = SITES[key].account;
  let connected = false;
  try {
    const found = await session.fromPartition(`persist:${key}`).cookies.get({ url, name: cookie });
    connected = found.some((c) => c.value);
  } catch {}
  const was = live[key].connected;
  live[key].connected = connected;
  if (connected !== was) {
    if (connected && win) toast(`${SITES[key].name} connected`);
    sendState();
  }
}

function setActive(key) {
  if (activeKey === key) return;
  activeKey = key;
  sendState();
}

function openIn(key, url) {
  if (state.mode !== "all" && state.mode !== key) state.mode = key;
  overlay = null;
  activeKey = key;
  views[key].webContents.loadURL(url);
  saveSettings();
  layout();
  views[key].webContents.focus();
}

// ---------- Errors and retrying ----------

function showError(key, kind, code) {
  const l = live[key];
  clearTimeout(l.retryTimer);
  l.error = { kind, code };
  if (kind === "unreachable" || kind === "offline") {
    const delay = RETRY_DELAYS[Math.min(l.retries, RETRY_DELAYS.length - 1)];
    l.retries += 1;
    l.retryAt = Date.now() + delay * 1000;
    l.retryTimer = setTimeout(() => retry(key), delay * 1000);
  } else {
    l.retryAt = 0;
  }
  layout();
}

function clearError(key) {
  const l = live[key];
  clearTimeout(l.retryTimer);
  l.error = null;
  l.retries = 0;
  l.retryAt = 0;
}

function retry(key) {
  const l = live[key];
  clearTimeout(l.retryTimer);
  l.retryAt = 0;
  const wc = views[key].webContents;
  if (l.error?.kind === "crashed" || !wc.getURL() || wc.getURL().startsWith("chrome-error:")) {
    wc.loadURL(SITES[key].home);
  } else {
    wc.reload();
  }
  sendState();
}

// ---------- Placing the sites ----------

function paneRects(W, H) {
  const shown = shownKeys();
  const n = shown.length;
  const { toolbar, rail, head, headGap, gap } = SIZES;
  const room = W - rail - gap * (n + 1);
  const total = shown.reduce((sum, key) => sum + (n > 1 ? state.widths[key] : 1), 0);
  const top = toolbar + gap;
  const bodyTop = top + head + headGap;
  const rects = {};
  let x = rail + gap;
  shown.forEach((key, i) => {
    // The last column takes any leftover pixels.
    const width = i === n - 1 ? W - gap - x : Math.floor((room * (n > 1 ? state.widths[key] : 1)) / total);
    rects[key] = { x, width, bodyTop, bodyHeight: Math.max(0, H - bodyTop - gap) };
    x += width + gap;
  });
  return rects;
}

// Places each visible site under its header. A site stays hidden until its
// page has drawn, while it shows an error, or while a panel covers the window.
// Hidden sites are muted so they don't play sound in the background.
function layout() {
  if (!win) return;
  const [W, H] = win.getContentSize();
  laidOut = `${W}x${H}`;
  const rects = paneRects(W, H);

  for (const key of KEYS) {
    const view = views[key];
    const rect = rects[key];
    let visible = !!rect;
    if (fullscreenKey) {
      visible = key === fullscreenKey;
      if (visible) view.setBounds({ x: 0, y: 0, width: W, height: H });
      view.setBorderRadius(0);
    } else {
      if (visible) view.setBounds({ x: rect.x, y: rect.bodyTop, width: rect.width, height: rect.bodyHeight });
      view.setBorderRadius(SIZES.radius);
    }
    const drawable = live[key].painted && !live[key].error && (!overlay || fullscreenKey);
    view.setVisible(visible && drawable);
    // Closing to the tray silences everything.
    view.webContents.setAudioMuted(state.muted[key] || state.muteAll || !visible || !win.isVisible());
  }
  sendState();
}

function sendState() {
  if (!win || win.webContents.isLoading()) return;
  const [W, H] = win.getContentSize();
  // Some systems don't report every resize; if the size changed, re-place the sites.
  if (`${W}x${H}` !== laidOut) return layout();
  const rects = paneRects(W, H);

  win.webContents.send("state", {
    platform: process.platform,
    mode: state.mode,
    theme: state.theme,
    notifications: state.notifications,
    welcomed: state.welcomed,
    muteAll: state.muteAll,
    order: state.order,
    hidden: state.hidden,
    allCount: allKeys().length,
    settings: { background: state.background, startup: state.startup, restore: state.restore },
    overlay,
    googleSite: googleKey,
    online,
    active: state.mode === "all" ? activeKey : null,
    fullscreen: !!fullscreenKey,
    sizes: SIZES,
    panes: KEYS.map((key) => {
      const wc = views[key].webContents;
      const l = live[key];
      const rect = rects[key];
      return {
        key,
        name: SITES[key].name,
        visible: !!rect,
        x: rect?.x ?? 0,
        width: rect?.width ?? 0,
        muted: state.muted[key],
        zoom: state.zoom[key],
        share: state.widths[key],
        videoFeed: isVideoFeed(key, wc.getURL()),
        savedLabel: SAVED[key].label,
        loading: wc.isLoading(),
        painted: l.painted,
        error: l.error,
        retryAt: l.retryAt,
        connected: l.connected,
        unread: l.unread,
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
      };
    }),
  });
}

function toast(text) {
  win?.webContents.send("toast", text);
}

// ---------- Ad blocker (YouTube) ----------

// Ghostery's free, open-source blocker with the EasyList and uBlock Origin
// lists. The lists are kept on this computer and refreshed once a day; if they
// can't be downloaded, the last saved copy is used, and if there is none
// YouTube simply works as usual.
const DAY = 24 * 60 * 60 * 1000;

async function startAdBlocker(ses) {
  const file = path.join(app.getPath("userData"), "adblock-lists.bin");
  const saved = () => fs.promises.readFile(file).then((data) => ElectronBlocker.deserialize(data));
  let blocker;
  try {
    if (Date.now() - fs.statSync(file).mtimeMs < DAY) blocker = await saved();
  } catch {}
  if (!blocker) {
    try {
      blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking((url) => net.fetch(url));
      fs.promises.writeFile(file, blocker.serialize()).catch(() => {});
    } catch {
      blocker = await saved().catch(() => null);
    }
  }
  if (!blocker) return;
  // Electron 33 only has the older way to add a page script; the blocker uses
  // it to hide ad boxes on the page.
  if (!ses.registerPreloadScript) {
    ses.registerPreloadScript = ({ filePath }) => (ses.setPreloads([...ses.getPreloads(), filePath]), filePath);
    ses.unregisterPreloadScript = (filePath) => ses.setPreloads(ses.getPreloads().filter((p) => p !== filePath));
  }
  blocker.enableBlockingInSession(ses);
}

// Night turns the sites dark too: they follow the app as if it were the
// computer's own dark mode. X keeps its own setting, so it's told directly.
function applySiteTheme() {
  nativeTheme.themeSource = state.theme === "night" ? "dark" : "light";
  session.fromPartition("persist:x").cookies.set({
    url: "https://x.com",
    domain: ".x.com",
    name: "night_mode",
    value: state.theme === "night" ? "2" : "0",
    secure: true,
    expirationDate: Date.now() / 1000 + 365 * 24 * 60 * 60,
  }).catch(() => {});
}

function setTheme(theme) {
  state.theme = theme;
  applySiteTheme();
  const colors = THEME_COLORS[theme];
  win.setBackgroundColor(colors.bg);
  if (process.platform !== "darwin") {
    try {
      win.setTitleBarOverlay({ color: colors.bar, symbolColor: colors.symbol, height: SIZES.toolbar });
    } catch {}
  }
  for (const key of KEYS) views[key].setBackgroundColor(colors.bg);
  saveSettings();
  sendState();
}

function setMode(mode) {
  if (mode !== "all" && !KEYS.includes(mode)) return;
  state.mode = mode;
  if (mode !== "all") activeKey = mode;
  saveSettings();
  layout();
}

function setOverlay(name) {
  overlay = name;
  layout();
}

function showGoogleHelp(key) {
  googleKey = key;
  if (state.mode !== "all" && state.mode !== key) state.mode = key;
  setOverlay("google");
  if (win && !win.isVisible()) showWindow();
}

// Which site a web page belongs to, by its saved login (its session).
function siteForSession(ses) {
  return KEYS.find((key) => session.fromPartition(`persist:${key}`) === ses);
}

// Ctrl+Tab: All, then each site in column order.
function cycleMode(step) {
  const modes = ["all", ...state.order];
  const i = modes.indexOf(state.mode);
  setMode(modes[(i + step + modes.length) % modes.length]);
}

function setMuteAll(on) {
  state.muteAll = on;
  saveSettings();
  layout();
  updateTray();
}

// ---------- Running in the background ----------

let tray = null;
let quitting = false;
let unreadTotal = 0;

function showWindow(mode) {
  if (!win) return;
  if (mode) setMode(mode);
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createTray() {
  if (tray || process.platform === "darwin") return;
  const icon = nativeImage.createFromPath(path.join(__dirname, "build", "icon.png")).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.on("click", () => showWindow());
  updateTray();
}

function updateTray(image) {
  if (!tray) return;
  if (image) tray.setImage(image);
  tray.setToolTip(unreadTotal ? `Social Hub: ${unreadTotal} new` : "Social Hub");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Social Hub", click: () => showWindow() },
    { type: "separator" },
    ...state.order.map((key) => ({
      label: live[key].unread ? `${SITES[key].name} (${live[key].unread} new)` : SITES[key].name,
      click: () => showWindow(key),
    })),
    { type: "separator" },
    { label: "Mute all sound", type: "checkbox", checked: state.muteAll, click: (item) => setMuteAll(item.checked) },
    { label: "Settings", click: () => (showWindow(), setOverlay("settings")) },
    { type: "separator" },
    { label: "Quit Social Hub", click: () => app.quit() },
  ]));
}

// Open at sign-in, straight to the tray. The portable app points Windows at
// its own .exe rather than the temporary copy it runs from.
function applyStartup() {
  if (process.platform === "linux") return;
  try {
    app.setLoginItemSettings({
      openAtLogin: state.startup,
      path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath,
      args: ["--hidden"],
    });
  } catch {}
}

function setSetting(name, value) {
  if (!["background", "startup", "restore"].includes(name) || typeof value !== "boolean") return;
  state[name] = value;
  if (name === "startup") applyStartup();
  if (name === "background") value ? createTray() : (tray?.destroy(), (tray = null));
  saveSettings();
  sendState();
}

// ---------- Site actions ----------

function paneAction(key, action) {
  const view = views[key];
  if (!view) return;
  const wc = view.webContents;
  const zoomTo = (z) => {
    state.zoom[key] = clampZoom(z);
    wc.setZoomFactor(state.zoom[key]);
    saveSettings();
    sendState();
  };
  switch (action) {
    case "back":
      if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
      break;
    case "forward":
      if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
      break;
    case "reload":
      if (live[key].error) retry(key);
      else wc.reload();
      break;
    case "home":
      wc.loadURL(SITES[key].home);
      break;
    case "retry":
      retry(key);
      break;
    case "mute":
      state.muted[key] = !state.muted[key];
      saveSettings();
      layout();
      break;
    case "zoom-in":
      zoomTo(state.zoom[key] + 0.1);
      break;
    case "zoom-out":
      zoomTo(state.zoom[key] - 0.1);
      break;
    case "zoom-reset":
      zoomTo(1);
      break;
    case "connect":
      openIn(key, SITES[key].login);
      break;
    case "sign-out":
      signOut(key);
      break;
    case "open-external":
      if (/^https?:\/\//.test(wc.getURL())) shell.openExternal(wc.getURL());
      break;
    case "open-chrome":
      openInChrome(hostMatches(wc.getURL(), SITES[key].hosts) ? wc.getURL() : SITES[key].home);
      // The video carries on in Chrome, so stop it here.
      wc.executeJavaScript(`document.querySelectorAll("video").forEach((v) => v.pause())`).catch(() => {});
      break;
    case "copy-link":
      if (/^https?:\/\//.test(wc.getURL())) {
        clipboard.writeText(wc.getURL());
        toast("Link copied");
      }
      break;
    case "menu":
      showPaneMenu(key);
      break;
    case "next-video":
    case "prev-video":
      wc.executeJavaScript(STEP_VIDEO(action === "next-video" ? 1 : -1)).catch(() => {});
      break;
    case "video-fullscreen":
      // Counts as your click, so the page may go full screen.
      wc.executeJavaScript(VIDEO_FULLSCREEN, true)
        .then((ok) => !ok && toast("Start a video first"))
        .catch(() => toast("Start a video first"));
      break;
    case "saved":
      openSaved(key);
      break;
  }
}

// ---------- Google Chrome ----------

// Chrome on this computer, if it's installed in one of the usual places.
function findChrome() {
  const env = process.env;
  const places = {
    win32: [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA]
      .filter(Boolean)
      .map((dir) => path.join(dir, "Google", "Chrome", "Application", "chrome.exe")),
    darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
    linux: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"],
  }[process.platform] || [];
  return places.find((file) => fs.existsSync(file));
}

// Opens a page in your own Chrome, with your Google account and your
// extensions (such as an ad blocker). Without Chrome, your normal browser.
function openInChrome(url) {
  const chrome = findChrome();
  if (!chrome) {
    shell.openExternal(url);
    toast("Chrome isn't installed, so it opened in your browser");
    return;
  }
  try {
    spawn(chrome, ["--new-window", url], { detached: true, stdio: "ignore" }).unref();
    toast("Opened in Chrome");
  } catch {
    shell.openExternal(url);
  }
}

async function openSaved(key) {
  const { label } = SAVED[key];
  if (!live[key].connected) {
    toast(`Connect your ${SITES[key].name} account to see your ${label.toLowerCase()}`);
    return paneAction(key, "connect");
  }
  let url = SAVED[key].url;
  if (key === "instagram") {
    // Instagram's saved page is under your username; ask Instagram for it.
    const wc = views[key].webContents;
    const name = hostMatches(wc.getURL(), SITES.instagram.hosts)
      ? await wc.executeJavaScript(`fetch("/api/v1/accounts/current_user/?edit=true", {
          headers: { "x-ig-app-id": "936619743392459" }, credentials: "include",
        }).then((r) => r.json()).then((j) => j.user && j.user.username).catch(() => null)`).catch(() => null)
      : null;
    if (typeof name === "string" && /^[\w.]+$/.test(name)) url = `https://www.instagram.com/${name}/saved/`;
    else {
      toast("Open your profile, then tap Saved");
      url = SITES.instagram.home;
    }
  }
  openIn(key, url);
  if (key === "tiktok") {
    toast("Your saved videos are under Favorites");
    // Open the Favorites tab on your profile once it has loaded.
    views.tiktok.webContents.once("did-finish-load", () => {
      views.tiktok.webContents.executeJavaScript(`(() => {
        let tries = 0;
        const t = setInterval(() => {
          const tab = document.querySelector('[data-e2e="favorites-tab"]');
          if (tab) tab.click();
          if (tab || ++tries > 20) clearInterval(t);
        }, 400);
      })()`).catch(() => {});
    });
  }
}

async function signOut(key) {
  const { name } = SITES[key];
  const { response } = await dialog.showMessageBox(win, {
    type: "question",
    buttons: ["Sign out", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    title: "Sign out",
    message: `Sign out of ${name} in Social Hub?`,
    detail: `This removes your ${name} login from this app only. Your account and other devices aren't affected.`,
  });
  if (response !== 0) return;
  const ses = session.fromPartition(`persist:${key}`);
  await ses.clearStorageData();
  await ses.clearCache();
  live[key].unread = 0;
  await checkAccount(key);
  views[key].webContents.loadURL(SITES[key].home);
  toast(`Signed out of ${name}`);
}

function showPaneMenu(key) {
  const z = state.zoom[key];
  const connected = live[key].connected;
  Menu.buildFromTemplate([
    { label: `Your ${SAVED[key].label.toLowerCase()}`, click: () => paneAction(key, "saved") },
    { label: "Play video full screen", click: () => paneAction(key, "video-fullscreen") },
    ...(key === "youtube" ? [{ label: "Watch in Chrome (with your extensions)", click: () => paneAction(key, "open-chrome") }] : []),
    { type: "separator" },
    { label: "Zoom in", accelerator: "CmdOrCtrl+=", enabled: z < 1.5, click: () => paneAction(key, "zoom-in") },
    { label: "Zoom out", accelerator: "CmdOrCtrl+-", enabled: z > 0.5, click: () => paneAction(key, "zoom-out") },
    { label: `Actual size (now ${Math.round(z * 100)}%)`, accelerator: "CmdOrCtrl+0", enabled: z !== 1, click: () => paneAction(key, "zoom-reset") },
    { type: "separator" },
    { label: "Copy page link", click: () => paneAction(key, "copy-link") },
    { label: "Open in your browser", click: () => paneAction(key, "open-external") },
    { type: "separator" },
    connected
      ? { label: `Sign out of ${SITES[key].name}…`, click: () => paneAction(key, "sign-out") }
      : { label: `Connect your ${SITES[key].name} account`, click: () => paneAction(key, "connect") },
  ]).popup({ window: win });
}

// Right-click menu inside a site, like in a normal browser.
function showContextMenu(key, p) {
  const wc = views[key].webContents;
  const items = [];
  const sep = () => items.length && items[items.length - 1].type !== "separator" && items.push({ type: "separator" });

  if (p.misspelledWord) {
    for (const word of p.dictionarySuggestions.slice(0, 5)) {
      items.push({ label: word, click: () => wc.replaceMisspelling(word) });
    }
    if (!p.dictionarySuggestions.length) items.push({ label: "No suggestions", enabled: false });
    items.push({ label: "Add to dictionary", click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) });
    sep();
  }
  if (p.linkURL && /^https?:\/\//.test(p.linkURL)) {
    items.push({ label: "Open link in your browser", click: () => shell.openExternal(p.linkURL) });
    items.push({ label: "Copy link address", click: () => clipboard.writeText(p.linkURL) });
    sep();
  }
  if (p.mediaType === "image" && p.srcURL) {
    items.push({ label: "Copy image", click: () => wc.copyImageAt(p.x, p.y) });
    items.push({ label: "Copy image address", click: () => clipboard.writeText(p.srcURL) });
    sep();
  }
  if (p.isEditable) {
    items.push(
      { label: "Undo", accelerator: "CmdOrCtrl+Z", enabled: p.editFlags.canUndo, click: () => wc.undo() },
      { label: "Redo", accelerator: "CmdOrCtrl+Y", enabled: p.editFlags.canRedo, click: () => wc.redo() },
      { type: "separator" },
      { label: "Cut", accelerator: "CmdOrCtrl+X", enabled: p.editFlags.canCut, click: () => wc.cut() },
      { label: "Copy", accelerator: "CmdOrCtrl+C", enabled: p.editFlags.canCopy, click: () => wc.copy() },
      { label: "Paste", accelerator: "CmdOrCtrl+V", enabled: p.editFlags.canPaste, click: () => wc.paste() },
      { label: "Select all", accelerator: "CmdOrCtrl+A", click: () => wc.selectAll() },
    );
  } else {
    if (p.selectionText.trim()) {
      items.push({ label: "Copy", accelerator: "CmdOrCtrl+C", click: () => wc.copy() });
      sep();
    }
    items.push(
      { label: "Back", accelerator: "Alt+Left", enabled: wc.navigationHistory.canGoBack(), click: () => paneAction(key, "back") },
      { label: "Forward", accelerator: "Alt+Right", enabled: wc.navigationHistory.canGoForward(), click: () => paneAction(key, "forward") },
      { label: "Reload", accelerator: "CmdOrCtrl+R", click: () => paneAction(key, "reload") },
      { type: "separator" },
      { label: "Copy page link", click: () => paneAction(key, "copy-link") },
      { label: "Open page in your browser", click: () => paneAction(key, "open-external") },
    );
  }
  Menu.buildFromTemplate(items).popup({ window: win });
}

// ---------- Keyboard shortcuts (work wherever you're typing) ----------

function handleShortcut(input, sourceKey) {
  if (input.type !== "keyDown") return false;
  const mod = input.control || input.meta;
  const k = input.key;
  const target = sourceKey || currentKey();

  // Esc always leaves a full-screen video, wherever the keyboard is.
  if (k === "Escape" && fullscreenKey) {
    views[fullscreenKey].webContents.executeJavaScript("document.fullscreenElement && document.exitFullscreen()").catch(() => {});
    return true;
  }
  if (k === "Escape" && overlay) {
    if (overlay === "accounts") {
      state.welcomed = true;
      saveSettings();
    }
    return setOverlay(null), true;
  }
  if (mod && !input.shift && !input.alt) {
    if (k >= "1" && k <= String(KEYS.length + 1)) return setMode(["all", ...KEYS][Number(k) - 1]), true;
    if (k === "r") return paneAction(target, "reload"), true;
    if (k === "=" || k === "+") return paneAction(target, "zoom-in"), true;
    if (k === "-") return paneAction(target, "zoom-out"), true;
    if (k === "0") return paneAction(target, "zoom-reset"), true;
    if (k === "m") return paneAction(target, "mute"), true;
    if (k === "/") return setOverlay(overlay === "shortcuts" ? null : "shortcuts"), true;
    if (k === ",") return setOverlay(overlay === "settings" ? null : "settings"), true;
    if (k === "Tab") return cycleMode(1), true;
  }
  if (mod && input.shift && k === "Tab") return cycleMode(-1), true;
  if (mod && input.shift && !input.alt) {
    if (k === "R") return KEYS.forEach((key) => paneAction(key, "reload")), true;
    if (k === "L") return setTheme(state.theme === "night" ? "day" : "night"), true;
    if (k === "A") return setOverlay(overlay === "accounts" ? null : "accounts"), true;
    if (k === "M") return setMuteAll(!state.muteAll), true;
  }
  // Instagram's reels don't move with the arrow keys; make them (unless
  // you're typing, e.g. a comment).
  if (sourceKey === "instagram" && !mod && !input.alt && !input.shift && (k === "ArrowDown" || k === "ArrowUp")
      && isVideoFeed("instagram", views.instagram.webContents.getURL())) {
    const step = STEP_VIDEO(k === "ArrowDown" ? 1 : -1);
    views.instagram.webContents.executeJavaScript(`(() => {
      const a = document.activeElement;
      if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
      ${step};
    })()`).catch(() => {});
    return false; // the key still reaches the page, e.g. to move the cursor in a comment
  }
  if (input.alt && !mod && !input.shift) {
    if (k === "ArrowDown") return paneAction(target, "next-video"), true;
    if (k === "ArrowUp") return paneAction(target, "prev-video"), true;
    if (k === "ArrowLeft") return paneAction(target, "back"), true;
    if (k === "ArrowRight") return paneAction(target, "forward"), true;
    if (k === "Home") return paneAction(target, "home"), true;
  }
  if (!mod && !input.alt) {
    if (k === "F5") return paneAction(target, "reload"), true;
    if (k === "F1") return setOverlay("shortcuts"), true;
    if (k === "F11" && !fullscreenKey) return win.setFullScreen(!win.isFullScreen()), true;
  }
  return false;
}

// ---------- Toolbar requests ----------

ipcMain.on("set-mode", (_e, mode) => setMode(mode));

ipcMain.on("set-theme", (_e, theme) => {
  if (theme === "day" || theme === "night") setTheme(theme);
});

ipcMain.on("pane", (_e, key, action) => paneAction(key, action));

ipcMain.on("overlay", (_e, name) => {
  if (name === null || ["accounts", "shortcuts", "settings"].includes(name)) setOverlay(name);
});

// From the Google help panel: go to the site's own login page, or open it in
// the computer's normal browser.
ipcMain.on("google-help", (_e, action) => {
  const key = googleKey;
  if (!key) return;
  if (action === "login") {
    if (key === "youtube") openIn(key, SITES.youtube.home);
    else paneAction(key, "connect");
  }
  if (action === "browser") {
    if (key === "youtube") openInChrome(SITES.youtube.home);
    else shell.openExternal(SITES[key].login);
    setOverlay(null);
  }
});

ipcMain.on("welcomed", () => {
  state.welcomed = true;
  saveSettings();
  setOverlay(null);
});

ipcMain.on("set-notifications", (_e, on) => {
  state.notifications = !!on;
  saveSettings();
  sendState();
});

ipcMain.on("online", (_e, isOnline) => {
  online = !!isOnline;
  // Back online: try any site that couldn't load right away.
  if (online) for (const key of KEYS) if (live[key].error) retry(key);
  sendState();
});

// The taskbar icon shows how many new alerts are waiting across all sites.
ipcMain.on("badge", (_e, count, dataUrl, trayUrl) => {
  if (!win || !Number.isInteger(count)) return;
  unreadTotal = count;
  if (typeof trayUrl === "string" && trayUrl.startsWith("data:image/png")) updateTray(nativeImage.createFromDataURL(trayUrl));
  else updateTray();
  if (process.platform === "win32") {
    const image = count > 0 && typeof dataUrl === "string" && dataUrl.startsWith("data:image/png")
      ? nativeImage.createFromDataURL(dataUrl) : null;
    win.setOverlayIcon(image, count > 0 ? `${count} new` : "");
  } else {
    app.setBadgeCount(count);
  }
});

ipcMain.on("set-setting", (_e, name, value) => setSetting(name, value));

ipcMain.on("mute-all", (_e, on) => setMuteAll(!!on));

ipcMain.on("set-order", (_e, order) => {
  if (!Array.isArray(order) || order.length !== KEYS.length || !KEYS.every((k) => order.includes(k))) return;
  state.order = order;
  saveSettings();
  layout();
  updateTray();
});

ipcMain.on("set-hidden", (_e, key, hide) => {
  if (!KEYS.includes(key)) return;
  // The All view always keeps at least one site.
  if (hide && allKeys().length <= 1) return sendState();
  state.hidden[key] = !!hide;
  saveSettings();
  layout();
});

// Dragging the space between two columns: weights for each shown site.
ipcMain.on("set-widths", (_e, widths) => {
  if (!widths || typeof widths !== "object") return;
  for (const key of KEYS) {
    if (typeof widths[key] === "number" && Number.isFinite(widths[key])) state.widths[key] = clampWidth(widths[key]);
  }
  saveSettings();
  layout();
});

ipcMain.on("reset-widths", () => {
  for (const key of KEYS) state.widths[key] = 1;
  saveSettings();
  layout();
});

ipcMain.on("ready", sendState);

// ---------- Start ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());

  // Nothing inside the app may embed other pages or open unknown windows.
  app.on("web-contents-created", (_e, contents) => {
    contents.on("will-attach-webview", (e) => e.preventDefault());
    // A site or sign-in pop-up heading to Google's sign-in page: stop there
    // and explain, instead of showing Google's "may not be secure" block.
    const stopGoogle = (e, url, isInPlace, isMainFrame) => {
      if (isMainFrame === false || !isGoogleSignIn(url)) return;
      const key = siteForSession(contents.session);
      if (!key || (key === "youtube" && !isGoogleRejection(url))) return;
      e.preventDefault();
      if (contents.getType() === "window") contents.close();
      else if (key === "youtube") contents.loadURL(SITES.youtube.home);
      showGoogleHelp(key);
    };
    contents.on("will-navigate", (e, url) => stopGoogle(e, url));
    contents.on("will-redirect", stopGoogle);
    contents.on("did-navigate", (_e, url) => {
      if (!isGoogleRejection(url) || siteForSession(contents.session) !== "youtube") return;
      contents.loadURL(SITES.youtube.home);
      showGoogleHelp("youtube");
    });
  });

  app.whenReady().then(() => {
    // Windows and Linux don't need the default menu; macOS keeps it for copy/paste.
    if (process.platform !== "darwin") Menu.setApplicationMenu(null);
    loadSettings();
    applySiteTheme();
    createWindow();
    if (state.background) createTray();
    applyStartup();
  });

  app.on("before-quit", () => {
    quitting = true;
  });
  app.on("window-all-closed", () => app.quit());
}
