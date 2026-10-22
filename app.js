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

// ---------- Side by side: the real apps, logged in ----------
//
// The sites won't run logged in inside this page, so instead open each one's
// feed in its own window and tile the three across the screen. You sign in
// in those windows like normal, and the browser remembers it next time.

const FEEDS = {
  tiktok: "https://www.tiktok.com/foryou",
  instagram: "https://www.instagram.com/reels/",
  x: "https://x.com/home",
};

const toast = document.getElementById("toast");

function showToast(html) {
  toast.querySelector(".toast-body").innerHTML = html;
  toast.hidden = false;
}

toast.querySelector("[data-dismiss]").addEventListener("click", () => {
  toast.hidden = true;
});

function feedLinks() {
  return Object.entries(FEEDS)
    .map(([key, url]) => `<a href="${url}" target="_blank" rel="noopener">${PLATFORMS[key].name} ↗</a>`)
    .join(" · ");
}

function openSideBySide() {
  // Phones and tablets can't place three windows side by side.
  if (matchMedia("(pointer: coarse)").matches && window.innerWidth < 1024) {
    showToast(`<p>Phones can't show three apps at once. Use Side by side on a computer, or open them one at a time:</p><p>${feedLinks()}</p>`);
    return;
  }

  const keys = Object.keys(FEEDS);
  const width = Math.floor(screen.availWidth / keys.length);
  const height = screen.availHeight;
  const left = screen.availLeft || 0;
  const top = screen.availTop || 0;

  let blocked = 0;
  keys.forEach((key, i) => {
    // A fixed name per site reuses its window instead of opening a new one each click.
    const win = window.open(
      FEEDS[key],
      `social-hub-${key}`,
      `popup,width=${width},height=${height},left=${left + i * width},top=${top}`,
    );
    if (!win) blocked++;
  });

  if (blocked) {
    showToast(`<p>Your browser blocked ${blocked} of the 3 windows. Click the blocked pop-up icon at the right of the address bar, choose <b>Always allow pop-ups</b> for this site, then press Side by side again.</p><p>Or open them yourself: ${feedLinks()}</p>`);
  } else {
    showToast(`<p>Opened TikTok, Instagram and X side by side. Log in once in each window and your browser will remember it.</p>`);
  }
}

document.getElementById("side-by-side").addEventListener("click", openSideBySide);

// ---------- Watch a single video or post ----------

const RECENT_KEY = "social-hub-recent";
const RECENT_MAX = 12;
const watchDialog = document.getElementById("watch");
const watchForm = document.getElementById("watch-form");
const watchMsg = document.getElementById("watch-msg");
const player = document.getElementById("player");

// Reads a pasted TikTok, Instagram or X link. Returns
// { platform, id, kind, url, who } or { error }.
function parsePostLink(text) {
  const raw = String(text || "").trim();
  if (!raw) return { error: "Paste a link first." };

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { error: "That doesn't look like a link." };
  }

  const host = url.hostname.replace(/^(www|m|mobile)\./, "");
  const path = url.pathname;
  const clean = `https://${url.hostname}${path}`;
  let m;

  if (host === "tiktok.com" && (m = path.match(/\/(?:video|photo)\/(\d+)/))) {
    const who = path.match(/^\/@([\w.]+)/);
    return { platform: "tiktok", id: m[1], url: clean, who: who && `@${who[1]}` };
  }
  if (host === "vm.tiktok.com" || host === "vt.tiktok.com" || (host === "tiktok.com" && path.startsWith("/t/"))) {
    return { error: "That's a TikTok short link. Open it first, then copy the full link (the one with /video/ in it)." };
  }
  if (host === "instagram.com" && (m = path.match(/^\/(?:[\w.]+\/)?(p|reels?|tv)\/([\w-]+)/))) {
    const kind = m[1].startsWith("reel") ? "reel" : "p";
    return { platform: "instagram", id: m[2], kind, url: `https://www.instagram.com/${kind}/${m[2]}/` };
  }
  if ((host === "x.com" || host === "twitter.com") && (m = path.match(/^\/(\w+)\/status(?:es)?\/(\d+)/))) {
    return { platform: "x", id: m[2], url: `https://x.com/${m[1]}/status/${m[2]}`, who: `@${m[1]}` };
  }
  return { error: "Paste a link to a TikTok video, an Instagram post or reel, or an X post." };
}

