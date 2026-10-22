// Toolbar, site headers and panels. The sites themselves are placed by main.js
// inside each frame, using the positions it sends in each "state" message.

const $ = (sel, root = document) => root.querySelector(sel);
const panesEl = $("#panes");
const paneTemplate = $("#pane-template");
const accountTemplate = $("#account-template");
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
  current = state;
  const root = document.documentElement;
  root.dataset.theme = state.theme;
  root.dataset.platform = state.platform;
  for (const [name, value] of Object.entries(state.sizes)) root.style.setProperty(`--${name}`, `${value}px`);
  document.body.classList.toggle("fullscreen", state.fullscreen);
  document.body.classList.toggle("ready", true);

  let total = 0;
  for (const p of state.panes) {
    total += p.unread;
    const el = panes[p.key] || (panes[p.key] = makePane(p.key, p.name));
    el.hidden = !p.visible;
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
  updateBadge(total);

  for (const tab of document.querySelectorAll(".tab")) {
    tab.setAttribute("aria-pressed", String(tab.dataset.mode === state.mode));
  }
  $("#offline").hidden = state.online;

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

  if (first) renderKeys(state.platform);
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
    [[mod, "2 / 3 / 4"], "TikTok, Instagram or X"],
    [["Alt", "←"], "Back"],
    [["Alt", "→"], "Forward"],
    [["Alt", "Home"], "Home feed"],
    [[mod, "R"], "Reload"],
    [[mod, "Shift", "R"], "Reload all 3"],
    [[mod, "M"], "Sound on / off"],
    [[mod, "+ / −"], "Bigger / smaller"],
    [[mod, "0"], "Actual size"],
    [[mod, "Shift", "L"], "Day / night"],
    [[mod, "Shift", "A"], "Accounts"],
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
  window.hub.badge(total, dataUrl);
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
$("#help").addEventListener("click", () => window.hub.overlay("shortcuts"));
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
window.addEventListener("resize", () => window.hub.ready());
