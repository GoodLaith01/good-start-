// Gives the toolbar page (ui/) a small, safe set of calls into the app.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hub", {
  setMode: (mode) => ipcRenderer.send("set-mode", mode),
  setTheme: (theme) => ipcRenderer.send("set-theme", theme),
  pane: (key, action) => ipcRenderer.send("pane", key, action),
  overlay: (name) => ipcRenderer.send("overlay", name),
  welcomed: () => ipcRenderer.send("welcomed"),
  setNotifications: (on) => ipcRenderer.send("set-notifications", on),
  online: (isOnline) => ipcRenderer.send("online", isOnline),
  badge: (count, dataUrl) => ipcRenderer.send("badge", count, dataUrl),
  onState: (fn) => ipcRenderer.on("state", (_e, state) => fn(state)),
  onToast: (fn) => ipcRenderer.on("toast", (_e, text) => fn(text)),
  ready: () => ipcRenderer.send("ready"),
});
