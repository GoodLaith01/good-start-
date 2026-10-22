// Gives the toolbar page (ui/) a small, safe set of calls into the app.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hub", {
  setMode: (mode) => ipcRenderer.send("set-mode", mode),
  setTheme: (theme) => ipcRenderer.send("set-theme", theme),
  pane: (key, action) => ipcRenderer.send("pane", key, action),
  onState: (fn) => ipcRenderer.on("state", (_e, state) => fn(state)),
  ready: () => ipcRenderer.send("ready"),
});
