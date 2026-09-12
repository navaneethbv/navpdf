const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("navpdf", {
  call: (args) => ipcRenderer.invoke("pdf:call", args),
  save: (payload) => ipcRenderer.invoke("pdf:save", payload),
  dirty: (value) => ipcRenderer.send("pdf:dirty", value),
});
