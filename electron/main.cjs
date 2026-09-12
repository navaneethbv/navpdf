const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { pathToFileURL } = require("node:url");
const { EngineBridge } = require("./bridge.cjs");
let bridge, window;
app.whenReady().then(() => {
  const root = app.isPackaged
    ? process.resourcesPath
    : path.join(__dirname, "..");
  bridge = new EngineBridge(
    root,
    app.isPackaged ? path.join(root, "python/bin/python") : undefined,
  );
  const entry = pathToFileURL(path.join(__dirname, "../dist/index.html")).href;
  window = new BrowserWindow({
    width: 1440,
    height: 1000,
    minWidth: 820,
    minHeight: 600,
    title: "NavPDF",
    backgroundColor: "#edf0f2",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (e) => e.preventDefault());
  window.webContents.session.setPermissionRequestHandler(
    (_web, _permission, callback) => callback(false),
  );
  function trusted(event) {
    if (event.sender !== window.webContents || event.senderFrame?.url !== entry)
      throw new Error("Untrusted request.");
  }
  ipcMain.handle("pdf:call", (event, args) => {
    trusted(event);
    return bridge.call(args);
  });
  ipcMain.handle("pdf:save", async (event, { data, name }) => {
    trusted(event);
    const result = await dialog.showSaveDialog(window, {
      defaultPath: path.basename(name),
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (result.canceled || !result.filePath) return false;
    const temp = result.filePath + ".navpdf-" + Date.now();
    try {
      await fs.writeFile(temp, Buffer.from(data, "base64"), {
        mode: 0o600,
        flag: "wx",
      });
      await fs.rename(temp, result.filePath);
    } finally {
      await fs.rm(temp, { force: true });
    }
    return true;
  });
  window.on("close", (event) => {
    if (window.isDocumentEdited()) {
      const choice = dialog.showMessageBoxSync(window, {
        type: "question",
        buttons: ["Keep editing", "Discard and close"],
        defaultId: 0,
        cancelId: 0,
        message: "Close without exporting?",
        detail: "Changes in this workspace will be lost.",
      });
      if (choice === 0) event.preventDefault();
    }
  });
  ipcMain.on("pdf:dirty", (event, dirty) => {
    trusted(event);
    window.setDocumentEdited(Boolean(dirty));
  });
  window.loadURL(entry);
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  if (!BrowserWindow.getAllWindows().length) bridge?.close();
});
app.on("will-quit", () => bridge?.close());
