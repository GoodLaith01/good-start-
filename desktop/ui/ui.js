// Toolbar, site headers and panels. The sites themselves are placed by main.js
// inside each frame, using the positions it sends in each "state" message.

const $ = (sel, root = document) => root.querySelector(sel);
const panesEl = $("#panes");
const paneTemplate = $("#pane-template");
const accountTemplate = $("#account-template");
const columnTemplate = $("#column-template");
const panes = {};
const accounts = {};
let current = null;

// ---------- Messages shown when a site can't be shown ----------

const PROBLEMS = {
  offline: {
    title: () => "You're offline",
    text: () => "Check your Wi-Fi or network cable. Your feed comes back on its own as soon as you're connected.",
  },
  unreachable: {
    title: (name) => `Can't reach ${name}`,
    text: (name) => `${name} isn't responding right now. It may be busy or blocked on this network.`,
  },
  crashed: {
    title: (name) => `${name} stopped working`,
    text: () => "This happens now and then with busy pages. Reloading usually fixes it.",
  },
  frozen: {
    title: (name) => `${name} isn't responding`,
    text: () => "The page is busy. You can wait a moment or reload it.",
  },
};

// ---------- Building the panes and account rows ----------

function makePane(key, name) {
  const el = paneTemplate.content.firstElementChild.cloneNode(true);
  el.dataset.key = key;
  $("use", el).setAttribute("href", `#icon-${key}`);
  $(".pane-name", el).textContent = name;
  el.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (btn) window.hub.pane(key, btn.dataset.action);
  });
  panesEl.appendChild(el);
  return el;
}

function makeAccount(key, name) {
  const el = accountTemplate.content.firstElementChild.cloneNode(true);
  el.dataset.key = key;
  $("use", el).setAttribute("href", `#icon-${key}`);
  $(".account-name", el).textContent = name;
  $(".account-btn", el).addEventListener("click", () => {
    const p = current.panes.find((pane) => pane.key === key);
    if (p.connected) {
      window.hub.pane(key, "sign-out");
    } else {
      window.hub.welcomed();
      window.hub.pane(key, "connect");
    }
  });
  $("#account-list").appendChild(el);
  return el;
}

function setCount(el, n) {
  el.hidden = !n;
  el.textContent = n > 99 ? "99+" : String(n);
}

// ---------- Drawing the state the app sends ----------

