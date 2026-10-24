import { app, ipcMain, net, type BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { UpdateInfo } from "./preload.ts";

/*
 * New versions come from GitHub Releases.
 *   • Windows (installed with setup.exe) and Linux (AppImage): downloaded in the background and installed on restart.
 *   • Everything else (macOS without an Apple Developer ID signature, the plain zips, the .deb): the editor shows that
 *     a new version is out, with a link to download it. (macOS refuses to auto-install apps that aren't signed.)
 */

const REPO = "faridmasjedi/NomadMovie";
const DOWNLOAD_PAGE = "https://faridmasjedi.github.io/NomadMovie/#download";
const EVERY = 6 * 60 * 60_000;

let current: UpdateInfo | null = null;

/** 1.10.0 > 1.9.2; a pre-release (1.2.0-beta.1) is older than its release */
export function newer(a: string, b: string) {
  const parse = (v: string) => {
    const [main, pre] = v.replace(/^v/, "").split("-", 2);
    return { n: main.split(".").map((x) => Number(x) || 0), pre };
  };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if ((x.n[i] ?? 0) !== (y.n[i] ?? 0)) return (x.n[i] ?? 0) > (y.n[i] ?? 0);
  if (x.pre && y.pre) return x.pre > y.pre;
  return !x.pre && !!y.pre;
}

function canInstallItself() {
  if (process.platform === "win32") return fs.existsSync(path.join(path.dirname(process.execPath), `Uninstall ${app.getName()}.exe`));
  if (process.platform === "linux") return !!process.env.APPIMAGE;
  return false;
}

export function watchForUpdates(getWindow: () => BrowserWindow | null, origin: string, opts: { check: boolean }) {
  const send = (info: UpdateInfo) => {
    current = info;
    getWindow()?.webContents.send("update", info);
  };
  const fromEditor = (e: Electron.IpcMainInvokeEvent) => !!e.senderFrame && new URL(e.senderFrame.url).origin === origin;

  ipcMain.handle("update:get", () => current);
  if (!opts.check) return void ipcMain.handle("update:install", () => {});

  if (canInstallItself()) {
    import("electron-updater").then(({ default: { autoUpdater } }) => {
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.on("update-downloaded", (info) => send({ state: "ready", version: info.version }));
      autoUpdater.on("error", (e) => console.error("update:", e?.message ?? e));
      ipcMain.handle("update:install", (e) => {
        if (fromEditor(e) && current?.state === "ready") autoUpdater.quitAndInstall();
      });
      const check = () => autoUpdater.checkForUpdates().catch(() => {});
      setTimeout(check, 10_000);
      setInterval(check, EVERY).unref();
    });
    return;
  }

  ipcMain.handle("update:install", () => {});
  const check = async () => {
    try {
      const r = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: "application/vnd.github+json" } });
      if (!r.ok) return;
      const tag = String(((await r.json()) as { tag_name?: string }).tag_name ?? "");
      if (tag && newer(tag, app.getVersion())) send({ state: "available", version: tag.replace(/^v/, ""), url: DOWNLOAD_PAGE });
    } catch {
      /* offline */
    }
  };
  setTimeout(check, 10_000);
  setInterval(check, EVERY).unref();
}
