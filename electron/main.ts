import { app, BrowserWindow, Menu, dialog, session, shell } from "electron";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { serveEditor } from "./bridge.ts";
import { watchForUpdates } from "./updates.ts";

// The editor's address inside the app. Nothing listens on it (see bridge.ts); it stays the same because the
// projects saved in the app are tied to it.
const ORIGIN = "http://127.0.0.1:47821";

// `--smoke-test=<file>`: start with a throwaway profile, check that everything works, write the result, quit (used by CI)
const smokeArg = process.argv.find((a) => a.startsWith("--smoke-test"));
const smokeOut = smokeArg ? smokeArg.split("=")[1] || path.join(os.tmpdir(), "nomadmovie-smoke.json") : null;
if (smokeOut) app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "nomadmovie-smoke-")));

// the app was called "Farid Editor" (and before that "Nova Editor"): on the first start, bring its projects and
// settings along. (Electron creates the new data folder before this runs, so a marker file records the migration.)
const userData = app.getPath("userData");
const migrated = path.join(userData, ".migrated");
if (!smokeOut && !fs.existsSync(migrated)) {
  for (const old of ["Farid Editor", "Nova Editor"]) {
    const dir = path.join(app.getPath("appData"), old);
    if (!fs.existsSync(path.join(dir, "IndexedDB"))) continue;
    try {
      fs.cpSync(dir, userData, { recursive: true, force: true, filter: (src) => !/Singleton|lockfile|\.lock$/i.test(path.basename(src)) });
    } catch (e) {
      console.error("could not copy the old app data:", e);
    }
    break;
  }
  try {
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(migrated, new Date().toISOString());
  } catch {
    /* read-only data folder: try again next time */
  }
}
process.env.NOMAD_DATA_DIR ??= userData;

let win: BrowserWindow | null = null;

if (!smokeOut && !app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

/** only web links leave the app (never file:// or other schemes) */
function openOutside(u: string) {
  if (/^https?:\/\//i.test(u) && !u.startsWith(ORIGIN)) shell.openExternal(u);
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1100,
    minHeight: 700,
    title: "NomadMovie",
    backgroundColor: "#0d0e12",
    show: false,
    webPreferences: {
      // the editor is a plain web page: no Node.js access, isolated and sandboxed; preload.ts is its only bridge
      preload: path.join(import.meta.dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false, // keep rendering exports when the window is in the background
      spellcheck: false,
    },
  });
  win.once("ready-to-show", () => !smokeOut && win?.show());
  // links to the outside world open in the default browser
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    openOutside(u);
    return { action: "deny" };
  });
  // the window only ever shows the editor; any other page goes to the browser instead
  win.webContents.on("will-navigate", (e, u) => {
    if (new URL(u).origin === ORIGIN) return;
    e.preventDefault();
    openOutside(u);
  });
  win.on("closed", () => (win = null));
  await win.loadURL(`${ORIGIN}/`);
}

/** the engine talks to the window over a private socket (a named pipe on Windows), protected by a random token */
function privateSocket() {
  const id = `nomadmovie-${process.pid}-${randomBytes(6).toString("hex")}`;
  return process.platform === "win32" ? `\\\\.\\pipe\\${id}` : path.join(os.tmpdir(), `${id}.sock`);
}

