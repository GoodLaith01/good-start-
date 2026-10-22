// Social Hub: shows your TikTok, Instagram and X accounts side by side.
//
// None of the three sites can be shown in a plain <iframe> (they block it),
// so each panel uses the platform's official profile embed, plus an
// "Open" button that takes you to the real profile.

// Put your usernames here to have them filled in for everyone who opens
// the page. Anything entered under "Accounts" overrides these (per browser).
const DEFAULT_ACCOUNTS = {
  tiktok: "",
  instagram: "",
  x: "",
};

const STORAGE_KEY = "social-hub-accounts";
const VIEWS = ["all", "tiktok", "instagram", "x"];

const PLATFORMS = {
  tiktok: {
    name: "TikTok",
    profileUrl: (u) => `https://www.tiktok.com/@${u}`,
    render(body, u) {
      body.innerHTML = `
        <blockquote class="tiktok-embed" cite="https://www.tiktok.com/@${u}"
          data-unique-id="${u}" data-embed-type="creator"
          style="max-width: 780px; min-width: 288px;">
          <section><a target="_blank" rel="noopener" href="https://www.tiktok.com/@${u}">@${u}</a></section>
        </blockquote>
        <p class="note">Not loading? <a href="https://www.tiktok.com/@${u}" target="_blank" rel="noopener">Open @${u} on TikTok ↗</a></p>`;
      // TikTok's script only scans the page once, so add a fresh copy each time.
      loadScript("https://www.tiktok.com/embed.js", { fresh: true });
    },
  },

  instagram: {
    name: "Instagram",
    profileUrl: (u) => `https://www.instagram.com/${u}/`,
    render(body, u) {
      body.innerHTML = `
        <iframe src="https://www.instagram.com/${u}/embed/" title="Instagram profile @${u}"
          loading="lazy" allowtransparency="true" scrolling="yes"></iframe>
        <p class="note">Only public profiles can be embedded.
          <a href="https://www.instagram.com/${u}/" target="_blank" rel="noopener">Open @${u} on Instagram ↗</a></p>`;
    },
  },

  x: {
    name: "X",
    profileUrl: (u) => `https://x.com/${u}`,
    render(body, u) {
      body.innerHTML = `
        <a class="twitter-timeline" data-theme="dark" data-dnt="true" data-chrome="noheader transparent"
          href="https://twitter.com/${u}">Loading posts by @${u}…</a>
        <p class="note">X sometimes only shows the timeline when you're signed in to X in this browser.
          <a href="https://x.com/${u}" target="_blank" rel="noopener">Open @${u} on X ↗</a></p>`;
      loadScript("https://platform.twitter.com/widgets.js").then(() => {
        window.twttr?.widgets?.load(body);
      });
    },
  },
};

// ---------- Accounts ----------

// Accepts "@name", "name" or a full profile URL, and keeps only the
// characters these sites allow in usernames.
function cleanUsername(value) {
  let v = String(value || "").trim();
  const fromUrl = v.match(/(?:tiktok\.com\/@|instagram\.com\/|(?:x|twitter)\.com\/)([^/?#]+)/i);
  if (fromUrl) v = fromUrl[1];
  return v.replace(/^@+/, "").replace(/[^A-Za-z0-9._]/g, "").slice(0, 30);
}

function loadAccounts() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {}
  const accounts = {};
  for (const key of Object.keys(PLATFORMS)) {
    accounts[key] = cleanUsername(saved[key] ?? DEFAULT_ACCOUNTS[key]);
  }
  return accounts;
}

function saveAccounts(accounts) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
  } catch {}
}

// ---------- Rendering ----------

const scripts = {};

function loadScript(src, { fresh = false } = {}) {
  if (fresh) document.querySelector(`script[src="${src}"]`)?.remove();
  else if (scripts[src]) return scripts[src];

  scripts[src] = new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = resolve; // the panel's "Open" link still works
    document.body.appendChild(s);
  });
  return scripts[src];
}

function renderPanel(key, username) {
  const panel = document.querySelector(`.panel[data-platform="${key}"]`);
  const platform = PLATFORMS[key];
  const body = panel.querySelector("[data-body]");
  const open = panel.querySelector("[data-open]");

  panel.querySelector("[data-handle]").textContent = username ? `@${username}` : "Not set";

  if (!username) {
    open.removeAttribute("href");
    open.hidden = true;
    body.innerHTML = `
      <div class="empty">
        <svg viewBox="0 0 24 24"><use href="#icon-${key}"/></svg>
        <div>Add your ${platform.name} username to see your account here.</div>
        <button class="btn" type="button" data-action="settings">Add ${platform.name}</button>
      </div>`;
    return;
  }

  open.href = platform.profileUrl(username);
  open.hidden = false;
  platform.render(body, username);
}

let current = {};

function renderAll(accounts) {
  for (const key of Object.keys(PLATFORMS)) {
    // Only re-render panels whose username changed, so embeds aren't reloaded.
    if (current[key] !== accounts[key]) renderPanel(key, accounts[key]);
  }
  current = { ...accounts };
}

// ---------- Views (All / TikTok / Instagram / X) ----------

function applyView() {
  const hash = location.hash.slice(1);
  const view = VIEWS.includes(hash) ? hash : "all";
  document.getElementById("board").dataset.view = view;
  for (const tab of document.querySelectorAll(".tab")) {
    tab.setAttribute("aria-selected", String(tab.dataset.view === view));
  }
}

window.addEventListener("hashchange", applyView);

// ---------- Settings dialog ----------

const dialog = document.getElementById("settings");
const form = document.getElementById("settings-form");

function openSettings() {
  for (const [key, value] of Object.entries(current)) {
    form.elements[key].value = value ? `@${value}` : "";
  }
  dialog.showModal();
}

dialog.addEventListener("close", () => {
  if (dialog.returnValue !== "save") return;
  const accounts = {};
  for (const key of Object.keys(PLATFORMS)) {
    accounts[key] = cleanUsername(form.elements[key].value);
  }
  saveAccounts(accounts);
  renderAll(accounts);
});

document.getElementById("open-settings").addEventListener("click", openSettings);

document.addEventListener("click", (e) => {
  if (e.target.closest("[data-action='settings']")) openSettings();
});

// Browsers may block all but the first new tab; allow pop-ups for this site
// if only one opens.
document.getElementById("open-all").addEventListener("click", () => {
  const keys = Object.keys(PLATFORMS).filter((k) => current[k]);
  if (!keys.length) return openSettings();
  for (const key of keys) {
    window.open(PLATFORMS[key].profileUrl(current[key]), `_blank`, "noopener");
  }
});

// ---------- Start ----------

applyView();
renderAll(loadAccounts());
if (!Object.values(current).some(Boolean)) openSettings();
