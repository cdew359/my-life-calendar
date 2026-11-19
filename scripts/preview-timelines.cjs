const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
app.setPath(
  "userData",
  fs.mkdtempSync(path.join(require("node:os").tmpdir(), "calendar-timeline-preview-")),
);
app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1040,
    height: 840,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  win.loadURL("http://127.0.0.1:5180/tests/ui/time-planning.html");
});
app.on("window-all-closed", () => app.quit());
