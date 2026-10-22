// Toolbar and site headers. The sites themselves are placed by main.js right
// under these headers, using the positions it sends in each "state" message.

const panesEl = document.getElementById("panes");
const template = document.getElementById("pane-template");
const panes = {};
let current = null;

function makePane(key, name) {
  const el = template.content.firstElementChild.cloneNode(true);
  el.dataset.key = key;
  el.querySelector("use").setAttribute("href", `#icon-${key}`);
  el.querySelector(".pane-name").textContent = name;
  el.querySelector(".pane-loading").textContent = `Loading ${name}…`;
  el.querySelector(".pane-tools").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (btn) window.hub.pane(key, btn.dataset.action);
  });
  panesEl.appendChild(el);
  return el;
}

function render(state) {
  current = state;
  document.documentElement.dataset.theme = state.theme;
  document.body.classList.toggle("fullscreen", state.fullscreen);

  for (const tab of document.querySelectorAll(".tab")) {
    tab.setAttribute("aria-pressed", String(tab.dataset.mode === state.mode));
  }

  for (const p of state.panes) {
    const el = panes[p.key] || (panes[p.key] = makePane(p.key, p.name));
    el.hidden = !p.visible;
    el.style.left = `${p.x}px`;
    el.style.width = `${p.width}px`;
    el.classList.toggle("loading", p.loading);
    el.classList.toggle("muted", p.muted);
    el.querySelector('[data-action="back"]').disabled = !p.canGoBack;
    el.querySelector('[data-action="zoom-out"]').disabled = p.zoom <= 0.5;
    el.querySelector('[data-action="zoom-in"]').disabled = p.zoom >= 1.5;
    el.querySelector('[data-action="mute"]').title = p.muted ? "Turn sound on" : "Turn sound off";
  }
}

document.querySelector(".tabs").addEventListener("click", (e) => {
  const tab = e.target.closest(".tab");
  if (tab) window.hub.setMode(tab.dataset.mode);
});

document.getElementById("theme").addEventListener("click", () => {
  window.hub.setTheme(current?.theme === "night" ? "day" : "night");
});

window.hub.onState(render);
window.hub.ready();
// Ask the app to re-place the sites whenever this window changes size.
window.addEventListener("resize", () => window.hub.ready());
