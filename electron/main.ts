import { app, BrowserWindow, Menu, dialog, session, shell } from "electron";
import path from "node:path";

// fixed local port: the editor's saved projects (IndexedDB) are tied to this origin
const PORT = 47821;

process.env.NOVA_DATA_DIR ??= app.getPath("userData");

let win: BrowserWindow | null = null;

if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

async function createWindow(url: string) {
  win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1100,
    minHeight: 700,
    title: "Farid Editor",
    backgroundColor: "#0d0e12",
    show: false,
    webPreferences: {
      backgroundThrottling: false, // keep rendering exports when the window is in the background
      spellcheck: false,
    },
  });
  win.once("ready-to-show", () => win?.show());
  // links to the outside world open in the default browser
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    if (!u.startsWith(url)) shell.openExternal(u);
    return { action: "deny" };
  });
  win.on("closed", () => (win = null));
  await win.loadURL(url);
}

app.whenReady().then(async () => {
  // microphone for voice-over recording
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(["media", "fullscreen", "clipboard-sanitized-write"].includes(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => ["media", "fullscreen"].includes(permission));

  // exports: ask where to save
  session.defaultSession.on("will-download", (_e, item) => {
    item.setSaveDialogOptions({ title: "Save export", defaultPath: path.join(app.getPath("videos"), item.getFilename()) });
  });

  const { startServer } = await import("../server/index.ts");
  let port: number;
  try {
    port = await startServer(PORT, { staticDir: path.join(app.getAppPath(), "dist") });
  } catch (e) {
    dialog.showErrorBox("Farid Editor", `Could not start the local engine on port ${PORT}.\n\n${e instanceof Error ? e.message : e}`);
    app.quit();
    return;
  }

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: "appMenu" },
      { role: "fileMenu" },
      { label: "Edit", submenu: [{ role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]),
  );

  const url = `http://127.0.0.1:${port}`;
  await createWindow(url);
  app.on("activate", () => {
    if (!BrowserWindow.getAllWindows().length) createWindow(url);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
