// Desktop-only features, provided by the app's preload script (electron/preload.ts). Undefined in a browser.
export interface UpdateInfo {
  state: "available" | "ready";
  version: string;
  url?: string;
}

interface DesktopBridge {
  pathForFile: (file: File) => string;
  onUpdate: (cb: (info: UpdateInfo) => void) => () => void;
  installUpdate: () => Promise<void>;
}

export const desktop = (window as unknown as { nomadDesktop?: DesktopBridge }).nomadDesktop;
