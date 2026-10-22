// Social Hub desktop app: the real TikTok, Instagram and X side by side in one
// window, each logged in to your own account.
//
// A website can't do this (the sites refuse to run logged in inside another
// page), but an app can show each site in its own browser view. Every view
// keeps its own saved login, so you sign in once and stay signed in.

const { app, BrowserWindow, WebContentsView, ipcMain, shell, session, Menu } = require("electron");
const fs = require("fs");
const path = require("path");

const SITES = {
  tiktok: { name: "TikTok", home: "https://www.tiktok.com/foryou" },
  instagram: { name: "Instagram", home: "https://www.instagram.com/" },
  x: { name: "X", home: "https://x.com/home" },
};
const KEYS = Object.keys(SITES);

// Layout sizes in pixels, shared with the window's toolbar (ui/ui.js).
const TOOLBAR_H = 56;
const HEAD_H = 40;
const GAP = 8;

// Sign-in pages a site may open in a pop-up (e.g. "Log in with Apple").
const LOGIN_HOSTS = [
  "tiktok.com", "instagram.com", "x.com", "twitter.com",
  "facebook.com", "accounts.google.com", "appleid.apple.com", "login.live.com",
];

// The sites block or limit unknown browsers, so present the app as the plain
// Chrome it's built on.
const PLATFORM_UA = {
  win32: "Windows NT 10.0; Win64; x64",
  darwin: "Macintosh; Intel Mac OS X 10_15_7",
  linux: "X11; Linux x86_64",
}[process.platform] || "Windows NT 10.0; Win64; x64";
const USER_AGENT = `Mozilla/5.0 (${PLATFORM_UA}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
app.userAgentFallback = USER_AGENT;

// ---------- Saved settings ----------

const settingsFile = () => path.join(app.getPath("userData"), "settings.json");

const state = {
  mode: "all", // "all" or one site key
  theme: "day",
  muted: { tiktok: false, instagram: true, x: true },
  zoom: { tiktok: 1, instagram: 1, x: 1 },
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
    if (saved.bounds) state.bounds = saved.bounds;
  } catch {}
}

let saveTimer;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(settingsFile(), JSON.stringify(state, null, 2));
    } catch {}
  }, 300);
}

function clampZoom(z) {
  return Math.min(1.5, Math.max(0.5, Math.round(z * 10) / 10));
}

// ---------- Window and site views ----------

let win;
const views = {};
let fullscreenKey = null; // a site playing a video full screen
let laidOut = ""; // window size the sites were last placed for

function createWindow() {
  win = new BrowserWindow({
    width: state.bounds?.width || 1600,
    height: state.bounds?.height || 950,
    x: state.bounds?.x,
    y: state.bounds?.y,
    minWidth: 720,
    minHeight: 480,
    title: "Social Hub",
    backgroundColor: "#0f3b2a",
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (state.bounds?.maximized) win.maximize();
  win.loadFile(path.join(__dirname, "ui", "index.html"));

  for (const key of KEYS) createSiteView(key);

  for (const event of ["resize", "resized", "maximize", "unmaximize", "restore", "enter-full-screen", "leave-full-screen"]) {
    win.on(event, layout);
  }
  win.on("close", () => {
    state.bounds = { ...win.getNormalBounds(), maximized: win.isMaximized() };
    clearTimeout(saveTimer);
    try {
      fs.writeFileSync(settingsFile(), JSON.stringify(state, null, 2));
    } catch {}
  });
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

function createSiteView(key) {
  const partition = `persist:${key}`;
  const ses = session.fromPartition(partition);
  ses.setUserAgent(USER_AGENT);
  // Only what watching needs: full-screen video and copying links.
  const allowed = new Set(["fullscreen", "clipboard-sanitized-write"]);
  ses.setPermissionRequestHandler((_wc, permission, done) => done(allowed.has(permission)));

  const view = new WebContentsView({
    webPreferences: { partition, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  view.setBackgroundColor("#000000");
  views[key] = view;
  win.contentView.addChildView(view);

  const wc = view.webContents;
  wc.setZoomFactor(state.zoom[key]);

  // Sign-in pop-ups stay in the app (sharing this site's login); any other
  // link that opens a new window goes to your normal browser.
  wc.setWindowOpenHandler(({ url }) => {
    if (hostMatches(url, LOGIN_HOSTS)) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 520,
          height: 720,
          parent: win,
          webPreferences: { partition, contextIsolation: true, nodeIntegration: false, sandbox: true },
        },
      };
    }
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  wc.on("enter-html-full-screen", () => {
    fullscreenKey = key;
    layout();
  });
  wc.on("leave-html-full-screen", () => {
    fullscreenKey = null;
    layout();
  });
  for (const event of ["did-start-loading", "did-stop-loading", "did-navigate", "did-navigate-in-page"]) {
    wc.on(event, sendState);
  }
  // Keep zoom per site even when the page changes it.
  wc.on("did-finish-load", () => wc.setZoomFactor(state.zoom[key]));

  wc.loadURL(SITES[key].home);
}

// Places each visible site under its header; hidden sites are muted so they
// don't play sound in the background.
function layout() {
  if (!win) return;
  const [W, H] = win.getContentSize();
  laidOut = `${W}x${H}`;
  const shown = state.mode === "all" ? KEYS : [state.mode];
  const n = shown.length;
  const width = Math.floor((W - GAP * (n + 1)) / n);
  const top = TOOLBAR_H + GAP + HEAD_H;
  const height = Math.max(0, H - top - GAP);

  for (const key of KEYS) {
    const view = views[key];
    const i = shown.indexOf(key);
    let visible = i >= 0;
    if (fullscreenKey) {
      visible = key === fullscreenKey;
      if (visible) view.setBounds({ x: 0, y: 0, width: W, height: H });
    } else if (visible) {
      const x = GAP + i * (width + GAP);
      // The last column takes any leftover pixels.
      view.setBounds({ x, y: top, width: i === n - 1 ? W - GAP - x : width, height });
    }
    view.setVisible(visible);
    view.webContents.setAudioMuted(state.muted[key] || !visible);
  }
  sendState();
}

function sendState() {
  if (!win || win.webContents.isLoading()) return;
  const [W, H] = win.getContentSize();
  // Some systems don't report every resize; if the size changed, re-place the sites.
  if (`${W}x${H}` !== laidOut) return layout();
  const shown = state.mode === "all" ? KEYS : [state.mode];
  const n = shown.length;
  const width = Math.floor((W - GAP * (n + 1)) / n);

  win.webContents.send("state", {
    mode: state.mode,
    theme: state.theme,
    fullscreen: !!fullscreenKey,
    sizes: { toolbar: TOOLBAR_H, head: HEAD_H, gap: GAP },
    panes: KEYS.map((key) => {
      const i = shown.indexOf(key);
      const wc = views[key].webContents;
      const x = GAP + Math.max(i, 0) * (width + GAP);
      return {
        key,
        name: SITES[key].name,
        visible: i >= 0,
        x,
        width: i === n - 1 ? W - GAP - x : width,
        muted: state.muted[key],
        zoom: state.zoom[key],
        loading: wc.isLoading(),
        canGoBack: wc.navigationHistory.canGoBack(),
      };
    }),
  });
}

// ---------- Toolbar actions ----------

ipcMain.on("set-mode", (_e, mode) => {
  if (mode !== "all" && !KEYS.includes(mode)) return;
  state.mode = mode;
  saveSettings();
  layout();
});

ipcMain.on("set-theme", (_e, theme) => {
  if (theme !== "day" && theme !== "night") return;
  state.theme = theme;
  saveSettings();
  sendState();
});

ipcMain.on("pane", (_e, key, action) => {
  const view = views[key];
  if (!view) return;
  const wc = view.webContents;
  switch (action) {
    case "back":
      if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
      break;
    case "reload":
      wc.reload();
      break;
    case "home":
      wc.loadURL(SITES[key].home);
      break;
    case "mute":
      state.muted[key] = !state.muted[key];
      saveSettings();
      layout();
      break;
    case "zoom-in":
    case "zoom-out":
      state.zoom[key] = clampZoom(state.zoom[key] + (action === "zoom-in" ? 0.1 : -0.1));
      wc.setZoomFactor(state.zoom[key]);
      saveSettings();
      sendState();
      break;
  }
});

ipcMain.on("ready", sendState);

// ---------- Start ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    // Windows and Linux don't need the default menu; macOS keeps it for copy/paste.
    if (process.platform !== "darwin") Menu.setApplicationMenu(null);
    loadSettings();
    createWindow();
  });

  app.on("window-all-closed", () => app.quit());
}