function render(state) {
  const first = !current;
  const modeChanged = !first && current.mode !== state.mode;
  current = state;
  const root = document.documentElement;
  root.dataset.theme = state.theme;
  root.dataset.platform = state.platform;
  for (const [name, value] of Object.entries(state.sizes)) root.style.setProperty(`--${name}`, `${value}px`);
  document.body.classList.toggle("fullscreen", state.fullscreen);
  document.body.classList.toggle("ready", true);

  let total = 0;
  const shownOrder = state.order.filter((key) => state.panes.find((p) => p.key === key)?.visible);
  for (const p of state.panes) {
    total += p.unread;
    const el = panes[p.key] || (panes[p.key] = makePane(p.key, p.name));
    el.hidden = !p.visible;
    // Columns rise in one after another, left to right.
    el.style.setProperty("--i", String(Math.max(0, shownOrder.indexOf(p.key))));
    if (modeChanged && p.visible) replay(el);
    el.style.left = `${p.x}px`;
    el.style.width = `${p.width}px`;
    el.classList.toggle("active", state.active === p.key);
    el.classList.toggle("loading", p.loading);
    el.classList.toggle("muted", p.muted);
    el.classList.toggle("painted", p.painted && !p.error);
    setCount($(".count", el), p.unread);
    $(".connect-chip", el).hidden = p.connected;
    $('[data-action="back"]', el).disabled = !p.canGoBack;
    $('[data-action="forward"]', el).disabled = !p.canGoForward;
    $(".video-nav", el).hidden = !p.videoFeed;
    $('[data-action="saved"]', el).title = `Your ${p.savedLabel.toLowerCase()}`;
    $('[data-action="mute"]', el).title = p.muted ? "Turn sound on (Ctrl+M)" : "Turn sound off (Ctrl+M)";
    renderProblem(el, p);

    const tab = $(`.tab[data-mode="${p.key}"]`);
    setCount($(".count", tab), p.unread);
    tab.classList.toggle("connected", p.connected);
    $(`.accounts-btn i[data-key="${p.key}"]`).classList.toggle("on", p.connected);

    const acc = accounts[p.key] || (accounts[p.key] = makeAccount(p.key, p.name));
    acc.classList.toggle("connected", p.connected);
    $(".account-status", acc).textContent = p.connected ? "Connected" : "Not connected";
    const btn = $(".account-btn", acc);
    btn.textContent = p.connected ? "Sign out" : "Connect";
    btn.className = `account-btn ${p.connected ? "ghost" : "primary"}`;
  }
  setCount($('.tab[data-mode="all"] .count'), state.mode === "all" ? 0 : total);
  $('.tab[data-mode="all"] .tab-label').textContent = `All ${state.allCount}`;
  state.order.forEach((key, i) => ($(`.tab[data-mode="${key}"]`).style.order = String(i + 1)));
  $("#muted-all").hidden = !state.muteAll;
  renderDividers(state);
  updateBadge(total);

  for (const tab of document.querySelectorAll(".tab")) {
    tab.setAttribute("aria-pressed", String(tab.dataset.mode === state.mode));
  }
  $("#offline").hidden = state.online;
  moveThumb();

  // The rail lights the button for what's on screen.
  const lit = { shortcuts: "#help", settings: "#settings" }[state.overlay] || (state.overlay ? null : "#rail-home");
  for (const btn of document.querySelectorAll(".rail-btn")) btn.classList.toggle("lit", lit !== null && btn.matches(lit));
  $("#accounts").classList.toggle("lit", state.overlay === "accounts");

  // Panels
  const anyConnected = state.panes.some((p) => p.connected);
  $("#accounts-title").textContent = state.welcomed ? "Your accounts" : "Welcome to Social Hub";
  $("#accounts-lead").textContent = state.welcomed
    ? "Connect or sign out of each site. Your logins stay on this computer."
    : "TikTok, Instagram and X together in one window. Connect your accounts to see the people you follow.";
  $("#accounts-done").textContent = state.welcomed || anyConnected ? "Done" : "Open my feeds";
  $("#notifications").checked = state.notifications;
  showOverlay("accounts", state.overlay === "accounts");
  showOverlay("shortcuts", state.overlay === "shortcuts");
  showOverlay("settings", state.overlay === "settings");
  const googleName = state.panes.find((p) => p.key === state.googleSite)?.name || "the site";
  for (const el of document.querySelectorAll("#google-panel [data-site-name]")) el.textContent = googleName;
  const yt = state.googleSite === "youtube";
  $("#google-youtube").hidden = !yt;
  $("#google-lead").hidden = yt;
  $("#google-steps").hidden = yt;
  $("#google-title").textContent = yt ? "Watch without signing in" : "Use another way to sign in";
  $("#google-login").textContent = yt ? "Keep watching here" : `Go to ${googleName} login`;
  showOverlay("google", state.overlay === "google");
  renderSettings(state);

  if (first) renderKeys(state.platform);
}

// Slides the white thumb under the chosen tab.
function moveThumb() {
  const tab = $('.tab[aria-pressed="true"]');
  const thumb = $(".tab-thumb");
  if (!tab) return;
  thumb.style.width = `${tab.offsetWidth}px`;
  thumb.style.transform = `translateX(${tab.offsetLeft}px)`;
  thumb.classList.add("placed");
}

// Plays an element's entrance animation again.
function replay(el) {
  el.style.animation = "none";
  void el.offsetWidth;
  el.style.animation = "";
}

// ---------- Settings ----------

function renderSettings(state) {
  for (const input of document.querySelectorAll("[data-setting]")) {
    input.checked = state.settings[input.dataset.setting];
  }
  const list = $("#column-list");
  const names = Object.fromEntries(state.panes.map((p) => [p.key, p.name]));
  // Rebuild only when the order changes, so focus stays put while toggling.
  if (list.dataset.order !== state.order.join()) {
    list.dataset.order = state.order.join();
    list.replaceChildren(...state.order.map((key) => makeColumn(key, names[key])));
  }
  state.order.forEach((key, i) => {
    const li = $(`.column[data-key="${key}"]`, list);
    const shown = !state.hidden[key];
    $("input", li).checked = shown;
    // The All view always keeps at least one site.
    $("input", li).disabled = shown && state.allCount <= 1;
    li.classList.toggle("off", !shown);
    $('[data-move="-1"]', li).disabled = i === 0;
    $('[data-move="1"]', li).disabled = i === state.order.length - 1;
  });
}

function makeColumn(key, name) {
  const li = columnTemplate.content.firstElementChild.cloneNode(true);
  li.dataset.key = key;
  $("use", li).setAttribute("href", `#icon-${key}`);
  $(".column-name", li).textContent = name;
  $("input", li).addEventListener("change", (e) => window.hub.setHidden(key, !e.target.checked));
  li.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-move]");
    if (!btn) return;
    const order = [...current.order];
    const i = order.indexOf(key);
    const j = i + Number(btn.dataset.move);
    [order[i], order[j]] = [order[j], order[i]];
    window.hub.setOrder(order);
    requestAnimationFrame(() => $(`.column[data-key="${key}"] [data-move="${btn.dataset.move}"]`)?.focus());
  });
  return li;
}

// ---------- Resizing columns ----------

