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
  badge: (count, dataUrl, trayUrl) => ipcRenderer.send("badge", count, dataUrl, trayUrl),
  setSetting: (name, value) => ipcRenderer.send("set-setting", name, value),
  muteAll: (on) => ipcRenderer.send("mute-all", on),
  setOrder: (order) => ipcRenderer.send("set-order", order),
  setHidden: (key, hide) => ipcRenderer.send("set-hidden", key, hide),
  setWidths: (widths) => ipcRenderer.send("set-widths", widths),
  resetWidths: () => ipcRenderer.send("reset-widths"),
  googleHelp: (action) => ipcRenderer.send("google-help", action),
  onState: (fn) => ipcRenderer.on("state", (_e, state) => fn(state)),
  onToast: (fn) => ipcRenderer.on("toast", (_e, text) => fn(text)),
  ready: () => ipcRenderer.send("ready"),
});
