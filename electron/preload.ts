import { contextBridge, ipcRenderer, webUtils } from "electron";

// The few desktop-only features the editor page may use. It gets no other access to the computer.
export interface UpdateInfo {
  state: "available" | "ready";
  version: string;
  /** where to download it, when it can't be installed automatically */
  url?: string;
}

contextBridge.exposeInMainWorld("nomadDesktop", {
  /** "darwin" | "win32" | "linux": the editor leaves room for the window buttons in its top bar */
  platform: process.platform,
  /** where a dropped or chosen file is on disk, so the engine can read it in place instead of receiving a copy */
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  /** new versions: called now with what is already known, and again when an update is found or downloaded */
  onUpdate: (cb: (info: UpdateInfo) => void) => {
    const handler = (_e: unknown, info: UpdateInfo) => cb(info);
    ipcRenderer.on("update", handler);
    ipcRenderer.invoke("update:get").then((info: UpdateInfo | null) => info && cb(info));
    return () => ipcRenderer.off("update", handler);
  },
  /** Export → "Save to": a suggested location in the Movies / Videos folder */
  defaultSavePath: (name: string): Promise<string> => ipcRenderer.invoke("save:default", name),
  /** the system save dialog; the chosen location is the only place the engine may write the export to */
  chooseSavePath: (suggested: string, ext: string): Promise<string | null> => ipcRenderer.invoke("save:choose", suggested, ext),
  /** shows a saved export in Finder / Explorer */
  showInFolder: (file: string) => ipcRenderer.invoke("save:reveal", file),
  /** restarts the app into a downloaded update */
  installUpdate: () => ipcRenderer.invoke("update:install"),
});