let drag = null;

function renderDividers(state) {
  const box = $("#dividers");
  const shown = state.mode === "all" && !state.fullscreen && !state.overlay
    ? state.order.filter((key) => !state.hidden[key]).map((key) => state.panes.find((p) => p.key === key))
    : [];
  const needed = Math.max(0, shown.length - 1);
  while (box.children.length > needed) box.lastChild.remove();
  while (box.children.length < needed) {
    const d = document.createElement("div");
    d.className = "divider";
    d.title = "Drag to resize. Double-click to even out.";
    d.addEventListener("pointerdown", startDrag);
    d.addEventListener("dblclick", () => window.hub.resetWidths());
    box.appendChild(d);
  }
  if (drag) return;
  [...box.children].forEach((d, i) => {
    const left = shown[i];
    const right = shown[i + 1];
    d.dataset.left = left.key;
    d.dataset.right = right.key;
    d.style.left = `${left.x + left.width}px`;
    d.style.width = `${right.x - left.x - left.width}px`;
  });
}

function startDrag(e) {
  const d = e.currentTarget;
  const pane = (key) => current.panes.find((p) => p.key === key);
  const l = pane(d.dataset.left);
  const r = pane(d.dataset.right);
  drag = {
    el: d,
    startX: e.clientX,
    l, r,
    startLeft: d.offsetLeft,
    frame: 0,
  };
  d.setPointerCapture(e.pointerId);
  d.classList.add("dragging");
  document.body.classList.add("resizing");
  d.addEventListener("pointermove", onDrag);
  d.addEventListener("pointerup", endDrag, { once: true });
  d.addEventListener("pointercancel", endDrag, { once: true });
}

function onDrag(e) {
  const { l, r } = drag;
  const pair = l.width + r.width;
  const min = 300;
  const leftPx = Math.min(pair - min, Math.max(min, l.width + e.clientX - drag.startX));
  drag.el.style.left = `${drag.startLeft + leftPx - l.width}px`;
  cancelAnimationFrame(drag.frame);
  drag.frame = requestAnimationFrame(() => {
    // Keep the pair's share of the window; just split it differently.
    const sum = l.share + r.share;
    window.hub.setWidths({ [l.key]: (sum * leftPx) / pair, [r.key]: (sum * (pair - leftPx)) / pair });
  });
}

function endDrag() {
  drag.el.classList.remove("dragging");
  drag.el.removeEventListener("pointermove", onDrag);
  document.body.classList.remove("resizing");
  drag = null;
  window.hub.ready();
}

function renderProblem(el, p) {
  const box = $(".problem", el);
  const problem = p.error && PROBLEMS[p.error.kind];
  box.hidden = !problem;
  $(".skeleton", el).hidden = !!problem;
  if (!problem) return;
  $(".problem-icon use", box).setAttribute("href", `#icon-${p.error.kind}`);
  $(".problem-title", box).textContent = problem.title(p.name);
  $(".problem-text", box).textContent = problem.text(p.name);
  $('[data-action="retry"]', box).textContent = p.error.kind === "crashed" || p.error.kind === "frozen" ? "Reload" : "Try again now";
  $('[data-action="open-external"]', box).hidden = p.error.kind !== "unreachable";
  box.dataset.retryAt = String(p.retryAt || 0);
  box.dataset.loading = String(p.loading);
  tickRetry(box);
}

// "Trying again in 12s", counted down every second.
function tickRetry(box) {
  const note = $(".problem-note", box);
  const at = Number(box.dataset.retryAt);
  if (box.dataset.loading === "true") note.textContent = "Trying again…";
  else if (at) note.textContent = `Trying again in ${Math.max(1, Math.ceil((at - Date.now()) / 1000))}s`;
  else note.textContent = "";
}
setInterval(() => document.querySelectorAll(".problem:not([hidden])").forEach(tickRetry), 1000);

function showOverlay(name, open) {
  const el = $(`#${name}-panel`);
  if (el.hidden === !open) return;
  el.hidden = !open;
  if (open) requestAnimationFrame(() => $(".sheet-actions .primary", el)?.focus());
}

function renderKeys(platform) {
  const mod = platform === "darwin" ? "⌘" : "Ctrl";
  const rows = [
    [[mod, "1"], "All 3 side by side"],
    [[mod, "2 – 5"], "TikTok, Instagram, X or YouTube"],
    [["Alt", "↓ / ↑"], "Next / previous video"],
    [["Alt", "←"], "Back"],
    [["Alt", "→"], "Forward"],
    [["Alt", "Home"], "Home feed"],
    [[mod, "R"], "Reload"],
    [[mod, "Shift", "R"], "Reload all 3"],
    [[mod, "Tab"], "Next view"],
    [[mod, "M"], "Sound on / off"],
    [[mod, "Shift", "M"], "Mute everything"],
    [[mod, "+ / −"], "Bigger / smaller"],
    [[mod, "0"], "Actual size"],
    [[mod, "Shift", "L"], "Day / night"],
    [[mod, "Shift", "A"], "Accounts"],
    [[mod, ","], "Settings"],
    [["F11"], "Full screen"],
    [[mod, "/"], "This list"],
  ];
  const dl = $("#keys");
  for (const [keys, what] of rows) {
    const dt = document.createElement("dt");
    for (const k of keys) {
      const kbd = document.createElement("kbd");
      kbd.textContent = k;
      dt.appendChild(kbd);
    }
    const dd = document.createElement("dd");
    dd.textContent = what;
    dl.append(dt, dd);
  }
}

