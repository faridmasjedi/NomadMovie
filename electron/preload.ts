import { contextBridge, ipcRenderer, webUtils } from "electron";

// The few desktop-only features the editor page may use. It gets no other access to the computer.
export interface UpdateInfo {
  state: "available" | "ready";
  version: string;
  /** where to download it, when it can't be installed automatically */
  url?: string;
}

contextBridge.exposeInMainWorld("nomadDesktop", {
  /** where a dropped or chosen file is on disk, so the engine can read it in place instead of receiving a copy */
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  /** new versions: called now with what is already known, and again when an update is found or downloaded */
  onUpdate: (cb: (info: UpdateInfo) => void) => {
    const handler = (_e: unknown, info: UpdateInfo) => cb(info);
    ipcRenderer.on("update", handler);
    ipcRenderer.invoke("update:get").then((info: UpdateInfo | null) => info && cb(info));
    return () => ipcRenderer.off("update", handler);
  },
  /** restarts the app into a downloaded update */
  installUpdate: () => ipcRenderer.invoke("update:install"),
});