function playPost(post) {
  player.innerHTML = "";

  if (post.platform === "tiktok") {
    player.innerHTML = `<iframe class="tiktok-frame" title="TikTok video"
      src="https://www.tiktok.com/player/v1/${post.id}?description=1&music_info=1&rel=0"
      allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
  } else if (post.platform === "instagram") {
    player.innerHTML = `<iframe class="ig-frame" title="Instagram ${post.kind === "reel" ? "reel" : "post"}"
      src="https://www.instagram.com/${post.kind}/${post.id}/embed/captioned/" allowfullscreen></iframe>`;
  } else {
    const holder = document.createElement("div");
    holder.className = "x-post";
    holder.textContent = "Loading post…";
    player.appendChild(holder);
    loadScript("https://platform.twitter.com/widgets.js").then(() => {
      const widgets = window.twttr?.widgets;
      if (!widgets) return (holder.textContent = "X didn't load. Use the link below to open the post.");
      holder.textContent = "";
      widgets.createTweet(post.id, holder, { theme: "dark", align: "center", dnt: true }).then((el) => {
        if (!el) holder.textContent = "This post can't be shown here (it may be deleted or private).";
      });
    });
  }

  const note = document.createElement("p");
  note.className = "note";
  const link = document.createElement("a");
  link.href = post.url;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = `Open on ${PLATFORMS[post.platform].name} ↗`;
  note.append("Not playing? ", link);
  player.appendChild(note);

  addRecent(post);
}

// ---- Recently watched (kept in this browser only) ----

function loadRecent() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveRecent(list) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {}
}

function addRecent(post) {
  const list = loadRecent().filter((p) => !(p.platform === post.platform && p.id === post.id));
  list.unshift({ platform: post.platform, id: post.id, kind: post.kind, url: post.url, who: post.who });
  saveRecent(list.slice(0, RECENT_MAX));
  renderRecent();
}

function recentLabel(post) {
  const what = post.platform === "tiktok" ? "video" : post.platform === "instagram" ? (post.kind === "reel" ? "reel" : "post") : "post";
  return post.who ? `${post.who} ${what}` : `${PLATFORMS[post.platform].name} ${what}`;
}

function renderRecent() {
  const list = loadRecent().filter((p) => PLATFORMS[p.platform]);
  const box = document.getElementById("recent");
  const ul = document.getElementById("recent-list");
  box.hidden = !list.length;
  ul.innerHTML = "";
  for (const post of list) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#icon-${post.platform}"/></svg>`;
    btn.append(recentLabel(post));
    btn.addEventListener("click", () => {
      watchForm.elements.url.value = post.url;
      watchMsg.textContent = "";
      playPost(post);
    });
    li.appendChild(btn);
    ul.appendChild(li);
  }
}

document.getElementById("recent-clear").addEventListener("click", () => {
  saveRecent([]);
  renderRecent();
});

function tryPlay() {
  const post = parsePostLink(watchForm.elements.url.value);
  if (post.error) {
    watchMsg.textContent = post.error;
    return;
  }
  watchMsg.textContent = "";
  playPost(post);
}

watchForm.addEventListener("submit", (e) => {
  e.preventDefault();
  tryPlay();
});

// Play straight away when a link is pasted.
watchForm.elements.url.addEventListener("paste", () => setTimeout(tryPlay));

document.getElementById("open-watch").addEventListener("click", () => {
  renderRecent();
  watchDialog.showModal();
  watchForm.elements.url.focus();
});

watchDialog.querySelector("[data-close]").addEventListener("click", () => watchDialog.close());

// Stop any playing video when the window closes.
watchDialog.addEventListener("close", () => {
  player.innerHTML = "";
  watchMsg.textContent = "";
});

// ---------- Day / night ----------

const MODE_KEY = "social-hub-mode";
const modeToggle = document.getElementById("mode-toggle");

function setMode(mode) {
  document.documentElement.dataset.mode = mode;
  const next = mode === "night" ? "day" : "night";
  modeToggle.title = `Switch to ${next} mode`;
  modeToggle.setAttribute("aria-label", modeToggle.title);
}

modeToggle.addEventListener("click", () => {
  const mode = document.documentElement.dataset.mode === "night" ? "day" : "night";
  setMode(mode);
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {}
});

// Scatter stars across the sky above the sea (top 60% of the screen), more of
// them higher up, each a box-shadow copy of a tiny dot.
function drawStars() {
  const layers = [
    [".stars.s1", 220, [0.35, 0.8]],
    [".stars.s2", 70, [0.6, 0.95]],
    [".stars.s3", 18, [0.85, 1]],
  ];
  const tints = ["255, 255, 255", "220, 230, 255", "255, 244, 220"];
  for (const [selector, count, [minA, maxA]] of layers) {
    const shadows = [];
    for (let i = 0; i < count; i++) {
      const x = (Math.random() * 100).toFixed(2);
      const y = (Math.pow(Math.random(), 1.4) * 60).toFixed(2);
      const a = (minA + Math.random() * (maxA - minA)).toFixed(2);
      const tint = tints[Math.floor(Math.random() * tints.length)];
      shadows.push(`${x}vw ${y}vh 0 0 rgba(${tint}, ${a})`);
    }
    document.querySelector(selector).style.boxShadow = shadows.join(", ");
  }
}

// ---------- Start ----------

setMode(document.documentElement.dataset.mode === "night" ? "night" : "day");
drawStars();

applyView();
renderAll(loadAccounts());
if (!Object.values(current).some(Boolean)) openSettings();
