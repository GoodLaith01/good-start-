// Social Hub desktop app: the real TikTok, Instagram and X side by side in one
// window, each logged in to your own account.
//
// A website can't do this (the sites refuse to run logged in inside another
// page), but an app can show each site in its own browser view. Every view
// keeps its own saved login, so you sign in once and stay signed in. You sign
// in on each site's own login page, so the app never sees your password.

const {
  app, BrowserWindow, WebContentsView, ipcMain, shell, session, Menu, dialog,
  nativeImage, screen, clipboard,
} = require("electron");
const fs = require("fs");
const path = require("path");

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
};
const KEYS = Object.keys(SITES);

// Layout sizes in pixels, shared with the window's toolbar (ui/ui.js).
const SIZES = { toolbar: 56, head: 42, headGap: 6, gap: 10, radius: 14 };

// Window colors per theme, so the title bar and first paint match the page.
const THEME_COLORS = {
  day: { bg: "#0f3b2a", bar: "#164a34", symbol: "#f6fff4" },
  night: { bg: "#050b1c", bar: "#0b1530", symbol: "#f1f4ff" },
};

// Sign-in pages a site may open in a pop-up (e.g. "Log in with Apple").
const LOGIN_HOSTS = [
  "tiktok.com", "instagram.com", "x.com", "twitter.com",
  "facebook.com", "accounts.google.com", "appleid.apple.com", "login.live.com",
];

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
  muted: { tiktok: false, instagram: true, x: true },
  zoom: { tiktok: 1, instagram: 1, x: 1 },
  notifications: true,
  welcomed: false,
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
    if (typeof saved.notifications === "boolean") state.notifications = saved.notifications;
    if (typeof saved.welcomed === "boolean") state.welcomed = saved.welcomed;
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
let overlay = null; // "accounts" or "shortcuts" while a panel covers the window
let activeKey = null; // the site you last clicked or typed in
let laidOut = ""; // window size the sites were last placed for
let online = true;

function shownKeys() {
  return state.mode === "all" ? KEYS : [state.mode];
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
  win.once("ready-to-show", () => win.show());
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
  win.on("close", () => {
    state.bounds = { ...win.getNormalBounds(), maximized: win.isMaximized() };
    clearTimeout(saveTimer);
    writeSettings();
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

  wc.on("enter-html-full-screen", () => {
    fullscreenKey = key;
    layout();
  });
  wc.on("leave-html-full-screen", () => {
    fullscreenKey = null;
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

  wc.loadURL(site.home);
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
  const { toolbar, head, headGap, gap } = SIZES;
  const width = Math.floor((W - gap * (n + 1)) / n);
  const top = toolbar + gap;
  const bodyTop = top + head + headGap;
  const rects = {};
  shown.forEach((key, i) => {
    const x = gap + i * (width + gap);
    // The last column takes any leftover pixels.
    rects[key] = { x, width: i === n - 1 ? W - gap - x : width, bodyTop, bodyHeight: Math.max(0, H - bodyTop - gap) };
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
    view.webContents.setAudioMuted(state.muted[key] || !visible);
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
    overlay,
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

function setTheme(theme) {
  state.theme = theme;
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
    case "copy-link":
      if (/^https?:\/\//.test(wc.getURL())) {
        clipboard.writeText(wc.getURL());
        toast("Link copied");
      }
      break;
    case "menu":
      showPaneMenu(key);
      break;
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

  if (k === "Escape" && overlay) {
    if (overlay === "accounts") {
      state.welcomed = true;
      saveSettings();
    }
    return setOverlay(null), true;
  }
  if (mod && !input.shift && !input.alt) {
    if (k >= "1" && k <= "4") return setMode(["all", ...KEYS][Number(k) - 1]), true;
    if (k === "r") return paneAction(target, "reload"), true;
    if (k === "=" || k === "+") return paneAction(target, "zoom-in"), true;
    if (k === "-") return paneAction(target, "zoom-out"), true;
    if (k === "0") return paneAction(target, "zoom-reset"), true;
    if (k === "m") return paneAction(target, "mute"), true;
    if (k === "/") return setOverlay(overlay === "shortcuts" ? null : "shortcuts"), true;
  }
  if (mod && input.shift && !input.alt) {
    if (k === "R") return KEYS.forEach((key) => paneAction(key, "reload")), true;
    if (k === "L") return setTheme(state.theme === "night" ? "day" : "night"), true;
    if (k === "A") return setOverlay(overlay === "accounts" ? null : "accounts"), true;
  }
  if (input.alt && !mod && !input.shift) {
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
  if (name === null || name === "accounts" || name === "shortcuts") setOverlay(name);
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
ipcMain.on("badge", (_e, count, dataUrl) => {
  if (!win || !Number.isInteger(count)) return;
  if (process.platform === "win32") {
    const image = count > 0 && typeof dataUrl === "string" && dataUrl.startsWith("data:image/png")
      ? nativeImage.createFromDataURL(dataUrl) : null;
    win.setOverlayIcon(image, count > 0 ? `${count} new` : "");
  } else {
    app.setBadgeCount(count);
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
      win.show();
      win.focus();
    }
  });

  // Nothing inside the app may embed other pages or open unknown windows.
  app.on("web-contents-created", (_e, contents) => {
    contents.on("will-attach-webview", (e) => e.preventDefault());
  });

  app.whenReady().then(() => {
    // Windows and Linux don't need the default menu; macOS keeps it for copy/paste.
    if (process.platform !== "darwin") Menu.setApplicationMenu(null);
    loadSettings();
    createWindow();
  });

  app.on("window-all-closed", () => app.quit());
}