// ---------- Taskbar badge ----------

let lastBadge = -1;
function updateBadge(total) {
  if (total === lastBadge) return;
  lastBadge = total;
  let dataUrl = "";
  if (total > 0) {
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    const g = c.getContext("2d");
    g.fillStyle = "#ff3b5c";
    g.beginPath();
    g.arc(16, 16, 16, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#fff";
    g.font = `bold ${total > 9 ? 15 : 19}px "Segoe UI", sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(total > 9 ? "9+" : String(total), 16, 17);
    dataUrl = c.toDataURL("image/png");
  }
  window.hub.badge(total, dataUrl, trayIcon(total > 0));
}

// The tray icon: the app's mark, with a red dot when something new is waiting.
function trayIcon(dot) {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 32, 32);
  grad.addColorStop(0, "#25f4ee");
  grad.addColorStop(0.5, "#ff7aa8");
  grad.addColorStop(1, "#ffc46b");
  g.fillStyle = grad;
  g.beginPath();
  g.roundRect(1, 1, 30, 30, 9);
  g.fill();
  g.fillStyle = "#fff";
  for (const [x, a] of [[7, 1], [13.5, 0.85], [20, 0.7]]) {
    g.globalAlpha = a;
    g.beginPath();
    g.roundRect(x, 8, 5, 16, 2);
    g.fill();
  }
  g.globalAlpha = 1;
  if (dot) {
    g.fillStyle = "#ff3b5c";
    g.strokeStyle = "#fff";
    g.lineWidth = 2.5;
    g.beginPath();
    g.arc(24.5, 7.5, 6.5, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
  return c.toDataURL("image/png");
}

// ---------- Toasts ----------

let toastTimer;
function showToast(text) {
  const el = $("#toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

// ---------- Toolbar and panel controls ----------

$(".tabs").addEventListener("click", (e) => {
  const tab = e.target.closest(".tab");
  if (tab) window.hub.setMode(tab.dataset.mode);
});

$("#theme").addEventListener("click", () => {
  window.hub.setTheme(current?.theme === "night" ? "day" : "night");
});
$("#accounts").addEventListener("click", () => window.hub.overlay("accounts"));
$("#rail-home").addEventListener("click", () => {
  if (current?.overlay === "accounts") window.hub.welcomed();
  else if (current?.overlay) window.hub.overlay(null);
  window.hub.setMode("all");
});
$("#help").addEventListener("click", () => window.hub.overlay("shortcuts"));
$("#settings").addEventListener("click", () => window.hub.overlay("settings"));
$("#settings-done").addEventListener("click", () => window.hub.overlay(null));
$("#muted-all").addEventListener("click", () => window.hub.muteAll(false));
$("#reset-widths").addEventListener("click", () => window.hub.resetWidths());
$("#google-login").addEventListener("click", () => window.hub.googleHelp("login"));
$("#google-browser").addEventListener("click", () => window.hub.googleHelp("browser"));
$("#google-cancel").addEventListener("click", () => window.hub.overlay(null));
for (const input of document.querySelectorAll("[data-setting]")) {
  input.addEventListener("change", () => window.hub.setSetting(input.dataset.setting, input.checked));
}
$("#accounts-done").addEventListener("click", () => window.hub.welcomed());
$("#shortcuts-done").addEventListener("click", () => window.hub.overlay(null));
$("#notifications").addEventListener("change", (e) => window.hub.setNotifications(e.target.checked));

// Clicking the dim area around a panel closes it.
for (const el of document.querySelectorAll(".overlay")) {
  el.addEventListener("click", (e) => {
    if (e.target !== el) return;
    if (el.id === "accounts-panel") window.hub.welcomed();
    else window.hub.overlay(null);
  });
}

window.addEventListener("online", () => window.hub.online(true));
window.addEventListener("offline", () => window.hub.online(false));

window.hub.onState(render);
window.hub.onToast(showToast);
window.hub.online(navigator.onLine);
window.hub.ready();
// Ask the app to re-place the sites whenever this window changes size.
window.addEventListener("resize", () => {
  window.hub.ready();
  moveThumb();
});