app.whenReady().then(async () => {
  // microphone for voice-over recording (only for the editor's own page)
  const ours = (u?: string) => !!u && u.startsWith(ORIGIN);
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(ours(wc.getURL()) && ["media", "fullscreen", "clipboard-sanitized-write"].includes(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => ours(origin) && ["media", "fullscreen"].includes(permission));

  // exports: ask where to save
  session.defaultSession.on("will-download", (_e, item) => {
    item.setSaveDialogOptions({ title: "Save export", defaultPath: path.join(app.getPath("videos"), item.getFilename()) });
  });

  const socket = privateSocket();
  const token = randomBytes(32).toString("hex");
  try {
    const { startPrivateEngine } = await import("../server/index.ts");
    await startPrivateEngine({ socket, token, staticDir: path.join(app.getAppPath(), "dist") });
  } catch (e) {
    dialog.showErrorBox("NomadMovie", `Could not start NomadMovie's engine.\n\n${e instanceof Error ? e.message : e}`);
    app.quit();
    return;
  }
  app.on("will-quit", () => process.platform !== "win32" && fs.rmSync(socket, { force: true }));
  serveEditor(ORIGIN, socket, token);

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: "appMenu" },
      { role: "fileMenu" },
      { label: "Edit", submenu: [{ role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]),
  );

  watchForUpdates(() => win, ORIGIN, { check: !smokeOut });
  await createWindow();
  if (smokeOut) return void smokeTest(smokeOut);
  app.on("activate", () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
  });
});

// no <webview> tags or extra windows with their own settings
app.on("web-contents-created", (_e, wc) => wc.on("will-attach-webview", (ev) => ev.preventDefault()));

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

/* ------------------------------------------------------------------------------------------------ */

/** checks that the installed app really works: editor, engine, ffmpeg, graphics, storage, and no open port */
async function smokeTest(out: string) {
  const result: Record<string, unknown> = { version: app.getVersion(), platform: `${process.platform}-${process.arch}` };
  setTimeout(() => {
    fs.writeFileSync(out, JSON.stringify({ ...result, ok: false, error: "timed out" }, null, 2));
    app.exit(2);
  }, 120_000).unref();
  let ok = false;
  try {
    result.noOpenPort = await new Promise<boolean>((resolve) => {
      const s = net.connect(47821, "127.0.0.1");
      s.once("connect", () => (s.destroy(), resolve(false)));
      s.once("error", () => resolve(true));
    });
    result.page = await win!.webContents.executeJavaScript(`(${pageChecks.toString()})()`);
    ok = result.noOpenPort === true && (result.page as { ok?: boolean }).ok === true;
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
  }
  result.ok = ok;
  fs.writeFileSync(out, JSON.stringify(result, null, 2));
  app.exit(ok ? 0 : 1);
}

/** runs inside the editor window */
async function pageChecks() {
  const r: Record<string, unknown> = { ok: false };
  const wait = (ms: number) => new Promise((s) => setTimeout(s, ms));
  for (let i = 0; i < 150 && !document.querySelector(".tabs-v"); i++) await wait(100);
  r.editor = !!document.querySelector(".tabs-v");
  r.desktopBridge = typeof (window as unknown as { nomadDesktop?: unknown }).nomadDesktop === "object";
  const h = await (await fetch("/api/health")).json();
  r.ffmpeg = h.ffmpeg;
  r.webgl = !!document.createElement("canvas").getContext("webgl2");
  r.videoEncoder = typeof VideoEncoder === "function";
  // a 1-second tone goes through the engine's converter: upload → ffmpeg → download
  const rate = 8000, n = rate;
  const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); str(8, "WAVE"); str(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin((i / rate) * 2 * Math.PI * 440) * 8000, true);
  const { id } = await (await fetch("/api/import?name=tone.wav&force=1", { method: "POST", body: buf })).json();
  let st: { status: string; error?: string } = { status: "running" };
  for (let i = 0; i < 300 && st.status === "running"; i++) {
    await wait(100);
    st = await (await fetch(`/api/import/${id}`)).json();
  }
  r.convert = st.status === "done" ? (await (await fetch(`/api/import/${id}/file`)).arrayBuffer()).byteLength : st.error ?? st.status;
  r.storage = await new Promise((res) => {
    const q = indexedDB.open("nomad-smoke-test");
    q.onsuccess = () => (q.result.close(), res(true));
    q.onerror = () => res(false);
  });
  r.ok = r.editor === true && r.desktopBridge === true && r.ffmpeg === true && r.webgl === true && typeof r.convert === "number" && (r.convert as number) > 0 && r.storage === true;
  return r;
}
